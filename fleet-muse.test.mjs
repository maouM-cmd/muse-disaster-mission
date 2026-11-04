import {test} from 'node:test';
import assert from 'node:assert/strict';
import {planFleetWithMuse,validFleetEvidence} from './meta.mjs';
import {createServer} from './server.mjs';

const candidate={routes:20,total:40,observed:40,unknown:0,blocked:0,maxGap:20,avoidsHazard:true};
const evidence={affected:20,unaffected:80,candidates:{A:{...candidate},B:{...candidate}}};
const representative={total:2,observed:2,unknown:0,blocked:0,maxGap:20};
const evidenceV2={...evidence,representatives:{A:{...representative},B:{...representative}}};
const distance={routes:20,outboundM:1000,returnM:1200,totalM:2200,representative:{outboundM:50,returnM:60,totalM:110}};
const evidenceV3={...evidenceV2,distances:{A:{...distance},B:{...distance}}};
const image='data:image/png;base64,AA==';
const response=value=>({ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(value)}]}]})});

test('Muse compares two bounded shared summaries and returns its own reasons',async()=>{
  const bodies=[];
  const result=await planFleetWithMuse({key:'test-key',image,evidence},async(_url,options)=>{
    bodies.push(JSON.parse(options.body));
    return response(bodies.length===1?{choice:'A',reason:'候補Aを確認'}:{choice:'B',reason:'候補Bを比較'});
  });
  assert.equal(bodies.length,2);
  assert.equal(bodies[0].model,'muse-spark-1.3');
  assert.match(bodies[0].input[0].content[0].text,/仮想区域/);
  assert.match(bodies[0].input[0].content[0].text,/仮想配送だけ/);
  assert.match(bodies[0].input[0].content[0].text,/距離は未計測/);
  assert.match(bodies[0].input[0].content[0].text,/none/);
  assert.deepEqual(result,{sora:{choice:'A',reason:'候補Aを確認'},nagi:{choice:'B',reason:'候補Bを比較'}});
});

test('malformed or unsolicited evidence and responses are rejected',async()=>{
  assert.equal(validFleetEvidence(evidence),true);
  assert.equal(validFleetEvidence(evidenceV2),true);
  assert.equal(validFleetEvidence(evidenceV3),true);
  assert.equal(validFleetEvidence({...evidenceV3,distances:{A:{...distance,totalM:-1},B:distance}}),false);
  assert.equal(validFleetEvidence({...evidenceV3,distances:{A:{...distance,routes:19},B:distance}}),false);
  assert.equal(validFleetEvidence({...evidenceV3,distances:{A:{...distance,totalM:1},B:distance}}),false);
  assert.equal(validFleetEvidence({...evidenceV3,distances:{A:null,B:distance}}),true);
  assert.equal(validFleetEvidence({...evidenceV2,representatives:{A:{...representative,observed:3},B:representative}}),false);
  assert.equal(validFleetEvidence({...evidenceV2,representatives:{A:{...representative,total:500,observed:500},B:representative}}),false);
  assert.equal(validFleetEvidence({...evidence,latitude:35}),false);
  assert.equal(validFleetEvidence({...evidence,candidates:{...evidence.candidates,A:{...candidate,unknown:1}}}),false);
  await assert.rejects(planFleetWithMuse({key:'x',image,evidence},async()=>response({choice:'C',reason:'bad'})),/不正/);
  await assert.rejects(planFleetWithMuse({key:'x',image,evidence},async()=>response({choice:'A',reason:'  '})),/不正/);
});

test('sends representative route observations separately from fleet-wide totals',async()=>{
  const bodies=[];
  await planFleetWithMuse({key:'test',image,evidence:evidenceV2},async(_url,options)=>{
    bodies.push(JSON.parse(options.body));return response({choice:'A',reason:'点検情報を比較'});
  });
  const prompt=bodies[0].input[0].content[0].text;
  assert.match(prompt,/代表機/);
  assert.match(prompt,/全機/);
  assert.match(prompt,/representatives/);
});

test('sends measured ground distance separately and never ranks by sample counts',async()=>{
  const bodies=[];
  await planFleetWithMuse({key:'test',image,evidence:evidenceV3},async(_url,options)=>{
    bodies.push(JSON.parse(options.body));return response({choice:'A',reason:'仮想候補を比較'});
  });
  const prompt=bodies[0].input[0].content[0].text;
  assert.match(prompt,/概算地表距離/);
  assert.match(prompt,/点検点数.*優劣/);
  assert.match(prompt,/distances/);
});

test('one Meta request timing out is distinguishable from cancellation',async()=>{
  const original=AbortSignal.timeout;
  try{
    AbortSignal.timeout=()=>AbortSignal.abort(new DOMException('timeout','TimeoutError'));
    await assert.rejects(planFleetWithMuse({key:'test',image,evidence},async(_url,options)=>{
      options.signal.throwIfAborted();
    }),/Meta API.*60秒/);
  }finally{AbortSignal.timeout=original}
});

test('fleet endpoint enforces origin, connection and exact payload',async t=>{
  let calls=0;
  const server=createServer({active:true,key:'test',fleetPlanProvenance:'fixture',fleetPlan:async()=>{calls++;return {sora:{choice:'A',reason:'x'},nagi:{choice:'A',reason:'y'}}}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base='http://127.0.0.1:'+server.address().port;
  const post=(data,origin=base)=>fetch(base+'/api/fleet-plan',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify(data)});
  const reply=await post({image,evidence});assert.equal(reply.status,200);assert.equal((await reply.json()).provenance,'fixture');
  const wrapped=createServer({active:true,key:'test',fleetPlan:async()=>({sora:{choice:'A',reason:'x'},nagi:{choice:'A',reason:'y'}})});
  await new Promise(resolve=>wrapped.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>wrapped.close(resolve)));
  const wrappedBase='http://127.0.0.1:'+wrapped.address().port;
  const wrappedReply=await fetch(wrappedBase+'/api/fleet-plan',{method:'POST',headers:{'Content-Type':'application/json',Origin:wrappedBase},body:JSON.stringify({image,evidence})});
  assert.equal(wrappedReply.status,200);assert.equal((await wrappedReply.json()).provenance,'unknown');
  assert.equal((await post({image,evidence:evidenceV3})).status,200);
  assert.equal((await fetch(base+'/fleet-distance.mjs')).status,200);
  assert.equal((await post({image,evidence,address:'secret'})).status,400);
  assert.equal((await post({image,evidence},'https://example.com')).status,403);
  assert.equal(calls,2);
});
