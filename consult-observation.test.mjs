import test from 'node:test';
import assert from 'node:assert/strict';
import {mapObservationContext,validateConsultObservation,consultEvidenceRefs,validateConsultEvidenceRefs,createConsultAudit,finishConsultAudit,decodeConsultAudits} from './readiness.mjs';
import {consultMapWithMuse} from './meta.mjs';
const now=Date.parse('2026-11-04T02:40:00.000Z');
const source={area:'13118',stationId:'44132',station:'東京',referenceLabel:'建物モデル範囲の中心',distance:6045.3,latitude:35.7,longitude:139.8,observedAt:'2026-11-04T02:30:00.000Z',retrievedAt:'2026-11-04T02:32:00.000Z',rain:0,wind:1.6};
test('only fresh, scoped, non-identifying observation fields enter the consultation',()=>{
 const value=mapObservationContext(source,'13118',now);assert.deepEqual(value,{stationId:'44132',distanceMeters:6045,observedAt:source.observedAt,retrievedAt:source.retrievedAt,rain:0,wind:1.6});assert.equal(validateConsultObservation(value,now),true);
 for(const [item,area,time] of [[source,'13101',now],[source,'13118',now+3600000],[{...source,wind:-1},'13118',now],[{...source,retrievedAt:'invalid'},'13118',now]])assert.equal(mapObservationContext(item,area,time),null);
 assert.equal(validateConsultObservation({...value,address:'private'},now),false);assert.equal(validateConsultObservation({...value,wind:NaN},now),false);
});
test('live observation with impossible chronology is not sent to Muse',()=>{
 for(const changed of [{retrievedAt:'2026-11-04T02:29:00.000Z'},{retrievedAt:'2026-11-04T02:41:00.000Z'},{observedAt:'2026-11-04T02:41:00.000Z',retrievedAt:'2026-11-04T02:41:00.000Z'}]){
  assert.equal(mapObservationContext({...source,...changed},'13118',now),null);
 }
});
test('reference type is explicitly bounded and supports old records without disclosing names',()=>{
 const point={...source,referenceKind:'facility'},v2=mapObservationContext(point,'13118',now,{includeReferenceKind:true});
 assert.equal(v2.referenceKind,'facility');assert.equal(validateConsultObservation(v2,now),true);
 assert.equal(Object.hasOwn(v2,'referenceLabel'),false);assert.equal(Object.hasOwn(v2,'latitude'),false);
 assert.equal(mapObservationContext({...point,referenceKind:'fake'},'13118',now,{includeReferenceKind:true}),null);
 assert.equal(validateConsultObservation({...v2,referenceKind:'fake'},now),false);
 assert.equal(validateConsultObservation({...v2,referenceLabel:'private'},now),false);
 const legacy=mapObservationContext(point,'13118',now);assert.equal(Object.hasOwn(legacy,'referenceKind'),false);assert.equal(validateConsultObservation(legacy,now,{historical:true}),true);
});
test('optional cumulative rain preserves periods, validates numbers and keeps older payloads unchanged',()=>{
 const observation={...source,referenceKind:'facility',rain1h:2.5,rain24h:7};
 const extended=mapObservationContext(observation,'13118',now,{includeReferenceKind:true,includeAccumulatedRain:true});
 assert.equal(extended.rain1h,2.5);assert.equal(extended.rain24h,7);assert.equal(validateConsultObservation(extended,now),true);
 const old=mapObservationContext(observation,'13118',now,{includeReferenceKind:true});assert.equal(Object.hasOwn(old,'rain1h'),false);assert.equal(validateConsultObservation(old,now),true);
 for(const bad of [{rain1h:-1},{rain24h:'7'},{rain1h:NaN}])assert.equal(validateConsultObservation({...extended,...bad},now),false);
 const partial={...extended};delete partial.rain24h;assert.equal(validateConsultObservation(partial,now),false);
 const missing=mapObservationContext({...observation,rain1h:null,rain24h:null},'13118',now,{includeAccumulatedRain:true});assert.equal(missing.rain1h,null);assert.equal(validateConsultObservation(missing,now),true);
 const audit=createConsultAudit({id:'rain-periods',capturedAt:new Date(now).toISOString(),area:'13118',payload:{supply:null,quantity:null,observation:extended},observation});
 const result=finishConsultAudit(audit,{density:'dense',ordered_ids:['flood','obstacles','airspace','shelter_open','communications']},new Date(now).toISOString());
 assert.deepEqual(decodeConsultAudits(JSON.stringify([result])).records[0].inputs.find(x=>x.kind==='observation').value,extended);
});
test('rainfall-only observations require the extended format and preserve missing values',()=>{
 const partial={...source,rain:null,wind:null,rain1h:0,rain24h:7};
 const extended=mapObservationContext(partial,'13118',now,{includeAccumulatedRain:true});
 assert.deepEqual([extended.rain,extended.wind,extended.rain1h,extended.rain24h],[null,null,0,7]);
 assert.equal(validateConsultObservation(extended,now),true);
 assert.equal(mapObservationContext(partial,'13118',now),null);
 assert.equal(mapObservationContext({...partial,rain1h:null,rain24h:null},'13118',now,{includeAccumulatedRain:true}),null);
 assert.equal(mapObservationContext({...partial,observedAt:'2026-11-04T01:00:00.000Z'},'13118',now,{includeAccumulatedRain:true}),null);
});
test('an audit stores the explicitly sent reference type and still accepts older observations',()=>{
 const point={...source,referenceKind:'facility'},observation=mapObservationContext(point,'13118',now,{includeReferenceKind:true});
 const audit=createConsultAudit({id:'ref-type',capturedAt:new Date(now).toISOString(),area:'13118',payload:{supply:null,quantity:null,observation},observation:point});
 const result=finishConsultAudit(audit,{density:'dense',ordered_ids:['flood','obstacles','airspace','shelter_open','communications']},new Date(now).toISOString());
 assert.equal(decodeConsultAudits(JSON.stringify([result])).records[0].inputs.find(x=>x.kind==='observation').value.referenceKind,'facility');
 assert.throws(()=>createConsultAudit({id:'bad-ref',capturedAt:new Date(now).toISOString(),area:'13118',payload:{supply:null,quantity:null,observation:{...observation,referenceKind:'model_center'}},observation:point}));
});
test('model receives the opted-in observation and its ID while missing or forged IDs fail',async()=>{
 const at=new Date().toISOString(),observation={stationId:'44132',distanceMeters:1000,observedAt:at,retrievedAt:at,rain:0,wind:1.6},refs=consultEvidenceRefs('obs-model',false,true),prompts=[];
 const fake=async(_url,options)=>{const input=JSON.parse(options.body);prompts.push(input.input[0].content[0].text);const result=prompts.length===1?{density:'dense'}:{ordered_ids:['flood','obstacles','airspace','shelter_open','communications'],cited_ids:['obs-model:observation']};return {ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(result)}]}]})}};
 const result=await consultMapWithMuse({key:'test',image:'data:image/png;base64,AA==',supply:null,quantity:null,observation,evidenceRefs:refs},fake);
 assert.deepEqual(result.cited_ids,['obs-model:observation']);assert.ok(prompts.every(text=>text.includes('44132')&&text.includes('obs-model:observation')&&text.includes('施設や上空の実測値ではなく')));
 await assert.rejects(consultMapWithMuse({key:'test',image:'data:image/png;base64,AA==',supply:null,quantity:null,observation},fake));
});
test('model prompt names the reference kind without facility identification',async()=>{
 const at=new Date().toISOString(),observation={stationId:'44132',distanceMeters:1000,observedAt:at,retrievedAt:at,rain:0,wind:1.6,referenceKind:'facility'},refs=consultEvidenceRefs('ref-model',false,true),prompts=[];
 const fake=async(_url,options)=>{const text=JSON.parse(options.body).input[0].content[0].text;prompts.push(text);const result=prompts.length===1?{density:'dense'}:{ordered_ids:['flood','obstacles','airspace','shelter_open','communications'],cited_ids:[]};return {ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(result)}]}]})}};
 await consultMapWithMuse({key:'test',image:'data:image/png;base64,AA==',supply:null,quantity:null,observation,evidenceRefs:refs},fake);
 assert.ok(prompts.every(text=>text.includes('facilityは選択した施設の公開座標')&&text.includes('施設名・住所・座標は含まれません')));
});
test('model receives the selected rainfall periods with their meaning and cited observation ID',async()=>{
 const at=new Date().toISOString(),observation={stationId:'44132',distanceMeters:1000,observedAt:at,retrievedAt:at,rain:0,wind:1.6,rain1h:2.5,rain24h:7},refs=consultEvidenceRefs('rain-model',false,true),prompts=[];
 const fake=async(_url,options)=>{const text=JSON.parse(options.body).input[0].content[0].text;prompts.push(text);const result=prompts.length===1?{density:'dense'}:{ordered_ids:['flood','obstacles','airspace','shelter_open','communications'],cited_ids:['rain-model:observation']};return {ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(result)}]}]})}};
 await consultMapWithMuse({key:'test',image:'data:image/png;base64,AA==',supply:null,quantity:null,observation,evidenceRefs:refs},fake);
 assert.ok(prompts.every(text=>text.includes('rain1h')&&text.includes('rain24h')&&text.includes('観測前1時間')&&text.includes('観測前24時間')&&text.includes('施設や上空の実測値ではなく')));
});
test('observation receives its own ID and survives only a valid audit round trip',()=>{
 const value=mapObservationContext(source,'13118',now),refs=consultEvidenceRefs('req-obs',true,true);assert.equal(validateConsultEvidenceRefs(refs,true,true),true);
 const audit=createConsultAudit({id:'req-obs',capturedAt:new Date(now).toISOString(),area:'13118',payload:{supply:null,quantity:null,flood:null,observation:value},observation:source});
 const out=finishConsultAudit(audit,{density:'dense',ordered_ids:['flood','obstacles','airspace','shelter_open','communications'],cited_ids:['req-obs:observation']},new Date(now).toISOString());
 assert.equal(decodeConsultAudits(JSON.stringify([out])).status,'ok');assert.equal(out.inputs.find(x=>x.kind==='observation').value.stationId,'44132');assert.equal(JSON.stringify(out).includes('139.8'),false);
 const legacy=structuredClone(out);legacy.inputs.find(x=>x.kind==='observation').value.retrievedAt='2026-11-04T02:29:00.000Z';
 assert.equal(decodeConsultAudits(JSON.stringify([legacy])).status,'ok');
 assert.throws(()=>createConsultAudit({id:'req-obs',capturedAt:new Date(now).toISOString(),area:'13101',payload:{supply:null,quantity:null,observation:value},observation:source}));
});
