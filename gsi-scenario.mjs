const endpoint='https://suiboumap.gsi.go.jp/shinsuimap/Api/Public/GetMaxDepthFromLatlon';
const limitKey='muse-gsi-flood-scenario-last-request-v1',lockName='muse-gsi-flood-scenario-request';
const problem=code=>Object.assign(new Error(code),{code});

export function scenarioUrl(point){
 if(!Number.isFinite(point?.latitude)||!Number.isFinite(point?.longitude)||Math.abs(point.latitude)>90||Math.abs(point.longitude)>180)throw problem('invalid_point');
 const url=new URL(endpoint);url.searchParams.set('lat',String(point.latitude));url.searchParams.set('lon',String(point.longitude));url.searchParams.set('CSVScale','0');return url.href;
}
export function parseScenarioDepths(value){
 if(!Array.isArray(value)||value.length>100)throw problem('invalid_response');
 return value.map(row=>{
  const bounded=value=>typeof value==='string'&&value.trim()===value&&value.length>0&&value.length<=120;
  if(!row||typeof row!=='object'||Array.isArray(row)||!Number.isFinite(row.Depth)||row.Depth<0||row.CSVScale!==0||!bounded(row.EntryRiverName)||!bounded(row.RiverCode)||!bounded(row.SubRiverCode)||!bounded(row.OfficeCode))throw problem('invalid_response');
  return {river:row.EntryRiverName,riverCode:row.RiverCode,subRiverCode:row.SubRiverCode,officeCode:row.OfficeCode,depth:row.Depth,scale:0};
 });
}
export function compareScenarioRanges(tile,rows){
 const ranges={'0.5m未満':[0,0.5],'0.5〜3.0m':[0.5,3],'3.0〜5.0m':[3,5],'5.0〜10.0m':[5,10],'10.0〜20.0m':[10,20],'20.0m以上':[20,Infinity]};
 if(!Object.hasOwn(ranges,tile)||!Array.isArray(rows)||!rows.length||rows.length>100)return {state:'unknown'};
 let valid;try{valid=parseScenarioDepths(rows.map(v=>({Depth:v?.depth,EntryRiverName:v?.river,RiverCode:v?.riverCode,SubRiverCode:v?.subRiverCode,OfficeCode:v?.officeCode,CSVScale:v?.scale})))}catch{return {state:'unknown'}}
 const maximum=Math.max(...valid.map(v=>v.depth)),[lower,upper]=ranges[tile];return {state:maximum>=lower&&maximum<upper?'within':'outside',maximum};
}
export async function requestScenarioDepths({point,locks,storage,fetcher=fetch,clock=Date.now,signal}){
 const url=scenarioUrl(point);if(!locks||typeof locks.request!=='function'||!storage)throw problem('coordination_unavailable');
 return locks.request(lockName,{ifAvailable:true},async lock=>{
  if(!lock)throw problem('busy');if(signal?.aborted)throw problem('cancelled');
  const now=clock();if(!Number.isSafeInteger(now)||now<0)throw problem('coordination_unavailable');
  let last;try{last=storage.getItem(limitKey)}catch{throw problem('coordination_unavailable')}
  if(last!==null){if(!/^(0|[1-9]\d{0,15})$/.test(last)||!Number.isSafeInteger(Number(last))||Number(last)>now)throw problem('coordination_unavailable');if(now-Number(last)<3000)throw problem('rate_wait')}
  try{storage.setItem(limitKey,String(now))}catch{throw problem('coordination_unavailable')}
  let response,body;try{const requestSignal=signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000);response=await fetcher(url,{signal:requestSignal,cache:'no-store',credentials:'omit'});if(!response.ok)throw problem('request_failed');body=await response.text()}catch(error){if(signal?.aborted)throw problem('cancelled');if(error?.code==='request_failed')throw error;throw problem('request_failed')}
  if(signal?.aborted)throw problem('cancelled');if(body.length>200000)throw problem('invalid_response');
  let raw;try{raw=JSON.parse(body)}catch{throw problem('invalid_response')}
  const rows=parseScenarioDepths(raw),retrieved=clock();if(!Number.isSafeInteger(retrieved)||retrieved<now)throw problem('coordination_unavailable');
  return {rows,retrievedAt:new Date(retrieved).toISOString()};
 });
}
