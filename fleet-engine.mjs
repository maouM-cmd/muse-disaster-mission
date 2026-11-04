// fleet-engine.mjs
// ============================================================================
// 100機の仮想物資配送フリートの状態管理エンジン（中心実装）。
// 将来の数千機への拡張を見据え、O(n) の単純ループと共有参照だけで構成する。
// 地図 / UI（Codexが並行統合）からは本ファイルの公開APIだけを使う想定。
//
// 公開API:
// - createFleet({ origin, destinations, count = 100 }) -> fleet
// - setDestinationCheck(fleet, destinationId, result, now) -> 適用機数
// - advanceFleet(fleet, now) -> 集計サマリ（fleetも更新）
// - stopFleet(fleet, reason) -> 集計サマリ（fleetも更新）
// - getSummary(fleet) -> 集計サマリ（更新なしの再計算つき）
// - FLEET_TIMING -> 仮想タイミング定数
//
// 機体（aircraft / units: 同一参照）の形:

// Show a representative reason without presenting every stopped aircraft as
// having the same cause. The full reason remains on each aircraft.
export function summarizeStoppedReasons(aircraft) {
  const reasons = new Map();
  for (const unit of aircraft || []) {
    if (unit.state !== 'stopped') continue;
    const reason = typeof unit.reason === 'string' && unit.reason.trim() ? unit.reason.trim() : '不明';
    reasons.set(reason, (reasons.get(reason) || 0) + 1);
  }
  if (!reasons.size) return '';
  const [reason, count] = [...reasons].sort((a,b)=>b[1]-a[1])[0];
  const remaining = [...reasons.values()].reduce((sum,n)=>sum+n,0) - count;
  return `停止理由：${reason}（${count}機）${remaining ? `ほか${remaining}機` : ''}`;
}
// {
//   id, index, origin, destinationId, destination,
//   state, reason, check, delivery, completedAt,
//   departAt, createdAt, updatedAt, position: { latitude, longitude, height }
// }
//
// 状態遷移（各機）:
//   checking → waiting → outbound → delivery → returning → complete
//   非完了（checking/waiting/outbound/delivery/returning）→ stopped
//   仮想障害時の協調停止（追加・既存遷移は不変）:
//   checking/waiting/outbound → holding（仮想停止・位置保持）
//   holding は advanceFleet では凍結し、setDestinationCheck の合格でも再出発しない。
// - checking: 初期状態。外部の経路・配送先モデル点検結果待ち。
// - waiting: 点検合格済み。出発時刻（departAt）待ち。
// - outbound/delivery/returning: 仮想移動中。
// - complete: 帰還完了。維持され、以後は不変。
// - stopped: 点検不合格・不明・失敗、または stopFleet による停止。以後は再開しない。
//
// 制限（重要）:
// - 外部アクセス・外部API・DOMなし。純粋計算のみで決定的（deterministic）。
// - 輸送時間の一定化は仮想の演出であり、物理的な安全判断は一切しない。
//   往路・配送・復路の所要時間は距離によらず一定（FLEET_TIMING参照）。
// - 座標・件数の不正は失敗（例外）とする。施設が不足する場合も明示的に
//   失敗し、施設を作り話（捏造）しない。
// - now はフリート作成起点（t=0）からの単調なミリ秒。advanceFleet は
//   巻き戻し（now < lastNow）を受け付けず例外とする。
// ============================================================================

export const FLEET_TIMING = Object.freeze({
  staggerMs: 200, // 共通出発地点での重なり抑制：機体ごとに出発時刻をずらす間隔
  outboundMs: 12000, // 仮想の往路所要時間（距離によらず一定＝演出）
  deliveryMs: 8000, // 仮想の配送作業時間（距離によらず一定＝演出）
  returnMs: 12000, // 仮想の復路所要時間（距離によらず一定＝演出）
  cruiseHeight: 180, // 既存の3Dモデル点検と同じ楕円体高[m]
});

const MAX_COUNT = 100000; // メモリ保護のための明示上限（数千機は十分範囲内）

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isValidLatitude(value) {
  return Number.isFinite(value) && value >= -90 && value <= 90;
}

function isValidLongitude(value) {
  return Number.isFinite(value) && value >= -180 && value <= 180;
}

function countStates(list, total) {
  const summary = {
    total,
    checking: 0,
    waiting: 0,
    holding: 0,
    outbound: 0,
    delivery: 0,
    returning: 0,
    complete: 0,
    stopped: 0,
  };
  for (const unit of list) {
    if (Object.prototype.hasOwnProperty.call(summary, unit.state)) summary[unit.state] += 1;
  }
  return summary;
}

function resolveAircraft(fleet) {
  if (Array.isArray(fleet)) return fleet;
  if (fleet && Array.isArray(fleet.aircraft)) return fleet.aircraft;
  if (fleet && Array.isArray(fleet.units)) return fleet.units;
  throw new TypeError('fleet-engine: fleet（createFleetの戻り値）を受け取れません');
}

function resolveTiming(fleet) {
  if (fleet && !Array.isArray(fleet)) {
    const { staggerMs, outboundMs, deliveryMs, returnMs, cruiseHeight } = fleet;
    if (
      [staggerMs, outboundMs, deliveryMs, returnMs, cruiseHeight].every(
        (v) => Number.isFinite(v) && v >= 0,
      ) &&
      outboundMs > 0 &&
      deliveryMs > 0 &&
      returnMs > 0
    ) {
      return { staggerMs, outboundMs, deliveryMs, returnMs, cruiseHeight };
    }
  }
  return { ...FLEET_TIMING };
}

function fleetOriginOf(fleet, list) {
  if (fleet && !Array.isArray(fleet) && isPlainObject(fleet.origin)) return fleet.origin;
  const first = list[0];
  if (first && isPlainObject(first.origin)) return first.origin;
  throw new TypeError('fleet-engine: 出発地点を解決できません');
}

function isFleetAborted(fleet) {
  return !!fleet && !Array.isArray(fleet) && fleet.aborted === true;
}

function refreshSummary(fleet, list) {
  const summary = countStates(list, list.length);
  if (fleet && !Array.isArray(fleet)) fleet.summary = { ...summary };
  return summary;
}

// 点検結果の不合格・不明・失敗の理由を返す。合格（出発可）の場合のみ null。
function checkFailureCause(result) {
  if (!isPlainObject(result)) return '点検結果が不明・不正な形式です';
  if (result.ok !== true) return typeof result.reason==='string' && result.reason ? result.reason : '点検が合格ではありません';
  if (!Number.isFinite(result.surfaceHeight) || result.surfaceHeight <= .5 || result.surfaceHeight > 168) return '施設のモデル表面の高さが不明または範囲外です';
  if (!isPlainObject(result.evidence)) return 'evidence がありません';
  const e=result.evidence;
  if(!Number.isInteger(e.total)||e.total<1||e.observed!==e.total||e.unknown!==0||!Number.isFinite(e.maxGap)||e.maxGap<0||e.maxGap>29||!Array.isArray(e.blockedIndices)||e.blockedIndices.length)return '経路の点検結果が不明または不十分です';
  return null;
}

/**
 * フリートを作成する。100機を複数の妥当な公開施設へ均等配分する。
 * 余りは入力順の先頭施設から1機ずつ割り当て（差は最大1機）。
 * @param {{ origin: {latitude:number,longitude:number},
 *            destinations: Array<{id:string,name:string,latitude:number,longitude:number}>,
 *            count?: number }} args
 * @returns fleet（.aircraft と .units は同一参照の動作単位配列）
 * @throws 座標・件数の不正、施設不足（0件）、id重複時は例外（施設を捏造しない）
 */
export function createFleet({ origin, destinations, count = 100 } = {}) {
  if (!isPlainObject(origin)) {
    throw new TypeError('fleet-engine: origin {latitude, longitude} が必要です');
  }
  if (!isValidLatitude(origin.latitude) || !isValidLongitude(origin.longitude)) {
    throw new RangeError(
      `fleet-engine: origin の座標が不正です (latitude=${String(origin.latitude)}, longitude=${String(origin.longitude)})`,
    );
  }
  if (!Array.isArray(destinations) || destinations.length === 0) {
    throw new Error(
      'fleet-engine: 配送先が不足しています（明示的な停止相当の失敗）: 有効な施設が0件のため施設を作り話しません',
    );
  }
  const seenIds = new Set();
  const validDestinations = destinations.map((d, i) => {
    if (!isPlainObject(d)) throw new TypeError(`fleet-engine: destinations[${i}] が不正です`);
    if (typeof d.id !== 'string' || d.id.length === 0) {
      throw new TypeError(`fleet-engine: destinations[${i}].id は空でない文字列が必要です`);
    }
    if (seenIds.has(d.id)) {
      throw new Error(`fleet-engine: destination id が重複しています: ${d.id}`);
    }
    seenIds.add(d.id);
    if (typeof d.name !== 'string' || d.name.length === 0) {
      throw new TypeError(`fleet-engine: destinations[${i}].name は空でない文字列が必要です`);
    }
    if (!isValidLatitude(d.latitude) || !isValidLongitude(d.longitude)) {
      throw new RangeError(`fleet-engine: destinations[${i}]（id=${d.id}）の座標が不正です`);
    }
    return Object.freeze({ id: d.id, name: d.name, latitude: d.latitude, longitude: d.longitude });
  });
  if (!Number.isInteger(count) || count < 1 || count > MAX_COUNT) {
    throw new RangeError(`fleet-engine: count は1〜${MAX_COUNT}の整数が必要です (count=${String(count)})`);
  }

  const originCopy = Object.freeze({ latitude: origin.latitude, longitude: origin.longitude });
  const width = String(count).length;
  const aircraft = new Array(count);
  for (let i = 0; i < count; i += 1) {
    const destination = validDestinations[i % validDestinations.length];
    aircraft[i] = {
      id: `unit-${String(i + 1).padStart(width, '0')}`,
      index: i,
      origin: originCopy,
      destinationId: destination.id,
      destination,
      state: 'checking',
      reason: null,
      check: null,
      delivery: null,
      completedAt: null,
      departAt: i * FLEET_TIMING.staggerMs,
      createdAt: 0,
      updatedAt: 0,
      position: { latitude: originCopy.latitude, longitude: originCopy.longitude, height: 0 },
    };
  }
  const fleet = {
    kind: 'fleet',
    origin: originCopy,
    destinations: Object.freeze(validDestinations),
    aircraft,
    units: aircraft, // 動作単位：機体配列と同一参照
    count,
    ...FLEET_TIMING,
    aborted: false,
    abortReason: null,
    lastNow: null,
    summary: countStates(aircraft, count),
  };
  return fleet;
}

/**
 * 対象施設の全機へモデル点検の判定を適用する。
 * result が { ok:true, surfaceHeight:number(有限), evidence:{...} } の場合のみ
 * checking → waiting（出発可）。それ以外（不合格・不明・失敗）は対象の
 * 非完了機を stopped とし reason を付与する。完了・停止済み・全体中止後の
 * 遅延応答では再開しない。
 * @returns 判定を適用した機数
 */
export function setDestinationCheck(fleet, destinationId, result, now = 0) {
  const list = resolveAircraft(fleet);
  if (typeof destinationId !== 'string' || destinationId.length === 0) {
    throw new TypeError('fleet-engine: destinationId は空でない文字列が必要です');
  }
  if (now !== undefined && (!Number.isFinite(now) || now < 0)) {
    throw new TypeError('fleet-engine: now は0以上の有限数（ミリ秒）が必要です');
  }
  const at = now === undefined ? 0 : now;
  let matched = 0;
  for (const unit of list) {
    if (unit.destinationId === destinationId) matched += 1;
  }
  if (matched === 0) {
    throw new Error(`fleet-engine: 未知の配送先です: ${destinationId}`);
  }
  if (isFleetAborted(fleet)) return 0; // 全体中止後の遅延応答では再開しない

  const cause = checkFailureCause(result);
  let applied = 0;
  for (const unit of list) {
    if (unit.destinationId !== destinationId) continue;
    if (unit.state === 'complete' || unit.state === 'stopped') continue; // 維持・再開なし
    if (cause !== null) {
      unit.state = 'stopped';
      unit.reason = `配送先 ${unit.destination?.name || '施設名不明'} のモデル点検が不合格/不明のため停止: ${cause}`;
      unit.check = null;
      unit.updatedAt = at;
      applied += 1;
    } else {
      unit.check = {
        ok: true,
        surfaceHeight: result.surfaceHeight,
        evidence: { ...result.evidence },
        at,
      };
      if (unit.state === 'checking') {
        unit.state = 'waiting';
        unit.reason = null;
        unit.departAt = at + unit.index * resolveTiming(fleet).staggerMs;
      }
      unit.updatedAt = at;
      applied += 1;
    }
  }
  if (fleet && !Array.isArray(fleet)) refreshSummary(fleet, list);
  return applied;
}

/**
 * 時刻 now（単調なミリ秒）で全機を決定的に進める。
 * waiting → outbound → delivery → returning → complete の仮想位置
 * （緯度・経度・高さ）、配送結果、集計を更新する。同じ now には同じ結果を返す。
 * @returns 集計サマリのコピー
 */
export function advanceFleet(fleet, now) {
  const list = resolveAircraft(fleet);
  if (!Number.isFinite(now) || now < 0) {
    throw new TypeError('fleet-engine: now は0以上の有限数（単調なミリ秒）が必要です');
  }
  if (fleet && !Array.isArray(fleet)) {
    if (fleet.lastNow !== null && now < fleet.lastNow) {
      throw new Error(`fleet-engine: now は単調である必要があります (lastNow=${fleet.lastNow}, now=${now})`);
    }
  }
  const timing = resolveTiming(fleet);
  const origin = fleetOriginOf(fleet, list);
  const total = timing.outboundMs + timing.deliveryMs + timing.returnMs;
  const aborted = isFleetAborted(fleet);

  for (const unit of list) {
    if (unit.state === 'complete' || unit.state === 'stopped') continue;
    if (aborted) continue;
    // 仮想障害による holding（仮想停止）中は位置を保ち、状態を変えない。
    // 協調モジュールが個別承認経路で動かす機体（detourActive）は本関数では触らない。
    if (unit.state === 'holding' || unit.detourActive === true) {
      unit.updatedAt = now;
      continue;
    }
    if (unit.state === 'checking') {
      unit.position.latitude = origin.latitude;
      unit.position.longitude = origin.longitude;
      unit.position.height = 0;
      unit.updatedAt = now;
      continue;
    }
    const elapsed = now - unit.departAt;
    if (elapsed < 0) {
      unit.position.latitude = origin.latitude;
      unit.position.longitude = origin.longitude;
      unit.position.height = 0;
      unit.updatedAt = now;
      continue;
    }
    const dest = unit.destination;
    if (elapsed < timing.outboundMs) {
      unit.state = 'outbound';
      const p = elapsed / timing.outboundMs;
      unit.position.latitude = origin.latitude + (dest.latitude - origin.latitude) * p;
      unit.position.longitude = origin.longitude + (dest.longitude - origin.longitude) * p;
      unit.position.height = timing.cruiseHeight;
    } else if (elapsed < timing.outboundMs + timing.deliveryMs) {
      unit.state = 'delivery';
      if (!unit.delivery) {
        unit.delivery = {
          destinationId: unit.destinationId,
          arrivedAt: unit.departAt + timing.outboundMs,
          ok: false,
        };
      }
      const surface =
        unit.check && Number.isFinite(unit.check.surfaceHeight) ? unit.check.surfaceHeight : null;
      const hover = surface === null ? timing.cruiseHeight : surface + 10;
      const q = (elapsed - timing.outboundMs) / timing.deliveryMs;
      unit.position.latitude = dest.latitude;
      unit.position.longitude = dest.longitude;
      unit.position.height = timing.cruiseHeight + (hover - timing.cruiseHeight) * q;
    } else if (elapsed < total) {
      unit.state = 'returning';
      if(!unit.delivery)unit.delivery={destinationId:unit.destinationId,arrivedAt:unit.departAt+timing.outboundMs,ok:true};
      else unit.delivery.ok=true;
      const p = (elapsed - timing.outboundMs - timing.deliveryMs) / timing.returnMs;
      unit.position.latitude = dest.latitude + (origin.latitude - dest.latitude) * p;
      unit.position.longitude = dest.longitude + (origin.longitude - dest.longitude) * p;
      unit.position.height = timing.cruiseHeight;
    } else {
      unit.state = 'complete';
      if (!unit.delivery) {
        unit.delivery = {
          destinationId: unit.destinationId,
          arrivedAt: unit.departAt + timing.outboundMs,
          ok: true,
        };
      }
      unit.delivery.ok=true;
      unit.position.latitude = origin.latitude;
      unit.position.longitude = origin.longitude;
      unit.position.height = 0;
      unit.completedAt = unit.departAt + total;
      unit.reason = null;
    }
    unit.updatedAt = now;
  }
  if (fleet && !Array.isArray(fleet)) fleet.lastNow = now;
  return refreshSummary(fleet, list);
}

/**
 * 未完了の機体を停止する。完了済みの結果は維持し、以後の遅延点検応答では
 * 再開しない（setDestinationCheck 側のガードと対になる）。
 * 既に stopped の機体の理由は最初の原因を残す（上書きしない）。
 * @returns 集計サマリのコピー
 */
export function stopFleet(fleet, reason) {
  const list = resolveAircraft(fleet);
  if (typeof reason !== 'string' || reason.trim().length === 0) {
    throw new TypeError('fleet-engine: reason は空でない文字列が必要です');
  }
  if (fleet && !Array.isArray(fleet)) {
    fleet.aborted = true;
    fleet.abortReason = reason;
  }
  for (const unit of list) {
    if (unit.state === 'complete' || unit.state === 'stopped') continue;
    unit.state = 'stopped';
    unit.reason = reason;
  }
  return refreshSummary(fleet, list);
}

/** 集計サマリを再計算して返す（fleet.summary も同期する）。 */
export function getSummary(fleet) {
  const list = resolveAircraft(fleet);
  const summary = countStates(list, list.length);
  if (fleet && !Array.isArray(fleet)) fleet.summary = { ...summary };
  return { ...summary };
}

const VALID_STATES = new Set([
  'checking',
  'waiting',
  'holding',
  'outbound',
  'delivery',
  'returning',
  'complete',
  'stopped',
]);

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateDestination(destination) {
  if (!destination || typeof destination !== 'object' || Array.isArray(destination)) {
    throw new Error('destination must be an object');
  }
  const { id, name, address, latitude, longitude } = destination;
  if (!isNonEmptyString(id)) {
    throw new Error('destination.id must be a non-empty string');
  }
  if (!isNonEmptyString(name)) {
    throw new Error('destination.name must be a non-empty string');
  }
  if (typeof address !== 'string') {
    throw new Error('destination.address must be a string');
  }
  if (typeof latitude !== 'number' || !Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    throw new Error('destination.latitude must be a finite number in [-90, 90]');
  }
  if (typeof longitude !== 'number' || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new Error('destination.longitude must be a finite number in [-180, 180]');
  }
}

function validateSupply(supply) {
  if (!isNonEmptyString(supply)) {
    throw new Error('supply must be a non-empty string');
  }
}

function validateQuantity(quantity) {
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 10000) {
    throw new Error('quantity must be a safe integer in 1..10000');
  }
}

function validateCapacity(capacity) {
  if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 100000) {
    throw new Error('capacity must be a safe integer in 1..100000');
  }
}

export function createCargoManifest(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    throw new Error('createCargoManifest args must be an object');
  }
  const { destination, supply, quantity } = args;
  const capacity = args.capacity === undefined ? 100 : args.capacity;

  validateDestination(destination);
  validateSupply(supply);
  validateQuantity(quantity);
  validateCapacity(capacity);

  const requested = quantity;
  const assigned = Math.min(quantity, capacity);
  const spare = capacity - assigned;
  const unassigned = requested - assigned;

  const destinationCopy = {
    id: destination.id,
    name: destination.name,
    address: destination.address,
    latitude: destination.latitude,
    longitude: destination.longitude,
  };
  Object.freeze(destinationCopy);

  const manifest = {
    destination: destinationCopy,
    supply,
    requested,
    capacity,
    assigned,
    spare,
    unassigned,
  };
  Object.freeze(manifest);
  return manifest;
}

function validateManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('manifest must be an object');
  }
  const { destination, supply, requested, capacity, assigned, spare, unassigned } = manifest;
  validateDestination(destination);
  validateSupply(supply);
  validateQuantity(requested);
  validateCapacity(capacity);
  if (!Number.isSafeInteger(assigned) || assigned < 0) {
    throw new Error('manifest.assigned must be a safe integer >= 0');
  }
  if (!Number.isSafeInteger(spare) || spare < 0) {
    throw new Error('manifest.spare must be a safe integer >= 0');
  }
  if (!Number.isSafeInteger(unassigned) || unassigned < 0) {
    throw new Error('manifest.unassigned must be a safe integer >= 0');
  }
  if (assigned !== Math.min(requested, capacity)) {
    throw new Error('manifest.assigned must equal Math.min(requested, capacity)');
  }
  if (spare !== capacity - assigned) {
    throw new Error('manifest.spare must equal capacity - assigned');
  }
  if (unassigned !== requested - assigned) {
    throw new Error('manifest.unassigned must equal requested - assigned');
  }
}

export function summarizeCargo(manifest, units) {
  validateManifest(manifest);
  if (!Array.isArray(units)) {
    throw new Error('units must be an array');
  }
  const manifestId = manifest.destination.id;
  if (units.length !== manifest.assigned) {
    throw new Error(`units length must equal manifest.assigned (${manifest.assigned})`);
  }

  const seen = new Set();
  let assigning = 0;
  let stopped = 0;
  let unknown = 0;
  let delivered = 0;

  for (const unit of units) {
    if (!unit || typeof unit !== 'object' || Array.isArray(unit)) {
      throw new Error('unit must be an object');
    }
    const { id, state, delivery, destinationId } = unit;
    if (!isNonEmptyString(id)) {
      throw new Error('unit.id must be a non-empty string');
    }
    if (seen.has(id)) {
      throw new Error(`duplicate unit.id: ${id}`);
    }
    seen.add(id);
    if (typeof destinationId !== 'string' || destinationId !== manifestId) {
      throw new Error('unit.destinationId must equal manifest.destination.id');
    }
    if (!VALID_STATES.has(state)) {
      throw new Error(`invalid unit.state: ${String(state)}`);
    }

    if (delivery === null) {
      if (state === 'delivery' || state === 'returning' || state === 'complete') {
        throw new Error(`${state} with delivery null is contradictory`);
      }
      if (state === 'stopped') {
        stopped += 1;
      } else {
        assigning += 1;
      }
      continue;
    }

    if (!delivery || typeof delivery !== 'object' || Array.isArray(delivery)) {
      throw new Error('unit.delivery must be null or { ok, destinationId }');
    }
    const { ok, destinationId: deliveryDestinationId } = delivery;
    if (typeof ok !== 'boolean') {
      throw new Error('unit.delivery.ok must be boolean');
    }
    if (typeof deliveryDestinationId !== 'string' || deliveryDestinationId !== manifestId) {
      throw new Error('unit.delivery.destinationId must equal manifest.destination.id');
    }

    if (ok === true) {
      if (state !== 'returning' && state !== 'complete' && state !== 'stopped') {
        throw new Error('delivery.ok:true requires state returning/complete/stopped');
      }
      delivered += 1;
    } else {
      if (state !== 'delivery' && state !== 'stopped') {
        throw new Error('delivery.ok:false requires state delivery/stopped');
      }
      if (state === 'stopped') {
        unknown += 1;
      } else {
        assigning += 1;
      }
    }
  }

  return {
    requested: manifest.requested,
    assigned: manifest.assigned,
    unassigned: manifest.unassigned,
    assigning,
    stopped,
    unknown,
    delivered,
  };
}

function validateDivertedFacility(destination) {
  if (!destination || typeof destination !== 'object' || Array.isArray(destination)) {
    throw new Error('assignment destination must be an object');
  }
  const { id, name, latitude, longitude } = destination;
  if (!isNonEmptyString(id)) {
    throw new Error('assignment destination.id must be a non-empty string');
  }
  if (!isNonEmptyString(name)) {
    throw new Error('assignment destination.name must be a non-empty string');
  }
  if (typeof latitude !== 'number' || !Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    throw new Error('assignment destination.latitude must be a finite number in [-90, 90]');
  }
  if (typeof longitude !== 'number' || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new Error('assignment destination.longitude must be a finite number in [-180, 180]');
  }
}

/**
 * 承認済みの別施設変更を反映した箱数集計（仮想配送の施設別台帳）。
 * manifest と units は summarizeCargo と同じデータ構造。assignments は承認済み変更の配列で、
 * 各要素は { unitId, destination:{ id, name, latitude, longitude } }。施設一覧と照合する。
 * 未変更機は元依頼先id、変更機は承認先idに unit.destinationId が一致し、
 * delivery.destinationId もその機の許可先idに一致しなければ例外とする。
 * 別施設への配送は元施設の達成に数えない。入力は決して変更しない。
 * 仮想の集計であり、実機の安全は判断しない。
 */
export function summarizeDivertedCargo(manifest, units, assignments, facilities) {
  validateManifest(manifest);
  if (!Array.isArray(units)) {
    throw new Error('units must be an array');
  }
  if (!Array.isArray(assignments)) {
    throw new Error('assignments must be an array');
  }
  if (!Array.isArray(facilities) || facilities.length === 0) throw new Error('facilities must be a non-empty array');
  const publicFacilities = new Map();
  for (const facility of facilities) {
    validateDivertedFacility(facility);
    if (publicFacilities.has(facility.id)) throw new Error('duplicate public facility id');
    publicFacilities.set(facility.id, facility);
  }
  const original = publicFacilities.get(manifest.destination.id);
  if (!original || original.name !== manifest.destination.name || original.latitude !== manifest.destination.latitude || original.longitude !== manifest.destination.longitude) throw new Error('original destination must match a public facility');
  if (units.length !== manifest.assigned) {
    throw new Error(`units length must equal manifest.assigned (${manifest.assigned})`);
  }
  const originalId = manifest.destination.id;

  const approvedByUnit = new Map();
  const facilityById = new Map();
  for (const assignment of assignments) {
    if (!assignment || typeof assignment !== 'object' || Array.isArray(assignment)) {
      throw new Error('assignment must be an object');
    }
    const { unitId, destination } = assignment;
    if (!isNonEmptyString(unitId)) {
      throw new Error('assignment.unitId must be a non-empty string');
    }
    if (approvedByUnit.has(unitId)) {
      throw new Error(`duplicate assignment unitId: ${unitId}`);
    }
    validateDivertedFacility(destination);
    const publicFacility = publicFacilities.get(destination.id);
    if (!publicFacility || publicFacility.name !== destination.name || publicFacility.latitude !== destination.latitude || publicFacility.longitude !== destination.longitude) throw new Error('assignment destination must match a public facility');
    if (destination.id === originalId) {
      throw new Error(`assignment diverts to the original facility: ${unitId}`);
    }
    const known = facilityById.get(destination.id);
    if (known !== undefined) {
      if (
        known.name !== destination.name ||
        known.latitude !== destination.latitude ||
        known.longitude !== destination.longitude
      ) {
        throw new Error(`conflicting facility for id: ${destination.id}`);
      }
    } else {
      facilityById.set(destination.id, {
        id: destination.id,
        name: destination.name,
        latitude: destination.latitude,
        longitude: destination.longitude,
      });
    }
    approvedByUnit.set(unitId, destination.id);
  }

  const seenUnits = new Set();
  for (const unit of units) {
    if (!unit || typeof unit !== 'object' || Array.isArray(unit)) {
      throw new Error('unit must be an object');
    }
    if (!isNonEmptyString(unit.id)) {
      throw new Error('unit.id must be a non-empty string');
    }
    if (seenUnits.has(unit.id)) {
      throw new Error(`duplicate unit.id: ${unit.id}`);
    }
    seenUnits.add(unit.id);
    if (!VALID_STATES.has(unit.state)) {
      throw new Error(`invalid unit.state: ${String(unit.state)}`);
    }
  }
  for (const unitId of approvedByUnit.keys()) {
    if (!seenUnits.has(unitId)) {
      throw new Error(`assignment for unknown unit: ${unitId}`);
    }
  }

  let assigning = 0;
  let stopped = 0;
  let unknown = 0;
  let delivered = 0;

  const counters = new Map();
  const counterFor = (id, name) => {
    let entry = counters.get(id);
    if (entry === undefined) {
      entry = { id, name, assigned: 0, delivered: 0, stopped: 0, unknown: 0, assigning: 0 };
      counters.set(id, entry);
    }
    return entry;
  };
  counterFor(originalId, manifest.destination.name);
  for (const facility of facilityById.values()) {
    counterFor(facility.id, facility.name);
  }

  for (const unit of units) {
    const effectiveId = approvedByUnit.has(unit.id) ? approvedByUnit.get(unit.id) : originalId;
    if (typeof unit.destinationId !== 'string' || unit.destinationId !== effectiveId) {
      throw new Error('unit.destinationId must equal the approved destination');
    }
    const { state, delivery } = unit;
    let kind;
    if (delivery === null) {
      if (state === 'delivery' || state === 'returning' || state === 'complete') {
        throw new Error(`${state} with delivery null is contradictory`);
      }
      kind = state === 'stopped' ? 'stopped' : 'assigning';
    } else {
      if (!delivery || typeof delivery !== 'object' || Array.isArray(delivery)) {
        throw new Error('unit.delivery must be null or { ok, destinationId }');
      }
      const { ok, destinationId: deliveryDestinationId } = delivery;
      if (typeof ok !== 'boolean') {
        throw new Error('unit.delivery.ok must be boolean');
      }
      if (typeof deliveryDestinationId !== 'string' || deliveryDestinationId !== effectiveId) {
        throw new Error('unit.delivery.destinationId must equal the approved destination');
      }
      if (ok === true) {
        if (state !== 'returning' && state !== 'complete' && state !== 'stopped') {
          throw new Error('delivery.ok:true requires state returning/complete/stopped');
        }
        kind = 'delivered';
      } else {
        if (state !== 'delivery' && state !== 'stopped') {
          throw new Error('delivery.ok:false requires state delivery/stopped');
        }
        kind = state === 'stopped' ? 'unknown' : 'assigning';
      }
    }
    if (kind === 'delivered') {
      delivered += 1;
    } else if (kind === 'unknown') {
      unknown += 1;
    } else if (kind === 'stopped') {
      stopped += 1;
    } else {
      assigning += 1;
    }
    const entry = counters.get(effectiveId);
    entry.assigned += 1;
    if (kind === 'delivered') {
      entry.delivered += 1;
    } else if (kind === 'unknown') {
      entry.unknown += 1;
    } else if (kind === 'stopped') {
      entry.stopped += 1;
    } else {
      entry.assigning += 1;
    }
  }

  const byFacility = [...counters.values()]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((entry) => ({
      id: entry.id,
      name: entry.name,
      assigned: entry.assigned,
      delivered: entry.delivered,
      stopped: entry.stopped,
      unknown: entry.unknown,
      assigning: entry.assigning,
    }));
  const deliveredOriginal = counters.get(originalId).delivered;

  return {
    requested: manifest.requested,
    assigned: manifest.assigned,
    unassigned: manifest.unassigned,
    assigning,
    stopped,
    unknown,
    delivered,
    deliveredOriginal,
    deliveredOther: delivered - deliveredOriginal,
    byFacility,
  };
}

