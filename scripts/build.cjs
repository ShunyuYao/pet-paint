'use strict';
// Bundle everything into ONE inline <script> (the host's HTML-work CSP only allows
// hashed inline scripts: no CDN, no blob: modules, no workers, no fetch).
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const esbuildPath=process.env.PET_PAINT_ESBUILD||path.resolve(root,'../../demo/node_modules/esbuild');
const esbuild=require(esbuildPath);
(async()=>{
  const result=await esbuild.build({entryPoints:[path.join(root,'src/main.js')],bundle:true,format:'iife',platform:'browser',target:['chrome120'],minify:true,write:false,legalComments:'inline',logLevel:'warning'});
  const js=result.outputFiles[0].text.replace(/<\/script/gi,'<\\/script');
  const css=fs.readFileSync(path.join(root,'src/style.css'),'utf8');
  const html=fs.readFileSync(path.join(root,'src/template.html'),'utf8').replace('__STYLE__',()=>css).replace('__SCRIPT__',()=>js);
  if(/__STYLE__|__SCRIPT__/.test(html))throw Error('template placeholders left');
  const bytes=Buffer.byteLength(html);if(bytes>10*1024*1024)throw Error('HTML exceeds host 10 MB limit');
  const out=path.join(root,'dist/桌宠颜料大作战.html');fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,html);
  const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
  const info={file:path.relative(root,out).split(path.sep).join('/'),bytes,sha256:crypto.createHash('sha256').update(html).digest('hex'),version:pkg.version,protocol:{id:'pet-paint',version:1},esbuild:require(path.join(esbuildPath,'package.json')).version,three:'0.164.1',cannon:'0.20.0'};
  fs.writeFileSync(path.join(root,'dist/build.json'),JSON.stringify(info,null,2));console.log(JSON.stringify(info,null,2));
})().catch(e=>{console.error(e);process.exit(1);});
