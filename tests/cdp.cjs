'use strict';
// Persistent CDP session: one socket per page so object ids / events survive between calls.
async function connect(target){
  const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=()=>j(Error('cdp connect failed'));});
  let id=0;const pending=new Map(),listeners=[];
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(m.error.message+' '+(m.error.data||''))):p.resolve(m.result);}else if(m.method)listeners.forEach(l=>l(m));};
  const send=(method,params={},timeout=30000)=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}));setTimeout(()=>{if(pending.delete(n))reject(Error('cdp timeout '+method));},timeout);});
  const evaluate=async(expr,timeout)=>{const r=await send('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true},timeout);if(r.exceptionDetails)throw Error('page exception: '+(r.exceptionDetails.exception?.description||r.exceptionDetails.text));return r.result.value;};
  const KEYS={KeyP:80,ShiftRight:16,ArrowUp:38,ArrowDown:40,ArrowLeft:37,ArrowRight:39,Space:32,ShiftLeft:16,Enter:13,KeyE:69,KeyW:87,KeyA:65,KeyD:68,KeyS:83,KeyJ:74,KeyK:75,KeyU:85,KeyL:76,KeyI:73,Tab:9};
  const keyName=c=>c.startsWith('Key')?c.slice(3).toLowerCase():c==='Space'?' ':c==='ShiftLeft'?'Shift':c;
  async function key(code,type='keyDown'){await send('Input.dispatchKeyEvent',{type,code,key:keyName(code),windowsVirtualKeyCode:KEYS[code],...(code==='Enter'&&type==='keyDown'?{text:'\r'}:{})});}
  async function press(code){await key(code,'keyDown');await key(code,'keyUp');}
  async function focus(selector){await send('Emulation.setFocusEmulationEnabled',{enabled:true});const ok=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e||e.disabled||e.closest('[hidden]'))return false;e.focus();return document.activeElement===e;})()`);if(!ok)throw Error('cannot focus '+selector);}
  async function activate(selector){await focus(selector);await press('Enter');}
  async function setFiles(selector,files){const {result}=await send('Runtime.evaluate',{expression:`document.querySelector(${JSON.stringify(selector)})`});await send('DOM.setFileInputFiles',{files,objectId:result.objectId});}
  // Hidden windows occasionally answer "Internal error" when no fresh frame is ready; retry a few times.
  async function screenshot(file){let last;for(let i=0;i<4;i++){try{const {data}=await send('Page.captureScreenshot',{format:'png'});require('node:fs').writeFileSync(file,Buffer.from(data,'base64'));return file;}catch(e){last=e;if(!/Internal error/.test(e.message))throw e;await new Promise(r=>setTimeout(r,300));}}throw last;}
  // Real mouse input through the browser's input pipeline (aiming / firing in the game canvas).
  async function mouse(type,x,y,button='none'){await send('Input.dispatchMouseEvent',{type,x,y,button,buttons:button==='left'?1:button==='right'?2:0,clickCount:type==='mouseMoved'?0:1});}
  return {send,evaluate,key,press,focus,activate,setFiles,screenshot,mouse,on:l=>listeners.push(l),close:()=>ws.close()};
}
module.exports={connect};
