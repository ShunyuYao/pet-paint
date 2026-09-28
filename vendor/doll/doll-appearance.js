import * as THREE from '../lib/three.module.js';
import { makePhotoHead } from './photo-head.js';

// Keep the original fine weave on the photo head and skin. The new wardrobe
// uses generated print maps; it must not emboss stars/checkers into the faces.
const weaveCanvas=document.createElement('canvas');
weaveCanvas.width=weaveCanvas.height=128;
const ctx=weaveCanvas.getContext('2d');
ctx.fillStyle='#dedede';ctx.fillRect(0,0,128,128);
for(let y=0;y<128;y+=4)for(let x=0;x<128;x+=4){
  ctx.fillStyle=(x+y)%8?'#f4f4f4':'#bdbdbd';ctx.fillRect(x,y,3,1);
  ctx.fillStyle='#b4b4b4';ctx.fillRect(x,y+1,1,3);
}
const cloth=new THREE.CanvasTexture(weaveCanvas);
cloth.wrapS=cloth.wrapT=THREE.RepeatWrapping;cloth.repeat.set(2,3);cloth.colorSpace=THREE.SRGBColorSpace;
const bump=cloth.clone();bump.colorSpace=THREE.NoColorSpace;bump.needsUpdate=true;
const material=color=>new THREE.MeshStandardMaterial({color,map:cloth,bumpMap:bump,bumpScale:.008,roughness:.94,metalness:0});


export function createWardrobe(id){
  return {shirt:material('#252024'),trousers:material('#76868b'),headBump:bump,
    skin:material(id==='female'?'#d8ac96':'#c69a80'),shoes:material('#302b33'),hair:material('#211b1b')};
}

function paddedBall(group,mat,position,scale){
  const mesh=new THREE.Mesh(new THREE.SphereGeometry(1,20,14),mat);
  mesh.position.set(...position);mesh.scale.set(...scale);mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);return mesh;
}

export function dressPart(body,doll,draggable){
  const group=new THREE.Group(),name=body.dollPartName,m=doll.wardrobe;
  function pickable(mesh){mesh.userData.body=body;mesh.userData.doll=doll;draggable.push(mesh);return mesh;}
  if(name==='head'){
    const head=makePhotoHead(doll.texture,m);
    // Seat the same photo head above the new fold-over collar. Physical body unchanged.
    head.position.z=doll.id==='female' ? .20 : .26;group.add(head);pickable(head);
    paddedBall(group,m.skin,[0,-.01,-.08],[.075,.065,.22]);
  } else if(name.startsWith('lower')&&name.includes('Arm')){
    const sign=name.includes('Left')?1:-1,length=body.shapes[0].halfExtents.x*2;
    pickable(paddedBall(group,m.skin,[sign*(length/2+.025),-.008,0],[.12,.06,.087]));
  } else if(name.startsWith('lower')&&name.includes('Leg')){
    const length=body.shapes[0].halfExtents.z*2;
    pickable(paddedBall(group,m.shoes,[0,-.045,-length/2+.015],[.113,.155,.088]));
  }
  if(name.includes('Arm')||name.includes('Leg')){
    const arm=name.includes('Arm'),half=body.shapes[0].halfExtents;
    // A small fabric skin limb under the short garment; no new physical body.
    // Rounded cylinder ends overlap at the original elbow/knee joint.
    const radius=arm?.055:.065,length=arm?half.x*2:half.z*2;
    const geometry=new THREE.CylinderGeometry(radius*.92,radius,length,16,1);
    const limb=new THREE.Mesh(geometry,m.skin);
    limb.rotation[arm?'z':'x']=Math.PI/2;limb.castShadow=limb.receiveShadow=true;group.add(limb);
    limb.userData.exposedLimb=arm?'top':'bottom';limb.visible=false;pickable(limb);
    for(const sign of [-1,1]){
      const position=arm?[sign*length/2,0,0]:[0,0,sign*length/2];
      const cap=paddedBall(group,m.skin,position,[radius,radius,radius]);
      cap.userData.exposedLimb=arm?'top':'bottom';cap.visible=false;pickable(cap);
    }
  }
  return group;
}

export function clothingSnapshot(doll){return doll.garments.snapshot();}
