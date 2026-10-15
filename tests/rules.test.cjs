'use strict';
// Rule acceptance tests (SPEC §1–§8). Players are driven by the same input objects the
// keyboard / mouse produce (move axes, aim point, fire / dive held, press counter).
// Test helpers only place actors on the floor, like picking a spot in training.
const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../game/config.cjs'),Arena=require('../game/arena.cjs'),Paint=require('../game/paint.cjs');
const Sim=require('../game/sim.cjs'),Match=require('../game/match.cjs'),Game=require('../game/game.cjs');

const DT=1/60;
function duel({weapons=['sprayer','sprayer'],duration=120}={}){
  const g=Game.create({role:'solo',mySlot:0,duration});
  Game.setRoster(g,[{slot:0,team:0,name:'我',weapon:weapons[0],kind:'human',owner:'local'},{slot:1,team:1,name:'对手',weapon:weapons[1],kind:'human',owner:'remote'}]);
  Game.start(g);for(let i=0;i<C.MATCH.countdown*60+2;i++)Game.step(g,DT);
  assert.equal(g.match.phase,'play');return g;
}
const run=(g,sec,input)=>{for(let i=0;i<Math.round(sec*60);i++)Game.step(g,DT,typeof input==='function'?input(i):input);};
const place=(a,x,z)=>{a.x=x;a.z=z;a.vx=a.vz=0;};
const paintUnder=(g,team,x,z,r=3)=>Paint.apply(g.world.paint,{kind:'blob',x,z,r,ph:0,team,t:g.world.ms,slot:7});

// ---------- §1 arena ----------
test('arena is point-symmetric and both spawns sit inside their own base',()=>{
  for(const o of Arena.OBSTACLES){
    const cx=o.kind==='disc'?o.x:(o.x0+o.x1)/2,cz=o.kind==='disc'?o.z:(o.z0+o.z1)/2;
    assert.ok(Arena.solidAt(-cx,-cz),'mirror of '+o.look+' is solid too');
  }
  for(const team of [0,1])for(let s=0;s<4;s++){const p=Arena.spawnPoint(team,s);assert.equal(Arena.baseAt(p.x,p.z),team);assert.equal(Arena.solidAt(p.x,p.z,C.PLAYER.radius),null);}
  const c=Paint.coverage(Paint.create());
  assert.deepEqual(c.cells,[0,0],'bases are excluded from the score, the rest starts bare');
  assert.ok(c.total>25000&&c.total<32256,'paintable cell count '+c.total);
});

// ---------- §2 last-writer-wins grid ----------
test('splats merged by paint time give identical grids in any arrival order',()=>{
  const r=Sim.rng(42),splats=[];
  for(let i=0;i<400;i++)splats.push(i%7===0?{kind:'band',x:(r()*2-1)*12,z:(r()*2-1)*8,dx:r()-.5,dz:r()-.5,w:1.6,l:.4,team:i%2,t:i*37,slot:i%4}
    :{kind:'blob',x:(r()*2-1)*13,z:(r()*2-1)*8.5,r:.3+r()*1.2,ph:r()*6,team:(i>>1)%2,t:i*37+(i%3),slot:i%4});
  const a=Paint.create(),b=Paint.create(),shuffled=splats.slice().sort(()=>r()-.5);
  splats.forEach(s=>Paint.apply(a,s));shuffled.forEach(s=>Paint.apply(b,s));
  assert.equal(Paint.hash(a),Paint.hash(b));assert.deepEqual(Paint.coverage(a).cells,Paint.coverage(b).cells);
  // Arrival-order overwrite would not converge: sanity-check that the test would catch it.
  const naive=list=>{const g=Paint.create();list.forEach((s,i)=>Paint.apply(g,{...s,t:i}));return Paint.hash(g);};
  assert.notEqual(naive(splats),naive(shuffled),'the order genuinely differs');
});
test('a newer splat covers an older one; an older one arriving late does not',()=>{
  const g=Paint.create();
  Paint.apply(g,{kind:'blob',x:0,z:-5,r:1,ph:0,team:1,t:2000,slot:1});
  Paint.apply(g,{kind:'blob',x:0,z:-5,r:1,ph:0,team:0,t:1000,slot:0});
  assert.equal(Paint.teamAt(g,0,-5),1,'late old splat ignored');
  Paint.apply(g,{kind:'blob',x:0,z:-5,r:1,ph:0,team:0,t:3000,slot:0});
  assert.equal(Paint.teamAt(g,0,-5),0,'newer splat wins');
});
test('obstacles and the enemy base never take paint; own base stays own',()=>{
  const g=Paint.create();
  Paint.apply(g,{kind:'blob',x:0,z:0,r:1.2,ph:0,team:0,t:10,slot:0});
  assert.equal(Paint.teamAt(g,0,0),-1,'laptop is not paintable');
  Paint.apply(g,{kind:'blob',x:12.5,z:0,r:1.5,ph:0,team:0,t:10,slot:0});
  assert.equal(Paint.teamAt(g,12.5,0),1,'orange cannot paint the blue base');
});
test('rotating chunks bring a grid that missed splats back in line',()=>{
  const host=Paint.create(),guest=Paint.create(),r=Sim.rng(9);
  for(let i=0;i<300;i++){const s={kind:'blob',x:(r()*2-1)*13,z:(r()*2-1)*8,r:.5+r(),ph:r()*6,team:i%2,t:i*20,slot:i%4};Paint.apply(host,s);if(i%5)Paint.apply(guest,s);}
  assert.notEqual(Paint.hash(host),Paint.hash(guest));
  for(let k=0;k<Paint.CHUNKS;k++)Paint.mergeChunk(guest,Paint.encodeChunk(host,k));
  assert.equal(Paint.hash(host),Paint.hash(guest));
});

// ---------- §3 movement, §4 ink ----------
test('run speed on bare floor, fast dive in own ink with refill, slowed and no dive in enemy ink',()=>{
  const g=duel(),me=Game.me(g);
  place(me,-6,2);run(g,1,{mx:1,mz:0,aimX:0,aimZ:2});
  const vRun=Math.hypot(me.vx,me.vz);assert.ok(Math.abs(vRun-C.PLAYER.runSpeed)<0.05,'run '+vRun);
  // Dive on bare floor: nothing happens.
  run(g,0.3,{mx:1,mz:0,dive:true,aimX:0,aimZ:2});assert.equal(me.diving,false,'no diving on bare floor');
  // Own ink: dive → faster, ink refills.
  place(me,-6,-3);paintUnder(g,0,-3,-3,4);me.ink=30;
  run(g,0.6,{mx:1,mz:0,dive:true,aimX:0,aimZ:-3});
  assert.equal(me.diving,true);const vDive=Math.hypot(me.vx,me.vz);
  assert.ok(vDive>=1.7*C.PLAYER.runSpeed,'dive '+vDive);assert.ok(me.ink>40,'ink refilled '+me.ink);
  // Enemy ink: cannot dive, slowed to 2 m/s.
  place(me,-6,6.5);paintUnder(g,1,-4,6.5,3.2);run(g,0.5,{mx:1,mz:0,dive:true,aimX:0,aimZ:6.5});
  assert.equal(me.diving,false,'no diving in enemy ink');assert.ok(Math.hypot(me.vx,me.vz)<=C.PLAYER.enemyInkSpeed+1e-6);
});
test('walls stop movement',()=>{
  const g=duel(),me=Game.me(g);place(me,-4,0);run(g,2,{mx:1,mz:0,aimX:0,aimZ:0});
  assert.ok(me.x<=-2.5-C.PLAYER.radius+0.01,'stopped at the laptop, x='+me.x);
});

// ---------- §5 weapons ----------
test('sprayer: 8 shots a second, 1 ink each, paints ahead, walls block the paint',()=>{
  const g=duel(),me=Game.me(g);place(me,-9,-3);const ink=me.ink;
  run(g,1,{mx:0,mz:0,fire:true,aimX:0,aimZ:-3});
  assert.ok(Math.abs((ink-me.ink)-8)<=1,'spent '+(ink-me.ink));
  run(g,0.6,{mx:0,mz:0,aimX:0,aimZ:-3});
  assert.equal(Paint.teamAt(g.world.paint,-4,-3),0,'floor ahead is orange');
  // Laptop between shooter and target: nothing lands behind it.
  place(me,-5,0);run(g,1.5,{mx:0,mz:0,fire:true,aimX:6,aimZ:0});run(g,0.5,{aimX:6,aimZ:0});
  assert.equal(Paint.teamAt(g.world.paint,3.5,0),-1,'no paint behind the laptop');
});
test('sprayer: three hits down an enemy, who respawns at base after 4 s with spawn protection',()=>{
  const g=duel(),me=Game.me(g),foe=Game.actor(g,1);place(me,-6,5);place(foe,-2,5);
  let steps=0;while(foe.alive&&steps<240){Game.step(g,DT,{fire:true,aimX:foe.x,aimZ:foe.z});steps++;}
  assert.equal(foe.alive,false,'enemy downed');assert.ok(g.feed.some(e=>e.type==='down'&&e.target===1&&e.by===0));
  const downs=g.feed.filter(e=>e.type==='hurt'&&e.target===1).length;assert.equal(downs,2,'two hurts then down (35 × 3)');
  run(g,C.PLAYER.respawnTime-0.1,{});assert.equal(foe.alive,false,'still down before 4 s');
  run(g,0.2,{});assert.equal(foe.alive,true,'back after 4 s');assert.equal(Arena.baseAt(foe.x,foe.z),1,'at own base');
  const hp=foe.hp;Match.hit(g.match,g.world,{target:1,by:0,dmg:35});assert.equal(foe.hp,hp,'spawn protection');
});
test('roller: a press flicks drops for 10 ink; holding rolls a stripe; rolling over an enemy downs it',()=>{
  const g=duel({weapons:['roller','sprayer']}),me=Game.me(g),foe=Game.actor(g,1);place(me,-9,-3);
  const ink=me.ink;Game.step(g,DT,{fire:true,press:1,aimX:0,aimZ:-3});
  assert.ok(Math.abs(ink-me.ink-10)<0.2,'flick costs 10');
  run(g,1,i=>({fire:true,press:1,aimX:me.x+5,aimZ:-3}));
  run(g,1.2,i=>({mx:1,mz:0,fire:true,press:1,aimX:me.x+5,aimZ:-3}));
  assert.equal(Paint.teamAt(g.world.paint,me.x-1.5,-3+0.6),0,'stripe is 1.6 m wide (covers +0.6 off centre)');
  place(foe,me.x+1.4,-3);let n=0;while(foe.alive&&n<60){Game.step(g,DT,{mx:1,mz:0,fire:true,press:1,aimX:me.x+5,aimZ:-3});n++;}
  assert.equal(foe.alive,false,'crushed by the roller');
});

// ---------- §7 match flow ----------
test('countdown freezes players; timer ends the match and the most painted floor wins',()=>{
  const g=Game.create({role:'solo',mySlot:0,duration:60});
  Game.setRoster(g,[{slot:0,team:0,name:'我',weapon:'sprayer',kind:'human',owner:'local'},{slot:1,team:1,name:'对手',weapon:'sprayer',kind:'human',owner:'remote'}]);
  Game.start(g);const me=Game.me(g),x0=me.x;run(g,2,{mx:1,mz:0,aimX:0,aimZ:0});
  assert.equal(me.x,x0,'no movement during the countdown');assert.equal(g.match.phase,'count');
  run(g,1.1,{});assert.equal(g.match.phase,'play');
  run(g,20,{mx:1,mz:0.3,fire:true,aimX:6,aimZ:4});
  run(g,40.2,{});assert.equal(g.match.phase,'judge');
  run(g,0.6,{});assert.equal(g.match.phase,'results');
  const r=g.match.result;assert.equal(r.winner,0);assert.ok(r.share[0]>0&&r.share[1]===0);
  assert.ok(r.share[0]+r.share[1]<=100);
});
test('identical cell counts are a draw',()=>{
  const w=Sim.createWorld();
  Paint.apply(w.paint,{kind:'band',x:-6,z:0,dx:1,dz:0,w:1,l:1,team:0,t:5,slot:0});Paint.apply(w.paint,{kind:'band',x:6,z:0,dx:1,dz:0,w:1,l:1,team:1,t:5,slot:1});
  assert.ok(Paint.coverage(w.paint).cells[0]>0);
  assert.equal(Match.judge(w).winner,-1);
});

// ---------- §8 computer players ----------
test('a 2v2 match of computer players paints the floor and nobody stays stuck',()=>{
  const g=Game.create({role:'solo',mySlot:-1,duration:60,cpuLevel:1,seed:3});
  Game.setRoster(g,Game.fillBots([]));Game.start(g);
  const start=new Map(g.world.actors.map(a=>[a.slot,{x:a.x,z:a.z}]));
  run(g,30,{});
  const c=Paint.coverage(g.world.paint);
  assert.ok(c.share[0]>0.08&&c.share[1]>0.08,'both teams painted '+c.share.map(s=>(s*100).toFixed(1)));
  for(const a of g.world.actors){const s=start.get(a.slot);assert.ok(Math.hypot(a.x-s.x,a.z-s.z)>3||!a.alive,'bot '+a.slot+' left spawn');}
  run(g,34,{});assert.equal(g.match.phase,'results');
});

test('settled results cannot be changed by a late network splat',()=>{
 const g=duel({duration:60});run(g,64,{});assert.equal(g.match.phase,'results');
 const result=structuredClone(g.match.result),before=Paint.hash(g.world.paint);
 Game.receive(g,[{type:'splat',kind:'band',x:6,z:0,dx:1,dz:0,w:3,l:3,team:1,t:999999,slot:1}]);
 assert.equal(Paint.hash(g.world.paint),before,'late paint must not alter the settled floor');assert.deepEqual(g.match.result,result);
});

test('in-flight paint still counts during the settlement grace window',()=>{
 const g=duel({duration:60});run(g,60,{});assert.equal(g.match.phase,'judge');const before=Paint.hash(g.world.paint);
 Game.receive(g,[{type:'splat',kind:'band',x:6,z:0,dx:1,dz:0,w:3,l:3,team:1,t:60000,slot:1}]);
 assert.notEqual(Paint.hash(g.world.paint),before);run(g,3,{});assert.equal(g.match.result.hash,Paint.hash(g.world.paint));
});

test('terminal checkpoint repairs a provisional grid atomically and rejects corrupt bytes',()=>{
 const authoritative=Paint.create(),guest=Paint.create();
 Paint.apply(authoritative,{x:0,z:0,r:1,team:0,slot:0,t:100});
 Paint.apply(guest,{x:0,z:0,r:1,team:1,slot:1,t:999999});
 const data=Paint.encodeFinal(authoritative),expected=Paint.hash(authoritative),before=Paint.hash(guest);
 assert(data.length<60*1024,'final owners fit one latest message');
 assert.equal(Paint.applyFinal(guest,data,expected+1),false);assert.equal(Paint.hash(guest),before);
 assert.equal(Paint.applyFinal(guest,'AA==',expected),false);assert.equal(Paint.hash(guest),before);
 assert.equal(Paint.applyFinal(guest,data,expected),true);assert.equal(Paint.hash(guest),expected);
});
