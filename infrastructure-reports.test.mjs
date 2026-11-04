import test from 'node:test';
import assert from 'node:assert/strict';
import {createInfrastructureReport,decodeInfrastructureReports,appendInfrastructureReport,infrastructureReportState,consultInfrastructureReports,validateConsultInfrastructureReports} from './infrastructure-reports.mjs';

const now=Date.parse('2026-11-04T12:00:00.000Z');
const base={id:'a-1',area:'13118',location:'川沿いの道路付近',item:'wire',status:'damaged',source:'現地の報告',observedAt:'2026-11-04T10:00:00.000Z',recordedAt:'2026-11-04T11:00:00.000Z',expiresAt:'2026-11-04T13:00:00.000Z',corrects:null};
test('reports are unverified, expire and preserve explicitly linked corrections',()=>{
 const first=createInfrastructureReport(base,now);assert.equal(first.kind,'manual-infrastructure-report');assert.equal(infrastructureReportState(first,now),'reported');assert.equal(infrastructureReportState(first,Date.parse(first.expiresAt)),'expired');assert.equal(infrastructureReportState(first,Date.parse(first.recordedAt)-1),'clock_unknown');
 const raw=appendInfrastructureReport(null,first,'13118',now),correction=createInfrastructureReport({...base,id:'b-2',status:'uncertain',corrects:first.id},now),updated=appendInfrastructureReport(raw,correction,'13118',now),records=decodeInfrastructureReports(updated,'13118').records;
 assert.equal(records.length,2);assert.equal(records[0].corrects,first.id);assert.equal(records[1].status,'damaged');assert.equal(records[0].status,'uncertain');
 assert.throws(()=>appendInfrastructureReport(updated,first,'13118',now));assert.throws(()=>appendInfrastructureReport(raw,{...correction,corrects:'missing'},'13118',now));
});
test('malformed, foreign and future reports are refused without replacing saved records',()=>{
 for(const bad of [{area:'13106',id:''},{observedAt:'2026-02-30T12:00:00.000Z'},{observedAt:'2026-11-04T12:01:00.000Z'},{expiresAt:'2026-11-04T10:00:00.000Z'},{item:'invented'},{status:'safe'},{location:''},{source:''},{unexpected:'x'}])assert.throws(()=>createInfrastructureReport({...base,...bad},now));
 const first=createInfrastructureReport(base,now),raw=appendInfrastructureReport(null,first,'13118',now);assert.equal(decodeInfrastructureReports(raw,'13106').status,'corrupt');assert.throws(()=>appendInfrastructureReport('{broken',first,'13118',now));assert.equal(decodeInfrastructureReports(raw,'13118').records[0].id,'a-1');
});
test('reports are scoped to the selected five-digit municipality beyond the sample regions',()=>{
 const other=createInfrastructureReport({...base,id:'outside-1',area:'15222'},now),raw=appendInfrastructureReport(null,other,'15222',now);assert.equal(decodeInfrastructureReports(raw,'15222').records[0].area,'15222');assert.equal(decodeInfrastructureReports(raw,'13118').status,'corrupt');
});
test('consultation data excludes identifying text, preserves correction relationships and excludes expired reports',()=>{
 const first=createInfrastructureReport({...base,expiresAt:'2026-11-04T11:30:00.000Z'},now),second=createInfrastructureReport({...base,id:'b-2',status:'uncertain',corrects:first.id},now),third=createInfrastructureReport({...base,id:'c-3',status:'present',corrects:second.id},now);
 let raw=null;for(const row of [first,second,third])raw=appendInfrastructureReport(raw,row,'13118',now);
 const data=consultInfrastructureReports(raw,'13118',now);assert.equal(data.length,2);assert.equal(data[0].correctionIndex,1);assert.equal(data[1].correctionTargetOmitted,true);assert.equal(data[1].correctionIndex,null);assert.equal(validateConsultInfrastructureReports(data,now),true);
 assert.doesNotMatch(JSON.stringify(data),/川沿い|現地の報告|13118|b-2/);assert.equal(consultInfrastructureReports(raw,'13106',now),null);assert.equal(consultInfrastructureReports(raw,'13118',Date.parse('2026-11-04T14:00:00Z')),null);
 assert.equal(validateConsultInfrastructureReports([{...data[0],location:'private'}],now),false);assert.equal(validateConsultInfrastructureReports([{...data[0],correctionIndex:0}],now),false);assert.equal(validateConsultInfrastructureReports([{...data[0],observedAt:'2026-02-30T10:00:00.000Z'}],now),false);
 assert.equal(validateConsultInfrastructureReports([{...data[0],correctionIndex:1},{...data[1],correctionIndex:0,correctionTargetOmitted:false}],now),false);
 let many=null;for(let i=0;i<21;i++)many=appendInfrastructureReport(many,createInfrastructureReport({...base,id:`item-${i}`},now),'13118',now);assert.equal(consultInfrastructureReports(many,'13118',now),null);
});
