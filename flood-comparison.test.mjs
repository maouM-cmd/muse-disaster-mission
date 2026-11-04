import test from 'node:test';
import assert from 'node:assert/strict';
import {createFloodFieldReport,decodeFloodFieldReports,appendFloodFieldReport,buildFloodComparison} from './readiness.mjs';
const now=Date.parse('2026-11-03T12:00:00.000Z');
const identity={area:'13118',name:'原中学校',address:'東京都荒川区'};
const report={...identity,id:'report-1',status:'water_seen',scope:'nearby_road',observedAt:'2026-11-03T11:30:00.000Z',expiresAt:'2026-11-03T12:30:00.000Z',organization:'施設管理者',source:'電話',note:'校門付近'};
const flood={shelter:identity.name,address:identity.address,state:'ready',depth:'3.0〜5.0m',checkedAt:'2026-11-03T11:00:00.000Z'};
test('a local field report carries scope, time, source, and never becomes a verified observation',()=>{
 const r=createFloodFieldReport(report,now);assert.equal(r.provenance,'human_report');assert.equal(r.scope,'nearby_road');
 const raw=appendFloodFieldReport(null,r,identity);const comp=buildFloodComparison({identity,forecast:flood,raw,now});
 assert.equal(comp.forecast.depth,'3.0〜5.0m');assert.equal(comp.forecast.kind,'scenario');assert.equal(comp.forecast.updatedAt,null);
 assert.equal(comp.reports[0].state,'reported');assert.equal(comp.reports[0].status,'water_seen');
});
test('expired reports, changed facility, missing data and corrupted storage remain unknown',()=>{
 const raw=appendFloodFieldReport(null,createFloodFieldReport(report,now),identity);
 assert.equal(buildFloodComparison({identity,forecast:flood,raw,now:Date.parse(report.expiresAt)}).reports[0].state,'expired');
 const other={...identity,name:'別施設'};assert.equal(buildFloodComparison({identity:other,forecast:flood,raw,now}).forecast.depth,null);
 assert.equal(decodeFloodFieldReports(raw,other).status,'corrupt');
 assert.equal(buildFloodComparison({identity,forecast:null,raw:'{',now}).reportsStatus,'corrupt');
 assert.throws(()=>createFloodFieldReport({...report,observedAt:'2026-11-03T13:00:00.000Z'},now));
 assert.throws(()=>createFloodFieldReport({...report,status:'safe'},now));
 assert.throws(()=>createFloodFieldReport({...report,expiresAt:'2026-11-03T11:00:00.000Z'},now));
});
test('field report rejects normalized invalid dates and missing offsets while preserving unreadable stored data',()=>{
 for(const fields of [
  {observedAt:'2026-02-30T10:00:00Z',expiresAt:'2026-03-04T10:00:00Z'},
  {observedAt:'2026-02-28T10:00:00Z',expiresAt:'2026-02-30T10:00:00Z'},
  {observedAt:'2026-11-03T10:00:00',expiresAt:'2026-11-03T12:30:00Z'},
 ])assert.throws(()=>createFloodFieldReport({...report,...fields},now),/日時|時刻/);
 const legacy=JSON.stringify([{...report,provenance:'human_report',observedAt:'2026-02-30T10:00:00Z',expiresAt:'2026-03-04T10:00:00Z'}]);
 assert.equal(decodeFloodFieldReports(legacy,identity).status,'corrupt');
 assert.throws(()=>appendFloodFieldReport(legacy,createFloodFieldReport(report,now),identity));
});
test('different reports remain separate and duplicate submissions or corrupt data cannot be overwritten',()=>{
 const one=createFloodFieldReport(report,now),first=appendFloodFieldReport(null,one,identity);
 const two=createFloodFieldReport({...report,id:'report-2',status:'no_water_seen'},now);
 const saved=appendFloodFieldReport(first,two,identity);assert.deepEqual(decodeFloodFieldReports(saved,identity).reports.map(x=>x.status),['no_water_seen','water_seen']);
 assert.throws(()=>appendFloodFieldReport(saved,{...two,id:'report-3'},identity),/同じ/);
 assert.throws(()=>appendFloodFieldReport('{',two,identity));
});

test('identifiers and timestamps must remain explicit and future data is not current',()=>{
 assert.throws(()=>createFloodFieldReport({...report,id:undefined},now));
 assert.throws(()=>createFloodFieldReport({...report,area:13118},now));
 const r=createFloodFieldReport(report,now),raw=appendFloodFieldReport(null,r,identity);
 assert.equal(buildFloodComparison({identity,forecast:flood,raw,now:Date.parse('2026-11-03T11:00:00Z')}).reports[0].state,'time_unknown');
});

test('only unexpired differing human reports about the same stated scope are flagged for review',()=>{
 const one=createFloodFieldReport(report,now);const two=createFloodFieldReport({...report,id:'report-2',status:'no_water_seen'},now);
 const raw=appendFloodFieldReport(appendFloodFieldReport(null,one,identity),two,identity);
 assert.deepEqual(buildFloodComparison({identity,forecast:flood,raw,now}).differingScopes,['nearby_road']);
 assert.deepEqual(buildFloodComparison({identity,forecast:flood,raw,now:Date.parse(report.expiresAt)}).differingScopes,[]);
 const other=createFloodFieldReport({...report,id:'report-3',status:'no_water_seen',scope:'facility_point'},now);
 const separate=appendFloodFieldReport(appendFloodFieldReport(null,one,identity),other,identity);
 assert.deepEqual(buildFloodComparison({identity,forecast:flood,raw:separate,now}).differingScopes,[]);
});
