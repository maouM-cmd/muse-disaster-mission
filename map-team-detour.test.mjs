import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {detourEvidencePayload,summarizeDetourValidation,detourTeamRecord,detourRecordText,detourStateText,detourSourceText,pastDetourNote,reinspectVerdict,detourRelevanceForSecond} from './readiness.mjs';
import * as readinessFns from './readiness.mjs';
import * as geoFns from './geo-data.mjs';
import {detourEvidenceText} from './readiness.mjs';
import {hazardNearPointsM} from './readiness.mjs';
import {mapSimulationPath,routeSamplePoints} from './geo-data.mjs';
import {createSamplingQueue} from './delivery.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const readProj = name => readFile(path.join(dir, name), 'utf8');

const goodReports = () => ({
  A:{total:3,observed:2,unknown:1,blockedIndices:[],maxGap:20.2},
  B:{total:3,observed:3,unknown:0,blockedIndices:[2],maxGap:25},
});

test('evidence payload keeps measured counts for both candidates', ()=>{
  assert.deepEqual(detourEvidencePayload(goodReports()),{
    A:{total:3,observed:2,unknown:1,blocked:0,maxGap:21},
    B:{total:3,observed:3,unknown:0,blocked:1,maxGap:25},
  });
});

test('evidence payload fails closed on stale, partial or malformed reports', ()=>{
  const good = goodReports();
  assert.equal(detourEvidencePayload(null), null);
  assert.equal(detourEvidencePayload({...good, stale:true}), null);
  assert.equal(detourEvidencePayload({A:good.A}), null);
  assert.equal(detourEvidencePayload({A:{...good.A, unknown:0}, B:good.B}), null);
  assert.equal(detourEvidencePayload({A:{...good.A, blockedIndices:[0,0]}, B:good.B}), null);
  assert.equal(detourEvidencePayload({A:{...good.A, maxGap:20001}, B:good.B}), null);
  assert.equal(detourEvidencePayload({A:{...good.A, total:50}, B:good.B}), null);
  assert.equal(detourEvidencePayload({A:{...good.A, blockedIndices:[9]}, B:good.B}), null);
});

test('validation summary never implies safety', ()=>{
  assert.match(summarizeDetourValidation({state:'accepted'}), /安全性は未確認/);
  assert.match(summarizeDetourValidation({state:'rejected'}), /不採用/);
  assert.match(summarizeDetourValidation({state:'stopped'}), /停止/);
  assert.equal(summarizeDetourValidation({state:'other'}), '判定不明');
  assert.equal(summarizeDetourValidation(null), '判定不明');
});

test('team record keeps only a complete result and rejects bad fields', ()=>{
  const record = detourTeamRecord({at:'2026-11-01 10:00:00',area:'東京都荒川区',side:'A',state:'accepted',reason:'条件を満たした',source:'Muse'});
  assert.deepEqual(record,{at:'2026-11-01 10:00:00',area:'東京都荒川区',side:'A',state:'accepted',reason:'条件を満たした',source:'Muse',flight:'one',evidence:null,facility:null,origin:null,inspectedAt:null,fetchedAt:null,sources:null,shares:null});
  assert.throws(()=>detourTeamRecord({at:'t',area:'a',side:'C',state:'accepted',reason:'x',source:'Muse'}),/候補/);
  assert.throws(()=>detourTeamRecord({at:'t',area:'a',side:'A',state:'maybe',reason:'x',source:'Muse'}),/判定/);
  assert.throws(()=>detourTeamRecord({at:'t',area:'a',side:'A',state:'accepted',reason:'',source:'Muse'}),/理由/);
  assert.throws(()=>detourTeamRecord({at:'t',area:'a',side:'A',state:'accepted',reason:'x',source:'radio'}),/選択元/);
  assert.equal(detourSourceText('auto'), '自動判断');
  assert.throws(()=>detourTeamRecord({at:'t',area:'a',side:'A',state:'accepted',reason:'x',source:'Muse',flight:'two'}),/迂回案/);
  assert.throws(()=>detourTeamRecord({at:'t',area:'a',side:'A',state:'accepted',reason:'x',source:'Muse',flight:'three'}),/便/);
  assert.throws(()=>detourTeamRecord({at:'t',area:'a',side:'A',state:'accepted',reason:'x',source:'Muse',evidence:7}),/根拠/);
  assert.throws(()=>detourTeamRecord({at:'',area:'a',side:'A',state:'accepted',reason:'x',source:'Muse'}),/時刻/);
});

test('record text distinguishes a manual stop from a Muse stop', ()=>{
  const muse = detourTeamRecord({at:'t',area:'a',side:'none',state:'stopped',reason:'候補なし',source:'Muse'});
  assert.match(detourRecordText(muse), /出所.*不明/);
  const manual = detourTeamRecord({at:'t',area:'a',side:'A',state:'stopped',reason:'手動で移動を終了しました',source:'manual'});
  assert.equal(detourStateText(manual), '手動で終了');
  assert.match(detourRecordText(manual), /手動で終了/);
  assert.match(detourRecordText(manual), /手動選択/);
});

test('team record keeps facility, origin, times, sources and shares, and drops personal keys', ()=>{
  const full = detourTeamRecord({at:'t',area:'a',side:'A',state:'accepted',reason:'x',source:'Muse',
    facility:{name:'第一施設'},origin:{latitude:35.7,longitude:139.7},
    inspectedAt:'2026-11-01T10:00:00.000Z',fetchedAt:'2026-11-01T09:00:00.000Z',
    sources:{buildings:'available',mode:'detailed'},shares:[{at:'t',text:'共有：1点'}],
    voice:'hello',contact:'090-0000-0000',transcript:'...' });
  assert.equal(full.facility.name, '第一施設');
  assert.deepEqual(full.origin, {latitude:35.7,longitude:139.7});
  assert.equal(full.inspectedAt, '2026-11-01T10:00:00.000Z');
  assert.ok(!('voice' in full) && !('contact' in full) && !('transcript' in full), 'personal keys must not persist');
  assert.throws(()=>detourTeamRecord({at:'t',area:'a',side:'none',state:'accepted',reason:'x',source:'manual',flight:'two',facility:{name:'F',phone:'000'}}),/保存できない/);
  assert.throws(()=>detourTeamRecord({at:'t',area:'a',side:'A',state:'accepted',reason:'x',source:'Muse',origin:{latitude:999,longitude:0}}),/出発地点/);
  assert.throws(()=>detourTeamRecord({at:'t',area:'a',side:'A',state:'accepted',reason:'x',source:'Muse',shares:[{at:'t'}]}),/共有/);
});
test('old stored records validate and render without the new segments', ()=>{
  const r = detourTeamRecord({at:'t',area:'a',side:'none',state:'stopped',reason:'候補なし',source:'Muse',flight:'one',evidence:null});
  const text = detourRecordText(r), note = pastDetourNote(r, 'a');
  for (const needle of ['配送先','出発地点','点検時刻','取得開始','データ種別','機体間の共有']) assert.ok(!text.includes(needle) && !note.includes(needle), needle);
  assert.match(note, /安全を意味しません/);
});
test('record and past notes show facility, origin, times, sources and shares when present', ()=>{
  const r = detourTeamRecord({at:'t',area:'a',side:'A',state:'accepted',reason:'条件を満たした',source:'Muse',
    facility:{name:'第一施設'},origin:{latitude:35.7,longitude:139.7},
    inspectedAt:'2026-11-01T10:00:00.000Z',fetchedAt:'2026-11-01T09:00:00.000Z',
    sources:{buildings:'available',mode:'detailed'},shares:[{at:'t',text:'共有：高い表面1点は2号機経路付近'}]});
  for (const text of [detourRecordText(r), pastDetourNote(r, 'a')]) {
    for (const needle of ['第一施設','35.70000, 139.70000','この端末内','2026-11-01T10:00:00.000Z','2026-11-01T09:00:00.000Z','データ種別','詳細優先','機体間の共有']) assert.ok(text.includes(needle), needle);
  }
  assert.match(pastDetourNote(r, 'a'), /安全を意味しません/);
});
test('second flight record names the aircraft without a detour choice', ()=>{
  const done = detourTeamRecord({at:'t',area:'a',side:'none',state:'accepted',reason:'r',source:'manual',flight:'two'});
  assert.equal(detourStateText(done), '2号機の仮想便が終了');
  assert.match(detourRecordText(done), /2号機/);
  assert.match(pastDetourNote(done, 'a'), /安全を意味しません/);
  const stopped = detourTeamRecord({at:'t',area:'a',side:'none',state:'stopped',reason:'r',source:'auto',flight:'two'});
  assert.equal(detourStateText(stopped), '2号機の仮想便を中止');
});

test('strict re-inspection verdict matches the server criteria', ()=>{
  const base = {observed:3,unknown:0,blockedIndices:[],total:3,maxGap:20};
  assert.equal(reinspectVerdict(base).ok, true);
  assert.equal(reinspectVerdict({...base, blockedIndices:[1]}).ok, false);
  assert.match(reinspectVerdict({...base, blockedIndices:[1]}).reason, /表面を検出/);
  assert.equal(reinspectVerdict({...base, observed:0}).ok, false);
  assert.equal(reinspectVerdict({...base, unknown:1}).ok, false);
  assert.match(reinspectVerdict({...base, unknown:1}).reason, /不明/);
  assert.equal(reinspectVerdict({...base, maxGap:29.4}).ok, false);
  assert.match(reinspectVerdict({...base, maxGap:29.4}).reason, /29m/);
  assert.equal(reinspectVerdict({...base, maxGap:29}).ok, true);
  assert.equal(reinspectVerdict(null).ok, false);
  assert.equal(reinspectVerdict({}).ok, false);
});

test('shared hazards reach only the second route corridor', ()=>{
  const start = {latitude:35.735,longitude:139.78}, end = {latitude:35.74,longitude:139.785};
  const near = detourRelevanceForSecond([{latitude:35.7375,longitude:139.7825,source:'A'}], start, end);
  assert.equal(near.near, true);
  assert.equal(near.count, 1);
  assert.ok(near.nearestM <= 300);
  const far = detourRelevanceForSecond([{latitude:36.0,longitude:140.0,source:'B'}], start, end);
  assert.equal(far.near, false);
  assert.equal(far.count, 1);
  assert.deepEqual(detourRelevanceForSecond([], start, end), {near:false,count:0,nearestM:null});
  assert.deepEqual(detourRelevanceForSecond([{latitude:35.7375,longitude:139.7825}], null, end), {near:false,count:1,nearestM:null});
  assert.deepEqual(detourRelevanceForSecond([{latitude:999,longitude:139.7825}], start, end), {near:false,count:1,nearestM:null});
});

test('past record is reference-only, area-scoped and never safety', ()=>{
  const record = detourTeamRecord({at:'t',area:'東京都荒川区',side:'A',state:'accepted',reason:'x',source:'Muse'});
  const note = pastDetourNote(record, '東京都荒川区');
  assert.match(note, /前回/);
  assert.match(note, /安全を意味しません/);
  assert.equal(pastDetourNote(record, '東京都台東区'), '');
  assert.equal(pastDetourNote(null, '東京都荒川区'), '');
  const manual = detourTeamRecord({at:'t',area:'a',side:'A',state:'stopped',reason:'x',source:'manual'});
  assert.match(pastDetourNote(manual, 'a'), /手動で終了/);
});

test('setArea refuses before any mutation while either aircraft is active via static inspection', async()=>{
  const source = await readProj('real-map.mjs');
  const guard = 'if(mapFlightActive())return false;';
  const gi = source.indexOf(guard);
  assert.ok(gi !== -1, 'setArea must refuse while a flight is active');
  for(const later of ['buildingMode=requestedMode;', 'currentArea=area', 'onSceneChanged();', 'stopSimulation();']) {
    const li = source.indexOf(later, gi);
    assert.ok(li !== -1 && li > gi, `${later} must come after the refusal guard`);
  }
  const active = source.slice(source.indexOf('function mapFlightActive(){'), source.indexOf('function setArea('));
  for(const phase of ['preflight','direct','obstacle','detour','surface-check','delivery']) assert.ok(active.includes(`'${phase}'`), `primary phase ${phase} blocks refetch`);
  for(const phase of ['checking','waiting','outbound','delivery','ascent','returning']) assert.ok(active.includes(`'${phase}'`) || active.includes('stopped'), `second phase handling present (${phase})`);
  for(const done of ['stopped','home','unavailable']) assert.ok(active.includes(`'${done}'`), `settled second state ${done} allows refetch`);
});

test('mode switch checks flight before mutating state via static inspection', async()=>{
  const source = await readProj('real-map.mjs');
  const wrap = 'setBuildingMode(mode){';
  const wi = source.indexOf(wrap);
  assert.ok(wi !== -1);
  const end = source.indexOf('}', wi);
  const body = source.slice(wi, end);
  assert.ok(body.indexOf('mapFlightActive()') !== -1 && body.indexOf('mapFlightActive()') < body.indexOf('buildingMode=mode'), 'flight check must precede mode mutation');
  const app = await readProj('app.js');
  const btn = app.indexOf('previousBuildingMode=mapBuildingMode;mapBuildingMode=mode;');
  assert.ok(btn !== -1, 'button keeps previous mode for restore');
  assert.ok(app.includes('mapBuildingMode=previousBuildingMode;'), 'refusal restores the previous mode');
});

test('timeline and saved-record UI stays on the same screen', async()=>{
  const html = await readProj('index.html');
  assert.ok(html.includes('id="map-team-log"'), 'timeline list');
  assert.ok(html.includes('id="map-team-past"'), 'past record note');
  assert.ok(html.includes('過去の成功は安全を意味しません'), 'past success is not safety');
  assert.ok(html.includes('固定の案とMuseの回答は記録内で区別します'), 'fixed plan vs Muse response');
  assert.ok(html.includes('最大間隔'), 'numbers sent are disclosed');
  assert.ok(html.includes('上限60秒'), 'time limit is disclosed');
});

let tmpSeq = 0;
async function harness(){
  const source=(await readFile(new URL('./app.js',import.meta.url),'utf8')).replace(/^import .*?;\s*/gm, '');
  const net={calls:[],reply:{sora:'A',nagi:'A',validation:{state:'accepted',reason:'条件を満たした'}},fresh:{observed:3,unknown:0,blockedIndices:[],total:3,maxGap:20},hazards:[]};
  const elements=new Map();
  function el(id){
    if(!elements.has(id)){
      const isCanvas = id==='scene' || id==='detection-overlay' || id.endsWith('-canvas') || id.endsWith('-preview');
      elements.set(id,{
        id, textContent:'', value:'', disabled:false, hidden:false, style:{}, dataset:{}, classList:{values:new Set(),add(v){this.values.add(v)},remove(v){this.values.delete(v)},toggle(v){if(this.values.has(v)){this.values.delete(v);return false}this.values.add(v);return true},contains(v){return this.values.has(v)}}, handlers:{},attributes:{},
        addEventListener(type,cb){this.handlers[type]=cb}, setAttribute(n,v){this.attributes[n]=v}, removeAttribute(n){delete this.attributes[n]}, getAttribute(n){return this.attributes[n]},
        querySelector(){return null}, querySelectorAll(){return []}, kids:[], replaceChildren(...nodes){this.kids=nodes.length?nodes:[];this.textContent=this.kids.map(n=>n.textContent||'').join('\n')}, append(...nodes){this.kids.push(...nodes);this.textContent=this.kids.map(n=>n.textContent||'').join('\n')}, focus(){}, click(){ this.handlers.click?.({preventDefault(){}}); },
        getContext: isCanvas ? (()=>({setTransform(){},drawImage(){},clearRect(){},fillRect(){},measureText(){return {width:0}}, fillText(){}})) : undefined,
        toDataURL: isCanvas ? (()=> 'data:image/png;base64,AA==') : undefined,
        width: isCanvas ? 800 : undefined, height: isCanvas ? 600 : undefined
      });
    }
    return elements.get(id);
  }
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
    URL, fetch: async(url,options)=>{ net.calls.push(String(url)); if(String(url).includes('/api/map-plan'))return {ok:true,json:async()=>({result:await net.reply,...(net.provenance?{provenance:net.provenance}:{})})}; return {ok:true,json:async()=>({enabled:true}), text:async()=>''}; },
    positionAt:()=>({}), progressBeforeReplan:()=>0, makeCity:()=>({}), fitImage:(c)=>c, isValidRoute:()=>true,
    readPlanStream:async function*(){}, configureSpeech:()=>{}, trackSpeech:()=>{}, initialCamera:()=>({view:'wide'}), beginFlight:()=>({view:'follow'}), selectCamera:()=>({}), deliveryCamera:()=>({}),
    canReplayMapRoute:()=>true, secondFleetCandidates:()=>[], jmaWarningLink:()=> '#', filterShelters:(list)=>list, nearbyShelters:()=>[],
    requestDraft:()=>({supply:null,quantity:null}), simulationManifest:()=>({}), suggestRequest:()=>({}), suggestShelters:()=>[], mapFloodContext:()=>'', mapConsultHistoryContext:()=>'', mapMissionSteps:()=>['pending','pending','pending','pending'], mapMissionDistance:()=>'', mapMissionEvidence:()=>'', mapRouteSummary:()=>'', fleetStatus:()=>'', fleetPosition:()=>null, createMapScan:()=>({invalidate(){} , run(){}}), createMapConsultation:()=>({invalidate(){} , run(){}}), createFacilityFloodTracker:()=>({select(){}, getStatus(){return ''}}), createWorld:()=>({update(){}}),
    AudioContext:class{async decodeAudioData(){return {sampleRate:24000,getChannelData:()=>new Float32Array([0])}} async close(){}},
    detourEvidencePayload:(...a)=>readinessFns.detourEvidencePayload(...a),
    createDetourReinspection:(...a)=>readinessFns.createDetourReinspection(...a),
    summarizeDetourValidation:(...a)=>readinessFns.summarizeDetourValidation(...a),
    detourTeamRecord:(...a)=>readinessFns.detourTeamRecord(...a),
    updateLocalHistory:async({storage,key,update})=>{const value=update(storage.getItem(key));if(value===null)storage.removeItem(key);else storage.setItem(key,value)},
    detourRecordText:(...a)=>readinessFns.detourRecordText(...a),
    pastDetourNote:(...a)=>readinessFns.pastDetourNote(...a),
    reinspectVerdict:(...a)=>readinessFns.reinspectVerdict(...a),
    detourRelevanceForSecond:(...a)=>readinessFns.detourRelevanceForSecond(...a),
    hazardNearPointsM:(...a)=>readinessFns.hazardNearPointsM(...a),
    isViewFrameCurrent:(...a)=>readinessFns.isViewFrameCurrent(...a),
    describeViewFrameChange:(...a)=>readinessFns.describeViewFrameChange(...a),
    mapSimulationPath:(...a)=>geoFns.mapSimulationPath(...a),
    routeSamplePoints:(...a)=>geoFns.routeSamplePoints(...a),
  };
  vm.runInNewContext(source, ctx);
  await new Promise(r=> setImmediate(r));
  ctx.__net = net;
  return {el, ctx, net, run:(code)=> vm.runInNewContext(code, ctx)};
}

test('refused mode switch keeps the previous value and explains why', async()=>{
  const h = await harness();
  h.run("realMap={mapFlightActive:()=>true,setBuildingMode:()=>{throw new Error('must not be called')}};");
  h.el('buildings-highest').click();
  assert.equal(h.run('mapBuildingMode'), 'detailed');
  assert.match(h.el('area-list-status').textContent, /飛行中は地域・建物モデルの再取得ができません/);
  assert.match(h.el('area-list-status').textContent, /保持しています/);
});

test('accepted mode switch applies the new value', async()=>{
  const h = await harness();
  h.run("realMap={mapFlightActive:()=>false,setBuildingMode:()=>true};");
  h.el('buildings-highest').click();
  assert.equal(h.run('mapBuildingMode'), 'highest');
});

test('refused refresh never reaches the map and keeps existing state', async()=>{
  const h = await harness();
  h.run("let areaCalls=0; realMap={mapFlightActive:()=>true,setArea:()=>{areaCalls++; return true}};");
  h.el('refresh-data').click();
  assert.equal(h.run('areaCalls'), 0);
  assert.match(h.el('area-list-status').textContent, /飛行中は地域・建物モデルの再取得ができません/);
});

test('consult requires fresh evidence on a capable server and explains old servers', async()=>{
  const app = await readProj('app.js');
  assert.ok(app.includes('mapPlanEvidenceCapable'), 'capability flag is tracked');
  assert.ok(app.includes('detourEvidencePayload(mapProbeReports)'), 'evidence is built from shared inspections');
  assert.ok(app.includes('AbortSignal.timeout(60000)'), 'AI call has a time limit');
  assert.ok(app.includes('reinspectDetourSide'), 'chosen route is re-inspected before auto replay');
  assert.ok(app.includes('continueSimulation(result.nagi)'), 'accepted choice replays automatically');
  assert.ok(app.includes('mapTeamPending={side:result.nagi'), 'accepted choice stays interim until completion');
  assert.ok(app.includes('resolveTeamPending'), 'completion and stop resolve the interim choice');
  assert.ok(app.includes('runMapConsult'), 'consult runs on demand and automatically');
  assert.ok(app.includes('maybeAutoConsult'), 'inspection completion triggers one automatic consult');
  assert.ok(app.includes("state:'rejected'"), 'rejected result is saved');
  assert.ok(app.includes("source:'manual'"), 'manual stop is recorded separately');
  assert.ok(app.includes('参考・自動判断なし'), 'legacy server answers stay reference-only');
});

const flush = async(rounds=15)=>{ for(let i=0;i<rounds;i++) await new Promise(r=>setTimeout(r,10)); };
const KEY = 'muse.teamDetour.東京都荒川区';
const savedAll = h => JSON.parse(h.run(`localStorage.getItem('${KEY}')`) || '[]');
const savedLast = h => { const all = savedAll(h); return all[all.length-1]; };
function armConsult(h, {reply, fresh, hazards}={}){
  if(reply !== undefined) h.net.reply = reply;
  if(fresh !== undefined) h.net.fresh = fresh;
  if(hazards !== undefined) h.net.hazards = hazards;
  h.el('map-area-title').textContent = '東京都荒川区 ／ 実地図';
  h.run(`real=true; realMode=true; mapPlanAvailable=true; mapPlanEvidenceCapable=true; mapPlanPhase='obstacle';
    mapProbeReports={A:{total:3,observed:3,unknown:0,blockedIndices:[],maxGap:20},B:{total:3,observed:2,unknown:1,blockedIndices:[],maxGap:22}};
    mapOriginPoint={latitude:35.735,longitude:139.78}; mapFleetActive=false; draftShelter='X'; mapOriginChosen=true;
    realMap={cameraMode:()=>'wide',
      capture:()=>({image:'data:image/png;base64,AA==',canvas:{width:10,height:10},view:{}}),
      isViewCurrent:()=>true,
      getSharedHazards:()=>__net.hazards||[],
      continueSimulation:(s)=>{__net.continue=s},
      reinspectDetourSide:async()=>__net.fresh,
      stopSecondFlight:(r)=>{__net.stop2=r;return true},
      mapFlightActive:()=>false,setArea:()=>true,setBuildingMode:()=>true};`);
}

test('accepted choice stays interim, replays, and saves only on completion', async()=>{
  const h = await harness();
  armConsult(h);
  h.el('map-sim-consult').click();
  await flush();
  assert.equal(h.net.continue, 'A');
  assert.equal(h.run(`localStorage.getItem('${KEY}')`), null);
  assert.equal(h.run('mapTeamPending===null'), false);
  h.run("resolveTeamPending('detour','')");
  assert.equal(h.run('mapTeamPending===null'), false);
  h.run("resolveTeamPending('complete','')");
  assert.equal(h.run('mapTeamPending===null'), true);
  const saved = savedLast(h);
  assert.equal(saved.side, 'A');
  assert.equal(saved.state, 'accepted');
  assert.equal(saved.source, 'unknown');
  assert.match(saved.reason, /完了まで再生/);
  const before = h.run(`localStorage.getItem('${KEY}')`);
  h.run("resolveTeamPending('complete','')");
  assert.equal(h.run(`localStorage.getItem('${KEY}')`), before);
});

test('fixed and old-server responses keep their provenance through decision, stop and history', async()=>{
  for(const [provenance,label] of [['fixture',/試験用/],[undefined,/出所.*不明/]]){
    const h=await harness();h.net.provenance=provenance;armConsult(h);
    h.el('map-sim-consult').click();await flush();
    assert.equal(h.net.continue,'A');
    assert.match(h.el('map-sim-dialogue').textContent,label);
    assert.match(h.el('map-team-log').textContent,label);
    h.run("resolveTeamPending('complete','')");await flush();
    const saved=savedLast(h);assert.equal(saved.provenance,provenance||'unknown');assert.equal(saved.source,provenance||'unknown');
    assert.match(detourRecordText(saved),label);assert.match(pastDetourNote(saved,'東京都荒川区'),label);
  }
});

test('reinspection evidence is preserved separately from the earlier consultation and displayed',async()=>{
  const h=await harness();h.net.provenance='fixture';armConsult(h,{fresh:{total:4,observed:4,unknown:0,blockedIndices:[],maxGap:18}});
  h.el('map-sim-consult').click();await flush();assert.equal(h.net.continue,'A');
  h.run("resolveTeamPending('complete','')");await flush();const saved=savedLast(h);
  assert.equal(saved.evidence.A.total,3);assert.equal(saved.reinspection.side,'A');assert.equal(saved.reinspection.total,4);
  assert.equal(saved.reinspection.observed,4);assert.equal(saved.reinspection.unknown,0);assert.equal(saved.reinspection.blocked,0);assert.equal(saved.reinspection.maxGap,18);
  assert.ok(Number.isFinite(Date.parse(saved.reinspection.at)));assert.match(detourRecordText(saved),/再点検.*4点.*不明0/);assert.match(pastDetourNote(saved,'東京都荒川区'),/再点検.*4点/);assert.match(pastDetourNote(saved,'東京都荒川区'),/相談時.*A案3点/);
});

test('failed reinspection and a later manual stop preserve the actual reinspection evidence',async()=>{
  const fail=await harness();fail.net.provenance='fixture';armConsult(fail,{fresh:{total:4,observed:3,unknown:1,blockedIndices:[],maxGap:18}});
  fail.el('map-sim-consult').click();await flush();assert.equal(fail.net.continue,undefined);assert.equal(savedLast(fail).reinspection.unknown,1);assert.equal(savedLast(fail).state,'rejected');
  const stop=await harness();stop.net.provenance='fixture';armConsult(stop,{fresh:{total:4,observed:4,unknown:0,blockedIndices:[],maxGap:18}});
  stop.el('map-sim-consult').click();await flush();stop.run("realMap.mapFlightActive=()=>true;realMap.stopSimulation=()=>{};realMap.setViewLock=()=>{}");stop.el('map-sim-stop').click();await flush();
  assert.equal(savedLast(stop).state,'stopped');assert.equal(savedLast(stop).reinspection.total,4);
});

test('a reinspection arriving after stop is not saved or replayed',async()=>{
  const h=await harness();let release;h.net.provenance='fixture';armConsult(h,{fresh:new Promise(resolve=>release=resolve)});
  h.run("realMap.mapFlightActive=()=>true;realMap.stopSimulation=()=>{};realMap.setViewLock=()=>{}");
  h.el('map-sim-consult').click();await flush();h.el('map-sim-stop').click();await flush();
  const before=h.run(`localStorage.getItem('${KEY}')`);release({total:4,observed:4,unknown:0,blockedIndices:[],maxGap:18});await flush();
  assert.equal(h.net.continue,undefined);assert.equal(h.run(`localStorage.getItem('${KEY}')`),before);assert.equal(savedLast(h).state,'stopped');assert.equal(savedLast(h).side,'A');assert.equal(savedLast(h).source,'fixture');assert.equal(savedLast(h).reinspection,undefined);
});
test('a reinspection timeout records the candidate and failure without reporting a completed reinspection',async()=>{
  const h=await harness();h.net.provenance='fixture';armConsult(h);
  h.run("realMap.reinspectDetourSide=async()=>{throw new Error('時間内に建物モデルの点検が完了しませんでした')}");
  h.el('map-sim-consult').click();await flush();assert.equal(h.net.continue,undefined);
  assert.match(h.el('map-sim-consult-status').textContent,/再点検.*時間内/);
  const saved=savedLast(h);assert.equal(saved.side,'A');assert.equal(saved.source,'fixture');assert.equal(saved.state,'stopped');assert.equal(saved.reinspection,undefined);assert.match(saved.reason,/時間内/);
});

test('a primary preflight clears old inspection time; second-aircraft checking does not clear it',async()=>{
  const h=await harness();h.run("mapProbeInspectedAt='old';resolveTeamPending('preflight','')");assert.equal(h.run('mapProbeInspectedAt'),null);
  h.run("mapProbeInspectedAt='current';renderFleet({phase:'checking',name:'施設B'})");assert.equal(h.run('mapProbeInspectedAt'),'current');
});

test('old records disclose that reinspection evidence was not saved',()=>{
  const old={at:'t',area:'a',side:'A',state:'accepted',reason:'x',source:'Muse'};
  assert.match(detourRecordText(old),/再点検.*記録なし/);assert.match(pastDetourNote(old,'a'),/再点検.*記録なし/);
});

test('reinspection records reject inconsistent counts, wrong route, bad time and unsupported fields',()=>{
  const valid={total:4,observed:3,unknown:1,blockedIndices:[2],maxGap:18};
  const saved=readinessFns.createDetourReinspection('A',valid,'2026-11-04T07:00:00.000Z');
  assert.deepEqual(saved,{side:'A',at:'2026-11-04T07:00:00.000Z',total:4,observed:3,unknown:1,blocked:1,maxGap:18});
  for(const bad of [{...valid,unknown:0},{...valid,blockedIndices:[2,2]},{...valid,blockedIndices:[4]},{...valid,maxGap:Infinity}])assert.throws(()=>readinessFns.createDetourReinspection('A',bad,'2026-11-04T07:00:00.000Z'),/再点検/);
  assert.throws(()=>readinessFns.createDetourReinspection('A',valid,'2026-02-31T07:00:00.000Z'),/再点検/);
  const record={at:'t',area:'a',side:'A',state:'rejected',reason:'x',source:'fixture',provenance:'fixture'};
  assert.throws(()=>detourTeamRecord({...record,reinspection:{...saved,side:'B'}}),/再点検/);
  assert.throws(()=>detourTeamRecord({...record,reinspection:{...saved,extra:'x'}}),/再点検/);
  const kept=detourTeamRecord({...record,reinspection:saved});saved.total=40;assert.equal(kept.reinspection.total,4);
});

test('latest second-aircraft result does not hide the first aircraft reinspection',async()=>{
  const h=await harness();h.el('map-area-title').textContent='東京都荒川区 ／ 実地図';
  const first={at:'t1',area:'東京都荒川区',side:'A',state:'accepted',reason:'x',source:'fixture',provenance:'fixture',flight:'one',reinspection:{side:'A',at:'2026-11-04T07:00:00.000Z',total:4,observed:4,unknown:0,blocked:0,maxGap:18}};
  const second={at:'t2',area:'東京都荒川区',side:'none',state:'accepted',reason:'x',source:'manual',flight:'two'};
  h.ctx.localStorage.setItem(KEY,JSON.stringify([first,second]));h.run('renderTeamPast()');
  assert.match(h.el('map-team-past').textContent,/2号機/);assert.match(h.el('map-team-past').textContent,/再点検.*4点/);
});

test('automatically shared inspection figures are not labelled as consultation inputs',()=>{
  const evidence={A:{total:4,observed:4,unknown:0,blocked:0,maxGap:18},B:{total:3,observed:3,unknown:0,blocked:0,maxGap:20}};
  const shared={at:'t',area:'a',side:'none',state:'stopped',reason:'x',source:'auto',flight:'two',evidence};
  assert.match(detourRecordText(shared),/時点の区別がない点検数値/);assert.doesNotMatch(detourRecordText(shared),/相談時の点検数値/);
});

test('ending the virtual flight after a rejected consultation records both events',async()=>{
  const h=await harness();h.net.provenance='fixture';armConsult(h,{reply:{sora:'none',nagi:'none',validation:{state:'stopped',reason:'候補なし'}}});
  h.run('realMap.mapFlightActive=()=>true;realMap.stopSimulation=()=>{};realMap.setViewLock=()=>{}');h.el('map-sim-consult').click();await flush();
  assert.equal(savedAll(h).length,1);h.el('map-sim-stop').click();await flush();
  const records=savedAll(h);assert.equal(records.length,2);assert.equal(records[0].reason,'候補なし');assert.match(records[1].reason,/利用者が配送を終了/);
});

test('an older record labelled Muse without provenance is not presented as proven Muse',()=>{
  const old={at:'t',area:'a',side:'A',state:'accepted',reason:'x',source:'Muse'};
  assert.match(detourRecordText(old),/出所.*不明/);
  assert.match(pastDetourNote(old,'a'),/出所.*不明/);
});

test('strict re-inspection stops on unknown or wide gaps without replay', async()=>{
  const h = await harness();
  armConsult(h, {fresh:{observed:2,unknown:1,blockedIndices:[],total:3,maxGap:20}});
  h.el('map-sim-consult').click();
  await flush();
  assert.equal(h.net.continue, undefined);
  const saved = savedLast(h);
  assert.equal(saved.state, 'rejected');
  assert.match(saved.reason, /不明/);
  assert.match(h.el('map-sim-consult-status').textContent, /停止したまま/);
});

test('failed consult keeps the aircraft stopped with a reason', async()=>{
  const h = await harness();
  armConsult(h, {reply:{sora:'A',nagi:'QX'}});
  h.el('map-sim-consult').click();
  await flush();
  assert.equal(h.net.continue, undefined);
  assert.match(h.el('map-sim-consult-status').textContent, /不正/);
  assert.equal(h.run(`localStorage.getItem('${KEY}')`), null);
});

test('automatic consult runs once per inspection and never on old servers', async()=>{
  const h = await harness();
  armConsult(h);
  h.run('maybeAutoConsult()');
  await flush();
  assert.ok(h.net.calls.some(u=>u.includes('/api/map-plan')), 'auto consult sends once');
  const count = h.net.calls.length;
  h.run('maybeAutoConsult()');
  await flush();
  assert.equal(h.net.calls.length, count);
});

test('old server and missing connection never auto send', async()=>{
  const h = await harness();
  armConsult(h);
  h.run('mapPlanEvidenceCapable=false; maybeAutoConsult()');
  await flush();
  assert.equal(h.net.calls.filter(u=>u.includes('/api/map-plan')).length, 0);
  assert.match(h.el('map-sim-consult-status').textContent, /参考表示/);
  const g = await harness();
  armConsult(g);
  g.run('real=false; mapPlanAutoTried=false; maybeAutoConsult()');
  await flush();
  assert.equal(g.net.calls.filter(u=>u.includes('/api/map-plan')).length, 0);
  assert.match(g.el('map-sim-consult-status').textContent, /未接続/);
});

test('consult auto-stop save failure is shown instead of claimed', async()=>{
  const h = await harness();
  armConsult(h, {hazards:[{latitude:35.7375,longitude:139.7825,source:'A'}]});
  h.run(`secondFleetCandidates=()=>[{index:0,name:'第二施設',latitude:35.74,longitude:139.785}]; mapFleetActive=true; localStorage.setItem=()=>{throw new Error('disk full')};`);
  h.el('map-sim-consult').click();
  await flush();
  assert.match(h.net.stop2 || '', /約/);
  assert.equal(h.run(`localStorage.getItem('${KEY}')`), null);
  assert.match(h.el('map-team-log').textContent, /保存に失敗/);
});
test('shared hazard near the second route stops it with a saved record', async()=>{
  const h = await harness();
  armConsult(h, {hazards:[{latitude:35.7375,longitude:139.7825,source:'A'}]});
  h.run(`secondFleetCandidates=()=>[{index:0,name:'第二施設',latitude:35.74,longitude:139.785}]; mapFleetActive=true;`);
  h.el('map-sim-consult').click();
  await flush();
  assert.match(h.net.stop2 || '', /約/);
  const saved = savedLast(h);
  assert.equal(saved.flight, 'two');
  assert.equal(saved.state, 'stopped');
  assert.equal(saved.source, 'auto');
});

test('second flight completion and stop each save their actual result', async()=>{
  const h = await harness();
  h.el('map-area-title').textContent = '東京都荒川区 ／ 実地図';
  h.run("renderFleet({phase:'home',name:'第二施設',report:{total:5,unknown:1}})");
  const done = savedLast(h);
  assert.equal(done.flight, 'two');
  assert.equal(done.state, 'accepted');
  assert.match(done.reason, /終了/);
  h.run("renderFleet({phase:'stopped',name:'第二施設',message:'接近のため中止'})");
  const stopped = savedLast(h);
  assert.equal(stopped.state, 'stopped');
  assert.match(stopped.reason, /接近のため中止/);
});

test('saved record keeps the shared evidence with the outcome', ()=>{
  const record = detourTeamRecord({at:'t',area:'a',side:'A',state:'accepted',reason:'x',source:'Muse',evidence:{A:{total:3,observed:3,unknown:0,blocked:0,maxGap:20},B:{total:3,observed:2,unknown:1,blocked:0,maxGap:22}}});
  assert.match(detourRecordText(record), /点検数値/);
  assert.match(detourRecordText(record), /A案3点/);
  assert.equal(detourEvidenceText(null), '');
  assert.equal(detourEvidenceText({}), '');
});

test('inspection-time sharing stops the second flight without any Muse call', async()=>{
  const h = await harness();
  h.el('map-area-title').textContent = '東京都荒川区 ／ 実地図';
  h.run(`mapOriginPoint={latitude:35.735,longitude:139.78}; mapFleetActive=true;
    secondFleetCandidates=()=>[{index:0,name:'第二施設',latitude:35.74,longitude:139.785}];
    realMap={getSharedHazards:()=>[{latitude:35.7375,longitude:139.7825,source:'A'}],
      stopSecondFlight:(r)=>{__net_stop2 = r; return true},
      mapFlightActive:()=>false,setArea:()=>true,setBuildingMode:()=>true};`);
  h.run('__net_stop2=null; shareHazardsWithSecond();');
  assert.match(h.run('__net_stop2') || '', /約/);
  const saved = savedLast(h);
  assert.equal(saved.flight, 'two');
  assert.equal(saved.source, 'auto');
  assert.equal(h.net.calls.filter(u=>u.includes('/api/map-plan')).length, 0);
});

test('sharing without a flying second drone only logs for its next inspection', async()=>{
  const h = await harness();
  h.el('map-area-title').textContent = '東京都荒川区 ／ 実地図';
  h.run(`mapOriginPoint={latitude:35.735,longitude:139.78}; mapFleetActive=false;
    secondFleetCandidates=()=>[{index:0,name:'第二施設',latitude:35.74,longitude:139.785}];
    realMap={getSharedHazards:()=>[{latitude:35.7375,longitude:139.7825,source:'A'}],
      stopSecondFlight:()=>{throw new Error('must not stop')},
      mapFlightActive:()=>false,setArea:()=>true,setBuildingMode:()=>true};`);
  h.run('shareHazardsWithSecond();');
  assert.equal(h.run(`localStorage.getItem('${KEY}')`), null);
});

test('failed terminal save is shown instead of claimed', async()=>{
  const h = await harness();
  h.el('map-area-title').textContent = '東京都荒川区 ／ 実地図';
  h.run(`mapTeamPending={side:'A',reason:'条件を満たした',evidence:null};
    localStorage.setItem=()=>{throw new Error('disk full')};`);
  h.run("resolveTeamPending('complete','')");
  await flush(1);
  assert.equal(h.run(`localStorage.getItem('${KEY}')`), null);
  assert.match(h.el('map-team-log').textContent, /保存に失敗/);
});

test('direct completion without a detour choice still saves facility, origin and sources', async()=>{
  const h = await harness();
  h.el('map-area-title').textContent = '東京都荒川区 ／ 実地図';
  h.run(`shelterList=[{name:'第一施設',address:'荒川区1',latitude:35.735,longitude:139.78}]; shelterChoice=0;
    mapOriginPoint={latitude:35.74,longitude:139.79};
    mapSourceEvidence={buildings:'available',shelters:'available',weather:'current',risk:'reference'}; mapBuildingMode='detailed';`);
  h.run("resolveTeamPending('complete','')");
  const saved = savedLast(h);
  assert.equal(saved.flight, 'one');
  assert.equal(saved.side, 'none');
  assert.equal(saved.state, 'accepted');
  assert.equal(saved.facility.name, '第一施設');
  assert.deepEqual(saved.origin, {latitude:35.74,longitude:139.79});
  assert.equal(saved.sources.mode, 'detailed');
  await flush(1);
  assert.match(h.el('map-team-past').textContent, /第一施設/);
});
test('stop without detour evidence still saves the actual reason', async()=>{
  const h = await harness();
  h.el('map-area-title').textContent = '東京都荒川区 ／ 実地図';
  h.run("resolveTeamPending('preflight-unavailable','建物データを取得できません')");
  const saved = savedLast(h);
  assert.equal(saved.flight, 'one');
  assert.equal(saved.side, 'none');
  assert.equal(saved.state, 'stopped');
  assert.match(saved.reason, /建物データを取得できません/);
});
test('corrupt stored records are reported instead of hidden', async()=>{
  const h = await harness();
  h.el('map-area-title').textContent = '東京都荒川区 ／ 実地図';
  h.run(`localStorage.setItem('${KEY}', 'not-json{{{'); renderTeamPast();`);
  assert.match(h.el('map-team-past').textContent, /読み取れません/);
  const g = await harness();
  g.el('map-area-title').textContent = '東京都荒川区 ／ 実地図';
  const good = detourTeamRecord({at:'t',area:'東京都荒川区',side:'none',state:'accepted',reason:'x',source:'manual',flight:'two'});
  const payload = JSON.stringify([good, 42]);
  g.run('localStorage.setItem("' + KEY + '", ' + JSON.stringify(payload) + '); renderTeamPast();');
  assert.match(g.el('map-team-past').textContent, /除く/);
});
test('two-aircraft history never discards existing records or overwrites corrupt data',async()=>{
 const h=await harness();h.el('map-area-title').textContent='東京都荒川区 ／ 実地図';
 const record={side:'none',state:'stopped',reason:'試験',source:'manual',flight:'two'};
 for(const raw of ['not-json{{{','',JSON.stringify([{at:'invalid'}])]){
  h.run(`localStorage.setItem('${KEY}',${JSON.stringify(raw)})`);
  assert.equal(await h.run(`saveTeamRecord(${JSON.stringify(record)})`),false);
  assert.equal(h.run(`localStorage.getItem('${KEY}')`),raw);
 }
 const good=detourTeamRecord({at:'t',area:'東京都荒川区',...record});
 const old=Array.from({length:11},()=>good);h.run(`localStorage.setItem('${KEY}',${JSON.stringify(JSON.stringify(old))})`);
 assert.equal(await h.run(`saveTeamRecord(${JSON.stringify(record)})`),true);assert.equal(savedAll(h).length,12);
});
test('failed saves retain distinct snapshots, even after changing regions',async()=>{
 const h=await harness();h.el('map-area-title').textContent='東京都荒川区 ／ 実地図';
 h.ctx.updateLocalHistory=async()=>{throw new Error('unavailable')};
 const first={side:'none',state:'stopped',reason:'最初の停止',source:'manual',flight:'one'};
 assert.equal(await h.run(`saveTeamRecord(${JSON.stringify(first)})`),false);
 h.el('map-area-title').textContent='東京都台東区 ／ 実地図';
 const second={side:'none',state:'stopped',reason:'別の停止',source:'manual',flight:'two'};
 assert.equal(await h.run(`saveTeamRecord(${JSON.stringify(second)})`),false);
 const pending=JSON.parse(h.run('JSON.stringify(mapTeamUnsaved)'));
 assert.deepEqual(pending.map(r=>[r.area,r.flight,r.reason]),[['東京都荒川区','one','最初の停止'],['東京都台東区','two','別の停止']]);
 assert.equal(h.el('map-team-unsaved-export').hidden,false);
 assert.match(h.el('map-team-unsaved-status').textContent,/2件/);
});
test('successful team record is not flagged as unsaved',async()=>{
 const h=await harness();h.el('map-area-title').textContent='東京都荒川区 ／ 実地図';
 assert.equal(await h.run("saveTeamRecord({side:'none',state:'stopped',reason:'確認',source:'manual',flight:'one'})"),true);
 assert.equal(h.run('mapTeamUnsaved.length'),0);
});
test('a failed delayed save preserves the evidence at the time the result was recorded',async()=>{
 const h=await harness();h.el('map-area-title').textContent='東京都荒川区 ／ 実地図';
 let release;const gate=new Promise(resolve=>{release=resolve});
 h.ctx.updateLocalHistory=async()=>{await gate;throw new Error('unavailable')};
 const pending=h.run("const originalEvidence={A:{total:3}}; saveTeamRecord({side:'A',state:'stopped',reason:'確認',source:'manual',flight:'one',evidence:originalEvidence})");
 h.run('originalEvidence.A.total=99');release();assert.equal(await pending,false);
 assert.equal(h.run('mapTeamUnsaved[0].evidence.A.total'),3);
});
test('retry saves pending results to their original regions, without saving twice',async()=>{
 const h=await harness();h.el('map-area-title').textContent='東京都荒川区 ／ 実地図';
 const normal=h.ctx.updateLocalHistory;h.ctx.updateLocalHistory=async()=>{throw new Error('unavailable')};
 assert.equal(await h.run("saveTeamRecord({side:'none',state:'stopped',reason:'一便',source:'manual',flight:'one'})"),false);
 h.el('map-area-title').textContent='東京都台東区 ／ 実地図';
 assert.equal(await h.run("saveTeamRecord({side:'none',state:'stopped',reason:'二便',source:'manual',flight:'two'})"),false);
 h.ctx.updateLocalHistory=normal;await h.run('retryTeamUnsaved()');
 assert.equal(h.run('mapTeamUnsaved.length'),0);
 assert.equal(savedAll(h).filter(r=>r.reason==='一便').length,1);
 assert.equal(JSON.parse(h.run("localStorage.getItem('muse.teamDetour.東京都台東区')")).filter(r=>r.reason==='二便').length,1);
});
test('retry recognizes an identical already-written record and refuses conflicting IDs',async()=>{
 const h=await harness();h.el('map-area-title').textContent='東京都荒川区 ／ 実地図';
 const normal=h.ctx.updateLocalHistory;
 h.ctx.updateLocalHistory=async options=>{await normal(options);throw new Error('checkpoint failed')};
 assert.equal(await h.run("saveTeamRecord({side:'none',state:'stopped',reason:'保存不確定',source:'manual',flight:'one'})"),false);
 h.ctx.updateLocalHistory=normal;await h.run('retryTeamUnsaved()');
 assert.equal(savedAll(h).length,1);assert.equal(h.run('mapTeamUnsaved.length'),0);
 h.ctx.updateLocalHistory=async()=>{throw new Error('unavailable')};
 assert.equal(await h.run("saveTeamRecord({side:'none',state:'stopped',reason:'新しい記録',source:'manual',flight:'one'})"),false);
 const pending=JSON.parse(h.run('JSON.stringify(mapTeamUnsaved[0])'));
 h.run(`localStorage.setItem('${KEY}',${JSON.stringify(JSON.stringify([{...pending,reason:'別の内容'}]))})`);
 h.ctx.updateLocalHistory=normal;await h.run('retryTeamUnsaved()');
 assert.equal(h.run('mapTeamUnsaved.length'),1);assert.equal(savedAll(h)[0].reason,'別の内容');
 assert.match(h.el('map-team-unsaved-status').textContent,/再試行でも保存を確認できません/);
});
test('overlapping retries do not write a pending result twice',async()=>{
 const h=await harness();h.el('map-area-title').textContent='東京都荒川区 ／ 実地図';
 const normal=h.ctx.updateLocalHistory;h.ctx.updateLocalHistory=async()=>{throw new Error('unavailable')};
 await h.run("saveTeamRecord({side:'none',state:'stopped',reason:'待機',source:'manual',flight:'one'})");
 let release,calls=0;const gate=new Promise(resolve=>{release=resolve});h.ctx.updateLocalHistory=async args=>{calls++;await gate;return normal(args)};
 const first=h.run('retryTeamUnsaved()');await h.run('retryTeamUnsaved()');release();await first;
 assert.equal(calls,1);assert.equal(savedAll(h).length,1);assert.equal(h.run('mapTeamUnsaved.length'),0);
});
test('saved records never carry voice or personal keys', async()=>{
  const h = await harness();
  h.el('map-area-title').textContent = '東京都荒川区 ／ 実地図';
  h.run(`shelterList=[{name:'第一施設',address:'荒川区1',latitude:35.735,longitude:139.78}]; shelterChoice=0;
    mapOriginPoint={latitude:35.74,longitude:139.79};`);
  h.run("resolveTeamPending('complete','')");
  const raw = h.run(`localStorage.getItem('${KEY}')`);
  assert.ok(!/voice|transcript|contact|phone/.test(raw), 'no personal keys in storage');
  assert.deepEqual(Object.keys(savedLast(h).facility), ['name']);
});
test('share events persist with the decided outcome', async()=>{
  const h = await harness();
  h.el('map-area-title').textContent = '東京都荒川区 ／ 実地図';
  h.run(`mapOriginPoint={latitude:35.735,longitude:139.78}; mapFleetActive=false;
    secondFleetCandidates=()=>[{index:0,name:'第二施設',latitude:35.74,longitude:139.785}];
    realMap={getSharedHazards:()=>[{latitude:35.7375,longitude:139.7825,source:'A'}],
      stopSecondFlight:()=>true, mapFlightActive:()=>false,setArea:()=>true,setBuildingMode:()=>true};`);
  h.run('shareHazardsWithSecond();');
  h.run(`shelterList=[{name:'第一施設',latitude:35.735,longitude:139.78}]; shelterChoice=0;`);
  h.run("resolveTeamPending('complete','')");
  const saved = savedLast(h);
  assert.ok(Array.isArray(saved.shares) && saved.shares.length > 0, 'shares persist');
  assert.ok(saved.shares.some(s=>/共有/.test(s.text)) && saved.shares.some(s=>/反応/.test(s.text)), 'share flow persists');
});
test('both aircraft outcomes persist as separate records', async()=>{
  const h = await harness();
  h.el('map-area-title').textContent = '東京都荒川区 ／ 実地図';
  h.run("renderFleet({phase:'home',name:'第二施設',report:{total:5,unknown:1}})");
  h.run("mapTeamPending={side:'A',reason:'条件を満たした',evidence:null}; resolveTeamPending('complete','')");
  const all = savedAll(h);
  assert.equal(all.length, 2);
  assert.equal(all[0].flight, 'two');
  assert.equal(all[1].flight, 'one');
  await flush(1);
  assert.match(h.el('map-team-past').textContent, /ほか1件/);
});

test('automatic consult waits for valid inspection results, once per inspection', async()=>{
  const h = await harness();
  h.el('map-area-title').textContent = '東京都荒川区 ／ 実地図';
  h.run(`real=true; realMode=true; mapPlanAvailable=true; mapPlanEvidenceCapable=true; mapPlanPhase='obstacle';
    mapProbeReports=null; draftShelter='X'; mapOriginChosen=true;
    realMap={cameraMode:()=>'wide',capture:()=>({image:'data:image/png;base64,AA==',canvas:{width:10,height:10},view:{}}),isViewCurrent:()=>true,
      getSharedHazards:()=>[],continueSimulation:(s)=>{__net.continue=s},reinspectDetourSide:async()=>__net.fresh,
      stopSecondFlight:()=>true,mapFlightActive:()=>false,setArea:()=>true,setBuildingMode:()=>true};`);
  h.run('maybeAutoConsult()');
  await flush(5);
  assert.equal(h.net.calls.filter(u=>u.includes('/api/map-plan')).length, 0);
  h.run(`mapProbeReports={A:{total:3,observed:3,unknown:0,blockedIndices:[],maxGap:20},B:{total:3,observed:3,unknown:0,blockedIndices:[],maxGap:22}}; maybeAutoConsult()`);
  await flush();
  assert.equal(h.net.calls.filter(u=>u.includes('/api/map-plan')).length, 1);
  h.run('maybeAutoConsult()');
  await flush(5);
  assert.equal(h.net.calls.filter(u=>u.includes('/api/map-plan')).length, 1);
});

test('second-drone hazard near the chosen detour refuses auto replay', async()=>{
  const h = await harness();
  const origin = {latitude:35.735,longitude:139.78}, dest = {latitude:35.74,longitude:139.785};
  const pts = routeSamplePoints(mapSimulationPath(origin, dest, 'A').detour).points;
  const mid = pts[Math.floor(pts.length/2)];
  armConsult(h, {hazards:[{latitude:mid.latitude,longitude:mid.longitude,source:'second'}]});
  h.run(`shelterList=[{name:'S',address:'A',latitude:${dest.latitude},longitude:${dest.longitude}}]; shelterChoice=0;`);
  h.el('map-sim-consult').click();
  await flush();
  assert.equal(h.net.continue, undefined);
  const saved = savedLast(h);
  assert.equal(saved.state, 'rejected');
  assert.equal(saved.source, 'auto');
  assert.match(saved.reason, /2号機と共有/);
  assert.match(h.el('map-sim-consult-status').textContent, /停止したまま/);
});

test('second-drone hazard near the chosen detour refuses manual replay too', async()=>{
  const h = await harness();
  const origin = {latitude:35.735,longitude:139.78}, dest = {latitude:35.74,longitude:139.785};
  const pts = routeSamplePoints(mapSimulationPath(origin, dest, 'A').detour).points;
  const mid = pts[Math.floor(pts.length/2)];
  armConsult(h, {hazards:[{latitude:mid.latitude,longitude:mid.longitude,source:'second'}]});
  h.run(`shelterList=[{name:'S',address:'A',latitude:${dest.latitude},longitude:${dest.longitude}}]; shelterChoice=0;`);
  h.el('map-dock-a').click();
  assert.equal(h.net.continue, undefined);
  assert.match(h.el('map-team-log').textContent, /2号機/);
});

test('manual replay may continue when second aircraft shares no high surfaces', async()=>{
  const h = await harness();
  armConsult(h, {hazards:[]});
  h.el('map-dock-a').click();
  assert.equal(h.net.continue, 'A');
});

test('automatic replay stops if a shared second-aircraft hazard cannot be related to a missing route', async()=>{
  const h = await harness();
  armConsult(h, {hazards:[{latitude:35.737,longitude:139.782,source:'second'}]});
  h.el('map-sim-consult').click();
  await flush();
  assert.equal(h.net.continue, undefined);
  assert.match(h.el('map-team-log').textContent, /確認できない/);
});

test('unknown points stop auto judgment without promising a retry fix', ()=>{
  const v = reinspectVerdict({observed:2,unknown:1,blockedIndices:[],total:3,maxGap:20});
  assert.equal(v.ok, false);
  assert.match(v.reason, /解消しない/);
});

test('all samplings serialize and fail closed on overlap or change via static inspection', async()=>{
  const source = await readProj('real-map.mjs');
  assert.equal(source.split('withSamplingLock(run,()=>').length - 1, 6);
  assert.ok(source.includes('createSamplingQueue'));
  const queue = await readProj('delivery.mjs');
  assert.ok(queue.includes('他の点検の待機が長引いたため中止しました'));
  assert.ok(source.includes('点検中に対象や表示物が変わったため中止しました'));
});

test('unknown-stop note stays visible in the obstacle legend', async()=>{
  const html = await readProj('index.html');
  assert.ok(html.includes('同じデータの再点検では解消しない場合があります'));
});

test('tracking auto consult switches wide once and captures once', async()=>{
  const h = await harness();
  h.el('map-area-title').textContent = '東京都荒川区 ／ 実地図';
  h.run(`real=true; realMode=true; mapPlanAvailable=true; mapPlanEvidenceCapable=true; mapPlanPhase='obstacle';
    draftShelter='X'; mapOriginChosen=true; mapFleetActive=false;
    realMap={cameraMode:()=>'follow', chooseCamera:(v,t,p)=>{__net.wide=[v,t,p];}, clearViewTouched:()=>{}, isViewTouched:()=>false,
      capture:()=>{__net.captures=(__net.captures||0)+1; return {image:'data:image/png;base64,AA==',canvas:{width:10,height:10},view:{m:1}};},
      isViewCurrent:()=>true, getSharedHazards:()=>[], continueSimulation:(s)=>{__net.continue=s}, reinspectDetourSide:async()=>__net.fresh,
      stopSecondFlight:()=>true,mapFlightActive:()=>false,setArea:()=>true,setBuildingMode:()=>true};`);
  const fresh = `{A:{total:3,observed:3,unknown:0,blockedIndices:[],maxGap:20},B:{total:3,observed:3,unknown:0,blockedIndices:[],maxGap:22}}`;
  h.run(`mapProbeBusy=false;mapProbeReports=${fresh}; handleProbeReady(${fresh});`);
  await flush();
  assert.equal(h.net.wide[0], 'wide');
  assert.equal(h.net.wide[1], 'one');
  assert.equal(h.net.wide[2], true);
  assert.equal(h.net.captures, 1);
  assert.equal(h.net.calls.filter(u=>u.includes('/api/map-plan')).length, 1);
  assert.match(h.el('map-team-log').textContent, /制御側の移動/);
});
test('stop before the reply lands invalidates the delayed response', async()=>{
  const h = await harness();
  armConsult(h);
  let release;
  h.net.reply = new Promise(r=>release=r);
  h.el('map-sim-consult').click();
  await flush();
  assert.equal(h.net.calls.filter(u=>u.includes('/api/map-plan')).length, 1);
  h.run('invalidateMapPlan()');
  release({sora:'A',nagi:'A',validation:{state:'accepted',reason:'条件を満たした'}});
  await flush();
  assert.equal(h.run('mapPlanChoice'), null);
  assert.equal(h.net.continue, undefined);
  assert.match(h.el('map-sim-consult-status').textContent, /変わった/);
  assert.ok(!h.el('map-sim-consult-status').textContent.includes('相談中'));
});
test('probe inspection time resets every flight', async()=>{
  const h = await harness();
  h.run("mapProbeInspectedAt='2026-11-01T10:00:00.000Z'; resolveTeamPending('needs-points','');");
  assert.equal(h.run('mapProbeInspectedAt'), null);
  h.run("mapProbeInspectedAt='2026-11-01T10:00:00.000Z'; renderFleet({phase:'checking',name:'2号機'});");
  assert.equal(h.run('mapProbeInspectedAt'), '2026-11-01T10:00:00.000Z');
  h.el('map-area-title').textContent = '東京都荒川区 ／ 実地図';
  h.run("mapProbeInspectedAt='2026-11-01T10:00:00.000Z'; resolveTeamPending('complete','');");
  assert.equal(h.run('mapProbeInspectedAt'), '2026-11-01T10:00:00.000Z');
  assert.equal(savedLast(h).inspectedAt, '2026-11-01T10:00:00.000Z');
});
test('own camera moves never invalidate the consult via static inspection', async()=>{
  const app = await readProj('app.js');
  assert.ok(app.includes('camera-own'), 'own moves are distinguished');
  const source = await readProj('real-map.mjs');
  assert.ok(source.includes("onSceneChanged('camera-own')"), 'own moves are reported');
});
test('camera events during control-side settling do not kill the consult', async()=>{
  const h = await harness();
  h.el('map-area-title').textContent = '東京都荒川区 ／ 実地図';
  h.run(`real=true; realMode=true; mapPlanAvailable=true; mapPlanEvidenceCapable=true; mapPlanPhase='obstacle';
    draftShelter='X'; mapOriginChosen=true; mapFleetActive=false;
    realMap={cameraMode:()=>'follow', chooseCamera:()=>{__net.wide=(__net.wide||0)+1;}, clearViewTouched:()=>{}, isViewTouched:()=>false,
      capture:()=>({image:'x',canvas:{width:10,height:10},view:{m:1}}), isViewCurrent:()=>false,
      getSharedHazards:()=>[], continueSimulation:()=>{}, reinspectDetourSide:async()=>__net.fresh,
      stopSecondFlight:()=>true,mapFlightActive:()=>false,setArea:()=>true,setBuildingMode:()=>true};`);
  const fresh = `{A:{total:3,observed:3,unknown:0,blockedIndices:[],maxGap:20},B:{total:3,observed:3,unknown:0,blockedIndices:[],maxGap:22}}`;
  h.run(`mapProbeBusy=false;mapProbeReports=${fresh}; handleProbeReady(${fresh});`);
  await flush();
  assert.equal(h.net.wide, 1);
  assert.equal(h.run('mapPlanCameraGuard'), true);
  const v0 = h.run('mapPlanVersion');
  h.run("realMapSceneChanged('camera')");
  await flush();
  assert.equal(h.run('mapPlanVersion'), v0);
  assert.equal(h.run('mapPlanController!==null'), true);
  h.run('realMapSceneChanged()');
  assert.equal(h.run('mapPlanVersion'), v0 + 1);
  assert.equal(h.run('mapPlanController===null'), true);
});
test('stale touch from origin selection does not kill the auto consult', async()=>{
  const h = await harness();
  h.el('map-area-title').textContent = '東京都荒川区 ／ 実地図';
  h.run(`real=true; realMode=true; mapPlanAvailable=true; mapPlanEvidenceCapable=true; mapPlanPhase='obstacle';
    draftShelter='X'; mapOriginChosen=true; mapFleetActive=false; __net.touched=true;
    realMap={cameraMode:()=>'wide', chooseCamera:()=>{}, clearViewTouched:()=>{__net.touched=false;}, isViewTouched:()=>__net.touched===true,
      capture:()=>({image:'x',canvas:{width:10,height:10},view:{m:1}}), isViewCurrent:()=>true,
      getSharedHazards:()=>[], continueSimulation:(s)=>{__net.continue=s;}, reinspectDetourSide:async()=>__net.fresh,
      stopSecondFlight:()=>true,mapFlightActive:()=>false,setArea:()=>true,setBuildingMode:()=>true};`);
  const fresh = `{A:{total:3,observed:3,unknown:0,blockedIndices:[],maxGap:20},B:{total:3,observed:3,unknown:0,blockedIndices:[],maxGap:22}}`;
  h.run(`mapProbeBusy=false;mapProbeReports=${fresh}; handleProbeReady(${fresh});`);
  let release;
  h.net.reply = new Promise(r=>release=r);
  await flush();
  assert.equal(h.run('__net.touched'), false);
  const v0 = h.run('mapPlanVersion');
  h.run("realMapSceneChanged('camera')");
  await flush();
  assert.equal(h.run('mapPlanVersion'), v0);
  release({sora:'A',nagi:'A',validation:{state:'accepted',reason:'条件を満たした'}});
  await flush();
  assert.equal(h.net.continue, 'A');
});
test('stale touch from origin selection does not kill the manual consult', async()=>{
  const h = await harness();
  armConsult(h);
  h.run(`__net.touched=true;
    realMap.clearViewTouched=()=>{__net.touched=false;};
    realMap.isViewTouched=()=>__net.touched===true;`);
  let release;
  h.net.reply = new Promise(r=>release=r);
  h.el('map-sim-consult').click();
  await flush();
  assert.equal(h.run('__net.touched'), false);
  const v0 = h.run('mapPlanVersion');
  h.run("realMapSceneChanged('camera')");
  await flush();
  assert.equal(h.run('mapPlanVersion'), v0);
  release({sora:'A',nagi:'A',validation:{state:'accepted',reason:'条件を満たした'}});
  await flush();
  assert.equal(h.net.continue, 'A');
});
test('untouched reflow during consult flight does not kill it, touch does', async()=>{
  const h = await harness();
  h.el('map-area-title').textContent = '東京都荒川区 ／ 実地図';
  h.run(`real=true; realMode=true; mapPlanAvailable=true; mapPlanEvidenceCapable=true; mapPlanPhase='obstacle';
    draftShelter='X'; mapOriginChosen=true; mapFleetActive=false;
    realMap={cameraMode:()=>'follow', chooseCamera:()=>{__net.wide=(__net.wide||0)+1;}, clearViewTouched:()=>{}, isViewTouched:()=>__net.touched===true,
      capture:()=>({image:'x',canvas:{width:10,height:10},view:{m:1}}), isViewCurrent:()=>true,
      getSharedHazards:()=>[], continueSimulation:()=>{}, reinspectDetourSide:async()=>__net.fresh,
      stopSecondFlight:()=>true,mapFlightActive:()=>false,setArea:()=>true,setBuildingMode:()=>true};`);
  const fresh = `{A:{total:3,observed:3,unknown:0,blockedIndices:[],maxGap:20},B:{total:3,observed:3,unknown:0,blockedIndices:[],maxGap:22}}`;
  h.run(`mapProbeBusy=false;mapProbeReports=${fresh}; handleProbeReady(${fresh});`);
  let release;
  h.net.reply = new Promise(r=>release=r);
  await flush();
  assert.equal(h.net.calls.filter(u=>u.includes('/api/map-plan')).length, 1);
  assert.equal(h.run('mapPlanCameraGuard'), true);
  const v0 = h.run('mapPlanVersion');
  h.run("realMapSceneChanged('camera')");
  await flush();
  assert.equal(h.run('mapPlanVersion'), v0);
  assert.equal(h.run('mapPlanController!==null'), true);
  h.run('__net.touched=true');
  h.run("realMapSceneChanged('camera')");
  assert.equal(h.run('mapPlanVersion'), v0 + 1);
  assert.equal(h.run('mapPlanController===null'), true);
  release({sora:'A',nagi:'A',validation:{state:'accepted',reason:'条件を満たした'}});
  await flush();
  assert.equal(h.run('mapPlanChoice'), null);
  assert.equal(h.net.continue, undefined);
  assert.ok(!h.el('map-sim-consult-status').textContent.includes('相談中'));
});
test('ready after candidate restore triggers one consult per inspection', async()=>{
  const h = await harness();
  h.el('map-area-title').textContent = '東京都荒川区 ／ 実地図';
  h.run(`real=true; realMode=true; mapPlanAvailable=true; mapPlanEvidenceCapable=true; mapPlanPhase='obstacle';
    draftShelter='X'; mapOriginChosen=true; mapFleetActive=false;
    realMap={cameraMode:()=>'wide',capture:()=>({image:'data:image/png;base64,AA==',canvas:{width:10,height:10},view:{}}),isViewCurrent:()=>true,
      getSharedHazards:()=>[],continueSimulation:(s)=>{__net.continue=s},reinspectDetourSide:async()=>__net.fresh,
      stopSecondFlight:()=>true,mapFlightActive:()=>false,setArea:()=>true,setBuildingMode:()=>true};`);
  const fresh = `{A:{total:3,observed:3,unknown:0,blockedIndices:[],maxGap:20},B:{total:3,observed:3,unknown:0,blockedIndices:[],maxGap:22}}`;
  h.run(`mapProbeBusy=false;mapProbeReports=${fresh};syncMapPlan();`);
  await flush(5);
  assert.equal(h.net.calls.filter(u=>u.includes('/api/map-plan')).length, 0);
  h.run(`__R=${fresh}; handleProbeReady(__R);`);
  await flush();
  assert.equal(h.net.calls.filter(u=>u.includes('/api/map-plan')).length, 1);
  h.run('handleProbeReady(__R);');
  await flush(5);
  assert.equal(h.net.calls.filter(u=>u.includes('/api/map-plan')).length, 1);
  h.run('handleProbeReady(null);');
  await flush(5);
  assert.equal(h.net.calls.filter(u=>u.includes('/api/map-plan')).length, 1);
});

test('done state never consults or shares on its own via static inspection', async()=>{
  const app = await readProj('app.js');
  const doneAt = app.indexOf("state==='done'");
  const errAt = app.indexOf("state==='error'", doneAt);
  assert.ok(doneAt !== -1 && errAt > doneAt);
  const doneSpan = app.slice(doneAt, errAt);
  assert.ok(!doneSpan.includes('maybeAutoConsult'), 'done must not trigger auto consult');
  assert.ok(!doneSpan.includes('shareHazardsWithSecond'), 'done must not share on its own');
  assert.ok(!doneSpan.includes('handleProbeReady'), 'done must not run the ready handler');
  assert.ok(app.includes("state==='ready'){handleProbeReady"), 'ready runs the shared handler');
});

test('candidates return before any probe event via static inspection', async()=>{
  const source = await readProj('real-map.mjs');
  assert.ok(source.includes('addProbeMarkers(run,points,heights);for(const entity of run.candidates)entity.show=true;'));
  const inspectShow = source.indexOf('addProbeMarkers(run,points,heights);for(const entity of run.candidates)entity.show=true;');
  const doneEmit = source.indexOf("state:'done'", inspectShow);
  assert.ok(inspectShow !== -1 && doneEmit > inspectShow, 'inspect restores candidates before done');
  assert.ok(source.includes('addProbeMarkers(run,plan.points,heights);for(const entity of run.candidates)entity.show=true;'));
  const reShow = source.indexOf('addProbeMarkers(run,plan.points,heights);for(const entity of run.candidates)entity.show=true;');
  const readyEmit = source.indexOf("state:'ready'", reShow);
  assert.ok(reShow !== -1 && readyEmit > reShow, 'reinspect restores candidates before ready');
});

test('each second flight saves its own outcome', async()=>{
  const h = await harness();
  h.el('map-area-title').textContent = '東京都荒川区 ／ 実地図';
  h.run("renderFleet({phase:'home',name:'第二施設',report:{total:5,unknown:1}})");
  h.run("renderFleet({phase:'checking',name:'第二施設'})");
  h.run("renderFleet({phase:'home',name:'第二施設',report:{total:5,unknown:0}})");
  const all = savedAll(h);
  assert.equal(all.length, 2);
  assert.ok(all.every(r=>r.flight==='two'));
});

test('stopped choice shows the saved reason instead of an unchosen claim', ()=>{
  const stopped = detourTeamRecord({at:'t',area:'a',side:'A',state:'stopped',reason:'建物データを取得できなくなりました',source:'Muse'});
  const text = detourRecordText(stopped);
  assert.match(text, /停止/);
  assert.ok(!text.includes('候補なし'), 'must not claim no candidate was chosen');
  assert.match(text, /建物データを取得できなくなりました/);
  const unknown = detourTeamRecord({at:'t',area:'a',side:'A',state:'rejected',reason:'再点検で1点の高さが不明',source:'Muse'});
  assert.match(detourRecordText(unknown), /再点検で1点の高さが不明/);
  assert.match(pastDetourNote(unknown, 'a'), /再点検で1点の高さが不明/);
});

test('aircraft names never repeat in a record', ()=>{
  const two = detourTeamRecord({at:'t',area:'a',side:'none',state:'accepted',reason:'2号機（→X）：仮想便が終了',source:'manual',flight:'two'});
  assert.ok(!detourRecordText(two).includes('2号機2号機'));
  assert.ok(!pastDetourNote(two, 'a').includes('2号機2号機'));
});

test('automatic consult settles the control-side camera move before capture', async()=>{
  const h = await harness();
  armConsult(h);
  h.run(`setTimeout=(fn)=>{fn();return 0};
    __net.cam='follow'; __net.touched=false; __net.tags=0;
    realMap.cameraMode=()=>__net.cam;
    realMap.chooseCamera=(v,t2,prog)=>{__net.choose=[v,t2,prog];__net.cam='wide'};
    realMap.clearViewTouched=()=>{__net.touched=false};
    realMap.isViewTouched=()=>__net.touched;
    realMap.capture=()=>{__net.tags++;return {image:'data:image/png;base64,AA==',canvas:{width:10,height:10},view:{tag:__net.tags}}};
    realMap.isViewCurrent=(v)=>v.tag>=2;`);
  h.run('runMapConsult({automatic:true})');
  await flush();
  assert.equal(h.run('JSON.stringify(__net.choose)'), '["wide","one",true]');
  assert.ok(h.net.calls.some(u=>u.includes('/api/map-plan')), 'capture happens after the move settles');
});

test('user touch before capture aborts the automatic consult', async()=>{
  const h = await harness();
  armConsult(h);
  h.run(`__net.cam='follow'; __net.touched=true; __net.tags=0;
    realMap.cameraMode=()=>__net.cam;
    realMap.chooseCamera=(v)=>{__net.cam='wide'};
    realMap.clearViewTouched=()=>{};
    realMap.isViewTouched=()=>__net.touched;
    realMap.capture=()=>{__net.tags++;return {image:'data:image/png;base64,AA==',canvas:{width:10,height:10},view:{tag:__net.tags}}};
    realMap.isViewCurrent=()=>true;`);
  h.run('runMapConsult({automatic:true})');
  await flush();
  assert.equal(h.net.calls.filter(u=>u.includes('/api/map-plan')).length, 0);
  assert.match(h.el('map-sim-consult-status').textContent, /操作したため相談を中止/);
});

test('sampling queue serializes point inspections', async()=>{
  const q = createSamplingQueue();
  const order = [];
  const slow = q.run(async()=>{order.push('slow-start');await new Promise(r=>setTimeout(r,30));order.push('slow-end');return 'slow'}, {});
  const fast = q.run(async()=>{order.push('fast');return 'fast'}, {});
  assert.deepEqual(await Promise.all([slow, fast]), ['slow', 'fast']);
  assert.deepEqual(order, ['slow-start', 'slow-end', 'fast']);
});

test('abort cancels a waiting inspection and the queue recovers', async()=>{
  const q = createSamplingQueue();
  const holder = q.run(async()=>{await new Promise(r=>setTimeout(r,20));return 'holder'}, {});
  const controller = new AbortController();
  const waiter = q.run(async()=>'waiter', {signal:controller.signal});
  controller.abort();
  await assert.rejects(waiter, /中止しました/);
  assert.equal(await holder, 'holder');
  assert.equal(await q.run(async()=>'third', {}), 'third');
});

test('a long wait aborts but a failed inspection never poisons the queue', async()=>{
  const q = createSamplingQueue({waitMs:20});
  q.run(()=>new Promise(()=>{}), {}).catch(()=>{});
  await assert.rejects(q.run(async()=>'never', {}), /待機が長引いた/);
  const r = createSamplingQueue();
  await assert.rejects(r.run(async()=>{throw new Error('boom')}, {}), /boom/);
  assert.equal(await r.run(async()=>'after', {}), 'after');
});

test('sampling lock wraps every height read via static inspection', async()=>{
  const source = await readProj('real-map.mjs');
  assert.equal(source.split('withSamplingLock(run,()=>').length - 1, 6);
  assert.ok(source.includes('createSamplingQueue'));
});

test('post-response view mismatch records capture-vs-response diagnostics', async()=>{
  const h = await harness();
  armConsult(h);
  h.run(`__net.views=[{width:800,height:600,matrix:[1,0,0,0,0,1,0,0,0,0,1,0,10,20,30,1]},{width:800,height:601,matrix:[1,0,0,0,0,1,0,0,0,0,1,0,10.5,21,30,1]}];__net.sent=0;
    realMap.capture=()=>{const v=__net.views[Math.min(__net.sent++,__net.views.length-1)];return {image:'data:image/png;base64,AA==',canvas:{width:v.width,height:v.height},view:v};};
    realMap.isViewCurrent=()=>false;`);
  h.el('map-sim-consult').click();
  await flush();
  assert.equal(h.run('mapPlanChoice'), null);
  assert.equal(h.net.continue, undefined);
  assert.match(h.el('map-sim-consult-status').textContent, /変わった/);
  assert.match(h.el('map-team-log').textContent, /診断：相談の無効化（理由：view/);
  assert.match(h.el('map-team-log').textContent, /送信時800x600→応答時800x601（画面サイズ不一致）/);
  assert.match(h.el('map-team-log').textContent, /カメラ差分2件/);
});
test('scene change after a consult records a scene reason', async()=>{
  const h = await harness();
  armConsult(h);
  h.el('map-sim-consult').click();
  await flush();
  assert.equal(h.net.continue, 'A');
  h.run('realMapSceneChanged()');
  assert.equal(h.run('mapPlanChoice'), null);
  assert.match(h.el('map-team-log').textContent, /診断：相談の無効化（理由：scene/);
});
test('starting a new consult records a restart reason', async()=>{
  const h = await harness();
  armConsult(h);
  h.el('map-sim-consult').click();
  await flush();
  assert.equal(h.net.continue, 'A');
  h.el('map-sim-consult').click();
  await flush();
  assert.equal(h.net.calls.filter(u=>u.includes('/api/map-plan')).length, 2);
  assert.match(h.el('map-team-log').textContent, /診断：相談の無効化（理由：restart/);
});

test('float-level drift between capture and response still accepts the consult', async()=>{
  const h = await harness();
  armConsult(h);
  h.run(`__net.base=[1,0,0,0,0,1,0,0,0,0,1,0,10,20,30,1];
    __net.sentView={width:800,height:600,matrix:__net.base};
    __net.liveView={width:800,height:600,matrix:[__net.base[0]+2e-7,...__net.base.slice(1,12),__net.base[12]+1e-9,...__net.base.slice(13)]};
    realMap.capture=()=>{__net.caps=(__net.caps||0)+1;const v=__net.caps>1?__net.liveView:__net.sentView;return {image:'data:image/png;base64,AA==',canvas:{width:v.width,height:v.height},view:v};};
    realMap.isViewCurrent=()=>isViewFrameCurrent(__net.sentView,__net.liveView);`);
  h.el('map-sim-consult').click();
  await flush();
  assert.equal(h.net.continue, 'A');
  assert.equal(h.run('mapPlanChoice'), 'A');
  assert.doesNotMatch(h.el('map-team-log').textContent, /相談の無効化/);
});
test('a real drag-level change after the response still discards the consult', async()=>{
  const h = await harness();
  armConsult(h);
  h.run(`__net.base=[1,0,0,0,0,1,0,0,0,0,1,0,10,20,30,1];
    __net.sentView={width:800,height:600,matrix:__net.base};
    __net.liveView={width:800,height:600,matrix:[__net.base[0]+8e-4,...__net.base.slice(1)]};
    realMap.capture=()=>{__net.caps=(__net.caps||0)+1;const v=__net.caps>1?__net.liveView:__net.sentView;return {image:'data:image/png;base64,AA==',canvas:{width:v.width,height:v.height},view:v};};
    realMap.isViewCurrent=()=>isViewFrameCurrent(__net.sentView,__net.liveView);`);
  h.el('map-sim-consult').click();
  await flush();
  assert.equal(h.run('mapPlanChoice'), null);
  assert.equal(h.net.continue, undefined);
  assert.match(h.el('map-sim-consult-status').textContent, /変わった/);
  assert.match(h.el('map-team-log').textContent, /診断：相談の無効化（理由：view/);
  assert.match(h.el('map-team-log').textContent, /\[0\]差0\.0008/);
});
test('a resize between capture and response still discards the consult', async()=>{
  const h = await harness();
  armConsult(h);
  h.run(`__net.base=[1,0,0,0,0,1,0,0,0,0,1,0,10,20,30,1];
    __net.sentView={width:800,height:600,matrix:__net.base};
    __net.liveView={width:801,height:600,matrix:__net.base};
    realMap.capture=()=>{__net.caps=(__net.caps||0)+1;const v=__net.caps>1?__net.liveView:__net.sentView;return {image:'data:image/png;base64,AA==',canvas:{width:v.width,height:v.height},view:v};};
    realMap.isViewCurrent=()=>isViewFrameCurrent(__net.sentView,__net.liveView);`);
  h.el('map-sim-consult').click();
  await flush();
  assert.equal(h.run('mapPlanChoice'), null);
  assert.match(h.el('map-team-log').textContent, /画面サイズ不一致/);
});
test('a phase change before the reply lands discards it as a phase reason', async()=>{
  const h = await harness();
  armConsult(h);
  let release;
  h.net.reply = new Promise(r=>release=r);
  h.el('map-sim-consult').click();
  await flush();
  assert.equal(h.net.calls.filter(u=>u.includes('/api/map-plan')).length, 1);
  h.run("mapPlanPhase='direct'");
  release({sora:'A',nagi:'A',validation:{state:'accepted',reason:'条件を満たした'}});
  await flush();
  assert.equal(h.run('mapPlanChoice'), null);
  assert.equal(h.net.continue, undefined);
  assert.match(h.el('map-team-log').textContent, /診断：相談の無効化（理由：phase/);
});

test('consult flight locks the view and releases it on stop', async()=>{
  const h = await harness();
  armConsult(h);
  h.run("__net.locks=[];realMap.setViewLock=(v)=>{__net.locks.push(v)};");
  let release;
  h.net.reply = new Promise(r=>release=r);
  h.el('map-sim-consult').click();
  await flush();
  assert.equal(h.net.locks.join(','), 'true');
  h.run('realMapSceneChanged()');
  assert.equal(h.net.locks.join(','), 'true,false');
  release({sora:'A',nagi:'A',validation:{state:'accepted',reason:'条件を満たした'}});
  await flush();
  assert.equal(h.run('mapPlanChoice'), null);
});
test('accepted consult releases the view lock on completion', async()=>{
  const h = await harness();
  armConsult(h);
  h.run("__net.locks=[];realMap.setViewLock=(v)=>{__net.locks.push(v)};");
  h.el('map-sim-consult').click();
  await flush();
  assert.equal(h.net.continue, 'A');
  assert.equal(h.net.locks.join(','), 'true,false');
});
test('camera motion during the flight rejects the late reply', async()=>{
  const h = await harness();
  armConsult(h);
  h.run(`__net.base=[1,0,0,0,0,1,0,0,0,0,1,0,10,20,30,1];
    __net.sentView={width:800,height:600,matrix:__net.base};
    __net.liveView={width:800,height:600,matrix:__net.base};
    realMap.capture=()=>{__net.caps=(__net.caps||0)+1;const v=__net.caps>1?__net.liveView:__net.sentView;return {image:'data:image/png;base64,AA==',canvas:{width:v.width,height:v.height},view:v};};
    realMap.isViewCurrent=()=>isViewFrameCurrent(__net.sentView,__net.liveView);`);
  let release;
  h.net.reply = new Promise(r=>release=r);
  h.el('map-sim-consult').click();
  await flush();
  assert.equal(h.net.calls.filter(u=>u.includes('/api/map-plan')).length, 1);
  h.run("__net.liveView={width:800,height:600,matrix:[__net.base[0]+1e-3,...__net.base.slice(1)]};");
  release({sora:'A',nagi:'A',validation:{state:'accepted',reason:'条件を満たした'}});
  await flush();
  assert.equal(h.run('mapPlanChoice'), null);
  assert.equal(h.net.continue, undefined);
  assert.match(h.el('map-team-log').textContent, /診断：相談の無効化（理由：view/);
  assert.match(h.el('map-team-log').textContent, /\[0\]差0\.001/);
});

test('missing evidence releases the consult so a retry is possible', async()=>{
  const h = await harness();
  armConsult(h);
  h.run("mapProbeReports=null; __net.locks=[]; realMap.setViewLock=(v)=>{__net.locks.push(v)};");
  h.el('map-sim-consult').click();
  await flush();
  assert.equal(h.net.locks.join(','), 'true,false');
  assert.equal(h.run('mapPlanController===null'), true);
  assert.match(h.el('map-sim-consult-status').textContent, /点検結果が不足/);
  h.el('map-sim-consult').click();
  await flush();
  assert.equal(h.net.locks.join(','), 'true,false,true,false');
});
test('touch-aborted wait releases the consult and a retry sends', async()=>{
  const h = await harness();
  armConsult(h);
  h.run(`__net.cam='follow'; __net.touched=true;
    realMap.cameraMode=()=>__net.cam;
    realMap.chooseCamera=(v)=>{__net.cam='wide'};
    realMap.clearViewTouched=()=>{};
    realMap.isViewTouched=()=>__net.touched;
    realMap.capture=()=>({image:'data:image/png;base64,AA==',canvas:{width:10,height:10},view:{}});
    realMap.isViewCurrent=()=>true;
    __net.locks=[];realMap.setViewLock=(v)=>{__net.locks.push(v)};`);
  h.run('runMapConsult({automatic:true})');
  await flush();
  assert.equal(h.net.calls.filter(u=>u.includes('/api/map-plan')).length, 0);
  assert.match(h.el('map-sim-consult-status').textContent, /操作したため相談を中止/);
  assert.equal(h.net.locks.join(','), 'true,false');
  assert.equal(h.run('mapPlanController===null'), true);
  h.run("__net.touched=false; runMapConsult({automatic:true})");
  await flush();
  assert.equal(h.net.calls.filter(u=>u.includes('/api/map-plan')).length, 1);
  assert.equal(h.net.locks.join(','), 'true,false,true,false');
});
test('stale wait failure never releases a newer consult', async()=>{
  const h = await harness();
  armConsult(h);
  h.run(`__net.sleeps=[];
    setTimeout=(fn)=>{__net.sleeps.push(fn);return __net.sleeps.length};
    realMap.cameraMode=()=> 'follow';
    realMap.chooseCamera=()=>{};
    realMap.clearViewTouched=()=>{};
    realMap.isViewTouched=()=>false;
    realMap.capture=()=>({image:'data:image/png;base64,AA==',canvas:{width:10,height:10},view:{}});
    realMap.isViewCurrent=()=>false;
    __net.locks=[];realMap.setViewLock=(v)=>{__net.locks.push(v)};`);
  h.run('runMapConsult({automatic:true})');
  await flush();
  assert.equal(h.net.sleeps.length, 1);
  assert.equal(h.net.locks.join(','), 'true');
  h.run('realMapSceneChanged()');
  assert.equal(h.net.locks.join(','), 'true,false');
  h.run('runMapConsult({automatic:true})');
  await flush();
  assert.equal(h.net.sleeps.length, 2);
  const v2 = h.run('mapPlanVersion');
  assert.equal(h.run('mapPlanController!==null'), true);
  h.run('__net.sleeps[0]()');
  await flush();
  assert.equal(h.run('mapPlanVersion'), v2);
  assert.equal(h.run('mapPlanController!==null'), true);
  assert.equal(h.net.locks.join(','), 'true,false,true');
});

test('silent phase change exits the wait without touching fresh status', async()=>{
  const h = await harness();
  armConsult(h);
  h.run(`__net.sleeps=[];
    setTimeout=(fn)=>{__net.sleeps.push(fn);return __net.sleeps.length};
    realMap.cameraMode=()=> 'follow';
    realMap.chooseCamera=()=>{};
    realMap.clearViewTouched=()=>{};
    realMap.isViewTouched=()=>false;
    realMap.capture=()=>({image:'data:image/png;base64,AA==',canvas:{width:10,height:10},view:{}});
    realMap.isViewCurrent=()=>false;
    __net.locks=[];realMap.setViewLock=(v)=>{__net.locks.push(v)};`);
  h.run('runMapConsult({automatic:true})');
  await flush();
  assert.equal(h.net.sleeps.length, 1);
  const v0 = h.run('mapPlanVersion');
  h.run("mapPlanPhase='detour';");
  h.el('map-sim-consult-status').textContent = '仮想案Aを再生中です。';
  h.run('__net.sleeps[0]()');
  await flush();
  assert.equal(h.run('mapPlanController===null'), true);
  assert.equal(h.net.locks.join(','), 'true,false');
  assert.equal(h.run('mapPlanVersion'), v0);
  assert.equal(h.el('map-sim-consult-status').textContent, '仮想案Aを再生中です。');
  assert.doesNotMatch(h.el('map-team-log').textContent, /相談の無効化/);
});

test('panel stop during direct flight logs and saves the manual stop', async()=>{
  const h = await harness();
  h.el('map-area-title').textContent = '東京都荒川区 ／ 実地図';
  h.run(`mapPlanPhase='direct'; mapPlanChoice=null; mapDetourEvidence=null; mapTeamPending=null; mapProbeReports=null; mapFleetActive=false;
    realMap={mapFlightActive:()=>true,stopSimulation(){__net.stopped=true}};`);
  h.el('map-sim-stop').click();
  assert.equal(h.net.stopped, true);
  assert.match(h.el('map-team-log').textContent, /手動で移動を終了しました/);
  await flush(1);
  assert.match(h.el('map-team-log').textContent, /(保存した|保存に失敗)/);
  assert.match(h.el('map-sim-status').textContent, /利用者が仮想移動を終了しました/);
  const saved = savedLast(h);
  assert.equal(saved.side, 'none');
  assert.equal(saved.state, 'stopped');
  assert.equal(saved.source, 'manual');
  assert.equal(saved.flight, 'one');
});
test('stopping is immediate even if another tab holds the save lock',async()=>{
 const h=await harness();h.el('map-area-title').textContent='東京都荒川区 ／ 実地図';let release,calls=0;
 const gate=new Promise(resolve=>{release=resolve});h.ctx.updateLocalHistory=async({storage,key,update})=>{calls++;await gate;storage.setItem(key,update(storage.getItem(key)))};
 h.run(`mapPlanPhase='direct'; realMap={mapFlightActive:()=>true,stopSimulation(){__net.stopped=true}};`);
 h.el('map-sim-stop').click();assert.equal(h.net.stopped,true);assert.match(h.run('mapLastStopNotice'),/保存中/);
 h.el('map-sim-stop').click();assert.equal(calls,1);assert.equal(h.run(`localStorage.getItem('${KEY}')`),null);
 release();await flush(1);assert.equal(savedAll(h).length,1);assert.match(h.run('mapLastStopNotice'),/再開できます/);
});
test('a delayed save does not restore a notice after switching regions',async()=>{
 const h=await harness();h.el('map-area-title').textContent='東京都荒川区 ／ 実地図';let release;
 const gate=new Promise(resolve=>{release=resolve});h.ctx.updateLocalHistory=async({storage,key,update})=>{await gate;storage.setItem(key,update(storage.getItem(key)))};
 h.run(`mapPlanPhase='direct'; realMap={mapFlightActive:()=>true,stopSimulation(){},setArea(){}};`);h.el('map-sim-stop').click();
 h.run("realMap.mapFlightActive=()=>false; applyAreaSelection('13101','東京都千代田区');");assert.equal(h.run('mapLastStopNotice'),null);
 release();await flush(1);assert.equal(h.run('mapLastStopNotice'),null);assert.equal(savedAll(h).length,1);
});
test('dock stop during detour with a choice saves that side once', async()=>{
  const h = await harness();
  h.el('map-area-title').textContent = '東京都荒川区 ／ 実地図';
  h.run(`realMode=true; mapPlanPhase='detour'; mapPlanChoice='A'; mapDetourEvidence=null; mapTeamPending=null; mapProbeReports=null; mapFleetActive=false;
    realMap={mapFlightActive:()=>true,stopSimulation(){__net.stopped=true}};`);
  const before = savedAll(h).length;
  h.el('map-dock-stop').click();
  assert.equal(h.net.stopped, true);
  assert.equal(savedAll(h).length, before + 1);
  assert.equal(savedLast(h).side, 'A');
  assert.match(h.el('map-team-log').textContent, /手動で移動を終了しました/);
});
test('manual stop during a Muse-pending flight settles the pending choice', async()=>{
  const h = await harness();
  h.el('map-area-title').textContent = '東京都荒川区 ／ 実地図';
  h.run(`mapPlanPhase='obstacle'; mapPlanChoice=null; mapDetourEvidence=null;
    mapTeamPending={side:'B',reason:'条件を満たした',evidence:null}; mapProbeReports=null; mapFleetActive=false;
    realMap={mapFlightActive:()=>true,stopSimulation(){__net.stopped=true}};`);
  h.el('map-sim-stop').click();
  assert.equal(h.run('mapTeamPending===null'), true);
  assert.equal(savedLast(h).side, 'B');
  assert.match(h.el('map-team-log').textContent, /手動で移動を終了しました/);
});
test('manual stop clears pending consultation subtitle and delayed speech',async()=>{
  const h=await harness();h.el('map-area-title').textContent='東京都荒川区 ／ 実地図';
  h.run(`mapPlanPhase='detour';mapPlanChoice='A';mapTeamPending={side:'A',reason:'x',provenance:'fixture'};mapSubtitleTimer=99;
    __net.cleared=[];clearTimeout=id=>__net.cleared.push(id);realMap={mapFlightActive:()=>true,stopSimulation(){},setViewLock(){}};`);
  h.el('map-subtitle').hidden=false;h.el('map-sim-stop').click();await flush();
  assert.equal(h.el('map-subtitle').hidden,true);assert.equal(h.run('mapSubtitleTimer'),null);assert.ok(h.net.cleared.includes(99));
});
test('stop after completion or before start saves nothing new', async()=>{
  const h = await harness();
  h.el('map-area-title').textContent = '東京都荒川区 ／ 実地図';
  h.run(`mapPlanPhase='complete'; mapPlanChoice='A'; mapDetourEvidence=null; mapTeamPending=null;
    realMap={mapFlightActive:()=>false,stopSimulation(){__net.stopped=true}};`);
  const logBefore = h.el('map-team-log').textContent, savedBefore = h.run(`localStorage.getItem('${KEY}')`);
  h.el('map-sim-stop').click();
  assert.equal(h.el('map-team-log').textContent, logBefore);
  assert.equal(h.run(`localStorage.getItem('${KEY}')`), savedBefore);
  h.run("mapPlanPhase='needs-points';");
  h.el('map-dock-stop').click();
  assert.equal(h.el('map-team-log').textContent, logBefore);
});
test('failed manual-stop save is shown instead of claimed', async()=>{
  const h = await harness();
  h.el('map-area-title').textContent = '東京都荒川区 ／ 実地図';
  h.run(`mapPlanPhase='direct'; mapPlanChoice=null; mapDetourEvidence=null; mapTeamPending=null; mapProbeReports=null; mapFleetActive=false;
    realMap={mapFlightActive:()=>true,stopSimulation(){__net.stopped=true}};
    localStorage.setItem=()=>{throw new Error('disk full')};`);
  h.el('map-sim-stop').click();
  assert.match(h.el('map-team-log').textContent, /手動で移動を終了しました/);
  await flush(1);
  assert.match(h.el('map-team-log').textContent, /保存に失敗/);
});
test('second-unit return re-enables destination and origin controls', async()=>{
  const h = await harness();
  h.el('map-area-title').textContent = '東京都荒川区 ／ 実地図';
  h.el('shelter-select').disabled = true;
  h.el('choose-origin').disabled = true;
  h.run(`mapPlanPhase='delivery'; mapAreaState='ready'; mapFleetActive=true;
    shelterList=[{name:'第二施設',address:'荒川区',latitude:35.74,longitude:139.785}];
    realMap={mapFlightActive:()=>false,stopSimulation(){}};`);
  h.run("renderFleet({phase:'home',name:'第二施設'})");
  assert.equal(h.el('shelter-select').disabled, false);
  assert.equal(h.el('choose-origin').disabled, false);
});

test('manual stop keeps a restartable notice after the phase resets', async()=>{
  const h = await harness();
  h.el('map-area-title').textContent = '東京都荒川区 ／ 実地図';
  h.run(`mapPlanPhase='direct'; mapPlanChoice=null; mapDetourEvidence=null; mapTeamPending=null; mapProbeReports=null; mapFleetActive=false;
    realMap={mapFlightActive:()=>true,stopSimulation(){__net.stopped=true},simulate:()=>true};`);
  h.el('map-sim-stop').click();
  h.run("mapPlanPhase='needs-points'; mapAreaState='ready'; mapSourceEvidence={buildings:'available'}; syncFlow();");
  await flush(1);
  assert.match(h.el('map-guide-live').textContent, /利用者が配送を終了しました。再開できます/);
  h.el('map-sim-start').click();
  assert.equal(h.run('mapLastStopNotice===null'), true);
  h.run("syncFlow();");
  assert.equal(h.el('map-guide-live').hidden, true);
});
test('failed stop save keeps a failure notice in the same place', async()=>{
  const h = await harness();
  h.el('map-area-title').textContent = '東京都荒川区 ／ 実地図';
  h.run(`mapPlanPhase='direct'; mapPlanChoice=null; mapDetourEvidence=null; mapTeamPending=null; mapProbeReports=null; mapFleetActive=false;
    realMap={mapFlightActive:()=>true,stopSimulation(){__net.stopped=true}};
    localStorage.setItem=()=>{throw new Error('disk full')};`);
  h.el('map-sim-stop').click();
  h.run("mapPlanPhase='needs-points'; syncFlow();");
  await flush(1);
  assert.match(h.el('map-guide-live').textContent, /保存に失敗/);
  assert.match(h.el('map-guide-live').textContent, /再開できます/);
});
test('area change clears the stop notice', async()=>{
  const h = await harness();
  h.el('map-area-title').textContent = '東京都荒川区 ／ 実地図';
  h.run(`mapPlanPhase='direct'; mapPlanChoice=null; mapDetourEvidence=null; mapTeamPending=null; mapProbeReports=null; mapFleetActive=false;
    realMap={mapFlightActive:()=>true,stopSimulation(){},setArea(){}};`);
  h.el('map-sim-stop').click();
  assert.equal(h.run('mapLastStopNotice===null'), false);
  h.run("realMap.mapFlightActive=()=>false; applyAreaSelection('13101','東京都千代田区');");
  assert.equal(h.run('mapLastStopNotice===null'), true);
});

test('manual stop never duplicates an already saved first-unit record', async()=>{
  const h = await harness();
  h.el('map-area-title').textContent = '東京都荒川区 ／ 実地図';
  h.run(`saveAndLog({side:'none',state:'stopped',reason:'Museの回答は none でした',source:'Muse',flight:'one',evidence:null},'ok','fail');
    mapPlanPhase='obstacle'; mapPlanChoice=null; mapDetourEvidence=null; mapTeamPending=null; mapProbeReports=null; mapFleetActive=false;
    realMap={mapFlightActive:()=>true,stopSimulation(){__net.stopped=true}};`);
  const before = savedAll(h).length;
  h.el('map-sim-stop').click();
  assert.equal(savedAll(h).length, before);
  assert.match(h.el('map-team-log').textContent, /手動で移動を終了しました/);
  h.run("mapPlanPhase='needs-points'; syncFlow();");
  await flush(1);
  assert.match(h.el('map-guide-live').textContent, /再開できます/);
  assert.doesNotMatch(h.el('map-guide-live').textContent, /保存に失敗/);
});
test('stopping while the second unit returns records its abort, not a first-unit stop', async()=>{
  const h = await harness();
  h.el('map-area-title').textContent = '東京都荒川区 ／ 実地図';
  h.run(`saveAndLog({side:'A',state:'accepted',reason:'Museが仮想案Aを選びました',source:'Muse',flight:'one',evidence:null},'ok','fail');
    realMode=true; mapPlanPhase='complete'; mapPlanChoice=null; mapDetourEvidence=null; mapTeamPending=null; mapProbeReports=null; mapFleetActive=true;
    realMap={mapFlightActive:()=>true,stopSimulation(reason){__net.stopReason=reason}};`);
  const before = savedAll(h).length;
  h.el('map-dock-stop').click();
  assert.equal(savedAll(h).length, before);
  assert.equal(h.net.stopReason, '利用者が配送を終了しました');
  assert.match(h.el('map-team-log').textContent, /手動で移動を終了しました/);
  h.run("renderFleet({phase:'stopped',name:'第二施設',message:'利用者が配送を終了しました'})");
  const last = savedLast(h);
  assert.equal(last.flight, 'two');
  assert.equal(last.state, 'stopped');
  assert.match(last.reason, /利用者が配送を終了しました/);
});

test('second-unit save never reopens first-unit saving on stop', async()=>{
  const h = await harness();
  h.el('map-area-title').textContent = '東京都荒川区 ／ 実地図';
  h.run(`saveAndLog({side:'none',state:'stopped',reason:'Museの回答は none でした',source:'Muse',flight:'one',evidence:null},'ok','fail');
    renderFleet({phase:'home',name:'第二施設'});`);
  const ones = () => savedAll(h).filter(r=>r.flight==='one').length;
  assert.equal(ones(), 1);
  h.run(`mapPlanPhase='obstacle'; mapPlanChoice=null; mapDetourEvidence=null; mapTeamPending=null; mapProbeReports=null; mapFleetActive=false;
    realMap={mapFlightActive:()=>true,stopSimulation(){__net.stopped=true}};`);
  h.el('map-sim-stop').click();
  assert.equal(ones(), 1);
  assert.match(h.el('map-team-log').textContent, /手動で移動を終了しました/);
});
test('save mark survives failure and new flights', async()=>{
  const h = await harness();
  h.el('map-area-title').textContent = '東京都荒川区 ／ 実地図';
  h.run(`mapPlanPhase='direct'; mapPlanChoice=null; mapDetourEvidence=null; mapTeamPending=null; mapProbeReports=null; mapFleetActive=false;
    realMap={mapFlightActive:()=>true,stopSimulation(){}};
    __net.realSetItem=localStorage.setItem;
    localStorage.setItem=()=>{throw new Error('disk full')};`);
  h.el('map-sim-stop').click();
  assert.equal(h.run('mapTeamSavedKey'), '');
  await flush(1);
  h.run(`localStorage.setItem=__net.realSetItem;`);
  h.el('map-sim-stop').click();
  await flush(1);
  assert.equal(h.run('mapTeamSavedKey'), '0:one');
  assert.match(h.el('map-team-log').textContent, /結果を端末に保存した/);
  h.run(`mapTeamSaveGen++;`);
  h.el('map-sim-stop').click();
  await flush(1);
  assert.equal(h.run('mapTeamSavedKey'), '1:one');
  assert.equal(savedAll(h).filter(r=>r.flight==='one').length, 2);
});
