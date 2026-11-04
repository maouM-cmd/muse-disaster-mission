import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectDepartureSamples} from './delivery.mjs';
import {canReplayMapRoute} from './geo-data.mjs';
import * as geo from './geo-data.mjs';
import {detourStateText, reinspectVerdict} from './readiness.mjs';

test('departure stops when a sampled height is unknown even if others are available', async () => {
  const result = await inspectDepartureSamples(async () => [10, null, 20], 3, {});
  assert.equal(result.report.unknown, 1);
  assert.notEqual(result.decision, 'proceed');
});

test('departure can proceed when every sampled height is available and below the limit', async () => {
  const result = await inspectDepartureSamples(async () => [10, 15, 20], 3, {});
  assert.equal(result.report.unknown, 0);
  assert.equal(result.decision, 'proceed');
});

test('manual replay refuses unknown, inconsistent, or widely spaced route samples', () => {
  const base = {total: 3, observed: 3, unknown: 0, blockedIndices: [], maxGap: 20};
  assert.equal(canReplayMapRoute({A: base}, 'A'), true);
  for (const change of [{observed: 2, unknown: 1}, {unknown: undefined}, {maxGap: 30}, {maxGap: undefined}, {observed: 2}]) {
    assert.equal(canReplayMapRoute({A: {...base, ...change}}, 'A'), false);
  }
  assert.equal(canReplayMapRoute({stale: true, A: base}, 'A'), false);
});

test('either aircraft requires complete, nearby route height samples before movement', () => {
  const base = {total: 3, observed: 3, unknown: 0, blockedIndices: [], maxGap: 20};
  assert.equal(typeof geo.routeReportComplete, 'function');
  assert.equal(geo.routeReportComplete(base), true);
  assert.equal(geo.routeReportComplete({...base, observed:2, unknown:1}), false);
  assert.equal(geo.routeReportComplete({...base, blockedIndices:[1]}), false);
  assert.equal(geo.routeReportComplete({...base, maxGap:30}), false);
});

test('a historical manual completion does not claim automated acceptance', () => {
  const record = {at: 't', area: 'a', side: 'A', state: 'accepted', reason: '手動再生', source: 'manual'};
  assert.match(detourStateText(record), /手動/);
  assert.doesNotMatch(detourStateText(record), /採用可能と判定/);
});

test('automatic reinspection rejects missing, inconsistent, and invalid measurements', () => {
  const base = {total: 3, observed: 3, unknown: 0, blockedIndices: [], maxGap: 20};
  assert.equal(reinspectVerdict(base).ok, true);
  for (const change of [{unknown: undefined}, {maxGap: undefined}, {maxGap: NaN}, {total: undefined}, {total: 4}, {observed: 2}, {maxGap: -1}]) {
    assert.equal(reinspectVerdict({...base, ...change}).ok, false);
  }
});
