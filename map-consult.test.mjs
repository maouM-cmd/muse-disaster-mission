import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createMapConsultation} from './readiness.mjs';
import * as readiness from './readiness.mjs';

test('input rejection is presented separately from a model failure',async()=>{
 let status,shown,category;const error=Object.assign(new Error('入力と期限を確認してください'),{code:'input_rejected'});
 const c=createMapConsultation({capture:()=>({image:'image',view:1}),current:()=>true,request:async()=>{throw error},onStatus:(s,_busy,reason)=>{status=s;category=reason},onResult:value=>shown=value});await c.run();assert.equal(shown,null);assert.equal(category,'input_rejected');assert.match(status,/サーバーが入力を受け付けませんでした/);assert.doesNotMatch(status,/Museの相談に失敗/);
});
test('an observation that expires before sending is reported as a pre-send cancellation',async()=>{
 let status,category;const error=Object.assign(new Error('観測情報を再確認してください'),{code:'observation_changed_before_send'});
 const c=createMapConsultation({capture:()=>({image:'image',view:1}),current:()=>true,request:async()=>{throw error},onStatus:(s,_busy,reason)=>{status=s;category=reason},onResult:()=>{}});await c.run();assert.equal(category,'observation_changed_before_send');assert.match(status,/送信前/);assert.doesNotMatch(status,/Museの相談に失敗|サーバーが入力/);
});
test('other changed inputs before sending are reported without blaming the provider',async()=>{
 let status,category;const error=Object.assign(new Error('再確認'),{code:'information_changed_before_send'});const c=createMapConsultation({capture:()=>({image:'image',view:1}),current:()=>true,request:async()=>{throw error},onStatus:(s,_busy,reason)=>{status=s;category=reason},onResult:()=>{}});await c.run();assert.equal(category,'information_changed_before_send');assert.match(status,/送信前に情報が変わった/);assert.doesNotMatch(status,/Museの相談に失敗|サーバーが入力/);
});

test('only the current facility verified flood category is prepared for sending',()=>{
  assert.equal(typeof readiness.mapFloodContext,'function');
  const value={shelter:'原中学校',address:'公開住所',state:'ready',depth:'3.0〜5.0m'};
  assert.equal(readiness.mapFloodContext(value,'原中学校','公開住所'),'3.0〜5.0m');
  assert.equal(readiness.mapFloodContext(value,'別の施設','公開住所'),null);
  assert.equal(readiness.mapFloodContext({...value,state:'error'},'原中学校','公開住所'),null);
  assert.equal(readiness.mapFloodContext({...value,depth:'安全'},'原中学校','公開住所'),null);
});

const result={density:'dense',ordered_ids:['flood','shelter_open','obstacles','airspace','communications']};
test('the two role results are derived from validated model output',async()=>{
  let shown;const statuses=[];
  const c=createMapConsultation({capture:()=>({image:'image',view:1}),current:()=>true,request:async()=>result,onStatus:s=>statuses.push(s),onResult:value=>{shown=value}});
  await c.run();assert.match(shown.sora,/建物/);assert.equal(shown.nagi.length,5);assert.match(statuses.at(-1),/飛行/);
});
test('a change of view cancels the request and prevents stale consultation',async()=>{
  let finish,signal,shown='none';
  const c=createMapConsultation({capture:()=>({image:'image',view:1}),current:()=>true,request:(_image,s)=>{signal=s;return new Promise(resolve=>finish=resolve)},onStatus(){},onResult:value=>{shown=value}});
  const running=c.run();c.invalidate();assert.equal(signal.aborted,true);finish(result);await running;assert.equal(shown,null);
});
test('bad model output is displayed as an error, not advice',async()=>{
  let status,shown;
  const c=createMapConsultation({capture:()=>({image:'image',view:1}),current:()=>true,request:async()=>({...result,density:'safe'}),onStatus:s=>{status=s},onResult:value=>{shown=value}});
  await c.run();assert.equal(shown,null);assert.match(status,/失敗/);
});
test('a view changed without a movement event still discards the response',async()=>{
  let status,shown;
  const c=createMapConsultation({capture:()=>({image:'image',view:1}),current:()=>false,request:async()=>result,onStatus:s=>{status=s},onResult:value=>{shown=value}});
  await c.run();assert.equal(shown,null);assert.match(status,/変わった/);
});


test('consultation history keeps the exact sent fields and local facility context',()=>{
  const sent={supply:'water',quantity:12,flood:'3.0〜5.0m'};
  const saved=readiness.mapConsultHistoryContext({area:'荒川区',shelter:'原中学校',address:'公開住所',time:'10:00',payload:sent});
  sent.supply='food';sent.flood=null;
  assert.deepEqual(saved,{area:'荒川区',shelter:'原中学校',address:'公開住所',time:'10:00',supply:'飲料水',quantity:12,flood:'3.0〜5.0m',floodSent:true});
});
test('consultation history distinguishes unknown flood from a server that did not send it',()=>{
  const unknown=readiness.mapConsultHistoryContext({payload:{supply:null,quantity:null,flood:null}});
  const legacy=readiness.mapConsultHistoryContext({payload:{supply:null,quantity:null}});
  assert.equal(unknown.floodSent,true);assert.equal(unknown.flood,null);
  assert.equal(legacy.floodSent,false);assert.equal(legacy.flood,null);
});

test('accepted current reply exposes the actual structured response for the local audit',async()=>{
 let raw;
 const c=createMapConsultation({capture:()=>({image:'image',view:1}),current:()=>true,request:async()=>result,onStatus(){},onResult:(_description,model)=>{if(model)raw=model}});
 await c.run();assert.deepEqual(raw,result);
});
