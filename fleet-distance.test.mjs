import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groundDistanceM } from './fleet-coordination.mjs';
import { summarizeCandidateDistances } from './fleet-distance.mjs';

// 往路3点（2区間）・復路2点（1区間）の機体u1。
const U1_PATH = [
  { latitude: 35.681, longitude: 139.767 },
  { latitude: 35.682, longitude: 139.768 },
  { latitude: 35.685, longitude: 139.77 },
];
const U1_RETURN = [
  { latitude: 35.685, longitude: 139.77 },
  { latitude: 35.681, longitude: 139.767 },
];
// 往路2点（1区間）・復路3点（2区間）の機体u2。
const U2_PATH = [
  { latitude: 35.69, longitude: 139.771 },
  { latitude: 35.692, longitude: 139.775 },
];
const U2_RETURN = [
  { latitude: 35.692, longitude: 139.775 },
  { latitude: 35.691, longitude: 139.773 },
  { latitude: 35.69, longitude: 139.771 },
];

function routeOf(path, returnPath) {
  return {
    path: path.map((p) => ({ ...p })),
    returnPath: returnPath.map((p) => ({ ...p })),
    valid: true,
  };
}

function candidateOf(routes) {
  return { side: 'A', valid: true, routes };
}

function polyline(paths) {
  let total = 0;
  for (let i = 1; i < paths.length; i += 1) total += groundDistanceM(paths[i - 1], paths[i]);
  return total;
}

test('複数区間・複数機の往路/復路/往復を集計する', () => {
  const candidate = candidateOf({ u1: routeOf(U1_PATH, U1_RETURN), u2: routeOf(U2_PATH, U2_RETURN) });
  const got = summarizeCandidateDistances(candidate, ['u1', 'u2']);
  assert.notEqual(got, null);
  const out = polyline(U1_PATH) + polyline(U2_PATH);
  const ret = polyline(U1_RETURN) + polyline(U2_RETURN);
  assert.equal(got.routes, 2);
  assert.equal(got.outboundM, Math.round(out));
  assert.equal(got.returnM, Math.round(ret));
  assert.equal(got.totalM, Math.round(out + ret));
  // 復路を含む往復であり、往路だけの値にならない。
  assert.ok(got.totalM > got.outboundM);
  assert.ok(Number.isInteger(got.outboundM) && Number.isInteger(got.returnM) && Number.isInteger(got.totalM));
});

test('代表値はids先頭の1機分であり順序に従う', () => {
  const candidate = candidateOf({ u1: routeOf(U1_PATH, U1_RETURN), u2: routeOf(U2_PATH, U2_RETURN) });
  const head2 = summarizeCandidateDistances(candidate, ['u2', 'u1']);
  assert.notEqual(head2, null);
  const out2 = polyline(U2_PATH);
  const ret2 = polyline(U2_RETURN);
  assert.equal(head2.routes, 2);
  assert.deepEqual(head2.representative, {
    outboundM: Math.round(out2),
    returnM: Math.round(ret2),
    totalM: Math.round(out2 + ret2),
  });
  // 全体集計は順序に依らない。
  const head1 = summarizeCandidateDistances(candidate, ['u1', 'u2']);
  assert.equal(head2.outboundM, head1.outboundM);
  assert.equal(head2.returnM, head1.returnM);
  assert.equal(head2.totalM, head1.totalM);
});

test('同じ入力は繰り返し同じ結果になる', () => {
  const candidate = candidateOf({ u1: routeOf(U1_PATH, U1_RETURN), u2: routeOf(U2_PATH, U2_RETURN) });
  const first = summarizeCandidateDistances(candidate, ['u1', 'u2']);
  const second = summarizeCandidateDistances(candidate, ['u1', 'u2']);
  assert.deepEqual(second, first);
  // 計算後も入力の点列を書き換えない。
  assert.deepEqual(candidate.routes.u1.path, U1_PATH);
});

test('候補自体が無効・不明なときはnull', () => {
  const good = candidateOf({ u1: routeOf(U1_PATH, U1_RETURN) });
  assert.equal(summarizeCandidateDistances(null, ['u1']), null);
  assert.equal(summarizeCandidateDistances(undefined, ['u1']), null);
  assert.equal(summarizeCandidateDistances({}, ['u1']), null);
  assert.equal(summarizeCandidateDistances({ routes: null }, ['u1']), null);
  assert.equal(summarizeCandidateDistances({ ...good, valid: false }, ['u1']), null);
  assert.equal(summarizeCandidateDistances({ routes: good.routes }, ['u1']), null);
  assert.equal(summarizeCandidateDistances(candidateOf({u1:{...good.routes.u1,valid:undefined}}), ['u1']), null);
  assert.equal(summarizeCandidateDistances({ side: 'A', valid: true, routes: {} }, ['u1']), null);
});

test('対象機の欠落・ids不正・空idsはnull', () => {
  const candidate = candidateOf({ u1: routeOf(U1_PATH, U1_RETURN) });
  assert.equal(summarizeCandidateDistances(candidate, []), null);
  assert.equal(summarizeCandidateDistances(candidate, 'u1'), null);
  assert.equal(summarizeCandidateDistances(candidate, null), null);
  assert.equal(summarizeCandidateDistances(candidate, ['u1', 'missing']), null);
  assert.equal(summarizeCandidateDistances(candidate, ['u1', '']), null);
  assert.equal(summarizeCandidateDistances(candidate, ['u1', 'u1']), null);
});

test('点列不足・非配列の経路は候補全体でnull', () => {
  const base = { u1: routeOf(U1_PATH, U1_RETURN) };
  assert.equal(summarizeCandidateDistances(candidateOf({ ...base, u2: routeOf([{ latitude: 35.681, longitude: 139.767 }], U2_RETURN) }), ['u1', 'u2']), null);
  assert.equal(summarizeCandidateDistances(candidateOf({ ...base, u2: routeOf([], U2_RETURN) }), ['u1', 'u2']), null);
  assert.equal(summarizeCandidateDistances(candidateOf({ ...base, u2: { ...routeOf(U2_PATH, U2_RETURN), returnPath: null } }), ['u1', 'u2']), null);
  assert.equal(summarizeCandidateDistances(candidateOf({ u1: { ...base.u1, returnPath: 'line' } }), ['u1']), null);
});

test('緯度経度不正・非有限値は候補全体でnull', () => {
  const badPoints = [
    { latitude: 91, longitude: 139.767 },
    { latitude: -91, longitude: 139.767 },
    { latitude: 35.681, longitude: 181 },
    { latitude: '35.681', longitude: 139.767 },
    { latitude: NaN, longitude: 139.767 },
    { latitude: Infinity, longitude: 139.767 },
    { latitude: 35.681, longitude: Infinity },
    null,
    { latitude: 35.681 },
  ];
  for (const bad of badPoints) {
    const path = [{ latitude: 35.681, longitude: 139.767 }, bad];
    const candidate = candidateOf({ u1: routeOf(U1_PATH, U1_RETURN), u2: routeOf(path, U2_RETURN) });
    assert.equal(summarizeCandidateDistances(candidate, ['u1', 'u2']), null, JSON.stringify(bad));
  }
  const badReturn = candidateOf({ u1: routeOf(U1_PATH, [{ latitude: 35.685, longitude: 139.77 }, { latitude: 35.681, longitude: null }]) });
  assert.equal(summarizeCandidateDistances(badReturn, ['u1']), null);
});
