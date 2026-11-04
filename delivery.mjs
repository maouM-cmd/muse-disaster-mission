import {routeSampleReport} from './geo-data.mjs';
export function secondFlightTarget(phase,start,end){return phase==='outbound'?end:phase==='returning'?start:null}
export function virtualAircraftApproach(from,to,other,limit=30){
  const values=[from?.x,from?.y,from?.z,to?.x,to?.y,to?.z,other?.x,other?.y,other?.z,limit];
  if(!values.every(Number.isFinite)||limit<=0)return true;
  const dx=to.x-from.x,dy=to.y-from.y,dz=to.z-from.z,length=dx*dx+dy*dy+dz*dz;
  const t=length?Math.max(0,Math.min(1,((other.x-from.x)*dx+(other.y-from.y)*dy+(other.z-from.z)*dz)/length)):0;
  return Math.hypot(from.x+dx*t-other.x,from.y+dy*t-other.y,from.z+dz*t-other.z)<=limit;
}
export function withHiddenOverlay(overlay,read){
  if(!overlay)return read();
  const previous=overlay.show;overlay.show=false;
  try{return read()}finally{overlay.show=previous}
}
// Heights are shared with the shelter roof and rendered cargo in the 3D scene.
export function deliveryPose(state,progress=0){
  const p=state==='complete'?1:state==='landing'?Math.max(0,Math.min(1,progress)):0;
  return {parcelY:4.3-2.6*p,attached:state!=='complete'};
}
// Zero can be the ellipsoid globe rather than a measured/modelled surface.
export function validMapSurface(height){return Number.isFinite(height)&&height>.5&&height<=168}
const pendingSamples=new WeakMap();
async function waitForSample(sample,{signal,timeoutMs=15000,isModelAvailable}={}){
  signal?.throwIfAborted();let timer,abort;
  const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('時間内に建物モデルの点検が完了しませんでした。前の取得が終わるまで再点検は待機します。改善しない場合は保存を確認して画面を再読み込みしてください。')),timeoutMs)});
  const cancelled=new Promise((_,reject)=>{if(signal){abort=()=>reject(new DOMException('中止しました','AbortError'));signal.addEventListener('abort',abort,{once:true})}});
  const sampling=Promise.resolve().then(()=>{signal?.throwIfAborted();return sample()});
  try{const value=await Promise.race([sampling,deadline,cancelled]);signal?.throwIfAborted();if(isModelAvailable&&!isModelAvailable())throw new Error('建物データを取得できません');return value}
  catch(error){if(error&&(typeof error==='object'||typeof error==='function'))pendingSamples.set(error,sampling);throw error}
  finally{clearTimeout(timer);if(abort)signal.removeEventListener('abort',abort)}
}
export async function readMapSurface(sample,options){const height=await waitForSample(sample,options);if(!validMapSurface(height))throw new Error('施設付近のモデル表面が不明です');return height}
export async function readRouteSamples(sample,expected,options){
  const values=await waitForSample(sample,options);if(!Array.isArray(values)||!Number.isInteger(expected)||values.length!==expected)throw new Error('地図モデルの確認結果の形式が不正です');
  return values.map(value=>Number.isFinite(value)?value:null);
}
export async function inspectDepartureSamples(sample,expected,options){
  const report=routeSampleReport(await readRouteSamples(sample,expected,options));
  return {report,decision:report.blockedIndices.length?'blocked':report.observed&&report.unknown===0?'proceed':'unavailable'};
}
export function interruptForBuildingFailure(run,cancelFrame){
  const phase={preflight:'preflight-unavailable',direct:'direct-unavailable',detour:'detour-unavailable','surface-check':'surface-unavailable',delivery:'surface-unavailable'}[run?.phase];
  if(!phase)return null;
  run.phase=phase;cancelFrame();run.probeController?.abort();run.surfaceController?.abort();return phase;
}
export function invalidateRouteInspection(run,removeMarker){
  if(!run?.probes||run.probes.stale||run.phase!=='obstacle')return false;
  const previous=run.probes;
  for(const marker of run.probeMarkers)removeMarker(marker);
  const blocked=side=>[...(previous[side]?.blockedIndices||[])];
  const A=blocked('A'),B=blocked('B');
  run.probeMarkers=[];run.probes=A.length||B.length?{stale:true,A:{blockedIndices:A},B:{blockedIndices:B}}:null;return true;
}
export function mapDeliveryPose(surface,progress,cruiseHeight=180){
  if(!validMapSurface(surface)||!Number.isFinite(progress)||!Number.isFinite(cruiseHeight)||cruiseHeight<surface+12||cruiseHeight>400)throw new Error('地図の表面を確認できません');
  const p=Math.max(0,Math.min(1,progress)),descent=Math.min(1,p/.4),lower=Math.max(0,(p-.4)/.6);
  const droneHeight=cruiseHeight+(surface+8-cruiseHeight)*descent,startParcel=droneHeight-1.15,parcelHeight=startParcel+(surface+.275-startParcel)*lower;
  return {droneHeight,parcelHeight,cargoOffset:parcelHeight-droneHeight,cableLength:Math.max(.05,droneHeight-.27-(parcelHeight+.275))};
}
export function secondDroneMotion(elapsed){
  if(!Number.isFinite(elapsed)||elapsed<0)throw new Error('経過時間が不正です');
  if(elapsed<2500)return {phase:'waiting',progress:0};
  if(elapsed<14500)return {phase:'outbound',progress:(elapsed-2500)/12000};
  if(elapsed<22500)return {phase:'delivery',progress:(elapsed-14500)/8000};
  if(elapsed<26500)return {phase:'ascent',progress:(elapsed-22500)/4000};
  if(elapsed<38500)return {phase:'returning',progress:(elapsed-26500)/12000};
  return {phase:'home',progress:1};
}
export function mapPartHeight(part,pose){
  if(!pose)return part.offset[2];
  if(part.kind.startsWith('cargo'))return pose.cargoOffset+(part.offset[2]+1.15);
  if(part.kind==='cable')return (-.27+pose.cargoOffset+.275)/2;
  return part.offset[2];
}

export function createSamplingQueue({waitMs=25000}={}){
  let tail=Promise.resolve();
  return {async run(task,{signal}={}){
    const previous=tail;let release;tail=new Promise(resolve=>{release=resolve});
    let timer=null,abortReject=null;
    const onAbort=()=>{if(abortReject){const error=new Error('中止しました');error.name='AbortError';abortReject(error)}};
    const abortError=()=>{const error=new Error('中止しました');error.name='AbortError';return error};
    try{
      if(signal?.aborted)throw abortError();
      await Promise.race([previous.catch(()=>{}),
        new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('他の点検の待機が長引いたため中止しました。前の取得が終わっていない可能性があります。改善しない場合は保存を確認して画面を再読み込みしてください。')),waitMs)}),
        ...(signal?[new Promise((_,reject)=>{abortReject=reject;signal.addEventListener('abort',onAbort,{once:true})})]:[])]);
      if(signal?.aborted)throw abortError();
      const value=await task();
      release();
      return value;
    }catch(error){
      const pending=error&&(typeof error==='object'||typeof error==='function')?pendingSamples.get(error):null;
      Promise.allSettled(pending?[previous,pending]:[previous]).then(release);
      throw error;
    }finally{if(timer!==null)clearTimeout(timer);signal?.removeEventListener?.('abort',onAbort)}
  }}
}
