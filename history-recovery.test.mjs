import test from 'node:test';
import assert from 'node:assert/strict';
import {createRiskReview,mergeLocalHistories,inspectLocalHistory,reconcileLocalHistory} from './readiness.mjs';
import {riverPilotStations,createRiverLogEntry} from './geo-data.mjs';

function memory(){const data=new Map();return {getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)}}
function versions(){const data=new Map();return {async read(k){return data.has(k)?{exists:true,value:data.get(k)}:{exists:false}},async write(k,v){data.set(k,v)},close(){},data}}
const locks={request:async(_name,_options,callback)=>callback()};
const key='muse-risk-review-v1:13118',base={area:'13118',product:'flood',checkedAt:'2026-11-03T10:00:00.000Z',recordedAt:'2026-11-03T10:01:00.000Z'};
const one=createRiskReview({...base,appearance:'yellow'}),two=createRiskReview({...base,appearance:'red'});
test('merge keeps both different notes and removes only exact duplicates',()=>{
 const result=mergeLocalHistories(key,JSON.stringify([one]),JSON.stringify([one,two]));
 assert.equal(result.mode,'merge');assert.deepEqual(JSON.parse(result.value),[one,two]);
});
test('river recovery treats reordered copies as the same record and retains distinct datums',()=>{
 const station=riverPilotStations('13118')[0],base={stationId:station.id,reference:station.levelUrl,value:1.25,at:'2026-11-03T01:00:00.000Z',recordedAt:'2026-11-03T01:10:00.000Z',reviewBy:null},original=createRiverLogEntry(base,station),reordered=Object.fromEntries(Object.entries(original).reverse()),known=createRiverLogEntry({...base,datum:'AP'},station),key='muse-river-log-v2:iwabuchi-upper';
 const result=mergeLocalHistories(key,JSON.stringify([original]),JSON.stringify([reordered,known]));assert.equal(result.mode,'merge');assert.deepEqual(JSON.parse(result.value),[original,known]);
});
test('invalid records, oversized unions and differing legacy notes are never silently merged',()=>{
 assert.equal(mergeLocalHistories(key,'{bad',JSON.stringify([one])).mode,'unreadable');
 assert.equal(mergeLocalHistories(key,JSON.stringify(Array(20).fill(one)),JSON.stringify(Array.from({length:20},(_,i)=>createRiskReview({...base,checkedAt:`2026-11-03T09:${String(i).padStart(2,'0')}:00.000Z`,appearance:'red'})))).mode,'too_many');
 assert.equal(mergeLocalHistories('muse-river-note-v1:iwabuchi-upper','{"value":1}','{"value":2}').mode,'manual');
});
test('recovery preserves both originals in backup and rejects a stale preview',async()=>{
 const storage=memory(),guard=versions();storage.setItem(key,JSON.stringify([one]));await guard.write(key,JSON.stringify([two]));
 const preview=await inspectLocalHistory({storage,locks,versions:guard,key});
 await reconcileLocalHistory({storage,locks,versions:guard,key,preview,backupId:'test-1'});
 assert.deepEqual(JSON.parse(storage.getItem(key)),[one,two]);
 const backup=[...guard.data].find(([k])=>k.startsWith('recovery-backup:'));assert.ok(backup);assert.equal(JSON.parse(backup[1]).local,JSON.stringify([one]));assert.equal(JSON.parse(backup[1]).committed,JSON.stringify([two]));
 assert.equal((await inspectLocalHistory({storage,locks,versions:guard,key})).latestBackup.id,'test-1');
 storage.setItem(key,JSON.stringify([one]));await assert.rejects(reconcileLocalHistory({storage,locks,versions:guard,key,preview,backupId:'test-2'}));assert.equal(storage.getItem(key),JSON.stringify([one]));
});
test('changing the selected target while backing up never updates the original records',async()=>{
 const storage=memory(),guard=versions();storage.setItem(key,JSON.stringify([one]));await guard.write(key,JSON.stringify([two]));let current=true;
 const preview=await inspectLocalHistory({storage,locks,versions:guard,key});
 const changed={...guard,async write(k,v){await guard.write(k,v);if(k.startsWith('recovery-backup:'))current=false}};
 await assert.rejects(reconcileLocalHistory({storage,locks,versions:changed,key,preview,backupId:'changed',stillCurrent:()=>current}));
 assert.equal(storage.getItem(key),JSON.stringify([one]));assert.equal((await guard.read(key)).value,JSON.stringify([two]));
});
test('an empty copy is flagged as potentially restoring deleted notes',()=>{
 const result=mergeLocalHistories(key,null,JSON.stringify([one]));assert.equal(result.mode,'merge');assert.equal(result.restoresDeleted,true);
});
test('failed backup leaves both values untouched',async()=>{
 const storage=memory(),guard=versions();storage.setItem(key,JSON.stringify([one]));await guard.write(key,JSON.stringify([two]));const preview=await inspectLocalHistory({storage,locks,versions:guard,key});
 const failing={...guard,async write(k,v){if(k.startsWith('recovery-backup:'))throw new Error('quota');return guard.write(k,v)}};
 await assert.rejects(reconcileLocalHistory({storage,locks,versions:failing,key,preview,backupId:'test-3'}));assert.equal(storage.getItem(key),JSON.stringify([one]));assert.equal((await guard.read(key)).value,JSON.stringify([two]));
});
