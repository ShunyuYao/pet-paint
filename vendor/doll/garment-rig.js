import {validateShape} from './data-contract.mjs';
import * as THREE from '../lib/three.module.js';

const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const smooth=(a,b,v)=>{const t=clamp((v-a)/(b-a));return t*t*(3-2*t);};
const FRONT=0,BACK=1,EDGE=2;
export const OUTFITS=[
  {id:'sweater',slot:'top',label:'黑色高领毛衣',edge:'#242326',bodyHalf:.34,reach:1.38,bodySplit:.19,armRow:.37,top:2.98,hem:1.84},
  {id:'tee',slot:'top',label:'宽松浅灰短袖',edge:'#909293',bodyHalf:.37,reach:.81,bodySplit:.28,armRow:.49,armZ:2.48,top:2.94,hem:1.84,short:true},
  {id:'shirt',slot:'top',label:'红黑拼色衬衫',edge:'#252024',bodyHalf:.34,reach:1.38,bodySplit:.17,armRow:.40,top:2.91,hem:1.83},
  {id:'denim',slot:'bottom',label:'经典蓝色牛仔裤',edge:'#506d80',width:.75,length:1.90},
  {id:'shorts',slot:'bottom',label:'宽松深蓝短裤',edge:'#222e46',width:.79,length:.85,short:true},
  {id:'jeans',slot:'bottom',label:'星星喇叭牛仔裤',edge:'#76868b',width:.82,length:1.91,flare:true}
];
const spec=kind=>OUTFITS.find(o=>o.id===kind);
const isTop=kind=>spec(kind).slot==='top';

async function loadPrint(input,face){
  const loader=new THREE.TextureLoader();
  const [map,bumpMap]=await Promise.all([
    loader.loadAsync(input.assets[face]),
    loader.loadAsync(input.assets[face+'Bump'])
  ]);
  map.colorSpace=THREE.SRGBColorSpace;map.magFilter=THREE.NearestFilter;
  bumpMap.colorSpace=THREE.NoColorSpace;
  // The image contour is geometry. Edge texels are extended during asset prep,
  // so no rectangular alpha card or invisible cyan background is needed here.
  return new THREE.MeshStandardMaterial({map,bumpMap,bumpScale:.0025,roughness:.99,metalness:0});
}

function planar(u,v,kind){
  const o=spec(kind);
  if(o.slot==='top'){
    const c=u-.5,a=Math.abs(c),x=Math.sign(c)*(a<o.bodySplit?a/o.bodySplit*o.bodyHalf:o.bodyHalf+(a-o.bodySplit)/(.5-o.bodySplit)*(o.reach-o.bodyHalf));
    const armZ=o.armZ??2.67;
    const z=v<o.armRow?o.top-v/o.armRow*(o.top-armZ):armZ-(v-o.armRow)/(1-o.armRow)*(armZ-o.hem);
    return [x,z];
  }
  const flare=o.flare?1+.12*smooth(.62,.98,v):1;
  return [(u-.5)*o.width*flare,2.025-v*o.length];
}

export function makePattern(data,kind){
  // Limit the derived mesh as well as the input JSON. Dense or overlapping
  // contours must not amplify a small resource into an unbounded GPU mesh.
  const maxVertices=12000,maxTriangles=24000;
  const outline=data.outline.map(([u,v])=>({u,v,p:planar(u,v,kind)}));
  const vertices=outline.map(x=>[x.u,x.v]);
  let triangles=THREE.ShapeUtils.triangulateShape(outline.map(x=>new THREE.Vector2(...x.p)),[]);
  // Split shared edges together. Independently subdividing each triangle makes
  // T-junctions that tear open after skinning even when the flat image looks fine.
  for(let pass=0;pass<9;pass++){
    const midpoints=new Map();
    const edgeKey=(a,b)=>a<b?`${a}:${b}`:`${b}:${a}`;
    for(const tri of triangles)for(let k=0;k<3;k++){
      const a=tri[k],b=tri[(k+1)%3],pa=planar(...vertices[a],kind),pb=planar(...vertices[b],kind);
      if(Math.hypot(pa[0]-pb[0],pa[1]-pb[1])>.072){
        const key=edgeKey(a,b);if(!midpoints.has(key)){midpoints.set(key,vertices.length);vertices.push([(vertices[a][0]+vertices[b][0])/2,(vertices[a][1]+vertices[b][1])/2]);if(vertices.length>maxVertices)throw Error('garment_geometry_budget');}
      }
    }
    if(!midpoints.size)break;
    const next=[];
    for(const [a,b,c] of triangles){
      const ab=midpoints.get(edgeKey(a,b)),bc=midpoints.get(edgeKey(b,c)),ca=midpoints.get(edgeKey(c,a));
      const count=Number(ab!==undefined)+Number(bc!==undefined)+Number(ca!==undefined);
      if(count===0)next.push([a,b,c]);
      else if(count===3)next.push([a,ab,ca],[ab,b,bc],[ca,bc,c],[ab,bc,ca]);
      else if(count===1){
        if(ab!==undefined)next.push([a,ab,c],[ab,b,c]);
        else if(bc!==undefined)next.push([b,bc,a],[bc,c,a]);
        else next.push([c,ca,b],[ca,a,b]);
      }else{
        if(ab===undefined)next.push([c,ca,bc],[a,b,ca],[b,bc,ca]);
        else if(bc===undefined)next.push([a,ab,ca],[b,c,ab],[c,ca,ab]);
        else next.push([b,bc,ab],[c,a,bc],[a,ab,bc]);
      }
    }
    if(next.length>maxTriangles)throw Error('garment_geometry_budget');
    triangles=next;
  }
  if(!triangles.length)throw Error('invalid_garment_contour');
  return {vertices,triangles};
}

function depthAt(data,u,v,kind){
  const d=data.distance,n=d.size;
  const x=clamp(Math.round(u*(n-1)),0,n-1),y=clamp(Math.round(v*(n-1)),0,n-1);
  const pixels=d.pixels[y*n+x];
  const scale=isTop(kind) ? .0024 : .0020;
  let depth=(isTop(kind) ? .065 : .018)+Math.min(isTop(kind) ? .065 : .092,pixels*scale);
  if(kind==='shirt'){
    // Slight relief under the photographed fold-over collar; follows the actual
    // collar placement instead of printing a collar on a generic cylinder.
    for(const center of [.465,.535])depth+=.022*Math.exp(-(((u-center)/.032)**2+((v-.12)/.09)**2));
  }
  return depth;
}

function influences(x,z,kind,index){
  const I=name=>index.get(name);
  if(isTop(kind)){
    const a=Math.abs(x),side=x>0?'Left':'Right';
    const shoulder=kind==='tee' ? smooth(.12,.62,a)*smooth(2.18,2.68,z) : smooth(.18,.46,a)*smooth(2.53,2.67,z);
    const elbow=smooth(.63,.97,a);
    if(shoulder>0)return [[I('upperBody'),1-shoulder],[I(`upper${side}Arm`),shoulder*(1-elbow)],[I(`lower${side}Arm`),shoulder*elbow]];
    const waist=1-smooth(1.93,2.16,z);
    return [[I('upperBody'),1-waist*.55],[I('pelvis'),waist*.55]];
  }
  const hip=1-smooth(1.49,1.84,z),knee=1-smooth(.74,1.08,z);
  // Blend across the crotch instead of abruptly assigning x=0 to one leg.
  // New straight jeans have a lower crotch than V4; a sign switch tears that seam.
  const left=smooth(-.10,.10,x),weights=[[I('pelvis'),1-hip]];
  for(const [side,weight] of [['Left',left],['Right',1-left]]){
    weights.push([I(`upper${side}Leg`),hip*(1-knee)*weight],[I(`lower${side}Leg`),hip*knee*weight]);
  }
  return weights;
}

function buildGeometry(data,kind,doll,index){
  const pattern=makePattern(data,kind),p=[],uv=[],skinIndex=[],skinWeight=[],triangles=[];
  let blendedVertices=0;
  for(const face of [FRONT,BACK])for(const [u,v] of pattern.vertices){
    const [x,z]=planar(u,v,kind),depth=depthAt(data,u,v,kind);
    p.push(x+doll.x,face===FRONT?-depth:depth*.8,z);uv.push(u,1-v);
    const weights=influences(x,z,kind,index).filter(([,w])=>w>1e-6);
    if(weights.length>1)blendedVertices++;
    while(weights.length<4)weights.push([0,0]);
    skinIndex.push(...weights.map(w=>w[0]));skinWeight.push(...weights.map(w=>w[1]));
  }
  const count=pattern.vertices.length,groups=[];
  for(const face of [FRONT,BACK]){
    const start=triangles.length;
    for(const tri of pattern.triangles){
      const [a,b,c]=tri,pa=planar(...pattern.vertices[a],kind),pb=planar(...pattern.vertices[b],kind),pc=planar(...pattern.vertices[c],kind);
      const cross=(pb[0]-pa[0])*(pc[1]-pa[1])-(pb[1]-pa[1])*(pc[0]-pa[0]);
      const order=(cross>0)===(face===FRONT)?[a,b,c]:[a,c,b];
      triangles.push(...order.map(i=>i+face*count));
    }
    groups.push({start,count:triangles.length-start,material:face});
  }
  // Edges used by only one cap triangle form the exact subdivided sewn outline.
  const edges=new Map();
  for(const [a,b,c] of pattern.triangles)for(const [i,j] of [[a,b],[b,c],[c,a]]){
    const key=i<j?`${i}:${j}`:`${j}:${i}`;
    if(edges.has(key))edges.delete(key);else edges.set(key,[i,j]);
  }
  const start=triangles.length;
  for(const [a,b] of edges.values())triangles.push(a,b,a+count,b,b+count,a+count);
  groups.push({start,count:triangles.length-start,material:EDGE});
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(p,3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  geometry.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(skinIndex,4));
  geometry.setAttribute('skinWeight',new THREE.Float32BufferAttribute(skinWeight,4));
  geometry.setIndex(triangles);for(const g of groups)geometry.addGroup(g.start,g.count,g.material);
  geometry.computeVertexNormals();geometry.computeBoundingBox();
  // Connectivity is measured from the actual triangle indices, not a declaration.
  const parents=Array.from({length:p.length/3},(_,i)=>i);
  const find=i=>parents[i]===i?i:(parents[i]=find(parents[i]));
  for(let i=0;i<triangles.length;i+=3)for(let j=1;j<3;j++)parents[find(triangles[i+j])]=find(triangles[i]);
  const components=new Set(parents.map((_,i)=>find(i))).size;
  const checkEdges=[];
  for(let i=0;i<triangles.length;i+=Math.max(3,Math.floor(triangles.length/900/3)*3)){
    const a=triangles[i],b=triangles[i+1],length=Math.hypot(p[a*3]-p[b*3],p[a*3+1]-p[b*3+1],p[a*3+2]-p[b*3+2]);
    if(length>.012)checkEdges.push({a,b,length});
  }
  return {geometry,blendedVertices,components,checkEdges};
}

export async function createGarments(doll,scene,draggable){
  const names=doll.bodies.map(b=>b.dollPartName),index=new Map(names.map((n,i)=>[n,i]));
  const bones=doll.bodies.map(body=>{const bone=new THREE.Bone();bone.name=body.dollPartName;bone.position.copy(body.position);bone.quaternion.copy(body.quaternion);scene.add(bone);bone.updateMatrixWorld(true);return bone;});
  const skeleton=new THREE.Skeleton(bones),items=[];
  const selection={top:doll.garmentInputs.top.kind,bottom:doll.garmentInputs.bottom.kind};
  const bindMatrix=new THREE.Matrix4();
  const all=await Promise.all(Object.values(doll.garmentInputs).map(async input=>{
    const kind=input.kind,outfit=spec(kind);
    const [front,back,data]=await Promise.all([loadPrint(input,'front'),loadPrint(input,'back'),(typeof input.assets.shape==='string'?fetch(input.assets.shape).then(r=>{if(!r.ok)throw Error('Missing garment contour');return r.json();}):Promise.resolve(input.assets.shape)).then(validateShape)]);
    const edge=new THREE.MeshStandardMaterial({color:outfit.edge,roughness:1,metalness:0,side:THREE.DoubleSide});
    const built=buildGeometry(data,kind,doll,index);
    const mesh=new THREE.SkinnedMesh(built.geometry,[front,back,edge]);
    mesh.name=kind;mesh.bind(skeleton,bindMatrix);mesh.castShadow=mesh.receiveShadow=true;
    mesh.frustumCulled=false;mesh.userData={doll,garment:true,body:doll.parts[isTop(kind)?'upperBody':'pelvis']};
    mesh.visible=false;scene.add(mesh);return {...built,mesh,kind,data,outfit};
  }));
  function select(slot,id){
    const next=all.find(item=>item.kind===id&&item.outfit.slot===slot);
    if(!next)throw Error('Unknown outfit selection');
    selection[slot]=id;
    for(const item of all){
      const active=selection[item.outfit.slot]===item.kind;
      item.mesh.visible=active;
      const i=draggable.indexOf(item.mesh);
      if(active&&i<0)draggable.push(item.mesh);else if(!active&&i>=0)draggable.splice(i,1);
    }
    items.splice(0,items.length,...['top','bottom'].map(s=>all.find(item=>item.kind===selection[s])));
    doll.wardrobe.shirt=items[0].mesh.material[0];doll.wardrobe.trousers=items[1].mesh.material[0];
    for(const body of doll.bodies)for(const mesh of body.visual.children){
      // The loose tee covers the upper arm. Rendering its hidden skin cylinder
      // as well lets it poke through the blended shoulder when the arm lifts.
      if(mesh.userData.exposedLimb)mesh.visible=!!spec(selection[mesh.userData.exposedLimb]).short&&!body.dollPartName.match(/^upper.*Arm$/);
    }
  }
  select('top',selection.top);
  function update(){
    bones.forEach((bone,i)=>{bone.position.copy(doll.bodies[i].position);bone.quaternion.copy(doll.bodies[i].quaternion);bone.updateMatrixWorld(true);});
    skeleton.update();
  }
  // Rendering is uncullable; calculate exact animated bounds only when picking,
  // avoiding a CPU reskin of every vertex on every frame.
  function refreshBounds(){for(const {mesh} of items)mesh.computeBoundingSphere();}
  update();refreshBounds();
  function pickBody(point){
    let best=doll.parts.upperBody,distance=Infinity;
    for(const body of doll.bodies){if(body.dollPartName==='head')continue;
      const local=body.pointToLocalFrame(body.position.clone().copy(point));
      const half=body.shapes[0].halfExtents;
      const d=half?Math.hypot(Math.max(0,Math.abs(local.x)-half.x),Math.max(0,Math.abs(local.y)-half.y),Math.max(0,Math.abs(local.z)-half.z)):Infinity;
      if(d<distance){distance=d;best=body;}
    }return best;
  }
  function snapshot(){
    const maxBoneError=Math.max(...bones.map((bone,i)=>{
      const body=doll.bodies[i],q=body.quaternion;
      return Math.max(bone.position.distanceTo(new THREE.Vector3(body.position.x,body.position.y,body.position.z)),bone.quaternion.angleTo(new THREE.Quaternion(q.x,q.y,q.z,q.w)));
    }));
    const a=new THREE.Vector3(),b=new THREE.Vector3();
    const info=items.map(item=>{
      let maxEdgeStretch=0,finite=true;
      for(const edge of item.checkEdges){item.mesh.getVertexPosition(edge.a,a);item.mesh.getVertexPosition(edge.b,b);finite&&=[...a,...b].every(Number.isFinite);maxEdgeStretch=Math.max(maxEdgeStretch,a.distanceTo(b)/edge.length);}
      return {kind:item.kind,slot:item.outfit.slot,type:item.mesh.type,vertexCount:item.geometry.attributes.position.count,blendedVertices:item.blendedVertices,components:item.components,maxBoneError,maxEdgeStretch,finite};
    });
    const mapInfo=mat=>({source:mat.map.image.src,width:mat.map.image.width,height:mat.map.image.height,bumpWidth:mat.bumpMap.image.width,roughness:mat.roughness,metalness:mat.metalness,nearestMagnification:mat.map.magFilter===THREE.NearestFilter});
    function rowWidth(kind,v){
      const points=items.find(g=>g.kind===kind).data.outline,cross=[];
      for(let i=0;i<points.length;i++){
        const a=points[i],b=points[(i+1)%points.length];
        if((a[1]<=v&&b[1]>v)||(a[1]>v&&b[1]<=v))cross.push(a[0]+(v-a[1])/(b[1]-a[1])*(b[0]-a[0]));
      }
      cross.sort((a,b)=>a-b);let sum=0;
      for(let i=0;i+1<cross.length;i+=2)sum+=planar(cross[i+1],v,kind)[0]-planar(cross[i],v,kind)[0];
      return sum/(isTop(kind)?1:2);
    }
    return {selection:{...selection},cachedGarments:all.length,activePickTargets:all.filter(item=>draggable.includes(item.mesh)).length,exposedLimbs:doll.bodies.flatMap(b=>b.visual.children).filter(m=>m.userData.exposedLimb&&m.visible).length,shirt:mapInfo(items[0].mesh.material[0]),trousers:mapInfo(items[1].mesh.material[0]),garments:info,shape:{shirtWidth:rowWidth(selection.top,.70),hemWidth:rowWidth(selection.bottom,.94),kneeWidth:rowWidth(selection.bottom,.58),sleeveReach:(items[0].geometry.boundingBox.max.x-items[0].geometry.boundingBox.min.x)/2,trouserHemZ:items[1].geometry.boundingBox.min.z}};
  }
  return {items,update,refreshBounds,snapshot,pickBody,select};
}
