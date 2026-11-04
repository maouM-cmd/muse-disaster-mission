import test from 'node:test';
import assert from 'node:assert/strict';
import {createRiskReview,decodeRiskReviews,appendRiskReview,riskReviewState,buildPilotEvidenceLedger} from './readiness.mjs';

const input={area:'13118',product:'inundation',appearance:'yellow',checkedAt:'2026-11-03T10:00:00.000Z',recordedAt:'2026-11-03T10:02:00.000Z'};
test('manual risk review preserves its region, type, appearance and declared check time',()=>{
 const record=createRiskReview(input);
 assert.equal(record.kind,'manual-risk-review');assert.equal(record.area,'13118');assert.equal(record.product,'inundation');assert.equal(record.appearance,'yellow');assert.equal(record.checkedAt,input.checkedAt);assert.equal(record.recordedAt,input.recordedAt);
 assert.deepEqual(decodeRiskReviews(appendRiskReview(null,record,'13118'),'13118').records,[record]);
});
test('review rejects unknown region, category, future check and misplaced history',()=>{
 for(const invalid of [{area:'99999'},{product:'imaginary'},{appearance:'safe'},{checkedAt:'2026-11-04T00:00:00.000Z'},{checkedAt:'bad'}])assert.throws(()=>createRiskReview({...input,...invalid}));
 const raw=JSON.stringify([createRiskReview(input)]);
 assert.equal(decodeRiskReviews(raw,'13101').status,'corrupt');assert.equal(decodeRiskReviews('{bad','13118').status,'corrupt');assert.throws(()=>appendRiskReview('{bad',createRiskReview(input),'13118'));
});
test('review history is bounded and never silently overwrites an existing record',()=>{
 let raw=null;for(let i=0;i<20;i++)raw=appendRiskReview(raw,createRiskReview(input),'13118');
 assert.throws(()=>appendRiskReview(raw,createRiskReview(input),'13118'));assert.equal(decodeRiskReviews(raw,'13118').records.length,20);
});
test('review deadlines preserve old notes and clearly separate planned, due and invalid device time',()=>{
 const old=createRiskReview(input);assert.equal(riskReviewState(old,Date.parse('2026-11-03T11:00:00Z')),'review_unspecified');
 const record=createRiskReview({...input,reviewBy:'2026-11-03T11:00:00.000Z'});
 assert.equal(riskReviewState(record,Date.parse('2026-11-03T10:30:00Z')),'review_due_later');assert.equal(riskReviewState(record,Date.parse('2026-11-03T11:00:00Z')),'review_due');assert.equal(riskReviewState(record,Date.parse('2026-11-03T10:01:00Z')),'time_unknown');
 assert.throws(()=>createRiskReview({...input,reviewBy:'2026-11-03T10:00:00.000Z'}));assert.equal(decodeRiskReviews(JSON.stringify([old,record]),'13118').status,'ok');
});
test('source ledger displays a self-reported risk note separately from official observations and avoids stale areas',()=>{
 const note=createRiskReview({...input,reviewBy:'2026-11-03T11:00:00.000Z'}),raw=JSON.stringify([note]),identity={area:'13118',name:'',address:''};
 const rows=buildPilotEvidenceLedger({identity,areaReady:true,riskRaw:raw,now:Date.parse('2026-11-03T11:30:00Z')});
 const record=rows.find(row=>row.kind==='manual_risk_review');assert.equal(record.state,'review_due');assert.equal(record.appearance,'yellow');assert.equal(record.checkedAt,note.checkedAt);assert.equal(record.recordedAt,note.recordedAt);assert.equal(record.sourceUpdatedAt,null);assert.match(record.sourceUrl,/^https:\/\/www\.jma\.go\.jp\/bosai\/risk\//);
 for(const args of [{identity,areaReady:false,riskRaw:raw},{identity:{...identity,area:'13101'},areaReady:true,riskRaw:raw},{identity,areaReady:true,riskRaw:'{broken'}])assert.equal(buildPilotEvidenceLedger(args).some(row=>row.kind==='manual_risk_review'),false);
});
test('different reports at the same product and review time remain visible as differing statements',()=>{
 const a=createRiskReview(input),b=createRiskReview({...input,appearance:'red'}),c=createRiskReview({...input,product:'flood',appearance:'black'});
 const rows=buildPilotEvidenceLedger({identity:{area:'13118',name:'',address:''},areaReady:true,riskRaw:JSON.stringify([a,b,c]),now:Date.parse('2026-11-03T11:30:00Z')}).filter(r=>r.kind==='manual_risk_review');
 assert.equal(rows.length,3);assert.equal(rows.find(r=>r.appearance==='yellow').differing,true);assert.equal(rows.find(r=>r.appearance==='red').differing,true);assert.equal(rows.find(r=>r.product==='flood').differing,false);
});
