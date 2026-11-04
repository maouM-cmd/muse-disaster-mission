import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

async function render(events,{real=false,capable=false,aircraft=[],phase='flight',active=true,provenance='muse'}={}){
  const source=await readFile(new URL('./app.js',import.meta.url),'utf8');
  const code=source.slice(source.indexOf('function fleetEventLabel('),source.indexOf('let fleetReviewRecord'))+source.slice(source.indexOf('function renderLargeFleet(data)'),source.indexOf('function syncFleetSize()'));
  const elements=new Map();elements.speech=[];
  const element=id=>{
    if(!elements.has(id))elements.set(id,{textContent:'',hidden:false,dataset:{},options:[{}],value:'',replaceChildren(...children){this.children=children}});
    return elements.get(id);
  };
  const context={
    $:element,document:{body:{classList:{add(){},remove(){}}},createElement:()=>({textContent:''})},
    largeFleetLaunching:false,largeFleetBusy:false,largeFleetData:null,largeFleetSelected:'',largeFleetPreviousRadio:null,
    largeFleetEventKey:'',largeFleetSpokenKey:'',largeFleetSession:null,largeFleetLabels:{},
    showMapSpeech(who,text){elements.speech.push({who,text})},summarizeStoppedReasons:()=>'',syncMapPlan(){},real,mapFleetPlanAvailable:capable
  };
  vm.runInNewContext(code,context);
  element('large-fleet-select').options=Array.from({length:aircraft.length+1},()=>({textContent:''}));
  context.renderLargeFleet({events,active,phase,aircraft,comparison:{input:{provenance}},summary:{stopped:aircraft.filter(unit=>unit.state==='stopped').length}});
  return elements;
}

test('the current event identifies a Muse answer as an unverified model response',async()=>{
  const els=await render([{source:'Muse',text:'案Bを提案します'}]);
  assert.match(els.get('large-fleet-sharing').textContent,/Museの回答.*未検証.*案Bを提案します/);
  assert.match(els.get('large-fleet-events').children[0].textContent,/Museの回答.*案Bを提案します/);
});
test('fixture and legacy response sources are identified distinctly',async()=>{
 const fixture=await render([{source:'fixture',text:'案B'}],{provenance:'fixture'});assert.match(fixture.get('large-fleet-sharing').textContent,/試験用の固定応答/);assert.doesNotMatch(fixture.get('large-fleet-sharing').textContent,/Muse/);
 const unknown=await render([{source:'Muse',text:'案A'}],{provenance:'unknown'});assert.match(unknown.get('large-fleet-sharing').textContent,/出所は不明/);
});

test('a stop replaces the old Muse subtitle with an attributed application notice',async()=>{
  const aircraft=[{id:'1',index:0,state:'stopped',destination:{name:'施設'}}];
  const els=await render([{source:'Muse',text:'仮想案A。理由：比較'}, {source:'app',text:'利用者が停止'}],{aircraft,phase:'stopped',active:false});
  assert.deepEqual(els.speech.map(item=>item.who),['アプリ']);
  assert.match(els.speech[0].text,/停止/);
});

test('the current event identifies an app message separately',async()=>{
  const els=await render([{source:'app',text:'点検結果を共有しました'}]);
  assert.match(els.get('large-fleet-sharing').textContent,/アプリの共有.*点検結果を共有しました/);
});

test('the initial radio does not promise a Muse consultation when disconnected',async()=>{
  const els=await render([]);
  assert.match(els.get('map-radio-live').textContent,/接続状況が不明/);
  assert.doesNotMatch(els.get('map-radio-live').textContent,/相談します/);
});

test('the initial radio describes a possible consultation when the configured server supports it',async()=>{
  const els=await render([],{real:true,capable:true});
  assert.match(els.get('map-radio-live').textContent,/相談します/);
});

test('status explains a unit counted as both delivered and stopped',async()=>{
  const aircraft=[{id:'1',index:0,state:'stopped',destination:{name:'施設'},delivery:{ok:true}}];
  const els=await render([],{aircraft});
  assert.match(els.get('large-fleet-count').textContent,/停止 1.*荷下ろし済（全施設） 1/);
  assert.match(els.get('large-fleet-count').textContent,/荷下ろし後に停止.*両方/);
});
