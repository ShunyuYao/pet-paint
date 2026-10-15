// Entry: menus, keyboard / mouse input, the fixed-step loop, HUD, and wiring of the
// simulation (game/) to the view (scene.js) and — for LAN play — the session (game/net.js).
import {createWorld} from './scene.js';
import {createAudio} from './audio.js';
import * as C from './characters.js';
import Config from '../game/config.cjs';
import Paint from '../game/paint.cjs';
import Game from '../game/game.cjs';
import AI from '../game/ai.cjs';
import Net from '../game/net.js';

const $=id=>document.getElementById(id);
const world=createWorld($('stage'));
const KIND_LABEL={doll3d:'3D 布偶',sprite:'2D 立绘',toy:'内置形象'};
const TIME_LABEL={60:'1 分钟',120:'2 分钟',180:'3 分钟'};
const SIZE_LABEL={1:'1 对 1',2:'2 对 2'};
const CPU_LOOKS=[{species:'cat',color:'#8e7cff'},{species:'bunny',color:'#34c38f'},{species:'mouse',color:'#ffb020'},{species:'cat',color:'#ff7aa8'}];
const DEFAULT_PREFS={weapon:'sprayer',cpuLevel:1,duration:120,size:2,sfx:true};
const prefs=loadPrefs();
function loadPrefs(){try{return {...DEFAULT_PREFS,...JSON.parse(localStorage.getItem('pet-paint-prefs')||'{}')};}catch{return {...DEFAULT_PREFS};}}
function savePrefs(){try{localStorage.setItem('pet-paint-prefs',JSON.stringify(prefs));}catch{}}
const audio=createAudio({sfx:prefs.sfx});
addEventListener('pointerdown',()=>audio.unlock(),{capture:true});addEventListener('keydown',()=>audio.unlock(),{capture:true});

let sdk=window.pet||null,driver=null,petDriver=null,realtimeNote='';
let session=null; // {kind:'solo'|'lan', game, ...}
let mode='title';
const peerAssets=new Map(); // signature → asset (LAN)
// A peer may use the same character. The host skips sending our own asset back.
const peerAsset=signature=>signature===driver?.profile.signature?driver.asset:peerAssets.get(signature);

// ---------- UI helpers ----------
let errorTimer=null,announceTimer=null;
function show(panel){for(const id of ['title-panel','lobby-panel','results-panel'])$(id).hidden=id!==panel;$('menu').hidden=!panel;}
function error(text){$('error').textContent=text||'';$('error').hidden=!text;clearTimeout(errorTimer);if(text)errorTimer=setTimeout(()=>{$('error').hidden=true;},7000);}
function announce(text,{small=false,ms=900}={}){const a=$('announce');a.textContent=text;a.classList.toggle('small',small);a.hidden=false;a.classList.remove('pop');void a.offsetWidth;a.classList.add('pop');clearTimeout(announceTimer);announceTimer=setTimeout(()=>{a.hidden=true;},ms);}
function describe(e){const m=e?.message||String(e);const map={no_invitation:'这份 HTML 还没有联机邀请。',protocol_mismatch:'双方的游戏版本不一致，请用同一份 HTML。',session_closed:'本次联机已结束。',zip_invalid:'这个 ZIP 读不出来，请确认是完整的角色包。',pack_no_character:'包里没有 character.json，不像是桌宠角色包。',pack_no_frames:'角色包里没有找到 idle 动作图。',pack_realtime_invalid:'角色包里的 3D 布偶数据不完整。',image_decode_failed:'图片解码失败，换一张 PNG / WebP / JPG 试试。',file_too_large:'文件太大了（超过 12 MB）。',asset_too_large:'形象素材超过 1 MB，其他人会看到内置形象。',CHARACTER_IMAGE_UNAVAILABLE:'暂时读不到当前桌宠形象。',host_only:'只有房主可以修改。',room_started:'这一局已经开始，下一局再上场。'};
  return map[m]||(/permission|denied|revoked/i.test(m)?'能力未授权：请重新打开 HTML 并允许读取形象 / 联机。':'出了点问题：'+m);}
function portraitInto(el,src,fallback='🐭'){el.replaceChildren();if(src){const img=new Image();img.src=src;img.alt='';el.append(img);}else el.textContent=fallback;}
function chipGroup(el,values,label,current,onPick){
  el.replaceChildren();
  for(const v of values){const b=document.createElement('button');b.type='button';b.className='chip';b.dataset.value=String(v);b.textContent=label(v);b.setAttribute('aria-pressed',String(v===current));b.addEventListener('click',()=>onPick(v));el.append(b);}
}
function renderFighterCard(){
  portraitInto($('fighter-portrait'),driver?.portrait,driver?.asset?.species==='cat'?'🐱':driver?.asset?.species==='bunny'?'🐰':'🐭');
  $('fighter-name').textContent=driver?.profile.name||'…';
  $('fighter-kind').textContent=driver?KIND_LABEL[driver.profile.kind]:'';$('fighter-kind').dataset.kind=driver?.profile.kind||'';
  $('use-pet').hidden=!sdk?.character;$('use-pet').disabled=!petDriver;
  const usingPet=driver&&petDriver&&(driver.source==='pet'||driver.characterKey===petDriver.characterKey);
  $('pet-auto').hidden=!usingPet;$('pet-auto').textContent='已自动带入你的桌宠形象。'+(driver?.profile.kind==='sprite'&&realtimeNote?' '+realtimeNote:'');
}
function renderOptions(){
  for(const b of document.querySelectorAll('.weapon-card'))b.setAttribute('aria-checked',String(b.dataset.weapon===prefs.weapon));
  chipGroup($('size-list'),[1,2],v=>SIZE_LABEL[v],prefs.size,v=>{prefs.size=v;savePrefs();renderOptions();});
  chipGroup($('cpu-list'),[0,1,2],v=>AI.LEVELS[v].name,prefs.cpuLevel,v=>{prefs.cpuLevel=v;savePrefs();renderOptions();});
  chipGroup($('time-list'),Config.MATCH.durations,v=>TIME_LABEL[v],prefs.duration,v=>{prefs.duration=v;savePrefs();renderOptions();session?.lan?.setDuration?.(v);});
}
for(const b of document.querySelectorAll('.weapon-card'))b.addEventListener('click',()=>{prefs.weapon=b.dataset.weapon;savePrefs();renderOptions();session?.lan?.setWeapon?.(prefs.weapon);});
$('sfx').addEventListener('click',()=>{prefs.sfx=!prefs.sfx;audio.setOn(prefs.sfx);savePrefs();$('sfx').textContent='音效 '+(prefs.sfx?'开':'关');$('sfx').setAttribute('aria-pressed',String(prefs.sfx));});
$('keys-btn').addEventListener('click',()=>toggleKeys());
function toggleKeys(force){const open=force??$('keys-panel').hidden;$('keys-panel').hidden=!open;$('keys-btn').setAttribute('aria-expanded',String(open));}

// ---------- characters ----------
async function setDriver(next){driver=next;renderFighterCard();session?.lan?.setProfile?.(profileOf(driver),driver.asset);syncPlayers();}
function profileOf(d){return {name:d.profile.name,signature:d.profile.signature,kind:d.profile.kind,color:d.profile.color,weapon:prefs.weapon};}
async function importFiles(files){
  const list=[...files];if(!list.length)return;
  $('import-status').textContent='正在读取 '+(list[0].webkitRelativePath?.split('/')[0]||list[0].name)+' …';$('import-status').dataset.state='busy';
  try{
    let d;
    if(list.length>1||list[0].webkitRelativePath)d=await C.packDriver(list);
    else if(/\.zip$/i.test(list[0].name)||list[0].type==='application/zip')d=await C.packDriver(list[0]);
    else if(/^image\//.test(list[0].type)||/\.(png|webp|jpe?g|gif)$/i.test(list[0].name))d=await C.imageDriver(list[0]);
    else throw Error('请导入角色包 ZIP / 文件夹，或 PNG / WebP / JPG 图片。');
    if(d.characterKey)void C.saveDriver('pack:'+d.characterKey,d);
    await setDriver(d);void C.saveDriver('last',d);
    $('import-status').textContent='已导入「'+d.profile.name+'」 · '+KIND_LABEL[d.profile.kind];$('import-status').dataset.state='ok';
  }catch(e){console.error(e);$('import-status').textContent=describe(e);$('import-status').dataset.state='error';}
}
$('import-file').addEventListener('change',e=>{void importFiles(e.target.files);e.target.value='';});
$('import-folder').addEventListener('change',e=>{void importFiles(e.target.files);e.target.value='';});
addEventListener('dragover',e=>{e.preventDefault();if(mode!=='play')document.body.classList.add('dragging');});
addEventListener('dragleave',e=>{if(!e.relatedTarget)document.body.classList.remove('dragging');});
addEventListener('drop',e=>{e.preventDefault();document.body.classList.remove('dragging');if(mode==='play')return;void importFiles(e.dataTransfer.files);});
for(const t of C.TOYS){const b=document.createElement('button');b.type='button';b.className='chip';b.dataset.toy=t.id;b.textContent=t.name;b.addEventListener('click',async()=>{await setDriver(await C.toyDriver(t.id));$('import-status').textContent='';});$('toy-row').append(b);}
$('use-pet').addEventListener('click',async()=>{if(petDriver)await setDriver(await preferRealtime(petDriver));});
async function preferRealtime(d){
  if(d?.source==='pet'&&sdk?.character?.getRealtime){
    try{const raw=await sdk.character.getRealtime(),rt=await C.realtimeDriver(raw,d);if(rt){realtimeNote='';return rt;}
      realtimeNote=raw?'这个形象的 3D 数据格式本游戏不认识，先以 2D 出战。':'这个形象没有 3D 布偶数据，以 2D 出战。';}
    catch(e){console.warn('realtime unavailable',e);realtimeNote='读取 3D 布偶数据失败，先以 2D 出战。';}
  }
  if(d?.characterKey){const cached=await C.loadDriver('pack:'+d.characterKey);if(cached?.asset.kind==='doll3d')return cached;}
  return d;
}
function grantState(text){$('grant-box').hidden=!text;$('grant-text').textContent=text||'';}
async function readPet(){
  grantState('正在请求读取你的桌宠形象：请在桌宠弹出的授权窗口里点「允许」。');
  let grant;try{grant=await sdk.capabilities.request({});}catch(e){grantState('授权请求没有完成（'+describe(e)+'），可以再试一次。');return false;}
  if(grant?.status!=='granted'||!grant.permissions?.includes('character:read')){grantState('还没有允许读取桌宠形象，现在先用内置形象。点下面的按钮可以重新授权。');return false;}
  try{petDriver=await C.currentPetDriver(sdk.character);}catch(e){grantState('已授权，但暂时读不到当前桌宠形象：'+describe(e));return false;}
  grantState('');await setDriver(await preferRealtime(petDriver));return true;
}
$('grant-retry').addEventListener('click',async()=>{if(await readPet())await joinInvitation();});

// ---------- players in the view ----------
// Every actor in the match gets an avatar: me = my driver; other humans = their transferred
// asset (a toy until it arrives); computer players = a coloured toy.
function syncPlayers(){
  const g=session?.game;if(!g){world.removePlayer(0);if(driver)void world.setPlayer(0,{signature:driver.profile.signature,asset:driver.asset,fallback:driver.fallback,name:driver.profile.name,team:0,weapon:prefs.weapon});return;}
  const slots=new Set();
  for(const r of g.roster){
    slots.add(r.slot);
    if(r.slot===g.mySlot&&driver){void world.setPlayer(r.slot,{signature:driver.profile.signature,asset:driver.asset,fallback:driver.fallback,name:r.name,team:r.team,weapon:r.weapon});continue;}
    if(r.kind==='bot'){const look=CPU_LOOKS[r.slot%CPU_LOOKS.length];void world.setPlayer(r.slot,{signature:'cpu:'+r.slot+look.species,asset:{kind:'toy',...look},name:r.name,team:r.team,weapon:r.weapon});continue;}
    const asset=peerAsset(r.signature);
    void world.setPlayer(r.slot,{signature:asset?r.signature:'pending:'+r.signature,asset:asset||{kind:'toy',species:'mouse',color:r.team===0?'#f4a261':'#6c8cff'},name:r.name,team:r.team,weapon:r.weapon});
  }
  for(const p of world.info().players)if(!slots.has(p.slot))world.removePlayer(p.slot);
}

// ---------- input ----------
const keys=new Set();let mouse={x:innerWidth/2,y:innerHeight/2,fire:false,dive:false},press=0,aim=null;
const MOVE={KeyW:[0,-1],ArrowUp:[0,-1],KeyS:[0,1],ArrowDown:[0,1],KeyA:[-1,0],ArrowLeft:[-1,0],KeyD:[1,0],ArrowRight:[1,0]};
addEventListener('keydown',e=>{
  if(e.code==='KeyP'){toggleKeys();return;}
  if(mode!=='play')return;
  if(MOVE[e.code]||e.code==='ShiftLeft'||e.code==='ShiftRight'||e.code==='KeyJ'||e.code==='Space')e.preventDefault();
  if((e.code==='KeyJ'||e.code==='Space')&&!keys.has(e.code))press++;
  keys.add(e.code);
});
addEventListener('keyup',e=>keys.delete(e.code));
addEventListener('blur',()=>{keys.clear();mouse.fire=mouse.dive=false;});
const stage=$('stage');
addEventListener('pointermove',e=>{mouse.x=e.clientX;mouse.y=e.clientY;const c=$('crosshair');c.style.left=e.clientX+'px';c.style.top=e.clientY+'px';});
stage.addEventListener('pointerdown',e=>{if(mode!=='play')return;if(e.button===0){mouse.fire=true;press++;}if(e.button===2)mouse.dive=true;});
addEventListener('pointerup',e=>{if(e.button===0)mouse.fire=false;if(e.button===2)mouse.dive=false;});
stage.addEventListener('contextmenu',e=>e.preventDefault());
function readInput(){
  let mx=0,mz=0;for(const k of keys){const m=MOVE[k];if(m){mx+=m[0];mz+=m[1];}}
  const me=session?.game&&Game.me(session.game);
  aim=world.aimAt(mouse.x,mouse.y)||aim;
  return {mx,mz,aimX:aim?.x??(me?me.x+1:0),aimZ:aim?.z??(me?me.z:0),fire:mouse.fire||keys.has('KeyJ')||keys.has('Space'),dive:mouse.dive||keys.has('ShiftLeft')||keys.has('ShiftRight'),press};
}

// ---------- solo ----------
function startSolo(){
  const g=Game.create({role:'solo',mySlot:0,duration:prefs.duration,cpuLevel:prefs.cpuLevel,seed:(Math.random()*1e9)|0});
  const me={slot:0,team:0,name:driver?.profile.name||'我',weapon:prefs.weapon,kind:'human',owner:'local',signature:driver?.profile.signature};
  Game.setRoster(g,Game.fillBots([me],{size:prefs.size}));
  session={kind:'solo',game:g,step:(dt,input)=>{Game.step(g,dt,input);return Game.drain(g);},again(){Game.setRoster(g,g.roster);Game.start(g);},leave(){}};
  Game.start(g);syncPlayers();const self=Game.me(g);world.snapCamera(self.x,self.z);
  setConn('solo','单人练习');
}
$('solo').addEventListener('click',()=>{audio.unlock();startSolo();});
$('again').addEventListener('click',()=>{if(!session)return;if(session.kind==='solo')session.again();else session.lan.again();});
$('to-title').addEventListener('click',()=>leave());
$('leave').addEventListener('click',()=>leave());
async function leave(){const s=session;session=null;try{await s?.leave?.();}catch{}renderMode(true);syncPlayers();}
function setConn(state,text){$('conn').hidden=!state;$('conn').dataset.state=state||'';$('conn').textContent=text||'';}

// ---------- LAN ----------
async function joinInvitation(){
  if(session||!sdk?.sessions?.getContext)return;
  let context=null;try{context=await sdk.sessions.getContext();}catch(e){if(!/permission|denied|revoked/i.test(e.message))error(describe(e));return;}
  if(!context)return;
  const lan=Net.create(sdk.sessions,{
    onRoster:()=>syncPlayers(),
    onAsset:(signature,asset)=>{if(!C.checkAsset(asset)){error('有位玩家的形象数据无效，已改用内置形象。');return;}peerAssets.set(signature,asset);syncPlayers();},
    onConnection:(s,text)=>setConn(s,text),
    onError:e=>{if(!/\b(backpressure|peer_offline|not_connected|quota_exceeded)\b/.test(e.message))error(describe(e));},
  });
  try{await lan.start(profileOf(driver),driver.asset,{weapon:prefs.weapon,duration:prefs.duration,cpuLevel:prefs.cpuLevel});}catch(e){error(describe(e));return;}
  session={kind:'lan',lan,get game(){return lan.game;},step:(dt,input)=>lan.step(dt,input),leave:()=>lan.leave()};
  syncPlayers();
}

// ---------- mode / menus ----------
function computeMode(){
  const g=session?.game;if(!g)return 'title';
  const ph=session.kind==='lan'?session.lan.phase():g.match.phase;
  if(ph==='closed')return 'closed';if(ph==='lobby')return 'lobby';if(ph==='results')return 'results';return 'play';
}
let renderedMode='';
function renderMode(force){
  mode=computeMode();if(!force&&mode===renderedMode)return;const prev=renderedMode;renderedMode=mode;
  document.body.classList.toggle('playing',mode==='play');
  $('hud').hidden=mode!=='play';$('crosshair').hidden=mode!=='play';$('leave').hidden=!session;
  if(mode==='title'){show('title-panel');renderOptions();}
  else if(mode==='closed'){show('title-panel');renderOptions();}
  else if(mode==='lobby'){show('lobby-panel');renderLobby();}
  else if(mode==='results'){show('results-panel');renderResults();}
  else{show(null);if(prev!=='play'){$('feed').replaceChildren();countdownShown=-1;}}
}
function renderLobby(){
  const lan=session?.lan;if(!lan)return;const L=lan.lobby(),me=L.players.find(p=>p.you);
  const seat=p=>{const d=document.createElement('div');d.className='seat'+(p.you?' you':'');
    const mini=document.createElement('div');mini.className='mini';const a=p.you?driver?.asset:peerAsset(p.signature);
    portraitInto(mini,a?.kind==='sprite'?a.frames[0]:a?.kind==='doll3d'?a.head:p.you?driver?.portrait:null,'🐭');
    const n=document.createElement('strong');n.textContent=p.name+(p.you?'（我）':'');const w=document.createElement('small');w.textContent=Config.WEAPONS[p.weapon]?.name||'';
    const r=document.createElement('span');r.className=p.ready?'ok':'';r.textContent=p.slot===0?'房主':p.ready?'已准备':'';d.append(mini,n,w,r);return d;};
  const teams=[0,1].map(t=>{const box=document.createElement('div');box.className='lobby-team '+(t===0?'a':'b');const h=document.createElement('h3');h.textContent=Config.TEAMS[t].name;box.append(h);
    for(const p of L.players.filter(x=>x.team===t))box.append(seat(p));if(!L.players.some(x=>x.team===t)){const e=document.createElement('small');e.textContent='空位由电脑补上';box.append(e);}return box;});
  $('lobby-teams').replaceChildren(...teams);
  chipGroup($('lobby-weapon'),Config.WEAPON_IDS,v=>Config.WEAPONS[v].name,me?.weapon||prefs.weapon,v=>{prefs.weapon=v;savePrefs();lan.setWeapon(v);renderLobby();});
  chipGroup($('lobby-team'),[0,1],v=>Config.TEAMS[v].name,me?.team,v=>{lan.setTeam(v);renderLobby();});
  chipGroup($('lobby-time'),Config.MATCH.durations,v=>TIME_LABEL[v],L.duration,v=>{if(!L.host)return;prefs.duration=v;savePrefs();lan.setDuration(v);renderLobby();});
  $('time-hint').textContent=L.host?'':'（房主决定）';
  for(const b of $('lobby-time').children)b.disabled=!L.host;
  $('ready').textContent=lan.ready()?'取消准备':'我准备好了';
  const waitingMe=!me;
  $('lobby-note').textContent=waitingMe?'这一局已经开始，你先观战，下一局上场。':L.players.length<2?'等朋友加入：在桌宠控制栏点「＋ 邀请」，最多 4 人。':'所有人都准备好就开始。3 个人时，人少的一边由电脑补位。';
}
$('ready').addEventListener('click',()=>{const lan=session?.lan;if(!lan)return;lan.setReady(!lan.ready());renderLobby();});
function renderResults(){
  const g=session.game,r=(session.kind==='lan'?session.lan.result():g.match.result)||{share:[0,0],winner:-1};
  const my=g.roster.find(x=>x.slot===g.mySlot)?.team??0;
  $('results-title').textContent=r.winner<0?'平局！':r.winner===my?'我们赢了！':'这局输了';
  requestAnimationFrame(()=>{$('res-a').style.width=r.share[0]+'%';$('res-b').style.width=r.share[1]+'%';});
  $('res-a').style.width='0%';$('res-b').style.width='0%';
  $('res-na').textContent=r.share[0].toFixed(1)+'%';$('res-nb').textContent=r.share[1].toFixed(1)+'%';
  const rows=g.roster.slice().sort((a,b)=>a.team-b.team).map(p=>{const d=document.createElement('div');d.className='result-row '+(p.team===0?'a':'b')+(p.slot===g.mySlot?' you':'');
    const st=stats.get(p.slot)||{downs:0,paint:0};const s1=document.createElement('strong');s1.textContent=p.name;const s2=document.createElement('small');s2.textContent='打倒 '+st.downs;d.append(s1,s2);return d;});
  $('results-players').replaceChildren(...rows);
  $('again').hidden=session.kind==='lan'&&!session.lan.isHost();$('results-note').textContent=session.kind==='lan'&&!session.lan.isHost()?'等房主开始下一局。':'';
  audio.play(r.winner===my?'win':'lose');
}

// ---------- HUD ----------
const stats=new Map();let countdownShown=-1,lastTimeLeft=0;
const mini=$('minimap').getContext('2d'),miniImg=mini.createImageData(Paint.COLS,Paint.ROWS);let miniVersion=-1;
function drawMinimap(g){
  const grid=g.world.paint;
  if(grid.version!==miniVersion){miniVersion=grid.version;const d=miniImg.data;
    for(let i=0;i<Paint.N;i++){const t=grid.team[i],k=Paint.CLASS[i],o=i*4;
      if(k===1){d[o]=120;d[o+1]=104;d[o+2]=88;}else if(t===0){d[o]=244;d[o+1]=122;d[o+2]=18;}else if(t===1){d[o]=42;d[o+1]=91;d[o+2]=215;}else{d[o]=226;d[o+1]=205;d[o+2]=176;}d[o+3]=255;}}
  mini.putImageData(miniImg,0,0);
  for(const a of g.world.actors){if(!a.alive||(a.diving&&a.team!==Game.me(g)?.team))continue;
    mini.fillStyle=a.slot===g.mySlot?'#fff':a.team===0?'#7a3500':'#0c2566';mini.beginPath();mini.arc((a.x+14)/Config.ARENA.cell,(a.z+9)/Config.ARENA.cell,a.slot===g.mySlot?6:4.5,0,Math.PI*2);mini.fill();}
}
function hud(g){
  const tl=session.kind==='lan'?session.lan.timeLeft():(g.match.phase==='count'?g.match.duration:Math.max(0,g.match.duration-g.match.phaseT));
  const ph=session.kind==='lan'?session.lan.phase():g.match.phase;
  const sec=Math.ceil(tl);$('timer').textContent=Math.floor(sec/60)+':'+String(sec%60).padStart(2,'0');$('timer').dataset.low=String(ph==='play'&&tl<=10);
  if(ph==='play'&&tl<=10&&Math.ceil(tl)!==Math.ceil(lastTimeLeft))audio.play('tick');lastTimeLeft=tl;
  const c=Paint.coverage(g.world.paint),pa=c.share[0]*100,pb=c.share[1]*100;
  $('cov-a').textContent=pa.toFixed(1)+'%';$('cov-b').textContent=pb.toFixed(1)+'%';$('bar-a').style.width=pa+'%';$('bar-b').style.width=pb+'%';
  const me=Game.me(g);
  if(me){$('ink').style.width=me.ink+'%';$('ink').style.setProperty('--team',me.team===0?'var(--a)':'var(--b)');$('ink').dataset.low=String(me.ink<15);$('hp').style.width=Math.max(0,me.hp)+'%';$('hp').dataset.low=String(me.hp<40);
    $('respawn').hidden=me.alive||ph!=='play';if(!me.alive)$('respawn').textContent='被打倒了，'+Math.max(0,Math.ceil((me.respawnAt-g.world.ms)/1000))+' 秒后复活';}
  if(ph==='count'){const n=Math.ceil(Config.MATCH.countdown-(session.kind==='lan'?session.lan.phaseT():g.match.phaseT));if(n!==countdownShown&&n>0){countdownShown=n;announce(String(n));audio.play('beep');}}
  else if(ph==='play'&&countdownShown>0){countdownShown=0;announce('开涂！',{ms:700});audio.play('go');}
  drawMinimap(g);
}
function onEvents(g,events){
  for(const e of events){
    if(e.type==='fire'&&e.owner===g.mySlot)audio.play(e.kind==='drop'?'flick':'shot');
    else if(e.type==='splat'&&e.slot===g.mySlot&&e.kind!=='band'&&e.r>0.5)audio.play('splat');
  }
  for(const e of g.feed.splice(0)){
    if(e.type==='hurt'){world.flash(e.target);if(e.target===g.mySlot)audio.play('hurt');}
    if(e.type==='down'){const s=stats.get(e.by)||{downs:0};s.downs++;stats.set(e.by,s);world.flash(e.target);audio.play(e.target===g.mySlot?'down':'splat');
      const by=g.roster.find(r=>r.slot===e.by),to=g.roster.find(r=>r.slot===e.target);
      if(by&&to){const li=document.createElement('li');li.className=by.team===0?'a':'b';li.textContent=by.name+' 打倒了 '+to.name;$('feed').prepend(li);while($('feed').children.length>4)$('feed').lastChild.remove();}}
    if(e.type==='respawn'&&e.target===g.mySlot)audio.play('respawn');
  }
}

// ---------- loops ----------
// Simulation: fixed 60 Hz on wall time (setInterval keeps running when the window is covered).
const STEP=1/60;let acc=0,lastT=performance.now(),lastPhase='';
setInterval(()=>{
  try{
    const t=performance.now();acc=Math.min(acc+(t-lastT)/1000,0.5);lastT=t;
    const s=session;if(!s){acc=0;return;}
    const input=mode==='play'?readInput():{...readInput(),mx:0,mz:0,fire:false,dive:false};
    while(acc>=STEP){acc-=STEP;const ev=s.step(STEP,input);if(s.game)onEvents(s.game,ev||[]);}
    const ph=s.kind==='lan'?s.lan.phase():s.game.match.phase;
    if(ph!==lastPhase){if(ph==='count')stats.clear();lastPhase=ph;}
  }catch(e){console.error(e);error(describe(e));}
},1000/120);
let lastFrame=performance.now(),lastLobby=0;
function frame(now){
  const dt=Math.min(0.1,(now-lastFrame)/1000);lastFrame=now;
  try{
    renderMode();if(mode==='lobby'&&now-lastLobby>250){lastLobby=now;renderLobby();}
    if(mode==='closed'&&session){const s=session;session=null;error(s.lan.closeReason()==='left'?'':'联机已结束：房主离开或连接断开。');renderMode(true);syncPlayers();}
    const g=session?.game;
    if(g){world.render(dt,{grid:g.world.paint,actors:session.kind==='lan'?session.lan.drawActors():g.world.actors,shots:g.world.projectiles,me:g.mySlot});if(mode==='play')hud(g);}
    else world.render(dt,{grid:idleGrid,actors:[idleActor],shots:[],me:0});
  }catch(e){console.error(e);}
  requestAnimationFrame(frame);
}
// Title backdrop: your pet standing on a desk with a couple of splats.
const idleGrid=Paint.create();[[-1,-3,1.6,0],[1.5,-4,1.2,1],[-4,-2,0.9,1],[3.5,-2.2,1.4,0]].forEach(([x,z,r,t],i)=>Paint.apply(idleGrid,{kind:'blob',x,z,r,ph:i*1.7,team:t,t:i+1,slot:0}));
const idleActor={slot:0,x:0,z:-3.2,vx:0,vz:0,face:Math.PI/2,alive:true,diving:false,firing:false};
world.snapCamera(0,-3);
requestAnimationFrame(frame);

// ---------- test / diagnostics hook (read-only view of the state) ----------
window.__paint={
  state:()=>{const g=session?.game;return {mode,driver:driver?{kind:driver.profile.kind,name:driver.profile.name}:null,session:session?.kind||null,
    phase:g?(session.kind==='lan'?session.lan.phase():g.match.phase):null,me:g?Game.me(g)&&{...Game.me(g),rand:undefined,crushCd:undefined}:null,
    coverage:g?Paint.coverage(g.world.paint):null,hash:g?Paint.hash(g.world.paint):null,result:g?(session.kind==='lan'?session.lan.result():g.match.result):null,
    actors:g?g.world.actors.map(a=>({slot:a.slot,team:a.team,x:a.x,z:a.z,alive:a.alive,diving:a.diving,hp:a.hp,kind:a.kind})):[],audio:audio.state(),net:session?.lan?.diagnostics?.()||null};},
  world:()=>world.info(),
  screen:(x,z)=>{const v=world.project(x,z);return v;},
};

// ---------- boot ----------
(async()=>{
  renderOptions();
  driver=await C.loadDriver('last')||await C.toyDriver('mouse');renderFighterCard();syncPlayers();
  $('env-note').textContent=sdk?'在桌宠里打开：会自动带入你的桌宠。和朋友一起玩：在桌宠里「发送并一起玩」这份 HTML。':'普通浏览器打开：可以单人练习；导入角色包或图片可以换形象。';
  if(sdk?.character&&await readPet())await joinInvitation();
  else if(sdk?.sessions)await joinInvitation();
})().catch(e=>{console.error(e);error(describe(e));});
