// fleet-coordination.mjs
// ============================================================================
// 100機の仮想配送フリート向けの仮想障害共有・協調停止・迂回承認の純粋状態管理。
// fleet-engine.mjs の上に載る層。外部通信・DOM・時刻取得なし。決定的。
//
// 位置づけ:
// - 定型処理（自動計算）: createVirtualHazard / reportVirtualHazard /
//   buildDetourCandidates / verifyDetourInspections / advanceCoordination /
//   getCoordinationStatus のうち、アプリ側が決定的に行う部分。
// - 相談回答: recordMuseChoice に出所を付けて渡す。試験回答・不明も別に記録する。
//   どちらも verifyDetourInspections のアプリ独立点検（source:'app'）を
//   通過しない限り再開しない。混同しないこと。
//
// 仮想の約束:
// - ここで扱う障害・停止・迂回はすべて仮想の演出であり、現実の安全判断はしない。
//   文言には必ず「仮想」を含め、架空の検出を現実情報として表示しない。
// - 既存の fleet-engine の挙動は変えない。holding 以外の遷移・判定はそのまま。
// ============================================================================

import { FLEET_TIMING } from './fleet-engine.mjs';

const EARTH_R = 6371008.8;
const DEG = Math.PI / 180;
const HOLDABLE = new Set(['checking', 'waiting', 'outbound']);
const WAYPOINT_OFFSETS_M = [150, 300, 600, 1200, 2500];
const RETURN_MARGIN_M = 1e-6;
const hazardEpochs = new WeakMap();
const issuedDiversionProposals = new WeakSet();

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function isValidLatitude(value) {
  return Number.isFinite(value) && value >= -90 && value <= 90;
}

function isValidLongitude(value) {
  return Number.isFinite(value) && value >= -180 && value <= 180;
}

function isValidLatLon(point) {
  return (
    isPlainObject(point) &&
    isValidLatitude(point.latitude) &&
    isValidLongitude(point.longitude)
  );
}

function copyPoint(point) {
  return {
    latitude: point.latitude,
    longitude: point.longitude,
    ...(Number.isFinite(point.height) ? { height: point.height } : {}),
  };
}

function copyLatLon(point) {
  return { latitude: point.latitude, longitude: point.longitude };
}

function resolveList(fleet) {
  if (Array.isArray(fleet)) return fleet;
  if (fleet && Array.isArray(fleet.aircraft)) return fleet.aircraft;
  if (fleet && Array.isArray(fleet.units)) return fleet.units;
  throw new TypeError('fleet-coordination: fleet（createFleetの戻り値）を受け取れません');
}

function resolveOrigin(fleet, list) {
  if (fleet && !Array.isArray(fleet) && isPlainObject(fleet.origin)) return fleet.origin;
  const first = list[0];
  if (first && isPlainObject(first.origin)) return first.origin;
  throw new TypeError('fleet-coordination: 出発地点を解決できません');
}

function resolveDestinations(fleet) {
  if (fleet && !Array.isArray(fleet) && Array.isArray(fleet.destinations)) {
    return fleet.destinations;
  }
  return [];
}

function isFleetAborted(fleet) {
  return !!fleet && !Array.isArray(fleet) && fleet.aborted === true;
}

function assertNow(now, name = 'now') {
  if (!Number.isFinite(now) || now < 0) {
    throw new TypeError(`fleet-coordination: ${name} は0以上の有限数（ミリ秒）が必要です`);
  }
}

/** 地表2点間の地上距離[m]。座標不正時は例外（fleet-engineの直線距離と同等のhaversine）。 */
export function groundDistanceM(a, b) {
  if (!isValidLatLon(a) || !isValidLatLon(b)) {
    throw new RangeError('fleet-coordination: 地点の座標が不正です');
  }
  const lat1 = a.latitude * DEG;
  const lat2 = b.latitude * DEG;
  const dlat = (b.latitude - a.latitude) * DEG;
  const dlon = (b.longitude - a.longitude) * DEG;
  const h =
    Math.sin(dlat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dlon / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * 仮想障害中心から線分 start-end までの地上距離[m]。
 * いずれかの座標が測定不能（不正）の場合は null を返し、呼び出し側は安全側に扱う。
 */
export function segmentDistanceM(hazard, start, end) {
  if (!isValidLatLon(hazard) || !isValidLatLon(start) || !isValidLatLon(end)) {
    return null;
  }
  const midLat = ((start.latitude + end.latitude) / 2) * DEG;
  const scale = Math.cos(midLat);
  const radR = DEG * EARTH_R;
  const bx = (end.longitude - start.longitude) * scale * radR;
  const by = (end.latitude - start.latitude) * radR;
  const px = (hazard.longitude - start.longitude) * scale * radR;
  const py = (hazard.latitude - start.latitude) * radR;
  const len2 = bx * bx + by * by;
  const s = len2 === 0 ? 0 : Math.max(0, Math.min(1, (px * bx + py * by) / len2));
  return Math.hypot(px - bx * s, py - by * s);
}

/**
 * 経路 path（2点以上の緯度経度列）の全線分・全点が仮想障害円を避けるか。
 * 1線分でも交差（距離 <= 半径）または測定不能なら false（安全側）。
 */
export function routeAvoidsHazard(path, hazard) {
  if (!Array.isArray(path) || path.length < 2) return false;
  if (!isPlainObject(hazard) || !Number.isFinite(hazard.radiusM) || hazard.radiusM <= 0) {
    return false;
  }
  if (!isValidLatLon(hazard)) return false;
  for (const point of path) {
    if (!isValidLatLon(point)) return false;
    let inside;
    try {
      inside = groundDistanceM(point, hazard);
    } catch {
      return false;
    }
    if (!(inside > hazard.radiusM + RETURN_MARGIN_M)) return false;
  }
  for (let i = 1; i < path.length; i += 1) {
    const distance = segmentDistanceM(hazard, path[i - 1], path[i]);
    if (distance === null) return false;
    if (!(distance > hazard.radiusM + RETURN_MARGIN_M)) return false;
  }
  return true;
}

function remainingRouteFor(unit, origin) {
  const dest = unit.destination;
  if (!isValidLatLon(dest)) return null; // 測定不能
  if (!isValidLatLon(origin)) return null;
  const pos = unit.position;
  switch (unit.state) {
    case 'checking':
    case 'waiting':
      return [copyLatLon(origin), copyLatLon(dest), copyLatLon(origin)];
    case 'outbound':
      if (!isValidLatLon(pos)) return null;
      return [copyLatLon(pos), copyLatLon(dest), copyLatLon(origin)];
    case 'delivery':
      if (!isValidLatLon(pos)) return null;
      return [copyLatLon(pos), copyLatLon(origin)];
    case 'returning':
      if (!isValidLatLon(pos)) return null;
      return [copyLatLon(pos), copyLatLon(origin)];
    default:
      return [];
  }
}

function intersectsHazard(route, hazard) {
  if (route === null) return true; // 測定不能は安全側に影響あり
  if (route.length === 0) return false;
  for (let i = 1; i < route.length; i += 1) {
    const distance = segmentDistanceM(hazard, route[i - 1], route[i]);
    if (distance === null) return true; // 測定不能は安全側に停止
    if (distance <= hazard.radiusM) return true;
  }
  return false;
}

function validateHazardShape(hazard) {
  if (!isPlainObject(hazard)) throw new TypeError('fleet-coordination: 仮想障害の形式が不正です');
  if (!isNonEmptyString(hazard.id)) throw new TypeError('fleet-coordination: 仮想障害のidは空でない文字列が必要です');
  if (!isValidLatitude(hazard.latitude) || !isValidLongitude(hazard.longitude)) {
    throw new RangeError('fleet-coordination: 仮想障害の座標が不正です');
  }
  if (!Number.isFinite(hazard.radiusM) || hazard.radiusM <= 0) {
    throw new RangeError('fleet-coordination: 仮想障害の半径は正の有限数[m]が必要です');
  }
}

function validateFacilityShape(place, label) {
  if (!isPlainObject(place)) throw new TypeError(`fleet-coordination: ${label}の形式が不正です`);
  if (!isNonEmptyString(place.id)) throw new TypeError(`fleet-coordination: ${label}のidは空でない文字列が必要です`);
  if (typeof place.name !== 'string' || place.name.length === 0) {
    throw new TypeError(`fleet-coordination: ${label}のnameは空でない文字列が必要です`);
  }
  if (!isValidLatitude(place.latitude) || !isValidLongitude(place.longitude)) {
    throw new RangeError(`fleet-coordination: ${label}の座標が不正です`);
  }
}

/**
 * 仮想障害オブジェクトを作成する（定型処理）。
 * @param {{id:string, latitude:number, longitude:number, radiusM:number}} input
 * @returns 凍結された仮想障害 {id, latitude, longitude, radiusM, virtual:true}
 * @throws 座標・半径・idの不正時は例外（架空物を作らない）
 */
export function createVirtualHazard(input = {}) {
  validateHazardShape(input);
  return Object.freeze({
    id: input.id,
    latitude: input.latitude,
    longitude: input.longitude,
    radiusM: input.radiusM,
    virtual: true,
  });
}

/**
 * 影響判定つきで仮想障害を共有し、対象機を現在位置で holding にする（定型処理）。
 * 各機の残り仮想経路（状態別の origin/現在位置/destination/帰還）と障害円の
 * 交差を地上距離で算出する。測定不能は安全側に影響ありとする。
 * 対象外は続行（触らない）。holding は位置保持し、障害ID・停止前位置・対象を保持する。
 * 全体中止（stopFleet）後は保持だけ行い、新たな holding は作らない。
 * @param {object} fleet createFleetの戻り値（直接更新する）
 * @param {object} hazard createVirtualHazardの戻り値（仮想障害）
 * @param {number} now 仮想時刻[ms]
 * @returns coord 協調レコード（状態・対象・理由の読み出し元）
 */
export function reportVirtualHazard(fleet, hazard, now = 0) {
  const list = resolveList(fleet);
  validateHazardShape(hazard);
  assertNow(now);
  hazardEpochs.set(fleet,(hazardEpochs.get(fleet)||0)+1);
  const origin = resolveOrigin(fleet, list);
  const aborted = isFleetAborted(fleet);

  const affectedIds = [];
  const heldIds = [];
  const unaffectedIds = [];
  const continuingIds = [];
  const held = {};

  for (const unit of list) {
    if (unit.state === 'complete' || unit.state === 'stopped') {
      unaffectedIds.push(unit.id);
      continue;
    }
    if (unit.state === 'holding') {
      // 既に仮想停止中の機は今回の共有では再判定せず、対象外として続行（保持）する
      unaffectedIds.push(unit.id);
      continue;
    }
    let route;
    try {
      route = remainingRouteFor(unit, origin);
    } catch {
      route = null;
    }
    const hit = intersectsHazard(route, hazard);
    if (!hit) {
      unaffectedIds.push(unit.id);
      continue;
    }
    affectedIds.push(unit.id);
    if (!HOLDABLE.has(unit.state)) {
      // 荷下ろし・帰還中の対象は別経路を未点検のまま進めない。
      unit.state = 'stopped';
      unit.reason = `仮想障害 ${hazard.id} と残り経路が交差するため停止しました。再開経路は未点検です。`;
      unit.detourActive = false;
      unit.updatedAt = now;
      continue;
    }
    if (aborted) continue; // 全体中止後は新たに holding 化しない
    const prevState = unit.state;
    const heldPosition = {
      latitude: unit.position.latitude,
      longitude: unit.position.longitude,
      height: unit.position.height,
    };
    held[unit.id] = {
      prevState,
      position: { ...heldPosition },
      destinationId: unit.destinationId,
      destination: {
        id: unit.destination.id,
        name: unit.destination.name,
        latitude: unit.destination.latitude,
        longitude: unit.destination.longitude,
      },
      origin: { latitude: origin.latitude, longitude: origin.longitude },
    };
    unit.state = 'holding';
    unit.reason = `仮想障害 ${hazard.id} の共有により仮想停止中（holding）。元の点検応答では再出発しません。停止前=${prevState}`;
    unit.hold = {
      hazardId: hazard.id,
      heldAt: now,
      position: { ...heldPosition },
      destinationId: unit.destinationId,
      prevState,
    };
    unit.detourActive = false;
    unit.detour = null;
    unit.updatedAt = now;
    heldIds.push(unit.id);
  }

  const coord = {
    kind: 'fleet-coordination',
    hazard: Object.freeze({
      id: hazard.id,
      latitude: hazard.latitude,
      longitude: hazard.longitude,
      radiusM: hazard.radiusM,
      virtual: true,
    }),
    heldAt: now,
    affectedIds: [...affectedIds],
    heldIds: [...heldIds],
    unaffectedIds: [...unaffectedIds],
    continuingIds: [...continuingIds],
    held: JSON.parse(JSON.stringify(held)),
    candidates: null,
    museChoice: null,
    decision: null,
    state: 'holding',
    reason:
      heldIds.length > 0
        ? `仮想障害 ${hazard.id}（仮想情報・現実の安全判断ではありません）を共有し、${heldIds.length}機を仮想停止（holding）しました。対象外は続行します。`
        : `仮想障害 ${hazard.id}（仮想情報）を共有しましたが、holding対象（checking/waiting/outboundの残り経路交差）は0機でした。`,
  };
  return coord;
}

// ---- 迂回中継点（定型の幾何計算。Museの回答ではない） ----

function toLocalMeters(point, lon0, lat0) {
  const scale = Math.cos(lat0 * DEG);
  return {
    x: (point.longitude - lon0) * scale * DEG * EARTH_R,
    y: (point.latitude - lat0) * DEG * EARTH_R,
  };
}

function fromLocalMeters(x, y, lon0, lat0) {
  const scale = Math.cos(lat0 * DEG);
  return {
    latitude: lat0 + y / (DEG * EARTH_R),
    longitude: lon0 + x / (scale * DEG * EARTH_R),
  };
}

function waypointForSide(start, end, hazard, offsetM, sign) {
  const lon0 = (start.longitude + end.longitude) / 2;
  const lat0 = (start.latitude + end.latitude) / 2;
  const s = toLocalMeters(start, lon0, lat0);
  const e = toLocalMeters(end, lon0, lat0);
  const dx = e.x - s.x;
  const dy = e.y - s.y;
  const len = Math.hypot(dx, dy);
  let px;
  let py;
  if (len === 0) {
    px = 1;
    py = 0;
  } else {
    px = (-dy / len) * sign;
    py = (dx / len) * sign;
  }
  const mx = (s.x + e.x) / 2 + px * offsetM;
  const my = (s.y + e.y) / 2 + py * offsetM;
  const geo = fromLocalMeters(mx, my, lon0, lat0);
  if (!isValidLatitude(geo.latitude) || !isValidLongitude(geo.longitude)) return null;
  return { latitude: geo.latitude, longitude: geo.longitude };
}

/**
 * 現在位置 start から配送先 end へ仮想障害円を避ける中継点を決定的に求める。
 * 両側・複数オフセットを小さい順に試し、往路2線分がいずれも回避できる最初の点を返す。
 * 端点が円内（距離 <= 半径）の場合や、全候補が交差する場合は null（迂回不可）。
 */
export function computeAvoidWaypoint(start, end, hazard, options = {}) {
  if (!isValidLatLon(start) || !isValidLatLon(end) || !isValidLatLon(hazard)) return null;
  if (!Number.isFinite(hazard.radiusM) || hazard.radiusM <= 0) return null;
  let distStart;
  let distEnd;
  try {
    distStart = groundDistanceM(start, hazard);
    distEnd = groundDistanceM(end, hazard);
  } catch {
    return null;
  }
  if (!(distStart > hazard.radiusM) || !(distEnd > hazard.radiusM)) return null;
  const alternate = options.alternate === true;
  const previous = options.excludeWaypoint;
  const offsets = alternate ? [...WAYPOINT_OFFSETS_M.slice(1), WAYPOINT_OFFSETS_M[0]] : WAYPOINT_OFFSETS_M;
  for (const offset of offsets) {
    const need = Math.max(offset, hazard.radiusM + 50);
    for (const sign of alternate ? [-1, 1] : [1, -1]) {
      const waypoint = waypointForSide(start, end, hazard, need, sign);
      if (!waypoint) continue;
      if (isValidLatLon(previous) && groundDistanceM(waypoint, previous) < 1) continue;
      let distW;
      try {
        distW = groundDistanceM(waypoint, hazard);
      } catch {
        continue;
      }
      if (!(distW > hazard.radiusM)) continue;
      const d1 = segmentDistanceM(hazard, start, waypoint);
      const d2 = segmentDistanceM(hazard, waypoint, end);
      if (d1 === null || d2 === null) continue;
      if (d1 > hazard.radiusM && d2 > hazard.radiusM) return waypoint;
    }
  }
  return null;
}

function buildReturnPath(destination, waypoint, holdPosition, origin) {
  const sameHoldOrigin =
    Math.abs(holdPosition.latitude - origin.latitude) < 1e-12 &&
    Math.abs(holdPosition.longitude - origin.longitude) < 1e-12;
  if (sameHoldOrigin) {
    return [
      copyLatLon(destination),
      copyLatLon(waypoint),
      copyLatLon(origin),
    ];
  }
  return [
    copyLatLon(destination),
    copyLatLon(waypoint),
    copyLatLon(holdPosition),
    copyLatLon(origin),
  ];
}

function isSameLatLon(a, b) {
  return (
    isValidLatLon(a) &&
    isValidLatLon(b) &&
    Math.abs(a.latitude - b.latitude) < 1e-9 &&
    Math.abs(a.longitude - b.longitude) < 1e-9
  );
}

function buildRouteForUnit(startHold, destination, hazard, options = {}) {
  if (!isValidLatLon(startHold) || !isValidLatLon(destination)) {
    return { valid: false, invalidReason: '仮想経路の座標が測定不能のため無効です', path: null, returnPath: null, waypoint: null };
  }
  const waypoint = computeAvoidWaypoint(startHold, destination, hazard, options);
  if (!waypoint) {
    return { valid: false, invalidReason: '仮想障害円を避ける中継点が作れないため無効です', path: null, returnPath: null, waypoint: null };
  }
  const path = [copyLatLon(startHold), copyLatLon(waypoint), copyLatLon(destination)];
  if (!routeAvoidsHazard(path, hazard)) {
    return { valid: false, invalidReason: '仮想障害円と往路の各線分が交差するため無効です', path, returnPath: null, waypoint };
  }
  return { valid: true, invalidReason: null, path, waypoint };
}

/**
 * 迂回候補A（元の施設）・B（別の実在する公開施設）を生成する（定型処理・Muse回答ではない）。
 * 候補ごとに影響機（heldIds）全機分の「現在位置（停止位置）からの経路と配送先」を持つ。
 * 座標・IDを厳密に検査し、円と経路の各線分が交差する経路は無効とする。
 * 候補は未点検のまま飛行させない（verifyDetourInspections が必須）。
 * @param {object} fleet createFleetの戻り値（B候補の実在施設の読み出し元。捏造しない）
 * @param {object} coord reportVirtualHazardの戻り値（candidates を書き込む）
 * @param {number} [now] 候補生成時刻（既定は coord.heldAt。heldAt 未満は例外）
 * @returns {{A:object, B:object}} 候補A・B（valid=false の候補は飛行不可）
 * @throws fleet・coord形状の不正、now不正時は例外
 */
export function buildDetourCandidates(fleet, coord, now = undefined, options = {}) {
  const list = resolveList(fleet);
  if (!isPlainObject(coord) || coord.kind !== 'fleet-coordination') {
    throw new TypeError('fleet-coordination: coord（reportVirtualHazardの戻り値）が必要です');
  }
  validateHazardShape(coord.hazard);
  const at = now === undefined ? coord.heldAt : now;
  assertNow(at, 'now');
  if (at < coord.heldAt) {
    throw new RangeError('fleet-coordination: 候補生成時刻は共有時刻（heldAt）以降が必要です');
  }
  if (!Array.isArray(coord.heldIds)) throw new TypeError('fleet-coordination: coord.heldIds が不正です');
  const destinations = resolveDestinations(fleet);
  for (const place of destinations) validateFacilityShape(place, '公開施設');
  const byId = new Map(destinations.map((d) => [d.id, d]));
  const hazard = coord.hazard;
  const previousCandidates = options.alternate === true ? coord.candidates : null;
  // 既存割当数: 現時点の配送先ごとの機数（非影響機への配送先も含む）。
  // 追加割当数: 本処理で既にB案へ割り当てた影響機数（heldIds順に加算）。
  const existingAssignmentCount = new Map(destinations.map((d) => [d.id, 0]));
  for (const unit of list) {
    if (unit && typeof unit.destinationId === 'string' && existingAssignmentCount.has(unit.destinationId)) {
      existingAssignmentCount.set(unit.destinationId, existingAssignmentCount.get(unit.destinationId) + 1);
    }
  }
  const assignedCountByFacility = new Map(destinations.map((d) => [d.id, 0]));

  const routesA = {};
  const routesB = {};
  let validA = true;
  let validB = true;
  if (coord.heldIds.length === 0) validB = false;

  for (const unitId of coord.heldIds) {
    const hold = coord.held?.[unitId];
    if (!isPlainObject(hold) || !isValidLatLon(hold.position) || !isNonEmptyString(hold.destinationId)) {
      routesA[unitId] = { destinationId: null, destination: null, path: null, returnPath: null, waypoint: null, valid: false, invalidReason: '仮想停止位置・対象が不明のため無効です' };
      routesB[unitId] = { ...routesA[unitId], assignmentBasis: null };
      validA = false;
      validB = false;
      continue;
    }
    const start = copyLatLon(hold.position);
    const origin = copyLatLon(hold.origin);
    // --- A: 元の施設 ---
    const origDest = byId.get(hold.destinationId) || null;
    if (!origDest) {
      routesA[unitId] = { destinationId: hold.destinationId, destination: null, path: null, returnPath: null, waypoint: null, valid: false, invalidReason: '元の施設が公開施設に存在しないためA案は無効です' };
      validA = false;
    } else {
      const destLatLon = { latitude: origDest.latitude, longitude: origDest.longitude };
      const built = buildRouteForUnit(start, destLatLon, hazard, {alternate:options.alternate===true,excludeWaypoint:previousCandidates?.A?.routes?.[unitId]?.waypoint});
      if (!built.valid) {
        routesA[unitId] = { destinationId: origDest.id, destination: { id: origDest.id, name: origDest.name, latitude: origDest.latitude, longitude: origDest.longitude }, path: built.path, returnPath: null, waypoint: built.waypoint, valid: false, invalidReason: built.invalidReason };
        validA = false;
      } else {
        const returnPath = buildReturnPath(destLatLon, built.waypoint, start, origin);
        if (!routeAvoidsHazard(returnPath, hazard)) {
          routesA[unitId] = { destinationId: origDest.id, destination: { id: origDest.id, name: origDest.name, latitude: origDest.latitude, longitude: origDest.longitude }, path: built.path, returnPath, waypoint: built.waypoint, valid: false, invalidReason: '仮想障害円と復路の各線分が交差するため無効です' };
          validA = false;
        } else {
          routesA[unitId] = { destinationId: origDest.id, destination: { id: origDest.id, name: origDest.name, latitude: origDest.latitude, longitude: origDest.longitude }, path: built.path, returnPath, waypoint: built.waypoint, valid: true, invalidReason: null };
        }
      }
    }
    // --- B: 別の実在する公開施設（仮想障害円の往路・復路を避けられる実在施設から分散選択） ---
    // 影響機ごとに、往路・復路とも回避できる実在施設だけを対象とし、
    // 既存割当数＋本処理での追加割当数の合計が少ない施設を優先し、
    // 同数なら現在位置からの概算地表距離が近い施設、さらに同数なら既存一覧順で選ぶ。
    // 施設の容量・開設・受入の情報は不明のため、ここでは数と距離だけを参照する。
    let placedB = false;
    const viable = [];
    destinations.forEach((alt, altIndex) => {
      if (alt.id === hold.destinationId) return;
      const destLatLon = { latitude: alt.latitude, longitude: alt.longitude };
      const previousB=previousCandidates?.B?.routes?.[unitId];
      const built = buildRouteForUnit(start, destLatLon, hazard, {alternate:options.alternate===true,excludeWaypoint:previousB?.destinationId===alt.id?previousB.waypoint:null});
      if (!built.valid) return;
      const returnPath = buildReturnPath(destLatLon, built.waypoint, start, origin);
      if (!routeAvoidsHazard(returnPath, hazard)) return;
      let distanceM;
      try {
        distanceM = groundDistanceM(start, destLatLon);
      } catch {
        return;
      }
      if (!Number.isFinite(distanceM)) return;
      const existingCount = existingAssignmentCount.get(alt.id) ?? 0;
      const assignedCount = assignedCountByFacility.get(alt.id) ?? 0;
      viable.push({
        alt,
        altIndex,
        built,
        returnPath,
        destLatLon,
        existingCount,
        assignedCount,
        distanceM,
        total: existingCount + assignedCount,
      });
    });
    viable.sort((p, q) => {
      if (p.total !== q.total) return p.total - q.total;
      if (p.distanceM !== q.distanceM) return p.distanceM - q.distanceM;
      return p.altIndex - q.altIndex;
    });
    if (viable.length > 0) {
      const chosen = viable[0];
      routesB[unitId] = {
        destinationId: chosen.alt.id,
        destination: { id: chosen.alt.id, name: chosen.alt.name, latitude: chosen.alt.latitude, longitude: chosen.alt.longitude },
        path: chosen.built.path,
        returnPath: chosen.returnPath,
        waypoint: chosen.built.waypoint,
        valid: true,
        invalidReason: null,
        assignmentBasis: {
          type: 'balanced_then_nearest',
          existingCount: chosen.existingCount,
          assignedCount: chosen.assignedCount,
          distanceM: chosen.distanceM,
        },
      };
      assignedCountByFacility.set(chosen.alt.id, chosen.assignedCount + 1);
      placedB = true;
    }
    if (!placedB) {
      routesB[unitId] = { destinationId: null, destination: null, path: null, returnPath: null, waypoint: null, valid: false, invalidReason: '回避可能な別の実在する公開施設がないためB案は無効です（捏造しません）', assignmentBasis: null };
      validB = false;
    }
  }
  if (destinations.length < 2) validB = false;

  const candidateA = { side: 'A', builtAt: at, hazardId: hazard.id, routes: routesA, valid: validA && coord.heldIds.length > 0 };
  const candidateB = { side: 'B', builtAt: at, hazardId: hazard.id, routes: routesB, valid: validB && coord.heldIds.length > 0 };
  coord.candidates = JSON.parse(JSON.stringify({ A: candidateA, B: candidateB, builtAt: at }));
  // fleet側の参照整合性のため、実在確認に使った機体順を残す
  void list;
  return JSON.parse(JSON.stringify({ A: candidateA, B: candidateB }));
}

const CONSULT_SOURCES = new Set(['Muse', 'fixture', 'unknown']);
function diversionSnapshot({fleet,coord,candidate,runId,modelVersion}) {
  if(!isNonEmptyString(runId)||!Number.isSafeInteger(modelVersion)||modelVersion<0||isFleetAborted(fleet))throw new Error('変更提案の配送または建物モデルを確認できません');
  if(coord?.kind!=='fleet-coordination'||coord.state!=='holding'||coord.decision!==null||!CONSULT_SOURCES.has(coord.museChoice?.source)||coord.museChoice?.side!=='B')throw new Error('相談の別施設案を確認できません');
  validateHazardShape(coord.hazard);
  if(!Array.isArray(coord.heldIds)||!coord.heldIds.length||new Set(coord.heldIds).size!==coord.heldIds.length)throw new Error('変更対象の機体を確認できません');
  if(!candidate||candidate.side!=='B'||candidate.valid!==true||candidate.hazardId!==coord.hazard.id||JSON.stringify(candidate)!==JSON.stringify(coord.candidates?.B))throw new Error('変更案が一致しません');
  const ids=[...coord.heldIds].sort(),routes=Object.keys(candidate.routes||{}).sort();
  if(routes.length!==ids.length||routes.some((id,index)=>id!==ids[index]))throw new Error('変更案の対象機が一致しません');
  const list=resolveList(fleet),units=new Map(list.map(unit=>[unit.id,unit]));
  const places=resolveDestinations(fleet),groups=new Map(),held=[];
  if(units.size!==list.length||new Set(places.map(place=>place.id)).size!==places.length)throw new Error('機体または施設の識別が重複しています');
  for(const id of ids){
    const unit=units.get(id),hold=coord.held?.[id],route=candidate.routes[id];
    const place=places.find(p=>p.id===route?.destinationId);
    if(!unit||unit.state!=='holding'||unit.hold?.hazardId!==coord.hazard.id||!hold||unit.destinationId!==hold.destinationId||!isValidLatLon(unit.position)||!isValidLatLon(hold.position)||unit.position.latitude!==hold.position.latitude||unit.position.longitude!==hold.position.longitude||unit.position.height!==hold.position.height)throw new Error('変更対象機の停止状態を確認できません');
    if(!unit.destination||!hold.destination||['id','name','latitude','longitude'].some(key=>unit.destination[key]!==hold.destination[key]))throw new Error('変更前の配送先を確認できません');
    if(!place||!isNonEmptyString(place.name)||!place.name.trim()||!isValidLatLon(place)||place.id===hold.destinationId||route.valid!==true||route.destination?.id!==place.id||route.destination?.name!==place.name||route.destination?.latitude!==place.latitude||route.destination?.longitude!==place.longitude)throw new Error('変更先施設を確認できません');
    if(!Array.isArray(route.path)||!Array.isArray(route.returnPath)||route.path.length<2||route.returnPath.length<2||!route.path.every(isValidLatLon)||!route.returnPath.every(isValidLatLon)||!routeAvoidsHazard(route.path,coord.hazard)||!routeAvoidsHazard(route.returnPath,coord.hazard))throw new Error('変更候補の経路を確認できません');
    const same=(a,b)=>isValidLatLon(a)&&isValidLatLon(b)&&a.latitude===b.latitude&&a.longitude===b.longitude;
    if(!same(route.path[0],hold.position)||!same(route.path.at(-1),place)||!same(route.returnPath[0],place)||!same(route.returnPath.at(-1),hold.origin))throw new Error('変更候補の出発・到着地点を確認できません');
    const group=groups.get(place.id)||{id:place.id,name:place.name,latitude:place.latitude,longitude:place.longitude,boxes:0};group.boxes++;groups.set(place.id,group);
    held.push({id,state:unit.state,position:copyPoint(unit.position),destinationId:unit.destinationId,destination:hold.destination,hold:unit.hold});
  }
  const destinations=[...groups.values()].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  return {destinations,snapshot:JSON.stringify({runId,modelVersion,hazardEpoch:hazardEpochs.get(fleet)||0,hazard:coord.hazard,heldAt:coord.heldAt,museChoice:coord.museChoice,held,candidate})};
}

export function createDiversionProposal(context) {
  const {destinations,snapshot}=diversionSnapshot(context);
  const proposal=Object.freeze({affected:context.coord.heldIds.length,destinations:Object.freeze(destinations.map(place=>Object.freeze(place))),snapshot});
  issuedDiversionProposals.add(proposal);return proposal;
}

export function isDiversionProposalCurrent(proposal,context) {
  try{const current=diversionSnapshot(context);return issuedDiversionProposals.has(proposal)&&proposal.affected===context.coord.heldIds.length&&proposal.snapshot===current.snapshot&&JSON.stringify(proposal.destinations)===JSON.stringify(current.destinations)}catch{return false}
}

/** 相談の選択と出所を記録する。再開にはアプリによる独立点検を必要とする。 */
export function recordMuseChoice(coord, choice = {}) {
  if (!isPlainObject(coord) || coord.kind !== 'fleet-coordination') {
    throw new TypeError('fleet-coordination: coord（reportVirtualHazardの戻り値）が必要です');
  }
  if (!isPlainObject(choice)) throw new TypeError('fleet-coordination: Museの選択は {side, source, at} が必要です');
  if (!['A', 'B', 'none'].includes(choice.side)) {
    throw new TypeError("fleet-coordination: Museの選択 side は 'A'/'B'/'none' が必要です");
  }
  if (!CONSULT_SOURCES.has(choice.source) && !['manual', 'auto'].includes(choice.source)) {
    throw new TypeError('fleet-coordination: 選択元 source が不正です');
  }
  assertNow(choice.at, 'choice.at');
  if (choice.at < coord.heldAt) {
    throw new RangeError('fleet-coordination: Museの選択時刻は共有時刻（heldAt）以降が必要です');
  }
  if (coord.decision || ['stopped', 'approved', 'completed'].includes(coord.state)) return coord;
  coord.museChoice = { side: choice.side, source: choice.source, at: choice.at };
  return coord;
}

// ---- 独立点検の検証（アプリ側の定型処理。Muse回答とは別） ----

function isCompleteEvidence(evidence) {
  if (!isPlainObject(evidence)) return '経路の点検結果が不明または不十分です';
  const { total, observed, unknown, maxGap, blockedIndices } = evidence;
  if (!Number.isInteger(total) || total < 1) return '経路の点検結果が不明または不十分です';
  if (observed !== total) return '経路の点検結果が不明または不十分です';
  if (unknown !== 0) return '経路の点検結果が不明または不十分です';
  if (!Number.isFinite(maxGap) || maxGap < 0 || maxGap > 29) {
    return maxGap > 29 ? `経路の点検間隔が約${Math.ceil(maxGap)}mで基準（29m以内）を超えました` : '経路の点検結果が不明または不十分です';
  }
  if (!Array.isArray(blockedIndices) || blockedIndices.length !== 0) {
    return '経路に仮想高度付近以上の表面（遮断）を検出したため不採用です';
  }
  return null;
}

function isValidSurfaceHeight(value) {
  return Number.isFinite(value) && value > 0.5 && value <= 168;
}

function stopAllHeld(fleet, coord, reason, now) {
  const list = resolveList(fleet);
  const byId = new Map(list.map((u) => [u.id, u]));
  const stopped = [];
  for (const unitId of coord.heldIds) {
    const unit = byId.get(unitId);
    if (!unit) continue;
    if (unit.state === 'complete' || unit.state === 'stopped') continue;
    unit.state = 'stopped';
    unit.reason = reason;
    unit.detourActive = false;
    unit.detour = null;
    unit.updatedAt = now;
    stopped.push(unitId);
  }
  return stopped;
}

/**
 * アプリの独立点検結果を検証し、全影響機・全地点で揃った場合のみ再開する（定型処理）。
 * Museが A/B/none を選んでいても、以下の全てを満たす場合のみ承認（resumed）する：
 * 未知・遮断なし、最大間隔29m以下、施設表面が妥当（0.5< h <=168）、
 * 障害円回避（往路・復路の各線分）、候補・現在位置（停止位置）・障害IDの一致、
 * 余計なIDなし・古い判断でないこと・取消でないこと。
 * それ以外（不完全点検・不正提案・取消・遅延・全体中止後）は対象を停止し、成功としない。
 * @param {object} fleet createFleetの戻り値（直接更新する）
 * @param {object} coord reportVirtualHazardの戻り値（decision を書き込む）
 * @param {{hazardId:string, side:'A'|'B', at:number, source:'app', results:Object}} inspection アプリ独立点検
 * @param {number} now 検証時刻[ms]
 * @returns {{state:'approved'|'stopped', resumed:string[], stopped:string[], reason:string}}
 */
export function verifyDetourInspections(fleet, coord, inspection = {}, now = 0) {
  const list = resolveList(fleet);
  if (!isPlainObject(coord) || coord.kind !== 'fleet-coordination') {
    throw new TypeError('fleet-coordination: coord（reportVirtualHazardの戻り値）が必要です');
  }
  if (!isPlainObject(inspection)) throw new TypeError('fleet-coordination: アプリ独立点検はオブジェクトが必要です');
  assertNow(now);
  const byId = new Map(list.map((u) => [u.id, u]));

  const fail = (reason) => {
    const stopped = stopAllHeld(fleet, coord, reason, now);
    coord.decision = { state: 'stopped', side: coord.museChoice?.side ?? null, reason, at: now, resumedIds: [], stoppedIds: [...stopped] };
    coord.state = 'stopped';
    return { state: 'stopped', resumed: [], stopped: [...stopped], reason };
  };

  // 決定済みの後の遅延点検・遅延提案では再開しない
  if (coord.decision !== null || coord.state === 'stopped' || coord.state === 'completed' || coord.state === 'approved') {
    if (coord.state === 'approved' || coord.state === 'completed') {
      return { state: coord.state, resumed: [...(coord.decision?.resumedIds ?? [])], stopped: [], reason: coord.decision?.reason ?? '仮想迂回は承認済みのため遅延点検では変更しません' };
    }
    const stopped = coord.heldIds.filter((id) => byId.get(id)?.state === 'stopped');
    return { state: 'stopped', resumed: [], stopped: [...stopped], reason: '仮想迂回は停止済みのため遅延提案では再開しません' };
  }
  // 全体中止（stopFleet）後の遅延応答は無効
  if (isFleetAborted(fleet)) {
    return fail(`仮想障害 ${coord.hazard.id} の迂回は全体中止後のため停止します（遅延点検は無効。仮想情報）`);
  }
  // 相談回答と定型処理（auto/manual）を区別する。試験回答も仮想点検を要する。
  if (!isPlainObject(coord.museChoice)) {
    return fail(`仮想障害 ${coord.hazard.id} の迂回はMuseの選択がないため停止します（仮想情報）`);
  }
  if (!CONSULT_SOURCES.has(coord.museChoice.source)) {
    return fail(`仮想障害 ${coord.hazard.id} の迂回はMuse応答（source:'Muse'）ではなく ${coord.museChoice.source} のため停止します（定型処理と区別）`);
  }
  if (coord.museChoice.side === 'none') {
    return fail(`仮想障害 ${coord.hazard.id} に対し相談の回答が候補なし（none）のため対象機を停止します`);
  }
  if (!isPlainObject(coord.candidates) || !isPlainObject(coord.candidates[coord.museChoice.side])) {
    return fail(`仮想障害 ${coord.hazard.id} の迂回候補が未生成のため停止します（未点検のまま飛ばしません）`);
  }
  // アプリ独立点検の出所は 'app' のみ。Muse回答を点検に混ぜない
  if (inspection.source !== 'app') {
    return fail(`仮想障害 ${coord.hazard.id} の点検出所が app ではなく ${String(inspection.source)} のため停止します（Muse応答と区別）`);
  }
  if (inspection.hazardId !== coord.hazard.id) {
    return fail(`仮想障害IDが不一致（点検=${String(inspection.hazardId)}・共有=${coord.hazard.id}）のため停止します（仮想情報）`);
  }
  if (inspection.side !== coord.museChoice.side) {
    return fail(`仮想迂回案が不一致（点検=${String(inspection.side)}・Muse選択=${coord.museChoice.side}）のため停止します`);
  }
  if (!Number.isFinite(inspection.at) || inspection.at < coord.heldAt) {
    return fail('仮想迂回点検の時刻が共有前（古い判断）のため停止します');
  }
  if (inspection.at < coord.museChoice.at) {
    return fail('仮想迂回点検がMuse選択より古いため停止します');
  }
  if (now < inspection.at) {
    return fail('仮想迂回点検が未来時刻のため停止します');
  }
  const candidate = coord.candidates[coord.museChoice.side];
  if (candidate.hazardId !== coord.hazard.id) {
    return fail('仮想迂回候補の障害IDが共有と不一致のため停止します');
  }
  if (candidate.valid !== true) {
    return fail(`仮想迂回案${candidate.side}は障害円回避が不成立のため停止します（無効候補のまま飛ばしません）`);
  }
  if (!isPlainObject(inspection.results)) {
    return fail('仮想迂回点検の results が不正のため停止します');
  }
  const gotIds = Object.keys(inspection.results).sort();
  const wantIds = [...coord.heldIds].sort();
  if (gotIds.length !== wantIds.length || gotIds.some((id, i) => id !== wantIds[i])) {
    return fail(`仮想迂回点検の対象IDが全影響機と揃わない（余計・不足あり）のため停止します。期待=${wantIds.join(',')}・受領=${gotIds.join(',')}`);
  }
  const destinations = resolveDestinations(fleet);
  const destById = new Map(destinations.map((d) => [d.id, d]));

  // 全機・全地点の厳密検査
  for (const unitId of coord.heldIds) {
    const result = inspection.results[unitId];
    const route = candidate.routes?.[unitId];
    const hold = coord.held?.[unitId];
    const current = byId.get(unitId);
    if (!isPlainObject(result) || !isPlainObject(route) || !isPlainObject(hold)) {
      return fail(`仮想迂回点検（${unitId}）の形式が不正のため停止します`);
    }
    if(!current||current.state!=='holding'||current.hold?.hazardId!==coord.hazard.id||!isSameLatLon(current.position,hold.position)||current.position.height!==hold.position.height){
      return fail(`仮想停止中の機体状態が変わったため、古い候補を採用せず停止します（${unitId}）`);
    }
    if (result.destinationId !== route.destinationId) {
      return fail(`仮想迂回先が不一致（${unitId}）のため停止します（不正提案の可能性）`);
    }
    const realDest = destById.get(result.destinationId);
    if (!realDest) {
      return fail(`仮想迂回先 ${result.destinationId}（${unitId}）は公開施設に存在しないため停止します（捏造しません）`);
    }
    if (Math.abs(realDest.latitude - route.destination.latitude) > 1e-9 || Math.abs(realDest.longitude - route.destination.longitude) > 1e-9) {
      return fail(`仮想迂回先の座標が公開施設と不一致（${unitId}）のため停止します`);
    }
    if (!Array.isArray(result.path) || !Array.isArray(route.path) || result.path.length !== route.path.length) {
      return fail(`仮想迂回経路の点数が不一致（${unitId}）のため停止します`);
    }
    for (let i = 0; i < route.path.length; i += 1) {
      if (!isSameLatLon(result.path[i], route.path[i])) {
        return fail(`仮想迂回経路の座標が候補・現在位置と不一致（${unitId}#${i}）のため停止します`);
      }
    }
    if(!Array.isArray(result.returnPath)||!Array.isArray(route.returnPath)||result.returnPath.length!==route.returnPath.length||result.returnPath.some((point,index)=>!isSameLatLon(point,route.returnPath[index]))){
      return fail(`復路の点検対象が候補と不一致（${unitId}）のため停止します`);
    }
    if (!isSameLatLon(result.path[0], hold.position)) {
      return fail(`仮想迂回経路の起点が停止位置と不一致（${unitId}）のため停止します（変更前位置からの連続性なし）`);
    }
    const lastPoint = result.path[result.path.length - 1];
    if (Math.abs(lastPoint.latitude - realDest.latitude) > 1e-9 || Math.abs(lastPoint.longitude - realDest.longitude) > 1e-9) {
      return fail(`仮想迂回経路の終点が配送先と不一致（${unitId}）のため停止します`);
    }
    const cause = isCompleteEvidence(result.evidence);
    if (cause !== null) {
      return fail(`仮想迂回点検が不完全（${unitId}）のため停止します: ${cause}`);
    }
    if (!isValidSurfaceHeight(result.surfaceHeight)) {
      return fail(`仮想配送先の表面が妥当でない（${unitId}）ため停止します`);
    }
    if (!routeAvoidsHazard(result.path, coord.hazard)) {
      return fail(`仮想迂回往路が障害円と交差（${unitId}）のため停止します`);
    }
    if (!Array.isArray(route.returnPath) || !routeAvoidsHazard(route.returnPath, coord.hazard)) {
      return fail(`仮想迂回復路が障害円と交差または不明（${unitId}）のため停止します`);
    }
  }

  // 全て揃った場合のみ承認。個別経路を機体に載せる
  const resumed = [];
  for (const unitId of coord.heldIds) {
    const unit = byId.get(unitId);
    const route = candidate.routes[unitId];
    const result = inspection.results[unitId];
    if (!unit) continue;
    if (unit.state !== 'holding') continue; // 既に止まった機は戻さない
    const realDest = destById.get(route.destinationId);
    unit.destinationId = realDest.id;
    unit.destination = Object.freeze({ id: realDest.id, name: realDest.name, latitude: realDest.latitude, longitude: realDest.longitude });
    unit.detour = {
      side: candidate.side,
      hazardId: coord.hazard.id,
      path: route.path.map((p) => ({ latitude: p.latitude, longitude: p.longitude })),
      returnPath: route.returnPath.map((p) => ({ latitude: p.latitude, longitude: p.longitude })),
      resumeAt: now,
      surfaceHeight: result.surfaceHeight,
      destinationId: realDest.id,
      assignmentBasis: route.assignmentBasis ? {...route.assignmentBasis} : null,
      check: {...result.evidence,blockedIndices:[...result.evidence.blockedIndices]},
    };
    unit.detourActive = true;
    unit.reason = `仮想障害 ${coord.hazard.id} の迂回案${candidate.side}を承認。アプリが仮想障害と建物モデルの点検地点を確認。地点間や現地の安全は未確認。`;
    unit.updatedAt = now;
    resumed.push(unitId);
  }
  const reason = `仮想障害 ${coord.hazard.id} の迂回案${candidate.side}を承認し、${resumed.length}機が個別承認経路で仮想飛行へ。アプリが仮想障害と建物モデルの点検地点を確認。点検地点の間や現地の安全は未確認です。`;
  coord.decision = { state: 'approved', side: candidate.side, reason, at: now, resumedIds: [...resumed], stoppedIds: [] };
  coord.state = 'approved';
  return { state: 'approved', resumed: [...resumed], stopped: [], reason };
}

// 仮想候補の各区間を地表距離で概算する。実飛行距離や安全の判定ではない。
// Shared by the simulation gate and the comparison-only baseline.
export function isUsableFleetCandidate(report,distance){
  return !!distance&&!!report&&report.avoidsHazard===true&&report.total>0&&report.observed===report.total&&report.unknown===0&&report.blocked===0&&report.maxGap<=29;
}
export function baselineFleetChoice(evidence){
  const usable=side=>isUsableFleetCandidate(evidence?.candidates?.[side],evidence?.distances?.[side]);
  const choice=usable('A')?'A':usable('B')?'B':'none';
  return {choice,rule:'Aを優先し、条件を満たさなければB。両方不足なら候補なし。'};
}
export function summarizeCandidateDistances(candidate, ids) {
  if(!isPlainObject(candidate)||candidate.valid!==true||!isPlainObject(candidate.routes)||
     !Array.isArray(ids)||!ids.length||new Set(ids).size!==ids.length)return null;
  const length=path=>{
    if(!Array.isArray(path)||path.length<2||!path.every(isValidLatLon))return null;
    let total=0;
    for(let i=1;i<path.length;i++){
      let distance;try{distance=groundDistanceM(path[i-1],path[i])}catch{return null}
      if(!Number.isFinite(distance)||distance<0)return null;
      total+=distance;if(!Number.isFinite(total))return null;
    }
    return total;
  };
  const measured=[];
  for(const id of ids){
    if(!isNonEmptyString(id))return null;
    const route=candidate.routes[id];
    if(!isPlainObject(route)||route.valid!==true)return null;
    const outbound=length(route.path),back=length(route.returnPath);
    if(outbound===null||back===null)return null;
    measured.push({outbound,back});
  }
  const out=measured.reduce((sum,item)=>sum+item.outbound,0),back=measured.reduce((sum,item)=>sum+item.back,0);
  if(!Number.isFinite(out)||!Number.isFinite(back)||!Number.isFinite(out+back))return null;
  const first=measured[0];
  return {routes:ids.length,outboundM:Math.round(out),returnM:Math.round(back),totalM:Math.round(out+back),
    representative:{outboundM:Math.round(first.outbound),returnM:Math.round(first.back),totalM:Math.round(first.outbound+first.back)}};
}

function polylineLengthsM(path) {
  const lengths = [0];
  let total = 0;
  for (let i = 1; i < path.length; i += 1) {
    let seg = 0;
    try {
      seg = groundDistanceM(path[i - 1], path[i]);
    } catch {
      seg = 0;
    }
    total += seg;
    lengths.push(total);
  }
  return { lengths, total };
}

function interpolatePath(path, fraction) {
  if (path.length === 1) return copyLatLon(path[0]);
  const p = Math.max(0, Math.min(1, fraction));
  const { lengths, total } = polylineLengthsM(path);
  if (total === 0) return copyLatLon(path[path.length - 1]);
  const target = p * total;
  for (let i = 1; i < path.length; i += 1) {
    if (target <= lengths[i]) {
      const span = lengths[i] - lengths[i - 1];
      const f = span === 0 ? 0 : (target - lengths[i - 1]) / span;
      return {
        latitude: path[i - 1].latitude + (path[i].latitude - path[i - 1].latitude) * f,
        longitude: path[i - 1].longitude + (path[i].longitude - path[i - 1].longitude) * f,
      };
    }
  }
  return copyLatLon(path[path.length - 1]);
}

/**
 * 承認済み個別経路に沿って現在位置から仮想飛行・荷下ろし・帰還する（定型処理）。
 * 復路も仮想障害を避ける。帰還区間は元の事前点検済み出発〜停止位置を逆向きに
 * 戻る構成（[配送先, 中継点, 停止位置, 出発地点]、停止位置==出発地点なら3点）。
 * 経路が分からない機は停止する。新しい施設に変わった場合は点検済み表面を使う。
 * holding 未承認機は位置保持。停止済み・完了は触らない。遅延提案では再開しない。
 * fleet-engine の advanceFleet と併用する（holding/detourActive はそちらで凍結）。
 * @param {object} fleet createFleetの戻り値（直接更新する）
 * @param {object} coord reportVirtualHazardの戻り値
 * @param {number} now 仮想時刻[ms]
 * @returns {{holding:number, outbound:number, delivery:number, returning:number, complete:number, stopped:number}} 協調管理機の内訳
 */
export function advanceCoordination(fleet, coord, now) {
  const list = resolveList(fleet);
  if (!isPlainObject(coord) || coord.kind !== 'fleet-coordination') {
    throw new TypeError('fleet-coordination: coord（reportVirtualHazardの戻り値）が必要です');
  }
  assertNow(now);
  const byId = new Map(list.map((u) => [u.id, u]));
  const timing = { ...FLEET_TIMING };
  const outboundMs = timing.outboundMs;
  const deliveryMs = timing.deliveryMs;
  const returnMs = timing.returnMs;
  const total = outboundMs + deliveryMs + returnMs;
  const counts = { holding: 0, outbound: 0, delivery: 0, returning: 0, complete: 0, stopped: 0 };

  for (const unitId of coord.heldIds) {
    const unit = byId.get(unitId);
    if (!unit) continue;
    if (unit.state === 'complete') {
      counts.complete += 1;
      continue;
    }
    if (unit.state === 'stopped') {
      counts.stopped += 1;
      continue;
    }
    // 未承認（holding のまま）は現在位置で仮想停止を続ける
    if (coord.state !== 'approved' || !isPlainObject(unit.detour)) {
      if (coord.state === 'approved' && !isPlainObject(unit.detour)) {
        // 承認済みなのに個別経路が分からない場合は停止（安全側）
        unit.state = 'stopped';
        unit.reason = `仮想障害 ${coord.hazard.id} の個別承認経路が不明のため停止します（仮想情報）`;
        unit.detourActive = false;
        unit.detour = null;
        unit.updatedAt = now;
        counts.stopped += 1;
        continue;
      }
      unit.updatedAt = now;
      counts.holding += 1;
      continue;
    }
    const detour = unit.detour;
    // 遅延・不一致の detour は進めない
    if (detour.hazardId !== coord.hazard.id || detour.side !== coord.decision?.side) {
      unit.state = 'stopped';
      unit.reason = `仮想障害 ${coord.hazard.id} の個別経路が候補と不一致のため停止します（仮想情報）`;
      unit.detourActive = false;
      unit.detour = null;
      unit.updatedAt = now;
      counts.stopped += 1;
      continue;
    }
    const elapsed = now - detour.resumeAt;
    if (elapsed < 0) {
      unit.updatedAt = now;
      counts.holding += 1;
      continue;
    }
    const dest = unit.destination;
    const hold = coord.held?.[unitId];
    const origin = hold && isValidLatLon(hold.origin)
      ? hold.origin
      : resolveOrigin(fleet, list);
    if (elapsed < outboundMs) {
      const fraction = outboundMs === 0 ? 1 : elapsed / outboundMs;
      const pos = interpolatePath(detour.path, fraction);
      unit.state = 'outbound';
      unit.position.latitude = pos.latitude;
      unit.position.longitude = pos.longitude;
      unit.position.height = timing.cruiseHeight;
      unit.updatedAt = now;
      counts.outbound += 1;
    } else if (elapsed < outboundMs + deliveryMs) {
      const surface = Number.isFinite(detour.surfaceHeight) ? detour.surfaceHeight : null;
      const hover = surface === null ? timing.cruiseHeight : surface + 10;
      const q = deliveryMs === 0 ? 1 : (elapsed - outboundMs) / deliveryMs;
      if (!unit.delivery) {
        unit.delivery = { destinationId: unit.destinationId, arrivedAt: detour.resumeAt + outboundMs, ok: false };
      }
      unit.state = 'delivery';
      unit.position.latitude = dest.latitude;
      unit.position.longitude = dest.longitude;
      unit.position.height = timing.cruiseHeight + (hover - timing.cruiseHeight) * q;
      unit.updatedAt = now;
      counts.delivery += 1;
    } else if (elapsed < total) {
      const fraction = returnMs === 0 ? 1 : (elapsed - outboundMs - deliveryMs) / returnMs;
      if (!unit.delivery) {
        unit.delivery = { destinationId: unit.destinationId, arrivedAt: detour.resumeAt + outboundMs, ok: true };
      } else {
        unit.delivery.ok = true;
      }
      const pos = interpolatePath(detour.returnPath, fraction);
      unit.state = 'returning';
      unit.position.latitude = pos.latitude;
      unit.position.longitude = pos.longitude;
      unit.position.height = timing.cruiseHeight;
      unit.updatedAt = now;
      counts.returning += 1;
    } else {
      if (!unit.delivery) {
        unit.delivery = { destinationId: unit.destinationId, arrivedAt: detour.resumeAt + outboundMs, ok: true };
      }
      unit.delivery.ok = true;
      unit.state = 'complete';
      unit.position.latitude = origin.latitude;
      unit.position.longitude = origin.longitude;
      unit.position.height = 0;
      unit.completedAt = detour.resumeAt + total;
      unit.reason = null;
      unit.detourActive = false;
      unit.updatedAt = now;
      counts.complete += 1;
    }
  }

  const managed = coord.heldIds
    .map((id) => byId.get(id))
    .filter((u) => u && u.state === 'complete');
  if (coord.state === 'approved' && managed.length === coord.heldIds.length && coord.heldIds.length > 0) {
    coord.state = 'completed';
  }
  return counts;
}

/**
 * 対象/対象外の状態・障害ID・候補・変更理由を外部から読む（読み出し専用・複写を返す）。
 * 架空の検出は「仮想障害」として表記し、現実情報としては表示しない。
 * @param {object} fleet createFleetの戻り値（現在状態の読み出し元）
 * @param {object} coord reportVirtualHazardの戻り値
 * @returns {{hazardId:string, hazard:object, state:string, heldAt:number,
 *   affectedIds:string[], heldIds:string[], unaffectedIds:string[], continuingIds:string[],
 *   units:Object, candidates:Object|null, museChoice:Object|null,
 *   decision:Object|null, reason:string}} 外部表示用の複写
 */
export function getCoordinationStatus(fleet, coord) {
  const list = resolveList(fleet);
  if (!isPlainObject(coord) || coord.kind !== 'fleet-coordination') {
    throw new TypeError('fleet-coordination: coord（reportVirtualHazardの戻り値）が必要です');
  }
  const byId = new Map(list.map((u) => [u.id, u]));
  const units = {};
  for (const unitId of [...coord.heldIds, ...(coord.continuingIds ?? []), ...coord.unaffectedIds]) {
    const unit = byId.get(unitId);
    if (!unit) {
      units[unitId] = { present: false };
      continue;
    }
    const hold = coord.held?.[unitId] ?? null;
    units[unitId] = {
      present: true,
      state: unit.state,
      held: coord.heldIds.includes(unitId),
      position: { latitude: unit.position.latitude, longitude: unit.position.longitude, height: unit.position.height },
      destinationId: unit.destinationId,
      hold: hold ? JSON.parse(JSON.stringify(hold)) : null,
      detour: unit.detour ? JSON.parse(JSON.stringify(unit.detour)) : null,
      reason: unit.reason,
    };
  }
  return {
    hazardId: coord.hazard.id,
    hazard: { ...coord.hazard },
    state: coord.state,
    heldAt: coord.heldAt,
    affectedIds: [...coord.affectedIds],
    heldIds: [...coord.heldIds],
    unaffectedIds: [...coord.unaffectedIds],
    continuingIds: [...(coord.continuingIds ?? [])],
    units,
    candidates: coord.candidates ? JSON.parse(JSON.stringify(coord.candidates)) : null,
    museChoice: coord.museChoice ? { ...coord.museChoice } : null,
    decision: coord.decision ? JSON.parse(JSON.stringify(coord.decision)) : null,
    reason: coord.reason,
  };
}


