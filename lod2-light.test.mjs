import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {lod2LightStatus} from './readiness.mjs';
import * as readinessFns from './readiness.mjs';
import * as geoFns from './geo-data.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const readProj = name => readFile(path.join(dir, name), 'utf8');

test('status distinguishes success, failure, off-target, unconfirmed and pending', ()=>{
  assert.match(lod2LightStatus({hasMap:true,target:'lod2',applied:true,requested:true,buildings:'available'}).text, /適用中/);
  assert.match(lod2LightStatus({hasMap:true,target:'lod2',applied:true,requested:true,buildings:'available'}).text, /実際の天候を示さない/);
  assert.match(lod2LightStatus({hasMap:true,target:'lod2',applied:false,requested:false,buildings:'available'}).text, /通常表示/);
  assert.match(lod2LightStatus({hasMap:true,target:'lod2',applied:false,requested:true,buildings:'available'}).text, /未適用/);
  const off = lod2LightStatus({hasMap:true,target:'other',applied:null,requested:false,buildings:'available'});
  assert.match(off.text, /対象外/);
  assert.equal(off.toggleDisabled, true);
  assert.equal(off.applyDisabled, true);
  const failed = lod2LightStatus({hasMap:true,target:'lod2',applied:false,requested:true,buildings:'error'});
  assert.match(failed.text, /失敗/);
  assert.equal(failed.applyDisabled, true);
  const loading = lod2LightStatus({hasMap:true,target:'lod2',applied:true,requested:true,buildings:'loading'});
  assert.match(loading.text, /読み込み中/);
  assert.equal(loading.applyDisabled, true);
  const flying = lod2LightStatus({hasMap:true,target:'lod2',applied:true,requested:true,buildings:'available',flightActive:true});
  assert.match(flying.text, /飛行中/);
  assert.equal(flying.applyDisabled, true);
  const unknown = lod2LightStatus({hasMap:true,target:null,applied:null,requested:false,buildings:'available'});
  assert.match(unknown.text, /未確認/);
  assert.equal(unknown.applyDisabled, true);
  const none = lod2LightStatus({hasMap:false});
  assert.equal(none.text, '');
  assert.equal(none.toggleDisabled, true);
});

async function harness(){
  const source=(await readFile(new URL('./app.js',import.meta.url),'utf8')).replace(/^import .*?;\s*/gm, '');
  const net={calls:[],areaCalls:[],requested:null,light:{requested:false,applied:null,target:null},flying:false,
    reply:{sora:'A',nagi:'A',validation:{state:'accepted',reason:'ok'}},fresh:{observed:3,unknown:0,blockedIndices:[],total:3,maxGap:20},hazards:[]};
  const elements=new Map();
  function el(id){
    if(!elements.has(id)){
      const isCanvas = id==='scene' || id==='detection-overlay' || id.endsWith('-canvas') || id.endsWith('-preview');
      elements.set(id,{
        id, textContent:'', value:'', checked:false, disabled:false, hidden:false, style:{}, dataset:{}, classList:{values:new Set(),add(v){this.values.add(v)},remove(v){this.values.delete(v)},toggle(v){if(this.values.has(v)){this.values.delete(v);return false}this.values.add(v);return true},contains(v){return this.values.has(v)}}, handlers:{},attributes:{},
        addEventListener(type,cb){this.handlers[type]=cb}, setAttribute(n,v){this.attributes[n]=v}, removeAttribute(n){delete this.attributes[n]}, getAttribute(n){return this.attributes[n]},
        querySelector(){return null}, querySelectorAll(){return []}, kids:[], replaceChildren(...nodes){this.kids=nodes.length?nodes:[];this.textContent=this.kids.map(n=>n.textContent||'').join('\n')}, append(...nodes){this.kids.push(...nodes);this.textContent=this.kids.map(n=>n.textContent||'').join('\n')}, focus(){}, click(){ this.handlers.click?.({preventDefault(){}}); },
        getContext: isCanvas ? (()=>({setTransform(){},drawImage(){},clearRect(){},fillRect(){},measureText(){return {width:0}}, fillText(){}})) : undefined,
        toDataURL: isCanvas ? (()=> 'data:image/png;base64,AA==') : undefined,
        width: isCanvas ? 800 : undefined, height: isCanvas ? 600 : undefined
      });
    }
    return elements.get(id);
  }
  let tmpSeq = 0;
  const ctx={
    document:{getElementById:el,createElement:()=>el('tmp-'+(tmpSeq++)),querySelector:()=>null,querySelectorAll:()=>[]},
    window:{}, navigator:{mediaDevices:{getUserMedia: async()=>({getTracks:()=>[]})}},
    ResizeObserver:class{observe(){}}, MediaRecorder:class{constructor(){this.state='inactive'} start(){this.state='recording'} stop(){this.state='inactive';queueMicrotask(()=>this.onstop?.())}},
    requestAnimationFrame(cb){return 0}, cancelAnimationFrame(id){},
    devicePixelRatio: 1,
    setTimeout(ms){return 0}, clearTimeout(id){}, setInterval(cb,ms){return 0}, clearInterval(id){}, queueMicrotask, performance, Blob, btoa,
    AbortSignal:{timeout(ms){return {aborted:false, addEventListener(){}, removeEventListener(){}, throwIfAborted(){}}}, any(signals){return {aborted:false, addEventListener(){}, removeEventListener(){}, throwIfAborted(){}}}},
    AbortController,
    localStorage:{store:{},getItem(k){return Object.hasOwn(this.store,k)?this.store[k]:null},setItem(k,v){this.store[k]=String(v)},removeItem(k){delete this.store[k]}},
    URL, fetch: async(url,options)=>{ net.calls.push(String(url)); if(String(url).includes('/api/map-plan'))return {ok:true,json:async()=>({result:net.reply})}; return {ok:true,json:async()=>({enabled:true}), text:async()=>''}; },
    positionAt:()=>({}), progressBeforeReplan:()=>0, makeCity:()=>({}), fitImage:(c)=>c, isValidRoute:()=>true,
    readPlanStream:async function*(){}, configureSpeech:()=>{}, trackSpeech:()=>{}, initialCamera:()=>({view:'wide'}), beginFlight:()=>({view:'follow'}), selectCamera:()=>({}), deliveryCamera:()=>({}),
    canReplayMapRoute:()=>true, secondFleetCandidates:()=>[], jmaWarningLink:()=> '#',
    requestDraft:()=>({supply:null,quantity:null}), simulationManifest:()=>({}), suggestRequest:()=>({}), suggestShelters:()=>[], mapFloodContext:()=>'', mapConsultHistoryContext:()=>'', mapMissionSteps:()=>['pending','pending','pending','pending'], mapMissionDistance:()=>'', mapMissionEvidence:()=>'', mapRouteSummary:()=>'', fleetStatus:()=>'', fleetPosition:()=>null, createMapScan:()=>({invalidate(){} , run(){}}), createMapConsultation:()=>({invalidate(){} , run(){}}), createFacilityFloodTracker:()=>({select(){}, getStatus(){return ''}}), createWorld:()=>({update(){}}),
    AudioContext:class{async decodeAudioData(){return {sampleRate:24000,getChannelData:()=>new Float32Array([0])}} async close(){}},
    detourEvidencePayload:(...a)=>readinessFns.detourEvidencePayload(...a),
    summarizeDetourValidation:(...a)=>readinessFns.summarizeDetourValidation(...a),
    detourTeamRecord:(...a)=>readinessFns.detourTeamRecord(...a),
    detourRecordText:(...a)=>readinessFns.detourRecordText(...a),
    pastDetourNote:(...a)=>readinessFns.pastDetourNote(...a),
    reinspectVerdict:(...a)=>readinessFns.reinspectVerdict(...a),
    detourRelevanceForSecond:(...a)=>readinessFns.detourRelevanceForSecond(...a),
    hazardNearPointsM:(...a)=>readinessFns.hazardNearPointsM(...a),
    lod2LightStatus:(...a)=>readinessFns.lod2LightStatus(...a),
    mapSimulationPath:(...a)=>geoFns.mapSimulationPath(...a),
    routeSamplePoints:(...a)=>geoFns.routeSamplePoints(...a),
  };
  ctx.__net = net;
  vm.runInNewContext(source, ctx);
  await new Promise(r=> setImmediate(r));
  return {el, ctx, net, run:(code)=> vm.runInNewContext(code, ctx)};
}

function armMap(h, light={requested:false,applied:null,target:null}, buildings='available', flying=false){
  h.net.light = {...light};
  h.net.areaCalls = [];
  h.net.requested = null;
  h.run(`mapSourceEvidence={buildings:'${buildings}'};
    realMap={setLod2LightRequested:(v)=>{__net.requested=v;__net.light.requested=!!v;return !!v},
      lod2LightState:()=>({...__net.light}),
      setArea:(a)=>{__net.areaCalls.push(a && a.code ? a.code : a);return true},
      mapFlightActive:()=>__net.flying};`);
  h.run(`__net.flying=${flying?'true':'false'}; syncLod2Light();`);
}

test('selecting the toggle stores the choice without refetching', async()=>{
  const h = await harness();
  armMap(h, {requested:false,applied:false,target:'lod2'});
  h.el('lod2-light-toggle').checked = true;
  h.el('lod2-light-toggle').handlers.change();
  assert.equal(h.net.requested, true);
  assert.deepEqual(h.net.areaCalls, []);
  assert.match(h.el('lod2-light-status').textContent, /未適用/);
});

test('the apply button refetches the current area once', async()=>{
  const h = await harness();
  armMap(h, {requested:true,applied:false,target:'lod2'});
  h.el('lod2-light-apply').handlers.click();
  assert.deepEqual(h.net.areaCalls, [h.run('activeArea')]);
});

test('apply is disabled while flying or loading and never refetches then', async()=>{
  const h = await harness();
  armMap(h, {requested:true,applied:false,target:'lod2'}, 'available', true);
  assert.equal(h.el('lod2-light-apply').disabled, true);
  assert.match(h.el('lod2-light-status').textContent, /飛行中/);
  h.el('lod2-light-apply').handlers.click();
  assert.deepEqual(h.net.areaCalls, []);
  const g = await harness();
  armMap(g, {requested:true,applied:null,target:null}, 'loading');
  assert.equal(g.el('lod2-light-apply').disabled, true);
  assert.match(g.el('lod2-light-status').textContent, /読み込み中/);
  g.el('lod2-light-apply').handlers.click();
  assert.deepEqual(g.net.areaCalls, []);
});

test('applied state follows creation, not selection', async()=>{
  const h = await harness();
  armMap(h, {requested:true,applied:false,target:'lod2'});
  assert.match(h.el('lod2-light-status').textContent, /未適用/);
  h.net.light = {requested:true,applied:true,target:'lod2'};
  h.run('syncLod2Light()');
  assert.match(h.el('lod2-light-status').textContent, /適用中/);
  assert.match(h.el('lod2-light-status').textContent, /実際の天候を示さない/);
});

test('off-target areas disable both controls with a reason', async()=>{
  const h = await harness();
  armMap(h, {requested:false,applied:null,target:'other'});
  assert.equal(h.el('lod2-light-toggle').disabled, true);
  assert.equal(h.el('lod2-light-apply').disabled, true);
  assert.match(h.el('lod2-light-status').textContent, /対象外/);
});

test('failure and unconfirmed states are told apart', async()=>{
  const h = await harness();
  armMap(h, {requested:true,applied:false,target:'lod2'}, 'error');
  assert.match(h.el('lod2-light-status').textContent, /失敗/);
  assert.equal(h.el('lod2-light-apply').disabled, true);
  const g = await harness();
  armMap(g, {requested:false,applied:null,target:null}, 'available');
  assert.match(g.el('lod2-light-status').textContent, /未確認/);
  assert.equal(g.el('lod2-light-apply').disabled, true);
});

test('selecting OFF after apply shows unapplied and keeps apply enabled', ()=>{
  const state = lod2LightStatus({hasMap:true,target:'lod2',applied:true,requested:false,buildings:'available'});
  assert.match(state.text, /未適用/);
  assert.equal(state.toggleDisabled, false);
  assert.equal(state.applyDisabled, false);
});

test('apply is disabled when the selection matches the rendered value', ()=>{
  const on = lod2LightStatus({hasMap:true,target:'lod2',applied:true,requested:true,buildings:'available'});
  assert.match(on.text, /適用中/);
  assert.match(on.text, /実際の天候を示さない/);
  assert.equal(on.applyDisabled, true);
  const off = lod2LightStatus({hasMap:true,target:'lod2',applied:false,requested:false,buildings:'available'});
  assert.match(off.text, /通常表示/);
  assert.equal(off.applyDisabled, true);
});

test('applied tiles with partial failure are shown as applied, not failed', ()=>{
  const partial = lod2LightStatus({hasMap:true,target:'lod2',applied:true,requested:true,buildings:'error'});
  assert.match(partial.text, /適用中/);
  assert.match(partial.text, /一部/);
  assert.equal(partial.applyDisabled, true);
  const offPartial = lod2LightStatus({hasMap:true,target:'lod2',applied:true,requested:false,buildings:'error'});
  assert.match(offPartial.text, /未適用/);
  assert.match(offPartial.text, /一部/);
  assert.equal(offPartial.applyDisabled, true);
});
test('off selection with partial failure points to region refresh, not the disabled apply', ()=>{
  const s = lod2LightStatus({hasMap:true,target:'lod2',applied:true,requested:false,buildings:'error'});
  assert.match(s.text, /未適用/);
  assert.match(s.text, /適用済み/);
  assert.match(s.text, /この地域の情報を再取得/);
  assert.ok(!s.text.includes('反映ボタン'), 'must not guide to the disabled button');
  assert.equal(s.applyDisabled, true);
});
test('brightness applies at creation only, LOD3 look untouched (structural supplement)', async()=>{
  const source = await readProj('real-map.mjs');
  assert.equal(source.split('sphericalHarmonicCoefficients').length - 1, 2);
  assert.ok(source.includes('new C.Cartesian3(1.2,1.2,1.2)'), 'LOD3 keeps 1.2');
  assert.ok(source.includes('new C.Cartesian3(0.6,0.6,0.6)'), 'LOD2 requests 0.6');
  assert.ok(!source.includes('setLodLighting'), 'no dynamic lighting switch from the failed attempt');
});

test('controls and reset notice stay on the same appearance panel', async()=>{
  const html = await readProj('index.html');
  assert.ok(html.includes('id="lod2-light-toggle"'));
  assert.ok(html.includes('id="lod2-light-apply"'));
  assert.ok(html.includes('id="lod2-light-status"'));
  assert.ok(html.includes('再取得で施設・拠点・仮想便が消えます'));
  assert.ok(html.includes('LOD3の見た目は変えません'));
});
