import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FLEET_TIMING,
  advanceFleet,
  createFleet,
  getSummary,
  setDestinationCheck,
  stopFleet,
  summarizeStoppedReasons,
} from './fleet-engine.mjs';

test('summarizes stopped aircraft reasons without conflating missing and known reasons',()=>{
  assert.equal(summarizeStoppedReasons([{state:'outbound'}]),'');
  assert.equal(summarizeStoppedReasons([{state:'stopped',reason:'点検不明'},{state:'stopped',reason:'点検不明'},{state:'stopped',reason:'接続失敗'},{state:'stopped'}]),'停止理由：点検不明（2機）ほか2機');
  assert.equal(summarizeStoppedReasons([{state:'stopped'}]),'停止理由：不明（1機）');
});

const ORIGIN = { latitude: 35.681, longitude: 139.767 };
const FACILITIES = [
  { id: 'civic-hall', name: '中央公民館', latitude: 35.682, longitude: 139.768 },
  { id: 'gym', name: '総合体育館', latitude: 35.69, longitude: 139.771 },
  { id: 'school', name: '第一小学校', latitude: 35.675, longitude: 139.76 },
  { id: 'hall', name: '市民会館', latitude: 35.685, longitude: 139.775 },
];
const PASS = (height = 12) => ({ ok: true, surfaceHeight: height, evidence: { total:2, observed:2, unknown:0, maxGap:29, blockedIndices:[] } });
const TOTAL_PER_UNIT =
  FLEET_TIMING.outboundMs + FLEET_TIMING.deliveryMs + FLEET_TIMING.returnMs;

function countByDestination(fleet) {
  const map = new Map();
  for (const unit of fleet.aircraft) {
    map.set(unit.destinationId, (map.get(unit.destinationId) ?? 0) + 1);
  }
  return map;
}

test('100件の一貫性: 既定100機・一意ID・初期checking・必須項目', () => {
  const fleet = createFleet({ origin: ORIGIN, destinations: FACILITIES });
  assert.equal(fleet.aircraft.length, 100);
  assert.equal(fleet.units, fleet.aircraft);
  assert.equal(new Set(fleet.aircraft.map((u) => u.id)).size, 100);
  for (const unit of fleet.aircraft) {
    assert.equal(unit.state, 'checking');
    assert.equal(unit.reason, null);
    assert.equal(unit.check, null);
    assert.ok(typeof unit.id === 'string' && unit.id.length > 0);
    assert.ok(typeof unit.destinationId === 'string');
    assert.ok(unit.destination && typeof unit.destination.name === 'string');
    assert.ok(Number.isFinite(unit.departAt));
    assert.ok(Number.isFinite(unit.position.latitude));
    assert.ok(Number.isFinite(unit.position.longitude));
    assert.ok(Number.isFinite(unit.position.height));
  }
  const summary = getSummary(fleet);
  assert.equal(summary.total, 100);
  assert.equal(summary.checking, 100);
});

test('複数施設へ均等配分する（余りは先頭から1機ずつ）', () => {
  const fleet = createFleet({ origin: ORIGIN, destinations: FACILITIES, count: 100 });
  const counts = countByDestination(fleet);
  assert.deepEqual([...counts.values()], [25, 25, 25, 25]);

  const odd = createFleet({ origin: ORIGIN, destinations: FACILITIES.slice(0, 3), count: 10 });
  assert.deepEqual([...countByDestination(odd).values()], [4, 3, 3]);
});

test('座標と件数の不正は失敗する（施設を作り話さない）', () => {
  assert.throws(() => createFleet({ origin: { latitude: 999, longitude: 0 }, destinations: FACILITIES }));
  assert.throws(() => createFleet({ origin: ORIGIN, destinations: [{ id: 'x', name: 'X', latitude: 0, longitude: 999 }] }));
  assert.throws(() => createFleet({ origin: ORIGIN, destinations: [] }));
  assert.throws(() => createFleet({ origin: ORIGIN, destinations: FACILITIES, count: 0 }));
  assert.throws(() => createFleet({ origin: ORIGIN, destinations: FACILITIES, count: 1.5 }));
  assert.throws(() =>
    createFleet({
      origin: ORIGIN,
      destinations: [FACILITIES[0], { ...FACILITIES[1], id: FACILITIES[0].id }],
    }),
  );
});

test('合格のみ出発可: result 形状が正しい施設だけ waiting へ', () => {
  const fleet = createFleet({ origin: ORIGIN, destinations: FACILITIES.slice(0, 2), count: 6 });
  const applied = setDestinationCheck(fleet, 'civic-hall', PASS(), 0);
  assert.equal(applied, 3);
  const waiting = fleet.aircraft.filter((u) => u.destinationId === 'civic-hall');
  const pending = fleet.aircraft.filter((u) => u.destinationId === 'gym');
  assert.ok(waiting.every((u) => u.state === 'waiting'));
  assert.ok(pending.every((u) => u.state === 'checking'));
});

test('未知・不適切な結果は停止し成功としない', () => {
  const badResults = [
    null,
    undefined,
    {},
    { ok: false, surfaceHeight: 10, evidence: {} },
    { ok: 'yes', surfaceHeight: 10, evidence: {} },
    { ok: true },
    { ok: true, surfaceHeight: Number.NaN, evidence: {} },
    { ok: true, surfaceHeight: 10 },
    { ok: true, surfaceHeight: 10, evidence: null },
    { ok: true, surfaceHeight: 0, evidence: PASS().evidence },
    { ok: true, surfaceHeight: 169, evidence: PASS().evidence },
    { ok: true, surfaceHeight: 10, evidence: { ...PASS().evidence, unknown:1 } },
  ];
  for (const bad of badResults) {
    const fleet = createFleet({ origin: ORIGIN, destinations: FACILITIES.slice(0, 2), count: 4 });
    const applied = setDestinationCheck(fleet, 'gym', bad, 0);
    assert.equal(applied, 2);
    const targets = fleet.aircraft.filter((u) => u.destinationId === 'gym');
    assert.ok(targets.every((u) => u.state === 'stopped'));
    assert.ok(targets.every((u) => typeof u.reason === 'string' && u.reason.includes('総合体育館')));
    assert.ok(targets.every((u) => u.check === null));
    const others = fleet.aircraft.filter((u) => u.destinationId !== 'gym');
    assert.ok(others.every((u) => u.state === 'checking'));
  }
  const fleet = createFleet({ origin: ORIGIN, destinations: FACILITIES.slice(0, 1), count: 2 });
  assert.throws(() => setDestinationCheck(fleet, 'unknown-place', PASS(), 0));
});

test('late model checks do not cause a flight to skip its departure',()=>{
  const fleet=createFleet({origin:ORIGIN,destinations:FACILITIES.slice(0,2),count:2});
  advanceFleet(fleet,100000);
  setDestinationCheck(fleet,'civic-hall',PASS(),100000);
  advanceFleet(fleet,100000);
  assert.equal(fleet.aircraft[0].state,'outbound');
  assert.equal(fleet.aircraft[0].delivery,null);
  assert.equal(fleet.aircraft[0].position.latitude,ORIGIN.latitude);
});

test('a package is not marked delivered until its simulated unloading finishes',()=>{
  const fleet=createFleet({origin:ORIGIN,destinations:FACILITIES.slice(0,1),count:1});
  setDestinationCheck(fleet,'civic-hall',PASS(),0);
  advanceFleet(fleet,FLEET_TIMING.outboundMs);
  assert.notEqual(fleet.aircraft[0].delivery?.ok,true);
  advanceFleet(fleet,FLEET_TIMING.outboundMs+FLEET_TIMING.deliveryMs);
  assert.equal(fleet.aircraft[0].delivery.ok,true);
});

test('不合格の施設は遠い未来でも成功しない', () => {
  const fleet = createFleet({ origin: ORIGIN, destinations: FACILITIES.slice(0, 2), count: 4 });
  setDestinationCheck(fleet, 'civic-hall', PASS(), 0);
  setDestinationCheck(fleet, 'gym', { ok: false, surfaceHeight: 1, evidence: {} }, 0);
  const summary = advanceFleet(fleet, 10_000_000);
  assert.equal(summary.complete, 2);
  assert.equal(summary.stopped, 2);
  assert.ok(
    fleet.aircraft
      .filter((u) => u.destinationId === 'gym')
      .every((u) => u.state === 'stopped' && u.delivery === null),
  );
});

test('中止後遅延応答: 停止は再開せず、完了は維持する', () => {
  const fleet = createFleet({ origin: ORIGIN, destinations: FACILITIES.slice(0, 2), count: 10 });
  for (const d of FACILITIES.slice(0, 2)) setDestinationCheck(fleet, d.id, PASS(), 0);
  const lastDepart =
    (fleet.count - 1) * FLEET_TIMING.staggerMs + TOTAL_PER_UNIT;
  advanceFleet(fleet, lastDepart - 1); // 一部は未完了のはず
  const completedBefore = fleet.aircraft.filter((u) => u.state === 'complete').length;
  assert.ok(completedBefore >= 0);
  stopFleet(fleet, '運営判断で中止');
  const summary = getSummary(fleet);
  assert.equal(summary.complete + summary.stopped, 10);
  const resumed = setDestinationCheck(fleet, 'gym', PASS(), lastDepart + 1000);
  assert.equal(resumed, 0);
  advanceFleet(fleet, lastDepart + 1_000_000);
  const after = getSummary(fleet);
  assert.equal(after.complete, summary.complete);
  assert.ok(
    fleet.aircraft
      .filter((u) => u.state === 'complete')
      .every((u) => u.delivery && u.delivery.ok === true),
  );
  assert.ok(
    fleet.aircraft
      .filter((u) => u.state === 'stopped')
      .every((u) => typeof u.reason === 'string' && u.reason.length > 0),
  );
});

test('異なる時刻の進行: 出発ずらし・決定性・単調性', () => {
  const fleet = createFleet({ origin: ORIGIN, destinations: FACILITIES.slice(0, 2), count: 10 });
  for (const d of FACILITIES.slice(0, 2)) setDestinationCheck(fleet, d.id, PASS(), 0);
  const departAts = fleet.aircraft.map((u) => u.departAt);
  assert.equal(new Set(departAts).size, 10); // 機体ごと異なる出発時刻

  advanceFleet(fleet, 100);
  const first = fleet.aircraft[0];
  const last = fleet.aircraft[fleet.aircraft.length - 1];
  assert.equal(first.state, 'outbound');
  assert.equal(last.state, 'waiting');

  const snapshot = JSON.stringify(fleet.aircraft.map((u) => u.position));
  advanceFleet(fleet, 100); // 同じ now は同じ結果
  assert.equal(JSON.stringify(fleet.aircraft.map((u) => u.position)), snapshot);

  advanceFleet(fleet, 1000);
  assert.throws(() => advanceFleet(fleet, 500)); // 巻き戻し不可

  const lastDepart = (fleet.count - 1) * FLEET_TIMING.staggerMs;
  const summary = advanceFleet(fleet, lastDepart + TOTAL_PER_UNIT);
  assert.equal(summary.complete, 10);
  assert.ok(fleet.aircraft.every((u) => u.position.height === 0));
  assert.ok(
    fleet.aircraft.every(
      (u) =>
        u.position.latitude === ORIGIN.latitude && u.position.longitude === ORIGIN.longitude,
    ),
  );
});

test('輸送時間の一定化は仮想の演出: 距離によらず同時刻で同時相', () => {
  const origin = { latitude: 0, longitude: 0 };
  const near = { id: 'near', name: '近隣集会所', latitude: 0.001, longitude: 0 };
  const far = { id: 'far', name: '遠方体育館', latitude: 1, longitude: 0 };
  const fleet = createFleet({ origin, destinations: [near, far], count: 2 });
  setDestinationCheck(fleet, 'near', PASS(), 0);
  setDestinationCheck(fleet, 'far', PASS(), 0);
  const [first, second] = fleet.aircraft;
  advanceFleet(fleet, Math.max(first.departAt, second.departAt) + FLEET_TIMING.outboundMs);
  assert.equal(first.state, 'delivery');
  assert.equal(second.state, 'delivery');
  assert.equal(first.delivery.arrivedAt - first.departAt, second.delivery.arrivedAt - second.departAt);
});

test('数千件で性能が著しく悪化しない', () => {
  const many = [
    { id: 'd1', name: '施設1', latitude: 35.681, longitude: 139.767 },
    { id: 'd2', name: '施設2', latitude: 35.682, longitude: 139.768 },
    { id: 'd3', name: '施設3', latitude: 35.683, longitude: 139.769 },
    { id: 'd4', name: '施設4', latitude: 35.684, longitude: 139.77 },
    { id: 'd5', name: '施設5', latitude: 35.685, longitude: 139.771 },
  ];
  const started = Date.now();
  const fleet = createFleet({ origin: ORIGIN, destinations: many, count: 3000 });
  for (const d of many) setDestinationCheck(fleet, d.id, PASS(), 0);
  const lastDepart = (fleet.count - 1) * FLEET_TIMING.staggerMs;
  const summary = advanceFleet(fleet, lastDepart + TOTAL_PER_UNIT);
  const elapsed = Date.now() - started;
  assert.equal(summary.complete, 3000);
  const counts = [...countByDestination(fleet).values()];
  assert.ok(Math.max(...counts) - Math.min(...counts) <= 1);
  assert.ok(elapsed < 5000, `3000機の処理が遅すぎます: ${elapsed}ms`);
});
