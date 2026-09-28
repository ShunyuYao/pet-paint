'use strict';
// Shared launcher: hidden Electron with the built HTML, CDP page handle, cleanup.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawn}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..'),REPO=path.resolve(ROOT,'../..');
const {connect}=require('./cdp.cjs');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function launch({width=960,height=656}={}){
  const port=19000+Math.floor(Math.random()*900),profile=fs.mkdtempSync(path.join(os.tmpdir(),'pet-paint-e2e-'));
  const child=spawn(require(path.join(REPO,'demo/node_modules/electron')),[path.join(__dirname,'browser-shell.cjs'),'--remote-debugging-port='+port,'--use-mock-keychain','--mute-audio'],{detached:true,env:{...process.env,ELECTRON_RUN_AS_NODE:'',PAINT_E2E_PROFILE:profile,PAINT_HTML:path.join(ROOT,'dist/桌宠颜料大作战.html'),PAINT_W:String(width),PAINT_H:String(height)}});
  let t;for(let i=0;i<80&&!t;i++){try{t=(await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(x=>x.type==='page'&&x.url.includes('.html'));}catch{}await sleep(250);}
  if(!t)throw Error('page not found');
  const p=await connect(t);await p.send('Runtime.enable');const errors=[];
  p.on(m=>{if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')errors.push(m.params.args.map(a=>a.value??a.description).join(' '));});
  const wait=async(expr,label,ms=20000)=>{const until=Date.now()+ms;let last;while(Date.now()<until){last=await p.evaluate(expr).catch(e=>e.message);if(last)return last;await sleep(60);}throw Error('timeout: '+label+' last='+JSON.stringify(last));};
  const close=()=>{try{p.close();}catch{}try{process.kill(-child.pid);}catch{}};
  return {p,wait,errors,close,sleep};
}
module.exports={launch,sleep,ROOT};
