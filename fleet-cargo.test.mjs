// fleet-cargo.mjs 実装契約 (本テストが正とする・他実装者向け):
// import { createCargoManifest, summarizeCargo } from './fleet-cargo.mjs';
// createCargoManifest({ destination:{id,name,address,latitude,longitude}, supply, quantity, capacity=100 })
//   -> { destination(深いコピー・凍結), supply, requested(=quantity・依頼箱数), capacity,
//        assigned(=Math.min(quantity,capacity)・積載箱数), spare(=capacity-assigned・予備機数),
//        unassigned(=requested-assigned・未割当箱数) } 全体も凍結.
// summarizeCargo(manifest, units)
//   units: Array<{ id(一意), state(checking|waiting|holding|outbound|delivery|returning|complete|stopped),
//     delivery: null | { ok:boolean, destinationId:string }, destinationId(==manifest.destination.id) }>
//     長さ==manifest.assigned (先頭assigned箱に対応). 余分な箱を作らない.
//   -> { requested, assigned, unassigned, assigning(割当中), stopped(停止未配送),
//        unknown(荷下ろし中断・所在不明), delivered(荷下ろし済み) }
// 分類は相互排他・合計==requested: delivered=ok:trueかつ配送先一致(帰還中停止もこちら・二重計上なし),
//   unknown=stoppedかつok:falseかつ配送先一致, stopped=stoppedかつdelivery===null,
//   assigning=上記以外の有効な進行中, unassigned=manifest由来.
// 不正(件数不一致・重複id・無効state・配送先変更・あり得ないdelivery・別施設ok)は
// 不明/エラー扱いで delivered に算入しない (例外throw可).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCargoManifest, summarizeCargo } from './fleet-cargo.mjs';

const DEST = {
  id: 'shelter-1',
  name: '第一施設',
  address: '東京都荒川区1-2-3',
  latitude: 35.735,
  longitude: 139.78,
};
const SUPPLY = 'drinking-water';

function makeDest(overrides = {}) {
  return { ...DEST, ...overrides };
}

function makeManifest(quantity, capacityOrUndefined, destOverrides = {}, supply = SUPPLY) {
  const args = {
    destination: makeDest(destOverrides),
    supply,
    quantity,
  };
  if (capacityOrUndefined !== undefined) args.capacity = capacityOrUndefined;
  return createCargoManifest(args);
}

function makeUnit(id, state, delivery, destinationId = DEST.id) {
  return { id, state, delivery, destinationId };
}

function unitIds(n, prefix = 'unit-') {
  return Array.from({ length: n }, (_, i) => `${prefix}${String(i + 1).padStart(3, '0')}`);
}

function assertSummaryShape(s) {
  for (const k of ['requested', 'assigned', 'unassigned', 'assigning', 'stopped', 'unknown', 'delivered']) {
    assert.equal(typeof s[k], 'number', `summary.${k} は数値`);
    assert.ok(Number.isInteger(s[k]) && s[k] >= 0, `summary.${k} は0以上の整数`);
  }
}

function assertBoxTotal(s) {
  assertSummaryShape(s);
  assert.equal(
    s.unassigned + s.assigning + s.stopped + s.unknown + s.delivered,
    s.requested,
    '5分類の合計==依頼箱数',
  );
  assert.equal(
    s.assigning + s.stopped + s.unknown + s.delivered,
    s.assigned,
    '割当分の内訳合計==積載箱数',
  );
}

// 不正は throw でも、throwせず delivered==0 の不明扱いでも可。成功件数に算入だけは不可.
function assertNotCountedAsDelivered(fn) {
  let summary = null;
  let threw = false;
  try {
    summary = fn();
  } catch (e) {
    threw = true;
    assert.ok(e instanceof Error, '例外はError系');
  }
  if (!threw) {
    assert.equal(summary.delivered, 0, '不正を荷下ろし済みに算入しない');
  }
}

test('createCargoManifest: 数量12/容量100は assigned=12・spare=88・unassigned=0', () => {
  const m = makeManifest(12);
  assert.equal(m.requested, 12);
  assert.equal(m.assigned, 12);
  assert.equal(m.spare, 88);
  assert.equal(m.unassigned, 0);
  assert.equal(m.capacity, 100);
  assert.equal(m.supply, SUPPLY);
  assert.deepEqual({ ...m.destination }, DEST);
});

test('createCargoManifest: 数量150/容量100は assigned=100・spare=0・unassigned=50', () => {
  const m = makeManifest(150);
  assert.equal(m.requested, 150);
  assert.equal(m.assigned, Math.min(150, 100));
  assert.equal(m.assigned, 100);
  assert.equal(m.spare, 0);
  assert.equal(m.unassigned, 50);
});

test('createCargoManifest: 明示capacityでも assigned=Math.min(quantity,capacity)', () => {
  const m = makeManifest(12, 5);
  assert.equal(m.assigned, 5);
  assert.equal(m.spare, 0);
  assert.equal(m.unassigned, 7);
});

test('createCargoManifest: 入力を深いコピーし凍結する', () => {
  const dest = makeDest();
  const args = { destination: dest, supply: SUPPLY, quantity: 12 };
  const m = createCargoManifest(args);
  assert.notEqual(m.destination, dest);
  assert.ok(Object.isFrozen(m), 'manifest本体を凍結');
  assert.ok(Object.isFrozen(m.destination), 'destinationを凍結');
  dest.name = '書き換え後';
  args.quantity = 999;
  assert.equal(m.destination.name, '第一施設');
  assert.equal(m.requested, 12);
  assert.throws(() => { m.requested = 999; }, '凍結への代入は例外');
});

test('createCargoManifest: 無効な数量を拒否', () => {
  for (const q of [0, -3, 1.5, NaN, Infinity, '12', undefined, null]) {
    assert.throws(() => makeManifest(q), /quantity|requested|数量/i, `quantity=${String(q)}`);
  }
});

test('createCargoManifest: 無効な座標を拒否', () => {
  assert.throws(() => makeManifest(12, undefined, { latitude: 91 }));
  assert.throws(() => makeManifest(12, undefined, { latitude: -91 }));
  assert.throws(() => makeManifest(12, undefined, { longitude: 181 }));
  assert.throws(() => makeManifest(12, undefined, { longitude: -181 }));
  assert.throws(() => makeManifest(12, undefined, { latitude: NaN }));
  assert.throws(() => makeManifest(12, undefined, { longitude: Infinity }));
  assert.throws(() => makeManifest(12, undefined, { latitude: '35.7' }));
});

test('createCargoManifest: 空の施設名/物資/IDを拒否', () => {
  assert.throws(() => makeManifest(12, undefined, { name: '' }));
  assert.throws(() => makeManifest(12, undefined, { id: '' }));
  assert.throws(() => makeManifest(12, undefined, {}, ''));
  assert.throws(() => createCargoManifest({ supply: SUPPLY, quantity: 12 }));
  assert.throws(() => createCargoManifest({ destination: makeDest(), quantity: 12 }));
});

test('createCargoManifest: 住所が未提供の場合は空欄のまま保持する', () => {
  assert.equal(makeManifest(1, undefined, {address:''}).destination.address, '');
});

test('createCargoManifest: 無効なcapacityを拒否', () => {
  for (const c of [0, -1, 1.5, NaN, Infinity, '100']) {
    assert.throws(() => makeManifest(12, c), /capacity/i, `capacity=${String(c)}`);
  }
});

test('summarizeCargo: 12箱が全て割当中なら合計==12', () => {
  const m = makeManifest(12);
  const units = unitIds(12).map((id) => makeUnit(id, 'outbound', null));
  const s = summarizeCargo(m, units);
  assert.equal(s.requested, 12);
  assert.equal(s.assigned, 12);
  assert.equal(s.unassigned, 0);
  assert.equal(s.assigning, 12);
  assert.equal(s.stopped, 0);
  assert.equal(s.unknown, 0);
  assert.equal(s.delivered, 0);
  assertBoxTotal(s);
});

test('summarizeCargo: 150箱/100機は未割当50・割当中100で合計==150', () => {
  const m = makeManifest(150);
  const units = unitIds(100).map((id) => makeUnit(id, 'outbound', null));
  const s = summarizeCargo(m, units);
  assert.equal(s.requested, 150);
  assert.equal(s.assigned, 100);
  assert.equal(s.unassigned, 50);
  assert.equal(s.assigning, 100);
  assertBoxTotal(s);
});

test('summarizeCargo: 正常な停止未配送はstoppedに数える', () => {
  const m = makeManifest(12);
  const units = unitIds(11).map((id) => makeUnit(id, 'outbound', null));
  units.push(makeUnit('unit-012', 'stopped', null));
  const s = summarizeCargo(m, units);
  assert.equal(s.assigning, 11);
  assert.equal(s.stopped, 1);
  assert.equal(s.unknown, 0);
  assert.equal(s.delivered, 0);
  assertBoxTotal(s);
});

test('summarizeCargo: 荷下ろし中の停止(ok:false)は所在不明unknownに数える', () => {
  const m = makeManifest(12);
  const units = unitIds(11).map((id) => makeUnit(id, 'outbound', null));
  units.push(makeUnit('unit-012', 'stopped', { ok: false, destinationId: DEST.id }));
  const s = summarizeCargo(m, units);
  assert.equal(s.assigning, 11);
  assert.equal(s.stopped, 0);
  assert.equal(s.unknown, 1);
  assert.equal(s.delivered, 0);
  assertBoxTotal(s);
});

test('summarizeCargo: 荷下ろし後・帰還中停止(ok:true)はdeliveredのみで二重計上しない', () => {
  const m = makeManifest(12);
  const units = unitIds(11).map((id) => makeUnit(id, 'outbound', null));
  units.push(makeUnit('unit-012', 'stopped', { ok: true, destinationId: DEST.id }));
  const s = summarizeCargo(m, units);
  assert.equal(s.delivered, 1);
  assert.equal(s.stopped, 0);
  assert.equal(s.unknown, 0);
  assert.equal(s.assigning, 11);
  assertBoxTotal(s);
});

test('summarizeCargo: 繰り返し集計は同一結果', () => {
  const m = makeManifest(12);
  const units = unitIds(11).map((id) => makeUnit(id, 'outbound', null));
  units.push(makeUnit('unit-012', 'stopped', { ok: true, destinationId: DEST.id }));
  const a = summarizeCargo(m, units);
  const b = summarizeCargo(m, units);
  assert.deepEqual(b, a);
  assertBoxTotal(b);
});

test('summarizeCargo: 割当機数がassignedと違う場合は成功に算入しない', () => {
  const m = makeManifest(12);
  const few = unitIds(11).map((id) => makeUnit(id, 'outbound', null));
  const many = unitIds(13).map((id) => makeUnit(id, 'outbound', null));
  assertNotCountedAsDelivered(() => summarizeCargo(m, few));
  assertNotCountedAsDelivered(() => summarizeCargo(m, many));
});

test('summarizeCargo: 重複idは成功に算入しない', () => {
  const m = makeManifest(12);
  const units = unitIds(12).map((id) => makeUnit(id, 'outbound', null));
  units[11] = makeUnit(units[0].id, 'outbound', null);
  assertNotCountedAsDelivered(() => summarizeCargo(m, units));
});

test('summarizeCargo: 無効stateは成功に算入しない', () => {
  const m = makeManifest(12);
  const units = unitIds(11).map((id) => makeUnit(id, 'outbound', null));
  units.push(makeUnit('unit-012', 'flying-to-mars', null));
  assertNotCountedAsDelivered(() => summarizeCargo(m, units));
});

test('summarizeCargo: 配送先の勝手な変更は成功に算入しない', () => {
  const m = makeManifest(12);
  const base = unitIds(11).map((id) => makeUnit(id, 'outbound', null));
  const changedUnit = makeUnit('unit-012', 'outbound', null, 'other-facility');
  assertNotCountedAsDelivered(() => summarizeCargo(m, [...base, changedUnit]));
  const changedDest = makeUnit('unit-012', 'returning', { ok: true, destinationId: 'other-facility' });
  assertNotCountedAsDelivered(() => summarizeCargo(m, [...base, changedDest]));
});

test('summarizeCargo: あり得ないdeliveryフラグは成功に算入しない', () => {
  const m = makeManifest(12);
  const base = unitIds(11).map((id) => makeUnit(id, 'outbound', null));
  assertNotCountedAsDelivered(() => summarizeCargo(m, [...base, makeUnit('unit-012', 'outbound', { ok: true, destinationId: DEST.id })]));
  assertNotCountedAsDelivered(() => summarizeCargo(m, [...base, makeUnit('unit-012', 'complete', { ok: false, destinationId: DEST.id })]));
  assertNotCountedAsDelivered(() => summarizeCargo(m, [...base, makeUnit('unit-012', 'complete', null)]));
  assert.throws(() => summarizeCargo(m, [...base, makeUnit('unit-012', 'returning', null)]));
  assert.throws(() => summarizeCargo(m, [...base, makeUnit('unit-012', 'delivery', null)]));
});

test('summarizeCargo: 別施設への配送を許可なしに成功扱いしない', () => {
  const m = makeManifest(12);
  const units = unitIds(11).map((id) => makeUnit(id, 'outbound', null));
  units.push(makeUnit('unit-012', 'returning', { ok: true, destinationId: 'shelter-9' }));
  assertNotCountedAsDelivered(() => summarizeCargo(m, units));
});
