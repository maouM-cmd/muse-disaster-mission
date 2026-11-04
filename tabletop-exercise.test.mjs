import test from 'node:test';
import assert from 'node:assert/strict';
import {createExerciseRecord,decodeExerciseRecords,appendExerciseRecord,recordExerciseObservation,removeExerciseRecord} from './readiness.mjs';
const base={scenario:'facility-refused',decision:'confirm',observed:['facility','communications'],notes:'再確認を依頼',startedAt:'2026-11-03T10:00:00.000Z',finishedAt:'2026-11-03T10:02:00.000Z'};
test('training record keeps human choice and observed facts without grading or operational claims',()=>{
 const record=createExerciseRecord(base);assert.equal(record.kind,'tabletop-training');assert.equal(record.scenario,'facility-refused');assert.deepEqual(record.observed,['facility','communications']);assert.equal(record.durationSeconds,120);assert.equal(record.decision,'confirm');assert.ok(!Object.hasOwn(record,'safety'));assert.ok(!Object.hasOwn(record,'score'));
});
test('invalid timestamps, options, duplicates and long notes are rejected',()=>{
 for(const bad of [{decision:'approve'},{scenario:'real'},{observed:['facility','facility']},{observed:['unknown']},{notes:'x'.repeat(301)},{finishedAt:'invalid'},{finishedAt:'2026-11-03T09:59:59.000Z'}])assert.throws(()=>createExerciseRecord({...base,...bad}));
});
test('records round-trip, reject corrupt history and are bounded',()=>{
 const record=createExerciseRecord(base);const data=appendExerciseRecord(null,record);assert.equal(decodeExerciseRecords(data).records.length,1);assert.equal(decodeExerciseRecords('{bad').status,'corrupt');assert.throws(()=>appendExerciseRecord('{bad',record));let raw=null;for(let i=0;i<20;i++)raw=appendExerciseRecord(raw,record);assert.throws(()=>appendExerciseRecord(raw,record));
});
test('new records preserve the exact presented messages, language and reveal time while old records stay readable',()=>{
 const presentation={initial:{text:'最初の訓練文',lang:'ja'},update:{text:'Update shown',lang:'en',shownAt:'2026-11-03T10:01:00.000Z'}};
 const original=createExerciseRecord(base),record=createExerciseRecord({...base,presentation});
 assert.deepEqual(record.presentation,presentation);presentation.initial.text='changed afterwards';assert.equal(record.presentation.initial.text,'最初の訓練文');
 let raw=appendExerciseRecord(null,original);raw=appendExerciseRecord(raw,record);const decoded=decodeExerciseRecords(raw);assert.equal(decoded.status,'ok');assert.deepEqual(decoded.records,[record,original]);assert.equal(Object.hasOwn(decoded.records[1],'presentation'),false);
});
test('invalid presentation data cannot be saved or turn an unreadable history into an empty history',()=>{
 const p={initial:{text:'initial',lang:'ja'},update:{text:'update',lang:'en',shownAt:'2026-11-03T10:01:00.000Z'}};
 for(const bad of [{...p,initial:{text:'',lang:'ja'}},{...p,initial:{text:'x'.repeat(501),lang:'ja'}},{...p,initial:{text:'x',lang:'xx'}},{...p,update:{...p.update,shownAt:'2026-11-03T09:59:00.000Z'}},{...p,update:{...p.update,shownAt:'2026-11-03T10:03:00.000Z'}},{...p,update:{...p.update,shownAt:'2026-11-03T10:01:00'}},{...p,update:{...p.update,extra:'unknown'}}])assert.throws(()=>createExerciseRecord({...base,presentation:bad}));
 const record=createExerciseRecord({...base,presentation:p});record.presentation.update.shownAt='bad';assert.equal(decodeExerciseRecords(JSON.stringify([record])).status,'corrupt');assert.throws(()=>appendExerciseRecord(JSON.stringify([record]),createExerciseRecord(base)));
});
test('an observer can append a separate observation without changing the participant record',()=>{
 const record=createExerciseRecord(base),raw=appendExerciseRecord(null,record),note={at:'2026-11-03T10:05:00.000Z',focus:'communications',observed:'uncertain',workload:'not_asked',note:'要確認'};
 const saved=recordExerciseObservation(raw,record,note),result=decodeExerciseRecords(saved).records[0];assert.deepEqual(result.reviews,[note]);const {reviews,...participant}=result;assert.deepEqual(participant,record);assert.deepEqual(decodeExerciseRecords(raw).records,[record]);
 assert.throws(()=>recordExerciseObservation(saved,record,note));assert.equal(decodeExerciseRecords(saved).status,'ok');
});
test('observer notes reject ambiguous, invalid, stale, missing and excessive records',()=>{
 const record=createExerciseRecord(base),raw=appendExerciseRecord(null,record),note={at:'2026-11-03T10:05:00.000Z',focus:'facility',observed:'acknowledged',workload:'high',note:''};
 for(const bad of [{...note,focus:'invented'},{...note,observed:'safe'},{...note,workload:'unknown'},{...note,note:'x'.repeat(301)},{...note,at:'2026-11-03T09:00:00.000Z'},{...note,at:'2026-11-03T10:05:00'},{...note,extra:1}])assert.throws(()=>recordExerciseObservation(raw,record,bad));
 assert.throws(()=>recordExerciseObservation('[]',record,note));assert.throws(()=>recordExerciseObservation(JSON.stringify([record,record]),record,note));assert.throws(()=>recordExerciseObservation('{bad',record,note));
 let history=raw,current=record;for(let i=0;i<10;i++){history=recordExerciseObservation(history,current,note);current=decodeExerciseRecords(history).records[0]}assert.throws(()=>recordExerciseObservation(history,current,note));
});
test('remove exactly one matching exercise without changing others; refuse ambiguous or stale records',()=>{
 const a=createExerciseRecord(base),b=createExerciseRecord({...base,decision:'hold'}),raw=JSON.stringify([a,b]);
 assert.deepEqual(decodeExerciseRecords(removeExerciseRecord(raw,a)).records,[b]);assert.deepEqual(decodeExerciseRecords(raw).records,[a,b]);
 assert.throws(()=>removeExerciseRecord(raw,{...a,notes:'changed'}));assert.throws(()=>removeExerciseRecord(JSON.stringify([a,a]),a));assert.throws(()=>removeExerciseRecord('{bad',a));
});
