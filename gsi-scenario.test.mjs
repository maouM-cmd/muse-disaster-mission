import test from 'node:test';import assert from 'node:assert/strict';
import {scenarioUrl,parseScenarioDepths,requestScenarioDepths} from './gsi-scenario.mjs';
import * as scenario from './gsi-scenario.mjs';
const row={Depth:3.62,EntryRiverName:'荒川',RiverCode:'8303040001',SubRiverCode:'_',OfficeCode:'21281',CSVScale:0};
test('comparison highlights only numerical range differences, never a safety decision',()=>{
 assert.equal(typeof scenario.compareScenarioRanges,'function');
 const values=parseScenarioDepths([row]),compare=(tile,rows=values)=>scenario.compareScenarioRanges(tile,rows);
 assert.equal(compare('3.0〜5.0m').state,'within');assert.equal(compare('0.5〜3.0m').state,'outside');assert.equal(compare('5.0〜10.0m').state,'outside');
 assert.equal(compare('3.0〜5.0m',[{...values[0],depth:5}]).state,'outside');assert.equal(compare('5.0〜10.0m',[{...values[0],depth:5}]).state,'within');
 for(const bad of [[],null,[{...values[0],depth:-1}],[{...values[0],depth:NaN}],[{...values[0],scale:1}]])assert.equal(compare('3.0〜5.0m',bad).state,'unknown');
 assert.equal(compare('安全').state,'unknown');assert.equal(compare(null).state,'unknown');
 assert.equal(compare('0.5m未満',[{...values[0],depth:0}]).state,'within');assert.equal(compare('20.0m以上',[{...values[0],depth:20}]).state,'within');
});
test('the official request uses only the selected public point and largest-scale scenario',()=>{
 const url=new URL(scenarioUrl({latitude:35.733,longitude:139.783}));assert.equal(url.origin,'https://suiboumap.gsi.go.jp');assert.equal(url.pathname,'/shinsuimap/Api/Public/GetMaxDepthFromLatlon');assert.equal(url.searchParams.get('lat'),'35.733');assert.equal(url.searchParams.get('lon'),'139.783');assert.equal(url.searchParams.get('CSVScale'),'0');assert.equal([...url.searchParams].length,3);
 for(const p of [{latitude:NaN,longitude:0},{latitude:91,longitude:1},{latitude:1,longitude:-181}])assert.throws(()=>scenarioUrl(p));
});
test('scenario records retain river identity, scale and depth without inferring current conditions',()=>{
 const values=parseScenarioDepths([row]);assert.deepEqual(values,[{river:'荒川',riverCode:'8303040001',subRiverCode:'_',officeCode:'21281',depth:3.62,scale:0}]);assert.deepEqual(parseScenarioDepths([]),[]);
 for(const bad of [null,{},[null],[{...row,Depth:-1}],[{...row,Depth:'3.62'}],[{...row,CSVScale:1}],[{...row,RiverCode:''}],[{...row,EntryRiverName:''}],Array(101).fill(row)])assert.throws(()=>parseScenarioDepths(bad));
});
test('cross-tab rate lock, limited requests and invalid responses fail closed',async()=>{
 let calls=0,now=100000,stored=null;const storage={getItem:()=>stored,setItem:(_key,val)=>{stored=val}},locks={request:async(_key,_options,run)=>run({})},fetcher=async()=>{calls++;return new Response(JSON.stringify([row]),{status:200,headers:{'content-type':'application/json'}})};
 const options={point:{latitude:35.733,longitude:139.783},locks,storage,fetcher,clock:()=>now};const result=await requestScenarioDepths(options);assert.equal(result.rows[0].depth,3.62);assert.equal(calls,1);
 await assert.rejects(()=>requestScenarioDepths(options),e=>e.code==='rate_wait');assert.equal(calls,1);now+=3000;await requestScenarioDepths(options);assert.equal(calls,2);
 await assert.rejects(()=>requestScenarioDepths({...options,locks:{request:async(_k,_o,run)=>run(null)}}),e=>e.code==='busy');await assert.rejects(()=>requestScenarioDepths({...options,locks:null}),e=>e.code==='coordination_unavailable');
 now+=3000;await assert.rejects(()=>requestScenarioDepths({...options,fetcher:async()=>new Response('invalid',{status:200})}),e=>e.code==='invalid_response');
 now+=3000;await assert.rejects(()=>requestScenarioDepths({...options,fetcher:async()=>new Response('',{status:503})}),e=>e.code==='request_failed');
 stored='corrupt';await assert.rejects(()=>requestScenarioDepths(options),e=>e.code==='coordination_unavailable');
});
