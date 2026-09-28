'use strict';
// In-process stand-in for the host's `pet.sessions` bridge, with the rules that matter to the
// game (demo/core/peer-session/*): star topology (guests only reach the host), `latest` lane
// coalescing (same key within 30 ms keeps the newest), per-channel send budget (30/s per lane
// → backpressure), ≤ 60 KB messages, one poll at a time, transfers ≤ 1 MB one at a time.
// Latency and loss are configurable so healing paths are exercised.
function createHub({latency=[5,40],loss=0,seed=7}={}){
  let s=seed>>>0||1;const rnd=()=>{s^=s<<13;s>>>=0;s^=s>>>17;s^=s<<5;s>>>=0;return s/4294967296;};
  const ends=new Map();let hostId=null,nextId=1,transfers=0;const stats={sent:0,dropped:0,coalesced:0,backpressure:0,maxBytes:0};
  function endpoint(role){
    const id='peer-'+(nextId++);const q=[];let waiter=null,cursor=0,joined=false;const pendingKey=new Map(),window=new Map(),blobs=new Map();
    const e={id,role,q,push(ev){q.push(ev);if(waiter){const w=waiter;waiter=null;w();}}};ends.set(id,e);if(role==='host')hostId=id;
    const deliver=(toId,ev,key)=>{
      const target=ends.get(toId);if(!target)return;
      if(loss&&rnd()<loss){stats.dropped++;return;}
      const delay=latency[0]+rnd()*(latency[1]-latency[0]);
      if(key){const k=toId+'|'+key,prev=pendingKey.get(k);if(prev&&!prev.done){prev.ev=ev;stats.coalesced++;return;}
        const item={ev,done:false};pendingKey.set(k,item);setTimeout(()=>{item.done=true;target.push(item.ev);},Math.max(delay,30));return;}
      setTimeout(()=>target.push(ev),delay);
    };
    const budget=toId=>{const t=Date.now(),w=window.get(toId)||[];while(w.length&&t-w[0]>=1000)w.shift();if(w.length>=30){stats.backpressure++;throw Error('backpressure');}w.push(t);window.set(toId,w);};
    const sdk={
      async getContext(){return {invitationId:'inv-1',role,protocol:{id:'pet-paint',version:1},peer:{sessionPeerId:id}};},
      async join(){joined=true;const others=role==='host'?[...ends.values()].filter(x=>x.role==='guest'):[ends.get(hostId)];
        if(role==='guest'){ends.get(hostId)?.push({type:'peer_joined',from:id});e.push({type:'connected',epoch:1});}
        return {status:'connected',epoch:1};},
      async send({to,type,payload,lane,key}){
        if(lane!=='latest')throw Error('invalid_request');
        const plain=v=>v===null||['string','boolean'].includes(typeof v)||(typeof v==='number'&&Number.isFinite(v))||(Array.isArray(v)&&v.every(plain))||(typeof v==='object'&&Object.getPrototypeOf(v)===Object.prototype&&Object.values(v).every(plain));
        if(!plain(payload))throw Error('invalid_request');
        const bytes=JSON.stringify(payload).length;stats.maxBytes=Math.max(stats.maxBytes,bytes);if(bytes>60*1024)throw Error('payload_too_large');
        stats.sent++;
        const targets=role==='guest'?(to?(()=>{throw Error('invalid_request');})():[hostId]):to==='*'?[...ends.values()].filter(x=>x.role==='guest').map(x=>x.id):[to];
        for(const t of targets){budget(t);deliver(t,{type:'message',from:id,message:{type,payload:JSON.parse(JSON.stringify(payload))}},key);}
        return {status:'queued',seq:stats.sent};
      },
      async poll({waitMs=1000}={}){
        if(!q.length)await new Promise(r=>{waiter=r;setTimeout(()=>{if(waiter===r){waiter=null;r();}},waitMs);});
        const events=q.splice(0);cursor+=events.length;return {cursor,events,transportState:'connected',epoch:1};
      },
      async transfer({to,purpose,contentType,dataBase64}){
        if(dataBase64.length>Math.ceil(1024*1024/3)*4)throw Error('payload_too_large');
        const tid='t'+(++transfers);const target=role==='guest'?hostId:to;blobs.set(tid,{purpose,contentType,dataBase64});
        const holder=ends.get(target);holder.blobs=holder.blobs||new Map();holder.blobs.set(tid,{purpose,contentType,dataBase64});
        await new Promise(r=>setTimeout(r,20));holder.push({type:'transfer',from:id,purpose,transferId:tid});return {transferId:tid};
      },
      async readTransfer({transferId}){const b=e.blobs?.get(transferId);if(!b)throw Error('not_found');return b;},
      async leave(){ends.delete(id);if(role==='guest')ends.get(hostId)?.push({type:'peer_left',from:id});else for(const g of ends.values())g.push({type:'closed',reason:'host_left'});},
    };
    return sdk;
  }
  return {host:()=>endpoint('host'),guest:()=>endpoint('guest'),stats};
}
module.exports={createHub};
