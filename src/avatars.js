// Player bodies (SPEC §9). Three kinds share one interface:
//   const a = await buildAvatar(asset, fallback, {height, weapon, color, clip});
//   a.object — THREE.Group, feet at the origin, faces +Z at yaw 0;
//   a.update(dt, P) — P = {yaw, run, runPhase, aim, sink, visible, alpha, flash};
//   a.setWeapon(kind, color).
// - doll3d: the pet-ragdoll-renderer rig (photo head + skinned garments), posed kinematically;
// - sprite: the desktop pet's picture as a standee facing the camera;
// - toy: a small procedural mascot (computer players, plain browsers).
// Diving works the same for all three: the body sinks and a clipping plane at the ink
// surface hides whatever is below it (`clip`, shared by every avatar material).
// Presentation only: the simulation never reads anything from here.
// Doll posing adapted from pet-brawl/src/avatars.js (same rig contract).
import * as THREE from '../vendor/lib/three.module.js';
import * as CANNON from '../vendor/lib/cannon-es.js';
import {createRagdoll} from '../vendor/doll/ragdoll-adapter.js';
import {createWardrobe,dressPart} from '../vendor/doll/doll-appearance.js';
import {createGarments} from '../vendor/doll/garment-rig.js';
import {makeWeapon} from './weapons.js';

const V=(x=0,y=0,z=0)=>new CANNON.Vec3(x,y,z);
const axisQ=(axis,angle)=>{const q=new CANNON.Quaternion();q.setFromAxisAngle(axis,angle);return q;};
const X=V(1,0,0);
const add=(a,b)=>{const r=new CANNON.Vec3();a.vadd(b,r);return r;};
const sub=(a,b)=>{const r=new CANNON.Vec3();a.vsub(b,r);return r;};
const scale=(a,s)=>{const r=new CANNON.Vec3();a.scale(s,r);return r;};
const norm=v=>{const r=v.clone();const l=r.length();if(l>1e-9)r.scale(1/l,r);return r;};
const between=(from,to)=>{const q=new CANNON.Quaternion();q.setFromVectors(norm(from),norm(to));return q;};
async function loadTexture(url){const t=await new THREE.TextureLoader().loadAsync(url);t.colorSpace=THREE.SRGBColorSpace;return t;}
// Game yaw (direction (cos θ, sin θ) on the x/z floor) → three.js rotation.y for a +Z-facing body.
export const yawToRotation=yaw=>Math.atan2(Math.cos(yaw),Math.sin(yaw));
function clipAll(root,clip){root.traverse(o=>{if(!o.isMesh)return;for(const m of [].concat(o.material)){m.clippingPlanes=[clip];m.clipShadows=true;m.transparent=true;}});}
function materialsOf(root){const out=[];root.traverse(o=>{if(o.isMesh)for(const m of [].concat(o.material))if(!out.includes(m))out.push(m);});return out;}

// The weapon is built along +Z; a pivot turns it so it can be aimed along any direction.
function weaponPivot(kind,size,color){const pivot=new THREE.Group(),w=makeWeapon(kind,size,color);pivot.add(w);return {pivot,weapon:w};}

// ---------- 3D doll ----------
// Rig frame: z up, facing −Y. Both hands hold the weapon out in front, pointing forward.
function aimPose(doll,P){
  const B=doll.parts,place=(name,p,r)=>{B[name].position.copy(p);B[name].quaternion.copy(r);};
  const q=axisQ(X,(P.lean||0));
  const pelvis=V(0,0,1.86-(P.crouch||0)*0.5);
  place('pelvis',pelvis,q);
  const upper=add(pelvis,q.vmult(V(0,0,.49)));place('upperBody',upper,q);
  const shoulder=add(upper,q.vmult(V(0,0,.35))),head=add(shoulder,q.vmult(V(0,0,.35)));
  place('head',head,q.mult(axisQ(X,-0.1)));
  for(const [side,sign] of [['Left',1],['Right',-1]]){
    const swing=(P.run||0)*Math.sin((P.runPhase||0)+(sign>0?0:Math.PI))*0.7;
    const thigh=-(P.crouch||0)*0.95+swing,bend=(P.crouch||0)*1.7+Math.max(0,-swing)*0.8;
    const hip=add(pelvis,q.vmult(V(sign*.18,0,-.14))),lq=q.mult(axisQ(X,thigh)),kq=q.mult(axisQ(X,thigh+bend));
    place('upper'+side+'Leg',add(hip,lq.vmult(V(0,0,-.42))),lq);
    const knee=add(hip,lq.vmult(V(0,0,-.84)));place('lower'+side+'Leg',add(knee,kq.vmult(V(0,0,-.39))),kq);
  }
  const dir=V(0,-1,0.05*(P.aim?0:-4));
  const grip=add(shoulder,add(V(0,-0.34,-0.3),scale(norm(dir),P.aim?0.38:0.22)));
  for(const [side,sign] of [['Left',1],['Right',-1]]){
    const hand=add(grip,V(sign*0.08,sign>0?-0.12:0,0));
    const joint=add(shoulder,q.vmult(V(sign*.36,-.10,0)));
    const reach=sub(hand,joint),elbowDir=norm(add(norm(reach),V(sign*0.5,0,-0.4)));
    place('upper'+side+'Arm',add(joint,scale(elbowDir,.31)),between(V(sign,0,0),elbowDir));
    const elbow=add(joint,scale(elbowDir,.62)),lowerDir=norm(sub(hand,elbow));
    place('lower'+side+'Arm',add(elbow,scale(lowerDir,.29)),between(V(sign,0,0),lowerDir));
  }
  return {grip,dir:norm(dir)};
}
const _m=new THREE.Matrix4(),_d=new THREE.Vector3(),_s=new THREE.Vector3(1,0,0),_z=new THREE.Vector3(),_x=new THREE.Vector3();
function orientY(obj,dir){_d.copy(dir).normalize();_x.set(1,0,0);_z.crossVectors(_x,_d).normalize();_x.crossVectors(_d,_z);_m.makeBasis(_x,_d,_z);obj.quaternion.setFromRotationMatrix(_m);}

async function dollAvatar(asset,{height,weapon,color,clip}){
  const holder=new THREE.Group(),body=new THREE.Group(),rig=new THREE.Group();
  const texture=await loadTexture(asset.head);
  const garments={};
  for(const slot of ['top','bottom']){const g=asset.garments[slot];garments[slot]={kind:g.kind,assets:{front:g.front,back:g.back,frontBump:g.frontBump,backBump:g.backBump,shape:g.shape}};}
  const doll={id:asset.person,x:0,texture,garmentInputs:garments,wardrobe:createWardrobe(asset.person),...createRagdoll({angle:Math.PI*.62,angleShoulders:Math.PI*.8,twistAngle:Math.PI/3})};
  const picks=[];
  for(const b of doll.bodies){b.visual=dressPart(b,doll,picks);rig.add(b.visual);}
  doll.garments=await createGarments(doll,rig,picks);
  const photo=doll.parts.head.visual.children.find(o=>o.userData.photoHead);
  if(photo&&asset.headScale!==1){
    const pos=photo.geometry.attributes.position,half=(photo.geometry.boundingBox.max.x-photo.geometry.boundingBox.min.x)*.025;let chin=Infinity;
    for(let i=0;i<pos.count;i++)if(Math.abs(pos.getX(i))<half)chin=Math.min(chin,pos.getY(i));
    const c=new THREE.Vector3(0,chin,0),anchor=c.clone().applyQuaternion(photo.quaternion).add(photo.position);
    photo.scale.setScalar(asset.headScale);photo.position.copy(anchor).sub(c.clone().multiplyScalar(asset.headScale).applyQuaternion(photo.quaternion));
  }
  // The weapon pivot lives in rig space (z up); weapon +Z → pivot +Y, then +Y is aimed along dir.
  let wp=weaponPivot(weapon,1.7,color);wp.weapon.rotation.x=-Math.PI/2;rig.add(wp.pivot);
  rig.rotation.x=-Math.PI/2;rig.scale.setScalar(height*1.3/2.75);
  body.add(rig);holder.add(body);clipAll(holder,clip);
  let mats=materialsOf(holder);const dirV=new THREE.Vector3();
  return {kind:'doll3d',object:holder,height,
    setWeapon(kind,c){rig.remove(wp.pivot);wp=weaponPivot(kind,1.7,c);wp.weapon.rotation.x=-Math.PI/2;rig.add(wp.pivot);clipAll(wp.pivot,clip);mats=materialsOf(holder);},
    update(dt,P){
      holder.rotation.y=yawToRotation(P.yaw);body.position.y=-(P.sink||0)*height*1.42;
      const {grip,dir}=aimPose(doll,P);wp.pivot.visible=(P.sink||0)<0.4;
      for(const b of doll.bodies){b.visual.position.copy(b.position);b.visual.quaternion.copy(b.quaternion);}
      doll.garments.update();
      wp.pivot.position.set(grip.x,grip.y,grip.z);dirV.set(dir.x,dir.y,dir.z);orientY(wp.pivot,dirV);
      for(const m of mats){m.opacity=P.alpha??1;if(m.emissive)m.emissive.setScalar((P.flash||0)*0.6);}
      holder.visible=P.visible!==false;
    },
    dispose(){texture.dispose();}};
}

// ---------- 2D standee ----------
// A plane that always faces the camera (the camera never turns), tilted back a little so the
// picture reads from above. Pictures face left by default: mirror when aiming to the right.
async function spriteAvatar(asset,{height,weapon,color,clip}){
  const textures=await Promise.all(asset.frames.map(loadTexture));
  const h=height*1.1,w=Math.min(h*2,h*asset.aspect);
  const mat=new THREE.MeshStandardMaterial({map:textures[0],transparent:true,alphaTest:.05,side:THREE.DoubleSide,roughness:.9});
  const plane=new THREE.Mesh(new THREE.PlaneGeometry(w,h),mat);plane.position.y=h/2;
  const holder=new THREE.Group(),body=new THREE.Group(),stand=new THREE.Group();
  stand.rotation.x=-0.32;stand.add(plane);body.add(stand);holder.add(body);
  let wp=weaponPivot(weapon,height*0.5,color);wp.pivot.position.set(0,h*0.4,0.25);body.add(wp.pivot);
  clipAll(holder,clip);let mats=materialsOf(holder);
  let clock=0;
  return {kind:'sprite',object:holder,height,
    setWeapon(kind,c){body.remove(wp.pivot);wp=weaponPivot(kind,height*0.5,c);wp.pivot.position.set(0,h*0.4,0.25);body.add(wp.pivot);clipAll(wp.pivot,clip);mats=materialsOf(holder);},
    update(dt,P){
      clock+=dt;if(asset.fps>0&&textures.length>1){const f=Math.floor(clock*asset.fps)%textures.length;if(mat.map!==textures[f])mat.map=textures[f];}
      const dx=Math.cos(P.yaw),flip=dx>0.05?-1:1;
      const bob=(P.run||0)*Math.abs(Math.sin((P.runPhase||0)))*0.08*h;
      stand.scale.set(flip*(1+(P.run||0)*0.03),1-(P.run||0)*0.04+Math.sin(clock*3)*0.01,1);
      stand.rotation.z=-(P.run||0)*0.08*(dx>0?1:-1)*(Math.sin(P.runPhase||0)>0?1:0.4);
      stand.position.y=bob;body.position.y=-(P.sink||0)*h;
      wp.pivot.rotation.set(0,yawToRotation(P.yaw),0);wp.pivot.visible=(P.sink||0)<0.4;wp.pivot.position.x=Math.cos(P.yaw)*w*0.22;
      for(const m of mats){m.opacity=P.alpha??1;if(m.emissive)m.emissive.setScalar((P.flash||0)*0.7);}
      holder.visible=P.visible!==false;
    },
    dispose(){textures.forEach(t=>t.dispose());mat.dispose();}};
}

// ---------- toy mascot ----------
export const TOY_SPECIES=['mouse','cat','bunny'];
function toyAvatar(asset,{height,weapon,color,clip}){
  const holder=new THREE.Group(),body=new THREE.Group(),inner=new THREE.Group();
  const c=new THREE.Color(asset.color||'#ffc93c'),mat=col=>new THREE.MeshStandardMaterial({color:col,roughness:.7});
  const fur=mat(c),light=mat(c.clone().lerp(new THREE.Color('#ffffff'),.55)),dark=mat('#2a2230'),pink=mat('#ff9fb8');
  const ball=(r,m,p,s=[1,1,1],parent=inner)=>{const o=new THREE.Mesh(new THREE.SphereGeometry(r,24,16),m);o.position.set(...p);o.scale.set(...s);o.castShadow=true;parent.add(o);return o;};
  ball(.42,fur,[0,.62,0],[1,1.1,.9]);ball(.3,light,[0,.58,.25],[1,1.1,.5]);
  const head=new THREE.Group();head.position.set(0,1.28,0);inner.add(head);
  ball(.42,fur,[0,0,0],[1.08,.95,1],head);ball(.07,dark,[-.15,.05,.37],undefined,head);ball(.07,dark,[.15,.05,.37],undefined,head);ball(.045,pink,[0,-.06,.41],undefined,head);
  const sp=asset.species||'mouse';
  if(sp==='mouse'){ball(.2,fur,[-.3,.34,0],[1,1,.35],head);ball(.2,fur,[.3,.34,0],[1,1,.35],head);}
  if(sp==='cat')for(const s of [-1,1]){const e=new THREE.Mesh(new THREE.ConeGeometry(.14,.28,4),fur);e.position.set(s*.24,.38,0);e.rotation.z=-s*.35;head.add(e);}
  if(sp==='bunny')for(const s of [-1,1]){const e=ball(.1,fur,[s*.14,.55,-.02],[.9,2.6,.6],head);e.rotation.z=-s*.15;}
  const feet=[-1,1].map(s=>ball(.13,fur,[s*.18,.1,.05],[1,.7,1.3]));
  const k=height/1.75;inner.scale.setScalar(k);body.add(inner);holder.add(body);
  let wp=weaponPivot(weapon,height*0.5,color);wp.pivot.position.set(.3*k,.62*k,.35*k);body.add(wp.pivot);
  clipAll(holder,clip);let mats=materialsOf(holder);
  return {kind:'toy',object:holder,height,
    setWeapon(kind,col){body.remove(wp.pivot);wp=weaponPivot(kind,height*0.5,col);wp.pivot.position.set(.3*k,.62*k,.35*k);body.add(wp.pivot);clipAll(wp.pivot,clip);mats=materialsOf(holder);},
    update(dt,P){
      holder.rotation.y=yawToRotation(P.yaw);body.position.y=-(P.sink||0)*height;
      inner.position.y=(P.run||0)*Math.abs(Math.sin(P.runPhase||0))*0.08*height;
      inner.rotation.x=(P.run||0)*0.12;wp.pivot.visible=(P.sink||0)<0.4;
      feet.forEach((f,i)=>{f.position.z=.05+Math.sin((P.runPhase||0)+i*Math.PI)*.18*(P.run||0);});
      for(const m of mats){m.opacity=P.alpha??1;if(m.emissive)m.emissive.setScalar((P.flash||0)*0.6);}
      holder.visible=P.visible!==false;
    },dispose(){}};
}

export async function buildAvatar(asset,fallback,opts){
  try{
    if(asset?.kind==='doll3d')return await dollAvatar(asset,opts);
    if(asset?.kind==='sprite')return await spriteAvatar(asset,opts);
  }catch(e){
    console.warn('avatar fallback',e);
    if(fallback)return buildAvatar(fallback,null,opts);
  }
  return toyAvatar(asset?.kind==='toy'?asset:{species:'mouse',color:'#ffc93c'},opts);
}
