import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {appendLargeFleetRecord,updateLocalHistory,decisionCardView} from './readiness.mjs';

async function harness(){
  const source=await readFile(new URL('./app.js',import.meta.url),'utf8');
  const code=source.slice(source.indexOf("const largeFleetHistoryKey="),source.indexOf('const largeFleetLabels='));
  const values=new Map(),elements={
    'map-area-title':{textContent:'東京都荒川区 ／ 実地図'},
    'large-fleet-previous':{hidden:true,textContent:''},
    'large-fleet-previous-details':{hidden:true},
    'large-fleet-previous-events':{textContent:''},
    'large-fleet-note':{textContent:''},
    'large-fleet-retry':{hidden:true},
    'large-fleet-pending-export':{hidden:true},
    'large-fleet-pending-discard':{hidden:true}
  };
  const localStorage={getItem:key=>values.has(key)?values.get(key):null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
  const versionsData=new Map(),versions={async read(key){return versionsData.has(key)?{exists:true,value:versionsData.get(key)}:{exists:false}},async write(key,value){versionsData.set(key,value)}};
  const locks={request(_name,_options,fn){return Promise.resolve().then(fn)}};
  const context={localStorage,$:id=>elements[id],navigator:{locks},appendLargeFleetRecord,decisionCardView,updateLocalHistory:options=>updateLocalHistory({...options,versions}),largeFleetSession:{id:'run1',area:'東京都荒川区',startedAt:'2026-11-03T00:00:00Z',source:'PLATEAU',saved:false}};
  vm.runInNewContext(code,context);
  return {values,elements,context};
}

test('stores each virtual result and shows it only as reference next time',async()=>{
  const h=await harness();
  const data={summary:{stopped:1},events:[{source:'app',text:'点検しました'},{source:'Muse',text:'案B'}],comparison:{affectedIds:['unit-001'],candidates:{A:{routes:{'unit-001':{path:[{latitude:35,longitude:139},{latitude:35.1,longitude:139.1}]}}},B:{routes:{}}},evidence:{distances:{A:{representative:{totalM:100},totalM:100},B:null}}},aircraft:[
    {id:'unit-001',state:'complete',origin:{latitude:35,longitude:139},destination:{name:'施設A'},check:{evidence:{total:2,unknown:0}},delivery:{ok:true},hold:{hazardId:'virtual-1'},detour:{choice:'B',path:[{latitude:35,longitude:139}]}},
    {id:'unit-002',state:'stopped',origin:{latitude:35,longitude:139},destination:{name:'施設B'},reason:'点検不明',check:null,delivery:null}
  ]};
  assert.equal(await h.context.saveLargeFleetHistory(data),true);
  const records=JSON.parse(h.values.get('muse-large-fleet-history-v1'));
  assert.equal(records.length,1);
  assert.equal(records[0].units.length,2);
  assert.equal(records[0].units[1].reason,'点検不明');
  assert.equal(records[0].events[1].source,'Muse');
  assert.equal(records[0].comparison.candidates.A.routes['unit-001'].path.length,2);
  assert.equal(records[0].comparison.evidence.distances.A.totalM,100);
  assert.match(h.elements['large-fleet-previous-events'].textContent,/アプリ.*点検しました/);
  assert.match(h.elements['large-fleet-previous-events'].textContent,/出所は不明.*案B/);
  assert.match(h.elements['large-fleet-previous-events'].textContent,/案A.*100/);
  assert.equal(h.elements['large-fleet-previous-details'].hidden,false);
  assert.equal(records[0].units[0].hold.hazardId,'virtual-1');
  assert.equal(records[0].units[0].detour.choice,'B');
  assert.equal(records[0].delivered,1);
  assert.match(h.elements['large-fleet-previous'].textContent,/参考記録.*今回もモデルを点検/);
  assert.equal(await h.context.saveLargeFleetHistory(data),null);
  h.elements['map-area-title'].textContent='東京都台東区 ／ 実地図';
  h.context.renderLargeFleetHistory();
  assert.equal(h.elements['large-fleet-previous'].hidden,true);
  assert.equal(h.elements['large-fleet-previous-details'].hidden,true);
});

test('does not overwrite an unreadable saved history',async()=>{
  const h=await harness();
  h.values.set('muse-large-fleet-history-v1','broken-data');
  assert.equal(await h.context.saveLargeFleetHistory({summary:{stopped:0},aircraft:[]}),false);
  assert.equal(h.values.get('muse-large-fleet-history-v1'),'broken-data');
});

test('failed storage leaves the result available for a later retry',async()=>{
  const h=await harness();
  const data={summary:{stopped:1},aircraft:[{id:'unit-001',state:'stopped',reason:'点検不明',delivery:null}]};
  const save=h.context.localStorage.setItem;
  h.context.localStorage.setItem=()=>{throw new Error('storage unavailable')};
  assert.equal(await h.context.persistLargeFleetHistory(data),false);
  assert.equal(h.elements['large-fleet-retry'].hidden,false);
  assert.match(h.elements['large-fleet-note'].textContent,/保存できません/);
  assert.equal(h.context.largeFleetSession.saved,false);
  h.context.localStorage.setItem=save;
  assert.equal(await h.context.persistLargeFleetHistory(data),true);
  assert.equal(h.elements['large-fleet-retry'].hidden,true);
  assert.match(h.elements['large-fleet-note'].textContent,/保存しました/);
  assert.equal(h.context.largeFleetSession.saved,true);
  assert.equal(JSON.parse(h.values.get('muse-large-fleet-history-v1')).length,1);
  assert.equal(await h.context.saveLargeFleetHistory(data),null);
});

test('full history preserves all records and retains the unsaved result for export and retry',async()=>{
  const h=await harness(),key='muse-large-fleet-history-v1';
  const rows=Array.from({length:20},(_,i)=>({id:`old-${i}`,area:'東京都荒川区',startedAt:'2026-11-03T00:00:00Z',finishedAt:'2026-11-03T01:00:00Z',total:1,delivered:0,stopped:1,events:[],units:[{id:'unit-001'}]}));
  h.values.set(key,JSON.stringify(rows));const data={summary:{stopped:1},aircraft:[{id:'unit-001',state:'stopped',reason:'点検不明',delivery:null}]};
  assert.equal(await h.context.persistLargeFleetHistory(data),false);assert.deepEqual(JSON.parse(h.values.get(key)),rows);
  assert.equal(h.elements['large-fleet-pending-export'].hidden,false);assert.equal(h.context.largeFleetSession.saved,false);
  const original=h.context.largeFleetSession.pendingRecord;
  await h.context.updateLocalHistory({storage:h.context.localStorage,locks:h.context.navigator.locks,key,expected:h.values.get(key),update:()=>null});
  assert.equal(await h.context.persistLargeFleetHistory({...data,summary:{stopped:0}}),true);
  assert.equal(JSON.parse(h.values.get(key))[0].stopped,1);assert.equal(h.context.largeFleetSession.pendingRecord,original);
});

test('history explains when aircraft stopped after completing their virtual delivery',async()=>{
  const h=await harness();
  const data={summary:{stopped:1},aircraft:[{id:'unit-001',state:'stopped',reason:'帰還中に停止',delivery:{ok:true}}]};
  assert.equal(await h.context.saveLargeFleetHistory(data),true);
  assert.match(h.elements['large-fleet-previous'].textContent,/荷下ろし済み 1機・停止 1機/);
  assert.match(h.elements['large-fleet-previous'].textContent,/荷下ろし後に停止.*両方/);
});

test('a saved cargo request is shown as a past reference, not a current delivery',async()=>{
  const h=await harness();
  const data={summary:{stopped:1},aircraft:[{id:'unit-001',state:'stopped',reason:'点検不明',delivery:null}],
    cargo:{manifest:{destination:{name:'施設A'},supply:'飲料水',requested:12},summary:{delivered:3,stopped:1,unknown:0,unassigned:0,assigning:8}}};
  assert.equal(await h.context.saveLargeFleetHistory(data),true);
  assert.match(h.elements['large-fleet-previous-events'].textContent,/前回.*施設A.*飲料水.*12箱/);
  assert.match(h.elements['large-fleet-previous-events'].textContent,/荷下ろし済み 3箱/);
});
