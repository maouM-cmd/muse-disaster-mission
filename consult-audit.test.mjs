import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createConsultAudit, finishConsultAudit,finishUncertainConsultAudit,appendConsultAudit,removeConsultAudit,mergeLocalHistories,recordConsultReview,decodeConsultAudits,consultImageDigest} from './readiness.mjs';

const time='2026-11-03T10:00:00.000Z';
const selection={shelter:'原中学校',address:'東京',state:'ready',depth:'3.0〜5.0m',checkedAt:time};
const input={id:'request-1',capturedAt:time,area:'13118',payload:{image:'data:image/png;base64,xxx',supply:'water',quantity:12,flood:'3.0〜5.0m'},flood:selection,shelter:'原中学校',address:'東京'};
const model={density:'dense',ordered_ids:['flood','obstacles','airspace','shelter_open','communications']};
test('response provenance survives saved audit without changing legacy history',()=>{
 const pending=createConsultAudit(input),legacy=finishConsultAudit(pending,model,time);
 assert.equal(Object.hasOwn(legacy,'responseProvenance'),false);
 for(const source of ['muse','fixture','unknown']){
  const record=finishConsultAudit(pending,model,time,source);assert.equal(record.responseProvenance,source);
  const raw=appendConsultAudit(null,record),restored=decodeConsultAudits(raw).records[0];assert.equal(restored.responseProvenance,source);
  const reviewed=recordConsultReview(raw,restored,'hold','2026-11-03T10:01:00.000Z');assert.equal(decodeConsultAudits(reviewed).records[0].responseProvenance,source);
 }
 assert.throws(()=>finishConsultAudit(pending,model,time,'forged'));
 assert.equal(decodeConsultAudits(JSON.stringify([{...legacy,responseProvenance:'forged'}])).status,'corrupt');
 assert.equal(decodeConsultAudits(JSON.stringify([{...finishUncertainConsultAudit(pending,time),responseProvenance:'muse'}])).status,'corrupt');
});
test('uncertain consultation records preserve only known failure categories and retain old records',()=>{
 const sent=createConsultAudit(input),old=finishUncertainConsultAudit(sent,time),rejected=finishUncertainConsultAudit(sent,time,'input_rejected');
 assert.equal(Object.hasOwn(old,'failureClass'),false);assert.equal(decodeConsultAudits(JSON.stringify([old])).status,'ok');assert.equal(rejected.failureClass,'input_rejected');assert.deepEqual(decodeConsultAudits(JSON.stringify([rejected])).records[0],rejected);assert.throws(()=>finishUncertainConsultAudit(sent,time,'invented'));assert.equal(decodeConsultAudits(JSON.stringify([{...rejected,failureClass:'invented'}])).status,'corrupt');
 const stored=appendConsultAudit(null,rejected),restored=decodeConsultAudits(stored).records[0];assert.equal(removeConsultAudit(stored,restored),'[]');
 const success=finishConsultAudit(sent,model,time);assert.equal(decodeConsultAudits(JSON.stringify([{...success,failureClass:'input_rejected'}])).status,'corrupt');
});
test('the exact sent PNG bytes can be fingerprinted without storing image data',async()=>{
 const digest=await consultImageDigest('data:image/png;base64,YWJj');assert.equal(digest,'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
 assert.equal(await consultImageDigest('data:image/png;base64,YWJj',null),null);
 assert.equal(await consultImageDigest('data:image/jpeg;base64,YWJj'),null);
 const done=finishConsultAudit(createConsultAudit({...input,imageHash:digest}),model,time);
 assert.equal(done.inputs[0].sha256,digest);assert.equal(decodeConsultAudits(JSON.stringify([done])).records[0].inputs[0].sha256,digest);
 assert.equal(JSON.stringify(done).includes('base64'),false);
 const damaged=structuredClone(done);damaged.inputs[0].sha256='not-a-hash';assert.equal(decodeConsultAudits(JSON.stringify([damaged])).status,'corrupt');
 const unavailable=finishConsultAudit(createConsultAudit({...input,imageHash:null}),model,time);assert.equal(decodeConsultAudits(JSON.stringify([unavailable])).records[0].inputs[0].sha256,null);
});
test('consultation audit records the exact sent categories, source and time without persisting the image',()=>{
 const audit=createConsultAudit(input);assert.equal(audit.requestId,'request-1');
 assert.equal(audit.inputs.find(x=>x.kind==='flood').value,'3.0〜5.0m');
 assert.equal(audit.inputs.find(x=>x.kind==='flood').retrievedAt,time);
 assert.equal(audit.inputs.find(x=>x.kind==='flood').observedAt,null);
 assert.match(audit.inputs.find(x=>x.kind==='flood').source,/disaportal\.gsi\.go\.jp/);
 assert.equal(JSON.stringify(audit).includes('base64'),false);
 assert.ok(audit.inputs.every(x=>x.id.startsWith('request-1:')));
});
test('unavailable or mismatched flood data is never assigned a source or sent as known',()=>{
 assert.throws(()=>createConsultAudit({...input,address:'別住所'}));
 const audit=createConsultAudit({...input,payload:{...input.payload,flood:null}});
 assert.equal(audit.inputs.find(x=>x.kind==='flood').value,null);
 assert.equal(audit.inputs.find(x=>x.kind==='flood').observedAt,null);
 const old=createConsultAudit({...input,payload:{image:'x',supply:null,quantity:null}});
 assert.equal(old.inputs.some(x=>x.kind==='flood'),false);
});
test('only schema-validated output can complete the audit, with a detached raw response',()=>{
 const audit=createConsultAudit(input),completed=finishConsultAudit(audit,model,time);
 assert.equal(completed.output.density,'dense');assert.deepEqual(completed.output.ordered_ids,model.ordered_ids);
 assert.notEqual(completed.output.ordered_ids,model.ordered_ids);
 assert.equal(completed.status,'received');assert.equal(audit.status,'sent');
 assert.throws(()=>finishConsultAudit(audit,{...model,density:'safe'},time));
});

test('local audit history is validated and never restores arbitrary content as evidence',async()=>{
 const {decodeConsultAudits}=await import('./readiness.mjs');
 const finished=finishConsultAudit(createConsultAudit(input),model,time);
 assert.deepEqual(decodeConsultAudits(JSON.stringify([finished])).records,[finished]);
 assert.equal(decodeConsultAudits(null).status,'ok');
 assert.equal(decodeConsultAudits('not json').status,'corrupt');
 const tampered=structuredClone(finished);tampered.inputs[2].source='https://example.com';
 assert.equal(decodeConsultAudits(JSON.stringify([tampered])).status,'corrupt');
 assert.equal(decodeConsultAudits(JSON.stringify([finished,finished])).status,'corrupt');
});

test('timestamps must be explicit strings; missing or fabricated values are not accepted',async()=>{
 const {decodeConsultAudits}=await import('./readiness.mjs');
 const entry=finishConsultAudit(createConsultAudit(input),model,time);
 assert.equal(decodeConsultAudits(JSON.stringify([{...entry,capturedAt:0}])).status,'corrupt');
 assert.throws(()=>createConsultAudit({...input,capturedAt:0}));
});

test('saved consultations preserve older records, reject overflow and reject changed IDs on deletion',()=>{
 const make=i=>finishConsultAudit(createConsultAudit({...input,id:`request-${i}`}),model,time);
 let raw=null;for(let i=0;i<20;i++)raw=appendConsultAudit(raw,make(i));
 assert.equal(JSON.parse(raw).length,20);assert.throws(()=>appendConsultAudit(raw,make(21)),/20/);assert.equal(JSON.parse(raw).length,20);
 const target=make(5);const altered={...target,output:{...target.output,density:'sparse'}};
 assert.throws(()=>removeConsultAudit(raw,altered));const removed=JSON.parse(removeConsultAudit(raw,target));assert.equal(removed.length,19);assert.equal(removed.some(x=>x.requestId===target.requestId),false);
 assert.throws(()=>appendConsultAudit('invalid',make(21)));
});

test('conflicting consultation copies merge without discarding records or overwriting the same ID',()=>{
 const make=i=>finishConsultAudit(createConsultAudit({...input,id:`request-${i}`}),model,time);
 const a=make(1),b=make(2),key='muse-map-consult-audits-v1';
 const merged=mergeLocalHistories(key,JSON.stringify([a]),JSON.stringify([b]));assert.equal(merged.mode,'merge');assert.equal(JSON.parse(merged.value).length,2);
 assert.equal(mergeLocalHistories(key,JSON.stringify([a]),JSON.stringify([{...a,output:{...a.output,density:'sparse'}}])).mode,'id_conflict');
});

test('retry is idempotent only for the identical audit, including when storage is full',()=>{
 const make=i=>finishConsultAudit(createConsultAudit({...input,id:`request-${i}`}),model,time);let raw=null;
 for(let i=0;i<20;i++)raw=appendConsultAudit(raw,make(i));
 assert.equal(appendConsultAudit(raw,make(5)),raw);
 assert.throws(()=>appendConsultAudit(raw,{...make(5),output:{...make(5).output,density:'sparse'}}),/相談ID/);
});
test('human reviews are separate, append-only and reject stale or invalid updates',()=>{
 const audit=finishConsultAudit(createConsultAudit(input),model,time),raw=appendConsultAudit(null,audit);
 const first=recordConsultReview(raw,audit,'consider','2026-11-03T10:01:00.000Z'),reviewed=decodeConsultAudits(first).records[0];
 assert.deepEqual(reviewed.reviews,[{choice:'consider',at:'2026-11-03T10:01:00.000Z'}]);assert.deepEqual(reviewed.output,audit.output);
 assert.throws(()=>recordConsultReview(first,audit,'reject','2026-11-03T10:02:00.000Z'));
 assert.throws(()=>recordConsultReview(first,reviewed,'safe','2026-11-03T10:02:00.000Z'));
 assert.throws(()=>recordConsultReview(first,reviewed,'hold','2026-11-03T09:59:00.000Z'));
 const second=recordConsultReview(first,reviewed,'hold','2026-11-03T10:02:00.000Z');assert.deepEqual(decodeConsultAudits(second).records[0].reviews.map(x=>x.choice),['consider','hold']);
 const tampered=JSON.parse(second);tampered[0].reviews[0].choice='safe';assert.equal(decodeConsultAudits(JSON.stringify(tampered)).status,'corrupt');
});

test('a human decision can retain a local reason and note without modifying the Muse response',()=>{
 const audit=finishConsultAudit(createConsultAudit(input),model,time),raw=appendConsultAudit(null,audit);
 const saved=recordConsultReview(raw,audit,'hold','2026-11-03T10:01:00.000Z',{reason:'missing_data',note:'  電線が未確認  '});
 const restored=decodeConsultAudits(saved).records[0];
 assert.deepEqual(restored.reviews,[{choice:'hold',at:'2026-11-03T10:01:00.000Z',reason:'missing_data',note:'電線が未確認'}]);
 assert.deepEqual(restored.output,audit.output);
 assert.throws(()=>recordConsultReview(raw,audit,'hold','2026-11-03T10:01:00.000Z',{reason:'unsafe',note:''}));
 assert.throws(()=>recordConsultReview(raw,audit,'hold','2026-11-03T10:01:00.000Z',{reason:'missing_data',note:'x'.repeat(201)}));
 const tampered=JSON.parse(saved);tampered[0].reviews[0].reason='unsafe';assert.equal(decodeConsultAudits(JSON.stringify(tampered)).status,'corrupt');
});
