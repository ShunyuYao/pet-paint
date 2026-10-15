'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm');
test('internet and explicit LAN artifacts match runtime, vendor and exact build receipts',()=>{
 const root=path.resolve(__dirname,'..'),protocol=require('../game/net.js').PROTOCOL;
 for(const lane of ['auto','lan']){
  const meta=JSON.parse(fs.readFileSync(path.join(root,'dist',lane==='auto'?'build.json':'build-lan.json'))),html=fs.readFileSync(path.join(root,meta.file),'utf8');
  assert.equal(meta.version,require('../package.json').version);assert.equal(meta.bytes,Buffer.byteLength(html));assert.equal(meta.sha256,crypto.createHash('sha256').update(html).digest('hex'));
  const sdk=JSON.parse(html.match(/id="pet-sdk">([^<]+)</)[1]);assert.equal(sdk.version,2);assert.deepEqual(sdk.interaction.protocol,protocol);assert.deepEqual(meta.protocol,protocol);assert.equal(sdk.interaction.players,4);assert.equal(sdk.interaction.transport,lane);assert.equal(meta.transport,lane);
  assert.equal(meta.kitVersion,require('../vendor/pet-kit/verify.cjs').check(root));assert.equal(meta.kitManifestSha256,crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'vendor/pet-kit/VERSION.json'))).digest('hex'));
  assert(!/__STYLE__|__SCRIPT__|__kartRenderProbe|__kartPollDelay|__paintMotionProbe/.test(html));new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]);
 }
});
