'use strict';
// The desk arena (SPEC §1): 28 × 18 m, point-symmetric about the centre so both teams
// get the same field. Obstacles are listed for one half; the other half is the 180°
// rotation (x,z) → (−x,−z). Obstacles block movement and shots and are never paintable.
// Team 0 (orange) spawns on the left (−x), team 1 (blue) on the right.
const {ARENA}=require('./config.cjs');

const HALF_X=ARENA.w/2,HALF_Z=ARENA.h/2;
// kind: 'box' {x0,z0,x1,z1,h} | 'disc' {x,z,r,h}. `look` names the prop for the renderer.
const HALF=[
  {kind:'box',look:'laptop',x0:-2.5,z0:-1.5,x1:0,z1:1.5,h:0.4}, // centre piece (split so mirroring yields one box)
  {kind:'box',look:'books',x0:-7.7,z0:-6.6,x1:-5.5,z1:-5.0,h:0.9},
  {kind:'box',look:'books',x0:-7.2,z0:4.5,x1:-5.0,z1:6.1,h:0.7},
  {kind:'disc',look:'mug',x:-3.4,z:-4.9,r:0.8,h:1.1},
  {kind:'box',look:'pencil',x0:-3.2,z0:-7.9,x1:3.2,z1:-7.45,h:0.35},
];
function mirror(o){
  if(o.kind==='disc')return {...o,x:-o.x,z:-o.z};
  return {...o,x0:-o.x1,x1:-o.x0,z0:-o.z1,z1:-o.z0};
}
function merge(list){
  // The laptop half-box and its mirror share the x=0 edge: join them into one prop.
  const out=[];
  for(const o of list){
    const twin=out.find(p=>p.kind==='box'&&o.kind==='box'&&p.look===o.look&&p.z0===o.z0&&p.z1===o.z1&&(p.x1===o.x0||p.x0===o.x1));
    if(twin){twin.x0=Math.min(twin.x0,o.x0);twin.x1=Math.max(twin.x1,o.x1);}else out.push({...o});
  }
  // The pencil is centred on x=0, so its mirror lands on the other long edge: keep both.
  return out;
}
const OBSTACLES=merge([...HALF,...HALF.map(mirror)]);
const BASES=[{team:0,x0:-HALF_X,z0:-3,x1:-10.5,z1:3},{team:1,x0:10.5,z0:-3,x1:HALF_X,z1:3}];
const SPAWNS=[[-12.8,0],[-12.8,1.6],[-12.8,-1.6],[-11.6,0]];
function spawnPoint(team,slot){const [x,z]=SPAWNS[slot%SPAWNS.length];return team===0?{x,z,face:0}:{x:-x,z:-z,face:Math.PI};}

const inBox=(o,x,z,pad=0)=>x>=o.x0-pad&&x<=o.x1+pad&&z>=o.z0-pad&&z<=o.z1+pad;
function solidAt(x,z,pad=0){
  for(const o of OBSTACLES){
    if(o.kind==='box'){if(inBox(o,x,z,pad))return o;}
    else if((x-o.x)**2+(z-o.z)**2<=(o.r+pad)**2)return o;
  }
  return null;
}
function baseAt(x,z){for(const b of BASES)if(inBox(b,x,z))return b.team;return -1;}
const inside=(x,z)=>x>=-HALF_X&&x<=HALF_X&&z>=-HALF_Z&&z<=HALF_Z;

// Push a circle (x,z,r) out of every obstacle and keep it inside the arena. Returns {x,z,hit}.
function resolveCircle(x,z,r){
  let hit=false;
  for(let pass=0;pass<3;pass++){
    for(const o of OBSTACLES){
      if(o.kind==='box'){
        const cx=Math.max(o.x0,Math.min(x,o.x1)),cz=Math.max(o.z0,Math.min(z,o.z1));
        let dx=x-cx,dz=z-cz,d2=dx*dx+dz*dz;
        if(d2>=r*r)continue;
        hit=true;
        if(d2<1e-9){ // centre inside the box: leave by the nearest face
          const exits=[[x-o.x0,-1,0],[o.x1-x,1,0],[z-o.z0,0,-1],[o.z1-z,0,1]].sort((a,b)=>a[0]-b[0])[0];
          x+=exits[1]*(exits[0]+r);z+=exits[2]*(exits[0]+r);continue;
        }
        const d=Math.sqrt(d2),push=r-d;x+=dx/d*push;z+=dz/d*push;
      }else{
        const dx=x-o.x,dz=z-o.z,d=Math.hypot(dx,dz),min=o.r+r;
        if(d>=min)continue;hit=true;
        if(d<1e-9){x+=min;continue;}
        x+=dx/d*(min-d);z+=dz/d*(min-d);
      }
    }
  }
  const cx=Math.max(-HALF_X+r,Math.min(HALF_X-r,x)),cz=Math.max(-HALF_Z+r,Math.min(HALF_Z-r,z));
  if(cx!==x||cz!==z)hit=true;
  return {x:cx,z:cz,hit};
}
// First obstacle / wall crossing on the segment a→b (projectile flight). Returns t∈[0,1] or null.
function segmentBlocked(ax,az,bx,bz){
  let best=null;
  const consider=t=>{if(t>=0&&t<=1&&(best===null||t<best))best=t;};
  const dx=bx-ax,dz=bz-az;
  for(const o of OBSTACLES){
    if(o.kind==='box'){
      // slab test
      let t0=0,t1=1,ok=true;
      for(const [p,d,lo,hi] of [[ax,dx,o.x0,o.x1],[az,dz,o.z0,o.z1]]){
        if(Math.abs(d)<1e-12){if(p<lo||p>hi){ok=false;break;}continue;}
        let ta=(lo-p)/d,tb=(hi-p)/d;if(ta>tb)[ta,tb]=[tb,ta];
        t0=Math.max(t0,ta);t1=Math.min(t1,tb);if(t0>t1){ok=false;break;}
      }
      if(ok)consider(t0);
    }else{
      const fx=ax-o.x,fz=az-o.z,a=dx*dx+dz*dz,b=2*(fx*dx+fz*dz),c=fx*fx+fz*fz-o.r*o.r,disc=b*b-4*a*c;
      if(a>1e-12&&disc>=0){const s=Math.sqrt(disc);consider((-b-s)/(2*a));if(c<0)consider(0);}
    }
  }
  if(!inside(bx,bz)){
    for(const [p,d,lo,hi] of [[ax,dx,-HALF_X,HALF_X],[az,dz,-HALF_Z,HALF_Z]])if(Math.abs(d)>1e-12){
      if(p+d<lo)consider((lo-p)/d);if(p+d>hi)consider((hi-p)/d);
    }
  }
  return best;
}

module.exports={OBSTACLES,BASES,HALF_X,HALF_Z,spawnPoint,solidAt,baseAt,inside,resolveCircle,segmentBlocked};
