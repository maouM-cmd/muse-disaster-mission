import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fleetPresentation, decisionCardView } from './readiness.mjs';

test('comparison labels fixed and unverified sources without calling them Muse',()=>{
 const make=provenance=>({phase:'detour',comparison:{input:{distanceIncluded:true,provenance},reply:{nagi:{choice:'A',reason:'案'},elapsedMs:1},baseline:{choice:'A',elapsedMs:1}}});
 for(const source of ['fixture','unknown']){const view=decisionCardView(make(source));assert.doesNotMatch(view.reply,/Muse/);assert.match(view.reply,source==='fixture'?/試験/:/不明/)}
 assert.match(decisionCardView(make('muse')).reply,/Muse/);
});

test('fleet presentation uses actual states and reserve capacity', () => {
  const data={phase:'consulting',active:true,summary:{holding:12,outbound:0,returning:0,stopped:0},cargo:{manifest:{spare:88}}};
  const view=fleetPresentation(data);
  assert.equal(view.step,3);
  assert.match(view.status,/回答待ち/);
  assert.match(view.counts,/相談待ち 12機/);
  assert.match(view.counts,/予備 88機/);
  assert.doesNotMatch(view.counts,/移動中 12機/);
});

test('waiting for approval and failure never display a completed delivery', () => {
  assert.match(fleetPresentation({phase:'approval',active:true,summary:{holding:3}}).status,/承認/);
  for(const phase of ['stopped','error']) {
    const view=fleetPresentation({phase,active:false,summary:{stopped:3}});
    assert.equal(view.stopped,true);
    assert.match(view.status,/停止|開始できません/);
    assert.doesNotMatch(view.status,/完了/);
  }
  assert.match(fleetPresentation({phase:'complete',active:false,summary:{complete:3,stopped:1}}).status,/停止/);
  assert.match(fleetPresentation({phase:'complete',active:false,summary:{complete:3,stopped:0}}).status,/帰還/);
});

test('recovery presentation explains new route inspection and Muse retry',()=>{
  const comparison={attempt:2},summary={holding:12};
  const inspecting=fleetPresentation({phase:'inspection',comparison,summary});
  const consulting=fleetPresentation({phase:'consulting',comparison,summary});
  assert.match(inspecting.status,/別の仮想経路.*点検/);
  assert.match(consulting.status,/再相談/);
  assert.match(consulting.counts,/相談待ち 12機/);
  assert.doesNotMatch(consulting.status,/完了|停止/);
});
