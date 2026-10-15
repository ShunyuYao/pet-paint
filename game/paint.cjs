'use strict';
// The turf grid (SPEC §2). One grid drives rendering, gameplay queries and scoring.
// Every cell remembers WHO painted it last and WHEN (match ms × 8 + actor slot).
// A splat only overwrites cells whose stamp is older, so applying the same set of splats
// in any order gives the same grid on every machine (last-writer-wins by paint time).
const {ARENA,STAMP_SLOTS}=require('./config.cjs');
const Arena=require('./arena.cjs');

const COLS=ARENA.cols,ROWS=ARENA.rows,CELL=ARENA.cell,N=COLS*ROWS;
const X0=-ARENA.w/2,Z0=-ARENA.h/2;
// Cell classes: 0 paintable, 1 solid (obstacle), 2 base of team 0, 3 base of team 1.
const CLASS=new Uint8Array(N);
for(let r=0;r<ROWS;r++)for(let c=0;c<COLS;c++){
  const x=X0+(c+0.5)*CELL,z=Z0+(r+0.5)*CELL,i=r*COLS+c;
  if(Arena.solidAt(x,z))CLASS[i]=1;else{const b=Arena.baseAt(x,z);CLASS[i]=b<0?0:2+b;}
}
let PAINTABLE=0;for(let i=0;i<N;i++)if(CLASS[i]===0)PAINTABLE++;

const stampOf=(ms,slot)=>Math.max(0,Math.round(ms))*STAMP_SLOTS+(slot&(STAMP_SLOTS-1));
// Deterministic blob outline: both the grid and any renderer use this same edge.
function blobEdge(angle,phase){return 1+0.14*Math.sin(3*angle+phase)+0.07*Math.sin(5*angle+phase*1.7);}
const BLOB_MAX=1.21;

function create(){
  const g={team:new Int8Array(N).fill(-1),stamp:new Uint32Array(N),dirty:true,version:0};
  for(let i=0;i<N;i++)if(CLASS[i]>=2)g.team[i]=CLASS[i]-2; // bases start in their team's colour
  return g;
}
// A splat: {kind:'blob',x,z,r,ph,team,t(ms),slot} or {kind:'band',x,z,dx,dz,w,l,team,t,slot}
// (band = roller stripe centred at x,z, `l` long along (dx,dz), `w` wide).
// Returns the number of cells whose owner changed.
function apply(g,s){
  const st=stampOf(s.t,s.slot),team=s.team|0;let changed=0;
  const visit=(c,r)=>{
    const i=r*COLS+c,k=CLASS[i];
    if(k===1||(k>=2&&k-2!==team))return;      // obstacles never; enemy bases never
    if(st<g.stamp[i])return;                     // an older splat never covers a newer one
    if(st===g.stamp[i]&&team<=g.team[i])return; // equal stamps: deterministic tie-break
    if(g.team[i]!==team)changed++;g.team[i]=team;g.stamp[i]=st;
  };
  if(s.kind==='band'){
    const len=Math.hypot(s.dx,s.dz)||1,ux=s.dx/len,uz=s.dz/len,hl=s.l/2,hw=s.w/2,ext=Math.hypot(hl,hw);
    const c0=Math.max(0,Math.floor((s.x-ext-X0)/CELL)),c1=Math.min(COLS-1,Math.floor((s.x+ext-X0)/CELL));
    const r0=Math.max(0,Math.floor((s.z-ext-Z0)/CELL)),r1=Math.min(ROWS-1,Math.floor((s.z+ext-Z0)/CELL));
    for(let r=r0;r<=r1;r++)for(let c=c0;c<=c1;c++){
      const px=X0+(c+0.5)*CELL-s.x,pz=Z0+(r+0.5)*CELL-s.z,along=px*ux+pz*uz,across=-px*uz+pz*ux;
      if(Math.abs(along)<=hl&&Math.abs(across)<=hw)visit(c,r);
    }
  }else{
    const R=s.r*BLOB_MAX;
    const c0=Math.max(0,Math.floor((s.x-R-X0)/CELL)),c1=Math.min(COLS-1,Math.floor((s.x+R-X0)/CELL));
    const r0=Math.max(0,Math.floor((s.z-R-Z0)/CELL)),r1=Math.min(ROWS-1,Math.floor((s.z+R-Z0)/CELL));
    for(let r=r0;r<=r1;r++)for(let c=c0;c<=c1;c++){
      const dx=X0+(c+0.5)*CELL-s.x,dz=Z0+(r+0.5)*CELL-s.z,edge=s.r*blobEdge(Math.atan2(dz,dx),s.ph||0);
      if(dx*dx+dz*dz<=edge*edge)visit(c,r);
    }
  }
  if(changed){g.dirty=true;g.version++;}
  return changed;
}
function cellAt(x,z){
  const c=Math.floor((x-X0)/CELL),r=Math.floor((z-Z0)/CELL);
  if(c<0||r<0||c>=COLS||r>=ROWS)return -1;return r*COLS+c;
}
// Owner of the ink under (x,z): 0 / 1, or -1 for bare floor / outside.
function teamAt(g,x,z){const i=cellAt(x,z);return i<0?-1:g.team[i];}
// Share of the paintable floor (bases and obstacles excluded) per team.
function coverage(g){
  let a=0,b=0;for(let i=0;i<N;i++)if(CLASS[i]===0){if(g.team[i]===0)a++;else if(g.team[i]===1)b++;}
  return {cells:[a,b],total:PAINTABLE,share:[a/PAINTABLE,b/PAINTABLE]};
}
// FNV-1a over the owner bytes: equal hashes ⇔ (practically) identical turf on two screens.
function hash(g){let h=0x811c9dc5;for(let i=0;i<N;i++){h^=(g.team[i]+1)&255;h=Math.imul(h,0x01000193)>>>0;}return h>>>0;}

// Row-range chunks for the host's rotating full-map broadcast (team + stamp per cell).
const CHUNKS=16,ROWS_PER_CHUNK=Math.ceil(ROWS/CHUNKS);
function encodeChunk(g,k){
  const r0=k*ROWS_PER_CHUNK,r1=Math.min(ROWS,r0+ROWS_PER_CHUNK),n=(r1-r0)*COLS,buf=new Uint8Array(n*5);
  for(let j=0;j<n;j++){const i=r0*COLS+j,s=g.stamp[i];buf[j*5]=g.team[i]+1;buf[j*5+1]=s&255;buf[j*5+2]=(s>>>8)&255;buf[j*5+3]=(s>>>16)&255;buf[j*5+4]=(s>>>24)&255;}
  return {k,data:toBase64(buf)};
}
// Merge a chunk with the same last-writer-wins rule (never makes a newer cell older).
function mergeChunk(g,chunk){
  const k=chunk?.k;if(!Number.isInteger(k)||k<0||k>=CHUNKS||typeof chunk.data!=='string')return 0;
  const r0=k*ROWS_PER_CHUNK,r1=Math.min(ROWS,r0+ROWS_PER_CHUNK),n=(r1-r0)*COLS,buf=fromBase64(chunk.data);
  if(buf.length!==n*5)return 0;let changed=0;
  for(let j=0;j<n;j++){
    const i=r0*COLS+j,team=buf[j*5]-1,s=(buf[j*5+1]|(buf[j*5+2]<<8)|(buf[j*5+3]<<16)|(buf[j*5+4]<<24))>>>0;
    if(team<-1||team>1||CLASS[i]===1)continue;
    if(s>g.stamp[i]||(s===g.stamp[i]&&team>g.team[i])){if(g.team[i]!==team)changed++;g.team[i]=team;g.stamp[i]=s;}
  }
  if(changed){g.dirty=true;g.version++;}
  return changed;
}
// Once the referee settles a round, its owner grid is authoritative. Provisional
// local timestamps cannot override it. Validate every byte and the digest before
// replacing any cell; regular in-match chunks keep their last-writer-wins rule.
function encodeFinal(g){return toBase64(Uint8Array.from(g.team,t=>t+1));}
function applyFinal(g,data,expectedHash){
  if(typeof data!=='string'||data.length!==Math.ceil(N/3)*4||!Number.isInteger(expectedHash))return false;
  let bytes;try{bytes=fromBase64(data);}catch{return false;}if(bytes.length!==N)return false;
  const candidate=create();for(let i=0;i<N;i++){
    const t=bytes[i]-1;if(t<-1||t>1||CLASS[i]===1&&t!==-1||CLASS[i]>=2&&t!==CLASS[i]-2)return false;
    candidate.team[i]=t;
  }
  if(hash(candidate)!==expectedHash)return false;
  g.team.set(candidate.team);g.stamp.fill(0);g.dirty=true;g.version++;return true;
}
function toBase64(bytes){
  if(typeof Buffer!=='undefined')return Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength).toString('base64');
  let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(s);
}
function fromBase64(str){
  if(typeof Buffer!=='undefined')return new Uint8Array(Buffer.from(str,'base64'));
  const s=atob(str),b=new Uint8Array(s.length);for(let i=0;i<s.length;i++)b[i]=s.charCodeAt(i);return b;
}

module.exports={COLS,ROWS,CELL,N,X0,Z0,CLASS,PAINTABLE,CHUNKS,create,apply,cellAt,teamAt,coverage,hash,encodeChunk,mergeChunk,encodeFinal,applyFinal,stampOf,blobEdge};
