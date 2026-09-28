'use strict';
// Actor + projectile simulation (SPEC §3–§5). Each machine simulates the actors it OWNS
// (its player; the room host also owns the computer players) and the projectiles they
// fire. Owned projectiles paint and report hits; copies of other machines' shots are
// "ghosts" that only fly for the eye. Everything that changes shared state goes out
// through `emit(event)`: splats (paint), fire (for ghosts), hit claims (for the referee).
const {PLAYER,WEAPONS}=require('./config.cjs');
const Arena=require('./arena.cjs');
const Paint=require('./paint.cjs');

const TAU=Math.PI*2;
const clamp=(v,a,b)=>v<a?a:v>b?b:v;
// Small deterministic PRNG (mulberry32) so spread / drops replay identically from a seed.
function rng(seed){let a=seed>>>0||1;return()=>{a=(a+0x6D2B79F5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};}

function createWorld(){return {ms:0,paint:Paint.create(),actors:[],projectiles:[],nextShot:1};}
function createActor({slot,team,name='',weapon='sprayer',kind='human'}){
  const sp=Arena.spawnPoint(team,slot);
  return {slot,team,name,weapon:WEAPONS[weapon]?weapon:'sprayer',kind,
    x:sp.x,z:sp.z,vx:0,vz:0,face:sp.face,aimX:sp.x+Math.cos(sp.face),aimZ:sp.z+Math.sin(sp.face),
    ink:PLAYER.inkMax,hp:PLAYER.hp,alive:true,diving:false,firing:false,rolling:false,
    ground:-1,sinceFire:99,fireCd:0,flickCd:0,holdT:0,lastPress:0,rollAcc:0,crushCd:{},
    invulnUntil:0,lastHurt:-1e9,downAt:0,respawnAt:0,rand:rng(0x9e37+slot*7919)};
}
const EMPTY_INPUT={mx:0,mz:0,aimX:0,aimZ:0,fire:false,dive:false,press:0};

// Advance one owned actor by dt seconds with its current input.
function stepActor(w,a,input=EMPTY_INPUT,dt,emit){
  if(!a.alive){a.vx=a.vz=0;a.diving=false;a.firing=false;a.rolling=false;return;}
  const W=WEAPONS[a.weapon],ms=w.ms;
  a.ground=Paint.teamAt(w.paint,a.x,a.z);
  const own=a.ground===a.team,enemy=a.ground>=0&&a.ground!==a.team;
  // Diving needs your own ink underfoot; firing always pops you out.
  const wantFire=!!input.fire;
  a.diving=!!input.dive&&own&&!wantFire;
  // ---- movement ----
  let mx=+input.mx||0,mz=+input.mz||0;const ml=Math.hypot(mx,mz);if(ml>1){mx/=ml;mz/=ml;}
  let speed=a.diving?PLAYER.diveSpeed:PLAYER.runSpeed;
  if(!a.diving&&wantFire)speed=a.weapon==='roller'?(a.rolling?W.rollSpeed:PLAYER.runSpeed):W.moveSpeedFiring;
  if(enemy&&!a.diving)speed=Math.min(speed,PLAYER.enemyInkSpeed);
  const tx=mx*speed,tz=mz*speed,dvx=tx-a.vx,dvz=tz-a.vz,dl=Math.hypot(dvx,dvz);
  const acc=(ml>0.01?(a.diving?PLAYER.diveAccel:PLAYER.accel):PLAYER.decel)*dt;
  if(dl<=acc){a.vx=tx;a.vz=tz;}else{a.vx+=dvx/dl*acc;a.vz+=dvz/dl*acc;}
  const px=a.x,pz=a.z,res=Arena.resolveCircle(a.x+a.vx*dt,a.z+a.vz*dt,PLAYER.radius);
  a.x=res.x;a.z=res.z;
  if(res.hit){a.vx=(a.x-px)/dt;a.vz=(a.z-pz)/dt;}
  // ---- facing / aim ----
  if(Number.isFinite(input.aimX)&&Number.isFinite(input.aimZ)){a.aimX=input.aimX;a.aimZ=input.aimZ;}
  const adx=a.aimX-a.x,adz=a.aimZ-a.z;
  if(a.diving&&Math.hypot(a.vx,a.vz)>0.5)a.face=Math.atan2(a.vz,a.vx);
  else if(adx*adx+adz*adz>0.01)a.face=Math.atan2(adz,adx);
  // ---- ink ----
  a.sinceFire+=dt;
  if(a.diving)a.ink=Math.min(PLAYER.inkMax,a.ink+PLAYER.inkRefillDive*dt);
  else if(a.sinceFire>=PLAYER.inkRefillDelay)a.ink=Math.min(PLAYER.inkMax,a.ink+PLAYER.inkRefillIdle*dt);
  // ---- weapon ----
  a.fireCd=Math.max(0,a.fireCd-dt);a.flickCd=Math.max(0,a.flickCd-dt);
  a.firing=wantFire;a.holdT=wantFire?a.holdT+dt:0;
  const pressed=(input.press|0)>a.lastPress;a.lastPress=Math.max(a.lastPress,input.press|0);
  const dir={x:Math.cos(a.face),z:Math.sin(a.face)};
  if(a.weapon==='sprayer'){
    a.rolling=false;
    if(wantFire&&a.fireCd<=0){
      if(a.ink>=W.inkPerShot){
        a.ink-=W.inkPerShot;a.fireCd+=W.fireInterval;a.sinceFire=0;
        const spread=(a.rand()*2-1)*W.spreadDeg*Math.PI/180,ang=a.face+spread;
        fire(w,a,{kind:'shot',x:a.x+Math.cos(ang)*0.5,z:a.z+Math.sin(ang)*0.5,dx:Math.cos(ang),dz:Math.sin(ang),speed:W.projSpeed,range:W.range,
          damage:W.damage,impactR:W.impactRadius,trailEvery:W.trailEvery,trailR:W.trailRadius},emit);
      }else a.fireCd=W.fireInterval;
    }
  }else{ // roller: a press flicks a fan of drops; holding rolls a stripe
    if(pressed&&a.flickCd<=0&&a.ink>=W.flickInk){
      a.ink-=W.flickInk;a.flickCd=W.flickInterval;a.sinceFire=0;
      const seed=(a.rand()*4294967296)>>>0,r=rng(seed);
      for(let i=0;i<W.flickDrops;i++){
        const ang=a.face+((i/(W.flickDrops-1))-0.5)*2*W.flickSpreadDeg*Math.PI/180+(r()-0.5)*0.05,range=W.flickRange*(0.7+0.3*r());
        fire(w,a,{kind:'drop',x:a.x+Math.cos(ang)*0.6,z:a.z+Math.sin(ang)*0.6,dx:Math.cos(ang),dz:Math.sin(ang),speed:W.flickSpeed,range,damage:W.flickDamage,impactR:W.flickRadius,trailEvery:0,trailR:0},emit);
      }
    }
    a.rolling=wantFire&&a.holdT>=W.rollDelay&&a.ink>0;
    if(a.rolling){
      const moved=Math.hypot(a.x-px,a.z-pz);a.rollAcc+=moved;a.sinceFire=0;
      a.ink=Math.max(0,a.ink-moved*W.rollInkPerMeter);
      if(a.rollAcc>=W.rollStep||moved<1e-4&&a.rollAcc===0){
        const cx=a.x+dir.x*0.65,cz=a.z+dir.z*0.65;
        if(a.rollAcc>=W.rollStep)emitSplat(w,a,{kind:'band',x:cx,z:cz,dx:dir.x,dz:dir.z,w:W.rollWidth,l:Math.max(W.rollStep,a.rollAcc)+0.15},emit);
        a.rollAcc=0;
        // Crushing: enemies inside the stripe right in front of the roller.
        for(const o of w.actors){
          if(o.team===a.team||!o.alive||(a.crushCd[o.slot]||0)>ms)continue;
          const ox=o.x-cx,oz=o.z-cz,along=ox*dir.x+oz*dir.z,across=-ox*dir.z+oz*dir.x;
          if(Math.abs(along)<=0.6+PLAYER.radius&&Math.abs(across)<=W.rollWidth/2+PLAYER.radius*0.5){a.crushCd[o.slot]=ms+500;emit({type:'hit',target:o.slot,by:a.slot,dmg:W.rollDamage,ms});}
        }
      }
    }else a.rollAcc=0;
  }
}
function emitSplat(w,a,s,emit){
  const splat={type:'splat',kind:s.kind||'blob',x:+s.x.toFixed(3),z:+s.z.toFixed(3),team:a.team,slot:a.slot,ms:w.ms};
  if(splat.kind==='band')Object.assign(splat,{dx:+s.dx.toFixed(3),dz:+s.dz.toFixed(3),w:s.w,l:+s.l.toFixed(3)});
  else Object.assign(splat,{r:+s.r.toFixed(3),ph:+(s.ph??a.rand()*TAU).toFixed(3)});
  applySplat(w,splat);emit(splat);return splat;
}
function applySplat(w,s){
  return Paint.apply(w.paint,s.kind==='band'?{kind:'band',x:s.x,z:s.z,dx:s.dx,dz:s.dz,w:s.w,l:s.l,team:s.team,t:s.ms,slot:s.slot}:{kind:'blob',x:s.x,z:s.z,r:s.r,ph:s.ph,team:s.team,t:s.ms,slot:s.slot});
}
function fire(w,a,p,emit){
  const shot={id:a.slot*1e6+(w.nextShot++),owner:a.slot,team:a.team,ghost:false,...p,travelled:0,trailAcc:0,age:0,y:0.55};
  w.projectiles.push(shot);
  emit({type:'fire',id:shot.id,owner:a.slot,team:a.team,kind:p.kind,x:+p.x.toFixed(3),z:+p.z.toFixed(3),dx:+p.dx.toFixed(4),dz:+p.dz.toFixed(4),speed:p.speed,range:+p.range.toFixed(3),ms:w.ms});
  return shot;
}
// A copy of another machine's shot, flying for the eye only (never paints, never hits).
function addGhost(w,e){
  if(w.projectiles.some(p=>p.id===e.id))return;
  w.projectiles.push({id:e.id,owner:e.owner,team:e.team,ghost:true,kind:e.kind,x:e.x,z:e.z,dx:e.dx,dz:e.dz,speed:e.speed,range:e.range,travelled:0,trailAcc:0,age:0,y:0.55,damage:0,impactR:0,trailEvery:0});
}
function stepProjectiles(w,dt,emit){
  const keep=[];
  for(const p of w.projectiles){
    p.age+=dt;
    const step=Math.min(p.speed*dt,p.range-p.travelled);
    const nx=p.x+p.dx*step,nz=p.z+p.dz*step;
    let end=null,hitActor=null;
    const tWall=Arena.segmentBlocked(p.x,p.z,nx,nz);
    let tHit=tWall===null?1:tWall;
    if(!p.ghost){
      for(const o of w.actors){
        if(o.team===p.team||!o.alive)continue;
        const t=segCircle(p.x,p.z,nx,nz,o.x,o.z,PLAYER.radius+0.08);
        if(t!==null&&t<=tHit){tHit=t;hitActor=o;}
      }
    }
    const hx=p.x+(nx-p.x)*tHit,hz=p.z+(nz-p.z)*tHit,moved=step*tHit;
    if(!p.ghost&&p.trailEvery>0){
      p.trailAcc+=moved;
      while(p.trailAcc>=p.trailEvery){p.trailAcc-=p.trailEvery;const back=p.trailAcc;emitSplat(w,{team:p.team,slot:p.owner,rand:Math.random},{x:hx-p.dx*back,z:hz-p.dz*back,r:p.trailR,ph:hashPhase(p.id,p.travelled)},emit);}
    }
    p.x=hx;p.z=hz;p.travelled+=moved;p.y=Math.max(0,0.55*(1-Math.pow(p.travelled/p.range,2)));
    if(hitActor)end='actor';else if(tWall!==null)end='wall';else if(p.travelled>=p.range-1e-6)end='land';
    if(!end){keep.push(p);continue;}
    if(p.ghost)continue;
    if(hitActor)emit({type:'hit',target:hitActor.slot,by:p.owner,dmg:p.damage,ms:w.ms});
    // Hitting a wall leaves a smaller splat just in front of it; landing leaves the full one.
    const r=end==='wall'?p.impactR*0.6:end==='actor'?p.impactR*0.7:p.impactR;
    emitSplat(w,{team:p.team,slot:p.owner,rand:Math.random},{x:p.x-p.dx*0.05,z:p.z-p.dz*0.05,r,ph:hashPhase(p.id,0)},emit);
  }
  w.projectiles=keep;
}
const hashPhase=(id,t)=>((Math.imul(id|0,2654435761)>>>0)%6283)/1000+t*0.37;
// Segment a→b vs circle (c,r): first t∈[0,1] of contact, or null.
function segCircle(ax,az,bx,bz,cx,cz,r){
  const dx=bx-ax,dz=bz-az,fx=ax-cx,fz=az-cz,a=dx*dx+dz*dz,b=2*(fx*dx+fz*dz),c=fx*fx+fz*fz-r*r;
  if(c<=0)return 0;if(a<1e-12)return null;
  const disc=b*b-4*a*c;if(disc<0)return null;const t=(-b-Math.sqrt(disc))/(2*a);return t>=0&&t<=1?t:null;
}
// Snapshot / restore of the fields other machines need to draw an actor.
function actorState(a){return [a.slot,+a.x.toFixed(3),+a.z.toFixed(3),+a.vx.toFixed(2),+a.vz.toFixed(2),+a.face.toFixed(3),(a.diving?1:0)|(a.firing?2:0)|(a.rolling?4:0)|(a.alive?8:0),Math.round(a.ink),Math.round(a.hp)];}
function readState(arr){if(!Array.isArray(arr)||arr.length<9||!arr.slice(1).every(Number.isFinite))return null;const f=arr[6];return {slot:arr[0],x:arr[1],z:arr[2],vx:arr[3],vz:arr[4],face:arr[5],diving:!!(f&1),firing:!!(f&2),rolling:!!(f&4),alive:!!(f&8),ink:arr[7],hp:arr[8]};}

module.exports={createWorld,createActor,stepActor,stepProjectiles,applySplat,emitSplat,addGhost,actorState,readState,rng,segCircle,clamp,EMPTY_INPUT};
