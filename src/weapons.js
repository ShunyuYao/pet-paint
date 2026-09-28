// Weapon props, procedural. Built pointing along +Z from the grip; `color` is the team ink.
import * as THREE from '../vendor/lib/three.module.js';

const mat=(c,o={})=>new THREE.MeshStandardMaterial({color:c,roughness:.45,metalness:.05,...o});
function mesh(g,m,{p=[0,0,0],r=[0,0,0],s=[1,1,1]}={}){const o=new THREE.Mesh(g,m);o.position.set(...p);o.rotation.set(...r);o.scale.set(...s);o.castShadow=true;return o;}

// 喷壶: a spray bottle with a trigger and a translucent ink tank.
function sprayer(size,color){
  const g=new THREE.Group(),ink=mat(color,{roughness:.25}),shell=mat('#f4f1ea'),dark=mat('#3a3346');
  const tank=mesh(new THREE.CylinderGeometry(.16,.18,.42,18),mat(color,{transparent:true,opacity:.85,roughness:.2}),{p:[0,.02,-.05]});
  const head=mesh(new THREE.BoxGeometry(.2,.16,.34),shell,{p:[0,.3,.08]});
  const nozzle=mesh(new THREE.CylinderGeometry(.035,.05,.2,10),dark,{p:[0,.3,.34],r:[Math.PI/2,0,0]});
  const trig=mesh(new THREE.BoxGeometry(.05,.16,.05),ink,{p:[0,.17,.16],r:[.4,0,0]});
  g.add(tank,head,nozzle,trig);g.scale.setScalar(size);g.userData.muzzle=new THREE.Vector3(0,.3,.46).multiplyScalar(size);
  return g;
}
// 滚刷: a paint roller on a handle, drum soaked in team ink.
function roller(size,color){
  const g=new THREE.Group(),ink=mat(color,{roughness:.6}),metal=mat('#c9cbd6',{metalness:.6,roughness:.3}),grip=mat('#3a3346');
  const handle=mesh(new THREE.CylinderGeometry(.035,.035,.9,10),metal,{p:[0,.1,.35],r:[Math.PI/2.6,0,0]});
  const hand=mesh(new THREE.CylinderGeometry(.06,.06,.26,12),grip,{p:[0,-.1,-.05],r:[Math.PI/2.6,0,0]});
  const drum=mesh(new THREE.CylinderGeometry(.2,.2,1.1,20),ink,{p:[0,-.08,.82],r:[0,0,Math.PI/2]});
  g.add(handle,hand,drum);g.scale.setScalar(size);g.userData.muzzle=new THREE.Vector3(0,-.08,.82).multiplyScalar(size);g.userData.drum=drum;
  return g;
}
export function makeWeapon(kind,size,color){return kind==='roller'?roller(size,color):sprayer(size,color);}
