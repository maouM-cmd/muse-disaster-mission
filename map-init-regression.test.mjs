import {test, afterEach} from 'node:test';
import assert from 'node:assert/strict';

// Created maps hold real timer handles once the stubbed clock is restored
// (weather/observation staleness timers). Destroy every map after each test
// so the process can exit naturally even when a test fails midway.
const liveMaps = [];
afterEach(() => { while (liveMaps.length) liveMaps.pop().destroy(); });

// Executes the real createRealMap with a stubbed Cesium/DOM/network.
// Unlike the static checks, this fails when the factory itself cannot build
// its return object (e.g. an undeclared identifier in the return literal),
// which is exactly what left refresh-data/buildings/choose-origin disabled
// in the browser: setArea('13118') runs before the return throws, so Arakawa
// renders but init rejects and the UI never enables.

function dummySignal(){
  return {aborted:false, addEventListener(){}, removeEventListener(){}, throwIfAborted(){}};
}

async function boot(){
  const rad = Math.PI / 180;
  const regionFor = (lon, lat) => [ (lon - 0.01) * rad, (lat - 0.005) * rad, (lon + 0.01) * rad, (lat + 0.005) * rad ];
  const buildingJson = (code, lod, lon, lat) => ({
    root: {
      boundingVolume: {region: regionFor(lon, lat)},
      children: [{content: {uri: `tiles/${code}_2023_citygml_lod${lod}_op/tileset.json`}, boundingVolume: {region: regionFor(lon, lat)}}]
    }
  });
  const calls = {buildingUrls: [], setViews: [], tilesets: [], buildings: [], areaViews: [], shelters: [], readiness: [], tilesLoaded: [], mapClick: null, sampleExcludes: [], sampleExcludedObjects: [], holdSample: null, moveStarts: [], containerListeners: {}, documentListeners: {}, warningRequests:0};
  let rafId = 0;
  const rafQueue = new Map();
  calls.stepRaf = time => { const pending = [...rafQueue.values()]; rafQueue.clear(); for (const cb of pending) cb(time); };
  const fetchStub = async url => {
    const text = String(url);
    if (text.includes('area.json')) return {ok: true, json: async () => ({
      class20s: {'1311800': {parent: 'p15'}, '1310600': {parent: 'p15'}, '1310100': {parent: 'p15'}},
      class15s: {p15: {parent: 'p10'}}, class10s: {p10: {parent: 'off1'}}, offices: {off1: {name: '東京'}}
    })};
    if (text.includes('/warning/data/')) {calls.warningRequests++;return {ok: true, json: async () => ([
      {dataTypeCode: 'VPWW55', reportDatetime: new Date().toISOString(), headlineText: '大雨注意報'}
    ])};}
    if (text.includes('tileset.json')) {
      calls.buildingUrls.push(text);
      if (calls.holdBuilding) await calls.holdBuilding;
      const code = (text.match(/(\d{5})-bldg-/) || [])[1];
      if (code === '13106') return {ok: true, json: async () => buildingJson(code, 3, 139.78, 35.713)};
      return {ok: true, json: async () => buildingJson(code || '13118', 2, 139.78, 35.735)};
    }
    if (text.includes('skhb01')) return {ok: true, json: async () => ({features: [
      {properties: {disaster1: 1, address: '東京都荒川区テスト1丁目', name: 'テスト施設'}, geometry: {type: 'Point', coordinates: [139.78, 35.735]}}
    ]})};
    return {ok: false, json: async () => ({}), text: async () => ''};
  };

  class Cartesian3 {
    constructor(x = 0, y = 0, z = 0){ this.x = x; this.y = y; this.z = z; }
    getValue(){ return this; }
    static fromDegrees(lng, lat, h = 0){ return new Cartesian3(lng, lat, h); }
    static fromDegreesArrayHeights(){ return []; }
    static clone(v){ return v; }
    static equals(){ return true; }
  }
  const evented = () => ({addEventListener(){}, removeEventListener(){}});
  const newLayer = () => ({show: false, alpha: 1});
  const viewer = {
    camera: {setView(view){ calls.setViews.push(view); }, lookAt(){}, lookAtTransform(){}, moveStart: {addEventListener(cb){ calls.moveStarts.push(cb); }, removeEventListener(){}}, viewMatrix: {}, pickEllipsoid(){ return {}; }, moveUp(m){ (calls.moves=calls.moves||[]).push(['up',m]); }, moveDown(m){ (calls.moves=calls.moves||[]).push(['down',m]); }, moveLeft(m){ (calls.moves=calls.moves||[]).push(['left',m]); }, moveRight(m){ (calls.moves=calls.moves||[]).push(['right',m]); }},
    scene: {
      globe: {depthTestAgainstTerrain: false, ellipsoid: {}, tileLoadProgressEvent: evented()},
      imageryLayers: {addImageryProvider(){ return newLayer(); }, remove(){}},
      primitives: {add(){}, remove(){}},
      preRender: evented(), canvas: {width: 800, height: 600},
      requestRender(){}, render(){}, pick(){ return calls.pickHit ?? null; },
      sampleHeightSupported: true, sampleHeightMostDetailed: async (positions, exclude) => { calls.sampleExcludes.push(exclude ? exclude.length : -1); calls.sampleExcludedObjects.push(exclude ? [...exclude] : []); if (calls.holdSample) await calls.holdSample; return positions.map(() => ({height: 50})); }
    },
    clock: {currentTime: null, shouldAnimate: false},
    entities: {add(e){ const entity = e || {}; viewer.entities.values.push(entity); return entity; }, remove(e){ const i = viewer.entities.values.indexOf(e); if (i >= 0) viewer.entities.values.splice(i, 1); }, removeAll(){ viewer.entities.values.length = 0; }, values: []},
    imageryLayers: {addImageryProvider(){ return newLayer(); }, remove(){}},
    trackedEntity: undefined, useDefaultRenderLoop: true,
    resize(){}, destroy(){}
  };
  calls.entityCount = () => viewer.entities.values.length;
  const C = {
    Cartesian3, Color: {fromCssColorString: () => ({withAlpha(){ return {}; }}), WHITE: {withAlpha(){ return {}; }}, CYAN: {}, LIME: {withAlpha(){ return {}; }}, ORANGE: {}, RED: {}, BLACK: {}, TRANSPARENT: {}},
    Cartesian2: class { constructor(x = 0, y = 0){ this.x = x; this.y = y; } },
    Cartographic: {fromDegrees: (lng, lat) => ({longitude: lng, latitude: lat}), fromCartesian: () => ({latitude: 35.74 * Math.PI / 180, longitude: 139.79 * Math.PI / 180})},
    Math: {toRadians: d => d * Math.PI / 180, toDegrees: r => r * 180 / Math.PI},
    Matrix4: {IDENTITY: {}}, HeadingPitchRange: class {}, Rectangle: {fromDegrees: () => ({})},
    JulianDate: {fromIso8601: () => ({})}, Credit: class {}, ImageryLayer: class {},
    UrlTemplateImageryProvider: class { constructor(){ this.errorEvent = evented(); } requestImage(){ return Promise.resolve(null); } },
    EllipsoidTerrainProvider: class {}, Viewer: class { constructor(){ return viewer; } },
    Cesium3DTileset: {fromUrl: async (url,options) => {
      const tiles = {url, options, imageBasedLighting: {}, initialTilesLoaded: {addEventListener(cb){ calls.tilesLoaded.push(cb); }, removeEventListener(){}}, tileFailed: evented(), destroy(){}};
      calls.tilesets.push(tiles);
      return tiles;
    }},
    ScreenSpaceEventHandler: class { setInputAction(cb){ calls.mapClick = cb; } destroy(){} }, ScreenSpaceEventType: {LEFT_CLICK: 0},
    Event: class {}, CallbackProperty: class { constructor(cb){ this.cb = cb; } },
    ArcType: {NONE: 0, GEODESIC: 1}, TrackingReferenceFrame: {INERTIAL: 0},
    Transforms: {eastNorthUpToFixedFrame: () => ({}), headingPitchRollQuaternion: () => ({})},
    HeadingPitchRoll: class {}, RequestState: {CANCELLED: 0},
    PolylineDashMaterialProperty: class {}, PolylineOutlineMaterialProperty: class {}, PolylineArrowMaterialProperty: class {},
    VerticalOrigin: {BOTTOM: 0, TOP: 1}, HorizontalOrigin: {CENTER: 0}
  };

  const realSetTimeout = globalThis.setTimeout, realClearTimeout = globalThis.clearTimeout;
  globalThis.window = {Cesium: C, matchMedia: undefined};
  globalThis.document = {
    hidden: false, head: {append(){}},
    createElement: tag => tag === 'canvas' ? {width: 0, height: 0, getContext: () => ({createRadialGradient(){ return {addColorStop(){}}; }, fillRect(){}, fillStyle: ''})} : {},
    addEventListener(type,cb){(calls.documentListeners[type] ||= []).push(cb)}, removeEventListener(type,cb){calls.documentListeners[type]=(calls.documentListeners[type]||[]).filter(item=>item!==cb)}
  };
  globalThis.ResizeObserver = class { constructor(cb){ calls.resizeCb = cb; } observe(){} disconnect(){} unobserve(){} };
  globalThis.fetch = fetchStub;
  globalThis.AbortSignal = {timeout: dummySignal, any: dummySignal};
  globalThis.requestAnimationFrame = cb => { const id = ++rafId; rafQueue.set(id, cb); return id; };
  globalThis.cancelAnimationFrame = id => { rafQueue.delete(id); };
  globalThis.setTimeout = () => 0;
  globalThis.clearTimeout = () => {};
  const container = {addEventListener(type, cb){ (calls.containerListeners[type] = calls.containerListeners[type] || []).push(cb); }, removeEventListener(){}, clientWidth: 800, clientHeight: 600};

  const {createRealMap} = await import('./real-map.mjs');
  const events = {buildings: [], areaViews: [], shelters: [], readiness: [], simulation: [], fleet: [], probes: [], sceneChanges: [], origins: [], blocked: [], weather:[], observation:[]};
  const map = await createRealMap(container, {
    onBuildings: msg => events.buildings.push(msg),
    onShelters: () => {}, onShelterList: (list, state) => events.shelters.push(state || 'ready'),
    onBase: () => {}, onHazard: () => {}, onPicked: () => {}, onWeather: msg => events.weather.push(msg),
    onObservation: msg => events.observation.push(msg), onObservationView: () => {},
    onReadiness: (result, evidence) => events.readiness.push(evidence),
    onOrigin: value => events.origins.push(value), onDistance: () => {}, onSceneChanged: state => events.sceneChanges.push(state), onSelectionBlocked: reason => events.blocked.push(reason),
    onReferencePoint: () => {}, onSimulation: result => events.simulation.push(result), onMapCamera: () => {},
    onRouteProbe: result => events.probes.push(result), onRain: () => {},
    onAreaView: state => events.areaViews.push(state),
    onProgress: () => {}, onFleet: result => events.fleet.push(result), onFleetPosition: () => {}
  });
  async function settle(min = 1){
    for (let i = 0; i < 500 && calls.tilesets.length < min; i++) await new Promise(r => setImmediate(r));
    for (let i = 0; i < 60; i++) await new Promise(r => setImmediate(r));
  }
  await settle();
  globalThis.setTimeout = realSetTimeout;
  globalThis.clearTimeout = realClearTimeout;
  liveMaps.push(map);
  return {map, calls, events, settle, container, viewer};
}

test('hiding and returning to the map invalidates weather display and refreshes once',async()=>{
 const {calls,events,settle}=await boot();const initial=calls.warningRequests;
 globalThis.document.hidden=true;for(const cb of calls.documentListeners.visibilitychange)cb();
 assert.match(events.weather.at(-1),/再表示した後/);assert.match(events.observation.at(-1),/再表示した後/);
 assert.equal(events.readiness.at(-1).weather,'loading');
 globalThis.document.hidden=false;for(const cb of calls.documentListeners.visibilitychange)cb();
 assert.match(events.weather.at(-1),/再確認中/);await settle();assert.equal(calls.warningRequests,initial+1);
 for(const cb of calls.documentListeners.visibilitychange)cb();assert.equal(calls.warningRequests,initial+1);
});

test('initialization resolves and exposes area, flight and brightness controls', async () => {
  const {map, calls, events} = await boot();
  for (const name of ['setArea', 'mapFlightActive', 'setLod2LightRequested', 'lod2LightState']) {
    assert.equal(typeof map[name], 'function', `${name} must be callable after init`);
  }
  assert.ok(calls.buildingUrls.some(url => url.includes('13118-bldg-')), 'initial area fetches Arakawa buildings');
  assert.ok(calls.setViews.length >= 1, 'initial camera view is set');
  assert.ok(events.areaViews.includes('ready'), 'area view reaches ready');
  assert.equal(calls.tilesets.length, 1, 'one tileset created for the initial area');
  assert.deepEqual(map.lod2LightState(), {requested: false, applied: false, target: 'lod2'});
});

test('detailed and highest building settings load the requested level of screen detail',async()=>{
  const {map,calls,settle}=await boot();
  assert.equal(calls.tilesets.at(-1).options.maximumScreenSpaceError,12);
  assert.equal(map.setBuildingMode('highest'),true);
  await settle(2);
  assert.equal(calls.tilesets.at(-1).options.maximumScreenSpaceError,8);
});

test('selecting brightness does not refetch; only an explicit area reload applies it', async () => {
  const {map, calls, settle} = await boot();
  const before = calls.tilesets.length;
  assert.equal(map.setLod2LightRequested(true), true);
  assert.equal(calls.tilesets.length, before, 'selection alone must not create a tileset');
  assert.deepEqual(map.lod2LightState(), {requested: true, applied: false, target: 'lod2'});
  assert.equal(map.setArea('13118'), true);
  await settle();
  assert.equal(calls.tilesets.length, before + 1, 'explicit reload creates exactly one tileset');
  const fresh = calls.tilesets.at(-1);
  assert.equal(fresh.imageBasedLighting.sphericalHarmonicCoefficients.length, 9);
  assert.equal(fresh.imageBasedLighting.sphericalHarmonicCoefficients[0].x, 0.6);
  assert.deepEqual(map.lod2LightState(), {requested: true, applied: true, target: 'lod2'});
  assert.equal(map.setLod2LightRequested(false), false);
});

test('switching region refetches buildings, moves the camera and keeps LOD3 look', async () => {
  const {map, calls, settle} = await boot();
  assert.equal(map.setLod2LightRequested(true), true);
  assert.equal(map.setArea('13106'), true);
  await settle();
  assert.ok(calls.buildingUrls.some(url => url.includes('13106-bldg-')), 'region switch fetches the new area');
  const lastView = calls.setViews.at(-1);
  assert.ok(Math.abs(lastView.destination.y - 35.713) < 1e-9, 'camera moves to Taito');
  const taito = calls.tilesets.at(-1);
  assert.equal(taito.imageBasedLighting.sphericalHarmonicCoefficients[0].x, 1.2, 'LOD3 keeps its existing light');
  assert.deepEqual(map.lod2LightState(), {requested: true, applied: null, target: 'other'});
});

test('a selection change during loading does not leak into the in-flight area', async () => {
  const {map, calls, settle} = await boot();
  const before = calls.tilesets.length;
  assert.equal(map.setLod2LightRequested(true), true);
  let release;
  calls.holdBuilding = new Promise(r => release = r);
  assert.equal(map.setArea('13118'), true);
  for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r));
  assert.equal(map.setLod2LightRequested(false), false);
  release();
  calls.holdBuilding = null;
  await settle(before + 1);
  const fresh = calls.tilesets.at(-1);
  const coeff = fresh.imageBasedLighting.sphericalHarmonicCoefficients;
  assert.ok(coeff, 'in-flight load applies the snapshot taken at reload start');
  assert.equal(coeff.length, 9);
  assert.equal(coeff[0].x, 0.6);
  assert.deepEqual(map.lod2LightState(), {requested: false, applied: true, target: 'lod2'});
});

test('unknown region input is rejected without touching the current tiles', async () => {
  const {map, calls} = await boot();
  const before = calls.tilesets.length;
  assert.throws(() => map.setArea('99999'), /利用できません/);
  assert.equal(calls.tilesets.length, before);
});

async function readyFlight(){
  const h = await boot();
  h.calls.tilesLoaded.forEach(cb => cb());
  h.map.chooseOrigin();
  h.calls.mapClick({position: {x: 1, y: 1}});
  h.map.selectShelter(0);
  return h;
}

test('departure sampling passes a real abort signal through the queue', async () => {
  const {map, events, settle} = await readyFlight();
  assert.equal(map.simulate(), true);
  await settle();
  const phases = events.simulation.map(e => e.phase);
  assert.ok(phases.includes('direct'), `departure must proceed, got ${phases.join(',')}`);
  assert.ok(!events.simulation.some(e => /addEventListener/.test(e.message || '')), 'no signal TypeError stops departure');
});

test('second drone route and surface sampling use abort signals', async () => {
  const {map, calls, events, settle} = await readyFlight();
  assert.equal(map.simulate({index: 0, latitude: 35.735, longitude: 139.78}), true);
  await settle();
  await settle();
  for (let t = 50; t <= 3000; t += 50) calls.stepRaf(t);
  const fleet = events.fleet.filter(e => e);
  assert.ok(fleet.some(e => e.phase === 'checking'), 'second drone starts checking');
  assert.ok(fleet.some(e => e.report && e.report.total > 0), 'second drone reports its sampled route');
  assert.ok(!fleet.some(e => /addEventListener/.test(e.message || '')), 'no signal TypeError stops the second drone');
});

test('obstacle inspection, detour reinspection and delivery surface all sample cleanly', async () => {
  const {map, calls, events, settle} = await readyFlight();
  assert.equal(map.simulate(), true);
  await settle();
  for (let t = 50; t <= 8000; t += 50) calls.stepRaf(t);
  await settle();
  const ready = events.probes.filter(e => e.state === 'ready').at(-1);
  assert.ok(ready && ready.reports.A.total > 0 && ready.reports.B.total > 0, 'both detour sides are inspected');
  const fresh = await map.reinspectDetourSide('A');
  assert.ok(fresh.total > 0, 'detour reinspection resamples the route');
  map.continueSimulation('A');
  for (let t = 8100; t <= 20000; t += 50) calls.stepRaf(t);
  await settle();
  const phases = events.simulation.map(e => e.phase);
  assert.ok(phases.includes('delivery'), `delivery surface must be confirmed, got ${phases.join(',')}`);
  for (let t = 20100; t <= 30000; t += 50) calls.stepRaf(t);
  await settle();
  assert.ok(events.simulation.some(e => e.phase === 'complete'), 'delivery completes on the map model');
});

test('overlays added while waiting are excluded from the delayed sampling', async () => {
  const {map, calls, settle, viewer} = await readyFlight();
  let releaseSample;
  calls.holdSample = new Promise(r => releaseSample = r);
  assert.equal(map.simulate(), true);
  for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r));
  assert.equal(map.simulate(), true);
  for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r));
  assert.equal(map.setWaterScene(true), true);
  const water=viewer.entities.values.find(entity=>entity.ellipse?.semiMajorAxis===250);assert.ok(water);
  releaseSample();
  calls.holdSample = null;
  await settle();
  await settle();
  assert.equal(calls.sampleExcludes.length, 2);
  assert.ok(!calls.sampleExcludedObjects[0].includes(water),'the first sampling began before the overlay existed');
  assert.ok(calls.sampleExcludedObjects[1].includes(water),'the delayed sampling must exclude the actual overlay');
  assert.ok(calls.sampleExcludedObjects[1].includes(viewer.scene.globe),'the delayed sampling must exclude the globe');
});

test('camera moves stay ours until the user touches, across repeated events', async () => {
  const {map, calls, events} = await boot();
  assert.equal(typeof map.chooseCamera, 'function');
  const fireMoves = () => calls.moveStarts.forEach(cb => cb());
  fireMoves();
  assert.equal(events.sceneChanges.at(-1), 'camera');
  map.chooseCamera('wide', 'one', true);
  assert.equal(map.isViewTouched(), false);
  fireMoves();
  assert.equal(events.sceneChanges.at(-1), 'camera-own');
  fireMoves();
  assert.equal(events.sceneChanges.at(-1), 'camera-own');
  for (const type of ['pointerdown', 'wheel', 'keydown']) (calls.containerListeners[type] || []).forEach(cb => cb());
  assert.equal(map.isViewTouched(), true);
  fireMoves();
  assert.equal(events.sceneChanges.at(-1), 'camera');
});

test('locked view ignores resize-driven follow reseats until unlocked', async()=>{
  const h = await readyFlight();
  assert.equal(h.map.simulate(), true);
  await h.settle();
  h.map.chooseCamera('follow', 'one');
  const drone = h.viewer.entities.values.find(e => e && e.label && e.label.text === '1号機（仮想）');
  assert.ok(drone, 'primary drone exists');
  const before = drone.viewFrom;
  h.container.clientWidth = 700;
  h.calls.resizeCb();
  const first = drone.viewFrom;
  assert.ok(first && first !== before, 'unlocked resize reseats the follow offset');
  h.map.setViewLock(true);
  h.container.clientWidth = 800;
  h.calls.resizeCb();
  assert.equal(drone.viewFrom, first, 'locked resize keeps the offset');
  h.map.setViewLock(false);
  h.calls.resizeCb();
  assert.notEqual(drone.viewFrom, first, 'unlocked resize reseats again');
});

test('keyboard arrows move the map and Enter picks the center origin', async()=>{
  const h = await boot();
  h.map.chooseOrigin();
  const keys = h.calls.containerListeners.keydown;
  assert.ok(keys.length >= 2, 'origin keys listen alongside touch tracking');
  keys.forEach(fn => fn({key: 'ArrowRight', preventDefault(){}}));
  assert.ok((h.calls.moves || []).some(([dir]) => dir === 'right'), 'arrow key moves the camera');
  keys.forEach(fn => fn({key: 'Enter', preventDefault(){}}));
  const picked = h.events.origins.at(-1);
  assert.ok(Number.isFinite(picked?.latitude) && Number.isFinite(picked?.longitude), 'center becomes the origin');
});

test('in-flight map taps keep the selection and report the block', async()=>{
  const h = await readyFlight();
  assert.equal(h.map.simulate(), true);
  await h.settle();
  assert.equal(h.map.mapFlightActive(), true);
  const phases = h.events.simulation.length;
  h.calls.pickHit = {id: {properties: {shelterIndex: {getValue: () => 0}}}};
  h.calls.mapClick({position: {x: 1, y: 1}});
  assert.deepEqual(h.events.blocked, ['shelter']);
  assert.equal(h.events.simulation.length, phases, 'flight continues without a silent stop');
  assert.equal(h.map.mapFlightActive(), true);
  h.map.stopSimulation();
  await h.settle();
  h.calls.mapClick({position: {x: 1, y: 1}});
  assert.deepEqual(h.events.blocked, ['shelter'], 'selection works again after the stop');
  assert.equal(h.events.simulation.at(-1).phase, 'ready');
});
