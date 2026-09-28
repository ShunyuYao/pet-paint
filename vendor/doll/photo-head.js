import * as THREE from '../lib/three.module.js';

// Read a smooth radial silhouette from the actual cutout. Front/back hemispheres
// meet at this contour, so the head is round all the way around, without a slab edge.
function outline(image,count=128){
  const canvas=document.createElement('canvas');canvas.width=192;canvas.height=Math.round(192*image.height/image.width);
  const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0,canvas.width,canvas.height);
  const {width:w,height:h}=canvas,pixels=ctx.getImageData(0,0,w,h).data,center=[.5,.48];
  const radii=Array.from({length:count},(_,i)=>{
    const angle=i/count*Math.PI*2,dx=Math.cos(angle),dy=Math.sin(angle);let radius=.2;
    for(let r=0;r<.8;r+=.002){
      const x=Math.round((center[0]+dx*r)*w),y=Math.round((center[1]-dy*r)*h);
      if(x>=0&&x<w&&y>=0&&y<h&&pixels[(y*w+x)*4+3]>160)radius=r;
    }
    return radius;
  });
  return {center,points:radii.map((r,i)=>{
    // Smooth photo cutout stair steps without replacing the hairstyle with a ball.
    const radius=[-2,-1,0,1,2].reduce((sum,k)=>sum+radii[(i+k+count)%count]*(k===0?4:Math.abs(k)===1?2:1),0)/10;
    const a=i/count*Math.PI*2;return [Math.cos(a)*radius,Math.sin(a)*radius];
  })};
}

export function makePhotoHead(texture,wardrobe){
  const {points,center}=outline(texture.image),segments=points.length,rings=64;
  const width=.91,height=1.03,depthRadius=.37,positions=[],uv=[],indices=[];
  // Closed surface from front pole through the photo contour to the back pole.
  for(let j=0;j<=rings;j++){
    const angle=j/rings*Math.PI,r=Math.sin(angle),z=Math.cos(angle)*depthRadius;
    for(let i=0;i<segments;i++){
      const [x,y]=points[i];positions.push(x*r*width,y*r*height,z);
      uv.push(center[0]+x*r,1-center[1]+y*r);
    }
  }
  for(let j=0;j<rings;j++)for(let i=0;i<segments;i++){
    const n=(i+1)%segments,a=j*segments+i,b=j*segments+n,c=(j+1)*segments+i,d=(j+1)*segments+n;
    indices.push(a,c,b,b,c,d);
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geometry.setIndex(indices);
  const half=indices.length/2;geometry.addGroup(0,half,0);geometry.addGroup(half,half,1);
  geometry.computeVertexNormals();
  // Coincident pole vertices need one shared normal to avoid a lighting pinwheel.
  const normal=geometry.attributes.normal;
  for(let i=0;i<segments;i++){normal.setXYZ(i,0,0,1);normal.setXYZ(rings*segments+i,0,0,-1);}
  geometry.computeBoundingBox();geometry.computeBoundingSphere();
  const print=new THREE.MeshStandardMaterial({map:texture,color:'#ffffff',roughness:.98,metalness:0,bumpMap:wardrobe.headBump,bumpScale:.0015});
  const head=new THREE.Mesh(geometry,[print,wardrobe.hair]);
  head.rotation.x=Math.PI/2;head.position.z=.075;head.castShadow=true;head.receiveShadow=true;
  const bounds=geometry.boundingBox,thickness=bounds.max.z-bounds.min.z,actualWidth=bounds.max.x-bounds.min.x;
  head.userData.photoHead={thickness,width:actualWidth,depthWidthRatio:thickness/actualWidth,outlineVertices:segments,form:'rounded-closed-photo-head'};
  return head;
}
