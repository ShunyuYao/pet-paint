'use strict';
// LAN room over the host's `pet.sessions` bridge (SPEC §10). Up to 4 humans: the room host is
// slot 0 and the referee; guests take slots 1–3 in arrival order. Star topology: guests only
// talk to the host, the host forwards what the others need.
//
// Who computes what: every machine simulates its OWN player (movement, shots, paint) and
// streams it; the host also runs the computer players and the referee (hp, downs, respawns,
// clock, result). Paint merges by paint time (game/paint.cjs), so arrival order never matters.
//
// Transport rules (demo/core/peer-session/contracts.js): only the `latest` lane is used
// (`reliable` allows 1,024 messages per session); per guest channel ≤ 30 sends/s per lane;
// ≤ 8 latest keys; ≤ 60 KB a message. Latest messages can be coalesced or dropped, so every
// event carries a sequence number and is repeated in later messages until acknowledged.
// Event lists travel as one JSON string (JSON node budget per poll batch).
//   guest → host: hello (1 Hz: profile / team / weapon / ready / avatars it has),
//                 up (20 Hz: own state + unacknowledged events + ack of the host log), ping
//   host → all:   st (20 Hz in a match, 5 Hz in the lobby: phase, clock, roster, all actor
//                 states, acks, the event log since the slowest ack), map (2 Hz: one grid chunk)
//   host → one:   pong (clock sync)
const Game=require('./game.cjs');
const Sim=require('./sim.cjs');
const Paint=require('./paint.cjs');
const Arena=require('./arena.cjs');
const {MATCH,WEAPONS,PLAYER}=require('./config.cjs');

const PROTOCOL={id:'pet-paint',version:1},PURPOSE='paint.profile.v1';
const SEND_MS=50,LOBBY_MS=200,MAP_MS=500,HELLO_MS=1000,PING_MS=2000,POLL_GAP=45,STALE_MS=3000,INTERP_MS=110,EXTRAP_MS=100;
const MAX_EVENTS=320,GUEST_SLOTS=[1,2,3];
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const encodeAsset=value=>{const b=new TextEncoder().encode(JSON.stringify(value));let s='';for(let i=0;i<b.length;i+=8192)s+=String.fromCharCode(...b.subarray(i,i+8192));return btoa(s);};
const decodeAsset=value=>{if(typeof value!=='string'||value.length>1400000)throw Error('invalid_profile');return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(value),c=>c.charCodeAt(0))));};
const MAX_PAYLOAD=Math.ceil(1024*1024/3)*4;
const SHARED=new Set(['splat','fire','hurt','down','respawn']); // events every screen needs
const cleanName=v=>[...String(v||'玩家')].slice(0,16).join('');
function validProfile(p){
  if(!p||typeof p!=='object'||typeof p.signature!=='string'||p.signature.length>200)throw Error('invalid_profile');
  return {name:cleanName(p.name),signature:p.signature,kind:['doll3d','sprite','toy'].includes(p.kind)?p.kind:'toy'};
}
const teamSize=list=>Math.max(1,...[0,1].map(t=>list.filter(p=>p.team===t).length));

function create(sdk,{onRoster=()=>{},onAsset=()=>{},onConnection=()=>{},onError=()=>{},now=()=>Date.now(),durationOverride=null}={}){
  let context=null,host=false,game=null,connection='waiting',closed=false,disposed=false,cursor=0,epoch=0,closeReason='';
  let profile=null,asset=null,prefs={weapon:'sprayer',team:null,ready:false,duration:MATCH.defaultDuration,cpuLevel:1};
  const timers=[],recent=[];
  const note=e=>{if(e.type==='message')return;recent.push({t:Math.round(now()),type:e.type,reason:e.reason,from:e.from?String(e.from).slice(0,8):undefined});if(recent.length>30)recent.shift();};
  const fail=e=>{recent.push({t:Math.round(now()),type:'error',reason:e?.message||String(e)});if(recent.length>30)recent.shift();onError(e instanceof Error?e:Error(String(e)));};
  const status=s=>{if(connection!==s){connection=s;onConnection(s,{connected:'已联机',waiting:'等待连接',reconnecting:'正在重连',closed:'联机已结束'}[s]||s);}};
  // Plain JSON only (the bridge rejects undefined values with invalid_request). Refusals are
  // kept in the diagnostics ring even when they are expected to pass (never silent).
  const send=(type,payload,key,to)=>closed||disposed?Promise.reject(Error('session_closed')):sdk.send({...(to?{to}:{}),type,payload:JSON.parse(JSON.stringify(payload)),lane:'latest',key})
    .catch(e=>{recent.push({t:Math.round(now()),type:'send_error',reason:type+': '+e.message});if(recent.length>30)recent.shift();throw e;});
  const TRANSIENT=/backpressure|quota_exceeded|peer_offline|not_connected|invalid_request/;
  // ---------- shared: remote actor interpolation ----------
  const interp=new Map(); // slot → [{t,s}]
  function pushState(slot,s){
    if(!s)return;const buf=interp.get(slot)||[];const last=buf[buf.length-1];
    if(last&&Math.hypot(last.s.x-s.x,last.s.z-s.z)>3.5)buf.length=0; // teleport (respawn): snap
    buf.push({t:now(),s});while(buf.length>12)buf.shift();interp.set(slot,buf);
  }
  function applyInterp(){
    const t=now()-INTERP_MS;
    for(const a of game.world.actors){
      if(a.owner==='local')continue;const buf=interp.get(a.slot);if(!buf?.length)continue;
      let i=buf.length-1;while(i>0&&buf[i-1].t>t)i--;
      const b=buf[i],p=i>0?buf[i-1]:null;let s;
      if(p&&b.t>=t&&p.t<=t){const k=(t-p.t)/Math.max(1,b.t-p.t);s={...b.s,x:p.s.x+(b.s.x-p.s.x)*k,z:p.s.z+(b.s.z-p.s.z)*k,face:p.s.face+angleDiff(p.s.face,b.s.face)*k};}
      else if(b.t<=t){const dt=Math.min(EXTRAP_MS,t-b.t)/1000;s={...b.s,x:b.s.x+b.s.vx*dt,z:b.s.z+b.s.vz*dt};}
      else s=b.s;
      a.x=s.x;a.z=s.z;a.vx=s.vx;a.vz=s.vz;a.face=s.face;a.diving=s.diving;a.firing=s.firing;a.rolling=s.rolling;a.ink=s.ink;
      a.aimX=a.x+Math.cos(a.face);a.aimZ=a.z+Math.sin(a.face);
      if(!host){a.alive=s.alive;a.hp=s.hp;}
    }
  }
  const angleDiff=(a,b)=>{let d=(b-a)%(Math.PI*2);if(d>Math.PI)d-=Math.PI*2;else if(d<-Math.PI)d+=Math.PI*2;return d;};

  // =========================== HOST ===========================
  const peers=new Map(); // sessionPeerId → {id,slot,online,lastHeard,lastSeq,gack,no,profile,team,weapon,ready,have:Set,sent:Set}
  let log=[],gseq=0,lobbySerial=0,mapChunk=0,roster=[],waiting=[],autoStartAt=0;
  const payloads=new Map();let uploading=false,uploadAfter=0;
  function humans(){
    const me={slot:0,name:profile.name,signature:profile.signature,kind:'human',owner:'local',team:prefs.team??0,weapon:prefs.weapon,ready:prefs.ready};
    const list=[me];
    for(const p of peers.values())if(p.slot!==null&&p.profile)list.push({slot:p.slot,name:p.profile.name,signature:p.profile.signature,kind:'human',owner:'remote',team:p.team??(p.slot%2),weapon:p.weapon,ready:p.ready,online:p.online});
    // Keep teams valid (≤ 2 each): overflow moves to the other team.
    for(const t of [0,1]){const on=list.filter(x=>x.team===t);while(on.length>2){const x=on.pop();x.team=1-t;}}
    return list.sort((a,b)=>a.slot-b.slot);
  }
  function lobbyRoster(){return humans().map(h=>({...h}));}
  function freeSlot(){const taken=new Set([...peers.values()].map(p=>p.slot));return GUEST_SLOTS.find(n=>!taken.has(n));}
  function hostLog(e,origin){if(!SHARED.has(e.type))return;log.push({...e,g:++gseq,o:origin,no:game.match.no});if(log.length>4000)log.splice(0,log.length-4000);}
  function startMatch(){
    const hs=humans();roster=Game.fillBots(hs.map(h=>({slot:h.slot,team:h.team,name:h.name,weapon:h.weapon,kind:'human',owner:h.slot===0?'local':'remote',signature:h.signature})),{size:teamSize(hs)});
    waiting=[];Game.setRoster(game,roster);Game.start(game);
    for(const p of peers.values()){p.ready=false;}prefs.ready=false;autoStartAt=0;
    onRoster();
  }
  function hostStep(dt,input){
    applyInterp();
    Game.step(game,dt,input);
    const out=Game.drain(game);for(const e of out)hostLog(e,0);
    // Lobby: every human ready → start after a beat.
    if(game.match.phase==='lobby'){
      const hs=humans(),all=hs.length>=2&&hs.every(h=>h.ready);
      if(all&&!autoStartAt)autoStartAt=now()+800;if(!all)autoStartAt=0;
      if(autoStartAt&&now()>=autoStartAt)startMatch();
      else if(JSON.stringify(game.roster.map(r=>[r.slot,r.team,r.name,r.weapon]))!==JSON.stringify(hs.map(r=>[r.slot,r.team,r.name,r.weapon]))){Game.setRoster(game,hs.map(h=>({...h,kind:'human'})));onRoster();}
    }
    return out;
  }
  function stPayload(){
    const m=game.match,online=[...peers.values()].filter(p=>p.slot!==null&&p.online);
    const minAck=online.length?Math.min(...online.map(p=>p.gack)):gseq;
    const events=log.filter(e=>e.g>minAck&&e.no===m.no).slice(0,MAX_EVENTS);
    const acks={};for(const p of peers.values())if(p.slot!==null)acks[p.slot]=p.lastSeq;
    return {no:m.no,ph:m.phase,pt:+m.phaseT.toFixed(3),dur:m.duration,ms:Math.round(game.world.ms),lv:lobbySerial,
      roster:(m.phase==='lobby'?lobbyRoster():game.roster).map(r=>({slot:r.slot,team:r.team,name:r.name,weapon:r.weapon,kind:r.kind,signature:r.signature||'',ready:!!r.ready})),
      waiting:waiting.slice(),a:game.world.actors.map(Sim.actorState),acks,ev:JSON.stringify(events),g:gseq,
      hash:m.phase==='results'||m.phase==='judge'?Paint.hash(game.world.paint):undefined,result:m.result||undefined};
  }
  let lastSt=0,lastMap=0,sendingSt=false;
  async function hostPublish(){
    const t=now(),m=game.match,gap=m.phase==='lobby'||m.phase==='results'?LOBBY_MS:SEND_MS;
    if(sendingSt||t-lastSt<gap||closed)return;const list=[...peers.values()].filter(p=>p.slot!==null&&p.online);if(!list.length)return;
    lastSt=t;sendingSt=true;
    try{await send('paint.st',stPayload(),'st','*');}catch(e){if(!TRANSIENT.test(e.message))fail(e);}finally{sendingSt=false;}
    if(m.phase!=='lobby'&&t-lastMap>=MAP_MS){lastMap=t;const chunk=Paint.encodeChunk(game.world.paint,mapChunk);mapChunk=(mapChunk+1)%Paint.CHUNKS;
      send('paint.map',{no:m.no,...chunk},'map','*').catch(e=>{if(!TRANSIENT.test(e.message))fail(e);});}
    // Trim the log to what every online guest has acknowledged.
    const minAck=list.length?Math.min(...list.map(p=>p.gack)):gseq;if(log.length&&log[0].g<=minAck-2000)log=log.filter(e=>e.g>minAck-2000);
  }
  function peer(id){let p=peers.get(id);if(!p){p={id,slot:null,online:true,lastHeard:now(),lastSeq:0,gack:0,no:-1,profile:null,team:null,weapon:'sprayer',ready:false,have:new Set(),sent:new Set()};peers.set(id,p);}return p;}
  function dropPeer(id){
    const p=peers.get(id);if(!p)return;peers.delete(id);
    if(p.slot===null)return;
    // A player who left mid-match is taken over by a computer player (teams stay even).
    const r=game.roster.find(x=>x.slot===p.slot);
    if(r&&game.match.phase!=='lobby'){r.kind='bot';r.owner='local';r.name=r.name+'（电脑接管）';Game.setRoster(game,game.roster);}
    else if(game.match.phase==='lobby')Game.setRoster(game,lobbyRoster());
    interp.delete(p.slot);onRoster();
  }
  function acceptPending(p){
    const v=p.pending;if(!v||p.profile?.signature!==v.signature)return;p.pending=null;
    payloads.set(v.signature,v.data);for(const q of peers.values())if(q!==p)q.sent.delete(v.signature);onAsset(v.signature,v.asset);
  }
  function hostUpload(){
    if(closed||uploading||now()<uploadAfter)return;
    const own=ownPayload();if(own)payloads.set(profile.signature,own);
    const need=new Set(humans().map(h=>h.signature));
    for(const p of peers.values()){
      if(!p.online||p.slot===null)continue;
      const mine=p.profile?.signature;
      const next=[...need].find(sig=>sig!==mine&&!p.sent.has(sig)&&!p.have.has(sig)&&payloads.has(sig));if(!next)continue;
      uploading=true;
      sdk.transfer({to:p.id,purpose:PURPOSE,contentType:'application/octet-stream',dataBase64:payloads.get(next)})
        .then(()=>p.sent.add(next)).catch(e=>{uploadAfter=now()+2000;if(!TRANSIENT.test(e.message))fail(e);}).finally(()=>{uploading=false;});
      return;
    }
  }
  async function hostEvent(e){
    const from=e.from;
    if(e.type==='closed'){end(e.reason||'peer_left');return;}
    if(!from)return;
    if(e.type==='peer_left'){dropPeer(from);return;}
    if(e.type==='disconnected'){const p=peers.get(from);if(p)p.online=false;return;}
    if(e.type==='connected'||e.type==='peer_joined'||e.type==='resync_required'){const p=peer(from);p.online=true;p.lastHeard=now();if(e.type==='resync_required')p.gack=Math.min(p.gack,gseq);return;}
    if(e.type==='transfer'&&e.purpose===PURPOSE){
      const data=await sdk.readTransfer({transferId:e.transferId});
      if(data.purpose!==PURPOSE||data.contentType!=='application/octet-stream')throw Error('invalid_profile');
      const value=decodeAsset(data.dataBase64);if(!value||value.v!==1||typeof value.signature!=='string')throw Error('invalid_profile');
      const p=peer(from);p.lastHeard=now();
      // Accept only the look the guest declared as its own; it may arrive before its hello.
      p.pending={signature:value.signature,data:data.dataBase64,asset:value.asset};acceptPending(p);return;
    }
    if(e.type!=='message')return;
    const {type,payload:v}=e.message,p=peer(from);p.lastHeard=now();p.online=true;if(!v||typeof v!=='object')return;
    if(type==='paint.hello'){
      let prof;try{prof=validProfile(v.profile);}catch{return;}
      if(p.slot===null){const n=freeSlot();if(n===undefined)return;p.slot=n;if(game.match.phase!=='lobby'&&!waiting.includes(n))waiting.push(n);}
      p.profile=prof;p.weapon=WEAPONS[v.weapon]?v.weapon:'sprayer';p.team=v.team===0||v.team===1?v.team:null;p.ready=!!v.ready;
      p.have=new Set(Array.isArray(v.have)?v.have.filter(s=>typeof s==='string').slice(0,8):[]);acceptPending(p);
      lobbySerial++;onRoster();
      if(!p.told){p.told=true;send('paint.pong',{slot:p.slot},'pong',from).catch(()=>{p.told=false;});}
      return;
    }
    if(type==='paint.ping'){send('paint.pong',{c:v.c,ms:Math.round(game.world.ms),slot:p.slot},'pong',from).catch(()=>{});return;}
    if(type==='paint.up'&&p.slot!==null){
      if(Number.isSafeInteger(v.gack))p.gack=Math.max(p.gack,Math.min(v.gack,gseq));
      if(v.no!==game.match.no)return;
      const a=game.world.actors.find(x=>x.slot===p.slot&&x.owner==='remote');
      if(a){const s=Sim.readState(v.s);if(s&&s.slot===p.slot)pushState(p.slot,s);}
      let events=[];try{events=JSON.parse(v.ev||'[]');}catch{return;}
      if(!Array.isArray(events))return;
      for(const ev of events){
        if(!ev||!Number.isSafeInteger(ev.q)||ev.q<=p.lastSeq)continue;p.lastSeq=ev.q;
        if(!['splat','fire','hit'].includes(ev.type))continue;
        // Only the sender's own actor may paint / fire / claim hits through this channel.
        if((ev.type==='splat'&&ev.slot!==p.slot)||(ev.type==='fire'&&ev.owner!==p.slot)||(ev.type==='hit'&&ev.by!==p.slot))continue;
        const clean={...ev};delete clean.q;
        Game.receive(game,[clean]);
        for(const r of Game.drain(game))hostLog(r,0); // referee results (hurt / down)
        hostLog(clean,p.slot);
      }
    }
  }

  // =========================== GUEST ===========================
  let mySlot=null,outbox=[],seq=0,lastG=0,lastSerial=-1,rtt=80,lastHello=0,lastPing=0,sendingUp=false,lastUp=0,sentSignature='',transferJob=null,remote={no:0,ph:'lobby',pt:0,dur:MATCH.defaultDuration,result:null,roster:[],waiting:[],hash:null,at:0};
  let guestUploadAfter=0;
  function guestStep(dt,input){
    applyInterp();
    if(remote.ph==='play'){game.world.ms+=dt*1000;}
    game.match.phase=remote.ph;
    game.match.phaseT=remote.pt+(now()-remote.at)/1000;
    Game.step(game,dt,input);
    const out=Game.drain(game);
    for(const e of out)if(['splat','fire','hit'].includes(e.type))outbox.push({...e,q:++seq});
    if(outbox.length>MAX_EVENTS*2)outbox.splice(0,outbox.length-MAX_EVENTS*2);
    return out;
  }
  async function guestSend(){
    const t=now();if(connection!=='connected'||closed)return;
    if(profile&&t-lastHello>=HELLO_MS){lastHello=t;send('paint.hello',{profile,weapon:prefs.weapon,team:prefs.team,ready:prefs.ready,have:[...haveSigs()]},'hello').catch(e=>{if(!TRANSIENT.test(e.message))fail(e);});}
    if(t-lastPing>=PING_MS){lastPing=t;send('paint.ping',{c:t},'ping').catch(()=>{});}
    if(sendingUp||t-lastUp<SEND_MS)return;lastUp=t;sendingUp=true;
    const me=mySlot!==null?game.world.actors.find(a=>a.slot===mySlot&&a.owner==='local'):null;
    try{await send('paint.up',{no:remote.no,gack:lastG,s:me?Sim.actorState(me):null,ev:JSON.stringify(outbox.slice(0,MAX_EVENTS))},'up');}
    catch(e){if(!TRANSIENT.test(e.message))fail(e);}finally{sendingUp=false;}
  }
  const knownAssets=new Set();function haveSigs(){return knownAssets;}
  function guestRoster(list){
    const r=list.map(x=>({slot:x.slot,team:x.team,name:x.name,weapon:x.weapon,kind:x.kind,signature:x.signature,ready:x.ready,owner:x.slot===mySlot?'local':'remote'}));
    Game.setRoster(game,r);onRoster();
  }
  function newMatch(no){
    remote.no=no;prefs.ready=false;const w=game.world;w.paint=Paint.create();w.projectiles=[];w.ms=0;outbox=[];
    const me=game.world.actors.find(a=>a.slot===mySlot);
    if(me){const sp=Arena.spawnPoint(me.team,me.slot);Object.assign(me,{x:sp.x,z:sp.z,vx:0,vz:0,face:sp.face,ink:PLAYER.inkMax,hp:PLAYER.hp,alive:true});}
    interp.clear();game.feed.length=0;
  }
  async function guestEvent(e){
    if(e.type==='closed'){end(e.reason||'peer_left');return;}
    if(e.type==='resync_required')return;
    if(e.type==='transfer'&&e.purpose===PURPOSE){
      const data=await sdk.readTransfer({transferId:e.transferId});
      if(data.purpose!==PURPOSE||data.contentType!=='application/octet-stream')throw Error('invalid_profile');
      const value=decodeAsset(data.dataBase64);if(!value||value.v!==1||typeof value.signature!=='string')throw Error('invalid_profile');
      knownAssets.add(value.signature);onAsset(value.signature,value.asset);return;
    }
    if(e.type!=='message')return;
    const {type,payload:v}=e.message;if(!v||typeof v!=='object')return;
    if(type==='paint.pong'){if(Number.isInteger(v.slot)&&GUEST_SLOTS.includes(v.slot)&&v.slot!==mySlot){mySlot=v.slot;game.mySlot=mySlot;remote.rosterKey='';}if(Number.isFinite(v.c))rtt=rtt*0.7+Math.max(1,now()-v.c)*0.3;return;}
    if(type==='paint.map'){if(v.no===remote.no)Paint.mergeChunk(game.world.paint,v);return;}
    if(type!=='paint.st')return;
    game.mySlot=mySlot??-1;
    if(v.no!==remote.no)newMatch(v.no);
    const rosterKey=JSON.stringify(v.roster);if(rosterKey!==remote.rosterKey){remote.rosterKey=rosterKey;guestRoster(v.roster||[]);}
    remote.roster=Array.isArray(v.roster)?v.roster:[];remote.ph=v.ph;remote.pt=v.pt;remote.at=now();remote.dur=v.dur;remote.result=v.result||null;remote.waiting=v.waiting||[];remote.hash=v.hash??null;
    game.match.duration=v.dur;game.match.no=v.no;game.match.result=v.result||null;
    if(v.ph==='play'){const target=v.ms+rtt/2;if(Math.abs(game.world.ms-target)>60)game.world.ms=target;else game.world.ms+=(target-game.world.ms)*0.1;}
    if(v.acks&&Number.isSafeInteger(v.acks[mySlot])){const ack=v.acks[mySlot];outbox=outbox.filter(e=>e.q>ack);}
    for(const arr of v.a||[]){const s=Sim.readState(arr);if(!s)continue;
      if(s.slot===mySlot){const me=game.world.actors.find(a=>a.slot===mySlot);if(me){me.hp=s.hp;if(!s.alive&&me.alive){me.alive=false;}}}
      else pushState(s.slot,s);}
    let events=[];try{events=JSON.parse(v.ev||'[]');}catch{}
    for(const ev of events){if(!ev||ev.g<=lastG)continue;lastG=ev.g;if(ev.no!==remote.no)continue;
      if(ev.o===mySlot&&(ev.type==='splat'||ev.type==='fire'))continue;
      const clean={...ev};delete clean.g;delete clean.o;delete clean.no;Game.receive(game,[clean]);}
  }
  function guestUpload(){
    if(transferJob||!asset||connection!=='connected'||closed||sentSignature===profile.signature||now()<guestUploadAfter)return;
    const signature=profile.signature,payload=ownPayload();if(!payload){sentSignature=signature;return;}
    transferJob=sdk.transfer({purpose:PURPOSE,contentType:'application/octet-stream',dataBase64:payload})
      .then(()=>{sentSignature=signature;}).catch(e=>{guestUploadAfter=now()+2000;if(!TRANSIENT.test(e.message))fail(e);}).finally(()=>{transferJob=null;});
  }

  // =========================== both ===========================
  let ownCache={signature:null,asset:null,data:null};
  function ownPayload(){
    if(!asset||!profile)return null;
    if(ownCache.signature===profile.signature&&ownCache.asset===asset)return ownCache.data;
    let data=encodeAsset({v:1,signature:profile.signature,asset});if(data.length>MAX_PAYLOAD){fail(Error('asset_too_large'));data=null;}
    ownCache={signature:profile.signature,asset,data};return data;
  }
  function end(reason='peer_left'){if(closed)return;closed=true;closeReason=reason;timers.forEach(clearInterval);status('closed');onRoster();}
  async function poll(){
    let lastPoll=0;
    while(!disposed&&!closed){
      try{
        const wait=lastPoll+POLL_GAP-now();if(wait>0)await pause(wait);lastPoll=now();
        const b=await sdk.poll({cursor,waitMs:1000});if(disposed||closed)break;
        if(b.transportState==='closed'){for(const e of b.events)if(e.type==='closed'){end(e.reason);break;}end();break;}
        if(b.epoch!==epoch){epoch=b.epoch;sentSignature='';}
        status(b.transportState);
        for(const e of b.events){note(e);try{await(host?hostEvent(e):guestEvent(e));}catch(err){fail(err);}}cursor=b.cursor;
      }catch(e){if(/session_closed|caller_disposed|permission_denied|permission_revoked|account_changed/.test(e.message)){end(e.message);break;}status('reconnecting');fail(e);await pause(350);}
    }
  }
  async function start(localProfile,localAsset,opts={}){
    if(context)throw Error('already_started');
    context=await sdk.getContext();if(!context)throw Error('no_invitation');
    if(context.protocol?.id!==PROTOCOL.id||context.protocol?.version!==PROTOCOL.version)throw Error('protocol_mismatch');
    host=context.role==='host';profile=validProfile(localProfile);asset=localAsset||null;
    prefs={...prefs,weapon:WEAPONS[opts.weapon]?opts.weapon:'sprayer',duration:MATCH.durations.includes(opts.duration)?opts.duration:MATCH.defaultDuration,cpuLevel:opts.cpuLevel??1};
    game=Game.create({role:host?'host':'guest',mySlot:host?0:-1,duration:prefs.duration,cpuLevel:prefs.cpuLevel,seed:(Math.random()*1e9)|0});
    if(durationOverride)game.match.duration=durationOverride;
    if(host){Game.setRoster(game,lobbyRoster());onRoster();}
    const joined=await sdk.join();epoch=joined.epoch;status(joined.status==='connected'?'connected':'waiting');void poll();
    if(host){timers.push(setInterval(()=>void hostPublish(),10));timers.push(setInterval(hostUpload,250));
      timers.push(setInterval(()=>{for(const p of peers.values())if(p.online&&now()-p.lastHeard>STALE_MS)p.online=false;},500));}
    else{timers.push(setInterval(()=>void guestSend(),10));timers.push(setInterval(guestUpload,250));}
    return context;
  }
  return {
    start,
    get game(){return game;},
    isHost:()=>host,
    step:(dt,input)=>host?hostStep(dt,input):guestStep(dt,input),
    phase:()=>closed?'closed':host?game.match.phase:remote.ph,
    phaseT:()=>host?game.match.phaseT:remote.pt+(now()-remote.at)/1000,
    timeLeft:()=>{const ph=host?game.match.phase:remote.ph,dur=host?game.match.duration:remote.dur,pt=host?game.match.phaseT:remote.pt+(now()-remote.at)/1000;return ph==='count'?dur:ph==='play'?Math.max(0,dur-pt):0;},
    result:()=>host?game.match.result:remote.result,
    remoteHash:()=>remote.hash,
    closeReason:()=>closeReason,
    lobby:()=>{const list=host?lobbyRoster():remote.roster.length?game.roster:[];return {players:list.map(r=>({...r,you:host?r.slot===0:r.slot===mySlot})),waiting:host?waiting:remote.waiting,duration:host?game.match.duration:remote.dur,host};},
    drawActors:()=>game.world.actors,
    setProfile(p,a){profile=validProfile(p);asset=a||null;sentSignature='';lastHello=0;lobbySerial++;},
    setWeapon(w){if(WEAPONS[w])prefs.weapon=w;lastHello=0;lobbySerial++;},
    setTeam(t){prefs.team=t===0||t===1?t:null;lastHello=0;lobbySerial++;},
    setReady(v){prefs.ready=!!v;lastHello=0;lobbySerial++;},
    ready:()=>prefs.ready,
    setDuration(d){if(!host||!MATCH.durations.includes(d))return;game.match.duration=d;prefs.duration=d;lobbySerial++;},
    again(){if(!host)return;startMatch();},
    toLobby(){if(!host)return;game.match.phase='lobby';game.match.phaseT=0;Game.setRoster(game,lobbyRoster());onRoster();},
    async leave(){try{await sdk.leave();}finally{end('left');}},
    dispose(){disposed=true;timers.forEach(clearInterval);},
    diagnostics:()=>({role:context?.role,connection,closed,mySlot:host?0:mySlot,seq,lastG,gseq,outbox:outbox.length,log:log.length,rtt:Math.round(rtt),
      peers:[...peers.values()].map(p=>({slot:p.slot,online:p.online,lastSeq:p.lastSeq,gack:p.gack,sent:p.sent.size})),recent:recent.slice()}),
  };
}
module.exports={create,PROTOCOL,PURPOSE};
