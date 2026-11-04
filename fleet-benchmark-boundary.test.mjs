import test from 'node:test';
import assert from 'node:assert/strict';
import {benchmarkBoundaryCases} from './evidence/fleet-benchmark-boundary-cases.mjs';
import {validFleetEvidence} from './meta.mjs';
import {baselineFleetChoice,isUsableFleetCandidate} from './fleet-coordination.mjs';

test('independently labelled fictional boundary cases match the stated eligibility rules',()=>{
 const cases=benchmarkBoundaryCases();assert.equal(cases.length,7);assert.equal(new Set(cases.map(item=>item.id)).size,7);
 for(const item of cases){
  assert.equal(validFleetEvidence(item.evidence),true,item.id);
  const actual=['A','B'].filter(side=>isUsableFleetCandidate(item.evidence.candidates[side],item.evidence.distances[side]));
  assert.deepEqual(actual,item.eligible,item.id);
  assert.equal(baselineFleetChoice(item.evidence).choice,item.expectedBaseline,item.id);
 }
});
