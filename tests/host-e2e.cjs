'use strict';
// Actual production UDP discovery, real file-send control and byte delivery,
// first-use invitation consent + matching TLS pairing codes, hosted game/SDK.
// No invitation fixture, trust seeding, mock broker or synthesized game results.
// Hidden windows/real CDP keys prove business behavior, not native OS focus or
// physical two-computer networking. Only OS keystore is a disposable AES fixture.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { isDeepStrictEqual } = require('node:util');
const GAME = path.resolve(__dirname, '..');
// Local fixture: a directory with rat-doll-{female,male}.zip character packs (not published).
const PACKS = process.env.PAINT_PACKS_DIR || path.resolve(GAME, '../rat-doll-lab/dist');
const HOST = process.env.PAINT_HOST_ROOT || path.resolve(GAME, '../..');
assert(fs.existsSync(path.join(HOST,'demo/core/peer-session/contracts.js')), 'Set PAINT_HOST_ROOT to the host checkout containing pet.sessions');
const H = require(path.join(HOST, 'tests/e2e-helpers'));
const electron = require(path.join(HOST, 'demo/node_modules/electron'));
const charIds = ['rat-doll-female', 'rat-doll-male'];
const F = require(path.join(HOST, 'tests/helpers/lan-appearance-fixture'));
const { activateButton, activateClosingButton } = require(path.join(HOST, 'tests/e2e/html-card-input'));
let source = path.join(GAME, 'dist/桌宠颜料大作战.html');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-plugin-appearance-peer-delivery-'));
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const evidence = path.join(GAME, 'artifacts/host-e2e', runId);
const bootstrap = path.join(H.REPO, 'tests/helpers/peer-session-delivery-bootstrap.js');
const report = { runId, root, scope: 'Actual three hidden production hosts (room of host + 2 guests) over loopback UDP/TCP/TLS. OS keystore is test AES-GCM only; native Keychain and two physical machines are not covered.', checks: [], failures: [], screenshots: [], dialogs: [], sdkGrants: [], exceptions: [] };
const motionAudit=process.argv.includes('--motion-audit');
let mandatory;
const apps = [], sockets = [];
let runtime;
const json = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2));
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function check(label, detail) { report.checks.push({ label, pass: true, ...(detail === undefined ? {} : { detail }) }); console.log('PASS', label); }
async function wait(fn, label, ms = 30000) { const until = Date.now() + ms; let last; while (Date.now() < until) { try { const value = await fn(); if (value) return value; last = value; } catch (e) { last = e.message; } await H.sleep(100); } throw Error('Timeout: ' + label + '; last=' + JSON.stringify(last)); }
const targets = app => fetch(`http://127.0.0.1:${app.cdp}/json`).then(r => r.json());
const activity = app => { const file = path.join(app.profile, 'activity-hub.json'); return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : { records: [] }; };
const state = app => H.evalIn(app.game, 'window.__paint.state()');
const world = app => H.evalIn(app.game, 'window.__paint.world()');
async function screenshot(page, name) { await H.cdp(page, 'Page.captureScreenshot', {format:'png'}); await H.evalIn(page, 'document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))'); const result = await H.cdp(page, 'Page.captureScreenshot', { format: 'png' }); const file = path.join(evidence, name + '.png'); fs.writeFileSync(file, Buffer.from(result.data, 'base64')); report.screenshots.push(file); }
async function watch(page, label) { const ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; }); ws.onmessage = e => { const m = JSON.parse(e.data); if (m.method === 'Runtime.exceptionThrown') report.exceptions.push({ label, details: m.params.exceptionDetails }); }; ws.send(JSON.stringify({ id: 1, method: 'Runtime.enable' })); sockets.push(ws); }
async function key(page, code, type = 'keyDown') { const key = code.startsWith('Key') ? code.slice(3).toLowerCase() : code === 'Space' ? ' ' : code; await H.cdp(page, 'Input.dispatchKeyEvent', { type, key, code, ...(code === 'ArrowDown' ? { windowsVirtualKeyCode: 40 } : code === 'Space' ? { windowsVirtualKeyCode: 32 } : code === 'Enter' ? { text: '\r', windowsVirtualKeyCode: 13 } : {}) }); }
async function focus(page, selector) { await H.cdp(page, 'Emulation.setFocusEmulationEnabled', { enabled: true }); assert.equal(await H.evalIn(page, `document.querySelector(${JSON.stringify(selector)}).focus();document.activeElement.matches(${JSON.stringify(selector)})`), true); }
async function input(page, selector, text) { await focus(page, selector); await H.cdp(page, 'Input.insertText', { text }); assert.equal(await H.evalIn(page, `document.querySelector(${JSON.stringify(selector)}).value`), text); }
async function boot(label, discovery, peerDiscoveries) {
  const app = { label, profile: path.join(root, label), deviceId: crypto.randomUUID(), name: 'Peer delivery ' + label, cdp: await F.freePort() };
  apps.push(app); fs.mkdirSync(app.profile);
  json(path.join(app.profile, 'device.json'), { deviceId: app.deviceId, name: app.name });
  json(path.join(app.profile, 'friends.json'), { friends: [], pending: [], outgoing: [] });
  json(path.join(app.profile, 'settings-privacy.json'), { version: 1, usageStatsEnabled: false, doNotDisturb: false, verboseLogging: false });
  json(path.join(app.profile, 'config.json'), { character: label === 'a' ? 'qiqi' : 'nienie', petName: app.name,
    me: { petId: 'peer_delivery_' + label }, onboarding: { completed: true },
    behavior: { idleStroll: false, autoSleep: false, edgeSnap: false, petSize: 220 },
    crossScreen: { allowDirectVisits: true, requireVisitConfirmation: false },
    relay: { url: 'ws://127.0.0.1:1', paired: {} }, general: { autoCheckUpdates: false }, tts: { enabled: false },
    plugins: { developerMode: false, registrySources: ['http://127.0.0.1:1/registry.json'] } });
  app.env = { ...process.env,...(mandatory?.env||{}), ELECTRON_RUN_AS_NODE: undefined, PET_USERDATA_DIR: app.profile,
    PET_E2E_TEST: '1', PET_E2E_HIDDEN: '1', PET_E2E_BACKGROUND: '1', PET_DND_TRIGGER_COUNT: '999',
    PET_ACCOUNT_API_BASE: 'http://127.0.0.1:1', PET_ACTIVITY_BRIDGE_PORT: '0',
    PET_LAN_DISCOVERY_PORT: String(discovery), PET_LAN_DISCOVERY_TARGETS: [].concat(peerDiscoveries).map(p => '127.0.0.1:' + p).join(','),
    PET_E2E_LAN_TCP_PORT: String(await F.freePort()), PET_E2E_TF_PORT: String(await F.freePort()) };
  return launch(app);
}
async function launch(app) {
  app.run = { label: app.label + '-run-' + ((app.runs?.length || 0) + 1) }; (app.runs ||= []).push(app.run);
  app.run.native = path.join(evidence, app.run.label + '-native.jsonl'); fs.writeFileSync(app.run.native, '');
  app.child = spawn(electron, ['--require', bootstrap, runtime.demo, `--remote-debugging-port=${app.cdp}`, '--use-mock-keychain', '--mute-audio'], { cwd: runtime.demo, env: { ...app.env, PET_PUBLIC_NATIVE_LOG: app.run.native }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  app.run.pid = app.child.pid; app.child.log = ''; app.child.stdout.on('data', x => { app.child.log += x; }); app.child.stderr.on('data', x => { app.child.log += x; });
  if(mandatory&&app.runs.length===1)await mandatory.login(app.cdp,'1997777666'+(app.label.charCodeAt(0)-96));
  app.pet = await H.findTarget(app.cdp, '/index.html');
  await wait(() => H.evalIn(app.pet, 'typeof currentCharKey==="string" && !!frames.idle?.[0]?.[0]?.naturalWidth'), 'real pet decoded ' + app.label);
  await wait(async () => (await H.evalIn(app.pet, H.CANVAS_PIXELS)) > 100, 'real pet painted ' + app.label);
  await watch(app.pet, app.run.label + '-pet');
  app.overlay = await H.findTarget(app.cdp, '/pet-overlay.html'); await wait(() => H.evalIn(app.overlay, 'typeof petOverlayAPI === "object"'), 'overlay preload ready');
  await screenshot(app.pet, app.run.label + '-pet'); return app;
}
async function stop(app) {
  if (!app.child) return;
  const child = app.child; H.kill(child);
  await wait(() => { try { process.kill(child.pid, 0); return false; } catch (e) { return e.code === 'ESRCH'; } }, 'owned host stopped ' + app.label, 10000);
  fs.writeFileSync(path.join(evidence, app.run.label + '-host.log'), child.log); app.run.exited = true; app.child = null;
}
async function nearby(a, b) { return wait(async () => { const rows = await H.evalIn(a.pet, 'petAPI.lanGetDevices()'); return rows.find(r => r.deviceId === b.deviceId); }, 'actual UDP discovered receiver'); }
async function sendGame(a, b, {share = false} = {}) {
  const previous = new Set(activity(b).records.map(r => r.id));
  const peer = await nearby(a, b); report.discovery = peer;
  await H.evalIn(a.pet, 'petAPI.openDashboard();true'); a.dashboard = await H.findReadyTarget(a.cdp, '/dashboard.html', 'dashboard');
  await wait(() => H.evalIn(a.dashboard, '!!document.querySelector("[data-action=resident-errand], .lan-row[data-via=lan] .lan-errand")'), 'real send entry ready');
  if(await H.evalIn(a.dashboard,'!!document.querySelector("[data-action=resident-errand]")')) {
    await activateButton(a.dashboard,'[data-action=resident-errand]');
    const recipient='[data-friend="'+b.deviceId+'"]';
    await wait(()=>H.evalIn(a.overlay,'!!document.querySelector('+JSON.stringify(recipient)+')'),'real discovered recipient');
    if(!await H.evalIn(a.overlay,'document.querySelector('+JSON.stringify(recipient)+').getAttribute("aria-pressed")==="true"'))await activateButton(a.overlay,recipient);
    // Only this recipient: other discovered devices are invited later from the game's control bar.
    for(const other of apps.filter(x=>x!==a&&x!==b)){const sel='[data-friend="'+other.deviceId+'"]';if(await H.evalIn(a.overlay,'document.querySelector('+JSON.stringify(sel)+')?.getAttribute("aria-pressed")==="true"'))await activateButton(a.overlay,sel);}
  } else {
    await activateClosingButton(a.cdp, a.dashboard, '.lan-row[data-via="lan"] .lan-errand');
  }
  await wait(() => H.evalIn(a.overlay, '!!document.querySelector("#errand-card")'), 'real send card');
  await activateButton(a.overlay, '#errand-card [data-tab="file"]');
  const point = await wait(() => H.evalIn(a.overlay, '(()=>{const e=document.querySelector("#ec-dropzone");if(!e)return null;const r=e.getBoundingClientRect();return r.width&&r.height?{x:r.left+r.width/2,y:r.top+r.height/2}:null;})()'), 'file tab dropzone painted');
  // CDP drag uses actual OS file paths. These are drag target coordinates, never
  // synthesized mouse clicks or pet-window hit-testing.
  const data = { items: [{ mimeType: 'text/html', data: '', title: path.basename(source), baseURL: '' }], files: [source], dragOperationsMask: 1 };
  for (const type of ['dragEnter', 'dragOver', 'drop']) await H.cdp(a.overlay, 'Input.dispatchDragEvent', { type, ...point, data });
  await wait(() => H.evalIn(a.overlay, `document.querySelector('#ec-dropzone .ec-attachment strong')?.textContent===${JSON.stringify(path.basename(source))}`), 'real file selected');
  await input(a.overlay, '#ec-input', '一起涂颜料'); await activateButton(a.overlay, '#ec-go');
  const sendDialog = await wait(async () => { for(const page of (await targets(a)).filter(t=>t.url.includes('/dialog.html'))){const init=await H.evalIn(page,'dialogAPI.getInit()',3000).catch(()=>null);if(init?.peerSessionKind==='send'&&await H.evalIn(page,'!!document.querySelector(".btn-primary") && document.body.innerText.length>10'))return page;}return null; }, 'real send versus share choice');
  await screenshot(sendDialog, share?'send-share-only':'send-and-play'); await activateClosingButton(a.cdp,sendDialog,share?'.btn-secondary':'.btn-primary');
  const incoming = await wait(async () => {
    const record=activity(b).records.find(r => !previous.has(r.id) && r.direction === 'incoming' && r.file?.name === path.basename(source) && r.file.savedPath && fs.existsSync(r.file.savedPath));
    if(record)return record;
    const text=await H.evalIn(a.overlay,'document.querySelector("#errand-card")?.innerText||""');
    return text.includes('发送失败')?{deliveryFailure:text}:null;
  }, 'real received HTML saved', 45000);
  assert(!incoming.deliveryFailure,incoming.deliveryFailure);
  assert.equal(hash(incoming.file.savedPath), hash(source)); assert(incoming.file.htmlWork?.id); report.incoming = incoming;
  check('real send controls deliver identical HTML bytes and persist the received work', { id: incoming.id, artifactHash: incoming.file.htmlWork.id });
  const receipt = await wait(async () => { for (const page of (await targets(b)).filter(t => t.url.includes('/dialog.html'))) if (await H.evalIn(page, '!!document.querySelector("[data-work-open]")').catch(() => false)) return page; return null; }, 'real work receipt');
  assert(!(await targets(b)).some(t => t.url.startsWith('pet-work:') && !t.url.includes('thumbnail=1')), 'receipt must not execute before opening');
  await screenshot(receipt, 'received-game-before-open');
  await activateClosingButton(b.cdp, receipt, '[data-work-open]');
}
// Every message the game shows in its error bar (it auto-hides after 7 s, so record rather than poll).
const recordErrors=page=>H.evalIn(page,'(()=>{if(window.__errorsSeen)return true;window.__errorsSeen=[];const e=document.getElementById("error");new MutationObserver(()=>{if(!e.hidden&&e.textContent)window.__errorsSeen.push(e.textContent);}).observe(e,{attributes:true,childList:true,characterData:true,subtree:true});return true;})()');
async function assertNoErrors(apps,label){for(const app of apps){const seen=await H.evalIn(app.game,'window.__errorsSeen||[]');assert.deepEqual(seen,[],label+': error bar on '+app.label);}}
function classifyDialog(init, text) {
  if (['pair', 'accept'].includes(init.peerSessionKind)) return init.peerSessionKind;
  if (text.includes('请求桌宠能力')) return 'sdk';
  if (/(?:[0-9A-F]{4}[ -]){3}[0-9A-F]{4}/i.test(text)) return 'pair';
  if (/加入.*(?:对局|游戏)|接受.*邀请|邀请.*联机|一起.*玩|联机邀请/.test(init.title || text)) return 'accept';
  return null;
}
async function approvals(a, b, expectPair = true) {
  const seen = new Set(), pairing = new Map(); let accepted = 0, sdk = 0, paired = false;
  await wait(async () => {
    for (const app of [a, b]) for (const page of (await targets(app)).filter(t => t.url.includes('/dialog.html') && !seen.has(t.id))) {
      const init = await H.evalIn(page, 'dialogAPI.getInit()', 3000).catch(() => null); if (!init) continue;
      const text = await H.evalIn(page, 'document.body.innerText'); if(!text.trim())continue; const kind = classifyDialog(init, text); if (!kind || kind==='pair'&&!/(?:[0-9A-F]{4}[ -]){3}[0-9A-F]{4}/i.test(text)) continue;
      seen.add(page.id); report.dialogs.push({ app: app.label, kind, title: init.title, text }); await screenshot(page, app.label + '-' + kind + '-' + seen.size);
      if (kind === 'pair') { assert(expectPair, 'trusted peers must not pair again'); pairing.set(app.label, { app, page, code: text.match(/(?:[0-9A-F]{4}[ -]){3}[0-9A-F]{4}/i)[0].replaceAll(' ', '').replaceAll('-', '').toLowerCase() }); }
      else { if (kind === 'sdk') {sdk++;report.sdkGrants.push(app.label);} else accepted++; await activateClosingButton(app.cdp, page, '.btn-primary'); }
    }
    if (pairing.size === 2 && !paired) { const [left, right] = [...pairing.values()]; assert.equal(left.code, right.code); assert.equal(left.code.length, 16); await activateClosingButton(left.app.cdp, left.page, '.btn-primary'); await activateClosingButton(right.app.cdp, right.page, '.btn-primary'); paired = true; check('both independently presented TLS pairing codes match before explicit confirmations'); }
    const pages = await Promise.all([a, b].map(async app => { const page = (await targets(app)).find(t => t.url.startsWith('pet-work:') && !t.url.includes('thumbnail=1')); if (!page) return null; if(app.game?.id!==page.id){app.game=page;await H.cdp(page,'Emulation.setFocusEmulationEnabled',{enabled:true});await H.cdp(page,'Page.captureScreenshot',{format:'png'});await recordErrors(page);} const ready = await H.evalIn(page, '(()=>{const s=window.__paint?.state();return s?.session==="lan"&&s.mode==="lobby"&&!document.querySelector("#lobby-panel").hidden&&document.querySelectorAll("#lobby-teams .seat.you").length===1;})()', 3000).catch(() => false); if (ready) { app.game = page; return page; } return null; }));
    return pages.every(Boolean);
  }, 'invitation, first pairing, SDK permission and current pets', 65000);
  assert(accepted >= 1, 'recipient must accept each game invitation'); assert(!expectPair || paired); if(expectPair)assert([a.label,b.label].every(label=>report.sdkGrants.includes(label)), 'both fresh hosts require explicit SDK consent, including initial share-only approval');
  for (const app of [a, b]) { await watch(app.game, app.label + '-game'); assert.equal(await H.evalIn(app.game, '!document.querySelector("#server-address,#room-code") && document.querySelector("#title-panel").hidden'), true); const context = await H.evalIn(app.game, 'pet.sessions.getContext()'); assert.equal(context.role, app === a ? 'host' : 'guest'); assert.equal(context.artifactHash, hash(source)); app.context = context; }
  // The host context keeps the first invitation; each later guest has its own, listed in the host's peers.
  if (a.context.peers.length === 1) assert.equal(a.context.invitationId, b.context.invitationId);
  assert.equal(a.context.maxPlayers, 4); assert.equal(b.context.maxPlayers, 4);
  assert(a.context.peers.some(p => p.displayName === b.name && p.status === 'connected'), 'host lists this guest as connected');
  check('real invite binds ' + b.label + ' to the host room: exact artifact, host referee, guest seat');
}
async function installAppearances(app) {
  await H.evalIn(app.pet, 'petAPI.openSettings("plugins");true');
  app.settings = await H.findReadyTarget(app.cdp, '/settings.html', 'settings');
  for (const id of charIds) {
    const archive = path.join(PACKS, id + '.zip');
    await H.evalIn(app.settings, `window.goldInstall=null;settings.pluginsInstallZip(${JSON.stringify(archive)}).then(r=>window.goldInstall=r);true`);
    await wait(async () => {
      const result = await H.evalIn(app.settings, 'window.goldInstall');
      if (result) { assert(result.ok, JSON.stringify(result)); return true; }
      for (const page of (await targets(app)).filter(t => t.url.includes('/dialog.html'))) {
        if (await H.evalIn(page, '!!document.querySelector(".btn-primary")').catch(() => false)) await activateClosingButton(app.cdp, page, '.btn-primary');
      }
      return false;
    }, 'appearance ZIP install ' + id);
  }
  const installed = await H.evalIn(app.settings, 'settings.pluginsList()');
  assert.deepEqual(installed.map(p => p.id).sort(), charIds.slice().sort());
  assert(installed.every(p => p.version === JSON.parse(fs.readFileSync(path.join(PACKS, '../exports/plugins', p.id, 'manifest.json'))).version));
  check(app.label + ' installs both current appearance packages; game is not installed', installed.map(p => ({ id:p.id, version:p.version })));
}
async function applyMain(app, id) {
  await H.evalIn(app.settings, `settings.pluginsTogglePanel(${JSON.stringify(id)});true`);
  const page = await H.findReadyTarget(app.cdp, '/' + id + '/panel.html', 'pet');
  await wait(() => H.evalIn(page, 'document.querySelector("#actor").naturalWidth>0 && document.querySelector("#companion").textContent!=="—"'), 'appearance ready');
  if (await H.evalIn(app.pet, `currentCharKey!==${JSON.stringify(id)}`)) await activateButton(page, '#apply');
  await wait(() => H.evalIn(app.pet, `currentCharKey===${JSON.stringify(id)} && !!frames.idle?.[0]?.[0]?.naturalWidth`), 'main pet applied');
  assert(await H.evalIn(app.pet, H.CANVAS_PIXELS) > 100);
  await screenshot(app.pet, 'main-' + app.label + '-' + id);
  await activateClosingButton(app.cdp, page, '#close');
}
async function closeWork(app) {
  const controls = await H.findTarget(app.cdp, '/work-player.html');
  await activateClosingButton(app.cdp, controls, '[data-work-exit]');
}
// ---------------- paint-specific ----------------
async function inviteFromControls(a,c){
  // The host's work-player control bar ("+ Invite n/4") invites a third device into the open room.
  const previous=new Set(activity(c).records.map(r=>r.id));
  const controls=await H.findTarget(a.cdp,'/work-player.html');
  await wait(async()=>{const b=await H.evalIn(controls,'(()=>{const b=document.querySelector("[data-work-invite]");return b&&!b.disabled&&b.textContent})()');return b&&b.includes('2/4');},'host invite control enabled at 2/4');
  await screenshot(controls,'10-host-controls-2of4');
  const gameId=a.game.id,origin=await H.evalIn(a.game,'performance.timeOrigin');
  await activateButton(controls,'[data-work-invite]');
  const picker=await wait(async()=>{for(const page of (await targets(a)).filter(t=>t.url.includes('/dialog.html'))){const init=await H.evalIn(page,'dialogAPI.getInit()',3000).catch(()=>null);if(init?.peerSessionKind==='room-invite'&&await H.evalIn(page,'!!document.querySelector(".btn-primary")'))return page;}return null;},'device picker');
  const text=await H.evalIn(picker,'document.body.innerText');assert(text.includes(c.name)&&!text.includes(apps[1].name),'picker offers only devices not yet in the room');
  await screenshot(picker,'11-room-invite-picker');await activateClosingButton(a.cdp,picker,'.btn-primary');
  const incoming=await wait(()=>activity(c).records.find(r=>!previous.has(r.id)&&r.direction==='incoming'&&r.file?.name===path.basename(source)&&r.file.savedPath&&fs.existsSync(r.file.savedPath)),'third device receives the same HTML',45000);
  assert.equal(hash(incoming.file.savedPath),hash(source));
  const receipt=await wait(async()=>{for(const page of (await targets(c)).filter(t=>t.url.includes('/dialog.html')))if(await H.evalIn(page,'!!document.querySelector("[data-work-open]")').catch(()=>false))return page;return null;},'work receipt on c');
  await activateClosingButton(c.cdp,receipt,'[data-work-open]');
  await approvals(a,c,false);
  assert.equal(a.game.id,gameId);assert.equal(await H.evalIn(a.game,'performance.timeOrigin'),origin,'host game never reloaded');
  check('control-bar invite brings a third host into the open room without reloading the host game');
}

const {connect}=require('./cdp.cjs');
// Real keys through one persistent CDP session per game: walk a loop of directions while
// holding the fire key (J), dive (Shift) every few seconds.
async function play(app,ms){
  const s=app.cdpS??=await connect(app.game);const seq=['KeyD','KeyS','KeyA','KeyW'];const until=Date.now()+ms;let i=app.label.charCodeAt(0)%4;
  await s.key('KeyJ');
  while(Date.now()<until){const k=seq[i++%4];await s.key(k);await H.sleep(900);await s.key(k,'keyUp');
    if(i%3===0){await s.key('KeyJ','keyUp');await s.key('ShiftLeft');await s.key(k);await H.sleep(500);await s.key(k,'keyUp');await s.key('ShiftLeft','keyUp');await s.key('KeyJ');}}
  await s.key('KeyJ','keyUp');
}
async function paintPlay(a,b,c){
  const all=[a,b,c];
  // Each game reads its own desktop pet; every screen draws every human with that human's kind.
  const kinds={};for(const app of all){const st=await wait(async()=>{const x=await state(app);return x.driver?.kind&&x.actors.length===3?x:null;},'driver + 3-human lobby '+app.label,60000);kinds[app.label]=st.driver.kind;}
  const slotOf={a:0,b:1,c:2};
  for(const app of all)await wait(async()=>{const p=(await world(app)).players;return [0,1,2].every(n=>p.find(x=>x.slot===n)?.kind===kinds['abc'[n]]);},'every human drawn with its own kind on '+app.label,90000);
  check('three hosts in one lobby; each pet is drawn as its own 2D / 3D kind on every screen',kinds);
  for(const app of all)await screenshot(app.game,'12-lobby-'+app.label);
  // Host-only duration; guests cannot change it.
  assert.equal(await H.evalIn(b.game,'document.querySelector(\'#lobby-time [data-value="60"]\').disabled'),true);
  await activateButton(a.game,'#lobby-time [data-value="60"]');
  await activateButton(a.game,'#ready');await activateButton(b.game,'#ready');await H.sleep(1500);
  assert.equal((await state(c)).phase,'lobby','two of three ready does not start');
  await activateButton(c.game,'#ready');
  await wait(async()=>{for(const app of all)if((await state(app)).phase!=='count')return false;return true;},'all counting down',8000);
  const roster=(await state(a)).actors;assert.equal(roster.length,4);assert.equal(roster.filter(x=>x.kind==='bot').length,1);
  check('the match starts only when all three are ready; a computer player fills 2v2');
  await wait(async()=>(await state(a)).phase==='play','play',8000);
  await Promise.all(all.map(app=>play(app,8000)));
  const cov=[];for(const app of all)cov.push((await state(app)).coverage.cells);
  assert(cov[0][0]+cov[0][1]>300,'real keys painted the floor '+JSON.stringify(cov[0]));
  for(const app of all)await screenshot(app.game,'13-play-'+app.label);
  check('three real keyboards move, shoot and paint',cov);
  await Promise.all(all.map(app=>play(app,40000)));
  await wait(async()=>{for(const app of all)if((await state(app)).phase!=='results')return false;return true;},'results everywhere',60000);
  await H.sleep(1500);
  const res=[];for(const app of all)res.push(await state(app));
  const r=res[0].result;assert(r&&r.hash);
  for(const x of res){assert.deepEqual(x.result.share,r.share);assert.equal(x.hash,r.hash,'turf identical to the host result');}
  check('identical result and identical turf (grid hash) on all three hosts',{share:r.share,winner:r.winner,hash:r.hash});
  for(const app of all)await screenshot(app.game,'14-results-'+app.label);
  await assertNoErrors(all,'match');check('no error message on any host through lobby, match and results');
  const net=res.map(x=>x.net);report.net=net;
  // Guest c leaves at the results: its player becomes a computer; the host starts again with b.
  await activateButton(c.game,'#leave');
  await wait(async()=>(await state(a)).actors.find(x=>x.slot===2)?.kind==='bot','c taken over by a computer',20000);
  await activateButton(a.game,'#again');
  await wait(async()=>(await state(b)).phase==='count','rematch countdown reaches b',10000);
  check('a guest leaving is taken over by a computer; the host starts a rematch');
  await closeWork(a);
  await wait(async()=>{const x=await state(b);return x.session===null||x.phase==='closed';},'host closing ends the room for b',20000);
  await screenshot(b.game,'15-host-closed');check('host closing the game ends the room for the remaining guest');
  for(const app of all)app.cdpS?.close();
}
(async()=>{
  fs.mkdirSync(evidence,{recursive:true});
  try{
    H.requireNode22();assert(fs.existsSync(source),'build first');mandatory=await require(path.join(HOST,'tests/helpers/mandatory-login-fixture')).createMandatoryLoginFixture();if(motionAudit){source=require('./remote-motion-audit.cjs').prepare(source,'paint',report);}report.gameSha256=hash(source);
    runtime=F.freeze(H.REPO,root,false);report.source=runtime.source;
    const ap=await F.freePort(),bp=await F.freePort(),cp=await F.freePort();
    if(motionAudit){const a=await boot('a',ap,[bp]),b=await boot('b',bp,[ap]);await sendGame(a,b);await approvals(a,b,false);await require('./remote-motion-audit.cjs').run({kind:'paint',a,b,H,wait,state,activateButton,check,screenshot,json,evidence,report,closeWork});}else{
    const a=await boot('a',ap,[bp,cp]),b=await boot('b',bp,[ap,cp]),c=await boot('c',cp,[ap,bp]);
    for(const app of [a,b])await installAppearances(app);
    await applyMain(a,'rat-doll-male');await applyMain(b,'rat-doll-female');
    await nearby(a,c);await sendGame(a,b);await approvals(a,b,false);await inviteFromControls(a,c);await paintPlay(a,b,c);
    }
  }catch(error){
    report.failures.push(error.message);report.error=error.stack;console.error(error);
    for(const app of apps){const list=await targets(app).catch(()=>[]);json(path.join(evidence,app.label+'-targets.json'),list.map(t=>({type:t.type,url:t.url,title:t.title})));
      for(const c of list.filter(t=>t.url.includes('/work-player.html')))json(path.join(evidence,app.label+'-work-player.json'),await H.evalIn(c,'({text:document.body.innerText,state:window.__state||null})',3000).catch(e=>({error:e.message})));
      json(path.join(evidence,app.label+'-work-inspect.json'),await (async()=>{const chat=list.find(t=>t.url.includes('/chat.html'));return chat?await H.evalIn(chat,'chatAPI.e2eInspectHtmlWork?.()',3000).catch(e=>({error:e.message})):'no chat';})());}
    for(const app of apps)for(const page of await targets(app).catch(()=>[]))if(page.type==='page'&&page.url.startsWith('pet-work:')){
      json(path.join(evidence,app.label+'-failure.json'),await H.evalIn(page,'({text:document.body.innerText.slice(0,3000),paint:window.__paint?.state(),world:window.__paint?.world()})',3000).catch(e=>({error:e.message})));
      await screenshot(page,app.label+'-failure').catch(()=>{});
    }
  }finally{
    if(mandatory)await mandatory.close();for(const ws of sockets)ws.close();
    for(const app of apps)await stop(app).catch(e=>report.failures.push('cleanup: '+e.message));
    if(report.exceptions.length)report.failures.push('uncaught renderer exceptions');
    report.ok=!report.failures.length;json(path.join(evidence,'report.json'),report);
    console.log('REPORT',path.join(evidence,'report.json'),report.ok?'OK':'FAIL');process.exitCode=report.ok?0:1;
  }
})().then(()=>process.exit(process.exitCode||0));
