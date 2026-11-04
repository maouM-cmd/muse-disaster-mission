import test from 'node:test';import assert from 'node:assert/strict';
import {createFacilityReport,consultFacilityReports,validateConsultFacilityReports,consultEvidenceRefs,validateConsultEvidenceRefs,createConsultAudit,finishConsultAudit,decodeConsultAudits} from './readiness.mjs';
import {createFloodFieldReport,consultFieldReports,mapObservationContext,consultFloodBulletin} from './readiness.mjs';
import {consultMapWithMuse} from './meta.mjs';
import {createServer} from './server.mjs';
import {createInfrastructureReport,appendInfrastructureReport,consultInfrastructureReports} from './infrastructure-reports.mjs';
const now=Date.parse('2026-11-04T08:00:00.000Z'),identity={area:'13118',name:'架空施設',address:'架空住所'};
const make=(id,status,extra={},at=now)=>({id,...createFacilityReport({...identity,status,confirmedAt:'2026-11-04T07:00:00.000Z',expiresAt:'2026-11-04T09:00:00.000Z',organization:'秘密の組織',source:'秘密の連絡先',condition:status==='conditional'?'秘密の条件':'',supply:'water',quantity:12,landing:'unknown',...extra},at)});
test('all optional evidence types keep separate references and survive audit decoding',()=>{
 const facilityReports=consultFacilityReports(JSON.stringify([make('one','available')]),identity,now);
 const report=createFloodFieldReport({...identity,id:'field',status:'uncertain',scope:'facility_point',observedAt:'2026-11-04T07:50:00.000Z',expiresAt:'2026-11-04T09:00:00.000Z',organization:'秘密',source:'秘密',note:''},now),fieldReports=consultFieldReports(JSON.stringify([report]),identity,now);
 const source={area:identity.area,stationId:'44132',station:'東京',referenceLabel:'建物モデル範囲の中心',distance:1000,latitude:35.7,longitude:139.8,observedAt:'2026-11-04T07:50:00.000Z',retrievedAt:'2026-11-04T07:55:00.000Z',rain:0,wind:1};
 const infra=createInfrastructureReport({id:'local',area:identity.area,location:'秘密',item:'wire',status:'damaged',source:'秘密',observedAt:'2026-11-04T07:00:00.000Z',recordedAt:'2026-11-04T07:30:00.000Z',expiresAt:'2026-11-04T09:00:00.000Z',corrects:null},now),infrastructureReports=consultInfrastructureReports(appendInfrastructureReport(null,infra,identity.area,now),identity.area,now);
 const observation=mapObservationContext(source,identity.area,now),bulletin=consultFloodBulletin({url:'https://www.data.jma.go.jp/developer/xml/data/20261104074000_0_VXKO50_000000.xml',issuedAt:'2026-11-04T07:40:00Z',retrievedAt:'2026-11-04T07:50:00Z',event:'830304000100',serial:'1',bulletinType:'発表',controlStatus:'通常',water:{rows:[],truncated:false}},now),payload={supply:null,quantity:null,flood:null,observation,fieldReports,facilityReports,bulletin,infrastructureReports},refs=consultEvidenceRefs('all',true,true,true,true,true,true);
 const audit=createConsultAudit({id:'all',capturedAt:new Date(now).toISOString(),area:identity.area,payload,observation:source}),complete=finishConsultAudit(audit,{density:'unclear',ordered_ids:['flood','obstacles','airspace','shelter_open','communications'],cited_ids:refs.map(row=>row.id)},new Date(now+1000).toISOString());
 assert.equal(decodeConsultAudits(JSON.stringify([complete])).status,'ok');assert.equal(complete.inputs.length,8);assert.deepEqual(complete.inputs.map(item=>item.kind),refs.map(item=>item.kind));assert.doesNotMatch(JSON.stringify(complete),/秘密|架空施設|架空住所/);
});
test('active facility reports preserve correction relationships but exclude private text',()=>{
 const first=make('a','conditional'),second=make('b','unavailable',{correctsId:'a'}),result=consultFacilityReports(JSON.stringify([second,first]),identity,now);
 assert.equal(result.length,2);assert.equal(result[0].correctionIndex,1);assert.equal(result[0].correctionTargetOmitted,false);assert.equal(result[1].correctionIndex,null);assert.doesNotMatch(JSON.stringify(result),/秘密|架空|"a"|"b"/);assert.equal(validateConsultFacilityReports(result,now),true);
 const expired=make('old','available',{confirmedAt:'2026-11-04T06:00:00.000Z',expiresAt:'2026-11-04T07:00:00.000Z'}),correction=make('new','checking',{correctsId:'old'}),selected=consultFacilityReports(JSON.stringify([correction,expired]),identity,now);
 assert.equal(selected[0].correctionTargetOmitted,true);assert.equal(selected[0].correctionIndex,null);
 assert.equal(consultFacilityReports(JSON.stringify([first]),{...identity,name:'別施設'},now),null);assert.equal(validateConsultFacilityReports([{...result[0],source:'private'}],now),false);assert.equal(validateConsultFacilityReports(result,Date.parse('2026-11-04T09:00:00Z')),false);
});
test('facility reports get a separate input ID and remain unverified in saved consultation',()=>{
 const facilityReports=consultFacilityReports(JSON.stringify([make('one','available')]),identity,now),refs=consultEvidenceRefs('req',false,false,false,true);assert.equal(validateConsultEvidenceRefs(refs,false,false,false,true),true);
 const audit=createConsultAudit({id:'req',capturedAt:new Date(now).toISOString(),area:identity.area,payload:{supply:null,quantity:null,facilityReports}}),result=finishConsultAudit(audit,{density:'unclear',ordered_ids:['flood','obstacles','airspace','shelter_open','communications'],cited_ids:['req:facility_reports']},new Date(now+1000).toISOString()),decoded=decodeConsultAudits(JSON.stringify([result]));
 assert.equal(decoded.status,'ok');assert.deepEqual(decoded.records[0].inputs.find(x=>x.kind==='facility_reports').value,facilityReports);assert.doesNotMatch(JSON.stringify(decoded),/秘密|架空/);
});
test('model receives unverified reports and is told that conditional details are omitted',async()=>{
 const at=Date.now(),item=make('live','conditional',{confirmedAt:new Date(at-10000).toISOString(),expiresAt:new Date(at+60000).toISOString()},at),facilityReports=consultFacilityReports(JSON.stringify([item]),identity,at),refs=consultEvidenceRefs('test',false,false,false,true);let prompts=[];
 await consultMapWithMuse({key:'fixture',image:'data:image/png;base64,AA==',supply:null,quantity:null,facilityReports,evidenceRefs:refs},async(_url,options)=>{prompts.push(JSON.parse(options.body).input[0].content[0].text);return {ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(prompts.length===1?{density:'unclear'}:{ordered_ids:['flood','obstacles','airspace','shelter_open','communications'],cited_ids:['test:facility_reports']})}]}]})}});
 assert.match(prompts[1],/未検証/);assert.match(prompts[1],/条件.*送信されていません/);assert.doesNotMatch(prompts[1],/秘密/);
});
test('server rejects omitted references, extra personal fields, invalid corrections and expired data',async t=>{
 let calls=0;const server=createServer({active:true,key:'fixture',mapConsult:async()=>{calls++;return {density:'unclear',ordered_ids:['flood','obstacles','airspace','shelter_open','communications'],cited_ids:['req:facility_reports']}}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base=`http://127.0.0.1:${server.address().port}`,at=Date.now(),item=make('live','available',{confirmedAt:new Date(at-10000).toISOString(),expiresAt:new Date(at+60000).toISOString()},at),facilityReports=consultFacilityReports(JSON.stringify([item]),identity,at),payload={image:'data:image/png;base64,AA==',supply:null,quantity:null,facilityReports,evidenceRefs:consultEvidenceRefs('req',false,false,false,true)};
 const post=data=>fetch(base+'/api/map-consult',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify(data)});
 for(const bad of [{...payload,facilityReports:[{...facilityReports[0],source:'private'}]},{...payload,facilityReports:[{...facilityReports[0],correctionIndex:0}]},{...payload,facilityReports:[{...facilityReports[0],expiresAt:new Date(at-1000).toISOString()}]},{...payload,evidenceRefs:consultEvidenceRefs('req',false)}])assert.equal((await post(bad)).status,400);
 assert.equal(calls,0);assert.equal((await post(payload)).status,200);assert.equal(calls,1);assert.equal((await (await fetch(base+'/api/map-capabilities')).json()).mapConsultFacilityReports,true);
});
