'use strict';
// LAN room acceptance (SPEC §10) over the in-process sessions stand-in (tests/fake-sessions.cjs):
// one host + two guests, each running its own simulation with scripted keyboard/mouse-like
// input, real timers, lossy latest-lane delivery. Checks the room fills to 2v2 with a computer
// player, everyone ends with the same turf as the host's result, guest shots paint on every
// screen, and no channel ever exceeds its send budget.
const test=require('node:test'),assert=require('node:assert/strict');
const {createHub}=require('./fake-sessions.cjs');
const Net=require('../game/net.js'),Paint=require('../game/paint.cjs'),Game=require('../game/game.cjs');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function player(sdk,name,{weapon='sprayer',team=null,seed=1}={}){
  const assets=new Map(),errors=[];
  const lan=Net.create(sdk,{durationOverride:10,onAsset:(sig,a)=>assets.set(sig,a),onError:e=>errors.push(e.message)});
  let t=seed,press=0;
  const input=()=>{ // wander in a circle-ish path, spray ahead, dive now and then
    const me=Game.me(lan.game);t+=1/60;if(!me)return {mx:0,mz:0};
    const ang=Math.sin(t*0.7+seed)*2+seed,fire=Math.sin(t*1.3+seed)>-0.6;
    if(Math.sin(t*3)>0.99)press++;
    return {mx:Math.cos(ang),mz:Math.sin(ang),aimX:me.x+Math.cos(ang)*6,aimZ:me.z+Math.sin(ang)*6,fire,dive:!fire,press};
  };
  const tick=setInterval(()=>{try{lan.step(1/60,input());}catch(e){errors.push(e.stack);}},1000/60);
  return {lan,assets,errors,name,weapon,team,stop(){clearInterval(tick);lan.dispose();},
    async start(){await lan.start({name,signature:'toy:'+name,kind:'toy'},{kind:'toy',species:'cat',color:'#ff8a3d'},{weapon});if(team!==null)lan.setTeam(team);}};
}

test('host + 2 guests: lobby → 2v2 with a computer player → same turf everywhere',{timeout:60000},async()=>{
  const hub=createHub({latency:[5,45],loss:0.03});
  const packets=[];const spy=(sdk,label)=>({...sdk,send:async m=>{packets.push({label,m:structuredClone(m)});return sdk.send(m);}});
  const H=player(spy(hub.host(),'H'),'房主',{seed:1}),A=player(spy(hub.guest(),'A'),'客人甲',{seed:2,weapon:'roller'}),B=player(spy(hub.guest(),'B'),'客人乙',{seed:3});
  const all=[H,A,B];
  try{
    await H.start();await A.start();await B.start();
    // Lobby: seats and default teams (slot parity): host 0→orange, 1→blue, 2→orange.
    await waitFor(()=>H.lan.lobby().players.length===3,'three humans in the lobby');
    await waitFor(()=>A.lan.lobby().players.length===3&&B.lan.lobby().players.length===3,'guests see the lobby');
    const lob=H.lan.lobby().players;assert.deepEqual(lob.map(p=>[p.slot,p.team]),[[0,0],[1,1],[2,0]]);
    // Avatars reach everyone through the host (star topology).
    await waitFor(()=>A.assets.size===2&&B.assets.size===2&&H.assets.size===2,'avatars relayed',8000);
    // Nobody ready → no start; everyone ready → countdown.
    await sleep(600);assert.equal(H.lan.phase(),'lobby');
    for(const p of all)p.lan.setReady(true);
    await waitFor(()=>all.every(p=>p.lan.phase()==='count'),'countdown on every screen',5000);
    assert.equal(H.lan.game.roster.length,4,'filled to 2v2');
    assert.equal(H.lan.game.roster.filter(r=>r.kind==='bot').length,1,'one computer player');
    assert.deepEqual(A.lan.game.roster.map(r=>r.slot),H.lan.game.roster.map(r=>r.slot),'guest sees the same roster');
    await waitFor(()=>all.every(p=>p.lan.phase()==='play'),'play',6000);
    // Sampling must never feed delayed poses back into authoritative gameplay.
    for(const p of all){const before=JSON.stringify(p.lan.game.world.actors);for(let n=0;n<10;n++)p.lan.drawActors();assert.equal(JSON.stringify(p.lan.game.world.actors),before,'draw leaves authority untouched');const own=p.lan.game.world.actors.find(a=>a.owner==='local'&&a.kind==='human');if(own)assert.deepEqual(p.lan.drawActors().find(a=>a.slot===own.slot),own,'local player is not interpolated');}
    // Everyone sees everyone else's shots in flight (ghost copies of remote fire events).
    const seen={H:new Set(),A:new Set(),B:new Set()};
    for(let i=0;i<60;i++){for(const [k,p] of [['H',H],['A',A],['B',B]])for(const s of p.lan.game.world.projectiles)if(s.ghost)seen[k].add(s.owner);await sleep(50);}
    // Seats follow hello arrival order, so read each guest's actual seat.
    const slotA=A.lan.diagnostics().mySlot,slotB=B.lan.diagnostics().mySlot,bot=H.lan.game.roster.find(r=>r.kind==='bot').slot;
    assert.ok(seen.H.has(slotA)&&seen.H.has(slotB),'host sees both guests\' shots '+[...seen.H]);
    assert.ok([0,slotB,bot].every(n=>seen.A.has(n))&&!seen.A.has(slotA),'guest A sees host, guest B and computer shots (never its own twice) '+[...seen.A]);
    assert.ok([0,slotA,bot].every(n=>seen.B.has(n))&&!seen.B.has(slotB),'guest B sees host, guest A and computer shots (never its own twice) '+[...seen.B]);
    // Guest paint shows up on the host and on the other guest.
    const guestSplat=(g,slot)=>{let n=0;const gr=g.lan.game.world.paint;for(let i=0;i<Paint.N;i++)if(gr.team[i]>=0&&Paint.CLASS[i]===0)n++;return n;};
    assert.ok(guestSplat(H)>0&&guestSplat(A)>0&&guestSplat(B)>0);
    await waitFor(()=>all.every(p=>p.lan.phase()==='results'),'results everywhere',20000);
    await sleep(1500); // let the last events and map chunks land
    const r=H.lan.result();assert.ok(r&&r.share[0]+r.share[1]>5,'turf painted: '+JSON.stringify(r?.share));
    const hostHash=Paint.hash(H.lan.game.world.paint);assert.equal(r.hash,hostHash);
    for(const g of [A,B]){assert.equal(Paint.hash(g.lan.game.world.paint),hostHash,g.name+' ends with the host\'s turf');assert.deepEqual(g.lan.result().share,r.share);}
    const originals=new Map();for(const {m}of packets)if(m.type==='paint.up'&&m.payload.s)originals.set(m.payload.s[0]+':'+m.payload.mt,m.payload.s);
    let forwarded=0;for(const {m}of packets)if(m.type==='paint.st')for(const pose of m.payload.a){const raw=originals.get(pose[0]+':'+m.payload.mt?.[pose[0]]);if(raw){assert.deepEqual(pose.slice(0,6),raw.slice(0,6),'forward original position and simulation timestamp together');forwarded++;}}
    assert(forwarded>20,'original guest samples reach the third player without restamping');
    // Both guests' shots landed on the host (their events were received and applied).
    const byGuests=H.lan.game.world.actors.filter(a=>a.slot!==0&&a.kind==='human').length;assert.equal(byGuests,2);
    assert.equal(hub.stats.backpressure,0,'no channel went over 30 sends/s');
    assert.ok(hub.stats.maxBytes<60*1024,'largest message '+hub.stats.maxBytes);
    for(const p of all)assert.deepEqual(p.errors,[],p.name+' errors');
    console.log('stats',hub.stats,'result',r.share,r.winner);
  }finally{all.forEach(p=>p.stop());}
});

test('a guest leaving mid-match is taken over by a computer player; the host leaving ends the room',{timeout:60000},async()=>{
  const hub=createHub({latency:[5,30]});
  const H=player(hub.host(),'房主',{seed:4}),A=player(hub.guest(),'客人甲',{seed:5});
  try{
    await H.start();await A.start();
    await waitFor(()=>H.lan.lobby().players.length===2,'lobby');
    H.lan.setReady(true);A.lan.setReady(true);
    await waitFor(()=>H.lan.phase()==='play'&&A.lan.phase()==='play','play',8000);
    assert.equal(H.lan.game.roster.length,2,'1v1: no computer players');
    await A.lan.leave();
    await waitFor(()=>H.lan.game.roster.find(r=>r.slot===1)?.kind==='bot','bot takes over',3000);
    assert.equal(H.lan.phase(),'play','match continues');
    const B=player(hub.guest(),'客人乙',{seed:6});await B.start();
    await waitFor(()=>B.lan.lobby().waiting.includes(1)||B.lan.lobby().waiting.length>0,'late joiner waits for the next round',5000);
    await H.lan.leave();
    await waitFor(()=>B.lan.phase()==='closed','host leaving closes the room',3000);
    B.stop();
  }finally{H.stop();A.stop();}
});

async function waitFor(fn,label,ms=5000){const until=Date.now()+ms;while(Date.now()<until){if(fn())return;await sleep(30);}throw Error('timeout: '+label);}
