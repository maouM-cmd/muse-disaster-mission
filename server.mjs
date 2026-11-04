import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createJmaFeedLoader,createJmaReportLoader,validJmaFloodReportUrl,validJmaWarningReportUrl} from './jma-feed-server.mjs';
import {planWithMuse,segmentWithSam,transcribeWithMuse,rankChecksWithMuse,consultMapWithMuse,planMapDetour,validRouteEvidence,validFleetEvidence,planFleetWithMuse,planFleetTextBenchmark} from './meta.mjs';
import {CHECK_LABELS,mapConsultInputValid,mapFloodInputValid,validateConsultObservation,validateConsultFieldReports,validateConsultFacilityReports,validateConsultEvidenceRefs,validateConsultCitations} from './readiness.mjs';
import {validateConsultFloodBulletin} from './readiness.mjs';
import {validateConsultInfrastructureReports} from './infrastructure-reports.mjs';
const root=path.dirname(fileURLToPath(import.meta.url)), port=Number(process.env.PORT||4385);
const files=new Map([['/',['index.html','text/html; charset=utf-8']],['/style.css',['style.css','text/css; charset=utf-8']],['/app.js',['app.js','text/javascript; charset=utf-8']],['/mission.mjs',['mission.mjs','text/javascript; charset=utf-8']],['/speech.mjs',['speech.mjs','text/javascript; charset=utf-8']],['/camera.mjs',['camera.mjs','text/javascript; charset=utf-8']],['/geo-data.mjs',['geo-data.mjs','text/javascript; charset=utf-8']],['/gsi-scenario.mjs',['gsi-scenario.mjs','text/javascript; charset=utf-8']],['/readiness.mjs',['readiness.mjs','text/javascript; charset=utf-8']],['/real-map.mjs',['real-map.mjs','text/javascript; charset=utf-8']],['/scene.mjs',['scene.mjs','text/javascript; charset=utf-8']],['/delivery.mjs',['delivery.mjs','text/javascript; charset=utf-8']],['/assets/plaster.jpg',['assets/plaster.jpg','image/jpeg']],['/assets/asphalt.jpg',['assets/asphalt.jpg','image/jpeg']],['/vendor/three.module.js',['node_modules/three/build/three.module.js','text/javascript; charset=utf-8']],['/vendor/three.core.js',['node_modules/three/build/three.core.js','text/javascript; charset=utf-8']],['/plan-stream.mjs',['plan-stream.mjs','text/javascript; charset=utf-8']]]);

for(const [route,entry] of [['/assets/urban/facade.gltf',['assets/urban/facade.gltf','model/gltf+json']],['/assets/urban/modular_urban_apartments_facade.bin',['assets/urban/modular_urban_apartments_facade.bin','application/octet-stream']],['/assets/urban/textures/modular_urban_apartments_facade_objects_arm_1k.jpg',['assets/urban/textures/modular_urban_apartments_facade_objects_arm_1k.jpg','image/jpeg']],['/assets/urban/textures/modular_urban_apartments_facade_objects_diff_1k.jpg',['assets/urban/textures/modular_urban_apartments_facade_objects_diff_1k.jpg','image/jpeg']],['/assets/urban/textures/modular_urban_apartments_facade_objects_nor_gl_1k.jpg',['assets/urban/textures/modular_urban_apartments_facade_objects_nor_gl_1k.jpg','image/jpeg']],['/assets/urban/textures/modular_urban_apartments_facade_plaster_arm_1k.jpg',['assets/urban/textures/modular_urban_apartments_facade_plaster_arm_1k.jpg','image/jpeg']],['/assets/urban/textures/modular_urban_apartments_facade_plaster_diff_1k.jpg',['assets/urban/textures/modular_urban_apartments_facade_plaster_diff_1k.jpg','image/jpeg']],['/assets/urban/textures/modular_urban_apartments_facade_plaster_nor_gl_1k.jpg',['assets/urban/textures/modular_urban_apartments_facade_plaster_nor_gl_1k.jpg','image/jpeg']],['/assets/urban/textures/modular_urban_apartments_facade_trim_01_arm_1k.jpg',['assets/urban/textures/modular_urban_apartments_facade_trim_01_arm_1k.jpg','image/jpeg']],['/assets/urban/textures/modular_urban_apartments_facade_trim_01_diff_1k.jpg',['assets/urban/textures/modular_urban_apartments_facade_trim_01_diff_1k.jpg','image/jpeg']],['/assets/urban/textures/modular_urban_apartments_facade_trim_01_nor_gl_1k.jpg',['assets/urban/textures/modular_urban_apartments_facade_trim_01_nor_gl_1k.jpg','image/jpeg']],['/assets/urban/textures/modular_urban_apartments_facade_trim_02_arm_1k.jpg',['assets/urban/textures/modular_urban_apartments_facade_trim_02_arm_1k.jpg','image/jpeg']],['/assets/urban/textures/modular_urban_apartments_facade_trim_02_diff_1k.jpg',['assets/urban/textures/modular_urban_apartments_facade_trim_02_diff_1k.jpg','image/jpeg']],['/assets/urban/textures/modular_urban_apartments_facade_trim_02_nor_gl_1k.jpg',['assets/urban/textures/modular_urban_apartments_facade_trim_02_nor_gl_1k.jpg','image/jpeg']],['/vendor/addons/loaders/GLTFLoader.js',['node_modules/three/examples/jsm/loaders/GLTFLoader.js','text/javascript; charset=utf-8']],['/vendor/addons/utils/BufferGeometryUtils.js',['node_modules/three/examples/jsm/utils/BufferGeometryUtils.js','text/javascript; charset=utf-8']],['/vendor/addons/utils/SkeletonUtils.js',['node_modules/three/examples/jsm/utils/SkeletonUtils.js','text/javascript; charset=utf-8']]])files.set(route,entry);
files.set('/assets/overcast.hdr',['assets/overcast.hdr','application/octet-stream']);
files.set('/assets/rescue-drone.glb',['assets/rescue-drone.glb','model/gltf-binary']);
files.set('/assets/mission-intro.png',['assets/mission-intro-generated-20261104.png','image/png']);
files.set('/assets/historical/nied-20150911-112705.jpg',['evidence/nied-20150911-112705-original.jpg','image/jpeg']);
files.set('/fleet-engine.mjs',['fleet-engine.mjs','text/javascript; charset=utf-8']);
files.set('/fleet-map.mjs',['fleet-map.mjs','text/javascript; charset=utf-8']);
files.set('/fleet-coordination.mjs',['fleet-coordination.mjs','text/javascript; charset=utf-8']);
files.set('/fleet-benchmark.mjs',['fleet-benchmark.mjs','text/javascript; charset=utf-8']);
files.set('/meta.mjs',['meta.mjs','text/javascript; charset=utf-8']);
files.set('/fleet-distance.mjs',['fleet-distance.mjs','text/javascript; charset=utf-8']);
files.set('/jma-river-areas-20260527.json',['jma-river-areas-20260527.json','application/json; charset=utf-8']);
files.set('/vendor/addons/loaders/HDRLoader.js',['node_modules/three/examples/jsm/loaders/HDRLoader.js','text/javascript; charset=utf-8']);
function cesiumEntry(urlPath){
  if(urlPath==='/cesium/Cesium.js')return ['node_modules/cesium/Build/Cesium/Cesium.js','text/javascript; charset=utf-8'];
  const match=urlPath.match(/^\/cesium\/(Assets|Widgets|Workers|ThirdParty)\/([a-zA-Z0-9_.\/-]+)$/);
  if(!match||match[2].split('/').some(part=>!part||part==='.'||part==='..'||part.startsWith('.')))return null;
  const ext=path.extname(match[2]).toLowerCase(),types={'.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.wasm':'application/wasm','.ktx2':'image/ktx2','.webp':'image/webp'};
  if(!types[ext])return null;return [`node_modules/cesium/Build/Cesium/${match[1]}/${match[2]}`,types[ext]];
}
const enabled=process.env.MUSE_REAL_ENABLED==='1' && !!process.env.MODEL_API_KEY;
files.set('/infrastructure-reports.mjs',['infrastructure-reports.mjs','text/javascript; charset=utf-8']);
files.set('/infrastructure-reports-ui.mjs',['infrastructure-reports-ui.mjs','text/javascript; charset=utf-8']);
function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data))}
function museFailureMessage(error){
  const code=/^Meta API エラー \((401|403|429)\)$/.exec(error?.message||'')?.[1];
  return code==='429'?'Metaの利用制限を確認してください。':code?'Metaの認証または利用権限を確認してください。':'Museとの通信または回答を確認できません。';
}
async function readJson(req){let chunks=[],size=0;for await(const chunk of req){size+=chunk.length;if(size>6_000_000)throw new Error('入力が大きすぎます');chunks.push(chunk)}return JSON.parse(Buffer.concat(chunks).toString('utf8'))}
function adapterProvenance(adapter,builtin,declared){
  if(declared!==undefined&&!['fixture','unknown'].includes(declared))throw new TypeError('Invalid adapter provenance');
  if(declared==='fixture'&&adapter===builtin)throw new TypeError('Fixture provenance requires a fixture adapter');
  return declared??(adapter===builtin?'muse':'unknown');
}
export function createServer({active=enabled,key=process.env.MODEL_API_KEY,plan=planWithMuse,segment=segmentWithSam,transcribe=transcribeWithMuse,review=rankChecksWithMuse,mapConsult=consultMapWithMuse,mapConsultProvenance,mapPlan=planMapDetour,mapPlanProvenance,fleetPlan=planFleetWithMuse,fleetPlanProvenance,fleetBenchmark=planFleetTextBenchmark,fleetBenchmarkProvenance,floodFeed=createJmaFeedLoader(),recentFloodFeed=createJmaFeedLoader({frequency:'recent'}),floodReport=createJmaReportLoader(),warningReport=createJmaReportLoader({validator:validJmaWarningReportUrl})}={}){const mapSource=adapterProvenance(mapConsult,consultMapWithMuse,mapConsultProvenance),planSource=adapterProvenance(mapPlan,planMapDetour,mapPlanProvenance),fleetSource=adapterProvenance(fleetPlan,planFleetWithMuse,fleetPlanProvenance),benchmarkSource=adapterProvenance(fleetBenchmark,planFleetTextBenchmark,fleetBenchmarkProvenance);return http.createServer(async(req,res)=>{const url=new URL(req.url,'http://localhost');if(url.pathname==='/api/status'&&req.method==='GET')return json(res,200,{enabled:active});
if(url.pathname==='/api/flood-feed'||url.pathname==='/api/flood-feed-recent'){
  if(req.method!=='POST')return json(res,405,{error:'Method not allowed'});
  if(req.headers.origin!==`http://127.0.0.1:${req.socket.localPort}`)return json(res,403,{error:'Origin not allowed'});
  try{const data=await readJson(req);if(!data||Array.isArray(data)||typeof data!=='object'||Object.keys(data).length)return json(res,400,{error:'入力が不正です'});return json(res,200,await (url.pathname==='/api/flood-feed-recent'?recentFloodFeed():floodFeed()))}catch{return json(res,502,{error:'気象庁フィードを取得できません'})}
}
if(url.pathname==='/api/flood-report'){
  if(req.method!=='POST')return json(res,405,{error:'Method not allowed'});
  if(req.headers.origin!==`http://127.0.0.1:${req.socket.localPort}`)return json(res,403,{error:'Origin not allowed'});
  try{const data=await readJson(req);if(!data||Array.isArray(data)||typeof data!=='object'||Object.keys(data).join(',')!=='url'||!validJmaFloodReportUrl(data.url))return json(res,400,{error:'入力が不正です'});return json(res,200,await floodReport(data.url))}catch{return json(res,502,{error:'気象庁の電文を取得できません'})}
}
if(url.pathname==='/api/warning-report'){
  if(req.method!=='POST')return json(res,405,{error:'Method not allowed'});
  if(req.headers.origin!==`http://127.0.0.1:${req.socket.localPort}`)return json(res,403,{error:'Origin not allowed'});
  try{const data=await readJson(req);if(!data||Array.isArray(data)||typeof data!=='object'||Object.keys(data).join(',')!=='url'||!validJmaWarningReportUrl(data.url))return json(res,400,{error:'入力が不正です'});return json(res,200,await warningReport(data.url))}catch{return json(res,502,{error:'気象庁の電文を取得できません'})}
}
if(url.pathname==='/api/map-capabilities'&&req.method==='GET')return json(res,200,{mapConsult:true,mapConsultProvenance:mapSource,mapConsultRefs:true,mapConsultObservation:true,mapConsultObservationReferenceKind:true,mapConsultObservationAccumulatedRain:true,mapConsultObservationTotalsOnly:true,mapConsultFieldReports:true,mapConsultFacilityReports:true,mapConsultBulletin:true,mapConsultInfrastructureReports:true,fleetPlanProvenance:fleetSource,mapPlan:true,mapPlanProvenance:planSource,mapPlanEvidence:true,mapFloodContext:true,fleetPlan:true,fleetEvidenceV2:true,fleetEvidenceV3:true});
if(url.pathname==='/api/fleet-benchmark'){
  if(req.method!=='POST')return json(res,405,{error:'Method not allowed'});
  if(req.headers.origin!==`http://127.0.0.1:${req.socket.localPort}`)return json(res,403,{error:'Origin not allowed'});
  if(!active)return json(res,503,{error:'Muse接続は無効です'});
  const controller=new AbortController();res.on('close',()=>{if(!res.writableFinished)controller.abort()});
  let data;try{data=await readJson(req)}catch{if(!res.destroyed)return json(res,400,{error:'比較の入力を読み取れません。'});return}
  if(!data||Array.isArray(data)||Object.keys(data).join(',')!=='evidence'||!validFleetEvidence(data.evidence)||!Object.hasOwn(data.evidence,'distances'))return json(res,400,{error:'比較の入力が不正です。'});
  try{const result=await fleetBenchmark({key,evidence:data.evidence,signal:controller.signal});if(!result||Object.keys(result).sort().join(',')!=='choice,reason'||!['A','B','none'].includes(result.choice)||typeof result.reason!=='string'||!result.reason.trim()||result.reason.length>240)throw new Error('Museの比較回答が不正です');return json(res,200,{result,provenance:benchmarkSource})}catch(error){if(!res.destroyed)return json(res,502,{error:museFailureMessage(error)})}return;
}
if(url.pathname==='/api/fleet-plan'){
  if(req.method!=='POST')return json(res,405,{error:'Method not allowed'});
  if(req.headers.origin!==`http://127.0.0.1:${req.socket.localPort}`)return json(res,403,{error:'Origin not allowed'});
  if(!active)return json(res,503,{error:'Muse接続は無効です'});
  const controller=new AbortController();res.on('close',()=>{if(!res.writableFinished)controller.abort()});
  let data;try{data=await readJson(req)}catch{if(!res.destroyed)return json(res,400,{error:'機体の共有情報の入力を読み取れません。'});return}
  if(!data||Array.isArray(data)||Object.keys(data).sort().join(',')!=='evidence,image'||typeof data.image!=='string'||!data.image.startsWith('data:image/png;base64,')||!validFleetEvidence(data.evidence))return json(res,400,{error:'機体の共有情報の入力が不正です。'});
  try{
    const result=await fleetPlan({key,image:data.image,evidence:data.evidence,signal:controller.signal});return json(res,200,{result,provenance:fleetSource});
  }catch(error){if(!res.destroyed)return json(res,502,{error:museFailureMessage(error)})}return;
}
if(url.pathname==='/api/map-plan'){
  if(req.method!=='POST')return json(res,405,{error:'Method not allowed'});
  if(req.headers.origin!==`http://127.0.0.1:${req.socket.localPort}`)return json(res,403,{error:'Origin not allowed'});
  if(!active)return json(res,503,{error:'Muse接続は無効です'});
  const controller=new AbortController();res.on('close',()=>{if(!res.writableFinished)controller.abort()});
  let data;try{data=await readJson(req)}catch{if(!res.destroyed)return json(res,400,{error:'経路相談の入力を読み取れません。'});return}
  if(!data||Array.isArray(data)||Object.keys(data).some(k=>!['image','evidence'].includes(k))||typeof data.image!=='string'||!data.image.startsWith('data:image/png;base64,')||(data.evidence!==undefined&&!validRouteEvidence(data.evidence)))return json(res,400,{error:'経路相談の入力が不正です。'});
  try{const result=await mapPlan({key,image:data.image,evidence:data.evidence,signal:controller.signal});return json(res,200,{result,provenance:planSource})}catch(error){if(!res.destroyed)return json(res,502,{error:museFailureMessage(error)})}return;
}
if(url.pathname==='/api/map-consult'){
  if(req.method!=='POST')return json(res,405,{error:'Method not allowed'});
  if(req.headers.origin!==`http://127.0.0.1:${req.socket.localPort}`)return json(res,403,{error:'Origin not allowed'});
  if(!active)return json(res,503,{error:'Muse接続は無効です'});
  const controller=new AbortController();res.on('close',()=>{if(!res.writableFinished)controller.abort()});
  let data;
  try{data=await readJson(req)}catch{if(!res.destroyed)return json(res,400,{code:'input_rejected',error:'相談内容を読み取れません。入力と期限を確認してください。'});return}
  if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).some(k=>!['image','supply','quantity','flood','observation','fieldReports','facilityReports','bulletin','infrastructureReports','evidenceRefs'].includes(k))||!Object.hasOwn(data,'image')||!Object.hasOwn(data,'supply')||!Object.hasOwn(data,'quantity')||typeof data.image!=='string'||!data.image.startsWith('data:image/png;base64,')||!mapConsultInputValid(data.supply,data.quantity)||!mapFloodInputValid(data.flood)||(Object.hasOwn(data,'observation')&&(!Object.hasOwn(data,'evidenceRefs')||!validateConsultObservation(data.observation,Date.now())))||(Object.hasOwn(data,'fieldReports')&&(!Object.hasOwn(data,'evidenceRefs')||!validateConsultFieldReports(data.fieldReports,Date.now())))||(Object.hasOwn(data,'facilityReports')&&(!Object.hasOwn(data,'evidenceRefs')||!validateConsultFacilityReports(data.facilityReports,Date.now())))||(Object.hasOwn(data,'bulletin')&&(!Object.hasOwn(data,'evidenceRefs')||!validateConsultFloodBulletin(data.bulletin,Date.now())))||(Object.hasOwn(data,'infrastructureReports')&&(!Object.hasOwn(data,'evidenceRefs')||!validateConsultInfrastructureReports(data.infrastructureReports,Date.now())))||(Object.hasOwn(data,'evidenceRefs')&&!validateConsultEvidenceRefs(data.evidenceRefs,Object.hasOwn(data,'flood'),Object.hasOwn(data,'observation'),Object.hasOwn(data,'fieldReports'),Object.hasOwn(data,'facilityReports'),Object.hasOwn(data,'bulletin'),Object.hasOwn(data,'infrastructureReports'))))return json(res,400,{code:'input_rejected',error:'相談内容が不正か期限切れです。入力と参照情報を確認してください。'});
  try{
    const result=await mapConsult({key,...data,signal:controller.signal});
    if(data.evidenceRefs&&!validateConsultCitations(data.evidenceRefs,result?.cited_ids))throw new Error('invalid citations');
    return json(res,200,{result,provenance:mapSource});
  }catch(error){
    if(!res.destroyed){const match=/^Meta API エラー \((401|403|429)\)$/.exec(error?.message||'');const message=match?.[1]==='429'?'Metaの利用制限を確認してください。':match?'Metaの認証または利用権限を確認してください。':'Museとの通信または回答を確認できません。';return json(res,502,{code:'consultation_failed',error:message})}
  }
  return;
}
if(url.pathname.startsWith('/api/')){
  if(req.method!=='POST')return json(res,405,{error:'Method not allowed'});
  if(req.headers.origin!==`http://127.0.0.1:${req.socket.localPort}`)return json(res,403,{error:'Origin not allowed'});
  if(!active)return json(res,503,{error:'Muse接続は無効です'});
  const controller=new AbortController();res.on('close',()=>{if(!res.writableFinished)controller.abort()});
  let data;try{data=await readJson(req)}catch{if(!res.destroyed)return json(res,400,{error:'入力を読み取れません。'});return}
  if(!data||typeof data!=='object'||Array.isArray(data))return json(res,400,{error:'入力が不正です。'});
  const route=url.pathname;
  if(route==='/api/plan'){
    if(typeof data.command!=='string'||data.command.length>500||typeof data.image!=='string'||!data.image.startsWith('data:image/png;base64,')||(data.samCount!==undefined&&(!Number.isInteger(data.samCount)||data.samCount<0||data.samCount>10000)))return json(res,400,{error:'作戦の入力が不正です。'});
  }else if(route==='/api/review'){
    if(Object.keys(data).length!==1||!Array.isArray(data.ids)||!data.ids.length||data.ids.length>Object.keys(CHECK_LABELS).length||new Set(data.ids).size!==data.ids.length||data.ids.some(id=>!Object.hasOwn(CHECK_LABELS,id)))return json(res,400,{error:'確認項目の入力が不正です。'});
  }else if(route==='/api/segment'){
    if(typeof data.image!=='string'||!data.image.startsWith('data:image/png;base64,'))return json(res,400,{error:'画像の入力が不正です。'});
  }else if(route==='/api/transcribe'){
    if(typeof data.wav!=='string'||data.wav.length>5_000_000)return json(res,400,{error:'音声の入力が不正です。'});
  }else return json(res,404,{error:'Not found'});
  try{
    let result;
    if(route==='/api/plan'){
      const streaming=req.headers.accept==='application/x-ndjson';
      if(streaming)res.writeHead(200,{'Content-Type':'application/x-ndjson; charset=utf-8','Cache-Control':'no-store'});
      result=await plan({key,image:data.image,command:data.command,hazard:data.hazard===true,samCount:data.samCount,signal:controller.signal,onSora:streaming?text=>res.write(JSON.stringify({type:'sora',text})+'\n'):undefined});
      if(streaming){res.end(JSON.stringify({type:'result',result})+'\n');return}
    }else if(route==='/api/review')result=await review({key,ids:data.ids,signal:controller.signal});
    else if(route==='/api/segment')result=await segment({key,image:data.image,signal:controller.signal});
    else result=await transcribe({key,wav:Buffer.from(data.wav,'base64'),signal:controller.signal});
    return json(res,200,{result});
  }catch(error){
    if(res.destroyed)return;
    const message=museFailureMessage(error);
    if(res.headersSent){res.end(JSON.stringify({type:'error',error:message})+'\n');return}
    return json(res,502,{error:message});
  }
}
const entry=files.get(url.pathname)||cesiumEntry(url.pathname);if(!entry){res.writeHead(404);res.end('Not found');return}try{const data=await readFile(path.join(root,entry[0]));res.writeHead(200,{'Content-Type':entry[1],'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(data)}catch{res.writeHead(500);res.end('Server error')}})}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) createServer().listen(port,'127.0.0.1',()=>console.log(`Muse Disaster Mission: http://127.0.0.1:${port}`));
