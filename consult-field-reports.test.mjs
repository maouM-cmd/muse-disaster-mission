import test from 'node:test';import assert from 'node:assert/strict';
import {createFloodFieldReport,consultFieldReports,validateConsultFieldReports,consultEvidenceRefs,validateConsultEvidenceRefs,createConsultAudit,finishConsultAudit,decodeConsultAudits} from './readiness.mjs';
import {consultMapWithMuse} from './meta.mjs';import {createServer} from './server.mjs';
const now=Date.parse('2026-11-04T08:00:00.000Z'),identity={area:'13118',name:'架空施設',address:'架空住所'};
const make=(id,status,observedAt='2026-11-04T07:50:00.000Z',expiresAt='2026-11-04T09:00:00.000Z')=>createFloodFieldReport({...identity,id,status,scope:'facility_point',observedAt,expiresAt,organization:'個人情報組織',source:'個人情報確認先',note:'個人情報メモ'},now);
const reports=[make('one','water_seen'),make('two','no_water_seen'),make('old','water_seen','2026-11-04T06:00:00.000Z','2026-11-04T07:00:00.000Z')];
test('only nonexpired field reports for the selected facility are prepared without identifying fields',()=>{
 const result=consultFieldReports(JSON.stringify(reports),identity,now);assert.equal(result.length,2);assert.deepEqual(result.map(r=>r.status),['water_seen','no_water_seen']);assert.doesNotMatch(JSON.stringify(result),/個人情報|架空|one|two/);assert.equal(validateConsultFieldReports(result,now),true);
 assert.equal(consultFieldReports(JSON.stringify(reports),{...identity,name:'別施設'},now),null);assert.equal(consultFieldReports('{bad',identity,now),null);assert.equal(validateConsultFieldReports([{...result[0],name:'個人'}],now),false);assert.equal(validateConsultFieldReports(result,Date.parse('2026-11-04T09:00:00Z')),false);
 assert.equal(validateConsultFieldReports([{...result[0],observedAt:'2026-02-30T00:00:00.000Z'}],now),false);
});
test('field reports receive a bound reference and survive audit without identity or private notes',()=>{
 const fieldReports=consultFieldReports(JSON.stringify(reports),identity,now),refs=consultEvidenceRefs('req',true,false,true);assert.equal(validateConsultEvidenceRefs(refs,true,false,true),true);assert.equal(validateConsultEvidenceRefs(refs,true,false,false),false);
 const payload={supply:null,quantity:null,flood:null,fieldReports},audit=createConsultAudit({id:'req',capturedAt:new Date(now).toISOString(),area:'13118',payload});
 const completed=finishConsultAudit(audit,{density:'unclear',ordered_ids:['flood','obstacles','airspace','shelter_open','communications'],cited_ids:['req:field_reports']},new Date(now+1000).toISOString());
 const decoded=decodeConsultAudits(JSON.stringify([completed]));assert.equal(decoded.status,'ok');assert.deepEqual(decoded.records[0].inputs.find(x=>x.kind==='field_reports').value,fieldReports);assert.doesNotMatch(JSON.stringify(decoded),/個人情報|架空住所/);
});
test('Muse prompt labels the reports unverified and citations must be among sent IDs',async()=>{
 // Generate current timestamps for the API validation.
 const at=Date.now(),active=[{status:'water_seen',scope:'facility_point',observedAt:new Date(at-60000).toISOString(),expiresAt:new Date(at+60000).toISOString()}],refs=consultEvidenceRefs('test',false,false,true);let prompts=[];
 const result=await consultMapWithMuse({key:'test',image:'data:image/png;base64,AA==',supply:null,quantity:null,fieldReports:active,evidenceRefs:refs},async(_url,options)=>{const payload=JSON.parse(options.body);prompts.push(payload.input[0].content[0].text);return {ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(prompts.length===1?{density:'unclear'}:{ordered_ids:['flood','obstacles','airspace','shelter_open','communications'],cited_ids:['test:field_reports']})}]}]})}});
 assert.match(prompts[1],/未検証/);assert.match(prompts[1],/人の報告/);assert.match(prompts[1],/test:field_reports/);assert.match(prompts[1],/同じ場所や同じ時刻/);assert.equal(result.cited_ids[0],'test:field_reports');
});
test('API refuses expired, extra or unreferenced reports before invoking the model',async t=>{
 let calls=0;const server=createServer({active:true,key:'fixture',mapConsult:async()=>{calls++;return {density:'unclear',ordered_ids:['flood','obstacles','airspace','shelter_open','communications'],cited_ids:['req:field_reports']}}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base=`http://127.0.0.1:${server.address().port}`,at=Date.now(),fieldReports=[{status:'uncertain',scope:'nearby_road',observedAt:new Date(at-60000).toISOString(),expiresAt:new Date(at+60000).toISOString()}],evidenceRefs=consultEvidenceRefs('req',false,false,true),payload={image:'data:image/png;base64,AA==',supply:null,quantity:null,fieldReports,evidenceRefs};
 const post=data=>fetch(base+'/api/map-consult',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify(data)});
 assert.equal((await post({...payload,fieldReports:[{...fieldReports[0],note:'private'}]})).status,400);assert.equal((await post({...payload,fieldReports:[{...fieldReports[0],expiresAt:new Date(at-1000).toISOString()}]})).status,400);assert.equal((await post({...payload,evidenceRefs:consultEvidenceRefs('req',false)})).status,400);assert.equal(calls,0);
 assert.equal((await post(payload)).status,200);assert.equal(calls,1);assert.equal((await (await fetch(base+'/api/map-capabilities')).json()).mapConsultFieldReports,true);
});
test('a report expiring during the first model call is not sent for the second call',async()=>{
 const at=Date.now(),fieldReports=[{status:'water_seen',scope:'facility_point',observedAt:new Date(at-1000).toISOString(),expiresAt:new Date(at+350).toISOString()}],evidenceRefs=consultEvidenceRefs('expiring',false,false,true);let calls=0;
 await assert.rejects(consultMapWithMuse({key:'fixture',image:'data:image/png;base64,AA==',supply:null,quantity:null,fieldReports,evidenceRefs},async()=>{calls++;await new Promise(resolve=>setTimeout(resolve,450));return {ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:'{"density":"unclear"}'}]}]})}}),/期限/);
 assert.equal(calls,1);
});
