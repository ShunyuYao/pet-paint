// The 3D view (SPEC §9): desk floor with the paint grid shaded as glossy ink, desk props as
// cover, players, shots, and a camera that follows your pet from a 50° angle.
// Reads the simulation, never writes it.
import * as THREE from '../vendor/lib/three.module.js';
import Paint from '../game/paint.cjs';
import Arena from '../game/arena.cjs';
import Config from '../game/config.cjs';
import {buildAvatar} from './avatars.js';

const TEAM_COLORS=Config.TEAMS.map(t=>new THREE.Color(t.color));
const PET_HEIGHT=1.25,PITCH=50*Math.PI/180,CAM_DIST=15;

const FLOOR_VS=`varying vec2 vUv;varying vec3 vWorld;
void main(){vUv=uv;vec4 w=modelMatrix*vec4(position,1.0);vWorld=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}`;
// Ink = the grid texture (R = orange owns the cell, G = blue) sampled with linear filtering
// and thresholded with a little noise, so cell edges become rounded paint blobs. A height
// field from the same samples gives the ink its thickness and highlight.
const FLOOR_FS=`uniform sampler2D paintTex;uniform vec2 texel;uniform vec3 colA;uniform vec3 colB;uniform vec3 camPos;uniform float time;
varying vec2 vUv;varying vec3 vWorld;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),u.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x),u.y);}
// 3×3 tent blur of the owner masks: rounds the cell staircase into smooth blob outlines.
vec2 inkAt(vec2 uv){
  vec2 s=texture2D(paintTex,uv).rg*4.0;
  s+=(texture2D(paintTex,uv+vec2(texel.x,0.0)).rg+texture2D(paintTex,uv-vec2(texel.x,0.0)).rg+texture2D(paintTex,uv+vec2(0.0,texel.y)).rg+texture2D(paintTex,uv-vec2(0.0,texel.y)).rg)*2.0;
  s+=texture2D(paintTex,uv+texel).rg+texture2D(paintTex,uv-texel).rg+texture2D(paintTex,uv+vec2(texel.x,-texel.y)).rg+texture2D(paintTex,uv+vec2(-texel.x,texel.y)).rg;
  return s/16.0;}
void main(){
  float n=(noise(vWorld.xz*2.1)-0.5)*0.22+(noise(vWorld.xz*6.5)-0.5)*0.1;
  vec2 k=inkAt(vUv);
  float a=smoothstep(0.44,0.56,k.r+n),b=smoothstep(0.44,0.56,k.g+n);
  // desk: warm light wood with soft grain
  float grain=noise(vec2(vWorld.x*0.35,vWorld.z*4.5))*0.6+noise(vWorld.xz*1.2)*0.4;
  vec3 wood=mix(vec3(0.86,0.74,0.58),vec3(0.78,0.64,0.47),grain);
  vec3 L=normalize(vec3(-0.35,1.0,0.45));
  // Ink thickness: a soft height field; its screen-space slope gives the normal (no extra taps).
  float h=smoothstep(0.3,0.75,max(k.r,k.g)+n);
  vec3 dx=dFdx(vec3(vWorld.x,h*0.08,vWorld.z)),dz=dFdy(vec3(vWorld.x,h*0.08,vWorld.z));
  vec3 N=normalize(cross(dz,dx));if(N.y<0.0)N=-N;
  vec3 V=normalize(camPos-vWorld);
  float diff=clamp(dot(N,L),0.0,1.0);
  float spec=pow(clamp(dot(reflect(-L,N),V),0.0,1.0),36.0);
  float ink=max(a,b);vec3 ic=a>=b?colA:colB;
  vec3 col=wood*0.96;
  vec3 inkCol=ic*(0.72+0.38*diff)+vec3(spec*0.5);
  col=mix(col,inkCol,ink);
  gl_FragColor=vec4(col,1.0);
  #include <colorspace_fragment>
}`;

function makeProps(scene){
  const group=new THREE.Group();const mat=(c,o={})=>new THREE.MeshStandardMaterial({color:c,roughness:.6,...o});
  const add=(g,m,p,r=[0,0,0])=>{const o=new THREE.Mesh(g,m);o.position.set(...p);o.rotation.set(...r);o.castShadow=true;o.receiveShadow=true;group.add(o);return o;};
  for(const o of Arena.OBSTACLES){
    if(o.kind==='disc'){ // mug
      const m=mat(o.x<0?'#f7c948':'#8bd3c7');add(new THREE.CylinderGeometry(o.r,o.r*0.92,o.h,28),m,[o.x,o.h/2,o.z]);
      add(new THREE.CylinderGeometry(o.r*0.84,o.r*0.84,0.02,28),mat('#5a3a24'),[o.x,o.h-0.05,o.z]);
      add(new THREE.TorusGeometry(o.r*0.45,0.09,10,20),m,[o.x+(o.x<0?-1:1)*o.r*1.05,o.h*0.5,o.z],[0,o.x<0?0:Math.PI,0]);
      continue;
    }
    const w=o.x1-o.x0,d=o.z1-o.z0,cx=(o.x0+o.x1)/2,cz=(o.z0+o.z1)/2;
    if(o.look==='laptop'){ // a closed laptop lying on the desk: low cover, never hides players
      const alu=mat('#c9ced8',{metalness:.45,roughness:.32});
      add(new THREE.BoxGeometry(w,o.h*0.55,d),alu,[cx,o.h*0.275,cz]);
      add(new THREE.BoxGeometry(w*0.98,o.h*0.4,d*0.98),mat('#b7bdc9',{metalness:.45,roughness:.3}),[cx,o.h*0.75,cz]);
      add(new THREE.CylinderGeometry(0.28,0.28,0.02,24),mat('#eef1f6',{metalness:.6,roughness:.2}),[cx,o.h*0.96,cz]);
    }else if(o.look==='books'){
      const colors=['#e8505b','#4f86f7','#f6c85f','#6cc070'];let y=0;const n=3;
      for(let i=0;i<n;i++){const h=o.h/n;add(new THREE.BoxGeometry(w*(1-i*0.06),h*0.96,d*(1-i*0.05)),mat(colors[(i+Math.round(cx))&3]),[cx+(i-1)*0.08,y+h/2,cz]);y+=h;}
    }else if(o.look==='pencil'){
      const r=d/2;add(new THREE.CylinderGeometry(r,r,w*0.86,6),mat('#f5b82e'),[cx-w*0.07,r,cz],[0,0,Math.PI/2]);
      add(new THREE.ConeGeometry(r,w*0.14,6),mat('#e9d3b0'),[cx+w*0.43,r,cz],[0,0,-Math.PI/2]);
    }else add(new THREE.BoxGeometry(w,o.h,d),mat('#bbb'),[cx,o.h/2,cz]);
  }
  // Spawn pads
  for(const b of Arena.BASES){
    const w=b.x1-b.x0,d=b.z1-b.z0;const pad=new THREE.Mesh(new THREE.PlaneGeometry(w-0.2,d-0.2),new THREE.MeshBasicMaterial({color:TEAM_COLORS[b.team],transparent:true,opacity:.22,depthWrite:false}));
    pad.rotation.x=-Math.PI/2;pad.position.set((b.x0+b.x1)/2,0.015,(b.z0+b.z1)/2);group.add(pad);
  }
  scene.add(group);
}

export function createWorld(canvas){
  const renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.5));renderer.localClippingEnabled=true;
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  const scene=new THREE.Scene();scene.background=new THREE.Color('#f3e6d4');
  const camera=new THREE.PerspectiveCamera(38,1,0.5,200);
  scene.add(new THREE.HemisphereLight('#fff6e8','#b99a78',1.6));
  const sun=new THREE.DirectionalLight('#ffffff',1.7);sun.position.set(-8,18,10);sun.castShadow=true;
  sun.shadow.mapSize.set(1024,1024);Object.assign(sun.shadow.camera,{left:-16,right:16,top:12,bottom:-12,near:1,far:50});scene.add(sun);
  // Desk under the arena (a little larger, with a lip) and the painted floor on top.
  const desk=new THREE.Mesh(new THREE.BoxGeometry(Arena.HALF_X*2+2.4,1,Arena.HALF_Z*2+2.4),new THREE.MeshStandardMaterial({color:'#b98a5e',roughness:.8}));desk.position.y=-0.51;desk.receiveShadow=true;scene.add(desk);
  const data=new Uint8Array(Paint.COLS*Paint.ROWS*4);
  const paintTex=new THREE.DataTexture(data,Paint.COLS,Paint.ROWS,THREE.RGBAFormat);
  paintTex.magFilter=THREE.LinearFilter;paintTex.minFilter=THREE.LinearFilter;paintTex.needsUpdate=true;
  const floorMat=new THREE.ShaderMaterial({vertexShader:FLOOR_VS,fragmentShader:FLOOR_FS,uniforms:{paintTex:{value:paintTex},texel:{value:new THREE.Vector2(1/Paint.COLS,1/Paint.ROWS)},
    colA:{value:TEAM_COLORS[0].clone()},colB:{value:TEAM_COLORS[1].clone()},camPos:{value:new THREE.Vector3()},time:{value:0}}});
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(Arena.HALF_X*2,Arena.HALF_Z*2),floorMat);
  // Plane uv: (0,0) bottom-left in local x/y. Rotating -90° about x maps local +y → world −z,
  // so uv.v grows toward −z; grid row 0 is z=−9 → flip the texture rows when uploading.
  floor.rotation.x=-Math.PI/2;scene.add(floor);
  makeProps(scene);
  // Shots: one instanced mesh, coloured per instance.
  // Shots: elongated droplets in a lighter tint of the team colour (so they read over the same
  // colour of ink), each with a small shadow dot on the floor. One instanced mesh each; frustum
  // culling is off because the instanced bounding sphere is computed once and goes stale as
  // shots move (whole batches vanished for a frame — see tests/dev-shots.cjs).
  const MAX_SHOTS=500;
  const shotMesh=new THREE.InstancedMesh(new THREE.SphereGeometry(0.17,12,8),new THREE.MeshStandardMaterial({roughness:.25,emissive:'#ffffff',emissiveIntensity:.12}),MAX_SHOTS);
  const shotShadow=new THREE.InstancedMesh(new THREE.CircleGeometry(0.16,12),new THREE.MeshBasicMaterial({color:'#1d2030',transparent:true,opacity:.28,depthWrite:false}),MAX_SHOTS);
  for(const m of [shotMesh,shotShadow]){m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);m.count=0;m.frustumCulled=false;scene.add(m);}
  const SHOT_TINT=TEAM_COLORS.map(c=>c.clone().lerp(new THREE.Color('#ffffff'),0.15)),_q=new THREE.Quaternion(),_sc=new THREE.Vector3(),_pos=new THREE.Vector3(),_fwd=new THREE.Vector3(),_zAxis=new THREE.Vector3(0,0,1),_flat=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),-Math.PI/2);
  const clip=new THREE.Plane(new THREE.Vector3(0,1,0),-0.03);
  const players=new Map(); // slot → {avatar, signature, ring, tag, shadow, runPhase, flash}
  const raycaster=new THREE.Raycaster(),aimPlane=new THREE.Plane(new THREE.Vector3(0,1,0),-0.5),tmp=new THREE.Vector3(),mtx=new THREE.Matrix4(),col=new THREE.Color();
  let camTarget=new THREE.Vector3(),lastVersion=-1,building=new Map();

  function resize(){const w=canvas.clientWidth||innerWidth,h=canvas.clientHeight||innerHeight;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();}
  addEventListener('resize',resize);resize();

  function uploadPaint(grid){
    if(grid.version===lastVersion&&!grid.dirty)return;lastVersion=grid.version;grid.dirty=false;
    const C=Paint.COLS,R=Paint.ROWS;
    for(let r=0;r<R;r++){const src=r*C,dst=(R-1-r)*C;for(let c=0;c<C;c++){const t=grid.team[src+c],o=(dst+c)*4;data[o]=t===0?255:0;data[o+1]=t===1?255:0;data[o+2]=0;data[o+3]=255;}}
    paintTex.needsUpdate=true;
  }
  function nameTag(text,team){
    const c=document.createElement('canvas');c.width=256;c.height=64;const g=c.getContext('2d');
    g.font='600 28px "PingFang SC","Microsoft YaHei",sans-serif';const w=Math.min(240,g.measureText(text).width+28);
    g.fillStyle=team===0?'rgba(212,98,8,.92)':'rgba(36,76,190,.92)';g.beginPath();g.roundRect((256-w)/2,10,w,44,22);g.fill();
    g.fillStyle='#fff';g.textAlign='center';g.textBaseline='middle';g.fillText(text,128,33);
    const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;
    const s=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,depthTest:false,transparent:true}));s.scale.set(1.6,0.4,1);s.renderOrder=10;return s;
  }
  // Build (or rebuild when the look changes) the avatar for a slot.
  async function setPlayer(slot,{signature,asset,fallback,name,team,weapon}){
    const cur=players.get(slot);
    if(cur&&cur.signature===signature&&cur.team===team&&cur.name===name){if(cur.weapon!==weapon){cur.avatar.setWeapon(weapon,'#'+TEAM_COLORS[team].getHexString());cur.weapon=weapon;}return;}
    const token={};building.set(slot,token);
    const avatar=await buildAvatar(asset,fallback,{height:PET_HEIGHT,weapon,color:'#'+TEAM_COLORS[team].getHexString(),clip});
    if(building.get(slot)!==token){avatar.dispose?.();return;}
    const old=players.get(slot);if(old){scene.remove(old.group);old.avatar.dispose?.();}
    const group=new THREE.Group();group.add(avatar.object);
    const ring=new THREE.Mesh(new THREE.RingGeometry(0.42,0.52,32),new THREE.MeshBasicMaterial({color:TEAM_COLORS[team],transparent:true,opacity:.85,depthWrite:false}));ring.rotation.x=-Math.PI/2;ring.position.y=0.02;group.add(ring);
    const shadow=new THREE.Mesh(new THREE.CircleGeometry(0.42,24),new THREE.MeshBasicMaterial({color:'#000',transparent:true,opacity:.18,depthWrite:false}));shadow.rotation.x=-Math.PI/2;shadow.position.y=0.012;group.add(shadow);
    const tag=nameTag(name,team);tag.position.y=PET_HEIGHT*(asset?.kind==='doll3d'?1.3:1)+0.5;group.add(tag);
    scene.add(group);players.set(slot,{avatar,group,ring,shadow,tag,signature,team,name,weapon,runPhase:0,flash:0,sink:0});
  }
  function removePlayer(slot){const p=players.get(slot);if(p){scene.remove(p.group);p.avatar.dispose?.();players.delete(slot);}}
  function flash(slot){const p=players.get(slot);if(p)p.flash=1;}

  // Draw one frame. `actors` carry interpolated positions ({slot,x,z,face,vx,vz,diving,firing,alive,...}).
  function render(dt,{grid,actors,shots,me}){
    uploadPaint(grid);
    for(const a of actors){
      const p=players.get(a.slot);if(!p)continue;
      const speed=Math.hypot(a.vx||0,a.vz||0);
      p.runPhase+=dt*speed*2.2;p.flash=Math.max(0,p.flash-dt*4);
      // Sink: diving still → only the top of the head shows; swimming fast → just the ears.
      const want=!a.alive?1.1:a.diving?(speed>3?0.95:0.78):0;
      p.sink+=(want-p.sink)*Math.min(1,dt*(a.alive?14:5));
      p.group.position.set(a.x,0,a.z);
      p.avatar.update(dt,{yaw:a.face,run:a.diving?0:Math.min(1,speed/5.5),runPhase:p.runPhase,aim:a.firing,sink:p.sink,visible:true,alpha:1,flash:p.flash});
      p.ring.visible=a.alive&&!a.diving;p.shadow.visible=a.alive&&p.sink<0.5;
      p.tag.visible=a.alive&&(!a.diving||a.slot===me);
    }
    // Shots
    let n=0;
    for(const s of shots){
      if(n>=MAX_SHOTS)break;
      _fwd.set(s.dx,0,s.dz).normalize();_q.setFromUnitVectors(_zAxis,_fwd);
      _pos.set(s.x,0.3+s.y*1.2,s.z);_sc.set(0.85,0.85,s.kind==='drop'?1.4:2.2);mtx.compose(_pos,_q,_sc);shotMesh.setMatrixAt(n,mtx);
      shotMesh.setColorAt(n,col.copy(SHOT_TINT[s.team]));
      _pos.set(s.x,0.02,s.z);_sc.set(1,1,1);mtx.compose(_pos,_flat,_sc);shotShadow.setMatrixAt(n,mtx);n++;
    }
    shotMesh.count=n;shotShadow.count=n;shotMesh.instanceMatrix.needsUpdate=true;shotShadow.instanceMatrix.needsUpdate=true;if(shotMesh.instanceColor)shotMesh.instanceColor.needsUpdate=true;
    // Camera: follow `me` from a fixed azimuth, looking a little ahead toward the aim.
    const self=actors.find(a=>a.slot===me);
    if(self){
      const ax=Math.max(-2,Math.min(2,(self.aimX??self.x)-self.x))*0.35,az=Math.max(-2,Math.min(2,(self.aimZ??self.z)-self.z))*0.35;
      tmp.set(Math.max(-7.5,Math.min(7.5,self.x+ax)),0,Math.max(-4,Math.min(5,self.z+az)));camTarget.lerp(tmp,Math.min(1,dt*6));
    }
    camera.position.set(camTarget.x,CAM_DIST*Math.sin(PITCH),camTarget.z+CAM_DIST*Math.cos(PITCH));camera.lookAt(camTarget);
    floorMat.uniforms.camPos.value.copy(camera.position);floorMat.uniforms.time.value+=dt;
    renderer.render(scene,camera);
  }
  function snapCamera(x,z){camTarget.set(x,0,z);}
  // Pointer (client px) → the point on the aim plane (0.5 m above the floor).
  function aimAt(clientX,clientY){
    const r=canvas.getBoundingClientRect();
    raycaster.setFromCamera({x:((clientX-r.left)/r.width)*2-1,y:-((clientY-r.top)/r.height)*2+1},camera);
    const hit=raycaster.ray.intersectPlane(aimPlane,tmp);return hit?{x:hit.x,z:hit.z}:null;
  }
  // World point → client px (for tests that aim with the real mouse).
  function project(x,z,y=0.5){tmp.set(x,y,z).project(camera);const r=canvas.getBoundingClientRect();return {x:r.left+(tmp.x+1)/2*r.width,y:r.top+(1-tmp.y)/2*r.height};}
  // Diagnostics: are the in-flight shots inside the view, and would the instanced mesh draw them?
  const _frustum=new THREE.Frustum(),_pm=new THREE.Matrix4(),_sphere=new THREE.Sphere();
  function shotView(){
    _pm.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);_frustum.setFromProjectionMatrix(_pm);
    let inView=0;const p=new THREE.Vector3(),m=new THREE.Matrix4();
    for(let i=0;i<shotMesh.count;i++){shotMesh.getMatrixAt(i,m);p.setFromMatrixPosition(m);if(_frustum.containsPoint(p))inView++;}
    const bs=shotMesh.boundingSphere;const meshVisible=!shotMesh.frustumCulled||!bs||_frustum.intersectsSphere(_sphere.copy(bs).applyMatrix4(shotMesh.matrixWorld));
    return {count:shotMesh.count,inView,meshVisible,culledWhileInView:inView>0&&!meshVisible};
  }
  function info(){return {shotView:shotView(),players:[...players.entries()].map(([slot,p])=>({slot,kind:p.avatar.kind,sink:+p.sink.toFixed(2),visible:p.group.visible})),shots:shotMesh.count,paintVersion:lastVersion,calls:renderer.info.render.calls};}
  return {render,setPlayer,removePlayer,flash,aimAt,project,snapCamera,info,renderer,camera};
}
