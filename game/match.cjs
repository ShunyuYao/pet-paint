'use strict';
// The referee and the match clock (SPEC §6–§7). Runs on the room host (or locally in solo).
// It owns hp / down / respawn, the phases and the result; players' machines own movement,
// shots and paint. Phases: lobby → count (3 s) → play → judge (grace for splats in flight)
// → results.
const {PLAYER,MATCH}=require('./config.cjs');
const Arena=require('./arena.cjs');
const Paint=require('./paint.cjs');

function create({duration=MATCH.defaultDuration}={}){
  return {phase:'lobby',phaseT:0,duration:MATCH.durations.includes(duration)?duration:MATCH.defaultDuration,result:null,no:0};
}
function start(m,w){
  m.phase='count';m.phaseT=0;m.result=null;m.no++;
  w.ms=0;w.paint=Paint.create();w.projectiles=[];
  for(const a of w.actors){const sp=Arena.spawnPoint(a.team,a.slot);Object.assign(a,{x:sp.x,z:sp.z,vx:0,vz:0,face:sp.face,aimX:sp.x+Math.cos(sp.face),aimZ:sp.z+Math.sin(sp.face),hp:PLAYER.hp,ink:PLAYER.inkMax,alive:true,diving:false,firing:false,rolling:false,invulnUntil:0,lastHurt:-1e9,respawnAt:0});}
}
const playing=m=>m.phase==='play';
const timeLeft=m=>m.phase==='count'?m.duration:m.phase==='play'?Math.max(0,m.duration-m.phaseT):0;

// Apply a hit claim from a shooter's machine. Returns the resulting events.
function hit(m,w,claim){
  if(!playing(m))return [];
  const a=w.actors.find(x=>x.slot===claim.target),by=w.actors.find(x=>x.slot===claim.by);
  if(!a||!by||!a.alive||a.team===by.team||w.ms<a.invulnUntil)return [];
  const dmg=Math.max(0,Math.min(200,+claim.dmg||0));if(!dmg)return [];
  a.hp-=dmg;a.lastHurt=w.ms;
  if(a.hp>0)return [{type:'hurt',target:a.slot,by:by.slot,hp:Math.round(a.hp),ms:w.ms}];
  a.hp=0;a.alive=false;a.diving=false;a.downAt=w.ms;a.respawnAt=w.ms+PLAYER.respawnTime*1000;
  return [{type:'down',target:a.slot,by:by.slot,ms:w.ms}];
}
// Advance the clock; returns referee events (down / respawn / phase changes).
function tick(m,w,dt){
  const ev=[];m.phaseT+=dt;
  if(m.phase==='count'&&m.phaseT>=MATCH.countdown){m.phase='play';m.phaseT=0;w.ms=0;ev.push({type:'phase',phase:'play'});}
  else if(m.phase==='play'){
    w.ms+=dt*1000;
    for(const a of w.actors){
      if(!a.alive){
        if(w.ms>=a.respawnAt){
          const sp=Arena.spawnPoint(a.team,a.slot);
          Object.assign(a,{alive:true,hp:PLAYER.hp,ink:PLAYER.inkMax,x:sp.x,z:sp.z,vx:0,vz:0,face:sp.face,invulnUntil:w.ms+PLAYER.spawnInvuln*1000,lastHurt:-1e9});
          ev.push({type:'respawn',target:a.slot,x:sp.x,z:sp.z,face:sp.face,ms:w.ms});
        }
      }else if(a.hp<PLAYER.hp&&w.ms-a.lastHurt>=PLAYER.regenDelay*1000)a.hp=Math.min(PLAYER.hp,a.hp+PLAYER.regenRate*dt);
    }
    if(m.phaseT>=m.duration){m.phase='judge';m.phaseT=0;ev.push({type:'phase',phase:'judge'});}
  }else if(m.phase==='judge'&&m.phaseT>=MATCH.judgeGrace){
    m.phase='results';m.phaseT=0;m.result=judge(w);ev.push({type:'phase',phase:'results',result:m.result});
  }
  return ev;
}
// Most painted floor wins; identical cell counts are a draw.
function judge(w){
  const c=Paint.coverage(w.paint);
  const winner=c.cells[0]===c.cells[1]?-1:c.cells[0]>c.cells[1]?0:1;
  return {cells:c.cells,total:c.total,share:c.share.map(s=>Math.round(s*1000)/10),winner,hash:Paint.hash(w.paint)};
}
function backToLobby(m){m.phase='lobby';m.phaseT=0;m.result=null;}

module.exports={create,start,tick,hit,judge,playing,timeLeft,backToLobby};
