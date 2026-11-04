import test from 'node:test';import assert from 'node:assert/strict';import {jmaMunicipalRainExcerpt} from './geo-data.mjs';
import {parseZonedTimestamp} from './geo-data.mjs';

test('JMA timestamps reject normalized impossible dates and require a valid timezone',()=>{
 for(const value of ['2026-02-30T10:00:00+09:00','2025-02-29T10:00:00Z','2026-04-31T10:00:00Z','2026-11-04T24:00:00Z','2026-11-04T10:60:00Z','2026-11-04T10:00:00','2026-11-04T10:00:00+14:01','2026-11-04T10:00:00+09:99'])assert.equal(parseZonedTimestamp(value),null,value);
 for(const value of ['2024-02-29T10:00:00+09:00','2026-11-04T00:41:15.699Z','2026-11-04T09:39:41+09:00'])assert.equal(parseZonedTimestamp(value),Date.parse(value));
});
import {jmaWarningProofState,selectJmaWarningProof,weatherSummary} from './geo-data.mjs';

test('warning proof is unknown if a candidate cannot be checked or matching reports conflict',()=>{
 assert.equal(selectJmaWarningProof([{available:true,state:'normal'},{available:true,state:'unmatched'}]),'normal');
 assert.equal(selectJmaWarningProof([{available:true,state:'normal'},{available:true,state:'unknown'}]),'unknown');
 assert.equal(selectJmaWarningProof([{available:true,state:'normal'},{available:false,state:'unknown'}]),'unknown');
 assert.equal(selectJmaWarningProof([{available:true,state:'normal'},{available:true,state:'training'}]),'unknown');
 assert.equal(selectJmaWarningProof([]),'unknown');
});
const bulletin={dataTypeCode:'VPWW55',reportDatetime:'2026-11-03T15:00:00+09:00',controlDatetime:'2026-11-03T15:01:00+09:00',infoType:'発表',publishingOffice:'気象庁',warning:{class20Items:[{areaCode:'1311800',kinds:[{status:'発表警報・注意報はなし'}]},{areaCode:'1310100',kinds:[{code:'10',status:'解除'}]}]}};
test('warning status requires matching bulletin metadata and never promotes training or unknown data',()=>{
 const proof={status:'通常',controlAt:bulletin.controlDatetime,published:bulletin.reportDatetime,office:bulletin.publishingOffice,infoType:'発表'};
 assert.equal(jmaWarningProofState(bulletin,proof),'normal');assert.equal(jmaWarningProofState(bulletin,{...proof,status:'訓練'}),'training');assert.equal(jmaWarningProofState(bulletin,{...proof,status:'試験'}),'test');
 assert.equal(jmaWarningProofState(bulletin,{...proof,office:'別の官署'}),'unknown');assert.equal(jmaWarningProofState(bulletin,{...proof,controlAt:'2026-11-03T15:02:00+09:00'}),'unknown');assert.equal(jmaWarningProofState(bulletin,null),'unknown');assert.equal(jmaWarningProofState(bulletin,{...proof,status:'不明'}),'unknown');
});
test('impossible warning timestamps cannot match, appear in excerpts, or become a fresh announcement',()=>{
 for(const date of ['2026-02-30T10:00:00+09:00','2026-04-31T10:00:00Z','2026-11-04T10:00:00','2026-11-04T10:00:00+14:01']){
  const bad={...bulletin,reportDatetime:date,controlDatetime:date},proof={status:'通常',controlAt:date,published:date,office:bulletin.publishingOffice,infoType:'発表'};
  assert.equal(jmaWarningProofState(bad,proof),'unknown',date);assert.equal(jmaMunicipalRainExcerpt(bad,'13118').published,null,date);assert.equal(jmaMunicipalRainExcerpt(bad,'13118').controlAt,null,date);assert.throws(()=>weatherSummary(bad,Date.now()),undefined,date);
 }
 const offsetProof={status:'通常',controlAt:'2026-11-03T06:01:00Z',published:'2026-11-03T06:00:00Z',office:bulletin.publishingOffice,infoType:'発表'};assert.equal(jmaWarningProofState(bulletin,offsetProof),'normal');
});
test('municipality excerpt preserves the official status and code without inventing safety',()=>{
 const x=jmaMunicipalRainExcerpt(bulletin,'13101');assert.equal(x.scope,'1310100');assert.deepEqual(x.kinds,[{code:'10',status:'解除'}]);assert.equal(x.infoType,'発表');assert.equal(x.published,bulletin.reportDatetime);assert.equal(x.controlAt,bulletin.controlDatetime);assert.ok(!Object.hasOwn(x,'safe'));
 assert.deepEqual(jmaMunicipalRainExcerpt(bulletin,'13118').kinds,[{code:null,status:'発表警報・注意報はなし'}]);
});
test('missing, duplicate, malformed or unrelated municipality data is unknown, not no warning',()=>{
 assert.equal(jmaMunicipalRainExcerpt(bulletin,'99999'),null);assert.equal(jmaMunicipalRainExcerpt({...bulletin,dataTypeCode:'VPWW58'},'13118'),null);assert.equal(jmaMunicipalRainExcerpt({...bulletin,warning:{class20Items:[bulletin.warning.class20Items[0],bulletin.warning.class20Items[0]]}},'13118'),null);assert.equal(jmaMunicipalRainExcerpt({...bulletin,warning:{class20Items:[{areaCode:'1311800',kinds:[{}]}]}},'13118'),null);assert.equal(jmaMunicipalRainExcerpt(bulletin,'1311800'),null);
});

test('a cancelled bulletin or unknown information type cannot be treated as a current announcement',async()=>{
 const {jmaBulletinState}=await import('./geo-data.mjs');assert.equal(jmaBulletinState('発表'),'usable');assert.equal(jmaBulletinState('訂正'),'usable');assert.equal(jmaBulletinState('取消'),'cancelled');assert.equal(jmaBulletinState('試験'),'unknown');assert.equal(jmaBulletinState(undefined),'unknown');
});
