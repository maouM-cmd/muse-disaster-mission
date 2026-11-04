// fleet-diversion-ledger.test.mjs — 仮想配送の別施設承認に必要な「箱数の施設別集計」の振る舞い契約。
// import { createCargoManifest, summarizeDivertedCargo } from './fleet-engine.mjs';
// summarizeDivertedCargo(manifest, units, assignments, facilities)
//   manifest: createCargoManifest の戻り値。元依頼であり manifest.destination は変更しない。
//   units: Array<{ id(一意), state(checking|waiting|holding|outbound|delivery|returning|complete|stopped),
//     delivery: null | { ok:boolean, destinationId }, destinationId }>
//     長さ==manifest.assigned。destinationId は未変更機なら元依頼先id、変更機なら承認先id。
//     delivery.destinationId もその機の許可先idと一致すること。
//   assignments: Array<{ unitId, destination:{ id, name, latitude, longitude } }>（承認済み変更のみ）。
//   -> { requested, assigned, unassigned, assigning(割当中), stopped(停止未配送),
//        unknown(荷下ろし中断・所在不明), delivered(全施設の荷下ろし済み合計),
//        deliveredOriginal(元施設分), deliveredOther(別施設分),
//        byFacility:[{ id, name, assigned, delivered, stopped, unknown, assigning }]（施設ID順） }
// 分類は summarizeCargo と同じ整合性：delivery===null の stopped→stopped、
//   stopped かつ ok:false→unknown（荷下ろし中の停止）、stopped かつ ok:true→deliveredのみ
//   （荷下ろし後の停止・二重計上なし）、それ以外の有効な進行中→assigning。
// 別施設への配送は元施設の達成に数えない。各施設の assigned に unassigned は含めない。
// 不正（件数不一致・重複・未知機・元施設への変更・無効施設・同一ID不一致・未承認・不一致・
// 状態矛盾）は例外。入力は決して変更しない。実機の安全は判断しない。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCargoManifest, summarizeDivertedCargo as buildLedger } from './fleet-engine.mjs';

const ORIGIN = {
  id: 'shelter-1',
  name: '第一施設',
  address: '東京都荒川区1-2-3',
  latitude: 35.735,
  longitude: 139.78,
};
const FACILITY_B = { id: 'shelter-2', name: '第二施設', latitude: 35.8, longitude: 139.81 };
const FACILITY_C = { id: 'shelter-3', name: '第三施設', latitude: 35.7, longitude: 139.75 };
const summarizeDivertedCargo=(manifest,units,assignments)=>buildLedger(manifest,units,assignments,[ORIGIN,FACILITY_B,FACILITY_C]);
const SUPPLY = 'drinking-water';

test('別施設のIDと施設名・座標は公開施設一覧と一致する必要がある',()=>{
  const manifest=makeManifest(1),units=[makeUnit('unit-001','returning',{ok:true,destinationId:FACILITY_B.id},FACILITY_B.id)];
  const changed={...FACILITY_B,name:FACILITY_C.name,latitude:FACILITY_C.latitude,longitude:FACILITY_C.longitude};
  assert.throws(()=>buildLedger(manifest,units,[makeAssignment('unit-001',changed)],[ORIGIN,FACILITY_B,FACILITY_C]));
});

function makeManifest(quantity, capacityOrUndefined) {
  const args = { destination: { ...ORIGIN }, supply: SUPPLY, quantity };
  if (capacityOrUndefined !== undefined) args.capacity = capacityOrUndefined;
  return createCargoManifest(args);
}

function makeUnit(id, state, delivery, destinationId = ORIGIN.id) {
  return { id, state, delivery, destinationId };
}

function makeAssignment(unitId, facility) {
  return {
    unitId,
    destination: {
      id: facility.id,
      name: facility.name,
      latitude: facility.latitude,
      longitude: facility.longitude,
    },
  };
}

function assertLedgerShape(s) {
  for (const k of ['requested', 'assigned', 'unassigned', 'assigning', 'stopped', 'unknown', 'delivered', 'deliveredOriginal', 'deliveredOther']) {
    assert.equal(typeof s[k], 'number', `summary.${k} は数値`);
    assert.ok(Number.isInteger(s[k]) && s[k] >= 0, `summary.${k} は0以上の整数`);
  }
  assert.ok(Array.isArray(s.byFacility), 'byFacility は配列');
  for (const f of s.byFacility) {
    for (const k of ['assigned', 'delivered', 'stopped', 'unknown', 'assigning']) {
      assert.equal(typeof f[k], 'number', `byFacility[${f.id}].${k} は数値`);
      assert.ok(Number.isInteger(f[k]) && f[k] >= 0, `byFacility[${f.id}].${k} は0以上の整数`);
    }
    assert.equal(typeof f.id, 'string');
    assert.equal(typeof f.name, 'string');
  }
}

function assertLedgerTotals(s) {
  assertLedgerShape(s);
  assert.equal(
    s.unassigned + s.assigning + s.stopped + s.unknown + s.delivered,
    s.requested,
    '5分類＋未割当の合計==依頼箱数',
  );
  assert.equal(
    s.assigning + s.stopped + s.unknown + s.delivered,
    s.assigned,
    '割当分の内訳合計==積載箱数',
  );
  assert.equal(s.deliveredOriginal + s.deliveredOther, s.delivered, '元施設分＋別施設分==荷下ろし済み合計');
  const sum = (k) => s.byFacility.reduce((n, f) => n + f[k], 0);
  assert.equal(sum('assigned'), s.assigned, '施設別assignedの合計==積載箱数（unassignedは含めない）');
  assert.equal(sum('delivered'), s.delivered, '施設別deliveredの合計==荷下ろし済み合計');
  assert.equal(sum('stopped'), s.stopped, '施設別stoppedの合計==停止未配送');
  assert.equal(sum('unknown'), s.unknown, '施設別unknownの合計==所在不明');
  assert.equal(sum('assigning'), s.assigning, '施設別assigningの合計==割当中');
  const ids = s.byFacility.map((f) => f.id);
  assert.deepEqual(ids, [...ids].sort(), 'byFacilityは施設ID順');
}

test('別施設承認：元施設と2つの別施設への荷下ろしを施設別に数える', () => {
  const m = makeManifest(6);
  const units = [
    makeUnit('unit-001', 'returning', { ok: true, destinationId: ORIGIN.id }),
    makeUnit('unit-002', 'complete', { ok: true, destinationId: ORIGIN.id }),
    makeUnit('unit-003', 'outbound', null),
    makeUnit('unit-004', 'returning', { ok: true, destinationId: FACILITY_B.id }, FACILITY_B.id),
    makeUnit('unit-005', 'complete', { ok: true, destinationId: FACILITY_B.id }, FACILITY_B.id),
    makeUnit('unit-006', 'returning', { ok: true, destinationId: FACILITY_C.id }, FACILITY_C.id),
  ];
  const assignments = [
    makeAssignment('unit-004', FACILITY_B),
    makeAssignment('unit-005', FACILITY_B),
    makeAssignment('unit-006', FACILITY_C),
  ];
  const s = summarizeDivertedCargo(m, units, assignments);
  assert.equal(s.requested, 6);
  assert.equal(s.assigned, 6);
  assert.equal(s.unassigned, 0);
  assert.equal(s.assigning, 1);
  assert.equal(s.stopped, 0);
  assert.equal(s.unknown, 0);
  assert.equal(s.delivered, 5);
  assert.equal(s.deliveredOriginal, 2);
  assert.equal(s.deliveredOther, 3);
  assert.equal(s.byFacility.length, 3);
  assert.deepEqual(s.byFacility[0], {
    id: 'shelter-1', name: '第一施設', assigned: 3, delivered: 2, stopped: 0, unknown: 0, assigning: 1,
  });
  assert.deepEqual(s.byFacility[1], {
    id: 'shelter-2', name: '第二施設', assigned: 2, delivered: 2, stopped: 0, unknown: 0, assigning: 0,
  });
  assert.deepEqual(s.byFacility[2], {
    id: 'shelter-3', name: '第三施設', assigned: 1, delivered: 1, stopped: 0, unknown: 0, assigning: 0,
  });
  assertLedgerTotals(s);
});

test('別施設承認：途中停止・荷下ろし後停止・未割当の合計が一致する', () => {
  const m = makeManifest(10, 7);
  assert.equal(m.assigned, 7);
  assert.equal(m.unassigned, 3);
  const units = [
    makeUnit('unit-001', 'outbound', null),
    makeUnit('unit-002', 'stopped', null),
    makeUnit('unit-003', 'stopped', { ok: false, destinationId: ORIGIN.id }),
    makeUnit('unit-004', 'stopped', { ok: true, destinationId: ORIGIN.id }),
    makeUnit('unit-005', 'delivery', { ok: false, destinationId: FACILITY_B.id }, FACILITY_B.id),
    makeUnit('unit-006', 'returning', { ok: true, destinationId: FACILITY_B.id }, FACILITY_B.id),
    makeUnit('unit-007', 'waiting', null, FACILITY_C.id),
  ];
  const assignments = [
    makeAssignment('unit-005', FACILITY_B),
    makeAssignment('unit-006', FACILITY_B),
    makeAssignment('unit-007', FACILITY_C),
  ];
  const s = summarizeDivertedCargo(m, units, assignments);
  assert.equal(s.requested, 10);
  assert.equal(s.assigned, 7);
  assert.equal(s.unassigned, 3);
  assert.equal(s.assigning, 3);
  assert.equal(s.stopped, 1);
  assert.equal(s.unknown, 1);
  assert.equal(s.delivered, 2);
  assert.equal(s.deliveredOriginal, 1);
  assert.equal(s.deliveredOther, 1);
  const origin = s.byFacility.find((f) => f.id === ORIGIN.id);
  assert.deepEqual(origin, {
    id: 'shelter-1', name: '第一施設', assigned: 4, delivered: 1, stopped: 1, unknown: 1, assigning: 1,
  });
  assertLedgerTotals(s);
});

test('別施設承認：未承認の行先は例外', () => {
  const m = makeManifest(3);
  const base = [
    makeUnit('unit-001', 'outbound', null),
    makeUnit('unit-002', 'outbound', null),
  ];
  assert.throws(() => summarizeDivertedCargo(m, [...base, makeUnit('unit-003', 'outbound', null, 'shelter-9')], []));
  assert.throws(() => summarizeDivertedCargo(
    m,
    [...base, makeUnit('unit-003', 'returning', { ok: true, destinationId: 'shelter-9' }, 'shelter-9')],
    [],
  ));
});

test('別施設承認：承認と機体・配送記録の不一致は例外', () => {
  const m = makeManifest(3);
  const base = [
    makeUnit('unit-001', 'outbound', null),
    makeUnit('unit-002', 'outbound', null),
  ];
  assert.throws(() => summarizeDivertedCargo(
    m,
    [...base, makeUnit('unit-003', 'outbound', null)],
    [makeAssignment('unit-003', FACILITY_B)],
  ));
  assert.throws(() => summarizeDivertedCargo(
    m,
    [...base, makeUnit('unit-003', 'returning', { ok: true, destinationId: ORIGIN.id }, FACILITY_B.id)],
    [makeAssignment('unit-003', FACILITY_B)],
  ));
  assert.throws(() => summarizeDivertedCargo(
    m,
    [...base, makeUnit('unit-003', 'returning', { ok: true, destinationId: FACILITY_C.id }, FACILITY_B.id)],
    [makeAssignment('unit-003', FACILITY_B)],
  ));
});

test('別施設承認：重複するunitIdは例外', () => {
  const m = makeManifest(3);
  const dupUnits = [
    makeUnit('unit-001', 'outbound', null),
    makeUnit('unit-002', 'outbound', null),
    makeUnit('unit-001', 'waiting', null),
  ];
  assert.throws(() => summarizeDivertedCargo(m, dupUnits, []));
  const units = [
    makeUnit('unit-001', 'outbound', null),
    makeUnit('unit-002', 'outbound', null, FACILITY_B.id),
    makeUnit('unit-003', 'outbound', null, FACILITY_B.id),
  ];
  const dupAssignments = [makeAssignment('unit-002', FACILITY_B), makeAssignment('unit-002', FACILITY_B)];
  assert.throws(() => summarizeDivertedCargo(m, units, dupAssignments));
});

test('別施設承認：状態矛盾は例外', () => {
  const m = makeManifest(2);
  const base = [makeUnit('unit-001', 'outbound', null)];
  assert.throws(() => summarizeDivertedCargo(m, [...base, makeUnit('unit-002', 'complete', null)], []));
  assert.throws(() => summarizeDivertedCargo(m, [...base, makeUnit('unit-002', 'returning', null)], []));
  assert.throws(() => summarizeDivertedCargo(
    m,
    [...base, makeUnit('unit-002', 'outbound', { ok: true, destinationId: ORIGIN.id })],
    [],
  ));
  assert.throws(() => summarizeDivertedCargo(
    m,
    [...base, makeUnit('unit-002', 'complete', { ok: false, destinationId: ORIGIN.id })],
    [],
  ));
  assert.throws(() => summarizeDivertedCargo(m, [...base, makeUnit('unit-002', 'flying', null)], []));
  assert.throws(() => summarizeDivertedCargo(
    m,
    [...base, makeUnit('unit-002', 'outbound', { ok: true, destinationId: FACILITY_B.id }, FACILITY_B.id)],
    [makeAssignment('unit-002', FACILITY_B)],
  ));
});

test('別施設承認：入力を決して変更しない（元依頼のdestination含む）', () => {
  const m = makeManifest(6);
  const units = [
    makeUnit('unit-001', 'returning', { ok: true, destinationId: ORIGIN.id }),
    makeUnit('unit-002', 'outbound', null),
    makeUnit('unit-003', 'stopped', { ok: false, destinationId: ORIGIN.id }),
    makeUnit('unit-004', 'returning', { ok: true, destinationId: FACILITY_B.id }, FACILITY_B.id),
    makeUnit('unit-005', 'delivery', { ok: false, destinationId: FACILITY_B.id }, FACILITY_B.id),
    makeUnit('unit-006', 'waiting', null, FACILITY_C.id),
  ];
  const assignments = [
    makeAssignment('unit-004', FACILITY_B),
    makeAssignment('unit-005', FACILITY_B),
    makeAssignment('unit-006', FACILITY_C),
  ];
  const before = JSON.stringify([m, units, assignments]);
  const first = summarizeDivertedCargo(m, units, assignments);
  const second = summarizeDivertedCargo(m, units, assignments);
  assert.deepEqual(second, first);
  assert.equal(JSON.stringify([m, units, assignments]), before, '引数・機体・配送記録を変更しない');
  assert.deepEqual({ ...m.destination }, { ...ORIGIN }, '元依頼のdestinationは変更しない');
});

test('別施設承認：存在しない機・元施設への変更・件数不一致・未知の入力は例外', () => {
  const m = makeManifest(3);
  const units = [
    makeUnit('unit-001', 'outbound', null),
    makeUnit('unit-002', 'outbound', null),
    makeUnit('unit-003', 'outbound', null),
  ];
  assert.throws(() => summarizeDivertedCargo(m, units, [makeAssignment('unit-999', FACILITY_B)]));
  assert.throws(() => summarizeDivertedCargo(
    m,
    units,
    [{ unitId: 'unit-003', destination: { id: ORIGIN.id, name: '第一施設', latitude: 35.735, longitude: 139.78 } }],
  ));
  assert.throws(() => summarizeDivertedCargo(m, units.slice(0, 2), []));
  assert.throws(() => summarizeDivertedCargo(m, units, null));
  assert.throws(() => summarizeDivertedCargo(m, null, []));
  assert.throws(() => summarizeDivertedCargo(null, units, []));
});

test('別施設承認：無効な施設・同一IDの不一致は例外', () => {
  const m = makeManifest(3);
  const units = [
    makeUnit('unit-001', 'outbound', null),
    makeUnit('unit-002', 'outbound', null, 'shelter-2'),
    makeUnit('unit-003', 'outbound', null, 'shelter-2'),
  ];
  const badFacilities = [
    { ...FACILITY_B, id: '' },
    { ...FACILITY_B, name: '' },
    { ...FACILITY_B, name: '   ' },
    { ...FACILITY_B, latitude: 91 },
    { ...FACILITY_B, longitude: -181 },
    { ...FACILITY_B, latitude: '35.8' },
    { ...FACILITY_B, longitude: NaN },
  ];
  for (const facility of badFacilities) {
    assert.throws(
      () => summarizeDivertedCargo(m, units, [makeAssignment('unit-002', facility), makeAssignment('unit-003', facility)]),
      `施設の不正を許さない: ${JSON.stringify(facility)}`,
    );
  }
  assert.throws(() => summarizeDivertedCargo(
    m,
    units,
    [makeAssignment('unit-002', FACILITY_B), makeAssignment('unit-003', { ...FACILITY_B, name: '別名施設' })],
  ));
  assert.throws(() => summarizeDivertedCargo(
    m,
    units,
    [makeAssignment('unit-002', FACILITY_B), makeAssignment('unit-003', { ...FACILITY_B, latitude: 36.0 })],
  ));
});
