'use strict';
// Computer players (SPEC §8). Three behaviours, picked every think tick:
//   fight  — an enemy within sight: strafe and shoot at it (reaction delay + aim error by level);
//   refill — ink below 20 %: go to the nearest own ink and dive until 80 %;
//   paint  — otherwise head for the best nearby patch of bare / enemy floor, painting ahead.
// Output is the same input object a keyboard produces, so bots run through stepActor.
const {PLAYER}=require('./config.cjs');
const Arena=require('./arena.cjs');
const Paint=require('./paint.cjs');
const {rng}=require('./sim.cjs');

const LEVELS=[
  {id:'easy',name:'轻松',reaction:0.6,aimError:0.22,sight:8,think:0.5},
  {id:'normal',name:'普通',reaction:0.35,aimError:0.12,sight:10,think:0.35},
  {id:'hard',name:'高手',reaction:0.18,aimError:0.05,sight:12,think:0.25},
];
function create(actor,level=1,seed=1){
  return {slot:actor.slot,L:LEVELS[level]||LEVELS[1],r:rng(seed*977+actor.slot*31+1),mode:'paint',goal:null,goalT:0,think:0,
    target:null,seen:0,strafe:1,strafeT:0,press:0,err:0,errT:0,stuck:0,lastX:actor.x,lastZ:actor.z};
}
const visible=(a,o)=>Arena.segmentBlocked(a.x,a.z,o.x,o.z)===null;
// Direction toward (gx,gz) that is not blocked within 2 m (probe ±30°, ±60°, ±90°).
function steer(a,gx,gz){
  const base=Math.atan2(gz-a.z,gx-a.x);
  for(const off of [0,0.52,-0.52,1.05,-1.05,1.57,-1.57,2.3,-2.3]){
    const ang=base+off,ex=a.x+Math.cos(ang)*2,ez=a.z+Math.sin(ang)*2;
    if(Arena.segmentBlocked(a.x+Math.cos(ang)*PLAYER.radius,a.z+Math.sin(ang)*PLAYER.radius,ex,ez)===null)return {x:Math.cos(ang),z:Math.sin(ang)};
  }
  return {x:Math.cos(base),z:Math.sin(base)};
}
// Score a candidate spot: cells there that are not ours, minus a distance cost.
function patchScore(w,a,x,z){
  let gain=0;for(let dx=-1.5;dx<=1.5;dx+=0.75)for(let dz=-1.5;dz<=1.5;dz+=0.75){
    if(Arena.solidAt(x+dx,z+dz)||!Arena.inside(x+dx,z+dz))continue;const t=Paint.teamAt(w.paint,x+dx,z+dz);if(t!==a.team)gain+=t<0?1:1.4;}
  return gain-Math.hypot(x-a.x,z-a.z)*0.35;
}
function nearestOwnInk(w,a){
  let best=null,bd=Infinity;
  for(let ring=1;ring<=14&&!best;ring++)for(let k=0;k<16;k++){
    const ang=k/16*Math.PI*2,x=a.x+Math.cos(ang)*ring,z=a.z+Math.sin(ang)*ring;
    if(!Arena.inside(x,z)||Arena.solidAt(x,z,PLAYER.radius))continue;
    if(Paint.teamAt(w.paint,x,z)===a.team){const d=Math.hypot(x-a.x,z-a.z);if(d<bd){bd=d;best={x,z};}}
  }
  return best;
}
function think(bot,w,a){
  const L=bot.L;
  const enemies=w.actors.filter(o=>o.team!==a.team&&o.alive&&Math.hypot(o.x-a.x,o.z-a.z)<=L.sight&&visible(a,o)&&!(o.diving&&Math.hypot(o.x-a.x,o.z-a.z)>3));
  enemies.sort((p,q)=>Math.hypot(p.x-a.x,p.z-a.z)-Math.hypot(q.x-a.x,q.z-a.z));
  if(bot.mode==='refill'&&a.ink<80&&Paint.teamAt(w.paint,a.x,a.z)===a.team)return; // keep refilling
  if(enemies.length&&a.ink>=8){
    if(bot.target!==enemies[0].slot){bot.target=enemies[0].slot;bot.seen=0;}
    bot.mode='fight';return;
  }
  bot.target=null;
  if(a.ink<PLAYER.inkMax*0.2){bot.mode='refill';bot.goal=nearestOwnInk(w,a);return;}
  bot.mode='paint';
  if(!bot.goal||bot.goalT<=0||Math.hypot(bot.goal.x-a.x,bot.goal.z-a.z)<1.2){
    let best=null,bs=-Infinity;
    for(let i=0;i<14;i++){
      const x=(bot.r()*2-1)*(Arena.HALF_X-1),z=(bot.r()*2-1)*(Arena.HALF_Z-1);
      if(Arena.solidAt(x,z,PLAYER.radius+0.2))continue;const s=patchScore(w,a,x,z);if(s>bs){bs=s;best={x,z};}
    }
    bot.goal=best;bot.goalT=3+bot.r()*2;
  }
}
// Returns an input object for this frame.
function update(bot,w,a,dt){
  const input={mx:0,mz:0,aimX:a.aimX,aimZ:a.aimZ,fire:false,dive:false,press:bot.press};
  if(!a.alive)return input;
  bot.think-=dt;bot.goalT-=dt;bot.strafeT-=dt;bot.errT-=dt;
  if(bot.think<=0){bot.think=bot.L.think*(0.8+0.4*bot.r());think(bot,w,a);}
  // Unstick: barely moving while trying to → new goal.
  const moved=Math.hypot(a.x-bot.lastX,a.z-bot.lastZ);bot.lastX=a.x;bot.lastZ=a.z;
  if(bot.mode==='paint'&&moved<0.3*dt)bot.stuck+=dt;else bot.stuck=0;
  if(bot.stuck>0.8){bot.goal=null;bot.stuck=0;}
  if(bot.errT<=0){bot.err=(bot.r()*2-1)*bot.L.aimError;bot.errT=0.4+bot.r()*0.5;}
  if(bot.mode==='fight'){
    const o=w.actors.find(x=>x.slot===bot.target);
    if(!o||!o.alive){bot.mode='paint';return input;}
    bot.seen+=dt;
    const d=Math.hypot(o.x-a.x,o.z-a.z),ang=Math.atan2(o.z-a.z,o.x-a.x)+bot.err;
    input.aimX=a.x+Math.cos(ang)*d;input.aimZ=a.z+Math.sin(ang)*d;
    if(bot.strafeT<=0){bot.strafe=bot.r()<0.5?1:-1;bot.strafeT=0.6+bot.r()*0.8;}
    // Close in to weapon range, strafe sideways.
    const want=a.weapon==='roller'?1.2:7,fwd=d>want?1:d<want*0.6?-0.6:0;
    const s={x:Math.cos(ang)*fwd-Math.sin(ang)*bot.strafe*0.8,z:Math.sin(ang)*fwd+Math.cos(ang)*bot.strafe*0.8};
    const st=steer(a,a.x+s.x*2,a.z+s.z*2);input.mx=st.x;input.mz=st.z;
    if(bot.seen>=bot.L.reaction){
      if(a.weapon==='roller'){input.fire=true;if(d<5&&bot.r()<0.08)input.press=++bot.press;}
      else input.fire=true;
    }
    return input;
  }
  if(bot.mode==='refill'){
    if(Paint.teamAt(w.paint,a.x,a.z)===a.team){
      input.dive=true;
      // Swim around a little inside own ink rather than sitting still.
      const g=bot.goal;if(g&&Math.hypot(g.x-a.x,g.z-a.z)>0.6){const st=steer(a,g.x,g.z);input.mx=st.x;input.mz=st.z;}
      if(a.ink>=80)bot.mode='paint';
      return input;
    }
    const g=bot.goal||nearestOwnInk(w,a);bot.goal=g;
    if(g){const st=steer(a,g.x,g.z);input.mx=st.x;input.mz=st.z;}
    return input;
  }
  // paint
  const g=bot.goal;if(!g)return input;
  const st=steer(a,g.x,g.z);input.mx=st.x;input.mz=st.z;
  // Aim a few metres ahead and down the path so the floor gets covered on the way.
  input.aimX=a.x+st.x*4+Math.sin(bot.goalT*3)*1.2*-st.z;input.aimZ=a.z+st.z*4+Math.sin(bot.goalT*3)*1.2*st.x;
  input.fire=a.ink>6;
  if(a.weapon==='roller'&&a.ink>6)input.fire=true;
  // Swim through own ink on the way (fast, refills).
  if(!input.fire&&Paint.teamAt(w.paint,a.x,a.z)===a.team)input.dive=true;
  return input;
}
module.exports={LEVELS,create,update};
