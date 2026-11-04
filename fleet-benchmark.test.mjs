import test from 'node:test';
import assert from 'node:assert/strict';
import {planFleetTextBenchmark} from './meta.mjs';
import {benchmarkCases,benchmarkCaseFromHistory,runFleetBenchmark} from './fleet-benchmark.mjs';
import {createServer} from './server.mjs';

const reply=value=>({ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(value)}]}]})});

test('text comparison sends only common candidate data and no image',async()=>{
 const evidence=benchmarkCases()[0].evidence;let sent;
 const result=await planFleetTextBenchmark({key:'fixture',evidence},async(_url,options)=>{sent=JSON.parse(options.body);return reply({choice:'A',reason:'固定応答'})});
 assert.equal(result.choice,'A');assert.equal(sent.model,'muse-spark-1.3');assert.equal(sent.input[0].content.length,1);assert.equal(sent.input[0].content[0].type,'input_text');assert.ok(sent.input[0].content[0].text.includes(JSON.stringify(evidence)));assert.doesNotMatch(JSON.stringify(sent),/input_image/);
 await assert.rejects(planFleetTextBenchmark({key:'fixture',evidence},async()=>reply({choice:'C',reason:'bad'})),/不正/);
 await assert.rejects(planFleetTextBenchmark({key:'fixture',evidence:{...evidence,address:'secret'}},async()=>reply({choice:'A',reason:'x'})),/不正/);
});

test('comparison records common inputs, invalid choices and failures separately without moving drones',async()=>{
 const cases=benchmarkCases(),seen=[];let n=0;
 const result=await runFleetBenchmark({cases,request:async evidence=>{seen.push(structuredClone(evidence));n++;if(n===3)throw new Error('fixture unavailable');return {choice:n===2?'A':'A',reason:'固定応答'}}});
 assert.equal(result.items.length,3);assert.deepEqual(seen,cases.map(item=>item.evidence));assert.deepEqual(result.items.map(item=>item.baseline.choice),['A','B','none']);
 assert.equal(result.items[1].muse.state,'rejected');assert.equal(result.items[2].muse.state,'error');assert.equal(result.items[2].muse.choice,null);assert.equal(result.items[2].muse.error,'fixture unavailable');
 assert.equal(result.summary.attempted,3);assert.equal(result.summary.responded,2);assert.equal(result.simulationOnly,true);
});

test('comparison records declared response provenance and does not infer older responses are Muse',async()=>{
 const cases=benchmarkCases(),answers=[{result:{choice:'A',reason:'fixed'},provenance:'fixture'},{result:{choice:'B',reason:'live'},provenance:'muse'},{result:{choice:'none',reason:'old'}}];let n=0;
 const result=await runFleetBenchmark({cases,request:async()=>answers[n++]});
 assert.deepEqual(result.items.map(item=>item.muse.provenance),['fixture','muse','unknown']);
 const old=await runFleetBenchmark({cases:[cases[0]],request:async()=>({choice:'A',reason:'legacy'})});assert.equal(old.items[0].muse.provenance,'unknown');
});

test('comparison API is local-origin only and rejects unsolicited data',async t=>{
 let calls=0;const server=createServer({active:true,key:'test',fleetBenchmarkProvenance:'fixture',fleetBenchmark:async({evidence})=>{calls++;return {choice:'A',reason:'固定'}}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base=`http://127.0.0.1:${server.address().port}`,evidence=benchmarkCases()[0].evidence;
 const post=(data,origin=base)=>fetch(base+'/api/fleet-benchmark',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify(data)});
 const first=await post({evidence});assert.equal(first.status,200);assert.equal((await first.json()).provenance,'fixture');assert.equal((await post({evidence,image:'private'})).status,400);assert.equal((await post({evidence},'https://example.test')).status,403);assert.equal(calls,1);
});

test('comparison and map planning failures do not expose internal error text',async t=>{
 const secret='fixture-sensitive-value-not-a-real-key',fail=async()=>{throw new Error(`internal detail ${secret}`)};
 const server=createServer({active:true,key:'fixture',fleetBenchmark:fail,fleetPlan:fail,mapPlan:fail});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base=`http://127.0.0.1:${server.address().port}`,evidence=benchmarkCases()[0].evidence;
 for(const [route,payload] of [['fleet-benchmark',{evidence}],['fleet-plan',{evidence,image:'data:image/png;base64,AA=='}],['map-plan',{image:'data:image/png;base64,AA=='}]]){
  const response=await fetch(`${base}/api/${route}`,{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify(payload)});
  assert.equal(response.status,502);const result=await response.text();assert.doesNotMatch(result,/fixture-sensitive-value-not-a-real-key|internal detail/);assert.match(result,/Muse/);
 }
});

test('malformed requests are distinguished from remote failures without invoking a model',async t=>{
 let calls=0;const fail=async()=>{calls++;throw new Error('should not be called')};
 const server=createServer({active:true,key:'fixture',fleetBenchmark:fail,fleetPlan:fail,mapPlan:fail});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base=`http://127.0.0.1:${server.address().port}`;
 for(const route of ['fleet-benchmark','fleet-plan','map-plan']){
  const response=await fetch(`${base}/api/${route}`,{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:'{}'});
  assert.equal(response.status,400);assert.match((await response.json()).error,/入力/);
 }
 assert.equal(calls,0);
});

test('known authentication and quota errors offer appropriate generic guidance',async t=>{
 let code=401;const server=createServer({active:true,key:'fixture',fleetBenchmark:async()=>{throw new Error(`Meta API エラー (${code})`)}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base=`http://127.0.0.1:${server.address().port}`;
 for(const [status,expected] of [[401,/認証/],[403,/認証/],[429,/利用制限/]]){
  code=status;const response=await fetch(`${base}/api/fleet-benchmark`,{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify({evidence:benchmarkCases()[0].evidence})});
  assert.equal(response.status,502);assert.match((await response.json()).error,expected);
 }
});

test('cancellation does not continue to later cases or return a completed report',async()=>{
 const controller=new AbortController();let calls=0;
 await assert.rejects(runFleetBenchmark({signal:controller.signal,request:async()=>{calls++;controller.abort();return {choice:'A',reason:'late'}}}),/abort/i);
 assert.equal(calls,1);
});

test('previous simulation comparison is scoped to the most recent saved run and sends only validated numeric evidence',async()=>{
 const evidence=benchmarkCases()[0].evidence;
 const make=(id,area,finishedAt,data)=>({id,area,startedAt:'2026-11-03T00:00:00.000Z',finishedAt,total:1,stopped:1,delivered:0,units:[{}],events:[],comparison:{attempt:2,evidence:data}});
 const newer=make('newer','東京都荒川区','2026-11-03T02:00:00.000Z',evidence),older=make('older','東京都荒川区','2026-11-03T01:00:00.000Z',evidence),other=make('other','東京都台東区','2026-11-03T03:00:00.000Z',evidence);
 const selected=benchmarkCaseFromHistory(JSON.stringify([older,other,newer]),'東京都荒川区');
 assert.equal(selected.source.runId,'newer');assert.equal(selected.source.attempt,2);assert.equal(selected.cases.length,1);let sent;
 await runFleetBenchmark({cases:selected.cases,request:async value=>(sent=value,{choice:'A',reason:'固定'})});assert.deepEqual(sent,evidence);assert.equal(JSON.stringify(sent).includes('東京都'),false);
 assert.throws(()=>benchmarkCaseFromHistory(JSON.stringify([older,{...newer,comparison:{}}]),'東京都荒川区'),/点検/);
 assert.throws(()=>benchmarkCaseFromHistory(JSON.stringify([older,{...newer,comparison:{evidence:{...evidence,address:'secret'}}}]),'東京都荒川区'),/点検/);
 assert.throws(()=>benchmarkCaseFromHistory('{bad','東京都荒川区'),/読み取/);assert.throws(()=>benchmarkCaseFromHistory(JSON.stringify([other]),'東京都荒川区'),/記録/);
});
