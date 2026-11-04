import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {appendLargeFleetRecord,updateLocalHistory} from './readiness.mjs';

function historyTools(){const data=new Map(),versions={async read(key){return data.has(key)?{exists:true,value:data.get(key)}:{exists:false}},async write(key,value){data.set(key,value)}};return {navigator:{locks:{request(_name,_options,fn){return Promise.resolve().then(fn)}}},appendLargeFleetRecord,updateLocalHistory:options=>updateLocalHistory({...options,versions})}}

test('a failed result can be saved through the retry button without duplication',async()=>{
  const source=await readFile(new URL('./app.js',import.meta.url),'utf8');
  const history=source.slice(source.indexOf('const largeFleetHistoryKey='),source.indexOf('const largeFleetLabels='));
  const render=source.slice(source.indexOf('function renderLargeFleet(data)'),source.indexOf('function syncFleetSize()'));
  const buttonHandler=source.split('\n').find(line=>line.startsWith("$('large-fleet-retry')?.addEventListener"));
  assert.ok(buttonHandler,'retry button must be connected');
  const entries=new Map(),elements=new Map();
  const element=id=>{
    if(!elements.has(id))elements.set(id,{textContent:'',hidden:false,dataset:{},options:[],value:'',handlers:{},
      addEventListener(name,handler){this.handlers[name]=handler},
      replaceChildren(...children){this.children=children;this.options=children}});
    return elements.get(id);
  };
  element('map-area-title').textContent='東京都荒川区 ／ 実地図';
  let fail=true;
  const storage={getItem:key=>entries.has(key)?entries.get(key):null,setItem:(key,value)=>{if(fail)throw new Error('storage unavailable');entries.set(key,value)}};
  const context={...historyTools(),localStorage:storage,$:element,document:{body:{classList:{add(){},remove(){}}},createElement:()=>({textContent:''})},
    Option:function(text,value){this.textContent=text;this.value=value},largeFleetSession:{id:'run1',area:'東京都荒川区',startedAt:'2026-11-03T00:00:00Z',saved:false},
    largeFleetLaunching:false,largeFleetBusy:false,largeFleetData:null,largeFleetSelected:'',largeFleetPreviousRadio:null,
    largeFleetEventKey:'',largeFleetSpokenKey:'',largeFleetLabels:{stopped:'停止'},real:false,mapFleetPlanAvailable:false,
    summarizeStoppedReasons:()=>'',showMapSpeech(){},syncMapPlan(){}};
  vm.runInNewContext(history+'\n'+render+'\n'+buttonHandler,context);
  const data={active:false,events:[],summary:{stopped:1},aircraft:[{id:'unit-001',index:0,state:'stopped',destination:{name:'施設A'},reason:'点検不明'}]};
  context.renderLargeFleet(data);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(element('large-fleet-retry').hidden,false);
  assert.match(element('large-fleet-note').textContent,/保存できません/);
  fail=false;
  element('large-fleet-retry').handlers.click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(element('large-fleet-retry').hidden,true);
  assert.match(element('large-fleet-note').textContent,/保存しました/);
  element('large-fleet-retry').handlers.click();
  assert.equal(JSON.parse(entries.get('muse-large-fleet-history-v1')).length,1);
});

test('a cargo accounting error is saved as unknown rather than a delivery success',async()=>{
  const source=await readFile(new URL('./app.js',import.meta.url),'utf8');
  const history=source.slice(source.indexOf('const largeFleetHistoryKey='),source.indexOf('const largeFleetLabels='));
  const entries=new Map(),elements=new Map();
  const element=id=>{if(!elements.has(id))elements.set(id,{textContent:'',hidden:false});return elements.get(id)};
  element('map-area-title').textContent='東京都荒川区 ／ 実地図';
  const context={...historyTools(),localStorage:{getItem:key=>entries.get(key)??null,setItem:(key,value)=>entries.set(key,value)},$:element,
    largeFleetSession:{id:'bad-run',area:'東京都荒川区',startedAt:'2026-11-03T00:00:00Z',saved:false}};
  vm.runInNewContext(history,context);
  const data={summary:{stopped:1},aircraft:[{id:'unit-001',state:'stopped',delivery:{ok:true}}],cargo:{error:'集計不整合'}};
  assert.equal(await context.saveLargeFleetHistory(data),true);
  assert.equal(JSON.parse(entries.get('muse-large-fleet-history-v1'))[0].delivered,null);
  assert.match(element('large-fleet-previous').textContent,/荷下ろし済み 不明/);
  assert.match(element('large-fleet-previous-events').textContent,/集計できません/);
});

test('previous cargo history shows boxes left unassigned, stopped and unknown',async()=>{
  const source=await readFile(new URL('./app.js',import.meta.url),'utf8');
  const history=source.slice(source.indexOf('const largeFleetHistoryKey='),source.indexOf('const largeFleetLabels='));
  const record={area:'東京都荒川区',total:100,delivered:90,stopped:10,finishedAt:'2026-11-03T00:00:00Z',cargo:{manifest:{destination:{name:'施設A'},supply:'飲料水',requested:150},summary:{delivered:90,stopped:7,unknown:3,unassigned:50}}};
  const elements=new Map(),element=id=>{if(!elements.has(id))elements.set(id,{textContent:'',hidden:false});return elements.get(id)};
  element('map-area-title').textContent='東京都荒川区 ／ 実地図';
  const context={localStorage:{getItem:()=>JSON.stringify([record])},$:element};
  vm.runInNewContext(history,context);context.renderLargeFleetHistory();
  assert.match(element('large-fleet-previous-events').textContent,/未割当\s*50箱/);
  assert.match(element('large-fleet-previous-events').textContent,/停止\s*7箱/);
  assert.match(element('large-fleet-previous-events').textContent,/所在不明\s*3箱/);
});

test('diverted boxes are not described as delivered to the original facility',async()=>{
  const source=await readFile(new URL('./app.js',import.meta.url),'utf8');
  const history=source.slice(source.indexOf('const largeFleetHistoryKey='),source.indexOf('const largeFleetLabels='));
  const record={area:'東京都荒川区',total:2,delivered:2,stopped:0,finishedAt:'2026-11-03T00:00:00Z',cargo:{manifest:{destination:{name:'施設A'},supply:'飲料水',requested:2},summary:{delivered:2,deliveredOriginal:0,deliveredOther:2,stopped:0,unknown:0,unassigned:0,byFacility:[{name:'施設A',delivered:0},{name:'施設B',delivered:2}]}}};
  const elements=new Map(),element=id=>{if(!elements.has(id))elements.set(id,{textContent:'',hidden:false});return elements.get(id)};
  element('map-area-title').textContent='東京都荒川区 ／ 実地図';
  const context={localStorage:{getItem:()=>JSON.stringify([record])},$:element};
  vm.runInNewContext(history,context);context.renderLargeFleetHistory();
  const text=element('large-fleet-previous-events').textContent;
  assert.match(text,/元施設.*0箱/);assert.match(text,/施設B.*2箱/);
});

test('a pending diversion shows before-and-after facilities and waits for a choice',async()=>{
  const source=await readFile(new URL('./app.js',import.meta.url),'utf8');
  const render=source.slice(source.indexOf('function renderLargeFleet(data)'),source.indexOf('function syncFleetSize()'));
  const elements=new Map(),element=id=>{if(!elements.has(id))elements.set(id,{textContent:'',hidden:false,disabled:false,dataset:{},options:[],value:'',replaceChildren(...x){this.options=x}});return elements.get(id)};
  const context={document:{body:{classList:{add(){},remove(){}}},createElement:()=>({})},$:element,Option:function(t,v){this.textContent=t;this.value=v},
    largeFleetLaunching:false,largeFleetBusy:false,largeFleetData:null,largeFleetSelected:'',largeFleetPreviousRadio:null,largeFleetSession:null,
    largeFleetEventKey:'',largeFleetSpokenKey:'',largeFleetLabels:{},real:false,mapFleetPlanAvailable:false,summarizeStoppedReasons:()=>'',showMapSpeech(){},syncMapPlan(){}};
  vm.runInNewContext(render,context);
  context.renderLargeFleet({active:true,aircraft:[],events:[],summary:{},pendingDiversion:{id:'p1',affected:2,original:{name:'施設A'},supply:'水',destinations:[{name:'施設B',latitude:35.7,longitude:139.7,boxes:2}]}});
  assert.equal(element('large-fleet-approval').hidden,false);
  assert.match(element('large-fleet-approval-text').textContent,/施設A/);
  assert.match(element('large-fleet-approval-text').textContent,/施設B.*2箱/);
  context.renderLargeFleet({active:true,aircraft:[],events:[],summary:{},pendingDiversion:null});
  assert.equal(element('large-fleet-approval').hidden,true);
});
