import {areaByCode,officialMapLinks,riverPilotStations,decodeRiverLog,riverLogState,floodBulletinStationContext,parseZonedTimestamp} from './geo-data.mjs';
import {decodeInfrastructureReports,infrastructureReportState,infrastructureReportChanges,validateConsultInfrastructureReports} from './infrastructure-reports.mjs';
import {parseScenarioDepths} from './gsi-scenario.mjs';
// Retrieval age is only a prompt to recheck, not a validity period for a bulletin.
export function bulletinRetrievalAge(fetchedAt,now=Date.now()){
  const time=parseZonedTimestamp(fetchedAt);
  if(time===null||!Number.isFinite(now))return 'unknown';
  if(time>now+300000)return 'clock';
  return now-time>=7200000?'old':'recent';
}
// Presentation only: this never chooses a route or alters aircraft state.
export function fleetPresentation(data={}) {
  const s=data.summary||{};
  const count=key=>Number.isInteger(s[key])&&s[key]>=0?s[key]:0;
  const moving=count('outbound')+count('returning');
  const spare=data.cargo?.manifest?.spare;
  const counts=[`移動中 ${moving}機`,`相談待ち ${count('holding')}機`,`停止 ${count('stopped')}機`];
  for(const [key,label] of [['checking','点検中'],['waiting','出発待ち'],['delivery','荷下ろし中'],['complete','帰還済み']])if(count(key))counts.push(`${label} ${count(key)}機`);
  if(Number.isInteger(spare)&&spare>=0)counts.push(`予備 ${spare}機`);
  const phase=data.error?'error':data.phase||'checking';
  const states={
    checking:[0,'出発前の建物モデルを点検中'], flight:[1,'仮想配送中'],
    inspection:[2,data.comparison?.attempt===2?'別の仮想経路を作り直して点検中':'仮想障害を共有し、候補を点検中'], consulting:[3,data.comparison?.attempt===2?'別の経路について再相談中':'相談の回答待ち'],
    approval:[4,'別施設への変更は承認待ち'], rechecking:[4,'選択された仮想案を再点検中'],
    detour:[5,'再点検を通った仮想案で移動中'],
    stopped:[5,data.active?'一部の機体が停止・他の機体は継続中':count('complete')?'仮想配送を終了・停止した機体あり':'仮想配送を停止'],
    complete:[5,count('stopped')?'配送を終了・停止した機体あり':'仮想配送と帰還を終了'],
    error:[0,'仮想配送を開始できません'],
  };
  const [step,status]=states[phase]||states.checking;
  return {step,status,counts:counts.join('　'),stopped:phase==='stopped'||phase==='error'||(phase==='complete'&&count('stopped')>0)};
}
export const CHECK_LABELS=Object.freeze({
  buildings:'建物データの取得状況が未確認',
  shelters:'施設一覧の取得状況が未確認',
  risk:'洪水想定図の一部を確認できません',
  weather:'気象情報の最新性を確認できません',
  flood:'現在の浸水状況は未確認',
  obstacles:'電線などの障害物は未確認',
  airspace:'飛行規制・飛行許可は未確認',
  shelter_open:'施設の開設・受入状況は未確認',
  communications:'機体・通信の状態は未確認',
});
export const MAP_CHECK_IDS=Object.freeze(['flood','obstacles','airspace','shelter_open','communications']);
export const FLOOD_DEPTHS=Object.freeze(['0.5m未満','0.5〜3.0m','3.0〜5.0m','5.0〜10.0m','10.0〜20.0m','20.0m以上']);
export function createFacilityFloodTracker({read,onChange}){
  let key=null,controller=null;
  return {select(point,{force=false}={}){
    const valid=typeof point?.name==='string'&&typeof point?.address==='string'&&Number.isFinite(point?.latitude)&&Number.isFinite(point?.longitude);
    const next=valid?JSON.stringify([point.name,point.address,point.latitude,point.longitude]):null;
    if(!force&&next===key)return;
    controller?.abort();controller=null;key=next;
    if(!valid){onChange(null);return}
    const selected={name:point.name,address:point.address,latitude:point.latitude,longitude:point.longitude},current=new AbortController();controller=current;
    onChange({...selected,state:'loading'});
    Promise.resolve().then(()=>current.signal.aborted?null:read(selected,current.signal)).then(depth=>{
      if(controller!==current||current.signal.aborted)return;
      onChange({...selected,state:FLOOD_DEPTHS.includes(depth)?'ready':'unknown',depth:FLOOD_DEPTHS.includes(depth)?depth:null});
    }).catch(()=>{if(controller===current&&!current.signal.aborted)onChange({...selected,state:'error'})});
  }};
}
export function mapMissionSteps(phase){
  const step={preflight:0,'preflight-blocked':0,'preflight-unavailable':0,direct:0,'direct-unavailable':0,obstacle:1,detour:2,'detour-unavailable':2,'surface-check':3,delivery:3,'surface-unavailable':3,complete:4}[phase]??-1;
  return [0,1,2,3].map(i=>i<step?'done':i===step?(['surface-unavailable','preflight-blocked','preflight-unavailable','direct-unavailable','detour-unavailable'].includes(phase)?'blocked':'current'):'pending');
}
export function mapMissionDistance(metres){
  if(!Number.isFinite(metres)||metres<0)return '—';
  return metres>=1000?`約 ${(metres/1000).toFixed(2)} km`:`約 ${Math.round(metres)} m`;
}
export function mapRouteSummary(reports,side,busy=false){
  if(busy)return '点検中';
  const r=reports?.[side],blocked=r?.blockedIndices;
  const valid=['A','B'].includes(side)&&!reports?.stale&&Number.isInteger(r?.total)&&r.total>0&&r.total<=49&&Number.isInteger(r.observed)&&r.observed>=0&&Number.isInteger(r.unknown)&&r.unknown>=0&&r.observed+r.unknown===r.total&&Array.isArray(blocked)&&new Set(blocked).size===blocked.length&&blocked.length<=r.observed&&blocked.every(index=>Number.isInteger(index)&&index>=0&&index<r.total)&&Number.isFinite(r.maxGap)&&r.maxGap>=0;
  return valid?`取得${r.observed}/${r.total}点・不明${r.unknown}点・高い表面${blocked.length}点・最大間隔 約${Math.ceil(r.maxGap)}m`:'点検結果を利用できません';
}
export function fleetPosition(phase,metres,total){
  if(!['outbound','delivery','ascent','returning','home'].includes(phase)||!Number.isFinite(metres)||metres<0||!Number.isFinite(total)||total<=0)return null;
  return {target:['returning','home'].includes(phase)?'出発地点':'配送先',distance:mapMissionDistance(metres),progress:Math.round(100*Math.max(0,Math.min(1,1-metres/total)))};
}
export function mapMissionEvidence(departure,route){
  const valid=report=>Number.isInteger(report?.total)&&report.total>0&&report.total<=49&&Number.isInteger(report.unknown)&&report.unknown>=0&&report.unknown<=report.total;
  const parts=[];
  if(valid(departure))parts.push(`出発 ${departure.total}点・不明${departure.unknown}点`);
  if(valid(route)&&['A','B'].includes(route.side)&&['Muse','fixture','unknown','manual'].includes(route.source))parts.push(`${route.side}案 ${route.total}点・不明${route.unknown}点（${detourSourceText(route.source,route.provenance)}）`);
  return parts.length?`点検時：${parts.join('／')}。点と点の間・電線は未確認。`:'';
}
export function fleetStatus(result){
  if(!result)return '';
  const labels={checking:'経路と施設を点検中',waiting:'出発待ち',outbound:'配送中',delivery:'仮想荷下ろし中',ascent:'上昇中',returning:'帰還中',home:'荷下ろし後に仮想帰還',stopped:'中止',unavailable:'待機'};
  const label=labels[result.phase]||'状態不明',name=result.name?` → ${result.name}`:'';
  const note=result.message?`（${result.message}）`:'';
  const r=result.report,report=Number.isInteger(r?.total)&&Number.isInteger(r?.unknown)?`／点検${r.total}点・不明${r.unknown}点`:'';
  return `2号機${name}：${label}${note}${report}`;
}
export function mapFloodContext(result,shelter,address){
  return shelter&&address&&result?.shelter===shelter&&result?.address===address&&result?.state==='ready'&&FLOOD_DEPTHS.includes(result.depth)?result.depth:null;
}
export function mapFloodInputValid(value){return value===undefined||value===null||FLOOD_DEPTHS.includes(value)}
export function mapConsultInputValid(supply,quantity){return (supply===null||['water','food','blanket','hygiene'].includes(supply))&&(quantity===null||Number.isInteger(quantity)&&quantity>=1&&quantity<=10000)}
export function validateConsultObservation(value,now=null,{historical=false}={}){
 if(!value||Array.isArray(value))return false;
 const keys=Object.keys(value).sort().join(','),base=['distanceMeters','observedAt','rain','retrievedAt','stationId','wind'],allowed=[];
 for(const ref of [false,true])for(const totals of [false,true])allowed.push([...base,...(ref?['referenceKind']:[]),...(totals?['rain1h','rain24h']:[])].sort().join(','));
 if(!allowed.includes(keys)||(Object.hasOwn(value,'referenceKind')&&!['model_center','facility'].includes(value.referenceKind))||typeof value.stationId!=='string'||!/^\d{1,10}$/.test(value.stationId)||!Number.isInteger(value.distanceMeters)||value.distanceMeters<0||value.distanceMeters>30000)return false;
 const timestamp=x=>typeof x==='string'&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString()===x;
 const measured=x=>x===null||typeof x==='number'&&Number.isFinite(x)&&x>=0;
 if(!timestamp(value.observedAt)||!timestamp(value.retrievedAt)||!measured(value.rain)||!measured(value.wind)||(Object.hasOwn(value,'rain1h')&&(!measured(value.rain1h)||!measured(value.rain24h)))||[value.rain,value.wind,value.rain1h??null,value.rain24h??null].every(item=>item===null))return false;
 if(!historical&&(Date.parse(value.observedAt)>Date.parse(value.retrievedAt)||(now!==null&&Date.parse(value.retrievedAt)>now)))return false;
 if(now!==null){const age=now-Date.parse(value.observedAt),fetchAge=now-Date.parse(value.retrievedAt);if(!Number.isFinite(now)||age< -300000||age>1800000||fetchAge< -300000)return false}
 return true;
}
export function mapObservationContext(observation,area,now=Date.now(),{includeReferenceKind=false,includeAccumulatedRain=false}={}){
 if(!observation||typeof area!=='string'||!/^\d{5}$/.test(area)||observation.area!==area||!Number.isFinite(observation.distance)||observation.distance<0||observation.distance>30000)return null;
 const value={stationId:observation.stationId,distanceMeters:Math.round(observation.distance),observedAt:observation.observedAt,retrievedAt:observation.retrievedAt,rain:observation.rain,wind:observation.wind};if(includeReferenceKind)value.referenceKind=observation.referenceKind;if(includeAccumulatedRain){value.rain1h=observation.rain1h??null;value.rain24h=observation.rain24h??null}return validateConsultObservation(value,now)?value:null;
}
export function describeMapConsult(result){
  const views={dense:'建物が密集して見えます。',sparse:'建物がまばらに見えます。',unclear:'画像から建物の密度を判断できません。'};
  if(!result||!Object.hasOwn(views,result.density))throw new Error('画像の観察結果が不正です');
  const ordered=result.ordered_ids;
  if(!Array.isArray(ordered)||ordered.length!==MAP_CHECK_IDS.length||new Set(ordered).size!==MAP_CHECK_IDS.length||ordered.some(id=>!MAP_CHECK_IDS.includes(id)))throw new Error('確認項目の順序が不正です');
  return {sora:views[result.density],nagi:ordered.map(id=>CHECK_LABELS[id])};
}
// No map-only condition proves the safety of an actual delivery flight.
export function assessReadiness(evidence={}){
  const ids=[];
  if(evidence.buildings!=='available')ids.push('buildings');
  if(evidence.shelters!=='available')ids.push('shelters');
  if(evidence.risk!=='reference')ids.push('risk');
  if(evidence.weather!=='current')ids.push('weather');
  ids.push('flood','obstacles','airspace','shelter_open','communications');
  return {state:'判断不可',ids,reasons:ids.map(id=>CHECK_LABELS[id])};
}
export function sourceNotice(ids){
  if(!Array.isArray(ids))return 'データの取得状態を確認できません。';
  const sources=[['buildings','建物'],['shelters','施設'],['risk','洪水想定図'],['weather','気象']].filter(([id])=>ids.includes(id)).map(([,name])=>name);
  return sources.length?`取得中・取得状況や鮮度が未確認：${sources.join('・')}`:'';
}
export function sourceOverview(evidence={},riskShown=true){
  const item=(id,label,states)=>({id,label,value:states[evidence?.[id]]||'未確認',state:evidence?.[id]||'unknown'});
  const rows=[
    item('buildings','3D建物',{loading:'取得中',available:'モデル表示中',error:'一部または全体を取得できず'}),
    item('shelters','施設一覧',{loading:'取得中',available:'一覧を取得',error:'取得できず'}),
    item('weather','気象庁・大雨情報',{loading:'取得中',current:'発表を取得',stale:'発表が古い',error:'取得できず'}),
    item('risk','洪水想定図',{reference:'重ね表示・範囲未確認',error:'取得失敗の履歴あり'})
  ];
  if(!riskShown)rows[3].value=evidence?.risk==='error'?'非表示・取得失敗の履歴あり':'非表示';
  return rows;
}
export function labelsForOrder(ids,order){
  if(!Array.isArray(ids)||!ids.length||new Set(ids).size!==ids.length||ids.some(id=>!Object.hasOwn(CHECK_LABELS,id))||!Array.isArray(order)||order.length!==ids.length||new Set(order).size!==ids.length||order.some(id=>!ids.includes(id)))throw new Error('確認項目の順序が不正です');
  return order.map(id=>CHECK_LABELS[id]);
}

const SUPPLIES=Object.freeze({water:'飲料水',food:'食料',blanket:'毛布',hygiene:'衛生用品'});
export function mapConsultHistoryContext({area='',shelter='',address='',time='',payload={}}={}){
  const supply=Object.hasOwn(SUPPLIES,payload.supply)?SUPPLIES[payload.supply]:'';
  return {area,shelter,address,time,supply,quantity:payload.quantity??null,flood:payload.flood??null,floodSent:Object.hasOwn(payload,'flood')};
}
export function suggestShelters(value,shelters){
  if(typeof value!=='string'||!value.trim()||value.length>500||!Array.isArray(shelters))return [];
  const normalize=s=>s.normalize('NFKC').replace(/\s+/gu,'');
  const text=normalize(value);if(/ではなく|じゃなく|ではない|じゃない|以外|除く|取り消|キャンセル|届けない|運ばない/.test(text)||/\b(?:not|never|except|cancel|don't|do not)\b/i.test(value))return [];
  const hits=[];
  const aliases={'原中学校':'harajuniorhighschool','ゆいの森あらかわ':'yuinomoriarakawa'};
  shelters.forEach((s,index)=>{if(typeof s?.name!=='string')return;const alias=aliases[s.name];if(alias&&text.toLowerCase().includes(alias))hits.push({index,start:text.toLowerCase().indexOf(alias),end:text.toLowerCase().indexOf(alias)+alias.length});const name=normalize(s.name);if(name.length<3)return;let start=text.indexOf(name);while(start!==-1){hits.push({index,start,end:start+name.length});start=text.indexOf(name,start+1)}});
  const visible=hits.filter(hit=>!hits.some(other=>other.start<=hit.start&&other.end>=hit.end&&other.end-other.start>hit.end-hit.start));
  return [...new Set(visible.map(hit=>hit.index))].sort((a,b)=>a-b);
}
export function suggestRequest(value){
  if(typeof value!=='string'||!value.trim()||value.length>500)return null;
  const text=value.normalize('NFKC');
  if(/不要|いらない|いりません|要ら|ではなく|じゃなく|取り消|キャンセル|届けない|運ばない|[0-9一二三四五六七八九十]\s*(?:[〜~\-−]|から)\s*[0-9一二三四五六七八九十]/.test(text)||/\b(?:not|never|except|cancel|don't|do not|no)\b/i.test(text))return null;
  const kinds=[['water',/飲料水|ミネラルウォーター|(?<![\p{Script=Han}])水(?=を|が|は|と|[、,\s\d]|$)|\bwater\b/iu],['food',/食料|食糧|食べ物|\bfood\b/i],['blanket',/毛布|\bblankets?\b/i],['hygiene',/衛生用品|\bhygiene(?: supplies)?\b/i]].filter(([,pattern])=>pattern.test(text));
  const wordNumbers={one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12,thirteen:13,fourteen:14,fifteen:15,sixteen:16,seventeen:17,eighteen:18,nineteen:19,twenty:20};
  const counts=[...text.matchAll(/(?<![\d一二三四五六七八九十.,+\-−])([0-9]+|[一二三四五六七八九十]+)\s*箱/g),...text.matchAll(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\s+box(?:es)?\b/gi)];
  if(kinds.length!==1||counts.length!==1)return null;
  const raw=counts[0][1],digits='一二三四五六七八九';let quantity;
  if(Object.hasOwn(wordNumbers,raw.toLowerCase()))quantity=wordNumbers[raw.toLowerCase()];
  else if(/^\d+$/.test(raw))quantity=Number(raw);
  else if(digits.includes(raw))quantity=digits.indexOf(raw)+1;
  else{const match=raw.match(/^([一二三四五六七八九])?十([一二三四五六七八九])?$/);quantity=match?((match[1]?digits.indexOf(match[1])+1:1)*10+(match[2]?digits.indexOf(match[2])+1:0)):NaN}
  if(!Number.isSafeInteger(quantity)||quantity<1||quantity>10000)return null;
  return {supply:kinds[0][0],label:SUPPLIES[kinds[0][0]],quantity};
}
export function requestDraft({area='',shelter='',supply='',quantity=''}={}){
  const validCount=typeof quantity==='string'&&/^[1-9]\d{0,4}$/.test(quantity)&&Number(quantity)<=10000;
  const areaName=typeof area==='string'?area.trim():'';
  const destination=typeof shelter==='string'?shelter.trim():'';
  const item=Object.hasOwn(SUPPLIES,supply)?SUPPLIES[supply]:'';
  return {complete:!!(areaName&&destination&&item&&validCount),status:'下書き・未送信',flight:'判断不可',area:areaName,destination,supply:item,quantity:validCount?Number(quantity):null};
}
export function simulationManifest(input={}){
  const draft=requestDraft(input);
  return draft.complete?{destination:draft.destination,supply:draft.supply,requested:draft.quantity,boxes:1}:{destination:'',supply:'',requested:null,boxes:1};
}
export function createBrief({created,area='',shelter='',address='',supply='',quantity='',request='',ids=[],buildings='',risk='',shelters='',weather='',observation='',origin='',distance='',fetched='',facilityFlood=null}={}){
  if(typeof created!=='string'||!Number.isFinite(Date.parse(created)))throw new Error('作成時刻が不正です');
  const draft=requestDraft({area,shelter,supply,quantity});
  const clean=value=>typeof value==='string'&&value.trim()?value.trim().replace(/[\r\n]+/g,' / ').slice(0,500):'未確認';
  const valid=Array.isArray(ids)&&ids.length>0&&ids.every(id=>Object.hasOwn(CHECK_LABELS,id));
  const required=['flood','obstacles','airspace','shelter_open','communications'];
  const checks=[...new Set([...(valid?ids:[]),...required])].map(id=>`・${CHECK_LABELS[id]}`).join('\n');
  const sameFacility=!!shelter&&!!address&&facilityFlood?.shelter===shelter&&facilityFlood?.address===address;
  let floodNote='未確認';
  if(sameFacility&&facilityFlood.state==='loading')floodNote='確認中';
  else if(sameFacility&&Number.isFinite(Date.parse(facilityFlood.checkedAt))){
    if(facilityFlood.state==='ready'&&FLOOD_DEPTHS.includes(facilityFlood.depth))floodNote=`着色から ${facilityFlood.depth}（想定最大規模・取得 ${facilityFlood.checkedAt}）`;
    else if(['unknown','error'].includes(facilityFlood.state))floodNote=`判別できず（確認 ${facilityFlood.checkedAt}）`;
  }
  return [
    'MUSE MISSION 連絡用メモ（試作）',
    `作成時刻（UTC）：${created}`,
    '下書き・未送信。依頼は送信されていません。実配送の判断：判断不可。これは飛行許可や安全の証明ではありません。',
    '情報は作成時点の記録です。実際の活動前に発表元と現地で最新情報を確認してください。',
    '',`地域：${draft.area||'未選択'}`,`施設候補：${draft.destination||'施設未選択'}（開設・受入は未確認）`,`施設住所（公開情報）：${clean(address)}`,
    `物資：${draft.supply||'物資未選択'} ${draft.quantity===null?'数量未入力':`${draft.quantity}箱`}`,
    `依頼文（入力内容）：${clean(request)}`,`出発候補：${clean(origin)}`,`距離：${clean(distance)}`,
    '', '【未確認事項】',valid?'':'確認項目を取得できていません。',checks,
    '', '【作成時に画面に表示されたデータ】',`取得操作：${clean(fetched)}`,`建物：${clean(buildings)}`,`洪水想定：${clean(risk)}`,`施設座標の洪水想定：${floodNote}`,`施設：${clean(shelters)}`,`気象庁発表：${clean(weather)}`,`近隣観測：${clean(observation)}`,
    '', '施設の洪水想定は公開座標の1地点の着色から読み取った参考値です。位置の誤差・未着色・未提供があり、現在の浸水や施設全体を示しません。データ更新時期は未確認です。',
    '洪水図は想定であり現在の浸水ではありません。観測所の値は飛行地点や上空を示しません。',
    '出典：国土地理院・国土交通省 PLATEAU・ハザードマップポータル・気象庁',
    'https://www.gsi.go.jp/bousaichiri/hinanbasho.html',
    'https://www.mlit.go.jp/plateau/',
    'https://disaportal.gsi.go.jp/hazardmapportal/hazardmap/copyright/opendata.html',
    'https://www.jma.go.jp/bosai/amedas/',
    ''
  ].filter((line,index,array)=>line!==''||index===0||array[index-1]!=='').join('\n');
}
export function createMapScan({capture,current,request,onStatus,onBoxes}){
  let version=0,controller=null,hasResult=false;
  function invalidate(){
    if(!controller&&!hasResult)return;
    version++;controller?.abort();controller=null;hasResult=false;onBoxes([],false);onStatus('地図の画面が変わったため、前の結果を消しました。',false);
  }
  async function run(){
    if(controller)return;
    const id=++version;controller=new AbortController();const active=controller;hasResult=false;onBoxes([],false);
    try{
      onStatus('地図の画像をMetaのSAMに送信して確認中です。',true);
      const frame=capture(),boxes=await request(frame.image,active.signal);
      if(id!==version)return;
      if(!current(frame.view)){invalidate();return}
      if(!Array.isArray(boxes)||boxes.length>1000||boxes.some(b=>!b||!['x1','y1','x2','y2','w','h'].every(k=>Number.isFinite(b[k]))||b.w<=0||b.h<=0||b.x1<0||b.y1<0||b.x1>=b.x2||b.y1>=b.y2||b.x2>b.w||b.y2>b.h))throw new Error('認識結果の座標が不正です');
      controller=null;hasResult=true;onBoxes(boxes,true);
      onStatus(boxes.length?`SAMの候補 ${boxes.length}件。誤検出・見逃しがあり、電線の存在や飛行の安全は確定できません。`:'SAMは画像から電線を検出できませんでした。電線がないことを意味しません。',false);
    }catch(error){if(id===version){controller=null;hasResult=false;onBoxes([],false);onStatus(`SAMの確認に失敗：${error.message}`,false)}}
  }
  return {run,invalidate};
}
export function createMapConsultation({capture,current,request,onStatus,onResult}){
  let version=0,controller=null,hasResult=false;
  function invalidate(){
    if(!controller&&!hasResult)return;
    version++;controller?.abort();controller=null;hasResult=false;onResult(null,undefined,{code:'interrupted'});onStatus('地図や依頼が変わったため、前の相談結果を消しました。',false);
  }
  async function run(){
    if(controller)return;
    const id=++version;controller=new AbortController();const active=controller;hasResult=false;onResult(null);
    try{
      onStatus('地図画像を送信して相談しています。',true);
      const frame=capture(),result=await request(frame.image,active.signal);
      if(id!==version)return;
      if(!current(frame.view)){invalidate();return}
      const descriptions=describeMapConsult(result);controller=null;hasResult=true;onResult(descriptions,result);onStatus('画像の印象と確認順の提案です。飛行の安全や許可は判断していません。',false);
    }catch(error){if(id===version){controller=null;hasResult=false;const code=['input_rejected','observation_changed_before_send','information_changed_before_send'].includes(error?.code)?error.code:'consultation_failed';onResult(null,undefined,{code});onStatus(code==='input_rejected'?`サーバーが入力を受け付けませんでした：${error.message}`:code==='observation_changed_before_send'?'送信前に観測情報が変わったため、相談を中止しました。もう一度確認してください。':code==='information_changed_before_send'?'送信前に情報が変わったため、相談を中止しました。もう一度確認してください。':`相談に失敗：${error.message}`,false,code)}}
  }
  return {run,invalidate};
}

// 2機の点検共有とMuse自動判断のための純粋関数。安全の判断はしない。
// 保存した過去の結果は参考であり、安全を意味しない。
export function detourEvidencePayload(reports){
  if(!reports||reports.stale)return null;
  const side=r=>Number.isInteger(r?.total)&&r.total>0&&r.total<=49&&Number.isInteger(r?.observed)&&r.observed>=0&&Number.isInteger(r?.unknown)&&r.unknown>=0&&r.observed+r.unknown===r.total&&Array.isArray(r?.blockedIndices)&&new Set(r.blockedIndices).size===r.blockedIndices.length&&r.blockedIndices.every(i=>Number.isInteger(i)&&i>=0&&i<r.total)&&Number.isFinite(r?.maxGap)&&r.maxGap>=0&&r.maxGap<=20000
    ?{total:r.total,observed:r.observed,unknown:r.unknown,blocked:r.blockedIndices.length,maxGap:Math.ceil(r.maxGap)}:null;
  const A=side(reports.A),B=side(reports.B);
  return A&&B?{A,B}:null;
}
export function summarizeDetourValidation(validation){
  if(validation?.state==='accepted')return '採用可能と判定（点検条件を満たしました。実際の飛行の安全性は未確認です）';
  if(validation?.state==='rejected')return '不採用と判定（点検地点の不足、障害候補、または点検間隔により採用できません）';
  if(validation?.state==='stopped')return '停止と判定（相談の回答は候補なし）';
  return '判定不明';
}
export function createDetourReinspection(side,report,at){
  if(!['A','B'].includes(side)||!report||Array.isArray(report)||typeof report!=='object'||!Array.isArray(report.blockedIndices))throw new Error('再点検の記録が不正です');
  const {total,observed,unknown,blockedIndices,maxGap}=report;
  if(!Number.isInteger(total)||total<1||total>49||!Number.isInteger(observed)||observed<0||!Number.isInteger(unknown)||unknown<0||observed+unknown!==total||new Set(blockedIndices).size!==blockedIndices.length||blockedIndices.length>observed||blockedIndices.some(i=>!Number.isInteger(i)||i<0||i>=total)||!Number.isFinite(maxGap)||maxGap<0||maxGap>20000)throw new Error('再点検の記録が不正です');
  if(typeof at!=='string'||!Number.isFinite(Date.parse(at))||new Date(at).toISOString()!==at)throw new Error('再点検の記録時刻が不正です');
  return {side,at,total,observed,unknown,blocked:blockedIndices.length,maxGap};
}
function validDetourReinspection(value,side,flight){
  if(!value||Array.isArray(value)||typeof value!=='object'||Object.keys(value).sort().join(',')!=='at,blocked,maxGap,observed,side,total,unknown'||flight!=='one'||value.side!==side)return false;
  const {total,observed,unknown,blocked,maxGap,at}=value;
  return ['A','B'].includes(side)&&Number.isInteger(total)&&total>0&&total<=49&&Number.isInteger(observed)&&observed>=0&&Number.isInteger(unknown)&&unknown>=0&&observed+unknown===total&&Number.isInteger(blocked)&&blocked>=0&&blocked<=observed&&Number.isFinite(maxGap)&&maxGap>=0&&maxGap<=20000&&typeof at==='string'&&Number.isFinite(Date.parse(at))&&new Date(at).toISOString()===at;
}
export function detourTeamRecord({at='',area='',side='',state='',reason='',source='',provenance,flight='one',evidence=null,reinspection,facility=null,origin=null,inspectedAt=null,fetchedAt=null,sources=null,shares=null}={}){
  if(typeof at!=='string'||!at||typeof area!=='string'||!area)throw new Error('記録時刻または地域が不正です');
  if(!['A','B','none'].includes(side))throw new Error('候補が不正です');
  if(!['accepted','rejected','stopped'].includes(state))throw new Error('判定が不正です');
  if(typeof reason!=='string'||!reason)throw new Error('理由が不正です');
  if(!['Muse','fixture','unknown','manual','auto'].includes(source))throw new Error('選択元が不正です');
  if(provenance!==undefined&&(!['muse','fixture','unknown'].includes(provenance)||!['Muse','fixture','unknown'].includes(source)))throw new Error('回答の出所が不正です');
  if((source==='fixture'&&provenance!=='fixture')||(source==='unknown'&&provenance!=='unknown'))throw new Error('回答の出所が不正です');
  if(!['one','two'].includes(flight))throw new Error('便の指定が不正です');
  if(flight==='two'&&side!=='none')throw new Error('2号機の記録に迂回案は指定できません');
  if(evidence!==undefined&&evidence!==null&&(typeof evidence!=='object'||Array.isArray(evidence)))throw new Error('根拠が不正です');
  if(reinspection!==undefined&&!validDetourReinspection(reinspection,side,flight))throw new Error('再点検の記録が不正です');
  if(facility!==undefined&&facility!==null){
    if(typeof facility!=='object'||Array.isArray(facility)||typeof facility.name!=='string'||!facility.name.trim())throw new Error('配送先が不正です');
    if(facility.address!==undefined&&typeof facility.address!=='string')throw new Error('配送先が不正です');
    for(const key of Object.keys(facility))if(key!=='name'&&key!=='address')throw new Error('配送先に保存できない項目があります');
  }
  if(origin!==undefined&&origin!==null){
    if(typeof origin!=='object'||Array.isArray(origin)||!Number.isFinite(origin.latitude)||!Number.isFinite(origin.longitude)||Math.abs(origin.latitude)>90||Math.abs(origin.longitude)>180)throw new Error('出発地点が不正です');
  }
  for(const stamp of [inspectedAt,fetchedAt])if(stamp!==undefined&&stamp!==null&&(typeof stamp!=='string'||!stamp))throw new Error('時刻が不正です');
  if(sources!==undefined&&sources!==null){
    if(typeof sources!=='object'||Array.isArray(sources))throw new Error('データ種別が不正です');
    for(const value of Object.values(sources))if(value!==null&&typeof value!=='string'&&typeof value!=='number'&&typeof value!=='boolean')throw new Error('データ種別が不正です');
  }
  let shareList=null;
  if(shares!==undefined&&shares!==null){
    if(!Array.isArray(shares))throw new Error('共有記録が不正です');
    shareList=shares.map(entry=>{if(!entry||typeof entry!=='object'||typeof entry.at!=='string'||!entry.at||typeof entry.text!=='string'||!entry.text)throw new Error('共有記録が不正です');return {at:entry.at,text:entry.text}});
  }
  return {at,area,side,state,reason,source,...(provenance===undefined?{}:{provenance}),flight,evidence:evidence??null,...(reinspection===undefined?{}:{reinspection:{...reinspection}}),
    facility:facility==null?null:{name:facility.name,...(typeof facility.address==='string'?{address:facility.address}:{})},
    origin:origin==null?null:{latitude:origin.latitude,longitude:origin.longitude},
    inspectedAt:inspectedAt??null,fetchedAt:fetchedAt??null,
    sources:sources==null?null:{...sources},shares:shareList};
}
export function detourStateText(record){
  const r=detourTeamRecord(record);
  if(r.flight==='two'&&r.state==='accepted')return '2号機の仮想便が終了';
  if(r.flight==='two'&&r.state==='stopped')return '2号機の仮想便を中止';
  if(r.flight==='two')return '2号機の仮想便は不採用';
  if(r.source==='manual'&&r.state==='stopped')return '手動で終了';
  if(r.source==='manual'&&r.state==='accepted')return '手動選択した仮想便の再生が終了';
  if(r.state==='stopped'&&r.side!=='none')return '停止';
  return summarizeDetourValidation(r);
}
export function detourSourceText(source,provenance){
  return source==='fixture'?'試験用の回答':source==='unknown'?'回答の出所は不明':source==='Muse'?(provenance==='muse'?'Museの回答（サーバーの申告）':provenance==='fixture'?'試験用の回答':'回答の出所は不明'):source==='auto'?'自動判断':'手動選択';
}
export function detourEvidenceText(evidence,consultation=true){
  if(!evidence||typeof evidence!=='object')return '';
  const side=s=>{const r=evidence[s];return r&&Number.isInteger(r.total)?`${s}案${r.total}点・取得${r.observed}・不明${r.unknown}・高${r.blocked}・間隔${r.maxGap}m`:''};
  const parts=[side('A'),side('B')].filter(Boolean);
  return parts.length?`（${consultation?'相談時の点検数値':'時点の区別がない点検数値'}：${parts.join('／')}）`:'';
}
export function detourSourcesText(sources){
  if(!sources||typeof sources!=='object')return '';
  const modes={detailed:'詳細優先',highest:'高精細優先',simple:'簡易'};
  const parts=[];
  if(typeof sources.mode==='string'&&sources.mode)parts.push(`建物モデル${modes[sources.mode]||sources.mode}`);
  for(const [key,label] of [['buildings','建物'],['shelters','避難場所'],['weather','気象'],['risk','想定']])if(typeof sources[key]==='string'&&sources[key])parts.push(`${label}${sources[key]}`);
  return parts.length?`データ種別：${parts.join('・')}`:'';
}
export function detourContextText(r){
  const parts=[];
  if(r.facility&&r.facility.name)parts.push(`${r.flight==='two'?'2号機':'1号機'}の配送先：${r.facility.name}（公開施設）`);
  if(r.origin)parts.push(`出発地点：${r.origin.latitude.toFixed(5)}, ${r.origin.longitude.toFixed(5)}（この端末内に保存）`);
  if(r.fetchedAt)parts.push(`取得開始：${r.fetchedAt}`);
  if(r.inspectedAt)parts.push(`点検時刻：${r.inspectedAt}`);
  if(r.reinspection){const q=r.reinspection;parts.push(`再点検：仮想案${q.side} ${q.total}点・取得${q.observed}・不明${q.unknown}・高い表面${q.blocked}・最大間隔${q.maxGap}m（端末の記録時刻：${q.at}）`)}
  else if(r.flight==='one'&&r.side!=='none')parts.push('再点検の数値は記録なし');
  const kinds=detourSourcesText(r.sources);
  if(kinds)parts.push(kinds);
  if(r.shares&&r.shares.length)parts.push(`機体間の共有${r.shares.length}件（最新：${r.shares[0].text}）`);
  return parts.length?`${parts.join('。')}。`:'';
}
export function detourRecordText(record){
  const r=detourTeamRecord(record);
  const what=r.flight==='two'?'':r.side==='none'?'候補なし':`仮想案${r.side} `;
  return `${r.at} ${r.area} — ${what}${detourStateText(r)}。${detourContextText(r)}理由：${r.reason}${detourEvidenceText(r.evidence,['Muse','fixture','unknown'].includes(r.source))}（${detourSourceText(r.source,r.provenance)}）`;
}
export function pastDetourNote(record,area){
  if(!record||record.area!==area)return '';
  let r;
  try{r=detourTeamRecord(record)}catch{return ''}
  const what=r.flight==='two'?'':r.side==='none'?'候補なし':`仮想案${r.side} `;
  return `前回（${r.at}）の結果は${what}${detourStateText(r)}${['Muse','fixture','unknown'].includes(r.source)?`（${detourSourceText(r.source,r.provenance)}）`:''}。${detourContextText(r)}理由：${r.reason}${detourEvidenceText(r.evidence,['Muse','fixture','unknown'].includes(r.source))}。参考記録であり、安全を意味しません。`;
}

export function reinspectVerdict(report){
  if(!report||!Number.isInteger(report.total)||report.total<1||!Number.isInteger(report.observed)||report.observed<0||!Number.isInteger(report.unknown)||report.unknown<0||!Number.isFinite(report.maxGap)||report.maxGap<0)return {ok:false,reason:'再点検の結果が不正です'};
  const blocked=Array.isArray(report.blockedIndices)?report.blockedIndices.length:(Number.isInteger(report.blocked)?report.blocked:-1);
  if(blocked<0)return {ok:false,reason:'再点検の結果が不正です'};
  if(blocked>0)return {ok:false,reason:`再点検で${blocked}点に仮想高度付近以上の表面を検出`};
  if(!report.observed)return {ok:false,reason:'再点検で高さを取得できず'};
  if(report.unknown>0)return {ok:false,reason:`再点検で${report.unknown}点の高さが不明（道路・空地・未取得の区別不可。同じデータの再点検では解消しない場合があり、多くの実地図ルートが停止し得る）`};
  if(report.observed!==report.total)return {ok:false,reason:'再点検の結果が不正です'};
  if(report.maxGap>29)return {ok:false,reason:`再点検の最大間隔が約${Math.ceil(report.maxGap)}mで基準（29m以内）を超えた`};
  return {ok:true,reason:'再点検で採用可能を確認'};
}

function hazardDistanceToSegmentM(hazard,start,end){
  const valid=p=>Number.isFinite(p?.latitude)&&Number.isFinite(p?.longitude)&&Math.abs(p.latitude)<=90&&Math.abs(p.longitude)<=180;
  if(!valid(hazard)||!valid(start)||!valid(end))return null;
  const mid=(start.latitude+end.latitude)/2*Math.PI/180,scale=Math.cos(mid),R=6371000,rad=Math.PI/180;
  const ax=0,ay=0,bx=(end.longitude-start.longitude)*scale*rad*R,by=(end.latitude-start.latitude)*rad*R;
  const px=(hazard.longitude-start.longitude)*scale*rad*R,py=(hazard.latitude-start.latitude)*rad*R;
  const len2=bx*bx+by*by;
  const s=len2?Math.max(0,Math.min(1,(px*bx+py*by)/len2)):0;
  return Math.hypot(px-bx*s,py-by*s);
}
export function detourRelevanceForSecond(hazards,start,end,limitM=300){
  if(!Array.isArray(hazards)||!hazards.length)return {near:false,count:0,nearestM:null};
  if(!Number.isFinite(limitM)||limitM<=0)return {near:false,count:hazards.length,nearestM:null};
  let nearest=Infinity;
  for(const hazard of hazards){
    const d=hazardDistanceToSegmentM(hazard,start,end);
    if(d!==null&&d<nearest)nearest=d;
  }
  if(!Number.isFinite(nearest))return {near:false,count:hazards.length,nearestM:null};
  return {near:nearest<=limitM,count:hazards.length,nearestM:Math.round(nearest)};
}

export function hazardNearPointsM(hazards,points,limitM=300){
  if(!Array.isArray(hazards)||!hazards.length||!Array.isArray(points)||!points.length)return {near:false,count:Array.isArray(hazards)?hazards.length:0,nearestM:null};
  if(!Number.isFinite(limitM)||limitM<=0)return {near:false,count:hazards.length,nearestM:null};
  const valid=p=>Number.isFinite(p?.latitude)&&Number.isFinite(p?.longitude)&&Math.abs(p.latitude)<=90&&Math.abs(p.longitude)<=180;
  const R=6371000,rad=Math.PI/180;
  let nearest=Infinity;
  for(const hazard of hazards){
    if(!valid(hazard))continue;
    const lat0=hazard.latitude*Math.PI/180,cos=Math.cos(lat0);
    for(const q of points){
      if(!valid(q))continue;
      const d=Math.hypot((q.longitude-hazard.longitude)*cos*rad*R,(q.latitude-hazard.latitude)*rad*R);
      if(d<nearest)nearest=d;
    }
  }
  if(!Number.isFinite(nearest))return {near:false,count:hazards.length,nearestM:null};
  return {near:nearest<=limitM,count:hazards.length,nearestM:Math.round(nearest)};
}

export function lod2LightStatus({requested=false,applied=null,target=null,buildings='idle',flightActive=false,hasMap=false}={}){
  if(!hasMap)return {toggleDisabled:true,applyDisabled:true,text:''};
  if(target==='other')return {toggleDisabled:true,applyDisabled:true,text:'対象外：詳細優先モードでLOD2データがある地域のみ有効'};
  if(buildings==='loading')return {toggleDisabled:false,applyDisabled:true,text:'読み込み中のため反映できません'};
  if(flightActive)return {toggleDisabled:false,applyDisabled:true,text:'仮想便の飛行中は反映できません'};
  if(target===null)return {toggleDisabled:false,applyDisabled:true,text:'未確認：建物データを読み込んでいません'};
  if(applied===true&&requested)return {toggleDisabled:false,applyDisabled:true,text:`適用中：LOD2の周囲光0.6（人工的な明るさで実際の天候を示さない）。選択と一致のため反映は不要です${buildings==='error'?'（一部の建物タイルを取得できず）':''}`};
  if(applied===true&&buildings==='error')return {toggleDisabled:false,applyDisabled:true,text:'未適用の選択あり（OFF）：適用済みの部分が残っています。「この地域の情報を再取得」から復旧できます（一部の建物タイルを取得できず）'};
  if(applied===true)return {toggleDisabled:false,applyDisabled:false,text:'未適用の選択あり（OFF）：反映ボタンで現在地域を再取得'};
  if(buildings==='error')return {toggleDisabled:false,applyDisabled:true,text:'失敗：建物データを読み込めなかったため適用できません'};
  if(requested)return {toggleDisabled:false,applyDisabled:false,text:'未適用の選択あり：反映ボタンで現在地域を再取得'};
  return {toggleDisabled:false,applyDisabled:true,text:'通常表示（周囲光なし）'};
}

const viewRotIdx=[0,1,2,4,5,6,8,9,10],viewPosIdx=[12,13,14];
// どちらも浮動小数点の計算誤差のみ吸収する。実測(Cesium 1.146):逆行列の往復で向き1.1e-16・位置4.7e-10、
// 等価な経路差で位置2.8e-9、64ulpの入力揺らぎで位置7.2e-8。1e-4radの実回転は向き8.2e-5のため拒否される。
// 相談中のm単位の見かけのずれは許容差で吸わず、相談前の位置固定で解消する。
const viewRotEps=1e-5,viewPosEps=1e-6;
export function isViewFrameCurrent(sent,now){
  try{
    if(Number(sent?.width)!==Number(now?.width)||Number(sent?.height)!==Number(now?.height))return false;
    const a=Array.from({length:16},(_,i)=>Number(sent?.matrix?.[i])),b=Array.from({length:16},(_,i)=>Number(now?.matrix?.[i]));
    if(a.some(v=>!Number.isFinite(v))||b.some(v=>!Number.isFinite(v)))return false;
    for(let i=0;i<16;i++){const eps=viewPosIdx.includes(i)?viewPosEps:viewRotEps;if(Math.abs(a[i]-b[i])>eps)return false}
    return true;
  }catch{return false}
}
export function describeViewFrameChange(sent,now){
  try{
    const sW=Number(sent?.width),sH=Number(sent?.height),nW=Number(now?.width),nH=Number(now?.height);
    const size=`送信時${sW}x${sH}→応答時${nW}x${nH}`,sizeNote=sW===nW&&sH===nH?'（画面サイズ一致）':'（画面サイズ不一致）';
    const a=Array.from({length:16},(_,i)=>Number(sent?.matrix?.[i])),b=Array.from({length:16},(_,i)=>Number(now?.matrix?.[i]));
    if(a.some(v=>!Number.isFinite(v))||b.some(v=>!Number.isFinite(v)))return `${size}${sizeNote}・カメラ差分は比較できず`;
    const diffs=[];for(let i=0;i<16;i++)if(a[i]!==b[i])diffs.push({i,d:b[i]-a[i]});
    if(!diffs.length)return `${size}${sizeNote}・カメラ一致`;
    let maxRot=0,maxPos=0;for(const {i,d} of diffs){const ad=Math.abs(d);if(viewPosIdx.includes(i))maxPos=Math.max(maxPos,ad);else maxRot=Math.max(maxRot,ad)}
    const parts=diffs.slice(0,6).map(({i,d})=>`[${i}]差${viewFrameNum(d)}`);
    return `${size}${sizeNote}・カメラ差分${diffs.length}件（最大差 向き${maxRot}・位置${maxPos}、例 ${parts.join('、')}）`;
  }catch{return '画面の差分を比較できず'}
}
function viewFrameNum(v){return Number.isFinite(v)?String(Number(v.toPrecision(6))):'?'}

// Presentation translations only. Mission state, coordinates and Muse replies stay unchanged.
export function resolveInterfaceLanguage(value){return typeof value==='string'&&/^en(?:-|$)/i.test(value)?'en':'ja'}
export function decisionCardView(data,language='ja'){
  const en=resolveInterfaceLanguage(language)==='en',c=data?.comparison;
  if(!c)return null;
  const choose=v=>v==='A'||v==='B'?`${en?'Route':'案'} ${v}`:v==='none'?(en?'No candidate':'候補なし'):(en?'Not available':'未確認');
  const scenario=c.scenario==='withhold-a'?(c.scenarioWithheld?(en?' Case B: one observed A sample is deliberately withheld; not an actual data failure.':' ケースB：案Aの確認済み1点を仮想的に伏せています。実際の取得失敗ではありません。'):(en?' Case B selected; no sample was withheld.':' ケースBを選択。伏せた点はありません。')):'';
  const input=(c.input?(en?`Consultation attempted with map image, simulated obstacle and inspection results${c.input.distanceIncluded?'; distance included':'; distance not sent'}.`:`地図画像・仮想障害・点検結果で相談を試行（${c.input.distanceIncluded?'距離を含む':'距離は送信対象外'}）。`):(en?'Not yet sent for consultation.':'相談への送信前、または送信なし。'))+scenario;
  const previousAttempt=!c.reply&&Array.isArray(c.previousAttempts)?[...c.previousAttempts].reverse().find(attempt=>attempt?.reply?.nagi):null,previous=previousAttempt?.reply||null;
  const shown=c.reply||previous;
  const provenance=(previous?previousAttempt?.input:c.input)?.provenance,source=provenance==='muse'?'Muse':provenance==='fixture'?(en?'Test response':'試験用の回答'):(en?'Unverified response source':'回答の出所は不明');
  const reply=c.error?(en?`Consultation failed: ${c.error}${previous?` / Previous ${source}: ${choose(previous.nagi.choice)} — ${previous.nagi.reason}`:''}`:`相談に失敗：${c.error}${previous?` ／ 前回の${source}：${choose(previous.nagi.choice)} — ${previous.nagi.reason}`:''}`):shown?.nagi?(en?`${source} (Japanese original): ${previous?'Previous attempt; new consultation pending. ':''}${choose(shown.nagi.choice)} — ${shown.nagi.reason}`:`${source}：${previous?'前回の回答・再相談中。':''}${choose(shown.nagi.choice)} — ${shown.nagi.reason}`):(en?'Awaiting consultation response.':'相談の回答待ち。');
  const elapsed=Number.isFinite(c.reply?.elapsedMs)?`${(c.reply.elapsedMs/1000).toFixed(1)}s`:(en?'not measured':'未計測');
  const baselineTime=Number.isFinite(c.baseline?.elapsedMs)?c.baseline.elapsedMs.toFixed(2):(en?'unknown':'不明');
  const baseline=c.baseline?(en?`Current attempt rule: ${choose(c.baseline.choice)} (prefer A; then B; otherwise none). Computation ${baselineTime} ms.${c.baseline.choice==='B'?' B would require approval and rechecking.':''}${previous?' Previous response used different candidates.':''}${c.input&&!c.input.distanceIncluded?' The consultation omitted distance, so inputs differ.':''}`:`今回の定型案：${choose(c.baseline.choice)}（A優先、次にB、両方不可なら候補なし）。計算 ${baselineTime} ms。${c.baseline.choice==='B'?'B案は承認と再点検が必要です。':''}${previous?'前回の回答とは候補が異なります。':''}${c.input&&!c.input.distanceIncluded?'相談の入力に距離が含まれず、条件は完全には同一ではありません。':''}`):(en?'Rule: waiting for inspection results.':'定型案：点検結果待ち。');
  let verdict;
  if(data.pendingDiversion)verdict=en?'App: destination change awaits your approval.':'アプリ：別施設への変更は承認待ち。';
  else if(c.verdict?.state==='stopped'||data.phase==='stopped'||data.phase==='error')verdict=en?'App: affected drones stopped; see the recorded reason.':'アプリ：影響機は停止。記録した理由を確認。';
  else if(c.verdict?.state==='approved')verdict=en?`App: ${choose(c.verdict.side)} passed the simulated recheck.`:`アプリ：${choose(c.verdict.side)}は仮想再点検の条件を通過。`;
  else if(data.phase==='rechecking')verdict=en?'App: rechecking the selected simulated route.':'アプリ：選択案を再点検中。';
  else verdict=en?'App: no route has been approved yet.':'アプリ：まだ経路は採用していません。';
  const report=side=>{const r=c.evidence?.candidates?.[side],d=c.evidence?.distances?.[side];if(!r)return en?`${side}: not inspected`:`${side}：未点検`;return en?`${side}: ${r.observed}/${r.total} sampled, ${r.unknown} unknown, ${r.blocked} blocked; round trip ${Number.isFinite(d?.representative?.totalM)?d.representative.totalM+' m':'unknown'}`:`${side}：${r.observed}/${r.total}点・不明${r.unknown}・遮断${r.blocked}、代表往復 ${Number.isFinite(d?.representative?.totalM)?d.representative.totalM+'m':'不明'}`};
  const received=c.reply?.receivedAt||null;
  return {input,reply,baseline,verdict,checks:`${report('A')} / ${report('B')}`,time:en?`${source} consultation (including capture and network): ${elapsed}. Response: ${received||'not received'}. Source is reported by the local server, not independently verified. The rule uses inspection summaries and distance availability, not the image. It is a comparison only and does not move drones.`:`${source}の相談（撮影・通信を含む）：${elapsed}。回答：${received||'未受信'}。出所は作品サーバーの申告で、独立に検証したものではありません。定型案は点検集計と距離の有無を使い、画像を解析しません。比較用で機体を動かしません。`};
}
const UI_EN=Object.freeze({
  '定型案は点検数値を使います。Museに相談する場合は地図画像も送るため、入力は同一ではありません。判断は振り返り用で、仮想便を変更しません。':'The rule uses inspection numbers. When Muse is consulted it also receives a map image, so the inputs differ. Your review does not change the simulation.',
  '定型案は点検数値を使います。相談先には地図画像も送るため、入力は同一ではありません。回答の出所は記録をご確認ください。判断は振り返り用で、仮想便を変更しません。':'The rule uses inspection numbers. The consultation also receives a map image, so inputs differ. Check the recorded source of the response. Your review does not change the simulation.',
  '経路相談':'Route consultation','相談の提案':'Consultation proposal',
  '今回の送信内容と回答を見る':'Review the submitted information and response',
  '地図は現場のライブ映像ではありません。文章は相談の分類・確認順からアプリが作成し、安全や飛行許可を判断しません。':'The map is not live footage. The app creates text from the consultation classification and check order; it does not determine safety or flight authorization.',
  '相談に送信した地図画像':'Map image sent for consultation',
  '自分の振り返り':'Your review','相談の案を参考にする':'Use the consultation for discussion','定型案を参考にする':'Use the rule for discussion','どちらも保留する':'Hold both','判断できない':'Unable to decide',
  '理由（任意）':'Reason (optional)','指定しない':'Unspecified','情報不足':'Missing information','情報が古い':'Outdated information','情報の食い違い':'Conflicting information','追加確認が必要':'Further review needed','その他':'Other',
  'メモ（任意・200文字以内）':'Notes (optional, up to 200 characters)','氏名・連絡先は入力しないでください。記録は端末内に保存され、書き出しにも含まれます。':'Do not enter names or contact details. The record stays on this device and is included in exports.',
  '振り返りを保存':'Save review','入力を消して再確認':'Clear draft and review again',
  '情報の出典と時刻を一覧で見る':'Review sources and times',
  '水位・キキクル・施設のメモを複数画面で編集する場合、同じアドレスのすべての画面を最新版に再読み込みしてください。対応していないブラウザでは保存・削除できません。':'When editing water-level, Kikikuru or facility notes in multiple tabs, reload every tab at the same address. Saving and deletion are unavailable in unsupported browsers.',
  '記録の照合には、このブラウザ内の別の保存領域も使います。照合できない記録は上書きせず確認を求めます。':'A separate local browser store is also used to compare records. If they cannot be reconciled, the app will not overwrite them.',
  'キキクルを開き、確認メモを残す':'Open Kikikuru and record a review',
  '指定河川洪水予報（全国）':'Designated river flood forecasts (nationwide)',
  '気象庁の長期フィードに掲載された全国の電文を表示します。過去の発表を含み、訂正や取消と後続の情報を整理していません。選択地域や施設との対応は自動判定しません。発表の対象河川・区間と最新状況を公式情報で確認してください。一覧が空でも発表がないとは限りません。':'Shows nationwide bulletins from JMA’s long-term feed, including past announcements. Corrections, cancellations and later updates are not reconciled. The app does not determine applicability to the selected region or facility. Check the river, section and latest information with JMA. An empty list does not mean there are no bulletins.',
  '全国の掲載分を取得':'Fetch nationwide listings',
  '未取得です。':'Not retrieved.',
  '気象庁の指定河川洪水予報を開く ↗':'Open JMA river flood forecasts ↗',
  'フィードの提供条件 ↗':'Feed terms and limitations ↗',
  '予報区域と市区町村の照合は、':'Forecast-area matching uses ',
  '気象庁の2026年5月27日時点の対応表':'JMA’s correspondence table as of May 27, 2026',
  'を加工して使用します。2026年10月9日更新のExcelとは、区域・市区町村コードのみ照合しました。表の更新は自動確認せず、施設の浸水は判定しません。':' with local processing. Only area and municipality codes were compared with the workbook updated October 9, 2026. Updates are not checked automatically and facility flooding is not determined.',
  '気象庁の危険度分布は予測等に基づく情報です。現在の浸水の実測や飛行安全ではありません。':'JMA risk maps use observations and forecasts. They are not measurements of current flooding or proof of flight safety.',
  '気象庁の浸水キキクルを開く ↗':'Open JMA inundation risk map ↗',
  '気象庁の洪水キキクルを開く ↗':'Open JMA flood risk map ↗',
  '地域の代表点を含む地図を開きます。実際に見た地点や時刻は自動確認しません。公式画面で地点と情報の時刻を確認してください。':'The links open a map around a representative point. The app does not verify which location or time you actually viewed. Check both on the official page.',
  '確認した種類':'Product reviewed','見た表示（自己申告）':'Appearance seen (self-reported)','確認した日時':'Time reviewed',
  '浸水キキクル':'Inundation risk map','洪水キキクル':'Flood risk map','黄色':'Yellow','赤色':'Red','紫色':'Purple','黒色':'Black','その他の表示':'Another appearance','確認できなかった':'Could not verify',
  '確認メモを端末に保存':'Save review on this device','この地域の確認メモを削除':'Delete review notes for this area',
  '再確認の予定は情報が変わらないことを保証しません。':'A planned review does not guarantee that the information remains unchanged.',
  'これは本人の申告で、公式データの自動取得・検証ではありません。色がない、確認できない、古い記録は安全を意味しません。Museには送信しません。':'This is self-reported, not automatically retrieved or verified official data. No color, an unavailable view, or an old note does not mean safe. It is not sent to Muse.',
  '表示用のIDです。情報の種類、取得状態、時刻と出典を分けて表示します。この一覧は外部に送信されません。':'IDs identify items in this view. Information type, status, time and source are shown separately. This list is not sent externally.',
  '保存するファイルには施設名・報告の場所や確認先・日時などが含まれる場合があります。共有前に内容を確認してください。':'The file may include facility names, reported locations, sources and times. Review it before sharing.',
  '受領報告と対応の補足メモは一覧・ファイルに含みません。':'Free-text receipt and follow-up notes are omitted from the list and file.',
  '送信許可が不明な場合は画像を送信できません。':'Images cannot be sent while transfer permission is unknown.',
  '同じ仮想データでMuseと定型ルールを比較':'Compare Muse and a rule using the same simulated data',
  '3つの架空の候補を数値だけで比較します。開始すると3回Museに送信し、API利用料が発生する場合があります。地図画像や施設情報は送りません。仮想便の動きは変わりません。':'Compare three fictional cases using only numbers. Starting sends three requests to Muse and may incur API charges. No map image or facility information is sent. The simulated flights do not change.',
  '架空の3件または境界条件7件、もしくは現在の地域で保存した仮想配送1件を数値だけで比較します。開始すると3件は3回、7件は7回、1件は1回Museに相談し、API利用料がかかる場合があります。地図画像・施設名・住所は送りません。仮想便の動きは変わりません。':'Compare 3 fictional cases, 7 boundary cases, or one saved simulation using numbers only. Starting makes 3, 7 or 1 Muse requests respectively and may incur API charges. Map images, facility names and addresses are not sent. Simulated flights do not change.',
  '比較するデータ':'Data to compare','固定の架空ケース3件':'Three fixed fictional cases','境界条件の架空ケース7件（7回相談）':'7 fictional boundary cases (7 requests)','この地域の最新の仮想配送1件':'Latest saved simulation in this area',
  '両方に同じ数値を渡します。定型ルールは点検条件と距離の有無のみ使い、Museは全数値と文章の指示を受け取ります。少数例の比較であり、実際の救助効果は分かりません。':'Both receive the same structured numbers. The rule uses inspection conditions and distance availability; Muse also receives all numbers and written instructions. These few cases do not establish real rescue effectiveness.',
  '比較を開始':'Start comparison','比較を中止':'Cancel comparison','比較結果を保存':'Save comparison',
  '選択施設の人による現地報告もMetaへ送る（任意）':'Also send human field reports for the selected facility to Meta (optional)',
  '現地報告の送信対応を確認中です。':'Checking support for sending field reports.',
  '人の報告は未検証です。水が見えなかったとの報告は安全を意味しません。期限が切れた報告は送りません。':'Human reports are unverified. A report that water was not visible does not establish safety. Expired reports are not sent.',
  '選択施設の受け入れ報告もMetaへ送る（任意）':'Also send acceptance reports for the selected facility to Meta (optional)',
  'この地域の設備報告をMetaへ送る（任意）':'Also send infrastructure reports for this area to Meta (optional)',
  '設備報告の送信対応を確認中です。':'Checking support for sending infrastructure reports.',
  '場所や確認先の文章は設備報告として送らないため、報告と経路・施設の関係は不明です。地図画像には地点が映る場合があります。':'Location and source text are not sent as report data, so the relationship to routes and facilities is unknown. The map image may contain locations.',
  '相談を中止したり失敗したりしても、送信済みの情報を取り消せるとは限りません。':'Cancelling or failing a consultation does not guarantee that already-sent information can be withdrawn.',
  '施設報告の送信対応を確認中です。':'Checking support for sending facility reports.',
  '開いた洪水予報の電文もMetaへ送る（任意）':'Also send the opened flood bulletin to Meta (optional)',
  '送信できる電文を確認中です。':'Checking available flood bulletin.',
  '電文と選択施設の対応は未確認です。「現況」は電文の時点であり、現在の施設の浸水や飛行の安全ではありません。':'The relationship between the bulletin and selected facility is unverified. “Current” is the bulletin time, not current facility flooding or flight safety.',
  '施設または報告が変わったため送信の選択を解除しました。内容を確認し、送る場合は選び直してください。':'Facility or reports changed. Review the information and choose again if you want to send it.',
  '取得から2時間は送信の目安であり、公式の有効期限ではありません。後続の情報も公式サイトで確認してください。':'The two-hour sending limit is an app guideline, not an official expiry. Check the official site for later updates.',
  '施設の報告は未検証です。条件付きの具体的な条件文や連絡先は送らず、実際の受け入れは再確認が必要です。':'Facility reports are unverified. Conditional details and contact information are not sent. Actual acceptance must be checked again.',
  'この時点の一覧をファイルに保存':'Download this snapshot',
  '保存した情報の一覧を確認':'Review a saved information snapshot',
  '以前保存した想定・公開情報・人の報告を参考表示します。端末内で読み取り、Museや配送には使いません。':'View saved scenarios, public information and human reports as reference. The file stays on this device and is not used by Muse or deliveries.',
  '保存した一覧ファイルを選ぶ':'Choose a saved snapshot',
  '表示を消す':'Clear preview',
  '過去の水害写真を比較（2018年・真備町）':'Compare historical flood images (Mabi, 2018)',
  '2018年7月豪雨・岡山県倉敷市真備町周辺の過去の資料です。現在の浸水や、選択中の地域の状況ではありません。':'Historical material from the July 2018 floods around Mabi, Kurashiki, Okayama. It does not show current flooding or the selected region.',
  '真備町の写真を大きく見る':'Enlarge Mabi images',
  '2018年・真備町周辺の水害写真':'2018 flood imagery around Mabi',
  '2018年7月9日撮影／7月11日公開':'Captured July 9, 2018 / published July 11',
  '2018年7月11日撮影／7月13日公開':'Captured July 11, 2018 / published July 13',
  '2018年7月9日撮影、真備町周辺の国土地理院正射画像の一部':'Part of the GSI orthophoto around Mabi, captured July 9, 2018',
  '2018年7月11日撮影、真備町周辺の国土地理院正射画像の一部':'Part of the GSI orthophoto around Mabi, captured July 11, 2018',
  '写真は同じ地図タイルの範囲です。撮影の正確な時刻と元画像の解像度は未確認。雲・歪みや欠けた場所があり、空白は浸水がない証拠ではありません。':'The images cover the same map tile. Exact capture times and source resolution are unknown. Clouds, distortion and gaps may occur; blank areas do not establish an absence of flooding.',
  '撮影の正確な時刻と元画像の解像度は未確認。画像の歪み、雲、欠けた範囲があります。この写真はMuseへ自動送信しません。':'Exact capture times and source resolution are unknown. Images may contain distortion, clouds and gaps. They are not automatically sent to Muse.',
  '推定図は航空写真等を使って作成されており、写真から独立した正解データではありません。現地踏査はなく、把握できない範囲や誤差があります。':'The estimated flood map uses aerial images and other sources, so it is not independent ground truth for these photographs. No field survey was conducted; coverage and accuracy are limited.',
  '◎ 真備分署の概略位置。防災科学技術研究所の報告の座標を写真タイル上に重ねています。別の研究報告では、同分署の2018年7月20日撮影の写真に浸水痕跡412cmと記載されています。座標と痕跡位置の厳密な一致、画像の位置精度、写真撮影時の水位は未確認です。痕跡は現在の浸水を示しません。':'◎ Approximate Mabi fire station location, plotted from coordinates in a NIED report. Another study reports a 412 cm flood trace in a photograph of the station taken July 20, 2018. The exact match of coordinate and trace, image alignment, and water level at the image capture times are unverified. The trace does not show current flooding.',
  '防災科研：座標の出典 ↗':'NIED: coordinate source ↗',
  '研究報告：浸水痕跡 ↗':'Research report: flood trace ↗',
  '別の現地調査：2018年7月17日、国土技術研究センターが真備町の被災状況を調査しました。':'Separate field survey: on July 17, 2018, the Japan Institute of Country-ology and Engineering surveyed damage in Mabi.',
  '現地調査報告 ↗':'Field survey report ↗',
  '調査地点と写真タイル・撮影時刻の一致は未確認で、写真の正解とは扱えません。':'The survey sites have not been matched to the image tile or capture times; this is not ground truth for the images.',
  '国交省は2018年7月11日、真備町の宅地・生活道路の浸水が概ね解消したと発表しました。写真の地点・撮影時刻との一致は未確認です。':'On July 11, 2018, MLIT reported that flooding of residential land and local roads in Mabi had largely subsided. Its relation to these image locations and capture times is unverified.',
  '国交省の発表 ↗':'MLIT announcement ↗',
  '推定浸水範囲の変化 ↗':'Estimated flood extent over time ↗',
  '次に確認する予定の日時（任意）':'Next planned review time (optional)',
  '日時はこの端末の時刻です。確認予定は水位が変わらないことを保証しません。':'Times use this device’s time zone. A planned review does not guarantee that the water level remains unchanged.',
  '端末に記録':'Save on this device',
  '以前の水位メモを削除':'Delete previous water-level note',
  '新しい記録は観測所ごとに最大20件を保存し、異なる値も残します。個人情報は入力しません。':'Up to 20 new records per station are stored, including differing values. Do not enter personal information.',
  'この観測所の新しい記録を削除':'Delete new records for this station',
  '直線距離は目安です。河川の流れに沿った距離や、施設の浸水・安全を示すものではありません。':'Straight-line distance is approximate. It is not distance along the river and does not establish flooding or safety at the facility.',
  '机上演習':'Tabletop exercise',
  '施設の河川別の洪水想定を見る':'View river-specific flood scenarios at the facility',
  '選択した公開施設の座標を国土地理院の浸水ナビへ送り、河川ごとの想定最大規模の浸水深を照会します。現在の浸水ではなく、対象外や欠測もあります。結果はMuseや配送に自動で使いません。':'Sends the selected public facility coordinates to GSI Shinsui Navi to request river-specific maximum-scale flood scenarios. These are not current flooding; coverage and data may be incomplete. Results are not automatically used by Muse or the simulation.',
  '選択施設の想定を取得':'Retrieve scenario for selected facility',
  '国土地理院：浸水ナビ ↗':'GSI: Shinsui Navi ↗','想定の条件と対象河川 ↗':'Scenario conditions and covered rivers ↗',
  '観察した人の記録':'Observer’s notes',
  '参加者の自己申告とは別に記録します。本人や所属を識別する情報は入力しないでください。観察できなかった場合は不明を選んでください。':'This is separate from the participant’s self-report. Do not enter identifying information. Select unknown when you could not observe.',
  '何について':'Topic','観察した様子':'What was observed','言及を観察した':'Mention observed','言及を観察しなかった':'No mention observed','不明・観察できなかった':'Unknown or not observed',
  '負荷（参加者の自己申告）':'Workload (participant self-report)','聞いていない・不明':'Not asked or unknown','軽い':'Light','普通':'Moderate','重い':'High',
  '混乱した点などのメモ（任意・300文字以内）':'Notes on confusion or barriers (optional, up to 300 characters)',
  '言及を観察しなかったことは、気づかなかったことの証明ではありません。この端末に最大10件保存します。内容は本人確認されず、能力や安全性の判定ではありません。':'Not observing a mention does not prove the participant failed to notice. Up to 10 notes are saved on this device. The reporter is not verified; this is not an assessment of ability or safety.',
  '記録とメモを書き出せます。共有前に内容を確認してください。同じアドレスの他の画面も最新版に更新してください。':'Records and notes can be exported. Review before sharing. Refresh other tabs at the same address to the latest version.',
  '演習記録を書き出す':'Export exercise records',
  '演習の集計を見る':'View exercise summary',
  '集計を書き出す':'Export summary',
  '集計にメモや日時は含めません。件数が少ない場合は人が推測されることもあるため、共有前に確認してください。':'The summary excludes notes and timestamps. Small counts may still identify people; review before sharing.',
  '観察を保存':'Save observation','記入をやめる':'Cancel entry',
  '表示した訓練文・言語・時刻も端末に保存します。同じアドレスで開いている他の画面も最新版に更新してください。':'Displayed training text, language and time are also saved on this device. Refresh other tabs at the same address to the latest version.',
  '施設や通信の変化を、訓練用の情報で確認します。':'Explore changes in facility and communication status using training information.',
  '演習を開く':'Open exercise',
  '状況の変化を確認する':'Review a changing situation',
  'これは架空の訓練です。実際の施設・地図・配送には反映されず、回答の正誤や安全性を判定しません。':'This is a fictional exercise. It does not change real facilities, maps, or deliveries, or determine correctness or safety.',
  '演習を選ぶ':'Choose an exercise',
  '施設の受け入れ不可と通信断':'Facility refusal and lost communications',
  '食い違う報告と期限切れ':'Conflicting and expired reports',
  '演習を始める':'Start exercise',
  '状況の変化を見る':'See the update',
  '気づいた情報（自己申告・複数選択可）':'What did you notice? (self-reported; select all that apply)',
  '施設の受け入れ':'Facility acceptance',
  '通信の状態':'Communication status',
  '情報の期限':'Information expiry',
  '報告の食い違い':'Conflicting reports',
  '機体の状況':'Aircraft status',
  '次に取る行動（自己申告）':'Next action (self-reported)',
  '保留して情報を整理する':'Hold and review the information',
  '関係先への確認を想定する':'Plan to verify with relevant parties',
  '別案を検討する':'Consider an alternative',
  '振り返りメモ（任意・300文字以内）':'Reflection (optional, up to 300 characters)',
  'メモに個人名・連絡先を入れないでください。演習結果はこの端末に最大20件保存し、外部には送信しません。経過時間には中断時間も含まれます。':'Do not enter names or contact details. Up to 20 records are stored on this device and are not sent elsewhere. Elapsed time includes breaks.',
  '演習を記録':'Save exercise',
  'この端末の演習記録':'Exercise records on this device',
  '演習記録をすべて削除':'Delete all exercise records',
  "画像内の障害物候補":"Obstacle candidates in an image",
  "利用権限のある画像を選び、候補枠と元画像を比べられます。":"Choose an image you are authorised to use and compare candidate boxes with the source.",
  "画像を選んで確認":"Choose an image",
  "画像内の電線候補を確認":"Review possible wires in an image",
  "利用権限のある画像を選んでください。「SAMに送信」を押すと画像をMetaへ送信します。人や住所などが写っていないか確認してください。":"Choose an image you are authorised to use. Pressing Send to SAM sends it to Meta. Check for people, addresses and other sensitive content.",
  "候補枠は画像内の目安です。見逃し・誤検出があり、実際の位置・高さ・飛行の安全は分かりません。画像内以外は未確認です。":"Boxes are approximate image candidates. Misses and false detections occur; actual location, height, flight safety and areas outside the image are unknown.",
  "画像を選択（PNG・JPEG・WebP、10 MB以下）":"Choose an image (PNG, JPEG or WebP; 10 MB max)",
  "画像の種類（申告）":"Image type (self-reported)",
  "現地の画像":"Field image",
  "過去の画像":"Historical image",
  "訓練・仮想画像":"Training or simulated image",
  "撮影日時（任意）":"Capture time (optional)",
  "電柱・電線の情報源を調べる":"Review utility pole and wire information sources",
  "公開ページの調査結果（2026年11月4日確認）です。アプリは設備情報を取得していません。電線の位置・高さ・災害後の状態は不明です。":"Public sources reviewed on November 4, 2026. The app does not obtain infrastructure data. Wire position, height and post-disaster condition are unknown.",
  "荒川区の2025年PLATEAU目録では都市設備（frn）が列挙されていません。目録だけの確認で、実際に設備がないという意味ではありません。":"The 2025 Arakawa PLATEAU catalogue did not list city furniture (frn). This catalogue-only check does not mean that infrastructure is absent.",
  "東京電力：設備照会の案内 ↗":"TEPCO: infrastructure inquiry guidance ↗", "電柱位置検索サービス（有料） ↗":"Utility pole location search (paid) ↗", "NTT東日本：電柱・ケーブルの窓口 ↗":"NTT East: poles and cables ↗", "PLATEAUの電柱・電線の説明例 ↗":"PLATEAU pole and wire example ↗",
  "提供範囲・精度・更新・利用条件・災害時の変更・AI送信可否は管理者への確認が必要です。窓口の案内はデータ提供の約束ではありません。":"Confirm coverage, accuracy, updates, usage terms, disaster changes and AI submission with each infrastructure manager. A contact page does not promise data access.",
  "20件に達すると新しい記録は保存できません。以前の記録は自動削除しません。同じアドレスの他の画面も最新版に更新してください。":"At 20 records, new records cannot be saved. Older records are not deleted automatically. Reload other tabs at the same address to use the latest version.",
  "ファイルには地域コード・日時・物資・Museの回答が含まれます。共有時は内容に注意してください。":"The file contains the area code, date and time, supplies and Muse's response. Check its contents before sharing.", "相談記録をファイルに保存":"Download consultation records",
  "画像には地名や地点が含まれる場合があります。任意で保存し、共有に注意してください。":"The image may contain place names and locations. Saving it is optional; take care when sharing.",
  "送信画像を保存（任意）":"Save sent image (optional)",
  "未保存の記録はこの画面を閉じたり再読み込みすると失われます。ファイルには地域コード・日時・物資・Museの回答が含まれます。":"Unsaved records are lost when this page is closed or reloaded. The file includes the area code, time, supplies and Muse's response.",
  "この記録を再保存":"Retry saving this record", "未保存の記録をファイルに保存":"Download unsaved record", "未保存の記録を破棄":"Discard unsaved record",
  "相談ごとに、自分の判断を時刻付きで記録できます。本人・権限は確認しておらず、飛行の承認や安全確認ではありません。":"You can record your decision and its time for each consultation. Identity and authority are not verified, and this is not flight approval or a safety check.",
  "相談記録が未保存です":"Consultation record not saved", "確認する":"Review",
  "近隣の気象観測もMetaへ送る（任意）":"Also send nearby weather observations to Meta (optional)", "観測情報の送信対応を確認中です。":"Checking whether observation data can be sent.",
  "撮影位置・方向などを申告（任意）":"Report camera position and direction (optional)",
  "撮影者から確認できた場合のみ入力してください。数値や方向の正確さは検証しません。":"Enter only information confirmed with the photographer. Values and directions are not verified.",
  "撮影位置の緯度":"Camera latitude", "撮影位置の経度":"Camera longitude", "位置の誤差（m・任意）":"Position error (m, optional)",
  "撮影方向（概略）":"Camera direction (approximate)", "カメラの校正":"Camera calibration",
  "北":"North", "東":"East", "南":"South", "西":"West", "実施したとの申告":"Reported performed", "未実施との申告":"Reported not performed",
  "緯度と経度は両方を入力してください。位置は撮影地点の申告で、候補の位置ではありません。方向は画像の範囲や死角を示しません。":"Enter both latitude and longitude. This is a reported camera position, not the candidate's position. Direction does not establish image coverage or blind spots.",
  "撮影条件は利用者の申告で、Metaへ送らず、この画面を閉じると消えます。候補の実際の位置・高さ、画像外の範囲は未確認です。":"Capture conditions are self-reported, are not sent to Meta, and are cleared on closing. Candidate location and height and areas outside the image remain unconfirmed.",
  "視界・遮蔽（申告）":"Visibility / obstruction (self-reported)",
  "見えにくい条件を記録（任意）":"Record visibility limitations (optional)",
  "気づいた項目を選びます。選ばなかった項目や画像の外も確認済みにはなりません。":"Select limitations you notice. Unselected conditions and areas outside the image remain unverified.",
  "見えにくさの申告":"Self-reported visibility limitations", "建物や樹木の陰":"Blocked by buildings or trees", "細い線や遠方が見えにくい":"Thin wires or distant details hard to see", "逆光・暗さ・雨など":"Backlight, darkness or rain", "ぼけ・低解像度":"Blur or low resolution",
  "目立つ遮蔽なし":"No obvious obstruction",
  "遮蔽・悪天候・暗さあり":"Obstructed, poor weather or dark",
  "日時・種類・視界は利用者の申告で、Metaへ送らず、この画面を閉じると消えます。位置情報・撮影方向・画像外の範囲は未確認です。":"Time, type and visibility are self-reported, are not sent to Meta, and are cleared on closing. Location, camera direction and areas outside the image are unknown.",
  "SAMに送信":"Send to SAM",
  "画像と結果を消す":"Clear image and results",
  "画像を選択してください。":"Choose an image.",
  "送信する縮小画像":"Resized image to be sent",
  "同じ画像上のSAM候補枠":"SAM candidate boxes on the same image",
  "送信画像（縮小・写真の付加情報を除去）":"Sent image (resized; file metadata removed)",
  "候補枠（マスクや地図上の位置ではありません）":"Candidate boxes (not masks or mapped positions)",
  "画像を選択しました。送信前に内容と利用権限を確認してください。":"Image selected. Check content and permission before sending.",
  "画像をMetaへ送信し、SAMの候補を確認中です。":"Sending the image to Meta and checking SAM candidates.",
  "候補枠は返りませんでした。結果を確認できない場合もあります。電線がないことを意味しません。":"No candidate boxes were returned. The result may be unavailable; this does not mean there are no wires.",
  "画像を端末内で読み込み中です。まだ送信していません。":"Preparing the image on this device. It has not been sent.",
  "PNG・JPEG・WebPの10 MB以下の画像を選んでください。":"Choose a PNG, JPEG or WebP image under 10 MB.",
  "Metaの接続が利用できないため送信できません。画像は端末内にあります。":"Meta connection unavailable. The image remains on this device.",
  "撮影日時を確認してください。未来の日時では送信できません。":"Check the capture time. A future time cannot be submitted.",

  "閉じる":"Close",
  "正確な撮影時刻・元画像の解像度は未確認。範囲や雲等により見えない場所があります。この写真はMuseへ自動送信しません。":"Exact capture time and native resolution are unknown. Some areas may be obscured or outside coverage. These images are not automatically sent to Muse.",
  "常総地区・2015年9月11日午後の国土地理院の正射画像（一部）":"GSI orthoimage of part of Joso, 11 September 2015 afternoon",
  "常総地区・2015年9月15日午前の国土地理院の正射画像（一部）":"GSI orthoimage of part of Joso, 15 September 2015 morning",
  "常総地区・2015年9月11日の防災科研の航空写真地図（一部）、時間帯要確認":"NIED aerial photo map of part of Joso, 11 September 2015, time of day unconfirmed",
  "防災科研の地図には午後、別の資料案内には航空写真を午前とあります。対象画像の関係と撮影時刻は未確認です。以前の確認記録も見直してください。":"The NIED map says afternoon; another NIED page describes aerial photos as morning. The relationship between the images and their capture times is unconfirmed. Recheck earlier reviews.",
  "防災科研の写真地図の時間帯は資料の記載を照合中です。詳しくは拡大画面をご確認ください。":"The time of day for the NIED photo map is being checked against the sources. See the enlarged view for details.",
  "2015年9月11日・時間帯要確認":"11 September 2015, time of day unconfirmed",
  "防災科研の地図 ↗":"NIED map ↗",
  "防災科研の資料案内 ↗":"NIED data guide ↗",

  "写真を大きく見る":"View larger images",
  "2015年・常総地区の水害写真":"2015 flood images: Joso area",
  "過去の同じ範囲の写真です。現在選択中の地域や今の浸水状況ではありません。":"Historical imagery of the same map area. This is not the currently selected area or current flooding.",
  "正確な撮影時刻・元画像の解像度は未確認。範囲や雲等により見えない場所があります。":"Exact capture time and native image resolution are unknown. Some areas may be obscured or outside coverage.",
  "国土地理院の資料 ↗":"GSI source ↗",
  "画像の提供情報 ↗":"Imagery metadata ↗",

  "過去の水害写真を比較（2015年・常総）":"Compare historical flood images (Joso, 2015)",
  "過去の災害資料です。現在選択中の地域や今の浸水状況ではありません。同じ位置の画像を比較しますが、撮影範囲・画質・雲などの違いがあります。":"Historical disaster imagery, not the selected area or current flooding. Images cover the same map tile but differ in coverage, quality and cloud conditions.",
  "2015年9月11日 午後":"11 September 2015, afternoon",
  "2015年9月11日 午前":"11 September 2015, morning",
  "2015年9月15日 午前":"15 September 2015, morning",
  "国土地理院・常総地区（一部）":"GSI, Joso area (partial)",
  "防災科研・常総地区（一部）":"NIED, Joso area (partial)",
  "防災科研と国土地理院の写真は正確な撮影時刻・位置精度が未確認で、地図上で位置がずれる場合があります。画像比較は浸水の正解判定ではありません。":"The exact capture times and positional accuracy of the NIED and GSI images are unconfirmed; the images may be misaligned. Image comparison does not establish ground truth for flooding.",
  "防災科学技術研究所：写真・利用条件 ↗":"NIED: imagery and terms of use ↗",
  "未取得":"Not retrieved",
  "画像を取得（内容・範囲は要確認）":"Image loaded; inspect content and coverage",
  "画像を取得できません。出典から確認してください。":"Image unavailable. Check the source.",
  "画像は同一の地図タイル範囲です。撮影の正確な時刻と元画像の解像度は未確認。表示が空白でも被害や浸水がない証拠にはなりません。":"Images cover the same map tile. Exact capture time and native image resolution are unknown. A blank image does not prove absence of damage or flooding.",
  "国土地理院：災害資料・画像の出典 ↗":"GSI: disaster and imagery sources ↗",
  "9月11日13時の推定浸水範囲 ↗":"Estimated flood extent on 11 September at 13:00 ↗",
  "推定範囲は画像等から判読された参考資料で、把握できない範囲があります。画像の見た目との自動照合や正解判定はしていません。":"The estimated extent is interpreted from imagery and may omit areas. No automatic comparison or ground-truth determination is performed.",
  "別の調査：浸水痕跡の現地調査（後日の計測・最大浸水深の推定）。撮影時の水位や写真の正解を直接示すものではありません。":"Separate field surveys measured flood traces later and estimated maximum flood depth. They do not directly establish the water level when these photographs were taken or ground truth for the images.",
  "京都大学：現地調査と推定の第二報 ↗":"Kyoto University: field survey and second estimate ↗",
  "防災科研：常総市の現地調査 ↗":"NIED: Joso field surveys ↗",
  "写真範囲に近い別の現地調査を見る":"View another field survey near the image area",
  "地上写真と近くの航空写真を比べる":"Compare a ground photo with a nearby aerial image",
  "2015年9月11日の別の場所です。印は地上写真のEXIFから概算した撮影地点で、水の位置ではありません。地上写真の撮影方向・位置精度・時刻の時間帯と、航空写真の正確な時刻は不明です。画像の位置ずれや時刻差があり、同時・同じ対象を示す保証はありません。":"This is a different location on 11 September 2015. The marker is an approximate camera location from the ground image EXIF, not the location of water. The camera direction, position accuracy and time zone, and the exact aerial image time are unknown. Image alignment and capture times may differ; the images are not guaranteed to show the same scene at the same time.",
  "防災科学技術研究所：地上写真（カメラ記録 11:27:05、時間帯不明）":"NIED: ground photo (camera clock 11:27:05; time zone unknown)",
  "国土地理院：同日午後の航空写真（一部）":"GSI: aerial image from the same afternoon (excerpt)",
  "川が見えることは住宅地の浸水や安全の正解ではありません。画像の空白や欠けも安全を示しません。過去の参考資料であり、現在の浸水・飛行安全には使えません。画像をMuseへ自動送信しません。":"Visible river water does not establish residential flooding or safety. Blank or missing image areas do not establish safety. These historical references do not establish current flooding or flight safety. Images are not automatically sent to Muse.",
  "印：撮影地点の概算":"Marker: approximate camera location",
  "取得に失敗した画像を再取得":"Retry unavailable images",
  "画像は未取得です。":"Images not yet retrieved.",
  "防災科学技術研究所：写真と利用条件 ↗":"NIED: photo and terms of use ↗",
  "国土地理院：航空写真の資料 ↗":"GSI: aerial image source ↗",
  "2015年9月11日の地上写真。橋から川を望む。":"Ground photo from 11 September 2015: a river seen from a bridge.",
  "2015年9月11日午後の国土地理院航空写真の一部。印は撮影地点の概算。":"Excerpt of a GSI aerial image from the afternoon of 11 September 2015; the marker is the approximate camera location.",
  "防災科研の2015年9月19日の調査報告では、表2の67〜69番の緯度経度を地図タイルに概算すると、写真の範囲内です。測地系・地点の精度と写真の位置ずれは未確認です。後日の浸水痕跡であり、写真撮影時の浸水を示しません。資料の利用条件は写真とは別に確認してください。":"NIED's field survey of 19 September 2015 lists Table 2, points 67–69. Approximate placement of their coordinates falls within the photo tile. Datum, point accuracy, and image alignment are unverified. Later flood traces do not show flooding at the time of the photographs. Check this report's terms separately from the imagery.",
  "防災科研：2015年の現地調査報告（表2） ↗":"NIED: 2015 field survey report (Table 2) ↗",

  "洪水想定と現地報告を比べる":"Compare flood scenario and field reports",
  "洪水想定と現地報告":"Flood scenario and field reports",
  "洪水想定は将来の条件に基づく資料です。現地報告は人の入力で、実際に確認できた情報かアプリは検証しません。条件や日時が異なれば結果が違うこともあります。":"Flood scenarios describe hypothetical conditions. Field reports are entered by people and are not verified by the app. Results may differ with time or conditions.",
  "公開：洪水想定":"Public: flood scenario",
  "人の入力：現地報告":"Human input: field reports",
  "公開資料の出典 ↗":"Public data source ↗",
  "現地報告を追加する":"Add a field report",
  "受け取った報告をこの端末に保存します。施設・関係機関への送信や飛行判断には使いません。個人名や連絡先は入力しないでください。":"Save a received report on this device. It is not sent to facilities or authorities or used for flight decisions. Do not enter names or contact details.",
  "報告内容":"Reported information",
  "水が見えたという報告":"Water reported visible",
  "水が見えなかったという報告":"Water reported not visible",
  "状況を確認できないという報告":"Condition reported unknown",
  "報告の対象":"Reported scope",
  "選択施設の一点":"One point at the selected facility",
  "選択施設付近の道路":"Road near the selected facility",
  "対象範囲は不明":"Scope unknown",
  "報告された観察日時":"Reported observation time",
  "報告元の組織":"Reporting organisation",
  "対象や状況の補足":"Notes on scope or conditions",
  "同じ施設につき最大20件まで保存します。水が見えなかったという報告は、浸水がないことや安全を示しません。":"Up to 20 reports per facility are saved locally. Water not being visible does not establish that flooding is absent or the area is safe.",
  "現地報告を保存":"Save field report",
  "この施設の現地報告をすべて削除":"Delete all field reports for this facility",

  "物資の受領報告":"Supply receipt reports",
  "未保存の結果を書き出す":"Export unsaved result",
  "未保存の結果を破棄":"Discard unsaved result",
  "仮想配送記録の管理":"Manage simulation records",
  "端末には最大20件保存します。ファイルには施設名・位置・経路・相談内容が含まれるため、共有に注意してください。":"Up to 20 records are saved on this device. Exports contain facility names, locations, routes and consultation contents; take care when sharing.",
  "記録を書き出す":"Export records",
  "保存済み記録をすべて削除":"Delete all saved records",
  "撮影条件は利用者の申告で、Metaへ送りません。保存しない場合はこの画面を閉じると消えます。候補の実際の位置・高さ、画像外の範囲は未確認です。":"Capture conditions are self-reported and not sent to Meta. They are discarded on close unless you save them. The actual location and height of candidates and the area outside the image are unknown.",
  "撮影条件と候補を端末に保存":"Save capture conditions and candidates on this device",
  "画像の提供元・資料名（任意）":"Image provider or publication (optional)",
  "Metaへの画像送信の許可（申告）":"Permission to send the image to Meta (self-reported)",
  "許可を確認した":"Permission confirmed by user",
  "許可されていない":"Not permitted",
  "提供元は組織名や公開資料名を入力し、氏名・連絡先は入力しないでください。許可の申告は自動検証されません。提供元と利用条件を確認してください。":"Enter an organization or publication, not a person's name or contact details. Permission is self-reported and not verified. Check the source and terms of use.",
  "保存には申告した撮影位置と候補枠、元画像の照合用情報を含みます。画像自体は保存しません。同じ元画像を再選択すると保存済みの候補を確認できます。照合に対応しない場合は条件と件数だけ保存します。候補0件は障害物がないことを意味しません。":"Saved data includes the reported camera position, candidate boxes, and a fingerprint for matching the original image. The image itself is not saved. Select the same original file to view saved candidates. If matching is unavailable, only conditions and count are saved. Zero candidates does not prove there are no obstacles.",
  "保存した画像確認の記録":"Saved image reviews",
  "端末内の位置情報です。共有や画面撮影に注意してください。最大20件を保存します。":"These local records contain location data. Take care when sharing or taking screenshots. Up to 20 records are saved.",
  "画像確認の記録をすべて削除":"Delete all image review records",
  "受領後の対応を記録":"Record a follow-up",
  "人による予定・実施の申告を端末に残します。施設への連絡や再配送は実行されません。個人名・連絡先は入力しないでください。":"Save a person's planned or reported follow-up on this device. No facility contact or redelivery is performed. Do not enter names or contact details.",
  "対象の受領報告":"Receipt report",
  "受領報告を選んでください":"Choose a receipt report",
  "対応":"Follow-up",
  "状況を再確認":"Recheck the situation",
  "再配送を検討":"Consider redelivery",
  "人への引き継ぎ":"Hand over to a person",
  "状態":"Status",
  "予定・検討中":"Planned / considering",
  "対応したとの申告":"Reported completed",
  "取りやめたとの申告":"Reported cancelled",
  "補足（任意・200文字以内）":"Note (optional, up to 200 characters)",
  "対応を記録":"Save follow-up",
  "施設側など人からの報告を端末に記録します。仮想機体の到着・荷下ろしだけでは受領になりません。施設への送信や本人確認は行いません。":"Record human receipt reports locally. Simulated arrival or unloading is not proof of receipt. The app does not contact the facility or verify identity.",
  "受領状態":"Reported receipt status",
  "未着との報告":"Reported not received",
  "全数受領との報告":"Reported received in full",
  "一部受領との報告":"Reported partially received",
  "破損ありとの報告":"Reported damaged",
  "報告された日時":"Time reported",
  "報告元・確認方法":"Report source / confirmation method",
  "例：施設管理者への電話":"e.g. phone call to facility operator",
  "予定数量（箱）":"Expected quantity (boxes)",
  "報告された受領数量（箱）":"Reported received quantity (boxes)",
  "不足・破損などの補足":"Notes on shortage or damage",
  "未確認では受領数量を空欄にし、未着では0を入力します。施設ごとに最大20件、端末内に残ります。個人名・連絡先は入力しないでください。":"Leave received quantity empty if unconfirmed; enter zero if not received. Up to 20 reports per facility are saved locally. Do not enter names or contact details.",
  "受領報告を保存":"Save receipt report",
  "この施設の受領報告を削除":"Delete receipt reports for this facility",

  "施設の受け入れ報告（期限付き）":"Facility acceptance reports (with expiry)",
  "人が確認した内容をこの端末に記録します。施設には送信されず、飛行判断には使われません。個人名・連絡先は入力しないでください。":"Records a human report locally. It is not sent to the facility or used for flight decisions. Do not enter names or contact details.",
  "施設を選択してください。":"Choose a facility.",
  "回答":"Reported response",
  "受け入れ可能との報告":"Reported accepting",
  "条件付きとの報告":"Reported conditional acceptance",
  "受け入れ不可との報告":"Reported not accepting",
  "再確認が必要になる期限":"Reconfirmation deadline",
  "確認先の組織":"Organisation contacted",
  "確認方法・出典":"Confirmation method / source",
  "例：施設管理者":"e.g. facility operator",
  "例：電話":"e.g. phone",
  "物資（任意）":"Supplies (optional)",
  "数量（箱・任意）":"Quantity (boxes, optional)",
  "着地点の報告":"Reported landing site",
  "使用可能との報告":"Reported usable",
  "使用不可との報告":"Reported unusable",
  "条件・補足":"Conditions / notes",
  "条件付きの場合は入力":"Required for conditional acceptance",
  "ファイルには地域コード・日時・物資・Museの回答・判断メモが含まれます。共有時は内容に注意してください。":"Exports contain the area code, time, supplies, Muse response, and decision notes. Check contents before sharing.",
  "報告は施設ごとに最大20件を端末に保存し、異なる内容も残します。":"Up to 20 local reports per facility are preserved, including conflicting reports.",
  "訂正する元の報告（任意）":"Report being corrected (optional)",
  "新しい独立した報告":"New independent report",
  "訂正も未検証の申告です。元の報告は削除されず、両方を確認できます。":"A correction is also unverified. The original report remains available for comparison.",
  "報告を保存":"Save report",
  "この施設の報告をすべて削除":"Delete all reports for this facility",
  "以前の簡易メモ（期限なし）":"Earlier simple note (no expiry)",

  "河川水位・過去の災害資料":"River levels and historical disaster resources",
  "東京都の観測所を探す場合：対象河川・観測所と時刻を公式画面で確認してください。下の国交省の観測所と同じ地点とは限りません。":"For Tokyo stations, check the river, station and time on the official site. These may differ from the national stations below.",
  "東京都の雨量・水位を確認 ↗":"View Tokyo rainfall and river levels ↗",
  "東京都の過去データを確認 ↗":"View Tokyo historical data ↗",
  "過去データは現在の状況ではありません。東京都のデータはアプリに自動取得・照合していません。":"Historical data does not show current conditions. The app does not automatically retrieve or match Tokyo data.",
  "国交省の観測所の位置と水位ページを表示します。水位の自動取得は未接続です。":"View MLIT station locations and official water level pages. Automatic readings are not connected.",
  "川の防災情報 ↗":"Official river information ↗",
  "観測所":"Station",
  "位置情報：国交省の観測所データ（現地位置とずれる場合があります）":"Location: MLIT station metadata (position may differ from the site).",
  "観測所を地図で見る":"Show station on map",
  "水位を公式ページで確認 ↗":"Check water level on official site ↗",
  "観測所の位置・諸元の出典 ↗":"Station location and metadata source ↗",
  "確認した水位を端末内にメモ":"Record a water level locally",
  "手入力であり自動観測ではありません。公式ページの観測日時を入力し、利用時は必ず再確認してください。河川水位は施設の浸水深ではありません。":"This is a manually entered note, not an automatic observation. Enter the official observation time and check again before use. River level is not a facility flood depth.",
  "水位（m）":"Water level (m)",
  "施設報告の元データを保存":"Download raw facility reports",
  "現地報告の元データを保存":"Download raw field reports",
  "確認するフィード":"Feed to retrieve",
  "表示中に自動更新する":"Refresh automatically while visible",
  "短期は2分ごと、長期は1時間ごとに確認します。更新のたびに開いた電文と相談の選択は解除され、電文を含む進行中の相談も中止されます。画面を離れるか閉じると停止します。最新情報の保証はありません。":"Check the recent feed every 2 minutes and the long-term feed every hour. Each refresh clears open bulletins and their consultation selection, and cancels an ongoing consultation using that bulletin. Refresh stops when this view is hidden or closed. The latest information is not guaranteed.",
  "自動更新はオフです。":"Automatic refresh is off.",
  "長期：数日分":"Long-term: several days",
  "短期：直近少なくとも10分":"Recent: at least the last 10 minutes",
  "気象庁の全国フィードから取得します。長期は毎時更新・数日分、短期は毎分更新・直近少なくとも10分の掲載です。短期だけでは以前の発表を確認できません。停止や遅延があり、どちらも最新情報の保証にはなりません。訂正や取消と後続の情報は整理していません。選択地域や施設との対応は自動判定しません。一覧が空でも発表がないとは限りません。公式情報で確認してください。":"Retrieve JMA's national feed. The long-term feed updates hourly and covers several days; the recent feed updates each minute and covers at least the last 10 minutes. The recent feed alone cannot show earlier reports. Either may be delayed or unavailable; neither guarantees the latest information. Corrections and cancellations are not grouped, and relevance to the selected location is not determined. An empty list does not prove there is no forecast. Check official information.",
  "施設メモの元データを保存":"Download raw facility note",
  "ファイルには施設名や確認先が含まれるため、共有に注意してください。":"The file may contain facility names and sources; take care when sharing.",
  "読み取れない記録も元の内容を保存できます。施設名や確認先などが含まれるため、共有に注意してください。":"Unreadable records can also be downloaded as raw content. They may include facility names and sources; take care when sharing.",
  "受領報告の元データを保存":"Download raw receipt reports",
  "記録を読み取れない場合も、端末にある元の内容を保存できます。施設名や確認先が含まれるため、共有に注意してください。":"You can download the original stored content even if it cannot be read. It may contain facility names and sources; take care when sharing.",
  "保存ファイルには施設名や確認先が含まれるため、共有に注意してください。":"The file may contain facility names and sources; take care when sharing.",
  "水位の基準（本人が確認）":"Water-level reference (self-reported)",
  "観測所の水位標の基準面":"Station gauge zero",
  "T.P.（東京湾平均海面）":"T.P. (Tokyo Peil)",
  "A.P.（荒川工事基準面）":"A.P. (Arakawa Peil)",
  "その他の基準":"Other reference",
  "基準の申告は未検証です。基準が異なる水位は直接比較できません。不明な場合は不明を選んでください。":"The reference is self-reported and unverified. Levels with different references cannot be directly compared. Choose unknown if unsure.",
  "観測日時":"Observation time",
  "端末に保存":"Save on this device",
  "水位メモを削除":"Delete water level note",
  "国土地理院：過去災害の写真・地図 ↗":"GSI: historic disaster imagery and maps ↗",
  "（過去の事例。現在の現場映像ではありません）":"(Historical examples, not current imagery.)",
  "荒川・岩淵水門（上）":"Arakawa River · Iwabuchi Sluice (upstream)",
  "荒川・西新井":"Arakawa River · Nishiarai",

  '観測所の地上の値であり、施設や上空の実測ではありません。':'Ground observations at the station, not measurements at the facility or in the air.',
  '人が確認した内容の端末内メモです。自動で施設の受入を確認する機能ではありません。個人名や連絡先は入力しないでください。':'A local note of a human report; acceptance is not automatically verified. Do not enter names or contact details.',
  '将来の想定・現在の浸水ではない。失敗履歴は他地域を含む場合があります。':'Scenario, not current flooding. Error history can include other areas.',

  '観測所を地図で見る':'Show observation station on map',
  "地域の情報を確認":"Explore local data",
  "データ確認を閉じる":"Close data panel",
  "公開データと人のメモを分けて表示します。実際の救助・飛行の判断には使えません。":"Public data and human notes are shown separately. Do not use for real rescue or flight decisions.",
  "▦ 3D建物":"▦ 3D buildings",
  "⌂ 避難場所":"⌂ Shelters",
  "☂ 大雨情報":"☂ Heavy rain information",
  "◩ 洪水想定":"◩ Flood scenario",
  "国交省 PLATEAU":"MLIT PLATEAU",
  "国土地理院の公開一覧":"GSI public facility list",
  "気象庁の広域情報":"JMA regional information",
  "将来の想定・現在の浸水ではない":"Scenario, not observed flooding",
  "モデル表示中":"Model displayed",
  "一覧を取得":"List retrieved",
  "発表を取得":"Bulletin retrieved",
  "発表が古い":"Bulletin is old",
  "取得できず":"Unavailable",
  "取得失敗の履歴あり":"A retrieval error occurred",
  "重ね表示・範囲未確認":"Overlay shown; coverage unknown",
  "非表示・取得失敗の履歴あり":"Hidden; a retrieval error occurred",
  "非表示":"Hidden",
  "一部または全体を取得できず":"Partly or entirely unavailable",
  "気象の観測・出典・取得時刻を見る":"View weather observations, sources and fetch time",
  "気象庁の観測を確認 ↗":"View JMA observations ↗",
  "洪水想定の出典 ↗":"Flood scenario source ↗",
  "未確認":"Unverified",
  "現在の浸水・電線・上空の安全・施設の受入状況":"Current flooding, power lines, airspace safety and facility acceptance",
  "選択施設の確認メモを残す":"Record a note for the selected facility",
  "地図や施設一覧から施設を選んでください。":"Choose a facility from the map or list.",
  "人が確認した内容の端末内メモです。自動で施設の受入を確認する機能ではありません。":"A local note of a human report; facility acceptance is not verified automatically.",
  "確認結果":"Reported status",
  "受入可能と確認した":"Reported accepting",
  "受入不可と確認した":"Reported not accepting",
  "確認した日時":"Time checked",
  "確認先・出典":"Source of the report",
  "例：施設への電話":"e.g. phone call to the facility",
  "この端末に保存":"Save on this device",
  "メモを削除":"Delete note",
  "この施設の確認メモはありません。受入状況は不明です。":"No note for this facility. Acceptance is unknown.",
  "施設を選択するとメモを保存できます。":"Select a facility to save a note.",

  '災害対応シミュレーション':'Disaster response simulation','地図を見る':'View map','はじめての MUSE MISSION':'WELCOME TO MUSE MISSION',
  '街の状況を確かめ、支援を届ける。':'Assess the situation. Deliver support.',
  '実地図を使って水害対応を体験します。まずは３つの流れをご案内します。':'Explore a flood-response simulation on a real map. Start with three simple steps.',
  '配送先と出発地点':'Destination and departure','先に地図を見る':'Explore the map first','準備を始める':'Start setup',
  '地域情報':'Local information','地図の見方':'Map guide','公開施設':'Published facility','開設・受け入れは未確認':'Opening and acceptance unknown','選択した施設':'Selected facility','色は選択状態を示します':'The color marks your selection','洪水の想定区域':'Flood scenario area','現在の浸水範囲ではありません':'Not current flooding','仮想ドローン':'Simulated drone','水色：1号機／黄緑：2号機':'Cyan: drone 1 / lime: drone 2','仮想の移動経路':'Simulated route','当初はオレンジ破線、案Aは水色、案Bは紫':'Original: dashed orange; A: cyan; B: purple','仮想障害・点検':'Simulated obstacle and checks','？は不明、点検間の安全も未確認':'? means unknown; safety between checked points is unknown','色・線種・文字を併用しています。':'Colors, line styles and text are used together.',
  '地域':'Area','支援内容':'Mission','配送先':'Destination','出発地点':'Departure','確認・開始':'Review and start',
  '地図上の出発したい場所をクリックしてください。キーボードでは矢印キーで地図を動かし、Enterで中央の地点を選びます。':'Click the desired departure point on the map. With a keyboard, move the map with arrow keys and press Enter to select the centre.',
  '現在の浸水範囲ではありません。背景と混ざるため色は変わります。':'Not current flooding. Colors vary with the background.',
  '現在の浸水範囲ではありません。色は想定深さと背景によって変わります。':'Not current flooding. Colors vary with projected depth and background.',
  '施設の一覧や地図の設定は「情報を表示」から開けます。':'Open “Show information” for the facility list and map settings.',
  '洪水想定の濃さ':'Flood overlay opacity','地図の色は背景と混ざります。色がない場所も安全とは限りません。':'Overlay colors mix with the background. Areas without color are not necessarily safe.',
  '実地図を使った水害対応のシミュレーションです。まずは操作の流れを見てみましょう。':'Explore a flood-response simulation on a real map. First, see how it works.',
  '地域を選ぶ':'Choose an area','公開された地図から、対象の地域を選びます。':'Choose an area using public map data.',
  '配送先を選ぶ':'Choose a destination','物資を届ける施設と、出発地点を決めます。':'Select a facility and a starting point.',
  '確認して開始':'Review and start','複数機の動きと、共有・相談の経過を見守ります。':'Watch the drones share information and coordinate their routes.',
  'どの地域で試しますか？':'Where would you like to run the simulation?',
  '東京都 荒川区':'Arakawa, Tokyo','東京都 千代田区':'Chiyoda, Tokyo','東京都 台東区':'Taito, Tokyo',
  '写真付き建物を優先（一部）':'Photo-textured buildings where available',
  '地図データを読み込み中です。':'Loading map data.',
  '支援する内容を確認':'Review the response mission','状況確認':'Assess','物資配送':'Deliver supplies','情報共有':'Share information',
  '公開データと仮想障害を確認します。':'Review public data and simulated obstacles.',
  '複数の仮想機体が施設へ向かいます。':'Multiple simulated drones travel to facilities.',
  '仮想障害と点検結果を機体間で共有します。':'Share simulated obstacles and inspection results between drones.',
  'この版では、仮想の偵察機が設定済みの障害を報告し、仮想の中継機を通して配送機へ共有します。実際の観測や無線通信ではありません。':'A simulated scout reports a predefined obstacle and a simulated relay shares it with delivery drones. This is not real observation or radio communication.',
  'どこへ物資を届けますか？':'Where should supplies go?',
  '依頼文（任意・確認して修正できます）':'Request (optional; review and edit)',
  '◉ 音声を文字にする':'◉ Transcribe voice','音声を文字にする':'Transcribe voice','■ 録音を終了':'■ Stop recording',
  '文章から候補を反映':'Apply suggested details',
  '音声は文字起こしのためMetaに送信されます。個人情報は話さないでください。':'Audio is sent to Meta for transcription. Do not include personal information.',
  '録音した音声は文字起こしのためMetaへ送信します。個人情報は話さないでください。':'Audio is sent to Meta for transcription. Do not include personal information.',
  'Muse接続時、依頼文と仮想の街の画像をMetaへ送信します。氏名・電話番号などは入力しないでください。音声入力は文字起こしのため録音をMetaへ送ります。':'When Muse is connected, the request and simulated city images are sent to Meta. Do not enter names, phone numbers or other personal information. Voice recordings are sent to Meta for transcription.',
  '配送先の施設':'Destination facility','施設を読み込み中です':'Loading facilities','施設の取得を待っています':'Waiting for facilities','施設を選択':'Choose a facility',
  '物資':'Supplies','指定なし':'Not specified','選択してください':'Choose an option','飲料水':'Drinking water','食料':'Food','毛布':'Blankets','衛生用品':'Hygiene supplies',
  '数量（箱）':'Quantity (boxes)','施設は公開情報です。現在の開設や受け入れ状況は確認していません。':'Facilities are from public data. Their current opening and acceptance status is unknown.',
  '出発地点を地図で選ぶ':'Choose a launch point on the map',
  '地図を押すと、地図の中央にある地点が出発地点になります。地図はドラッグして動かせます。':'Click the map to select its center as the launch point. Drag the map to move it.',
  '出発地点：未選択':'Launch point: not selected','出発候補地点：未選択':'Launch point: not selected',
  '地図で出発地点を選ぶ':'Choose launch point on map','内容を確認して開始':'Review and start',
  '配送する機体数':'Number of delivery drones','最大100機':'Up to 100 drones','2機':'2 drones',
  '比較シナリオ（100機モード）':'Comparison scenario (100-drone mode)','ケースA：取得した点検結果を使う':'Case A: use acquired checks','ケースB：案Aの1点を仮想的に伏せる':'Case B: withhold one A sample (simulated)',
  'ケースBでは案Aの確認済み点を1点伏せて不明扱いにします。実際の取得失敗ではありません。':'In case B, one observed A sample is withheld and treated as unknown. This is not an actual data failure.',
  '仮想障害が発生すると、地名を含む地図画像と点検結果をMuseに送って相談する場合があります。100機の配送では、候補なしや一時的な通信障害の際に、別の候補を点検して最大2回相談します。条件を確認できない場合は対象機を停止します。':'When a simulated obstacle occurs, a map image (which may contain place names) and inspection results may be sent to Muse. In 100-drone mode, an alternative can be checked and Muse consulted up to twice. Affected drones stop if requirements cannot be verified.',
  '戻る':'Back','次へ':'Next','配送先を選ぶ':'Choose a destination','出発地点を選ぶ':'Choose a launch point','ミッションの準備':'Prepare your mission',
  '内容を確認':'Review','シミュレーションを開始':'Start simulation','開始へ進む':'Continue to start','はじめる':'Get started','スキップ':'Skip',
  'シミュレーションです。背景はイメージで、現在の浸水や実機の飛行状況ではありません。':'Simulation only. The background is illustrative, not live flooding or real drone activity.',
  '地図を押して出発地点を選んでください':'Click the map to choose a launch point',
  '街全体':'Overview','ドローン追跡':'Follow drone','1号機追跡':'Follow drone 1','2号機追跡':'Follow drone 2',
  '仮想配送':'Simulation','実地図を見る':'View real map','使い方の案内':'How to use','情報を閉じる':'Hide details','情報を表示':'Show details',
  '航空写真は現在の映像ではありません。洪水は想定です。':'Aerial imagery is not live. Flooding is a scenario.',
  '航空写真：撮影時期未確認・現在の現場映像ではありません。':'Aerial imagery: capture date unknown; not live footage.',
  '洪水の想定区域は、現在の浸水状況ではありません。':'Flood hazard areas are projections, not current flooding.',
  '仮想の水面を表示中：実際の浸水ではありません。':'Simulated water is shown, not actual flooding.',
  'データの取得状態を確認中です。':'Checking data availability.','表示の注意':'Data notes','地図の記号を見る':'Map legend','この地域の2機の記録を保存':'Download two-aircraft records for this area',
  '国土地理院の航空写真（撮影時期未確認）。広域では地図を表示します。':'GSI aerial imagery (capture date unknown); a map is shown at wider scales.',
  '取得中・取得状況や鮮度が未確認：洪水想定図・気象':'Loading or availability and freshness unknown: flood hazard map and weather',
  '1号機：出発地点と施設を選んでください。':'Drone 1: choose a launch point and facility.',
  'アプリ：仮想配送を停止しました。理由は左上をご確認ください。':'App: The simulation has stopped. See the reason at the top left.',
  'アプリ：一部の機体を停止しました。理由は左上をご確認ください。':'App: Some drones have stopped. See the reason at the top left.',
  'Muse接続設定あり':'Muse connection configured','試作モード':'Prototype mode',
  '判断の根拠':'Decision evidence','仮想配送の進行状況':'Simulated mission progress','仮想の共有情報':'Simulated shared report','Museへの入力':'Input to Muse','Museの提案':'Muse proposal','アプリの判断':'App decision','定型ルールとの比較':'Rule comparison','点検と画像を見る':'Inspect evidence and image','地図画像（送信対象）':'Map image prepared for Muse','点検地点の間・電線・現地の安全は未確認。':'Between sampled points, wires and real-world safety remain unverified.',
  '配送先の変更を確認':'Review destination change','仮想変更を承認':'Approve simulated change','変更せず停止':'Decline and stop',
  '荷下ろし中断・所在不明':'Unloading interrupted; whereabouts unknown','荷下ろし済（全施設）':'Unloaded (all facilities)','仮想荷下ろし済':'Simulated unloaded',
  '配送中・準備中':'In flight or preparing','元施設':'original facility','別施設':'other facilities','未割当':'Unassigned',
  '帰還完了':'Returned','施設の開設・受入は未確認。':'Facility opening and acceptance are unverified.',
  '結果をこの端末に保存しました。':'Results saved on this device.','点検した地点の間、電線・機体間の安全・現地の受入は未確認。':'Conditions between sampled points, wires, aircraft separation and facility acceptance remain unverified.',
  '施設の受入は未確認。承認後に経路を再点検します。2分以内に判断がなければ停止します。':'Facility acceptance is unverified. Routes will be rechecked after approval. The drones stop if no decision is made within two minutes.',
  '（現地状況は未確認）':' (on-site conditions unverified)',
  'AI 交信':'AI radio','迂回相談':'Route consultation','読み上げ OFF':'Speech OFF','読み上げ ON':'Speech ON','読み上げ不可':'Speech unavailable',
  '仮想障害で停止後、Museに相談できます。':'Muse can be consulted after a simulated obstacle.',
  '依頼確認':'Request','出発':'Departure','障害共有':'Share obstacle','Muse相談':'Consult Muse','再点検':'Recheck','配送・結果':'Delivery / result','停止・結果':'Stopped / result',
  'シミュレーション':'SIMULATION','機体を追跡':'Follow drone','交信履歴・根拠':'Radio & evidence','全機を停止':'Stop all drones',
  '100機の仮想配送':'100-drone simulation','共有と相談の履歴を見る':'View sharing and consultation history',
  '機体を選ぶ':'Choose a drone','機体を選択':'Select a drone','詳しい情報を表示':'Show details',
  '確認中':'Checking','待機':'Waiting','移動中':'In flight','相談待ち':'Awaiting consultation','荷下ろし':'Unloading','終了':'Finished','停止':'Stopped',
  '点検中':'Checking','出発待ち':'Awaiting departure','荷下ろし中':'Unloading','帰還済み':'Returned','予備':'Spare',
  '出発前の建物モデルを点検中':'Checking building models before departure','仮想配送中':'Simulated delivery in progress',
  '仮想障害を共有し、候補を点検中':'Simulated obstacle shared; inspecting route options',
  '別の仮想経路を作り直して点検中':'Building and checking an alternative simulated route',
  'Museの回答待ち':'Waiting for Muse','別の経路についてMuseに再相談中':'Consulting Muse again about an alternative',
  '別施設への変更は承認待ち':'Waiting for approval to change destination',
  '選択された仮想案を再点検中':'Rechecking the selected simulated route',
  '再点検を通った仮想案で移動中':'Flying the rechecked simulated route',
  '一部の機体が停止・他の機体は継続中':'Some drones stopped; others continue',
  '仮想配送を終了・停止した機体あり':'Simulation finished; some drones stopped',
  '仮想配送を停止':'Simulated delivery stopped','配送を終了・停止した機体あり':'Delivery ended; some drones stopped',
  '仮想配送と帰還を終了':'Simulated delivery and return complete','仮想配送を開始できません':'Could not start the simulation',
  '最大8機を3Dで拡大表示':'Up to 8 delivery drones shown as enlarged 3D models',
  '代表機の3Dモデルを読み込み中':'Loading the selected drone model',
  '代表機の3Dモデルを確認できず、点で表示':'Drone model unavailable; showing a point',
  '代表機の3Dモデル：表示状況を確認中':'Checking drone model availability',
  '出発前の点検待ち':'Waiting for preflight checks','仮想ルートを移動':'Moving on a simulated route',
  '仮想情報の共有待ち':'Waiting to share simulated data','仮想障害を報告':'Reported simulated obstacle','仮想情報を共有':'Shared simulated information','任務終了':'Mission ended',
  '配送先の施設を選んでください。':'Choose a destination facility.',
  '物資と数量は両方選ぶか、両方とも指定なしにしてください。':'Choose both supplies and quantity, or leave both unspecified.',
  '地図で出発地点を選んでください。':'Choose a launch point on the map.',
  '地域データを読み込み中、または取得できません。地図の状態を確認してください。':'Area data is loading or unavailable. Check the map status.',
  '開始の準備を確認中です。少し待つか、地図の読み込み状況を確認してください。':'Preparing to start. Please wait or check map availability.',
  '音声の認識が終わるまでお待ちください。':'Wait for voice transcription to finish.',
  '地図の読み込みをお待ちください。':'Please wait for the map to load.',
  '候補を確認し、必要なら施設・物資・数量を修正してください。':'Review the suggestions and correct the facility, supplies or quantity if needed.',
  '例：原中学校に水を12箱届けて':'Example: deliver 12 boxes of water to Hara Junior High School',
  '例：12':'e.g. 12',
  '原中学校':'Hara Junior High School','ゆいの森あらかわ':'Yuinomori Arakawa',
  '東京都荒川区':'Arakawa, Tokyo','東京都千代田区':'Chiyoda, Tokyo','東京都台東区':'Taito, Tokyo'
});
const UI_EN_ENTRIES=Object.entries(UI_EN).sort((a,b)=>b[0].length-a[0].length);
export function translateInterfaceText(value,language='ja'){
  if(typeof value!=='string'||resolveInterfaceLanguage(language)!=='en')return value;
  const trimmed=value.trim();if(!trimmed)return value;
  if(Object.hasOwn(UI_EN,trimmed))return value.replace(trimmed,UI_EN[trimmed]);
  const photoCount=trimmed.match(/^画像内の候補 (\d+)件。位置や安全は未確認です。$/);if(photoCount)return `Image candidates: ${photoCount[1]}. Actual position and safety are unknown.`;
  if(trimmed.startsWith('画像の確認に失敗しました：'))return value.replace('画像の確認に失敗しました：','Image review failed: ');
  if(trimmed.startsWith('画像を読み込めません：'))return value.replace('画像を読み込めません：','Could not load image: ');

  const userStop=trimmed.match(/^停止理由：利用者が仮想配送を停止しました（(\d+)機）$/);
  if(userStop)return `Stop reason: simulation stopped by the user (${userStop[1]} drones)`;
  if(/^停止理由：/.test(trimmed))return value.replace('停止理由：','Stop reason (Japanese original): ');
  const loadingSources=trimmed.match(/^取得中・取得状況や鮮度が未確認：(.+)$/);
  if(loadingSources){const names={'建物':'buildings','気象':'weather','洪水想定図':'flood hazard map'};return 'Loading or availability and freshness unknown: '+loadingSources[1].split('・').map(name=>names[name]||name).join(', ')}
  if(/^アプリの共有：/.test(trimmed))value=value.replace('アプリの共有：','App event: ');
  if(/^Museの回答（説明は未検証）：/.test(trimmed))return value.replace('Museの回答（説明は未検証）：','Muse response (Japanese original; explanation unverified): ');
  if(/^Muse \(Japanese original\):/.test(trimmed))return value;
  if(/^Muse consultation failed:/.test(trimmed))return value;
  if(/^Muse[：:]/.test(trimmed)&&/[\u3040-\u30ff\u3400-\u9fff]/.test(trimmed))return value.replace(/^Muse[：:]/,'Muse (Japanese original): ');
  let out=value.replace(/^(.+?)への(.+?) (\d+)箱を変更：/,'Proposed destination change for $1, $2 $3 boxes: ').replace(/^(.+?)へ (.+?) (\d+)箱$/,'Supplies to $1: $2 — $3 boxes').replace(/への依頼 /g,' request: ').replace(/地域：/g,'Area: ').replace(/施設：/g,'Facility: ').replace(/出発地点：/g,'Launch point: ').replace(/物資：/g,'Supplies: ');
  for(const [ja,en] of UI_EN_ENTRIES)if(ja.length>=2&&out.includes(ja))out=out.split(ja).join(en);
  out=out.replace(/(\d+)機/g,'$1 drones').replace(/(\d+)箱/g,'$1 boxes');
  out=out.replace(/東京都荒川区/g,'Arakawa, Tokyo').replace(/東京都千代田区/g,'Chiyoda, Tokyo').replace(/東京都台東区/g,'Taito, Tokyo').replace(/ ／ 実地図/g,' / Real map');
  out=out.replace(/原中学校/g,'Hara Junior High School').replace(/ゆいの森あらかわ/g,'Yuinomori Arakawa');
  out=out.replace(/準備 (\d+) \/ (\d+)/g,'SETUP $1 / $2').replace(/偵察（仮想）：/g,'Scout (simulated): ').replace(/中継（仮想）：/g,'Relay (simulated): ');
  return out;
}

// A facility note is a local human report, never an operational readiness signal.
export function pilotFacilityKey(area,name,address){
  if (![area,name,address].every(value=>typeof value==='string') || !area.trim() || !name.trim()) return null;
  return 'muse-pilot-facility-v1:'+JSON.stringify([area,name,address]);
}
export function validatePilotFacilityRecord(record,identity){
  if(!record || !identity || !pilotFacilityKey(identity.area,identity.name,identity.address))return null;
  if(['area','name','address'].some(key=>record[key]!==identity[key]))return null;
  if(!['available','unavailable'].includes(record.status))return null;
  if(typeof record.at!=='string'||!Number.isFinite(Date.parse(record.at)))return null;
  if(typeof record.source!=='string'||!record.source.trim()||record.source.length>150)return null;
  return {area:record.area,name:record.name,address:record.address,status:record.status,at:record.at,source:record.source};
}

const CONSULT_BULLETIN_LABELS=['現況','１時間後','２時間後','３時間後','４時間後','５時間後','６時間後'];
export function consultBulletinIssueAge(issuedAt,now=Date.now()){
 const issued=parseZonedTimestamp(issuedAt);
 if(issued===null||!Number.isFinite(now))return {state:'unknown',minutes:null};
 if(issued>now)return {state:'clock',minutes:null};
 return {state:'elapsed',minutes:Math.floor((now-issued)/60000)};
}
export function validateConsultFloodBulletin(value,now=Date.now()){
 if(!value||Array.isArray(value)||Object.keys(value).sort().join(',')!=='bulletinType,controlStatus,event,issuedAt,levels,retrievedAt,serial,sourceUrl'||!Number.isFinite(now))return false;
 if(typeof value.sourceUrl!=='string'||value.sourceUrl.length>300||!/^https:\/\/www\.data\.jma\.go\.jp\/developer\/xml\/data\/[0-9]{14}_[0-9]+_VXKO(?:5\d|6\d|7\d|8\d)_[0-9]+\.xml$/.test(value.sourceUrl)||typeof value.event!=='string'||!/^\d{12}$/.test(value.event)||typeof value.serial!=='string'||!/^\d{1,20}$/.test(value.serial)||value.controlStatus!=='通常'||!['発表','訂正'].includes(value.bulletinType))return false;
 const issued=parseZonedTimestamp(value.issuedAt),retrieved=parseZonedTimestamp(value.retrievedAt);if(issued===null||retrieved===null||retrieved>now+300000||issued>retrieved+300000||now-retrieved>=7200000)return false;
 if(!Array.isArray(value.levels)||value.levels.length>30)return false;
 return value.levels.every(row=>row&&!Array.isArray(row)&&Object.keys(row).sort().join(',')==='at,category,condition,stationCode,unit,value'&&typeof row.stationCode==='string'&&/^\d{1,30}$/.test(row.stationCode)&&CONSULT_BULLETIN_LABELS.includes(row.category)&&parseZonedTimestamp(row.at)!==null&&row.unit==='m'&&((row.condition==='欠測'&&row.value===null)||(row.condition==='正常'&&typeof row.value==='string'&&/^-?\d{1,4}(?:\.\d{1,3})?$/.test(row.value)&&Math.abs(Number(row.value))<=1000)));
}
export function consultFloodBulletin(source,now=Date.now()){
 if(!source||!source.water||source.water.truncated!==false||!Array.isArray(source.water.rows)||source.water.rows.length>30)return null;
 if(source.water.rows.some(row=>!row||row.stationCodeType!=='水位観測所'))return null;
 const value={sourceUrl:source.url,issuedAt:source.issuedAt,retrievedAt:source.retrievedAt,event:source.event,serial:source.serial,bulletinType:source.bulletinType,controlStatus:source.controlStatus,levels:source.water.rows.map(row=>({stationCode:row.code,at:row.time,category:row.label,value:row.condition==='欠測'&&row.value===''?null:row.value,unit:row.unit,condition:row.condition}))};
 return validateConsultFloodBulletin(value,now)?value:null;
}

// Local provenance for one consultation. Input references identify what was sent,
// not claims that the model cited, verified or independently fetched the sources.
export function consultEvidenceRefs(requestId,hasFlood,hasObservation=false,hasFieldReports=false,hasFacilityReports=false,hasBulletin=false,hasInfrastructureReports=false){
  if(typeof requestId!=='string'||!/^[-a-zA-Z0-9]{1,100}$/.test(requestId)||[hasFlood,hasObservation,hasFieldReports,hasFacilityReports,hasBulletin,hasInfrastructureReports].some(value=>typeof value!=='boolean'))throw new Error('相談の参照IDが不正です');
  return ['image','supplies',...(hasFlood?['flood']:[]),...(hasObservation?['observation']:[]),...(hasFieldReports?['field_reports']:[]),...(hasFacilityReports?['facility_reports']:[]),...(hasBulletin?['bulletin']:[]),...(hasInfrastructureReports?['infrastructure_reports']:[])].map(kind=>({id:`${requestId}:${kind}`,kind}));
}
export function validateConsultEvidenceRefs(refs,hasFlood,hasObservation=false,hasFieldReports=false,hasFacilityReports=false,hasBulletin=false,hasInfrastructureReports=false){
  if(!Array.isArray(refs)||!refs.length||typeof refs[0]?.id!=='string')return false;
  const match=refs[0].id.match(/^([-a-zA-Z0-9]{1,100}):image$/);if(!match)return false;
  try{return JSON.stringify(refs)===JSON.stringify(consultEvidenceRefs(match[1],hasFlood,hasObservation,hasFieldReports,hasFacilityReports,hasBulletin,hasInfrastructureReports))}catch{return false}
}
export function validateConsultCitations(refs,cited){
  return Array.isArray(refs)&&Array.isArray(cited)&&cited.length<=refs.length&&new Set(cited).size===cited.length&&cited.every(id=>typeof id==='string'&&refs.some(ref=>ref.id===id));
}
export async function consultImageDigest(dataUrl,subtle=globalThis.crypto?.subtle){
  if(typeof dataUrl!=='string'||!dataUrl.startsWith('data:image/png;base64,')||dataUrl.length>10000000||!subtle)return null;
  try{const binary=atob(dataUrl.slice('data:image/png;base64,'.length)),bytes=Uint8Array.from(binary,c=>c.charCodeAt(0)),digest=await subtle.digest('SHA-256',bytes);return Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('')}catch{return null}
}
export function createConsultAudit({id,capturedAt,area,payload,flood,observation,shelter='',address='',imageHash}={}){
  if(typeof id!=='string'||!id||id.length>100||typeof capturedAt!=='string'||!Number.isFinite(Date.parse(capturedAt))||typeof area!=='string'||!area)throw new Error('相談の識別情報が不正です');
  if(!payload||!mapConsultInputValid(payload.supply,payload.quantity)||!mapFloodInputValid(payload.flood))throw new Error('相談入力が不正です');
  const inputs=[
    {id:`${id}:image`,kind:'image',value:'3D地図の画面画像',capturedAt,observedAt:null,source:'地図画面（現場のライブ映像ではありません）'},
    {id:`${id}:supplies`,kind:'supplies',supply:payload.supply,quantity:payload.quantity,source:'アプリの選択'}
  ];
  if(imageHash!==undefined){if(imageHash!==null&&(typeof imageHash!=='string'||!/^[a-f0-9]{64}$/.test(imageHash)))throw new Error('画像の照合情報が不正です');inputs[0].sha256=imageHash}
  if(Object.hasOwn(payload,'flood')){
    const value=payload.flood??null;
    if(value!==null&&mapFloodContext(flood,shelter,address)!==value)throw new Error('送信した洪水想定の施設が一致しません');
    inputs.push({id:`${id}:flood`,kind:'flood',value,retrievedAt:value!==null&&Number.isFinite(Date.parse(flood?.checkedAt))?flood.checkedAt:null,observedAt:null,source:value!==null?'https://disaportal.gsi.go.jp/hazardmap/copyright/opendata.html':null});
  }
  if(Object.hasOwn(payload,'observation')){
    const value=mapObservationContext(observation,area,Date.parse(capturedAt),{includeReferenceKind:Object.hasOwn(payload.observation||{},'referenceKind'),includeAccumulatedRain:Object.hasOwn(payload.observation||{},'rain1h')});if(!value||JSON.stringify(value)!==JSON.stringify(payload.observation))throw new Error('送信した観測情報を確認できません');
    inputs.push({id:`${id}:observation`,kind:'observation',value:{...value},source:'https://www.jma.go.jp/bosai/amedas/'});
  }
  if(Object.hasOwn(payload,'fieldReports')){
    if(!validateConsultFieldReports(payload.fieldReports,Date.parse(capturedAt)))throw new Error('送信する現地報告を確認できません');
    inputs.push({id:`${id}:field_reports`,kind:'field_reports',value:payload.fieldReports.map(item=>({...item})),source:'人の未検証報告'});
  }
  if(Object.hasOwn(payload,'facilityReports')){
    if(!validateConsultFacilityReports(payload.facilityReports,Date.parse(capturedAt)))throw new Error('送信する施設報告を確認できません');
    inputs.push({id:`${id}:facility_reports`,kind:'facility_reports',value:payload.facilityReports.map(item=>({...item})),source:'人の未検証施設報告'});
  }
  if(Object.hasOwn(payload,'bulletin')){
    if(!validateConsultFloodBulletin(payload.bulletin,Date.parse(capturedAt)))throw new Error('送信する洪水予報電文を確認できません');
    inputs.push({id:`${id}:bulletin`,kind:'bulletin',value:{...payload.bulletin,levels:payload.bulletin.levels.map(item=>({...item}))},source:payload.bulletin.sourceUrl});
  }
  if(Object.hasOwn(payload,'infrastructureReports')){
    if(!validateConsultInfrastructureReports(payload.infrastructureReports,Date.parse(capturedAt)))throw new Error('送信する設備報告を確認できません');
    inputs.push({id:`${id}:infrastructure_reports`,kind:'infrastructure_reports',value:payload.infrastructureReports.map(item=>({...item})),source:'人の未検証設備報告'});
  }
  return {version:1,requestId:id,area,capturedAt,status:'sent',inputs};
}
export function finishConsultAudit(audit,result,receivedAt,provenance){
  if(!audit||audit.status!=='sent'||typeof receivedAt!=='string'||!Number.isFinite(Date.parse(receivedAt)))throw new Error('相談記録が不正です');
  if(provenance!==undefined&&!['muse','fixture','unknown'].includes(provenance))throw new Error('回答の出所が不正です');
  describeMapConsult(result);
  const output={density:result.density,ordered_ids:[...result.ordered_ids]};
  if(Object.hasOwn(result,'cited_ids')){const refs=audit.inputs.map(({id,kind})=>({id,kind}));if(!validateConsultCitations(refs,result.cited_ids))throw new Error('Museの参照IDを確認できません');output.cited_ids=[...result.cited_ids]}
  return {...audit,status:'received',receivedAt,...(provenance===undefined?{}:{responseProvenance:provenance}),inputs:audit.inputs.map(item=>item.kind==='observation'?{...item,value:{...item.value}}:['field_reports','facility_reports','infrastructure_reports'].includes(item.kind)?{...item,value:item.value.map(row=>({...row}))}:item.kind==='bulletin'?{...item,value:{...item.value,levels:item.value.levels.map(row=>({...row}))}}:{...item}),output};
}
const CONSULT_FAILURE_CLASSES=['input_rejected','consultation_failed','interrupted'];
export function finishUncertainConsultAudit(audit,endedAt,failureClass){
  if(!audit||audit.status!=='sent'||typeof endedAt!=='string'||!Number.isFinite(Date.parse(endedAt))||(failureClass!==undefined&&!CONSULT_FAILURE_CLASSES.includes(failureClass)))throw new Error('相談記録が不正です');
  return {...audit,status:'uncertain',endedAt,inputs:JSON.parse(JSON.stringify(audit.inputs)),...(failureClass===undefined?{}:{failureClass})};
}

// Reject malformed local history instead of turning it into trustworthy evidence.
const CONSULT_AUDIT_MAX_CHARS=400000;
export function decodeConsultAudits(raw){
  if(raw===null||raw===undefined)return {status:'ok',records:[]};
  try{
    if(typeof raw!=='string'||raw.length>CONSULT_AUDIT_MAX_CHARS)throw new Error('history');
    const rows=JSON.parse(raw);if(!Array.isArray(rows)||rows.length>20)throw new Error('history');
    const ids=new Set(),records=rows.map(row=>{
      if(!row||row.version!==1||!['received','uncertain'].includes(row.status)||typeof row.requestId!=='string'||!/^[-a-zA-Z0-9]{1,100}$/.test(row.requestId)||ids.has(row.requestId)||!/^\d{5}$/.test(row.area)||typeof row.capturedAt!=='string'||!Number.isFinite(Date.parse(row.capturedAt)))throw new Error('record');
      if(Object.hasOwn(row,'responseProvenance')&&(row.status!=='received'||!['muse','fixture','unknown'].includes(row.responseProvenance)))throw new Error('provenance');
      if(row.status==='received'){if(typeof row.receivedAt!=='string'||!Number.isFinite(Date.parse(row.receivedAt))||Object.hasOwn(row,'endedAt')||Object.hasOwn(row,'failureClass'))throw new Error('received');describeMapConsult(row.output)}
      else if(typeof row.endedAt!=='string'||!Number.isFinite(Date.parse(row.endedAt))||Object.hasOwn(row,'receivedAt')||Object.hasOwn(row,'output')||Object.hasOwn(row,'reviews')||(Object.hasOwn(row,'failureClass')&&!CONSULT_FAILURE_CLASSES.includes(row.failureClass)))throw new Error('uncertain');
      ids.add(row.requestId);
      if(!Array.isArray(row.inputs)||row.inputs.length<2||row.inputs.length>8)throw new Error('inputs');
      const [image,supplies]=row.inputs,extras=row.inputs.slice(2),flood=extras.find(item=>item?.kind==='flood'),observation=extras.find(item=>item?.kind==='observation'),fieldReports=extras.find(item=>item?.kind==='field_reports'),facilityReports=extras.find(item=>item?.kind==='facility_reports'),bulletin=extras.find(item=>item?.kind==='bulletin'),infrastructureReports=extras.find(item=>item?.kind==='infrastructure_reports');
      if(JSON.stringify(extras.map(item=>item?.kind))!==JSON.stringify([...(flood?['flood']:[]),...(observation?['observation']:[]),...(fieldReports?['field_reports']:[]),...(facilityReports?['facility_reports']:[]),...(bulletin?['bulletin']:[]),...(infrastructureReports?['infrastructure_reports']:[])]))throw new Error('inputs');
      if(image?.id!==`${row.requestId}:image`||image.kind!=='image'||image.value!=='3D地図の画面画像'||image.capturedAt!==row.capturedAt||image.observedAt!==null||image.source!=='地図画面（現場のライブ映像ではありません）')throw new Error('image');
      if(supplies?.id!==`${row.requestId}:supplies`||supplies.kind!=='supplies'||supplies.source!=='アプリの選択'||!mapConsultInputValid(supplies.supply,supplies.quantity))throw new Error('supplies');
      if(flood&&(flood.id!==`${row.requestId}:flood`||flood.kind!=='flood'||!mapFloodInputValid(flood.value)||flood.value===undefined||flood.observedAt!==null||(flood.retrievedAt!==null&&!Number.isFinite(Date.parse(flood.retrievedAt)))||flood.source!==(flood.value===null?null:'https://disaportal.gsi.go.jp/hazardmap/copyright/opendata.html')||(flood.value===null&&flood.retrievedAt!==null)))throw new Error('flood');
      const imageInput={id:image.id,kind:image.kind,value:image.value,capturedAt:image.capturedAt,observedAt:null,source:image.source};
      if(Object.hasOwn(image,'sha256')){if(image.sha256!==null&&(typeof image.sha256!=='string'||!/^[a-f0-9]{64}$/.test(image.sha256)))throw new Error('hash');imageInput.sha256=image.sha256}
      const inputs=[imageInput,{id:supplies.id,kind:supplies.kind,supply:supplies.supply,quantity:supplies.quantity,source:supplies.source}];
      if(flood)inputs.push({id:flood.id,kind:flood.kind,value:flood.value,retrievedAt:flood.retrievedAt,observedAt:null,source:flood.source});
      if(observation){if(observation.id!==`${row.requestId}:observation`||observation.source!=='https://www.jma.go.jp/bosai/amedas/'||!validateConsultObservation(observation.value,Date.parse(row.capturedAt),{historical:true}))throw new Error('observation');inputs.push({id:observation.id,kind:'observation',value:{...observation.value},source:observation.source})}
      if(fieldReports){if(fieldReports.id!==`${row.requestId}:field_reports`||fieldReports.source!=='人の未検証報告'||!validateConsultFieldReports(fieldReports.value,Date.parse(row.capturedAt)))throw new Error('field reports');inputs.push({id:fieldReports.id,kind:'field_reports',value:fieldReports.value.map(item=>({...item})),source:fieldReports.source})}
      if(facilityReports){if(facilityReports.id!==`${row.requestId}:facility_reports`||facilityReports.source!=='人の未検証施設報告'||!validateConsultFacilityReports(facilityReports.value,Date.parse(row.capturedAt)))throw new Error('facility reports');inputs.push({id:facilityReports.id,kind:'facility_reports',value:facilityReports.value.map(item=>({...item})),source:facilityReports.source})}
      if(bulletin){if(bulletin.id!==`${row.requestId}:bulletin`||!validateConsultFloodBulletin(bulletin.value,Date.parse(row.capturedAt))||bulletin.source!==bulletin.value.sourceUrl)throw new Error('bulletin');inputs.push({id:bulletin.id,kind:'bulletin',value:{...bulletin.value,levels:bulletin.value.levels.map(item=>({...item}))},source:bulletin.source})}
      if(infrastructureReports){if(infrastructureReports.id!==`${row.requestId}:infrastructure_reports`||infrastructureReports.source!=='人の未検証設備報告'||!validateConsultInfrastructureReports(infrastructureReports.value,Date.parse(row.capturedAt)))throw new Error('infrastructure reports');inputs.push({id:infrastructureReports.id,kind:'infrastructure_reports',value:infrastructureReports.value.map(item=>({...item})),source:infrastructureReports.source})}
      if(row.status==='uncertain')return {version:1,requestId:row.requestId,area:row.area,capturedAt:row.capturedAt,status:'uncertain',inputs,endedAt:row.endedAt,...(Object.hasOwn(row,'failureClass')?{failureClass:row.failureClass}:{})};
      const output={density:row.output.density,ordered_ids:[...row.output.ordered_ids]};
      if(Object.hasOwn(row.output,'cited_ids')){if(!validateConsultCitations(inputs.map(({id,kind})=>({id,kind})),row.output.cited_ids))throw new Error('citations');output.cited_ids=[...row.output.cited_ids]}
      const result={version:1,requestId:row.requestId,area:row.area,capturedAt:row.capturedAt,status:'received',inputs,receivedAt:row.receivedAt,...(Object.hasOwn(row,'responseProvenance')?{responseProvenance:row.responseProvenance}:{}),output};
      if(Object.hasOwn(row,'reviews')){
        if(!Array.isArray(row.reviews)||!row.reviews.length||row.reviews.length>20)throw new Error('reviews');let last=Date.parse(row.receivedAt);
        result.reviews=row.reviews.map(item=>{if(!item||Object.keys(item).some(key=>!['at','choice','reason','note'].includes(key))||!['consider','hold','reject'].includes(item.choice)||typeof item.at!=='string'||!Number.isFinite(Date.parse(item.at))||new Date(item.at).toISOString()!==item.at||Date.parse(item.at)<last)throw new Error('review');last=Date.parse(item.at);const review={choice:item.choice,at:item.at};if(Object.hasOwn(item,'reason')){if(!['missing_data','conflicting_data','outdated_data','response_mismatch','needs_review','other'].includes(item.reason))throw new Error('reason');review.reason=item.reason}if(Object.hasOwn(item,'note')){if(typeof item.note!=='string'||!item.note||item.note!==item.note.trim()||item.note.length>200)throw new Error('note');review.note=item.note}return review});
      }
      return result;
    });
    return {status:'ok',records};
  }catch{return {status:'corrupt',records:[]}}
}
export function appendConsultAudit(raw,audit){
  const saved=decodeConsultAudits(raw);if(saved.status!=='ok'||decodeConsultAudits(JSON.stringify([audit])).status!=='ok')throw new Error('相談記録を確認してください');
  const rows=raw===null?[]:JSON.parse(raw),existing=rows.find(item=>item.requestId===audit.requestId);
  if(existing){if(JSON.stringify(existing)===JSON.stringify(audit))return raw;throw new Error('同じ相談IDで異なる記録が保存されています')}
  if(rows.length>=20)throw new Error('保存上限20件です。必要な記録を保存し、整理してください');
  const next=JSON.stringify([audit,...rows]);if(next.length>CONSULT_AUDIT_MAX_CHARS)throw new Error('記録の容量上限です。必要な記録を書き出して整理してください');if(decodeConsultAudits(next).status!=='ok')throw new Error('相談記録を保存できません');return next;
}
export function removeConsultAudit(raw,audit){
  if(decodeConsultAudits(raw).status!=='ok'||decodeConsultAudits(JSON.stringify([audit])).status!=='ok')throw new Error('相談記録を確認してください');
  const rows=raw===null?[]:JSON.parse(raw),index=rows.findIndex(item=>item.requestId===audit.requestId);
  if(index<0||JSON.stringify(rows[index])!==JSON.stringify(audit))throw new Error('確認後に記録が変わりました。再確認してください');
  return JSON.stringify(rows.filter((_,i)=>i!==index));
}
export function recordConsultReview(raw,audit,choice,at,details){
  if(decodeConsultAudits(raw).status!=='ok'||decodeConsultAudits(JSON.stringify([audit])).status!=='ok')throw new Error('相談記録を確認してください');
  if(audit.status!=='received')throw new Error('回答を確認できない相談には判断を記録できません');
  if(!['consider','hold','reject'].includes(choice)||typeof at!=='string'||!Number.isFinite(Date.parse(at))||new Date(at).toISOString()!==at)throw new Error('判断と時刻を確認してください');
  const rows=raw===null?[]:JSON.parse(raw),index=rows.findIndex(item=>item.requestId===audit.requestId);
  if(index<0||JSON.stringify(rows[index])!==JSON.stringify(audit))throw new Error('確認後に記録が変わりました。再確認してください');
  const previous=rows[index].reviews||[];if(previous.length>=20)throw new Error('この相談の判断記録は上限20件です');
  if(Date.parse(at)<Date.parse(previous.at(-1)?.at||audit.receivedAt))throw new Error('端末の日時を確認してください');
  const review={choice,at};
  if(details!==undefined){if(!details||typeof details!=='object'||Array.isArray(details)||Object.keys(details).some(key=>!['reason','note'].includes(key))||typeof details.reason!=='string'||typeof details.note!=='string'||details.note.length>200)throw new Error('理由を確認してください');if(details.reason)review.reason=details.reason;if(details.note.trim())review.note=details.note.trim()}
  rows[index]={...rows[index],reviews:[...previous,review]};const next=JSON.stringify(rows);
  if(decodeConsultAudits(next).status!=='ok')throw new Error('判断記録を保存できません');return next;
}

// These are human-entered local reports, never evidence of facility acceptance.
export function createFacilityReport(input,now=Date.now()){
  const string=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.length<=max;
  if(!input||!/^\d{5}$/.test(input.area)||!string(input.name,200)||typeof input.address!=='string'||input.address.length>300)throw new Error('施設が不正です');
  if(!['checking','available','conditional','unavailable'].includes(input.status)||!string(input.organization,100)||!string(input.source,150))throw new Error('確認内容が不正です');
  if(typeof input.confirmedAt!=='string'||typeof input.expiresAt!=='string')throw new Error('確認日時と期限が不正です');
  const confirmed=parseZonedTimestamp(input.confirmedAt),expires=parseZonedTimestamp(input.expiresAt);
  if(!Number.isFinite(now)||confirmed===null||expires===null||confirmed>now||expires<=confirmed)throw new Error('確認日時と期限が不正です');
  if(!['unknown','clear_reported','unusable_reported'].includes(input.landing))throw new Error('着地点が不正です');
  if(typeof input.condition!=='string'||input.condition.length>300||(input.status==='conditional'&&!input.condition.trim()))throw new Error('条件が不正です');
  const supply=input.supply||null,quantity=input.quantity??null;
  if(!((supply===null&&quantity===null)||(['water','food','blanket','hygiene'].includes(supply)&&Number.isInteger(quantity)&&quantity>0&&quantity<=10000)))throw new Error('物資・数量が不正です');
  const result={version:2,area:input.area,name:input.name,address:input.address,status:input.status,confirmedAt:input.confirmedAt,expiresAt:input.expiresAt,organization:input.organization.trim(),source:input.source.trim(),supply,quantity,landing:input.landing,condition:input.condition.trim()};
  if(input.correctsId!==undefined){if(typeof input.correctsId!=='string'||!/^[-a-zA-Z0-9]{1,100}$/.test(input.correctsId))throw new Error('訂正元が不正です');result.correctsId=input.correctsId}
  return result;
}
export function facilityReportState(report,identity,now=Date.now()){
  if(!report||report.version!==2||!identity||['area','name','address'].some(key=>report[key]!==identity[key]))return 'unknown';
  try{const valid=createFacilityReport(report,now);return now>=Date.parse(valid.expiresAt)?'expired':valid.status}catch{return 'unknown'}
}
export function facilityReportDifferences(reports,identity,now=Date.now()){
  const active=(Array.isArray(reports)?reports:[]).filter(report=>['checking','available','conditional','unavailable'].includes(facilityReportState(report,identity,now)));
  const acceptance=new Set(active.map(item=>item.status).filter(status=>status!=='checking')).size>1;
  const landing=new Set(active.map(item=>item.landing).filter(value=>value!=='unknown')).size>1;
  const supplies=['water','food','blanket','hygiene'].filter(supply=>new Set(active.filter(item=>item.supply===supply).map(item=>item.quantity)).size>1);
  return {acceptance,landing,supplies};
}
export function validateConsultFacilityReports(rows,now=Date.now()){
 if(!Array.isArray(rows)||!rows.length||rows.length>20||!Number.isFinite(now))return false;
 const time=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
 if(!rows.every((r,i)=>r&&!Array.isArray(r)&&Object.keys(r).sort().join(',')==='confirmedAt,correctionIndex,correctionTargetOmitted,expiresAt,landing,quantity,status,supply'&&['checking','available','conditional','unavailable'].includes(r.status)&&['unknown','clear_reported','unusable_reported'].includes(r.landing)&&((r.supply===null&&r.quantity===null)||(['water','food','blanket','hygiene'].includes(r.supply)&&Number.isInteger(r.quantity)&&r.quantity>0&&r.quantity<=10000))&&time(r.confirmedAt)&&time(r.expiresAt)&&Date.parse(r.confirmedAt)<=now&&now<Date.parse(r.expiresAt)&&typeof r.correctionTargetOmitted==='boolean'&&(r.correctionIndex===null||Number.isInteger(r.correctionIndex)&&r.correctionIndex>=0&&r.correctionIndex<rows.length&&r.correctionIndex!==i&&!r.correctionTargetOmitted)))return false;
 return rows.every((_r,i)=>{const seen=new Set();let current=i;while(current!==null){if(seen.has(current))return false;seen.add(current);current=rows[current].correctionIndex}return true});
}
export function consultFacilityReports(raw,identity,now=Date.now()){
 const saved=decodeFacilityReports(raw,identity);if(saved.status!=='ok')return null;
 const active=saved.reports.filter(row=>['checking','available','conditional','unavailable'].includes(facilityReportState(row,identity,now))),indices=new Map(active.map((row,index)=>[row.id,index]));
 const rows=active.map(row=>({status:row.status,confirmedAt:row.confirmedAt,expiresAt:row.expiresAt,supply:row.supply,quantity:row.quantity,landing:row.landing,correctionIndex:row.correctsId&&indices.has(row.correctsId)?indices.get(row.correctsId):null,correctionTargetOmitted:!!row.correctsId&&!indices.has(row.correctsId)}));
 return validateConsultFacilityReports(rows,now)?rows:null;
}
export function decodeFacilityReports(raw,identity){
  if(raw===null||raw===undefined)return {status:'ok',reports:[]};
  try{
    if(typeof raw!=='string'||raw.length>100000||!identity)throw new Error('storage');
    const decoded=JSON.parse(raw),rows=Array.isArray(decoded)?decoded:[{id:'legacy-v2',...decoded}];
    if(rows.length>20)throw new Error('count');const ids=new Set();
    const reports=rows.map(row=>{
      if(!row||row.version!==2||typeof row.id!=='string'||!/^[-a-zA-Z0-9]{1,100}$/.test(row.id)||ids.has(row.id)||['area','name','address'].some(key=>row[key]!==identity[key]))throw new Error('identity');
      ids.add(row.id);const report={id:row.id,...createFacilityReport(row,Date.parse(row.confirmedAt))};if(Object.keys(row).some(key=>!Object.hasOwn(report,key)))throw new Error('unknown field');return report;
    });
    const byId=new Map(reports.map(report=>[report.id,report]));
    for(const report of reports){const visited=new Set([report.id]);let target=report.correctsId;while(target!==undefined){if(visited.has(target)||!byId.has(target))throw new Error('correction');visited.add(target);target=byId.get(target).correctsId}}
    return {status:'ok',reports};
  }catch{return {status:'corrupt',reports:[]}}
}
export function appendFacilityReport(raw,report,identity){
  const decoded=decodeFacilityReports(raw,identity);
  if(decoded.status!=='ok'||decoded.reports.length>=20)throw new Error('保存済み報告の確認、または件数の整理が必要です');
  const content=value=>JSON.stringify(createFacilityReport(value,Date.parse(value.confirmedAt)));
  if(decoded.reports.some(existing=>content(existing)===content(report)))throw new Error('同じ内容の報告が既にあります');
  const next=JSON.stringify([report,...decoded.reports]);
  if(decodeFacilityReports(next,identity).status!=='ok')throw new Error('報告の保存形式が不正です');
  return next;
}

// A human receipt report is separate from the virtual drone's arrival or unload state.
export function createFacilityReceipt(input,now=Date.now()){
  const text=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.length<=max;
  if(!input||!/^\d{5}$/.test(input.area)||!text(input.name,200)||typeof input.address!=='string'||input.address.length>300||!text(input.source,150))throw new Error('施設または確認先が不正です');
  const reportedAt=parseZonedTimestamp(input.reportedAt);if(reportedAt===null||!Number.isFinite(now)||reportedAt>now)throw new Error('報告日時が不正です');
  if(!['water','food','blanket','hygiene'].includes(input.supply)||!Number.isInteger(input.expected)||input.expected<1||input.expected>10000)throw new Error('物資または予定数量が不正です');
  if(!['unconfirmed','not_received','received','partial','damaged'].includes(input.status))throw new Error('受領状態が不正です');
  const received=input.received??null;
  if(input.status==='unconfirmed'?received!==null:!Number.isInteger(received)||received<0||received>input.expected)throw new Error('受領数量が不正です');
  if((input.status==='received'&&received!==input.expected)||(input.status==='partial'&&(received<=0||received>=input.expected))||(input.status==='not_received'&&received!==0))throw new Error('受領状態と数量が一致しません');
  if(typeof input.note!=='string'||input.note.length>300)throw new Error('補足が不正です');
  return {version:1,area:input.area,name:input.name,address:input.address,reportedAt:input.reportedAt,source:input.source.trim(),supply:input.supply,expected:input.expected,received,status:input.status,note:input.note.trim()};
}
function receiptFollowup(input,earliest,now){
  if(!input||Object.keys(input).sort().join(',')!=='at,kind,note,state'||!['confirm','redelivery','handoff'].includes(input.kind)||!['planned','reported_done','cancelled'].includes(input.state)||typeof input.at!=='string'||!Number.isFinite(Date.parse(input.at))||new Date(input.at).toISOString()!==input.at||Date.parse(input.at)<earliest||Date.parse(input.at)>now||typeof input.note!=='string'||input.note.length>200)throw new Error('対応記録を確認してください');
  return {kind:input.kind,state:input.state,at:input.at,note:input.note.trim()};
}
export function decodeFacilityReceipts(raw,identity){
  if(raw===null||raw===undefined)return {status:'ok',receipts:[]};
  try{
    if(typeof raw!=='string'||raw.length>100000||!identity)throw new Error('storage');const rows=JSON.parse(raw);
    if(!Array.isArray(rows)||rows.length>20)throw new Error('count');const ids=new Set();
    const receipts=rows.map(row=>{if(!row||row.version!==1||typeof row.id!=='string'||!/^[-a-zA-Z0-9]{1,100}$/.test(row.id)||ids.has(row.id)||['area','name','address'].some(key=>row[key]!==identity[key]))throw new Error('identity');ids.add(row.id);const receipt={id:row.id,...createFacilityReceipt(row,Date.parse(row.reportedAt))};if(Object.keys(row).some(key=>key!=='followups'&&!Object.hasOwn(receipt,key)))throw new Error('unknown field');if(Object.hasOwn(row,'followups')){if(!Array.isArray(row.followups)||!row.followups.length||row.followups.length>20)throw new Error('followups');let earliest=Date.parse(row.reportedAt);receipt.followups=row.followups.map(action=>{const valid=receiptFollowup(action,earliest,Date.parse(action.at));earliest=Date.parse(valid.at);if(JSON.stringify(valid)!==JSON.stringify(action))throw new Error('followup');return valid})}return receipt});
    return {status:'ok',receipts};
  }catch{return {status:'corrupt',receipts:[]}}
}
export function appendFacilityReceipt(raw,receipt,identity){
  const saved=decodeFacilityReceipts(raw,identity);if(saved.status!=='ok'||saved.receipts.length>=20)throw new Error('保存済み受領報告の確認、または件数の整理が必要です');
  const content=value=>JSON.stringify(createFacilityReceipt(value,Date.parse(value.reportedAt)));
  if(saved.receipts.some(value=>content(value)===content(receipt)))throw new Error('同じ内容の受領報告が既にあります');
  const next=JSON.stringify([receipt,...saved.receipts]);if(decodeFacilityReceipts(next,identity).status!=='ok')throw new Error('受領報告の保存形式が不正です');return next;
}
export function appendFacilityReceiptFollowup(raw,receipt,identity,action,now=Date.now()){
  const decoded=decodeFacilityReceipts(raw,identity);if(decoded.status!=='ok'||!Number.isFinite(now))throw new Error('受領報告を確認してください');
  const rows=JSON.parse(raw||'[]'),index=rows.findIndex(row=>row.id===receipt?.id);
  if(index<0||JSON.stringify(rows[index])!==JSON.stringify(receipt))throw new Error('確認後に報告が変わりました。再確認してください');
  const previous=rows[index].followups||[];if(previous.length>=20)throw new Error('この報告の対応記録は上限20件です');
  const valid=receiptFollowup(action,Date.parse(previous.at(-1)?.at||receipt.reportedAt),now);
  rows[index]={...rows[index],followups:[...previous,valid]};const next=JSON.stringify(rows);
  if(decodeFacilityReceipts(next,identity).status!=='ok')throw new Error('対応記録を保存できません');return next;
}

// Separate scenario data from time-bounded, unverified human reports.
export function createFloodFieldReport(input,now=Date.now()){
  const text=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.length<=max;
  if(!input||typeof input.id!=='string'||!/^[-a-zA-Z0-9]{1,100}$/.test(input.id)||typeof input.area!=='string'||!/^\d{5}$/.test(input.area)||!text(input.name,200)||typeof input.address!=='string'||input.address.length>300)throw new Error('施設または報告IDが不正です');
  if(!['water_seen','no_water_seen','uncertain'].includes(input.status)||!['facility_point','nearby_road','unspecified'].includes(input.scope)||!text(input.organization,100)||!text(input.source,150))throw new Error('報告内容が不正です');
  if(typeof input.observedAt!=='string'||typeof input.expiresAt!=='string'||!Number.isFinite(now))throw new Error('日時が不正です');
  const observed=parseZonedTimestamp(input.observedAt),expires=parseZonedTimestamp(input.expiresAt);
  if(observed===null||expires===null||observed>now||expires<=observed)throw new Error('報告時刻または再確認期限が不正です');
  if(typeof input.note!=='string'||input.note.length>300)throw new Error('補足が不正です');
  return {version:1,id:input.id,area:input.area,name:input.name,address:input.address,provenance:'human_report',status:input.status,scope:input.scope,observedAt:input.observedAt,expiresAt:input.expiresAt,organization:input.organization.trim(),source:input.source.trim(),note:input.note.trim()};
}
export function decodeFloodFieldReports(raw,identity){
  if(raw===null||raw===undefined)return {status:'ok',reports:[]};
  try{
    if(typeof raw!=='string'||raw.length>100000||!identity)throw new Error('storage');const rows=JSON.parse(raw);
    if(!Array.isArray(rows)||rows.length>20)throw new Error('count');const ids=new Set();
    const reports=rows.map(row=>{if(!row||row.version!==1||row.provenance!=='human_report'||ids.has(row.id)||['area','name','address'].some(key=>row[key]!==identity[key]))throw new Error('identity');ids.add(row.id);return createFloodFieldReport(row,Date.parse(row.observedAt))});
    return {status:'ok',reports};
  }catch{return {status:'corrupt',reports:[]}}
}
export function appendFloodFieldReport(raw,report,identity){
  const saved=decodeFloodFieldReports(raw,identity);if(saved.status!=='ok'||saved.reports.length>=20)throw new Error('保存済み報告の確認または件数の整理が必要です');
  const content=value=>{const normalized=createFloodFieldReport(value,Date.parse(value.observedAt));delete normalized.id;return JSON.stringify(normalized)};
  if(saved.reports.some(item=>content(item)===content(report)))throw new Error('同じ内容の報告が既にあります');
  const next=JSON.stringify([report,...saved.reports]);if(decodeFloodFieldReports(next,identity).status!=='ok')throw new Error('報告の保存形式が不正です');return next;
}
export function buildFloodComparison({identity,forecast,raw,now=Date.now()}={}){
  const validIdentity=identity&&typeof identity.area==='string'&&/^\d{5}$/.test(identity.area)&&typeof identity.name==='string'&&identity.name.trim()&&typeof identity.address==='string';
  const depth=validIdentity?mapFloodContext(forecast,identity.name,identity.address):null;
  const forecastState=!validIdentity?'unknown':forecast?.shelter===identity.name&&forecast?.address===identity.address?forecast.state:'unknown';
  const scenario={kind:'scenario',depth,state:depth?'available':['loading','error','unknown'].includes(forecastState)?forecastState:'unknown',retrievedAt:depth&&typeof forecast.checkedAt==='string'&&Number.isFinite(Date.parse(forecast.checkedAt))?forecast.checkedAt:null,updatedAt:null,source:'https://disaportal.gsi.go.jp/hazardmap/copyright/opendata.html'};
  const saved=validIdentity?decodeFloodFieldReports(raw,identity):{status:'unavailable',reports:[]};
  const reports=saved.reports.map(report=>({...report,state:!Number.isFinite(now)||now<Date.parse(report.observedAt)?'time_unknown':now>=Date.parse(report.expiresAt)?'expired':'reported'}));
  const differingScopes=['facility_point','nearby_road'].filter(scope=>{const active=reports.filter(row=>row.state==='reported'&&row.scope===scope);return active.some(row=>row.status==='water_seen')&&active.some(row=>row.status==='no_water_seen')});
  return {forecast:scenario,reportsStatus:saved.status,reports,differingScopes};
}
// Only the unverified, in-term statements are sent; identifying free text stays local.
export function validateConsultFieldReports(value,now=Date.now()){
 if(!Array.isArray(value)||!value.length||value.length>20||!Number.isFinite(now))return false;
 const validTime=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
 return value.every(row=>row&&!Array.isArray(row)&&Object.keys(row).sort().join(',')==='expiresAt,observedAt,scope,status'&&['water_seen','no_water_seen','uncertain'].includes(row.status)&&['facility_point','nearby_road','unspecified'].includes(row.scope)&&validTime(row.observedAt)&&validTime(row.expiresAt)&&Date.parse(row.observedAt)<=now&&now<Date.parse(row.expiresAt)&&Date.parse(row.expiresAt)>Date.parse(row.observedAt));
}
export function consultFieldReports(raw,identity,now=Date.now()){
 const result=buildFloodComparison({identity,raw,now});if(result.reportsStatus!=='ok')return null;
 const rows=result.reports.filter(row=>row.state==='reported').map(({status,scope,observedAt,expiresAt})=>({status,scope,observedAt,expiresAt}));
 return validateConsultFieldReports(rows,now)?rows:null;
}

async function openHistoryVersions(indexedDB,signal){
 if(!indexedDB?.open)throw new Error('記録の照合機能が使えないため更新できません');
 const db=await new Promise((resolve,reject)=>{
  let settled=false;const request=indexedDB.open('muse-history-consistency-v1',1);
  const fail=()=>{if(!settled){settled=true;reject(new Error('記録の照合機能を開けません'))}};
  signal.addEventListener('abort',fail,{once:true});
  request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('history'))request.result.createObjectStore('history',{keyPath:'key'})};
  request.onerror=fail;request.onblocked=fail;
  request.onsuccess=()=>{if(settled){request.result.close();return}settled=true;resolve(request.result)};
 });
 return {
  read(key){return new Promise((resolve,reject)=>{const tx=db.transaction('history','readonly'),req=tx.objectStore('history').get(key);req.onsuccess=()=>{const row=req.result;if(row===undefined)resolve({exists:false});else if(row&&row.key===key&&(row.value===null||typeof row.value==='string'))resolve({exists:true,value:row.value});else reject(new Error('照合記録が不正です'))};req.onerror=()=>reject(new Error('照合記録を読み取れません'));tx.onabort=()=>reject(new Error('照合記録を読み取れません'))})},
  write(key,value){return new Promise((resolve,reject)=>{const tx=db.transaction('history','readwrite');tx.objectStore('history').put({key,value});tx.oncomplete=()=>resolve();tx.onabort=tx.onerror=()=>reject(new Error('照合記録を保存できません'))})},
  close(){db.close()}
 };
}
function localHistoryInfo(key){
 if(typeof key!=='string')return null;
 if(key==='muse-map-consult-audits-v1')return {type:'consult'};
 if(key==='muse-large-fleet-history-v1')return {type:'single'};
 if(key==='muse-photo-reviews-v1')return {type:'single'};
 if(key==='muse-tabletop-training-v1')return {type:'single'};
 if(key==='muse-historical-reviews-v1')return {type:'single'};
 if(/^muse-infrastructure-reports-v1:\d{5}$/.test(key))return {type:'single'};
 if(/^muse\.teamDetour\.[^\u0000-\u001f\u007f]{1,150}$/u.test(key))return {type:'single'};
 const risk=key.match(/^muse-risk-review-v1:(\d{5})$/);if(risk){try{areaByCode(risk[1]);return {type:'risk',area:risk[1]}}catch{return null}}
 const river=key.match(/^muse-(river-log-v2|river-note-v1):([a-zA-Z0-9-]+)$/);
 if(river){const station=riverPilotStations('13118').find(item=>item.id===river[2]);return station?{type:river[1]==='river-log-v2'?'river':'single',station}:null}
 const prefix='muse-pilot-facility-v1:';if(!key.startsWith(prefix))return null;
 let base=key,type='single';for(const [suffix,kind] of [[':report-v2','facility'],[':receipt-v1','receipt'],[':flood-field-v1','field']])if(base.endsWith(suffix)){base=base.slice(0,-suffix.length);type=kind;break}
 try{const parts=JSON.parse(base.slice(prefix.length));if(!Array.isArray(parts)||parts.length!==3||pilotFacilityKey(...parts)!==base)return null;return {type,identity:{area:parts[0],name:parts[1],address:parts[2]}}}catch{return null}
}
export function appendLargeFleetRecord(raw,record){
 const valid=row=>row&&typeof row.id==='string'&&/^[-a-zA-Z0-9]{1,100}$/.test(row.id)&&typeof row.area==='string'&&row.area.length>0&&row.area.length<=200&&typeof row.startedAt==='string'&&Number.isFinite(Date.parse(row.startedAt))&&typeof row.finishedAt==='string'&&Number.isFinite(Date.parse(row.finishedAt))&&Number.isInteger(row.total)&&row.total>=0&&row.total<=100&&Number.isInteger(row.stopped)&&row.stopped>=0&&row.stopped<=row.total&&(row.delivered===null||Number.isInteger(row.delivered)&&row.delivered>=0&&row.delivered<=row.total)&&Array.isArray(row.units)&&row.units.length===row.total&&Array.isArray(row.events);
 if(raw!==null&&typeof raw!=='string'||!valid(record))throw new Error('仮想配送の記録を確認してください');
 let records;try{records=raw===null?[]:JSON.parse(raw)}catch{throw new Error('保存済み記録を読み取れません')}
 if(!Array.isArray(records)||records.length>20||records.some(row=>!valid(row))||new Set(records.map(row=>row.id)).size!==records.length)throw new Error('保存済み記録を確認してください');
 const old=records.find(row=>row.id===record.id);if(old){if(JSON.stringify(old)===JSON.stringify(record))return raw;throw new Error('同じ記録IDで異なる内容があります')}
 if(records.length>=20)throw new Error('保存上限20件です。記録を保存して整理してください');
 return JSON.stringify([record,...records]);
}
export function recordFleetComparisonReview(raw,snapshot,review){
 if(typeof raw!=='string'||!snapshot||!review||typeof snapshot.id!=='string')throw new Error('比較記録を確認してください');
 let rows;try{rows=JSON.parse(raw)}catch{throw new Error('比較記録を読み取れません')}
 if(!Array.isArray(rows)||rows.length>20||rows.filter(row=>row?.id===snapshot.id).length!==1)throw new Error('比較記録を確認してください');
 if(rows.find(row=>row?.area===snapshot.area&&Number.isInteger(row.total))?.id!==snapshot.id)throw new Error('新しい記録があります。最新の記録を確認してください');
 const index=rows.findIndex(row=>row.id===snapshot.id);if(JSON.stringify(rows[index])!==JSON.stringify(snapshot))throw new Error('確認後に記録が変わりました');
 appendLargeFleetRecord(null,snapshot);
 const c=snapshot.comparison;if(!c||!c.baseline||!['A','B','none'].includes(c.baseline.choice))throw new Error('定型案が記録されていません');
 const validReview=item=>item&&['muse','baseline','hold','undecided'].includes(item.choice)&&['','missing_data','outdated_data','conflicting_data','needs_review','other'].includes(item.reason)&&typeof item.note==='string'&&item.note===item.note.trim()&&item.note.length<=200&&typeof item.at==='string'&&Number.isFinite(Date.parse(item.at))&&new Date(item.at).toISOString()===item.at;
 const prior=snapshot.comparisonReviews??[];if(!Array.isArray(prior)||prior.length>=20||prior.some(item=>!validReview(item))||!validReview(review))throw new Error('判断内容を確認してください');
 if(Date.parse(review.at)<Date.parse(prior.at(-1)?.at||snapshot.finishedAt))throw new Error('端末の時刻を確認してください');
 if(review.choice==='muse'&&(!c.reply||c.error||!['A','B','none'].includes(c.reply?.nagi?.choice)))throw new Error('今回のMuse回答を確認できません');
 rows[index]={...snapshot,comparisonReviews:[...prior,{choice:review.choice,reason:review.reason,note:review.note,at:review.at}]};return JSON.stringify(rows);
}
// Serialize writers and wait until this tab observes the last committed value.
export async function updateLocalHistory({storage,locks,versions,key,update,stillCurrent=()=>true,expected,waitMs=5000}){
 if(!storage||typeof locks?.request!=='function')throw new Error('同時編集の保護を利用できないため、保存・削除できません');
 if(!localHistoryInfo(key)||typeof update!=='function'||typeof stillCurrent!=='function'||!Number.isFinite(waitMs)||waitMs<=0)throw new Error('記録の更新条件が不正です');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),waitMs);let mismatch=false;
 try{
  return await locks.request(`muse-history:${key}`,{mode:'exclusive',signal:controller.signal},async()=>{
   if(controller.signal.aborted)throw new Error('別の画面の更新が終わりませんでした');
   if(!stillCurrent())throw new Error('地域または観測所が変更されたため更新しませんでした');
   const guard=versions||await openHistoryVersions(globalThis.indexedDB,controller.signal);
   try{
    let committed=await guard.read(key),current=storage.getItem(key);
    if(expected!==undefined&&current!==expected)throw new Error('確認後に記録が変わりました。内容を再確認してください');
    if(!committed.exists){await guard.write(key,current);committed={exists:true,value:current}}
    while(current!==committed.value){
     mismatch=true;
     if(controller.signal.aborted)throw new Error('記録の照合が完了しませんでした');
     if(!stillCurrent())throw new Error('地域または観測所が変更されたため更新しませんでした');
     await new Promise(resolve=>setTimeout(resolve,25));current=storage.getItem(key);
    }
    mismatch=false;if(controller.signal.aborted)throw new Error('記録の照合が完了しませんでした');
    if(!stillCurrent())throw new Error('地域または観測所が変更されたため更新しませんでした');
    if(expected!==undefined&&current!==expected)throw new Error('確認後に記録が変わりました。内容を再確認してください');
    const next=update(current);if(next!==null&&typeof next!=='string')throw new Error('記録の更新結果が不正です');
    clearTimeout(timer);
    if(next===null)storage.removeItem(key);else storage.setItem(key,next);
    try{await guard.write(key,next)}catch{throw new Error('記録は変更された可能性がありますが照合に失敗しました。手動で復旧してください')}
   }finally{if(!versions)guard.close()}
  });
 }catch(error){if(controller.signal.aborted)throw new Error(mismatch?'記録が一致しないため上書きせず中止しました。内容を確認してください':'別の画面の更新が終わりませんでした。もう一度お試しください');throw error}
 finally{clearTimeout(timer)}
}
export function mergeLocalHistories(key,local,committed){
 const info=localHistoryInfo(key);if(!info||![local,committed].every(v=>v===null||typeof v==='string'))return {mode:'unreadable'};
 if(info.type==='single')return {mode:local===committed?'same':'manual'};
 function parse(raw){
  if(raw===null)return [];
  let checked;if(info.type==='risk')checked=decodeRiskReviews(raw,info.area);else if(info.type==='river')checked=decodeRiverLog(raw,info.station);else if(info.type==='consult')checked=decodeConsultAudits(raw);else if(info.type==='facility')checked=decodeFacilityReports(raw,info.identity);else if(info.type==='receipt')checked=decodeFacilityReceipts(raw,info.identity);else checked=decodeFloodFieldReports(raw,info.identity);
  if(checked.status!=='ok')throw new Error();
  const parsed=JSON.parse(raw);return Array.isArray(parsed)?parsed:info.type==='facility'?[{id:'legacy-v2',...parsed}]:(()=>{throw new Error()})();
 }
 try{
  const left=parse(local),right=parse(committed),merged=[],byId=new Map(),seen=new Set();
  for(const item of [...left,...right]){const value=info.type==='river'?JSON.stringify(Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b)))):JSON.stringify(item),id=info.type==='consult'?item.requestId:item.id;if(seen.has(value))continue;if(typeof id==='string'&&byId.has(id)&&byId.get(id)!==value)return {mode:'id_conflict'};if(typeof id==='string')byId.set(id,value);seen.add(value);merged.push(item)}
  if(merged.length>20)return {mode:'too_many',localCount:left.length,committedCount:right.length};
  const value=JSON.stringify(merged);parse(value);
  return {mode:local===committed?'same':'merge',value,localCount:left.length,committedCount:right.length,mergedCount:merged.length,restoresDeleted:(local===null)!==(committed===null)};
 }catch{return {mode:'unreadable'}}
}
async function withHistoryInspection({storage,locks,versions,key,stillCurrent=()=>true,waitMs=5000},action){
 if(!storage||typeof locks?.request!=='function'||!localHistoryInfo(key)||typeof stillCurrent!=='function'||!Number.isFinite(waitMs)||waitMs<=0)throw new Error('記録の照合機能を利用できません');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),waitMs);
 try{return await locks.request(`muse-history:${key}`,{mode:'exclusive',signal:controller.signal},async()=>{
  if(controller.signal.aborted||!stillCurrent())throw new Error('対象が変わったため中止しました');
  const guard=versions||await openHistoryVersions(globalThis.indexedDB,controller.signal);
  try{const committed=await guard.read(key),local=storage.getItem(key);if(controller.signal.aborted||!stillCurrent())throw new Error('対象が変わったため中止しました');return await action({guard,committed,local,signal:controller.signal,stopTimeout:()=>clearTimeout(timer)})}finally{if(!versions)guard.close()}
 })}catch(error){if(controller.signal.aborted)throw new Error('記録の照合が時間内に完了しませんでした');throw error}finally{clearTimeout(timer)}
}
export async function inspectLocalHistory(options){
 return withHistoryInspection(options,async({guard,committed,local})=>{
  const pointer=await guard.read(`recovery-latest:${options.key}`);let latestBackup=null;
  if(pointer.exists&&typeof pointer.value==='string'&&/^[-a-zA-Z0-9]{1,100}$/.test(pointer.value)){
   const stored=await guard.read(`recovery-backup:${options.key}:${pointer.value}`);
   try{const backup=JSON.parse(stored.value);if(stored.exists&&backup.version===1&&backup.key===options.key&&[backup.local,backup.committed].every(v=>v===null||typeof v==='string'))latestBackup={id:pointer.value,...backup}}catch{}
  }
  return {key:options.key,local,committedExists:committed.exists,committed:committed.exists?committed.value:null,comparison:committed.exists?mergeLocalHistories(options.key,local,committed.value):{mode:'no_checkpoint'},latestBackup};
 });
}
export async function reconcileLocalHistory({preview,backupId,...options}){
 if(!preview||preview.key!==options.key||!preview.committedExists||typeof backupId!=='string'||!/^[-a-zA-Z0-9]{1,100}$/.test(backupId))throw new Error('確認内容が不正です');
 return withHistoryInspection(options,async({guard,committed,local,signal,stopTimeout})=>{
  if(!committed.exists||local!==preview.local||committed.value!==preview.committed)throw new Error('確認後に記録が変わりました。もう一度確認してください');
  const merged=mergeLocalHistories(options.key,local,committed.value);if(merged.mode!=='merge')throw new Error('この記録は自動統合できません');
  const backupKey=`recovery-backup:${options.key}:${backupId}`;
  if((await guard.read(backupKey)).exists)throw new Error('バックアップIDが重複しています');
  if(signal.aborted||(options.stillCurrent&&!options.stillCurrent()))throw new Error('対象が変わったため中止しました');
  stopTimeout();await guard.write(backupKey,JSON.stringify({version:1,key:options.key,local,committed:committed.value,createdAt:new Date().toISOString()}));
  await guard.write(`recovery-latest:${options.key}`,backupId);
  if(options.stillCurrent&&!options.stillCurrent())throw new Error('対象が変わったため統合せず、元の記録を保持しました');
  await guard.write(options.key,merged.value);
  try{options.storage.setItem(options.key,merged.value)}catch{throw new Error('統合記録と元データは照合領域に保存されましたが、画面側の更新に失敗しました')}
  return {backupId,count:merged.mergedCount,restoresDeleted:merged.restoresDeleted};
 });
}
export function createRiskReview(input){
 const stamp=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
 try{areaByCode(input?.area)}catch{throw new Error('地域を確認してください')}
 if(!['inundation','flood'].includes(input?.product)||!['yellow','red','purple','black','other','unconfirmed'].includes(input?.appearance)||!stamp(input?.checkedAt)||!stamp(input?.recordedAt)||Date.parse(input.checkedAt)>Date.parse(input.recordedAt))throw new Error('種類・表示・確認日時を確認してください');
 if(Object.hasOwn(input,'reviewBy')&&input.reviewBy!==null&&(!stamp(input.reviewBy)||Date.parse(input.reviewBy)<=Date.parse(input.recordedAt)))throw new Error('再確認の予定日時を確認してください');
 const result={kind:'manual-risk-review',area:input.area,product:input.product,appearance:input.appearance,checkedAt:input.checkedAt,recordedAt:input.recordedAt};
 if(Object.hasOwn(input,'reviewBy'))result.reviewBy=input.reviewBy;
 return result;
}
export function riskReviewState(record,now=Date.now()){
 if(!Number.isFinite(now)||now<Date.parse(record.recordedAt))return 'time_unknown';
 if(record.reviewBy==null)return 'review_unspecified';
 return now>=Date.parse(record.reviewBy)?'review_due':'review_due_later';
}
export function decodeRiskReviews(raw,area){
 if(raw==null)return {status:'ok',records:[]};
 try{
  const records=JSON.parse(raw);if(!Array.isArray(records)||records.length>20)throw new Error();
  for(const record of records){if(record?.area!==area||record?.kind!=='manual-risk-review'||JSON.stringify(createRiskReview(record))!==JSON.stringify(record))throw new Error()}
  return {status:'ok',records};
 }catch{return {status:'corrupt',records:[]}}
}
export function appendRiskReview(raw,record,area){
 const history=decodeRiskReviews(raw,area),clean=createRiskReview(record);
 if(history.status!=='ok'||history.records.length>=20||clean.area!==area)throw new Error('保存済み記録を確認してください');
 return JSON.stringify([clean,...history.records]);
}
export function buildPilotEvidenceLedger({identity,areaReady=false,evidence={},forecast,facilityRaw,receiptRaw,fieldRaw,riverStationId,riverRaw,riskRaw,infrastructureRaw,floodFeed=null,floodBulletins=[],facilityPosition=null,gsiScenario=null,observationText='',observation=null,fetchStartedAt=null,now=Date.now()}={}){
 const validArea=typeof identity?.area==='string'&&/^\d{5}$/.test(identity.area),ready=areaReady===true&&validArea;
 const selected=ready&&!!pilotFacilityKey(identity.area,identity.name,identity.address);
 const time=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?value:null;
 const start=ready?time(fetchStartedAt):null,scope=ready?identity.area:null;
 const permitted={buildings:['loading','available','error'],shelters:['loading','available','error'],weather:['loading','current','stale','error']};
 const state=id=>ready&&permitted[id].includes(evidence?.[id])?evidence[id]:'unknown';
 const o=observation,observed=time(o?.observedAt),retrieved=time(o?.retrievedAt);
 const measuredRain=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;
 const normalizedObservation=o?{...o,rain1h:measuredRain(o.rain1h),rain24h:measuredRain(o.rain24h)}:null;
 const usable=ready&&mapObservationContext(normalizedObservation,scope,now,{includeAccumulatedRain:true})!==null&&typeof o.station==='string'&&o.station.trim().length>0&&o.station.length<=100&&typeof o.referenceLabel==='string'&&o.referenceLabel.length<=100&&o.referenceLabel.trim().length>0&&Number.isFinite(o.latitude)&&Math.abs(o.latitude)<=90&&Number.isFinite(o.longitude)&&Math.abs(o.longitude)<=180&&observed&&retrieved;
 const obs=usable?{state:'observed',station:o.station,stationId:o.stationId,referenceLabel:o.referenceLabel,distance:o.distance,rain:o.rain,rain1h:measuredRain(o.rain1h),rain24h:measuredRain(o.rain24h),wind:o.wind,observedAt:observed,retrievedAt:retrieved,detail:''}:{state:ready&&o===null&&typeof observationText==='string'&&observationText.trim()?'detail_only':'unknown',detail:ready&&o===null&&typeof observationText==='string'?observationText.slice(0,600):'',observedAt:null};
 const missingFeedType=floodFeed?.feedType===undefined,feedType=missingFeedType?(floodFeed?.state==='available'?'long':null):['long','recent'].includes(floodFeed.feedType)?floodFeed.feedType:null;
 let feed={state:(feedType||missingFeedType)&&['loading','error'].includes(floodFeed?.state)?floodFeed.state:'unknown',feedType,updatedAt:null,retrievedAt:null};
 const u=parseZonedTimestamp(floodFeed?.updatedAt),r=parseZonedTimestamp(floodFeed?.retrievedAt),feedUpdated=u===null?null:floodFeed.updatedAt,feedRetrieved=r===null?null:floodFeed.retrievedAt;
 if(feedType&&floodFeed?.state==='available'&&Number.isFinite(now)&&feedUpdated&&feedRetrieved&&u<=now+300000&&r<=now+300000&&u<=r+300000&&Number.isSafeInteger(floodFeed.count)&&floodFeed.count>=0&&Number.isSafeInteger(floodFeed.skipped)&&floodFeed.skipped>=0){
  const maxAge=feedType==='recent'?300000:7200000;
  feed={state:now-u>=maxAge||now-r>=maxAge?'stale':floodFeed.skipped?'partial':'available',feedType,updatedAt:feedUpdated,retrievedAt:feedRetrieved,count:floodFeed.count,skipped:floodFeed.skipped};
 }
 const rows=[
  {id:'jma:flood-feed',kind:'public_flood_feed',scope:'national',sourceUrl:'https://www.jma.go.jp/bosai/flood/',locationMatch:'not-assessed',zeroDoesNotProveNoForecast:true,latestStatus:'not-established',...feed},
  {id:'map:buildings',kind:'public_model',scope,state:state('buildings'),sourceUrl:'https://www.mlit.go.jp/plateau/',fetchStartedAt:start,updatedAt:null},
  {id:'map:shelters',kind:'public_facilities',scope,state:state('shelters'),sourceUrl:'https://www.gsi.go.jp/bousaichiri/hinanbasho.html',fetchStartedAt:start,updatedAt:null},
  {id:'map:warning',kind:'public_warning',scope,state:state('weather'),sourceUrl:'https://www.jma.go.jp/bosai/warning/',updatedAt:null},
  {id:'map:observation',kind:'public_observation',scope:ready?'observation_reference':null,sourceUrl:'https://www.jma.go.jp/bosai/amedas/',updatedAt:null,...obs}
 ];
 const seenBulletins=new Set();
 for(const item of Array.isArray(floodBulletins)?floodBulletins:[]){
  if(!Number.isSafeInteger(item?.index)||item.index<0||seenBulletins.has(item.index)||typeof item.url!=='string'||!/^https:\/\/www\.data\.jma\.go\.jp\/developer\/xml\/data\/[0-9]{14}_[0-9]+_VXKO(?:5\d|6\d|7\d|8\d)_[0-9]+\.xml$/.test(item.url))continue;
  const fetchMs=parseZonedTimestamp(item.retrievedAt),issueMs=parseZonedTimestamp(item.issuedAt),fetched=fetchMs===null?null:item.retrievedAt,issued=issueMs===null?null:item.issuedAt;if(!fetched)continue;
  const badTime=!Number.isFinite(now)||issueMs===null||fetchMs>now+300000||issueMs>fetchMs+300000;
  const state=badTime?'time_unknown':now-fetchMs>=7200000?'stale':'available';
  const waterFields={station:200,code:200,stationCodeType:200,location:200,time:200,label:200,value:100,unit:30,condition:100},eligible=item.controlStatus==='通常'&&['発表','訂正'].includes(item.bulletinType);
  const validWater=eligible&&Array.isArray(item.water?.rows)&&item.water.rows.length<=100&&typeof item.water.truncated==='boolean'&&item.water.rows.every(row=>row&&Object.entries(waterFields).every(([key,max])=>typeof row[key]==='string'&&row[key].length<=max));
  const waterStatus=!eligible?'suppressed':validWater?'included':'unknown';
  const facility=selected&&facilityPosition?.name===identity.name&&facilityPosition?.address===identity.address?facilityPosition:null;
  const stationContexts=validWater?item.water.rows.map(row=>{
   const match=ready?floodBulletinStationContext(row,scope,facility):{state:'unknown'};
   if(match.state!=='matched')return {state:'unknown'};
   return {state:'matched',stationId:match.station.id,latitude:match.station.latitude,longitude:match.station.longitude,sourceUrl:match.station.metadataUrl,distanceMeters:match.distance,targetFacility:match.distance===null?null:identity.name};
  }):[];
  const water=validWater?{water:{rows:item.water.rows.map(row=>Object.fromEntries(Object.keys(waterFields).map(key=>[key,row[key]]))),stationContexts,truncated:item.water.truncated}}:{};
  seenBulletins.add(item.index);rows.push({id:`jma:bulletin:${item.index}`,kind:'public_flood_bulletin',scope:'national',sourceUrl:item.url,state,issuedAt:issued,retrievedAt:fetched,bulletinType:['発表','訂正','取消'].includes(item.bulletinType)?item.bulletinType:null,controlStatus:['通常','訓練','試験'].includes(item.controlStatus)?item.controlStatus:null,event:typeof item.event==='string'&&/^\d{1,30}$/.test(item.event)?item.event:null,serial:typeof item.serial==='string'&&/^\d{1,20}$/.test(item.serial)?item.serial:null,office:typeof item.office==='string'&&item.office.trim()&&item.office.length<=100?item.office:null,locationMatch:'not-assessed',latestStatus:'not-established',waterStatus,...water});
 }
 const comparison=selected?buildFloodComparison({identity,forecast,raw:fieldRaw,now}):null;
 rows.push({id:'scenario:facility',kind:'scenario',scope:selected?identity.name:null,state:comparison?.forecast.state||'unknown',value:comparison?.forecast.depth||null,retrievedAt:comparison?.forecast.retrievedAt||null,updatedAt:null,sourceUrl:'https://disaportal.gsi.go.jp/hazardmap/copyright/opendata.html'});
 let scenarioValues=null,scenarioTime=null;
 const matching=selected&&facilityPosition?.name===identity.name&&facilityPosition?.address===identity.address&&gsiScenario?.identity?.area===identity.area&&gsiScenario?.identity?.name===identity.name&&gsiScenario?.identity?.address===identity.address&&Number.isFinite(facilityPosition.latitude)&&Number.isFinite(facilityPosition.longitude)&&gsiScenario.latitude===facilityPosition.latitude&&gsiScenario.longitude===facilityPosition.longitude;
 const scenarioMs=parseZonedTimestamp(gsiScenario?.retrievedAt);
 if(matching&&scenarioMs!==null&&Number.isFinite(now)&&scenarioMs<=now+300000&&Array.isArray(gsiScenario.rows)&&gsiScenario.rows.length<=100){
  try{scenarioValues=parseScenarioDepths(gsiScenario.rows.map(v=>({Depth:v?.depth,EntryRiverName:v?.river,RiverCode:v?.riverCode,SubRiverCode:v?.subRiverCode,OfficeCode:v?.officeCode,CSVScale:v?.scale})));scenarioTime=gsiScenario.retrievedAt}catch{}
 }
 rows.push({id:'gsi:facility-scenario',kind:'public_river_scenario',scope:selected?identity.name:null,state:scenarioValues===null?'unknown':scenarioValues.length?'available':'empty',retrievedAt:scenarioTime,updatedAt:null,sourceUrl:'https://suiboumap.gsi.go.jp/joken.html',currentConditions:'not-established',...(scenarioValues===null?{}:{values:scenarioValues})});
 const facility=selected&&facilityRaw!==undefined?decodeFacilityReports(facilityRaw,identity):{status:'unavailable',reports:[]};
 rows.push({id:'reports:facility',kind:'human_report_group',scope:selected?identity.name:null,state:facility.status,count:facility.reports.length,differences:facility.status==='ok'?facilityReportDifferences(facility.reports,identity,now):null});
 for(const report of facility.reports)rows.push({id:`facility:${report.id}`,kind:'human_report',scope:identity.name,state:facilityReportState(report,identity,now),reportedValue:report.status,observedAt:report.confirmedAt,expiresAt:report.expiresAt,declaredSource:report.source});
 const receipts=selected&&receiptRaw!==undefined?decodeFacilityReceipts(receiptRaw,identity):{status:'unavailable',receipts:[]};
 rows.push({id:'reports:receipt',kind:'human_report_group',scope:selected?identity.name:null,state:receipts.status,count:receipts.receipts.length});
 for(const report of receipts.receipts)rows.push({id:`receipt:${report.id}`,kind:'human_receipt',scope:identity.name,state:'reported',receiptStatus:report.status,supply:report.supply,expected:report.expected,received:report.received,reportedAt:report.reportedAt,declaredSource:report.source,followups:(report.followups||[]).map(({kind,state,at})=>({kind,state,at}))});
 const field=selected&&fieldRaw!==undefined?comparison:{reportsStatus:'unavailable',reports:[]};
 rows.push({id:'reports:field',kind:'human_report_group',scope:selected?identity.name:null,state:field.reportsStatus,count:field.reports.length,differingScopes:field.reportsStatus==='ok'?field.differingScopes:null});
 for(const report of field.reports)rows.push({id:`field:${report.id}`,kind:'human_report',scope:report.scope,state:report.state,reportedValue:report.status,observedAt:report.observedAt,expiresAt:report.expiresAt,declaredSource:report.source});
 const station=ready?riverPilotStations(identity.area).find(item=>item.id===riverStationId):null;
 const river=station&&riverRaw!==undefined?decodeRiverLog(riverRaw,station):{status:'unavailable',records:[]};
 const riverScope=station?`${station.river}・${station.name}`:null;
 rows.push({id:'river:manual',kind:'manual_river_group',scope:riverScope,state:river.status,count:river.records.length});
 river.records.forEach(record=>{
  const related=[];let relatedLevelsTruncated=false;for(const bulletin of rows.filter(row=>row.kind==='public_flood_bulletin'&&row.waterStatus==='included'))for(const [index,level] of bulletin.water.rows.entries()){
   const levelAt=parseZonedTimestamp(level.time);if(bulletin.water.stationContexts[index]?.stationId!==station.id||level.label!=='現況'||levelAt===null||levelAt!==Date.parse(record.at))continue;
   if(related.length<20)related.push({sourceUrl:bulletin.sourceUrl,issuedAt:bulletin.issuedAt,retrievedAt:bulletin.retrievedAt,sourceState:bulletin.state,observedAt:level.time,value:level.value,unit:level.unit,condition:level.condition,datum:'unknown',sourceTruncated:bulletin.water.truncated});else relatedLevelsTruncated=true;
  }
  rows.push({id:`river:manual:${station.id}:${record.at}:${record.value}${Object.hasOwn(record,'datum')?`:${record.datum}`:''}:${record.recordedAt}:${record.reviewBy??'no-review'}`,kind:'manual_river_note',scope:riverScope,state:riverLogState(record,now),value:record.value,datum:record.datum??'unknown',observedAt:record.at,recordedAt:record.recordedAt,reviewBy:record.reviewBy,sourceUrl:station.levelUrl,conflict:river.records.some(other=>other.at===record.at&&(other.value!==record.value||(other.datum??'unknown')!==(record.datum??'unknown'))),relatedLevels:related,relatedLevelsTruncated});
 });
 let riskArea=null;try{if(ready)riskArea=areaByCode(identity.area)}catch{}
 const risk=riskArea&&riskRaw!==undefined?decodeRiskReviews(riskRaw,identity.area):{status:'unavailable',records:[]};
 rows.push({id:'risk:manual',kind:'manual_risk_group',scope:riskArea?.area||null,state:risk.status,count:risk.records.length});
 risk.records.forEach(record=>rows.push({id:`risk:manual:${record.product}:${record.checkedAt}:${record.recordedAt}:${record.appearance}`,kind:'manual_risk_review',scope:riskArea.area,state:riskReviewState(record,now),product:record.product,appearance:record.appearance,checkedAt:record.checkedAt,recordedAt:record.recordedAt,reviewBy:record.reviewBy??null,sourceUpdatedAt:null,sourceUrl:officialMapLinks(riskArea)[record.product],differing:risk.records.some(other=>other.product===record.product&&other.checkedAt===record.checkedAt&&other.appearance!==record.appearance)}));
 const infrastructure=ready&&infrastructureRaw!==undefined?decodeInfrastructureReports(infrastructureRaw,identity.area):{status:'unavailable',records:[]};
 rows.push({id:'infrastructure:manual',kind:'manual_infrastructure_group',scope:ready?(riskArea?.area||identity.area):null,state:infrastructure.status,count:infrastructure.records.length});
 infrastructure.records.forEach(record=>rows.push({id:`infrastructure:manual:${record.id}`,kind:'manual_infrastructure_report',scope:riskArea?.area||identity.area,state:infrastructureReportState(record,now),location:record.location,item:record.item,reportStatus:record.status,source:record.source,observedAt:record.observedAt,recordedAt:record.recordedAt,expiresAt:record.expiresAt,corrects:record.corrects?`infrastructure:manual:${record.corrects}`:null,correctedBy:infrastructure.records.filter(item=>item.corrects===record.id).map(item=>`infrastructure:manual:${item.id}`),changes:infrastructureReportChanges(infrastructure.records.find(item=>item.id===record.corrects),record)}));
 return rows;
}
export function createPilotEvidenceSnapshot(input={}){
 const now=input.now??Date.now();if(!Number.isFinite(now)||!Number.isFinite(new Date(now).getTime()))throw new Error('記録時刻が不正です');
 const ready=input.areaReady===true&&typeof input.identity?.area==='string'&&/^\d{5}$/.test(input.identity.area),selected=ready&&!!pilotFacilityKey(input.identity.area,input.identity.name,input.identity.address);
 return {version:1,kind:'pilot-evidence-snapshot',createdAt:new Date(now).toISOString(),scope:{area:ready?input.identity.area:null,facility:selected?input.identity.name:null},referenceIds:'display-only',currentConditions:'not-established',notice:'保存時点の参考情報です。現在の浸水・施設の受け入れ・飛行の安全や、人の報告の正確さを確認したものではありません。',noticeEn:'Reference information as of export. Current flooding, facility acceptance, flight safety and the accuracy of human reports are not established.',items:buildPilotEvidenceLedger({...input,now})};
}
export function decodeScenarioSnapshot(text){
 if(typeof text!=='string'||text.length>1024*1024)throw new Error('invalid_snapshot');
 let data;try{data=JSON.parse(text)}catch{throw new Error('invalid_snapshot')}
 const invalid=()=>{throw new Error('invalid_snapshot')};
 if(!data||data.version!==1||data.kind!=='pilot-evidence-snapshot'||parseZonedTimestamp(data.createdAt)===null||!Array.isArray(data.items)||data.items.length>10000)invalid();
 const area=data.scope?.area,facility=data.scope?.facility;
 if(!(area===null||typeof area==='string'&&/^\d{5}$/.test(area))||!(facility===null||typeof facility==='string'&&facility.trim().length>0&&facility.length<=200))invalid();
 const found=data.items.filter(x=>x?.id==='gsi:facility-scenario');if(found.length!==1)invalid();
 const entry=found[0];if(entry.kind!=='public_river_scenario'||entry.scope!==facility||entry.currentConditions!=='not-established'||entry.sourceUrl!=='https://suiboumap.gsi.go.jp/joken.html'||entry.updatedAt!==null||!['available','empty','unknown'].includes(entry.state))invalid();
 let values=[];
 if(entry.state==='unknown'){if(entry.retrievedAt!==null||Object.hasOwn(entry,'values'))invalid()}
 else{
  const at=parseZonedTimestamp(entry.retrievedAt),saved=parseZonedTimestamp(data.createdAt);
  if(!area||!facility||at===null||at>saved+300000||!Array.isArray(entry.values)||entry.values.length>100)invalid();
  try{values=parseScenarioDepths(entry.values.map(v=>({Depth:v?.depth,EntryRiverName:v?.river,RiverCode:v?.riverCode,SubRiverCode:v?.subRiverCode,OfficeCode:v?.officeCode,CSVScale:v?.scale})))}catch{invalid()}
  if(entry.state==='available'&&!values.length||entry.state==='empty'&&values.length)invalid();
 }
 return {savedAt:data.createdAt,area,facility,state:entry.state,retrievedAt:entry.retrievedAt,values,trust:'unverified_file'};
}
export function decodePilotEvidencePreview(text){
 const scenario=decodeScenarioSnapshot(text),data=JSON.parse(text);
 const kinds=new Set(['public_flood_feed','public_model','public_facilities','public_warning','public_observation','public_flood_bulletin','scenario','human_report_group','human_report','human_receipt','manual_river_group','manual_river_note','manual_risk_group','manual_risk_review','manual_infrastructure_group','manual_infrastructure_report']);
 const fields=['scope','state','feedType','count','value','datum','reportedValue','reportStatus','receiptStatus','supply','expected','received','station','stationId','distance','rain','rain1h','rain24h','wind','detail','product','appearance','item','location','sourceUrl','declaredSource','source','observedAt','retrievedAt','issuedAt','reportedAt','recordedAt','checkedAt','expiresAt','reviewBy'];
 const timeFields=new Set(['observedAt','retrievedAt','issuedAt','reportedAt','recordedAt','checkedAt','expiresAt','reviewBy']);
 const clean=(value,max=300)=>typeof value==='string'&&value.length<=max?value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,' '):typeof value==='number'&&Number.isFinite(value)?value:undefined;
 const rows=[];let omitted=0,incomplete=false;const savedMs=parseZonedTimestamp(scenario.savedAt);
 const meaningful=value=>Array.isArray(value)?value.length>0:value&&typeof value==='object'?Object.values(value).some(meaningful):value!==null&&value!==undefined&&value!==false&&value!=='';
 for(const item of data.items){
  if(!item||Array.isArray(item)||typeof item!=='object'||!kinds.has(item.kind)){omitted++;continue}
  if(rows.length>=60){omitted++;continue}
  const row={kind:item.kind,id:clean(item.id),fields:{},warnings:[]};
  const warn=code=>{if(!row.warnings.includes(code))row.warnings.push(code);incomplete=true};
  if(item.id==='reports:field'&&Object.hasOwn(item,'differingScopes')&&item.differingScopes!==null){
   const scopes=item.differingScopes;if(Array.isArray(scopes)&&scopes.length<=2&&new Set(scopes).size===scopes.length&&scopes.every(scope=>['facility_point','nearby_road'].includes(scope)))row.differingScopes=[...scopes];else warn('field_unreadable');
  }
  for(const key of fields){const value=item[key];if(value===undefined||value===null)continue;const valid=clean(value,key==='detail'?600:300);if(valid===undefined){warn('field_unreadable');continue}if(timeFields.has(key)&&(typeof valid!=='string'||parseZonedTimestamp(valid)===null)){warn('invalid_time');continue}row.fields[key]=valid}
  if(['human_report','manual_infrastructure_report'].includes(item.kind)&&row.fields.expiresAt&&parseZonedTimestamp(row.fields.expiresAt)<=savedMs&&['reported','available','checking','conditional'].includes(row.fields.state))warn('expired_at_save');
  if(['human_report','manual_infrastructure_report'].includes(item.kind)&&row.fields.expiresAt&&parseZonedTimestamp(row.fields.expiresAt)>savedMs&&row.fields.state==='expired')warn('expiry_mismatch');
  if(typeof row.id==='string'&&/^(?:facility|receipt):/.test(row.id)&&scenario.facility&&row.fields.scope!==scenario.facility)warn('scope_mismatch');
  if(typeof row.id==='string'&&row.id.startsWith('field:')&&!['facility_point','nearby_road','unspecified'].includes(row.fields.scope))warn('scope_unrecognized');
  if(['human_report','human_receipt','manual_infrastructure_report','manual_river_note','manual_risk_review'].includes(item.kind)&&row.fields.observedAt&&parseZonedTimestamp(row.fields.observedAt)>savedMs+300000)warn('time_after_save');
  for(const [key,max] of Object.entries({count:100000,expected:10000,received:10000,distance:40075000,rain:10000,rain1h:10000,rain24h:10000,wind:10000})){const n=row.fields[key];if(n!==undefined&&(typeof n!=='number'||n<0||n>max||(['count','expected','received'].includes(key)&&!Number.isInteger(n))))warn('numeric_invalid')}
  if(['corrects','correctedBy','changes','followups','relatedLevels','relatedLevelsTruncated','differences','water'].some(key=>meaningful(item[key])))warn('details_omitted');
  rows.push(row);
 }
 return {savedAt:scenario.savedAt,area:scenario.area,facility:scenario.facility,trust:'unverified_file',currentConditions:'not-established',rows,omitted,incomplete};
}

// In-memory photo analysis. The user must trigger run; no metadata is sent here.
export function createPhotoScan({request,onChange}){
  if(typeof request!=='function'||typeof onChange!=='function')throw new Error('画像確認の接続が不正です');
  let frame=null,controller=null,version=0;
  const emit=(phase,message,boxes=[])=>onChange({phase,message,id:frame?.id||null,boxes:boxes.map(box=>({...box}))});
  function clear(){version++;controller?.abort();controller=null;frame=null;emit('empty','画像を選択してください。')}
  function setImage(next){
    clear();
    if(!next||typeof next.id!=='string'||!next.id||typeof next.image!=='string'||next.image.length>5700000||!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(next.image)||!Number.isInteger(next.width)||!Number.isInteger(next.height)||next.width<1||next.height<1||next.width>1024||next.height>1024)throw new Error('画像形式または大きさが不正です');
    frame={id:next.id,image:next.image,width:next.width,height:next.height};emit('ready','画像を選択しました。送信前に内容と利用権限を確認してください。');
  }
  async function run(){
    if(!frame||controller)return;
    const id=++version,active=new AbortController(),selected=frame;controller=active;emit('loading','画像をMetaへ送信し、SAMの候補を確認中です。');
    try{
      const boxes=await request(selected.image,active.signal);
      if(id!==version||controller!==active)return;
      if(!Array.isArray(boxes)||boxes.length>1000||boxes.some(b=>!b||!['x1','y1','x2','y2','w','h'].every(k=>Number.isFinite(b[k]))||b.w<=0||b.h<=0||b.x1<0||b.y1<0||b.x1>=b.x2||b.y1>=b.y2||b.x2>b.w||b.y2>b.h))throw new Error('候補枠の座標が不正です');
      controller=null;emit('done',boxes.length?`画像内の候補 ${boxes.length}件。位置や安全は未確認です。`:'候補枠は返りませんでした。結果を確認できない場合もあります。電線がないことを意味しません。',boxes);
    }catch(error){if(id===version&&controller===active){controller=null;emit('error',`画像の確認に失敗しました：${error?.message||'不明なエラー'}`)}}
  }
  return {setImage,run,clear};
}
export function photoScanDimensions(width,height){
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>10000||height>10000)throw new Error('画像の寸法が大きすぎるか不正です');
  const scale=Math.min(1,1024/Math.max(width,height));return {width:Math.max(1,Math.round(width*scale)),height:Math.max(1,Math.round(height*scale))};
}
// Metadata is self-reported and never sent as part of the SAM request.
export function createPhotoMetadata(input,now=Date.now()){
  if(!input||!['unknown','field','historical','training'].includes(input.kind)||!['unknown','clear','obscured'].includes(input.visibility)||!['unknown','north','east','south','west'].includes(input.direction)||!['unknown','reported','not_done'].includes(input.calibration)||!Number.isFinite(now))throw new Error('撮影条件を確認してください');
  photoScanDimensions(input.width,input.height);
  let time=null;
  if(input.time){
    if(typeof input.time!=='string')throw new Error('撮影日時を確認してください');
    const local=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(input.time);
    if(local){
      const parsed=new Date(input.time),parts=[parsed.getFullYear(),parsed.getMonth()+1,parsed.getDate(),parsed.getHours(),parsed.getMinutes(),parsed.getSeconds(),parsed.getMilliseconds()],expected=[...local.slice(1,6).map(Number),Number(local[6]||0),Number((local[7]||'').padEnd(3,'0'))];
      if(!Number.isFinite(parsed.getTime())||parts.some((part,index)=>part!==expected[index]))throw new Error('撮影日時を確認してください');
      time=parsed.getTime();
    }else time=parseZonedTimestamp(input.time);
    if(time===null||time>now)throw new Error('撮影日時を確認してください');
  }
  const numeric=value=>{if(typeof value!=='string')throw new Error('撮影位置を確認してください');if(!value.trim())return null;const number=Number(value);if(!Number.isFinite(number))throw new Error('撮影位置を確認してください');return number};
  const latitude=numeric(input.latitude),longitude=numeric(input.longitude),accuracy=numeric(input.accuracy);
  if((latitude===null)!==(longitude===null)||latitude!==null&&(Math.abs(latitude)>90||Math.abs(longitude)>180)||accuracy!==null&&(latitude===null||accuracy<=0||accuracy>100000))throw new Error('緯度・経度と位置誤差を確認してください');
  const result={selfReported:true,kind:input.kind,time:time===null?null:new Date(time).toISOString(),visibility:input.visibility,position:latitude===null?null:{latitude,longitude,accuracy},direction:input.direction,calibration:input.calibration,originalSize:{width:input.width,height:input.height}};
  if(Object.hasOwn(input,'source')||Object.hasOwn(input,'permission')){
    if(typeof input.source!=='string'||input.source.length>160||/[\u0000-\u001f\u007f]/.test(input.source)||!['unknown','allowed','disallowed'].includes(input.permission))throw new Error('画像の提供元または送信許可を確認してください');
    result.source=input.source.trim();result.permission=input.permission;
  }
  if(Object.hasOwn(input,'limitations')){
    const allowed=['occluded','thin_wires','lighting','blur'];
    if(!Array.isArray(input.limitations)||input.limitations.some(value=>!allowed.includes(value))||new Set(input.limitations).size!==input.limitations.length||input.limitations.some((value,index,array)=>index>0&&allowed.indexOf(value)<allowed.indexOf(array[index-1])))throw new Error('見えにくい条件を確認してください');
    result.limitations=[...input.limitations];
  }
  return result;
}

export function createPhotoReview(input,now=Date.now()){
  const stamp=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
  const keys=input?.version===1?'boxCount,frameId,id,metadata,receivedAt,recordedAt,sentSize,version':'boxCount,boxes,frameId,id,imageHash,metadata,receivedAt,recordedAt,sentSize,version';
  if(!input||Object.keys(input).sort().join(',')!==keys||![1,2].includes(input.version)||typeof input.id!=='string'||typeof input.frameId!=='string'||!/^[-a-zA-Z0-9]{1,100}$/.test(input.id)||!/^[-a-zA-Z0-9]{1,100}$/.test(input.frameId)||!stamp(input.receivedAt)||!stamp(input.recordedAt)||!Number.isFinite(now)||Date.parse(input.receivedAt)>Date.parse(input.recordedAt)||Date.parse(input.recordedAt)>now||!Number.isInteger(input.boxCount)||input.boxCount<0||input.boxCount>1000)throw new Error('画像確認の記録を確認してください');
  const meta=input.metadata,pos=meta?.position;
  if(!meta||!meta.originalSize||!input.sentSize)throw new Error('撮影条件を確認してください');
  const validated=createPhotoMetadata({kind:meta.kind,visibility:meta.visibility,time:meta.time||'',latitude:pos===null?'':String(pos?.latitude),longitude:pos===null?'':String(pos?.longitude),accuracy:pos===null||pos?.accuracy===null?'':String(pos?.accuracy),direction:meta.direction,calibration:meta.calibration,width:meta.originalSize.width,height:meta.originalSize.height,...(Object.hasOwn(meta,'source')||Object.hasOwn(meta,'permission')?{source:meta.source,permission:meta.permission}:{}),...(Object.hasOwn(meta,'limitations')?{limitations:meta.limitations}:{})},Date.parse(input.receivedAt));
  if(JSON.stringify(meta)!==JSON.stringify(validated)||JSON.stringify(input.sentSize)!==JSON.stringify(photoScanDimensions(meta.originalSize.width,meta.originalSize.height)))throw new Error('撮影条件または画像寸法を確認してください');
  const result={version:input.version,id:input.id,frameId:input.frameId,receivedAt:input.receivedAt,recordedAt:input.recordedAt,boxCount:input.boxCount,metadata:validated,sentSize:{...input.sentSize}};
  if(input.version===2){
    if(typeof input.imageHash!=='string'||!/^[a-f0-9]{64}$/.test(input.imageHash)||!Array.isArray(input.boxes)||input.boxes.length!==input.boxCount||input.boxes.some(b=>!b||Object.keys(b).sort().join(',')!=='h,w,x1,x2,y1,y2'||!['x1','y1','x2','y2','w','h'].every(k=>Number.isFinite(b[k]))||b.w<=0||b.h<=0||b.x1<0||b.y1<0||b.x1>=b.x2||b.y1>=b.y2||b.x2>b.w||b.y2>b.h))throw new Error('画像の照合情報または候補枠が不正です');
    result.imageHash=input.imageHash;result.boxes=input.boxes.map(({x1,y1,x2,y2,w,h})=>({x1,y1,x2,y2,w,h}));
  }
  return result;
}
export function photoReviewMatchesFile(review,hash){return review?.version===2&&typeof hash==='string'&&/^[a-f0-9]{64}$/.test(hash)&&review.imageHash===hash}
export function decodePhotoReviews(raw){
  if(raw==null)return {status:'ok',records:[]};
  try{if(typeof raw!=='string'||raw.length>4000000)throw new Error();const rows=JSON.parse(raw);if(!Array.isArray(rows)||rows.length>20)throw new Error();const ids=new Set();for(const row of rows){if(ids.has(row.id)||JSON.stringify(createPhotoReview(row,Date.parse(row.recordedAt)))!==JSON.stringify(row))throw new Error();ids.add(row.id)}return {status:'ok',records:rows}}catch{return {status:'corrupt',records:[]}}
}
export function appendPhotoReview(raw,review){
  const saved=decodePhotoReviews(raw);if(saved.status!=='ok'||saved.records.length>=20)throw new Error('画像確認記録を確認してください');
  const clean=createPhotoReview(review);if(saved.records.some(record=>record.id===clean.id||(record.frameId===clean.frameId&&record.receivedAt===clean.receivedAt)))throw new Error('この画像確認は既に記録されています');return JSON.stringify([clean,...saved.records]);
}

// Tabletop observations are self-reported training data, not operational decisions.
function validateExerciseObservation(value,finishedAt){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='at,focus,note,observed,workload'||!['facility','communications','age','conflict','flight'].includes(value.focus)||!['acknowledged','not_acknowledged','uncertain'].includes(value.observed)||!['not_asked','light','moderate','high'].includes(value.workload)||typeof value.note!=='string'||value.note.length>300||typeof value.at!=='string')throw new Error('観察内容を確認してください');
  const at=Date.parse(value.at);if(!Number.isFinite(at)||new Date(at).toISOString()!==value.at||at<Date.parse(finishedAt))throw new Error('観察記録の時刻を確認してください');
  return {at:value.at,focus:value.focus,observed:value.observed,workload:value.workload,note:value.note.trim()};
}
export function createExerciseRecord(input){
  const scenarios=['facility-refused','conflicting-reports'];
  const decisions=['hold','confirm','alternate'];
  const facts=['facility','communications','age','conflict','flight'];
  if(!input||!scenarios.includes(input.scenario)||!decisions.includes(input.decision)||!Array.isArray(input.observed)||input.observed.length>facts.length||new Set(input.observed).size!==input.observed.length||input.observed.some(value=>!facts.includes(value))||typeof input.notes!=='string'||input.notes.length>300)throw new Error('演習の入力を確認してください');
  const start=Date.parse(input.startedAt),end=Date.parse(input.finishedAt);
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<start||end-start>86400000)throw new Error('演習の時刻を確認してください');
  const record={kind:'tabletop-training',scenario:input.scenario,decision:input.decision,observed:[...input.observed],notes:input.notes.trim(),startedAt:new Date(start).toISOString(),finishedAt:new Date(end).toISOString(),durationSeconds:Math.floor((end-start)/1000)};
  if(Object.hasOwn(input,'presentation')){
    const p=input.presentation,validText=item=>item&&typeof item==='object'&&!Array.isArray(item)&&typeof item.text==='string'&&item.text.trim().length>0&&item.text.length<=500&&['ja','en'].includes(item.lang);
    if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).sort().join(',')!=='initial,update'||!validText(p.initial)||Object.keys(p.initial).sort().join(',')!=='lang,text'||!validText(p.update)||Object.keys(p.update).sort().join(',')!=='lang,shownAt,text'||typeof p.update.shownAt!=='string')throw new Error('演習で表示した内容を確認してください');
    const shown=Date.parse(p.update.shownAt);if(!Number.isFinite(shown)||new Date(shown).toISOString()!==p.update.shownAt||shown<start||shown>end)throw new Error('演習の表示時刻を確認してください');
    record.presentation={initial:{text:p.initial.text,lang:p.initial.lang},update:{text:p.update.text,lang:p.update.lang,shownAt:p.update.shownAt}};
  }
  if(Object.hasOwn(input,'reviews')){if(!Array.isArray(input.reviews)||input.reviews.length>10)throw new Error('観察記録を確認してください');record.reviews=input.reviews.map(review=>validateExerciseObservation(review,record.finishedAt));}
  return record;
}
export function decodeExerciseRecords(raw){
  if(raw===null||raw===undefined)return {status:'ok',records:[]};
  try{
    const records=JSON.parse(raw);if(!Array.isArray(records)||records.length>20)throw new Error();
    for(const record of records){
      if(!record||record.kind!=='tabletop-training')throw new Error();
      const checked=createExerciseRecord(record);
      if(JSON.stringify(checked)!==JSON.stringify(record))throw new Error();
    }
    return {status:'ok',records};
  }catch{return {status:'corrupt',records:[]}}
}
// Counts training records and observation entries; it never scores people or infers omissions.
export function summarizeExerciseRecords(raw){
  if(raw!==null&&raw!==undefined&&(typeof raw!=='string'||raw.length>256000))return {status:'corrupt'};
  const saved=decodeExerciseRecords(raw);if(saved.status!=='ok')return {status:'corrupt'};
  if(!saved.records.length)return {status:'empty'};
  const focuses=['facility','communications','age','conflict','flight'],observationStates=['acknowledged','not_acknowledged','uncertain'];
  const scenarios=['facility-refused','conflicting-reports'].map(scenario=>{
    const records=saved.records.filter(row=>row.scenario===scenario),times=records.map(row=>row.durationSeconds).sort((a,b)=>a-b),middle=Math.floor(times.length/2);
    const decisions={hold:0,confirm:0,alternate:0},selfReported=Object.fromEntries(focuses.map(focus=>[focus,0])),observations=Object.fromEntries(focuses.map(focus=>[focus,Object.fromEntries(observationStates.map(state=>[state,0]))])),workloads={not_asked:0,light:0,moderate:0,high:0};
    let observationCount=0,noObserverRecords=0,noPresentationRecords=0;
    for(const row of records){decisions[row.decision]++;for(const focus of row.observed)selfReported[focus]++;if(!row.presentation)noPresentationRecords++;if(!row.reviews?.length)noObserverRecords++;for(const review of row.reviews||[]){observationCount++;observations[review.focus][review.observed]++;workloads[review.workload]++}}
    return {scenario,recordCount:records.length,decisions,selfReported,observationCount,noObserverRecords,noPresentationRecords,observations,workloads,durationSeconds:times.length?{min:times[0],median:times.length%2?times[middle]:(times[middle-1]+times[middle])/2,max:times.at(-1)}:null};
  });
  return {status:'ok',recordCount:saved.records.length,observationCount:scenarios.reduce((sum,row)=>sum+row.observationCount,0),scenarios};
}
export function recordExerciseObservation(raw,record,observation){
  const history=decodeExerciseRecords(raw);if(history.status!=='ok')throw new Error('演習記録を確認してください');
  const matches=history.records.map((item,index)=>JSON.stringify(item)===JSON.stringify(record)?index:-1).filter(index=>index>=0);
  if(matches.length!==1)throw new Error('演習記録が変わったか、同じ記録が複数あります');
  const current=history.records[matches[0]],reviews=current.reviews||[];if(reviews.length>=10)throw new Error('観察記録は10件までです');
  const checked=validateExerciseObservation(observation,current.finishedAt);history.records[matches[0]]={...current,reviews:[...reviews,checked]};return JSON.stringify(history.records);
}
export function removeExerciseRecord(raw,record){
  const history=decodeExerciseRecords(raw);if(history.status!=='ok')throw new Error('演習記録を確認してください');
  const matches=history.records.map((item,index)=>JSON.stringify(item)===JSON.stringify(record)?index:-1).filter(index=>index>=0);
  if(matches.length!==1)throw new Error('演習記録が変わったか、同じ記録が複数あります');
  return JSON.stringify(history.records.filter((_,index)=>index!==matches[0]));
}
export function appendExerciseRecord(raw,record){
  const history=decodeExerciseRecords(raw);
  if(history.status!=='ok'||history.records.length>=20)throw new Error('演習記録を保存できません。記録の確認が必要です');
  const checked=createExerciseRecord(record);return JSON.stringify([checked,...history.records]);
}

// Personal annotations of historical imagery; they do not establish flood extent.
export const HISTORICAL_REVIEW_IMAGES=Object.freeze({
  'joso-2015':Object.freeze(['joso-nied-20150911-am','joso-20150911-pm','joso-20150915-am']),
  'mabi-2018':Object.freeze(['mabi-20180709','mabi-20180711'])
});
const choices=['water-like','not-clear','uncertain','unavailable'];
const limits=['time','alignment','visibility','coverage','reference'];
export function createHistoricalReview(input){
  const images=HISTORICAL_REVIEW_IMAGES[input?.caseId];
  if(!images||typeof input.id!=='string'||!/^[-a-zA-Z0-9]{1,100}$/.test(input.id)||!input.assessments||typeof input.assessments!=='object'||Array.isArray(input.assessments))throw new Error('記録の内容を確認してください');
  if(Object.keys(input.assessments).length!==images.length||images.some(id=>!Object.hasOwn(input.assessments,id)||!choices.includes(input.assessments[id])))throw new Error('すべての写真について見え方を選んでください');
  if(!Array.isArray(input.limitations)||new Set(input.limitations).size!==input.limitations.length||input.limitations.some(x=>!limits.includes(x))||typeof input.notes!=='string'||input.notes.length>300)throw new Error('注意点とメモを確認してください');
  const time=Date.parse(input.recordedAt);if(!Number.isFinite(time))throw new Error('記録時刻を確認してください');
  return {version:1,id:input.id,caseId:input.caseId,assessments:Object.fromEntries(images.map(id=>[id,input.assessments[id]])),limitations:[...input.limitations],notes:input.notes.trim(),recordedAt:new Date(time).toISOString()};
}
export function decodeHistoricalReviews(raw){
  if(raw==null)return {status:'ok',records:[]};
  try{if(typeof raw!=='string'||raw.length>100000)throw new Error();const records=JSON.parse(raw);if(!Array.isArray(records)||records.length>20)throw new Error();const ids=new Set();for(const row of records){if(ids.has(row.id)||JSON.stringify(createHistoricalReview(row))!==JSON.stringify(row))throw new Error();ids.add(row.id)}return {status:'ok',records}}catch{return {status:'corrupt',records:[]}}
}
export function appendHistoricalReview(raw,record){
  const previous=decodeHistoricalReviews(raw);if(previous.status!=='ok'||previous.records.length>=20)throw new Error('保存済みの記録を確認してください');
  const clean=createHistoricalReview(record);if(previous.records.some(row=>row.id===clean.id))throw new Error('同じ記録IDがあります');return JSON.stringify([clean,...previous.records]);
}

