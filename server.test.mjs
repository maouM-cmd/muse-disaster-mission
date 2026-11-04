import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from './server.mjs';
import {planWithMuse,segmentWithSam,transcribeWithMuse} from './meta.mjs';
import {readPlanStream} from './plan-stream.mjs';
import {createJmaReportLoader,validJmaWarningReportUrl} from './jma-feed-server.mjs';

async function fixture(t,options){
  const server=createServer(options);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}
test('capability classifies injected adapters as unknown unless explicitly declared as fixture',async t=>{
 const live=await fixture(t,{active:true,key:'fixture'}),fake=await fixture(t,{active:true,key:'fixture',fleetPlan:async()=>({}),fleetPlanProvenance:'fixture'});
 assert.equal((await (await fetch(live+'/api/map-capabilities')).json()).fleetPlanProvenance,'muse');
 assert.equal((await (await fetch(fake+'/api/map-capabilities')).json()).fleetPlanProvenance,'fixture');
 assert.equal((await (await fetch(live+'/api/map-capabilities')).json()).mapConsultProvenance,'muse');
 const fakeMap=await fixture(t,{active:true,key:'fixture',mapConsult:async()=>({}),mapConsultProvenance:'fixture'});assert.equal((await (await fetch(fakeMap+'/api/map-capabilities')).json()).mapConsultProvenance,'fixture');
 const wrapped=await fixture(t,{active:true,key:'fixture',mapConsult:async()=>({}),fleetPlan:async()=>({})});
 const unknown=await (await fetch(wrapped+'/api/map-capabilities')).json();
 assert.equal(unknown.mapConsultProvenance,'unknown');assert.equal(unknown.fleetPlanProvenance,'unknown');
 assert.throws(()=>createServer({fleetPlan:async()=>({}),fleetPlanProvenance:'muse'}),/provenance/i);
 assert.throws(()=>createServer({mapConsult:async()=>({}),mapConsultProvenance:'invalid'}),/provenance/i);
 assert.throws(()=>createServer({mapConsultProvenance:'fixture'}),/provenance/i);
 assert.throws(()=>createServer({fleetPlanProvenance:'fixture'}),/provenance/i);
 const mapPlanUnknown=await fixture(t,{active:true,key:'fixture',mapPlan:async()=>({})});
 assert.equal((await (await fetch(mapPlanUnknown+'/api/map-capabilities')).json()).mapPlanProvenance,'unknown');
 const mapPlanFixture=await fixture(t,{active:true,key:'fixture',mapPlan:async()=>({}),mapPlanProvenance:'fixture'});
 assert.equal((await (await fetch(mapPlanFixture+'/api/map-capabilities')).json()).mapPlanProvenance,'fixture');
});
function post(base,path,data,origin=base){return fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify(data)})}

test('the official flood feed is available without Muse and only to this local app origin',async t=>{
 let calls=0;const base=await fixture(t,{active:false,floodFeed:async()=>{calls++;return {xml:'<feed xmlns="http://www.w3.org/2005/Atom"></feed>',fetchedAt:'2026-11-04T00:00:00.000Z'}}});
 assert.equal((await post(base,'/api/flood-feed',{},'http://example.test')).status,403);assert.equal(calls,0);
 assert.equal((await post(base,'/api/flood-feed',{other:'x'})).status,400);assert.equal(calls,0);
 const response=await post(base,'/api/flood-feed',{});assert.equal(response.status,200);assert.match((await response.json()).xml,/<feed/);assert.equal(calls,1);
});

test('recent flood feed is separately available without Muse and never accepts a caller-supplied URL',async t=>{
 let calls=0;const base=await fixture(t,{active:false,recentFloodFeed:async()=>{calls++;return {xml:'<feed/>',fetchedAt:'2026-11-04T00:00:00.000Z'}}});
 assert.equal((await post(base,'/api/flood-feed-recent',{},'http://example.test')).status,403);
 assert.equal((await post(base,'/api/flood-feed-recent',{url:'https://example.test'})).status,400);
 assert.equal((await post(base,'/api/flood-feed-recent',{})).status,200);assert.equal(calls,1);
});

test('flood bulletin details accept only the official bulletin URL and reject cross-origin or extra input',async t=>{
 let calls=0;const url='https://www.data.jma.go.jp/developer/xml/data/20251118064500_0_VXKO50_000000.xml';
 const base=await fixture(t,{active:false,floodReport:async input=>{calls++;assert.equal(input,url);return {xml:'<Report/>',fetchedAt:'2026-11-04T00:00:00.000Z'}}});
 assert.equal((await post(base,'/api/flood-report',{url},'https://example.test')).status,403);
 for(const value of ['https://evil.test/a_VXKO50_1.xml',url+'?x=1','http://www.data.jma.go.jp/developer/xml/data/20251118064500_0_VXKO50_000000.xml'])assert.equal((await post(base,'/api/flood-report',{url:value})).status,400);
 assert.equal((await post(base,'/api/flood-report',{url,extra:'x'})).status,400);assert.equal(calls,0);
 const response=await post(base,'/api/flood-report',{url});assert.equal(response.status,200);assert.equal((await response.json()).xml,'<Report/>');assert.equal(calls,1);
});
test('warning bulletin verification accepts only official VPWW55 URLs',async t=>{
 let calls=0;const url='https://www.data.jma.go.jp/developer/xml/data/20261102112735_0_VPWW55_150000.xml';
 const base=await fixture(t,{active:false,warningReport:async input=>{calls++;assert.equal(input,url);return {xml:'<Report/>',fetchedAt:'2026-11-04T00:00:00.000Z'}}});
 assert.equal((await post(base,'/api/warning-report',{url},'https://example.test')).status,403);
 for(const value of [url+'?x=1',url.replace('VPWW55','VPWW58'),url.replace('www.data.jma.go.jp','evil.test')])assert.equal((await post(base,'/api/warning-report',{url:value})).status,400);
 assert.equal((await post(base,'/api/warning-report',{url,extra:true})).status,400);assert.equal(calls,0);
 assert.equal((await post(base,'/api/warning-report',{url})).status,200);assert.equal(calls,1);
});

test('expired flood and warning bulletins return an error if upstream refresh fails',async t=>{
 let now=Date.parse('2026-11-04T00:00:00Z'),fail=false,calls=0;
 const options={clock:()=>now,fetcher:async()=>{calls++;if(fail)throw Error('unavailable');return new Response('<Report/>')}};
 const base=await fixture(t,{active:false,floodReport:createJmaReportLoader(options),warningReport:createJmaReportLoader({...options,validator:validJmaWarningReportUrl})});
 const flood='https://www.data.jma.go.jp/developer/xml/data/20251118064500_0_VXKO50_000000.xml';
 const warning='https://www.data.jma.go.jp/developer/xml/data/20261102112735_0_VPWW55_150000.xml';
 for(const [path,url] of [['/api/flood-report',flood],['/api/warning-report',warning]])assert.equal((await post(base,path,{url})).status,200);
 assert.equal(calls,2);now+=60000;fail=true;
 for(const [path,url] of [['/api/flood-report',flood],['/api/warning-report',warning]])assert.equal((await post(base,path,{url})).status,502);
 assert.equal(calls,4);
});

test('optional observed weather passes only fresh allowlisted data and matching reference IDs',async t=>{
 let captured;const base=await fixture(t,{active:true,key:'test',mapConsult:async args=>(captured=args,{density:'dense',ordered_ids:['flood','obstacles','airspace','shelter_open','communications'],cited_ids:['weather-1:observation']})});
 const at=new Date().toISOString(),observation={stationId:'44132',distanceMeters:1000,observedAt:at,retrievedAt:at,rain:0,wind:1.5};
 const {consultEvidenceRefs}=await import('./readiness.mjs');const payload={image:'data:image/png;base64,AA==',supply:null,quantity:null,observation,evidenceRefs:consultEvidenceRefs('weather-1',false,true)};
 assert.equal((await post(base,'/api/map-consult',payload)).status,200);assert.deepEqual(captured.observation,observation);
 assert.equal((await post(base,'/api/map-consult',{...payload,observation:{...observation,address:'private'}})).status,400);
 assert.equal((await post(base,'/api/map-consult',{...payload,observation:{...observation,observedAt:'2000-01-01T00:00:00.000Z'}})).status,400);
 assert.equal((await post(base,'/api/map-consult',{...payload,observation:{...observation,retrievedAt:new Date(Date.parse(at)-60000).toISOString()}})).status,400);
 assert.equal((await post(base,'/api/map-consult',{...payload,evidenceRefs:consultEvidenceRefs('weather-1',false)})).status,400);
 assert.equal((await (await fetch(base+'/api/map-capabilities')).json()).mapConsultObservation,true);
 assert.equal((await (await fetch(base+'/api/map-capabilities')).json()).mapConsultObservationReferenceKind,true);
 assert.equal((await (await fetch(base+'/api/map-capabilities')).json()).mapConsultObservationAccumulatedRain,true);
 assert.equal((await (await fetch(base+'/api/map-capabilities')).json()).mapConsultObservationTotalsOnly,true);
 const withTotals={...observation,rain1h:2.5,rain24h:7};assert.equal((await post(base,'/api/map-consult',{...payload,observation:withTotals})).status,200);assert.deepEqual(captured.observation,withTotals);
 const totalsOnly={...withTotals,rain:null,wind:null};assert.equal((await post(base,'/api/map-consult',{...payload,observation:totalsOnly})).status,200);assert.deepEqual(captured.observation,totalsOnly);
 assert.equal((await post(base,'/api/map-consult',{...payload,observation:{...withTotals,rain1h:-1}})).status,400);
 const v2={...observation,referenceKind:'facility'};
 assert.equal((await post(base,'/api/map-consult',{...payload,observation:v2})).status,200);assert.deepEqual(captured.observation,v2);
 assert.equal((await post(base,'/api/map-consult',{...payload,observation:{...v2,referenceKind:'other'}})).status,400);
});

test('serves the fleet map and engine as javascript on a fresh server',async t=>{
  const base=await fixture(t,{active:false});
  for(const file of ['/fleet-map.mjs','/fleet-engine.mjs']){
    const response=await fetch(base+file);
    assert.equal(response.status,200);
    assert.match(response.headers.get('content-type'),/javascript/);
    assert.match(await response.text(),/export/);
  }
});

test('serves the locally packaged drone model with the correct type',async t=>{
  const base=await fixture(t,{active:false});
  const response=await fetch(base+'/assets/rescue-drone.glb');
  assert.equal(response.status,200);
  assert.match(response.headers.get('content-type'),/model\/gltf-binary/);
  const bytes=new Uint8Array(await response.arrayBuffer());
  assert.deepEqual([...bytes.slice(0,4)],[0x67,0x6c,0x54,0x46]);
});

test('map detour forwards bounded route evidence and rejects unsolicited fields',async t=>{
  let received;const base=await fixture(t,{active:true,key:'test',mapPlan:async args=>(received=args,{sora:'A',nagi:'none'})});
  const evidence={A:{total:3,observed:2,unknown:1,blocked:0,maxGap:20},B:{total:3,observed:3,unknown:0,blocked:1,maxGap:25}};
  const res=await post(base,'/api/map-plan',{image:'data:image/png;base64,AA==',evidence});
  assert.equal(res.status,200);assert.equal((await res.json()).provenance,'unknown');assert.deepEqual(received.evidence,evidence);
  const capabilities=await (await fetch(base+'/api/map-capabilities')).json();assert.equal(capabilities.mapPlanEvidence,true);
  assert.equal((await post(base,'/api/map-plan',{image:'data:image/png;base64,AA==',evidence:{...evidence,address:'secret'}})).status,400);
  assert.equal((await post(base,'/api/map-plan',{image:'data:image/png;base64,AA==',evidence:{...evidence,A:{...evidence.A,observed:99}}})).status,400);
});

test('map detour accepts only the snapshot and rejects extra location fields',async t=>{
  let calls=0;const base=await fixture(t,{active:true,key:'test',mapPlan:async()=>{calls++;return {sora:'A',nagi:'B'}}});
  assert.deepEqual((await (await post(base,'/api/map-plan',{image:'data:image/png;base64,AA=='})).json()).result,{sora:'A',nagi:'B'});
  assert.equal((await post(base,'/api/map-plan',{image:'data:image/png;base64,AA==',latitude:35})).status,400);
  assert.equal((await post(base,'/api/map-plan',{image:'data:image/png;base64,AA=='},'https://example.com')).status,403);assert.equal(calls,1);
});
test('map detour model failure cannot produce a selected route',async t=>{
  const base=await fixture(t,{active:true,key:'test',mapPlan:async()=>{throw new Error('モデルに接続できません')}});
  const res=await post(base,'/api/map-plan',{image:'data:image/png;base64,AA=='});assert.equal(res.status,502);assert.equal((await res.json()).result,undefined);
});

test('map consultation accepts only the image and fixed supply fields',async t=>{
  let calls=0;const base=await fixture(t,{active:true,key:'test',mapConsult:async({supply,quantity})=>{calls++;return {density:'dense',ordered_ids:['flood','shelter_open','obstacles','airspace','communications'],supply,quantity}}});
  const data={image:'data:image/png;base64,AA==',supply:'water',quantity:12};
  assert.equal((await post(base,'/api/map-consult',data)).status,200);
  assert.equal((await post(base,'/api/map-consult',{...data,address:'private'})).status,400);
  assert.equal((await post(base,'/api/map-consult',{...data,quantity:1.5})).status,400);
  assert.equal(calls,1);
});
test('map consultation accepts only a recognized flood category and advertises support',async t=>{
  let received;const base=await fixture(t,{active:true,key:'test',mapConsult:async args=>(received=args,{density:'dense',ordered_ids:['flood','shelter_open','obstacles','airspace','communications']})});
  assert.equal((await (await fetch(base+'/api/map-capabilities')).json()).mapFloodContext,true);
  const data={image:'data:image/png;base64,AA==',supply:null,quantity:null,flood:'3.0〜5.0m'};
  assert.equal((await post(base,'/api/map-consult',data)).status,200);assert.equal(received.flood,'3.0〜5.0m');
  assert.equal((await post(base,'/api/map-consult',{...data,flood:'安全'})).status,400);
  assert.equal((await post(base,'/api/map-consult',{...data,address:'東京都'})).status,400);
});
test('map consultation rejects a foreign origin and does not turn provider failure into success',async t=>{
  let calls=0;const base=await fixture(t,{active:true,mapConsult:async()=>{calls++;throw new Error('モデルに接続できません')}});
  const data={image:'data:image/png;base64,AA==',supply:null,quantity:null};
  assert.equal((await post(base,'/api/map-consult',data,'https://example.com')).status,403);assert.equal(calls,0);
  const failed=await post(base,'/api/map-consult',data);assert.equal(failed.status,502);assert.equal((await failed.json()).result,undefined);assert.equal(calls,1);
});

test('map checklist sends only approved IDs and rejects location fields',async t=>{
  let calls=0;const base=await fixture(t,{active:true,key:'test',review:async({ids})=>{calls++;return ids.slice().reverse()}});
  const good=await post(base,'/api/review',{ids:['flood','airspace']});assert.equal(good.status,200);assert.deepEqual((await good.json()).result,['airspace','flood']);
  const bad=await post(base,'/api/review',{ids:['flood'],latitude:35});assert.equal(bad.status,400);assert.equal(calls,1);
});

test('serves only the selected city model and its renderer modules',async t=>{
  const base=await fixture(t,{active:false});
  for(const p of ['/vendor/addons/loaders/GLTFLoader.js','/vendor/addons/loaders/HDRLoader.js','/vendor/addons/utils/BufferGeometryUtils.js','/assets/urban/facade.gltf','/assets/urban/modular_urban_apartments_facade.bin','/assets/overcast.hdr'])assert.equal((await fetch(base+p)).status,200,p);
  assert.equal((await fetch(base+'/assets/urban/private.txt')).status,404);
});

test('serves the Cesium map runtime without exposing project files',async t=>{
  const base=await fixture(t,{active:false});
  assert.equal((await fetch(base+'/cesium/Cesium.js')).status,200);
  assert.equal((await fetch(base+'/cesium/Widgets/widgets.css')).status,200);
  assert.equal((await fetch(base+'/cesium/.env')).status,404);
  assert.equal((await fetch(base+'/cesium/%2e%2e/server.mjs')).status,404);
});

test('disabled mode refuses API calls and does not invoke providers',async t=>{
  let invoked=false;const base=await fixture(t,{active:false,plan:async()=>{invoked=true}});
  assert.deepEqual(await (await fetch(base+'/api/status')).json(),{enabled:false});
  const response=await post(base,'/api/plan',{image:'data:image/png;base64,AA==',command:'届けて'});
  assert.equal(response.status,503);assert.equal(invoked,false);
});
test('rejects calls from another origin before the provider is invoked',async t=>{
  let invoked=false;const base=await fixture(t,{active:true,plan:async()=>{invoked=true}});
  const response=await post(base,'/api/plan',{},'https://example.com');
  assert.equal(response.status,403);assert.equal(invoked,false);
});
test('forwards the image, command and incident to a local test provider',async t=>{
  let received;const base=await fixture(t,{active:true,key:'test',plan:async data=>{received=data;return {route:'east',sora:'観察',nagi:'迂回'}}});
  const response=await post(base,'/api/plan',{image:'data:image/png;base64,AA==',command:'水を届けて',hazard:true,samCount:0});
  assert.equal(response.status,200);assert.equal((await response.json()).result.route,'east');
  assert.equal(received.command,'水を届けて');assert.equal(received.hazard,true);assert.equal(received.samCount,0);
});
test('failed planning stays an error and never returns a successful route',async t=>{
  const base=await fixture(t,{active:true,key:'test',plan:async()=>{throw new Error('モデルが利用できません')}});
  const response=await post(base,'/api/plan',{image:'data:image/png;base64,AA==',command:'届けて'});
  const result=await response.json();assert.equal(response.status,502);assert.equal(result.result,undefined);
});
test('voice, segment, review and planning errors never expose provider details',async t=>{
  const secret='fixture-internal-sensitive-value-not-a-key',fail=async()=>{throw new Error(`provider failure ${secret}`)};
  const base=await fixture(t,{active:true,key:'test',plan:fail,segment:fail,transcribe:fail,review:fail});
  for(const [route,data] of [['plan',{image:'data:image/png;base64,AA==',command:'依頼'}],['segment',{image:'data:image/png;base64,AA=='}],['transcribe',{wav:'AA=='}],['review',{ids:['flood']}]]){
    const response=await post(base,`/api/${route}`,data);assert.equal(response.status,502);
    const body=await response.text();assert.doesNotMatch(body,/fixture-internal-sensitive-value-not-a-key|provider failure/);assert.match(body,/Muse/);assert.doesNotMatch(body,/"result"/);
  }
});
test('streaming plan sends a generic error after an observation and never returns a result',async t=>{
  const base=await fixture(t,{active:true,key:'test',plan:async({onSora})=>{onSora('初案');throw new Error('fixture-internal-sensitive-value-not-a-key')}});
  const response=await fetch(base+'/api/plan',{method:'POST',headers:{Origin:base,'Content-Type':'application/json',Accept:'application/x-ndjson'},body:JSON.stringify({image:'data:image/png;base64,AA==',command:'依頼'})});
  const body=await response.text();assert.match(body,/"type":"sora"/);assert.match(body,/"type":"error"/);assert.match(body,/Muse/);assert.doesNotMatch(body,/fixture-internal-sensitive-value-not-a-key|"type":"result"/);
});
test('invalid voice, image, review and plan inputs are rejected before provider invocation',async t=>{
  let calls=0;const fail=async()=>{calls++;throw new Error('unexpected provider call')};
  const base=await fixture(t,{active:true,key:'test',plan:fail,segment:fail,transcribe:fail,review:fail});
  for(const route of ['plan','segment','transcribe','review']){const response=await post(base,`/api/${route}`,{});assert.equal(response.status,400);assert.match((await response.json()).error,/入力/)}
  assert.equal(calls,0);
});
test('streams the observation before the final plan is ready',async t=>{
  let finish;const gate=new Promise(resolve=>{finish=resolve});
  const base=await fixture(t,{active:true,key:'test',plan:async({onSora})=>{onSora('障害を確認');await gate;return {route:'east',sora:'障害を確認',nagi:'東を選択'}}});
  const response=await fetch(base+'/api/plan',{method:'POST',headers:{Origin:base,'Content-Type':'application/json',Accept:'application/x-ndjson'},body:JSON.stringify({image:'data:image/png;base64,AA==',command:'届けて',hazard:true})});
  const reader=response.body.getReader();const first=await reader.read();assert.match(new TextDecoder().decode(first.value),/障害を確認/);
  finish();let remaining='';for(;;){const chunk=await reader.read();if(chunk.done)break;remaining+=new TextDecoder().decode(chunk.value)}
  assert.match(remaining,/"type":"result"/);assert.match(remaining,/east/);
});
test('stream reports a failed review instead of a final plan',async t=>{
  const base=await fixture(t,{active:true,key:'test',plan:async({onSora})=>{onSora('初案');throw new Error('確認失敗')}});
  const response=await fetch(base+'/api/plan',{method:'POST',headers:{Origin:base,'Content-Type':'application/json',Accept:'application/x-ndjson'},body:JSON.stringify({image:'data:image/png;base64,AA==',command:'届けて'})});
  const result=await response.text();assert.match(result,/"type":"sora"/);assert.match(result,/"type":"error"/);assert.doesNotMatch(result,/"type":"result"/);
});
test('an incomplete review reaches the client as an error after the observation',async t=>{
  let calls=0;
  const fakeMeta=async()=>({ok:true,json:async()=>{
    calls++;
    const text=calls===1?'{"route":"direct","sora":"街を確認"}':'{"route":"direct","nagi":"出発"}';
    return {status:calls===1?'completed':'incomplete',output:[{content:[{type:'output_text',text}]}]};
  }});
  const base=await fixture(t,{active:true,key:'test',plan:args=>planWithMuse(args,fakeMeta)});
  const response=await fetch(base+'/api/plan',{method:'POST',headers:{Origin:base,'Content-Type':'application/json',Accept:'application/x-ndjson'},body:JSON.stringify({image:'data:image/png;base64,AA==',command:'届けて'})});
  const observations=[];
  await assert.rejects(readPlanStream(response,text=>observations.push(text)),/Museとの通信または回答を確認できません/);
  assert.deepEqual(observations,['街を確認']);assert.equal(calls,2);
});
test('disconnecting during a streamed plan cancels the provider',async t=>{
  let cancelled;const ended=new Promise(resolve=>{cancelled=resolve});
  const base=await fixture(t,{active:true,key:'test',plan:async({onSora,signal})=>{onSora('初案');await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));cancelled();throw new Error('cancelled')}});
  const controller=new AbortController();
  const response=await fetch(base+'/api/plan',{method:'POST',signal:controller.signal,headers:{Origin:base,'Content-Type':'application/json',Accept:'application/x-ndjson'},body:JSON.stringify({image:'data:image/png;base64,AA==',command:'届けて'})});
  await response.body.getReader().read();controller.abort();
  await Promise.race([ended,new Promise((_,reject)=>setTimeout(()=>reject(new Error('provider was not cancelled')),1000))]);
});
test('disconnecting while transcribing cancels the provider',async t=>{
  let started, cancelled;const ready=new Promise(resolve=>{started=resolve}),ended=new Promise(resolve=>{cancelled=resolve});
  const base=await fixture(t,{active:true,key:'test',transcribe:async({signal})=>{started();await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));cancelled();throw new Error('cancelled')}});
  const controller=new AbortController();
  const request=fetch(base+'/api/transcribe',{method:'POST',signal:controller.signal,headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({wav:'AA=='})}).catch(()=>{});
  await ready;controller.abort();await request;
  await Promise.race([ended,new Promise((_,reject)=>setTimeout(()=>reject(new Error('provider was not cancelled')),1000))]);
});

test('local simulated voice-to-replan flow carries the actual outputs between stages',async t=>{
  const calls=[];
  const fakeMeta=async(url,options)=>{
    if(url.endsWith('/asr/transcribe')){calls.push('voice');return {ok:true,json:async()=>({transcript:'水を届けて',turns:[]})}}
    const body=JSON.parse(options.body);calls.push(body.model);
    const field=body.text?.format?.name;
    const output=body.model==='sam-3.1'?'<0f>0<|box;x1=1;y1=2;x2=30;y2=40;w=100;h=100|>':
      field==='mission_sora'?JSON.stringify({route:calls.includes('sam-3.1')?'west':'direct',sora:'街を確認'}):
        JSON.stringify({route:calls.includes('sam-3.1')?'east':'direct',nagi:'作戦を決定'});
    if(body.model==='sam-3.1')return new Response(`data: ${JSON.stringify({type:'response.output_text.delta',delta:output})}\n\ndata: ${JSON.stringify({type:'response.completed',response:{status:'completed'}})}\n\n`,{headers:{'Content-Type':'text/event-stream'}});
    return {ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:output}]}]})};
  };
  const base=await fixture(t,{active:true,key:'test',plan:args=>planWithMuse(args,fakeMeta),segment:args=>segmentWithSam(args,fakeMeta),transcribe:args=>transcribeWithMuse(args,fakeMeta)});
  const command=(await (await post(base,'/api/transcribe',{wav:'AA=='})).json()).result;
  async function plan(hazard,samCount){
    const response=await fetch(base+'/api/plan',{method:'POST',headers:{Origin:base,'Content-Type':'application/json',Accept:'application/x-ndjson'},body:JSON.stringify({command,image:'data:image/png;base64,AA==',hazard,samCount})});
    return readPlanStream(response,()=>{});
  }
  assert.equal((await plan(false)).route,'direct');
  const detected=(await (await post(base,'/api/segment',{image:'data:image/png;base64,AA=='})).json()).result;
  assert.equal(detected.length,1);assert.equal((await plan(true,detected.length)).route,'east');
  assert.deepEqual(calls,['voice','muse-spark-1.3','muse-spark-1.3','sam-3.1','muse-spark-1.3','muse-spark-1.3']);
});

test('map consultation verifies cited IDs and rejects references not bound to supplied input',async t=>{
 const refs=[{id:'req-1:image',kind:'image'},{id:'req-1:supplies',kind:'supplies'},{id:'req-1:flood',kind:'flood'}];let called=0;
 const base=await fixture(t,{active:true,key:'test',mapConsult:async args=>{called++;return {density:'dense',ordered_ids:['flood','obstacles','airspace','shelter_open','communications'],cited_ids:args.evidenceRefs.map(x=>x.id)}}});
 assert.equal((await (await fetch(base+'/api/map-capabilities')).json()).mapConsultRefs,true);
 const input={image:'data:image/png;base64,AA==',supply:'water',quantity:1,flood:null,evidenceRefs:refs};assert.equal((await post(base,'/api/map-consult',input)).status,200);assert.equal(called,1);
 assert.equal((await post(base,'/api/map-consult',{...input,evidenceRefs:[...refs.slice(0,2),{id:'other:flood',kind:'flood'}]})).status,400);assert.equal(called,1);
});
test('map consultation rejects model citations that were not sent',async t=>{
 const refs=[{id:'req-1:image',kind:'image'},{id:'req-1:supplies',kind:'supplies'}];const base=await fixture(t,{active:true,key:'test',mapConsult:async()=>({density:'dense',ordered_ids:['flood','obstacles','airspace','shelter_open','communications'],cited_ids:['forged']})});
 assert.equal((await post(base,'/api/map-consult',{image:'data:image/png;base64,AA==',supply:null,quantity:null,evidenceRefs:refs})).status,502);
});
