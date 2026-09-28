'use strict';
// Dev aid: import the 3D doll pack, start solo, crop around our pet (standing, firing, diving).
const path=require('node:path'),fs=require('node:fs');
const {launch,ROOT}=require('./launch.cjs');
const DOLL=process.env.PAINT_DOLL_ZIP||path.resolve(ROOT,'../rat-doll-lab/dist/rat-doll-female.zip');
(async()=>{
  const out=path.join(ROOT,'artifacts/dev');fs.mkdirSync(out,{recursive:true});
  const {p,wait,errors,close,sleep}=await launch();
  try{
    await wait('window.__paint?.state().driver','boot');
    await p.setFiles('#import-file',[DOLL]);await wait('window.__paint.state().driver.kind==="doll3d"','3d import',60000);
    await p.activate('#solo');await wait('window.__paint.state().phase==="play"','play',10000);
    await wait('window.__paint.world().players.find(x=>x.slot===0)?.kind==="doll3d"','doll built',30000);
    const shot=async name=>{const s=await p.evaluate('window.__paint.state().me');const c=await p.evaluate(`window.__paint.screen(${s.x},${s.z},0.6)`);const f=path.join(out,name+'.png');await p.screenshot(f);return {f,c};};
    const s=await p.evaluate('window.__paint.state().me');const aim=await p.evaluate(`window.__paint.screen(${s.x+5},${s.z+1})`);
    await p.mouse('mouseMoved',aim.x,aim.y);await sleep(600);
    const a=await shot('doll-stand');
    await p.mouse('mousePressed',aim.x,aim.y,'left');await sleep(900);const b=await shot('doll-fire');await p.mouse('mouseReleased',aim.x,aim.y,'left');
    await p.key('ShiftLeft');await sleep(700);const c=await shot('doll-dive');await p.key('ShiftLeft','keyUp');
    console.log(JSON.stringify({a:a.c,b:b.c,c:c.c,errors}));
  }finally{close();}
})().catch(e=>{console.error(e);process.exit(1);});
