import {DATA,riverPilotStations,buildingDataUrl,jmaRainTime,jmaRainMask,rainTileRequest,FLOOD_IMAGERY_BOUNDS,tileFor,selectFloodShelters,representativeShelter,areaByCode,buildingYears,buildingLevels,tilesetRegion,tilesForBounds,jmaOffice,jmaRainProduct,jmaMunicipalRainExcerpt,jmaBulletinState,jmaWarningFeedUrls,parseJmaWarningProof,jmaWarningProofMatches,jmaWarningProofState,selectJmaWarningProof,createWeatherMonitor,createObservationMonitor,weatherSummary,parseZonedTimestamp,straightDistance,amedasTimeKey,amedasObservation,mapSimulationPath,virtualWireGeometry,mapSimulationPosition,mapDroneParts,routeSamplePoints,routeSampleReport,routeSampleMarkers,routeReportComplete,canReplayMapRoute,withImageryFallback} from './geo-data.mjs';
import {assessReadiness,isViewFrameCurrent} from './readiness.mjs';
import {fitImage} from './mission.mjs';
import {initialCamera,beginFlight,selectCamera,selectMapCamera,mapObstacleCamera,mapWireRange,mapFollowOffset,smoothHeading} from './camera.mjs';
import {mapDeliveryPose,mapPartHeight,readMapSurface,readRouteSamples,inspectDepartureSamples,createSamplingQueue,invalidateRouteInspection,interruptForBuildingFailure,secondDroneMotion,secondFlightTarget,virtualAircraftApproach,withHiddenOverlay} from './delivery.mjs';

function loadCesium(){
  if(window.Cesium)return Promise.resolve(window.Cesium);
  return new Promise((resolve,reject)=>{
    const stylesheet=document.createElement('link');stylesheet.rel='stylesheet';stylesheet.href='/cesium/Widgets/widgets.css';document.head.append(stylesheet);
    window.CESIUM_BASE_URL='/cesium/';
    const script=document.createElement('script');script.src='/cesium/Cesium.js';
    script.onload=()=>window.Cesium?resolve(window.Cesium):reject(new Error('地図を読み込めません'));
    script.onerror=()=>reject(new Error('地図ライブラリを読み込めません'));document.head.append(script);
  });
}
export async function createRealMap(container,{onBuildings,onShelters,onShelterList,onBase,onHazard,onPicked,onWeather,onObservation,onObservationView,onReadiness,onOrigin,onDistance,onSceneChanged,onSelectionBlocked=()=>{},onReferencePoint,onSimulation,onMapCamera,onRouteProbe,onRain,onAreaView,onProgress,onFleet=()=>{},onFleetPosition=()=>{},onLargeFleet=()=>{},onLargeFleetPick=()=>{},onLargeFleetConsult=async()=>{throw new Error('Muse未接続')}}){
  const C=await loadCesium();
  const baseProvider=new C.UrlTemplateImageryProvider({url:DATA.basemap,maximumLevel:18,credit:new C.Credit('<a href="https://maps.gsi.go.jp/development/ichiran.html">地理院タイル（国土地理院）</a>',true)});
  let baseFailed=false,photoFailed=false,plateauMissing=false,baseMode='photo';
  const baseStatus=()=>onBase(baseMode==='plateau'?`PLATEAU-Ortho（2023年度版・撮影時期未確認）。${plateauMissing?'取得できない箇所は':'広域や対象外は'}国土地理院の写真や地図を表示します。`:baseMode==='photo'?(photoFailed?'航空写真を取得できない箇所があります。地図が見える場合があります。撮影時期は未確認です。':'国土地理院の航空写真（撮影時期未確認）。広域では地図を表示します。'):(baseFailed?'地図タイルを取得できない箇所があります。':'地理院地図を表示中（取得時点の地図）'));
  baseProvider.errorEvent.addEventListener(()=>{baseFailed=true;baseStatus()});
  const viewer=new C.Viewer(container,{baseLayer:new C.ImageryLayer(baseProvider),terrainProvider:new C.EllipsoidTerrainProvider(),baseLayerPicker:false,geocoder:false,homeButton:false,sceneModePicker:false,navigationHelpButton:false,animation:false,timeline:false,fullscreenButton:false,infoBox:false,selectionIndicator:false,skyBox:false,scene3DOnly:true});
  viewer.creditDisplay?.addStaticCredit(new C.Credit('<a href="https://www.mlit.go.jp/plateau/">3D都市モデル：国土交通省 PLATEAU</a>',true));
  viewer.clock.currentTime=C.JulianDate.fromIso8601('2025-06-01T03:00:00Z');viewer.clock.shouldAnimate=false;
  viewer.camera.moveStart.addEventListener(()=>{if(cameraOwnMove)onSceneChanged('camera-own');else onSceneChanged('camera')});
  const resizeObserver=new ResizeObserver(()=>{onSceneChanged('camera');updateTrackingView()});resizeObserver.observe(container);
  viewer.scene.globe.depthTestAgainstTerrain=false;
  const photoProvider=new C.UrlTemplateImageryProvider({url:DATA.photomap,maximumLevel:18,customTags:{layer:(_provider,_x,_y,level)=>level>=14?'seamlessphoto':'std',format:(_provider,_x,_y,level)=>level>=14?'jpg':'png'},credit:new C.Credit('<a href="https://maps.gsi.go.jp/development/ichiran.html">地理院タイル（国土地理院）</a>',true)});
  photoProvider.errorEvent.addEventListener(()=>{photoFailed=true;baseStatus()});
  const photoLayer=viewer.imageryLayers.addImageryProvider(photoProvider);photoLayer.show=true;
  const plateauProvider=new C.UrlTemplateImageryProvider({url:DATA.plateauPhoto,maximumLevel:18,credit:new C.Credit('<a href="https://docs.plateauview.mlit.go.jp/datasets/ortho/">航空写真：国土交通省 PLATEAU</a>',true)});
  const transparent=document.createElement('canvas');transparent.width=256;transparent.height=256;
  plateauProvider.requestImage=withImageryFallback(plateauProvider.requestImage.bind(plateauProvider),transparent,()=>{if(!plateauMissing){plateauMissing=true;baseStatus()}});
  const plateauLayer=viewer.imageryLayers.addImageryProvider(plateauProvider);plateauLayer.show=false;
  onBase('航空写真を読み込み中（撮影時期未確認）');viewer.scene.globe.tileLoadProgressEvent.addEventListener(count=>{if(count===0)baseStatus()});
  const evidence={buildings:'loading',shelters:'loading',weather:'loading',risk:'reference'};
  let largeFleetMap=null,largeFleetLoading=false,largeFleetVersion=0;
  const mark=(source,value)=>{evidence[source]=value;if(source==='buildings'&&value==='error')largeFleetMap?.stop('建物モデルを取得できなくなったため停止しました');onReadiness(assessReadiness(evidence),{...evidence})};
  const bounds=FLOOD_IMAGERY_BOUNDS;
  const riskProvider=new C.UrlTemplateImageryProvider({url:DATA.floodRisk,minimumLevel:2,maximumLevel:17,rectangle:C.Rectangle.fromDegrees(bounds.west,bounds.south,bounds.east,bounds.north),credit:new C.Credit('<a href="https://disaportal.gsi.go.jp/hazardmap/copyright/opendata.html">ハザードマップポータルサイト</a>',true)});
  riskProvider.errorEvent.addEventListener(()=>{mark('risk','error');onHazard('洪水想定タイルを取得できない箇所があります')});
  const riskLayer=viewer.imageryLayers.addImageryProvider(riskProvider);riskLayer.alpha=.28;
  onHazard('洪水浸水想定区域（想定最大規模）を重ね合わせ');
  const rainRoot='https://www.jma.go.jp/bosai/jmatile/data/nowc/';
  let rainEnabled=false,rainVersion=0,rainLayer=null,rainTimer=null,rainAbort=null,rainTime=0;
  function clearRain(){if(rainTimer!==null){clearTimeout(rainTimer);rainTimer=null}rainAbort?.abort();rainAbort=null;if(rainLayer){viewer.imageryLayers.remove(rainLayer);rainLayer=null}}
  function rainMaskCanvas(mask,x,y,level,failed=false){
    const out=document.createElement('canvas');out.width=out.height=256;const context=out.getContext('2d');context.fillStyle='rgba(115,120,126,.72)';context.fillRect(0,0,256,256);
    if(failed)return out;
    const n=2**level;context.globalCompositeOperation='destination-out';context.fillStyle='#fff';
    for(const ring of mask){if(ring.maxX<x/n||ring.minX>(x+1)/n||ring.maxY<y/n||ring.minY>(y+1)/n)continue;context.beginPath();ring.points.forEach(([px,py],i)=>{const xx=(px*n-x)*256,yy=(py*n-y)*256;i?context.lineTo(xx,yy):context.moveTo(xx,yy)});context.closePath();context.fill()}
    context.globalCompositeOperation='source-over';return out;
  }
  async function loadRain(){
    const version=++rainVersion;clearRain();if(!rainEnabled)return;onSceneChanged('rain');onRain('雨雲の解析と欠測範囲を確認中です。');
    const controller=new AbortController();rainAbort=controller;
    try{
      const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(15000)]),fetchJson=async url=>{const r=await fetch(url,{signal,cache:'no-store'});if(!r.ok)throw new Error('雨雲情報を取得できません');return r.json()};
      const time=jmaRainTime(await fetchJson(rainRoot+'targetTimes_N1.json')),mask=jmaRainMask(await fetchJson(`${rainRoot}${time}/none/${time}/surf/hrpns_nd/data.geojson`));
      if(!rainEnabled||version!==rainVersion)return;
      const formatted=`${time.slice(0,4)}-${time.slice(4,6)}-${time.slice(6,8)}T${time.slice(8,10)}:${time.slice(10,12)}:${time.slice(12,14)}Z`,label=new Date(formatted).toLocaleString('ja-JP');rainTime=Date.parse(formatted);let failed=false;
      const provider=new C.UrlTemplateImageryProvider({url:`${rainRoot}${time}/none/${time}/surf/hrpns/{z}/{x}/{y}.png`,maximumLevel:10,credit:new C.Credit('<a href="https://www.jma.go.jp/bosai/nowc/">気象庁 雨雲の動き（加工）</a>',true)});
      const request=provider.requestImage.bind(provider);
      provider.requestImage=rainTileRequest(request,(image,x,y,level,missing)=>{if(missing)return rainMaskCanvas(mask,x,y,level,true);const canvas=document.createElement('canvas');canvas.width=canvas.height=256;const context=canvas.getContext('2d');context.globalAlpha=.6;context.drawImage(image,0,0,256,256);context.globalAlpha=1;context.drawImage(rainMaskCanvas(mask,x,y,level),0,0);return canvas},()=>{if(!failed&&rainEnabled&&version===rainVersion){failed=true;onRain(`解析 ${label}。雨雲画像を取得できない箇所があります。灰色は欠測または取得失敗です。`)}},()=>{if(rainEnabled&&version===rainVersion)onSceneChanged('rain')},info=>info?.state===C.RequestState.CANCELLED);
      onSceneChanged('rain');rainLayer=viewer.imageryLayers.addImageryProvider(provider);onRain(`解析 ${label}。灰色は欠測、画像のない部分も安全や雨がないことを示しません。`);viewer.scene.requestRender();
    }catch(error){if(rainEnabled&&version===rainVersion&&!controller.signal.aborted)onRain('雨雲情報または欠測範囲を取得・確認できません。表示はありません。')}
    finally{if(rainEnabled&&version===rainVersion)rainTimer=setTimeout(loadRain,300000)}
  }
  function showRain(show){rainEnabled=!!show;rainVersion++;clearRain();onSceneChanged('rain');if(rainEnabled)loadRain();else onRain('雨雲の解析は非表示です。');viewer.scene.requestRender()}
  function rainVisibility(){if(!document.hidden&&rainEnabled&&rainLayer&&Date.now()-rainTime>1200000)loadRain()}
  document.addEventListener('visibilitychange',rainVisibility);
  viewer.scene.preRender.addEventListener(rainVisibility);
  let buildingMode='detailed',currentArea=null,revision=0,currentTiles=null,shelterRequest=null,jmaAreas=null,weatherTimer=null,weatherMonitor=null,observationTimer=null,observationFocus=null,observationEntities=[],origin=null,destination=null,overview=null,choosingOrigin=false,originEntity=null,distanceLine=null,shelterItems=[],shelterEntities=[],fleetPreviewEntity=null,fleetPreviewIndex=null,waterEntity=null,simulation=null,simulationEntities=[],simulationFrame=null,mapCamera=initialCamera(),mapTracked='one',viewTouched=false,cameraOwnMove=false;
  let lod2LightRequested=false,lod2LightTarget=null,lod2LightApplied=null;
  function setLod2LightRequested(value){lod2LightRequested=value===true;return lod2LightRequested}
  function lod2LightState(){return {requested:lod2LightRequested,target:lod2LightTarget,applied:lod2LightApplied}}
  const aircraftVisible=run=>!!run&&run.phase!=='stopped'&&(!run.isSecond||!['checking','waiting'].includes(run.phase));
  const notifyMapCamera=()=>onMapCamera(mapCamera.view,!!simulation,mapTracked,aircraftVisible(simulation?.second));
  const touchView=()=>{viewTouched=true;cameraOwnMove=false};
  for(const type of ['pointerdown','wheel','keydown'])container.addEventListener(type,touchView);
  function showFacilityOverview(point){viewer.camera.lookAt(C.Cartesian3.fromDegrees(point.longitude,point.latitude,0),new C.HeadingPitchRange(0,C.Math.toRadians(-48),2300));viewer.camera.lookAtTransform(C.Matrix4.IDENTITY)}
  const samplingQueue=createSamplingQueue();
  async function withSamplingLock(owner,read,signal){
    return samplingQueue.run(async()=>{
      const before=viewer.entities.values.length;
      const value=await read();
      if(viewer.entities.values.length!==before)throw new Error('点検中に対象や表示物が変わったため中止しました');
      return value;
    },{signal});
  }
  function clearViewTouched(){viewTouched=false}
  function isViewTouched(){return viewTouched}
  function mapFlightActive(){
    if(largeFleetLoading||largeFleetMap?.active())return true;
    if(['preflight','direct','obstacle','detour','surface-check','delivery'].includes(simulation?.phase))return true;
    return !!simulation?.second&&!['stopped','home','unavailable'].includes(simulation.second.phase);
  }
  function setArea(input,requestedMode=buildingMode){
    if(mapFlightActive())return false;
    if(!['detailed','highest','simple'].includes(requestedMode))throw new Error('建物データの指定が不正です');
    buildingMode=requestedMode;
    const lod2LightAtStart=lod2LightRequested;
    onSceneChanged();
    const area=typeof input==='string'?areaByCode(input):input;
    if(!area||!/^\d{5}$/.test(area.code)||typeof area.areaPrefix!=='string')throw new Error('地域情報が不正です');
    currentArea=area;viewTouched=false;
    stopSimulation();const version=++revision;weatherMonitor?.stop();weatherMonitor=null;observationMonitor.stop();clearObservationView();if(weatherTimer!==null){clearTimeout(weatherTimer);weatherTimer=null}if(observationTimer!==null){clearTimeout(observationTimer);observationTimer=null}shelterRequest?.abort();shelterRequest=new AbortController();
    viewer.entities.removeAll();lod2LightTarget=null;lod2LightApplied=null;origin=null;destination=null;choosingOrigin=false;originEntity=null;distanceLine=null;fleetPreviewEntity=null;fleetPreviewIndex=null;waterEntity=null;shelterItems=[];shelterEntities=[];onSimulation({phase:'needs-points'});onShelterList(null,'loading');onOrigin(null);onDistance(null);
    onReferencePoint(null,'');onObservation('近隣の観測所を確認中');
    if(currentTiles){viewer.scene.primitives.remove(currentTiles);currentTiles=null}
    overview=Number.isFinite(area.longitude)&&Number.isFinite(area.latitude)?{longitude:area.longitude,latitude:area.latitude}:null;
    onAreaView(overview?'ready':'loading');
    if(overview)viewer.camera.setView({destination:C.Cartesian3.fromDegrees(overview.longitude,overview.latitude,1050),orientation:{heading:0,pitch:C.Math.toRadians(-48),roll:0}});
    mark('buildings','loading');mark('shelters','loading');mark('weather','loading');onBuildings(`${area.area}の3D建物を取得中`);onShelters(`${area.area}の避難場所を取得中`);onWeather('気象庁の発表を取得中');onPicked('','');
    weatherMonitor=createWeatherMonitor({load:async signal=>{
      const timeout=AbortSignal.any([signal,AbortSignal.timeout(12000)]);
      if(!jmaAreas){const r=await fetch('https://www.jma.go.jp/bosai/common/const/area.json',{signal:timeout});if(!r.ok)throw new Error('地域情報');const data=await r.json();if(signal.aborted)throw new Error('中断');jmaAreas=data}
      const office=jmaOffice(jmaAreas,area.cityCode||area.code);if(!office)throw new Error('対象区域不明');
      const r=await fetch(`https://www.jma.go.jp/bosai/warning/data/r8/${office}.json`,{signal:timeout,cache:'no-store'});if(!r.ok)throw new Error('防災情報');const product=jmaRainProduct(await r.json());let proof='unknown';
      if(/^\d{6}$/.test(office)&&parseZonedTimestamp(product.controlDatetime)!==null&&parseZonedTimestamp(product.reportDatetime)!==null){
        try{const feed=await fetch('/api/flood-feed',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',signal:timeout});if(feed.ok){const value=await feed.json(),urls=jmaWarningFeedUrls(value.xml,office),results=await Promise.all(urls.map(async url=>{try{const response=await fetch('/api/warning-report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url}),signal:timeout});if(!response.ok)return {available:false};const detail=await response.json(),parsed=parseJmaWarningProof(detail.xml);if(!parsed)return {available:false};return {available:true,state:jmaWarningProofMatches(product,parsed)?jmaWarningProofState(product,parsed):'unmatched'}}catch{return {available:false}}}));proof=selectJmaWarningProof(results)}}
        catch{if(signal.aborted)throw new Error('中断')}
      }
      return {product,proof};
    },onResult:result=>{
      const {product:data,proof}=result;
      if(version!==revision)return;if(weatherTimer!==null){clearTimeout(weatherTimer);weatherTimer=null}const fetched=Date.now(),summary=weatherSummary(data,fetched),date=new Date(summary.published).toLocaleString('ja-JP');
      const local=jmaMunicipalRainExcerpt(data,area.cityCode||area.code);
      const shortText=value=>typeof value==='string'&&value.trim()&&value.length<=100?value.trim():'未確認',controlTime=parseZonedTimestamp(data.controlDatetime),control=controlTime!==null?new Date(controlTime).toLocaleString('ja-JP'):'未確認';
      const prefix=`気象庁 大雨情報・発表 ${date}（広域情報）／取得 ${new Date(fetched).toLocaleString('ja-JP')}／発表官署 ${shortText(data.publishingOffice)}／情報種別 ${shortText(data.infoType)}／電文管理時刻 ${control}${proof==='normal'?'／運用種別：通常（日時・官署・情報種別を元電文と照合。本文の完全一致や最新情報は未確認）':''}`;
      const localText=local?`${area.area}の記載（VPWW55・原文）：${local.kinds.map(item=>`${item.code?`区分コード ${item.code} `:''}${item.status}`).join(' ／ ')}`:`${area.area}の市区町村別の記載は確認できません。`;
      const bulletinState=jmaBulletinState(data.infoType);
      if(proof!=='normal'){mark('weather','unknown');const reason=proof==='training'?'対応する電文は訓練用です。':proof==='test'?'対応する電文は試験用です。':'通常の電文か照合できません。';onWeather(`${prefix}\n${reason} 市区町村の内容は表示しません。最新の状況は気象庁で確認してください。`);return}
      if(bulletinState!=='usable'){mark('weather','unknown');onWeather(`${prefix}\n${bulletinState==='cancelled'?'この電文は取り消されています。警報・注意報の解除とは限りません。':'情報種別を確認できず、利用できません。'} 最新の状況は気象庁で確認してください。`);return}
      const stale=()=>{if(version!==revision)return;mark('weather','stale');onWeather(`${prefix}\n古い発表の記載：${localText}\n発表から6時間以上経過、または時刻を確認できません。これは警報の期限を示しません。現在の状況は気象庁で確認してください。`)};
      if(summary.fresh){mark('weather','current');onWeather(`${prefix}\n${summary.headline||'見出しなし。警報がないことを意味しません。'}\n${localText}\n大雨以外の警報・注意報は気象庁で確認してください。取得時点の情報であり、現在の安全を示しません。`);weatherTimer=setTimeout(stale,Math.max(0,summary.published+6*3600000-Date.now()))}else stale();
    },onFailure:()=>{if(version===revision){if(weatherTimer!==null){clearTimeout(weatherTimer);weatherTimer=null}mark('weather','error');onWeather('気象情報を取得できません。最新状況は気象庁を確認してください。')}}});
    if(document.hidden)weatherMonitor.suspend();else weatherMonitor.refresh();
    const modeLabel=buildingMode==='simple'?'簡易 LOD1':buildingMode==='highest'?'高精細優先 LOD3以下':'詳細優先 LOD2以下',url=buildingDataUrl(area.code,buildingMode),signal=AbortSignal.any([shelterRequest.signal,AbortSignal.timeout(15000)]);
    fetch(url,{signal}).then(response=>{if(!response.ok)throw new Error('建物データが未提供です');return response.json()}).then(data=>{
      if(version!==revision)return;const region=tilesetRegion(data),years=buildingYears(data),levels=buildingLevels(data),yearLabel=years.length?`整備年度：${years.join('・')}年度`:'整備年度：未確認',levelLabel=levels.length?`データ名：${levels.map(level=>`LOD${level}`).join('・')}`:'データ名の詳細度：未確認';
      if(!region)throw new Error('建物データの位置を確認できません');
      onReferencePoint(region,`${area.area}・建物モデルの範囲中心`);
      observationMonitor.set(region,'建物モデル範囲の中心','model_center');
      if(!overview){overview=region;viewer.camera.setView({destination:C.Cartesian3.fromDegrees(region.longitude,region.latitude,1700),orientation:{heading:0,pitch:C.Math.toRadians(-48),roll:0}});viewTouched=false;onAreaView('ready')}
      C.Cesium3DTileset.fromUrl(url,{maximumScreenSpaceError:buildingMode==='highest'?8:buildingMode==='detailed'?12:16}).then(tiles=>{
        if(version!==revision){tiles.destroy();return}if(levels.includes(3))tiles.imageBasedLighting.sphericalHarmonicCoefficients=[new C.Cartesian3(1.2,1.2,1.2),...Array.from({length:8},()=>new C.Cartesian3(0,0,0))];lod2LightTarget=(buildingMode==='detailed'&&levels.includes(2)&&!levels.includes(3))?'lod2':'other';lod2LightApplied=lod2LightTarget==='lod2'?lod2LightAtStart:null;if(lod2LightTarget==='lod2'&&lod2LightAtStart)tiles.imageBasedLighting.sphericalHarmonicCoefficients=[new C.Cartesian3(0.6,0.6,0.6),...Array.from({length:8},()=>new C.Cartesian3(0,0,0))];currentTiles=tiles;viewer.scene.primitives.add(tiles);let failed=false;
        onBuildings(`PLATEAU建物モデル ${modeLabel} を読み込み中（${yearLabel}／${levelLabel}）`);
        tiles.initialTilesLoaded.addEventListener(()=>{if(version===revision&&!failed){mark('buildings','available');onBuildings(`PLATEAU建物モデル ${modeLabel} を表示中（${yearLabel}／${levelLabel}）`)}});
        tiles.tileFailed.addEventListener(()=>{failed=true;if(version===revision){mark('buildings','error');onBuildings('建物データの一部を取得できません');stopSecond(simulation,'建物データを取得できません');const phase=interruptForBuildingFailure(simulation,()=>{if(simulationFrame!==null)cancelAnimationFrame(simulationFrame);simulationFrame=null});if(phase)onSimulation({phase,message:'建物データを取得できなくなりました'});if(invalidateRouteInspection(simulation,marker=>viewer.entities.remove(marker))){onSceneChanged();onRouteProbe({state:'error',message:'建物データの一部を取得できないため、以前の点検の詳細を消しました'});onRouteProbe({state:'ready',reports:simulation.probes})}}});
      }).catch(()=>{if(version===revision){mark('buildings','error');onBuildings('建物データを取得できません。地図のみ表示しています。')}});
      let tiles;try{tiles=tilesForBounds(region,10)}catch{mark('shelters','error');onShelterList(null,'error');onShelters('地域が広いため施設を自動取得できません。自治体の情報を確認してください。');return}
      const requests=tiles.map(tile=>DATA.shelters.replace('{z}',tile.z).replace('{x}',tile.x).replace('{y}',tile.y));
      Promise.all(requests.map(request=>fetch(request,{signal}).then(response=>{if(!response.ok)throw new Error('施設情報の取得に失敗');return response.json()}))).then(results=>{
        if(version!==revision)return;const found=new Map();for(const result of results)for(const s of selectFloodShelters(result,area.areaPrefix))found.set(`${s.name}|${s.longitude}|${s.latitude}`,s);
        const shelters=[...found.values()];shelterItems=shelters;onShelterList(shelters);mark('shelters','available');shelterEntities=shelters.map((shelter,index)=>viewer.entities.add({name:shelter.name,position:C.Cartesian3.fromDegrees(shelter.longitude,shelter.latitude,15),point:{pixelSize:9,color:C.Color.fromCssColorString('#ff8c3a'),outlineColor:C.Color.WHITE,outlineWidth:1,disableDepthTestDistance:Number.POSITIVE_INFINITY},properties:{shelterIndex:index}}));
        const focus=representativeShelter(shelters);if(focus&&!Number.isFinite(area.latitude)){overview={latitude:focus.latitude,longitude:focus.longitude,facility:true};if(!viewTouched&&viewer.useDefaultRenderLoop)showFacilityOverview(overview)}
        onShelters(shelters.length?`${area.area}の洪水向け指定緊急避難場所 ${shelters.length}件（開設状況は不明）${focus&&!Number.isFinite(area.latitude)?'。街全体の基準は施設分布の中央付近です。':''}`:'この取得範囲に対象施設がありません。施設が存在しないことを意味しません。');
      }).catch(()=>{if(version===revision){mark('shelters','error');onShelterList(null,'error');onShelters('避難場所データを取得できません。開設状況も不明です。')}});
    }).catch(()=>{if(version===revision){if(!overview)onAreaView('error');mark('buildings','error');mark('shelters','error');onShelterList(null,'error');onBuildings('建物データを取得できません。');onShelters('対象地域を確認できず、避難場所を取得できません。');onObservation('対象範囲を確認できず、観測所を選択できません。')}});
    return true;
  }
  const observationMonitor=createObservationMonitor({
    load:async(point,controllerSignal)=>{
      const signal=AbortSignal.any([controllerSignal,AbortSignal.timeout(15000)]);
      const root='https://www.jma.go.jp/bosai/amedas/';
      const get=async url=>{const response=await fetch(url,{signal,cache:'no-store'});if(!response.ok)throw new Error('観測情報を取得できません');return response};
      const [stationResponse,timeResponse]=await Promise.all([get(root+'const/amedastable.json'),get(root+'data/latest_time.txt')]);
      const [stations,time]=await Promise.all([stationResponse.json(),timeResponse.text()]);
      const key=amedasTimeKey(time),readings=await (await get(root+`data/map/${key}.json`)).json();
      const fetched=Date.now(),value=amedasObservation(stations,readings,point,time,fetched);return value?{...value,retrievedAt:new Date(fetched).toISOString()}:null;
    },
    onLoading:ref=>{clearObservationView();if(observationTimer!==null){clearTimeout(observationTimer);observationTimer=null}onObservation(`${ref.label}の近隣観測を確認中です。`)},
    onResult:(result,ref,current)=>{
      clearObservationView();if(observationTimer!==null){clearTimeout(observationTimer);observationTimer=null}
      if(!result){onObservation(`${ref.label}から30km以内の利用可能な観測値を確認できません。`);return}
      const prefix=`${result.station}（${ref.label}から約 ${(result.distance/1000).toFixed(1)} km）・観測 ${new Date(result.published).toLocaleString('ja-JP')}`;
      const stale=()=>{if(current()){clearObservationView();onObservation(`${prefix}。観測が古いか時刻を確認できないため値は表示しません。再取得してください。`)}};
      if(!result.fresh){stale();return}
      observationFocus={ref,result,current};onObservationView(true);onObservation(`${prefix}。観測時刻までの降水量：10分間 ${result.rain===null?'未確認':`${result.rain} mm`}、1時間 ${result.rain1h===null?'未確認':`${result.rain1h} mm`}、24時間 ${result.rain24h===null?'未確認':`${result.rain24h} mm`}。10分間平均風速：${result.wind===null?'未確認':`${result.wind} m/s`}。観測所の地上値で、施設の浸水深ではありません。`,{area:currentArea.cityCode||currentArea.code,stationId:result.stationId,station:result.station,referenceLabel:ref.label,referenceKind:ref.kind,distance:result.distance,latitude:result.latitude,longitude:result.longitude,observedAt:new Date(result.published).toISOString(),retrievedAt:result.retrievedAt,rain:result.rain,rain1h:result.rain1h,rain24h:result.rain24h,wind:result.wind});
      observationTimer=setTimeout(stale,Math.max(0,result.published+1800000-Date.now()));
    },
    onFailure:(_error,ref)=>{clearObservationView();if(observationTimer!==null){clearTimeout(observationTimer);observationTimer=null}onObservation(`${ref.label}の近隣観測を取得できません。気象庁で最新情報を確認してください。`)}
  });
  // A hidden or suspended tab cannot be relied on to run expiry timers on time.
  let weatherPageHidden=document.hidden;
  function weatherVisibility(){
    if(document.hidden===weatherPageHidden)return;weatherPageHidden=document.hidden;
    if(document.hidden){
      weatherMonitor?.suspend();observationMonitor.suspend();
      if(weatherTimer!==null){clearTimeout(weatherTimer);weatherTimer=null}if(observationTimer!==null){clearTimeout(observationTimer);observationTimer=null}
      clearObservationView();mark('weather','loading');onWeather('画面を再表示した後、気象庁の発表を再確認します。');onObservation('画面を再表示した後、近隣観測を再確認します。');
    }else{
      mark('weather','loading');onWeather('気象庁の発表を再確認中です。');onObservation('近隣観測を再確認中です。');
      weatherMonitor?.resume();observationMonitor.resume();
    }
  }
  document.addEventListener('visibilitychange',weatherVisibility);
  if(document.hidden)observationMonitor.suspend();
  function clearObservationView(){observationFocus=null;if(observationEntities.length){for(const entity of observationEntities)viewer.entities.remove(entity);observationEntities=[];onSceneChanged('observation')}onObservationView(false)}
  let pilotRiverEntity=null;
  function focusPilotRiverStation(id){
    if(mapFlightActive()||choosingOrigin)return false;
    const area=typeof currentArea==='string'?currentArea:currentArea?.cityCode||currentArea?.code;
    const station=riverPilotStations(area).find(item=>item.id===id);if(!station)return false;
    if(pilotRiverEntity)viewer.entities.remove(pilotRiverEntity);
    viewTouched=true;onSceneChanged('observation');
    pilotRiverEntity=viewer.entities.add({position:C.Cartesian3.fromDegrees(station.longitude,station.latitude,40),point:{pixelSize:16,color:C.Color.fromCssColorString('#41ccef'),outlineColor:C.Color.WHITE,outlineWidth:2,disableDepthTestDistance:Number.POSITIVE_INFINITY},label:{text:`水位観測所 ${station.name}\n位置情報・水位は未取得`,font:'bold 15px sans-serif',fillColor:C.Color.WHITE,showBackground:true,pixelOffset:new C.Cartesian2(0,-24),verticalOrigin:C.VerticalOrigin.BOTTOM,disableDepthTestDistance:Number.POSITIVE_INFINITY}});
    viewer.camera.lookAt(C.Cartesian3.fromDegrees(station.longitude,station.latitude,40),new C.HeadingPitchRange(0,C.Math.toRadians(-60),1300));viewer.camera.lookAtTransform(C.Matrix4.IDENTITY);viewer.scene.requestRender();return true;
  }
  function focusObservation(){
    const focus=observationFocus;if(!focus||!focus.current())return;const {ref,result}=focus,age=Date.now()-result.published;
    if(age>1800000||age< -300000){clearObservationView();onObservation('観測が古いか時刻を確認できないため、観測所を表示できません。');return}
    viewTouched=true;onSceneChanged('observation');for(const entity of observationEntities)viewer.entities.remove(entity);observationEntities=[];
    const color=C.Color.fromCssColorString('#77caff'),start=ref.point,end={latitude:result.latitude,longitude:result.longitude};
    observationEntities.push(viewer.entities.add({position:C.Cartesian3.fromDegrees(end.longitude,end.latitude,40),point:{pixelSize:13,color,outlineColor:C.Color.WHITE,outlineWidth:2,disableDepthTestDistance:Number.POSITIVE_INFINITY},label:{text:`アメダス ${result.station}\n${new Date(result.published).toLocaleString('ja-JP')} 観測`,font:'bold 14px sans-serif',fillColor:C.Color.WHITE,showBackground:true,pixelOffset:new C.Cartesian2(0,-22),verticalOrigin:C.VerticalOrigin.BOTTOM,disableDepthTestDistance:Number.POSITIVE_INFINITY}}));
    observationEntities.push(viewer.entities.add({polyline:{positions:C.Cartesian3.fromDegreesArrayHeights([start.longitude,start.latitude,40,end.longitude,end.latitude,40]),width:5,material:new C.PolylineOutlineMaterialProperty({color,outlineColor:C.Color.fromCssColorString('#12364b'),outlineWidth:2}),arcType:C.ArcType.GEODESIC}}));
    if(!destination)observationEntities.push(viewer.entities.add({position:C.Cartesian3.fromDegrees(start.longitude,start.latitude,40),point:{pixelSize:9,color:C.Color.WHITE,outlineColor:color,outlineWidth:2,disableDepthTestDistance:Number.POSITIVE_INFINITY},label:{text:'建物モデルの範囲中心',font:'12px sans-serif',fillColor:C.Color.WHITE,showBackground:true,pixelOffset:new C.Cartesian2(0,-18),verticalOrigin:C.VerticalOrigin.BOTTOM,disableDepthTestDistance:Number.POSITIVE_INFINITY}}));
    if(simulation){viewer.trackedEntity=undefined;mapCamera=selectCamera(mapCamera,'wide');notifyMapCamera()}
    viewer.camera.lookAt(C.Cartesian3.fromDegrees((start.longitude+end.longitude)/2,(start.latitude+end.latitude)/2,0),new C.HeadingPitchRange(0,C.Math.toRadians(-65),Math.max(1500,result.distance*2)));viewer.camera.lookAtTransform(C.Matrix4.IDENTITY);viewer.scene.requestRender();
  }
  setArea('13118');
  function updateDistance(){
    if(distanceLine){viewer.entities.remove(distanceLine);distanceLine=null}
    if(!origin||!destination){onDistance(null);return}
    const distance=straightDistance(origin,destination);onDistance(distance);onSimulation({phase:'ready'});
    // An indicative surface line only; it is not a proposed flight route.
    distanceLine=viewer.entities.add({polyline:{positions:C.Cartesian3.fromDegreesArrayHeights([origin.longitude,origin.latitude,40,destination.longitude,destination.latitude,40]),width:2,material:new C.PolylineDashMaterialProperty({color:C.Color.WHITE.withAlpha(.7)}),arcType:C.ArcType.GEODESIC}});
  }
  function selectShelter(index){
    if(!Number.isInteger(index)||index<0||index>=shelterItems.length)return false;
    if(mapFlightActive()){onSelectionBlocked('shelter');return false}
    viewTouched=true;onSceneChanged();stopSimulation();
    const shelter=shelterItems[index];shelterEntities.forEach((entity,i)=>{const selected=i===index;entity.point.pixelSize=selected?15:9;entity.point.color=selected?C.Color.CYAN:C.Color.fromCssColorString('#ff8c3a');entity.label=selected?{text:`${shelter.name}\n開設・受入 未確認`,font:'bold 14px sans-serif',fillColor:C.Color.WHITE,showBackground:true,pixelOffset:new C.Cartesian2(0,-24),verticalOrigin:C.VerticalOrigin.BOTTOM,disableDepthTestDistance:Number.POSITIVE_INFINITY}:undefined});destination={latitude:shelter.latitude,longitude:shelter.longitude};onReferencePoint(destination,`${shelter.name}（公開施設の位置）`);observationMonitor.set(destination,`${shelter.name}の公開座標`,'facility');onPicked(shelter.name,shelter.address,index);updateDistance();return true;
  }
  function setFleetPreview(choice){
    const place=Number.isInteger(choice?.index)?shelterItems[choice.index]:null;
    const valid=place&&place.latitude===choice.latitude&&place.longitude===choice.longitude;
    const index=valid?choice.index:null;if(index===fleetPreviewIndex)return;
    if(fleetPreviewEntity)viewer.entities.remove(fleetPreviewEntity);fleetPreviewEntity=null;fleetPreviewIndex=index;onSceneChanged();
    if(valid)fleetPreviewEntity=viewer.entities.add({position:C.Cartesian3.fromDegrees(place.longitude,place.latitude,40),point:{pixelSize:13,color:C.Color.LIME,outlineColor:C.Color.WHITE,outlineWidth:2,disableDepthTestDistance:Number.POSITIVE_INFINITY},label:{text:`2号機の候補\n${place.name}\n開設・受入 未確認`,font:'bold 13px sans-serif',fillColor:C.Color.WHITE,showBackground:true,pixelOffset:new C.Cartesian2(0,-25),verticalOrigin:C.VerticalOrigin.BOTTOM,disableDepthTestDistance:Number.POSITIVE_INFINITY}});
    viewer.scene.requestRender();
  }
  function setWaterScene(show){
    if(waterEntity)viewer.entities.remove(waterEntity);waterEntity=null;onSceneChanged();
    if(show&&destination){
      const motion=window.matchMedia?.('(prefers-reduced-motion: reduce)');
      const mask=document.createElement('canvas');mask.width=mask.height=256;const ctx=mask.getContext('2d'),fade=ctx.createRadialGradient(128,128,72,128,128,128);fade.addColorStop(0,'white');fade.addColorStop(1,'black');ctx.fillStyle=fade;ctx.fillRect(0,0,256,256);
      const material={isConstant:false,definitionChanged:new C.Event(),getType(){return 'Water'},getValue(_time,result={}){return Object.assign(result,{baseWaterColor:C.Color.fromCssColorString('#716b5a').withAlpha(.65),blendColor:C.Color.fromCssColorString('#8b8571').withAlpha(.65),specularMap:mask,normalMap:'/cesium/Assets/Textures/waterNormalsSmall.jpg',frequency:300,animationSpeed:motion?.matches?0:.008,amplitude:3,specularIntensity:.35})},equals(other){return this===other}};
      waterEntity=viewer.entities.add({position:C.Cartesian3.fromDegrees(destination.longitude,destination.latitude),ellipse:{semiMajorAxis:250,semiMinorAxis:250,height:1.5,material}});
    }
    viewer.scene.requestRender();return !!waterEntity;
  }
  function focusShelter(){
    if(!destination)return;
    onSceneChanged('camera');
    if(simulation){viewer.trackedEntity=undefined;mapCamera=selectCamera(mapCamera,'wide');notifyMapCamera()}
    viewer.camera.lookAt(C.Cartesian3.fromDegrees(destination.longitude,destination.latitude,15),new C.HeadingPitchRange(0,C.Math.toRadians(-65),650));
    viewer.camera.lookAtTransform(C.Matrix4.IDENTITY);viewer.scene.requestRender();
  }
  function confirmOriginAt(position){
    if(mapFlightActive()){onSelectionBlocked('origin');return false}
    const point=viewer.camera.pickEllipsoid(position,viewer.scene.globe.ellipsoid);if(!point)return false;
    stopSimulation();const c=C.Cartographic.fromCartesian(point);origin={latitude:C.Math.toDegrees(c.latitude),longitude:C.Math.toDegrees(c.longitude)};choosingOrigin=false;
      if(originEntity)viewer.entities.remove(originEntity);originEntity=viewer.entities.add({position:C.Cartesian3.fromDegrees(origin.longitude,origin.latitude,15),point:{pixelSize:11,color:C.Color.CYAN,outlineColor:C.Color.WHITE,outlineWidth:1,disableDepthTestDistance:Number.POSITIVE_INFINITY},label:{text:'出発・帰還（仮想）',font:'bold 12px sans-serif',fillColor:C.Color.WHITE,showBackground:true,pixelOffset:new C.Cartesian2(0,14),horizontalOrigin:C.HorizontalOrigin.CENTER,verticalOrigin:C.VerticalOrigin.TOP,disableDepthTestDistance:Number.POSITIVE_INFINITY}});
      onOrigin(origin);updateDistance();return true;
  }
  function originKeys(event){
    if(!choosingOrigin)return;
    const step=100;
    if(event.key==='ArrowUp'){viewer.camera.moveUp(step);event.preventDefault()}
    else if(event.key==='ArrowDown'){viewer.camera.moveDown(step);event.preventDefault()}
    else if(event.key==='ArrowLeft'){viewer.camera.moveLeft(step);event.preventDefault()}
    else if(event.key==='ArrowRight'){viewer.camera.moveRight(step);event.preventDefault()}
    else if(event.key==='Enter'){event.preventDefault();confirmOriginAt(new C.Cartesian2(container.clientWidth/2,container.clientHeight/2))}
  }
  container.addEventListener('keydown',originKeys);
  const handler=new C.ScreenSpaceEventHandler(viewer.scene.canvas);handler.setInputAction(click=>{
    if(choosingOrigin){confirmOriginAt(click.position);return}

    const hit=viewer.scene.pick(click.position),entity=hit?.id;
    if(typeof entity==='string'&&entity.startsWith('fleet:')){largeFleetMap?.select(entity.slice(6));return}
    const index=entity?.properties?.shelterIndex?.getValue();if(Number.isInteger(index))selectShelter(index);
  },C.ScreenSpaceEventType.LEFT_CLICK);
  function capture({includeVirtualMarker=false}={}){
    const captureFrame=()=>withHiddenOverlay(waterEntity,()=>withHiddenOverlay(simulation?.second?.directionEntity,()=>withHiddenOverlay(simulation?.wireGroup,()=>withHiddenOverlay(includeVirtualMarker?null:simulation?.obstacle,()=>{viewer.resize();viewer.render();const source=viewer.scene.canvas,size=fitImage(source.width,source.height,1024);
      if(!size.width||!size.height)throw new Error('地図画像を取得できません');
      const output=document.createElement('canvas');output.width=size.width;output.height=size.height;output.getContext('2d').drawImage(source,0,0,size.width,size.height);
      return {image:output.toDataURL('image/png'),canvas:output,view:{matrix:C.Matrix4.clone(viewer.camera.viewMatrix),width:source.width,height:source.height}};
    }))));
    try{return largeFleetMap?largeFleetMap.withoutMarkers(captureFrame):captureFrame()}finally{viewer.scene.requestRender()}
  }
  function isViewCurrent(view){const source=viewer.scene.canvas;return isViewFrameCurrent({width:view?.width,height:view?.height,matrix:view?.matrix},{width:source.width,height:source.height,matrix:viewer.camera.viewMatrix})}
  function stopSimulation(reason){
    largeFleetVersion++;largeFleetLoading=false;
    if(largeFleetMap){largeFleetMap.clear();largeFleetMap=null;onLargeFleet(null)}
    if(simulationFrame!==null)cancelAnimationFrame(simulationFrame);simulationFrame=null;stopSecond(simulation,reason);simulation?.surfaceController?.abort();simulation?.probeController?.abort();viewer.trackedEntity=undefined;simulation=null;mapCamera=initialCamera();mapTracked='one';notifyMapCamera();onRouteProbe({state:'idle'});onFleet(null);
    for(const entity of simulationEntities)viewer.entities.remove(entity);simulationEntities=[];
    onProgress(null);onSimulation({phase:origin&&destination?'ready':'needs-points'});
  }
  async function startLargeFleet(count=100,cargoRequest=null,scenario='standard'){
    if(mapFlightActive())throw new Error('配送が進行中です');
    stopSimulation();
    if(!origin||!destination)throw new Error('配送先と出発地点を選択してください');
    const token=++largeFleetVersion;largeFleetLoading=true;
    try{
      const {createFleetMap}=await import('./fleet-map.mjs');
      if(token!==largeFleetVersion)return false;
      largeFleetMap=createFleetMap({C,viewer,withSamplingLock,
        modelSnapshot:()=>({tiles:currentTiles,version:revision,available:evidence.buildings==='available'}),
        onUpdate:onLargeFleet,onPick:onLargeFleetPick,consult:onLargeFleetConsult});
      largeFleetMap.start({origin,facilities:shelterItems,selectedDestination:destination,count,cargoRequest,scenario});
      // Fit the selected origin and destination in the first operational view.
      // This is a camera change only; route and evidence calculations are unchanged.
      try{
        const center={latitude:(origin.latitude+destination.latitude)/2,longitude:(origin.longitude+destination.longitude)/2};
        const radius=straightDistance(origin,destination)/2;
        viewer.trackedEntity=undefined;
        viewer.camera.lookAt(C.Cartesian3.fromDegrees(center.longitude,center.latitude,180),new C.HeadingPitchRange(0,C.Math.toRadians(-65),Math.max(900,radius*3.6)));
        viewer.camera.lookAtTransform(C.Matrix4.IDENTITY);
      }catch{viewer.scene.requestRender()}
      return true;
    }finally{if(token===largeFleetVersion)largeFleetLoading=false}
  }
  function stopLargeFleet(reason='利用者が仮想配送を停止しました'){largeFleetVersion++;largeFleetLoading=false;if(largeFleetMap)largeFleetMap.stop(reason);else onLargeFleet({active:false,error:reason})}
  function resolveLargeFleetDiversion(id,accepted){return largeFleetMap?.resolveDiversion(id,accepted)??Promise.resolve(false)}
  function simulate(secondDestination=null){
    stopSimulation();let route;try{route=mapSimulationPath(origin,destination)}catch(error){onSimulation({phase:'error',message:error.message});return false}
    const coords=points=>C.Cartesian3.fromDegreesArrayHeights(points.flatMap(p=>[p.longitude,p.latitude,180]));
    const marker=(p,label,color)=>viewer.entities.add({position:C.Cartesian3.fromDegrees(p.longitude,p.latitude,180),point:{pixelSize:16,color,outlineColor:C.Color.WHITE,outlineWidth:2,disableDepthTestDistance:Number.POSITIVE_INFINITY},label:{text:label,font:'14px sans-serif',fillColor:C.Color.WHITE,showBackground:true,pixelOffset:new C.Cartesian2(0,-24),disableDepthTestDistance:Number.POSITIVE_INFINITY}});
    const line=viewer.entities.add({polyline:{positions:coords([origin,route.obstacle,destination]),width:3,material:new C.PolylineDashMaterialProperty({color:C.Color.ORANGE}),arcType:C.ArcType.NONE}});
    const obstacle=marker(route.obstacle,'仮想電線（演出）',C.Color.ORANGE),drone=marker(origin,'1号機（仮想）',C.Color.CYAN);simulationEntities.push(line,obstacle,drone);
    const heading=Math.atan2((route.obstacle.longitude-origin.longitude)*Math.cos(origin.latitude*Math.PI/180),route.obstacle.latitude-origin.latitude);
    simulation={route,line,drone,obstacle,secondDestination,phase:'preflight',candidates:[],probeMarkers:[],probes:null,center:C.Cartesian3.fromDegrees(origin.longitude,origin.latitude,180),heading,wireHeading:heading,spin:0};
    const run=simulation;
    const visible=new C.CallbackProperty(()=>['obstacle','detour','surface-check','delivery','complete'].includes(run.phase),false);
    obstacle.point.show=visible;obstacle.label.show=visible;
    run.wireGroup=viewer.entities.add({show:true});simulationEntities.push(run.wireGroup);
    for(const strand of virtualWireGeometry(origin,destination)){
      const wire=viewer.entities.add({parent:run.wireGroup,polyline:{positions:C.Cartesian3.fromDegreesArrayHeights(strand.flatMap(p=>[p.longitude,p.latitude,p.height])),show:visible,width:5,material:new C.PolylineOutlineMaterialProperty({color:C.Color.fromCssColorString('#f8ba6c'),outlineColor:C.Color.fromCssColorString('#35291f'),outlineWidth:1}),arcType:C.ArcType.NONE}});
      simulationEntities.push(wire);
    }
    drone.trackingReferenceFrame=C.TrackingReferenceFrame.INERTIAL;drone.orientation=new C.CallbackProperty(()=>C.Transforms.headingPitchRollQuaternion(run.center,new C.HeadingPitchRoll(run.heading,0,0)),false);
    updateTrackingView();
    const showPrimary=()=>mapCamera.view==='wide'||mapTracked==='two';drone.point.pixelSize=new C.CallbackProperty(()=>showPrimary()?16:1,false);drone.point.color=new C.CallbackProperty(()=>showPrimary()?C.Color.CYAN:C.Color.TRANSPARENT,false);drone.point.outlineWidth=new C.CallbackProperty(()=>showPrimary()?2:0,false);drone.label.show=new C.CallbackProperty(showPrimary,false);addAircraft(simulation);
    applyMapCamera();onProgress(straightDistance(origin,destination));onSimulation({phase:'preflight'});inspectDeparture(simulation);return true;
  }
  async function inspectDeparture(run){
    const tiles=currentTiles,version=revision,controller=new AbortController();run.probeController=controller;
    try{
      if(!tiles||evidence.buildings!=='available'||!viewer.scene.sampleHeightSupported)throw new Error('3D建物モデルが利用できません');
      const samples=routeSamplePoints(run.route.direct),positions=samples.points.map(p=>C.Cartographic.fromDegrees(p.longitude,p.latitude));
      const {report,decision}=await withSamplingLock(run,()=>{const exclude=[...viewer.entities.values,viewer.scene.globe];return inspectDepartureSamples(async()=>{const result=await viewer.scene.sampleHeightMostDetailed(positions,exclude,5);return result.map(p=>p?.height)},samples.points.length,{signal:controller.signal,isModelAvailable:()=>evidence.buildings==='available'});},controller.signal);
      if(simulation!==run)return;
      if(version!==revision||tiles!==currentTiles)throw new Error('点検中に地図が変わりました');
      const details={...report,total:samples.points.length,maxGap:Math.ceil(samples.maxGap)};
      if(decision==='blocked'){run.phase='preflight-blocked';onSimulation({phase:run.phase,report:details});return}
      if(decision==='unavailable')throw new Error('点検地点の高さに不明な箇所があります');
      if(!routeReportComplete(details))throw new Error('点検地点の間隔または結果が不十分です');
      run.departurePoints=samples.points;run.departureReport=details;run.phase='direct';
      mapCamera=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches?initialCamera():beginFlight();applyMapCamera();onSimulation({phase:'direct',report:details});animateSimulation(run.route.direct,6000,'obstacle');startSecond(run);
    }catch(error){if(simulation===run&&run.phase==='preflight'){run.phase='preflight-unavailable';onSimulation({phase:run.phase,message:error.message})}}
    finally{if(run.probeController===controller)run.probeController=null}
  }
  function stopSecond(owner,reason){
    const run=owner?.second;if(!run||['home','stopped'].includes(run.phase))return;
    run.phase='stopped';run.controller?.abort();if(run.frame!==null)cancelAnimationFrame(run.frame);run.frame=null;
    if(reason&&mapCamera.view==='follow'&&mapTracked==='two'){mapTracked='one';mapCamera=selectCamera(mapCamera,'wide');applyMapCamera()}else if(reason)notifyMapCamera();
    if(reason)onFleet({phase:'stopped',name:run.name,message:reason,report:run.report});
  }
  async function startSecond(owner){
    const choice=owner.secondDestination,place=Number.isInteger(choice?.index)?shelterItems[choice.index]:null;
    if(!place||place.latitude!==choice.latitude||place.longitude!==choice.longitude){onFleet({phase:'unavailable',message:'別の施設候補がありません'});return}
    const start={...origin},end={latitude:place.latitude,longitude:place.longitude};
    try{const distance=straightDistance(start,end);if(distance<50||distance>20000)throw new Error('施設までの距離が範囲外です')}catch(error){onFleet({phase:'unavailable',name:place.name,message:error.message});return}
    const heading=Math.atan2((end.longitude-start.longitude)*Math.cos(start.latitude*Math.PI/180),end.latitude-start.latitude);
    const center=C.Cartesian3.fromDegrees(start.longitude,start.latitude,195),drone=viewer.entities.add({position:center,point:{pixelSize:12,color:C.Color.LIME,outlineColor:C.Color.WHITE,outlineWidth:2,disableDepthTestDistance:Number.POSITIVE_INFINITY},label:{text:'2号機（仮想）',font:'14px sans-serif',fillColor:C.Color.WHITE,showBackground:true,pixelOffset:new C.Cartesian2(0,-22),disableDepthTestDistance:Number.POSITIVE_INFINITY}});
    simulationEntities.push(drone);
    const run={isSecond:true,name:place.name,start,end,drone,center,heading,spin:0,phase:'checking',frame:null,controller:new AbortController()};owner.second=run;drone.point.show=new C.CallbackProperty(()=>aircraftVisible(run),false);drone.trackingReferenceFrame=C.TrackingReferenceFrame.INERTIAL;drone.orientation=new C.CallbackProperty(()=>C.Transforms.headingPitchRollQuaternion(run.center,new C.HeadingPitchRoll(run.heading,0,0)),false);drone.point.pixelSize=new C.CallbackProperty(()=>mapCamera.view==='follow'&&mapTracked==='two'?1:12,false);drone.label.show=new C.CallbackProperty(()=>aircraftVisible(run)&&!(mapCamera.view==='follow'&&mapTracked==='two'),false);addAircraft(run);updateTrackingView();notifyMapCamera();onFleet({phase:run.phase,name:run.name});
    checkSecond(owner,run);
  }
  async function checkSecond(owner,run){
        const start=run.start,end=run.end,tiles=currentTiles,version=revision;
    try{
      if(!tiles||evidence.buildings!=='available'||!viewer.scene.sampleHeightSupported)throw new Error('建物モデルを点検できません');
      const samples=routeSamplePoints([start,end]),positions=samples.points.map(p=>C.Cartographic.fromDegrees(p.longitude,p.latitude));
      const heights=await withSamplingLock(run,()=>{const exclude=[...viewer.entities.values,viewer.scene.globe];return readRouteSamples(async()=>{const result=await viewer.scene.sampleHeightMostDetailed(positions,exclude,5);return result.map(p=>p?.height)},positions.length,{signal:run.controller.signal,isModelAvailable:()=>evidence.buildings==='available'});},run.controller.signal);
      if(simulation!==owner||run.phase!=='checking')return;
      if(version!==revision||tiles!==currentTiles)throw new Error('点検中に地図が変わりました');
      const report=routeSampleReport(heights,190);run.report={...report,total:positions.length,maxGap:Math.ceil(samples.maxGap)};run.routePoints=samples.points;
      if(report.blockedIndices.length)throw new Error('仮想高度付近に建物表面を検出しました');
      if(!report.observed)throw new Error('経路上の高さが不明です');
      if(!routeReportComplete(run.report))throw new Error('経路上に高さ不明の地点があるか、点検間隔が不十分です');
      const position=C.Cartographic.fromDegrees(end.longitude,end.latitude);
      run.surface=await withSamplingLock(run,()=>readMapSurface(async()=>{const points=await viewer.scene.sampleHeightMostDetailed([position],[...viewer.entities.values,viewer.scene.globe],.3);return points?.[0]?.height},{signal:run.controller.signal,isModelAvailable:()=>evidence.buildings==='available'}),run.controller.signal);
      if(simulation!==owner||run.phase!=='checking')return;
      if(version!==revision||tiles!==currentTiles)throw new Error('点検中に地図が変わりました');
      run.directionEntity=viewer.entities.add({polyline:{positions:new C.CallbackProperty(()=>{const target=secondFlightTarget(run.phase,start,end);return target?[run.center,C.Cartesian3.fromDegrees(target.longitude,target.latitude,195)]:[]},false),show:new C.CallbackProperty(()=>!!secondFlightTarget(run.phase,start,end),false),width:11,material:new C.PolylineArrowMaterialProperty(C.Color.LIME.withAlpha(.9)),arcType:C.ArcType.NONE}});simulationEntities.push(run.directionEntity);
      run.controller=null;animateSecond(owner,run);
    }catch(error){if(simulation===owner&&run.phase==='checking')stopSecond(owner,error.message)}
  }
  function animateSecond(owner,run){
    let elapsed=0,last=null,lastMetric=-Infinity;
    const step=now=>{
      if(simulation!==owner||run.phase==='stopped')return;
      if(last!==null)elapsed+=Math.min(100,Math.max(0,now-last));last=now;
      const motion=secondDroneMotion(elapsed);
      let point=run.start,height=195;
      if(motion.phase==='outbound')point=mapSimulationPosition([run.start,run.end],motion.progress);
      else if(motion.phase==='delivery'){point=run.end;height=mapDeliveryPose(run.surface,motion.progress,195).droneHeight}
      else if(motion.phase==='ascent'){
        point=run.end;
        height=run.surface+8+(195-run.surface-8)*motion.progress;
      }else if(motion.phase==='returning')point=mapSimulationPosition([run.end,run.start],motion.progress);
      const next=C.Cartesian3.fromDegrees(point.longitude,point.latitude,height);
      if(motion.phase!=='waiting'&&virtualAircraftApproach(run.center,next,owner.center)){stopSecond(owner,run.parcelCenter?'荷下ろし後、仮想の2機が接近するため帰還を中止しました':'仮想の2機が接近するため中止しました');return}
      const phaseChanged=motion.phase!==run.phase;
      if(phaseChanged){run.phase=motion.phase;updateTrackingView();notifyMapCamera();onFleet({phase:run.phase,name:run.name,report:run.report})}
      if(motion.phase==='delivery')run.deliveryPose=mapDeliveryPose(run.surface,motion.progress,195);
      if(motion.phase==='ascent'&&!run.parcelCenter){run.parcelCenter=C.Cartesian3.fromDegrees(run.end.longitude,run.end.latitude,run.surface+.275);run.parcelHeading=run.heading}
      if(motion.phase==='returning'){run.heading=smoothHeading(run.heading,Math.atan2((run.start.longitude-run.end.longitude)*Math.cos(run.end.latitude*Math.PI/180),run.start.latitude-run.end.latitude),.1);run.deliveryPose=null}
      run.spin=now*.018;run.center=next;run.drone.position=run.center;
      if(motion.phase!=='waiting'&&(phaseChanged||now-lastMetric>=500)){const goal=['returning','home'].includes(motion.phase)?run.start:run.end;onFleetPosition({phase:motion.phase,distance:straightDistance(point,goal),total:straightDistance(run.start,run.end)});lastMetric=now}
      viewer.scene.requestRender();
      if(motion.phase==='home'){run.frame=null;return}run.frame=requestAnimationFrame(step);
    };
    run.frame=requestAnimationFrame(step);
  }
  function addAircraft(run){
    for(const part of mapDroneParts()){
      const position=new C.CallbackProperty(()=>{const fixed=part.kind.startsWith('cargo')&&run.parcelCenter,h=fixed?run.parcelHeading:run.heading,x=part.offset[0],y=part.offset[1],z=fixed?part.offset[2]+1.15:mapPartHeight(part,run.deliveryPose);const local=new C.Cartesian3(x*Math.cos(h)+y*Math.sin(h),y*Math.cos(h)-x*Math.sin(h),z);return C.Matrix4.multiplyByPoint(C.Transforms.eastNorthUpToFixedFrame(fixed||run.center),local,new C.Cartesian3())},false);
      const orientation=new C.CallbackProperty(()=>{const fixed=part.kind.startsWith('cargo')&&run.parcelCenter;return C.Transforms.headingPitchRollQuaternion(fixed||run.center,new C.HeadingPitchRoll((fixed?run.parcelHeading:run.heading)+(part.yaw||0)+(part.spin?run.spin+(part.phase||0):0),part.pitch||0,part.roll||0))},false);
      const color=C.Color.fromCssColorString(part.color),size=part.size;
      const geometry=part.shape==='ellipsoid'?{ellipsoid:{radii:new C.Cartesian3(size[0]/2,size[1]/2,size[2]/2),material:color}}:['rotor','motor-band'].includes(part.kind)?{cylinder:{length:size[2],topRadius:size[0]/2,bottomRadius:size[1]/2,material:color}}:{box:{dimensions:new C.Cartesian3(...size),material:color}};
      const shape=geometry.ellipsoid||geometry.cylinder||geometry.box;
      shape.show=new C.CallbackProperty(()=>(aircraftVisible(run)||run.parcelCenter&&part.kind.startsWith('cargo'))&&(part.kind!=='cable'||run.phase!=='complete'&&!run.parcelCenter),false);
      if(part.kind==='cable')geometry.box.dimensions=new C.CallbackProperty(()=>new C.Cartesian3(size[0],size[1],run.deliveryPose?.cableLength??size[2]),false);
      simulationEntities.push(viewer.entities.add({position,orientation,...geometry}));
    }
  }
  function applyMapCamera(){
    if(mapCamera.view==='follow'&&simulation)viewer.trackedEntity=mapTracked==='two'&&simulation.second?simulation.second.drone:simulation.drone;
    else{
      viewer.trackedEntity=undefined;
      if(mapCamera.view==='wire'&&simulation){const p=simulation.route.obstacle;viewer.camera.lookAt(C.Cartesian3.fromDegrees(p.longitude,p.latitude,180),new C.HeadingPitchRange(simulation.wireHeading,C.Math.toRadians(-12),mapWireRange(straightDistance(origin,destination))));viewer.camera.lookAtTransform(C.Matrix4.IDENTITY)}
      else if(simulation&&origin&&destination){const points=[origin,destination,...(simulation.second?.end?[simulation.second.end]:[])],lat=(Math.min(...points.map(p=>p.latitude))+Math.max(...points.map(p=>p.latitude)))/2,lon=(Math.min(...points.map(p=>p.longitude))+Math.max(...points.map(p=>p.longitude)))/2,center={latitude:lat,longitude:lon},radius=Math.max(...points.map(p=>straightDistance(center,p)));viewer.camera.lookAt(C.Cartesian3.fromDegrees(lon,lat,180),new C.HeadingPitchRange(0,C.Math.toRadians(-65),Math.max(700,radius*4)));viewer.camera.lookAtTransform(C.Matrix4.IDENTITY)}
      else if(overview){if(overview.facility)showFacilityOverview(overview);else viewer.camera.setView({destination:C.Cartesian3.fromDegrees(overview.longitude,overview.latitude,1700),orientation:{heading:0,pitch:C.Math.toRadians(-48),roll:0}})}
    }
    notifyMapCamera();
  }
  let viewLocked=false;
  function setViewLock(locked){viewLocked=!!locked}
  function updateTrackingView(){
    if(viewLocked)return;
    if(!simulation)return;
    const tracking=viewer.trackedEntity;
    for(const run of [simulation,simulation.second].filter(Boolean)){
      const offset=mapFollowOffset(container.clientWidth,container.clientHeight,['delivery','complete'].includes(run.phase));
      const previous=run.drone.viewFrom?.getValue(viewer.clock.currentTime);if(previous&&previous.x===offset.x&&previous.y===offset.y&&previous.z===offset.z)continue;
      if(tracking===run.drone)viewer.trackedEntity=undefined;
      run.drone.viewFrom=new C.Cartesian3(offset.x,offset.y,offset.z);
      if(tracking===run.drone)viewer.trackedEntity=tracking;
    }
  }
  function chooseCamera(view,target='one',programmatic=false){if(view==='follow'&&(!simulation||target==='two'&&!aircraftVisible(simulation.second))||view==='wire'&&simulation?.phase!=='obstacle')return;if(programmatic)cameraOwnMove=true;else viewTouched=true;if(view==='follow')mapTracked=target;mapCamera=selectMapCamera(mapCamera,view);applyMapCamera()}
  function allowPrimaryMovement(run,next){
    const second=run.second;
    if(!aircraftVisible(second)||!virtualAircraftApproach(run.center,next,second.center))return true;
    if(second.phase!=='home'){stopSecond(run,second.parcelCenter?'荷下ろし後、仮想の2機が接近するため帰還を中止しました':'仮想の2機が接近するため中止しました');return true}
    run.phase=run.phase==='delivery'?'surface-unavailable':run.phase==='detour'?'detour-unavailable':'direct-unavailable';simulationFrame=null;
    onSimulation({phase:run.phase,message:'帰還済みの仮想機に接近するため1号機を中止しました'});return false;
  }
  function animateSimulation(path,duration,next){
    const run=simulation;let elapsed=0,last=null,lastMetric=-Infinity;
    const step=now=>{if(simulation!==run)return;const dt=last===null?0:Math.min(100,Math.max(0,now-last));elapsed+=dt;last=now;const progress=Math.min(1,elapsed/duration),p=mapSimulationPosition(path,progress),q=mapSimulationPosition(path,Math.min(1,progress+.001)),nextCenter=C.Cartesian3.fromDegrees(p.longitude,p.latitude,180);if(!allowPrimaryMovement(run,nextCenter))return;if(progress<1){const target=Math.atan2((q.longitude-p.longitude)*Math.cos(p.latitude*Math.PI/180),q.latitude-p.latitude);run.heading=smoothHeading(run.heading,target,dt/1000)}run.spin=now*.018;run.center=nextCenter;run.drone.position=run.center;if(now-lastMetric>=250||progress===1){onProgress(straightDistance(p,destination));lastMetric=now}viewer.scene.requestRender();
      if(elapsed<duration)simulationFrame=requestAnimationFrame(step);else{simulationFrame=null;run.phase=next;if(next==='obstacle'){showCandidates();const nextCamera=mapObstacleCamera(mapCamera);if(nextCamera.view!==mapCamera.view){mapCamera=nextCamera;applyMapCamera()}onSimulation({phase:next});inspectRouteModels({automatic:true})}else if(next==='surface-check')checkDeliverySurface(run);else onSimulation({phase:next})}};
    simulationFrame=requestAnimationFrame(step);
  }
  function showCandidates(){
    for(const [side,color] of [['A',C.Color.CYAN],['B',C.Color.MAGENTA]]){
      const route=mapSimulationPath(origin,destination,side),p=route.detour[1];
      const material=C.PolylineDashMaterialProperty?new C.PolylineDashMaterialProperty({color,dashLength:14}):color;
      const line=viewer.entities.add({polyline:{positions:C.Cartesian3.fromDegreesArrayHeights(route.detour.flatMap(q=>[q.longitude,q.latitude,180])),width:3,material,arcType:C.ArcType.NONE}});
      const label=viewer.entities.add({position:C.Cartesian3.fromDegrees(p.longitude,p.latitude,180),label:{text:`仮想案 ${side}・点間未確認`,font:'bold 16px sans-serif',fillColor:color,showBackground:true,disableDepthTestDistance:Number.POSITIVE_INFINITY}});simulationEntities.push(line,label);simulation.candidates.push(line,label);
    }
  }
  function continueSimulation(side='A'){
    if(!simulation||simulation.phase!=='obstacle'||simulation.probeController||evidence.buildings!=='available'||!canReplayMapRoute(simulation.probes,side))return;const route=mapSimulationPath(origin,destination,side);for(const entity of [...simulation.candidates,...simulation.probeMarkers])viewer.entities.remove(entity);simulation.candidates=[];simulation.probeMarkers=[];const detourColor=side==='A'?C.Color.CYAN:C.Color.MAGENTA,material=C.PolylineDashMaterialProperty?new C.PolylineDashMaterialProperty({color:detourColor,dashLength:14}):detourColor;const detourLine=viewer.entities.add({polyline:{positions:C.Cartesian3.fromDegreesArrayHeights(route.detour.flatMap(p=>[p.longitude,p.latitude,180])),width:4,material,arcType:C.ArcType.NONE}});const detourMid=route.detour[1];const detourLabel=viewer.entities.add({position:C.Cartesian3.fromDegrees(detourMid.longitude,detourMid.latitude,180),label:{text:`選択中 仮想案${side}・点間未確認`,font:'bold 15px sans-serif',fillColor:detourColor,showBackground:true,pixelOffset:new C.Cartesian2(-45,-28),disableDepthTestDistance:Number.POSITIVE_INFINITY}});simulationEntities.push(detourLine,detourLabel);simulation.detourLine=detourLine;simulation.detourLabel=detourLabel;simulation.phase='detour';onSimulation({phase:'detour',side});animateSimulation(route.detour,9000,'surface-check');
  }
  async function inspectRouteModels({automatic=false}={}){
    const run=simulation;if(!run||run.phase!=='obstacle'||run.probeController)return;
    if(!currentTiles||evidence.buildings!=='available'||!viewer.scene.sampleHeightSupported){onRouteProbe({state:'error',message:'3D建物モデルの点検を開始できません'});return}
    onSceneChanged();for(const marker of run.probeMarkers)viewer.entities.remove(marker);run.probeMarkers=[];run.probes=null;
    const version=revision,tiles=currentTiles,controller=new AbortController();run.probeController=controller;onRouteProbe({state:'checking',automatic});for(const entity of run.candidates)entity.show=false;
    try{
      if(!tiles||evidence.buildings!=='available'||!viewer.scene.sampleHeightSupported)throw new Error('3D建物モデルの点検を開始できません');
      const a=routeSamplePoints(mapSimulationPath(origin,destination,'A').detour),b=routeSamplePoints(mapSimulationPath(origin,destination,'B').detour),points=[...a.points,...b.points],positions=points.map(p=>C.Cartographic.fromDegrees(p.longitude,p.latitude));
      const heights=await withSamplingLock(run,()=>{const exclude=[...viewer.entities.values,viewer.scene.globe];return readRouteSamples(async()=>{const result=await viewer.scene.sampleHeightMostDetailed(positions,exclude,5);return result.map(p=>p?.height)},points.length,{signal:controller.signal,isModelAvailable:()=>evidence.buildings==='available'});},controller.signal);
      if(simulation!==run||revision!==version||currentTiles!==tiles)return;
      const A={...routeSampleReport(heights.slice(0,a.points.length)),total:a.points.length,maxGap:Math.ceil(a.maxGap)},B={...routeSampleReport(heights.slice(a.points.length)),total:b.points.length,maxGap:Math.ceil(b.maxGap)};run.probes={A,B};run.probePoints={A:a.points,B:b.points};
      addProbeMarkers(run,points,heights);for(const entity of run.candidates)entity.show=true;
      onRouteProbe({state:'done',reports:run.probes});
    }catch(error){if(simulation===run&&revision===version)onRouteProbe({state:'error',message:error.message})}
    finally{for(const entity of run.candidates)entity.show=true;if(run.probeController===controller){run.probeController=null;if(simulation===run)onRouteProbe({state:'ready',reports:run.probes})}}
  }

  function addProbeMarkers(run,points,heights){
    for(const mark of routeSampleMarkers(points,heights)){
      const p=mark.point,graphics=mark.state==='observed'
        ?{point:{pixelSize:4,color:C.Color.WHITE,outlineColor:C.Color.BLACK,outlineWidth:1,disableDepthTestDistance:Number.POSITIVE_INFINITY}}
        :{label:{text:mark.state==='high'?'!':'?',font:'bold 16px sans-serif',fillColor:mark.state==='high'?C.Color.RED:C.Color.ORANGE,showBackground:true,disableDepthTestDistance:Number.POSITIVE_INFINITY}};
      const entity=viewer.entities.add({position:C.Cartesian3.fromDegrees(p.longitude,p.latitude,180),...graphics});simulationEntities.push(entity);run.probeMarkers.push(entity);
    }
  }
  async function reinspectDetourSide(side){
    const run=simulation;
    if(!run||run.phase!=='obstacle'||run.probeController)throw new Error('再点検できる状態ではありません');
    if(!['A','B'].includes(side))throw new Error('仮想案が不正です');
    if(!currentTiles||evidence.buildings!=='available'||!viewer.scene.sampleHeightSupported)throw new Error('3D建物モデルが利用できません');
    for(const marker of run.probeMarkers)viewer.entities.remove(marker);run.probeMarkers=[];
    for(const entity of run.candidates)entity.show=false;
    const version=revision,tiles=currentTiles,controller=new AbortController();run.probeController=controller;
    try{
      const plan=routeSamplePoints(mapSimulationPath(origin,destination,side).detour);
      const positions=plan.points.map(q=>C.Cartographic.fromDegrees(q.longitude,q.latitude));
      const heights=await withSamplingLock(run,()=>{const exclude=[...viewer.entities.values,viewer.scene.globe];return readRouteSamples(async()=>{const result=await viewer.scene.sampleHeightMostDetailed(positions,exclude,5);return result.map(q=>q?.height)},plan.points.length,{signal:controller.signal,isModelAvailable:()=>evidence.buildings==='available'});},controller.signal);
      if(simulation!==run||revision!==version||currentTiles!==tiles)throw new Error('点検中に地図が変わりました');
      const fresh={...routeSampleReport(heights),total:plan.points.length,maxGap:Math.ceil(plan.maxGap)};
      const keep=run.probes&&!run.probes.stale?{A:run.probes.A,B:run.probes.B}:{};
      run.probes={...keep,[side]:fresh};run.probePoints={...(run.probePoints||{}),[side]:plan.points};
      addProbeMarkers(run,plan.points,heights);for(const entity of run.candidates)entity.show=true;
      onRouteProbe({state:'ready',reports:run.probes});
      return fresh;
    }finally{
      for(const entity of run.candidates)entity.show=true;
      if(run.probeController===controller)run.probeController=null;
    }
  }
  function getSharedHazards(){
    const out=[],run=simulation;if(!run)return out;
    const push=(points,indices,source)=>{if(!Array.isArray(points))return;for(const index of indices||[]){const p=points[index];if(p&&Number.isFinite(p.latitude)&&Number.isFinite(p.longitude))out.push({latitude:p.latitude,longitude:p.longitude,source})}};
    if(run.departureReport)push(run.departurePoints,run.departureReport.blockedIndices,'departure');
    for(const side of ['A','B']){const r=run.probes?.[side];if(r&&!run.probes.stale)push(run.probePoints?.[side],r.blockedIndices,side)}
    if(run.second?.report)push(run.second.routePoints,run.second.report.blockedIndices,'second');
    return out;
  }
  function stopSecondFlight(reason){
    if(!simulation)return false;
    stopSecond(simulation,reason||'共有した点検結果のため2号機を中止しました');
    return true;
  }
  async function checkDeliverySurface(run){
    onSimulation({phase:'surface-check'});const tiles=currentTiles,version=revision,controller=new AbortController();run.surfaceController=controller;
    try{
      if(!tiles||evidence.buildings!=='available'||!viewer.scene.sampleHeightSupported)throw new Error('地図モデルの高さを確認できません');
      const position=C.Cartographic.fromDegrees(destination.longitude,destination.latitude);
      const height=await withSamplingLock(run,()=>{const exclude=[...viewer.entities.values,viewer.scene.globe];return readMapSurface(async()=>{const points=await viewer.scene.sampleHeightMostDetailed([position],exclude,.3);return points?.[0]?.height},{signal:controller.signal,isModelAvailable:()=>evidence.buildings==='available'});},controller.signal);
      if(simulation!==run||version!==revision||tiles!==currentTiles)return;
      run.surface=height;run.phase='delivery';updateTrackingView();onSimulation({phase:'delivery',height});animateDelivery(run);
    }catch(error){if(simulation===run&&version===revision&&run.phase==='surface-check'){run.phase='surface-unavailable';onSimulation({phase:'surface-unavailable',message:error.message})}}
    finally{if(run.surfaceController===controller)run.surfaceController=null}
  }
  function animateDelivery(run){
    let elapsed=0,last=null;const step=now=>{if(simulation!==run)return;if(last!==null)elapsed+=Math.min(100,Math.max(0,now-last));last=now;const p=Math.min(1,elapsed/8000),pose=mapDeliveryPose(run.surface,p),nextCenter=C.Cartesian3.fromDegrees(destination.longitude,destination.latitude,pose.droneHeight);if(!allowPrimaryMovement(run,nextCenter))return;run.deliveryPose=pose;run.spin=now*.018;run.center=nextCenter;run.drone.position=run.center;viewer.scene.requestRender();
      if(p<1)simulationFrame=requestAnimationFrame(step);else{simulationFrame=null;run.phase='complete';onSimulation({phase:'complete',height:run.surface})}};simulationFrame=requestAnimationFrame(step);
  }
  return {setArea,showRain,setBuildingMode(mode){if(!['detailed','highest','simple'].includes(mode)||mode===buildingMode)return true;if(mapFlightActive())return false;buildingMode=mode;return setArea(currentArea)},selectShelter,setFleetPreview,setWaterScene,focusShelter,focusObservation,focusPilotRiverStation,capture,isViewCurrent,setViewLock,mapFlightActive,setLod2LightRequested,lod2LightState,clearViewTouched,isViewTouched,simulate,startLargeFleet,stopLargeFleet,resolveLargeFleetDiversion,selectLargeFleet:id=>largeFleetMap?.select(id),followLargeFleet:enabled=>largeFleetMap?.setFollow(enabled),refreshFleetLanguage:()=>largeFleetMap?.refreshLanguage(),continueSimulation,inspectRouteModels,reinspectDetourSide,getSharedHazards,stopSecondFlight,stopSimulation,chooseCamera,cameraMode:()=>mapCamera.view,pause(){stopSimulation();viewer.useDefaultRenderLoop=false},resume(){viewer.useDefaultRenderLoop=true;viewer.resize();viewer.scene.requestRender()},chooseOrigin(){viewTouched=true;onSceneChanged();stopSimulation();choosingOrigin=true;container.setAttribute?.('tabindex','0');if(container.focus)container.focus({preventScroll:true});onOrigin('selecting');onSimulation({phase:'needs-points'})},showBase(mode){if(!['standard','photo','plateau'].includes(mode))return;onSceneChanged();baseMode=mode;photoLayer.show=mode!=='standard';plateauLayer.show=mode==='plateau';baseStatus();viewer.scene.requestRender()},showRisk(show){onSceneChanged();riskLayer.show=show;viewer.scene.requestRender()},setRiskOpacity(value){if(!Number.isFinite(value)||value<10||value>80)return false;onSceneChanged();riskLayer.alpha=value/100;viewer.scene.requestRender();return true},resize(){viewer.resize();viewer.scene.requestRender()},destroy(){for(const type of ['pointerdown','wheel','keydown'])container.removeEventListener(type,touchView);container.removeEventListener('keydown',originKeys);viewer.scene.preRender.removeEventListener(rainVisibility);document.removeEventListener('visibilitychange',rainVisibility);document.removeEventListener('visibilitychange',weatherVisibility);rainEnabled=false;rainVersion++;clearRain();stopSimulation();revision++;weatherMonitor?.stop();observationMonitor.stop();clearObservationView();resizeObserver.disconnect();if(weatherTimer!==null)clearTimeout(weatherTimer);if(observationTimer!==null)clearTimeout(observationTimer);shelterRequest?.abort();handler.destroy();viewer.destroy()}};
}
