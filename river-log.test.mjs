import test from 'node:test';
import assert from 'node:assert/strict';
import {riverPilotStations,createRiverLogEntry,decodeRiverLog,appendRiverLog,riverLogState} from './geo-data.mjs';
const station=riverPilotStations('13118')[0];
const input={stationId:station.id,reference:station.levelUrl,value:1.25,at:'2026-11-03T01:00:00.000Z',recordedAt:'2026-11-03T01:10:00.000Z',reviewBy:'2026-11-03T01:30:00.000Z'};
test('manual river log preserves observation, recording and optional review times separately',()=>{
 const record=createRiverLogEntry(input,station);assert.equal(record.kind,'manual-river-note');assert.equal(record.value,1.25);assert.equal(record.at,input.at);assert.equal(record.recordedAt,input.recordedAt);assert.equal(record.reviewBy,input.reviewBy);
 assert.equal(riverLogState(record,Date.parse('2026-11-03T01:15:00Z')),'review_due_later');assert.equal(riverLogState(record,Date.parse('2026-11-03T01:30:00Z')),'review_due');assert.equal(riverLogState(record,Date.parse('2026-11-03T01:05:00Z')),'time_unknown');
 const noDue=createRiverLogEntry({...input,reviewBy:null},station);assert.equal(riverLogState(noDue,Date.parse('2026-11-03T01:15:00Z')),'review_unspecified');
});
test('invalid station, value, dates and invalid ordering never produce records',()=>{
 for(const wrong of [{stationId:'bad'},{reference:'https://example.com'}, {value:NaN},{value:1001},{at:'no'},{at:'2026-11-03T01:11:00.000Z'},{reviewBy:'2026-11-03T01:05:00.000Z'}])assert.throws(()=>createRiverLogEntry({...input,...wrong},station));
});
test('manual log retains conflicting values, rejects exact duplicate and refuses corrupt storage',()=>{
 const a=createRiverLogEntry(input,station),b=createRiverLogEntry({...input,value:1.3},station);let raw=appendRiverLog(null,a,station);raw=appendRiverLog(raw,b,station);assert.equal(decodeRiverLog(raw,station).records.length,2);assert.throws(()=>appendRiverLog(raw,a,station));assert.equal(decodeRiverLog('{bad',station).status,'corrupt');assert.throws(()=>appendRiverLog('{bad',a,station));
});
test('a self-reported level datum is retained without changing old records or assuming their datum',()=>{
 const old=createRiverLogEntry(input,station),known=createRiverLogEntry({...input,datum:'AP'},station);assert.equal(Object.hasOwn(old,'datum'),false);assert.equal(known.datum,'AP');assert.throws(()=>createRiverLogEntry({...input,datum:'invalid'},station));
 let raw=appendRiverLog(null,old,station);raw=appendRiverLog(raw,known,station);assert.equal(decodeRiverLog(raw,station).records.length,2);assert.throws(()=>appendRiverLog(raw,known,station));assert.deepEqual(decodeRiverLog(JSON.stringify([old]),station).records,[old]);
});
test('valid river records survive reordered object keys while unexpected fields remain rejected',()=>{
 const entry=createRiverLogEntry({...input,datum:'AP'},station),reordered=Object.fromEntries(Object.entries(entry).reverse());
 assert.deepEqual(decodeRiverLog(JSON.stringify([reordered]),station),{status:'ok',records:[reordered]});
 assert.equal(decodeRiverLog(JSON.stringify([{...entry,extra:'unverified'}]),station).status,'corrupt');
 assert.equal(decodeRiverLog(JSON.stringify([{...entry,datum:'forged'}]),station).status,'corrupt');
});
