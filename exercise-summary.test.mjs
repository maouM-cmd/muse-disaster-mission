import test from 'node:test';import assert from 'node:assert/strict';import * as readiness from './readiness.mjs';
const start='2026-11-03T10:00:00.000Z',finish='2026-11-03T10:02:00.000Z';
const make=(scenario,decision,observed,seconds,extra={})=>readiness.createExerciseRecord({scenario,decision,observed,notes:'DO NOT EXPORT participant note',startedAt:start,finishedAt:new Date(Date.parse(start)+seconds*1000).toISOString(),...extra});
const review={at:'2026-11-03T10:05:00.000Z',focus:'communications',observed:'uncertain',workload:'not_asked',note:'DO NOT EXPORT observer note'};
test('exercise summary counts records and observation entries without grading or exporting notes',()=>{
 assert.equal(typeof readiness.summarizeExerciseRecords,'function');
 const a=make('facility-refused','hold',['facility'],120,{reviews:[review,review]}),b=make('facility-refused','confirm',[],60),c=make('conflicting-reports','alternate',['conflict'],30);
 const s=readiness.summarizeExerciseRecords(JSON.stringify([a,b,c]));assert.equal(s.status,'ok');assert.equal(s.recordCount,3);assert.equal(s.observationCount,2);
 const x=s.scenarios.find(x=>x.scenario==='facility-refused');assert.equal(x.recordCount,2);assert.deepEqual(x.decisions,{hold:1,confirm:1,alternate:0});assert.deepEqual(x.durationSeconds,{min:60,median:90,max:120});assert.equal(x.selfReported.facility,1);assert.equal(x.noObserverRecords,1);assert.equal(x.observations.communications.uncertain,2);assert.equal(x.workloads.not_asked,2);
 assert.doesNotMatch(JSON.stringify(s),/DO NOT EXPORT|2026-11-03|score|safety|participant/i);
 const y=s.scenarios.find(x=>x.scenario==='conflicting-reports');assert.equal(y.recordCount,1);assert.equal(y.durationSeconds.median,30);assert.equal(y.noObserverRecords,1);
});
test('empty and unreadable records cannot become successful zero-count evidence',()=>{
 assert.equal(readiness.summarizeExerciseRecords(null).status,'empty');assert.equal(readiness.summarizeExerciseRecords('[]').status,'empty');
 for(const raw of ['{bad',JSON.stringify([{kind:'tabletop-training'}]),' '.repeat(256001)]){const result=readiness.summarizeExerciseRecords(raw);assert.equal(result.status,'corrupt');assert.equal(Object.hasOwn(result,'recordCount'),false)}
});
