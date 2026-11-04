import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isUsableFleetCandidate,baselineFleetChoice} from './fleet-coordination.mjs';
import {decisionCardView,recordFleetComparisonReview} from './readiness.mjs';

const good={avoidsHazard:true,total:4,observed:4,unknown:0,blocked:0,maxGap:20};
const bad={...good,observed:3,unknown:1};
const distance={totalM:250};
test('baseline uses the same candidate checks, preferring the original destination',()=>{
  const evidence={candidates:{A:good,B:good},distances:{A:distance,B:distance}};
  assert.equal(isUsableFleetCandidate(good,distance),true);
  assert.equal(baselineFleetChoice(evidence).choice,'A');
  assert.equal(baselineFleetChoice({...evidence,candidates:{A:bad,B:good}}).choice,'B');
});
test('decision card distinguishes sent evidence, model reply and app checks',()=>{
  const data={phase:'rechecking',comparison:{input:{attemptedAt:'2026-11-03T00:00:00Z',distanceIncluded:true},evidence:{affected:12,candidates:{A:good,B:bad},distances:{A:distance,B:distance}},baseline:{choice:'A',elapsedMs:1},reply:{nagi:{choice:'A',reason:'actual model text'},elapsedMs:200},verdict:null}};
  const view=decisionCardView(data,'en');
  assert.match(view.input,/map image/i);assert.match(view.reply,/actual model text/);assert.match(view.baseline,/A/);assert.match(view.verdict,/recheck/i);
  assert.match(decisionCardView({phase:'inspection',comparison:{evidence:data.comparison.evidence}},'en').input,/not yet/i);
  assert.match(decisionCardView({phase:'stopped',comparison:{error:'timeout'}},'en').reply,/timeout/);
  const retry=decisionCardView({phase:'consulting',comparison:{previousAttempts:[{reply:{nagi:{choice:'none',reason:'first answer'}}}]}},'en');
  assert.match(retry.reply,/previous/i);assert.match(retry.reply,/first answer/);
  const stopped=decisionCardView({phase:'stopped',comparison:{verdict:{state:'approved',side:'A'}}},'en');
  assert.match(stopped.verdict,/stopped/i);
  const failed=decisionCardView({phase:'stopped',comparison:{error:'timeout',previousAttempts:[{reply:{nagi:{choice:'none',reason:'first answer'}}}],baseline:{choice:'A',elapsedMs:1}}},'en');
  assert.match(failed.reply,/timeout/);assert.match(failed.reply,/first answer/);assert.match(failed.baseline,/different candidates/);
});
test('unknown or missing evidence cannot produce a candidate',()=>{
  assert.equal(isUsableFleetCandidate(bad,distance),false);
  assert.equal(isUsableFleetCandidate(good,null),false);
  assert.equal(baselineFleetChoice({candidates:{A:bad,B:bad},distances:{A:distance,B:distance}}).choice,'none');
  assert.equal(baselineFleetChoice(null).choice,'none');
});
test('a human can record a comparison judgment without changing the simulated outcome',()=>{
 const record={id:'run-1',area:'荒川区',startedAt:'2026-11-04T01:00:00.000Z',finishedAt:'2026-11-04T02:00:00.000Z',total:1,delivered:0,stopped:1,units:[{}],events:[],comparison:{baseline:{choice:'A'},reply:{nagi:{choice:'B'}}}};
 const raw=JSON.stringify([record]);const review={choice:'baseline',reason:'missing_data',note:'追加の確認が必要',at:'2026-11-04T02:01:00.000Z'};
 const saved=JSON.parse(recordFleetComparisonReview(raw,record,review))[0];assert.deepEqual(saved.comparison,record.comparison);assert.equal(saved.delivered,0);assert.deepEqual(saved.comparisonReviews,[review]);
 assert.throws(()=>recordFleetComparisonReview(JSON.stringify([saved]),record,review));
 assert.throws(()=>recordFleetComparisonReview(raw,record,{...review,choice:'safe'}));
 const noReply={...record,comparison:{baseline:{choice:'A'}}};assert.throws(()=>recordFleetComparisonReview(JSON.stringify([noReply]),noReply,{...review,choice:'muse'}));
 const newer={...record,id:'run-2'};assert.throws(()=>recordFleetComparisonReview(JSON.stringify([newer,record]),record,review),/新しい記録/);
 assert.throws(()=>recordFleetComparisonReview(raw,record,{...review,at:'2026-11-04T01:30:00.000Z'}),/時刻/);
});
