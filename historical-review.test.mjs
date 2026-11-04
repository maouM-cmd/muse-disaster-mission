import test from 'node:test';
import assert from 'node:assert/strict';
import {createHistoricalReview,decodeHistoricalReviews,appendHistoricalReview} from './readiness.mjs';

const sample={id:'r-1',caseId:'joso-2015',assessments:{'joso-nied-20150911-am':'water-like','joso-20150911-pm':'uncertain','joso-20150915-am':'unavailable'},limitations:['time','alignment'],notes:'試験用',recordedAt:'2026-11-04T00:00:00.000Z'};
test('historical reviews preserve each image assessment and explicit uncertainty without asserting safety',()=>{
 const row=createHistoricalReview(sample);assert.deepEqual(row.assessments,sample.assessments);assert.deepEqual(row.limitations,sample.limitations);assert.equal(row.caseId,'joso-2015');
 assert.equal(decodeHistoricalReviews(appendHistoricalReview(null,row)).status,'ok');
});
test('invalid or incomplete image assessments cannot be saved',()=>{
 assert.throws(()=>createHistoricalReview({...sample,assessments:{'joso-20150911-pm':'water-like'}}));
 assert.throws(()=>createHistoricalReview({...sample,assessments:{...sample.assessments,'joso-20150915-am':'safe'}}));
 assert.throws(()=>createHistoricalReview({...sample,caseId:'mabi-2018'}));
 assert.throws(()=>createHistoricalReview({...sample,limitations:['invented']}));
});
test('corrupt, duplicate and full records are not silently overwritten',()=>{
 const row=createHistoricalReview(sample),saved=appendHistoricalReview(null,row);
 assert.throws(()=>appendHistoricalReview(saved,row));assert.throws(()=>appendHistoricalReview('{bad',row));
 const full=Array.from({length:20},(_,i)=>createHistoricalReview({...sample,id:`r-${i}`}));assert.throws(()=>appendHistoricalReview(JSON.stringify(full),row));
});
