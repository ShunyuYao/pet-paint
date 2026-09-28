// Sound effects, synthesized with WebAudio at runtime (no recordings, no files).
// Browsers only allow audio after a user gesture: the context starts on the first click / key.
export function createAudio({sfx=true}={}){
  let ctx=null,bus=null,noiseBuf=null,on=sfx,last={};
  function ensure(){
    if(!ctx){
      ctx=new AudioContext();bus=ctx.createGain();bus.gain.value=on?.5:0;
      const comp=ctx.createDynamicsCompressor();comp.threshold.value=-16;comp.ratio.value=4;bus.connect(comp);comp.connect(ctx.destination);
      const len=ctx.sampleRate;noiseBuf=ctx.createBuffer(1,len,ctx.sampleRate);const d=noiseBuf.getChannelData(0);for(let i=0;i<len;i++)d[i]=Math.random()*2-1;
    }
    if(ctx.state==='suspended')void ctx.resume();return ctx;
  }
  function tone(type,f0,f1,dur,gain){const t=ctx.currentTime,o=ctx.createOscillator(),g=ctx.createGain();o.type=type;o.frequency.setValueAtTime(f0,t);o.frequency.exponentialRampToValueAtTime(Math.max(20,f1),t+dur);g.gain.setValueAtTime(gain,t);g.gain.exponentialRampToValueAtTime(.0001,t+dur);o.connect(g);g.connect(bus);o.start(t);o.stop(t+dur+.02);}
  function hiss(dur,gain,type,freq){const t=ctx.currentTime,s=ctx.createBufferSource(),f=ctx.createBiquadFilter(),g=ctx.createGain();s.buffer=noiseBuf;f.type=type;f.frequency.value=freq;g.gain.setValueAtTime(gain,t);g.gain.exponentialRampToValueAtTime(.0001,t+dur);s.connect(f);f.connect(g);g.connect(bus);s.start(t,Math.random()*.5);s.stop(t+dur+.02);}
  // Rate-limit each sound so a stream of shots does not stack into noise.
  const gate=(k,ms)=>{const n=performance.now();if(n-(last[k]||0)<ms)return false;last[k]=n;return true;};
  const SFX={
    shot:()=>{if(gate('shot',55)){hiss(.07,.12,'bandpass',2400);tone('triangle',520,300,.06,.05);}},
    splat:()=>{if(gate('splat',70))hiss(.16,.1,'lowpass',900);},
    flick:()=>{hiss(.22,.16,'bandpass',1200);tone('sine',300,140,.18,.08);},
    hurt:()=>{tone('square',420,220,.1,.06);},
    down:()=>{hiss(.5,.25,'lowpass',700);tone('sawtooth',260,60,.45,.1);},
    respawn:()=>{tone('sine',440,880,.25,.08);},
    beep:()=>{tone('square',660,660,.12,.07);},
    go:()=>{tone('square',990,990,.3,.08);},
    tick:()=>{tone('sine',1200,1200,.05,.05);},
    win:()=>{[523,659,784,1047].forEach((f,i)=>setTimeout(()=>tone('triangle',f,f,.25,.09),i*120));},
    lose:()=>{[440,392,330].forEach((f,i)=>setTimeout(()=>tone('triangle',f,f*0.97,.3,.08),i*160));},
  };
  return {
    unlock(){ensure();},
    play(name){if(!on||!ctx||ctx.state!=='running')return;SFX[name]?.();},
    setOn(v){on=!!v;if(bus)bus.gain.value=on?.5:0;},
    get on(){return on;},
    state:()=>({unlocked:!!ctx,running:ctx?.state==='running',on}),
  };
}
