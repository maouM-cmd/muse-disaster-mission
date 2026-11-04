import test from 'node:test';import assert from 'node:assert/strict';
import {consultEvidenceRefs,validateConsultEvidenceRefs,validateConsultCitations,createConsultAudit,finishConsultAudit,decodeConsultAudits} from './readiness.mjs';
import {consultMapWithMuse} from './meta.mjs';
const refs=consultEvidenceRefs('req-1',true),input={key:'test',image:'data:image/png;base64,AA==',supply:'water',quantity:1,flood:'0.5m未満',evidenceRefs:refs};
test('reference IDs are bound to one request and exactly the supplied kinds',()=>{
 assert.equal(validateConsultEvidenceRefs(refs,true),true);assert.equal(validateConsultEvidenceRefs(refs,false),false);assert.equal(validateConsultEvidenceRefs([{...refs[0],id:'evil:image'},...refs.slice(1)],true),false);assert.equal(validateConsultEvidenceRefs([...refs,{id:'req-1:extra',kind:'extra'}],true),false);
 assert.equal(validateConsultCitations(refs,['req-1:image','req-1:flood']),true);assert.equal(validateConsultCitations(refs,[]),true);assert.equal(validateConsultCitations(refs,['forged']),false);assert.equal(validateConsultCitations(refs,['req-1:image','req-1:image']),false);
});
test('model receives identifiers and unsent or duplicate citations reject the consultation',async()=>{
 let calls=[];const fake=cited=>async(_url,opts)=>{const p=JSON.parse(opts.body);calls.push(p);let text=calls.length===1?JSON.stringify({density:'dense'}):JSON.stringify({ordered_ids:['flood','obstacles','airspace','shelter_open','communications'],cited_ids:cited});return {ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text}]}]})}};
 const result=await consultMapWithMuse(input,fake(['req-1:image']));assert.deepEqual(result.cited_ids,['req-1:image']);assert.ok(calls.every(x=>x.input[0].content[0].text.includes('req-1:image')));
 calls=[];await assert.rejects(consultMapWithMuse(input,fake(['not-sent'])),/参照/);calls=[];await assert.rejects(consultMapWithMuse(input,fake(['req-1:image','req-1:image'])),/参照/);
});
test('audit stores validated model self-reported citations and rejects forged history',()=>{
 const date='2026-11-03T10:00:00.000Z';const audit=createConsultAudit({id:'req-1',capturedAt:date,area:'13118',payload:{image:input.image,supply:'water',quantity:1,flood:input.flood},flood:{shelter:'S',address:'A',state:'ready',depth:input.flood,checkedAt:date},shelter:'S',address:'A'});
 const result={density:'dense',ordered_ids:['flood','obstacles','airspace','shelter_open','communications'],cited_ids:['req-1:image']};const saved=finishConsultAudit(audit,result,date);assert.deepEqual(saved.output.cited_ids,['req-1:image']);assert.equal(decodeConsultAudits(JSON.stringify([saved])).status,'ok');assert.throws(()=>finishConsultAudit(audit,{...result,cited_ids:['forged']},date));saved.output.cited_ids=['forged'];assert.equal(decodeConsultAudits(JSON.stringify([saved])).status,'corrupt');
});

test('late citation result after view change is discarded and never added to an audit',async()=>{
 const {createMapConsultation}=await import('./readiness.mjs');let finish,abort,accepted=0;const raw={density:'dense',ordered_ids:['flood','obstacles','airspace','shelter_open','communications'],cited_ids:['req-1:image']};
 const flow=createMapConsultation({capture:()=>({image:'image',view:1}),current:()=>true,request:(_image,signal)=>{abort=signal;return new Promise(resolve=>{finish=resolve})},onStatus(){},onResult:(_desc,result)=>{if(result)accepted++}});
 const pending=flow.run();flow.invalidate();assert.equal(abort.aborted,true);finish(raw);await pending;assert.equal(accepted,0);
});
test('missing citation output is not accepted when references were sent',async()=>{
 let calls=0;const fake=async()=>{calls++;const text=calls===1?'{"density":"dense"}':JSON.stringify({ordered_ids:['flood','obstacles','airspace','shelter_open','communications']});return {ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text}]}]})}};
 await assert.rejects(consultMapWithMuse(input,fake),/参照/);assert.equal(calls,2);
});
