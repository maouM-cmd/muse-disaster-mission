import {baselineFleetChoice,isUsableFleetCandidate} from './fleet-coordination.mjs';
import {validFleetEvidence} from './meta.mjs';
import {appendLargeFleetRecord} from './readiness.mjs';

// Fictional data only: these counts describe simulated checks, not physical safety.
export function benchmarkCases(){
 const good={routes:20,total:40,observed:40,unknown:0,blocked:0,maxGap:20,avoidsHazard:true};
 const unknown={...good,observed:39,unknown:1};
 const blocked={...good,blocked:1};
 const d={routes:20,outboundM:1000,returnM:1200,totalM:2200,representative:{outboundM:50,returnM:60,totalM:110}};
 const make=(id,A,B)=>({id,evidence:{affected:20,unaffected:80,candidates:{A,B},representatives:{A:null,B:null},distances:{A:{...d,representative:{...d.representative}},B:{...d,representative:{...d.representative}}}}});
 return [make('both-eligible',{...good},{...good}),make('a-unknown',{...unknown},{...good}),make('both-ineligible',{...unknown},{...blocked})];
}

// Fictional boundary cases and expectations are fixed before consulting a model.
export function benchmarkBoundaryCases(){
 const make=(id,eligible,expectedBaseline,configure)=>{
  const evidence=structuredClone(benchmarkCases()[0].evidence);configure(evidence);
  return {id,eligible,expectedBaseline,evidence};
 };
 return [
  make('at-gap-limit',['A'],'A',e=>{e.candidates.A.maxGap=29;e.candidates.B.maxGap=30}),
  make('above-gap-limit',['B'],'B',e=>{e.candidates.A.maxGap=29.1;e.candidates.B.maxGap=29}),
  make('missing-distance',['B'],'B',e=>{e.distances.A=null}),
  make('no-hazard-clearance',[],'none',e=>{e.candidates.A.avoidsHazard=false;e.distances.B=null}),
  make('blocked-and-unknown',[],'none',e=>{e.candidates.A.blocked=1;e.candidates.B.observed=39;e.candidates.B.unknown=1}),
  make('zero-samples',['B'],'B',e=>{e.candidates.A.total=0;e.candidates.A.observed=0}),
  make('both-eligible-b-shorter',['A','B'],'A',e=>{e.distances.B.outboundM=600;e.distances.B.returnM=600;e.distances.B.totalM=1200}),
 ];
}

// The most recent matching run is selected even if its evidence is unusable:
// silently falling back to an older run would misrepresent the source.
export function benchmarkCaseFromHistory(raw,area){
 if(raw===null)throw new Error('この地域に保存済みの仮想配送記録がありません');
 let rows;try{rows=JSON.parse(raw)}catch{throw new Error('仮想配送の記録を読み取れません')}
 if(!Array.isArray(rows)||rows.length>20||typeof area!=='string'||!area)throw new Error('仮想配送の記録を確認してください');
 const matches=rows.filter(row=>row?.area===area);if(!matches.length)throw new Error('この地域に保存済みの仮想配送記録がありません');
 try{for(const row of matches)appendLargeFleetRecord(null,row)}catch{throw new Error('仮想配送の記録を確認してください')}
 if(new Set(matches.map(row=>row.id)).size!==matches.length)throw new Error('仮想配送の記録IDが重複しています');
 matches.sort((a,b)=>Date.parse(b.finishedAt)-Date.parse(a.finishedAt));
 const run=matches[0],evidence=run.comparison?.evidence;
 if(!validFleetEvidence(evidence)||!Object.hasOwn(evidence,'distances'))throw new Error('最新の仮想配送に比較できる点検・距離の記録がありません');
 return {source:{kind:'saved-simulation',runId:run.id,area:run.area,finishedAt:run.finishedAt,attempt:[1,2].includes(run.comparison.attempt)?run.comparison.attempt:null},cases:[{id:'saved-run',evidence:structuredClone(evidence)}]};
}

export async function runFleetBenchmark({cases=benchmarkCases(),request,signal,clock=()=>performance.now(),onProgress=()=>{}}={}){
 if(!Array.isArray(cases)||!cases.length||cases.length>100||typeof request!=='function'||new Set(cases.map(c=>c?.id)).size!==cases.length||cases.some(c=>!c||typeof c.id!=='string'||!/^[-a-z0-9]{1,60}$/.test(c.id)||!validFleetEvidence(c.evidence)||!Object.hasOwn(c.evidence,'distances')))throw new Error('比較ケースが不正です');
 const items=[];
 for(const entry of cases){
  signal?.throwIfAborted();const evidence=structuredClone(entry.evidence),started=clock(),baseline=baselineFleetChoice(evidence),baselineMs=Math.max(0,clock()-started),modelStarted=clock();let muse;
  try{
   const reply=await request(structuredClone(evidence),signal);signal?.throwIfAborted();
   const wrapped=reply&&typeof reply==='object'&&Object.hasOwn(reply,'result'),response=wrapped?reply.result:reply,provenance=wrapped&&['muse','fixture','unknown'].includes(reply.provenance)?reply.provenance:'unknown';
   if(!response||Object.keys(response).sort().join(',')!=='choice,reason'||!['A','B','none'].includes(response.choice)||typeof response.reason!=='string'||!response.reason.trim()||response.reason.length>240)throw new Error('回答形式が不正です');
   const eligible=response.choice==='none'||isUsableFleetCandidate(evidence.candidates[response.choice],evidence.distances[response.choice]);
   muse={state:eligible?'answered':'rejected',choice:response.choice,reason:response.reason.trim(),provenance,elapsedMs:Math.max(0,clock()-modelStarted),error:null};
  }catch(error){signal?.throwIfAborted();muse={state:'error',choice:null,reason:null,provenance:'unknown',elapsedMs:Math.max(0,clock()-modelStarted),error:String(error?.message||'比較に失敗しました').slice(0,160)}}
  items.push({id:entry.id,evidence,baseline:{...baseline,elapsedMs:baselineMs},muse});
  onProgress(items.length,cases.length);
 }
 return {version:1,method:'fleet-text-benchmark-v1',simulationOnly:true,input:'same structured evidence; rule reads inspection conditions and distance availability; Muse receives all values and written instructions; no image',requestedModel:'muse-spark-1.3',items,summary:{attempted:items.length,responded:items.filter(item=>item.muse.state!=='error').length,rejected:items.filter(item=>item.muse.state==='rejected').length},notice:'比較試験のみ。実飛行・安全・施設の受入の証明ではありません。Museの所要時間は通信を含みます。'};
}
