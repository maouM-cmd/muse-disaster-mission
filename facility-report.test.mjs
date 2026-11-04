import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createFacilityReport,facilityReportState} from './readiness.mjs';
const now=Date.parse('2026-11-03T12:00:00.000Z');
const identity={area:'13118',name:'原中学校',address:'東京都荒川区'};
const input={...identity,status:'conditional',confirmedAt:'2026-11-03T11:30:00.000Z',expiresAt:'2026-11-03T12:30:00.000Z',organization:'避難所',source:'電話',supply:'water',quantity:12,landing:'unknown',condition:'担当者への連絡が必要'};
test('a local facility report retains its actual confirmation, expiry, supply and conditions',()=>{
 const r=createFacilityReport(input,now);assert.equal(r.status,'conditional');assert.equal(r.quantity,12);assert.equal(r.expiresAt,input.expiresAt);assert.equal(facilityReportState(r,identity,now),'conditional');
});
test('old, future, invalid and different-facility reports are never presented as current',()=>{
 const r=createFacilityReport(input,now);
 assert.equal(facilityReportState(r,identity,Date.parse('2026-11-03T12:30:00.000Z')),'expired');
 assert.equal(facilityReportState(r,{...identity,name:'別の施設'},now),'unknown');
 assert.equal(facilityReportState(r,identity,Date.parse('2026-11-03T11:00:00.000Z')),'unknown');
 assert.equal(facilityReportState({...r,expiresAt:'bad'},identity,now),'unknown');
 assert.throws(()=>createFacilityReport({...input,expiresAt:'2026-11-03T11:00:00.000Z'},now));
 assert.throws(()=>createFacilityReport({...input,status:'safe'},now));
 assert.throws(()=>createFacilityReport({...input,confirmedAt:'2026-11-03T14:00:00.000Z'},now));
});
test('impossible or unzoned report times do not become an active facility report',()=>{
 for(const date of ['2026-02-30T10:00:00Z','2026-04-31T10:00:00Z','2026-11-03T11:30:00']){
  const bad={...input,confirmedAt:date};assert.throws(()=>createFacilityReport(bad,now));assert.equal(facilityReportState({version:2,...bad},identity,now),'unknown');
 }
});
test('unknown saved fields are retained by refusing an update instead of stripping them',async()=>{
 const {decodeFacilityReports,appendFacilityReport}=await import('./readiness.mjs');const first={id:'one',...createFacilityReport(input,now),futureField:'must keep'},raw=JSON.stringify([first]),second={id:'two',...createFacilityReport({...input,status:'unavailable',condition:''},now)};
 assert.equal(decodeFacilityReports(raw,identity).status,'corrupt');assert.throws(()=>appendFacilityReport(raw,second,identity));assert.equal(JSON.parse(raw)[0].futureField,'must keep');
});

test('multiple local reports preserve conflicting information and reject corrupt or foreign records',async()=>{
 const {decodeFacilityReports,appendFacilityReport}=await import('./readiness.mjs');
 const first={id:'one',...createFacilityReport(input,now)};
 const second={id:'two',...createFacilityReport({...input,status:'unavailable',condition:''},now)};
 const saved=appendFacilityReport(JSON.stringify([first]),second,identity);
 const result=decodeFacilityReports(saved,identity);
 assert.equal(result.status,'ok');assert.equal(result.reports.length,2);
 assert.deepEqual(result.reports.map(x=>x.status),['unavailable','conditional']);
 assert.equal(decodeFacilityReports('{',identity).status,'corrupt');
 assert.equal(decodeFacilityReports(JSON.stringify([{...first,name:'別の施設'}]),identity).status,'corrupt');
 assert.throws(()=>appendFacilityReport('{',second,identity));
});

test('duplicate reports do not silently create duplicate entries',async()=>{
 const {appendFacilityReport}=await import('./readiness.mjs');
 const first={id:'one',...createFacilityReport(input,now)};
 assert.throws(()=>appendFacilityReport(JSON.stringify([first]),{...first,id:'two'},identity),/同じ/);
});

test('a declared correction preserves and links the original report',async()=>{
 const {decodeFacilityReports,appendFacilityReport}=await import('./readiness.mjs');
 const first={id:'one',...createFacilityReport(input,now)};
 const correction={id:'two',...createFacilityReport({...input,status:'unavailable',condition:'',correctsId:'one'},now)};
 const result=decodeFacilityReports(appendFacilityReport(JSON.stringify([first]),correction,identity),identity);
 assert.equal(result.status,'ok');
 assert.equal(result.reports[0].correctsId,'one');
 assert.equal(result.reports[1].status,'conditional');
});

test('correction links reject missing, self, cyclic and other-facility targets',async()=>{
 const {decodeFacilityReports,appendFacilityReport}=await import('./readiness.mjs');
 const first={id:'one',...createFacilityReport(input,now)};
 const make=id=>({id:'two',...createFacilityReport({...input,status:'unavailable',condition:'',correctsId:id},now)});
 assert.throws(()=>appendFacilityReport(JSON.stringify([first]),make('missing'),identity));
 assert.throws(()=>appendFacilityReport(JSON.stringify([first]),make('two'),identity));
 assert.equal(decodeFacilityReports(JSON.stringify([{...first,correctsId:'two'},make('one')]),identity).status,'corrupt');
 assert.equal(decodeFacilityReports(JSON.stringify([first,{...make('one'),name:'別施設'}]),identity).status,'corrupt');
});

test('history merging keeps a correction and its original even when their order changes',async()=>{
 const {appendFacilityReport,mergeLocalHistories,pilotFacilityKey,decodeFacilityReports}=await import('./readiness.mjs');
 const first={id:'one',...createFacilityReport(input,now)};
 const correction={id:'two',...createFacilityReport({...input,status:'unavailable',condition:'',correctsId:'one'},now)};
 const original=JSON.stringify([first]);
 const edited=appendFacilityReport(original,correction,identity);
 const merged=mergeLocalHistories(`${pilotFacilityKey(identity.area,identity.name,identity.address)}:report-v2`,original,edited);
 assert.equal(merged.mode,'merge');
 const records=decodeFacilityReports(merged.value,identity).reports;
 assert.equal(records.length,2);assert.equal(records.find(record=>record.id==='two').correctsId,'one');
});

test('active reports expose differences in landing and quantities without inventing a contradiction',async()=>{
 const {facilityReportDifferences,buildPilotEvidenceLedger}=await import('./readiness.mjs');
 const first={id:'one',...createFacilityReport({...input,status:'available',landing:'clear_reported',quantity:12},now)};
 const second={id:'two',...createFacilityReport({...input,status:'available',landing:'unusable_reported',quantity:7},now)};
 assert.deepEqual(facilityReportDifferences([first,second],identity,now),{acceptance:false,landing:true,supplies:['water']});
 const group=buildPilotEvidenceLedger({identity,areaReady:true,facilityRaw:JSON.stringify([first,second]),now}).find(row=>row.id==='reports:facility');
 assert.deepEqual(group.differences,{acceptance:false,landing:true,supplies:['water']});
 assert.deepEqual(facilityReportDifferences([first,second],identity,Date.parse('2026-11-03T12:31:00Z')),{acceptance:false,landing:false,supplies:[]});
 const other={...second,id:'three',supply:'food'};
 assert.deepEqual(facilityReportDifferences([first,other],identity,now).supplies,[]);
 assert.deepEqual(facilityReportDifferences([first,second],{...identity,name:'別施設'},now),{acceptance:false,landing:false,supplies:[]});
});
