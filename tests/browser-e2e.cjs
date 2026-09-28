'use strict';
// Plain-browser acceptance (SPEC §11): the unmodified built HTML in a hidden Chromium window,
// driven only by real CDP input — keyboard for menus / movement / diving, the mouse for aiming
// and firing, the real file chooser for 2D / 3D imports. Checks read what the game shows or
// the read-only state hook.
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {launch,ROOT}=require('./launch.cjs');
const DOLL=process.env.PAINT_DOLL_ZIP||path.resolve(ROOT,'../rat-doll-lab/dist/rat-doll-female.zip');
const IMAGE=process.env.PAINT_IMAGE||path.resolve(ROOT,'../rat-doll-lab/dist/rat-doll-male/frames/idle/frame_00.png');
const out=path.join(ROOT,'artifacts/browser-e2e');fs.mkdirSync(out,{recursive:true});
const check=(ok,label,detail)=>{assert.ok(ok,label+(detail!==undefined?' '+JSON.stringify(detail):''));console.log('PASS',label);};
(async()=>{
  assert(fs.existsSync(DOLL)&&fs.existsSync(IMAGE),'local character fixtures missing');
  const {p,wait,errors,close,sleep}=await launch();
  const st=()=>p.evaluate('window.__paint.state()'),me=async()=>(await st()).me,shot=n=>p.screenshot(path.join(out,n+'.png'));
  try{
    await wait('window.__paint?.state().driver','boot');
    check(await p.evaluate('typeof window.pet==="undefined"'),'plain browser: no pet SDK');
    check((await st()).driver.kind==='toy','default look is a built-in toy');
    // 2D and 3D looks through the real file chooser.
    await p.setFiles('#import-file',[IMAGE]);await wait('window.__paint.state().driver.kind==="sprite"','2D import');
    await wait('window.__paint.world().players.find(x=>x.slot===0)?.kind==="sprite"','2D standee built');check(true,'a picture becomes a 2D standee');
    await p.setFiles('#import-file',[DOLL]);await wait('window.__paint.state().driver.kind==="doll3d"','3D import',60000);
    await wait('window.__paint.world().players.find(x=>x.slot===0)?.kind==="doll3d"','3D doll built',30000);check(true,'a doll pack becomes a 3D doll');
    await shot('01-title');
    // Options by keyboard: 1v1, 1 minute, roller.
    await p.activate('#size-list [data-value="1"]');await p.activate('#time-list [data-value="60"]');await p.activate('.weapon-card[data-weapon="roller"]');
    await p.activate('#solo');
    await wait('window.__paint.state().phase==="count"','countdown');
    check((await st()).actors.length===2,'1v1: one computer opponent');
    const x0=(await me()).x;await p.key('KeyD');await sleep(500);await p.key('KeyD','keyUp');
    check((await me()).x===x0,'the countdown freezes movement');
    await wait('window.__paint.state().phase==="play"','play',6000);
    // Move right while holding the fire key: the roller paints a stripe.
    await p.key('KeyD');await p.key('KeyJ');await sleep(1600);await p.key('KeyJ','keyUp');await p.key('KeyD','keyUp');
    const m1=await me();check(m1.x>x0+3,'D moves right',{from:x0,to:m1.x});
    const cov=(await st()).coverage.cells[0];check(cov>150,'the roller painted our colour',cov);
    // Dive in our own ink: faster than running, ink refills.
    await p.key('KeyA');await p.key('ShiftLeft');await sleep(500);
    const d=await me();check(d.diving&&Math.hypot(d.vx,d.vz)>7,'Shift dives in own ink and swims fast',{diving:d.diving,speed:Math.hypot(d.vx,d.vz)});
    await p.key('ShiftLeft','keyUp');await p.key('KeyA','keyUp');await shot('02-play');
    // Shots in flight inside the view are always drawn while the camera moves (the instanced
    // mesh used to be culled as a whole with a stale bounding sphere).
    let withShots=0,culled=0;await p.key('KeyW');
    for(let i=0;i<50;i++){const v=await p.evaluate('window.__paint.world().shotView');if(v.inView)withShots++;if(v.culledWhileInView)culled++;if(i%12===0)await p.press('KeyJ');if(i===25){await p.key('KeyW','keyUp');await p.key('KeyD');}await sleep(80);}
    await p.key('KeyD','keyUp');
    check(withShots>5&&culled===0,'shots in view are never culled while the camera moves',{withShots,culled});
    await sleep(1500); // flick cooldown + a little ink back after the presses above
    // Mouse aim + click fire (switching to the sprayer needs a new match; the roller flicks on click).
    const s=await me(),aim=await p.evaluate(`window.__paint.screen(${s.x+5},${s.z})`),ink0=s.ink;
    await p.mouse('mouseMoved',aim.x,aim.y);await p.mouse('mousePressed',aim.x,aim.y,'left');await sleep(120);await p.mouse('mouseReleased',aim.x,aim.y,'left');
    await sleep(300);check((await me()).ink<ink0-5,'a mouse click flicks paint (costs ink)');
    // Play it out; results show the same shares as the grid.
    await wait('window.__paint.state().phase==="results"','results',80000);
    await sleep(600);const r=await st();
    check(r.result&&Math.abs(r.result.share[0]-Math.round(r.coverage.share[0]*1000)/10)<0.01,'result equals the painted floor',r.result.share);
    check(await p.evaluate('!document.querySelector("#results-panel").hidden&&/赢|输|平局/.test(document.querySelector("#results-title").textContent)'),'results panel shows the outcome');
    await shot('03-results');
    await p.activate('#again');await wait('window.__paint.state().phase==="count"','rematch');check(true,'rematch from the results panel');
    await p.activate('#leave');await wait('window.__paint.state().mode==="title"','back to title');check(true,'leave returns to the title');
    assert.deepEqual(errors,[],'no page errors');check(true,'no page errors or exceptions');
  }finally{close();}
})().catch(e=>{console.error(e);process.exit(1);});
