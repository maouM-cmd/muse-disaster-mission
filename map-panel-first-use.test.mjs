import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

async function harness(){
  const source=(await readFile(new URL('./app.js',import.meta.url),'utf8')).replace(/^import .*?;\s*/gm, '');
  const elements=new Map();
  function el(id){
    if(!elements.has(id)){
      const isCanvas = id==='scene' || id==='detection-overlay' || id.endsWith('-canvas');
      elements.set(id,{
        id, textContent:'', value:'', disabled:false, hidden:false, style:{}, dataset:{}, classList:{values:new Set(),add(v){this.values.add(v)},remove(v){this.values.delete(v)},toggle(v){if(this.values.has(v)){this.values.delete(v);return false}this.values.add(v);return true},contains(v){return this.values.has(v)}}, handlers:{},attributes:{},
        addEventListener(type,cb){this.handlers[type]=cb}, setAttribute(n,v){this.attributes[n]=v}, removeAttribute(n){delete this.attributes[n]}, getAttribute(n){return this.attributes[n]},
        querySelector(){return null}, querySelectorAll(){return []}, replaceChildren(){}, append(){}, focus(){}, click(){ this.handlers.click?.({preventDefault(){}}); },
        getContext: isCanvas ? (()=>({setTransform(){},drawImage(){},clearRect(){},fillRect(){},measureText(){return {width:0}}, fillText(){}})) : undefined,
        toDataURL: isCanvas ? (()=> 'data:image/png;base64,AA==') : undefined,
        width: isCanvas ? 800 : undefined, height: isCanvas ? 600 : undefined
      });
    }
    return elements.get(id);
  }
  const ctx={
    document:{getElementById:el,createElement:()=>el('tmp'),querySelector:()=>null,querySelectorAll:()=>[]},
    window:{}, navigator:{mediaDevices:{getUserMedia: async()=>({getTracks:()=>[]})}},
    ResizeObserver:class{observe(){}}, MediaRecorder:class{constructor(){this.state='inactive'} start(){this.state='recording'} stop(){this.state='inactive';queueMicrotask(()=>this.onstop?.())}},
    requestAnimationFrame(cb){return 0}, cancelAnimationFrame(id){},
    devicePixelRatio: 1,
    setTimeout(ms){return 0}, clearTimeout(id){}, setInterval(cb,ms){return 0}, clearInterval(id){}, queueMicrotask, performance, Blob, btoa,
    AbortSignal:{timeout(ms){return {aborted:false, addEventListener(){}, removeEventListener(){}, throwIfAborted(){}}}, any(signals){return {aborted:false, addEventListener(){}, removeEventListener(){}, throwIfAborted(){}}}},
    AbortController,
    URL, fetch: async()=>({ok:true,json:async()=>({enabled:true}), text:async()=>''}),
    // stubs for imported modules
    positionAt:()=>({}), progressBeforeReplan:()=>0, makeCity:()=>({}), fitImage:(c)=>c, isValidRoute:()=>true,
    readPlanStream:async function*(){}, configureSpeech:()=>{}, trackSpeech:()=>{}, initialCamera:()=>({view:'wide'}), beginFlight:()=>({view:'follow'}), selectCamera:()=>({}), deliveryCamera:()=>({}),
    canReplayMapRoute:()=>true, secondFleetCandidates:()=>[], jmaWarningLink:()=> '#', filterShelters:(list)=>list, nearbyShelters:()=>[],
    requestDraft:()=>({supply:null,quantity:null}), simulationManifest:()=>({}), suggestRequest:()=>({}), suggestShelters:()=>[], mapFloodContext:()=>'', mapConsultHistoryContext:()=>'', mapMissionSteps:()=>['pending','pending','pending','pending'], mapMissionDistance:()=>'', mapMissionEvidence:()=>'', mapRouteSummary:()=>'', fleetStatus:()=>'', fleetPosition:()=>null, createMapScan:()=>({invalidate(){} , run(){}}), createMapConsultation:()=>({invalidate(){} , run(){}}), createFacilityFloodTracker:()=>({select(){}, getStatus(){return ''}}), createWorld:()=>({update(){}}),
    AudioContext:class{async decodeAudioData(){return {sampleRate:24000,getChannelData:()=>new Float32Array([0])}} async close(){}},
  };
  vm.runInNewContext(source, ctx);
  vm.runInNewContext("mapSourceEvidence={buildings:'available'}",ctx);
  await new Promise(r=> setImmediate(r));
  return {el, ctx, run:(code)=> vm.runInNewContext(code, ctx)};
}

test('a previous fleet clearing during a new launch cannot admit a second start',async()=>{
  const h=await harness();let finish,starts=0;
  const pending=new Promise(resolve=>{finish=resolve});
  h.ctx.document.querySelector=selector=>selector==='.shell'?{classList:{contains:()=>true}}:null;
  h.ctx.startStub=()=>{starts++;h.run('renderLargeFleet(null)');return pending};
  h.el('fleet-size').value='100';
  h.run("mapAreaState='ready'; realMap={startLargeFleet:startStub}");
  const first=h.el('map-sim-start').handlers.click();
  const second=h.el('map-sim-start').handlers.click();
  assert.equal(starts,1);
  assert.equal(h.run('largeFleetBusy'),true);
  finish(true);await Promise.all([first,second]);
});

test('100-aircraft start forwards the confirmed facility, supply and quantity',async()=>{
  const h=await harness();let captured;
  h.ctx.document.querySelector=selector=>selector==='.shell'?{classList:{contains:()=>true}}:null;
  h.ctx.requestDraft=()=>({complete:true,supply:'飲料水',quantity:12});
  h.ctx.startStub=(count,request)=>{captured={count,request};return Promise.resolve(true)};
  h.el('fleet-size').value='100';h.el('draft-supply').value='water';h.el('draft-quantity').value='12';
  h.run("mapAreaState='ready'; draftShelter='施設A'; shelterChoice=0; shelterList=[{name:'施設A',address:'住所A',latitude:35.7,longitude:139.7}]; realMap={startLargeFleet:startStub}");
  await h.el('map-sim-start').handlers.click();
  assert.equal(captured.count,100);
  assert.equal(captured.request.supply,'飲料水');
  assert.equal(captured.request.quantity,12);
  assert.equal(captured.request.destination.name,'施設A');
  assert.equal(captured.request.destination.latitude,35.7);
});

test('an incomplete cargo request is not silently ignored by 100-aircraft start',async()=>{
  const h=await harness();let starts=0;
  h.ctx.requestDraft=()=>({complete:false,supply:'',quantity:12});
  h.ctx.startStub=()=>{starts++;return Promise.resolve(true)};
  h.el('fleet-size').value='100';h.el('draft-quantity').value='12';
  h.run("mapAreaState='ready'; realMap={startLargeFleet:startStub}");
  await h.el('map-sim-start').handlers.click();
  assert.equal(starts,0);
  assert.match(h.el('map-sim-status').textContent,/物資|数量/);
  assert.equal(h.el('stage-error').hidden,false);
  assert.match(h.el('stage-error').textContent,/物資|数量/);
});

test('a transcribed but unconfirmed request cannot start a generic fleet silently',async()=>{
  const h=await harness();let starts=0;
  h.ctx.requestDraft=()=>({complete:false,supply:'',quantity:null});
  h.ctx.startStub=()=>{starts++;return Promise.resolve(true)};
  h.el('fleet-size').value='100';h.el('draft-transcript').value='原中学校に水を十二箱届けて';
  h.run("mapAreaState='ready'; realMap={startLargeFleet:startStub}");
  await h.el('map-sim-start').handlers.click();
  assert.equal(starts,0);
  assert.match(h.el('map-sim-status').textContent,/物資|数量/);
});

test('a changed transcript cannot silently reuse an older confirmed cargo quantity',async()=>{
  const h=await harness();let starts=0;
  h.ctx.document.querySelector=selector=>selector==='.shell'?{classList:{contains:()=>true}}:null;
  h.ctx.requestDraft=()=>({complete:true,supply:'飲料水',quantity:Number(h.el('draft-quantity').value)});
  h.ctx.suggestRequest=()=>({supply:'water',quantity:30});
  h.ctx.startStub=()=>{starts++;return Promise.resolve(true)};
  h.el('fleet-size').value='100';h.el('draft-transcript').value='施設Aに水を30箱届けて';
  h.el('draft-supply').value='water';h.el('draft-quantity').value='12';
  h.run("mapAreaState='ready'; draftShelter='施設A'; shelterChoice=0; shelterList=[{name:'施設A',address:'住所A',latitude:35.7,longitude:139.7}]; realMap={startLargeFleet:startStub}");
  await h.el('map-sim-start').handlers.click();
  assert.equal(starts,0);
  assert.match(h.el('stage-error').textContent,/依頼文|候補/);
  h.el('draft-quantity').value='30';
  await h.el('map-sim-start').handlers.click();
  assert.equal(starts,1);
  assert.equal(h.el('stage-error').hidden,true);
});

test('a changed transcript cannot silently reuse an older confirmed destination',async()=>{
  const h=await harness();let starts=0;
  h.ctx.requestDraft=()=>({complete:true,supply:'飲料水',quantity:12});
  h.ctx.suggestRequest=()=>({supply:'water',quantity:12});
  h.ctx.suggestShelters=()=>[1];
  h.ctx.startStub=()=>{starts++;return Promise.resolve(true)};
  h.el('fleet-size').value='100';h.el('draft-transcript').value='施設Bに水を12箱届けて';
  h.el('draft-supply').value='water';h.el('draft-quantity').value='12';
  h.run("mapAreaState='ready'; draftShelter='施設A'; shelterChoice=0; shelterList=[{name:'施設A',address:'住所A',latitude:35.7,longitude:139.7},{name:'施設B',address:'住所B',latitude:35.8,longitude:139.8}]; realMap={startLargeFleet:startStub}");
  await h.el('map-sim-start').handlers.click();
  assert.equal(starts,0);
  assert.match(h.el('stage-error').textContent,/依頼文|施設候補/);
});

test('cargo preview reflects the selected fleet mode',async()=>{
  const h=await harness();
  h.ctx.requestDraft=()=>({complete:true,status:'下書き',area:'荒川区',destination:'施設A',supply:'飲料水',quantity:12});
  h.el('fleet-size').value='100';
  h.run('renderDraft()');
  assert.match(h.el('map-cargo-preview').textContent,/12箱/);
  assert.match(h.el('map-cargo-preview').textContent,/予備/);
  const startNotice=h.el('fleet-size-note').textContent;
  assert.match(startNotice,/施設A.*飲料水.*12箱/);
  assert.match(startNotice,/1機1箱/);
  assert.match(startNotice,/別施設.*承認.*再点検/);
  assert.match(startNotice,/地図画像.*地名.*点検結果.*Meta.*Muse/);
  assert.match(startNotice,/未接続.*点検不明.*停止/);
  h.el('fleet-size').value='2';
  h.run('renderDraft()');
  assert.match(h.el('map-cargo-preview').textContent,/1箱/);
});

test('incomplete 100-aircraft cargo explains that confirmation is required',async()=>{
  const h=await harness();
  h.ctx.requestDraft=()=>({complete:false,quantity:null});
  h.el('fleet-size').value='100';h.el('draft-supply').value='water';
  h.run('renderDraft()');
  assert.match(h.el('map-cargo-preview').textContent,/確認.*開始/);
  assert.doesNotMatch(h.el('map-cargo-preview').textContent,/内容未指定の仮想便です/);
});

test('typing a new 100-aircraft request updates the preview immediately',async()=>{
  const h=await harness();
  h.ctx.requestDraft=()=>({complete:false,quantity:null});
  h.ctx.suggestRequest=()=>null;
  h.el('fleet-size').value='100';h.el('draft-transcript').value='原中学校に水を届けて';
  h.el('draft-transcript').handlers.input();
  assert.match(h.el('map-cargo-preview').textContent,/確認.*開始/);
});

test('setup closes once during flight and returns after stopping', async()=>{
  const h=await harness();
  h.el('setup-details').open=true;
  h.run("mapPlanPhase='ready'; syncPanelCompact()");
  assert.equal(h.el('setup-details').open,true);
  h.run("mapPlanPhase='direct'; syncPanelCompact()");
  assert.equal(h.el('setup-details').open,false);
  assert.equal(h.el('flight-actions').hidden,false);
  h.el('setup-details').open=true;
  h.run("syncPanelCompact()");
  assert.equal(h.el('setup-details').open,true);
  h.run("mapPlanPhase='ready'; syncPanelCompact()");
  assert.equal(h.el('setup-details').open,true);
  assert.equal(h.el('flight-actions').hidden,true);
});

test('map-panel first-use progress is at top and always matches selection state', async()=>{
  const h=await harness();
  const html=await readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.html'),'utf8');
  // Check that flow-strip is inside first-use-flow at top of map-panel (after title)
  const panelStart = html.indexOf('id="map-panel"');
  const firstUseIndex = html.indexOf('first-use-flow');
  const flowStripIndex = html.indexOf('flow-strip');
  const areaHeadingIndex = html.indexOf('id="area-heading"');
  assert.ok(firstUseIndex !== -1 && firstUseIndex < areaHeadingIndex, 'first-use-flow should be before region heading');
  assert.ok(flowStripIndex !== -1 && flowStripIndex > firstUseIndex && flowStripIndex < areaHeadingIndex, 'flow-strip should be inside first-use-flow at top');
  // Check that all 4 steps exist
  assert.ok(html.includes('id="flow-region"'));
  assert.ok(html.includes('id="flow-shelter"'));
  assert.ok(html.includes('id="flow-origin"'));
  assert.ok(html.includes('id="flow-sim"'));
  // Check state consistency via harness
  // Initially no shelter, no origin
  h.run("draftShelter=''; mapOriginChosen=false; mapPlanPhase='needs-points'; syncFlow();");
  assert.equal(h.el('flow-shelter').className, '');
  assert.equal(h.el('flow-origin').className, '');
  assert.equal(h.el('flow-sim').className, '');
  assert.match(h.el('flow-hint').textContent, /まず.*配送先/);
  // After selecting shelter and origin
  h.run("draftShelter='原中学校'; mapOriginChosen=true; mapPlanPhase='ready'; syncFlow();");
  assert.equal(h.el('flow-shelter').className, 'done');
  assert.equal(h.el('flow-origin').className, 'done');
  assert.match(h.el('flow-hint').textContent, /仮想移動.*開始/);
  // During delivery
  h.run("mapPlanPhase='delivery'; syncFlow();");
  assert.equal(h.el('flow-sim').className, 'current');
  assert.match(h.el('flow-hint').textContent, /仮想移動を再生中/);
  // Only completion marks the step done
  h.run("mapPlanPhase='complete'; syncFlow();");
  assert.equal(h.el('flow-sim').className, 'done');
  assert.match(h.el('flow-hint').textContent, /荷下ろしが終了/);
});

test('short notes remain visible while details are collapsed', async()=>{
  const html=await readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.html'),'utf8');
  // Short note should be outside details, visible
  assert.ok(html.includes('背景と建物と雨雲は実際の災害状況ではありません'));
  // Detailed controls should be inside <details>
  const detailsStart = html.indexOf('<details class="map-details"><summary>地図の見た目を変える');
  assert.ok(detailsStart !== -1, 'background/building/rain should be inside details');
  // Check that details is not open by default (collapsed)
  const detailsTag = html.slice(detailsStart, detailsStart+200);
  assert.ok(!detailsTag.includes('open'), 'map appearance details should be collapsed by default');
  // Voice request should be open by default and not too hidden
  assert.ok(html.includes('<details class="map-details extra-details" open>'), 'voice request details should be open by default');
  assert.ok(html.includes('音声や文字で物資を伝える'), 'voice summary should be visible and link from sim-flow');
});

test('all existing IDs and 2ship/AI/map on same screen are kept', async()=>{
  const html=await readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.html'),'utf8');
  const requiredIds=['map-panel','flow-region','flow-shelter','flow-origin','flow-sim','flow-hint','area-heading','destination-heading','origin-heading','sim-heading','shelter-select','fleet-select','map-sim-start','map-mission-dock','map-radio-dock','real-map','world','draft-transcript','draft-voice','consult-map','scan-map'];
  for(const id of requiredIds) assert.ok(html.includes(`id="${id}"`), `should keep ID ${id}`);
  // Check that 2ship and AI and map remain on same screen (shell grid with world and map-panel)
  assert.ok(html.includes('id="world"') && html.includes('id="map-panel"') && html.includes('id="real-map"'));
  // Check that fleet and radio history remain
  assert.ok(html.includes('id="fleet-select"') && html.includes('id="map-radio"') && html.includes('id="radio"'));
});

test('keyboard and aria for progress and details', async()=>{
  const h=await harness();
  const html=await readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.html'),'utf8');
  // Check aria for flow
  assert.ok(html.includes('aria-label="はじめての手順と現在の進捗"'));
  assert.ok(html.includes('role="status"') && html.includes('aria-live="polite"'));
  // Check details have summary and are keyboard accessible (summary is natively keyboard accessible)
  assert.ok(html.includes('<summary>地図の見た目を変える'));
  assert.ok(html.includes('<summary>音声や文字で物資を伝える'));
  // Check that map-panel top progress is focusable and not hidden
  h.run("draftShelter=''; mapOriginChosen=false; mapPlanPhase='needs-points'; syncFlow();");
  assert.equal(h.el('flow-hint').textContent.length > 0, true);
});

test('voice request is guided from delivery procedure and not too hidden', async()=>{
  const html=await readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.html'),'utf8');
  // Check that sim-flow contains a guide linking to draft-transcript
  assert.ok(html.includes('href="#draft-transcript"'));
  assert.ok(html.includes('物資を伝えるには') && html.includes('音声や文字で物資を伝える'));
  // Check that draft-transcript is not inside a closed details that would hide it too much - it is inside an open details now
  const voiceDetails = html.indexOf('id="draft-transcript"');
  const voiceSummary = html.indexOf('音声や文字で物資を伝える');
  assert.ok(voiceDetails > voiceSummary, 'draft-transcript should be after its summary, inside open details');
});

test('guide live region mirrors consult, flight and stop states', async()=>{
  const h=await harness();
  // Consult in flight shows the exact waiting words
  h.run("mapPlanController={}; mapPlanPhase='obstacle'; syncFlow();");
  assert.equal(h.el('map-guide-live').hidden, false);
  assert.match(h.el('map-guide-live').textContent, /AIに相談中。お待ちください/);
  // Delivery shows both aircraft with their destinations and states
  h.run("mapPlanController=null; mapPlanPhase='delivery'; draftShelter='原中学校'; syncFlow();");
  assert.match(h.el('map-guide-live').textContent, /1号機/);
  assert.match(h.el('map-guide-live').textContent, /原中学校/);
  assert.match(h.el('map-guide-live').textContent, /2号機/);
  // Stop shows the cause and the next possible action first
  h.el('map-sim-status').textContent='点検地点の3点で仮想高度付近以上の表面を検出。出発を中止しました。出発地点を変更してください。';
  h.el('map-sim-start').disabled=true;h.el('map-sim-probe').disabled=true;
  h.el('map-sim-detour').disabled=true;h.el('map-sim-detour').hidden=true;
  h.el('map-sim-consult').disabled=true;h.el('map-sim-consult').hidden=true;
  h.run("mapPlanPhase='preflight-blocked'; syncFlow();");
  assert.match(h.el('map-guide-live').textContent, /停止中/);
  assert.match(h.el('map-guide-live').textContent, /出発地点を変更/);
  assert.match(h.el('map-guide-live').textContent, /次にできる操作/);
  // Ready state hides the live region (next action stays in flow-hint)
  h.run("draftShelter='原中学校'; mapOriginChosen=true; mapPlanPhase='ready'; syncFlow();");
  assert.equal(h.el('map-guide-live').hidden, true);
  assert.match(h.el('flow-hint').textContent, /仮想移動.*開始/);
});
test('simulation panel offers a clear real-map entry without changing the default mode', async()=>{
  const html=await readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.html'),'utf8');
  const simStart=html.indexOf('id="simulation-panel"');
  const mapStart=html.indexOf('id="map-panel"');
  const entry=html.indexOf('id="enter-realmap"');
  assert.ok(entry!==-1&&entry>simStart&&entry<mapStart, 'entry button lives in the simulation panel');
  assert.ok(html.includes('実地図を見る')||html.includes('実地図の調査画面'), 'entry names the real map');
  // Default mode stays simulation: simulation panel visible, map panel hidden
  const simTag=html.slice(simStart,simStart+120);
  assert.ok(!simTag.includes('hidden'), 'simulation panel is the default view');
  assert.ok(html.includes('<aside id="map-panel" class="panel map-panel" hidden'), 'map panel stays hidden initially');
  // Entry opens the real map panel
  const h=await harness();
  h.el('enter-realmap').click();
  assert.equal(h.el('map-panel').hidden,false);
});
test('guide region and entry keep required IDs and narrow layout', async()=>{
  const html=await readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.html'),'utf8');
  for(const id of ['map-guide-live','enter-realmap'])assert.ok(html.includes(`id="${id}"`), `should keep ID ${id}`);
  assert.ok(html.includes('role="status"')&&html.includes('aria-live="polite"'), 'guide is announced politely');
  const css=await readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), 'style.css'),'utf8');
  assert.ok(css.includes('.flow-strip')&&css.includes('flex-wrap'), 'steps wrap on narrow widths');
});

test('initial view puts the real controls first in one flow', async()=>{
  const html=await readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.html'),'utf8');
  const at=(s)=>html.indexOf(s);
  const flow=at('quick-flow'),guide=at('id="map-guide-live"');
  const area=at('id="quick-13118"'),dest=at('id="shelter-select"'),origin=at('id="choose-origin"'),start=at('id="map-sim-start"');
  assert.ok(flow!==-1&&flow<area&&area<dest&&dest<origin&&origin<start, 'region, destination, origin, start in one run');
  assert.ok(start<at('id="sim-heading"')&&dest<at('id="destination-heading"')&&origin<at('id="origin-heading"'), 'controls precede the leftover detail sections');
  for(const id of ['quick-13118','shelter-select','focus-shelter','shelter-list-status','draft-destination','choose-origin','map-origin','map-distance','fleet-select','fleet-preview','map-sim-start'])
    assert.equal(html.split(`id="${id}"`).length-1,1,`${id} is not duplicated`);
  const css=await readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), 'style.css'),'utf8');
  assert.ok(css.includes('.quick-flow'), 'quick flow is styled');
});
test('moved start button still follows flight state', async()=>{
  const h=await harness();
  h.run("mapPlanPhase='ready'; mapFleetActive=false; mapSourceEvidence={buildings:'available'}; syncMapPlan();");
  assert.equal(h.el('map-sim-start').disabled,false);
  h.run("mapPlanPhase='delivery'; syncMapPlan();");
  assert.equal(h.el('map-sim-start').disabled,true);
});

test('the flight cannot start while the building model is loading or unavailable',async()=>{
  const h=await harness();
  h.run("mapAreaState='ready';mapPlanPhase='ready';mapFleetActive=false;mapSourceEvidence={buildings:'loading'};syncMapPlan()");
  assert.equal(h.el('map-sim-start').disabled,true);assert.match(h.el('map-building-start-status').textContent,/読み込み/);
  h.run("mapSourceEvidence={buildings:'error'};syncMapPlan()");
  assert.equal(h.el('map-sim-start').disabled,true);assert.match(h.el('map-building-start-status').textContent,/取得/);
  h.run("mapSourceEvidence={buildings:'available'};syncMapPlan()");
  assert.equal(h.el('map-sim-start').disabled,false);assert.equal(h.el('map-building-start-status').hidden,true);
});

test('delivery keeps status and stop visible in a sticky top region', async()=>{
  const html=await readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.html'),'utf8');
  const panel=html.indexOf('id="map-panel"');
  const sticky=html.indexOf('id="map-sticky-state"');
  assert.ok(sticky>panel, 'sticky region exists in the map panel');
  assert.ok(sticky<html.indexOf('id="sim-heading"'), 'sticky region stays above the long sections');
  const guide=html.indexOf('id="map-guide-live"'),stop=html.indexOf('id="map-sim-stop"');
  assert.ok(guide>sticky&&stop>sticky, 'status and the real stop button live in the sticky region');
  assert.ok(html.split('id="map-sim-stop"').length-1===1, 'stop button is moved, not duplicated');
  const css=await readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), 'style.css'),'utf8');
  assert.ok(css.includes('.sticky-state')&&css.includes('position:sticky'), 'sticky region pins to the panel top');
  const h=await harness();
  h.el('map-sim-stop').hidden=false;
  h.run("mapPlanPhase='delivery'; mapFleetActive=false; draftShelter='原中学校'; syncMapPlan(); syncFlow();");
  assert.equal(h.el('map-sticky-state').hidden,false);
  assert.match(h.el('map-guide-live').textContent,/1号機/);
  assert.equal(h.el('map-sim-stop').hidden,false);
  h.el('map-sim-stop').hidden=true;
  h.run("mapPlanPhase='ready'; syncMapPlan(); syncFlow();");
  assert.equal(h.el('map-sticky-state').hidden,true);
});
test('sticky sync never hijacks scroll position', async()=>{
  const source=(await readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), 'app.js'),'utf8')).replace(/\r\n/g,'\n');
  const at=source.indexOf('function syncGuide(){');
  assert.ok(at!==-1);
  const end=source.indexOf('\n}\n',at);
  const body=source.slice(at,end);
  assert.ok(!body.includes('scroll'), 'guide sync updates text only');
});

test('flow hint matches the actual status for every stop kind', async()=>{
  const h=await harness();
  h.run("draftShelter='原中学校'; mapOriginChosen=true;");
  const cases=[
    ['preflight-blocked','点検地点の3点で仮想高度付近以上の表面を検出。出発を中止しました。出発地点を変更してください。'],
    ['preflight-unavailable','3Dモデルを点検できません：高さを取得できません。出発を中止しました。再試行できます。'],
    ['direct-unavailable','帰還済みの仮想機に接近するため1号機を中止しました。仮想移動を中止しました。'],
    ['detour-unavailable','建物データを取得できません。迂回を中止しました。'],
    ['surface-unavailable','地図モデルの表面が不明です。荷下ろしを中止しました。'],
    ['error','経路を計算できませんでした。'],
  ];
  for(const [phase,status] of cases){
    h.el('map-sim-status').textContent=status;
    h.run(`mapPlanPhase='${phase}'; syncFlow();`);
    assert.equal(h.el('flow-hint').textContent,status);
  }
  assert.doesNotMatch(h.el('flow-hint').textContent,/準備完了/);
});

test('refused area change restores the visible selection', async()=>{
  const h=await harness();
  h.run("realMap={mapFlightActive:()=>true};");
  h.el('area-select').options=[{value:'13118',textContent:'荒川区'},{value:'13101',textContent:'千代田区'}];
  h.el('area-select').selectedIndex=1;h.el('area-select').value='13101';
  h.el('quick-13101').setAttribute('aria-pressed','true');h.el('quick-13118').setAttribute('aria-pressed','false');
  h.el('area-select').handlers.change();
  assert.equal(h.el('area-select').value,'13118');
  assert.equal(h.el('quick-13118').attributes['aria-pressed'],'true');
  assert.equal(h.el('quick-13101').attributes['aria-pressed'],'false');
  assert.match(h.el('area-list-status').textContent,/飛行中/);
});
test('in-flight destination and origin controls stay locked', async()=>{
  const h=await harness();
  h.ctx.filterShelters=()=>[{index:0,name:'A',address:'B'}];
  h.run("realMap={mapFlightActive:()=>true}; renderShelterList(); renderAreaLocation('ready');");
  assert.equal(h.el('shelter-select').disabled,true);
  assert.equal(h.el('choose-origin').disabled,true);
  h.run("realMap={mapFlightActive:()=>false}; renderShelterList(); renderAreaLocation('ready');");
  assert.equal(h.el('shelter-select').disabled,false);
  assert.equal(h.el('choose-origin').disabled,false);
});
test('obstacle guidance follows inspection state and latest second-unit result', async()=>{
  const h=await harness();
  h.run("mapPlanController=null; mapPlanPhase='obstacle'; draftShelter='原中学校';");
  h.el('map-sim-status').textContent='仮想障害の手前で停止。相談または迂回を確認できます。';
  h.run("mapProbeBusy=true; syncFlow();");
  assert.match(h.el('map-guide-live').textContent,/点検中/);
  h.run("mapProbeBusy=false; mapProbeReports={A:{total:3,observed:3,unknown:0,blockedIndices:[1],maxGap:5},B:{total:3,observed:2,unknown:1,blockedIndices:[0],maxGap:6}};");
  h.ctx.canReplayMapRoute=()=>false;
  h.run("syncFlow();");
  assert.match(h.el('map-guide-live').textContent,/自動判断できる案がありません/);
  h.ctx.canReplayMapRoute=()=>true;
  h.el('map-fleet-state').textContent='2号機 → 原中学校：荷下ろし後に仮想帰還';
  h.el('fleet-preview').textContent='2号機の候補：原中学校。未確定のため実際と異なる場合があります。';
  h.run("mapFleetActive=false; syncFlow();");
  assert.match(h.el('map-guide-live').textContent,/荷下ろし後に仮想帰還/);
  assert.doesNotMatch(h.el('map-guide-live').textContent,/未確定/);
});
test('map speech cancels the previous utterance and clears stale subtitles', async()=>{
  const h=await harness();
  h.ctx.configureSpeech=(u)=>u;
  h.ctx.speechSynthesis={calls:[],cancel(){this.calls.push('cancel')},speak(u){this.calls.push('speak:'+u.text);if(u.onstart)u.onstart()},getVoices:()=>[],speaking:false,pending:false};
  h.ctx.SpeechSynthesisUtterance=class{constructor(t){this.text=t}};
  h.ctx.window.speechSynthesis=h.ctx.speechSynthesis;
  h.run("mapSound=true; showMapSpeech('ソラ','あ'); showMapSpeech('ナギ','い');");
  assert.deepEqual(h.ctx.speechSynthesis.calls,['cancel','speak:あ','cancel','speak:い']);
  assert.equal(h.el('map-subtitle').textContent,'ナギ：い');
});
test('narrow widths keep flight status and stop on the map', async()=>{
  const html=await readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.html'),'utf8');
  const dock=html.indexOf('id="map-mission-dock"');
  assert.ok(dock!==-1);
  for(const id of ['map-mission-state','map-dock-stop','map-fleet-card'])assert.ok(html.indexOf(`id="${id}"`)>dock,`${id} rides on the map`);
  const css=await readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), 'style.css'),'utf8');
  assert.ok(css.includes('@media(max-width:600px)')&&css.includes('.map-mission-dock{right:14px'), 'dock stays on screen when narrow');
});
test('origin selection explains keyboard use and marks the map center', async()=>{
  const html=await readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.html'),'utf8');
  assert.ok(html.includes('id="map-center-cross"'), 'center mark exists');
  const source=await readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), 'app.js'),'utf8');
  assert.ok(source.includes('矢印キー'), 'selecting guidance names keyboard use');
});

test('refused facility selection guides to end the flight first', async()=>{
  const h=await harness();
  h.run("realMap={mapFlightActive:()=>true, selectShelter:()=>false};");
  h.el('shelter-select').options=[{value:'0',textContent:'原中学校'}];
  h.el('shelter-select').selectedIndex=0;h.el('shelter-select').value='0';
  h.el('shelter-select').handlers.change();
  assert.match(h.el('shelter-list-status').textContent,/移動を終了/);
  assert.equal(h.el('shelter-select').value,'');
});

test('current flow step is highlighted, not dimmed', async()=>{
  const css=await readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), 'style.css'),'utf8');
  assert.ok(css.includes('.flow-strip span.current'), 'current step has its own style');
});

test('narrow widths pin the real map while the guide scrolls', async()=>{
  const css=(await readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), 'style.css'),'utf8')).replace(/\s+/g,'');
  assert.ok(css.includes('@media(max-width:850px)'), 'narrow rules exist');
  const narrow=css.slice(css.indexOf('@media(max-width:850px)'));
  assert.ok(narrow.includes('.world.real-mode{position:sticky'), 'real map pins on narrow screens');
  assert.ok(narrow.includes('44dvh'), 'pinned map keeps a usable height');
  assert.ok(narrow.includes('.sticky-state{top:'), 'status bar docks below the pinned map');
  assert.ok(css.includes('@media(min-width:851px){.shell{height:100dvh'), 'desktop shell behavior is unchanged');
  assert.ok(css.includes('.panel{height:100dvh;min-height:0;overflow-y:auto}'), 'desktop panel behavior is unchanged');
});

test('narrow banner is one row and folds static notes behind a toggle', async()=>{
  const h=await harness();
  const banner=h.el('map-banner'), button=h.el('map-banner-more');
  button.click();
  assert.ok(banner.classList.contains('banner-open'), 'first tap expands the banner');
  assert.equal(button.getAttribute('aria-expanded'),'true');
  assert.equal(button.textContent,'注意を閉じる');
  button.click();
  assert.ok(!banner.classList.contains('banner-open'), 'second tap folds it back');
  assert.equal(button.getAttribute('aria-expanded'),'false');
  assert.equal(button.textContent,'表示の注意');
  const html=await readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.html'),'utf8');
  const bannerAt=html.indexOf('id="map-banner"');
  assert.ok(bannerAt!==-1&&html.indexOf('id="map-banner-more"')>bannerAt, 'toggle rides inside the banner');
  assert.ok(html.includes('aria-expanded="false"'), 'banner toggle starts folded');
  const css=(await readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), 'style.css'),'utf8')).replace(/\s+/g,'');
  assert.ok(css.includes('#map-banner-more{display:none}'), 'banner toggle stays hidden on wide screens');
  assert.ok(css.includes('grid-template-columns:minmax(0,1fr)auto'), 'narrow banner lays out as one row');
  assert.ok(css.includes('#map-banner#imagery-banner,#map-banner#risk-banner{display:none}'), 'static photo and flood notes fold on narrow screens');
  assert.ok(css.includes('#map-banner.banner-open#imagery-banner,#map-banner.banner-open#risk-banner{display:block}'), 'opening the toggle reveals the folded notes');
  assert.ok(!css.includes('map-source-notice){display:none'), 'live data notices are never folded away');
  assert.ok(css.includes('pointer-events:auto'), 'folded banner toggle stays tappable over the map');
});

test('narrow mission dock folds to its heading and leaves gestures alone', async()=>{
  const css=(await readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), 'style.css'),'utf8')).replace(/\s+/g,'');
  assert.ok(css.includes(':not(.details-open).map-aircraft-card'), 'narrow dock folds aircraft cards until details open');
  assert.ok(css.includes(':not(.details-open)#map-mission-state'), 'narrow dock folds its status line until details open');
  assert.ok(css.includes(':not(.details-open)#map-dock-stop'), 'narrow dock folds its stop until details open');
  assert.ok(css.includes('#map-mission-more{display:block'), 'narrow dock keeps its details toggle visible');
  assert.ok(css.includes('.map-mission-dock:not(.details-open){pointer-events:none}'), 'folded dock leaves map gestures alone');
  assert.ok(css.includes(':not(.details-open)#map-mission-more{pointer-events:auto}'), 'folded dock keeps its toggle tappable');
  const h=await harness();
  h.el('map-mission-more').click();
  assert.ok(h.el('map-mission-dock').classList.contains('details-open'), 'existing details toggle still reopens the folded cards');
});

test('folded map frames lose nothing below: guide keeps destinations, status and stop', async()=>{
  const h=await harness();
  h.run("mapPlanController=null; mapPlanPhase='delivery'; draftShelter='原中学校';");
  h.el('map-sim-status').textContent='仮想の荷下ろし中。';
  h.el('map-fleet-state').textContent='2号機は帰還中。';
  h.run("syncFlow();");
  const guide=h.el('map-guide-live').textContent;
  assert.match(guide,/原中学校/);
  assert.match(guide,/仮想の荷下ろし中/);
  assert.match(guide,/2号機/);
  const html=await readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.html'),'utf8');
  const dockAt=html.indexOf('id="map-mission-dock"');
  assert.ok(dockAt!==-1&&html.indexOf('id="map-guide-live"')>dockAt&&html.indexOf('id="map-sim-stop"')>dockAt, 'guide and stop sit below the map, outside the folded dock');
});
