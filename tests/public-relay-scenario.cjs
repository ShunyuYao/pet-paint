'use strict';
const assert=require('node:assert/strict');
const {connect}=require('./cdp.cjs');
const readyExpression='window.__paint?.state().actors.length===2&&window.__paint.state().driver?.kind==="sprite"&&!document.querySelector("#ready").disabled';
const stateExpression='window.__paint.state()';
async function run({apps,H,wait,press,shot,check,state}){
 const [a,b]=apps;
 await press(a.game,'#lobby-time [data-value="60"]');await press(a.game,'#ready');await H.sleep(350);assert.equal((await state(a)).phase,'lobby','one ready does not start');await press(b.game,'#ready');
 await wait(async()=>(await Promise.all(apps.map(async x=>(await state(x)).phase==='play'))).every(Boolean),'both public players in match',15000);
 for(const x of apps){await H.evalIn(x.game,'document.activeElement?.blur();true');x.cdpS=await connect(x.game);}
 const before=await Promise.all(apps.map(state));
 async function walk(x){const dirs=['KeyD','KeyS','KeyA','KeyW'];let n=x.label==='a'?0:2;await x.cdpS.key('KeyJ');try{while(!cancelled&&(await state(x)).phase==='play'){const code=dirs[n++%4];await x.cdpS.key(code);try{await H.sleep(650);}finally{await x.cdpS.key(code,'keyUp');}}}finally{await x.cdpS.key('KeyJ','keyUp').catch(()=>{});}}
 let cancelled=false;const playing=apps.map(walk);const outcome=Promise.allSettled(playing);
 try{
  await H.sleep(6000);
  for(const [i,x]of apps.entries()){const st=await state(x);assert(st.coverage.cells[0]+st.coverage.cells[1]>200,'real shooting paints floor');assert(st.me.x!==before[i].me.x||st.me.z!==before[i].me.z,'own keyboard moves');await shot(x.game,x.label+'-painting');}
  check('both physical keyboards move, shoot and paint through public relay');
  await wait(async()=>(await Promise.all(apps.map(async x=>(await state(x)).phase==='results'))).every(Boolean),'both public result screens',75000);await Promise.all(playing);await H.sleep(1800);
  const result=(await state(a)).result;assert(result?.hash);for(const x of apps){const st=await state(x);assert.deepEqual(st.result.share,result.share);assert.equal(st.hash,result.hash,'exact final paint grid');await shot(x.game,x.label+'-results');}
  check('both physical Macs share final paint grid hash, score and winner',result);
  await press(a.game,'#again');await wait(async()=>(await state(b)).phase==='count','public paint rematch');check('public rematch after same settlement');
  await press(b.game,'#leave');await wait(async()=>(await state(a)).actors.find(v=>v.slot===1)?.kind==='bot','public departure handed to CPU');check('guest departure reaches host and CPU takes over');
 }finally{cancelled=true;await outcome;for(const x of apps)x.cdpS?.close();}
}
module.exports={gameId:'pet-paint',readyExpression,stateExpression,run};
