import {positionAt, progressBeforeReplan, makeCity, mapCropBoxes, fitImage, isValidRoute} from './mission.mjs';
import {bulletinRetrievalAge} from './readiness.mjs';
import {decodePilotEvidencePreview} from './readiness.mjs';
import {createDetourReinspection} from './readiness.mjs';
import {parseZonedTimestamp} from './geo-data.mjs';
import {consultFacilityReports,consultFloodBulletin,consultBulletinIssueAge} from './readiness.mjs';
import {inspectLocalHistory,reconcileLocalHistory} from './readiness.mjs';
import {createPhotoMetadata} from './readiness.mjs';
import {appendConsultAudit,removeConsultAudit,consultImageDigest,finishUncertainConsultAudit} from './readiness.mjs';
import {mapObservationContext} from './readiness.mjs';
import {recordConsultReview} from './readiness.mjs';
import {recordExerciseObservation,removeExerciseRecord} from './readiness.mjs';
import {requestScenarioDepths,compareScenarioRanges} from './gsi-scenario.mjs';
import {mountInfrastructureReports} from './infrastructure-reports-ui.mjs';
import {consultInfrastructureReports} from './infrastructure-reports.mjs';
import {appendFacilityReceiptFollowup} from './readiness.mjs';
import {createPhotoReview,decodePhotoReviews,appendPhotoReview,photoReviewMatchesFile} from './readiness.mjs';
import {appendLargeFleetRecord,recordFleetComparisonReview} from './readiness.mjs';
import {runFleetBenchmark,benchmarkCases,benchmarkBoundaryCases,benchmarkCaseFromHistory} from './fleet-benchmark.mjs';
import {HISTORICAL_REVIEW_IMAGES,createHistoricalReview,decodeHistoricalReviews,appendHistoricalReview} from './readiness.mjs';
import {configureSpeech,trackSpeech} from './speech.mjs';
import {readPlanStream} from './plan-stream.mjs';
import {createWorld} from './scene.mjs';
import {summarizeStoppedReasons} from './fleet-engine.mjs';
import {fleetPresentation,translateInterfaceText,resolveInterfaceLanguage,decisionCardView,createConsultAudit,finishConsultAudit,decodeConsultAudits,consultEvidenceRefs,validateConsultCitations,consultFieldReports,createPhotoScan,photoScanDimensions,createFacilityReport,facilityReportState,facilityReportDifferences,decodeFacilityReports,appendFacilityReport,createFacilityReceipt,decodeFacilityReceipts,appendFacilityReceipt,createFloodFieldReport,appendFloodFieldReport,buildFloodComparison,buildPilotEvidenceLedger,createPilotEvidenceSnapshot,decodeScenarioSnapshot,pilotFacilityKey,validatePilotFacilityRecord,createRiskReview,decodeRiskReviews,appendRiskReview,riskReviewState,updateLocalHistory,createExerciseRecord,decodeExerciseRecords,summarizeExerciseRecords,appendExerciseRecord} from './readiness.mjs';
import {initialCamera,beginFlight,selectCamera,deliveryCamera} from './camera.mjs';
import {requestDraft,simulationManifest,suggestRequest,suggestShelters,sourceNotice,sourceOverview,mapFloodContext,mapConsultHistoryContext,mapMissionSteps,mapMissionDistance,mapMissionEvidence,mapRouteSummary,fleetStatus,fleetPosition,createBrief,createMapScan,createMapConsultation,createFacilityFloodTracker,detourEvidencePayload,summarizeDetourValidation,detourTeamRecord,detourRecordText,pastDetourNote,reinspectVerdict,detourRelevanceForSecond,hazardNearPointsM,lod2LightStatus,describeViewFrameChange} from './readiness.mjs';
import {DATA,areaByCode,historicalFloodCase,historicalGroundReference,historicalMabiFloodCase,slippyTilePoint,riverPilotStations,riverStationDistance,floodBulletinStationContext,validateRiverPilotNote,createRiverLogEntry,decodeRiverLog,appendRiverLog,riverLogState,floodPixelFor,floodDepthFromPixel,filterShelters,nearbyShelters,officialMapLinks,jmaWarningLink,canReplayMapRoute,secondFleetCandidates,mapSimulationPath,routeSamplePoints,floodForecastAreaRelation,floodBulletinWaterValues} from './geo-data.mjs';
const $ = id => document.getElementById(id);
function riverDatumLabel(value,en=false){const labels=en?{unknown:'unknown',gauge_zero:'station gauge zero',TP:'T.P.',AP:'A.P.',other:'other'}:{unknown:'不明',gauge_zero:'水位標の基準面',TP:'T.P.',AP:'A.P.',other:'その他'};return labels[value]||labels.unknown}
const canvas = $('scene'), overlay=$('detection-overlay'), ctx=overlay.getContext('2d');
let realMode=false,realMap=null,mapPromise=null,areaCatalog=null,texturedAreas=new Set(),activeArea='13118',mapEvidenceIds=[],mapReviewVersion=0,mapReviewBusy=false,mapReviewController=null,draftShelter='',draftAddress='',shelterList=[],shelterChoice=null,shelterState='loading',mapScan=null,scanFrame=null,mapConsultation=null,consultFrame=null,mapCapability=null,mapCapabilityPromise=null,mapSound=false,mapSubtitleTimer=null,mapHistory=[];
let mapSourceEvidence={},mapBuildingMode='detailed',mapAreaState='loading',mapScanBusy=false,observationAvailable=false,observationEvidence=null,facilitySelectionVersion=0,consultObservationConsent=null,consultObservationCleared=false,syncGsiScenario=()=>{};
let consultAuditPending=null,consultCaptureAt=null,consultImageData=null,syncPhotoControls=()=>{},pendingConsultAudit=null,consultAuditSaving=false,consultObservationSnapshot=null,mapObservationCapability=false,mapObservationReferenceKindCapability=false,mapObservationAccumulatedRainCapability=false,mapObservationTotalsOnlyCapability=false,consultFieldSnapshot=null,mapFieldReportsCapability=false,consultFacilitySnapshot=null,mapFacilityReportsCapability=false;
const consultReportConsents={field:null,facility:null,infrastructure:null};
let consultInfrastructureSnapshot=null,mapInfrastructureCapability=false;
let consultMayHaveReachedMeta=false,consultUncertainKind=null;
let consultBulletinCandidate=null,consultBulletinVersion=0,consultBulletinSnapshot=null,mapBulletinCapability=false,consultBulletinTimer=null;
let floodLookup=null,facilityFlood=null,fleetFlood=null,mapFloodCapability=false,mapRefsCapability=false,mapFleetPlanAvailable=false,mapFleetEvidenceV2=false,mapFleetEvidenceV3=false,mapConsultBusy=false,consultContext=null;
async function readFacilityFlood(point,signal){
  const {z,x,y,px,py}=floodPixelFor(point),url=DATA.floodRisk.replace('{z}',z).replace('{x}',x).replace('{y}',y);
  const response=await fetch(url,{signal:AbortSignal.any([signal,AbortSignal.timeout(12000)])});
  if(!response.ok)throw new Error('想定図を取得できません');
  const image=await createImageBitmap(await response.blob());
  try{if(image.width!==256||image.height!==256)throw new Error('想定図の形式が不正です');const sample=document.createElement('canvas');sample.width=sample.height=1;const ctx=sample.getContext('2d');ctx.drawImage(image,px,py,1,1,0,0,1,1);return floodDepthFromPixel(ctx.getImageData(0,0,1,1).data)}finally{image.close()}
}
function renderFleetFlood(){
  const describe=value=>value?.state==='loading'?'確認中':value?.state==='ready'?`想定浸水深 ${value.depth}`:value?.state==='error'?'取得できず':value?.state==='unknown'?'着色を判別できず':'未確認';
  const primary=facilityFlood?.shelter===draftShelter&&facilityFlood?.address===draftAddress?facilityFlood:null;
  $('fleet-flood-primary').textContent=`${draftShelter||'施設未選択'}：${describe(primary)}`;
  $('fleet-flood-second').textContent=`${fleetFlood?.name||'施設未選択'}：${describe(fleetFlood)}`;
  $('fleet-flood-retry').hidden=!['error','unknown'].includes(fleetFlood?.state);
}
const fleetFloodTracker=createFacilityFloodTracker({read:readFacilityFlood,onChange:value=>{fleetFlood=value;renderFleetFlood()}});
function renderConsultFlood(){const value=mapFloodContext(facilityFlood,draftShelter,draftAddress);$('consult-flood-input').textContent=mapCapability===null?'サーバーの対応状況を確認中です。':mapCapability===false?'サーバーの対応状況を確認できません。':!mapFloodCapability?'このサーバーでは施設座標の洪水想定をMuseへ送りません。':facilityFlood?.state==='loading'?'施設座標の洪水想定を確認中です。':`送信する施設座標の洪水想定：${value||'未確認'}（現在の浸水ではありません）`}
async function showShelterFlood(point){
  floodLookup?.abort();const controller=new AbortController();floodLookup=controller;
  const output=$('shelter-flood-status');
  facilityFlood=point?{shelter:point.name,address:point.address,state:'loading'}:null;if(mapFloodCapability)mapConsultation?.invalidate();renderConsultFlood();renderFleetFlood();syncConsult();
  if(!point){output.textContent='施設を選ぶと公開座標の想定図を確認します。';return}
  output.textContent='選択施設の想定図を確認中です。';
  try{
    const depth=await readFacilityFlood(point,controller.signal);
    if(controller.signal.aborted||floodLookup!==controller)return;
    const before=mapFloodContext(facilityFlood,draftShelter,draftAddress);facilityFlood={shelter:point.name,address:point.address,state:depth?'ready':'unknown',depth,checkedAt:new Date().toISOString()};if(mapFloodCapability&&before!==mapFloodContext(facilityFlood,draftShelter,draftAddress))mapConsultation?.invalidate();renderConsultFlood();renderFleetFlood();syncConsult();output.textContent=depth?`公開座標の着色：想定浸水深 ${depth}（想定最大規模）`:'この座標の着色は判別できません。浸水しないことを示しません。';
  }catch{if(!controller.signal.aborted&&floodLookup===controller){facilityFlood={shelter:point.name,address:point.address,state:'error',checkedAt:new Date().toISOString()};renderConsultFlood();renderFleetFlood();syncConsult();output.textContent='想定図を取得・判別できません。浸水しないことを示しません。'}}
}
function renderSourceOverview(){const list=$('source-overview-list');list.replaceChildren();for(const row of sourceOverview(mapSourceEvidence,$('risk-toggle').checked)){const item=document.createElement('li'),label=document.createElement('span'),value=document.createElement('strong');label.textContent=row.label;value.textContent=row.value;item.dataset.state=row.state;item.append(label,value);list.append(item)}}
let W=0,H=0, cameraX=0, sound=false, mission=null, recording=null, real=false, boxes=[], voiceEpoch=0, voicePending=false, voiceAbort=null, voiceTimer=null, statusReady=false, viewVersion=0;
let mapDepartureEvidence=null,mapDetourEvidence=null,mapFleetActive=false;
let secondChoice=null,mapPlanChoiceProvenance='unknown',mapPlanCandidate=null,mapSpeechVersion=0;
function mapPlanRecordedSource(provenance){return provenance==='muse'?'Muse':provenance==='fixture'?'fixture':'unknown'}
function mapPlanSourceLabel(provenance){return provenance==='muse'?'Museの回答（サーバーの申告）':provenance==='fixture'?'試験用の回答':'回答の出所は不明'}
let mapPlanAvailable=false,mapPlanEvidenceCapable=false,mapPlanPhase='needs-points',mapPlanController=null,mapPlanVersion=0,mapPlanChoice=null,mapPlanHistory=[],mapTeamLog=[],mapTeamPending=null,mapTeamSharedKey='',mapPlanAutoKey=null,mapTeamExplained=false,mapTeamFleetSaved='',mapTeamSaveGen=0,mapTeamSavedKey='',mapTeamSavingOne=null,mapTeamUnsaved=[],mapOriginChosen=false,mapOriginSelecting=false,mapOriginPoint=null,mapProbeBusy=false,mapProbeReports=null,mapFetchStartedAt=null,mapProbeInspectedAt=null,mapTeamShareEvents=[],mapPlanCameraGuard=false;
$('start').disabled=true;
fetch('/api/status',{signal:AbortSignal.timeout(5000)}).then(r=>{if(!r.ok)throw new Error('状態を確認できません');return r.json()}).then(data=>{if(data.enabled){real=true;$('mode-badge').textContent='Muse接続設定あり';$('status-detail').textContent='Muse接続設定あり・疎通未確認';$('voice-note').textContent='音声ボタンを押して録音。もう一度押すか20秒後に送信します。'}}).catch(()=>{status('試作モードで待機中','接続状態を確認できないため、試作のみ利用できます')}).finally(()=>{statusReady=true;if(!mission&&!voicePending)$('start').disabled=false;syncReview();syncScan();syncConsult();syncPhotoControls()});
async function api(name,data,signal,envelope=false){const response=await fetch('/api/'+name,{method:'POST',signal,headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const body=await response.json();if(!response.ok){const error=new Error(body.error||'接続に失敗しました');if(name==='map-consult'&&response.status===400&&body.code==='input_rejected')error.code='input_rejected';throw error}return envelope?body:body.result}
let benchmarkResult=null,benchmarkController=null,benchmarkReviews={},benchmarkArea=null;
function renderBenchmark(){
 const target=$('pilot-benchmark-results'),en=document.documentElement.lang==='en';target.replaceChildren();if(!benchmarkResult)return;
 const names=en?{'both-eligible':'Both meet simulated checks','a-unknown':'A has an unknown point','both-ineligible':'Both have insufficient checks','at-gap-limit':'A inspection gap is 29 m','above-gap-limit':'A inspection gap exceeds 29 m','missing-distance':'A distance is unknown','no-hazard-clearance':'A does not avoid the obstacle; B distance unknown','blocked-and-unknown':'Blocked points and unknown points','zero-samples':'A has zero inspected points','both-eligible-b-shorter':'Both eligible; B is shorter','saved-run':'Saved simulation evidence'}:{'both-eligible':'両方が仮想点検の条件を満たす','a-unknown':'Aに不明な点がある','both-ineligible':'どちらも仮想点検の条件を満たさない','at-gap-limit':'Aの点検間隔が29 m','above-gap-limit':'Aの点検間隔が29 mを超える','missing-distance':'Aの距離が不明','no-hazard-clearance':'Aは障害を回避せず、Bの距離は不明','blocked-and-unknown':'障害ありと不明な点','zero-samples':'Aの点検点が0件','both-eligible-b-shorter':'両案が条件を満たしBの距離が短い','saved-run':'保存した仮想配送の点検結果'};
 const choice=value=>value==='none'?(en?'No candidate':'候補なし'):value||'—';
 if(benchmarkResult.source?.kind==='saved-simulation'){const source=document.createElement('p'),s=benchmarkResult.source;source.textContent=en?`Saved simulation in ${s.area}, completed ${new Date(s.finishedAt).toLocaleString('en')}, attempt ${s.attempt??'unknown'}. Historical, unverified data; not current conditions.`:`保存済みの仮想配送：${s.area}、終了 ${new Date(s.finishedAt).toLocaleString('ja-JP')}、${s.attempt?`${s.attempt}回目`:'回数不明'}の点検。過去の未検証データであり、現在の状況ではありません。`;target.append(source)}
 for(const item of benchmarkResult.items){
  const section=document.createElement('section'),title=document.createElement('h4'),description=document.createElement('p'),details=document.createElement('details'),summary=document.createElement('summary'),data=document.createElement('ul'),label=document.createElement('label'),select=document.createElement('select');
  title.textContent=names[item.id]||item.id;const m=item.muse,source=m.provenance==='muse'?(en?'Muse (server-reported)':'Muse（サーバー申告）'):m.provenance==='fixture'?(en?'Test response':'試験用の回答'):(en?'Response source unknown':'回答の出所は不明');
  description.textContent=en?`Rule: ${choice(item.baseline.choice)} (${item.baseline.elapsedMs.toFixed(2)} ms). ${source}: ${m.state==='error'?'failed: '+m.error:choice(m.choice)+' / '+m.reason+(m.state==='rejected'?' (fails the simulated check)':'')}. Response time including network: ${(m.elapsedMs/1000).toFixed(2)} s.`:`定型ルール：${choice(item.baseline.choice)}（計算 ${item.baseline.elapsedMs.toFixed(2)}ミリ秒）。${source}：${m.state==='error'?'失敗：'+m.error:choice(m.choice)+'／'+m.reason+(m.state==='rejected'?'（仮想点検の条件に不適合）':'')}。回答所要時間（通信を含む）：${(m.elapsedMs/1000).toFixed(2)}秒。`;
  summary.textContent=en?'View common input':'共通の入力を見る';for(const side of ['A','B']){const c=item.evidence.candidates[side],d=item.evidence.distances[side],li=document.createElement('li');li.textContent=en?`${side}: ${c.observed}/${c.total} points checked; unknown ${c.unknown}, blocked ${c.blocked}; largest gap ${c.maxGap} m; virtual obstacle avoided: ${c.avoidsHazard?'yes':'no'}; total simulated ground distance ${d?d.totalM+' m':'unknown'}.`:`${side}：点検 ${c.observed}/${c.total}点、不明 ${c.unknown}点、障害あり ${c.blocked}点、最大間隔 ${c.maxGap} m、仮想障害の回避 ${c.avoidsHazard?'あり':'なし'}、地表距離の概算 ${d?d.totalM+' m':'不明'}。`;data.append(li)}details.append(summary,data);
  const review=benchmarkReviews[item.id]||{choice:'',reason:''};benchmarkReviews[item.id]=review;
  label.textContent=en?'Your assessment: ':'あなたの判断：';for(const [value,ja,english] of [['','未記入','Not reviewed'],['A','Aを参考','Consider A'],['B','Bを参考','Consider B'],['none','候補なし','No candidate'],['undecided','判断できない','Unable to decide']]){const option=document.createElement('option');option.value=value;option.textContent=en?english:ja;select.append(option)}select.value=review.choice;select.addEventListener('change',()=>{review.choice=select.value});label.append(select);
  const reasonLabel=document.createElement('label'),reason=document.createElement('select');reasonLabel.textContent=en?'Reason or uncertainty: ':'理由・不明点：';for(const [value,ja,english] of [['','未記入','Not specified'],['missing_data','点検情報が不足','Missing inspection data'],['conflicting_data','情報に食い違い','Conflicting information'],['needs_review','追加確認が必要','Further review needed'],['other','その他','Other']]){const option=document.createElement('option');option.value=value;option.textContent=en?english:ja;reason.append(option)}reason.value=review.reason;reason.addEventListener('change',()=>{review.reason=reason.value});reasonLabel.append(reason);section.append(title,description,details,label,reasonLabel);target.append(section);
 }
}
$('pilot-benchmark-start')?.addEventListener('click',async()=>{
 if(benchmarkController)return;const en=document.documentElement.lang==='en',status=$('pilot-benchmark-status');
 if(!real){status.textContent=en?'Muse is not configured on this server.':'このサーバーではMuse接続を利用できません。';return}
 let selected;try{if($('pilot-benchmark-source').value==='saved'){if(mapAreaState!=='ready')throw new Error('地域の読み込み完了を待ってください');const code=typeof activeArea==='string'?activeArea:activeArea?.cityCode||activeArea?.code;selected=benchmarkCaseFromHistory(localStorage.getItem('muse-large-fleet-history-v1'),areaByCode(code).area);benchmarkArea=code}else if($('pilot-benchmark-source').value==='boundary'){selected={source:{kind:'boundary-fixtures'},cases:benchmarkBoundaryCases()};benchmarkArea=null}else{selected={source:{kind:'fixed-fixtures'},cases:benchmarkCases()};benchmarkArea=null}}catch(error){status.textContent=en?'The latest simulation has no usable saved inspection evidence, or its record cannot be read.':error.message;return}
 const controller=new AbortController();benchmarkController=controller;benchmarkResult=null;benchmarkReviews={};renderBenchmark();$('pilot-benchmark-export').hidden=true;$('pilot-benchmark-start').disabled=true;$('pilot-benchmark-source').disabled=true;$('pilot-benchmark-cancel').hidden=false;
 const startedAt=new Date().toISOString(),total=selected.cases.length;status.textContent=en?`Comparing 0 of ${total} cases…`:`${total}件中0件の比較を開始…`;
 try{
  const result=await runFleetBenchmark({cases:selected.cases,signal:controller.signal,request:(evidence,signal)=>api('fleet-benchmark',{evidence},AbortSignal.any([signal,AbortSignal.timeout(75000)]),true),onProgress:(done,total)=>{status.textContent=document.documentElement.lang==='en'?`Compared ${done} of ${total} cases…`:`${total}件中${done}件を比較…`}});
  if(benchmarkController!==controller||controller.signal.aborted)return;benchmarkResult={...result,source:selected.source,startedAt,finishedAt:new Date().toISOString()};renderBenchmark();$('pilot-benchmark-export').hidden=false;
  status.textContent=document.documentElement.lang==='en'?`Finished: ${result.summary.responded} of ${result.summary.attempted} responses. This does not establish field effectiveness.`:`終了：${result.summary.attempted}件中${result.summary.responded}件の回答。現場での効果を示す結果ではありません。`;
 }catch(error){if(benchmarkController===controller)status.textContent=controller.signal.aborted?(document.documentElement.lang==='en'?'Comparison cancelled; partial results were discarded. Requests already sent may have reached Meta and may incur API charges.':'比較を中止し、途中結果は破棄しました。送信済みの情報はMetaに届いている可能性があり、API利用料が発生する場合があります。'):(en?'Could not complete comparison.':'比較を完了できませんでした。')}
 finally{if(benchmarkController===controller){benchmarkController=null;benchmarkArea=null;$('pilot-benchmark-start').disabled=false;$('pilot-benchmark-source').disabled=false;$('pilot-benchmark-cancel').hidden=true}}
});
$('pilot-benchmark-cancel')?.addEventListener('click',()=>benchmarkController?.abort());
$('pilot-benchmark-export')?.addEventListener('click',()=>{
 if(!benchmarkResult)return;const en=document.documentElement.lang==='en';
 try{const record={...benchmarkResult,items:benchmarkResult.items.map(item=>({...item,humanReview:benchmarkReviews[item.id]?.choice||benchmarkReviews[item.id]?.reason?{...benchmarkReviews[item.id]}:null}))},url=URL.createObjectURL(new Blob([JSON.stringify(record,null,2)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='muse-simulation-comparison.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);$('pilot-benchmark-status').textContent=en?'Comparison file saved; review it before sharing.':'比較結果の保存を開始しました。共有前に内容を確認してください。'}catch{$('pilot-benchmark-status').textContent=en?'Could not prepare the file.':'ファイルを作成できません。'}
});
for(const id of ['welcome-language','map-language'])$(id)?.addEventListener('change',()=>queueMicrotask(renderBenchmark));
async function getPlan(data,run){
  const response=await fetch('/api/plan',{method:'POST',signal:run.controller.signal,headers:{'Content-Type':'application/json','Accept':'application/x-ndjson'},body:JSON.stringify(data)});
  return readPlanStream(response,text=>{if(mission===run)say('ソラ',text)});
}
function frame(){const size=fitImage(canvas.width,canvas.height,1024);const output=document.createElement('canvas');output.width=size.width;output.height=size.height;output.getContext('2d').drawImage(canvas,0,0,size.width,size.height);return output.toDataURL('image/png')}

function cropScene(rect){
  const out=document.createElement('canvas'),sourceW=canvas.width*rect.w,sourceH=canvas.height*rect.h,scale=Math.min(3,1024/Math.max(sourceW,sourceH));
  out.width=Math.max(1,Math.round(sourceW*scale));out.height=Math.max(1,Math.round(sourceH*scale));
  out.getContext('2d').drawImage(canvas,canvas.width*rect.x,canvas.height*rect.y,sourceW,sourceH,0,0,out.width,out.height);return out.toDataURL('image/png');
}
const city=makeCity();
const world=createWorld(canvas,city);let cameraState=initialCamera();
function setCamera(state){cameraState=state;viewVersion++;boxes=[];$('view-wide').setAttribute('aria-pressed',String(state.view==='wide'));$('view-follow').setAttribute('aria-pressed',String(state.view!=='wide'))}
$('view-wide').addEventListener('click',()=>setCamera(selectCamera(cameraState,'wide')));
$('view-follow').addEventListener('click',()=>setCamera(selectCamera(cameraState,'follow')));
function resizeOverlay(){if(W!==canvas.clientWidth||H!==canvas.clientHeight){viewVersion++;boxes=[]}W=canvas.clientWidth;H=canvas.clientHeight;const dpr=Math.min(devicePixelRatio||1,2);overlay.width=W*dpr;overlay.height=H*dpr;ctx.setTransform(dpr,0,0,dpr,0,0)}
new ResizeObserver(resizeOverlay).observe(canvas);resizeOverlay();
new ResizeObserver(entries=>{const height=entries[0]?.target.offsetHeight;if(Number.isFinite(height))$('world').style.setProperty('--map-radio-height',`${height}px`)}).observe($('map-radio-dock'));
new ResizeObserver(entries=>{const height=entries[0]?.target.offsetHeight;if(Number.isFinite(height)&&height>0)$('world').style.setProperty('--fleet-dock-height',`${height}px`)}).observe($('large-fleet-dock'));
const fleetBrief=document.querySelector?.('.fleet-brief');if(fleetBrief)new ResizeObserver(entries=>{const height=entries[0]?.target.offsetHeight;if(Number.isFinite(height)&&height>0)$('world').style.setProperty('--fleet-brief-height',`${height}px`)}).observe(fleetBrief);
function render(t){if(realMode){requestAnimationFrame(render);return}const shelter=world.update(mission,cameraState.view,t),tag=$('map-tag');if(shelter){tag.hidden=!shelter.visible;tag.style.left=`${Math.min(W-150,Math.max(0,shelter.x+12))}px`;tag.style.top=`${Math.min(H-60,Math.max(90,shelter.y-45))}px`}ctx.clearRect(0,0,W,H);if(boxes.length){ctx.strokeStyle='#b7ffe0';ctx.lineWidth=2;for(const b of boxes)ctx.strokeRect(b.x1/b.w*W,b.y1/b.h*H,(b.x2-b.x1)/b.w*W,(b.y2-b.y1)/b.h*H)}requestAnimationFrame(render)}requestAnimationFrame(render);
function speechUnavailable(){sound=false;$('sound').textContent='音声 エラー';$('sound').setAttribute('aria-pressed','false');try{speechSynthesis.cancel()}catch{}$('radio').querySelectorAll('.speaking').forEach(row=>row.classList.remove('speaking'));$('radio').scrollTop=$('radio').scrollHeight}
function showSubtitle(who,text){const subtitle=$('subtitle');subtitle.textContent=`${who}：${text}`;subtitle.hidden=false}
function say(who,text){const empty=$('radio').querySelector('.empty');if(empty)empty.remove();const row=document.createElement('div');row.className='message';const avatar=document.createElement('div');avatar.className='avatar';avatar.textContent=who==='管制'?'管':who==='ソラ'?'S':'N';const content=document.createElement('div');const title=document.createElement('b');title.textContent=who;const time=document.createElement('time');time.textContent=new Date().toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'});const p=document.createElement('p');p.textContent=text;content.append(title,time,p);row.append(avatar,content);$('radio').append(row);if(!sound||!('speechSynthesis'in window))showSubtitle(who,text);if(!sound||!('speechSynthesis'in window)||(!speechSynthesis.speaking&&!speechSynthesis.pending))$('radio').scrollTop=$('radio').scrollHeight;if(sound&&'speechSynthesis'in window){try{const u=configureSpeech(new SpeechSynthesisUtterance(text),who,speechSynthesis.getVoices());trackSpeech(u,row,$('radio'),()=>sound,speechUnavailable,()=>showSubtitle(who,text));speechSynthesis.speak(u)}catch{speechUnavailable();showSubtitle(who,text)}}}
function status(title,detail){$('status-title').textContent=title;$('status-detail').textContent=detail;$('world-status').textContent=title}
function wait(ms){return new Promise(resolve=>setTimeout(resolve,ms))}
async function start(){if(mission||voicePending||!statusReady)return;const command=$('command').value.trim();if(!command){status('依頼を入力してください','配送先と物資を入力して開始します');return}if(real){const en=document.documentElement?.lang==='en';const disclosure=en?`Send this request and images of the simulated city to Meta? The same request may be sent again after the simulated obstacle. Remove personal information first.\n\n${command}`:`この依頼文と仮想の街の画像をMetaへ送信します。障害発生時にも同じ依頼文を再送する場合があります。氏名・電話番号などがあれば、キャンセルして削除してください。\n\n${command}`;if(!window.confirm(disclosure))return}if('speechSynthesis'in window)speechSynthesis.cancel();const run={state:'planning',hazard:false,route:'west',controller:new AbortController(),position:{x:-2,z:1}};mission=run;$('world').classList.add('mission-active');$('start').disabled=true;$('voice').disabled=true;$('radio').replaceChildren();$('plan-name').textContent='作戦を検討中';$('plan-indicator').textContent='検討中';status('配送作戦を確認中',real?'Museが作戦を検討します':'試作モード：固定のシナリオによる判断');say('管制',`依頼を受け付けました。「${command}」`);try{if(real){status('Museが作戦を検討中','街の画像と依頼をMuseに送信しています');const plan=await getPlan({image:frame(),command,hazard:false},run);if(mission!==run)return;if(plan.route!=='direct')throw new Error('初期ルートに対応できません');say('ナギ',plan.nagi)}else{await wait(850);if(mission!==run)return;say('ソラ','街の中心を通り、避難所Aへ向かいます。');await wait(850);if(mission!==run)return;say('ナギ','了解。浸水地域を避け、飛行を開始します。')}if(!isValidRoute('direct',false,city))throw new Error('初期ルートが街の安全条件を満たしていません')}catch(e){if(mission!==run)return;run.state='failed';mission=null;$('world').classList.remove('mission-active');status('作戦を作成できません',e.message);$('plan-name').textContent='未決定';$('plan-indicator').textContent='失敗';$('start').disabled=false;$('voice').disabled=false;return}$('original-plan').textContent='中央を直進';$('plan-name').textContent='中央を直進';$('plan-indicator').textContent=real?'MUSE':'試作';run.state='flying';setCamera(beginFlight(cameraState));status('配送中','ドローンが避難所へ向かっています');let startAt=performance.now();let last=0;async function step(now){if(mission!==run)return;let p=progressBeforeReplan((now-startAt)/14000,run.hazard);if(p>=.4&&!run.hazard){startAt=now-5600;run.position=positionAt(.4,false);$('progress').style.width='40%';run.hazard=true;run.state='replanning';$('hazard').textContent='障害発生';$('plan-name').textContent='迂回ルートを検討';$('plan-indicator').textContent='検討中';status('新たな障害を発見',real?'MuseとSAMで状況を確認します':'試作モード：状況変化を再確認');say('管制','仮想の電線が進路上にあります。飛行を一時停止します。');try{if(real){await new Promise(requestAnimationFrame);if(mission!==run)return;const image=frame();const snapshotVersion=viewVersion;let detected=await api('segment',{image},run.controller.signal);if(mission!==run)return;let sameView=snapshotVersion===viewVersion;
if(!detected.length&&sameView){const region=world.hazardCrop();if(region){say('管制','全景で検出できず、仮想の電線位置の周辺を拡大して再確認します。');const crop=cropScene(region);const closeBoxes=await api('segment',{image:crop},run.controller.signal);if(mission!==run)return;sameView=snapshotVersion===viewVersion;detected=mapCropBoxes(closeBoxes,region)}}
boxes=sameView?detected:[];say('管制',detected.length?(sameView?`SAMが撮影画像で${detected.length}件検出しました。`:`SAMが撮影画像で${detected.length}件検出しました。画面変更のため枠は非表示です。`):'SAMは撮影画像で対象を検出できませんでした。');const [plan]=await Promise.all([getPlan({image,command,hazard:true,samCount:detected.length},run),sameView&&detected.length?wait(1800):Promise.resolve()]);if(mission!==run)return;run.route=plan.route;say('ナギ',plan.nagi)}else{say('ソラ','前方の電線を想定し、直進ルートを中断します。');await wait(1000);if(mission!==run)return;say('ナギ','西側を迂回しましょう。新しいルートで配送を続けます。')}if(!isValidRoute(run.route,true,city))throw new Error('迂回ルートが街の安全条件を満たしていません')}catch(e){if(mission!==run)return;run.state='failed';status('再計画できません',e.message);$('plan-name').textContent='迂回案は未決定';$('plan-indicator').textContent='失敗';$('hazard').textContent='停止';return};$('plan-name').textContent=run.route==='east'?'東側の迂回ルート':'西側の迂回ルート';$('plan-indicator').textContent=real?'MUSE':'試作';$('hazard').textContent='迂回中';boxes=[];run.state='flying';status('迂回して配送中',real?'Museが作戦を変更しました':'試作モード：作戦を変更しました');startAt+=performance.now()-now;now=performance.now();p=Math.min((now-startAt)/14000,1)}run.position=positionAt(p,run.hazard?run.route:'direct');run.progress=p;$('progress').style.width=`${p*100}%`;if(p>=1){beginLanding(run);return}if(now-last>25){last=now;requestAnimationFrame(step)}else requestAnimationFrame(step)}requestAnimationFrame(step)}
function beginLanding(run){
  run.state='landing';run.landingProgress=0;setCamera(deliveryCamera(cameraState));status('物資を降ろしています','ケーブルで避難所へ荷物を下ろします');
  say('管制','避難所に到着。物資を降ろします。');
  const began=performance.now();
  function descend(now){
    if(mission!==run)return;
    const p=Math.min((now-began)/3000,1);run.landingProgress=p;
    if(p<1){requestAnimationFrame(descend);return}
    run.state='complete';$('delivery').textContent='1 / 1';$('hazard').textContent='回避完了';$('plan-indicator').textContent='完了';
    status('配送完了',real?'Museの作戦で仮想の避難所に到着':'試作シミュレーションで避難所に到着');
    say('管制','物資を届けました。配送完了です。');
  }
  requestAnimationFrame(descend);
}
$('start').addEventListener('click',start);$('reset').addEventListener('click',()=>{mission?.controller.abort();if(voiceTimer!==null){clearTimeout(voiceTimer);voiceTimer=null}voiceAbort?.abort();voiceAbort=null;voiceEpoch++;voicePending=false;if(recording){const active=recording;recording=null;active.stream.getTracks().forEach(track=>track.stop());if(active.state!=='inactive')active.stop()}$('voice').textContent='◉ 音声で依頼';$('voice').disabled=false;mission=null;setCamera(initialCamera());$('subtitle').hidden=true;$('subtitle').textContent='';$('world').classList.remove('mission-active');boxes=[];$('start').disabled=!statusReady;$('progress').style.width='0%';$('delivery').textContent='0 / 1';$('hazard').textContent='未発生';$('plan-name').textContent='作戦待ち';$('original-plan').textContent='未決定';$('plan-indicator').textContent='—';$('radio').innerHTML='<div class="empty"><span>◌</span><p>通信はここに表示されます</p><small>MISSION CONTROL STANDING BY</small></div>';if('speechSynthesis'in window)speechSynthesis.cancel();status('シミュレーション待機中',real?'Muse接続設定あり・疎通未確認':'Muse未接続・試作の判断を使用します')});$('sound').addEventListener('click',()=>{if(!('speechSynthesis'in window)){status('音声を利用できません','このブラウザーでは字幕で交信を表示します');return}sound=!sound;$('sound').textContent=`音声 ${sound?'ON':'OFF'}`;$('sound').setAttribute('aria-pressed',sound);if(!sound&&'speechSynthesis'in window){speechSynthesis.cancel();$('radio').querySelectorAll('.speaking').forEach(row=>row.classList.remove('speaking'));$('radio').scrollTop=$('radio').scrollHeight}});$('voice').addEventListener('click',()=>recordVoice(false));$('draft-voice').addEventListener('click',()=>recordVoice(true));setInterval(()=>$('clock').textContent=new Date().toLocaleTimeString('ja-JP',{hour12:false}),1000);

async function encodeWav(blob){const context=new AudioContext();try{const audio=await context.decodeAudioData(await blob.arrayBuffer()),samples=audio.getChannelData(0),rate=24000,count=Math.floor(samples.length*rate/audio.sampleRate),buffer=new ArrayBuffer(44+count*2),view=new DataView(buffer);let put=(at,str)=>{for(let i=0;i<str.length;i++)view.setUint8(at+i,str.charCodeAt(i))};put(0,'RIFF');view.setUint32(4,36+count*2,true);put(8,'WAVE');put(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,rate,true);view.setUint32(28,rate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);put(36,'data');view.setUint32(40,count*2,true);for(let i=0;i<count;i++){let sample=samples[Math.min(samples.length-1,Math.floor(i*audio.sampleRate/rate))];view.setInt16(44+i*2,Math.max(-1,Math.min(1,sample))*32767,true)}const bytes=new Uint8Array(buffer);let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(binary)}finally{await context.close()}}
async function recordVoice(mapDraft){
  if(mission)return;
  const button=$(mapDraft?'draft-voice':'voice'),input=$(mapDraft?'draft-transcript':'command');
  const report=(title,detail)=>mapDraft?$('draft-voice-status').textContent=`${title}：${detail}`:status(title,detail);
  if(!real){report('音声入力は未接続','Muse Voice Transcribeへの接続後に利用できます');return}
  if(recording){if(recording.state!=='inactive')recording.stop();return}
  if(voicePending)return;
  const epoch=++voiceEpoch, controller=new AbortController();voiceAbort=controller;voicePending=true;$('start').disabled=true;if(mapDraft){input.disabled=true;updateDraftSuggestion()}
  let stream;
  try{
    stream=await navigator.mediaDevices.getUserMedia({audio:true});
    if(epoch!==voiceEpoch){stream.getTracks().forEach(track=>track.stop());return}
    const media=new MediaRecorder(stream),chunks=[];recording=media;
    button.textContent='■ 録音を終了';report('録音中','もう一度押して終了。20秒で自動終了します');
    media.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};
    media.onstop=async()=>{
      if(voiceTimer!==null){clearTimeout(voiceTimer);voiceTimer=null}
      stream.getTracks().forEach(track=>track.stop());
      if(epoch!==voiceEpoch)return;
      recording=null;button.textContent=mapDraft?'◉ 音声を文字にする':'◉ 音声で依頼';
      try{
        report('音声を認識中','Muse Voice Transcribeに送信しています');
        const wav=await encodeWav(new Blob(chunks));
        if(epoch!==voiceEpoch)return;
        const transcript=await api('transcribe',{wav},controller.signal);
        if(epoch!==voiceEpoch)return;
        input.value=transcript;if(mapDraft)updateDraftSuggestion();report('音声を認識しました',mapDraft?'施設名や箱数の聞き間違いを確認・修正してください。依頼は送信されていません。':'内容を確認して配送を開始できます');
      }catch(e){if(epoch===voiceEpoch)report('音声入力に失敗',e.message)}
      finally{if(epoch===voiceEpoch){voiceAbort=null;voicePending=false;input.disabled=false;if(mapDraft)updateDraftSuggestion();$('start').disabled=!!mission}}
    };
    media.start();voiceTimer=setTimeout(()=>{if(epoch===voiceEpoch&&media.state==='recording')media.stop()},20000);
  }catch(e){
    if(stream)stream.getTracks().forEach(track=>track.stop());
    if(epoch===voiceEpoch){recording=null;voiceAbort=null;voicePending=false;input.disabled=false;if(mapDraft)updateDraftSuggestion();$('start').disabled=!!mission;report('録音を開始できません',e.message)}
  }
}

$('history-toggle').addEventListener('click',()=>{const radio=$('radio'),hidden=!radio.hidden;radio.hidden=hidden;$('history-toggle').setAttribute('aria-expanded',String(!hidden));$('history-toggle').textContent=hidden?'履歴を見る':'履歴を閉じる'});

function guideNextAction(){
  const actions=[];
  if(!$('map-sim-start').disabled)actions.push('「▶ 仮想移動を開始」');
  if(!$('map-sim-probe').hidden&&!$('map-sim-probe').disabled)actions.push('「3D建物モデルを再点検」');
  if(!$('map-sim-detour').hidden&&!$('map-sim-detour').disabled)actions.push(`「${$('map-sim-detour').textContent}」`);
  if(!$('map-sim-consult').hidden&&!$('map-sim-consult').disabled)actions.push('「2つの仮想迂回案をMuseに相談」');
  return actions.length?`${actions.join('・')}を試せます`:'地域・配送先・出発地点を選び直せます';
}
let compactWasStandby=true;
function compactOpsInit(){
  try{
    const flow=document.querySelector('#map-primary .quick-flow');
    if(flow&&!document.getElementById('setup-details')&&flow.children.length>=4){
      const items=Array.from(flow.children);
      const details=document.createElement('details');
      details.id='setup-details';details.className='setup-details';details.open=true;
      const summary=document.createElement('summary');
      const title=document.createElement('span');title.textContent='準備：地域・配送先・出発地点';
      const note=document.createElement('small');note.textContent='飛行中は自動で閉じます';
      summary.append(title,note);details.append(summary);
      const setupList=document.createElement('ol');
      setupList.className='quick-flow setup-flow';
      setupList.setAttribute('aria-label','すぐに操作する手順');
      setupList.append(items[0],items[1],items[2]);
      details.append(setupList);
      flow.replaceWith(details);
      const ops=document.createElement('div');
      ops.className='ops-start';ops.setAttribute('aria-label','開始の操作');
      while(items[3].firstChild)ops.append(items[3].firstChild);
      items[3].remove();details.after(ops);
    }
    const dock=document.getElementById('map-mission-dock');
    const sticky=document.getElementById('map-sticky-state');
    if(dock&&sticky&&sticky.parentNode&&dock.parentNode!==sticky.parentNode)sticky.before(dock);
    let actions=document.getElementById('flight-actions');
    if(!actions){
      actions=document.createElement('div');
      actions.id='flight-actions';actions.className='flight-actions';actions.hidden=true;
      const sticky=document.getElementById('map-sticky-state');
      if(sticky&&sticky.parentNode)sticky.after(actions);
    }
    for(const id of['map-sim-status','map-sim-probe','map-sim-consult','map-sim-detour','map-sim-alternate','map-sim-consult-status']){
      const el=document.getElementById(id);
      if(el&&el.parentNode!==actions)actions.append(el);
    }
    if(!document.getElementById('flight-evidence-details')){
      const evidence=document.createElement('details');evidence.id='flight-evidence-details';
      const summary=document.createElement('summary');summary.textContent='点検の詳しい結果';evidence.append(summary);
      for(const id of['map-probe-status','map-probe-choice']){const el=document.getElementById(id);if(el)evidence.append(el);}
      actions.append(evidence);
    }
  }catch(error){}
  try{syncPanelCompact();}catch(error){}
}
function syncPanelCompact(){
  const panel=document.getElementById('map-panel');
  const setup=document.getElementById('setup-details');
  const actions=document.getElementById('flight-actions');
  if(!panel)return;
  const phase=(typeof mapPlanPhase==='string')?mapPlanPhase:'needs-points';
  const standby=(phase==='needs-points'||phase==='ready');
  panel.classList.toggle('is-active',!standby);
  if(setup&&compactWasStandby&&!standby)setup.open=false;
  else if(setup&&!compactWasStandby&&standby)setup.open=true;
  compactWasStandby=standby;
  if(actions)actions.hidden=standby;
}
compactOpsInit();
function syncGuide(){
  const guide=$('map-guide-live');if(!guide)return;
  let text='';
  if(mapPlanController)text='AIに相談中。お待ちください。';
  else if(mapLastStopNotice&&['needs-points','ready'].includes(mapPlanPhase))text=mapLastStopNotice;
  else if(['preflight','direct','obstacle','detour','surface-check','delivery','complete'].includes(mapPlanPhase)){
    const status=$('map-sim-status').textContent||'';
    const shelter=draftShelter||'配送先未選択';
    let first;
    if(mapPlanPhase==='obstacle'&&mapProbeBusy)first=`1号機（→${shelter}）：3Dモデルを点検中です。終わるまでお待ちください。`;
    else if(mapPlanPhase==='obstacle'&&mapProbeReports&&!canReplayMapRoute(mapProbeReports,'A')&&!canReplayMapRoute(mapProbeReports,'B'))first=`1号機（→${shelter}）：点検結果では自動判断できる案がありません。点検結果の表示を確認してください。`;
    else first=`1号機（→${shelter}）：${status}`;
    const fleet=$('map-fleet-state').textContent;
    text=`${first}／2号機：${fleet||($('fleet-preview').textContent||'待機中')}`;
  }else if(['preflight-blocked','preflight-unavailable','direct-unavailable','detour-unavailable','surface-unavailable','error'].includes(mapPlanPhase)){
    text=`停止中：${$('map-sim-status').textContent}次にできる操作：${guideNextAction()}`;
  }
  guide.textContent=text;guide.hidden=!text;
  const bar=$('map-sticky-state');if(bar)bar.hidden=guide.hidden&&$('map-sim-stop').hidden;syncDockSummary();
}
function syncFlow(){
  $('flow-region').className='done';$('flow-shelter').className=draftShelter?'done':'';$('flow-origin').className=mapOriginChosen?'done':'';$('flow-sim').className=mapPlanPhase==='complete'?'done':['preflight','direct','obstacle','detour','surface-check','delivery'].includes(mapPlanPhase)?'current':'';
  $('flow-hint').textContent=mapOriginSelecting?'地図を押して出発地点を選んでください。':!draftShelter?(mapOriginChosen?'配送先を選びます。':'まず配送先を選びます。'):!mapOriginChosen?'次に地図から出発地点を選びます。':mapPlanPhase==='preflight'?'出発前の3Dモデルを点検中です。':['preflight-blocked','preflight-unavailable','direct-unavailable','detour-unavailable','surface-unavailable','error'].includes(mapPlanPhase)?($('map-sim-status').textContent||'仮想移動を停止しました。'):mapPlanPhase==='obstacle'?'仮想障害で停止中。迂回を確認できます。':['direct','detour','surface-check','delivery'].includes(mapPlanPhase)?'仮想移動を再生中です。':mapPlanPhase==='complete'?'仮想の荷下ろしが終了しました。':'準備完了。仮想移動を開始できます。';
  syncGuide();
}
function renderAreaLocation(state){mapAreaState=state;syncGsiScenario();const label=$('area-view-status');label.hidden=state==='ready';label.textContent=state==='error'?'地域の位置を取得できません。地図は切り替え前の地域の場合があります。':'地域の位置を取得中。地図は切り替え前の地域の場合があります。';if(state!=='ready'){mapScan?.invalidate?.();mapConsultation?.invalidate?.()}$('choose-origin').disabled=!realMap||state!=='ready'||(realMap?.mapFlightActive?.()||false);syncScan();syncConsult();updateShelterSuggestion()}
function renderObservationView(available){observationAvailable=!!available;$('map-observation-view').hidden=!observationAvailable;$('map-observation-view').disabled=mapOriginSelecting}
function syncWaterSelection(hasShelter){
  const toggle=$('water-toggle');toggle.disabled=!hasShelter;
  if(!hasShelter)toggle.checked=false;
  if(toggle.checked&&!realMap?.setWaterScene?.(true))toggle.checked=false;
  $('water-banner').hidden=!toggle.checked;
}
function fleetCandidates(){return secondFleetCandidates(shelterList,mapOriginPoint,shelterChoice)}
function fleetDestination(candidates=fleetCandidates()){return secondChoice===null?candidates[0]||null:candidates.find(item=>item.index===secondChoice)||null}
function syncFleetSelect(){const selectable=['ready','complete','surface-unavailable','preflight-blocked','preflight-unavailable','direct-unavailable','detour-unavailable','error'].includes(mapPlanPhase);$('fleet-select').disabled=mapFleetActive||!selectable||!fleetCandidates().length}
function renderFleetPreview(){
  const candidates=fleetCandidates();if(secondChoice!==null&&!candidates.some(item=>item.index===secondChoice))secondChoice=null;
  const select=$('fleet-select');select.replaceChildren();const automatic=document.createElement('option');automatic.value='auto';automatic.textContent=candidates.length?'自動：出発地点に最も近い別施設':'出発地点と施設を選んでください';select.append(automatic);
  for(const item of candidates){const option=document.createElement('option');option.value=String(item.index);option.textContent=`${item.name} — ${item.address}（約 ${(item.distance/1000).toFixed(2)} km）`;select.append(option)}
  select.value=secondChoice===null?'auto':String(secondChoice);const next=fleetDestination(candidates);
  $('fleet-preview').textContent=next?`2号機の候補：${next.name}（出発地点から直線 約 ${(next.distance/1000).toFixed(2)} km、開設・受入未確認）`:mapOriginPoint&&shelterChoice!==null?'2号機：条件に合う別施設候補がありません。1号機のみの仮想便です。':'2号機の配送先は、出発地点と施設を選ぶと表示します。';
  realMap?.setFleetPreview?.($('fleet-size')?.value==='100'?null:next);fleetFloodTracker.select(next);renderFleetFlood();syncFleetSelect();
}
function renderFleet(result){if(result&&result.phase==='checking'){mapTeamFleetSaved=''}mapFleetActive=!!result&&['checking','waiting','outbound','delivery','ascent','returning'].includes(result.phase);
  if(result&&['home','stopped'].includes(result.phase)){const key=`${result.name||''}:${result.phase}`;if(key!==mapTeamFleetSaved){mapTeamFleetSaved=key;if(result.phase==='home'){const r=result.report,counts=Number.isInteger(r?.total)&&Number.isInteger(r?.unknown)?`点検${r.total}点・不明${r.unknown}点`:'点検結果の詳細は不明';saveAndLog({side:'none',state:'accepted',reason:`2号機（→${result.name||'施設未選択'}）：仮想便が終了。${counts}。安全は未確認。`,source:'manual',flight:'two'},'確定：2号機の仮想便が終了。結果を端末に保存した。','確定：2号機の仮想便が終了したが、端末への保存に失敗した（表示のみ）。')}else{saveAndLog({side:'none',state:'stopped',reason:`2号機（→${result.name||'施設未選択'}）：${result.message||'中止しました'}`,source:'manual',flight:'two'},`確定：2号機の仮想便を中止。結果を端末に保存した。理由：${result.message||'中止しました'}`,`確定：2号機の仮想便を中止。端末への保存に失敗した（表示のみ）。理由：${result.message||'中止しました'}`)}}}const text=fleetStatus(result);$('map-fleet-state').textContent=text;$('map-fleet-state').hidden=!text;$('map-fleet-card').hidden=!text;$('map-fleet-card').dataset.state=result?.phase||'';if(!result||['checking','waiting','stopped','unavailable'].includes(result.phase))$('map-fleet-position').hidden=true;syncMapPlan();renderShelterList();renderAreaLocation(mapAreaState)}
function renderFleetPosition(result){const position=fleetPosition(result?.phase,result?.distance,result?.total);$('map-fleet-position').hidden=!position;if(!position)return;$('map-fleet-distance-label').textContent=`${position.target}までの地表直線`;$('map-fleet-distance').textContent=position.distance;$('map-fleet-progress').value=position.progress;$('map-fleet-progress').setAttribute('aria-label',`2号機の${position.target}までの仮想位置の目安`);$('map-fleet-progress').setAttribute('aria-valuetext',`${position.target}まで${position.distance}、仮想の直線距離`)}
function renderMapEvidence(){const text=mapMissionEvidence(mapDepartureEvidence,mapDetourEvidence);$('map-mission-evidence').textContent=text;$('map-mission-evidence').hidden=!text}
function syncDockSummary(){const routeEl=$('map-dock-route'),decisionEl=$('map-dock-decision');if(!routeEl||!decisionEl)return;const phase=mapPlanPhase;const side=(mapDetourEvidence&&mapDetourEvidence.side)||(mapTeamPending&&mapTeamPending.side)||mapPlanChoice||null;const source=(mapDetourEvidence&&mapDetourEvidence.source)||(mapTeamPending?mapPlanRecordedSource(mapTeamPending.provenance):(mapPlanChoice?mapPlanRecordedSource(mapPlanChoiceProvenance):null));let routeText='経路：未開始（当初・選択案なし）';if(['needs-points','ready'].includes(phase))routeText='経路：未開始（当初・選択案なし）';else if(phase==='preflight')routeText='経路：出発前に点検中。まだ移動していません。';else if(phase==='direct')routeText='経路：当初のみ（オレンジ破線）を移動中。選択案なし。';else if(phase==='obstacle')routeText=mapProbeBusy?'経路：仮想案A・Bの点検中。':'経路：当初（オレンジ破線）＋仮想案A（水色実線）・B（紫実線）を表示中。';else if(['detour','surface-check','delivery','complete'].includes(phase)&&side)routeText=`経路：当初（オレンジ破線）＋選択案${side}（${side==='A'?'水色実線':'紫実線'}）を再生・終了。`;else if(['detour','surface-check','delivery','complete'].includes(phase))routeText='経路：当初＋選択案を再生・終了（案名は不明）。';else routeText=`経路：停止中（${$('map-sim-status').textContent||phase}）。当初と選択案の表示は点検結果による。`;let selectionText='未選択';if(side&&['Muse','fixture','unknown'].includes(source))selectionText=`仮想案${side}（${mapPlanSourceLabel(mapDetourEvidence?.provenance||mapTeamPending?.provenance||mapPlanChoiceProvenance)}）`;else if(side&&source==='manual')selectionText=`仮想案${side}（手動選択）`;else if(side)selectionText=`仮想案${side}（選択方法は不明）`;else if(phase==='obstacle')selectionText=mapProbeBusy?'点検中':'未選択（点検結果によって再生可）';const statusText=$('map-sim-status').textContent||phase;const fleetText=$('map-fleet-state').hidden?($('fleet-preview').textContent||'未開始'):$('map-fleet-state').textContent;routeEl.textContent=routeText;syncPanelCompact();decisionEl.textContent=`選択：${selectionText} ／ 状態：${statusText} ／ 2号機：${fleetText}`}
function renderMapMission(phase){const labels=['出発','障害','迂回','荷下ろし'],words={pending:'待機',current:'進行中',done:'完了',blocked:'確認できず'};mapMissionSteps(phase).forEach((state,i)=>{const item=$(`map-step-${i}`);item.dataset.state=state;item.setAttribute('aria-label',`${labels[i]} ${words[state]}`);if(state==='current'||state==='blocked')item.setAttribute('aria-current','step');else item.removeAttribute('aria-current')})}

let largeFleetBusy=false,largeFleetLaunching=false,largeFleetData=null,largeFleetSelected='',largeFleetPreviousRadio=null,largeFleetSession=null,largeFleetEventKey='',largeFleetSpokenKey='';
const largeFleetHistoryKey='muse-large-fleet-history-v1';
function fleetEventLabel(source,provenance){
  if(source==='app')return 'アプリの共有';
  if(source==='fixture')return '試験用の固定応答';
  if(source==='Muse'&&provenance==='muse')return 'Museの回答（説明は未検証）';
  return '回答の出所は不明';
}
let fleetReviewRecord=null,fleetReviewDirty=false,fleetReviewBusy=false;
const fleetHistoryEnglish=()=>typeof document!=='undefined'&&document.documentElement?.lang==='en';
function readLargeFleetHistory(){
  const raw=localStorage.getItem(largeFleetHistoryKey);
  if(raw===null)return [];
  const records=JSON.parse(raw);if(!Array.isArray(records))throw new Error('保存記録の形式を確認できません');
  return records;
}
function renderLargeFleetHistory(){
  const target=$('large-fleet-previous');if(!target)return;
  const details=$('large-fleet-previous-details'),events=$('large-fleet-previous-events');
  try{
    const area=$('map-area-title').textContent.replace(' ／ 実地図','');
    const record=readLargeFleetHistory().find(item=>item?.area===area&&Number.isInteger(item.total));
    const reviewPanel=$('fleet-comparison-review');if(reviewPanel){if(fleetReviewDirty&&JSON.stringify(record)!==JSON.stringify(fleetReviewRecord))$('fleet-comparison-review-status').textContent=fleetHistoryEnglish()?'The record changed. Copy your draft or clear it, then review the latest record.':'記録が変わりました。メモを控えるか入力を消し、最新の記録を確認してください。';else if(!fleetReviewDirty)fleetReviewRecord=record||null;reviewPanel.hidden=!record||!fleetReviewRecord?.comparison?.baseline;if(!fleetReviewDirty&&record?.comparison?.baseline)renderFleetComparisonReviews()}
    target.hidden=!record;
    if(record){const delivered=Number.isInteger(record.delivered)?`${record.delivered}機`:'不明',overlap=Number.isInteger(record.delivered)&&Array.isArray(record.units)?record.units.filter(unit=>unit?.state==='stopped'&&unit?.delivery?.ok===true).length:0;target.textContent=`前回${record.total}機：荷下ろし済み ${delivered}・停止 ${record.stopped}機。${overlap?`荷下ろし後に停止した${overlap}機は両方に含みます。`:''}参考記録です。今回もモデルを点検します。`}
    if(details&&events){
      details.hidden=!record;
      if(record){
        const evidence=record.comparison?.evidence,distances=evidence?.distances;
        const distanceText=side=>{const d=distances?.[side];return Number.isFinite(d?.representative?.totalM)&&Number.isFinite(d?.totalM)?`案${side}：代表機 ${d.representative.totalM}m・対象機合計 ${d.totalM}m`:`案${side}：一覧用の距離は不明`};
        const cargo=record.cargo,m=cargo?.manifest,s=cargo?.summary;
        const boxes=key=>Number.isInteger(s?.[key])&&s[key]>=0?`${s[key]}箱`:'不明';
        const delivered=Array.isArray(s?.byFacility)?`元施設 ${boxes('deliveredOriginal')}・別施設 ${boxes('deliveredOther')}（${s.byFacility.map(place=>`${place.name} ${Number.isInteger(place.delivered)?place.delivered+'箱':'不明'}`).join(' / ')}）`:boxes('delivered');
        const cargoLine=cargo?.error?'前回の物資：集計できませんでした':typeof m?.destination?.name==='string'&&typeof m?.supply==='string'&&Number.isInteger(m?.requested)&&Number.isInteger(s?.delivered)?`前回の物資：${m.destination.name}への依頼 ${m.supply} ${m.requested}箱。仮想荷下ろし済み ${delivered}・停止 ${boxes('stopped')}・所在不明 ${boxes('unknown')}・未割当 ${boxes('unassigned')}。参考記録です。`:'前回の物資：数量の記録なし';
        const baseline=record.comparison?.baseline,rule=baseline?`前回の比較用定型案：${baseline.choice==='none'?'候補なし':'案'+baseline.choice}（実行はしていません）。`:'前回の定型案：記録なし。';
        const comparison=record.comparison?decisionCardView({comparison:record.comparison,phase:'stopped'},globalThis.document?.documentElement?.lang):null;
        const lines=[`前回の記録（${new Date(record.finishedAt).toLocaleString('ja-JP')}。参考であり今回の安全性は未確認）`,cargoLine,rule,...(comparison?[comparison.input,comparison.reply,comparison.baseline,comparison.time]:[]),distanceText('A'),distanceText('B'),...(Array.isArray(record.events)?record.events.filter(event=>event&&typeof event.text==='string').map(event=>`${fleetEventLabel(event.source,record.comparison?.input?.provenance)}：${event.text}`):[])];
        events.textContent=lines.join('\n');
      }
    }
  }catch{target.hidden=false;target.textContent='過去の仮想便の記録を読み込めません。今回の点検は別に行います。';if(details)details.hidden=true}
}
function renderFleetComparisonReviews(){
  const container=$('fleet-comparison-review-history');if(!container)return;container.replaceChildren();const en=fleetHistoryEnglish(),reviews=fleetReviewRecord?.comparisonReviews||[];
  const choices=en?{muse:'Use consultation for discussion',baseline:'Use rule for discussion',hold:'Hold both',undecided:'Unable to decide'}:{muse:'相談の案を参考',baseline:'定型案を参考',hold:'どちらも保留',undecided:'判断できない'};
  const reasons=en?{missing_data:'Missing information',outdated_data:'Outdated information',conflicting_data:'Conflicting information',needs_review:'Further review',other:'Other'}:{missing_data:'情報不足',outdated_data:'情報が古い',conflicting_data:'情報の食い違い',needs_review:'追加確認が必要',other:'その他'};
  for(const review of reviews){const p=document.createElement('p');p.textContent=`${new Date(review.at).toLocaleString(en?'en':'ja-JP')} / ${choices[review.choice]||'?'}${review.reason?' / '+(reasons[review.reason]||'?'):''}${review.note?' / '+review.note:''}`;container.append(p)}
}
async function saveLargeFleetHistory(data){
  const session=largeFleetSession;if(!session||session.saved||session.saving||session.discarded)return null;
  session.saving=true;
  try{
    if(!session.pendingRecord){const record={id:session.id,area:session.area,startedAt:session.startedAt,finishedAt:new Date().toISOString(),source:session.source,sourceDetails:session.sourceDetails||null,total:data.aircraft.length,delivered:data.cargo?.error?null:data.aircraft.filter(unit=>unit.delivery?.ok===true).length,stopped:data.summary.stopped,cargo:data.cargo||null,events:data.events||[],comparison:data.comparison||null,units:data.aircraft.map(unit=>({id:unit.id,origin:unit.origin,destination:unit.destination,state:unit.state,reason:unit.reason,check:unit.check,delivery:unit.delivery,hold:unit.hold||null,detour:unit.detour||null}))};session.pendingRecord=JSON.parse(JSON.stringify(record))}
    await updateLocalHistory({storage:localStorage,locks:navigator.locks,key:largeFleetHistoryKey,waitMs:30000,update:raw=>appendLargeFleetRecord(raw,session.pendingRecord)});
    session.saved=true;session.saveError=null;if(largeFleetSession===session)renderLargeFleetHistory();return true;
  }catch(error){session.saveError=error.message;return false}
  finally{session.saving=false}
}
async function persistLargeFleetHistory(data){
  const session=largeFleetSession;if(!session||session.saved||session.saving||session.discarded)return null;
  session.attempted=true;$('large-fleet-note').textContent=fleetHistoryEnglish()?'Saving the simulation result…':'仮想配送の結果を保存中です。';$('large-fleet-retry').hidden=true;
  const saved=await saveLargeFleetHistory(data);if(largeFleetSession!==session)return saved;
  if(saved===null)return null;
  $('large-fleet-retry').hidden=saved;
  $('large-fleet-pending-export').hidden=saved||!session.pendingRecord;$('large-fleet-pending-discard').hidden=saved;
  $('large-fleet-note').textContent=fleetHistoryEnglish()?(saved?'Simulation result saved on this device. Actual flight and acceptance remain unverified.':'Could not save the simulation result. Reloading will lose the unsaved result. Export it, retry, or explicitly discard it.'):'仮想配送。点検した地点の間、電線・機体間の安全・現地の受入は未確認。'+(saved?'結果をこの端末に保存しました。':`結果をこの端末に保存できません：${session.saveError||'不明なエラー'}。再読み込みすると未保存の結果は失われます。`);
  if(typeof syncMapPlan==='function')syncMapPlan();
  return saved;
}
const largeFleetLabels={checking:'点検中',waiting:'出発待ち',holding:'相談待ち',outbound:'配送中',delivery:'荷下ろし中',returning:'帰還中',complete:'帰還完了',stopped:'停止'};
$('fleet-comparison-review-form')?.addEventListener('input',()=>{fleetReviewDirty=true});
$('fleet-comparison-review-form')?.addEventListener('change',()=>{fleetReviewDirty=true});
$('fleet-comparison-review-reset')?.addEventListener('click',()=>{if(fleetReviewBusy)return;$('fleet-comparison-review-form').reset();fleetReviewDirty=false;$('fleet-comparison-review-status').textContent='';renderLargeFleetHistory()});
$('fleet-comparison-review-form')?.addEventListener('submit',async event=>{
  event.preventDefault();if(fleetReviewBusy||!fleetReviewRecord)return;const snapshot=fleetReviewRecord,en=fleetHistoryEnglish(),area=$('map-area-title').textContent.replace(' ／ 実地図','');
  if(snapshot.area!==area){$('fleet-comparison-review-status').textContent=en?'The selected area changed.':'選択地域が変わりました。';return}
  const review={choice:$('fleet-comparison-review-choice').value,reason:$('fleet-comparison-review-reason').value,note:$('fleet-comparison-review-note').value.trim(),at:new Date().toISOString()},current=()=>$('map-area-title').textContent.replace(' ／ 実地図','')===area;
  const buttons=$('fleet-comparison-review-form').querySelectorAll('button');try{fleetReviewBusy=true;buttons.forEach(button=>button.disabled=true);$('fleet-comparison-review-status').textContent=en?'Saving…':'保存中…';await updateLocalHistory({storage:localStorage,locks:navigator.locks,key:largeFleetHistoryKey,stillCurrent:current,waitMs:30000,update:raw=>recordFleetComparisonReview(raw,snapshot,review)});fleetReviewDirty=false;$('fleet-comparison-review-form').reset();renderLargeFleetHistory();$('fleet-comparison-review-status').textContent=en?'Review saved. The simulation was not changed.':'振り返りを保存しました。仮想便の結果は変わりません。'}catch(error){$('fleet-comparison-review-status').textContent=en?'Could not save. Keep your note and check the latest record.':`保存できません：${error.message}。メモを控えて最新の記録を確認してください。`}finally{fleetReviewBusy=false;buttons.forEach(button=>button.disabled=false)}
});

async function consultLargeFleet(evidence,signal,onNotice=()=>{},onInput=()=>{}){
  if(!real)throw new Error('Muse未接続のため相談できません');
  if(!mapFleetPlanAvailable)throw new Error('この作品サーバーは100機のMuse相談に対応していません');
  if(!realMap||!realMode)throw new Error('実地図を利用できません');
  const frame=realMap.capture();
  const {representatives,distances,...legacyEvidence}=evidence;
  const compatibleEvidence=mapFleetEvidenceV3?evidence:mapFleetEvidenceV2?{...legacyEvidence,representatives}:legacyEvidence;
  if(!mapFleetEvidenceV3)onNotice('この接続先では、計算した距離はMuseに送信されません。距離を含む相談には新しい作品サーバーが必要です。');
  const attemptedAt=new Date().toISOString();
  onInput({image:frame.image,distanceIncluded:!!mapFleetEvidenceV3,at:attemptedAt,provenance:'unknown'});
  const deadline=AbortSignal.timeout(130000);
  let result;
  try{result=await api('fleet-plan',{image:frame.image,evidence:compatibleEvidence},AbortSignal.any([signal,deadline]),true)}
  catch(error){if(deadline.aborted&&!signal.aborted)throw new Error('Museの回答が130秒以内に届きませんでした');throw error}
  if(!realMode||!realMap?.isViewCurrent(frame.view))throw new Error('相談中に地図の視点が変わりました');
  const provenance=['muse','fixture'].includes(result?.provenance)?result.provenance:'unknown';
  onInput({image:frame.image,distanceIncluded:!!mapFleetEvidenceV3,at:attemptedAt,provenance});
  return result?.result;
}
function renderLargeFleet(data){
  const dock=$('large-fleet-dock'),list=$('large-fleet-select');
  if(!dock||!list)return;
  if(!data){if(!largeFleetLaunching)largeFleetBusy=false;largeFleetData=null;largeFleetSelected='';largeFleetEventKey='';largeFleetSpokenKey='';$('large-fleet-approval').hidden=true;dock.hidden=true;dock.classList?.remove('details-open');dock.classList?.remove('needs-approval');if($('fleet-hud'))$('fleet-hud').hidden=true;$('fleet-hud-details')?.setAttribute('aria-expanded','false');document.body?.classList.remove('large-fleet-mode');if(largeFleetPreviousRadio!==null){$('map-radio-live').textContent=largeFleetPreviousRadio;largeFleetPreviousRadio=null}return}
  dock.hidden=false;document.body?.classList.add('large-fleet-mode');
  if(typeof fleetPresentation==='function'&&$('fleet-hud')){
    const view=fleetPresentation(data),hud=$('fleet-hud');hud.hidden=false;
    $('fleet-brief-area').textContent=$('map-area-title').textContent;
    const manifest=data.cargo?.manifest;
    const destinations=[...new Set((data.aircraft||[]).map(unit=>unit.destination?.name).filter(Boolean))];
    $('fleet-brief-cargo').textContent=manifest?`${manifest.destination.name}へ ${manifest.supply} ${manifest.requested}箱`:destinations.length?`${destinations[0]}${destinations.length>1?'など':''}へ（物資未指定）`:'物資の種類・数量は未指定';
    $('fleet-brief-status').textContent=view.status;
    if($('fleet-roles')&&data.support)$('fleet-roles').textContent=`偵察（仮想）：${data.support.scout} ／ 中継（仮想）：${data.support.relay}`;
    if($('fleet-model-status'))$('fleet-model-status').textContent=data.modelState==='ready'?'最大8機を3Dで拡大表示':data.modelState==='loading'?'代表機の3Dモデルを読み込み中':data.modelState==='unavailable'?'代表機の3Dモデルを確認できず、点で表示':'代表機の3Dモデル：表示状況を確認中';
    const reason=$('fleet-brief-reason');
    if(reason){const message=data.error||(data.summary?.stopped?summarizeStoppedReasons(data.aircraft||[]):'');reason.textContent=message;reason.hidden=!message}
    $('fleet-hud-count').textContent=view.counts;
    $('fleet-hud-stop').disabled=!data.active;
    for(let i=0;i<6;i++){const item=$(`fleet-progress-${i}`);item.dataset.state=i===view.step?(view.stopped?'stopped':'current'):i<view.step?'done':'pending';if(i===view.step)item.setAttribute('aria-current','step');else item.removeAttribute('aria-current')}
    $('fleet-progress-5').textContent=view.stopped?'停止・結果':'配送・結果';
  }
  const decisionCard=$('decision-card'),decision=decisionCard&&typeof decisionCardView==='function'?decisionCardView(data,document.documentElement?.lang):null;
  if(decisionCard){
    decisionCard.hidden=!decision;
    if(decision){
      const en=document.documentElement.lang==='en',count=data.comparison?.evidence?.affected??data.comparison?.affectedIds?.length;
      const scenario=data.comparison?.scenario==='withhold-a'?(en?'Case B: simulated A-sample withholding. ':'ケースB：案Aの1点を伏せる仮定。 '):(en?'Case A. ':'ケースA。 ');
      const values={'decision-share':en?`${scenario}Simulated scout → relay → ${Number.isInteger(count)?count:'?'} affected drones`:`${scenario}偵察（仮想）→ 中継 → 影響 ${Number.isInteger(count)?count:'?'}機`,'decision-reply':decision.reply,'decision-reply-full':decision.reply,'decision-verdict':decision.verdict,'decision-input':decision.input,'decision-checks':decision.checks,'decision-baseline':decision.baseline,'decision-time':decision.time};
      for(const [id,text] of Object.entries(values)){const node=$(id);if(node&&node.textContent!==text)node.textContent=text}
      const image=$('decision-image'),src=typeof data.consultImage==='string'&&data.consultImage.startsWith('data:image/png;base64,')?data.consultImage:null;
      if(image){image.hidden=!src;if(src&&image.getAttribute('src')!==src)image.setAttribute('src',src);if(!src&&image.hasAttribute('src'))image.removeAttribute('src')}
    }
  }
  if(largeFleetPreviousRadio===null)largeFleetPreviousRadio=$('map-radio-live').textContent;
  const events=Array.isArray(data.events)?data.events:[];
  const latest=events.at(-1);
  const fleetCount=Array.isArray(data.aircraft)?data.aircraft.length:100;
  $('map-radio-live').textContent=data.error?'仮想配送の準備を停止しました。':latest?`${fleetEventLabel(latest.source,data.comparison?.input?.provenance)}：${latest.text}`:data.active?(real&&mapFleetPlanAvailable?`${fleetCount}機の点検結果を共有中。仮想障害後、相談します。`:`${fleetCount}機の点検結果を共有中。接続状況が不明または相談に非対応の場合は影響機が停止します。`):'仮想配送は終了しました。';
  const eventKey=JSON.stringify(events);
  if(eventKey!==largeFleetEventKey){
    largeFleetEventKey=eventKey;
    const log=$('large-fleet-events');
    if(log){const rows=events.map(event=>{const row=document.createElement('li');row.textContent=`${fleetEventLabel(event.source,data.comparison?.input?.provenance)}：${event.text}`;return row});if(!rows.length){const row=document.createElement('li');row.textContent='共有と判断の記録はまだありません。';rows.push(row)}log.replaceChildren(...rows)}
    $('large-fleet-sharing').textContent=latest?`${fleetEventLabel(latest.source,data.comparison?.input?.provenance)}：${latest.text}`:'共有：機体と施設ごとの点検結果を確認中。';
    const stopped=data.phase==='stopped'&&data.summary?.stopped>0&&latest?.source==='app';
    const speech=stopped?latest:[...events].reverse().find(event=>['Muse','fixture','unknown'].includes(event.source));
    if(speech){const key=JSON.stringify(speech);if(key!==largeFleetSpokenKey){largeFleetSpokenKey=key;showMapSpeech(stopped?'アプリ':fleetEventLabel(speech.source,data.comparison?.input?.provenance),stopped?(data.active?'一部の機体を停止しました。理由は左上をご確認ください。':'仮想配送を停止しました。理由は左上をご確認ください。'):speech.text.split('。理由：')[0])}}
  }
  if(data.error){largeFleetBusy=false;largeFleetSession=null;$('large-fleet-retry').hidden=true;$('large-fleet-cargo').hidden=true;$('large-fleet-count').textContent='開始できません';$('large-fleet-detail').textContent=data.error;$('large-fleet-stop').disabled=true;$('fleet-size').disabled=false;syncMapPlan();return}
  largeFleetData=data;largeFleetBusy=!!data.active;
  const proposal=data.pendingDiversion;
  if(proposal)dock.classList?.add('needs-approval');else dock.classList?.remove('needs-approval');
  $('large-fleet-approval').hidden=!proposal;
  if(proposal){
    const targets=proposal.destinations.map(place=>`${place.name}（${place.latitude.toFixed(5)}, ${place.longitude.toFixed(5)}）${place.boxes}箱`).join(' / ');
    const text=`${proposal.original.name}への${proposal.supply} ${proposal.affected}箱を変更：${targets}。施設の受入は未確認。承認後に経路を再点検します。2分以内に判断がなければ停止します。`;
    if($('large-fleet-approval-text').textContent!==text)$('large-fleet-approval-text').textContent=text;
    $('large-fleet-approve').disabled=false;$('large-fleet-decline').disabled=false;
  }
  const cargo=data.cargo;
  $('large-fleet-cargo').hidden=!cargo;
  if(cargo){const m=cargo.manifest,s=cargo.summary;const delivered=s?.byFacility?`元施設 ${s.deliveredOriginal}箱・別施設 ${s.deliveredOther}箱`:`${s?.delivered}箱`;$('large-fleet-cargo').textContent=cargo.error?cargo.error:`${m.destination.name}への依頼 ${m.supply} ${m.requested}箱：配送中・準備中 ${s.assigning}箱／停止 ${s.stopped}箱／荷下ろし中断・所在不明 ${s.unknown}箱／仮想荷下ろし済 ${delivered}／未割当 ${s.unassigned}箱。予備 ${m.spare}機。`}
  if(!data.active&&largeFleetSession&&!largeFleetSession.saved&&!largeFleetSession.attempted&&!largeFleetSession.discarded){
    persistLargeFleetHistory(data);
  }
  if(data.active)$('large-fleet-retry').hidden=true;
  const s=data.summary||{};
  const stoppedReasons=summarizeStoppedReasons(data.aircraft);
  $('large-fleet-stopped-reason').hidden=!stoppedReasons;
  $('large-fleet-stopped-reason').textContent=stoppedReasons;
  $('large-fleet-sharing').hidden=!!stoppedReasons&&latest?.source==='app'&&data.aircraft.some(unit=>unit.state==='stopped'&&unit.reason&&latest.text.includes(unit.reason));
  const delivered=cargo?.error?null:data.aircraft.filter(unit=>unit.delivery?.ok===true).length;
  const deliveredThenStopped=delivered===null?0:data.aircraft.filter(unit=>unit.state==='stopped'&&unit.delivery?.ok===true).length;
  $('large-fleet-count').textContent=`点検 ${s.checking||0} / 待機 ${s.waiting||0} / 相談待ち ${s.holding||0} / 移動 ${(s.outbound||0)+(s.returning||0)} / 荷下ろし ${s.delivery||0} / 帰還完了 ${s.complete||0} / 停止 ${s.stopped||0} / 荷下ろし済（全施設） ${delivered===null?'不明':delivered}${deliveredThenStopped?`（荷下ろし後に停止 ${deliveredThenStopped}機は両方に含む）`:''}`;
  const selected=data.selectedId||largeFleetSelected;
  if(list.options.length!==data.aircraft.length+1){
    const options=[new Option('機体を選択',''),...data.aircraft.map(unit=>new Option('',unit.id))];
    list.replaceChildren(...options);
  }
  data.aircraft.forEach((unit,index)=>{const option=list.options[index+1];if(option){const text=`${unit.index+1}号機 → ${unit.destination.name}：${largeFleetLabels[unit.state]||'不明'}`;if(option.textContent!==text)option.textContent=text}});
  list.value=selected||'';largeFleetSelected=list.value;
  const unit=data.aircraft.find(item=>item.id===largeFleetSelected);
  dock.dataset.selected=unit?'true':'false';
  const check=unit?.detour?.check||unit?.check?.evidence,checked=check?.checkedAt?new Date(check.checkedAt).toLocaleString('ja-JP'):'';
  const basis=unit?.detour?.assignmentBasis;
  const allocation=basis?.type==='balanced_then_nearest'?` ／ 別施設の選択理由：割当済み${basis.existingCount}機と今回の追加${basis.assignedCount}機を比較し、同数なら停止位置からの直線距離（約${Math.round(basis.distanceM)}m）を優先`:'';
  $('large-fleet-detail').textContent=unit?`${unit.index+1}号機 → ${unit.destination.name}：${largeFleetLabels[unit.state]||'不明'}${!cargo?.error&&unit.delivery?.ok?' ／ 荷下ろし済み（仮想）':''}${unit.reason?' ／ '+unit.reason:''}${allocation}。${check?`${unit.detour?.check?'迂回後の再点検':'出発前の点検'}：建物モデル ${check.total}点・不明${check.unknown}点${checked?`（点検 ${checked}）`:''}。`:''}施設の開設・受入は未確認。`:'地図上の点、または一覧から機体を選んでください。重なった点は一覧で選べます。';
  $('large-fleet-stop').disabled=!largeFleetBusy;
  $('fleet-size').disabled=largeFleetBusy;
  syncMapPlan();
}
function syncFleetSize(){
  const many=$('fleet-size')?.value==='100';
  document.body?.classList.toggle('large-fleet-selection',many);
  if(realMap)renderFleetPreview();
  renderDraft();
  renderLargeFleetHistory();
}
$('fleet-size')?.addEventListener('change',syncFleetSize);syncFleetSize();
$('fleet-hud-details')?.addEventListener('click',()=>{const dock=$('large-fleet-dock'),button=$('fleet-hud-details');if(dock.classList.contains('details-open')){dock.classList.remove('details-open');button.setAttribute('aria-expanded','false')}else{dock.classList.add('details-open');button.setAttribute('aria-expanded','true')}});
$('fleet-hud-stop')?.addEventListener('click',()=>realMap?.stopLargeFleet?.('利用者が仮想配送を停止しました'));
$('large-fleet-select')?.addEventListener('change',()=>{largeFleetSelected=$('large-fleet-select').value;if(largeFleetSelected)realMap?.selectLargeFleet?.(largeFleetSelected)});
$('large-fleet-stop')?.addEventListener('click',()=>realMap?.stopLargeFleet?.('利用者が仮想配送を停止しました'));
$('large-fleet-approve')?.addEventListener('click',()=>{const id=largeFleetData?.pendingDiversion?.id;if(!id)return;$('large-fleet-approve').disabled=true;$('large-fleet-decline').disabled=true;realMap?.resolveLargeFleetDiversion?.(id,true)});
$('large-fleet-decline')?.addEventListener('click',()=>{const id=largeFleetData?.pendingDiversion?.id;if(!id)return;$('large-fleet-approve').disabled=true;$('large-fleet-decline').disabled=true;realMap?.resolveLargeFleetDiversion?.(id,false)});
$('large-fleet-retry')?.addEventListener('click',()=>{if((largeFleetData||largeFleetSession?.pendingRecord)&&!largeFleetBusy)persistLargeFleetHistory(largeFleetData||{})});
$('large-fleet-pending-export')?.addEventListener('click',()=>{try{if(!largeFleetSession?.pendingRecord)throw new Error();const url=URL.createObjectURL(new Blob([JSON.stringify(largeFleetSession.pendingRecord,null,2)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='muse-unsaved-simulation.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}catch{$('large-fleet-note').textContent=fleetHistoryEnglish()?'Could not export the unsaved result. Keep this page open.':'未保存の結果を書き出せませんでした。画面を閉じずに確認してください。'}});
$('large-fleet-pending-discard')?.addEventListener('click',()=>{const session=largeFleetSession,en=fleetHistoryEnglish();if(!session||session.saved||session.saving||!session.attempted)return;if(!confirm(en?'Discard this unsaved simulation result? It cannot be recovered.':'未保存の仮想配送結果を破棄しますか？ この結果は後から復元できません。'))return;session.discarded=true;$('large-fleet-retry').hidden=true;$('large-fleet-pending-export').hidden=true;$('large-fleet-pending-discard').hidden=true;$('large-fleet-note').textContent=en?'Unsaved simulation result discarded.':'未保存の仮想配送結果を破棄しました。';syncMapPlan()});
$('large-fleet-history-export')?.addEventListener('click',()=>{const en=fleetHistoryEnglish();try{const raw=localStorage.getItem(largeFleetHistoryKey);if(raw===null)throw new Error(en?'No records':'記録がありません');const url=URL.createObjectURL(new Blob([raw],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='muse-simulation-records.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);$('large-fleet-history-status').textContent=en?'Export started. The file contains facilities, locations and consultation details.':'書き出しを開始しました。ファイルには施設・位置・相談内容が含まれます。'}catch(error){$('large-fleet-history-status').textContent=en?'Could not export records.':`書き出せません：${error.message}`}});
$('large-fleet-history-delete')?.addEventListener('click',async()=>{const en=fleetHistoryEnglish();let expected;try{expected=localStorage.getItem(largeFleetHistoryKey)}catch{$('large-fleet-history-status').textContent=en?'Could not read records.':'記録を読み取れません。';return}if(!confirm(en?'Delete all saved simulation records? Export them first if needed.':'保存済みの仮想配送記録をすべて削除しますか？ 必要なら先に書き出してください。'))return;const button=$('large-fleet-history-delete');button.disabled=true;try{$('large-fleet-history-status').textContent=en?'Waiting to delete…':'削除の順番を確認中…';await updateLocalHistory({storage:localStorage,locks:navigator.locks,key:largeFleetHistoryKey,expected,update:()=>null});$('large-fleet-history-status').textContent=en?'Saved simulation records deleted.':'保存済みの仮想配送記録を削除しました。';renderLargeFleetHistory()}catch(error){$('large-fleet-history-status').textContent=en?'Deletion failed or may be incomplete. Check the records.':`削除できなかったか、完了を確認できません：${error.message}`}finally{button.disabled=false}});
window.addEventListener?.('storage',event=>{if(event.storageArea===localStorage&&event.key===largeFleetHistoryKey)renderLargeFleetHistory()});
window.addEventListener?.('beforeunload',event=>{if(largeFleetSession?.attempted&&!largeFleetSession.saved&&!largeFleetSession.discarded){event.preventDefault();event.returnValue=''}});
$('large-fleet-info')?.addEventListener('click',()=>{if(document.querySelector('.shell')?.classList.contains('panel-collapsed'))$('panel-toggle').click()});

async function showRealMap(){
  if(mission||voicePending){status('表示を切り替えられません','先にミッションをリセットしてください');return}
  realMode=true;$('world').classList.add('real-mode');$('simulation-panel').hidden=true;$('map-panel').hidden=false;$('real-map').hidden=false;$('map-banner').hidden=false;checkMapCapability();
  $('mode-real').setAttribute('aria-pressed','true');$('mode-simulation').setAttribute('aria-pressed','false');$('mode-badge').textContent='実地図 / 調査';
  if(!mapPromise){mapFetchStartedAt=new Date().toISOString();$('map-fetch-time').textContent=`取得を開始：${new Date().toLocaleString('ja-JP')}（データ更新時刻ではありません）`;
    mapPromise=import('./real-map.mjs').then(({createRealMap})=>createRealMap($('real-map'),{
      onBase:text=>{$('map-base-status').textContent=text;$('photo-base-status').textContent=text},
      onAreaView:renderAreaLocation,
      onFleet:renderFleet,
      onLargeFleet:renderLargeFleet,onLargeFleetPick:id=>{largeFleetSelected=id},onLargeFleetConsult:consultLargeFleet,
      onProgress:distance=>{$('map-mission-distance').textContent=mapMissionDistance(distance)},onFleetPosition:renderFleetPosition,
      onBuildings:text=>$('map-buildings-status').textContent=text,
      onHazard:text=>$('map-risk-status').textContent=text,
      onRain:text=>{$('rain-status').textContent=text;$('rain-map-status').textContent=`雨雲：${text}`;$('rain-map-status').hidden=!$('rain-toggle').checked},
      onShelters:text=>$('map-shelters-status').textContent=text,
      onShelterList:(list,state='ready')=>{shelterList=list||[];shelterState=state;shelterChoice=null;secondChoice=null;syncGsiScenario();syncWaterSelection(false);renderShelterList();updateShelterSuggestion();renderFleetPreview();renderTeamPast();renderLargeFleetHistory();syncLod2Light()},
      onWeather:text=>$('map-weather-status').textContent=text,
      onObservation:(text,details)=>{observationEvidence=details||null;$('map-observation-status').textContent=text;renderConsultObservation()},
      onObservationView:renderObservationView,
      onReferencePoint:(point,label)=>{const links=$('official-nearby');if(!point){links.hidden=true;$('official-location').textContent='地域の位置を確認できていません。';return}try{const urls=officialMapLinks(point);$('official-inundation').href=urls.inundation;$('official-flood').href=urls.flood;$('official-rain').href=urls.rain;$('official-location').textContent=`表示範囲：${label}`;links.hidden=false}catch{links.hidden=true;$('official-location').textContent='地域の位置を確認できていません。'}},
      onSceneChanged:realMapSceneChanged,
      onMapCamera:(view,active,target,hasSecond)=>{$('map-view-wide').setAttribute('aria-pressed',String(view==='wide'));$('map-view-follow').setAttribute('aria-pressed',String(view==='follow'&&target==='one'));$('map-view-follow').disabled=!active;$('map-view-second').setAttribute('aria-pressed',String(view==='follow'&&target==='two'));$('map-view-second').disabled=!active||!hasSecond;$('map-dock-wire').setAttribute('aria-pressed',String(view==='wire'))},
      onRouteProbe:result=>{if(result.state==='idle'){mapDepartureEvidence=null;mapDetourEvidence=null;renderMapEvidence();mapProbeBusy=false;mapProbeReports=null;$('map-probe-status').textContent='3Dモデルの点検は未実施です。実際の建物・電線や点と点の間は未確認です。'}else if(result.state==='checking'){mapProbeBusy=true;mapProbeReports=null;$('map-probe-status').textContent=`${result.automatic?'自動点検':'再点検'}：2つの仮想案の一部を3D建物モデルで確認中です。`;$('map-mission-state').textContent='仮想障害で停止。2つの案の3Dモデルを点検中です。'}else if(result.state==='done'){mapProbeInspectedAt=new Date().toISOString();mapProbeReports=result.reports;const line=(side,r)=>`${side}案：${r.total}点中 ${r.observed}点で高さ取得、${r.unknown}点は不明、仮想高度付近・それ以上の表面 ${r.blockedIndices.length}点。最大間隔 約${r.maxGap}m。`;$('map-probe-status').textContent=`${line('A',result.reports.A)} ${line('B',result.reports.B)} 各地点の幅5m、仮想高度180m付近を点検。点と点の間・実際の電線・現場状況は未確認です。`;$('map-mission-state').textContent='モデルの一部を点検しました。点間・電線・現場は未確認です。'}else if(result.state==='error'){mapProbeReports=null;mapProbeBusy=false;$('map-probe-status').textContent=`3Dモデルを点検できません：${result.message}。安全は不明です。`;$('map-mission-state').textContent='3Dモデルを点検できません。安全は不明です。'}else if(result.state==='ready'){handleProbeReady(result.reports)}syncMapPlan()},
      onSimulation:result=>{const phase=result.phase;mapPlanPhase=phase;if(['direct','preflight-blocked'].includes(phase)&&result.report){mapDepartureEvidence=result.report;shareHazardsWithSecond();}if(phase==='detour'&&mapProbeReports?.[result.side])mapDetourEvidence={...mapProbeReports[result.side],side:result.side,source:mapPlanChoice===result.side?mapPlanRecordedSource(mapPlanChoiceProvenance):'manual',...(mapPlanChoice===result.side?{provenance:mapPlanChoiceProvenance}:{})};renderMapEvidence();renderMapMission(phase);if(phase==='detour')teamLog(`仮想案${result.side}の再生を開始（${mapPlanChoice===result.side?mapPlanSourceLabel(mapPlanChoiceProvenance):'手動選択'}）。`);if(phase==='complete')teamLog('仮想の荷下ろしが終了しました。');if(phase==='preflight'){mapTeamSaveGen++}if(phase==='preflight'&&!mapTeamExplained){mapTeamExplained=true;teamLog('開始操作に伴う送信：仮想障害での停止後は街全体の画像とA/B案の点検数値をMuseへ送り自動で判断します（上限60秒・取消可）。旧サーバー・未接続では自動送信しません。');}if(['needs-points','ready'].includes(phase)){mapTeamExplained=false;mapTeamSharedKey='';mapTeamShareEvents=[]}resolveTeamPending(phase,result.message);if(['needs-points','ready','error'].includes(phase))$('map-sim-manifest').hidden=true;if(!['obstacle','detour','surface-check','delivery','complete'].includes(phase))invalidateMapPlan('phase');$('map-sim-start').disabled=!['ready','complete','surface-unavailable','preflight-blocked','preflight-unavailable','direct-unavailable','detour-unavailable','error'].includes(phase);$('map-sim-stop').disabled=!['preflight','preflight-blocked','preflight-unavailable','direct-unavailable','detour-unavailable','direct','obstacle','detour','surface-check','surface-unavailable','delivery','complete'].includes(phase);$('map-sim-stop').hidden=!['preflight','preflight-blocked','preflight-unavailable','direct-unavailable','detour-unavailable','direct','obstacle','detour','surface-check','surface-unavailable','delivery','complete'].includes(phase);const height=Number.isFinite(result.height)?`（モデル表面の楕円体高 約${result.height.toFixed(1)}m）`:'';$('map-sim-status').textContent=({ 'needs-points':'出発地点と施設を選んでください。',ready:'試験可能：仮想障害を使います。',preflight:'出発前に経路の一部を3D建物モデルで点検しています。','preflight-blocked':`点検地点の${result.report?.blockedIndices.length??0}点で仮想高度付近以上の表面を検出。出発を中止しました。出発地点を変更してください。`,'preflight-unavailable':`${result.message||'3Dモデルを点検できません'}。出発を中止しました。再試行できます。`,'direct-unavailable':`${result.message||'建物データを取得できません'}。仮想移動を中止しました。`,'detour-unavailable':`${result.message||'建物データを取得できません'}。迂回を中止しました。`,direct:`仮想障害へ移動中。出発前の${result.report?.total??0}点中 ${result.report?.unknown??0}点は高さ不明。点間・電線・現場は未確認です。`,obstacle:'仮想障害の手前で停止。相談または迂回の再生を選んでください。',detour:`仮想案${result.side}を再生中です。実際の障害物は確認していません。`,'surface-check':'施設付近の地図モデル表面を確認中です。',delivery:`地図モデルへ仮想の荷下ろし中${height}。屋根かどうか、現地の受入は未確認です。`,'surface-unavailable':`${result.message||'地図モデルの表面が不明です'}。荷下ろしを中止しました。`,complete:`地図モデル上の仮想の荷下ろしが終了${height}。屋根かどうか、実際の配送・受取は未確認です。`,error:result.message})[phase]||'状態を確認できません。';$('map-mission-dock').hidden=['needs-points','ready'].includes(phase);if(phase==='error'){$('map-mission-destination').textContent='';$('map-mission-cargo').textContent=''}$('map-mission-state').textContent=$('map-sim-status').textContent;syncMapPlan();syncFlow();syncLod2Light();renderShelterList();renderAreaLocation(mapAreaState)},
      onOrigin:value=>{mapOriginSelecting=value==='selecting';$('map-center-cross').hidden=value!=='selecting';if(mapOriginSelecting||!value)secondChoice=null;$('origin-map-hint').hidden=!mapOriginSelecting;mapOriginChosen=!!value&&!mapOriginSelecting;mapOriginPoint=mapOriginChosen?value:null;$('map-origin').textContent=mapOriginSelecting?'地図上の出発地点をクリックしてください。矢印キーで地図を動かし、Enterで中央の地点を選ぶこともできます。':value?`出発地点：${value.latitude.toFixed(5)}, ${value.longitude.toFixed(5)}（現地状況は未確認）`:'出発地点：未選択';renderObservationView(observationAvailable);renderShelterList();renderFleetPreview();syncFlow()},
      onSelectionBlocked:noticeSelectionBlocked,onDistance:value=>{$('map-distance').textContent=value===null?'施設を選ぶと直線距離を表示します。飛行経路ではありません。':`地表の直線距離：約 ${(value/1000).toFixed(2)} km。飛行経路・安全性は未確認です。`},
      onReadiness:(result,evidence)=>{mapSourceEvidence=evidence;renderSourceOverview();if(JSON.stringify(result.ids)!==JSON.stringify(mapEvidenceIds)){invalidateReview();mapEvidenceIds=result.ids.slice()}const notice=sourceNotice(result.ids);$('map-source-notice').textContent=notice;$('map-source-notice').hidden=!notice;$('readiness-state').textContent=result.state;const list=$('readiness-reasons');list.replaceChildren();for(const reason of result.reasons){const item=document.createElement('li');item.textContent=reason;list.append(item)}syncReview();syncLod2Light();syncMapPlan();syncFlow()},
      onPicked:(name,address,index)=>{if(draftShelter!==(name||'')||draftAddress!==(address||''))facilitySelectionVersion++;draftShelter=name||'';draftAddress=address||'';const next=Number.isInteger(index)?index:null;if(shelterChoice!==next)secondChoice=null;shelterChoice=next;syncGsiScenario();reconcileReportConsents();syncWaterSelection(!!name);showShelterFlood(shelterChoice===null?null:shelterList[shelterChoice]);$('focus-shelter').hidden=!name;$('map-picked').textContent=name?`${name} / ${address}（洪水向け指定緊急避難場所。開設・受入状況は不明）`:'地図上のオレンジの点を押すと施設名を表示します。';renderShelterList();renderDraft();updateShelterSuggestion();renderFleetPreview();syncFlow()}
    })).then(map=>{realMap=map;$('refresh-data').disabled=false;$('example-detailed-city').disabled=false;$('choose-origin').disabled=mapAreaState!=='ready';$('rain-toggle').disabled=false;for(const mode of ['standard','photo','plateau'])$(`basemap-${mode}`).disabled=false;for(const mode of ['detailed','highest','simple'])$(`buildings-${mode}`).disabled=false;map.showRisk($('risk-toggle').checked);map.setRiskOpacity?.(Number($('risk-opacity').value));restoreRain(map);if(activeArea!=='13118')map.setArea(activeArea);if(realMode)map.resume();else map.pause();syncScan();syncConsult();return map}).catch(error=>{$('map-base-status').textContent=`地図を表示できません。サーバーの再起動または通信の確認が必要です。` ;mapPromise=null;syncScan();syncConsult()});
  }else{const map=await mapPromise;if(map&&realMode)map.resume()}
}
function showSimulation(){if(realMode&&largeFleetSession?.attempted&&!largeFleetSession.saved&&!largeFleetSession.discarded){$('large-fleet-note').textContent=fleetHistoryEnglish()?'Save, export or discard the pending result first.':'未保存の結果を保存・書き出ししてから、必要に応じて破棄してください。';return}if(realMode&&voicePending){$('draft-voice-status').textContent='録音・文字起こしが終了してから表示を切り替えてください。';return}mapScan?.invalidate();mapConsultation?.invalidate();invalidateReview();realMap?.pause();realMode=false;$('world').classList.remove('real-mode');$('simulation-panel').hidden=false;$('map-panel').hidden=true;$('real-map').hidden=true;$('map-banner').hidden=true;$('mode-real').setAttribute('aria-pressed','false');$('mode-simulation').setAttribute('aria-pressed','true');$('mode-badge').textContent=real?'Muse接続設定あり':'試作モード'}
function restoreRain(map){const show=$('rain-toggle').checked;$('rain-details').hidden=!show;if(show)map.showRain(true)}
$('rain-toggle').addEventListener('change',()=>{const show=$('rain-toggle').checked;$('rain-details').hidden=!show;realMap?.showRain(show)});
$('mode-real').addEventListener('click',showRealMap);
$('enter-realmap').addEventListener('click',()=>$('mode-real').click());$('mode-simulation').addEventListener('click',showSimulation);$('map-back').addEventListener('click',showSimulation);$('risk-toggle').addEventListener('change',()=>{const show=$('risk-toggle').checked;realMap?.showRisk(show);renderSourceOverview();$('risk-banner').textContent=show?'洪水の想定区域は、現在の浸水状況ではありません。':'洪水の想定区域は非表示です。安全を示すものではありません。'});
$('risk-opacity').addEventListener('input',event=>{const value=Number(event.target.value);if(!Number.isFinite(value)||value<10||value>80)return;$('risk-opacity-value').textContent=`${value}%`;realMap?.setRiskOpacity?.(value)});
$('water-toggle').addEventListener('change',()=>{const toggle=$('water-toggle'),shown=realMap?.setWaterScene?.(toggle.checked)||false;toggle.checked=shown;$('water-banner').hidden=!shown});
for(const mode of ['standard','photo','plateau'])$(`basemap-${mode}`).addEventListener('click',()=>{if(!realMap)return;realMap.showBase(mode);for(const option of ['standard','photo','plateau'])$(`basemap-${option}`).setAttribute('aria-pressed',String(mode===option));$('photo-note').hidden=mode==='standard';$('plateau-photo-credit').hidden=mode!=='plateau';$('imagery-banner').hidden=mode==='standard'});
for(const mode of ['detailed','highest','simple'])$(`buildings-${mode}`).addEventListener('click',()=>{if(!realMap||mapBuildingMode===mode||refuseAreaReload())return;const previousBuildingMode=mapBuildingMode;mapBuildingMode=mode;for(const option of ['detailed','highest','simple'])$(`buildings-${option}`).setAttribute('aria-pressed',String(mode===option));$('shelter-search').value='';invalidateReview();mapFetchStartedAt=new Date().toISOString();$('map-fetch-time').textContent=`取得を開始：${new Date().toLocaleString('ja-JP')}（データ更新時刻ではありません）`;if(realMap.setBuildingMode(mode)===false){mapBuildingMode=previousBuildingMode;for(const option of ['detailed','highest','simple'])$(`buildings-${option}`).setAttribute('aria-pressed',String(previousBuildingMode===option));refuseAreaReload()}});

function syncLod2Light(){
  const toggle=$('lod2-light-toggle'),apply=$('lod2-light-apply'),status=$('lod2-light-status');
  if(!toggle||!apply||!status)return;
  const state=realMap?.lod2LightState?.()||{requested:false,applied:null,target:null};
  const decision=lod2LightStatus({...state,buildings:mapSourceEvidence.buildings,flightActive:realMap?.mapFlightActive?.()||false,hasMap:!!realMap});
  toggle.checked=!!state.requested;
  toggle.disabled=decision.toggleDisabled;
  apply.disabled=decision.applyDisabled;
  status.textContent=decision.text;
}
function refuseAreaReload(){if(largeFleetSession?.attempted&&!largeFleetSession.saved&&!largeFleetSession.discarded){$('area-list-status').textContent=fleetHistoryEnglish()?'Save, export or discard the pending simulation result first.':'未保存の仮想配送結果を保存するか、書き出し後に破棄してください。';return true}if(realMap?.mapFlightActive?.()){$('area-list-status').textContent='仮想便の飛行中は地域・建物モデルの再取得ができません。移動を終了してから再取得してください。既存の便と点検情報は保持しています。';return true}return false}
function syncAreaSelectionUI(){
  const code=typeof activeArea==='string'?activeArea:(activeArea&&typeof activeArea==='object'?(activeArea.cityCode||activeArea.code):null)||'13118';
  const select=$('area-select');
  try{
    const values=select.options?[...select.options].map(option=>option.value):null;
    if(!values||values.includes(code))select.value=code;
  }catch{select.value=code;}
  for(const c of ['13118','13101','13106']){const button=$(`quick-${c}`);if(button)button.setAttribute('aria-pressed',String(c===code));}
}
function noticeSelectionBlocked(kind){const target=kind==='origin'?'出発地点':'施設';const message=`飛行中は${target}の選択を変更できません。先に「移動を終了」で便を止めてください。`;$('shelter-list-status').textContent=message;teamLog(`選択の保持：${message}`);}
function applyAreaSelection(value,label){if(refuseAreaReload()){syncAreaSelectionUI();return;}if(benchmarkArea!==null)benchmarkController?.abort();if(value&&value!==(typeof activeArea==='string'?activeArea:activeArea?.cityCode||activeArea?.code))setConsultBulletin(null);mapLastStopNotice=null;$('map-area-title').textContent=`${label} ／ 実地図`;$('map-panel-title').textContent=`${label}の地図と防災情報`;mapFetchStartedAt=new Date().toISOString();$('map-fetch-time').textContent=`取得を開始：${new Date().toLocaleString('ja-JP')}（データ更新時刻ではありません）`;for(const code of ['13118','13101','13106'])$(`quick-${code}`).setAttribute('aria-pressed',String(value===code));if(value){$('shelter-search').value='';invalidateReview();activeArea=areaCatalog?.find(a=>a.code===value)||value;const code=typeof activeArea==='string'?activeArea:activeArea.cityCode||activeArea.code;$('official-warning').href=jmaWarningLink(code);realMap?.setArea(activeArea,mapBuildingMode)}}
$('area-select').addEventListener('change',()=>{const select=$('area-select');applyAreaSelection(select.value,select.options[select.selectedIndex].textContent)});
for(const code of ['13118','13101','13106'])$(`quick-${code}`).addEventListener('click',()=>{if(areaCatalog){$('area-search').value='';$('area-texture-filter').checked=false;renderAreaOptions()}const select=$('area-select');if(select.value===code)return;select.value=code;select.dispatchEvent(new Event('change'))});
$('lod2-light-toggle').addEventListener('change',()=>{if(realMap?.setLod2LightRequested)realMap.setLod2LightRequested($('lod2-light-toggle').checked);syncLod2Light()});
$('lod2-light-apply').addEventListener('click',()=>{
  if(!realMap?.lod2LightState)return;
  const state=realMap.lod2LightState();
  const decision=lod2LightStatus({...state,buildings:mapSourceEvidence.buildings,flightActive:realMap.mapFlightActive?.()||false,hasMap:true});
  if(decision.applyDisabled){syncLod2Light();return}
  if(realMap.setArea(activeArea)===false)refuseAreaReload();
  syncLod2Light();
});
$('example-detailed-city').addEventListener('click',()=>{if(!realMap||refuseAreaReload())return;if(areaCatalog&&!areaCatalog.some(area=>area.code==='13106')){$('area-list-status').textContent='現在の公開一覧では台東区を確認できません。';return}if(areaCatalog){$('area-search').value='';$('area-texture-filter').checked=false;renderAreaOptions()}mapBuildingMode='highest';for(const mode of ['detailed','highest','simple'])$(`buildings-${mode}`).setAttribute('aria-pressed',String(mode==='highest'));$('area-select').value='13106';applyAreaSelection('13106','東京都台東区')});

$('load-areas').addEventListener('click',async()=>{
  const button=$('load-areas');button.disabled=true;$('area-list-status').textContent='全国の公開地域一覧を取得中…';
  try{const {DATA,catalogAreas,catalogTexturedAreas}=await import('./geo-data.mjs'),response=await fetch(DATA.catalog,{signal:AbortSignal.timeout(30000)});if(!response.ok)throw new Error('一覧を取得できません');const catalog=await response.json();areaCatalog=catalogAreas(catalog);texturedAreas=catalogTexturedAreas(catalog);if(!areaCatalog.length)throw new Error('地域一覧が空です');$('area-search-label').hidden=false;$('area-texture-label').hidden=false;$('area-texture-note').hidden=false;button.textContent='公開地域の読み込み完了';renderAreaOptions();}
  catch{$('area-list-status').textContent='地域一覧を取得できませんでした。初期の3地域は利用できます。';button.disabled=false;button.textContent='全国の公開地域を再取得'}
});
function renderAreaOptions(){
  if(!areaCatalog)return;const select=$('area-select'),previous=select.value,query=$('area-search').value.trim().toLocaleLowerCase('ja-JP');
  const options=areaCatalog.filter(area=>area.area.toLocaleLowerCase('ja-JP').includes(query)&&(!$('area-texture-filter').checked||texturedAreas.has(area.code)));select.replaceChildren();
  const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent=options.length?'地域を選択':'該当する公開地域がありません';placeholder.disabled=true;select.append(placeholder);
  const selected=areaCatalog.find(area=>area.code===previous);if(selected&&!options.some(area=>area.code===previous)){const option=document.createElement('option');option.value=selected.code;option.textContent=selected.area;select.append(option)}
  for(const area of options){const option=document.createElement('option');option.value=area.code;option.textContent=area.area;select.append(option)}
  select.value=selected?previous:'';$('area-list-status').textContent=`公開3D建物のある地域：${areaCatalog.length}件 / 条件に合う候補：${options.length}件。未公開の地域は表示されません。`;
}
$('area-search').addEventListener('input',renderAreaOptions);
$('area-texture-filter').addEventListener('change',renderAreaOptions);

$('refresh-data').addEventListener('click',()=>{if(!realMap||refuseAreaReload())return;$('shelter-search').value='';invalidateReview();mapFetchStartedAt=new Date().toISOString();$('map-fetch-time').textContent=`取得を開始：${new Date().toLocaleString('ja-JP')}（データ更新時刻ではありません）`;realMap.setArea(activeArea)});

function showMapOnSmallScreen(){if(window.matchMedia?.('(max-width:850px)').matches)window.scrollTo({top:0,behavior:'auto'})}
$('choose-origin').addEventListener('click',()=>{if(mapAreaState==='ready'&&realMap){realMap.chooseOrigin();showMapOnSmallScreen()}});
$('focus-shelter').addEventListener('click',()=>realMap?.focusShelter());
$('map-observation-view').addEventListener('click',()=>{if(observationAvailable&&!mapOriginSelecting)realMap?.focusObservation()});
$('map-view-wide').addEventListener('click',()=>realMap?.chooseCamera('wide'));
$('map-view-follow').addEventListener('click',()=>realMap?.chooseCamera('follow'));
$('map-view-second').addEventListener('click',()=>realMap?.chooseCamera('follow','two'));
$('map-dock-wire').addEventListener('click',()=>realMap?.chooseCamera('wire'));
$('map-mission-more').addEventListener('click',()=>{const open=$('map-mission-dock').classList.toggle('details-open');$('map-mission-more').setAttribute('aria-expanded',String(open));$('map-mission-more').textContent=open?'詳細を閉じる':'詳細・操作'});
$('map-banner-more').addEventListener('click',()=>{const open=$('map-banner').classList.toggle('banner-open');$('map-banner-more').setAttribute('aria-expanded',String(open));$('map-banner-more').textContent=open?'注意を閉じる':'表示の注意';});
$('map-sim-start').addEventListener('click',async()=>{
  if(mapAreaState!=='ready')return;
  if(mapSourceEvidence?.buildings!=='available'){syncMapPlan();return}
  const transcript=$('draft-transcript').value.trim();
  if(transcript){
    const suggestion=suggestRequest(transcript),facilities=suggestShelters(transcript,shelterList);
    const cargoConflict=suggestion&&Number.isSafeInteger(suggestion.quantity)&&(suggestion.supply!==$('draft-supply').value||suggestion.quantity!==Number($('draft-quantity').value));
    const destinationConflict=facilities.length===1&&facilities[0]!==shelterChoice;
    if(cargoConflict||destinationConflict){
      const message='依頼文の候補と選択した物資・箱数・施設が一致しません。候補を反映するか、依頼文と選択内容を確認してください。';
      $('map-sim-status').textContent=message;$('stage-error').textContent=message;$('stage-error').hidden=false;return;
    }
  }
  $('stage-error').hidden=true;
  if($('fleet-size')?.value==='100'){
    if(largeFleetBusy||largeFleetLaunching||(largeFleetSession?.attempted&&!largeFleetSession.saved&&!largeFleetSession.discarded))return;
    const area=$('map-area-title').textContent.replace(/ ／ 実地図$/,''),supply=$('draft-supply').value,quantity=$('draft-quantity').value;
    const draft=requestDraft({area,shelter:draftShelter,supply,quantity});
    const hasCargo=!!supply||!!String(quantity).trim()||!!$('draft-transcript').value.trim();
    const destination=Number.isInteger(shelterChoice)?shelterList[shelterChoice]:null;
    if(hasCargo&&(!draft.complete||!destination||destination.name!==draftShelter)){const message='物資・数量・配送先を確認してから開始してください。';$('map-sim-status').textContent=message;$('stage-error').textContent=message;$('stage-error').hidden=false;return}
    const cargoRequest=hasCargo?{destination:{name:destination.name,address:destination.address,latitude:destination.latitude,longitude:destination.longitude},supply:draft.supply,quantity:draft.quantity}:null;
    largeFleetSession={id:String(Date.now())+'-'+Math.random().toString(36).slice(2),area:$('map-area-title').textContent.replace(' ／ 実地図',''),startedAt:new Date().toISOString(),source:$('map-buildings-status').textContent,sourceDetails:{states:sourceSnapshotForRecord(),fetchStartedAt:mapFetchStartedAt,recordedAt:new Date().toISOString()},saved:false};
    $('large-fleet-retry').hidden=true;
    $('large-fleet-note').textContent='仮想配送。点検した地点の間、電線・機体間の安全・現地の受入は未確認。';
    largeFleetBusy=true;largeFleetLaunching=true;$('map-sim-start').disabled=true;
    $('large-fleet-dock').hidden=false;document.body?.classList.add('large-fleet-mode');
    $('large-fleet-count').textContent='100機を準備中';$('large-fleet-detail').textContent='公開施設と建物モデルの点検を準備しています。';
    $('large-fleet-stop').disabled=false;
    if(!document.querySelector('.shell')?.classList.contains('panel-collapsed'))$('panel-toggle').click();
    showMapOnSmallScreen();
    try{await realMap.startLargeFleet(100,cargoRequest,$('welcome-scenario')?.value==='withhold-a'?'withhold-a':'standard')}catch(error){const message=/import|module|fetch dynamically/i.test(error.message||'')?'100機用のプログラムを読み込めません。新しく起動した作品画面を開いてください。':(error.message||'100機の準備に失敗しました');renderLargeFleet({active:false,error:message})}finally{largeFleetLaunching=false;syncMapPlan()}
    return;
  }
  const manifest=simulationManifest({area:$('map-area-title').textContent.replace(/ ／ 実地図$/,''),shelter:draftShelter,supply:$('draft-supply').value,quantity:$('draft-quantity').value});
  const second=fleetDestination();
  if(!realMap?.simulate(second))return;
  mapLastStopNotice=null;
  showMapOnSmallScreen();
  $('map-sim-manifest').textContent=manifest.supply?`今回の仮想便：${manifest.destination}へ${manifest.supply} 1箱（下書き ${manifest.requested}箱のうち）。開始時の内容・未送信。`:'今回の仮想便：物資 1箱（内容未指定・未送信）。';$('map-sim-manifest').hidden=false;
  $('map-mission-destination').textContent=`1号機 → ${draftShelter||'未選択'}（受入未確認）`;
  $('map-mission-cargo').textContent=manifest.supply?`1号機の仮想物資：${manifest.supply} 1箱`:'1号機の仮想物資：内容未指定 1箱';
});
function replayManualDetour(side){
  if(!realMode||!realMap||mapPlanPhase!=='obstacle'||mapProbeBusy||mapPlanController||!canReplayMapRoute(mapProbeReports,side))return;
  let hazards,points;
  try{
    if(typeof realMap.getSharedHazards!=='function')throw new Error('2号機の共有結果を確認できません');
    hazards=realMap.getSharedHazards();
    if(!Array.isArray(hazards))throw new Error('2号機の共有結果が不正です');
    const second=hazards.filter(h=>h?.source==='second');
    if(second.length){
      const dest=shelterList[shelterChoice];
      if(!mapOriginPoint||!dest)throw new Error('選択案の経路を確認できません');
      points=routeSamplePoints(mapSimulationPath(mapOriginPoint,{latitude:dest.latitude,longitude:dest.longitude},side).detour).points;
      const relation=hazardNearPointsM(second,points);
      if(relation.nearestM===null)throw new Error('2号機の共有地点との関連を確認できません');
      if(relation.near)throw new Error(`2号機と共有した高い表面が仮想案${side}の経路付近（約${relation.nearestM}m）にあります`);
      teamShareLog(`共有（2→1）：仮想案${side}の経路300m以内に2号機の高い表面なし（最短約${relation.nearestM}m）。`);
    }
  }catch(error){
    const reason=`${error.message}。仮想案${side}の再生を停止しました。`;
    $('map-sim-consult-status').textContent=reason;$('map-radio-live').textContent=reason;teamShareLog(`検証（2→1）：${reason}`);
    saveAndLog({side,state:'rejected',reason,source:'manual',flight:'one',interim:true,evidence:detourEvidencePayload(mapProbeReports)},`確定：${reason}`,`記録の保存に失敗：${reason}`);
    syncMapPlan();return;
  }
  if(mapPlanChoice!==null||mapTeamPending!==null)teamLog(`手動で仮想案${side}を選択（自動判断は取り消し）。`);
  mapPlanChoice=null;mapTeamPending=null;realMap.continueSimulation(side);showMapOnSmallScreen();
}
$('map-sim-detour').addEventListener('click',()=>replayManualDetour(mapPlanChoice||'A'));
$('map-sim-probe').addEventListener('click',()=>realMap?.inspectRouteModels());
$('map-sim-alternate').addEventListener('click',()=>replayManualDetour((mapPlanChoice||'A')==='A'?'B':'A'));
let mapLastStopNotice=null;
function stopMapFlight(){
  if(!realMap)return;
  clearMapSpeech();
  if(!(realMap.mapFlightActive?.()||false)){
    if(!['needs-points','ready'].includes(mapPlanPhase))realMap.stopSimulation();
    return;
  }
  const pending=mapTeamPending||mapPlanCandidate;
  mapTeamPending=null;mapPlanCandidate=null;
  teamLog('手動で移動を終了しました。');
  const generation=mapTeamSaveGen,saveKey=`${generation}:one`;let saving=null;
  if(mapTeamSavedKey!==saveKey){
    const side=pending?.side||mapPlanChoice||mapDetourEvidence?.side||'none';
    const evidence=pending?.evidence||detourEvidencePayload(mapProbeReports);
    saving=mapTeamSavingOne?.key===saveKey?mapTeamSavingOne.promise:saveAndLog({side,state:'stopped',reason:'利用者が配送を終了しました',source:pending?mapPlanRecordedSource(pending.provenance):'manual',...(pending?{provenance:pending.provenance||'unknown',reinspection:pending.reinspection}:{}),flight:'one',evidence},'手動で移動を終了した。結果を端末に保存した。','手動で移動を終了した。端末への保存に失敗した（表示のみ）。');
  }
  const pendingNotice='利用者が配送を終了しました。結果を保存中です。';mapLastStopNotice=saving?pendingNotice:'利用者が配送を終了しました。再開できます。';
  invalidateMapPlan('phase');realMap.stopSimulation('利用者が配送を終了しました');showMapOnSmallScreen();
  $('map-sim-status').textContent='利用者が仮想移動を終了しました。';$('map-mission-state').textContent='利用者が仮想移動を終了しました。';syncDockSummary();
  if(saving)saving.then(ok=>{if(mapTeamSaveGen!==generation||mapLastStopNotice!==pendingNotice)return;mapLastStopNotice=ok?'利用者が配送を終了しました。再開できます。':'利用者が配送を終了しましたが、端末への保存に失敗しました（表示のみ）。再開できます。';syncFlow()});
}
$('map-sim-stop').addEventListener('click',stopMapFlight);
$('map-dock-consult').addEventListener('click',()=>{if(!$('map-dock-consult').disabled)$('map-sim-consult').click()});
for(const choice of ['A','B'])$(`map-dock-${choice.toLowerCase()}`).addEventListener('click',()=>replayManualDetour(choice));
$('map-dock-stop').addEventListener('click',()=>{if(realMode&&realMap)stopMapFlight()});

function renderShelterList(){
  const select=$('shelter-select'),matches=filterShelters(shelterList,$('shelter-search').value);select.replaceChildren();
  const placeholder=document.createElement('option');placeholder.value='';placeholder.disabled=true;placeholder.textContent=shelterState==='loading'?'施設を取得中':shelterState==='error'?'施設を取得できません':matches.length?'施設を選択':'該当する施設はありません';select.append(placeholder);
  if(shelterChoice!==null&&!matches.some(item=>item.index===shelterChoice)&&shelterList[shelterChoice]){const chosen=shelterList[shelterChoice],option=document.createElement('option');option.value=String(shelterChoice);option.textContent=`選択中：${chosen.name} — ${chosen.address}`;select.append(option)}
  for(const item of matches){const option=document.createElement('option');option.value=String(item.index);option.textContent=`${item.name} — ${item.address}`;select.append(option)}
  select.disabled=!matches.length||(realMap?.mapFlightActive?.()||false);select.value=shelterChoice!==null?String(shelterChoice):'';
  const nearby=nearbyShelters(shelterList,mapOriginPoint,$('shelter-search').value),list=$('nearby-shelter-list');list.replaceChildren();$('nearby-shelters').hidden=!nearby.length;
  for(const item of nearby){const row=document.createElement('li'),button=document.createElement('button');button.type='button';button.className='area-load';button.textContent=`${item.name} ／ 約 ${(item.distance/1000).toFixed(2)} km`;button.disabled=realMap?.mapFlightActive?.()||false;button.setAttribute('aria-pressed',String(item.index===shelterChoice));button.addEventListener('click',()=>{if(realMap?.selectShelter(item.index)===false){renderShelterList();noticeSelectionBlocked();}});row.append(button);list.append(row)}
  $('shelter-list-status').textContent=shelterState==='loading'?'施設情報を取得中です。':shelterState==='error'?'施設情報を取得できません。施設がないことを意味しません。':`公開施設 ${shelterList.length}件・候補 ${matches.length}件。掲載外や受入は未確認。`;
}
$('shelter-search').addEventListener('input',renderShelterList);
$('shelter-select').addEventListener('change',()=>{const value=$('shelter-select').value;if(value!==''){if(realMap?.selectShelter(Number(value))===false){renderShelterList();noticeSelectionBlocked();}}});
$('fleet-select').addEventListener('change',()=>{if($('fleet-select').disabled)return;const value=$('fleet-select').value;if(mapPlanPhase!=='ready')realMap?.stopSimulation();secondChoice=value==='auto'?null:Number(value);renderFleetPreview()});
$('fleet-flood-retry').addEventListener('click',()=>fleetFloodTracker.select(fleetDestination(),{force:true}));

function renderDraft(){
  const area=$('map-area-title').textContent.replace(/ ／ 実地図$/,''),draft=requestDraft({area,shelter:draftShelter,supply:$('draft-supply').value,quantity:$('draft-quantity').value});
  $('draft-destination').textContent=draft.destination?`配送先候補：${draft.destination}（開設・受入は未確認）`:'配送先候補：施設一覧または地図のオレンジの点から選択してください。';
  $('draft-summary').textContent=draft.complete?`${draft.status}：${draft.area} / ${draft.destination}へ ${draft.supply} ${draft.quantity}箱。配送・飛行は判断不可。`:'下書き・未送信。物資・数量（1〜10000箱）・施設の選択が必要です。';
  const hasCargoInput=!!$('draft-supply').value||!!$('draft-quantity').value.trim()||!!$('draft-transcript').value.trim();
  $('map-cargo-preview').textContent=draft.complete?($('fleet-size')?.value==='100'?`次に開始する仮想便：${draft.supply} ${draft.quantity}箱。1機1箱、最大100機、余りは予備機または未割当。`:`次に開始する仮想便：${draft.supply} 1箱（下書き ${draft.quantity}箱のうち）。`):$('fleet-size')?.value==='100'&&hasCargoInput?'物資・数量・配送先を確認してから開始してください。':'物資を指定しない場合は、内容未指定の仮想便です。';
  $('fleet-size-note').textContent=(draft.complete?`${draft.destination}へ${draft.supply} ${draft.quantity}箱（1機1箱）。余りは予備か未割当。別施設は承認後に再点検。`:'物資未指定なら最大5施設へ仮想配送。依頼は内容の確認が必要。')+'仮想障害後、地図画像（地名を含む場合あり）と点検結果をMetaのMuseへ最大2回送信。未接続・点検不明なら影響機は停止。';
  $('consult-input').textContent=`送信する物資：${draft.supply||'未指定'} ／ ${draft.quantity===null?'数量未指定':`${draft.quantity}箱`}`;
}
let draftSuggestion=null,draftSuggestionText='',draftShelterCandidate=null,draftShelterText='';
function updateShelterSuggestion(){
  const value=$('draft-transcript').value,output=$('draft-shelter-suggestion'),button=$('draft-shelter-apply'),matches=suggestShelters(value,shelterList);draftShelterText=value;draftShelterCandidate=matches.length===1?{index:matches[0],name:shelterList[matches[0]].name,address:shelterList[matches[0]].address}:null;
  button.hidden=!draftShelterCandidate;button.disabled=voicePending||!realMap||mapAreaState!=='ready'||shelterState!=='ready'||shelterChoice===draftShelterCandidate?.index;
  output.textContent=!value.trim()?'文章の施設名と、選択地域の公開施設を照合できます。':shelterState==='loading'?'施設一覧を取得後に文章と照合します。':shelterState==='error'?'施設一覧を取得できないため、照合できません。':matches.length>1?`施設候補が${matches.length}件あります。施設一覧で名前と住所を確認してください。`:draftShelterCandidate?`施設候補：${draftShelterCandidate.name} — ${draftShelterCandidate.address}（開設・受入は未確認）${shelterChoice===draftShelterCandidate.index?'。選択済みです。':'。確認して選択してください。'}`:'施設名を1つに特定できません。施設一覧から確認してください。';
}
function updateDraftSuggestion(){
  const value=$('draft-transcript').value;draftSuggestionText=value;draftSuggestion=suggestRequest(value);
  $('draft-suggestion').textContent=draftSuggestion?`文章からの候補：${draftSuggestion.label} ${draftSuggestion.quantity}箱。内容を確認してください。`:value.trim()?'物資と箱数を1つに特定できません。選択済みの値はそのままです。手動で確認してください。':'文章から物資と箱数の候補を確認できます。';
  $('draft-apply').hidden=!draftSuggestion;$('draft-apply').disabled=voicePending;updateShelterSuggestion();renderDraft();
}
$('draft-shelter-apply').addEventListener('click',()=>{
  if(voicePending||!realMap||mapAreaState!=='ready'||shelterState!=='ready')return;
  const value=$('draft-transcript').value,candidate=draftShelterCandidate,matches=suggestShelters(value,shelterList),current=matches.length===1?shelterList[matches[0]]:null;
  if(!candidate||value!==draftShelterText||matches[0]!==candidate.index||current?.name!==candidate.name||current?.address!==candidate.address){updateShelterSuggestion();return}
  if(shelterChoice===candidate.index)return;if(realMap.selectShelter(candidate.index)===false){renderShelterList();noticeSelectionBlocked();return}updateShelterSuggestion();
});
$('draft-transcript').addEventListener('input',updateDraftSuggestion);
$('draft-apply').addEventListener('click',()=>{
  if(voicePending)return;
  if($('draft-transcript').value!==draftSuggestionText){updateDraftSuggestion();return}
  const candidate=draftSuggestion;if(!candidate)return;
  $('draft-supply').value=candidate.supply;$('draft-quantity').value=String(candidate.quantity);mapConsultation?.invalidate();renderDraft();
  draftSuggestion=null;$('draft-apply').hidden=true;$('draft-suggestion').textContent='候補を反映しました。内容と配送先を確認してください。';
});
$('draft-supply').addEventListener('change',()=>{mapConsultation?.invalidate();renderDraft()});
$('draft-quantity').addEventListener('input',()=>{mapConsultation?.invalidate();renderDraft()});
function consultObservationValue(){const area=typeof activeArea==='string'?activeArea:String(activeArea?.cityCode||activeArea?.code||'');const value=mapAreaState==='ready'&&observationEvidence?mapObservationContext(observationEvidence,area,Date.now(),{includeReferenceKind:mapObservationReferenceKindCapability,includeAccumulatedRain:mapObservationAccumulatedRainCapability}):null;return value&&value.rain===null&&value.wind===null&&!mapObservationTotalsOnlyCapability?null:value}
function ensureCurrentObservationConsent(){
  if(!consultObservationSnapshot)return;
  const value=consultObservationValue();if(!$('consult-use-observation').checked||!value||JSON.stringify(value)!==JSON.stringify(consultObservationSnapshot)||JSON.stringify(value)!==consultObservationConsent){$('consult-use-observation').checked=false;consultObservationConsent=null;consultObservationCleared=true;renderConsultObservation();throw Object.assign(new Error('観測情報が変更または期限切れです。再確認してください'),{code:'observation_changed_before_send'})}
}
function consultFieldValue(){
  const area=typeof activeArea==='string'?activeArea:String(activeArea?.cityCode||activeArea?.code||''),chosen=Number.isInteger(shelterChoice)?shelterList[shelterChoice]:null;
  if(mapAreaState!=='ready'||!chosen||chosen.name!==draftShelter||chosen.address!==draftAddress)return null;
  const identity={area,name:draftShelter,address:draftAddress},key=pilotFacilityKey(area,identity.name,identity.address);if(!key)return null;
  try{return consultFieldReports(localStorage.getItem(`${key}:flood-field-v1`),identity)}catch{return null}
}
function consultFacilityValue(){
  const area=typeof activeArea==='string'?activeArea:String(activeArea?.cityCode||activeArea?.code||''),chosen=Number.isInteger(shelterChoice)?shelterList[shelterChoice]:null;
  if(mapAreaState!=='ready'||!chosen||chosen.name!==draftShelter||chosen.address!==draftAddress)return null;
  const identity={area,name:draftShelter,address:draftAddress},key=pilotFacilityKey(area,identity.name,identity.address);if(!key)return null;
  try{return consultFacilityReports(localStorage.getItem(`${key}:report-v2`),identity)}catch{return null}
}
function consultInfrastructureData(){
  const area=typeof activeArea==='string'?activeArea:String(activeArea?.cityCode||activeArea?.code||'');if(mapAreaState!=='ready'||!/^\d{5}$/.test(area))return null;
  try{const raw=localStorage.getItem(`muse-infrastructure-reports-v1:${area}`),value=consultInfrastructureReports(raw,area);return value?{area,raw,value}:null}catch{return null}
}
function reportConsentSignature(kind){if(kind==='infrastructure'){const data=consultInfrastructureData();return data?JSON.stringify(data):null}const value=kind==='field'?consultFieldValue():consultFacilityValue();if(!value)return null;const area=typeof activeArea==='string'?activeArea:String(activeArea?.cityCode||activeArea?.code||''),key=pilotFacilityKey(area,draftShelter,draftAddress);try{const raw=localStorage.getItem(key+(kind==='field'?':flood-field-v1':':report-v2'));return JSON.stringify({selection:facilitySelectionVersion,raw,value})}catch{return null}}
function ensureCurrentConsultReports(){
  const changed=[];
  if(consultFieldSnapshot&&(!$('consult-use-field').checked||!mapRefsCapability||!mapFieldReportsCapability||JSON.stringify(consultFieldSnapshot)!==JSON.stringify(consultFieldValue())||consultReportConsents.field!==reportConsentSignature('field')))changed.push('field');
  if(consultFacilitySnapshot&&(!$('consult-use-facility').checked||!mapRefsCapability||!mapFacilityReportsCapability||consultFacilitySnapshot.selectionVersion!==facilitySelectionVersion||JSON.stringify(consultFacilitySnapshot.value)!==JSON.stringify(consultFacilityValue())||consultReportConsents.facility!==reportConsentSignature('facility')))changed.push('facility');
  if(consultInfrastructureSnapshot&&(!$('consult-use-infrastructure').checked||!mapRefsCapability||!mapInfrastructureCapability||consultInfrastructureSnapshot!==reportConsentSignature('infrastructure')))changed.push('infrastructure');
  if(consultBulletinSnapshot&&(!$('consult-use-bulletin').checked||!mapRefsCapability||!mapBulletinCapability||consultBulletinSnapshot.version!==consultBulletinVersion||JSON.stringify(consultBulletinSnapshot.value)!==JSON.stringify(consultBulletinValue())))changed.push('bulletin');
  if(!changed.length)return;
  for(const kind of changed){$(`consult-use-${kind}`).checked=false;if(kind!=='bulletin')consultReportConsents[kind]=null}
  if(changed.some(kind=>kind!=='bulletin'))showReportConsentNotice();
  if(changed.includes('bulletin'))showBulletinConsentNotice();
  renderConsultField();renderConsultFacility();renderConsultInfrastructure();renderConsultBulletin();
  throw Object.assign(new Error('情報を再確認してください'),{code:'information_changed_before_send'});
}
function showBulletinConsentNotice(){const node=$('consult-bulletin-consent-status');node.dataset.active='true';node.textContent=document.documentElement.lang==='en'?'The bulletin changed or expired, so its selection was cleared. Review it and select again to send.':'電文が変わったか期限を過ぎたため、送信の選択を解除しました。内容を確認し、送る場合は選び直してください。'}
function showReportConsentNotice(){const node=$('consult-report-consent-status');node.dataset.active='true';node.textContent=document.documentElement.lang==='en'?'Facility or reports changed. Review the information and choose again if you want to send it.':'施設または報告が変わったため送信の選択を解除しました。内容を確認し、送る場合は選び直してください。'}
function reconcileReportConsents(){let changed=false;for(const kind of ['field','facility','infrastructure']){const checkbox=$(`consult-use-${kind}`);if(checkbox.checked&&(!consultReportConsents[kind]||consultReportConsents[kind]!==reportConsentSignature(kind))){checkbox.checked=false;consultReportConsents[kind]=null;changed=true}}if(changed){showReportConsentNotice();mapConsultation?.invalidate()}return changed}
function consultBulletinValue(){return consultBulletinCandidate?consultFloodBulletin(consultBulletinCandidate):null}
function renderConsultBulletin(){
  const checkbox=$('consult-use-bulletin'),value=consultBulletinValue(),en=document.documentElement?.lang==='en';checkbox.disabled=!checkbox.checked&&(!mapBulletinCapability||!mapRefsCapability||!value);
  if(consultBulletinTimer!==null){clearTimeout(consultBulletinTimer);consultBulletinTimer=null}
  if(value&&checkbox.checked){const until=Date.parse(value.retrievedAt)+7200000-Date.now();consultBulletinTimer=setTimeout(refreshConsultBulletin,Math.max(0,Math.min(until,2147483647)))}
  const target=$('consult-bulletin-input');
  const age=value?consultBulletinIssueAge(value.issuedAt):null;
  const signature=JSON.stringify({value,en,available:mapBulletinCapability&&mapRefsCapability});
  if(target.dataset.signature!==signature){
    target.dataset.signature=signature;target.textContent=!mapBulletinCapability||!mapRefsCapability?(en?'This server cannot send flood bulletins.':'このサーバーは洪水予報電文の送信に対応していません。'):!value?(en?'Open a supported bulletin in the national flood forecast section. Training, cancellation, unsupported formats, over 30 water entries or retrievals over two hours old cannot be sent.':'全国の洪水予報で、送信可能な電文の詳細を開いてください。訓練・取消・未対応の形式・水位が30件を超える電文や、取得から2時間以上の電文は送れません。'):(en?`If selected, send the opened bulletin URL, issue and retrieval times, area code, type and ${value.levels.length} water entries. Facility relationship is unverified.`:`選択すると、開いた電文のURL・発表／取得時刻・区域コード・種別・水位 ${value.levels.length}件を送信します。施設との対応は未確認です。`);
    if(value&&mapBulletinCapability&&mapRefsCapability){const notice=document.createElement('p');notice.dataset.issueAge='';target.append(notice);const details=document.createElement('details'),summary=document.createElement('summary'),content=document.createElement('p');summary.textContent=en?'Review the information to be sent':'送信する情報を確認';content.textContent=[value.sourceUrl,`${value.issuedAt} / ${value.retrievedAt} / ${value.event} / ${value.serial} / ${value.bulletinType} / ${value.controlStatus}`,...value.levels.map(row=>`${row.stationCode} / ${row.category} / ${row.at} / ${row.value??(en?'missing':'欠測')} ${row.unit} / ${row.condition}`)].join('\n');details.append(summary,content);target.append(details)}
  }
  const notice=target.querySelector('[data-issue-age]');if(notice&&value){const minutes=age.minutes,amount=minutes<60?minutes:minutes<2880?Math.floor(minutes/60):Math.floor(minutes/1440),unit=minutes<60?(en?'minutes':'分'):minutes<2880?(en?'hours':'時間'):(en?'days':'日');notice.textContent=age.state==='elapsed'?(en?`Issued ${amount} ${unit} ago (${value.issuedAt}); retrieved ${value.retrievedAt}. Retrieving it now does not make the announcement current. Check later updates.`:`発表から約 ${amount} ${unit}経過（${value.issuedAt}）、取得 ${value.retrievedAt}。再取得しても発表時点は変わりません。後続の情報を確認してください。`):(en?'The issue time is in the future or unknown relative to this device. Check the device clock and official bulletin.':'発表時刻が端末時刻より未来、または不明です。端末の時計と公式電文を確認してください。')}
  updateConsultButton();
}
const refreshConsultBulletin=()=>{const value=consultBulletinValue(),checkbox=$('consult-use-bulletin');if(checkbox.checked&&!value){checkbox.checked=false;showBulletinConsentNotice();mapConsultation?.invalidate()}else if(consultBulletinSnapshot&&(consultBulletinSnapshot.version!==consultBulletinVersion||JSON.stringify(consultBulletinSnapshot.value)!==JSON.stringify(value)))mapConsultation?.invalidate();renderConsultBulletin()};
function setConsultBulletin(value){consultBulletinVersion++;consultBulletinCandidate=value;const checkbox=$('consult-use-bulletin');if(checkbox.checked){showBulletinConsentNotice();if(consultBulletinSnapshot)mapConsultation?.invalidate()}checkbox.checked=false;renderConsultBulletin()}
let consultFacilityTimer=null;
function renderConsultFacility(){
  const checkbox=$('consult-use-facility'),value=consultFacilityValue(),en=document.documentElement?.lang==='en';checkbox.disabled=!checkbox.checked&&(!mapFacilityReportsCapability||!mapRefsCapability||!value);
  if(consultFacilityTimer!==null){clearTimeout(consultFacilityTimer);consultFacilityTimer=null}
  if(value&&checkbox.checked){const until=Math.min(...value.map(item=>Date.parse(item.expiresAt)))-Date.now();consultFacilityTimer=setTimeout(refreshConsultFacility,Math.max(0,Math.min(until,2147483647)))}
  const target=$('consult-facility-input');
  target.textContent=!mapFacilityReportsCapability||!mapRefsCapability?(en?'This server cannot send facility reports.':'このサーバーは施設報告の送信に対応していません。'):!value?(en?'No usable current report for the selected facility.':'選択施設に送信できる期限内の報告がありません。'):(en?`${value.length} unverified reports will be sent if selected. Status, times, supplies, landing and correction links only; names, contacts and condition text are excluded. The image may contain locations.`:`選択すると期限内の未検証の報告 ${value.length}件を送信します。状態・日時・物資・着地点・訂正関係のみで、氏名・連絡先・条件文は送りません。画像には地点情報が映る場合があります。`);
  if(value&&mapFacilityReportsCapability&&mapRefsCapability){
    const states=en?{checking:'checking',available:'reported accepting',conditional:'reported conditional',unavailable:'reported not accepting'}:{checking:'確認中',available:'受け入れ可能',conditional:'条件付き',unavailable:'受け入れ不可'};
    const landing=en?{unknown:'landing unknown',clear_reported:'landing reported usable',unusable_reported:'landing reported unusable'}:{unknown:'着地点不明',clear_reported:'着地点使用可能との報告',unusable_reported:'着地点使用不可との報告'};
    const supplies=en?{water:'water',food:'food',blanket:'blankets',hygiene:'hygiene supplies'}:{water:'飲料水',food:'食料',blanket:'毛布',hygiene:'衛生用品'};
    target.textContent+=' '+value.map((row,i)=>`${i+1}. ${states[row.status]} / ${landing[row.landing]} / ${row.supply?`${supplies[row.supply]} ${row.quantity}`:(en?'supply unknown':'物資不明')} / ${new Date(row.confirmedAt).toLocaleString(en?'en':'ja-JP')} → ${new Date(row.expiresAt).toLocaleString(en?'en':'ja-JP')}${row.correctionIndex!==null?(en?` / corrects report ${row.correctionIndex+1}`:` ／ 報告${row.correctionIndex+1}の訂正`):row.correctionTargetOmitted?(en?' / correction target not sent':' ／ 訂正元は未送信'):''}`).join(' ; ');
  }
  updateConsultButton();
}
let consultFieldTimer=null;
function renderConsultField(){
  const checkbox=$('consult-use-field'),value=consultFieldValue(),en=document.documentElement?.lang==='en';checkbox.disabled=!checkbox.checked&&(!mapFieldReportsCapability||!mapRefsCapability||!value);
  if(consultFieldTimer!==null){clearTimeout(consultFieldTimer);consultFieldTimer=null}
  if(value&&checkbox.checked){const until=Math.min(...value.map(item=>Date.parse(item.expiresAt)))-Date.now();consultFieldTimer=setTimeout(refreshConsultField,Math.max(0,Math.min(until,2147483647)))}
  $('consult-field-input').textContent=!mapFieldReportsCapability||!mapRefsCapability?(en?'This server cannot send field reports.':'このサーバーは現地報告の送信に対応していません。'):!value?(en?'No usable current report for the selected facility.':'選択施設に送信できる期限内の報告がありません。'):(en?`${value.length} unverified human reports will be sent when selected. Status, stated scope and times only; names, contact details, source text and notes are excluded. The same category does not establish the same place or time. The image may contain location information.`:`選択すると期限内の人の報告 ${value.length}件を送信します。状態・申告範囲・日時のみで、氏名・連絡先・確認先・メモは送りません。同じ分類でも場所や時刻が同じとは限りません。画像には地点情報が映る場合があります。`);
  if(value&&mapFieldReportsCapability&&mapRefsCapability){const states=en?{water_seen:'water seen',no_water_seen:'water not seen',uncertain:'unknown'}:{water_seen:'水が見えた',no_water_seen:'水が見えなかった',uncertain:'不明'},scopes=en?{facility_point:'facility point',nearby_road:'nearby road',unspecified:'scope unknown'}:{facility_point:'施設の一点',nearby_road:'付近の道路',unspecified:'範囲不明'};$('consult-field-input').textContent+=' '+value.map(row=>`${states[row.status]} / ${scopes[row.scope]} / ${new Date(row.observedAt).toLocaleString(en?'en':'ja-JP')} → ${new Date(row.expiresAt).toLocaleString(en?'en':'ja-JP')}`).join(' ; ')}
  updateConsultButton();
}
function renderConsultObservation(){
  const checkbox=$('consult-use-observation'),value=consultObservationValue(),en=document.documentElement?.lang==='en';
  if(checkbox.checked&&(!value||!mapObservationCapability||!mapRefsCapability||JSON.stringify(value)!==consultObservationConsent)){checkbox.checked=false;consultObservationConsent=null;consultObservationCleared=true;mapConsultation?.invalidate()}
  checkbox.disabled=!mapObservationCapability||!mapRefsCapability||!value;
  $('consult-observation-consent-status').textContent=consultObservationCleared?(en?'The observation changed or became unavailable, so the selection was cleared. Review it and select again if you want to send it.':'観測情報が変わったか利用できなくなったため、送信の選択を解除しました。内容を確認し、送る場合は選び直してください。'):'';
  const rawReference=typeof observationEvidence?.referenceLabel==='string'&&observationEvidence.referenceLabel.length<=200?observationEvidence.referenceLabel:'',reference=en?(rawReference==='建物モデル範囲の中心'?'building model area centre':rawReference.endsWith('の公開座標')?`${rawReference.slice(0,-5)} (published facility location)`:'unknown'):(rawReference||'不明');
  const kindNotice=mapObservationReferenceKindCapability?(en?'The reference type is included in observation data.':'基準の種類は観測データに含めます。'):(en?'This server does not include the reference type in observation data.':'このサーバーでは基準の種類を観測データに含めません。');
  $('consult-observation-input').textContent=!mapObservationCapability||!mapRefsCapability?(en?'This server does not support sending observation evidence.':'このサーバーでは観測情報の送信に対応していません。'):!value?(en?'No observation can be sent with this server. Older servers may not accept rainfall-only data; missing or outdated data cannot be sent.':'このサーバーでは送信できる観測がありません。旧サーバーは1時間・24時間雨量だけのデータに対応しない場合があります。欠測や古い情報も送信できません。'):(en?`Optional: station ${value.stationId}, observation ${new Date(value.observedAt).toLocaleString()}, retrieved ${new Date(value.retrievedAt).toLocaleString()}. Reference point: ${reference}; straight-line distance to station ${value.distanceMeters} m. ${kindNotice} The reference name is not included in observation data; it may appear in the image. 10-minute rain ${value.rain??'unknown'} mm, wind ${value.wind??'unknown'} m/s. Ground observation, not facility or aircraft conditions.`:`任意：観測所 ${value.stationId}／観測 ${new Date(value.observedAt).toLocaleString('ja-JP')}／取得 ${new Date(value.retrievedAt).toLocaleString('ja-JP')}。距離の基準：${reference}／観測所までの直線距離 ${value.distanceMeters} m。${kindNotice} 基準点の名称は観測データに含めません（画像には映る場合があります）。10分間降水量 ${value.rain??'不明'} mm／平均風速 ${value.wind??'不明'} m/s。観測所の地上値で、施設や上空の状況ではありません。`);
  if(value)$('consult-observation-input').textContent+=mapObservationAccumulatedRainCapability?(en?` 1-hour rain ${value.rain1h??'unknown'} mm; 24-hour rain ${value.rain24h??'unknown'} mm will also be sent when selected.`:` 選択時は1時間降水量 ${value.rain1h??'不明'} mm、24時間降水量 ${value.rain24h??'不明'} mmも送信します。`):(en?' This server does not send 1-hour or 24-hour rain.':'このサーバーでは1時間・24時間降水量は送信しません。');
  updateConsultButton();
}
let consultInfrastructureTimer=null;
function renderConsultInfrastructure(){
  const checkbox=$('consult-use-infrastructure'),data=consultInfrastructureData(),en=document.documentElement?.lang==='en',target=$('consult-infrastructure-input');checkbox.disabled=!checkbox.checked&&(!mapInfrastructureCapability||!mapRefsCapability||!data);
  clearTimeout(consultInfrastructureTimer);consultInfrastructureTimer=null;
  if(data&&checkbox.checked){const until=Math.min(...data.value.map(row=>Date.parse(row.expiresAt)))-Date.now();consultInfrastructureTimer=setTimeout(refreshConsultInfrastructure,Math.max(0,Math.min(until,2147483647)))}
  target.textContent=!mapInfrastructureCapability||!mapRefsCapability?(en?'This server cannot send infrastructure reports.':'このサーバーは設備報告の送信に対応していません。'):!data?(en?'No usable reports for this area, or more than 20 reports require review.':'この地域に送信できる報告がないか、20件を超えるため確認が必要です。'):(en?`${data.value.length} unverified reports will be sent only if selected. Locations, sources and local identifiers are excluded; their relation to the map is unknown.`:`選択すると未検証の報告 ${data.value.length}件を送信します。場所・確認先・端末内IDは含まず、地図との関係は不明です。`);
  if(data&&mapInfrastructureCapability&&mapRefsCapability){const items=en?{wire:'wire/cable',pole:'pole',tree:'tree',work:'work/temporary',other:'other'}:{wire:'電線・ケーブル',pole:'電柱',tree:'樹木',work:'工事・仮設',other:'その他'},states=en?{present:'reported visible',damaged:'reported damaged',changed:'reported changed',not_seen:'reported not seen in viewed area',uncertain:'reported unknown'}:{present:'見えたとの報告',damaged:'破損との報告',changed:'変化したとの報告',not_seen:'確認範囲で見えなかったとの報告',uncertain:'確認できなかったとの報告'};target.textContent+=en?' Location or source corrections are not conveyed to Muse. The image may contain place names or locations.':' 場所・確認先の訂正はMuseには伝わりません。画像には地名や地点が映る場合があります。';target.textContent+=' '+data.value.map((row,index)=>`${index+1}. ${items[row.item]} / ${states[row.status]} / ${new Date(row.observedAt).toLocaleString(en?'en':'ja-JP')} → ${new Date(row.expiresAt).toLocaleString(en?'en':'ja-JP')}${row.correctionIndex!==null?(en?` / corrects ${row.correctionIndex+1}`:` ／ 報告${row.correctionIndex+1}の訂正`):row.correctionTargetOmitted?(en?' / correction target omitted':' ／ 訂正元は未送信'):''}`).join(' ; ')}
  updateConsultButton();
}
function updateConsultButton(){$('consult-map').disabled=!!pendingConsultAudit||mapConsultBusy||!real||!realMap||mapAreaState!=='ready'||mapCapability!==true||(mapFloodCapability&&facilityFlood?.state==='loading')||(!!$('consult-use-observation').checked&&(!mapObservationCapability||!mapRefsCapability||!consultObservationValue()))||(!!$('consult-use-field').checked&&(!mapFieldReportsCapability||!mapRefsCapability||!consultFieldValue()))||(!!$('consult-use-facility').checked&&(!mapFacilityReportsCapability||!mapRefsCapability||!consultFacilityValue()))||(!!$('consult-use-bulletin').checked&&(!mapBulletinCapability||!mapRefsCapability||!consultBulletinValue()))||(!!$('consult-use-infrastructure').checked&&(!mapInfrastructureCapability||!mapRefsCapability||!consultInfrastructureData()))}
$('consult-use-observation').addEventListener('change',()=>{const value=consultObservationValue();consultObservationConsent=$('consult-use-observation').checked&&value?JSON.stringify(value):null;consultObservationCleared=false;mapConsultation?.invalidate();renderConsultObservation()});
for(const kind of ['field','facility','infrastructure'])$(`consult-use-${kind}`).checked=false;
$('consult-use-field').addEventListener('change',()=>{consultReportConsents.field=$('consult-use-field').checked?reportConsentSignature('field'):null;$('consult-report-consent-status').textContent='';delete $('consult-report-consent-status').dataset.active;reconcileReportConsents();mapConsultation?.invalidate();renderConsultField()});
$('consult-use-facility').addEventListener('change',()=>{consultReportConsents.facility=$('consult-use-facility').checked?reportConsentSignature('facility'):null;$('consult-report-consent-status').textContent='';delete $('consult-report-consent-status').dataset.active;reconcileReportConsents();mapConsultation?.invalidate();renderConsultFacility()});
$('consult-use-infrastructure').addEventListener('change',()=>{consultReportConsents.infrastructure=$('consult-use-infrastructure').checked?reportConsentSignature('infrastructure'):null;$('consult-report-consent-status').textContent='';delete $('consult-report-consent-status').dataset.active;reconcileReportConsents();mapConsultation?.invalidate();renderConsultInfrastructure()});
for(const id of ['welcome-language','map-language'])$(id)?.addEventListener('change',()=>queueMicrotask(()=>{if($('consult-report-consent-status').dataset.active==='true')showReportConsentNotice();if($('consult-bulletin-consent-status').dataset.active==='true')showBulletinConsentNotice()}));
$('consult-use-bulletin').addEventListener('change',()=>{$('consult-bulletin-consent-status').textContent='';delete $('consult-bulletin-consent-status').dataset.active;mapConsultation?.invalidate();renderConsultBulletin()});
const refreshConsultField=()=>{reconcileReportConsents();if(consultFieldSnapshot&&JSON.stringify(consultFieldSnapshot)!==JSON.stringify(consultFieldValue()))mapConsultation?.invalidate();renderConsultField()};
if(typeof MutationObserver==='function')new MutationObserver(refreshConsultField).observe($('flood-comparison-reports'),{childList:true,subtree:true,characterData:true});
window.addEventListener?.('storage',event=>{if(event.key?.endsWith(':flood-field-v1'))refreshConsultField()});
setInterval(()=>{if($('consult-use-field').checked)refreshConsultField()},30000);
const refreshConsultFacility=()=>{reconcileReportConsents();if(consultFacilitySnapshot&&(consultFacilitySnapshot.selectionVersion!==facilitySelectionVersion||JSON.stringify(consultFacilitySnapshot.value)!==JSON.stringify(consultFacilityValue())))mapConsultation?.invalidate();renderConsultFacility()};
if(typeof MutationObserver==='function')new MutationObserver(refreshConsultFacility).observe($('facility-report-current'),{childList:true,subtree:true,characterData:true});
window.addEventListener?.('storage',event=>{if(event.key?.endsWith(':report-v2'))refreshConsultFacility()});
setInterval(()=>{if($('consult-use-facility').checked)refreshConsultFacility()},30000);
const refreshConsultInfrastructure=()=>{reconcileReportConsents();if(consultInfrastructureSnapshot&&consultInfrastructureSnapshot!==reportConsentSignature('infrastructure'))mapConsultation?.invalidate();renderConsultInfrastructure()};
if(typeof MutationObserver==='function')new MutationObserver(refreshConsultInfrastructure).observe($('pilot-infrastructure-reports'),{childList:true,subtree:true,characterData:true});
window.addEventListener?.('storage',event=>{if(event.key?.startsWith('muse-infrastructure-reports-v1:'))refreshConsultInfrastructure()});
setInterval(()=>{if($('consult-use-infrastructure').checked)refreshConsultInfrastructure()},30000);
setInterval(()=>{if(consultBulletinCandidate)refreshConsultBulletin()},30000);
function consultUncertainMessage(en){
  const reason=consultUncertainKind==='input_rejected'?(en?'The server rejected the input; review the information and deadlines.':'サーバーが入力を受け付けませんでした。内容と期限を確認してください。'):consultUncertainKind==='consultation_failed'?(en?'The Muse consultation failed.':'Museの相談に失敗しました。'):(en?'The previous consultation outcome is unknown.':'前回の相談結果は不明です。');
  return reason+(en?' Information may have reached Meta.':' 情報はMetaに到達した可能性があります。');
}
function syncConsult(){
  updateConsultButton();
  const en=document.documentElement?.lang==='en',refsInfo=$('consult-refs-info');if(refsInfo)refsInfo.textContent=mapCapability===null?(en?'Checking support for input reference IDs.':'入力参照IDの送信に対応しているか確認中です。'):mapRefsCapability?(en?'Input reference IDs are also sent to Muse. IDs do not prove factual accuracy.':'入力を識別するIDもMuseに送ります。IDの一致は内容の正しさを保証しません。'):(en?'This server does not send input reference IDs to Muse.':'このサーバーでは入力参照IDをMuseへ送信しません。');
  if(!mapConsultBusy)$('consult-status').textContent=pendingConsultAudit?(en?'Save or discard the unsaved record before a new consultation. ':'未保存の記録を保存または破棄すると、次の相談ができます。')+(consultMayHaveReachedMeta?consultUncertainMessage(en):''):consultMayHaveReachedMeta?consultUncertainMessage(en):mapCapability===null?'利用できる接続を確認中':mapCapability===false?'新しい作品サーバーで利用できます。':!real?'Muse未接続のため利用できません。':!realMap?'地図を準備中です。':mapAreaState!=='ready'?'地域の位置を確認できてから相談できます。':mapFloodCapability&&facilityFlood?.state==='loading'?'施設の洪水想定を確認中です。確認後に相談できます。':'画像の観察と確認順を相談できます。';renderConsultObservation();renderConsultField();refreshConsultFacility();refreshConsultBulletin();refreshConsultInfrastructure();
}
function checkMapCapability(){
  if(mapCapabilityPromise)return;
  mapCapabilityPromise=fetch('/api/map-capabilities',{signal:AbortSignal.timeout(5000)}).then(r=>r.ok?r.json():null).then(data=>{mapCapability=data?.mapConsult===true;mapRefsCapability=data?.mapConsultRefs===true;mapObservationCapability=data?.mapConsultObservation===true;mapObservationReferenceKindCapability=data?.mapConsultObservationReferenceKind===true;mapObservationAccumulatedRainCapability=data?.mapConsultObservationAccumulatedRain===true;mapObservationTotalsOnlyCapability=data?.mapConsultObservationTotalsOnly===true;mapFieldReportsCapability=data?.mapConsultFieldReports===true;mapFacilityReportsCapability=data?.mapConsultFacilityReports===true;mapBulletinCapability=data?.mapConsultBulletin===true;mapInfrastructureCapability=data?.mapConsultInfrastructureReports===true;mapPlanAvailable=data?.mapPlan===true;mapPlanEvidenceCapable=data?.mapPlanEvidence===true;mapFloodCapability=data?.mapFloodContext===true;mapFleetPlanAvailable=data?.fleetPlan===true;mapFleetEvidenceV2=data?.fleetEvidenceV2===true;mapFleetEvidenceV3=data?.fleetEvidenceV3===true}).catch(()=>{mapCapability=false;mapRefsCapability=false;mapObservationCapability=false;mapObservationReferenceKindCapability=false;mapObservationAccumulatedRainCapability=false;mapObservationTotalsOnlyCapability=false;mapFieldReportsCapability=false;mapFacilityReportsCapability=false;mapBulletinCapability=false;mapInfrastructureCapability=false;mapPlanAvailable=false;mapFloodCapability=false;mapFleetPlanAvailable=false;mapFleetEvidenceV2=false;mapFleetEvidenceV3=false}).finally(()=>{syncConsult();syncMapPlan();renderConsultFlood()});
}
function syncMapPlan(){
  syncFleetSelect();
  const buildings=mapSourceEvidence?.buildings,buildingReady=buildings==='available',message=$('map-building-start-status'),en=document.documentElement?.lang==='en';
  message.hidden=mapAreaState!=='ready'||buildingReady;
  message.textContent=buildingReady?'':buildings==='loading'?(en?'Loading the building model. The simulation can start when it is ready.':'建物モデルを読み込み中です。準備ができるまでお待ちください。'):(en?'The building model is unavailable or unconfirmed. Refresh the map data before starting.':'建物モデルを取得できないか未確認です。地図データを再取得してください。');
  $('map-sim-start').disabled=!buildingReady||largeFleetBusy||largeFleetLaunching||!!(largeFleetSession?.attempted&&!largeFleetSession.saved&&!largeFleetSession.discarded)||mapFleetActive||!['ready','complete','surface-unavailable','preflight-blocked','preflight-unavailable','direct-unavailable','detour-unavailable','error'].includes(mapPlanPhase);
  const side=mapPlanChoice||'A',other=side==='A'?'B':'A',blocked=!canReplayMapRoute(mapProbeReports,side);
  $('map-sim-consult').disabled=mapPlanPhase!=='obstacle'||!real||!mapPlanAvailable||!!mapPlanController||mapProbeBusy;
  if(mapPlanPhase!=='obstacle')$('map-dock-consult').textContent='Museに相談';
  $('map-dock-actions').hidden=mapPlanPhase!=='obstacle';
  $('map-dock-consult').disabled=$('map-sim-consult').disabled;
  for(const choice of ['A','B']){const output=$(`map-route-${choice.toLowerCase()}`),text=mapRouteSummary(mapProbeReports,choice,mapProbeBusy);if(output.textContent!==text)output.textContent=text}
  for(const choice of ['A','B']){const button=$(`map-dock-${choice.toLowerCase()}`);button.disabled=mapPlanPhase!=='obstacle'||mapProbeBusy||!!mapPlanController||!canReplayMapRoute(mapProbeReports,choice);button.textContent=`仮想案${choice}を再生${mapPlanChoice===choice?`（${mapPlanSourceLabel(mapPlanChoiceProvenance)}）`:''}`}
  $('map-dock-stop').hidden=!mapFleetActive&&!['preflight','preflight-blocked','preflight-unavailable','direct-unavailable','detour-unavailable','direct','obstacle','detour','surface-check','surface-unavailable','delivery'].includes(mapPlanPhase);
  $('map-sim-detour').disabled=mapPlanPhase!=='obstacle'||!!mapPlanController||mapProbeBusy||blocked;
  $('map-sim-probe').hidden=mapPlanPhase!=='obstacle';$('map-sim-probe').disabled=mapProbeBusy||!!mapPlanController;
  $('map-sim-alternate').hidden=mapPlanPhase!=='obstacle'||!blocked;$('map-sim-alternate').disabled=mapProbeBusy||!!mapPlanController||!canReplayMapRoute(mapProbeReports,other);
  $('map-sim-detour').textContent=`仮想案${side}を再生`;$('map-sim-alternate').textContent=`仮想案${other}を再生（手動）`;$('map-probe-choice').hidden=mapPlanPhase!=='obstacle'||!blocked;
  const report=mapProbeReports?.[side];
  $('map-probe-choice').textContent=!blocked?'':mapProbeBusy?'3Dモデルを点検中です。':mapProbeReports?.stale?'建物データを取得できないため再生を止めています。':!report?'3Dモデルの点検結果がないため再生を止めています。':report.blockedIndices?.length?`仮想案${side}は点検地点で仮想高度付近以上の表面が見つかったため再生を止めています。`:report.unknown>0?`仮想案${side}の点検地点に高さ不明な箇所があるため再生を止めています。`:Number.isFinite(report.maxGap)&&report.maxGap>29?`仮想案${side}は点検地点の間隔が広いため再生を止めています。`:`仮想案${side}の点検結果が不十分なため再生を止めています。`;
  $('map-probe-status').hidden=mapPlanPhase!=='obstacle';
  $('map-probe-legend').hidden=mapPlanPhase!=='obstacle'||!mapProbeReports||!!mapProbeReports.stale;
  $('map-sim-consult').hidden=mapPlanPhase!=='obstacle';$('map-sim-detour').hidden=mapPlanPhase!=='obstacle';$('map-sim-privacy').hidden=mapPlanPhase!=='obstacle';$('map-sim-consult-status').hidden=!['obstacle','detour','surface-check','delivery','complete'].includes(mapPlanPhase);
  if(mapPlanPhase==='obstacle'&&!mapPlanAvailable)$('map-sim-consult-status').textContent='このサーバーではMuse相談を利用できません。点検結果に応じて仮想案を手動で選べます。';
  if(mapPlanPhase==='obstacle'&&mapPlanAvailable&&!mapPlanEvidenceCapable&&$('map-sim-consult-result').hidden)$('map-sim-consult-status').textContent='このサーバーは点検数値の送信に対応していません。自動判断は行わず、相談結果は参考表示のみです。';
  if(mapPlanPhase==='obstacle'&&mapPlanAvailable&&mapPlanEvidenceCapable&&!mapPlanController&&!mapProbeBusy&&!detourEvidencePayload(mapProbeReports)&&$('map-sim-consult-result').hidden)$('map-sim-consult-status').textContent='点検結果が不足・古いため自動判断を行いません。3D建物モデルを再点検してください。';
  syncGuide();
}
function realMapSceneChanged(reason){mapScan?.invalidate();mapConsultation?.invalidate();const cameraReason=reason==='camera'||reason==='camera-own';const touched=realMap?.isViewTouched?.()===true;if(((reason!=='camera'&&reason!=='camera-own')||(reason==='camera'&&mapPlanController))&&!(cameraReason&&mapPlanCameraGuard&&!touched))invalidateMapPlan(reason||'scene')}
const mapPlanInvalidateReasons={scene:'scene・画面や地域の変更',camera:'camera・カメラの変更',phase:'phase・状態の変化',view:'view・応答後の画面不一致',stale:'stale・古い相談の破棄',restart:'restart・相談の再開始'};
function invalidateMapPlan(reason='scene',detail=''){
  if(!mapPlanController&&!mapPlanChoice)return;
  mapPlanVersion++;mapPlanCameraGuard=false;realMap?.setViewLock?.(false);mapPlanController?.abort();mapPlanController=null;mapPlanChoice=null;mapPlanCandidate=null;$('map-sim-consult-result').hidden=true;
  clearMapSpeech();
  $('map-sim-consult-status').textContent='画面または試験が変わったため、前の相談結果を消しました。';$('map-radio-live').textContent='画面が変わったため、前の相談を終了しました。';teamLog(`診断：相談の無効化（理由：${mapPlanInvalidateReasons[reason]||reason}${detail?`：${detail}`:''}）。`);syncMapPlan();
}
function describePlanViewChange(sentView){
  try{
    const now=realMap.capture({includeVirtualMarker:true});
    if(!now||!now.view)return '応答時の画面を再取得できず';
    return describeViewFrameChange(sentView,now.view);
  }catch{return '応答時の画面を再取得できず'}
}
function teamShareLog(message){teamLog(message);mapTeamShareEvents.unshift({at:new Date().toISOString(),text:message});mapTeamShareEvents=mapTeamShareEvents.slice(0,5);}
function teamLog(message){
  mapTeamLog.unshift(`${new Date().toLocaleString('ja-JP')} ${message}`);
  mapTeamLog=mapTeamLog.slice(0,20);
  const log=$('map-team-log');log.replaceChildren();
  for(const item of mapTeamLog){const row=document.createElement('li');row.textContent=item;log.append(row)}
}
function teamRecordKey(area){return `muse.teamDetour.${area}`}
function readTeamRecords(area,raw){
  if(raw===undefined)raw=localStorage.getItem(teamRecordKey(area));
  if(raw===null)return [];
  if(typeof raw!=='string'||raw.length>4000000)throw new Error('記録を確認できません');
  const parsed=JSON.parse(raw),records=Array.isArray(parsed)?parsed:[parsed];
  if(records.length>1000)throw new Error('記録が多すぎます');
  for(const record of records)if(!record||typeof record!=='object'||Array.isArray(record)||detourTeamRecord(record).area!==area)throw new Error('記録を確認できません');
  return records;
}
function facilityForRecord(flight){
  try{
    if(flight==='two'){const next=(typeof fleetDestination==='function')?fleetDestination():null;return next&&typeof next.name==='string'&&next.name?{name:next.name}:null}
    const place=shelterList[shelterChoice];return place&&typeof place.name==='string'&&place.name?{name:place.name}:null;
  }catch{return null}
}
function originForRecord(){
  try{const p=mapOriginPoint;return p&&Number.isFinite(p.latitude)&&Number.isFinite(p.longitude)?{latitude:p.latitude,longitude:p.longitude}:null}catch{return null}
}
function sourceSnapshotForRecord(){
  try{const e=mapSourceEvidence||{};return {buildings:String(e.buildings??'unknown'),shelters:String(e.shelters??'unknown'),weather:String(e.weather??'unknown'),risk:String(e.risk??'unknown'),mode:String(mapBuildingMode??'unknown')}}catch{return null}
}
let mapTeamRetryBusy=false,mapTeamRetrySucceeded=false,mapTeamRetryFailed=false;
async function persistTeamRecord(record){
  if(typeof localStorage==='undefined')throw new Error('保存機能がありません');
  const area=record.area,key=teamRecordKey(area);
  await updateLocalHistory({storage:localStorage,locks:navigator.locks,key,update:raw=>{
    const records=readTeamRecords(area,raw),matches=records.filter(item=>item.recordId===record.recordId);
    if(matches.length){if(matches.length===1&&JSON.stringify(matches[0])===JSON.stringify(record))return raw;throw new Error('同じIDの記録が一致しません')}
    if(records.length>=1000)throw new Error('記録が上限です');return JSON.stringify([...records,record]);
  }});
}
async function saveTeamRecord({side,state,reason,source,provenance,flight,evidence,reinspection}={}){
  let record=null;
  try{
    const area=$('map-area-title').textContent.replace(/ ／ 実地図$/,'');
    record=JSON.parse(JSON.stringify(detourTeamRecord({at:new Date().toLocaleString('ja-JP'),area,side,state,reason,source,provenance,flight,evidence,reinspection,facility:facilityForRecord(flight),origin:originForRecord(),inspectedAt:mapProbeInspectedAt,fetchedAt:mapFetchStartedAt,sources:sourceSnapshotForRecord(),shares:mapTeamShareEvents.map(entry=>({...entry}))})));
    record.recordId=globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await persistTeamRecord(record);
    if($('map-area-title').textContent.replace(/ ／ 実地図$/,'')===area)renderTeamPast();
    return true;
  }catch(error){if(record?.recordId){mapTeamUnsaved.push(record);mapTeamRetrySucceeded=false;mapTeamRetryFailed=false;renderTeamUnsaved()}renderTeamPast();return false}
}
function renderTeamUnsaved(){
  const n=mapTeamUnsaved.length,en=document.documentElement?.lang==='en';$('map-team-unsaved-banner').hidden=!n&&!mapTeamRetrySucceeded;$('map-team-unsaved-export').hidden=!n;$('map-team-unsaved-retry').hidden=!n;$('map-team-unsaved-retry').disabled=mapTeamRetryBusy;$('map-team-unsaved-dismiss').hidden=!!n||!mapTeamRetrySucceeded;
  $('map-team-unsaved-status').textContent=n?(mapTeamRetryBusy?(en?'Checking and saving results…':'保存を確認しています…'):(mapTeamRetryFailed?(en?`Retry could not confirm ${n} result(s). Check saved records and download before closing; the file may contain facility names and coordinates.`:`再試行でも保存を確認できません（${n}件）。保存内容を確認し、閉じる前に結果をファイルへ保存してください。施設名や座標を含む場合があります。`):(en?`${n} two-aircraft result(s) could not be confirmed saved. Retry or download before closing; the file may contain facility names and coordinates.`:`2機の配送結果${n}件の保存を確認できません。再試行するか、閉じる前にファイルへ保存してください。施設名や座標を含む場合があります。`))):(mapTeamRetrySucceeded?(en?'The results were saved on this device.':'結果をこの端末に保存しました。'):'');
  $('map-team-unsaved-retry').textContent=en?'Retry saving':'保存を再試行';$('map-team-unsaved-export').textContent=en?'Download results':'結果をファイルに保存';$('map-team-unsaved-dismiss').textContent=en?'Close':'閉じる';
}
async function retryTeamUnsaved(){
  if(mapTeamRetryBusy||!mapTeamUnsaved.length)return;
  mapTeamRetryBusy=true;mapTeamRetrySucceeded=false;mapTeamRetryFailed=false;renderTeamUnsaved();
  try{for(const record of [...mapTeamUnsaved]){try{await persistTeamRecord(record);mapTeamUnsaved=mapTeamUnsaved.filter(item=>item!==record)}catch{}}
    mapTeamRetrySucceeded=!mapTeamUnsaved.length;mapTeamRetryFailed=!!mapTeamUnsaved.length;renderTeamPast();
  }finally{mapTeamRetryBusy=false;renderTeamUnsaved()}
}
$('map-team-unsaved-retry').addEventListener('click',retryTeamUnsaved);
$('map-team-unsaved-dismiss').addEventListener('click',()=>{mapTeamRetrySucceeded=false;renderTeamUnsaved()});
$('map-team-unsaved-export').addEventListener('click',()=>{
  if(!mapTeamUnsaved.length)return;
  try{const blob=new Blob([JSON.stringify({kind:'two-aircraft-results-save-unconfirmed',records:mapTeamUnsaved},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='muse-two-aircraft-unsaved-results.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
  catch{ $('map-team-unsaved-status').textContent=document.documentElement?.lang==='en'?'Download failed. Keep this page open.':'ファイルに保存できませんでした。この画面を閉じずに確認してください。' }
});
window.addEventListener?.('beforeunload',event=>{if(mapTeamUnsaved.length){event.preventDefault();event.returnValue=''}});
function saveAndLog(record,okText,failText){
  const generation=mapTeamSaveGen,key=`${generation}:one`,terminal=record?.flight==='one'&&!record.interim;
  const promise=saveTeamRecord(record).then(ok=>{if(ok&&terminal&&mapTeamSaveGen===generation)mapTeamSavedKey=key;teamLog(ok?okText:failText);return ok});
  if(terminal){mapTeamSavingOne={key,promise};promise.finally(()=>{if(mapTeamSavingOne?.promise===promise)mapTeamSavingOne=null})}
  return promise;
}
function renderTeamPast(){
  let note='',available=false;const en=document.documentElement?.lang==='en';
  try{
    if(typeof localStorage!=='undefined'){
      const area=$('map-area-title').textContent.replace(/ ／ 実地図$/,'');
      const kept=[],dropped=[];let rawBroken=false;const rawStore=localStorage.getItem(teamRecordKey(area));available=rawStore!==null;if(rawStore!==null){try{const data=JSON.parse(rawStore);for(const r of Array.isArray(data)?data:[data]){try{if(!r||typeof r!=='object'||Array.isArray(r)||detourTeamRecord(r).area!==area)throw new Error('record');kept.push(r)}catch{dropped.push(r)}}}catch{rawBroken=true}}
      if(kept.length){
        const latest=kept[kept.length-1],first=latest.flight==='two'?[...kept].reverse().find(record=>(record.flight||'one')==='one'):null;
        note=pastDetourNote(latest,area)+(first?(en?' Latest first-aircraft record (may be a different run): ':' 直近の1号機記録（別の配送の場合あり）：')+pastDetourNote(first,area):'')+(kept.length>(first?2:1)?`（ほか${kept.length-(first?2:1)}件の記録あり）`:'')+(dropped.length?(en?` (${dropped.length} unreadable records omitted; new saving is stopped)`:`（読み取れない記録${dropped.length}件を除く。新しい保存は停止します）`):'');
      }else if(rawBroken||dropped.length)note=en?'Saved records cannot be read. They are preserved, and new saving is stopped.':'保存された記録を読み取れません。上書きせず保持し、新しい保存を停止します。';
      if(kept.length>=1000)note+=en?' Storage limit reached; additional results cannot be saved.':' 記録が1000件に達したため、新しい結果は保存できません。';
      if(rawStore!==null&&rawStore.length>4000000)note+=en?' Stored data exceeds the size limit; additional results cannot be saved.':' 保存データが上限を超えているため、新しい結果は保存できません。';
    }
  }catch(error){note=''}
  $('map-team-past').textContent=note;
  $('map-team-past').hidden=!note;
  $('map-team-export').hidden=!available;
}
$('map-team-export').addEventListener('click',()=>{
  const en=document.documentElement?.lang==='en',status=$('map-team-export-status');
  try{
    const area=$('map-area-title').textContent.replace(/ ／ 実地図$/,''),raw=localStorage.getItem(teamRecordKey(area));if(raw===null)throw new Error('no record');
    const url=URL.createObjectURL(new Blob([raw],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='muse-two-aircraft-records.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    status.textContent=en?'Download started. The file can contain facility names and coordinates; review before sharing.':'保存を開始しました。ファイルには施設名や座標が含まれる場合があります。共有前に確認してください。';
  }catch{status.textContent=en?'Could not download the stored record.':'保存済みの記録をファイルに保存できません。'}
});
for(const id of ['welcome-language','map-language'])$(id)?.addEventListener('change',()=>queueMicrotask(()=>{renderTeamPast();renderTeamUnsaved()}));
function shareHazardsWithSecond(){
  if(!realMap?.getSharedHazards)return;
  let hazards=[];
  try{hazards=realMap.getSharedHazards()||[]}catch(error){return}
  const key=JSON.stringify(hazards);
  if(key===mapTeamSharedKey)return;
  mapTeamSharedKey=key;
  const secondNext=(typeof fleetDestination==='function')?fleetDestination():null;
  if(!hazards.length){teamShareLog('共有：高い表面の点検結果なし（不明は安全を意味しない）。2号機への共有事項はない。');return}
  const relevance=(mapOriginPoint&&secondNext)?detourRelevanceForSecond(hazards,mapOriginPoint,secondNext):{near:false,count:hazards.length,nearestM:null};
  const kinds=[...new Set(hazards.map(h=>h.source))].join('・');
  if(!mapOriginPoint||!secondNext){teamShareLog(`共有：高い表面${hazards.length}点（${kinds}）。2号機の経路が未確定のため関連性を確認できない。2号機の飛行前点検で確認する。`);return}
  if(!relevance.near){teamShareLog(`共有：高い表面${hazards.length}点（${kinds}）は2号機（→${secondNext.name}）の経路300m以内になし（最短約${relevance.nearestM===null?'不明':relevance.nearestM+'m'}）。2号機の飛行前点検でも確認する。`);return}
  teamShareLog(`共有：高い表面${hazards.length}点（${kinds}）のうち2号機（→${secondNext.name}）の経路から約${relevance.nearestM}mにあり。`);
  if(!mapFleetActive){teamShareLog('反応：2号機は飛行していない。次回飛行前の点検で確認する。');return}
  const reason=`1号機と共有した高い表面が2号機の経路付近（約${relevance.nearestM}m）のため自動で中止しました`;
  mapTeamFleetSaved=`${secondNext.name}:stopped`;
  saveAndLog({side:'none',state:'stopped',reason:`2号機（→${secondNext.name}）：${reason}`,source:'auto',flight:'two',evidence:detourEvidencePayload(mapProbeReports)},`反応：${reason}。結果を端末に保存した。`,`反応：${reason}。端末への保存に失敗した（表示のみ）。`);
  try{realMap.stopSecondFlight?.(reason)}catch(error){}
}
function resolveTeamPending(phase,message){if(['needs-points','ready','preflight'].includes(phase))mapProbeInspectedAt=null;
  if(mapTeamPending){
    const pending=mapTeamPending;
    if(phase==='complete'){
      mapTeamPending=null;
      saveAndLog({side:pending.side,state:'accepted',reason:`${pending.reason} 仮想便は完了まで再生した。安全は未確認。`,source:mapPlanRecordedSource(pending.provenance),provenance:pending.provenance||'unknown',flight:'one',evidence:pending.evidence,reinspection:pending.reinspection},`確定：仮想案${pending.side}は完了まで再生した。結果を端末に保存した。`,`確定：仮想案${pending.side}は完了まで再生したが、端末への保存に失敗した（表示のみ）。`);
      return true;
    }
    if(['preflight-blocked','preflight-unavailable','direct-unavailable','detour-unavailable','surface-unavailable','error'].includes(phase)){
      mapTeamPending=null;
      saveAndLog({side:pending.side,state:'stopped',reason:message||'仮想移動を中止しました',source:mapPlanRecordedSource(pending.provenance),provenance:pending.provenance||'unknown',flight:'one',evidence:pending.evidence,reinspection:pending.reinspection},`確定：仮想案${pending.side}は停止。結果を端末に保存した。理由：${message||'仮想移動を中止しました'}`,`確定：仮想案${pending.side}は停止。端末への保存に失敗した（表示のみ）。理由：${message||'仮想移動を中止しました'}`);
      return true;
    }
    if(['needs-points','ready'].includes(phase))mapTeamPending=null;
    return null;
  }
  if(mapTeamSavedKey===`${mapTeamSaveGen}:one`||mapTeamSavingOne?.key===`${mapTeamSaveGen}:one`)return null;
  if(phase==='complete'&&mapDetourEvidence?.side){
    saveAndLog({side:mapDetourEvidence.side,state:'accepted',reason:'手動選択の仮想案で仮想の荷下ろしが終了（自動検証なし）。安全は未確認。',source:'manual',flight:'one',evidence:detourEvidencePayload(mapProbeReports)},`確定：仮想案${mapDetourEvidence.side}（手動選択）は完了まで再生した。結果を端末に保存した。`,`確定：仮想案${mapDetourEvidence.side}（手動選択）は完了まで再生したが、端末への保存に失敗した（表示のみ）。`);
    return true;
  }
  if(['preflight-blocked','preflight-unavailable','direct-unavailable','detour-unavailable','surface-unavailable','error'].includes(phase)&&mapDetourEvidence?.side){
    saveAndLog({side:mapDetourEvidence.side,state:'stopped',reason:message||'仮想移動を中止しました',source:'manual',flight:'one',evidence:detourEvidencePayload(mapProbeReports)},`確定：仮想案${mapDetourEvidence.side}（手動選択）は停止。結果を端末に保存した。理由：${message||'仮想移動を中止しました'}`,`確定：仮想案${mapDetourEvidence.side}（手動選択）は停止。端末への保存に失敗した（表示のみ）。理由：${message||'仮想移動を中止しました'}`);
    return true;
  }
  if(mapTeamSavedKey===`${mapTeamSaveGen}:one`)return null;
  if(phase==='complete'){
    saveAndLog({side:'none',state:'accepted',reason:'迂回案を使わず仮想の荷下ろしが終了。安全は未確認。',source:'manual',flight:'one',evidence:detourEvidencePayload(mapProbeReports)},'確定：迂回案を使わず完了まで再生した。結果を端末に保存した。','確定：迂回案を使わず完了まで再生したが、端末への保存に失敗した（表示のみ）。');
    return true;
  }
  if(['preflight-blocked','preflight-unavailable','direct-unavailable','detour-unavailable','surface-unavailable','error'].includes(phase)){
    saveAndLog({side:'none',state:'stopped',reason:message||'仮想移動を中止しました',source:'manual',flight:'one',evidence:detourEvidencePayload(mapProbeReports)},`確定：迂回案を使わず停止。結果を端末に保存した。理由：${message||'仮想移動を中止しました'}` ,`確定：迂回案を使わず停止。端末への保存に失敗した（表示のみ）。理由：${message||'仮想移動を中止しました'}`);
    return true;
  }
  return null;
}
function handleProbeReady(reports){
  mapProbeBusy=false;mapProbeReports=reports;shareHazardsWithSecond();maybeAutoConsult();
}
function maybeAutoConsult(){
  if(mapPlanPhase!=='obstacle'||mapPlanController||mapPlanChoice)return;
  const reports=mapProbeReports;
  if(!reports||reports===mapPlanAutoKey)return;
  if(!real||!mapPlanAvailable){mapPlanAutoKey=reports;const message=!real?'Muse未接続のため自動相談しません。停止したままです。':'このサーバーではMuse相談を利用できません。点検結果に応じて仮想案を手動で選べます。';$('map-sim-consult-status').textContent=message;teamLog(`自動相談なし：${message}`);return}
  if(!mapPlanEvidenceCapable||!detourEvidencePayload(reports)){mapPlanAutoKey=reports;const message=!mapPlanEvidenceCapable?'このサーバーは点検数値の送信に対応していません。自動判断は行わず、相談結果は参考表示のみです。':'点検結果が不足・古いため自動判断を行いません。3D建物モデルを再点検してください。';$('map-sim-consult-status').textContent=message;teamLog(`自動相談なし：${message}`);return}
  mapPlanAutoKey=reports;
  runMapConsult({automatic:true});
}
$('map-sim-consult').addEventListener('click',()=>{mapPlanAutoKey=mapProbeReports;runMapConsult({automatic:false})});
async function waitForStableWide(id,controller,limitMs=6000){
  const start=Date.now();
  for(;;){
    if(id!==mapPlanVersion||controller.signal.aborted||!realMode||mapPlanPhase!=='obstacle')return {ok:false,silent:true};
    if(realMap.isViewTouched?.())return {ok:false,reason:'撮影前に地図を操作したため相談を中止しました'};
    const frame=realMap.capture({includeVirtualMarker:true});
    if(realMap.isViewCurrent(frame.view))return {ok:true,frame};
    if(Date.now()-start>limitMs)return {ok:false,reason:'街全体への切替が安定しないため相談を中止しました'};
    await new Promise(resolve=>setTimeout(resolve,300));
  }
}
async function runMapConsult({automatic=false}={}){
  if(!realMode||!realMap||!real||!mapPlanAvailable||mapPlanPhase!=='obstacle'||mapPlanController)return;
  invalidateMapPlan('restart');
  const id=++mapPlanVersion,controller=new AbortController();mapPlanController=controller;mapPlanChoice=null;mapPlanCameraGuard=true;realMap.clearViewTouched?.();realMap.setViewLock?.(true);$('map-sim-consult-result').hidden=true;
  let wideFrame=null;
  if(realMap.cameraMode()!=='wide'){
    if(!automatic){
      mapPlanController=null;
      mapPlanCameraGuard=false;realMap.setViewLock?.(false);realMap.chooseCamera('wide');
      const message='街全体に切り替えました。もう一度「Museに相談」を押すと画像を送信します。';
      $('map-sim-consult-status').textContent=message;$('map-radio-live').textContent=message;$('map-dock-consult').textContent='もう一度押してMuseに相談';return;
    }
    realMap.clearViewTouched?.();
    realMap.chooseCamera('wide','one',true);
    const settled=await waitForStableWide(id,controller);
    if(!settled.ok){if(id!==mapPlanVersion||controller.signal.aborted)return;mapPlanCameraGuard=false;realMap.setViewLock?.(false);mapPlanController=null;if(!settled.silent){const message=settled.reason;$('map-sim-consult-status').textContent=message;$('map-radio-live').textContent=message;teamLog(`相談の中止：${settled.reason}`)}syncMapPlan();return}
        if(id!==mapPlanVersion||controller.signal.aborted){if(mapPlanController&&mapPlanController!==controller)return;invalidateMapPlan('stale');return}
    wideFrame=settled.frame;
    teamLog('相談のため街全体に切り替え、安定を確認して撮影する（制御側の移動）。');
  }
  $('map-dock-consult').textContent='Museに相談';
  const evidence=detourEvidencePayload(mapProbeReports);
  const second=`2号機の状況：${$('map-fleet-state').textContent||'待機中'}`;
  if(mapPlanEvidenceCapable&&!evidence){if(id!==mapPlanVersion)return;mapPlanCameraGuard=false;realMap.setViewLock?.(false);mapPlanController=null;
    const message='点検結果が不足・古いため、自動判断を行わず停止したままです。3D建物モデルを再点検してください。';
    $('map-sim-consult-status').textContent=message;$('map-radio-live').textContent=message;teamLog(`共有の失敗：${message}${second}。`);syncMapPlan();return;
  }

  $('map-sim-consult-status').textContent=evidence?'画像と点検数値（A/B案ごとの点数・取得数・不明数・高い表面数・最大間隔）をMuseに送り、相談中です。上限60秒で取り消せます。':'画像をMuseに送り、相談中です。このサーバーは点検数値に対応していないため、自動判断は行いません。';
  $('map-radio-live').textContent='地図画像をMuseに送り、相談中です。';syncMapPlan();
  teamShareLog(evidence?`共有：A案${evidence.A.observed}/${evidence.A.total}点・不明${evidence.A.unknown}・高${evidence.A.blocked}・間隔${evidence.A.maxGap}m、B案${evidence.B.observed}/${evidence.B.total}点・不明${evidence.B.unknown}・高${evidence.B.blocked}・間隔${evidence.B.maxGap}m。${second}。`:'共有：画像のみ（点検数値なし）。自動判断は行わない。');
  try{
    const frame=wideFrame||realMap.capture({includeVirtualMarker:true}),capturedAt=new Date().toLocaleString('ja-JP');
    const response=await api('map-plan',evidence?{image:frame.image,evidence}:{image:frame.image},AbortSignal.any([controller.signal,AbortSignal.timeout(60000)]),true);
    const result=response?.result,provenance=['muse','fixture'].includes(response?.provenance)?response.provenance:'unknown',responseLabel=mapPlanSourceLabel(provenance);
    if(id!==mapPlanVersion)return;
    if(!realMode||mapPlanPhase!=='obstacle'||!realMap.isViewCurrent(frame.view)){const viewReason=mapPlanPhase!=='obstacle'?'phase':(!realMode?'scene':'view');invalidateMapPlan(viewReason,viewReason==='view'?describePlanViewChange(frame.view):'');return}
    const choices=evidence?['A','B','none']:['A','B'];
    if(!choices.includes(result?.sora)||!choices.includes(result?.nagi))throw new Error('Museの回答が不正です');
    let validation=null;
    if(evidence){
      if(!['accepted','rejected','stopped'].includes(result?.validation?.state)||typeof result?.validation?.reason!=='string'||!result.validation.reason)throw new Error('Museの回答が不正です');
      validation=result.validation;
    }
    teamLog(`提案（${responseLabel}）：ソラは仮想案${result.sora}、ナギは仮想案${result.nagi}。`);
    if(!evidence){
      const text=`${responseLabel}。ソラ：仮想案${result.sora}を提案。ナギ：仮想案${result.nagi}を選択（参考・自動判断なし）。`;const preview=$('map-sim-preview');preview.width=frame.canvas.width;preview.height=frame.canvas.height;preview.getContext('2d').drawImage(frame.canvas,0,0);$('map-sim-dialogue').textContent=`${capturedAt}の画像：${text}`;$('map-sim-consult-result').hidden=false;
      mapPlanHistory.unshift(`${new Date().toLocaleString('ja-JP')} ${$('map-area-title').textContent} — ${text}`);mapPlanHistory=mapPlanHistory.slice(0,5);$('map-sim-history').replaceChildren();for(const item of mapPlanHistory){const row=document.createElement('p');row.textContent=item;$('map-sim-history').append(row)}
      $('map-sim-consult-status').textContent=`${responseLabel}：仮想案${result.nagi}（参考表示）。自動判断は行わないため、再生は手動で選べます。安全性は未確認です。`;
      $('map-radio-live').textContent=`${capturedAt}の画像への選択（${responseLabel}・参考）\nソラ：仮想案${result.sora}を提案\nナギ：仮想案${result.nagi}を選択\n文章は選択結果から作成`;
      showMapSpeech(`アプリの定型字幕（${responseLabel}）`,`ソラの提案：仮想案${result.sora}。`,'ソラ');if(mapSound&&'speechSynthesis'in window)showMapSpeech(`アプリの定型字幕（${responseLabel}）`,`ナギの選択：仮想案${result.nagi}。`,'ナギ');else{if(mapSubtitleTimer!==null)clearTimeout(mapSubtitleTimer);mapSubtitleTimer=setTimeout(()=>{mapSubtitleTimer=null;showMapSpeech(`アプリの定型字幕（${responseLabel}）`,`ナギの選択：仮想案${result.nagi}。`,'ナギ')},2800)}
      return;
    }
    if(result.nagi==='none'||validation.state!=='accepted'){
      const message=`アプリの検証（${responseLabel}）：${summarizeDetourValidation(validation)} 理由：${validation.reason} 停止したままです。`;
      $('map-sim-consult-status').textContent=message;$('map-radio-live').textContent=`${responseLabel}をアプリが点検し、不採用または候補なしのため停止したままです。理由：${validation.reason}`;
      teamLog(`検証：${summarizeDetourValidation(validation)} 理由：${validation.reason} 自動迂回しません。`);
      saveAndLog({side:result.nagi,state:validation.state,reason:validation.reason,source:mapPlanRecordedSource(provenance),provenance,flight:'one',interim:true,evidence},`確定：仮想案${result.nagi}は${summarizeDetourValidation(validation)}。結果を端末に保存した。`,`確定：仮想案${result.nagi}は${summarizeDetourValidation(validation)}。端末への保存に失敗した（表示のみ）。`);
      return;
    }
    const hazards=realMap.getSharedHazards?realMap.getSharedHazards():[];
    const secondNext=fleetDestination();
    const relevance=(mapOriginPoint&&secondNext)?detourRelevanceForSecond(hazards,mapOriginPoint,secondNext):{near:false,count:(hazards||[]).length,nearestM:null};
    if(!mapOriginPoint||!secondNext)teamShareLog(`共有の関連：2号機の経路が未確定のため関連性を確認できない（共有した高い表面${relevance.count}点）。2号機の飛行前点検で確認する。`);
    else if(relevance.near){
      teamShareLog(`共有の関連：2号機（→${secondNext.name}）の経路から約${relevance.nearestM}mに共有した高い表面あり。`);
      if(mapFleetActive){
        const reason=`1号機と共有した高い表面が2号機の経路付近（約${relevance.nearestM}m）のため自動で中止しました`;
        mapTeamFleetSaved=`${secondNext.name}:stopped`;
        saveAndLog({side:'none',state:'stopped',reason:`2号機（→${secondNext.name}）：${reason}`,source:'auto',flight:'two'},`反応：${reason}。結果を端末に保存した。`,`反応：${reason}。端末への保存に失敗した（表示のみ）。`);
        realMap.stopSecondFlight?.(reason);
      }else teamShareLog('反応：2号機は飛行していない。次回飛行前の点検で確認する。');
    }else teamShareLog(`共有の関連：2号機（→${secondNext.name}）の経路300m以内に共有すべき高い表面なし（共有${relevance.count}点・最短約${relevance.nearestM===null?'不明':relevance.nearestM+'m'}）。`);
    const secondHazards=(hazards||[]).filter(h=>h&&h.source==='second');
    if(secondHazards.length){
      teamShareLog(`共有（2→1）：2号機の経路で高い表面${secondHazards.length}点（1号機の高度180mでも上回る）。選択案の経路との関連を確認する。`);
      let detourPts=null;
      try{
        const dest=shelterList[shelterChoice];
        if(mapOriginPoint&&dest&&Number.isFinite(dest.latitude)&&Number.isFinite(dest.longitude))detourPts=routeSamplePoints(mapSimulationPath(mapOriginPoint,{latitude:dest.latitude,longitude:dest.longitude},result.nagi).detour).points;
      }catch(error){detourPts=null}
      const rel2=detourPts?hazardNearPointsM(secondHazards,detourPts):{near:false,count:secondHazards.length,nearestM:null};
      if(!detourPts||rel2.nearestM===null){
        const reason='2号機の共有地点と選択案の関連を確認できないため停止';
        $('map-sim-consult-status').textContent=reason;$('map-radio-live').textContent=reason;teamShareLog(`共有（2→1）：${reason}。`);
        saveAndLog({side:result.nagi,state:'rejected',reason,source:'auto',flight:'one',interim:true,evidence},`確定：${reason}。`,`記録の保存に失敗：${reason}。`);return;
      }
      else if(rel2.near){
        const reason=`2号機と共有した高い表面が選択案の経路付近（約${rel2.nearestM}m）のため自動迂回せず停止`;
        const message=`${reason}したままです。`;
        $('map-sim-consult-status').textContent=message;$('map-radio-live').textContent='2号機の共有結果により、自動迂回せず停止したままです。';
        teamShareLog(`検証（2→1）：${message}`);
        saveAndLog({side:result.nagi,state:'rejected',reason,source:'auto',flight:'one',interim:true,evidence},`確定：仮想案${result.nagi}は不採用。結果を端末に保存した。`,`確定：仮想案${result.nagi}は不採用。端末への保存に失敗した（表示のみ）。`);
        return;
      }else teamShareLog(`共有（2→1）：2号機の高い表面は選択案の経路300m以内になし（最短約${rel2.nearestM===null?'不明':rel2.nearestM+'m'}）。1号機自身の再点検で判断する。`);
    }
    $('map-sim-consult-status').textContent=`${responseLabel}：仮想案${result.nagi}。1号機の高度180mで再点検中です。時間内に完了しない場合は停止します。2号機の判定には使いません。`;
    mapPlanCandidate={side:result.nagi,provenance,evidence};
    const fresh=await realMap.reinspectDetourSide(result.nagi);
    if(id!==mapPlanVersion)return;
    if(!realMode||mapPlanPhase!=='obstacle'){invalidateMapPlan('phase');return}
    const verdict=reinspectVerdict(fresh),reinspection=createDetourReinspection(result.nagi,fresh,new Date().toISOString());
    teamLog(`再点検（1号機の高度180m）：仮想案${result.nagi}は${fresh.total}点中${fresh.observed}点で高さ取得・不明${fresh.unknown}点・高い表面${fresh.blockedIndices.length}点・最大間隔 約${fresh.maxGap}m。`);
    if(!verdict.ok){
      mapPlanCandidate=null;const reason=verdict.reason;
      const message=`${reason}したため、自動迂回せず停止したままです。`;
      $('map-sim-consult-status').textContent=message;$('map-radio-live').textContent='再点検で採用できないため、停止したままです。';
      teamLog(`検証：${message}`);
      saveAndLog({side:result.nagi,state:'rejected',reason,source:mapPlanRecordedSource(provenance),provenance,flight:'one',interim:true,evidence,reinspection},`確定：仮想案${result.nagi}は不採用。結果を端末に保存した。`,`確定：仮想案${result.nagi}は不採用。端末への保存に失敗した（表示のみ）。`);
      return;
    }
    mapPlanChoice=result.nagi;mapPlanChoiceProvenance=provenance;const text=`${responseLabel}。ソラ：仮想案${result.sora}を提案。ナギ：仮想案${result.nagi}を選択（再点検済み）。`;const preview=$('map-sim-preview');preview.width=frame.canvas.width;preview.height=frame.canvas.height;preview.getContext('2d').drawImage(frame.canvas,0,0);$('map-sim-dialogue').textContent=`${capturedAt}の画像：${text}`;$('map-sim-consult-result').hidden=false;
    mapPlanHistory.unshift(`${new Date().toLocaleString('ja-JP')} ${$('map-area-title').textContent} — ${text}`);mapPlanHistory=mapPlanHistory.slice(0,5);$('map-sim-history').replaceChildren();for(const item of mapPlanHistory){const row=document.createElement('p');row.textContent=item;$('map-sim-history').append(row)}
    $('map-sim-consult-status').textContent=`${responseLabel}の仮想案${result.nagi}を再点検し、採用可能を確認しました。自動で迂回します。安全性は未確認です。`;
    $('map-radio-live').textContent=`${capturedAt}の画像への選択（${responseLabel}・再点検済み）\nソラ：仮想案${result.sora}を提案\nナギ：仮想案${result.nagi}を選択\n文章は選択結果から作成`;
    teamLog(`自動判断：${summarizeDetourValidation(validation)} 仮想案${result.nagi}を自動で迂回する（選択は途中経過。完了・停止時に確定結果を保存する）。`);
    mapTeamPending={side:result.nagi,reason:validation.reason,evidence,provenance,reinspection};mapPlanCandidate=null;
    showMapSpeech(`アプリの定型字幕（${responseLabel}）`,`ソラの提案：仮想案${result.sora}。`,'ソラ');if(mapSound&&'speechSynthesis'in window)showMapSpeech(`アプリの定型字幕（${responseLabel}）`,`ナギの選択：仮想案${result.nagi}。`,'ナギ');else{if(mapSubtitleTimer!==null)clearTimeout(mapSubtitleTimer);mapSubtitleTimer=setTimeout(()=>{mapSubtitleTimer=null;showMapSpeech(`アプリの定型字幕（${responseLabel}）`,`ナギの選択：仮想案${result.nagi}。`,'ナギ')},2800)}
    realMap.continueSimulation(result.nagi);
  }catch(error){if(id===mapPlanVersion&&mapPlanPhase==='obstacle'){const candidate=mapPlanCandidate,stage=candidate?'再点検':'相談';mapPlanCandidate=null;const message=`${stage}に失敗しました。停止したままです：${error.message}`;$('map-sim-consult-status').textContent=message;$('map-radio-live').textContent=`${stage}できませんでした。仮想障害で停止中です。`;teamLog(`失敗：${message}`);if(candidate)saveAndLog({side:candidate.side,state:'stopped',reason:message,source:mapPlanRecordedSource(candidate.provenance),provenance:candidate.provenance,flight:'one',interim:true,evidence:candidate.evidence},'再点検の失敗を端末に保存した。','再点検の失敗を端末に保存できなかった（表示のみ）。')}}
  finally{if(id===mapPlanVersion){mapPlanController=null;mapPlanCameraGuard=false;realMap.setViewLock?.(false);syncMapPlan()}}
}
$('map-sound').addEventListener('click',()=>{if(!('speechSynthesis'in window)){$('map-sound').textContent='読み上げ不可';$('map-sound').disabled=true;return}mapSound=!mapSound;$('map-sound').textContent=`読み上げ ${mapSound?'ON':'OFF'}`;$('map-sound').setAttribute('aria-pressed',String(mapSound));if(!mapSound)speechSynthesis.cancel()});
function showMapSpeech(who,text,speaker=who){
  if(mapSubtitleTimer!==null){try{clearTimeout(mapSubtitleTimer)}catch{}mapSubtitleTimer=null}
  const subtitle=$('map-subtitle'),version=mapSpeechVersion;const show=()=>{if(version!==mapSpeechVersion)return;subtitle.textContent=`${who}：${text}`;subtitle.hidden=false};
  if(!mapSound||!('speechSynthesis'in window)){show();return}
  try{const utterance=configureSpeech(new SpeechSynthesisUtterance(text),speaker,speechSynthesis.getVoices());utterance.onstart=show;utterance.onerror=show;try{speechSynthesis.cancel()}catch{}speechSynthesis.speak(utterance)}catch{show()}
}
function clearMapSpeech(){mapSpeechVersion++;if(mapSubtitleTimer!==null){clearTimeout(mapSubtitleTimer);mapSubtitleTimer=null}$('map-subtitle').hidden=true;if('speechSynthesis'in window)speechSynthesis.cancel()}
function consultFailureLabel(value,en=false){const labels=en?{input_rejected:'server reported input rejection',consultation_failed:'consultation failed',interrupted:'interrupted or changed'}:{input_rejected:'サーバーから入力拒否の通知',consultation_failed:'相談の失敗',interrupted:'途中中断または内容変更'};return labels[value]||''}
function consultResponseLabel(value,en=false){return value==='muse'?(en?'Muse response (server-reported)':'Museの回答（サーバーの申告）'):value==='fixture'?(en?'Test response':'試験用の回答'):(en?'Response source unknown':'回答の出所は不明')}
function renderConsultAudit(container,audit){
  container.replaceChildren();if(!audit)return;
  const line=text=>{const p=document.createElement('p');p.textContent=text;container.append(p)};
  const uncertain=audit.status==='uncertain',english=document.documentElement?.lang==='en';
  if(uncertain)line(english?'The app attempted a consultation, but its outcome is unknown. The following data may have reached Meta; receipt and a model answer were not confirmed.':'相談を試みましたが結果は不明です。以下の情報がMetaに送信された可能性があります。到達とモデルの回答は確認できていません。');
  if(uncertain&&audit.failureClass)line(english?`App-recorded failure category: ${consultFailureLabel(audit.failureClass,true)}. This does not establish provider receipt or the underlying cause.`:`アプリが記録した失敗の種別：${consultFailureLabel(audit.failureClass)}。Metaへの到達や根本原因を確定するものではありません。`);
  line(`相談ID ${audit.requestId} ／ 地域コード ${audit.area}`);
  line(`画面画像 ${new Date(audit.capturedAt).toLocaleString('ja-JP')} に取得（画像は保存しません。現場映像ではありません）`);
  for(const input of audit.inputs){
    if(input.kind==='image'){
      line(uncertain?`${input.id}：送信対象の3D地図画像`:`${input.id}：3D地図画像を送信`);
      const en=document.documentElement?.lang==='en';
      if(input.sha256){
        line(en?`SHA-256 of ${uncertain?'the intended':'the sent'} PNG: ${input.sha256}. A match does not establish authenticity or safety.`:`${uncertain?'送信対象':'送信'}PNGのSHA-256：${input.sha256}。一致しても真正性や安全は保証しません。`);
        const label=document.createElement('label'),file=document.createElement('input'),status=document.createElement('p');label.textContent=en?'Compare an image stored on this device: ':'端末に保存した画像と照合：';file.type='file';file.accept='image/png';status.setAttribute('role','status');label.append(file);container.append(label,status);let generation=0;
        file.addEventListener('change',async()=>{const current=++generation,chosen=file.files?.[0];if(!chosen)return;status.textContent=en?'Comparing on this device…':'端末内で照合中…';if(!globalThis.crypto?.subtle||chosen.type!=='image/png'||chosen.size>7500000){status.textContent=en?'Choose a PNG up to 7.5 MB in a supported browser.':'対応ブラウザーで7.5MB以下のPNGを選んでください。';return}try{const bytes=await chosen.arrayBuffer(),digest=await crypto.subtle.digest('SHA-256',bytes),hash=Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');if(current!==generation||!status.isConnected)return;status.textContent=hash===input.sha256?(en?'Image bytes match. Nothing was sent.':'画像のデータが一致しました。送信はしていません。'):(en?'Image bytes do not match. Nothing was sent.':'画像のデータが一致しません。送信はしていません。')}catch{if(current===generation&&status.isConnected)status.textContent=en?'Could not compare the image.':'画像を照合できません。'}});
      }else line(en?'Image fingerprint unavailable; the image was not saved.':'画像の照合情報はありません。画像は保存していません。');
    }
    if(input.kind==='supplies')line(`${input.id}：物資 ${input.supply||'未指定'} ／ 数量 ${input.quantity??'未指定'}`);
    if(input.kind==='field_reports'){
      const en=document.documentElement.lang==='en',states=en?{water_seen:'water seen',no_water_seen:'water not seen',uncertain:'unknown'}:{water_seen:'水が見えた',no_water_seen:'水が見えなかった',uncertain:'不明'},scopes=en?{facility_point:'facility point',nearby_road:'nearby road',unspecified:'scope unknown'}:{facility_point:'施設の一点',nearby_road:'付近の道路',unspecified:'範囲不明'};
      line(en?`${input.id}: unverified human reports; the contents and reporter are not verified. The same category does not establish the same place or time.`:`${input.id}：人の未検証報告。内容と報告者は確認していません。同じ分類でも場所や時刻が同じとは限りません。`);
      for(const report of input.value)line(`${states[report.status]} / ${scopes[report.scope]} / ${new Date(report.observedAt).toLocaleString(en?'en':'ja-JP')} → ${new Date(report.expiresAt).toLocaleString(en?'en':'ja-JP')}`);
    }
    if(input.kind==='facility_reports'){
      const en=document.documentElement.lang==='en',states=en?{checking:'checking',available:'reported accepting',conditional:'conditional',unavailable:'reported not accepting'}:{checking:'確認中',available:'受け入れ可能',conditional:'条件付き',unavailable:'受け入れ不可'},landing=en?{unknown:'landing unknown',clear_reported:'landing reported usable',unusable_reported:'landing reported unusable'}:{unknown:'着地点不明',clear_reported:'着地点使用可能との報告',unusable_reported:'着地点使用不可との報告'},supplies=en?{water:'water',food:'food',blanket:'blankets',hygiene:'hygiene supplies'}:{water:'飲料水',food:'食料',blanket:'毛布',hygiene:'衛生用品'};
      line(en?`${input.id}: unverified facility reports. Names, contacts and condition text were not sent.`:`${input.id}：施設の未検証報告。氏名・連絡先・条件文は送信していません。`);
      input.value.forEach((report,i)=>line(`${i+1}. ${states[report.status]} / ${landing[report.landing]} / ${report.supply?`${supplies[report.supply]} ${report.quantity}`:(en?'supply unknown':'物資不明')} / ${new Date(report.confirmedAt).toLocaleString(en?'en':'ja-JP')} → ${new Date(report.expiresAt).toLocaleString(en?'en':'ja-JP')}${report.correctionIndex!==null?(en?` / corrects report ${report.correctionIndex+1}`:` ／ 報告${report.correctionIndex+1}の訂正`):report.correctionTargetOmitted?(en?' / correction target not sent':' ／ 訂正元は未送信'):''}`));
    }
    if(input.kind==='infrastructure_reports'){
      const en=document.documentElement.lang==='en',items=en?{wire:'wire/cable',pole:'pole',tree:'tree',work:'work/temporary',other:'other'}:{wire:'電線・ケーブル',pole:'電柱',tree:'樹木',work:'工事・仮設',other:'その他'},states=en?{present:'reported visible',damaged:'reported damaged',changed:'reported changed',not_seen:'reported not seen in viewed area',uncertain:'reported unknown'}:{present:'見えたとの報告',damaged:'破損との報告',changed:'変化したとの報告',not_seen:'確認範囲で見えなかったとの報告',uncertain:'確認できなかったとの報告'};
      line(en?`${input.id}: unverified infrastructure reports. Location, source text and local IDs were not sent; relation to routes is unknown. Location or source corrections are not conveyed to Muse.`:`${input.id}：未検証の設備報告。場所・確認先・端末内IDは送信せず、経路との関係は不明です。場所・確認先の訂正はMuseには伝わりません。`);
      input.value.forEach((report,index)=>line(`${index+1}. ${items[report.item]} / ${states[report.status]} / ${new Date(report.observedAt).toLocaleString(en?'en':'ja-JP')} → ${new Date(report.expiresAt).toLocaleString(en?'en':'ja-JP')}${report.correctionIndex!==null?(en?` / corrects ${report.correctionIndex+1}`:` ／ 報告${report.correctionIndex+1}の訂正`):report.correctionTargetOmitted?(en?' / correction target omitted':' ／ 訂正元は未送信'):''}`));
    }
    if(input.kind==='bulletin'){
      const en=document.documentElement?.lang==='en',v=input.value;
      line(en?`${input.id}: selected flood bulletin; issued ${v.issuedAt} / retrieved ${v.retrievedAt} / area code ${v.event} / number ${v.serial} / type ${v.bulletinType}. Facility relationship and current conditions are unknown.`:`${input.id}：選択した洪水予報電文。発表 ${v.issuedAt} ／ 取得 ${v.retrievedAt} ／ 区域コード ${v.event} ／ 番号 ${v.serial} ／ 種別 ${v.bulletinType}。施設との対応と現在の状況は不明です。`);
      for(const value of v.levels)line(`${value.stationCode} / ${value.category} / ${value.at} / ${value.value??(en?'missing':'欠測')} ${value.unit} / ${value.condition}`);
      const link=document.createElement('a');link.href=v.sourceUrl;link.target='_blank';link.rel='noopener noreferrer';link.textContent=en?'Open official bulletin ↗':'公式電文を開く ↗';container.append(link);
    }
    if(input.kind==='observation'){
      const o=input.value;line(`${input.id}：気象庁の観測所 ${o.stationId}（基準点から約 ${o.distanceMeters} m）／観測 ${new Date(o.observedAt).toLocaleString('ja-JP')}／取得 ${new Date(o.retrievedAt).toLocaleString('ja-JP')}／10分間降水量 ${o.rain??'不明'} mm／平均風速 ${o.wind??'不明'} m/s。観測所の地上値です。`);
      if(Object.hasOwn(o,'rain1h'))line(document.documentElement?.lang==='en'?`1-hour rain ${o.rain1h??'unknown'} mm / 24-hour rain ${o.rain24h??'unknown'} mm.`:`1時間降水量 ${o.rain1h??'不明'} mm ／ 24時間降水量 ${o.rain24h??'不明'} mm。`);
      const en=document.documentElement?.lang==='en',kind=o.referenceKind;line(en?`Reference type ${uncertain?'selected':'sent'}: ${kind==='facility'?'published facility location':kind==='model_center'?'building model area centre':'not included / unknown'}.`:`${uncertain?'送信対象':'送信した'}距離の基準種別：${kind==='facility'?'施設の公開座標':kind==='model_center'?'建物モデル範囲の中心':'送信なし・不明'}。`);
      line(document.documentElement?.lang==='en'?'The reference point name and coordinates were not sent in observation data or saved in this record; this distance alone cannot identify the point.':'基準点の名称・座標は観測データとして送信せず、この記録にも保存していません。距離だけでは地点を特定できません。');
      if(Date.parse(o.observedAt)>Date.parse(o.retrievedAt)||Date.parse(o.retrievedAt)>Date.parse(audit.capturedAt))line(document.documentElement?.lang==='en'?'The observation and retrieval times are inconsistent. This older record is retained but cannot verify current conditions.':'観測時刻と取得時刻の前後関係を確認できません。過去の記録は保持していますが、現在の状況は確認できません。');
      const link=document.createElement('a');link.href=input.source;link.target='_blank';link.rel='noopener noreferrer';link.textContent='気象観測の出典';container.append(link);
    }
    if(input.kind==='flood'){
      line(`${input.id}：施設の洪水想定 ${input.value||'不明'} ／ タイルの取得 ${input.retrievedAt?new Date(input.retrievedAt).toLocaleString('ja-JP'):'不明'} ／ 元データの更新時刻 不明`);
      if(input.source){const link=document.createElement('a');link.href=input.source;link.target='_blank';link.rel='noopener noreferrer';link.textContent='洪水想定の出典';container.append(link)}
    }
  }
  if(uncertain){line(english?'No verified model response was saved. This record is not evidence of delivery or completion.':'確認できたモデルの回答は保存していません。この記録は送信の到達や完了の証拠ではありません。');return}
  const responseLabel=consultResponseLabel(audit.responseProvenance,english);
  line(english?`${responseLabel}. Server-reported source is not independently verified.`:`${responseLabel}。出所は作品サーバーの申告であり、独立に検証していません。`);
  line(`${responseLabel}・構造化結果：建物の分類 ${audit.output.density} ／ 確認順 ${audit.output.ordered_ids.join(' → ')}`);
  line('アプリは回答の形式と確認項目の重複を検証しました。内容の正しさは未検証です。');
  if(Object.hasOwn(audit.output,'cited_ids'))line(`回答が参照したと示した入力ID：${audit.output.cited_ids.join('、')||'なし'}。送信したIDとの一致のみを検証しており、引用の正確さや内容の裏付けは未検証です。`);
  else line('上記IDはアプリが付けた識別子で相談先には送っていません。出典を検証・引用したことを示しません。');
  line('文章は構造化回答を基にアプリが作成しました。');
  const labels=english?{consider:'use for discussion',hold:'hold',reject:'not used'}:{consider:'検討に使う',hold:'保留',reject:'不採用'};
  const reasons=english?{missing_data:'Missing information',conflicting_data:'Conflicting information',outdated_data:'Outdated information',response_mismatch:'Response does not match the input',needs_review:'Further review needed',other:'Other'}:{missing_data:'情報不足',conflicting_data:'情報の食い違い',outdated_data:'情報が古い',response_mismatch:'回答と入力が合わない',needs_review:'追加確認が必要',other:'その他'};
  if(audit.reviews?.length)for(const review of audit.reviews){line(english?`User-recorded decision: ${labels[review.choice]} / ${new Date(review.at).toLocaleString()}${review.reason?` / Reason: ${reasons[review.reason]}`:''}${review.note?` / Note: ${review.note}`:''}. Identity and authority not verified.`:`利用者が記録した判断：${labels[review.choice]} ／ ${new Date(review.at).toLocaleString('ja-JP')}${review.reason?` ／ 理由：${reasons[review.reason]}`:''}${review.note?` ／ メモ：${review.note}`:''}。記録者の本人確認・権限確認はしていません。`)}
  else line(english?'No user decision has been recorded.':'人の判断はまだ記録されていません。');
  line(`${audit.inputs.some(item=>item.kind==='observation')?'上記の観測以外の気象・':'気象・'}${audit.inputs.some(item=>item.kind==='bulletin')?'上記電文以外の河川水位':'河川水位'}${audit.inputs.some(item=>item.kind==='facility_reports')?'や施設報告の条件文・連絡先':'・施設メモ'}はこの相談では送信していません。入力の範囲外は不明です。`);
}
const consultAuditStorageKey='muse-map-consult-audits-v1';
let consultReviewDirty=false;
function readSavedConsultAudits(){try{return decodeConsultAudits(localStorage.getItem(consultAuditStorageKey))}catch{return {status:'unavailable',records:[]}}}
function renderSavedConsultAudits(){
  consultReviewDirty=false;
  const container=$('consult-saved-audits'),status=$('consult-saved-status');container.replaceChildren();
  const saved=readSavedConsultAudits();
  $('consult-audits-export').disabled=saved.status!=='ok'||!saved.records.length;
  if(saved.status!=='ok'){status.textContent=saved.status==='corrupt'?'保存記録を読み取れません。上書きせず保持しています。':'端末内の記録を読み取れません。';return}
  const english=document.documentElement?.lang==='en';status.textContent=saved.records.length?(english?`${saved.records.length} records on this device. Images, facility names and addresses are not saved automatically. Do not put personal information in notes. These are not current conditions.`:`端末に${saved.records.length}件保存。画像・施設名・住所は自動保存しません。メモには個人情報を入れないでください。現在の状況には使えません。`):(english?'No saved records.':'保存された記録はありません。');
  for(const audit of saved.records){
    const details=document.createElement('details'),summary=document.createElement('summary'),content=document.createElement('div'),remove=document.createElement('button'),label=document.createElement('label'),select=document.createElement('select'),reasonLabel=document.createElement('label'),reason=document.createElement('select'),noteLabel=document.createElement('label'),note=document.createElement('textarea'),hint=document.createElement('p'),saveReview=document.createElement('button');
    summary.textContent=`${new Date(audit.capturedAt).toLocaleString('ja-JP')} ／ 地域 ${audit.area}${audit.status==='uncertain'?(english?' / outcome unknown':' ／ 相談結果不明'):''}${audit.status==='uncertain'&&audit.failureClass?` / ${consultFailureLabel(audit.failureClass,english)}`:''}`;renderConsultAudit(content,audit);
    const en=document.documentElement?.lang==='en';label.textContent=en?'Record your decision: ':'自分の判断を記録：';
    for(const [value,ja,english] of [['','選択してください','Choose'],['consider','検討に使う','Use for discussion'],['hold','保留','Hold'],['reject','不採用','Not used']]){const option=document.createElement('option');option.value=value;option.textContent=en?english:ja;select.append(option)}
    reasonLabel.textContent=en?'Reason (optional): ':'理由（任意）：';for(const [value,ja,english] of [['','指定しない','Unspecified'],['missing_data','情報不足','Missing information'],['conflicting_data','情報の食い違い','Conflicting information'],['outdated_data','情報が古い','Outdated information'],['response_mismatch','回答と入力が合わない','Response does not match input'],['needs_review','追加確認が必要','Further review needed'],['other','その他','Other']]){const option=document.createElement('option');option.value=value;option.textContent=en?english:ja;reason.append(option)}reasonLabel.append(reason);
    noteLabel.textContent=en?'Note (optional, 200 characters): ':'メモ（任意・200文字以内）：';note.maxLength=200;note.rows=2;noteLabel.append(note);hint.textContent=en?'Saved only on this device and included in exported records. Do not enter names, contact details or other personal information.':'メモは端末内に保存され、記録のファイル出力にも含まれます。氏名・連絡先などの個人情報は入力しないでください。';
    for(const control of [select,reason,note])control.addEventListener('input',()=>{consultReviewDirty=true});
    label.append(select);saveReview.type='button';saveReview.textContent=en?'Save decision':'判断を記録';saveReview.addEventListener('click',async()=>{
      if(!select.value){status.textContent=en?'Choose a decision first.':'先に判断を選んでください。';return}const choice=select.value,details={reason:reason.value,note:note.value};for(const control of [select,reason,note,saveReview,remove])control.disabled=true;
      try{await updateLocalHistory({storage:localStorage,locks:navigator.locks,key:consultAuditStorageKey,update:raw=>recordConsultReview(raw,audit,choice,new Date().toISOString(),details)});renderSavedConsultAudits();status.textContent=en?'Decision saved on this device.':'判断をこの端末に記録しました。'}
      catch(error){status.textContent=en?'Could not save. Keep a copy of your note and reload the record before retrying.':`判断を記録できません：${error.message}。メモを控えて記録を再表示し、確認してください。`;for(const control of [select,reason,note,saveReview,remove])control.disabled=false}
    });
    remove.type='button';remove.textContent='この記録を削除';remove.addEventListener('click',async()=>{
      if(!window.confirm('この相談記録を端末から削除しますか？'))return;remove.disabled=true;status.textContent='削除の順番を確認中です。';
      try{await updateLocalHistory({storage:localStorage,locks:navigator.locks,key:consultAuditStorageKey,update:raw=>removeConsultAudit(raw,audit)});renderSavedConsultAudits()}
      catch(error){renderSavedConsultAudits();status.textContent=`削除を完了できません：${error.message}。保存内容を確認してください。`;remove.disabled=false}
    });if(audit.status==='uncertain'){for(const item of [label,reasonLabel,noteLabel,hint,saveReview])item.hidden=true}details.append(summary,content,label,reasonLabel,noteLabel,hint,saveReview,remove);container.append(details);
  }
}
$('consult-audits-export').addEventListener('click',()=>{
  try{const raw=localStorage.getItem(consultAuditStorageKey);if(decodeConsultAudits(raw).status!=='ok'||raw===null)throw new Error();const url=URL.createObjectURL(new Blob([raw],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='muse-consultation-records.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
  catch{$('consult-saved-status').textContent='記録をファイルに保存できません。内容を確認してください。'}
});
async function saveConsultAudit(audit){
  if(consultAuditSaving||pendingConsultAudit!==audit)return;
  consultAuditSaving=true;renderPendingConsultAudit();$('consult-saved-status').textContent='保存の順番を確認中です。';
  try{await updateLocalHistory({storage:localStorage,locks:navigator.locks,key:consultAuditStorageKey,update:raw=>appendConsultAudit(raw,audit)});if(pendingConsultAudit===audit)pendingConsultAudit=null;renderSavedConsultAudits()}
  catch(error){renderSavedConsultAudits();$('consult-saved-status').textContent=`記録の保存を完了できません：${error.message}。未保存の記録はこの画面に保持しています。`}
  finally{consultAuditSaving=false;renderPendingConsultAudit();syncConsult()}
}
function renderPendingConsultAudit(){
  const pending=!!pendingConsultAudit,en=document.documentElement?.lang==='en';$('consult-unsaved').hidden=!pending;$('consult-unsaved-banner').hidden=!pending||consultAuditSaving;
  $('consult-unsaved-message').textContent=consultAuditSaving?(en?'Saving the consultation record…':'相談記録を保存中です。'):(en?'This consultation has not been saved. Free a slot or resolve the storage mismatch, then retry.':'この相談は未保存です。記録を整理するか保存内容の不一致を解消してから再保存してください。');
  for(const id of ['consult-save-retry','consult-unsaved-export','consult-unsaved-discard'])$(id).disabled=consultAuditSaving;
  updateConsultButton();
}
$('consult-unsaved-open').addEventListener('click',()=>{
  if(!pendingConsultAudit||!realMode)return;if(document.querySelector?.('.shell')?.classList.contains('panel-collapsed'))$('panel-toggle').click();
  for(let node=$('consult-unsaved').parentElement;node;node=node.parentElement)if(node.tagName==='DETAILS')node.open=true;
  $('consult-unsaved').scrollIntoView?.({block:'nearest'});$('consult-save-retry').focus?.({preventScroll:true});
});
$('consult-save-retry').addEventListener('click',()=>{if(pendingConsultAudit&&!consultAuditSaving)saveConsultAudit(pendingConsultAudit)});
$('consult-unsaved-export').addEventListener('click',()=>{if(!pendingConsultAudit||consultAuditSaving)return;try{const url=URL.createObjectURL(new Blob([JSON.stringify([pendingConsultAudit])],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='muse-unsaved-consultation.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}catch{$('consult-unsaved-message').textContent='未保存の記録をファイルに保存できませんでした。'}});
$('consult-unsaved-discard').addEventListener('click',()=>{if(!pendingConsultAudit||consultAuditSaving)return;const en=document.documentElement?.lang==='en';if(!window.confirm(en?'Discard this unsaved consultation record?':'未保存の相談記録を破棄しますか？'))return;pendingConsultAudit=null;renderPendingConsultAudit();syncConsult()});
window.addEventListener?.('beforeunload',event=>{if(pendingConsultAudit){event.preventDefault();event.returnValue=''}});
window.addEventListener?.('storage',event=>{if(event.storageArea===localStorage&&(event.key===consultAuditStorageKey||event.key===null)){if(consultReviewDirty){$('consult-saved-status').textContent=document.documentElement?.lang==='en'?'Another tab changed the records. Keep your draft and review the latest records before saving.':'別の画面で記録が変わりました。入力中のメモを控え、最新の記録を確認してください。'}else renderSavedConsultAudits()}});
for(const id of ['welcome-language','map-language'])$(id)?.addEventListener('change',()=>queueMicrotask(()=>{if(pendingConsultAudit)renderPendingConsultAudit();if(typeof localStorage!=='undefined'){if(consultReviewDirty)$('consult-saved-status').textContent=document.documentElement?.lang==='en'?'Finish or copy your draft before refreshing the record language.':'入力中の判断を保存または控えてから、記録の表示を更新してください。';else renderSavedConsultAudits()}}));
if(typeof localStorage!=='undefined')renderSavedConsultAudits();
function addMapHistory(result,context,audit){
  if(!context)return;
  mapHistory.unshift({...context,sora:result.sora,nagi:result.nagi.slice(),audit});mapHistory=mapHistory.slice(0,5);
  const history=$('map-history');history.replaceChildren();for(const entry of mapHistory){
    const block=document.createElement('div'),title=document.createElement('p'),facility=document.createElement('p'),inputs=document.createElement('p'),sora=document.createElement('p'),list=document.createElement('ol');
    title.textContent=`${entry.area} / ${entry.time}`;
    facility.textContent=`画面内の施設候補：${entry.shelter||'未選択'}${entry.address?`（${entry.address}）`:''}（施設名・住所は別テキストでは送信しません）`;
    const flood=entry.floodSent?(entry.flood||'未確認'):'未送信（旧サーバー）';
    const infra=entry.audit?.inputs?.some(input=>input.kind==='infrastructure_reports');
    const infrastructureLabel=document.documentElement?.lang==='en'?`Infrastructure reports: ${entry.audit?(infra?'sent':'not sent'):'unknown'}`:`設備報告：${entry.audit?(infra?'送信あり':'送信なし'):'不明'}`;
    inputs.textContent=`送信した物資：${entry.supply||'未指定'} ／ ${entry.quantity===null?'数量未指定':`${entry.quantity}箱`} ／ 施設座標の洪水想定：${flood}（現在の浸水ではありません） ／ ${infrastructureLabel}`;
    sora.textContent=`${consultResponseLabel(entry.audit?.responseProvenance)} ／ ソラ：${entry.sora}`;for(const item of entry.nagi){const row=document.createElement('li');row.textContent=item;list.append(row)}block.append(title,facility,inputs,sora,list);if(entry.audit){const details=document.createElement('details'),summary=document.createElement('summary'),content=document.createElement('div');summary.textContent='送信内容と構造化回答';renderConsultAudit(content,entry.audit);details.append(summary,content);block.append(details)}history.append(block)
  }
}
$('consult-image-download').addEventListener('click',()=>{if(!consultImageData)return;const link=document.createElement('a');link.href=consultImageData;link.download='muse-consult-image.png';link.click()});
function showPastConsultNotice(){const node=$('consult-result-age');node.hidden=false;node.textContent=document.documentElement.lang==='en'?'Previous consultation, kept for reference. Conditions may have changed; check the latest information and consult again.':'前回の相談結果（参考）です。状況が変わっている可能性があります。最新情報を確認し、もう一度相談してください。'}
for(const id of ['welcome-language','map-language'])$(id)?.addEventListener('change',()=>queueMicrotask(()=>{if(!$('consult-result-age').hidden)showPastConsultNotice();const audit=mapHistory[0]?.audit;if(!$('consult-result').hidden&&audit){const label=$('consult-response-source');if(label)label.textContent=consultResponseLabel(audit.responseProvenance,document.documentElement?.lang==='en');renderConsultAudit($('consult-audit'),audit)}}));
$('consult-map').addEventListener('click',()=>{
  if(reconcileReportConsents()){$('consult-status').textContent=document.documentElement.lang==='en'?'Reports changed. Review them and choose again before consulting.':'報告が変わりました。内容を確認し、送信するか選び直してください。';renderConsultField();renderConsultFacility();return}
  if(pendingConsultAudit||!real||!realMode||!realMap||mapAreaState!=='ready'||!mapCapability||mapConsultBusy||(mapFloodCapability&&facilityFlood?.state==='loading')||($('consult-use-observation').checked&&(!mapObservationCapability||!mapRefsCapability||!consultObservationValue()))||($('consult-use-field').checked&&(!mapFieldReportsCapability||!mapRefsCapability||!consultFieldValue()))||($('consult-use-facility').checked&&(!mapFacilityReportsCapability||!mapRefsCapability||!consultFacilityValue()))||($('consult-use-bulletin').checked&&(!mapBulletinCapability||!mapRefsCapability||!consultBulletinValue()))||($('consult-use-infrastructure').checked&&(!mapInfrastructureCapability||!mapRefsCapability||!consultInfrastructureData())))return;
  if(!mapConsultation)mapConsultation=createMapConsultation({capture:()=>{const frame=realMap.capture();consultFrame=frame.canvas;consultCaptureAt=new Date().toISOString();$('consult-time').textContent=`送信画像（取得 ${new Date(consultCaptureAt).toLocaleString('ja-JP')}）`;return frame},current:view=>realMode&&mapAreaState==='ready'&&realMap.isViewCurrent(view)&&(!consultObservationSnapshot||$('consult-use-observation').checked&&JSON.stringify(consultObservationSnapshot)===JSON.stringify(consultObservationValue()))&&(!consultFieldSnapshot||$('consult-use-field').checked&&JSON.stringify(consultFieldSnapshot)===JSON.stringify(consultFieldValue()))&&(!consultFacilitySnapshot||$('consult-use-facility').checked&&consultFacilitySnapshot.selectionVersion===facilitySelectionVersion&&JSON.stringify(consultFacilitySnapshot.value)===JSON.stringify(consultFacilityValue()))&&(!consultBulletinSnapshot||$('consult-use-bulletin').checked&&consultBulletinSnapshot.version===consultBulletinVersion&&JSON.stringify(consultBulletinSnapshot.value)===JSON.stringify(consultBulletinValue()))&&(!consultInfrastructureSnapshot||$('consult-use-infrastructure').checked&&consultInfrastructureSnapshot===reportConsentSignature('infrastructure')),request:async(image,signal)=>{const draft=requestDraft({supply:$('draft-supply').value,quantity:$('draft-quantity').value});const payload={image,supply:draft.supply?$('draft-supply').value:null,quantity:draft.quantity};consultObservationSnapshot=null;consultFieldSnapshot=null;consultFacilitySnapshot=null;consultBulletinSnapshot=null;consultInfrastructureSnapshot=null;if($('consult-use-field').checked){if(!mapFieldReportsCapability||!mapRefsCapability)throw new Error('現地報告の送信に対応していません');const value=consultFieldValue();if(!value)throw new Error('現地報告を再確認してください');consultFieldSnapshot=value;payload.fieldReports=value;}if($('consult-use-observation').checked){if(!mapObservationCapability||!mapRefsCapability)throw new Error('観測情報の送信に対応していません');const value=consultObservationValue();if(!value)throw new Error('観測情報を再確認してください');consultObservationSnapshot=value;payload.observation=value;}if($('consult-use-facility').checked){if(!mapFacilityReportsCapability||!mapRefsCapability)throw new Error('施設報告の送信に対応していません');const value=consultFacilityValue();if(!value)throw new Error('施設報告を再確認してください');consultFacilitySnapshot={value,selectionVersion:facilitySelectionVersion};payload.facilityReports=value;}if($('consult-use-bulletin').checked){if(!mapBulletinCapability||!mapRefsCapability)throw new Error('洪水予報電文の送信に対応していません');const value=consultBulletinValue();if(!value)throw new Error('洪水予報電文を再確認してください');consultBulletinSnapshot={value,version:consultBulletinVersion};payload.bulletin=value;}if($('consult-use-infrastructure').checked){if(!mapInfrastructureCapability||!mapRefsCapability)throw new Error('設備報告の送信に対応していません');const data=consultInfrastructureData();if(!data||consultReportConsents.infrastructure!==JSON.stringify(data))throw new Error('設備報告を再確認してください');consultInfrastructureSnapshot=JSON.stringify(data);payload.infrastructureReports=data.value;}if(mapFloodCapability)payload.flood=mapFloodContext(facilityFlood,draftShelter,draftAddress);consultContext=mapConsultHistoryContext({area:$('map-area-title').textContent,shelter:draftShelter,address:draftAddress,time:$('consult-time').textContent,payload});const area=typeof activeArea==='string'?activeArea:String(activeArea?.cityCode||activeArea?.code||'');const id=globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`;const imageHash=await consultImageDigest(image);if(signal.aborted)throw new Error('相談を中止しました');ensureCurrentObservationConsent();ensureCurrentConsultReports();consultImageData=image;consultAuditPending=createConsultAudit({id,capturedAt:consultCaptureAt,area,payload,flood:facilityFlood,observation:observationEvidence,shelter:draftShelter,address:draftAddress,imageHash});const refs=mapRefsCapability?consultEvidenceRefs(id,Object.hasOwn(payload,'flood'),Object.hasOwn(payload,'observation'),Object.hasOwn(payload,'fieldReports'),Object.hasOwn(payload,'facilityReports'),Object.hasOwn(payload,'bulletin'),Object.hasOwn(payload,'infrastructureReports')):null;if(refs)payload.evidenceRefs=refs;const envelope=await api('map-consult',payload,signal,true),response=envelope?.result;if(signal.aborted)throw new Error('相談を中止しました');if(!response||typeof response!=='object'||Array.isArray(response))throw new Error('相談の回答を確認できません');if(refs?!validateConsultCitations(refs,response.cited_ids):Object.hasOwn(response,'cited_ids'))throw new Error('相談の参照IDを確認できません');Object.defineProperty(response,Symbol.for('muse.consult.responseProvenance'),{value:['muse','fixture'].includes(envelope?.provenance)?envelope.provenance:'unknown'});return response},onStatus:(message,busy,reason)=>{mapConsultBusy=busy;if(busy){consultMayHaveReachedMeta=false;consultUncertainKind=null}else if(consultMayHaveReachedMeta)consultUncertainKind=reason||'interrupted';const notice=consultMayHaveReachedMeta&&!busy?(document.documentElement?.lang==='en'?' The information may have reached Meta.':' 情報はMetaに到達した可能性があります。'):'';$('consult-status').textContent=(reason==='observation_changed_before_send'&&document.documentElement?.lang==='en'?'Observation changed before sending. The consultation was cancelled; review it again.':reason==='information_changed_before_send'&&document.documentElement?.lang==='en'?'Information changed before sending. The consultation was cancelled; review it again.':message)+notice;updateConsultButton()},onResult:(result,raw,failure)=>{
    $('map-subtitle').hidden=true;if(mapSubtitleTimer!==null){clearTimeout(mapSubtitleTimer);mapSubtitleTimer=null}if('speechSynthesis'in window)speechSynthesis.cancel();if(!result&&document.hidden&&!$('consult-result').hidden&&!consultAuditPending){showPastConsultNotice();return;}if(!result&&consultAuditPending){consultMayHaveReachedMeta=true;const failureClass=['input_rejected','consultation_failed','interrupted'].includes(failure?.code)?failure.code:undefined,attempt=finishUncertainConsultAudit(consultAuditPending,new Date().toISOString(),failureClass);consultAuditPending=null;pendingConsultAudit=attempt;saveConsultAudit(attempt)}$('consult-result').hidden=!result;$('consult-result-age').hidden=true;$('map-radio').replaceChildren();if(!result||!consultFrame){consultAuditPending=null;consultImageData=null;return;}
    const audit=finishConsultAudit(consultAuditPending,raw,new Date().toISOString(),raw[Symbol.for('muse.consult.responseProvenance')]||'unknown');consultAuditPending=null;renderConsultAudit($('consult-audit'),audit);pendingConsultAudit=audit;saveConsultAudit(audit);
    const preview=$('consult-preview');preview.width=consultFrame.width;preview.height=consultFrame.height;preview.getContext('2d').drawImage(consultFrame,0,0);
    const label=consultResponseLabel(audit.responseProvenance,document.documentElement?.lang==='en'),source=document.createElement('p');source.id='consult-response-source';source.textContent=label;const sora=document.createElement('p');sora.textContent=`ソラ（画像の印象）：${result.sora}`;const nagi=document.createElement('p');nagi.textContent='ナギ（確認順の提案）：';const list=document.createElement('ol');for(const item of result.nagi){const row=document.createElement('li');row.textContent=item;list.append(row)}$('map-radio').append(source,sora,nagi,list);addMapHistory(result,consultContext,audit);
    const next=`まず、${result.nagi[0]}。`;showMapSpeech(`${label}・ソラ`,result.sora,'ソラ');
    if(mapSound&&'speechSynthesis'in window)showMapSpeech(`${label}・ナギ`,next,'ナギ');else mapSubtitleTimer=setTimeout(()=>{mapSubtitleTimer=null;showMapSpeech(`${label}・ナギ`,next,'ナギ')},2800);
  }});
  mapConsultation.run();
});
function updateScanButton(){$('scan-map').disabled=mapScanBusy||!real||!realMap||mapAreaState!=='ready'}
function syncScan(){updateScanButton();if(!mapScanBusy)$('scan-status').textContent=!real?'Muse未接続のため利用できません。':!realMap?'地図を準備中です。':mapAreaState!=='ready'?'地域の位置を確認できてから確認できます。':'撮影した地図画像の電線候補を確認します。';}
$('scan-map').addEventListener('click',()=>{
  if(!real||!realMap||!realMode||mapAreaState!=='ready')return;
  if(!mapScan)mapScan=createMapScan({capture:()=>{const frame=realMap.capture();scanFrame=frame.canvas;$('scan-time').textContent=`送信した画像とSAMの候補枠（撮影 ${new Date().toLocaleString('ja-JP')}）`;return frame},current:view=>realMode&&mapAreaState==='ready'&&realMap.isViewCurrent(view),request:(image,signal)=>api('segment',{image},signal),onStatus:(message,busy)=>{mapScanBusy=busy;$('scan-status').textContent=message;updateScanButton()},onBoxes:(boxes,finished)=>{
    $('scan-result').hidden=!finished;if(!finished||!scanFrame)return;const preview=$('scan-preview');preview.width=scanFrame.width;preview.height=scanFrame.height;const context=preview.getContext('2d');context.drawImage(scanFrame,0,0);context.strokeStyle='#7dffcf';context.lineWidth=Math.max(2,preview.width/400);for(const b of boxes)context.strokeRect(b.x1/b.w*preview.width,b.y1/b.h*preview.height,(b.x2-b.x1)/b.w*preview.width,(b.y2-b.y1)/b.h*preview.height);
  }});
  mapScan.run();
});
$('save-brief').addEventListener('click',()=>{
  const content=createBrief({created:new Date().toISOString(),area:$('map-area-title').textContent.replace(/ ／ 実地図$/,''),shelter:draftShelter,address:draftAddress,facilityFlood,supply:$('draft-supply').value,quantity:$('draft-quantity').value,request:$('draft-transcript').value,ids:mapEvidenceIds,buildings:$('map-buildings-status').textContent,risk:`地図の表示 ${$('risk-toggle').checked?'ON':'OFF'} / ${$('map-risk-status').textContent}`,shelters:$('map-shelters-status').textContent,weather:$('map-weather-status').textContent,observation:$('map-observation-status').textContent,origin:$('map-origin').textContent,distance:$('map-distance').textContent,fetched:$('map-fetch-time').textContent});
  const url=URL.createObjectURL(new Blob(['\ufeff',content],{type:'text/plain;charset=utf-8'})),link=document.createElement('a');link.href=url;link.download='muse-mission-確認メモ.txt';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});

function syncReview(){const button=$('review-checks');button.disabled=!real||mapReviewBusy||!mapEvidenceIds.length;$('review-status').textContent=mapReviewBusy?'Museが確認中です':real?'未確認項目の種類のみを送信します。':'Muse未接続：この機能は実接続時に使えます。'}
function invalidateReview(){mapReviewVersion++;mapReviewController?.abort();mapReviewController=null;mapReviewBusy=false;$('review-results').replaceChildren();if(statusReady)syncReview()}
$('review-checks').addEventListener('click',async()=>{
  if(!real||mapReviewBusy||!mapEvidenceIds.length)return;
  const ids=mapEvidenceIds.slice(),version=mapReviewVersion,controller=new AbortController();mapReviewController=controller;mapReviewBusy=true;syncReview();
  try{
    const [{labelsForOrder},order]=await Promise.all([import('./readiness.mjs'),api('review',{ids},controller.signal)]);
    if(version!==mapReviewVersion)return;const labels=labelsForOrder(ids,order),list=$('review-results');list.replaceChildren();
    for(const label of labels){const item=document.createElement('li');item.textContent=label;list.append(item)}
    $('review-status').textContent='Museが並べた確認順です。実際の安全性や飛行可否は判断していません。';
  }catch(error){if(version===mapReviewVersion)$('review-status').textContent=`Museの確認順を取得できません：${error.message}`}
  finally{if(version===mapReviewVersion){mapReviewController=null;mapReviewBusy=false;$('review-checks').disabled=!real||!mapEvidenceIds.length}}
});
/* Guided tutorial, staged selection and collapsed map view (additive layer).
   Existing delivery control, safety validation and API calls are untouched:
   this block only reads DOM state and forwards clicks to existing buttons. */
(function guidedSetup(){
try{
var $ = function(id){ return document.getElementById(id); };
var shell = (document.querySelector && document.querySelector('.shell')) || null;
var mapPanel = $('map-panel'), overlay = $('tutorial-overlay'), mini = $('mini-ops');
if(!mapPanel || !overlay || !mini) return;
var stage = 1, tutorialIndex = 0, tutorialSeen = false, collapsed = false, lastStopVisible = false;
var SLIDES = [
  {title:'実地図の仮想配送を試す', text:'地域→配送先→出発地点→開始の順に一段階ずつ選びます。実際の飛行ではなく仮想の演出です。', note:'航空写真は現在の映像ではありません。洪水は想定です。'},
  {title:'複数の機体で試す仮想便', text:'100機で複数施設へ配送するか、2機の配送を選べます。各機の状態と停止操作を地図上で確認できます。', note:'施設の開設・受入、飛行の安全は判断できません。不明な点検は停止します。'},
  {title:'開始すると地図が広がります', text:'開始後は右の詳しい情報を閉じ、地図上に機体の状態と停止操作を表示します。', note:'仮想障害の後、地名が映る場合がある地図画像と点検結果をMetaのMuseに送って相談する場合があります。未接続のときは影響機を停止します。'}
];
var STAGE_DESC = {
  1:'地域を選びます。初期選択のまま次へ進めます。読み込み失敗時は理由を表示します。',
  2:'配送先を選びます。施設一覧または地図のオレンジの点から1件選びます。未選択では次へ進めません。',
  3:'出発地点を選びます。ボタンを押して地図の中央で選びます（タッチは地図を押す、キーボードは矢印キーで移動しEnter）。未選択では次へ進めません。',
  4:'機体数と注意を確認して開始します。仮想の演出で、安全や受入は判断できません。'
};
function isRealOpen(){ return !!mapPanel && !mapPanel.hidden; }
function showStageError(text){ var e=$('stage-error'); if(!e) return; e.textContent=text; e.hidden=false; }
function hideStageError(){ var e=$('stage-error'); if(e) e.hidden=true; }
function areaFailure(){
  var ids=['area-list-status','map-base-status','map-buildings-status','map-shelters-status'];
  var keys=['取得できません','取得できず','表示できません','失敗','エラー'];
  for(var i=0;i<ids.length;i++){
    var el=$(ids[i]); if(!el) continue;
    var t=el.textContent||'';
    for(var k=0;k<keys.length;k++){ if(t.indexOf(keys[k])!==-1) return t; }
  }
  return null;
}
function shelterChosen(){
  var sel=$('shelter-select');
  if(sel && sel.value) return true;
  var d=$('draft-destination');
  if(d){ var t=d.textContent||''; if(t && t.indexOf('選択してください')===-1 && t.indexOf('未選択')===-1) return true; }
  return false;
}
function originChosen(){
  var o=$('map-origin'); if(!o) return false;
  var t=o.textContent||'';
  if(!t) return false;
  return t.indexOf('未選択')===-1 && t.indexOf('選んでください')===-1;
}
function canPass(n){
  hideStageError();
  if(n===1){
    var f=areaFailure();
    if(f){ showStageError('地域の読み込みに失敗しています：'+f+'。再取得してから進んでください。'); return false; }
    return true;
  }
  if(n===2){
    if(!shelterChosen()){ showStageError('配送先が未選択です。施設一覧または地図のオレンジの点から選んでください。'); return false; }
    return true;
  }
  if(n===3){
    if(!originChosen()){ showStageError('出発地点が未選択です。地図の中央で選んでください。'); return false; }
    return true;
  }
  return true;
}
function refreshStageMarks(){
  var done={1:!areaFailure(),2:shelterChosen(),3:originChosen()};
  for(var i=1;i<=3;i++){
    var tab=$('stage-tab-'+i);
    if(!tab || !tab.classList) continue;
    if(done[i]) tab.classList.add('stage-done'); else tab.classList.remove('stage-done');
  }
}
function setStage(n){
  stage=Math.min(4,Math.max(1,n));
  try{ mapPanel.setAttribute('data-stage',String(stage)); }catch(e){}
  for(var i=1;i<=4;i++){
    var tab=$('stage-tab-'+i);
    if(!tab) continue;
    if(i===stage) tab.setAttribute('aria-current','step'); else tab.removeAttribute('aria-current');
  }
  var desc=$('stage-desc');
  if(desc){
    if(stage===4){
      var area=$('map-area-title'),sel=$('shelter-select');
      var destination=sel&&sel.selectedOptions&&sel.selectedOptions[0]?sel.selectedOptions[0].textContent.split(' — ')[0]:'選択した施設';
      desc.textContent=(area?area.textContent.replace(' ／ 実地図',''):'選択地域')+' → '+destination+'。出発地点：選択済み。機体数と注意を確認して開始します。';
    }else desc.textContent=STAGE_DESC[stage];
  }
  hideStageError();
  var back=$('stage-back'), next=$('stage-next');
  if(back) back.disabled=stage<=1;
  if(next) next.textContent=(stage===4?'開始へ進む':'次へ');
  refreshStageMarks();
  if(typeof window!=='undefined' && window.matchMedia?.('(max-width:850px)').matches && typeof window.scrollTo==='function')window.scrollTo({top:0,behavior:'auto'});
}
function onStageNext(){
  if(stage<4){ if(canPass(stage)) setStage(stage+1); return; }
  var s=$('map-sim-start');
  if(s && s.focus) s.focus();
}
function onStageBack(){ if(stage>1) setStage(stage-1); }
function onStageTab(m){
  if(m<=stage){ setStage(m); return; }
  for(var k=stage;k<m;k++){ if(!canPass(k)) return; }
  setStage(m);
}
function showTutorial(i){
  tutorialIndex=Math.min(SLIDES.length-1,Math.max(0,i));
  var slide=SLIDES[tutorialIndex];
  var count=$('tutorial-count'), title=$('tutorial-title'), text=$('tutorial-text'), note=$('tutorial-note');
  if(count) count.textContent=(tutorialIndex+1)+' / '+SLIDES.length;
  if(title) title.textContent=slide.title;
  if(text) text.textContent=slide.text;
  if(note) note.textContent=slide.note;
  var back=$('tutorial-back'), next=$('tutorial-next');
  if(back) back.disabled=tutorialIndex===0;
  if(next) next.textContent=(tutorialIndex===SLIDES.length-1?'はじめる':'次へ');
  overlay.hidden=false;
  if(next && next.focus) next.focus();
}
function hideTutorial(){ overlay.hidden=true; }
function focusStageNext(){
  var n=(mapPanel.classList&&mapPanel.classList.contains('is-active'))?$('map-dock-stop'):(stage===4?$('map-sim-start'):$('stage-next'));
  if(n && n.focus && !n.hidden) n.focus({preventScroll:true});
}
function firstOpenCheck(){
  if(tutorialSeen || !isRealOpen()) return;
  tutorialSeen=true;
  setCollapsed(false);
  setStage(1);
  showTutorial(0);
}
function mirror(realId,miniId,copyText){
  var r=$(realId), m=$(miniId);
  if(!r || !m) return;
  m.hidden=!!r.hidden;
  m.disabled=!!r.disabled;
  if(copyText && r.textContent) m.textContent=r.textContent;
}
function mirrorDetour(){
  var det=$('map-sim-detour'), alt=$('map-sim-alternate'), m=$('mini-detour');
  if(!m) return;
  var r=(alt && !alt.hidden)?alt:det;
  if(!r){ m.hidden=true; return; }
  m.hidden=!!r.hidden;
  m.disabled=!!r.disabled;
  if(r.textContent) m.textContent=r.textContent;
}
function syncMini(){
  if(!mini) return;
  var open=isRealOpen();
  mini.hidden=!(open && collapsed);
  var st=$('map-sim-status'), ms=$('mini-status');
  if(ms) ms.textContent='1号機：'+((st && st.textContent)?st.textContent:'待機中');
  var fl=$('map-fleet-state'), mf=$('mini-fleet');
  if(mf){
    var ft=(fl && !fl.hidden && fl.textContent)?fl.textContent:((open && $('map-sim-stop') && !$('map-sim-stop').hidden)?'2号機：状況を確認中':'');
    mf.textContent=ft;
    mf.hidden=!ft;
  }
  mirror('map-sim-stop','mini-stop',false);
  mirror('map-sim-consult','mini-consult',true);
  var notice=$('map-sim-consult-status'), miniNotice=$('mini-consult-notice'), consult=$('map-sim-consult');
  if(miniNotice){var noticeText=notice&&notice.textContent?notice.textContent:'';miniNotice.textContent=noticeText;miniNotice.hidden=!(consult&&!consult.hidden&&noticeText);}
  mirrorDetour();
  var dock=$('map-mission-dock');
  var vis=open && !!dock && !dock.hidden;
  if(vis && !lastStopVisible && !collapsed) setCollapsed(true);
  lastStopVisible=vis;
}
function setCollapsed(on){
  on=!!on;
  if(collapsed===on) return;
  collapsed=on;
  if(shell && shell.classList) shell.classList.toggle('panel-collapsed',collapsed);
  var t=$('panel-toggle');
  if(t){
    t.setAttribute('aria-expanded',String(!collapsed));
    t.textContent=(collapsed?'情報を表示':'情報を閉じる');
  }
  syncMini();
  try{
    if(typeof window!=='undefined' && window && window.dispatchEvent && typeof Event!=='undefined'){
      window.dispatchEvent(new Event('resize'));
      if(typeof requestAnimationFrame==='function') requestAnimationFrame(function(){
        try{ window.dispatchEvent(new Event('resize')); }catch(e){}
      });
    }
  }catch(e){}
}
function on(id,type,fn){
  var el=$(id);
  if(!el || !el.addEventListener) return;
  var prev=null;
  try{ prev=(el.handlers && el.handlers[type]) || null; }catch(e){ prev=null; }
  if(typeof prev!=='function') prev=null;
  el.addEventListener(type,function(e){
    if(prev) prev.call(this,e);
    fn.call(this,e);
  });
}
on('tutorial-back','click',function(){ showTutorial(tutorialIndex-1); });
on('tutorial-next','click',function(){
  if(tutorialIndex>=SLIDES.length-1){ hideTutorial(); focusStageNext(); }
  else showTutorial(tutorialIndex+1);
});
on('tutorial-skip','click',function(){ hideTutorial(); focusStageNext(); });
on('tutorial-reopen','click',function(){ tutorialSeen=true; showTutorial(0); });
on('stage-back','click',onStageBack);
on('stage-next','click',onStageNext);
for(var ti=1;ti<=4;ti++)(function(m){ on('stage-tab-'+m,'click',function(){ onStageTab(m); }); })(ti);
on('panel-toggle','click',function(){ setCollapsed(!collapsed); if(!collapsed) focusStageNext(); });
on('mini-expand','click',function(){ setCollapsed(false); focusStageNext(); });
on('mini-stop','click',function(){ var r=$('map-sim-stop'); if(r && !r.disabled && !r.hidden) r.click(); });
on('mini-consult','click',function(){ var r=$('map-sim-consult'); if(r && !r.disabled && !r.hidden) r.click(); });
on('mini-detour','click',function(){
  var alt=$('map-sim-alternate'), det=$('map-sim-detour');
  var r=(alt && !alt.hidden && !alt.disabled)?alt:det;
  if(r && !r.disabled && !r.hidden) r.click();
});
on('enter-realmap','click',function(){ setTimeout(firstOpenCheck,600); });
on('mode-real','click',function(){ setTimeout(firstOpenCheck,600); });
on('map-sim-start','click',function(){ setTimeout(syncMini,600); });
on('map-sim-stop','click',function(){ setTimeout(syncMini,600); });
if(document.addEventListener) document.addEventListener('keydown',function(e){
  if(!e || overlay.hidden) return;
  if(e.key==='Escape'){hideTutorial();focusStageNext();return;}
  if(e.key==='Tab'){
    var buttons=Array.from(overlay.querySelectorAll('button:not([disabled])'));
    if(!buttons.length)return;
    var first=buttons[0],last=buttons[buttons.length-1],active=document.activeElement;
    if(e.shiftKey && (active===first||!overlay.contains(active))){e.preventDefault();last.focus();}
    else if(!e.shiftKey && (active===last||!overlay.contains(active))){e.preventDefault();first.focus();}
  }
});
try{
  if(typeof MutationObserver!=='undefined'){
    var obs=new MutationObserver(function(){ try{ syncMini(); refreshStageMarks(); }catch(e){} });
    obs.observe(mapPanel,{attributes:true});
    var ids=['map-sim-status','map-fleet-state','map-sim-stop','map-sim-consult','map-sim-consult-status','map-sim-detour','map-sim-alternate','shelter-select','map-origin','area-list-status','draft-destination','map-base-status'];
    for(var oi=0;oi<ids.length;oi++){
      var el=$(ids[oi]);
      if(el) obs.observe(el,{attributes:true,childList:true,characterData:true,subtree:true});
    }
  }
}catch(e){}
setStage(1);
syncMini();
refreshStageMarks();
}catch(e){}
})();

// Keep the introductory choices connected to the same real-map state and checks.
(function missionWelcome(){
  const $ = id => document.getElementById(id);
  const dialog=$('mission-welcome');if(!dialog||typeof dialog.showModal!=='function')return;
  const sections=['welcome-intro','welcome-region','welcome-mission','welcome-destination','welcome-origin','welcome-confirm'];
  let step=0,picking=false;
  const err=$('welcome-error');
  function textError(message){err.textContent=message;err.hidden=!message;}
  function chooseArea(code){if(code==='13106'&&!$('example-detailed-city').disabled){$('example-detailed-city').click()}else{mapBuildingMode='detailed';for(const mode of ['detailed','highest','simple'])$(`buildings-${mode}`).setAttribute('aria-pressed',String(mode==='detailed'));$('quick-'+code)?.click()}sync();}
  function sync(){
    for(const button of $('welcome-regions').querySelectorAll('button'))button.setAttribute('aria-pressed',String($('quick-'+button.dataset.area)?.getAttribute('aria-pressed')==='true'));
    $('welcome-map-status').textContent=`${$('map-area-title').textContent}：${$('map-base-status').textContent}`;
    const original=$('shelter-select'),copy=$('welcome-shelter');
    const snapshot=Array.from(original.options).map(option=>[option.value,option.textContent,option.disabled]);
    const key=JSON.stringify(snapshot);if(copy.dataset.options!==key){copy.replaceChildren(...snapshot.map(([value,label,disabled])=>{const option=document.createElement('option');option.value=value;option.textContent=label;option.disabled=disabled;return option}));copy.dataset.options=key}
    copy.value=original.value;copy.disabled=original.disabled;
    const transcript=$('welcome-transcript');if(document.activeElement!==transcript)transcript.value=$('draft-transcript').value;transcript.disabled=$('draft-transcript').disabled;
    $('welcome-voice').textContent=$('draft-voice').textContent;$('welcome-voice-status').textContent=$('draft-voice-status').textContent;
    $('welcome-origin-state').textContent=$('map-origin').textContent;
    $('welcome-pick-origin').disabled=$('choose-origin').disabled;
    $('welcome-summary').textContent=`地域：${$('map-area-title').textContent.replace(' ／ 実地図','')} ／ 施設：${draftShelter||'未選択'} ／ ${$('map-origin').textContent} ／ 物資：${$('draft-supply').selectedOptions[0]?.textContent||'未指定'} ${$('draft-quantity').value?$('draft-quantity').value+'箱':''}`;
    $('welcome-next').disabled=step===4&&!mapOriginChosen;
  }
  function render(){sections.forEach((id,index)=>$(id).hidden=index!==step);$('welcome-back').hidden=step===0;$('welcome-map-inline').hidden=step!==0;$('welcome-steps').hidden=step===0;[...$('welcome-steps').children].forEach((item,index)=>{item.dataset.state=index+1<step?'done':index+1===step?'current':'pending';if(index+1===step)item.setAttribute('aria-current','step');else item.removeAttribute('aria-current')});$('welcome-next').textContent=['準備を始める','次へ','配送先を選ぶ','出発地点を選ぶ','内容を確認','シミュレーションを開始'][step];$('welcome-title').textContent=step===0?'街の状況を確かめ、支援を届ける。':'ミッションの準備';$('welcome-description').hidden=step!==0;$('welcome-kicker').textContent=step===0?'はじめての MUSE MISSION':`準備 ${step} / 5`;textError('');sync()}
  function open(){if(!dialog.open)dialog.showModal();render()}
  function collapse(){const shell=document.querySelector('.shell');if(shell&&!shell.classList.contains('panel-collapsed'))$('panel-toggle').click()}
  $('welcome-close').addEventListener('click',()=>{picking=false;dialog.close();collapse()});
  $('welcome-map-inline').addEventListener('click',()=>$('welcome-close').click());
  $('welcome-back').addEventListener('click',()=>{step=Math.max(0,step-1);render()});
  $('welcome-regions').addEventListener('click',event=>{const button=event.target.closest('button[data-area]');if(button)chooseArea(button.dataset.area)});
  $('welcome-transcript').addEventListener('input',event=>{const original=$('draft-transcript');original.value=event.target.value;original.dispatchEvent(new Event('input',{bubbles:true}))});
  $('welcome-voice').addEventListener('click',()=>$('draft-voice').click());
  $('welcome-apply').addEventListener('click',()=>{if(!$('draft-shelter-apply').hidden)$('draft-shelter-apply').click();if(!$('draft-apply').hidden)$('draft-apply').click();$('welcome-supply').value=$('draft-supply').value;$('welcome-quantity').value=$('draft-quantity').value;sync();textError('候補を確認し、必要なら施設・物資・数量を修正してください。')});
  $('welcome-shelter').addEventListener('change',event=>{const original=$('shelter-select');original.value=event.target.value;original.dispatchEvent(new Event('change',{bubbles:true}));sync()});
  $('welcome-supply').addEventListener('change',event=>{const original=$('draft-supply');original.value=event.target.value;original.dispatchEvent(new Event('change',{bubbles:true}));sync()});
  $('welcome-quantity').addEventListener('input',event=>{const original=$('draft-quantity');original.value=event.target.value;original.dispatchEvent(new Event('input',{bubbles:true}));sync()});
  $('welcome-fleet').addEventListener('change',event=>{const original=$('fleet-size');original.value=event.target.value;original.dispatchEvent(new Event('change',{bubbles:true}))});
  $('welcome-pick-origin').addEventListener('click',()=>{if($('choose-origin').disabled){textError('地図の読み込みをお待ちください。');return}picking=true;dialog.close();collapse();$('choose-origin').click()});
  $('welcome-next').addEventListener('click',()=>{
    sync();
    if(step===1&&mapAreaState!=='ready'){textError('地域データを読み込み中、または取得できません。地図の状態を確認してください。');return}
    if(step===3&&voicePending){textError('音声の認識が終わるまでお待ちください。');return}
    if(step===3&&!draftShelter){textError('配送先の施設を選んでください。');return}
    if(step===3&&!!$('draft-supply').value!==!!$('draft-quantity').value){textError('物資と数量は両方選ぶか、両方とも指定なしにしてください。');return}
    if(step===4&&!mapOriginChosen){textError('地図で出発地点を選んでください。');return}
    if(step===5){if($('map-sim-start').disabled){textError('開始の準備を確認中です。少し待つか、地図の読み込み状況を確認してください。');return}$('map-sim-start').click();setTimeout(()=>{if(largeFleetBusy||largeFleetLaunching||mapFleetActive||!['ready','needs-points'].includes(mapPlanPhase)){dialog.close();collapse()}else textError($('stage-error').textContent||$('map-sim-status').textContent||'開始条件を確認してください。')},100);return}
    step=Math.min(5,step+1);render();
  });
  dialog.addEventListener('cancel',()=>{picking=false;setTimeout(collapse,0)});
  $('tutorial-reopen').addEventListener('click',event=>{event.stopImmediatePropagation();step=0;open()},true);
  if(typeof MutationObserver!=='undefined'){
    const observer=new MutationObserver(()=>{sync();if(picking&&mapOriginChosen){picking=false;step=5;open()}});
    for(const id of ['map-origin','map-base-status','map-area-title','shelter-select','choose-origin','draft-voice-status','draft-voice']){const element=$(id);if(element)observer.observe(element,{attributes:true,childList:true,subtree:true,characterData:true})}
  }
  $('fleet-view-follow')?.addEventListener('click',()=>{if(realMap?.followLargeFleet?.(true)){$('fleet-view-follow').setAttribute('aria-pressed','true');$('fleet-view-wide').setAttribute('aria-pressed','false')}});
  $('fleet-view-wide')?.addEventListener('click',()=>{if(realMap?.followLargeFleet?.(false)){$('fleet-view-follow').setAttribute('aria-pressed','false');$('fleet-view-wide').setAttribute('aria-pressed','true');realMap.chooseCamera('wide')}});
  showRealMap();open();
})();

// Translate presentation copies only; original form fields and mission state remain Japanese.
(function setupInterfaceLanguage(){
  if(typeof document==='undefined'||!document.createTreeWalker||typeof translateInterfaceText!=='function')return;
  const $lang=id=>document.getElementById(id);
  const selectors=[$lang('welcome-language'),$lang('map-language')].filter(Boolean);
  if(!selectors.length)return;
  const key='muse-mission-language-v1';
  let stored=null;try{stored=localStorage.getItem(key)}catch{}
  let language=resolveInterfaceLanguage(stored||globalThis.navigator?.language||'ja');
  const originals=new WeakMap();
  const scopes=['mission-welcome','origin-map-hint','map-radio-dock','map-camera-controls','mode-controls','map-legend','tutorial-overlay','mini-ops','fleet-hud','large-fleet-dock','fleet-comparison-review','map-subtitle','data-pilot','historical-flood-dialog','historical-mabi-dialog','photo-scan-dialog','exercise-dialog'];
  const roots=scopes.map(id=>$lang(id)||document.querySelector('.'+id)).filter(Boolean);
  for(const selector of ['#map-banner .map-context-note','#imagery-banner','#risk-banner','#water-banner','#map-source-notice','#map-banner-more','#mode-badge']){
    const element=document.querySelector(selector);if(element)roots.push(element);
  }
  function translateNode(node){
    const parent=node.parentElement;
    if(!parent||parent.closest('.language-control, .language-note, textarea, script, style, #gsi-scenario-status, #gsi-scenario-results, #gsi-range-comparison, #pilot-snapshot-status, #pilot-snapshot-preview, #exercise-history, #exercise-initial, #exercise-update, #pilot-infrastructure-reports, #pilot-history-recovery, #pilot-report-result, #pilot-report-message, #pilot-evidence-list, #pilot-river-note, #pilot-river-history, #pilot-river-message, #pilot-river-distance, #pilot-risk-review-area, #pilot-risk-review-message, #pilot-risk-review-history, #facility-report-current, #facility-receipt-current, #flood-comparison-forecast, #flood-comparison-reports'))return;
    // Spoken subtitles may contain unlabelled model output; preserve the original.
    if(parent.closest('#map-subtitle, #subtitle')&&!/^(?:アプリ：(?:仮想配送を停止しました|一部の機体を停止しました)。理由は左上をご確認ください。)$/.test(originals.get(node)?.source||node.nodeValue))return;
    let record=originals.get(node);
    if(!record||node.nodeValue!==record.rendered)record={source:node.nodeValue,rendered:node.nodeValue};
    const next=translateInterfaceText(record.source,language);
    record.rendered=next;originals.set(node,record);
    if(node.nodeValue!==next)node.nodeValue=next;
  }
  function translateTree(root){
    if(root.nodeType===3){translateNode(root);return}
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let node;
    while((node=walker.nextNode()))translateNode(node);
  }
  const attrs=[['welcome-transcript','placeholder'],['welcome-quantity','placeholder'],['decision-image','alt'],['decision-card','aria-label'],['fleet-hud','aria-label'],['pilot-close','aria-label'],['pilot-report-source','placeholder'],['facility-report-organization','placeholder'],['facility-report-source','placeholder'],['facility-report-condition','placeholder'],['facility-receipt-source','placeholder'],['flood-field-organization','placeholder'],['flood-field-source','placeholder'],['flood-compare-grid','aria-label'],['historical-flood-image-1','alt'],['historical-flood-image-2','alt'],['historical-flood-image-3','alt'],['historical-flood-large-1','alt'],['historical-flood-large-2','alt'],['historical-flood-large-3','alt'],['joso-ground-image','alt'],['joso-ground-aerial','alt'],['historical-mabi-image-1','alt'],['historical-mabi-image-2','alt'],['historical-mabi-large-1','alt'],['historical-mabi-large-2','alt'],['photo-scan-original','aria-label'],['photo-scan-overlay','aria-label']].map(([id,name])=>({element:$lang(id),name,source:$lang(id)?.getAttribute(name)}));
  function update(){
    document.documentElement.lang=language;
    selectors.forEach(select=>{select.value=language});
    const originalArea=$lang('map-area-title'),englishArea=$lang('map-area-title-english');
    if(originalArea&&englishArea){englishArea.textContent=translateInterfaceText(originalArea.textContent,'en');englishArea.hidden=language!=='en';originalArea.classList.toggle('language-original-hidden',language==='en')}
    for(const id of ['welcome-language-note','fleet-language-note'])if($lang(id))$lang(id).hidden=language!=='en';
    for(const item of attrs)if(item.element&&item.source)item.element.setAttribute(item.name,translateInterfaceText(item.source,language));
    roots.forEach(translateTree);
    realMap?.refreshFleetLanguage?.();
    if(typeof largeFleetData!=='undefined'&&largeFleetData?.comparison)renderLargeFleet(largeFleetData);
  }
  const observer=new MutationObserver(mutations=>{
    for(const mutation of mutations){
      if(mutation.type==='characterData')translateNode(mutation.target);
      else for(const node of mutation.addedNodes)if(node.nodeType===1||node.nodeType===3)translateTree(node);
    }
  });
  roots.forEach(root=>observer.observe(root,{childList:true,subtree:true,characterData:true}));
  const area=$lang('map-area-title');if(area)new MutationObserver(()=>{const english=$lang('map-area-title-english');if(english)english.textContent=translateInterfaceText(area.textContent,'en')}).observe(area,{childList:true,characterData:true,subtree:true});
  selectors.forEach(select=>select.addEventListener('change',()=>{language=resolveInterfaceLanguage(select.value);try{localStorage.setItem(key,language)}catch{}update()}));
  update();
})();


const key='muse-historical-reviews-v1';
const imageLabels={
  'joso-nied-20150911-am':['9月11日・時間帯要確認・防災科研','11 Sep, time of day unconfirmed · NIED'],
  'joso-20150911-pm':['9月11日午後・国土地理院','11 Sep afternoon · GSI'],
  'joso-20150915-am':['9月15日午前・国土地理院','15 Sep morning · GSI'],
  'mabi-20180709':['7月9日・国土地理院','9 Jul · GSI'],
  'mabi-20180711':['7月11日・国土地理院','11 Jul · GSI']
};
const choices={'water-like':['水らしく見える場所がある','Possible water visible'],'not-clear':['水らしい場所は見えない','No water-like area visible'],'uncertain':['見分けられない','Cannot tell'],'unavailable':['画像を確認できない','Image unavailable']};
const limits={time:['撮影時刻の詳細','Exact capture time'],alignment:['位置のずれ','Image alignment'],visibility:['雲・影・画質','Clouds, shadows or quality'],coverage:['写っていない範囲','Areas outside coverage'],reference:['現地調査との時点・地点の違い','Difference from field surveys']};
const imageElements={'joso-nied-20150911-am':'historical-flood-large-3','joso-20150911-pm':'historical-flood-large-1','joso-20150915-am':'historical-flood-large-2','mabi-20180709':'historical-mabi-large-1','mabi-20180711':'historical-mabi-large-2'};

function mountHistoricalReview({root,dialog,caseId,updateLocalHistory}){
  const images=HISTORICAL_REVIEW_IMAGES[caseId];if(!root||!dialog||!images)throw new Error('Unknown historical case');
  root.classList.add('historical-review');
  const el=(tag,parent,text)=>{const node=document.createElement(tag);if(text)node.textContent=text;parent.append(node);return node};
  const details=el('details',root),summary=el('summary',details),intro=el('p',details),form=el('form',details),selects={};
  const labels=[];
  for(const id of images){const label=el('label',form),caption=el('span',label),select=el('select',label);select.required=true;selects[id]=select;labels.push([caption,imageLabels[id]]);el('option',select).value='';for(const value of Object.keys(choices))el('option',select).value=value}
  const group=el('fieldset',form),legend=el('legend',group),checks={};
  for(const code of Object.keys(limits)){const label=el('label',group),input=el('input',label);input.type='checkbox';input.value=code;checks[code]=input;const text=el('span',label);labels.push([text,limits[code]])}
  const noteLabel=el('label',form),noteCaption=el('span',noteLabel),note=el('textarea',noteLabel);note.maxLength=300;note.rows=2;
  const privacy=el('p',form),save=el('button',form);save.type='submit';
  const status=el('p',details);status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const historyDetails=el('details',details),historySummary=el('summary',historyDetails),history=el('div',historyDetails),download=el('button',historyDetails),remove=el('button',historyDetails);download.type=remove.type='button';
  let generation=0,busy=false;
  const en=()=>document.documentElement.lang==='en',pick=pair=>pair[en()?1:0];
  const local=()=>{try{return decodeHistoricalReviews(localStorage.getItem(key))}catch{return {status:'corrupt',records:[]}}};
  function showHistory(){
    history.replaceChildren();const saved=local();
    if(saved.status!=='ok'){history.textContent=en()?'Records unavailable or unreadable. Use the recovery comparison.':'記録を読めません。保存内容の比較を確認してください。';return}
    const records=saved.records.filter(row=>row.caseId===caseId);if(!records.length){history.textContent=en()?'No records for this case.':'この事例の記録はありません。';return}
    for(const row of records){const item=el('p',history),description=Object.entries(row.assessments).map(([id,value])=>`${pick(imageLabels[id])}: ${pick(choices[value])}`).join(' / '),caveats=row.limitations.map(value=>pick(limits[value])).join(' / ')||(en()?'None recorded':'記録なし');item.textContent=`${new Date(row.recordedAt).toLocaleString(en()?'en':'ja-JP')} — ${description}\n${en()?'Uncertainties':'注意点'}: ${caveats}${row.notes?'\n'+row.notes:''}`}
  }
  function refresh(){
    summary.textContent=en()?'Record what you can see':'写真の見え方を記録';intro.textContent=en()?'Your own review of historical images. It is not ground truth, a flood map, or a safety decision.':'過去の写真についての本人の記録です。浸水の正解・範囲・安全を判定するものではありません。';
    for(const [node,pair] of labels)node.textContent=pick(pair);
    for(const select of Object.values(selects)){select.options[0].textContent=en()?'Choose':'選択してください';for(const option of Array.from(select.options).slice(1))option.textContent=pick(choices[option.value])}
    legend.textContent=en()?'Uncertainties noticed (optional)':'気になった不確かさ（任意）';noteCaption.textContent=en()?'Notes (optional, 300 characters max)':'メモ（任意・300文字以内）';privacy.textContent=en()?'Do not enter names or contact details. Up to 20 reviews across both cases stay on this device and are not sent to Muse.':'氏名・連絡先は入力しないでください。両事例あわせて最大20件を端末に保存し、Museへは送信しません。';
    save.textContent=en()?'Save review':'確認内容を保存';historySummary.textContent=en()?'Saved reviews':'保存した確認内容';download.textContent=en()?'Download this case':'この事例の記録を保存';remove.textContent=en()?'Delete this case’s records':'この事例の記録を削除';showHistory();
  }
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(busy)return;const epoch=generation,current=()=>dialog.open&&generation===epoch;
    if(images.some(id=>{const image=document.getElementById(imageElements[id]);return (!image?.complete||!image.naturalWidth)&&selects[id].value!=='unavailable'})){status.textContent=en()?'An image did not load. Choose “Image unavailable” for that image.':'読み込めなかった写真は「画像を確認できない」を選んでください。';return}
    try{
      const id=crypto.randomUUID(),record=createHistoricalReview({id,caseId,assessments:Object.fromEntries(images.map(image=>[image,selects[image].value])),limitations:Object.entries(checks).filter(([,input])=>input.checked).map(([code])=>code),notes:note.value,recordedAt:new Date().toISOString()});
      busy=true;save.disabled=remove.disabled=true;status.textContent=en()?'Saving…':'保存中…';
      await updateLocalHistory({storage:localStorage,locks:navigator.locks,key,stillCurrent:current,update:raw=>appendHistoricalReview(raw,record)});
      if(current()){form.reset();status.textContent=en()?'Review saved on this device.':'この端末に確認内容を保存しました。';showHistory()}
    }catch(error){if(current())status.textContent=en()?'Save failed or may be incomplete. Compare saved records before retrying.':`保存できなかったか、完了を確認できません：${error.message}`}
    finally{busy=false;save.disabled=remove.disabled=false}
  });
  download.addEventListener('click',()=>{const saved=local();if(saved.status!=='ok'){status.textContent=en()?'Records unavailable.':'記録を読めません。';return}const blob=new Blob([JSON.stringify(saved.records.filter(row=>row.caseId===caseId),null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`${caseId}-reviews.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)});
  remove.addEventListener('click',async()=>{
    if(busy)return;let expected;try{expected=localStorage.getItem(key)}catch{status.textContent=en()?'Records unavailable.':'記録を読めません。';return}
    if(!confirm(en()?'Delete this case’s reviews from this device?':'この事例の確認記録を端末から削除しますか？'))return;
    const epoch=generation,current=()=>dialog.open&&generation===epoch;
    try{busy=true;save.disabled=remove.disabled=true;await updateLocalHistory({storage:localStorage,locks:navigator.locks,key,expected,stillCurrent:current,update:raw=>{const saved=decodeHistoricalReviews(raw);if(saved.status!=='ok')throw new Error('記録を読めません');return JSON.stringify(saved.records.filter(row=>row.caseId!==caseId))}});if(current()){status.textContent=en()?'Records deleted.':'この事例の記録を削除しました。';showHistory()}}
    catch(error){if(current())status.textContent=en()?'Deletion failed or may be incomplete. Compare saved records.':`削除できなかったか、完了を確認できません：${error.message}`}
    finally{busy=false;save.disabled=remove.disabled=false}
  });
  dialog.addEventListener('close',()=>{generation++});window.addEventListener('storage',event=>{if(event.key===key&&dialog.open)showHistory()});refresh();
  return {refresh};
}


// DATA PILOT is a reading and local note-taking view; it never changes flight decisions.
if (typeof $ !== 'undefined' && typeof MutationObserver !== 'undefined') {
  const panel=$('data-pilot'), toggle=$('pilot-toggle'), form=$('pilot-form');
  let floodFeedRevision=0,floodFeedController=null,floodFeedTimer=null,floodFeedTouched=false,floodFeedRefreshStatus=null;
  let floodAutoTimer=null,floodAutoState='off';
  const floodAuto=$('pilot-flood-auto'),floodPanel=$('pilot-flood-panel'),riverPanel=$('pilot-river-section');
  function renderFloodAuto(){const en=document.documentElement.lang==='en';$('pilot-flood-auto-status').textContent=floodAutoState==='active'?(en?'Automatic refresh is on while this view is open.':'この画面を開いている間は自動更新します。'):floodAutoState==='stopped'?(en?'Automatic refresh stopped. Turn it on again to resume.':'自動更新を停止しました。再開するにはオンにしてください。'):(en?'Automatic refresh is off.':'自動更新はオフです。')}
  function stopFloodAuto(){clearTimeout(floodAutoTimer);floodAutoTimer=null;floodAuto.checked=false;floodAutoState='stopped';renderFloodAuto()}
  function scheduleFloodAuto(){
    clearTimeout(floodAutoTimer);floodAutoTimer=null;if(!floodAuto.checked)return;
    if(document.hidden||panel.hidden||!floodPanel.open||!riverPanel.open){stopFloodAuto();return}
    const interval=$('pilot-flood-frequency').value==='recent'?120000:3600000;
    floodAutoTimer=setTimeout(()=>{floodAutoTimer=null;if(!floodAuto.checked)return;if(document.hidden||panel.hidden||!floodPanel.open||!riverPanel.open){stopFloodAuto();return}if($('pilot-flood-load').disabled){scheduleFloodAuto();return}$('pilot-flood-load').click()},interval);
  }
  floodAuto.addEventListener('change',()=>{if(!floodAuto.checked){stopFloodAuto();return}if(document.hidden||panel.hidden||!floodPanel.open||!riverPanel.open){stopFloodAuto();return}floodAutoState='active';renderFloodAuto();if(!$('pilot-flood-load').disabled)$('pilot-flood-load').click()});
  for(const element of [floodPanel,riverPanel])element.addEventListener('toggle',()=>{if(!element.open&&floodAuto.checked){stopFloodAuto();resetFloodFeed(document.documentElement.lang==='en'?'View closed. Fetch the feed again when you return.':'画面を閉じたため、戻ったらフィードを再取得してください。')}});
  const floodPanelObserver=new MutationObserver(()=>{if(panel.hidden&&floodAuto.checked){stopFloodAuto();resetFloodFeed(document.documentElement.lang==='en'?'View closed. Fetch the feed again when you return.':'画面を閉じたため、戻ったらフィードを再取得してください。')}});floodPanelObserver.observe(panel,{attributes:true,attributeFilter:['hidden']});
  for(const id of ['welcome-language','map-language'])$(id)?.addEventListener('change',()=>queueMicrotask(renderFloodAuto));
  let floodEvidence={state:'unknown'};
  const floodBulletinEvidence=new Map();
  function setFloodEvidence(value){floodEvidence=value;if(!panel.hidden&&$('pilot-evidence-ledger').open)renderPilotEvidenceLedger()}
  const floodDetailControllers=new Set();
  const floodRelations=new Map(),floodStations=new Map(),floodDetailAges=new Map();let floodAreaTable=null;
  function updateFloodDetailAges(){
    const en=document.documentElement.lang==='en';
    for(const [node,fetchedAt] of floodDetailAges){
      if(!node.isConnected){floodDetailAges.delete(node);continue}
      const age=bulletinRetrievalAge(fetchedAt);
      node.textContent=age==='old'?(en?'This bulletin was retrieved over two hours ago. Retrieve it again and check the latest official information.':'この電文の取得から2時間以上経過しました。再取得し、最新情報を公式サイトでも確認してください。'):age==='clock'||age==='unknown'?(en?'Retrieval time or device clock is uncertain. Check the official information.':'取得時刻または端末の時計を確認できません。公式情報を確認してください。'):(en?'A recent retrieval does not prove this is the latest bulletin. Check the official information.':'取得したばかりでも、最新の電文とは限りません。公式情報を確認してください。');
    }
  }
  function updateFloodStations(){
    const en=document.documentElement.lang==='en',area=typeof activeArea==='string'?activeArea:String(activeArea?.cityCode||activeArea?.code||''),selected=Number.isInteger(shelterChoice)?shelterList[shelterChoice]:null,facility=selected?.name===draftShelter&&selected?.address===draftAddress?selected:null;
    for(const [node,item] of floodStations){
      if(!node.isConnected){floodStations.delete(node);continue}
      const match=mapAreaState==='ready'?floodBulletinStationContext(item,area,facility):{state:'unknown'};node.replaceChildren();
      if(match.state!=='matched'){node.textContent=en?'Station location and distance are not verified.':'観測所の座標と施設までの距離は未確認です。';continue}
      const text=document.createElement('span'),link=document.createElement('a');
      text.textContent=match.distance===null?(en?'Curated station match; select a facility to show approximate straight-line distance. ':'登録済み観測所と番号・名称が一致。施設を選ぶと直線距離を表示します。 '):(en?`Curated station match; approximately ${(match.distance/1000).toFixed(1)} km straight-line distance to ${facility.name}. Not river distance, current flood depth or safety. `:`登録済み観測所と番号・名称が一致。${facility.name}まで直線で約 ${(match.distance/1000).toFixed(1)} km。河川沿いの距離、現在の浸水深や安全を示しません。 `);
      link.href=match.station.metadataUrl;link.target='_blank';link.rel='noopener noreferrer';link.textContent=en?'MLIT station metadata ↗':'国交省の観測所情報 ↗';node.append(text,link);
    }
  }
  function updateFloodRelations(){
    const en=document.documentElement.lang==='en',code=typeof activeArea==='string'?activeArea:String(activeArea?.cityCode||activeArea?.code||''),label=$('map-area-title').textContent;
    for(const [node,item] of floodRelations){if(!node.isConnected){floodRelations.delete(node);continue}const relation=mapAreaState==='ready'?floodForecastAreaRelation(item.table,item.event,code):{state:'unknown'};
      node.textContent=relation.state==='listed'?(en?`JMA's May 27, 2026 CSV lists ${label} among municipalities related to ${relation.name}. Area and municipality codes were compared with the workbook updated October 9, 2026. Updates are not automatic. Facility flooding and safety are unknown.`:`気象庁の2026年5月27日版CSVでは、${label}は${relation.name}の関連する市区町村として掲載。2026年10月9日更新のExcelと区域・市区町村コードを照合。更新は自動確認せず、施設の浸水や安全は不明です。`):(en?`The reference table alone cannot determine a relationship to ${label}. A missing entry does not mean unaffected; check the latest official information.`:`${label}との関係はこの資料だけでは確認できません。記載がなくても対象外とは限りません。最新の公式情報を確認してください。`)}
  }
  const floodAreaObserver=new MutationObserver(updateFloodRelations);for(const id of ['map-area-title','area-view-status'])floodAreaObserver.observe($(id),{childList:true,characterData:true,subtree:true,attributes:id==='area-view-status'});
  for(const id of ['welcome-language','map-language'])$(id)?.addEventListener('change',()=>queueMicrotask(()=>{updateFloodRelations();updateFloodDetailAges();floodFeedRefreshStatus?.()}));
  function stopFloodDetails(){for(const controller of floodDetailControllers)controller.abort();floodDetailControllers.clear()}
  function resetFloodFeed(message){
    floodFeedRevision++;floodFeedController?.abort();floodFeedController=null;stopFloodDetails();floodRelations.clear();floodStations.clear();floodBulletinEvidence.clear();clearTimeout(floodFeedTimer);floodFeedTimer=null;floodFeedRefreshStatus=null;
    setConsultBulletin(null);setFloodEvidence({state:'unknown',feedType:$('pilot-flood-frequency').value});
    $('pilot-flood-load').disabled=false;$('pilot-flood-results').replaceChildren();$('pilot-flood-status').textContent=message;
  }
  $('pilot-flood-frequency').addEventListener('change',()=>{if(floodAuto.checked)stopFloodAuto();resetFloodFeed(document.documentElement.lang==='en'?'Feed changed. Retrieve the selected feed.':'フィードを切り替えました。選んだフィードを取得してください。')});
  document.addEventListener('visibilitychange',()=>{
    if(!document.hidden||!floodFeedTouched)return;
    if(floodAuto.checked)stopFloodAuto();
    resetFloodFeed(document.documentElement.lang==='en'?'Page hidden. Fetch the feed again when you return.':'画面を離れたため、戻ったらフィードを再取得してください。');
  });
  $('pilot-flood-load').addEventListener('click',async()=>{
    const button=$('pilot-flood-load'),status=$('pilot-flood-status'),results=$('pilot-flood-results'),en=document.documentElement.lang==='en',feedType=$('pilot-flood-frequency').value;
    if(!['long','recent'].includes(feedType)){resetFloodFeed(en?'Select a valid feed.':'フィードを選び直してください。');return}
    if(document.hidden){status.textContent=en?'Fetch again when the page is visible.':'画面を表示してから再取得してください。';return}
    clearTimeout(floodAutoTimer);floodAutoTimer=null;
    const revision=++floodFeedRevision,controller=new AbortController();floodFeedController=controller;floodFeedTouched=true;stopFloodDetails();floodRelations.clear();floodStations.clear();floodBulletinEvidence.clear();clearTimeout(floodFeedTimer);floodFeedTimer=null;floodFeedRefreshStatus=null;
    setConsultBulletin(null);
    setFloodEvidence({state:'loading',feedType});
    button.disabled=true;results.replaceChildren();status.textContent=en?'Retrieving the JMA feed…':'気象庁のフィードを取得中です。';
    try{
      const response=await fetch(feedType==='recent'?'/api/flood-feed-recent':'/api/flood-feed',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(20000)])});if(!response.ok)throw new Error('feed');
      const {xml,fetchedAt}=await response.json();if(typeof xml!=='string'||xml.length>5000000||/<!DOCTYPE/i.test(xml)||parseZonedTimestamp(fetchedAt)===null)throw new Error('format');
      if(revision!==floodFeedRevision||document.hidden)return;
      const doc=new DOMParser().parseFromString(xml,'application/xml'),root=doc.documentElement,ns='http://www.w3.org/2005/Atom';
      if(root.localName!=='feed'||root.namespaceURI!==ns||doc.querySelector('parsererror'))throw new Error('format');
      const child=(element,name)=>Array.from(element.children).find(node=>node.namespaceURI===ns&&node.localName===name),feedTime=child(root,'updated')?.textContent;
      if(parseZonedTimestamp(feedTime)===null)throw new Error('time');
      const entries=[];let skipped=0;
      for(const item of Array.from(root.children).filter(node=>node.namespaceURI===ns&&node.localName==='entry')){
        const id=child(item,'id')?.textContent||'';if(!/_VXKO(?:5\d|6\d|7\d|8\d)_/.test(id))continue;
        let link;try{link=new URL(id)}catch{skipped++;continue}
        const updated=child(item,'updated')?.textContent,summary=child(item,'content')?.textContent||'',author=child(child(item,'author')||item,'name')?.textContent||'';
        if(link.protocol!=='https:'||link.hostname!=='www.data.jma.go.jp'||link.port||link.username||link.password||!/^\/developer\/xml\/data\/[0-9]{14}_[0-9]+_VXKO(?:5\d|6\d|7\d|8\d)_[0-9]+\.xml$/.test(link.pathname)||link.search||link.hash||parseZonedTimestamp(updated)===null){skipped++;continue}
        entries.push({url:link.href,updated,summary:summary.slice(0,2000),author:author.slice(0,200)});
      }
      const date=value=>new Date(value).toLocaleString(en?'en':'ja-JP');
      setFloodEvidence({state:'available',feedType,updatedAt:feedTime,retrievedAt:fetchedAt,count:entries.length,skipped});
      const markAge=()=>{if(revision!==floodFeedRevision)return;clearTimeout(floodFeedTimer);const english=document.documentElement.lang==='en',format=value=>new Date(value).toLocaleString(english?'en':'ja-JP'),base=english?`Fetched: ${format(fetchedAt)} / ${feedType==='recent'?'recent':'long-term'} feed updated: ${format(feedTime)}. ${entries.length} nationwide entries.${skipped?' Some entries could not be displayed.':''}`:`取得：${format(fetchedAt)}／${feedType==='recent'?'短期':'長期'}フィード更新：${format(feedTime)}。全国の掲載 ${entries.length}件。${skipped?'一部の電文を表示できません。':''}`,now=Date.now(),updated=Date.parse(feedTime),fetched=Date.parse(fetchedAt),clockBad=!Number.isFinite(now)||updated>now+300000||fetched>now+300000,maxAge=feedType==='recent'?300000:7200000,old=now-updated>=maxAge||now-fetched>=maxAge;status.textContent=base+(clockBad?(english?' Check device and feed timestamps.':'端末やフィードの時刻を確認してください。'):old?(english?' The feed update or retrieval time is old. Whether distribution has stopped is unknown; check JMA.':'フィードの更新または取得から時間が経っています。配信停止かどうかは不明です。気象庁で確認してください。'):'');updateFloodDetailAges();if(!panel.hidden&&$('pilot-evidence-ledger').open)renderPilotEvidenceLedger();floodFeedTimer=setTimeout(markAge,60000)};floodFeedRefreshStatus=markAge;markAge();
      entries.sort((a,b)=>Date.parse(b.updated)-Date.parse(a.updated));
      if(!entries.length){const p=document.createElement('p');p.textContent=en?'No matching entries in this feed. This does not prove there are no forecasts; check JMA.':'このフィードに該当する掲載はありません。発表がないことは示しません。気象庁で確認してください。';results.append(p)}
      const list=document.createElement('div'),progress=document.createElement('p'),more=document.createElement('button');let displayed=0;
      list.id='pilot-flood-list';progress.setAttribute('role','status');progress.setAttribute('aria-live','polite');more.type='button';more.setAttribute('aria-controls',list.id);
      if(entries.length)results.append(list,progress);if(entries.length>30)results.append(more);
      const renderEntry=(entry,index)=>{
        const row=document.createElement('div'),p=document.createElement('p'),link=document.createElement('a'),button=document.createElement('button'),detail=document.createElement('p'),ageNote=document.createElement('p'),water=document.createElement('div');
        link.href=entry.url;link.target='_blank';link.rel='noopener noreferrer';link.textContent=en?'Official bulletin ↗':'公式電文 ↗';p.textContent=`${date(entry.updated)} / ${entry.author||'—'} / ${entry.summary||'—'} `;p.append(link);
        button.type='button';button.textContent=en?'View bulletin details':'電文の詳細を確認';detail.setAttribute('role','status');detail.setAttribute('aria-live','polite');ageNote.setAttribute('role','status');ageNote.dataset.floodDetailAge='';water.dataset.floodWater='';row.append(p,button,detail,ageNote,water);list.append(row);
        let relationNode=null;button.addEventListener('click',async()=>{
          if(document.hidden||revision!==floodFeedRevision)return;
          const en=document.documentElement.lang==='en';
          setConsultBulletin(null);const bulletinVersion=consultBulletinVersion;
          floodBulletinEvidence.delete(index);setFloodEvidence(floodEvidence);
          if(relationNode){floodRelations.delete(relationNode);relationNode=null}
          const active=new AbortController();floodDetailControllers.add(active);button.disabled=true;floodDetailAges.delete(ageNote);ageNote.textContent='';water.replaceChildren();detail.textContent=en?'Retrieving bulletin…':'電文を取得中です。';
          try{
            const response=await fetch('/api/flood-report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:entry.url}),signal:AbortSignal.any([active.signal,AbortSignal.timeout(20000)])});if(!response.ok)throw new Error('fetch');
            const {xml,fetchedAt}=await response.json();if(typeof xml!=='string'||xml.length>1000000||/<!DOCTYPE/i.test(xml)||parseZonedTimestamp(fetchedAt)===null)throw new Error('format');
            const doc=new DOMParser().parseFromString(xml,'application/xml'),root=doc.documentElement,main='http://xml.kishou.go.jp/jmaxml1/',headNs='http://xml.kishou.go.jp/jmaxml1/informationBasis1/';
            const direct=(parent,space,name)=>Array.from(parent?.children||[]).find(node=>node.namespaceURI===space&&node.localName===name),value=(parent,space,name)=>direct(parent,space,name)?.textContent?.trim().slice(0,2000)||'';
            if(root.localName!=='Report'||root.namespaceURI!==main||doc.querySelector('parsererror'))throw new Error('format');
            const control=direct(root,main,'Control'),head=direct(root,headNs,'Head');if(value(control,main,'Title')!=='指定河川洪水予報'||value(head,headNs,'InfoKind')!=='指定河川洪水予報')throw new Error('type');
            const kind=value(head,headNs,'InfoType'),event=value(head,headNs,'EventID'),serial=value(head,headNs,'Serial'),title=value(head,headNs,'Title'),issued=value(head,headNs,'ReportDateTime'),controlStatus=value(control,main,'Status'),office=value(control,main,'PublishingOffice'),headline=value(direct(head,headNs,'Headline'),headNs,'Text');
            if(revision!==floodFeedRevision||document.hidden||active.signal.aborted)return;
            floodDetailAges.set(ageNote,fetchedAt);updateFloodDetailAges();
            const issue=parseZonedTimestamp(issued)!==null?date(issued):(en?'unknown':'不明'),kindLabel=['発表','訂正','取消'].includes(kind)?kind:(en?'unknown':'不明');
            detail.textContent=en?`Bulletin type (original): ${kindLabel} / forecast area code: ${event||'unknown'} / number: ${serial||'unknown'} / issued: ${issue} / control status: ${controlStatus||'unknown'} / issuer: ${office||'unknown'} / retrieved: ${date(fetchedAt)}. ${title||''} ${headline||''}. ${kind==='取消'?'Cancellation of this bulletin does not mean flooding has ended. ':''}The latest status and any later corrections are not determined.`:`情報種別：${kindLabel}／予報区域コード：${event||'不明'}／番号：${serial||'不明'}／発表：${issue}／電文の状態：${controlStatus||'不明'}／発表官署：${office||'不明'}／電文取得：${date(fetchedAt)}。${title||''} ${headline||''}。${kind==='取消'?'この電文の取消は洪水の解除を意味しません。':''}最新の発表や後続の訂正は自動判定していません。`;
            const normalStatus=controlStatus==='通常',usableKind=['発表','訂正'].includes(kind),waterValues=normalStatus&&usableKind?floodBulletinWaterValues(root):{rows:[],truncated:false},waterNote=document.createElement('p');
            const bulletinEvidence={index,url:entry.url,issuedAt:issued,retrievedAt:fetchedAt,bulletinType:kind,controlStatus,event,serial,office,water:waterValues};
            floodBulletinEvidence.set(index,bulletinEvidence);setFloodEvidence(floodEvidence);if(bulletinVersion===consultBulletinVersion)setConsultBulletin(bulletinEvidence);
            if(!normalStatus){const warning=controlStatus==='訓練'?(en?'TRAINING bulletin; not an operational report. ':'訓練用の電文です。実際の発表として使えません。'):controlStatus==='試験'?(en?'TEST bulletin; not an operational report. ':'試験用の電文です。実際の発表として使えません。'):(en?'Bulletin operational status unknown; do not treat it as an operational report. ':'電文の運用種別が不明です。実際の発表として扱えません。');detail.prepend(document.createTextNode(warning))}
            waterNote.textContent=!normalStatus?(controlStatus==='訓練'?(en?'Training bulletin: water levels are not displayed.':'訓練用の電文のため水位情報は表示しません。'):controlStatus==='試験'?(en?'Test bulletin: water levels are not displayed.':'試験用の電文のため水位情報は表示しません。'):(en?'Operational status unknown: water levels are not displayed.':'運用種別が不明のため水位情報は表示しません。')):kind==='取消'?(en?'Cancelled bulletin: water levels are not displayed.':'取消電文のため水位情報は表示しません。'):!usableKind?(en?'Bulletin type is unknown: water levels are not displayed.':'情報種別が不明のため水位情報は表示しません。'):waterValues.rows.length?(en?'Water levels and labels as stated in this bulletin. “Current” refers to the bulletin time, not necessarily current water levels. Forecasts and missing values are shown separately. Only a small set of stations can be matched to locations; other station locations and distances are unknown. Facility flooding and safety are unknown.':'電文に記載された水位・区分・時刻です。「現況」は電文中の時点で、現在の水位ではありません。予測や欠測も表示します。一部の登録済み観測所を除き、座標と施設までの距離は未確認です。施設の浸水や安全は不明です。'):(en?'Water levels are not available in this bulletin. Current conditions are unknown.':'電文の水位情報は確認できません。現在の状況は不明です。');water.append(waterNote);
            for(const item of waterValues.rows){const line=document.createElement('p'),stationInfo=document.createElement('span'),level=item.condition==='欠測'?(en?'missing':'欠測'):item.value?`${item.value} ${item.unit||(en?'unit unknown':'単位不明')} (${item.condition||(en?'condition unknown':'状態不明')})`:(item.condition|| (en?'unknown':'不明'));line.textContent=en?`Station ${item.station||'unknown'} (${item.code||'code unknown'}, ${item.location||'location unknown'}) / ${item.label||'category unknown'} / ${item.time||'time unknown'} / ${level}`:`観測所 ${item.station||'不明'}（${item.code||'番号不明'}・${item.location||'所在地不明'}）／${item.label||'区分不明'}／${item.time||'時刻不明'}／${level}`;stationInfo.dataset.floodStation='';line.append(document.createElement('br'),stationInfo);water.append(line);floodStations.set(stationInfo,item)}updateFloodStations();
            if(waterValues.truncated){const line=document.createElement('p');line.textContent=en?'First 100 water level entries shown. Check the official bulletin for all entries.':'水位の先頭100件を表示。全件は公式電文で確認してください。';water.append(line)}
            relationNode=document.createElement('span');relationNode.dataset.floodRelation='';detail.append(document.createElement('br'),relationNode);floodRelations.set(relationNode,{event,table:null});updateFloodRelations();
            try{if(!floodAreaTable){const mapping=await fetch('/jma-river-areas-20260527.json',{cache:'no-store',signal:AbortSignal.any([active.signal,AbortSignal.timeout(10000)])});if(!mapping.ok)throw new Error('table');floodAreaTable=await mapping.json()}if(revision!==floodFeedRevision||active.signal.aborted||!relationNode.isConnected)return;floodRelations.set(relationNode,{event,table:floodAreaTable});updateFloodRelations()}catch{if(revision===floodFeedRevision&&!active.signal.aborted)updateFloodRelations()}
          }catch{if(revision===floodFeedRevision&&!active.signal.aborted){floodBulletinEvidence.delete(index);setFloodEvidence(floodEvidence);detail.textContent=en?'Could not read this bulletin; its type and current status are unknown.':'電文を取得・確認できません。情報種別と現在の状況は不明です。'}}
          finally{floodDetailControllers.delete(active);if(revision===floodFeedRevision)button.disabled=false}
        });
      };
      const showMore=()=>{if(revision!==floodFeedRevision||document.hidden)return;const end=Math.min(displayed+30,entries.length);for(;displayed<end;displayed++)renderEntry(entries[displayed],displayed);progress.textContent=en?`Showing ${displayed} of ${entries.length} readable entries. Confirm the latest official information.`:`読み取れた${entries.length}件中${displayed}件を表示。最新の公式情報を確認してください。`;more.disabled=displayed>=entries.length;more.textContent=more.disabled?(en?'All entries shown':'すべて表示しました'):(en?'Show more':'続きを表示')};
      more.addEventListener('click',showMore);if(entries.length)showMore();
    }catch{if(revision===floodFeedRevision){setFloodEvidence({state:'error',feedType});status.textContent=en?'Could not retrieve or read the feed. Current conditions are unknown; check JMA.':'フィードを取得できません、または内容を確認できません。現在の状況は不明です。気象庁で確認してください。'}}
    finally{if(revision===floodFeedRevision){floodFeedController=null;button.disabled=false;scheduleFloodAuto()}}
  });
  let shownKey=null,legacyRevision=0,legacyBusy=false;
  const identity=()=>({area:typeof activeArea==='string'?activeArea:String(activeArea?.cityCode||activeArea?.code||''),name:draftShelter,address:draftAddress});
  let scenarioKey=null,scenarioRevision=0,scenarioController=null,scenarioState={phase:'idle'};
  let savedScenario=null,savedScenarioState='idle',savedScenarioRevision=0;
  function scenarioContext(){
    const selected=Number.isInteger(shelterChoice)?shelterList[shelterChoice]:null,item=identity();
    if(mapAreaState!=='ready'||!selected||selected.name!==item.name||selected.address!==item.address||!Number.isFinite(selected.latitude)||!Number.isFinite(selected.longitude)||Math.abs(selected.latitude)>90||Math.abs(selected.longitude)>180)return null;
    return {key:JSON.stringify([item.area,item.name,item.address,selected.latitude,selected.longitude,facilitySelectionVersion]),name:item.name,latitude:selected.latitude,longitude:selected.longitude};
  }
  function renderGsiScenario(){
    const en=document.documentElement.lang==='en',point=scenarioContext(),button=$('gsi-scenario-load'),status=$('gsi-scenario-status'),list=$('gsi-scenario-results');button.disabled=!point||scenarioState.phase==='loading';list.replaceChildren();
    const tile=point?mapFloodContext(facilityFlood,draftShelter,draftAddress):null;
    const comparison=point&&point.key===scenarioKey&&scenarioState.phase==='ready'?compareScenarioRanges(tile,scenarioState.result.rows):{state:'unknown'};
    $('gsi-range-comparison').textContent=comparison.state==='unknown'?(en?'Cannot compare: retrieve both scenario sources for the selected facility. Missing information is not safety.':'比較できません。選択施設の両方の想定を確認してください。情報がないことは安全を意味しません。'):(en?`App comparison: river maximum ${comparison.maximum} m is ${comparison.state==='within'?'within':'outside'} the map color range ${tile}. Coverage, timing and assumptions may differ; this does not establish correctness, current flooding or safety.`:`アプリの数値照合：河川別の最大 ${comparison.maximum} m は、地図の着色区分 ${tile} の${comparison.state==='within'?'範囲内':'区分の外'}です。対象河川・時期・条件が異なる場合があり、正誤や現在の浸水・安全は判定できません。`);
    if(!point){status.textContent=en?'Choose a public facility.':'公開施設を選んでください。';return}
    const prefix=en?`${point.name}: `:`${point.name}：`;
    if(scenarioState.phase==='idle')status.textContent=prefix+(en?'Not retrieved. Coordinates are sent only when you select Retrieve.':'未取得。取得を押したときに座標を送ります。');
    else if(scenarioState.phase==='loading')status.textContent=prefix+(en?'Retrieving scenario…':'想定を取得中…');
    else if(scenarioState.phase==='ready'){
      const at=new Date(scenarioState.result.retrievedAt).toLocaleString(en?'en':'ja-JP');
      status.textContent=prefix+(en?`Retrieved ${at}; source update time unknown. Maximum-scale scenario, not current flooding.`:`取得 ${at}／元資料の更新時刻は不明。想定最大規模であり、現在の浸水ではありません。`);
      for(const item of scenarioState.result.rows){const li=document.createElement('li');li.textContent=en?`${item.river} (river ${item.riverCode}, branch ${item.subRiverCode}, office ${item.officeCode}): scenario maximum ${item.depth} m`:`${item.river}（河川 ${item.riverCode}・枝番 ${item.subRiverCode}・事務所 ${item.officeCode}）：想定最大 ${item.depth} m`;list.append(li)}
    }else if(scenarioState.phase==='empty'){
      const at=new Date(scenarioState.result.retrievedAt).toLocaleString(en?'en':'ja-JP');
      status.textContent=prefix+(en?`No scenario was returned (retrieved ${at}). This does not mean safe or no flooding.`:`対象の想定が返されませんでした（取得 ${at}）。浸水しないことや安全を意味しません。`);
    }
    else if(scenarioState.phase==='rate')status.textContent=prefix+(en?'Please wait a few seconds before trying again.':'連続取得を避けるため、数秒待ってから再度お試しください。');
    else if(scenarioState.phase==='busy')status.textContent=prefix+(en?'Another tab is retrieving a scenario. Wait before trying again.':'別の画面が取得中です。完了後にお試しください。');
    else if(scenarioState.phase==='coordination')status.textContent=prefix+(en?'Request coordination or the device clock is unavailable. Check them before retrying.':'連続取得の調整または端末時刻を確認できません。確認後にお試しください。');
    else status.textContent=prefix+(en?'Could not retrieve or read the scenario. Current conditions are unknown.':'想定を取得・確認できません。現在の状況は不明です。');
  }
  syncGsiScenario=()=>{const point=scenarioContext(),key=point?.key||null;if(key!==scenarioKey){scenarioRevision++;scenarioController?.abort();scenarioController=null;scenarioKey=key;scenarioState={phase:'idle'}}renderGsiScenario()};
  $('gsi-scenario-load').addEventListener('click',async()=>{
    syncGsiScenario();const point=scenarioContext();if(!point||scenarioController)return;const revision=scenarioRevision,controller=new AbortController();scenarioController=controller;scenarioState={phase:'loading'};renderGsiScenario();
    try{const result=await requestScenarioDepths({point,locks:navigator.locks,storage:localStorage,signal:controller.signal});if(revision!==scenarioRevision||controller.signal.aborted||scenarioContext()?.key!==point.key)return;scenarioState={phase:result.rows.length?'ready':'empty',result}}
    catch(error){if(revision!==scenarioRevision||controller.signal.aborted)return;scenarioState={phase:error?.code==='rate_wait'?'rate':error?.code==='busy'?'busy':error?.code==='coordination_unavailable'?'coordination':'error'}}
    finally{if(scenarioController===controller){scenarioController=null;renderGsiScenario();if(!panel.hidden&&$('pilot-evidence-ledger').open)renderPilotEvidenceLedger()}}
  });
  mountInfrastructureReports({root:$('pilot-infrastructure-reports'),panel,context:()=>({area:identity().area,ready:mapAreaState==='ready'}),updateLocalHistory});
  const readRecord=(item,key)=>{
    if(!key)return null;
    try{return validatePilotFacilityRecord(JSON.parse(localStorage.getItem(key)||'null'),item)}catch{return null}
  };
  function renderPilot(){
    if(panel.hidden)return;
    updateFloodStations();
    $('pilot-area').textContent=$('map-area-title').textContent;
    for(const row of sourceOverview(mapSourceEvidence,$('risk-toggle').checked)){
      const target=$(`pilot-${row.id}`);if(target){target.textContent=row.value;target.dataset.state=row.state}
    }
    $('pilot-observation').textContent=$('map-observation-status').textContent;
    $('pilot-observation-view').disabled=!observationAvailable;
    $('pilot-facility-flood').textContent=$('shelter-flood-status').textContent;
    $('pilot-weather-detail').textContent=$('map-weather-status').textContent;
    $('pilot-fetch-time').textContent=$('map-fetch-time').textContent;
    renderRiskReview();
    renderRiverPilot();
    renderFacilityReport();
    renderFacilityReceipt();
    renderFloodComparison();
    syncGsiScenario();
    renderSavedScenario();
    if($('pilot-evidence-ledger').open)renderPilotEvidenceLedger();
    const item=identity(),key=pilotFacilityKey(item.area,item.name,item.address);
    $('pilot-facility').textContent=key?`${item.name}（${item.address||'住所未記載'}）`:'地図や施設一覧から施設を選んでください。';
    for(const el of form.elements)el.disabled=!key;
    form.querySelector('[type="submit"]').disabled=!key||legacyBusy||mapAreaState!=='ready';$('pilot-delete').disabled=!key||legacyBusy||mapAreaState!=='ready';$('pilot-export').disabled=!key||legacyBusy||mapAreaState!=='ready';
    if(key!==shownKey){form.reset();shownKey=key;legacyRevision++;$('pilot-report-message').textContent=''}
    const record=readRecord(item,key);
    const english=document.documentElement.lang==='en';
    $('pilot-report-result').textContent=english?(record?`Local note: reported ${record.status==='available'?'accepting':'not accepting'}. Checked ${new Date(record.at).toLocaleString()} / source: ${record.source}. Reconfirmation is required.`:(key?'No note for this facility. Acceptance is unknown.':'Select a facility to save a note.')):(record?`端末内メモ：${record.status==='available'?'受入可能':'受入不可'}と確認。確認日時 ${new Date(record.at).toLocaleString('ja-JP')}／確認先 ${record.source}。再確認が必要です。`:(key?'この施設の確認メモはありません。受入状況は不明です。':'施設を選択するとメモを保存できます。'));
  }
  function setPilot(open){panel.hidden=!open;toggle.setAttribute('aria-expanded',String(open));if(open)renderPilot()}
  let ledgerSignature=null;
  function pilotEvidenceInputs(){
    const item=identity(),chosen=Number.isInteger(shelterChoice)?shelterList[shelterChoice]:null;
    const same=chosen?.name===item.name&&chosen?.address===item.address,context={area:item.area,name:same?item.name:'',address:same?item.address:''},key=pilotFacilityKey(context.area,context.name,context.address);
    let facilityRaw=undefined,receiptRaw=undefined,fieldRaw=undefined,riverRaw=undefined,riskRaw=undefined,infrastructureRaw=undefined;
    if(key)try{facilityRaw=localStorage.getItem(`${key}:report-v2`);receiptRaw=localStorage.getItem(`${key}:receipt-v1`);fieldRaw=localStorage.getItem(`${key}:flood-field-v1`)}catch{}
    const riverStation=selectedRiver();if(riverStation)try{riverRaw=localStorage.getItem(`muse-river-log-v2:${riverStation.id}`)}catch{}
    if(context.area)try{riskRaw=localStorage.getItem(`muse-risk-review-v1:${context.area}`)}catch{}
    if(context.area)try{infrastructureRaw=localStorage.getItem(`muse-infrastructure-reports-v1:${context.area}`)}catch{}
    const point=scenarioContext(),gsiScenario=point&&point.key===scenarioKey&&['ready','empty'].includes(scenarioState.phase)?{identity:context,latitude:point.latitude,longitude:point.longitude,...scenarioState.result}:null;
    return {identity:context,areaReady:mapAreaState==='ready',facilityPosition:same&&shelterState==='ready'?chosen:null,gsiScenario,evidence:mapSourceEvidence,forecast:facilityFlood,facilityRaw,receiptRaw,fieldRaw,riverStationId:riverStation?.id,riverRaw,riskRaw,infrastructureRaw,floodFeed:floodEvidence,floodBulletins:[...floodBulletinEvidence.values()],observation:observationEvidence,observationText:$('map-observation-status').textContent,fetchStartedAt:mapFetchStartedAt};
  }
  function renderPilotEvidenceLedger(){
    const target=$('pilot-evidence-list'),english=document.documentElement.lang==='en',rows=buildPilotEvidenceLedger(pilotEvidenceInputs());
    const signature=JSON.stringify({rows,english});if(signature===ledgerSignature)return;ledgerSignature=signature;
    const titles=english?{'map:buildings':'3D building model','map:shelters':'Published facilities','map:warning':'Weather warning','map:observation':'Nearby weather observation','scenario:facility':'Flood scenario at facility','reports:facility':'Facility human reports','reports:field':'Field human reports'}:{'map:buildings':'3D建物モデル','map:shelters':'公開施設一覧','map:warning':'大雨情報','map:observation':'近隣の気象観測','scenario:facility':'施設座標の洪水想定','reports:facility':'施設の人による報告','reports:field':'現地の人による報告'};
    titles['reports:receipt']=english?'Human receipt reports':'物資受領の人による報告';
    titles['infrastructure:manual']=english?'Human infrastructure reports':'電線・障害の人による報告';
    titles['jma:flood-feed']=english?'National river flood forecast feed':'指定河川洪水予報（全国フィード）';
    titles['gsi:facility-scenario']=english?'River flood scenarios at facility point':'施設地点の河川別洪水想定';
    const labels=english?{unknown:'unknown',detail_only:'see details',observed:'observation received',loading:'loading',available:'available',error:'failed',current:'bulletin received',stale:'bulletin stale',corrupt:'unreadable',unavailable:'unavailable',ok:'available',reported:'reported (unverified)',expired:'expired',time_unknown:'time unknown',checking:'reported checking',conditional:'reported conditional',unavailable_report:'reported unavailable'}:{unknown:'不明',detail_only:'詳細を参照',observed:'観測を取得',loading:'取得中',available:'利用可能',error:'取得失敗',current:'発表を取得',stale:'発表が古い',corrupt:'読み取れない',unavailable:'未選択・利用不可',ok:'確認可能',reported:'人の報告・未検証',expired:'期限切れ',time_unknown:'時刻不明',checking:'確認中との報告',conditional:'条件付きとの報告',unavailable_report:'受入不可との報告'};
    const values=english?{available:'reported accepting',unavailable:'reported not accepting',conditional:'reported conditional',checking:'reported checking',water_seen:'water reported visible',no_water_seen:'water reported not visible',uncertain:'reported unknown'}:{available:'受入可能との報告',unavailable:'受入不可との報告',conditional:'条件付きとの報告',checking:'確認中との報告',water_seen:'水が見えたとの報告',no_water_seen:'水が見えなかったとの報告',uncertain:'状況不明との報告'};
    const scopeLabel=english?{facility_point:'facility point',nearby_road:'nearby road',unspecified:'scope unknown',observation_reference:'nearby station; see observation details'}:{facility_point:'施設の一点',nearby_road:'施設付近の道路',unspecified:'範囲不明',observation_reference:'近隣観測所・詳細を参照'};
    labels.partial=english?'some entries unreadable':'一部の電文を表示できません';scopeLabel.national=english?'national, not matched to the selected location':'全国・選択地点との対応は未確認';
    labels.clock_unknown=english?'device clock needs checking':'端末時刻を要確認';
    labels.empty=english?'no scenarios returned; safety unknown':'想定の返却なし・安全は不明';
    const unknown=english?'unknown':'不明',fmt=value=>value?new Date(value).toLocaleString(english?'en':'ja-JP'):unknown;
    const opened=new Set([...target.querySelectorAll('details[open]')].map(node=>node.dataset.id));target.replaceChildren();const list=document.createElement('ul');
    for(const row of rows){
      const li=document.createElement('li'),details=document.createElement('details'),summary=document.createElement('summary'),body=document.createElement('p');details.dataset.id=row.id;details.open=opened.has(row.id);
      const name=titles[row.id]||(row.kind==='manual_infrastructure_report'?(english?'Human infrastructure report':'電線・障害の本人報告'):row.kind==='public_flood_bulletin'?(english?'Opened flood bulletin':'確認した洪水予報電文'):row.kind==='human_receipt'?(english?'Receipt report':'受領報告'):row.kind==='manual_risk_group'?(english?'Kikikuru self-reviews':'キキクルの本人確認メモ'):row.kind==='manual_risk_review'?(english?'Self-reported risk review':'本人の危険度確認メモ'):row.kind==='manual_river_group'?(english?'River level manual notes':'河川水位の手入力記録'):row.kind==='manual_river_note'?(english?'Manual river note':'水位の手入力'):row.id.startsWith('facility:')?(english?'Facility report':'施設報告'):(english?'Field report':'現地報告'));
      const riverStates=english?{review_due:'Review due',review_due_later:'Review planned',review_unspecified:'No review time',time_unknown:'Device time needs checking'}:{review_due:'再確認の時刻を過ぎました',review_due_later:'再確認予定あり',review_unspecified:'再確認の日時は未設定',time_unknown:'端末の日時を確認してください'};
      const label=['manual_river_note','manual_risk_review'].includes(row.kind)?riverStates[row.state]||unknown:['manual_river_group','manual_risk_group','human_report_group','manual_infrastructure_group'].includes(row.kind)&&row.state==='ok'?(row.count?(english?'unverified reports':'未検証の報告'):(english?'no reports':'報告なし')):row.id.startsWith('facility:')&&['available','unavailable','conditional','checking'].includes(row.state)?values[row.state]:labels[row.state]||unknown;
      const differences=row.differences,hasDifferences=!!(differences&&(differences.acceptance||differences.landing||differences.supplies.length>0)||row.id==='reports:field'&&row.differingScopes?.length);
      if(row.kind==='public_flood_feed'){
        const feedLabel=row.state==='available'?(english?'feed retrieved':'フィード取得'):row.state==='stale'?(english?'feed time is old':'フィードの時刻が古い'):label;
        const feedCount=Number.isInteger(row.count)?(english?` / ${row.count} readable${row.count===0?' (forecasts may exist)':''}`:` ／ 読取 ${row.count}件${row.count===0?'（発表の有無は不明）':''}`):'';
        summary.textContent=`${name} — ${feedLabel}${feedCount}`;
      }else if(row.kind==='public_flood_bulletin')summary.textContent=english?`${name} — type (original): ${row.bulletinType||unknown} / status (original): ${row.controlStatus||unknown} / ${label}`:`${name} — 情報種別：${row.bulletinType||unknown} ／ 運用種別：${row.controlStatus||unknown} ／ ${label}`;
      else summary.textContent=`${name} — ${label}${Number.isInteger(row.count)?` (${row.count})`:''}${hasDifferences?(english?' / reports differ':' ／ 内容に違いあり'):''}`;
      if(row.kind==='manual_infrastructure_report'&&row.correctedBy.length)summary.textContent+=english?` / named as correction target by ${row.correctedBy.length} report(s)`:` ／ 訂正元として指定 ${row.correctedBy.length}件`;
      const lines=[`${english?'Display ID':'表示用ID'}: ${row.id}`,`${english?'Scope':'対象'}: ${scopeLabel[row.scope]||row.scope||unknown}`];
      if(row.id==='reports:field'&&row.differingScopes?.length)lines.push(english?`Different reports in the same category: ${row.differingScopes.map(scope=>scopeLabel[scope]).join(', ')}. Locations and times may differ; review the original reports.`:`同じ分類で内容の異なる報告：${row.differingScopes.map(scope=>scopeLabel[scope]).join('・')}。場所や時刻は異なる場合があります。元の報告を確認してください。`);
      if(row.kind==='public_flood_feed')lines.push(english?`Feed: ${row.feedType==='recent'?'recent (minimum last 10 minutes)':row.feedType==='long'?'long-term (several days)':'unknown'}. Freshness thresholds are app indicators, not official validity. Whether distribution has stopped is unknown.`:`フィード：${row.feedType==='recent'?'短期（直近少なくとも10分）':row.feedType==='long'?'長期（数日分）':'不明'}。古さの表示はアプリの目安で、公式の有効期限ではありません。配信停止かどうかは不明です。`);
      if(row.fetchStartedAt)lines.push(`${english?'Request started':'取得開始'}: ${fmt(row.fetchStartedAt)} (${english?'not source update time':'データ更新時刻ではありません'})`);
      if(Object.hasOwn(row,'observedAt'))lines.push(`${english?'Observation / confirmation':'観測・確認'}: ${row.observedAt?fmt(row.observedAt):row.detail?(english?'see observation detail':'観測の詳細を参照'):unknown}`);
      if(Object.hasOwn(row,'retrievedAt'))lines.push(`${english?'Retrieved':'取得'}: ${fmt(row.retrievedAt)}`);
      if(Object.hasOwn(row,'updatedAt'))lines.push(`${english?'Source update':'元データの更新'}: ${fmt(row.updatedAt)}`);
      if(row.kind==='public_river_scenario'){
        lines.push(english?'Maximum-scale scenario at one facility point; not current flooding or flight safety. Source update time and point accuracy are unknown.':'施設の一点の想定最大規模であり、現在の浸水や飛行安全ではありません。元資料の更新時刻・座標の精度は不明です。');
        for(const value of row.values||[])lines.push(english?`${value.river} (river ${value.riverCode}, branch ${value.subRiverCode}, office ${value.officeCode}): scenario maximum ${value.depth} m`:`${value.river}（河川 ${value.riverCode}・枝番 ${value.subRiverCode}・事務所 ${value.officeCode}）：想定最大 ${value.depth} m`);
        if(row.state==='empty')lines.push(english?'No returned scenario does not establish safety or absence of flooding.':'想定が返されなくても、浸水しないことや安全を意味しません。');
      }
      if(row.kind==='public_flood_feed'){
        if(Number.isInteger(row.skipped))lines.push(`${english?'Unreadable entries':'表示できなかった電文'}: ${row.skipped}`);
        lines.push(english?'The feed may include past bulletins; zero entries does not establish that there are no forecasts. Current local conditions are unknown.':'過去の電文を含む場合があります。0件でも発表がないとは限らず、選択地点の現在の状況は不明です。');
      }
      if(row.kind==='public_flood_bulletin'){
        lines.push(`${english?'Issued':'発表'}: ${fmt(row.issuedAt)}`,`${english?'Forecast area code':'予報区域コード'}: ${row.event||unknown}`,`${english?'Bulletin number':'電文番号'}: ${row.serial||unknown}`,`${english?'Issuing office':'発表官署'}: ${row.office||unknown}`);
        lines.push(english?'Training and test bulletins are not operational reports. Cancellation of a bulletin does not establish that flooding has ended. Later corrections and current local conditions are unknown.':'訓練・試験の電文は実際の発表ではありません。電文の取消は洪水の解除を意味しません。後続の訂正や現在の現場状況は不明です。');
        if(row.waterStatus==='included'){
          lines.push(english?'Water values and categories as written in this bulletin; not current facility flooding or safety. A zero count does not prove there are no values.':'以下は電文中の水位と区分で、現在の施設の浸水や安全ではありません。0件でも水位情報がない証拠にはなりません。');
          for(const [i,value] of row.water.rows.entries()){
            lines.push(`${english?'Station':'観測所'}: ${value.station||unknown} (${value.code||unknown} / ${value.stationCodeType||unknown} / ${value.location||unknown}) / ${value.label||unknown} / ${value.time||unknown} / ${value.value||unknown} ${value.unit||unknown} / ${value.condition||unknown}`);
            const station=row.water.stationContexts[i];
            if(station.state==='matched')lines.push(station.distanceMeters===null?(english?`Matched station coordinates: ${station.latitude.toFixed(5)}, ${station.longitude.toFixed(5)}. Distance requires a selected facility with valid coordinates.`:`登録済み観測所の座標：${station.latitude.toFixed(5)}, ${station.longitude.toFixed(5)}。施設を選び、座標が確認できた場合に概算距離を表示します。`):(english?`Matched station: ${station.latitude.toFixed(5)}, ${station.longitude.toFixed(5)} / approximately ${(station.distanceMeters/1000).toFixed(1)} km straight-line to ${station.targetFacility}; not river distance or flood safety.`:`登録済み観測所：${station.latitude.toFixed(5)}, ${station.longitude.toFixed(5)} ／ ${station.targetFacility}まで直線で約 ${(station.distanceMeters/1000).toFixed(1)} km。河川沿いの距離や浸水・安全は不明です。`));
            else lines.push(english?'Station coordinates and distance are not verified.':'観測所の座標と施設までの距離は未確認です。');
          }
          if(row.water.truncated)lines.push(english?'Only the first 100 water entries were read; check the official bulletin.':'水位は先頭100件のみです。全件は公式電文を確認してください。');
        }else lines.push(row.waterStatus==='suppressed'?(english?'Water values are not included for this bulletin type or status.':'この電文の情報種別・運用種別では、水位は記録しません。'):(english?'Water values could not be verified.':'水位情報を確認できません。'));
      }
      if(row.kind==='public_observation'&&row.state==='observed'){
        lines.push(`${english?'Station':'観測所'}: ${row.station} (${row.stationId})`,`${english?'Reference point':'基準点'}: ${row.referenceLabel} / ${english?'straight-line distance':'直線距離'} ${Math.round(row.distance)} m`);
        lines.push(`${english?'Precipitation up to observation time':'観測時刻までの降水量'}: 10${english?' min':'分間'} ${row.rain===null?unknown:`${row.rain} mm`} / 1${english?' hour':'時間'} ${row.rain1h==null?unknown:`${row.rain1h} mm`} / 24${english?' hours':'時間'} ${row.rain24h==null?unknown:`${row.rain24h} mm`} / ${english?'10-minute average wind speed':'10分間平均風速'}: ${row.wind===null?unknown:`${row.wind} m/s`}`);
        lines.push(english?'Station ground observations do not establish conditions at the facility or in the air.':'観測所の地上の値です。施設や上空の状況を示すものではありません。');
      }
      if(row.expiresAt)lines.push(`${english?'Report expiry':'報告の期限'}: ${fmt(row.expiresAt)}`);
      if(row.kind==='manual_infrastructure_report'){
        const items=english?{wire:'wire or cable',pole:'pole',tree:'tree',work:'work or temporary equipment',other:'other'}:{wire:'電線・ケーブル',pole:'電柱',tree:'倒木・樹木',work:'工事・仮設設備',other:'その他'};
        const states=english?{present:'reported visible',damaged:'reported damaged',changed:'reported changed',not_seen:'reported not seen within viewed area',uncertain:'reported unable to verify'}:{present:'見えたとの報告',damaged:'破損との報告',changed:'以前と変化したとの報告',not_seen:'確認範囲では見えなかったとの報告',uncertain:'確認できなかったとの報告'};
        lines.push(`${english?'Location (unverified)':'場所（未検証）'}: ${row.location}`,`${english?'Item / report':'対象・報告内容'}: ${items[row.item]} / ${states[row.reportStatus]}`,`${english?'Self-reported source':'確認先の申告'}: ${row.source}`,`${english?'Recorded':'記録'}: ${fmt(row.recordedAt)}`);
        if(row.corrects)lines.push(`${english?'User-linked correction of display ID':'本人が指定した訂正元の表示ID'}: ${row.corrects}`);
        if(row.correctedBy.length)lines.push(`${english?'Reports that name this as their correction target':'この報告を訂正元として指定した表示ID'}: ${row.correctedBy.join(', ')}. ${english?'Neither the reports nor their relationship is verified.':'報告と訂正関係の正否は未確認です。'}`);
        if(row.changes.length){const names=english?{location:'Location',item:'Object',status:'Reported observation',source:'Source',observedAt:'Observed',expiresAt:'Recheck deadline'}:{location:'場所',item:'対象',status:'報告内容',source:'確認先',observedAt:'確認日時',expiresAt:'再確認期限'},display=(field,value)=>field==='item'?items[value]:field==='status'?states[value]:field==='observedAt'||field==='expiresAt'?fmt(value):value;lines.push(english?'Differences between the user-linked statements; not verified field changes.':'本人が関連づけた報告の違いであり、現場の変化を検証したものではありません。');for(const change of row.changes)lines.push(`${names[change.field]}：${display(change.field,change.before)} → ${display(change.field,change.after)}`)}
        lines.push(english?'Human report; location, current conditions and flight safety are not verified. This list does not send reports to Muse.':'人の報告です。位置・現在の状況・飛行安全は未検証です。この一覧からMuseには送信しません。');
      }
      if(row.kind==='human_receipt'){
        const statuses=english?{unconfirmed:'unconfirmed',not_received:'not received',received:'received',partial:'partially received',damaged:'damaged'}:{unconfirmed:'未確認',not_received:'未着',received:'受領',partial:'一部受領',damaged:'破損'};
        const supplies=english?{water:'water',food:'food',blanket:'blankets',hygiene:'hygiene supplies'}:{water:'飲料水',food:'食料',blanket:'毛布',hygiene:'衛生用品'};
        const kinds=english?{confirm:'confirm',redelivery:'redelivery',handoff:'handoff'}:{confirm:'再確認',redelivery:'再配送',handoff:'引き継ぎ'};
        const states=english?{planned:'planned',reported_done:'reported done',cancelled:'cancelled'}:{planned:'予定',reported_done:'実施したとの申告',cancelled:'中止'};
        lines.push(`${english?'Unverified receipt report':'未検証の受領報告'}: ${statuses[row.receiptStatus]}`,`${english?'Supply / expected / reported received':'物資 / 予定数 / 受領申告数'}: ${supplies[row.supply]} / ${row.expected} / ${row.received??unknown}`,`${english?'Reported at':'報告日時'}: ${fmt(row.reportedAt)}`);
        for(const action of row.followups)lines.push(`${english?'Self-reported follow-up':'対応の申告'}: ${kinds[action.kind]} / ${states[action.state]} / ${fmt(action.at)}`);
        lines.push(english?'This does not verify an actual receipt or action. Free-text notes are omitted.':'実際の受領や対応を確認したものではありません。補足メモは含みません。');
      }
      if(row.kind==='manual_river_note'){
        lines.push(`${english?'Manual entry; current level unknown':'手入力・現在の水位は不明'}: ${row.value} m`);
        lines.push(english?`Self-reported reference: ${riverDatumLabel(row.datum,true)} (unverified).`:`水位の基準：${riverDatumLabel(row.datum)}（本人申告・未検証）。`);
        lines.push(`${english?'Recorded':'記録'}: ${fmt(row.recordedAt)}`);
        lines.push(`${english?'Review planned':'再確認予定'}: ${fmt(row.reviewBy)}`);
        if(row.conflict)lines.push(english?'The same observation time has different values or references; recheck before comparing.':'同じ観測時刻に値または基準が異なる記録があります。比較する前に再確認してください。');
        if(row.relatedLevels?.length){
          lines.push(english?'A bulletin has the same registered station and observation time. This does not verify either value. The bulletin datum is unknown; values are not automatically compared.':'同じ登録観測所・観測時刻の電文があります。一致は数値の正確さを保証しません。電文の基準面は不明のため、数値を自動比較しません。');
          for(const level of row.relatedLevels){
            const freshness=level.sourceState==='available'?(english?'retrieved':'取得済み'):level.sourceState==='stale'?(english?'retrieval is old':'取得から時間が経過'):(english?'retrieval time unknown':'取得時刻不明');
            lines.push(english?`Bulletin observed value: ${level.value||unknown} ${level.unit||''} / condition: ${level.condition||unknown} / observed: ${fmt(level.observedAt)} / issued: ${fmt(level.issuedAt)} / retrieved: ${fmt(level.retrievedAt)} (${freshness})`:`電文の現況の値：${level.value||unknown} ${level.unit||''} ／ 状態：${level.condition||unknown} ／ 観測：${fmt(level.observedAt)} ／ 発表：${fmt(level.issuedAt)} ／ 取得：${fmt(level.retrievedAt)}（${freshness}）`);
            if(level.sourceTruncated)lines.push(english?'The bulletin water entries were truncated; other entries may exist.':'電文の水位項目は一部のみ表示しており、他の項目がある可能性があります。');
          }
          if(row.relatedLevelsTruncated)lines.push(english?'Only the first 20 matching entries are shown.':'一致する項目は先頭20件まで表示しています。');
        }
      }else if(row.kind==='manual_risk_review'){
        const appearances=english?{yellow:'yellow',red:'red',purple:'purple',black:'black',other:'another appearance',unconfirmed:'not verified'}:{yellow:'黄色',red:'赤色',purple:'紫色',black:'黒色',other:'その他の表示',unconfirmed:'確認できなかった'};
        const product=row.product==='inundation'?(english?'inundation risk':'浸水キキクル'):(english?'flood risk':'洪水キキクル');
        lines.push(`${english?'Self-reported appearance':'本人の申告'}: ${product} / ${appearances[row.appearance]}`);
        lines.push(`${english?'Checked':'確認'}: ${fmt(row.checkedAt)}`,`${english?'Recorded':'記録'}: ${fmt(row.recordedAt)}`,`${english?'Review planned':'再確認予定'}: ${fmt(row.reviewBy)}`);
        lines.push(english?'Location and source issue time unverified. Current conditions unknown.':'地点・情報の発表時刻は未検証。現在の状況は不明です。');
        if(row.differing)lines.push(english?'Different statements share a product and check time; verify location and entry.':'同じ種類・確認時刻に異なる申告があります。地点や入力を確認してください。');
      }else if(row.value)lines.push(`${english?'Scenario only':'将来の想定'}: ${row.value}`);
      if(row.reportedValue)lines.push(`${english?'Unverified report':'未検証の報告'}: ${values[row.reportedValue]||unknown}`);
      if(row.declaredSource)lines.push(`${english?'Self-reported source':'申告された確認先'}: ${row.declaredSource}`);
      if(hasDifferences)lines.push(english?'Active reports differ in acceptance, landing or quantities. Compare times and details; do not assume which is correct.':'期限内の報告で受け入れ・着地点・数量に違いがあります。日時と内容を比較し、どれが正しいか再確認してください。');
      if(row.detail)lines.push(`${english?'Observation detail':'観測の詳細'}: ${row.detail}`);
      body.textContent=lines.join('\n');details.append(summary,body);
      if(row.sourceUrl){const link=document.createElement('a');link.href=row.sourceUrl;link.target='_blank';link.rel='noopener noreferrer';link.textContent=['manual_river_note','manual_risk_review'].includes(row.kind)?(english?'Open official page (does not verify this note) ↗':'公式ページを開く（この記録の検証ではありません） ↗'):(english?'Open source ↗':'出典を開く ↗');details.append(link)}
      if(row.kind==='manual_infrastructure_report'){
        const targets=[...(row.corrects?[{id:row.corrects,label:english?'Open correction target':'訂正元を開く'}]:[]),...row.correctedBy.map((id,index)=>({id,label:english?`Open linked correction ${index+1}`:`訂正報告${index+1}を開く`}))];
        for(const entry of targets){const button=document.createElement('button');button.type='button';button.textContent=entry.label;button.addEventListener('click',()=>{const destination=[...target.querySelectorAll('details[data-id]')].find(node=>node.dataset.id===entry.id);if(!destination)return;destination.open=true;destination.querySelector('summary')?.focus();destination.scrollIntoView({block:'nearest'})});details.append(button)}
      }
      if(row.kind==='manual_river_note')for(const url of new Set((row.relatedLevels||[]).map(level=>level.sourceUrl))){const link=document.createElement('a');link.href=url;link.target='_blank';link.rel='noopener noreferrer';link.textContent=english?' Related JMA bulletin ↗':' 関連する気象庁電文 ↗';details.append(link)}
      if(row.kind==='public_flood_bulletin'&&row.waterStatus==='included')for(const url of new Set(row.water.stationContexts.filter(item=>item.state==='matched').map(item=>item.sourceUrl))){const link=document.createElement('a');link.href=url;link.target='_blank';link.rel='noopener noreferrer';link.textContent=english?' Station metadata ↗':' 観測所の位置・諸元 ↗';details.append(link)}
      li.append(details);list.append(li);
    }
    target.append(list);
  }
  $('pilot-evidence-ledger').addEventListener('toggle',()=>{if($('pilot-evidence-ledger').open)renderPilotEvidenceLedger()});
  $('pilot-evidence-export').addEventListener('click',()=>{
    const status=$('pilot-evidence-export-status'),en=document.documentElement.lang==='en';
    try{const snapshot=createPilotEvidenceSnapshot(pilotEvidenceInputs()),blob=new Blob([JSON.stringify(snapshot,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='muse-data-pilot-snapshot.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);status.textContent=en?'Download started. This is a snapshot, not proof of current conditions.':'保存を開始しました。保存時点の一覧であり、現在の状況を証明するものではありません。'}catch{status.textContent=en?'Could not prepare the snapshot.':'一覧をファイルに保存できません。'}
  });
  let savedScenarioRenderKey='';
  function renderSavedScenario(){
    const en=document.documentElement.lang==='en',status=$('pilot-snapshot-status'),preview=$('pilot-snapshot-preview'),item=identity();
    const key=JSON.stringify([savedScenarioRevision,savedScenarioState,en,item.area,item.name]);
    if(key===savedScenarioRenderKey)return;
    const previousKey=savedScenarioRenderKey,openStates=[...preview.querySelectorAll('details')].map(detail=>detail.open);
    savedScenarioRenderKey=key;preview.replaceChildren();
    status.textContent=savedScenarioState==='loading'?(en?'Reading file on this device…':'端末内でファイルを読み込み中…'):savedScenarioState==='error'?(en?'Could not read this snapshot or its scenario. Choose a supported file under 1 MiB.':'ファイルまたは洪水想定を確認できません。1 MiB以下の対応ファイルを選んでください。'):savedScenarioState==='ready'?(en?'File read on this device.':'端末内でファイルを読み込みました。'):'';
    if(!savedScenario)return;
    const add=text=>{const p=document.createElement('p');p.textContent=text;preview.append(p)},s=savedScenario,fmt=value=>value?new Date(value).toLocaleString(en?'en':'ja-JP'):(en?'unknown':'不明');
    add(en?'Saved-file contents; origin and authenticity are unverified. This is not current flooding or flight safety.':'保存ファイルの記載です。出所と真偽は未確認で、現在の浸水や飛行安全ではありません。');
    add(en?`Saved ${fmt(s.savedAt)} / region ${s.area||'unknown'} / facility ${s.facility||'unknown'} / scenario retrieved ${fmt(s.retrievedAt)} / source update unknown`:`保存 ${fmt(s.savedAt)} ／ 地域 ${s.area||'不明'} ／ 施設 ${s.facility||'不明'} ／ 想定取得 ${fmt(s.retrievedAt)} ／ 元資料の更新時刻は不明`);
    if(item.area&&item.name&&s.area===item.area&&s.facility===item.name)add(en?'Region code and facility name match the current selection; the location and identity are not verified.':'現在の選択と地域コード・施設名が一致します。場所や同一施設かどうかは未確認です。');
    else add(en?'The saved region or facility name does not match the current selection, or no facility is selected.':'保存された地域または施設名が現在の選択と異なるか、施設が未選択です。');
    if(s.state==='unknown')add(en?'The file contains no verified scenario result.':'このファイルには確認できる想定結果がありません。');
    else if(s.state==='empty')add(en?'The file records no returned scenario; safety remains unknown.':'想定の返却なしと記録されています。安全は不明です。');
    else for(const v of s.values)add(en?`${v.river} (river ${v.riverCode}, branch ${v.subRiverCode}, office ${v.officeCode}): recorded scenario maximum ${v.depth} m`:`${v.river}（河川 ${v.riverCode}・枝番 ${v.subRiverCode}・事務所 ${v.officeCode}）：記録された想定最大 ${v.depth} m`);
    const overview=s.overview;
    if(overview){
      if(overview.incomplete)add(en?'Some entries have inconsistencies, unreadable fields or related details not shown. Open the flagged rows and inspect the original file.':'一部の項目に不一致・読めない値・表示していない関連情報があります。注意の付いた行と元ファイルを確認してください。');
      if(overview.omitted)add(en?`${overview.omitted} entries are outside this preview, shown separately, or exceed its limit.`:`対象外・別表示・件数超過のため、${overview.omitted}件はこの一覧に表示していません。`);
      const group=document.createElement('details'),heading=document.createElement('summary'),list=document.createElement('ul');
      heading.textContent=en?'Other information recorded in this file':'このファイルに記録されたその他の情報';group.append(heading);
      const notice=document.createElement('p');notice.textContent=en?'Historical file contents only; sources, people, times and location matches are not verified. Check current original sources. No information here is used for a mission.':'保存時点のファイル記載です。出所・報告者・時刻・地点の一致は未検証です。現在の情報は元の出典で確認してください。配送の判断には使いません。';group.append(notice);
      const names={public_flood_feed:['洪水予報フィード','Flood forecast feed'],public_model:['建物モデル','Building model'],public_facilities:['公開施設一覧','Published facilities'],public_warning:['気象情報','Weather information'],public_observation:['気象観測','Weather observation'],public_flood_bulletin:['洪水予報電文','Flood bulletin'],scenario:['施設の洪水想定','Facility flood scenario'],human_report_group:['人による報告の一覧','Human report group'],human_report:['人による報告','Human report'],human_receipt:['物資受領の報告','Receipt report'],manual_river_group:['水位の手入力一覧','Manual river notes'],manual_river_note:['水位の手入力','Manual river note'],manual_risk_group:['キキクル確認一覧','Kikikuru reviews'],manual_risk_review:['キキクルの本人確認','Self-reported risk review'],manual_infrastructure_group:['設備報告の一覧','Infrastructure reports'],manual_infrastructure_report:['電線・障害の報告','Infrastructure report']};
      const fieldNames={scope:['対象','Scope'],state:['保存時の状態','Saved state'],feedType:['フィード種別','Feed type'],count:['記録数','Count'],value:['値','Value'],datum:['基準面','Datum'],reportedValue:['報告内容','Reported value'],reportStatus:['報告状態','Report status'],receiptStatus:['受領状態','Receipt status'],supply:['物資','Supplies'],expected:['予定数','Expected'],received:['受領数','Received'],station:['観測所','Station'],stationId:['観測所ID','Station ID'],distance:['概算直線距離（m）','Approx. straight-line distance (m)'],rain:['10分降水量（mm）','10-minute rain (mm)'],rain1h:['1時間降水量（mm）','1-hour rain (mm)'],rain24h:['24時間降水量（mm）','24-hour rain (mm)'],wind:['10分平均風速（m/s）','10-minute mean wind (m/s)'],detail:['観測の詳細','Observation detail'],product:['対象情報','Product'],appearance:['表示の申告','Reported appearance'],item:['対象物','Item'],location:['報告場所','Reported location'],sourceUrl:['ファイル記載の出典（未検証）','Source as recorded (unverified)'],declaredSource:['申告された確認先','Reported source'],source:['申告された確認先','Reported source'],observedAt:['観測・確認日時','Observed/confirmed'],retrievedAt:['取得日時','Retrieved'],issuedAt:['発表日時','Issued'],reportedAt:['報告日時','Reported'],recordedAt:['記録日時','Recorded'],checkedAt:['確認日時','Checked'],expiresAt:['再確認期限','Review expiry'],reviewBy:['再確認予定','Review due']};
      const values={unknown:['不明','unknown'],stale:['古いとの記録','recorded as stale'],available:['利用可能との記録','recorded available'],error:['取得失敗との記録','recorded failure'],current:['当時の発表を取得したとの記録','bulletin recorded as received'],observed:['観測取得の記録','observation recorded'],expired:['保存時に期限切れとの記録','recorded expired at save time'],reported:['本人の報告','self-reported'],water_seen:['水が見えたとの報告','water reportedly visible'],no_water_seen:['水が見えなかったとの報告','water reportedly not visible'],uncertain:['不明との報告','reported unknown'],checking:['確認中との報告','reported checking'],conditional:['条件付きとの報告','reported conditional'],unavailable:['利用不可との記録','recorded unavailable'],partial:['一部受領との報告','reported partially received'],received:['全数受領との報告','reported received'],not_received:['未受領との報告','reported not received'],damaged:['破損との報告','reported damaged'],unconfirmed:['未確認との記録','recorded unconfirmed'],review_due:['再確認時刻を過ぎたとの記録','review was due at save time'],review_due_later:['再確認予定ありとの記録','review was planned at save time'],review_unspecified:['再確認時刻の記載なし','no review time recorded'],facility_point:['施設の一点','facility point'],nearby_road:['施設付近の道路','nearby road'],unspecified:['範囲不明','scope unknown'],water:['飲料水','water'],food:['食料','food'],blanket:['毛布','blanket'],hygiene:['衛生用品','hygiene supplies'],wire:['電線・ケーブル','wire/cable'],pole:['電柱','pole'],tree:['樹木','tree'],work:['工事・仮設','work/temporary'],present:['見えたとの報告','reported visible'],changed:['変化したとの報告','reported changed'],not_seen:['見えなかったとの報告','reported not visible']};
      const warnings={invalid_time:['日時を読み取れません','A timestamp could not be read'],field_unreadable:['一部の値を読み取れません','A field could not be read'],expired_at_save:['保存日時には期限を過ぎている可能性があります。状態と時刻を照合してください','The expiry may precede the save time. Check state and time'],scope_mismatch:['行の施設名が保存ヘッダーと一致しません','The row facility differs from the saved header'],scope_unrecognized:['報告の対象範囲を確認できません','The report scope is unrecognized'],expiry_mismatch:['保存日時と期限切れの記録が一致しません','The expiry and saved state do not agree'],time_after_save:['観測時刻が保存時刻より後です。時計や入力を確認してください','Observation is after the save time. Check clock and input'],numeric_invalid:['件数や数値が想定範囲外です','A count or number is outside the expected range'],details_omitted:['訂正・関連情報や対応の詳細を表示していません。元ファイルを確認してください','Correction, related information or follow-up details are not shown. Check the original file']};
      for(const row of overview.rows){const li=document.createElement('li'),details=document.createElement('details'),summary=document.createElement('summary'),body=document.createElement('p'),name=names[row.kind];summary.textContent=(row.warnings.length?'⚠ ':'')+(name?.[en?1:0]||row.kind);const lines=row.warnings.map(code=>warnings[code]?.[en?1:0]||code);for(const [key,value] of Object.entries(row.fields)){const label=fieldNames[key]?.[en?1:0]||key,translated=typeof value==='string'&&['state','reportedValue','reportStatus','receiptStatus','scope','supply','item'].includes(key)?values[value]?.[en?1:0]:null;lines.push(`${label}: ${translated||value}`)}if(row.differingScopes?.length){const scopes=row.differingScopes.map(scope=>values[scope]?.[en?1:0]||scope).join(' / ');lines.push(en?`Saved category differences: ${scopes}. Places and times may differ; inspect the original reports.`:`保存時に同じ分類で違いがあった報告：${scopes}。場所や時刻は異なる場合があります。元の報告を確認してください。`)}body.textContent=lines.join(' ／ ');details.append(summary,body);li.append(details);list.append(li)}
      group.append(list);const limit=document.createElement('p');limit.textContent=en?`Up to 60 supported entries shown; ${overview.omitted} other or separately displayed entries omitted.${overview.incomplete?' Some fields could not be read.':''}`:`対応する項目を最大60件表示。対象外・別表示・超過 ${overview.omitted}件。${overview.incomplete?'一部の項目は読み取れませんでした。':''}`;group.append(limit);preview.append(group);
    }
    if(previousKey&&JSON.parse(previousKey)[0]===savedScenarioRevision)[...preview.querySelectorAll('details')].forEach((detail,index)=>{detail.open=!!openStates[index]});
  }
  $('pilot-snapshot-file').addEventListener('change',async event=>{
    const file=event.target.files?.[0],revision=++savedScenarioRevision;savedScenario=null;savedScenarioState=file?'loading':'idle';renderSavedScenario();if(!file)return;
    try{if(file.size>1024*1024)throw new Error('size');const bytes=await file.arrayBuffer(),text=new TextDecoder('utf-8',{fatal:true}).decode(bytes),decoded=decodeScenarioSnapshot(text);decoded.overview=decodePilotEvidencePreview(text);if(revision!==savedScenarioRevision)return;savedScenario=decoded;savedScenarioState='ready'}
    catch{if(revision!==savedScenarioRevision)return;savedScenarioState='error'}
    renderSavedScenario();
  });
  $('pilot-snapshot-clear').addEventListener('click',()=>{savedScenarioRevision++;savedScenario=null;savedScenarioState='idle';$('pilot-snapshot-file').value='';renderSavedScenario()});
  const ledgerObserver=new MutationObserver(()=>{if(!panel.hidden&&$('pilot-evidence-ledger').open)renderPilotEvidenceLedger()});
  for(const id of ['facility-report-current','facility-receipt-current','flood-comparison-reports','pilot-river-history','pilot-risk-review-history','pilot-infrastructure-reports'])ledgerObserver.observe($(id),{childList:true,subtree:true,characterData:true});
  setInterval(()=>{if(!panel.hidden&&$('pilot-evidence-ledger').open)renderPilotEvidenceLedger()},30000);
  let riskReviewArea=null,riskReviewTimer=null,riskReviewRevision=0,riskReviewBusy=false;
  function renderRiskReview(){
    clearTimeout(riskReviewTimer);riskReviewTimer=null;
    const area=identity().area,en=document.documentElement.lang==='en',form=$('pilot-risk-review-form'),links=$('pilot-risk-review-links'),history=$('pilot-risk-review-history');
    let region=null;try{region=areaByCode(area)}catch{}
    const ready=!!region&&mapAreaState==='ready';
    if(area!==riskReviewArea){form.reset();riskReviewArea=area;riskReviewRevision++;$('pilot-risk-review-message').textContent=''}
    for(const el of form.elements)el.disabled=!ready;
    form.querySelector('[type="submit"]').disabled=!ready||riskReviewBusy;
    $('pilot-risk-review-delete').disabled=!ready||riskReviewBusy;links.hidden=!ready;
    if(!ready){$('pilot-risk-review-area').textContent=en?'This area is loading or not supported by this review.':'地域を読み込み中か、この確認メモには未対応です。';history.replaceChildren();return}
    const urls=officialMapLinks(region);$('pilot-risk-inundation').href=urls.inundation;$('pilot-risk-flood').href=urls.flood;
    $('pilot-risk-review-area').textContent=en?`Representative point: ${region.area} (${region.latitude.toFixed(3)}, ${region.longitude.toFixed(3)}). The map can be moved.`:`代表点：${region.area}（${region.latitude.toFixed(3)}, ${region.longitude.toFixed(3)}）。公式地図は移動できます。`;
    let saved;try{saved=decodeRiskReviews(localStorage.getItem(`muse-risk-review-v1:${area}`),area)}catch{saved={status:'unavailable',records:[]}}
    history.replaceChildren();
    if(saved.status!=='ok'){history.textContent=en?'Saved notes cannot be read and were not overwritten.':'保存済みメモを読み取れません。上書きしていません。';return}
    if(!saved.records.length){history.textContent=en?'No review notes. Current conditions are unknown.':'確認メモはありません。現在の状況は不明です。';return}
    const names=en?{yellow:'yellow',red:'red',purple:'purple',black:'black',other:'another appearance',unconfirmed:'not verified'}:{yellow:'黄色',red:'赤色',purple:'紫色',black:'黒色',other:'その他の表示',unconfirmed:'確認できなかった'};
    const now=Date.now(),reviewStates=en?{review_due:'Review due',review_due_later:'Review planned',review_unspecified:'No review time',time_unknown:'Device time needs checking'}:{review_due:'再確認の時刻を過ぎました',review_due_later:'再確認予定あり',review_unspecified:'再確認の日時は未設定',time_unknown:'端末の日時を確認してください'};
    for(const record of saved.records){
      const p=document.createElement('p'),when=value=>new Date(value).toLocaleString(en?'en':'ja-JP'),product=record.product==='inundation'?(en?'inundation risk':'浸水キキクル'):(en?'flood risk':'洪水キキクル');
      const review=reviewStates[riskReviewState(record,now)]+(record.reviewBy?' '+when(record.reviewBy):'');
      const differing=saved.records.some(other=>other.product===record.product&&other.checkedAt===record.checkedAt&&other.appearance!==record.appearance);
      p.textContent=en?`Self-reported review: ${product} / ${names[record.appearance]} / checked ${when(record.checkedAt)} / saved ${when(record.recordedAt)} / ${review}. Location and source issue time were not verified; current conditions unknown.${differing?' Different statements share a product and check time; verify location and entry.':''}`:`本人の確認メモ：${product} ／ ${names[record.appearance]} ／ 確認 ${when(record.checkedAt)} ／ 記録 ${when(record.recordedAt)} ／ ${review}。地点・情報の発表時刻は未検証。現在の状況は不明です。${differing?'同じ種類・確認時刻に異なる申告があります。地点や入力を確認してください。':''}`;
      history.append(p);
    }
    const next=saved.records.map(record=>record.reviewBy?Date.parse(record.reviewBy):Infinity).filter(time=>time>now).sort((a,b)=>a-b)[0];
    if(Number.isFinite(next))riskReviewTimer=setTimeout(renderRiskReview,Math.min(2147483000,Math.max(1,next-now+1)));
  }
  $('pilot-risk-review-form').addEventListener('submit',async event=>{
    event.preventDefault();const form=event.currentTarget,area=identity().area,en=document.documentElement.lang==='en',revision=riskReviewRevision;if(mapAreaState!=='ready'||riskReviewBusy)return;
    try{
      const fields=['pilot-risk-review-product','pilot-risk-review-appearance','pilot-risk-review-time','pilot-risk-review-next'],snapshot=fields.map(id=>$(id).value);
      const checked=new Date($('pilot-risk-review-time').value),recorded=new Date();
      if(!Number.isFinite(checked.getTime()))throw new Error('確認日時を入力してください');
      const review=$('pilot-risk-review-next').value,reviewDate=review?new Date(review):null;if(reviewDate&&!Number.isFinite(reviewDate.getTime()))throw new Error('再確認の日時を確認してください');
      const record=createRiskReview({area,product:$('pilot-risk-review-product').value,appearance:$('pilot-risk-review-appearance').value,checkedAt:checked.toISOString(),recordedAt:recorded.toISOString(),reviewBy:reviewDate?reviewDate.toISOString():null}),key=`muse-risk-review-v1:${area}`;
      riskReviewBusy=true;renderRiskReview();$('pilot-risk-review-message').textContent=en?'Waiting to save…':'保存の順番を確認中…';
      await updateLocalHistory({storage:localStorage,locks:navigator.locks,key,stillCurrent:()=>identity().area===area&&riskReviewRevision===revision&&mapAreaState==='ready',update:raw=>appendRiskReview(raw,record,area)});
      if(identity().area===area&&riskReviewRevision===revision){if(fields.every((id,i)=>$(id).value===snapshot[i]))form.reset();$('pilot-risk-review-message').textContent=en?'Self-reported review saved on this device.':'本人の確認メモを端末に保存しました。'}
    }catch(error){$('pilot-risk-review-message').textContent=identity().area===area&&riskReviewRevision===revision?(en?'Save failed or may be incomplete. Check stored notes before retrying.':`保存できません：${error.message}`):(en?'A previous save did not complete; check the relevant area.':'以前の保存が完了しませんでした。対象地域の記録を確認してください。')}
    finally{riskReviewBusy=false;renderRiskReview()}
  });
  $('pilot-risk-review-delete').addEventListener('click',async()=>{
    const area=identity().area,en=document.documentElement.lang==='en',revision=riskReviewRevision,key=`muse-risk-review-v1:${area}`;if(mapAreaState!=='ready'||riskReviewBusy)return;
    try{
      const expected=localStorage.getItem(key);if(!confirm(en?'Delete all risk review notes for this area?':'この地域の確認メモをすべて削除しますか？'))return;
      riskReviewBusy=true;renderRiskReview();$('pilot-risk-review-message').textContent=en?'Waiting to delete…':'削除の順番を確認中…';
      await updateLocalHistory({storage:localStorage,locks:navigator.locks,key,expected,stillCurrent:()=>identity().area===area&&riskReviewRevision===revision&&mapAreaState==='ready',update:()=>null});
      if(identity().area===area&&riskReviewRevision===revision)$('pilot-risk-review-message').textContent=en?'Review notes deleted.':'確認メモを削除しました。';
    }catch(error){$('pilot-risk-review-message').textContent=identity().area===area&&riskReviewRevision===revision?(en?'Deletion failed or may be incomplete. Check stored notes before retrying.':`削除できません：${error.message}`):(en?'A previous deletion did not complete; check the relevant area.':'以前の削除が完了しませんでした。対象地域の記録を確認してください。')}
    finally{riskReviewBusy=false;renderRiskReview()}
  });
  for(const id of ['map-language','welcome-language'])$(id)?.addEventListener('change',()=>{$('pilot-risk-review-message').textContent='';if(!panel.hidden)renderRiskReview()});
  toggle.addEventListener('click',()=>setPilot(panel.hidden));
  $('pilot-close').addEventListener('click',()=>{setPilot(false);toggle.focus()});
  $('pilot-observation-view').addEventListener('click',()=>{if(observationAvailable){$('map-observation-view').click();setPilot(false)}});
  async function writeFacilityHistory({key,isCurrent,setBusy,render,messageId,update,compare=false,expectedValue,success,onSuccess=()=>{}}){
    const en=document.documentElement.lang==='en',selectionVersion=facilitySelectionVersion,current=()=>isCurrent()&&facilitySelectionVersion===selectionVersion;let started=false;
    try{
      const expected=compare?(expectedValue===undefined?localStorage.getItem(key):expectedValue):undefined;
      setBusy(true);started=true;render();$(messageId).textContent=en?'Waiting to update…':'更新の順番を確認中…';
      await updateLocalHistory({storage:localStorage,locks:navigator.locks,key,expected,stillCurrent:current,update});
      if(current()){onSuccess();$(messageId).textContent=success}
    }catch(error){$(messageId).textContent=current()?(en?'Update failed or may be incomplete. Check stored notes before retrying.':`更新できません：${error.message}`):(en?'A previous update did not complete; check its facility.':'以前の更新が完了しませんでした。対象施設の記録を確認してください。')}
    finally{if(started){setBusy(false);render()}}
  }
  function deleteFacilityHistory({key,busy,isCurrent,setBusy,render,messageId,kind}){
    const en=document.documentElement.lang==='en';if(!key||busy||mapAreaState!=='ready')return;
    let expected;try{expected=localStorage.getItem(key)}catch{$(messageId).textContent=en?'Could not read stored records.':'保存された記録を読み取れません。';return}
    if(expected===null){$(messageId).textContent=en?'No stored records to delete.':'削除する記録はありません。';return}
    const facility=identity().name;
    if(!window.confirm(en?`Delete all ${kind.en} for ${facility}? Download the raw records first if needed.`:`「${facility}」の${kind.ja}をすべて削除しますか？ 必要なら先に元データを保存してください。`))return;
    writeFacilityHistory({key,isCurrent,setBusy,render,messageId,compare:true,expectedValue:expected,update:()=>null,success:en?'Records deleted.':'記録を削除しました。'});
  }
  form.addEventListener('submit',event=>{
    event.preventDefault();const item=identity(),key=pilotFacilityKey(item.area,item.name,item.address),input=$('pilot-report-time').value,revision=legacyRevision,en=document.documentElement.lang==='en';if(!key||legacyBusy||mapAreaState!=='ready')return;
    const date=new Date(input);const candidate={...item,status:$('pilot-report-status').value,at:Number.isFinite(date.getTime())?date.toISOString():'',source:$('pilot-report-source').value.trim()};
    const record=validatePilotFacilityRecord(candidate,item);
    if(!key||!record){$('pilot-report-message').textContent=en?'Enter the facility, result, time and source.':'施設、確認結果、確認日時、確認先を入力してください。';return}
    writeFacilityHistory({key,isCurrent:()=>{const now=identity();return pilotFacilityKey(now.area,now.name,now.address)===key&&legacyRevision===revision&&mapAreaState==='ready'},setBusy:value=>{legacyBusy=value},render:renderPilot,messageId:'pilot-report-message',compare:true,update:()=>JSON.stringify(record),success:en?'Local note saved.':'端末内の確認メモを保存しました。'});
  });
  $('pilot-delete').addEventListener('click',()=>{const item=identity(),key=pilotFacilityKey(item.area,item.name,item.address),revision=legacyRevision;deleteFacilityHistory({key,busy:legacyBusy,isCurrent:()=>{const now=identity();return pilotFacilityKey(now.area,now.name,now.address)===key&&legacyRevision===revision&&mapAreaState==='ready'},setBusy:value=>{legacyBusy=value},render:renderPilot,messageId:'pilot-report-message',kind:{ja:'施設メモ',en:'facility notes'}})});
  const observer=new MutationObserver(renderPilot);
  for(const id of ['source-overview-list','map-area-title','map-picked','map-observation-status','map-weather-status','map-fetch-time','shelter-flood-status']){
    const el=$(id);if(el)observer.observe(el,{childList:true,subtree:true,characterData:true});
  }
  let riverArea=null,riverReviewTimer=null,riverRevision=0,riverWriteBusy=false;
  function selectedRiver(){return riverPilotStations(identity().area).find(item=>item.id===$('pilot-river-select').value)||null}
  function renderRiverPilot(){
    clearTimeout(riverReviewTimer);riverReviewTimer=null;
    const area=identity().area,stations=riverPilotStations(area), select=$('pilot-river-select'), english=document.documentElement.lang==='en';
    $('pilot-river-content').hidden=!stations.length;
    $('pilot-river-coverage').textContent=stations.length?(english?'Pilot: two Arakawa River stations, not a complete station list.':'荒川区の試験範囲：荒川の2観測所を表示。観測所の全一覧ではありません。'):(english?'No curated stations for this area yet. Use the official river information site.':'この地域の観測所は未登録です。国交省の川の防災情報で確認してください。');
    if(area!==riverArea){riverArea=area;riverRevision++;select.replaceChildren();for(const station of stations){const option=document.createElement('option');option.value=station.id;option.textContent=`${station.river}・${station.name}`;select.append(option)}$('pilot-river-form').reset()}
    $('pilot-river-form').querySelector('[type="submit"]').disabled=riverWriteBusy||mapAreaState!=='ready';
    $('pilot-river-delete').disabled=riverWriteBusy||mapAreaState!=='ready';$('pilot-river-history-delete').disabled=riverWriteBusy||mapAreaState!=='ready';
    const station=selectedRiver();if(!station)return;
    $('pilot-river-official').href=station.levelUrl;$('pilot-river-metadata').href=station.metadataUrl;
    const selected=Number.isInteger(shelterChoice)?shelterList[shelterChoice]:null;
    const facility=selected?.name===draftShelter&&selected?.address===draftAddress?selected:null;
    const distance=riverStationDistance(station,facility);
    $('pilot-river-distance').textContent=distance===null?(english?'Select a facility with a known location to see its approximate straight-line distance.':'座標が確認できる施設を選ぶと、観測所からの直線距離を表示します。'):(english?`Selected facility: ${facility.name} / approximately ${(distance/1000).toFixed(1)} km in a straight line.`:`選択施設：${facility.name} ／ 直線で約 ${(distance/1000).toFixed(1)} km`);
    let note=null;try{note=validateRiverPilotNote(JSON.parse(localStorage.getItem(`muse-river-note-v1:${station.id}`)||'null'),station)}catch{}
    $('pilot-river-note').textContent=english?(note?`Previous manual note: ${note.value} m at ${new Date(note.at).toLocaleString()}. Recording time and review deadline are unknown. Recheck the source.`:'No previous manual note.'):(note?`以前の手入力メモ：${note.value} m（観測日時 ${new Date(note.at).toLocaleString('ja-JP')}）。記録日時・確認予定は不明です。公式情報を再確認してください。`:'以前の手入力メモはありません。');
    const history=$('pilot-river-history');history.replaceChildren();let saved;
    try{saved=decodeRiverLog(localStorage.getItem(`muse-river-log-v2:${station.id}`),station)}catch{saved={status:'unavailable',records:[]}}
    if(saved.status!=='ok')history.textContent=english?'The stored records could not be read. They have not been overwritten.':'保存済み記録を読み取れません。上書きしていません。';
    else if(!saved.records.length)history.textContent=english?'No new records. The current level is unknown.':'新しい記録はありません。現在の水位は不明です。';
    else {
      const now=Date.now(),labels=english?{review_due_later:'Review planned',review_due:'Review due',review_unspecified:'Review time not set',time_unknown:'Device time needs checking'}:{review_due_later:'再確認予定あり',review_due:'再確認の時刻を過ぎました',review_unspecified:'再確認の日時は未設定',time_unknown:'端末の日時を確認してください'};
      for(const entry of saved.records){const row=document.createElement('p'),fmt=value=>new Date(value).toLocaleString(english?'en':'ja-JP');const state=riverLogState(entry,now),conflict=[...saved.records,...(note?[note]:[])].some(other=>Date.parse(other.at)===Date.parse(entry.at)&&(other.value!==entry.value||(other.datum??'unknown')!==(entry.datum??'unknown')));row.textContent=english?`Manual note: ${entry.value} m / reference ${riverDatumLabel(entry.datum,true)} (self-reported, unverified) / observed ${fmt(entry.at)} / recorded ${fmt(entry.recordedAt)} / ${labels[state]}${entry.reviewBy?' '+fmt(entry.reviewBy):''}. Current level is unknown.${conflict?' Values or references differ at the same observation time; recheck before comparing.':''}`:`手入力：${entry.value} m ／ 基準 ${riverDatumLabel(entry.datum)}（本人申告・未検証）／ 観測 ${fmt(entry.at)} ／ 記録 ${fmt(entry.recordedAt)} ／ ${labels[state]}${entry.reviewBy?' '+fmt(entry.reviewBy):''}。現在の水位は不明です。${conflict?'同じ観測時刻に値または基準が異なる記録があります。比較前に公式情報を再確認してください。':''}`;history.append(row)}
      const next=saved.records.map(x=>x.reviewBy?Date.parse(x.reviewBy):Infinity).filter(x=>x>now).sort((a,b)=>a-b)[0];
      if(Number.isFinite(next))riverReviewTimer=setTimeout(renderRiverPilot,Math.min(2147483000,Math.max(1,next-now+1)));
    }
  }
  $('pilot-river-select').addEventListener('change',()=>{riverRevision++;$('pilot-river-form').reset();$('pilot-river-message').textContent='';renderRiverPilot()});
  $('pilot-river-focus').addEventListener('click',()=>{
    const station=selectedRiver();if(!station)return;
    if(realMap?.focusPilotRiverStation?.(station.id)){setPilot(false)}else{$('pilot-river-coverage').textContent='地図が準備中か、仮想移動中・出発地点選択中です。終了してから表示してください。'}
  });
  $('pilot-river-form').addEventListener('submit',async event=>{
    event.preventDefault();const form=event.currentTarget,station=selectedRiver(),area=identity().area,revision=riverRevision,raw=$('pilot-river-value').value,time=new Date($('pilot-river-time').value);if(!station||riverWriteBusy||mapAreaState!=='ready')return;
    const candidate={stationId:station.id,value:raw.trim()===''?NaN:Number(raw),at:Number.isFinite(time.getTime())?time.toISOString():'',reference:station.levelUrl};
    const note=validateRiverPilotNote(candidate,station),en=document.documentElement.lang==='en';if(!note){$('pilot-river-message').textContent=en?'Check the value and observation time. Future observations cannot be saved.':'数値と観測日時を確認してください。未来の日時は保存できません。';return}
    try{
      const fields=['pilot-river-value','pilot-river-datum','pilot-river-time','pilot-river-review'],snapshot=fields.map(id=>$(id).value);
      const review=$('pilot-river-review').value,reviewDate=review?new Date(review):null;
      if(reviewDate&&!Number.isFinite(reviewDate.getTime()))throw new Error('確認予定日時を確認してください');
      const entry=createRiverLogEntry({...note,recordedAt:new Date().toISOString(),reviewBy:reviewDate?reviewDate.toISOString():null,datum:$('pilot-river-datum').value},station),key=`muse-river-log-v2:${station.id}`;
      riverWriteBusy=true;renderRiverPilot();$('pilot-river-message').textContent=en?'Waiting to save…':'保存の順番を確認中…';
      await updateLocalHistory({storage:localStorage,locks:navigator.locks,key,stillCurrent:()=>identity().area===area&&selectedRiver()?.id===station.id&&riverRevision===revision&&mapAreaState==='ready',update:current=>appendRiverLog(current,entry,station)});
      if(identity().area===area&&selectedRiver()?.id===station.id&&riverRevision===revision){if(fields.every((id,i)=>$(id).value===snapshot[i]))form.reset();$('pilot-river-message').textContent=en?'Manual record saved on this device.':'手入力の記録を保存しました。'}
    }catch(error){$('pilot-river-message').textContent=identity().area===area&&selectedRiver()?.id===station.id&&riverRevision===revision?(en?'Save failed or may be incomplete. Check stored notes before retrying.':`保存できません：${error.message}`):(en?'A previous save did not complete; check the relevant station.':'以前の保存が完了しませんでした。対象観測所の記録を確認してください。')}
    finally{riverWriteBusy=false;renderRiverPilot()}
  });
  async function deleteRiverHistory(legacy){
    const station=selectedRiver(),area=identity().area,revision=riverRevision,en=document.documentElement.lang==='en';if(!station||riverWriteBusy||mapAreaState!=='ready')return;
    const key=`${legacy?'muse-river-note-v1':'muse-river-log-v2'}:${station.id}`;
    try{
      const expected=localStorage.getItem(key),question=legacy?(en?'Delete the previous manual note for this station?':'この観測所の以前の水位メモを削除しますか？'):(en?'Delete all new records for this station?':'この観測所の新しい記録をすべて削除しますか？');
      if(!confirm(question))return;riverWriteBusy=true;renderRiverPilot();$('pilot-river-message').textContent=en?'Waiting to delete…':'削除の順番を確認中…';
      await updateLocalHistory({storage:localStorage,locks:navigator.locks,key,expected,stillCurrent:()=>identity().area===area&&selectedRiver()?.id===station.id&&riverRevision===revision&&mapAreaState==='ready',update:()=>null});
      if(identity().area===area&&selectedRiver()?.id===station.id&&riverRevision===revision)$('pilot-river-message').textContent=en?'Notes deleted.':'メモを削除しました。';
    }catch(error){$('pilot-river-message').textContent=identity().area===area&&selectedRiver()?.id===station.id&&riverRevision===revision?(en?'Deletion failed or may be incomplete. Check stored notes before retrying.':`削除できません：${error.message}`):(en?'A previous deletion did not complete; check the relevant station.':'以前の削除が完了しませんでした。対象観測所の記録を確認してください。')}
    finally{riverWriteBusy=false;renderRiverPilot()}
  }
  $('pilot-river-delete').addEventListener('click',()=>deleteRiverHistory(true));
  $('pilot-river-history-delete').addEventListener('click',()=>deleteRiverHistory(false));
  let facilityReportShownKey=null,facilityReportRevision=0,facilityReportBusy=false;
  const reportKey=item=>{const key=pilotFacilityKey(item.area,item.name,item.address);return key?`${key}:report-v2`:null};
  function exportRawFacilityRecord(key,messageId,filename){
    const en=document.documentElement.lang==='en';if(!key||mapAreaState!=='ready')return;
    try{const raw=localStorage.getItem(key);if(raw===null){$(messageId).textContent=en?'No stored record to download.':'保存された記録はありません。';return}const url=URL.createObjectURL(new Blob([raw],{type:'text/plain;charset=utf-8'})),link=document.createElement('a');link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);$(messageId).textContent=en?'Download started. The content is unverified; check it before sharing.':'元の内容の保存を開始しました。未検証のため、共有前に内容を確認してください。'}catch{$(messageId).textContent=en?'Could not download the stored content.':'元の内容を保存できません。'}
  }
  $('pilot-export').addEventListener('click',()=>{const item=identity();exportRawFacilityRecord(pilotFacilityKey(item.area,item.name,item.address),'pilot-report-message','muse-facility-note-raw.txt')});
  $('facility-report-export').addEventListener('click',()=>exportRawFacilityRecord(reportKey(identity()),'facility-report-message','muse-facility-reports-raw.txt'));
  function renderFacilityReport(){
    const item=identity(),key=reportKey(item),form=$('facility-report-form'),english=document.documentElement.lang==='en';
    const show=value=>{const target=$('facility-report-current');if(target.textContent!==value)target.textContent=value};
    const choices=(reports=[])=>{const select=$('facility-report-correction'),selected=select.value,options=[['',english?'New independent report':'新しい独立した報告'],...reports.map((report,i)=>[report.id,`${i+1}. ${new Date(report.confirmedAt).toLocaleString()} / ${report.organization}`])];if(selected&&!options.some(([id])=>id===selected))options.push([selected,english?'Previous selection unavailable; choose again':'元の報告が見つかりません。選び直してください']);const signature=JSON.stringify(options);if(select.dataset.reportChoices===signature)return;select.replaceChildren(...options.map(([value,label])=>{const option=document.createElement('option');option.value=value;option.textContent=label;return option}));select.value=selected;select.dataset.reportChoices=signature};
    $('facility-report-name').textContent=key?`${item.name}（${item.address||'住所未記載'}）`:(english?'Choose a facility.':'施設を選択してください。');
    for(const field of form.elements)field.disabled=!key;
    form.querySelector('[type="submit"]').disabled=!key||facilityReportBusy||mapAreaState!=='ready';$('facility-report-delete').disabled=!key||facilityReportBusy||mapAreaState!=='ready';$('facility-report-export').disabled=!key||facilityReportBusy||mapAreaState!=='ready';
    if(key!==facilityReportShownKey){form.reset();$('facility-report-correction').value='';facilityReportShownKey=key;facilityReportRevision++;$('facility-report-message').textContent=''}
    if(!key){choices();show(english?'No facility selected.':'施設を選ぶと報告を確認できます。');return}
    let saved;try{saved=decodeFacilityReports(localStorage.getItem(key),item)}catch{show(english?'Reports unavailable. Acceptance is unknown.':'報告を読み取れません。受け入れ状況は不明です。');return}
    if(saved.status!=='ok'){choices();show(english?'Saved reports are unreadable and will not be overwritten.':'保存された報告を読み取れません。上書きせず保持します。');return}
    choices(saved.reports);
    if(!saved.reports.length){show(english?'No dated reports. Acceptance is unknown.':'期限付きの報告はありません。受け入れ状況は不明です。');return}
    const labels=english?{checking:'Checking',available:'Reported accepting',conditional:'Reported conditional acceptance',unavailable:'Reported not accepting',expired:'Expired; reconfirmation needed',unknown:'Time or state unknown'}:{checking:'確認中',available:'受け入れ可能との報告',conditional:'条件付きとの報告',unavailable:'受け入れ不可との報告',expired:'期限切れ・再確認が必要',unknown:'時刻等が未確認'};
    const states=saved.reports.map(report=>facilityReportState(report,item));
    const differences=facilityReportDifferences(saved.reports,item),names=english?{acceptance:'acceptance',landing:'landing site',water:'water',food:'food',blanket:'blankets',hygiene:'hygiene supplies'}:{acceptance:'受け入れ',landing:'着地点',water:'飲料水',food:'食料',blanket:'毛布',hygiene:'衛生用品'};
    const changed=[...(differences.acceptance?[names.acceptance]:[]),...(differences.landing?[names.landing]:[]),...differences.supplies.map(value=>`${names[value]}${english?' quantity':'の数量'}`)];
    const intro=changed.length?(english?`Reports differ in ${changed.join(', ')}. Compare the times and details, and reconfirm; the correct information is unknown.`:`異なる報告があります（${changed.join('・')}）。日時と内容を比較して再確認してください。どの報告が正しいかは不明です。`):(english?'Local human reports; the facility has not been contacted automatically.':'端末内の人による報告です。施設には自動確認していません。');
    const lines=saved.reports.map((report,i)=>{const supply={water:'飲料水',food:'食料',blanket:'毛布',hygiene:'衛生用品'}[report.supply]||'未指定';const landing={unknown:'未確認',clear_reported:'使用可能との報告',unusable_reported:'使用不可との報告'}[report.landing];return english?`${i+1}. ${labels[states[i]]}${states[i]==='expired'?` (${labels[report.status]})`:''} / checked ${new Date(report.confirmedAt).toLocaleString()} / expires ${new Date(report.expiresAt).toLocaleString()} / organisation ${report.organization} / source ${report.source} / supplies ${report.supply||'unspecified'} ${report.quantity??''} / landing ${report.landing}${report.condition?` / condition ${report.condition}`:''}`:`${i+1}. ${labels[states[i]]}${states[i]==='expired'?`（${labels[report.status]}）`:''}／確認 ${new Date(report.confirmedAt).toLocaleString('ja-JP')}／期限 ${new Date(report.expiresAt).toLocaleString('ja-JP')}／組織 ${report.organization}／確認方法 ${report.source}／物資 ${supply} ${report.quantity??'数量未指定'}／着地点 ${landing}${report.condition?`／条件 ${report.condition}`:''}`});
    const linked=lines.map((line,i)=>{const report=saved.reports[i],target=saved.reports.findIndex(other=>other.id===report.correctsId),corrected=saved.reports.some(other=>other.correctsId===report.id);return line+(target>=0?(english?` / declared correction of report ${target+1}`:`／報告${target+1}の訂正申告`):'')+(corrected?(english?' / a correction was declared for this report':'／この報告への訂正申告あり'):'')});
    show([intro,...linked].join('\n'));
  }
  $('facility-report-form').addEventListener('submit',event=>{
    event.preventDefault();const item=identity(),key=reportKey(item),revision=facilityReportRevision,en=document.documentElement.lang==='en';if(!key||facilityReportBusy||mapAreaState!=='ready')return;
    const date=id=>{const d=new Date($(id).value);return Number.isFinite(d.getTime())?d.toISOString():''};
    const raw=$('facility-report-quantity').value;
    try{
      const correctsId=$('facility-report-correction').value;
      const report=createFacilityReport({...item,status:$('facility-report-status').value,confirmedAt:date('facility-report-time'),expiresAt:date('facility-report-expiry'),organization:$('facility-report-organization').value,source:$('facility-report-source').value,supply:$('facility-report-supply').value,quantity:raw===''?null:Number(raw),landing:$('facility-report-landing').value,condition:$('facility-report-condition').value,...(correctsId?{correctsId}:{})});
      const id=globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`;
      writeFacilityHistory({key,isCurrent:()=>reportKey(identity())===key&&facilityReportRevision===revision&&mapAreaState==='ready',setBusy:value=>{facilityReportBusy=value},render:renderFacilityReport,messageId:'facility-report-message',update:raw=>appendFacilityReport(raw,{id,...report},item),success:en?'Report saved on this device; not sent to the facility.':'報告をこの端末に保存しました。施設には送信していません。'});
    }catch(error){$('facility-report-message').textContent=en?'Could not save. Check the report fields.':`保存できません：${error.message}`}
  });
  $('facility-report-delete').addEventListener('click',()=>{const key=reportKey(identity()),revision=facilityReportRevision;deleteFacilityHistory({key,busy:facilityReportBusy,isCurrent:()=>reportKey(identity())===key&&facilityReportRevision===revision&&mapAreaState==='ready',setBusy:value=>{facilityReportBusy=value},render:renderFacilityReport,messageId:'facility-report-message',kind:{ja:'施設報告',en:'facility reports'}})});
  setInterval(()=>{if(!panel.hidden){renderFacilityReport();renderFloodComparison()}},30000);
  let facilityReceiptShownKey=null,facilityReceiptRevision=0,facilityReceiptBusy=false,followupSelected=null;
  const receiptKey=item=>{const key=pilotFacilityKey(item.area,item.name,item.address);return key?`${key}:receipt-v1`:null};
  $('facility-receipt-export').addEventListener('click',()=>exportRawFacilityRecord(receiptKey(identity()),'facility-receipt-message','muse-receipt-reports-raw.txt'));
  function renderFacilityReceipt(){
    const item=identity(),key=receiptKey(item),form=$('facility-receipt-form'),english=document.documentElement.lang==='en';
    const followupForm=$('facility-followup-form'),target=$('facility-followup-target');
    const choices=(receipts=[])=>{const selected=target.value,options=[['',english?'Choose a receipt report':'受領報告を選んでください'],...receipts.map((r,i)=>[r.id,`${i+1}. ${new Date(r.reportedAt).toLocaleString()} / ${r.supply}`])];if(selected&&!options.some(([id])=>id===selected))options.push([selected,english?'Report unavailable; choose again':'元の報告が見つかりません']);const signature=JSON.stringify(options);if(target.dataset.receiptChoices===signature)return;target.replaceChildren(...options.map(([value,label])=>{const option=document.createElement('option');option.value=value;option.textContent=label;return option}));target.value=selected;target.dataset.receiptChoices=signature};
    $('facility-receipt-name').textContent=key?`${item.name}（${item.address||'住所未記載'}）`:(english?'Choose a facility.':'施設を選択してください。');
    for(const field of form.elements)field.disabled=!key;
    form.querySelector('[type="submit"]').disabled=!key||facilityReceiptBusy||mapAreaState!=='ready';$('facility-receipt-delete').disabled=!key||facilityReceiptBusy||mapAreaState!=='ready';$('facility-receipt-export').disabled=!key||facilityReceiptBusy||mapAreaState!=='ready';
    for(const field of followupForm.elements)field.disabled=!key||facilityReceiptBusy||mapAreaState!=='ready';
    if(key!==facilityReceiptShownKey){form.reset();followupForm.reset();target.value='';followupSelected=null;facilityReceiptShownKey=key;facilityReceiptRevision++;$('facility-receipt-message').textContent='';$('facility-followup-message').textContent=''}
    const show=value=>{const target=$('facility-receipt-current');if(target.textContent!==value)target.textContent=value};
    if(!key){choices();show(english?'No facility selected.':'施設を選ぶと受領報告を確認できます。');return}
    let saved;try{saved=decodeFacilityReceipts(localStorage.getItem(key),item)}catch{show('端末の受領報告を読み取れません。');return}
    if(saved.status!=='ok'){choices();show('保存された受領報告を読み取れません。上書きせず保持します。');return}
    choices(saved.receipts);
    if(!saved.receipts.length){show(english?'No human receipt report. Receipt is unknown.':'人による受領報告はありません。受領は未確認です。');return}
    const labels=english?{unconfirmed:'Unconfirmed',not_received:'Reported not received',received:'Reported received in full',partial:'Reported partial receipt',damaged:'Reported damaged'}:{unconfirmed:'未確認',not_received:'未着との報告',received:'全数受領との報告',partial:'一部受領との報告',damaged:'破損ありとの報告'};
    const intro=english?'Local human reports; not automatic proof of delivery.':'端末内の人による報告です。自動的な受領証明ではありません。';
    const lines=saved.receipts.map((r,i)=>english?`${i+1}. ${labels[r.status]} / reported ${new Date(r.reportedAt).toLocaleString()} / source ${r.source} / ${r.supply} ${r.received??'unknown'}/${r.expected}${r.note?` / note ${r.note}`:''}`:`${i+1}. ${labels[r.status]}／報告日時 ${new Date(r.reportedAt).toLocaleString('ja-JP')}／出典 ${r.source}／物資 ${{water:'飲料水',food:'食料',blanket:'毛布',hygiene:'衛生用品'}[r.supply]} ${r.received??'未確認'}/${r.expected}箱${r.note?`／補足 ${r.note}`:''}`);
    const kinds=english?{confirm:'Recheck',redelivery:'Consider redelivery',handoff:'Hand over'}:{confirm:'状況を再確認',redelivery:'再配送を検討',handoff:'人への引き継ぎ'},states=english?{planned:'planned',reported_done:'reported completed',cancelled:'reported cancelled'}:{planned:'予定・検討中',reported_done:'対応したとの申告',cancelled:'取りやめたとの申告'};
    const withActions=lines.map((line,i)=>[line,...(saved.receipts[i].followups||[]).map(action=>english?`  Follow-up (self-reported): ${kinds[action.kind]} / ${states[action.state]} / ${new Date(action.at).toLocaleString()}${action.note?` / ${action.note}`:''}`:`  対応の申告：${kinds[action.kind]}／${states[action.state]}／${new Date(action.at).toLocaleString('ja-JP')}${action.note?`／${action.note}`:''}`)].join('\n'));
    show([intro,...withActions].join('\n'));
  }
  $('facility-followup-target').addEventListener('change',()=>{const item=identity(),key=receiptKey(item);try{followupSelected=decodeFacilityReceipts(localStorage.getItem(key),item).receipts.find(row=>row.id===$('facility-followup-target').value)||null}catch{followupSelected=null}});
  $('facility-followup-form').addEventListener('submit',event=>{
    event.preventDefault();const item=identity(),key=receiptKey(item),revision=facilityReceiptRevision,en=document.documentElement.lang==='en',receipt=followupSelected;if(!key||facilityReceiptBusy||mapAreaState!=='ready'||!receipt||receipt.id!==$('facility-followup-target').value){$('facility-followup-message').textContent=en?'Choose a current receipt report.':'対象の受領報告を選び直してください。';return}
    const action={kind:$('facility-followup-kind').value,state:$('facility-followup-state').value,at:new Date().toISOString(),note:$('facility-followup-note').value};
    writeFacilityHistory({key,isCurrent:()=>receiptKey(identity())===key&&facilityReceiptRevision===revision&&mapAreaState==='ready',setBusy:value=>{facilityReceiptBusy=value},render:renderFacilityReceipt,messageId:'facility-followup-message',update:raw=>appendFacilityReceiptFollowup(raw,receipt,item,action),success:en?'Follow-up saved locally. No contact or redelivery was performed.':'対応の申告を端末に記録しました。連絡や再配送は行っていません。',onSuccess:()=>{$('facility-followup-form').reset();followupSelected=null}});
  });
  $('facility-receipt-form').addEventListener('submit',event=>{
    event.preventDefault();const item=identity(),key=receiptKey(item),revision=facilityReceiptRevision,en=document.documentElement.lang==='en';if(!key||facilityReceiptBusy||mapAreaState!=='ready')return;const date=new Date($('facility-receipt-time').value),raw=$('facility-receipt-received').value;
    try{
      const receipt=createFacilityReceipt({...item,status:$('facility-receipt-status').value,reportedAt:Number.isFinite(date.getTime())?date.toISOString():'',source:$('facility-receipt-source').value,supply:$('facility-receipt-supply').value,expected:Number($('facility-receipt-expected').value),received:raw===''?null:Number(raw),note:$('facility-receipt-note').value});
      const id=globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`;
      writeFacilityHistory({key,isCurrent:()=>receiptKey(identity())===key&&facilityReceiptRevision===revision&&mapAreaState==='ready',setBusy:value=>{facilityReceiptBusy=value},render:renderFacilityReceipt,messageId:'facility-receipt-message',update:raw=>appendFacilityReceipt(raw,{id,...receipt},item),success:en?'Receipt report saved on this device; not sent to the facility.':'受領報告を端末に保存しました。施設には送信していません。'});
    }catch(error){$('facility-receipt-message').textContent=en?'Could not save. Check the receipt fields.':`保存できません：${error.message}`}
  });
  $('facility-receipt-delete').addEventListener('click',()=>{const key=receiptKey(identity()),revision=facilityReceiptRevision;deleteFacilityHistory({key,busy:facilityReceiptBusy,isCurrent:()=>receiptKey(identity())===key&&facilityReceiptRevision===revision&&mapAreaState==='ready',setBusy:value=>{facilityReceiptBusy=value},render:renderFacilityReceipt,messageId:'facility-receipt-message',kind:{ja:'受領報告',en:'receipt reports'}})});
  let fieldReportShownKey=null,fieldReportRevision=0,fieldReportBusy=false;
  const fieldKey=item=>{const key=pilotFacilityKey(item.area,item.name,item.address);return key?`${key}:flood-field-v1`:null};
  $('flood-field-export').addEventListener('click',()=>exportRawFacilityRecord(fieldKey(identity()),'flood-field-message','muse-field-reports-raw.txt'));
  function renderFloodComparison(){
    const item=identity(),key=fieldKey(item),form=$('flood-field-form'),english=document.documentElement.lang==='en';
    $('flood-comparison-name').textContent=key?`${item.name}（${item.address||'住所未記載'}）`:(english?'Choose a facility.':'施設を選択してください。');
    for(const field of form.elements)field.disabled=!key;
    form.querySelector('[type="submit"]').disabled=!key||fieldReportBusy||mapAreaState!=='ready';$('flood-field-delete').disabled=!key||fieldReportBusy||mapAreaState!=='ready';$('flood-field-export').disabled=!key||fieldReportBusy||mapAreaState!=='ready';
    if(key!==fieldReportShownKey){form.reset();fieldReportShownKey=key;fieldReportRevision++;$('flood-field-message').textContent=''}
    const show=(id,value)=>{const target=$(id);if(target.textContent!==value)target.textContent=value};
    if(!key){show('flood-comparison-forecast',english?'Choose a facility.':'施設を選ぶと確認できます。');show('flood-comparison-reports',english?'No facility selected.':'施設を選択してください。');return}
    let raw;try{raw=localStorage.getItem(key)}catch{show('flood-comparison-reports',english?'Local reports unavailable.':'端末の報告を読み取れません。');raw=undefined}
    const result=buildFloodComparison({identity:item,forecast:facilityFlood,raw}),scenario=result.forecast;
    const date=value=>value?new Date(value).toLocaleString(english?'en':'ja-JP'):(english?'unknown':'不明');
    show('flood-comparison-forecast',english?(scenario.depth?`Scenario depth at the published facility point: ${scenario.depth}. Tile retrieved ${date(scenario.retrievedAt)}; source update time unknown.`:`Scenario data: ${scenario.state}. It does not establish current flooding.`):(scenario.depth?`公開施設座標の想定 ${scenario.depth}。タイル取得 ${date(scenario.retrievedAt)}／元資料の更新時刻 不明。現在の浸水ではありません。`:`想定図：${{loading:'取得中',error:'取得失敗',unknown:'未確認'}[scenario.state]||'未確認'}。現在の浸水は分かりません。`));
    if(result.reportsStatus==='corrupt'){show('flood-comparison-reports',english?'Saved reports are unreadable and will not be overwritten.':'保存された報告を読み取れません。上書きせず保持します。');return}
    if(raw===undefined){show('flood-comparison-reports',english?'Local reports unavailable.':'端末の報告を読み取れません。');return}
    if(!result.reports.length){show('flood-comparison-reports',english?'No human report. Current flooding is unknown.':'人の報告はありません。現在の浸水は不明です。');return}
    const labels=english?{water_seen:'Water reported visible',no_water_seen:'Water reported not visible',uncertain:'Reported unknown',expired:'Expired',time_unknown:'Time unknown'}:{water_seen:'水が見えたとの報告',no_water_seen:'水が見えなかったとの報告',uncertain:'状況不明との報告',expired:'期限切れ',time_unknown:'日時不明'};
    const scopes=english?{facility_point:'facility point',nearby_road:'nearby road',unspecified:'scope unknown'}:{facility_point:'施設の一点',nearby_road:'施設付近の道路',unspecified:'範囲不明'};
    const lines=result.reports.map((r,i)=>`${i+1}. ${r.state==='reported'?'':`${labels[r.state]} / `}${labels[r.status]} / ${scopes[r.scope]} / ${date(r.observedAt)} → ${date(r.expiresAt)} / ${r.organization} / ${r.source}${r.note?` / ${r.note}`:''} (${r.id})`);
    const intro=result.differingScopes.length?(english?'Reports in the same category differ. They may refer to different places or times; check the original reports.':'同じ分類の報告内容に違いがあります。場所や時刻が異なる場合もあるため、元の報告を確認してください。'):(english?'Unverified human reports; absence of visible water is not proof of safety.':'人の入力で、内容は未検証です。水が見えない報告も安全を意味しません。');
    show('flood-comparison-reports',[intro,...lines].join('\n'));
  }
  $('flood-field-form').addEventListener('submit',event=>{
    event.preventDefault();const item=identity(),key=fieldKey(item),revision=fieldReportRevision,en=document.documentElement.lang==='en';if(!key||fieldReportBusy||mapAreaState!=='ready')return;
    const date=id=>{const value=new Date($(id).value);return Number.isFinite(value.getTime())?value.toISOString():''};
    try{
      const id=globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const report=createFloodFieldReport({...item,id,status:$('flood-field-status').value,scope:$('flood-field-scope').value,observedAt:date('flood-field-time'),expiresAt:date('flood-field-expiry'),organization:$('flood-field-organization').value,source:$('flood-field-source').value,note:$('flood-field-note').value});
      writeFacilityHistory({key,isCurrent:()=>fieldKey(identity())===key&&fieldReportRevision===revision&&mapAreaState==='ready',setBusy:value=>{fieldReportBusy=value},render:renderFloodComparison,messageId:'flood-field-message',update:raw=>appendFloodFieldReport(raw,report,item),success:en?'Field report saved locally, unverified and not sent externally.':'現地報告を端末に保存しました。内容は未検証で、外部には送信していません。'});
    }catch(error){$('flood-field-message').textContent=en?'Could not save. Check the report fields.':`保存できません：${error.message}`}
  });
  $('flood-field-delete').addEventListener('click',()=>{const key=fieldKey(identity()),revision=fieldReportRevision;deleteFacilityHistory({key,busy:fieldReportBusy,isCurrent:()=>fieldKey(identity())===key&&fieldReportRevision===revision&&mapAreaState==='ready',setBusy:value=>{fieldReportBusy=value},render:renderFloodComparison,messageId:'flood-field-message',kind:{ja:'現地報告',en:'field reports'}})});
  // Recovery compares local copies only; it never feeds old notes to Muse or flight decisions.
  let recoveryPreview=null,recoveryGeneration=0,recoveryBusy=false;
  const recoveryEnglish=()=>document.documentElement.lang==='en';
  function recoveryKey(){
    if(mapAreaState!=='ready')return null;const item=identity(),kind=$('recovery-kind').value,station=selectedRiver();
    if(kind==='consult')return consultAuditStorageKey;if(kind==='exercise')return 'muse-tabletop-training-v1';if(kind==='photo')return 'muse-photo-reviews-v1';if(kind==='fleet')return largeFleetHistoryKey;if(kind==='historical')return 'muse-historical-reviews-v1';if(kind==='team')return teamRecordKey($('map-area-title').textContent.replace(/ ／ 実地図$/,''));if(kind==='risk')return `muse-risk-review-v1:${item.area}`;
    if(kind==='river'||kind==='old-river')return station?`muse-${kind==='river'?'river-log-v2':'river-note-v1'}:${station.id}`:null;
    if(kind==='report')return reportKey(item);if(kind==='receipt')return receiptKey(item);if(kind==='field')return fieldKey(item);
    return pilotFacilityKey(item.area,item.name,item.address)||null;
  }
  function clearRecovery(){recoveryGeneration++;recoveryPreview=null;$('recovery-preview').hidden=true;$('recovery-backup-download').hidden=true;$('recovery-status').textContent=''}
  function recoveryLabels(){
    const en=recoveryEnglish(),labels={ 'recovery-title':['保存内容が一致しないとき','When saved records disagree'],'recovery-help':['同じアドレスの他の画面をすべて最新版に再読み込みしてから比較してください。記録は端末内で扱い、Museには送信しません。','Reload all other tabs at the same address before comparing. Records stay on this device and are not sent to Muse.'],'recovery-kind-label':['比較する記録','Records to compare'],'recovery-inspect':['保存内容を比較','Compare saved records'],'recovery-privacy':['施設名などが含まれます。共有や画面撮影に注意してください。','Records may contain facility names. Take care when sharing or taking screenshots.'],'recovery-local-label':['画面側の記録','Browser record'],'recovery-committed-label':['照合用の記録','Comparison copy'],'recovery-download':['両方をファイルに保存','Download both copies'],'recovery-merge':['2つの記録を統合','Merge both copies'],'recovery-backup-download':['直近の統合前の記録を保存','Download latest pre-merge backup']};
    for(const [id,words] of Object.entries(labels))$(id).textContent=words[en?1:0];
    const labelsJa=['キキクル確認メモ','水位の記録','施設の報告','物資受領の報告','現地の浸水報告','以前の水位メモ','以前の施設メモ','Muse相談の記録','机上演習の記録','画像確認の記録','仮想配送の記録','過去事例の確認記録','2機の仮想配送の記録'],labelsEn=['Risk review notes','River level records','Facility reports','Supply receipts','Field flood reports','Earlier river note','Earlier facility note','Muse consultation records','Tabletop exercise records','Image review records','Simulation records','Historical case reviews','Two-aircraft simulation records'];
    [...$('recovery-kind').options].forEach((option,i)=>option.textContent=(en?labelsEn:labelsJa)[i]);
  }
  function recoveryShow(raw){if(raw===null)return recoveryEnglish()?'No record':'記録なし';if(raw.length>30000)return `${raw.slice(0,30000)}\n… ${recoveryEnglish()?'Preview shortened; download for the full record.':'表示を省略しました。全内容はファイルで確認してください。'}`;try{return JSON.stringify(JSON.parse(raw),null,2)}catch{return raw}}
  function downloadRecovery(value){const blob=new Blob([JSON.stringify(value,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='muse-record-backup.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
  $('recovery-kind').addEventListener('change',clearRecovery);
  for(const id of ['welcome-language','map-language'])$(id)?.addEventListener('change',()=>{clearRecovery();recoveryLabels()});
  recoveryLabels();
  $('recovery-inspect').addEventListener('click',async()=>{
    if(recoveryBusy)return;clearRecovery();const key=recoveryKey(),generation=recoveryGeneration,en=recoveryEnglish();
    if(!key){$('recovery-status').textContent=en?'Choose a loaded region, station or facility first.':'先に地域を読み込み、必要に応じて観測所または施設を選んでください。';return}
    const selectedFacility=facilitySelectionVersion,selectedRisk=riskReviewRevision,selectedRiverRevision=riverRevision,stillCurrent=()=>generation===recoveryGeneration&&key===recoveryKey()&&selectedFacility===facilitySelectionVersion&&selectedRisk===riskReviewRevision&&selectedRiverRevision===riverRevision;
    recoveryBusy=true;$('recovery-inspect').disabled=true;$('recovery-status').textContent=en?'Comparing…':'比較中…';
    try{
      const preview=await inspectLocalHistory({storage:localStorage,locks:navigator.locks,key,stillCurrent});if(!stillCurrent())return;recoveryPreview={...preview,stillCurrent};
      $('recovery-local').textContent=recoveryShow(preview.local);$('recovery-committed').textContent=preview.committedExists?recoveryShow(preview.committed):(en?'No comparison copy':'照合用の記録なし');$('recovery-preview').hidden=false;
      const messages={same:['記録は一致しています。統合は不要です。','Copies match; no merge needed.'],merge:['内容を確認してから統合できます。','Review both copies before merging.'],no_checkpoint:['照合用の記録がないため、自動統合はできません。','No comparison copy exists; automatic merge is unavailable.'],manual:['この記録は自動統合できません。両方を保存して確認してください。','These records cannot be merged automatically. Download and review both copies.'],unreadable:['読み取れない内容があるため統合できません。','A copy is unreadable; it cannot be merged.'],too_many:['統合すると上限20件を超えるため、統合できません。','The combined records exceed the 20-record limit.'],id_conflict:['同じIDで内容が異なる記録があるため統合できません。','Records with the same ID differ and cannot be merged.']};
      $('recovery-status').textContent=(messages[preview.comparison.mode]||messages.unreadable)[en?1:0];$('recovery-merge').disabled=preview.comparison.mode!=='merge';$('recovery-backup-download').hidden=!preview.latestBackup;
    }catch(error){if(stillCurrent())$('recovery-status').textContent=en?'Could not compare records. No changes were made.':`比較できません：${error.message}`}
    finally{recoveryBusy=false;$('recovery-inspect').disabled=false}
  });
  $('recovery-download').addEventListener('click',()=>{if(recoveryPreview?.stillCurrent())downloadRecovery({key:recoveryPreview.key,local:recoveryPreview.local,committedExists:recoveryPreview.committedExists,committed:recoveryPreview.committed})});
  $('recovery-backup-download').addEventListener('click',()=>{if(recoveryPreview?.stillCurrent()&&recoveryPreview.latestBackup)downloadRecovery(recoveryPreview.latestBackup)});
  $('recovery-merge').addEventListener('click',async()=>{
    const preview=recoveryPreview,en=recoveryEnglish();if(recoveryBusy||!preview?.stillCurrent()||preview.comparison.mode!=='merge')return;
    const extra=preview.comparison.restoresDeleted?(en?' One copy is empty, so previously deleted records may be restored.':' 片方が空のため、削除済みの記録が復元される場合があります。'):'';
    if(!confirm((en?'Keep both originals on this device and merge these records?':'両方の元記録を端末に保存したうえで統合しますか？')+extra))return;
    recoveryBusy=true;$('recovery-merge').disabled=true;$('recovery-inspect').disabled=true;
    try{const backupId=globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`;await reconcileLocalHistory({storage:localStorage,locks:navigator.locks,key:preview.key,preview,backupId,stillCurrent:preview.stillCurrent});
      clearRecovery();$('recovery-status').textContent=en?'Merged. Compare again to download the pre-merge backup.':'統合しました。もう一度比較すると、統合前の記録を保存できます。';renderPilot();if(preview.key===consultAuditStorageKey)renderSavedConsultAudits();
    }catch(error){clearRecovery();$('recovery-status').textContent=en?'Merge did not complete. Compare again before retrying.':`統合を完了できません：${error.message}。再度比較してください。`}
    finally{recoveryBusy=false;$('recovery-inspect').disabled=false}
  });
  window.addEventListener('storage',event=>{
    if(panel.hidden||event.storageArea!==localStorage)return;
    if(event.key===null||event.key.startsWith('muse-pilot-facility-v1:')){renderPilot();return}
    if(event.key===`muse-risk-review-v1:${identity().area}`){renderRiskReview();return}
    const station=selectedRiver();
    if(station&&(event.key===`muse-river-log-v2:${station.id}`||event.key===`muse-river-note-v1:${station.id}`))renderRiverPilot();
  });
  const historicSection=$('historical-flood-case');
  historicSection.addEventListener('toggle',()=>{
    if(!historicSection.open)return;
    const floodCase=historicalFloodCase();[...floodCase.images,floodCase.comparisonImage].forEach((item,index)=>{
      const image=$(`historical-flood-image-${index+1}`),status=$(`historical-flood-status-${index+1}`);
      if(image.dataset.started)return;image.dataset.started='true';status.textContent=document.documentElement.lang==='en'?'Loading':'取得中';
      image.addEventListener('load',()=>{status.textContent=document.documentElement.lang==='en'?'Image loaded; inspect content and coverage':'画像を取得（内容・範囲は要確認）'},{once:true});
      image.addEventListener('error',()=>{status.textContent=document.documentElement.lang==='en'?'Image unavailable. Check the source.':'画像を取得できません。出典から確認してください。'},{once:true});
      image.src=item.url;
    });
  });
  $('historical-flood-open').addEventListener('click',()=>{
    const dialog=$('historical-flood-dialog');
    const floodCase=historicalFloodCase();[...floodCase.images,floodCase.comparisonImage].forEach((item,index)=>{
      const image=$(`historical-flood-large-${index+1}`),status=$(`historical-flood-large-status-${index+1}`);
      if(image.dataset.started)return;image.dataset.started='true';status.textContent=document.documentElement.lang==='en'?'Loading':'取得中';
      image.addEventListener('load',()=>{status.textContent=document.documentElement.lang==='en'?'Image loaded; inspect content and coverage':'画像を取得（内容・範囲は要確認）'},{once:true});
      image.addEventListener('error',()=>{status.textContent=document.documentElement.lang==='en'?'Image unavailable. Check the source.':'画像を取得できません。出典から確認してください。'},{once:true});
      image.src=item.url;
    });
    if(typeof dialog.showModal==='function')dialog.showModal();
  });
  function updateGroundPairStatus(){
    const states=['joso-ground-image','joso-ground-aerial'].map(id=>$(id).dataset.loadState||'idle'),en=document.documentElement.lang==='en',failed=states.includes('error');
    for(const [id,statusId] of [['joso-ground-image','joso-ground-status'],['joso-ground-aerial','joso-ground-aerial-status']]){const state=$(id).dataset.loadState||'idle';$(statusId).textContent=state==='ready'?($(id).dataset.outside==='true'?(en?'Image loaded; camera position is outside this tile.':'画像を取得。撮影地点はこのタイル外です。'):(en?'Image loaded; position and time are unverified':'画像を取得（位置・時刻は未確認）')):state==='error'?(en?'Image unavailable. Check the source.':'画像を取得できません。出典を確認してください。'):state==='loading'?(en?'Loading':'取得中'):(en?'Not retrieved':'未取得')}
    $('joso-ground-retry').hidden=!failed;
    $('joso-ground-pair-status').textContent=failed?(en?'Comparison unavailable: at least one image did not load.':'画像を取得できないため比較できません。') :states.every(state=>state==='ready')?(en?'Both images loaded; location and timing remain unverified.':'両画像を取得しました。位置と撮影時刻の一致は未確認です。'):states.every(state=>state==='idle')?(en?'Images not yet retrieved.':'画像は未取得です。'):(en?'Retrieving images…':'画像を取得中です。');
  }
  function loadGroundPair(){
    const reference=historicalGroundReference(),point=slippyTilePoint(reference.tile,reference.cameraPoint);
    for(const [id,url,isAerial] of [['joso-ground-image',reference.ground.url,false],['joso-ground-aerial',reference.aerial.url,true]]){
      const image=$(id);if(image.dataset.loadState==='ready'||image.dataset.loadState==='loading')continue;image.dataset.loadState='loading';
      image.onload=()=>{image.dataset.loadState='ready';image.dataset.outside=String(isAerial&&!point);if(isAerial&&point){const marker=$('joso-ground-marker');marker.style.left=`${point.x*100}%`;marker.style.top=`${point.y*100}%`;marker.hidden=false}updateGroundPairStatus()};
      image.onerror=()=>{image.dataset.loadState='error';if(isAerial)$('joso-ground-marker').hidden=true;updateGroundPairStatus()};image.removeAttribute('src');image.src=url;
    }
    updateGroundPairStatus();
  }
  $('historical-ground-pair').addEventListener('toggle',()=>{if($('historical-ground-pair').open)loadGroundPair()});
  $('joso-ground-retry').addEventListener('click',loadGroundPair);
  for(const id of ['welcome-language','map-language'])$(id)?.addEventListener('change',()=>queueMicrotask(updateGroundPairStatus));
  function loadMabiImages(large=false){
    const floodCase=historicalMabiFloodCase(),reference=slippyTilePoint(floodCase.tile,floodCase.referencePoint);
    floodCase.images.forEach((item,index)=>{
      const suffix=large?'large-':'image-',statusSuffix=large?'large-status-':'status-',image=$(`historical-mabi-${suffix}${index+1}`),status=$(`historical-mabi-${statusSuffix}${index+1}`);
      if(image.dataset.started)return;image.dataset.started='true';status.textContent='取得中';
      image.addEventListener('load',()=>{status.textContent='画像を取得（内容・範囲は要確認）';if(large&&reference){const marker=$(`historical-mabi-marker-${index+1}`);marker.style.left=`${reference.x*100}%`;marker.style.top=`${reference.y*100}%`;marker.hidden=false}},{once:true});
      image.addEventListener('error',()=>{status.textContent='画像を取得できません。出典から確認してください。'},{once:true});
      image.src=item.url;
    });
  }
  $('historical-mabi-case').addEventListener('toggle',()=>{if($('historical-mabi-case').open)loadMabiImages()});
  $('historical-mabi-open').addEventListener('click',()=>{loadMabiImages(true);if(typeof $('historical-mabi-dialog').showModal==='function')$('historical-mabi-dialog').showModal()});
  const historicalReviewers=[mountHistoricalReview({root:$('historical-review-joso'),dialog:$('historical-flood-dialog'),caseId:'joso-2015',updateLocalHistory}),mountHistoricalReview({root:$('historical-review-mabi'),dialog:$('historical-mabi-dialog'),caseId:'mabi-2018',updateLocalHistory})];
  for(const id of ['welcome-language','map-language'])$(id)?.addEventListener('change',()=>historicalReviewers.forEach(reviewer=>reviewer.refresh()));
  const photoDialog=$('photo-scan-dialog'),photoFile=$('photo-scan-file');
  const photoReviewKey='muse-photo-reviews-v1';
  let photoGeneration=0,photoPrepared=null,photoPhase='empty',photoMetaSnapshot=null,photoReviewReceived=null,photoReviewBusy=false;
  function drawPhotoPreviews(boxes=[]){
    const view=$('photo-scan-previews');view.hidden=!photoPrepared;if(!photoPrepared)return;
    for(const id of ['photo-scan-original','photo-scan-overlay']){const canvas=$(id);canvas.width=photoPrepared.canvas.width;canvas.height=photoPrepared.canvas.height;const context=canvas.getContext('2d');context.drawImage(photoPrepared.canvas,0,0)}
    const canvas=$('photo-scan-overlay'),context=canvas.getContext('2d');context.strokeStyle='#ffb347';context.lineWidth=Math.max(2,canvas.width/220);
    for(const box of boxes)context.strokeRect(box.x1/box.w*canvas.width,box.y1/box.h*canvas.height,(box.x2-box.x1)/box.w*canvas.width,(box.y2-box.y1)/box.h*canvas.height);
  }
  function syncPhotoButton(){$('photo-scan-send').disabled=!photoPrepared||photoPhase==='loading'||!real;$('photo-review-save').disabled=!photoPrepared||photoPhase!=='done'||!photoMetaSnapshot||!photoReviewReceived||photoReviewBusy;$('photo-review-delete').disabled=photoReviewBusy;if(photoPrepared&&photoPhase==='ready'&&statusReady&&!real)$('photo-scan-status').textContent='Metaの接続が利用できないため送信できません。画像は端末内にあります。'}
  syncPhotoControls=syncPhotoButton;
  const photoScan=createPhotoScan({request:(image,signal)=>api('segment',{image},signal),onChange:state=>{
    photoPhase=state.phase;photoReviewReceived=state.phase==='done'&&photoMetaSnapshot?{frameId:state.id,receivedAt:new Date().toISOString(),boxCount:state.boxes.length,boxes:state.boxes}:null;$('photo-scan-status').textContent=state.message;drawPhotoPreviews(state.boxes);syncPhotoButton();
    if(state.phase==='done'&&photoMetaSnapshot)renderPhotoMetadata();
    else if(state.phase!=='loading')$('photo-scan-meta-result').textContent='';
  }});
  function photoLimitationsText(meta,en){
    const labels=en?{occluded:'blocked by buildings or trees',thin_wires:'thin wires or distant details hard to see',lighting:'backlight, darkness or rain',blur:'blur or low resolution'}:{occluded:'建物や樹木の陰',thin_wires:'細い線や遠方が見えにくい',lighting:'逆光・暗さ・雨など',blur:'ぼけ・低解像度'};
    const items=Array.isArray(meta?.limitations)?meta.limitations.map(value=>labels[value]).filter(Boolean):[];
    return en?`Self-reported visibility limitations: ${items.join(', ')||'none recorded'}. Unselected conditions and areas outside the image remain unverified.`:`見えにくさの申告：${items.join('・')||'記録なし'}。未選択の条件や画像の外も未確認です。`;
  }
  function renderPhotoMetadata(){
    if(!photoMetaSnapshot)return;const english=document.documentElement.lang==='en',kind=photoMetaSnapshot.kind,visibility=photoMetaSnapshot.visibility;
    const types=english?{unknown:'unknown',field:'field image',historical:'historical image',training:'training or simulated'}:{unknown:'不明',field:'現地の画像',historical:'過去の画像',training:'訓練・仮想画像'};
    const views=english?{unknown:'unknown',clear:'no obvious obstruction',obscured:'obscured, poor weather or dark'}:{unknown:'不明',clear:'目立つ遮蔽なし',obscured:'遮蔽・悪天候・暗さあり'};
    const time=photoMetaSnapshot.time?new Date(photoMetaSnapshot.time).toLocaleString(english?'en':'ja-JP'):(english?'unknown':'不明'),p=photoMetaSnapshot.position;
    const pos=p?`${p.latitude}, ${p.longitude} (${english?'reported error':'申告誤差'} ${p.accuracy===null?(english?'unknown':'不明'):`${p.accuracy} m`})`:(english?'unknown':'不明');
    const dirs=english?{unknown:'unknown',north:'north',east:'east',south:'south',west:'west'}:{unknown:'不明',north:'北',east:'東',south:'南',west:'西'},cal=english?{unknown:'unknown',reported:'reported performed',not_done:'reported not performed'}:{unknown:'不明',reported:'実施したとの申告',not_done:'未実施との申告'};
    const size=photoMetaSnapshot.originalSize,output=photoPrepared?.frame;
    const permissions=english?{unknown:'unknown',allowed:'user reports permission',disallowed:'not permitted'}:{unknown:'不明',allowed:'許可を確認したとの申告',disallowed:'許可されていない'};
    $('photo-scan-meta-result').textContent=(english?`Self-reported: ${types[kind]||types.unknown} / source ${photoMetaSnapshot.source||'unknown'} / Meta transfer permission ${permissions[photoMetaSnapshot.permission]||'unknown'} / captured ${time} / visibility ${views[visibility]||views.unknown} / camera position ${pos} / direction ${dirs[photoMetaSnapshot.direction]} / calibration ${cal[photoMetaSnapshot.calibration]}. Original ${size.width}×${size.height} px; sent ${output.width}×${output.height} px. Candidate location, area outside image and safety are unknown. `:`利用者の申告：画像の種類 ${types[kind]||types.unknown}／提供元 ${photoMetaSnapshot.source||'不明'}／Meta送信許可 ${permissions[photoMetaSnapshot.permission]||'不明'}／撮影日時 ${time}／視界 ${views[visibility]||views.unknown}／撮影位置 ${pos}／撮影方向 ${dirs[photoMetaSnapshot.direction]}／校正 ${cal[photoMetaSnapshot.calibration]}。元画像 ${size.width}×${size.height} px、送信画像 ${output.width}×${output.height} px。候補の実際の位置・画像外・安全は未確認です。`)+photoLimitationsText(photoMetaSnapshot,english);
  }
  function resetPhotoMetadata(){for(const id of ['photo-scan-kind','photo-scan-visibility','photo-scan-direction','photo-scan-calibration','photo-scan-permission'])$(id).value='unknown';for(const id of ['photo-scan-time','photo-scan-lat','photo-scan-lon','photo-scan-accuracy','photo-scan-source'])$(id).value='';for(const input of $('photo-scan-limitations').querySelectorAll('input'))input.checked=false}
  function clearPhoto(){photoGeneration++;photoPrepared=null;photoMetaSnapshot=null;photoFile.value='';$('photo-review-message').textContent='';resetPhotoMetadata();photoScan.clear();for(const id of ['photo-scan-original','photo-scan-overlay']){$(id).width=1;$(id).height=1}}
  function renderPhotoReviewHistory(){
    const container=$('photo-review-history'),en=document.documentElement.lang==='en';container.replaceChildren();let saved;
    try{saved=decodePhotoReviews(localStorage.getItem(photoReviewKey))}catch{container.textContent=en?'Local records unavailable.':'端末内の記録を読み取れません。';return}
    if(saved.status!=='ok'){container.textContent=en?'Records are unreadable and will not be overwritten.':'記録を読み取れません。上書きせず保持します。';return}
    if(!saved.records.length){container.textContent=en?'No saved image reviews.':'保存された画像確認はありません。';return}
    const kinds=en?{unknown:'unknown',field:'field image',historical:'historical image',training:'training or simulated'}:{unknown:'不明',field:'現地の画像',historical:'過去の画像',training:'訓練・仮想画像'},views=en?{unknown:'unknown',clear:'no obvious obstruction',obscured:'obscured / poor weather / dark'}:{unknown:'不明',clear:'目立つ遮蔽なし',obscured:'遮蔽・悪天候・暗さあり'},dirs=en?{unknown:'unknown',north:'north',east:'east',south:'south',west:'west'}:{unknown:'不明',north:'北',east:'東',south:'南',west:'西'},cal=en?{unknown:'unknown',reported:'reported performed',not_done:'reported not performed'}:{unknown:'不明',reported:'実施したとの申告',not_done:'未実施との申告'};
    for(const record of saved.records){const row=document.createElement('div'),description=document.createElement('p'),m=record.metadata,p=m.position,position=p?`${p.latitude}, ${p.longitude} ± ${p.accuracy??(en?'unknown':'不明')} m`:(en?'unknown':'不明'),captured=m.time?new Date(m.time).toLocaleString():(en?'unknown':'不明'),size=`${m.originalSize.width}×${m.originalSize.height} → ${record.sentSize.width}×${record.sentSize.height} px`;description.textContent=(en?`Self-reported: ${kinds[m.kind]} / captured ${captured} / position ${position} / direction ${dirs[m.direction]} / visibility ${views[m.visibility]} / calibration ${cal[m.calibration]}. Image size ${size}. Result ${new Date(record.receivedAt).toLocaleString()}: ${record.boxCount} candidates; saved ${new Date(record.recordedAt).toLocaleString()}. `:`申告：${kinds[m.kind]}／撮影 ${captured}／撮影位置 ${position}／方向 ${dirs[m.direction]}／視界 ${views[m.visibility]}／校正 ${cal[m.calibration]}。画像寸法 ${size}。${new Date(record.receivedAt).toLocaleString('ja-JP')} の候補 ${record.boxCount}件／保存 ${new Date(record.recordedAt).toLocaleString('ja-JP')}。`)+(record.version===2?(en?'Original image not saved; coverage and safety unknown.':'元画像は未保存。範囲・安全は不明。'):(en?'Image and boxes not saved; coverage and safety unknown.':'画像・候補枠は保存されず、範囲・安全は不明。'));row.append(description);
      const source=document.createElement('p'),permissions=en?{unknown:'unknown',allowed:'user reports permission',disallowed:'not permitted'}:{unknown:'不明',allowed:'許可を確認したとの申告',disallowed:'許可されていない'};source.textContent=en?`Self-reported source: ${m.source||'unknown'} / Meta transfer permission: ${permissions[m.permission]||'unknown'}. Not independently verified.`:`提供元の申告：${m.source||'不明'}／Meta送信許可：${permissions[m.permission]||'不明'}。独立した確認はしていません。`;row.append(source);
      const limitations=document.createElement('p');limitations.textContent=photoLimitationsText(m,en);row.append(limitations);
      if(record.version===2){const button=document.createElement('button');button.type='button';button.textContent=en?'Compare with selected image':'選択した画像と照合';button.addEventListener('click',()=>{const english=document.documentElement.lang==='en';if(!photoPrepared?.imageHash||!photoReviewMatchesFile(record,photoPrepared.imageHash)){$('photo-review-message').textContent=english?'Select the exact original image for this record. No image was sent.':'記録した元画像と一致しません。同じ画像ファイルを選んでください。送信はしていません。';return}if(photoPhase==='loading'||photoReviewBusy){$('photo-review-message').textContent=english?'Wait for the current operation to finish.':'現在の処理が終わるまでお待ちください。';return}photoMetaSnapshot=null;photoScan.setImage(photoPrepared.frame);drawPhotoPreviews(record.boxes);$('photo-scan-status').textContent=english?'Saved candidate boxes shown on the matching image. This is not a new SAM result.':'一致した画像に保存済みの候補枠を表示中。新しいSAMの結果ではありません。';$('photo-review-message').textContent=english?'Image matched locally; no image was sent.':'端末内で画像を照合しました。送信はしていません。'});row.append(button)}container.append(row)}
  }
  $('photo-scan-open').addEventListener('click',()=>{renderPhotoReviewHistory();syncPhotoButton();if(typeof photoDialog.showModal==='function')photoDialog.showModal()});
  photoDialog.addEventListener('close',clearPhoto);
  $('photo-scan-clear').addEventListener('click',clearPhoto);
  photoFile.addEventListener('change',async()=>{
    const generation=++photoGeneration,file=photoFile.files?.[0];photoPrepared=null;photoMetaSnapshot=null;$('photo-review-message').textContent='';photoScan.clear();
    resetPhotoMetadata();
    if(!file)return;
    if(!['image/png','image/jpeg','image/webp'].includes(file.type)||!file.size||file.size>10*1024*1024){$('photo-scan-status').textContent='PNG・JPEG・WebPの10 MB以下の画像を選んでください。';return}
    $('photo-scan-status').textContent='画像を端末内で読み込み中です。まだ送信していません。';
    let bitmap;
    try{
      if(typeof createImageBitmap!=='function')throw new Error('このブラウザーでは画像を読み込めません');
      bitmap=await createImageBitmap(file);if(generation!==photoGeneration)return;
      let imageHash=null;if(globalThis.crypto?.subtle){try{const hash=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());imageHash=Array.from(new Uint8Array(hash),byte=>byte.toString(16).padStart(2,'0')).join('')}catch{}if(generation!==photoGeneration)return}
      const size=photoScanDimensions(bitmap.width,bitmap.height),canvas=document.createElement('canvas');canvas.width=size.width;canvas.height=size.height;
      const context=canvas.getContext('2d');if(!context)throw new Error('画像を準備できません');context.drawImage(bitmap,0,0,size.width,size.height);
      const image=canvas.toDataURL('image/png'),id=globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`;
      photoPrepared={canvas,imageHash,originalSize:{width:bitmap.width,height:bitmap.height},frame:{id,image,width:size.width,height:size.height}};photoScan.setImage(photoPrepared.frame);
    }catch(error){if(generation===photoGeneration){photoPrepared=null;photoScan.clear();$('photo-scan-status').textContent=`画像を読み込めません：${error.message}`}}
    finally{bitmap?.close?.()}
  });
  const metadataChanged=()=>{if(photoPrepared){photoMetaSnapshot=null;$('photo-review-message').textContent='';photoScan.setImage(photoPrepared.frame)}};
  for(const id of ['photo-scan-kind','photo-scan-time','photo-scan-visibility','photo-scan-lat','photo-scan-lon','photo-scan-accuracy','photo-scan-direction','photo-scan-calibration','photo-scan-source','photo-scan-permission'])$(id).addEventListener('change',metadataChanged);
  for(const id of ['photo-scan-time','photo-scan-lat','photo-scan-lon','photo-scan-accuracy','photo-scan-source'])$(id).addEventListener('input',metadataChanged);
  $('photo-scan-limitations').addEventListener('change',metadataChanged);
  $('photo-scan-send').addEventListener('click',()=>{
    if(!real||!photoPrepared||photoPhase==='loading')return;
    if($('photo-scan-permission').value==='disallowed'){$('photo-scan-status').textContent=document.documentElement.lang==='en'?'The image is marked as not permitted for transfer; it was not sent.':'Metaへの送信が許可されていないため、画像は送信しませんでした。';return}
    if($('photo-scan-permission').value!=='allowed'){$('photo-scan-status').textContent=document.documentElement.lang==='en'?'Confirm the permission to send this image to Meta before sending. No image was sent.':'Metaへの送信許可を確認し、選択してください。画像は送信していません。';return}
    try{photoMetaSnapshot=createPhotoMetadata({kind:$('photo-scan-kind').value,time:$('photo-scan-time').value,visibility:$('photo-scan-visibility').value,latitude:$('photo-scan-lat').value,longitude:$('photo-scan-lon').value,accuracy:$('photo-scan-accuracy').value,direction:$('photo-scan-direction').value,calibration:$('photo-scan-calibration').value,source:$('photo-scan-source').value,permission:$('photo-scan-permission').value,limitations:[...$('photo-scan-limitations').querySelectorAll('input:checked')].map(input=>input.value),...photoPrepared.originalSize})}
    catch(error){$('photo-scan-status').textContent=document.documentElement.lang==='en'?'Check the date, paired coordinates and location error before sending.':`送信できません：${error.message}`;return}
    photoScan.run();
  });
  $('photo-review-save').addEventListener('click',async()=>{
    if(photoReviewBusy||photoPhase!=='done'||!photoPrepared||!photoMetaSnapshot||!photoReviewReceived)return;
    const generation=photoGeneration,meta=photoMetaSnapshot,received=photoReviewReceived,frame=photoPrepared.frame,en=document.documentElement.lang==='en',current=()=>photoDialog.open&&generation===photoGeneration&&photoMetaSnapshot===meta&&photoReviewReceived===received&&photoPhase==='done';
    try{const id=globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`,hash=photoPrepared.imageHash,review=createPhotoReview({version:hash?2:1,id,frameId:received.frameId,receivedAt:received.receivedAt,recordedAt:new Date().toISOString(),boxCount:received.boxCount,metadata:meta,sentSize:{width:frame.width,height:frame.height},...(hash?{imageHash:hash,boxes:received.boxes}:{})});photoReviewBusy=true;syncPhotoButton();$('photo-review-message').textContent=en?'Waiting to save…':'保存の順番を確認中…';await updateLocalHistory({storage:localStorage,locks:navigator.locks,key:photoReviewKey,stillCurrent:current,update:raw=>appendPhotoReview(raw,review)});if(current()){$('photo-review-message').textContent=hash?(en?'Review and candidate boxes saved; the image was not saved.':'確認記録と候補枠を保存しました。画像は保存していません。'):(en?'Review saved; image and boxes were not saved.':'確認記録を端末に保存しました。画像と候補枠は保存していません。');renderPhotoReviewHistory()}}
    catch(error){if(current())$('photo-review-message').textContent=en?'Save failed or may be incomplete. Check the local records.':`保存できなかったか、完了を確認できません：${error.message}`}
    finally{photoReviewBusy=false;syncPhotoButton()}
  });
  $('photo-review-delete').addEventListener('click',async()=>{
    if(photoReviewBusy)return;let expected;const en=document.documentElement.lang==='en';try{expected=localStorage.getItem(photoReviewKey)}catch{$('photo-review-message').textContent=en?'Local records unavailable.':'端末内の記録を読み取れません。';return}if(!confirm(en?'Delete all saved image reviews on this device?':'この端末の画像確認記録をすべて削除しますか？'))return;
    const generation=photoGeneration,current=()=>photoDialog.open&&generation===photoGeneration;
    try{photoReviewBusy=true;syncPhotoButton();$('photo-review-message').textContent=en?'Waiting to delete…':'削除の順番を確認中…';await updateLocalHistory({storage:localStorage,locks:navigator.locks,key:photoReviewKey,expected,stillCurrent:current,update:()=>null});if(current()){$('photo-review-message').textContent=en?'Image reviews deleted.':'画像確認の記録を削除しました。';renderPhotoReviewHistory()}}
    catch(error){if(current())$('photo-review-message').textContent=en?'Deletion failed or may be incomplete. Check the records.':`削除できなかったか、完了を確認できません：${error.message}`}
    finally{photoReviewBusy=false;syncPhotoButton()}
  });
  window.addEventListener('storage',event=>{if(event.key===photoReviewKey&&photoDialog.open)renderPhotoReviewHistory()});
  const exerciseKey='muse-tabletop-training-v1',exerciseDialog=$('exercise-dialog');
  let exerciseStart=null,exerciseScenario=null,exerciseGeneration=0,exerciseBusy=false,exerciseInitialSnapshot=null,exerciseUpdateSnapshot=null,exerciseReviewSnapshot=null;
  const trainingText={
    'facility-refused':{ja:['訓練：架空の施設に物資を届ける依頼があります。受け入れは確認中です。','変化：施設から受け入れ不可との報告。中継機との通信も途絶え、機体の最新位置は不明です。'],en:['Training: A fictional facility has requested supplies. Acceptance is unconfirmed.','Update: The facility reports it cannot accept supplies. Relay communication is lost and the aircraft position is unknown.']},
    'conflicting-reports':{ja:['訓練：架空の地域に、施設周辺の水について二つの報告があります。','変化：水が見えた報告と見えなかった報告が食い違い、一方の確認期限が切れました。機体の状況は未確認です。'],en:['Training: Two reports describe water near a fictional facility.','Update: Reports of water and no water disagree; one has expired. Aircraft status is unknown.']}
  };
  const exerciseEnglish=()=>document.documentElement.lang==='en';
  function renderExerciseSummary(){
    const target=$('exercise-summary'),button=$('exercise-summary-export'),en=exerciseEnglish();target.replaceChildren();button.disabled=true;let result;
    try{result=summarizeExerciseRecords(localStorage.getItem(exerciseKey))}catch{result={status:'corrupt'}}
    if(result.status!=='ok'){target.textContent=result.status==='empty'?(en?'No training records yet.':'演習記録はまだありません。'):(en?'Records are unreadable or unavailable; no summary was created.':'記録を読めないため集計できません。元の記録は変更しません。');return}
    const intro=document.createElement('p');intro.textContent=en?`Training records: ${result.recordCount}; observer entries: ${result.observationCount}. These are records, not participants. Unselected items and unobserved mentions do not prove a miss. Elapsed time includes interruptions and is not a safety or ability score.`:`演習記録 ${result.recordCount}件 ／ 観察記録 ${result.observationCount}件。件数は人数ではありません。未選択や言及を観察しなかったことは見落としの証明ではありません。経過時間には中断が含まれ、能力や安全の採点ではありません。`;target.append(intro);
    const names=en?{'facility-refused':'Facility refusal / lost communication','conflicting-reports':'Conflicting / expired reports'}:{'facility-refused':'施設の受け入れ不可と通信断','conflicting-reports':'食い違う報告と期限切れ'},focus=en?{facility:'facility',communications:'communications',age:'expiry',conflict:'conflict',flight:'aircraft'}:{facility:'施設',communications:'通信',age:'期限',conflict:'食い違い',flight:'機体'};
    const list=document.createElement('ul');list.className='exercise-summary-list';
    for(const row of result.scenarios){
      const li=document.createElement('li'),heading=document.createElement('strong');heading.textContent=names[row.scenario];li.append(heading);
      const add=(parent,text)=>{const p=document.createElement('p');p.textContent=text;parent.append(p)};
      if(!row.recordCount){add(li,en?'No records':'記録なし');list.append(li);continue}
      const d=row.durationSeconds,reported=Object.entries(row.selfReported).map(([key,n])=>`${focus[key]} ${n}`).join(' / '),observed=Object.entries(row.observations).filter(([,counts])=>Object.values(counts).some(Boolean)).map(([key,c])=>`${focus[key]} ${en?'mentioned / not observed / unknown':'言及あり／観察せず／不明'} ${c.acknowledged}/${c.not_acknowledged}/${c.uncertain}`).join(' · ')||(en?'none recorded':'記録なし');
      add(li,en?`${row.recordCount} records · ${row.observationCount} observer entries`:`演習 ${row.recordCount}件 ・ 観察 ${row.observationCount}件`);
      add(li,en?`Choices: hold ${row.decisions.hold} / confirm ${row.decisions.confirm} / alternative ${row.decisions.alternate}`:`行動：保留 ${row.decisions.hold} ／ 確認 ${row.decisions.confirm} ／ 別案 ${row.decisions.alternate}`);
      add(li,en?`Elapsed seconds: median ${d.median} (min ${d.min}, max ${d.max})`:`経過時間：中央値 ${d.median}秒（最短 ${d.min}秒・最長 ${d.max}秒）`);
      const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent=en?'View observation details':'観察の内訳を見る';details.append(summary);
      add(details,en?`Self-reported items: ${reported}`:`自己申告：${reported}`);
      add(details,en?`Records without observer: ${row.noObserverRecords}; records without shown text: ${row.noPresentationRecords}.`:`観察記録なし ${row.noObserverRecords}件 ／ 表示文のない旧記録 ${row.noPresentationRecords}件`);
      add(details,en?`Observer mentions: ${observed}`:`観察：${observed}`);
      add(details,en?`Workload per observer entry (not asked / light / moderate / high): ${row.workloads.not_asked}/${row.workloads.light}/${row.workloads.moderate}/${row.workloads.high}`:`観察記録ごとの負荷申告（聞いていない・不明／軽い／普通／重い） ${row.workloads.not_asked}/${row.workloads.light}/${row.workloads.moderate}/${row.workloads.high}`);
      li.append(details);list.append(li);
    }
    target.append(list);button.disabled=exerciseBusy;
  }
  function exerciseButtons(){for(const id of ['exercise-start','exercise-reveal','exercise-delete','exercise-export'])$(id).disabled=exerciseBusy;$('exercise-form').querySelector('[type="submit"]').disabled=exerciseBusy;renderExerciseSummary()}
  function exerciseHistory(){
    const el=$('exercise-history');el.replaceChildren();renderExerciseSummary();let saved;
    try{saved=decodeExerciseRecords(localStorage.getItem(exerciseKey))}catch{el.textContent=exerciseEnglish()?'Local storage unavailable.':'端末の保存領域を利用できません。';return}
    if(saved.status!=='ok'){el.textContent=exerciseEnglish()?'Saved records are unreadable; no records were overwritten.':'保存済みの記録を読み取れません。上書きしていません。';return}
    if(!saved.records.length){el.textContent=exerciseEnglish()?'No records yet.':'まだ記録はありません。';return}
    for(const record of saved.records){
      const row=document.createElement('p'),en=exerciseEnglish(),name=en?(record.scenario==='facility-refused'?'Facility refusal / lost communication':'Conflicting / expired reports'):(record.scenario==='facility-refused'?'施設の受け入れ不可と通信断':'食い違う報告と期限切れ');
      const decisions=en?{hold:'Hold and review',confirm:'Plan to verify',alternate:'Consider alternatives'}:{hold:'保留して情報を整理',confirm:'関係先への確認を想定',alternate:'別案を検討'};
      const facts=en?{facility:'facility',communications:'communications',age:'expiry',conflict:'conflicting reports',flight:'aircraft'}:{facility:'施設',communications:'通信',age:'期限',conflict:'報告の食い違い',flight:'機体'};
      row.textContent=`${new Date(record.finishedAt).toLocaleString(en?'en':'ja-JP')} · ${name}\n${decisions[record.decision]} · ${en?'Noticed':'気づいた情報'}: ${record.observed.map(x=>facts[x]).join(' / ')||(en?'none recorded':'記録なし')} · ${record.durationSeconds}${en?' sec':'秒'}${record.notes?'\n'+record.notes:''}`;
      const details=document.createElement('details'),summary=document.createElement('summary'),scenario=document.createElement('p'),notice=document.createElement('p');
      summary.textContent=en?'Review scenario context':'演習の状況を振り返る';
      if(record.presentation){
        const {initial,update}=record.presentation;
        scenario.textContent=`${en?'Content shown during the exercise':'演習時に表示した内容'} · ${en?'Initial':'開始時'} (${initial.lang}): ${initial.text}\n${en?'Update':'状況変化'} (${update.lang}, ${new Date(update.shownAt).toLocaleString(en?'en':'ja-JP')}): ${update.text}`;
        notice.textContent=en?'Times use this device’s clock and do not prove the participant saw or understood the text. A selection not made is not proof of an omission. This is not a safety assessment.':'時刻はこの端末の時計によるもので、参加者が文章を見たことや理解したことの証明にはなりません。選択しなかったことは見落としの証明ではありません。安全性の評価ではありません。';
      }else{
        scenario.textContent=`${en?'Current scenario':'現在のシナリオ'}: ${trainingText[record.scenario][en?'en':'ja'].join(' ')}`;
        notice.textContent=en?'This is the current scenario; the exact text shown during the earlier exercise was not saved. A selection not made is not proof of an omission. This is not a safety assessment.':'これは現在のシナリオです。以前の演習時に表示された文章は保存されていません。選択しなかったことは見落としの証明ではありません。安全性の評価ではありません。';
      }
      details.append(summary,scenario,notice);el.append(row,details);
      for(const review of record.reviews||[]){
        const observation=document.createElement('p'),focus=en?{facility:'facility',communications:'communications',age:'expiry',conflict:'conflicting reports',flight:'aircraft'}:{facility:'施設',communications:'通信',age:'期限',conflict:'報告の食い違い',flight:'機体'},observed=en?{acknowledged:'mention observed',not_acknowledged:'no mention observed',uncertain:'unknown'}:{acknowledged:'言及を観察',not_acknowledged:'言及を観察せず',uncertain:'不明'},workload=en?{not_asked:'not asked / unknown',light:'light',moderate:'moderate',high:'high'}:{not_asked:'聞いていない・不明',light:'軽い',moderate:'普通',high:'重い'};
        observation.textContent=`${en?'Observer':'観察者'} · ${new Date(review.at).toLocaleString(en?'en':'ja-JP')} · ${focus[review.focus]}: ${observed[review.observed]} · ${en?'Workload (self-report)':'負荷（本人申告）'}: ${workload[review.workload]}${review.note?' · '+review.note:''}`;details.append(observation);
      }
      const observe=document.createElement('button');observe.type='button';observe.className='exercise-observe-button';observe.textContent=en?'Add observer note':'観察を記録';observe.addEventListener('click',()=>{
        if(exerciseBusy)return;if(!$('exercise-review-form').hidden){$('exercise-review-status').textContent=exerciseEnglish()?'Finish or cancel the current note before choosing another record.':'別の記録を選ぶ前に、記入中のメモを保存するか記入をやめてください。';return}
        exerciseReviewSnapshot=record;$('exercise-review-target').textContent=`${exerciseEnglish()?'Selected training':'対象の演習'}: ${name} · ${new Date(record.finishedAt).toLocaleString(exerciseEnglish()?'en':'ja-JP')}`;$('exercise-review-form').reset();$('exercise-review-form').hidden=false;$('exercise-review-status').textContent='';$('exercise-review-focus').focus();
      });details.append(observe);
      const remove=document.createElement('button');remove.type='button';remove.className='exercise-delete-one';remove.textContent=en?'Delete this record':'この演習記録を削除';remove.addEventListener('click',async()=>{
        if(exerciseBusy||!exerciseDialog.open)return;const generation=exerciseGeneration,english=exerciseEnglish();let expected;
        if(!$('exercise-review-form').hidden){$('exercise-status').textContent=english?'Save or cancel the open observer note before deleting records.':'削除する前に、記入中の観察メモを保存するか記入をやめてください。';return}
        try{expected=localStorage.getItem(exerciseKey)}catch{$('exercise-status').textContent=english?'Could not read records.':'記録を読み取れません。';return}
        if(!confirm(english?'Delete only this training record and its observer notes? Export it first if needed.':'この演習記録と観察メモだけを削除しますか？ 必要なら先に記録を書き出してください。'))return;
        const current=()=>exerciseDialog.open&&exerciseGeneration===generation;
        try{exerciseBusy=true;exerciseButtons();$('exercise-status').textContent=english?'Waiting to delete…':'削除の順番を確認中…';await updateLocalHistory({storage:localStorage,locks:navigator.locks,key:exerciseKey,expected,stillCurrent:current,update:raw=>removeExerciseRecord(raw,record)});if(current()){$('exercise-status').textContent=english?'Training record deleted.':'この演習記録を削除しました。';exerciseHistory()}}
        catch(error){if(current())$('exercise-status').textContent=english?'Deletion failed. Check the latest records or duplicates.':`削除できません：${error.message}`}
        finally{exerciseBusy=false;exerciseButtons()}
      });details.append(remove);
    }
  }
  $('exercise-open').addEventListener('click',()=>{exerciseHistory();exerciseDialog.showModal()});
  $('exercise-start').addEventListener('click',()=>{
    if(exerciseBusy)return;exerciseGeneration++;exerciseScenario=$('exercise-scenario').value;if(!Object.hasOwn(trainingText,exerciseScenario))return;exerciseStart=new Date().toISOString();$('exercise-scenario').disabled=true;$('exercise-run').hidden=false;$('exercise-form').hidden=true;$('exercise-reveal').hidden=false;$('exercise-update').textContent='';$('exercise-form').reset();$('exercise-status').textContent='';const lang=exerciseEnglish()?'en':'ja';$('exercise-initial').textContent=trainingText[exerciseScenario][lang][0];exerciseInitialSnapshot={text:$('exercise-initial').textContent,lang};exerciseUpdateSnapshot=null;
  });
  $('exercise-reveal').addEventListener('click',()=>{if(!exerciseStart||exerciseUpdateSnapshot)return;const lang=exerciseEnglish()?'en':'ja';$('exercise-update').textContent=trainingText[exerciseScenario][lang][1];exerciseUpdateSnapshot={text:$('exercise-update').textContent,lang,shownAt:new Date().toISOString()};$('exercise-reveal').hidden=true;$('exercise-form').hidden=false});
  $('exercise-form').addEventListener('submit',async event=>{
    event.preventDefault();if(!exerciseStart||!exerciseScenario||exerciseBusy)return;
    const generation=exerciseGeneration,current=()=>exerciseDialog.open&&exerciseGeneration===generation;
    try{
      const record=createExerciseRecord({scenario:exerciseScenario,decision:$('exercise-decision').value,observed:[...document.querySelectorAll('input[name="exercise-observed"]:checked')].map(x=>x.value),notes:$('exercise-notes').value,startedAt:exerciseStart,finishedAt:new Date().toISOString(),presentation:{initial:exerciseInitialSnapshot,update:exerciseUpdateSnapshot}});
      exerciseBusy=true;exerciseButtons();$('exercise-status').textContent=exerciseEnglish()?'Waiting to save…':'保存の順番を確認中…';
      await updateLocalHistory({storage:localStorage,locks:navigator.locks,key:exerciseKey,stillCurrent:current,update:raw=>appendExerciseRecord(raw,record)});
      if(current()){exerciseStart=null;$('exercise-scenario').disabled=false;$('exercise-form').hidden=true;$('exercise-status').textContent=exerciseEnglish()?'Training record saved on this device.':'訓練の記録をこの端末に保存しました。';exerciseHistory();$('exercise-history').parentElement.open=true}
    }catch(error){if(current())$('exercise-status').textContent=exerciseEnglish()?'Save failed or may be incomplete. Compare the stored records before retrying.':`保存できなかったか、完了を確認できません。記録を確認してください：${error.message}`}
    finally{exerciseBusy=false;exerciseButtons()}
  });
  $('exercise-review-form').addEventListener('submit',async event=>{
    event.preventDefault();if(exerciseBusy||!exerciseReviewSnapshot)return;const snapshot=exerciseReviewSnapshot,generation=exerciseGeneration,current=()=>exerciseDialog.open&&exerciseGeneration===generation&&exerciseReviewSnapshot===snapshot;
    const observation={at:new Date().toISOString(),focus:$('exercise-review-focus').value,observed:$('exercise-review-observed').value,workload:$('exercise-review-workload').value,note:$('exercise-review-note').value};
    try{exerciseBusy=true;exerciseButtons();$('exercise-review-form').querySelectorAll('button').forEach(button=>button.disabled=true);$('exercise-review-status').textContent=exerciseEnglish()?'Saving observation…':'観察を保存中…';await updateLocalHistory({storage:localStorage,locks:navigator.locks,key:exerciseKey,stillCurrent:current,update:raw=>recordExerciseObservation(raw,snapshot,observation)});if(current()){exerciseReviewSnapshot=null;$('exercise-review-form').reset();$('exercise-review-form').hidden=true;exerciseHistory();$('exercise-review-status').textContent=exerciseEnglish()?'Observation saved.':'観察を保存しました。'}}
    catch(error){if(current())$('exercise-review-status').textContent=exerciseEnglish()?'Could not save. Keep the note and check the latest or duplicate records.':`保存できません。メモを控え、最新の記録や重複を確認してください：${error.message}`}
    finally{exerciseBusy=false;exerciseButtons();$('exercise-review-form').querySelectorAll('button').forEach(button=>button.disabled=false)}
  });
  $('exercise-review-cancel').addEventListener('click',()=>{if(exerciseBusy)return;exerciseReviewSnapshot=null;$('exercise-review-form').reset();$('exercise-review-form').hidden=true;$('exercise-review-status').textContent=''});
  $('exercise-summary-export').addEventListener('click',()=>{if(exerciseBusy)return;const en=exerciseEnglish();try{const summary=summarizeExerciseRecords(localStorage.getItem(exerciseKey));if(summary.status!=='ok')throw new Error('unavailable');const url=URL.createObjectURL(new Blob([JSON.stringify({kind:'tabletop-summary',version:1,...summary},null,2)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='muse-tabletop-summary.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);$('exercise-status').textContent=en?'Summary export started. Small counts may identify people; check before sharing.':'集計を書き出します。件数が少ない場合は人が推測されることもあるため、共有前に確認してください。'}catch{$('exercise-status').textContent=en?'Could not export summary.':'集計を書き出せません。';renderExerciseSummary()}});
  $('exercise-export').addEventListener('click',()=>{if(exerciseBusy)return;const en=exerciseEnglish();try{const raw=localStorage.getItem(exerciseKey);if(raw===null)throw new Error('empty');const valid=decodeExerciseRecords(raw).status==='ok',url=URL.createObjectURL(new Blob([raw],{type:'text/plain;charset=utf-8'})),link=document.createElement('a');link.href=url;link.download=valid?'muse-tabletop-records.json':'muse-tabletop-unreadable.txt';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);$('exercise-status').textContent=en?'Export started. Review notes before sharing.':'書き出しを開始しました。共有前にメモを確認してください。'}catch{$('exercise-status').textContent=en?'Could not export records.':'記録を書き出せません。'}});
  $('exercise-delete').addEventListener('click',async()=>{
    if(exerciseBusy)return;let expected;try{expected=localStorage.getItem(exerciseKey)}catch{$('exercise-status').textContent=exerciseEnglish()?'Could not read records.':'記録を読み取れません。';return}
    if(!$('exercise-review-form').hidden){$('exercise-status').textContent=exerciseEnglish()?'Save or cancel the open observer note before deleting records.':'削除する前に、記入中の観察メモを保存するか記入をやめてください。';return}
    if(!confirm(exerciseEnglish()?'Delete all tabletop training records on this device?':'この端末の机上演習記録をすべて削除しますか？'))return;
    const generation=exerciseGeneration,current=()=>exerciseDialog.open&&exerciseGeneration===generation;
    try{exerciseBusy=true;exerciseButtons();$('exercise-status').textContent=exerciseEnglish()?'Waiting to delete…':'削除の順番を確認中…';await updateLocalHistory({storage:localStorage,locks:navigator.locks,key:exerciseKey,expected,stillCurrent:current,update:()=>null});if(current()){$('exercise-status').textContent=exerciseEnglish()?'Training records deleted.':'演習記録を削除しました。';exerciseHistory()}}
    catch(error){if(current())$('exercise-status').textContent=exerciseEnglish()?'Deletion failed or may be incomplete. Check the stored records.':`削除できなかったか、完了を確認できません。記録を確認してください：${error.message}`}
    finally{exerciseBusy=false;exerciseButtons()}
  });
  function hasExerciseDraft(){
    const exercise=exerciseStart!==null;
    const review=!$('exercise-review-form').hidden&&['exercise-review-focus','exercise-review-observed','exercise-review-workload','exercise-review-note'].some(id=>$(id).value.trim());
    return !!(exercise||review);
  }
  function confirmExerciseClose(event){if(hasExerciseDraft()&&!window.confirm(exerciseEnglish()?'Discard the unsaved exercise or observer note and close?':'未保存の演習や観察メモを破棄して閉じますか？'))event.preventDefault()}
  exerciseDialog.addEventListener('cancel',confirmExerciseClose);
  exerciseDialog.querySelector('header form[method="dialog"]').addEventListener('submit',confirmExerciseClose);
  window.addEventListener('beforeunload',event=>{if(exerciseDialog.open&&hasExerciseDraft()){event.preventDefault();event.returnValue=''}});
  exerciseDialog.addEventListener('close',()=>{exerciseGeneration++;exerciseStart=null;exerciseScenario=null;exerciseInitialSnapshot=null;exerciseUpdateSnapshot=null;exerciseReviewSnapshot=null;$('exercise-review-form').reset();$('exercise-review-form').hidden=true;$('exercise-review-status').textContent='';$('exercise-scenario').disabled=false;$('exercise-form').reset();$('exercise-run').hidden=true;$('exercise-status').textContent=''});
  window.addEventListener('storage',event=>{if(event.key===exerciseKey&&exerciseDialog.open)exerciseHistory()});
  $('risk-toggle').addEventListener('change',renderPilot);
  for(const id of ['welcome-language','map-language'])$(id)?.addEventListener('change',()=>{renderPilot();syncConsult();syncMapPlan();if(photoPhase==='done')renderPhotoMetadata();if(photoDialog.open)renderPhotoReviewHistory();if(exerciseDialog.open)exerciseHistory()});
}


