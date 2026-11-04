import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {positionAt,progressBeforeReplan,makeCity,fitImage,isValidRoute} from './mission.mjs';
import {readPlanStream} from './plan-stream.mjs';
import {configureSpeech,trackSpeech} from './speech.mjs';
import {initialCamera,beginFlight,selectCamera,deliveryCamera} from './camera.mjs';
import {canReplayMapRoute,secondFleetCandidates,jmaWarningLink,mapSimulationPath,routeSamplePoints,filterShelters,nearbyShelters} from './geo-data.mjs';
import {requestDraft,simulationManifest,suggestRequest,suggestShelters,mapFloodContext,mapConsultHistoryContext,createConsultAudit,finishConsultAudit,finishUncertainConsultAudit,decodeConsultAudits,consultImageDigest,mapMissionSteps,mapMissionDistance,mapMissionEvidence,mapRouteSummary,fleetStatus,fleetPosition,createMapScan,createMapConsultation,createFacilityFloodTracker,detourEvidencePayload,summarizeDetourValidation,detourTeamRecord,pastDetourNote,reinspectVerdict,detourRelevanceForSecond,hazardNearPointsM} from './readiness.mjs';

async function harness(getUserMedia, transcribe, getStatus, timers={setTimeout,clearTimeout}, plan, speech, audio) {
  const source=(await readFile(new URL('./app.js',import.meta.url),'utf8')).replace(/^import .*?;\s*/gm, '');
  const elements=new Map();
  function element(id){
    if(!elements.has(id))elements.set(id,{
      id, textContent:'', value:'', disabled:false, style:{}, dataset:{}, classList:{values:new Set(),add(value){this.values.add(value)},remove(value){this.values.delete(value)},toggle(value){if(this.values.has(value)){this.values.delete(value);return false}this.values.add(value);return true},contains(value){return this.values.has(value)}}, handlers:{},attributes:{}, clientWidth:800,clientHeight:600,
      addEventListener(type,callback){this.handlers[type]=callback}, setAttribute(name,value){this.attributes[name]=value}, removeAttribute(name){delete this.attributes[name]},
      getContext(){return {setTransform(){},drawImage(){}}}, toDataURL(){return 'data:image/png;base64,AA=='}, querySelector(){return null}, querySelectorAll(){return []}, replaceChildren(){}, append(){},
    });
    return elements.get(id);
  }
  const calls=[];
  class Recorder {
    constructor(stream){this.stream=stream;this.state='inactive'}
    start(){this.state='recording'}
    stop(){this.state='inactive';queueMicrotask(()=>this.onstop?.())}
  }
  const context={document:{getElementById:element,createElement:()=>({append(){},getContext(){return {drawImage(){}}},toDataURL(){return 'data:image/png;base64,AA=='}})},window:speech?{speechSynthesis:speech,confirm:()=>true}:{confirm:()=>true},speechSynthesis:speech,SpeechSynthesisUtterance:class{constructor(text){this.text=text}},navigator:{mediaDevices:{getUserMedia}},
    ResizeObserver:class{observe(){}},MediaRecorder:Recorder,devicePixelRatio:1,positionAt,progressBeforeReplan,makeCity,fitImage,isValidRoute,readPlanStream,configureSpeech,trackSpeech,initialCamera,beginFlight,selectCamera,deliveryCamera,canReplayMapRoute,secondFleetCandidates,jmaWarningLink,mapSimulationPath,routeSamplePoints,filterShelters,nearbyShelters,requestDraft,simulationManifest,suggestRequest,suggestShelters,mapFloodContext,mapConsultHistoryContext,createConsultAudit,finishConsultAudit,finishUncertainConsultAudit,decodeConsultAudits,consultImageDigest,mapMissionSteps,mapMissionDistance,mapMissionEvidence,mapRouteSummary,fleetStatus,fleetPosition,createMapScan,createMapConsultation,createFacilityFloodTracker,detourEvidencePayload,summarizeDetourValidation,detourTeamRecord,pastDetourNote,reinspectVerdict,detourRelevanceForSecond,hazardNearPointsM,createWorld:()=>({update(){}}),
    requestAnimationFrame(){},setInterval(){},setTimeout:timers.setTimeout,clearTimeout:timers.clearTimeout,queueMicrotask,performance,Blob,btoa,AbortSignal,AbortController,
    AudioContext:class{async decodeAudioData(){return audio??{sampleRate:24000,getChannelData(){return new Float32Array([0])}}}async close(){}},
    fetch:async(url,options)=>{calls.push(url);if(url==='/api/transcribe')return transcribe(options);if(url==='/api/plan')return plan(options);if(getStatus)return getStatus();return {ok:true,json:async()=>({enabled:true})}},
  };
  vm.runInNewContext(source,context);
  await new Promise(resolve=>setImmediate(resolve));
  return {element,calls,context,run:code=>vm.runInNewContext(code,context)};
}

test('compact map mission details open and close with the correct accessible state',async()=>{
  const app=await harness(),button=app.element('map-mission-more'),dock=app.element('map-mission-dock');
  button.handlers.click();assert.equal(dock.classList.contains('details-open'),true);assert.equal(button.attributes['aria-expanded'],'true');
  button.handlers.click();assert.equal(dock.classList.contains('details-open'),false);assert.equal(button.attributes['aria-expanded'],'false');
});

test('mobile origin selection returns to the map only after selection actually starts',async()=>{
  const app=await harness();let scrolled=0;
  app.context.window.scrollTo=options=>{assert.equal(options.top,0);scrolled++};
  app.run("window.matchMedia=()=>({matches:true});mapAreaState='ready';realMap={chooseOrigin(){}};");
  app.element('choose-origin').handlers.click();assert.equal(scrolled,1);
  app.run("mapAreaState='loading'");app.element('choose-origin').handlers.click();assert.equal(scrolled,1);
  app.run("mapAreaState='ready';realMap=null");app.element('choose-origin').handlers.click();assert.equal(scrolled,1);
});

test('second aircraft position switches target and clears when its flight is stopped',async()=>{
  const app=await harness();
  app.run("renderFleetPosition({phase:'outbound',distance:150,total:200})");
  assert.equal(app.element('map-fleet-position').hidden,false);
  assert.match(app.element('map-fleet-distance-label').textContent,/配送先/);
  assert.equal(app.element('map-fleet-progress').value,25);
  app.run("renderFleetPosition({phase:'returning',distance:100,total:200})");
  assert.match(app.element('map-fleet-distance-label').textContent,/出発地点/);
  assert.equal(app.element('map-fleet-progress').value,50);
  app.run("renderFleet({phase:'stopped',message:'中止'})");
  assert.equal(app.element('map-fleet-position').hidden,true);
  app.run('renderFleet(null)');assert.equal(app.element('map-fleet-position').hidden,true);
});

test('second destination selection follows available facilities and locks during a flight',async()=>{
  const app=await harness();
  app.run("shelterList=[{name:'一号',address:'A',latitude:35.742,longitude:139.78},{name:'近い',address:'B',latitude:35.741,longitude:139.78},{name:'別施設',address:'C',latitude:35.75,longitude:139.78}]; mapOriginPoint={latitude:35.74,longitude:139.78}; shelterChoice=0; mapPlanPhase='ready'; realMap={setFleetPreview(value){globalThis.lastPreview=value}}; renderFleetPreview()");
  assert.match(app.element('fleet-preview').textContent,/近い/);
  app.element('fleet-select').value='2';app.element('fleet-select').handlers.change();
  assert.match(app.element('fleet-preview').textContent,/別施設/);
  assert.equal(app.context.lastPreview.name,'別施設');
  app.run("mapPlanPhase='direct';syncFleetSelect()");
  assert.equal(app.element('fleet-select').disabled,true);
  app.element('fleet-select').value='1';app.element('fleet-select').handlers.change();
  assert.match(app.element('fleet-preview').textContent,/別施設/);
  app.run("mapPlanPhase='ready';shelterList=shelterList.slice(0,2);renderFleetPreview()");
  assert.equal(app.element('fleet-select').value,'auto');
  assert.match(app.element('fleet-preview').textContent,/近い/);
});

test('illustrative water requires a selected facility and updates its label',async()=>{
  const app=await harness();app.context.waterCalls=[];
  app.run("realMap={setWaterScene(show){waterCalls.push(show);return show}};syncWaterSelection(false)");
  assert.equal(app.element('water-toggle').disabled,true);
  assert.equal(app.element('water-banner').hidden,true);
  app.run('syncWaterSelection(true)');
  assert.equal(app.element('water-toggle').disabled,false);
  app.element('water-toggle').checked=true;app.element('water-toggle').handlers.change();
  assert.deepEqual(app.context.waterCalls,[true]);assert.equal(app.element('water-banner').hidden,false);
  app.element('water-toggle').checked=false;app.element('water-toggle').handlers.change();
  assert.deepEqual(app.context.waterCalls,[true,false]);assert.equal(app.element('water-banner').hidden,true);
  app.run('syncWaterSelection(false)');assert.equal(app.element('water-toggle').disabled,true);
});

test('region location status warns when the previous map may still be visible',async()=>{
  const app=await harness();
  app.run("renderAreaLocation('loading')");
  assert.equal(app.element('area-view-status').hidden,false);
  assert.match(app.element('area-view-status').textContent,/切り替え前/);
  app.run("renderAreaLocation('error')");
  assert.match(app.element('area-view-status').textContent,/取得できません/);
  app.run("renderAreaLocation('ready')");
  assert.equal(app.element('area-view-status').hidden,true);
});

test('unknown region position blocks map-image requests and origin selection until ready',async()=>{
  const app=await harness();
  app.run(`real=true;realMode=true;mapCapability=true;globalThis.originCalls=0;globalThis.scanCalls=0;globalThis.consultCalls=0;realMap={chooseOrigin(){originCalls++}};mapScan={run(){scanCalls++}};mapConsultation={run(){consultCalls++}};renderAreaLocation('ready')`);
  assert.equal(app.element('choose-origin').disabled,false);
  assert.equal(app.element('scan-map').disabled,false);
  assert.equal(app.element('consult-map').disabled,false);
  for(const state of ['loading','error']){
    app.run(`renderAreaLocation('${state}')`);
    for(const id of ['choose-origin','scan-map','consult-map'])assert.equal(app.element(id).disabled,true,id);
    for(const id of ['choose-origin','scan-map','consult-map'])app.element(id).handlers.click();
    assert.equal(app.context.originCalls,0);assert.equal(app.context.scanCalls,0);assert.equal(app.context.consultCalls,0);
  }
  app.run(`renderAreaLocation('ready')`);
  assert.equal(app.element('choose-origin').disabled,false);
  assert.equal(app.element('scan-map').disabled,false);
  assert.equal(app.element('consult-map').disabled,false);
});

test('losing region position cancels active image requests and keeps actions disabled',async()=>{
  const app=await harness();const signals=[];let started;const bothStarted=new Promise(resolve=>{started=resolve});
  app.context.fetch=(_url,options)=>new Promise((_resolve,reject)=>{signals.push(options.signal);if(signals.length===2)started();options.signal.addEventListener('abort',()=>reject(new Error('cancelled'))) });
  app.run(`real=true;realMode=true;mapCapability=true;realMap={capture(){return {image:'data:image/png;base64,AA==',canvas:{},view:{}}},isViewCurrent(){return true}};renderAreaLocation('ready')`);
  app.element('scan-map').handlers.click();app.element('consult-map').handlers.click();
  await bothStarted;
  assert.equal(signals.length,2);assert.ok(signals.every(signal=>!signal.aborted));
  app.run(`renderAreaLocation('loading')`);
  assert.ok(signals.every(signal=>signal.aborted));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(app.element('scan-map').disabled,true);
  assert.equal(app.element('consult-map').disabled,true);
});

test('changing region during image fingerprinting does not send an old image',async()=>{
  const app=await harness();let release;const held=new Promise(resolve=>{release=resolve});let calls=0;
  app.context.consultImageDigest=()=>held;app.context.fetch=()=>{calls++;throw new Error('unexpected send')};
  app.run(`real=true;realMode=true;mapCapability=true;realMap={capture(){return {image:'data:image/png;base64,AA==',canvas:{},view:{}}},isViewCurrent(){return true}};renderAreaLocation('ready')`);
  app.element('consult-map').handlers.click();app.run(`renderAreaLocation('loading')`);release(null);
  await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,0);assert.equal(app.element('consult-map').disabled,true);
});

test('a restored rain selection activates its map layer and details',async()=>{
  const app=await harness();
  const states=[];
  app.context.testMap={showRain:show=>states.push(show)};
  app.element('rain-toggle').checked=true;
  app.run('restoreRain(testMap)');
  assert.equal(app.element('rain-details').hidden,false);
  assert.deepEqual(states,[true]);
});

test('facility suggestions need confirmation and cannot apply a stale request or list',async()=>{
  const app=await harness();app.context.selected=[];
  app.run(`shelterList=[{name:'原中学校',address:'荒川区A'},{name:'第四中学校',address:'荒川区B'}];shelterState='ready';mapAreaState='ready';realMap={selectShelter:i=>selected.push(i)}`);
  app.element('draft-transcript').value='原中学校に水を十二箱';app.element('draft-transcript').handlers.input();
  assert.match(app.element('draft-shelter-suggestion').textContent,/原中学校.*荒川区A/);
  assert.deepEqual(app.context.selected,[]);
  app.element('draft-shelter-apply').handlers.click();assert.deepEqual(app.context.selected,[0]);
  app.element('draft-transcript').value='第四中学校に水を十二箱';app.element('draft-shelter-apply').handlers.click();
  assert.deepEqual(app.context.selected,[0]);
  app.element('draft-transcript').handlers.input();
  app.run(`shelterList=[{name:'別施設',address:'別地域'}]`);
  app.element('draft-shelter-apply').handlers.click();assert.deepEqual(app.context.selected,[0]);
});

test('the observation map action is available only while a current observation exists',async()=>{
  const app=await harness();app.context.focuses=0;
  app.run(`realMap={focusObservation(){focuses++}};renderObservationView(true)`);
  assert.equal(app.element('map-observation-view').hidden,false);
  app.element('map-observation-view').handlers.click();assert.equal(app.context.focuses,1);
  app.run(`renderObservationView(false)`);
  assert.equal(app.element('map-observation-view').hidden,true);
  app.element('map-observation-view').handlers.click();assert.equal(app.context.focuses,1);
  app.run(`mapOriginSelecting=true;renderObservationView(true)`);
  assert.equal(app.element('map-observation-view').disabled,true);
  app.element('map-observation-view').handlers.click();assert.equal(app.context.focuses,1);
});

test('map consultation shows the selected supply and valid quantity before sending',async()=>{
  const app=await harness();
  app.element('draft-supply').value='water';
  app.element('draft-supply').handlers.change();
  app.element('draft-quantity').value='12';
  app.element('draft-quantity').handlers.input();
  assert.match(app.element('consult-input').textContent,/飲料水/);
  assert.match(app.element('consult-input').textContent,/12箱/);
  app.element('draft-quantity').value='0';
  app.element('draft-quantity').handlers.input();
  assert.match(app.element('consult-input').textContent,/数量未指定/);
});

test('retry after a failed plan cancels queued speech from the previous attempt',async()=>{
  const events=[],speech={speaking:false,pending:false,getVoices:()=>[],cancel(){events.push('cancel')},speak(utterance){events.push(utterance.text)}};
  const plan=async()=>new Response('{"type":"sora","text":"前回の観察"}\n{"type":"error","error":"模擬失敗"}\n');
  const app=await harness(null,null,null,undefined,plan,speech);
  app.element('sound').handlers.click();app.element('command').value='届けて';
  await app.element('start').handlers.click();
  assert.ok(events.includes('前回の観察'));
  const previousLength=events.length;
  await app.element('start').handlers.click();
  assert.equal(events[previousLength],'cancel');
  assert.match(events[previousLength+1],/依頼を受け付け/);
});

test('speech playback failure leaves captions and planning available',async()=>{
  const speech={speaking:false,pending:false,getVoices:()=>[],cancel(){},speak(){throw new Error('audio unavailable')}};
  const plan=async()=>new Response('{"type":"result","result":{"route":"direct","nagi":"出発"}}\n');
  const app=await harness(null,null,null,undefined,plan,speech);
  app.element('sound').handlers.click();app.element('command').value='届けて';
  await app.element('start').handlers.click();
  assert.equal(app.element('sound').textContent,'音声 エラー');
  assert.equal(app.element('status-title').textContent,'配送中');
  assert.ok(app.calls.includes('/api/plan'));
});

test('a transcribed request is sent to planning when the user starts delivery',async()=>{
  let planningInput;
  const app=await harness(async()=>({getTracks:()=>[{stop(){}}]}),
    async()=>({ok:true,json:async()=>({result:'避難所Aに水を届けて'})}),null,undefined,
    async options=>{planningInput=JSON.parse(options.body);return new Response('{"type":"result","result":{"route":"direct","nagi":"出発します"}}\n')});
  await app.element('voice').handlers.click();
  await app.element('voice').handlers.click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(app.element('command').value,'避難所Aに水を届けて');
  await app.element('start').handlers.click();
  assert.equal(planningInput.command,'避難所Aに水を届けて');
  assert.equal(planningInput.hazard,false);
  assert.match(planningInput.image,/^data:image\/png;base64,/);
  assert.equal(app.element('original-plan').textContent,'中央を直進');
  assert.equal(app.element('voice').disabled,true);
});

test('live simulation sends no request if the user declines the text disclosure',async()=>{
  const app=await harness();let disclosure='';app.context.window.confirm=message=>{disclosure=message;return false};
  app.element('command').value='避難所Aに水を届けて';await app.element('start').handlers.click();
  assert.match(disclosure,/避難所Aに水を届けて/);assert.match(disclosure,/Meta/);
  assert.equal(app.calls.includes('/api/plan'),false);assert.equal(app.element('start').disabled,false);
});

test('offline simulation does not ask to send text to Meta',async()=>{
  const app=await harness(undefined,undefined,async()=>({ok:true,json:async()=>({enabled:false})}));
  let asked=false;app.context.window.confirm=()=>{asked=true;return false};app.element('command').value='仮想の依頼';
  app.element('start').handlers.click();assert.equal(asked,false);assert.equal(app.calls.includes('/api/plan'),false);
});

test('map voice transcription fills only the local draft and does not submit a request',async()=>{
  const app=await harness(async()=>({getTracks:()=>[{stop(){}}]}),async()=>({ok:true,json:async()=>({result:'水を12箱届けて'})}));
  app.element('mode-real').handlers.click();
  await app.element('draft-voice').handlers.click();
  await app.element('draft-voice').handlers.click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(app.element('draft-transcript').value,'水を12箱届けて');
  assert.equal(app.element('command').value,'');
  assert.equal(app.element('draft-supply').value,'');
  assert.equal(app.element('draft-quantity').value,'');
  assert.match(app.element('draft-voice-status').textContent,/確認/);
  assert.deepEqual(app.calls.filter(url=>url!=='/api/map-capabilities'),['/api/status','/api/transcribe']);
});
test('a transcription suggestion requires confirmation and cannot apply after the text changes',async()=>{
  const app=await harness(async()=>({getTracks:()=>[{stop(){}}]}),async()=>({ok:true,json:async()=>({result:'水を12箱届けて'})}));
  app.element('mode-real').handlers.click();await app.element('draft-voice').handlers.click();await app.element('draft-voice').handlers.click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(app.element('draft-supply').value,'');assert.equal(app.element('draft-quantity').value,'');
  assert.match(app.element('draft-suggestion').textContent,/飲料水.*12/);
  app.element('draft-apply').handlers.click();assert.equal(app.element('draft-supply').value,'water');assert.equal(app.element('draft-quantity').value,'12');
  app.element('draft-transcript').value='水と食料を3箱';app.element('draft-transcript').handlers.input();
  assert.equal(app.element('draft-apply').hidden,true);assert.match(app.element('draft-suggestion').textContent,/選択済みの値はそのまま/);app.element('draft-apply').handlers.click();
  assert.equal(app.element('draft-supply').value,'water');assert.equal(app.element('draft-quantity').value,'12');
});

test('map voice in progress prevents switching to the simulated flight',async()=>{
  const app=await harness(async()=>({getTracks:()=>[{stop(){}}]}),async()=>({ok:true,json:async()=>({result:'水'})}));
  app.element('mode-real').handlers.click();
  await app.element('draft-voice').handlers.click();
  app.element('mode-simulation').handlers.click();
  assert.match(app.element('draft-voice-status').textContent,/終了/);
  assert.equal(app.element('map-panel').hidden,false);
  await app.element('draft-voice').handlers.click();
  await new Promise(resolve=>setImmediate(resolve));
});

test('recording stops at 20 seconds and processes the captured audio',async()=>{
  let timeout,delay,stopped=0;
  const timers={setTimeout(fn,ms){timeout=fn;delay=ms;return 1},clearTimeout(){}};
  const app=await harness(async()=>({getTracks:()=>[{stop(){stopped++}}]}),async()=>({ok:true,json:async()=>({result:'水を届けて'})}),null,timers);
  await app.element('voice').handlers.click();assert.equal(delay,20000);timeout();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(app.element('command').value,'水を届けて');assert.ok(stopped>=1);
});

test('recording sends a mono 24 kHz PCM WAV with converted sample data',async()=>{
  let wav;
  const audio={sampleRate:48000,getChannelData:()=>new Float32Array([-1,.2,0,.2,1,.2])};
  const app=await harness(async()=>({getTracks:()=>[{stop(){}}]}),async options=>{
    wav=Buffer.from(JSON.parse(options.body).wav,'base64');return {ok:true,json:async()=>({result:'届けて'})};
  },null,undefined,undefined,undefined,audio);
  await app.element('voice').handlers.click();await app.element('voice').handlers.click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(wav.toString('ascii',0,4),'RIFF');assert.equal(wav.toString('ascii',8,12),'WAVE');
  assert.equal(wav.readUInt16LE(20),1);assert.equal(wav.readUInt16LE(22),1);
  assert.equal(wav.readUInt32LE(24),24000);assert.equal(wav.readUInt16LE(34),16);
  assert.equal(wav.readUInt32LE(40),6);assert.equal(wav.length,50);
  assert.deepEqual([wav.readInt16LE(44),wav.readInt16LE(46),wav.readInt16LE(48)],[-32767,0,32767]);
});

test('delivery cannot start while connection status is unresolved, including after reset',async()=>{
  let resolveStatus;
  const app=await harness(()=>{},null,()=>new Promise(resolve=>{resolveStatus=resolve}));
  app.element('command').value='届けて';
  assert.equal(app.element('start').disabled,true);
  await app.element('start').handlers.click();
  app.element('reset').handlers.click();
  assert.equal(app.element('start').disabled,true);
  resolveStatus({ok:true,json:async()=>({enabled:true})});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(app.element('start').disabled,false);
  assert.equal(app.element('mode-badge').textContent,'Muse接続設定あり');
  assert.deepEqual(app.calls,['/api/status']);
});

test('reset during microphone permission stops a late stream without sending audio',async()=>{
  let resolvePermission;let stopped=0;
  const app=await harness(()=>new Promise(resolve=>{resolvePermission=resolve}));
  const pending=app.element('voice').handlers.click();
  assert.equal(app.element('start').disabled,true);
  app.element('reset').handlers.click();
  resolvePermission({getTracks:()=>[{stop(){stopped++}}]});
  await pending;
  assert.equal(stopped,1);assert.equal(app.element('start').disabled,false);
  assert.deepEqual(app.calls,['/api/status']);
});

test('a transcription response arriving after reset cannot overwrite the next request',async()=>{
  let resolveResponse,requestSignal;
  const app=await harness(async()=>({getTracks:()=>[{stop(){}}]}),options=>new Promise(resolve=>{requestSignal=options.signal;resolveResponse=resolve}));
  await app.element('voice').handlers.click();
  await app.element('voice').handlers.click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.ok(resolveResponse,'transcription request started');
  app.element('reset').handlers.click();app.element('command').value='新しい依頼';
  assert.equal(requestSignal.aborted,true);
  resolveResponse({ok:true,json:async()=>({result:'古い依頼'})});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(app.element('command').value,'新しい依頼');
  assert.equal(app.element('start').disabled,false);
});

test('reset during recording stops the microphone and does not transcribe',async()=>{
  let stopped=0;
  const app=await harness(async()=>({getTracks:()=>[{stop(){stopped++}}]}));
  await app.element('voice').handlers.click();
  assert.equal(app.element('voice').textContent,'■ 録音を終了');
  app.element('reset').handlers.click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.ok(stopped>=1);assert.equal(app.element('start').disabled,false);
  assert.deepEqual(app.calls,['/api/status']);
});


test('a pending facility flood lookup blocks consultation and unknown results do not cancel a new request',async()=>{
  const app=await harness();
  let finish;app.context.fetch=()=>new Promise(resolve=>{finish=resolve});
  app.context.DATA={floodRisk:'https://example.test/{z}/{x}/{y}'};
  app.context.floodPixelFor=()=>({z:1,x:1,y:1,px:0,py:0});
  app.run(`real=true;realMode=true;realMap={};mapCapability=true;mapFloodCapability=true;draftShelter='原中学校';draftAddress='公開住所';globalThis.invalidations=0;mapConsultation={invalidate(){invalidations++}};renderAreaLocation('ready')`);
  assert.equal(app.element('consult-map').disabled,false);
  const pending=app.run(`showShelterFlood({name:'原中学校',address:'公開住所'})`);
  assert.equal(app.element('consult-map').disabled,true);
  assert.match(app.element('consult-flood-input').textContent,/確認中/);
  assert.equal(app.context.invalidations,1);
  finish({ok:false});await pending;
  assert.equal(app.element('consult-map').disabled,false);
  assert.match(app.element('consult-flood-input').textContent,/未確認/);
  assert.equal(app.context.invalidations,1);
});


test('map overlay controls follow the same route restrictions and cancel state as the panel',async()=>{
  const app=await harness();
  app.context.paths=[];app.context.stops=0;
  app.run(`real=true;realMode=true;realMap={getSharedHazards(){return []},continueSimulation(side){paths.push(side)},stopSimulation(){stops++}};mapPlanAvailable=true;mapPlanPhase='obstacle';mapProbeReports={A:{blockedIndices:[0],observed:3,total:3,unknown:0,maxGap:20},B:{blockedIndices:[],observed:3,total:3,unknown:0,maxGap:20}};syncMapPlan()`);
  assert.equal(app.element('map-dock-actions').hidden,false);
  assert.equal(app.element('map-dock-a').disabled,true);
  assert.equal(app.element('map-dock-b').disabled,false);
  app.element('map-dock-a').handlers.click();app.element('map-dock-b').handlers.click();
  assert.deepEqual(app.context.paths,['B']);
  app.run(`mapProbeBusy=true;syncMapPlan()`);
  assert.equal(app.element('map-dock-b').disabled,true);
  app.element('map-dock-b').handlers.click();assert.deepEqual(app.context.paths,['B']);
  app.element('map-dock-stop').handlers.click();assert.equal(app.context.stops,1);
  app.run(`mapPlanPhase='complete';mapProbeBusy=false;syncMapPlan()`);
  assert.equal(app.element('map-dock-actions').hidden,true);
});

test('detour consultation asks for another click after switching to the overview',async()=>{
  const app=await harness();app.context.events=[];
  app.context.fetch=async(url)=>{assert.equal(url,'/api/map-plan');app.context.events.push('request');return {ok:true,json:async()=>({result:{sora:'A',nagi:'B'}})}};
  app.run(`real=true;realMode=true;mapPlanAvailable=true;mapPlanPhase='obstacle';realMap={view:'wire',cameraMode(){return this.view},chooseCamera(view){events.push(view);this.view=view},capture(options){events.push('capture:'+this.view+':'+options.includeVirtualMarker);return {image:'data:image/png;base64,AA==',canvas:{width:10,height:10},view:1}},isViewCurrent(){return true}}`);
  await app.element('map-sim-consult').handlers.click();
  assert.deepEqual(app.context.events,['wide']);
  assert.match(app.element('map-radio-live').textContent,/もう一度/);
  await app.element('map-sim-consult').handlers.click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(app.context.events,['wide','capture:wide:true','request']);
  assert.match(app.element('map-sim-consult-status').textContent,/仮想案B/);
});

test('failed or wholly unknown detour inspection cannot be replayed and explains why',async()=>{
  const app=await harness();app.context.paths=[];
  app.run(`real=true;realMode=true;realMap={continueSimulation(side){paths.push(side)}};mapPlanAvailable=true;mapPlanPhase='obstacle';mapProbeReports=null;syncMapPlan()`);
  assert.equal(app.element('map-dock-a').disabled,true);
  assert.equal(app.element('map-sim-detour').disabled,true);
  assert.match(app.element('map-probe-choice').textContent,/点検/);
  app.element('map-dock-a').handlers.click();assert.deepEqual(app.context.paths,[]);
  app.run(`mapProbeReports={A:{blockedIndices:[],observed:0,unknown:3},B:{blockedIndices:[],observed:1,unknown:2}};syncMapPlan()`);
  assert.equal(app.element('map-dock-a').disabled,true);assert.equal(app.element('map-dock-b').disabled,true);
  assert.match(app.element('map-probe-choice').textContent,/不明/);
});


test('changing the building model reloads the active area only once per change',async()=>{
  const app=await harness();app.context.selected=[];
  app.run(`realMap={setBuildingMode(mode){selected.push(mode)}}`);
  app.element('buildings-simple').handlers.click();
  app.element('buildings-simple').handlers.click();
  app.element('buildings-highest').handlers.click();
  app.element('buildings-highest').handlers.click();
  app.element('buildings-detailed').handlers.click();
  assert.deepEqual(app.context.selected,['simple','highest','detailed']);
});

test('the textured city example selects Taito and high detail in one map reload',async()=>{
  const app=await harness();app.context.selected=[];
  app.run(`realMap={setArea(area,mode){selected.push([area,mode])}};areaCatalog=null;`);
  app.element('risk-toggle').checked=true;
  app.element('example-detailed-city').handlers.click();
  assert.equal(app.element('area-select').value,'13106');
  assert.equal(app.element('buildings-highest').attributes['aria-pressed'],'true');
  assert.equal(app.element('risk-toggle').checked,true);
  assert.equal(app.context.selected.length,1);assert.equal(app.context.selected[0][0],'13106');assert.equal(app.context.selected[0][1],'highest');
});
test('the textured city example does not select an area missing from the loaded catalog',async()=>{
  const app=await harness();app.context.selected=[];
  app.run(`realMap={setArea(area,mode){selected.push([area,mode])}};areaCatalog=[{code:'13118',area:'東京都荒川区'}]`);
  app.element('example-detailed-city').handlers.click();
  assert.equal(app.context.selected.length,0);assert.match(app.element('area-list-status').textContent,/確認できません/);
});
