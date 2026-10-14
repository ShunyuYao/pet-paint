"use strict";
// Read-only rendered-coordinate probes; delays only real production SDK polls.
// No game state, inputs, authority messages or outcome is fabricated.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),assert=require('node:assert/strict'),vm=require('node:vm');
const CDP=require('./cdp.cjs');
exports.prepare=(source,kind,report)=>{
 const original=fs.readFileSync(source,'utf8');let html=original,observed=0,polls=0;
 if(kind==='kitchen')html=html.replace('g.translate(p.x,p.y+bob);',m=>{observed++;return m+'globalThis.__motionProbe?.({t:performance.now(),seat:i,x:p.x,y:p.y,speed:p.moving?210:0,phase:state.phase});';});
 if(kind==='gold')html=html.replace('rope(ctx,origins[seat],displayedHook,seat);',m=>{observed++;return m+'globalThis.__motionProbe?.({t:performance.now(),seat,x:displayedHook.x,y:displayedHook.y,speed:1,phase:state?.phase,mode:hook?.mode});';});
 if(kind==='paint')html=html.replace(/([\w$]+)\.group\.position\.set\(([\w$]+)\.x,0,\2\.z\)/g,(m,actor,state)=>{observed++;return m+`,globalThis.__motionProbe?.({t:performance.now(),seat:${state}.slot,x:${actor}.group.position.x,y:${actor}.group.position.z,speed:Math.hypot(${state}.vx,${state}.vz),phase:${state}.alive?'play':'dead'})`;});
 html=html.replace(/await ([\w$]+(?:\.sessions)?)\.poll\(\{\s*cursor(?:\s*:\s*[\w$]+)?\s*,\s*waitMs\s*:\s*(?:1000|1e3)\s*\}\)/g,(m)=>{polls++;return '(await globalThis.__motionPollDelay?.(),'+m+')';});
 assert.equal(observed,1,'one actual render-coordinate seam');assert.equal(polls,1,'one real SDK poll seam');
 for(const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)){if(match[1].trim().startsWith('{'))continue;new vm.Script(match[1]);}
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),kind+'-motion-artifact-')),out=path.join(dir,path.basename(source));fs.writeFileSync(out,html);
 report.motionSource={kind,source,sha256:crypto.createHash('sha256').update(original).digest('hex'),instrumentedSha256:crypto.createHash('sha256').update(html).digest('hex'),seams:{observed,polls}};return out;
};
function stats(rows,run,seat,kind){
 const ratios=[],deltas=[],dts=[];let holds=0;
 const f=rows.filter(r=>r.run===run&&r.seat===seat);
 for(let i=1;i<f.length;i++){
  const a=f[i-1],b=f[i],dt=(b.t-a.t)/1000;
  if(dt<.005||dt>.05||b.age<250||a.step!==b.step)continue;
  if(kind==='gold'){if(a.mode!==b.mode||!['swing','out'].includes(b.mode)||b.phase!=='playing')continue;}
  else if(b.speed<(kind==='paint'?2:1)||a.speed<1||!['play','playing'].includes(b.phase))continue;
  // Exclude walls, stations, turns and collisions, so stationary gameplay isn't jitter.
  if(kind==='kitchen'&&(b.x<205||b.x>730||b.y<140||b.y>403))continue;
  const dist=Math.hypot(b.x-a.x,b.y-a.y);holds+=dist<1e-5?1:0;deltas.push(dist);dts.push(dt);
  if(kind!=='gold')ratios.push(dist/(b.speed*dt));
 }
 assert(deltas.length>80,'enough moving rendered frames '+kind+' '+run+' seat '+seat+' '+deltas.length);
 ratios.sort((a,b)=>a-b);deltas.sort((a,b)=>a-b);
 return {run,seat,frames:deltas.length,holdRatio:holds/deltas.length,p95SpeedRatio:ratios.length?ratios[Math.floor(ratios.length*.95)]:null,p95FrameDistance:deltas[Math.floor(deltas.length*.95)],maxFrameDistance:deltas.at(-1),meanFrameMs:1000*dts.reduce((a,b)=>a+b,0)/dts.length};
}
exports.run=async({kind,a,b,H,wait,state,activateButton,check,screenshot,json,evidence,report,closeWork})=>{
 const sessions=[];
 try{
  for(const app of [a,b]){const s=await CDP.connect(app.game);app.motionCDP=s;sessions.push(s);s.on(m=>{if(m.method==='Page.screencastFrame')void s.send('Page.screencastFrameAck',{sessionId:m.params.sessionId});});await s.send('Page.startScreencast',{format:'jpeg',quality:1,maxWidth:160,maxHeight:100,everyNthFrame:1});await s.evaluate(`window.__motionRows=[];window.__motionStep=0;window.__motionStepAt=performance.now();window.__motionRun='normal';window.__motionProbe=p=>{if(window.__motionRows.length<16000)window.__motionRows.push({...p,run:window.__motionRun,step:window.__motionStep,age:performance.now()-window.__motionStepAt});};true`);}
  const ready=kind==='gold'?'#ready-button':'#ready';for(const app of [a,b])await activateButton(app.game,ready);
  await wait(async()=>{for(const app of [a,b]){const st=await state(app);if((kind==='kitchen'?st.state.phase:kind==='paint'?st.phase:st.phase)!==(kind==='paint'?'play':'playing'))return false;}return true;},'both humans playing');
  for(const app of [a,b])await app.motionCDP.evaluate('document.activeElement?.blur();true');
  for(const run of ['normal','batched']){
   for(const app of [a,b])await app.motionCDP.evaluate(`window.__motionRun=${JSON.stringify(run)};true`);
   if(run==='batched')await b.motionCDP.evaluate('window.__delayedPolls=0;window.__motionPollDelay=()=>{window.__delayedPolls++;return new Promise(r=>setTimeout(r,180));};true');
   if(kind==='gold'){
    for(let n=0;n<3;n++){for(const app of [a,b])await app.motionCDP.evaluate(`window.__motionStep=${n};window.__motionStepAt=performance.now();true`);await H.sleep(1000);if(n===1)for(const app of [a,b])await app.motionCDP.press('ArrowDown');await H.sleep(1500);}
   }else{
    const seq=kind==='kitchen'?['KeyD','KeyS','KeyA','KeyW','KeyD','KeyS','KeyA','KeyW']:['KeyD','KeyW','KeyA','KeyS','KeyD','KeyW','KeyA','KeyS'];
    for(let n=0;n<seq.length;n++){for(const app of [a,b]){await app.motionCDP.evaluate(`window.__motionStep=${n};window.__motionStepAt=performance.now();true`);await app.motionCDP.key(seq[n]);}await H.sleep(kind==='paint'?1000:650);for(const app of [a,b])await app.motionCDP.key(seq[n],'keyUp');}
   }
   await screenshot(b.game,kind+'-receiver-'+run);
  }
  report.delayedPolls=await b.motionCDP.evaluate('window.__delayedPolls');assert(report.delayedPolls>10,'real poll delay exercised');
  const results={};for(const app of [a,b]){const rows=await app.motionCDP.evaluate('window.__motionRows');json(path.join(evidence,app.label+'-rendered-motion.json'),rows);results[app.label]=['normal','batched'].map(run=>stats(rows,run,0,kind));if(app===b&&kind==='kitchen')report.receiverOwn=['normal','batched'].map(run=>stats(rows,run,1,kind));}
  report.motion=results;
  report.motionFinding=results.b.some(r=>r.holdRatio>.2||r.p95SpeedRatio>1.7)?'remote-motion-stutter-reproduced':'no-remote-stutter-within-this-path';
  console.log('MOTION',JSON.stringify({motion:results,receiverOwn:report.receiverOwn,finding:report.motionFinding}));
  check('real rendered remote movement measured under normal and batched SDK delivery',results);
  await b.motionCDP.evaluate('window.__motionPollDelay=null;window.__motionProbe=null;true');
  if(closeWork)await closeWork(a);else{const c=await H.findTarget(a.cdp,'/work-player.html');await require(process.env.MOTION_HOST_ROOT+'/tests/e2e/html-card-input').activateClosingButton(a.cdp,c,'[data-work-exit]');}
  await wait(async()=>{const s=await state(b);return s.connection==='closed'||s.phase==='closed'||s.session===null;},'room closure reaches receiver');check('room exit propagates after measurement');
  report.smoothnessAccepted=results.b.every(r=>r.holdRatio<.25 && (r.p95SpeedRatio===null || r.p95SpeedRatio<2.5));
  if(kind==='kitchen')report.smoothnessAccepted=report.smoothnessAccepted&&report.receiverOwn.every(r=>r.holdRatio<.3&&r.p95SpeedRatio<2.5);
  report.motionFinding=report.smoothnessAccepted?'motion-regression-passed':'remote-motion-stutter-reproduced';
  assert(report.smoothnessAccepted,'rendered motion must remain continuous under batching: '+JSON.stringify(results.b));
 }finally{for(const s of sessions){await s.send('Page.stopScreencast').catch(()=>{});s.close();}}
};
