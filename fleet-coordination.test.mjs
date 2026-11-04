import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FLEET_TIMING,
  advanceFleet,
  createFleet,
  getSummary,
  setDestinationCheck,
  stopFleet,
} from './fleet-engine.mjs';
import {
  advanceCoordination,
  buildDetourCandidates,
  computeAvoidWaypoint,
  createVirtualHazard,
  getCoordinationStatus,
  groundDistanceM,
  recordMuseChoice,
  reportVirtualHazard,
  routeAvoidsHazard,
  segmentDistanceM,
  verifyDetourInspections,
} from './fleet-coordination.mjs';

const ORIGIN = { latitude: 35.681, longitude: 139.767 };
const FACILITIES = [
  { id: 'civic-hall', name: '中央公民館', latitude: 35.682, longitude: 139.768 },
  { id: 'gym', name: '総合体育館', latitude: 35.69, longitude: 139.771 },
  { id: 'school', name: '第一小学校', latitude: 35.675, longitude: 139.76 },
  { id: 'hall', name: '市民会館', latitude: 35.685, longitude: 139.775 },
];
// gym往路の中点付近。半径200mでgym便のみに交差し、他施設便は対象外になる。
const GYM_HAZARD = { id: 'hz-gym-1', latitude: 35.6855, longitude: 139.769, radiusM: 200 };
const PASS = (height = 12) => ({
  ok: true,
  surfaceHeight: height,
  evidence: { total: 2, observed: 2, unknown: 0, maxGap: 29, blockedIndices: [] },
});
const TOTAL = FLEET_TIMING.outboundMs + FLEET_TIMING.deliveryMs + FLEET_TIMING.returnMs;

function makeReadyFleet(count = 100, facilities = FACILITIES, now = 100) {
  const fleet = createFleet({ origin: ORIGIN, destinations: facilities, count });
  for (const d of facilities) if(fleet.aircraft.some(unit=>unit.destinationId===d.id))setDestinationCheck(fleet, d.id, PASS(), 0);
  advanceFleet(fleet, now);
  return fleet;
}

function buildValidInspection(coord, candidate, at, source = 'app') {
  const results = {};
  for (const id of coord.heldIds) {
    const route = candidate.routes[id];
    results[id] = {
      destinationId: route.destinationId,
      path: route.path.map((p) => ({ ...p })),
      returnPath: route.returnPath.map((p) => ({ ...p })),
      evidence: { total: 2, observed: 2, unknown: 0, maxGap: 10, blockedIndices: [] },
      surfaceHeight: 12,
    };
  }
  return { hazardId: coord.hazard.id, side: candidate.side, at, source, results };
}

test('仮想配送は相談回答の出所を保持して独立点検を行う', () => {
  for (const source of ['fixture', 'unknown', 'Muse']) {
    const fleet = makeReadyFleet(8, FACILITIES, 100);
    const coord = reportVirtualHazard(fleet, createVirtualHazard(GYM_HAZARD), 100);
    const { A } = buildDetourCandidates(fleet, coord, 100);
    recordMuseChoice(coord, { side: 'A', source, at: 100 });
    assert.equal(getCoordinationStatus(fleet, coord).museChoice.source, source);
    assert.equal(verifyDetourInspections(fleet, coord, buildValidInspection(coord, A, 120), 150).state, 'approved');
  }
});

test('100機ケース: 影響IDを特定し対象外は続行、holdingは位置保持', () => {
  const fleet = makeReadyFleet(100, FACILITIES, 100);
  const hazard = createVirtualHazard(GYM_HAZARD);
  const before = new Map(fleet.aircraft.map((u) => [u.id, { ...u.position }]));
  const coord = reportVirtualHazard(fleet, hazard, 100);
  // gym便=25機（4施設均等）が影響・holding対象
  assert.equal(coord.heldIds.length, 25);
  assert.equal(coord.affectedIds.length, 25);
  assert.equal(coord.unaffectedIds.length, 75);
  assert.ok(coord.heldIds.every((id) => fleet.aircraft.find((u) => u.id === id).destinationId === 'gym'));
  for (const id of coord.heldIds) {
    const unit = fleet.aircraft.find((u) => u.id === id);
    assert.equal(unit.state, 'holding');
    assert.ok(typeof unit.reason === 'string' && unit.reason.includes('仮想障害') && unit.reason.includes('hz-gym-1'));
    assert.equal(unit.hold.hazardId, 'hz-gym-1');
    assert.deepEqual(unit.hold.position, before.get(id));
    assert.ok(typeof unit.hold.prevState === 'string');
  }
  // 対象外は waiting/outbound のまま
  for (const id of coord.unaffectedIds) {
    const unit = fleet.aircraft.find((u) => u.id === id);
    assert.ok(['waiting', 'outbound'].includes(unit.state));
  }
  // advanceFleet は holding を凍結する
  const heldPos = new Map(coord.heldIds.map((id) => [id, { ...fleet.aircraft.find((u) => u.id === id).position }]));
  advanceFleet(fleet, 200);
  for (const id of coord.heldIds) {
    const unit = fleet.aircraft.find((u) => u.id === id);
    assert.equal(unit.state, 'holding');
    assert.deepEqual({ ...unit.position }, heldPos.get(id));
  }
  const summary = getSummary(fleet);
  assert.equal(summary.holding, 25);
});

test('inspection of a different return path cannot approve the candidate',()=>{
  const fleet=makeReadyFleet(8,FACILITIES,100);
  const coord=reportVirtualHazard(fleet,createVirtualHazard(GYM_HAZARD),100);
  const {A}=buildDetourCandidates(fleet,coord,100);
  recordMuseChoice(coord,{side:'A',source:'Muse',at:100});
  const inspection=buildValidInspection(coord,A,120);
  inspection.results[coord.heldIds[0]].returnPath[1].latitude+=0.001;
  const result=verifyDetourInspections(fleet,coord,inspection,150);
  assert.equal(result.state,'stopped');
  assert.equal(result.resumed.length,0);
});

test('配送中でも障害に関係する機体は勝手に続行しない', () => {
  const fleet = makeReadyFleet(100, FACILITIES, 13_000);
  const statesBefore = new Map(fleet.aircraft.map((u) => [u.id, u.state]));
  assert.ok([...statesBefore.values()].includes('delivery'));
  assert.ok([...statesBefore.values()].includes('waiting'));
  const hazard = createVirtualHazard(GYM_HAZARD);
  const coord = reportVirtualHazard(fleet, hazard, 13_000);
  // waiting の gym 便は holding、配送中の該当便は検証できるまで停止する
  const heldWaiting = coord.heldIds.filter((id) => coord.held[id].prevState === 'waiting');
  assert.ok(heldWaiting.length > 0);
  for (const id of coord.heldIds) {
    assert.ok(['checking', 'waiting', 'outbound'].includes(coord.held[id].prevState));
  }
  assert.equal(coord.continuingIds.length,0);
  const deliveryGymBefore = [...statesBefore.entries()].filter(([id, s]) => s === 'delivery' && fleet.aircraft.find((u) => u.id === id).destinationId === 'gym').map(([id]) => id);
  assert.ok(deliveryGymBefore.length > 0);
  for (const id of deliveryGymBefore) {
    assert.ok(coord.affectedIds.includes(id));
    assert.equal(fleet.aircraft.find((u)=>u.id===id).state,'stopped');
  }
});

test('stale or individually stopped held unit prevents partial approval',()=>{
  const fleet=makeReadyFleet(8,FACILITIES,100);
  const coord=reportVirtualHazard(fleet,createVirtualHazard(GYM_HAZARD),100);
  const {A}=buildDetourCandidates(fleet,coord,100);
  recordMuseChoice(coord,{side:'A',source:'Muse',at:100});
  const inspection=buildValidInspection(coord,A,120);
  fleet.aircraft.find(unit=>unit.id===coord.heldIds[0]).state='stopped';
  const result=verifyDetourInspections(fleet,coord,inspection,150);
  assert.equal(result.state,'stopped');
  assert.equal(result.resumed.length,0);
});

test('複数施設・適切なA/B: Aは元の施設・Bは別の実在施設で全線分が回避', () => {
  const fleet = makeReadyFleet(8, FACILITIES, 100);
  const coord = reportVirtualHazard(fleet, createVirtualHazard(GYM_HAZARD), 100);
  assert.ok(coord.heldIds.length > 0);
  const { A, B } = buildDetourCandidates(fleet, coord, 100);
  assert.equal(A.side, 'A');
  assert.equal(B.side, 'B');
  assert.equal(A.valid, true);
  assert.equal(B.valid, true);
  const destIds = new Map(FACILITIES.map((d) => [d.id, d]));
  for (const id of coord.heldIds) {
    const hold = coord.held[id];
    const a = A.routes[id];
    const b = B.routes[id];
    assert.equal(a.destinationId, hold.destinationId);
    assert.notEqual(b.destinationId, hold.destinationId);
    assert.ok(destIds.has(b.destinationId));
    assert.deepEqual({ latitude: b.destination.latitude, longitude: b.destination.longitude }, { latitude: destIds.get(b.destinationId).latitude, longitude: destIds.get(b.destinationId).longitude });
    for (const route of [a, b]) {
      assert.equal(route.valid, true);
      assert.equal(route.path.length, 3);
      assert.ok(Math.abs(route.path[0].latitude - hold.position.latitude) < 1e-9);
      assert.ok(Math.abs(route.path[0].longitude - hold.position.longitude) < 1e-9);
      assert.ok(routeAvoidsHazard(route.path, coord.hazard));
      assert.ok(routeAvoidsHazard(route.returnPath, coord.hazard));
      // 復路は [配送先, 中継点, 停止位置, 出発地点]（停止==出発なら3点）
      assert.ok(route.returnPath.length === 3 || route.returnPath.length === 4);
      const last = route.returnPath[route.returnPath.length - 1];
      assert.ok(Math.abs(last.latitude - ORIGIN.latitude) < 1e-9);
    }
  }
});

test('元の点検応答が届いても再出発しない', () => {
  const fleet = makeReadyFleet(8, FACILITIES, 100);
  const coord = reportVirtualHazard(fleet, createVirtualHazard(GYM_HAZARD), 100);
  const applied = setDestinationCheck(fleet, 'gym', PASS(), 100);
  assert.ok(applied > 0);
  for (const id of coord.heldIds) {
    const unit = fleet.aircraft.find((u) => u.id === id);
    assert.equal(unit.state, 'holding');
  }
});

test('候補は未点検のまま飛ばさない（承認前はholding維持）', () => {
  const fleet = makeReadyFleet(8, FACILITIES, 100);
  const coord = reportVirtualHazard(fleet, createVirtualHazard(GYM_HAZARD), 100);
  buildDetourCandidates(fleet, coord, 100);
  const counts = advanceCoordination(fleet, coord, 5000);
  assert.equal(counts.holding, coord.heldIds.length);
  for (const id of coord.heldIds) {
    assert.equal(fleet.aircraft.find((u) => u.id === id).state, 'holding');
  }
});

test('承認フロー（A）: Muse選択＋アプリ独立点検が全機一致でのみ再開', () => {
  const fleet = makeReadyFleet(8, FACILITIES, 100);
  const coord = reportVirtualHazard(fleet, createVirtualHazard(GYM_HAZARD), 100);
  const { A } = buildDetourCandidates(fleet, coord, 100);
  recordMuseChoice(coord, { side: 'A', source: 'Muse', at: 100 });
  const inspection = buildValidInspection(coord, A, 120);
  const out = verifyDetourInspections(fleet, coord, inspection, 150);
  assert.equal(out.state, 'approved');
  assert.deepEqual([...out.resumed].sort(), [...coord.heldIds].sort());
  assert.equal(out.stopped.length, 0);
  assert.ok(out.reason.includes('仮想'));
  assert.match(out.reason, /建物モデル/);
  assert.match(out.reason, /点検地点の間.*未確認/);
  assert.doesNotMatch(out.reason, /独立点検が全機一致/);
  for (const id of coord.heldIds) {
    const unit = fleet.aircraft.find((u) => u.id === id);
    assert.equal(unit.detour.side, 'A');
    assert.equal(unit.detour.hazardId, 'hz-gym-1');
    assert.equal(unit.detourActive, true);
  }
});

test('遮断・不明・間隔・表面の不完全点検は対象を停止し成功としない', () => {
  const variants = [
    { name: '遮断あり', mutate: (r) => { r.evidence.blockedIndices = [0]; } },
    { name: '不明あり', mutate: (r) => { r.evidence.unknown = 1; r.evidence.observed = 1; } },
    { name: '観測不足', mutate: (r) => { r.evidence.observed = 1; } },
    { name: '間隔超過', mutate: (r) => { r.evidence.maxGap = 30; } },
    { name: '表面低', mutate: (r) => { r.surfaceHeight = 0.4; } },
    { name: '表面高', mutate: (r) => { r.surfaceHeight = 169; } },
  ];
  for (const { name, mutate } of variants) {
    const fleet = makeReadyFleet(8, FACILITIES, 100);
    const coord = reportVirtualHazard(fleet, createVirtualHazard(GYM_HAZARD), 100);
    const { A } = buildDetourCandidates(fleet, coord, 100);
    recordMuseChoice(coord, { side: 'A', source: 'Muse', at: 100 });
    const inspection = buildValidInspection(coord, A, 120);
    mutate(inspection.results[coord.heldIds[0]]);
    const out = verifyDetourInspections(fleet, coord, inspection, 150);
    assert.equal(out.state, 'stopped', name);
    assert.equal(out.resumed.length, 0, name);
    assert.ok(out.stopped.length > 0, name);
    for (const id of coord.heldIds) {
      assert.equal(fleet.aircraft.find((u) => u.id === id).state, 'stopped', name);
    }
  }
});

test('余計なID・不足ID・障害ID不一致・案不一致・不正経路は停止', () => {
  const setup = () => {
    const fleet = makeReadyFleet(8, FACILITIES, 100);
    const coord = reportVirtualHazard(fleet, createVirtualHazard(GYM_HAZARD), 100);
    const { A, B } = buildDetourCandidates(fleet, coord, 100);
    recordMuseChoice(coord, { side: 'A', source: 'Muse', at: 100 });
    return { fleet, coord, A, B };
  };
  {
    const { fleet, coord, A } = setup();
    const inspection = buildValidInspection(coord, A, 120);
    inspection.results['unit-999'] = { ...inspection.results[coord.heldIds[0]] };
    const out = verifyDetourInspections(fleet, coord, inspection, 150);
    assert.equal(out.state, 'stopped');
    assert.equal(out.resumed.length, 0);
  }
  {
    const { fleet, coord, A } = setup();
    const inspection = buildValidInspection(coord, A, 120);
    delete inspection.results[coord.heldIds[0]];
    const out = verifyDetourInspections(fleet, coord, inspection, 150);
    assert.equal(out.state, 'stopped');
  }
  {
    const { fleet, coord, A } = setup();
    const inspection = buildValidInspection(coord, A, 120);
    inspection.hazardId = 'hz-other';
    const out = verifyDetourInspections(fleet, coord, inspection, 150);
    assert.equal(out.state, 'stopped');
  }
  {
    const { fleet, coord, A } = setup();
    const inspection = buildValidInspection(coord, A, 120);
    inspection.side = 'B';
    const out = verifyDetourInspections(fleet, coord, inspection, 150);
    assert.equal(out.state, 'stopped');
  }
  {
    const { fleet, coord, A } = setup();
    const inspection = buildValidInspection(coord, A, 120);
    inspection.results[coord.heldIds[0]].path[1] = { latitude: GYM_HAZARD.latitude, longitude: GYM_HAZARD.longitude };
    const out = verifyDetourInspections(fleet, coord, inspection, 150);
    assert.equal(out.state, 'stopped');
  }
  {
    const { fleet, coord, A } = setup();
    const inspection = buildValidInspection(coord, A, 120);
    inspection.results[coord.heldIds[0]].destinationId = 'hall';
    const out = verifyDetourInspections(fleet, coord, inspection, 150);
    assert.equal(out.state, 'stopped');
  }
  {
    const { fleet, coord, A } = setup();
    const inspection = buildValidInspection(coord, A, 120);
    inspection.results[coord.heldIds[0]].destinationId = 'ghost-facility';
    const out = verifyDetourInspections(fleet, coord, inspection, 150);
    assert.equal(out.state, 'stopped');
  }
});

test('古い判断・未来時刻・取消（none）は停止', () => {
  {
    const fleet = makeReadyFleet(8, FACILITIES, 100);
    const coord = reportVirtualHazard(fleet, createVirtualHazard(GYM_HAZARD), 100);
    const { A } = buildDetourCandidates(fleet, coord, 100);
    recordMuseChoice(coord, { side: 'A', source: 'Muse', at: 120 });
    const inspection = buildValidInspection(coord, A, 90);
    const out = verifyDetourInspections(fleet, coord, inspection, 150);
    assert.equal(out.state, 'stopped');
  }
  {
    const fleet = makeReadyFleet(8, FACILITIES, 100);
    const coord = reportVirtualHazard(fleet, createVirtualHazard(GYM_HAZARD), 100);
    const { A } = buildDetourCandidates(fleet, coord, 100);
    recordMuseChoice(coord, { side: 'A', source: 'Muse', at: 100 });
    const inspection = buildValidInspection(coord, A, 120);
    inspection.at = 999;
    const out = verifyDetourInspections(fleet, coord, inspection, 150);
    assert.equal(out.state, 'stopped');
  }
  {
    const fleet = makeReadyFleet(8, FACILITIES, 100);
    const coord = reportVirtualHazard(fleet, createVirtualHazard(GYM_HAZARD), 100);
    buildDetourCandidates(fleet, coord, 100);
    recordMuseChoice(coord, { side: 'none', source: 'Muse', at: 100 });
    const out = verifyDetourInspections(fleet, coord, { hazardId: 'hz-gym-1', side: 'A', at: 120, source: 'app', results: {} }, 150);
    assert.equal(out.state, 'stopped');
    assert.equal(out.resumed.length, 0);
    assert.match(out.reason, /対象機を停止します/);
  }
});

test('定型処理とMuse応答は区別する（出所の混同では再開しない）', () => {
  {
    const fleet = makeReadyFleet(8, FACILITIES, 100);
    const coord = reportVirtualHazard(fleet, createVirtualHazard(GYM_HAZARD), 100);
    const { A } = buildDetourCandidates(fleet, coord, 100);
    recordMuseChoice(coord, { side: 'A', source: 'auto', at: 100 });
    const out = verifyDetourInspections(fleet, coord, buildValidInspection(coord, A, 120), 150);
    assert.equal(out.state, 'stopped');
  }
  {
    const fleet = makeReadyFleet(8, FACILITIES, 100);
    const coord = reportVirtualHazard(fleet, createVirtualHazard(GYM_HAZARD), 100);
    const { A } = buildDetourCandidates(fleet, coord, 100);
    recordMuseChoice(coord, { side: 'A', source: 'Muse', at: 100 });
    const out = verifyDetourInspections(fleet, coord, buildValidInspection(coord, A, 120, 'Muse'), 150);
    assert.equal(out.state, 'stopped');
  }
});

test('変更前位置からの連続性: 再開直後は停止位置から動き全経路が障害回避', () => {
  const fleet = makeReadyFleet(8, FACILITIES, 100);
  const coord = reportVirtualHazard(fleet, createVirtualHazard(GYM_HAZARD), 100);
  const { A } = buildDetourCandidates(fleet, coord, 100);
  recordMuseChoice(coord, { side: 'A', source: 'Muse', at: 100 });
  verifyDetourInspections(fleet, coord, buildValidInspection(coord, A, 120), 150);
  const holdPos = new Map(coord.heldIds.map((id) => [id, { ...coord.held[id].position }]));
  const counts = advanceCoordination(fleet, coord, 150);
  assert.equal(counts.outbound + counts.holding, coord.heldIds.length);
  for (const id of coord.heldIds) {
    const unit = fleet.aircraft.find((u) => u.id === id);
    const hp = holdPos.get(id);
    assert.ok(Math.abs(unit.position.latitude - hp.latitude) < 1e-9);
    assert.ok(Math.abs(unit.position.longitude - hp.longitude) < 1e-9);
    assert.ok(routeAvoidsHazard(unit.detour.path, coord.hazard));
    assert.ok(routeAvoidsHazard(unit.detour.returnPath, coord.hazard));
  }
  // 中盤は配送先へ向かい、往路・復路とも円と交差しない
  advanceCoordination(fleet, coord, 150 + FLEET_TIMING.outboundMs / 2);
  for (const id of coord.heldIds) {
    const unit = fleet.aircraft.find((u) => u.id === id);
    assert.equal(unit.state, 'outbound');
    let d = segmentDistanceM(coord.hazard, holdPos.get(id), { latitude: unit.position.latitude, longitude: unit.position.longitude });
    assert.ok(d === null || d > 0);
  }
});

test('途中新しい施設（B）: 配送先変更・表面検査済み・帰還まで完走', () => {
  const fleet = makeReadyFleet(8, FACILITIES, 100);
  const coord = reportVirtualHazard(fleet, createVirtualHazard(GYM_HAZARD), 100);
  const { B } = buildDetourCandidates(fleet, coord, 100);
  assert.equal(B.valid, true);
  recordMuseChoice(coord, { side: 'B', source: 'Muse', at: 100 });
  const inspection = buildValidInspection(coord, B, 120);
  const out = verifyDetourInspections(fleet, coord, inspection, 150);
  assert.equal(out.state, 'approved');
  for (const id of coord.heldIds) {
    const unit = fleet.aircraft.find((u) => u.id === id);
    assert.notEqual(unit.destinationId, coord.held[id].destinationId);
    assert.equal(unit.destinationId, B.routes[id].destinationId);
    assert.deepEqual(unit.detour.check, inspection.results[id].evidence);
    assert.deepEqual(unit.detour.assignmentBasis, B.routes[id].assignmentBasis);
  }
  advanceCoordination(fleet, coord, 150 + FLEET_TIMING.outboundMs);
  for (const id of coord.heldIds) {
    const unit = fleet.aircraft.find((u) => u.id === id);
    assert.equal(unit.state, 'delivery');
    assert.equal(unit.destinationId, B.routes[id].destinationId);
  }
  const done = advanceCoordination(fleet, coord, 150 + TOTAL);
  assert.equal(done.complete, coord.heldIds.length);
  for (const id of coord.heldIds) {
    const unit = fleet.aircraft.find((u) => u.id === id);
    assert.equal(unit.state, 'complete');
    assert.equal(unit.delivery.ok, true);
    assert.ok(Math.abs(unit.position.latitude - ORIGIN.latitude) < 1e-12);
  }
  assert.equal(coord.state, 'completed');
});

test('停止後遅延: 不完全点検で停止した対象は後の正規提案でも再開しない', () => {
  const fleet = makeReadyFleet(8, FACILITIES, 100);
  const coord = reportVirtualHazard(fleet, createVirtualHazard(GYM_HAZARD), 100);
  const { A } = buildDetourCandidates(fleet, coord, 100);
  recordMuseChoice(coord, { side: 'A', source: 'Muse', at: 100 });
  const bad = buildValidInspection(coord, A, 120);
  bad.results[coord.heldIds[0]].evidence.unknown = 1;
  bad.results[coord.heldIds[0]].evidence.observed = 1;
  const first = verifyDetourInspections(fleet, coord, bad, 150);
  assert.equal(first.state, 'stopped');
  // 遅れて正規の点検が届いても再開しない
  recordMuseChoice(coord, { side: 'A', source: 'Muse', at: 200 });
  const good = buildValidInspection(coord, A, 200);
  const second = verifyDetourInspections(fleet, coord, good, 250);
  assert.equal(second.state, 'stopped');
  assert.equal(second.resumed.length, 0);
  for (const id of coord.heldIds) {
    assert.equal(fleet.aircraft.find((u) => u.id === id).state, 'stopped');
  }
});

test('決定後の遅延回答は承認・停止の記録済み候補を変更しない', () => {
  for (const shouldApprove of [true, false]) {
    const fleet = makeReadyFleet(8, FACILITIES, 100);
    const coord = reportVirtualHazard(fleet, createVirtualHazard(GYM_HAZARD), 100);
    const { A } = buildDetourCandidates(fleet, coord, 100);
    recordMuseChoice(coord, { side: 'A', source: 'Muse', at: 100 });
    const inspection = buildValidInspection(coord, A, 120);
    if (!shouldApprove) inspection.results[coord.heldIds[0]].evidence.unknown = 1;
    const decision = verifyDetourInspections(fleet, coord, inspection, 150);
    assert.equal(decision.state, shouldApprove ? 'approved' : 'stopped');
    recordMuseChoice(coord, { side: 'B', source: 'Muse', at: 200 });
    const status = getCoordinationStatus(fleet, coord);
    assert.equal(status.museChoice.side, 'A');
    assert.equal(status.decision.side, 'A');
  }
});

test('stopFleet後の遅延応答は無効（点検・迂回とも再開しない）', () => {
  const fleet = makeReadyFleet(8, FACILITIES, 100);
  const coord = reportVirtualHazard(fleet, createVirtualHazard(GYM_HAZARD), 100);
  buildDetourCandidates(fleet, coord, 100);
  stopFleet(fleet, '運営判断で全体中止（仮想）');
  // fleet-engine側の遅延点検も無効
  const resumed = setDestinationCheck(fleet, 'gym', PASS(), 5000);
  assert.equal(resumed, 0);
  // 迂回側の遅延承認も無効
  recordMuseChoice(coord, { side: 'A', source: 'Muse', at: 200 });
  const { A } = coord.candidates;
  const out = verifyDetourInspections(fleet, coord, buildValidInspection(coord, A, 200), 300);
  assert.equal(out.state, 'stopped');
  assert.equal(out.resumed.length, 0);
});

test('対象/対象外・障害ID・候補・変更理由を外部から読める', () => {
  const fleet = makeReadyFleet(8, FACILITIES, 100);
  const coord = reportVirtualHazard(fleet, createVirtualHazard(GYM_HAZARD), 100);
  buildDetourCandidates(fleet, coord, 100);
  recordMuseChoice(coord, { side: 'A', source: 'Muse', at: 100 });
  const status = getCoordinationStatus(fleet, coord);
  assert.equal(status.hazardId, 'hz-gym-1');
  assert.equal(status.hazard.virtual, true);
  assert.deepEqual([...status.heldIds].sort(), [...coord.heldIds].sort());
  assert.deepEqual([...status.unaffectedIds].sort(), [...coord.unaffectedIds].sort());
  assert.ok(status.candidates.A.valid);
  assert.equal(status.museChoice.side, 'A');
  assert.equal(status.museChoice.source, 'Muse');
  assert.ok(typeof status.reason === 'string' && status.reason.includes('仮想'));
  for (const id of status.heldIds) {
    assert.equal(status.units[id].held, true);
    assert.equal(status.units[id].state, 'holding');
    assert.ok(status.units[id].reason.includes('仮想'));
  }
});

test('測定不能は安全側に停止する', () => {
  const fleet = makeReadyFleet(4, FACILITIES.slice(0, 2), 600);
  const outbound = fleet.aircraft.find((u) => u.state === 'outbound');
  assert.ok(outbound);
  outbound.position.latitude = Number.NaN;
  const coord = reportVirtualHazard(fleet, createVirtualHazard(GYM_HAZARD), 600);
  assert.ok(coord.affectedIds.includes(outbound.id));
});

test('架空の検出を現実情報と表示しない（仮想表記・捏造なし）', () => {
  const fleet = makeReadyFleet(4, FACILITIES.slice(0, 2), 100);
  const coord = reportVirtualHazard(fleet, createVirtualHazard(GYM_HAZARD), 100);
  assert.equal(coord.hazard.virtual, true);
  assert.ok(coord.reason.includes('仮想'));
  assert.ok(coord.reason.includes('現実の安全判断ではありません'));
  const status = getCoordinationStatus(fleet, coord);
  assert.ok(status.reason.includes('仮想'));
  // 不正な障害は例外、施設不足は捏造せず無効候補（作り話さない）
  assert.throws(() => createVirtualHazard({ id: '', latitude: 0, longitude: 0, radiusM: 100 }));
  assert.throws(() => createVirtualHazard({ id: 'x', latitude: 999, longitude: 0, radiusM: 100 }));
  const empty = buildDetourCandidates({ aircraft: [], destinations: [] }, { kind: 'fleet-coordination', hazard: createVirtualHazard(GYM_HAZARD), heldAt: 0, heldIds: [], affectedIds: [], unaffectedIds: [], continuingIds: [], held: {}, candidates: null, museChoice: null, decision: null, state: 'holding', reason: '仮想' }, 0);
  assert.equal(empty.A.valid, false);
  assert.throws(() => buildDetourCandidates(fleet, null, 100));
});

test('元機能回帰: 対象外は通常飛行で完走し、決定性・単調性を保つ', () => {
  const fleet = makeReadyFleet(100, FACILITIES, 100);
  const coord = reportVirtualHazard(fleet, createVirtualHazard(GYM_HAZARD), 100);
  assert.equal(getSummary(fleet).holding, 25);
  // 対象外だけを通常進行させても完走できる
  const lastDepart = (fleet.count - 1) * FLEET_TIMING.staggerMs;
  advanceFleet(fleet, lastDepart + TOTAL);
  const unaffectedComplete = coord.unaffectedIds.filter((id) => fleet.aircraft.find((u) => u.id === id).state === 'complete');
  assert.equal(unaffectedComplete.length, coord.unaffectedIds.length);
  for (const id of coord.heldIds) {
    assert.equal(fleet.aircraft.find((u) => u.id === id).state, 'holding');
  }
  // 決定性: 同じ now は同じ結果
  const snap = JSON.stringify(fleet.aircraft.map((u) => u.position));
  advanceFleet(fleet, lastDepart + TOTAL);
  assert.equal(JSON.stringify(fleet.aircraft.map((u) => u.position)), snap);
});

test('地上距離の算出: 直線・線分・回避判定が決定的', () => {
  const a = { latitude: 35.681, longitude: 139.767 };
  const b = { latitude: 35.682, longitude: 139.768 };
  const d = groundDistanceM(a, b);
  assert.ok(d > 100 && d < 200);
  assert.equal(groundDistanceM(a, b), d);
  const hazard = { id: 'h', latitude: 35.6815, longitude: 139.7675, radiusM: 10 };
  assert.ok(segmentDistanceM(hazard, a, b) <= 10);
  assert.ok(!routeAvoidsHazard([a, b], hazard));
  const far = { id: 'h2', latitude: 36, longitude: 140, radiusM: 10 };
  assert.ok(routeAvoidsHazard([a, b], far));
  assert.equal(segmentDistanceM({ latitude: NaN, longitude: 0 }, a, b), null);
  const wp = computeAvoidWaypoint(a, { latitude: 35.69, longitude: 139.771 }, createVirtualHazard(GYM_HAZARD));
  assert.ok(wp && Number.isFinite(wp.latitude));
});

test('B案は集中せず既存＋追加の少ない施設へ分散する', () => {
  const north = { id: 'north-gym', name: '北体育館', latitude: 35.69, longitude: 139.771 };
  const near = { id: 'south-near', name: '南集会所', latitude: 35.671, longitude: 139.767 };
  const mid = { id: 'south-mid', name: '南小学校', latitude: 35.671, longitude: 139.762 };
  const far = { id: 'south-far', name: '南公民館', latitude: 35.671, longitude: 139.777 };
  const facilities = [north, near, mid, far];
  const fleet = makeReadyFleet(6, facilities, 100);
  const coord = reportVirtualHazard(fleet, createVirtualHazard(GYM_HAZARD), 100);
  assert.equal(coord.heldIds.length, 2);
  const { B } = buildDetourCandidates(fleet, coord, 100);
  assert.equal(B.valid, true);
  const first = coord.heldIds[0];
  const second = coord.heldIds[1];
  // 既存数は near=2, mid=1, far=1。最寄りのnearより少ないmid/farを優先する。
  assert.equal(B.routes[first].destinationId, 'south-mid');
  assert.equal(B.routes[second].destinationId, 'south-far');
  assert.notEqual(B.routes[first].destinationId, B.routes[second].destinationId);
  for (const id of coord.heldIds) {
    const route = B.routes[id];
    assert.equal(route.valid, true);
    assert.ok(routeAvoidsHazard(route.path, coord.hazard));
    assert.ok(routeAvoidsHazard(route.returnPath, coord.hazard));
    assert.equal(route.assignmentBasis.type, 'balanced_then_nearest');
    assert.ok(Number.isFinite(route.assignmentBasis.distanceM));
    assert.ok(Number.isInteger(route.assignmentBasis.existingCount));
    assert.ok(Number.isInteger(route.assignmentBasis.assignedCount));
  }
  assert.equal(B.routes[first].assignmentBasis.existingCount, 1);
  assert.equal(B.routes[first].assignmentBasis.assignedCount, 0);
  // 2機目はmidへの追加割当を避けてfarへ向かう
  assert.equal(B.routes[second].assignmentBasis.existingCount, 1);
  assert.equal(B.routes[second].assignmentBasis.assignedCount, 0);
  const via = JSON.stringify(B.routes);
  assert.ok(!via.includes('保証'));
  assert.ok(!via.includes('受入可能'));
});

test('同数なら現在位置に近い施設を選ぶ', () => {
  const north = { id: 'north-gym', name: '北体育館', latitude: 35.69, longitude: 139.771 };
  const near = { id: 'south-near', name: '南集会所', latitude: 35.671, longitude: 139.767 };
  const mid = { id: 'south-mid', name: '南小学校', latitude: 35.671, longitude: 139.762 };
  const far = { id: 'south-far', name: '南公民館', latitude: 35.671, longitude: 139.777 };
  const fleet = makeReadyFleet(4, [north, near, mid, far], 100);
  const coord = reportVirtualHazard(fleet, createVirtualHazard(GYM_HAZARD), 100);
  assert.equal(coord.heldIds.length, 1);
  const { B } = buildDetourCandidates(fleet, coord, 100);
  assert.equal(B.valid, true);
  const only = coord.heldIds[0];
  assert.equal(B.routes[only].destinationId, 'south-near');
  const hold = coord.held[only];
  const expected = groundDistanceM(hold.position, near);
  assert.ok(Math.abs(B.routes[only].assignmentBasis.distanceM - expected) < 1e-6);
  assert.equal(B.routes[only].assignmentBasis.type, 'balanced_then_nearest');
});

test('障害円と交差する施設を飛ばして実在施設だけを選ぶ', () => {
  const north = { id: 'north-gym', name: '北体育館', latitude: 35.69, longitude: 139.771 };
  const south = { id: 'south-near', name: '南集会所', latitude: 35.671, longitude: 139.767 };
  const blocked = { id: 'blocked', name: '中央仮設', latitude: GYM_HAZARD.latitude, longitude: GYM_HAZARD.longitude };
  const fleet = makeReadyFleet(2, [north, south, blocked], 100);
  const coord = reportVirtualHazard(fleet, createVirtualHazard(GYM_HAZARD), 100);
  assert.ok(coord.heldIds.length >= 1);
  const northHeld = coord.heldIds.filter((id) => coord.held[id].destinationId === 'north-gym');
  assert.equal(northHeld.length, 1);
  const { B } = buildDetourCandidates(fleet, coord, 100);
  const route = B.routes[northHeld[0]];
  // blockedは障害円内（既存0でも選ばない）でsouthだけが残る
  assert.equal(route.destinationId, 'south-near');
  assert.equal(route.valid, true);
  assert.ok(routeAvoidsHazard(route.path, coord.hazard));
  assert.ok(routeAvoidsHazard(route.returnPath, coord.hazard));
});

test('回避可能な別施設がなければB案は不採用（A案は保つ）', () => {
  const north = { id: 'north-gym', name: '北体育館', latitude: 35.69, longitude: 139.771 };
  const blocked = { id: 'blocked', name: '中央仮設', latitude: GYM_HAZARD.latitude, longitude: GYM_HAZARD.longitude };
  const fleet = makeReadyFleet(1, [north, blocked], 100);
  const coord = reportVirtualHazard(fleet, createVirtualHazard(GYM_HAZARD), 100);
  assert.equal(coord.heldIds.length, 1);
  const { A, B } = buildDetourCandidates(fleet, coord, 100);
  assert.equal(A.valid, true);
  assert.equal(A.routes[coord.heldIds[0]].destinationId, 'north-gym');
  assert.equal(B.valid, false);
  const route = B.routes[coord.heldIds[0]];
  assert.equal(route.valid, false);
  assert.equal(route.assignmentBasis, null);
  assert.ok(route.invalidReason.includes('回避可能な別の実在する公開施設がない'));
});

test('B案は決定的でA案・停止挙動を保つ', () => {
  const setup = () => {
    const fleet = makeReadyFleet(8, FACILITIES, 100);
    const coord = reportVirtualHazard(fleet, createVirtualHazard(GYM_HAZARD), 100);
    return { fleet, coord };
  };
  const first = setup();
  const second = setup();
  const builtFirst = buildDetourCandidates(first.fleet, first.coord, 100);
  const builtSecond = buildDetourCandidates(second.fleet, second.coord, 100);
  assert.deepEqual(builtFirst.B, builtSecond.B);
  assert.deepEqual(builtFirst.A, builtSecond.A);
  // 繰り返しも同じ結果
  const again = buildDetourCandidates(first.fleet, first.coord, 100);
  assert.deepEqual(again.B, builtFirst.B);
  // A案は元の施設のまま有効
  for (const id of first.coord.heldIds) {
    assert.equal(builtFirst.A.routes[id].destinationId, first.coord.held[id].destinationId);
  }
  assert.equal(builtFirst.A.valid, true);
  // 安全停止の挙動は保つ: 不完全点検では停止する
  recordMuseChoice(first.coord, { side: 'A', source: 'Muse', at: 100 });
  const inspection = buildValidInspection(first.coord, builtFirst.A, 120);
  inspection.results[first.coord.heldIds[0]].evidence.unknown = 1;
  inspection.results[first.coord.heldIds[0]].evidence.observed = 1;
  const out = verifyDetourInspections(first.fleet, first.coord, inspection, 150);
  assert.equal(out.state, 'stopped');
  assert.equal(out.resumed.length, 0);
  const dumped = JSON.stringify(builtFirst.B);
  assert.ok(!dumped.includes('安全です'));
  assert.ok(!dumped.includes('保証'));
  assert.ok(!dumped.includes('受入可能'));
});
