const kinds=['wire','pole','tree','work','other'];
const statuses=['present','damaged','changed','not_seen','uncertain'];
const stamp=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const cleanText=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value);
const validId=value=>typeof value==='string'&&/^[-a-zA-Z0-9]{1,100}$/.test(value);

export function createInfrastructureReport(input,now=Date.now()){
 const keys='area,corrects,expiresAt,id,item,location,observedAt,recordedAt,source,status';
 if(!input||!Number.isFinite(now)||![keys,`${keys},kind`.split(',').sort().join(',')].includes(Object.keys(input).sort().join(',')))throw new Error('報告の内容を確認してください');
 if(typeof input.area!=='string'||!/^\d{5}$/.test(input.area))throw new Error('対象地域を確認してください');
 if(!validId(input.id)||!cleanText(input.location,150)||!cleanText(input.source,150)||!kinds.includes(input.item)||!statuses.includes(input.status)||!stamp(input.observedAt)||!stamp(input.recordedAt)||!stamp(input.expiresAt)||Date.parse(input.observedAt)>Date.parse(input.recordedAt)||Date.parse(input.recordedAt)>now||Date.parse(input.expiresAt)<=Date.parse(input.observedAt)||!(input.corrects===null||validId(input.corrects)&&input.corrects!==input.id))throw new Error('報告の内容または日時を確認してください');
 if(Object.hasOwn(input,'kind')&&input.kind!=='manual-infrastructure-report')throw new Error('報告の種類を確認してください');
 return {kind:'manual-infrastructure-report',id:input.id,area:input.area,location:input.location.trim(),item:input.item,status:input.status,source:input.source.trim(),observedAt:input.observedAt,recordedAt:input.recordedAt,expiresAt:input.expiresAt,corrects:input.corrects};
}
export function infrastructureReportState(report,now=Date.now()){
 if(!Number.isFinite(now)||now<Date.parse(report.recordedAt))return 'clock_unknown';
 return now>=Date.parse(report.expiresAt)?'expired':'reported';
}
// Differences describe two user-linked statements, not changes verified in the field.
export function infrastructureReportChanges(previous,current){
 if(!previous||!current||current.corrects!==previous.id)return [];
 return ['location','item','status','source','observedAt','expiresAt'].filter(field=>previous[field]!==current[field]).map(field=>({field,before:previous[field],after:current[field]}));
}
export function decodeInfrastructureReports(raw,area){
 if(raw==null)return {status:'ok',records:[]};
 try{
  if(typeof raw!=='string'||raw.length>300000)throw new Error();
  const records=JSON.parse(raw);if(!Array.isArray(records)||records.length>50)throw new Error();
  const seen=new Set();
  for(let i=records.length-1;i>=0;i--){const row=records[i];if(row?.area!==area||seen.has(row?.id)||row?.corrects!==null&&!seen.has(row.corrects)||JSON.stringify(createInfrastructureReport(row,Date.parse(row.recordedAt)))!==JSON.stringify(row))throw new Error();seen.add(row.id)}
  return {status:'ok',records};
 }catch{return {status:'corrupt',records:[]}}
}
export function appendInfrastructureReport(raw,input,area,now=Date.now()){
 const stored=decodeInfrastructureReports(raw,area),report=createInfrastructureReport(input,now);
 if(stored.status!=='ok'||stored.records.length>=50||report.area!==area||stored.records.some(row=>row.id===report.id)||report.corrects!==null&&!stored.records.some(row=>row.id===report.corrects))throw new Error('保存済みの報告と訂正元を確認してください');
 return JSON.stringify([report,...stored.records]);
}
// This bounded projection is not sent unless a separate, explicit consent flow chooses it.
export function validateConsultInfrastructureReports(rows,now=Date.now()){
 if(!Array.isArray(rows)||!rows.length||rows.length>20||!Number.isFinite(now))return false;
 if(!rows.every((row,index)=>row&&!Array.isArray(row)&&Object.keys(row).sort().join(',')==='correctionIndex,correctionTargetOmitted,expiresAt,item,observedAt,status'&&kinds.includes(row.item)&&statuses.includes(row.status)&&stamp(row.observedAt)&&stamp(row.expiresAt)&&Date.parse(row.observedAt)<=now&&now<Date.parse(row.expiresAt)&&typeof row.correctionTargetOmitted==='boolean'&&(row.correctionIndex===null||Number.isInteger(row.correctionIndex)&&row.correctionIndex>=0&&row.correctionIndex<rows.length&&row.correctionIndex!==index&&!row.correctionTargetOmitted)))return false;
 return rows.every((_row,index)=>{const seen=new Set();let current=index;while(current!==null){if(seen.has(current))return false;seen.add(current);current=rows[current].correctionIndex}return true});
}
export function consultInfrastructureReports(raw,area,now=Date.now()){
 const saved=decodeInfrastructureReports(raw,area);if(saved.status!=='ok')return null;
 const active=saved.records.filter(row=>infrastructureReportState(row,now)==='reported'),indices=new Map(active.map((row,index)=>[row.id,index]));
 const rows=active.map(row=>({item:row.item,status:row.status,observedAt:row.observedAt,expiresAt:row.expiresAt,correctionIndex:row.corrects&&indices.has(row.corrects)?indices.get(row.corrects):null,correctionTargetOmitted:!!row.corrects&&!indices.has(row.corrects)}));
 return validateConsultInfrastructureReports(rows,now)?rows:null;
}
