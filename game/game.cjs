'use strict';
// One machine's view of a match: the world it simulates, which actors it owns, and the
// event traffic in and out. The same object runs solo play, the room host and a guest:
//   solo / host — owns its player + the computer players, runs the referee (match.cjs);
//   guest       — owns only its player; hp, downs, respawns and the clock come from the host.
// Shared state changes leave through `drain()` (events to broadcast) and arrive through
// `receive(events)`; paint merges by paint time, so arrival order never matters.
const {PLAYER,TEAMS}=require('./config.cjs');
const Sim=require('./sim.cjs');
const Match=require('./match.cjs');
const AI=require('./ai.cjs');

function create({role='solo',mySlot=0,duration,cpuLevel=1,seed=1}={}){
  const g={role,mySlot,world:Sim.createWorld(),match:Match.create({duration}),bots:new Map(),cpuLevel,seed,
    out:[],feed:[],roster:[],input:Sim.EMPTY_INPUT};
  return g;
}
const referee=g=>g.role!=='guest';
// roster: [{slot,team,name,weapon,kind:'human'|'bot',owner:'local'|'remote',profile?}]
function setRoster(g,roster){
  g.roster=roster.map(r=>({...r}));
  const keep=new Map(g.world.actors.map(a=>[a.slot,a]));
  g.world.actors=g.roster.map(r=>{
    const old=keep.get(r.slot);
    const a=old&&old.team===r.team?old:Sim.createActor({slot:r.slot,team:r.team,name:r.name,weapon:r.weapon,kind:r.kind});
    a.name=r.name;a.kind=r.kind;a.weapon=r.weapon;a.owner=r.owner;return a;
  });
  g.bots=new Map([...g.bots].filter(([slot])=>g.roster.some(r=>r.slot===slot&&r.kind==='bot'&&r.owner==='local')));
  for(const r of g.roster)if(r.kind==='bot'&&r.owner==='local'&&!g.bots.has(r.slot))g.bots.set(r.slot,AI.create(g.world.actors.find(a=>a.slot===r.slot),g.cpuLevel,g.seed));
}
// Fill both teams to `size` players with computer players (solo / host).
function fillBots(humans,{size=2,names=['电脑 · 奶酪','电脑 · 布丁','电脑 · 棉花','电脑 · 饭团']}={}){
  const roster=humans.map(h=>({...h}));const used=new Set(roster.map(r=>r.slot));let n=0;
  for(const team of [0,1]){
    while(roster.filter(r=>r.team===team).length<size){
      let slot=0;while(used.has(slot))slot++;used.add(slot);
      roster.push({slot,team,name:names[n%names.length],weapon:n%2?'roller':'sprayer',kind:'bot',owner:'local'});n++;
    }
  }
  return roster.sort((a,b)=>a.slot-b.slot);
}
function start(g){if(!referee(g))return;Match.start(g.match,g.world);g.feed.length=0;queue(g,{type:'start',no:g.match.no});}
function queue(g,e){g.out.push(e);}
function actor(g,slot){return g.world.actors.find(a=>a.slot===slot);}
// Handle one event that changes shared state (locally produced or received).
function handle(g,e,local){
  // judge is the bounded grace window. After settlement, late network paint
  // cannot change the floor underneath the published result.
  if(g.match.phase==='results'&&(e.type==='splat'||e.type==='fire'))return;
  const w=g.world;
  switch(e.type){
    case 'splat':if(!local)Sim.applySplat(w,e);break;
    case 'fire':if(!local)Sim.addGhost(w,e);break;
    case 'hit':
      if(referee(g))for(const r of Match.hit(g.match,w,e)){handle(g,r,true);queue(g,r);}
      break;
    case 'hurt':{const a=actor(g,e.target);if(a&&!referee(g)){a.hp=e.hp;a.lastHurt=w.ms;}g.feed.push(e);break;}
    case 'down':{const a=actor(g,e.target);if(a){a.alive=false;a.hp=0;a.diving=false;a.downAt=e.ms;}g.feed.push(e);break;}
    case 'respawn':{const a=actor(g,e.target);if(a){Object.assign(a,{alive:true,hp:PLAYER.hp,ink:PLAYER.inkMax,x:e.x,z:e.z,vx:0,vz:0,face:e.face,invulnUntil:e.ms+PLAYER.spawnInvuln*1000});}g.feed.push(e);break;}
  }
}
function receive(g,events){for(const e of events||[])handle(g,e,false);}
// Advance by dt seconds. `input` drives this machine's own player.
function step(g,dt,input=g.input){
  g.input=input;const w=g.world,emit=e=>{handle(g,e,true);queue(g,e);};
  const live=g.match.phase==='play';
  if(live){
    for(const a of w.actors){
      if(a.owner!=='local')continue;
      const bot=g.bots.get(a.slot);
      if(bot)Sim.stepActor(w,a,AI.update(bot,w,a,dt),dt,emit);
      else if(a.slot===g.mySlot)Sim.stepActor(w,a,input,dt,emit);
    }
  }
  if(live||g.match.phase==='judge')Sim.stepProjectiles(w,dt,emit);
  if(referee(g))for(const e of Match.tick(g.match,w,dt)){handle(g,e,true);queue(g,e);}
}
function drain(g){const o=g.out;g.out=[];return o;}
function me(g){return actor(g,g.mySlot);}
function teamOf(g,slot){return actor(g,slot)?.team;}

module.exports={create,setRoster,fillBots,start,step,receive,drain,me,actor,teamOf,referee,TEAMS};
