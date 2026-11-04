// This module does nothing until a caller explicitly invokes an operation.
import {CHECK_LABELS,MAP_CHECK_IDS,mapConsultInputValid,mapFloodInputValid,validateConsultObservation,validateConsultFieldReports,validateConsultFacilityReports,validateConsultFloodBulletin,describeMapConsult,validateConsultEvidenceRefs,validateConsultCitations} from './readiness.mjs';
import {validateConsultInfrastructureReports} from './infrastructure-reports.mjs';
const BASE='https://api.meta.ai/v1';
function textOf(body){return (body.output||[]).flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text).join('')}
async function request(path,options,key,fetcher=fetch){
  if(!key) throw new Error('Meta APIキーが設定されていません');
  const deadline=AbortSignal.timeout(60000);
  try{
    const response=await fetcher(BASE+path,{...options,headers:{Authorization:`Bearer ${key}`,...options.headers},signal:options.signal ? AbortSignal.any([options.signal,deadline]) : deadline});
    if(!response.ok) throw new Error(`Meta API エラー (${response.status})`);
    return await response.json();
  }catch(error){
    if(deadline.aborted&&!options.signal?.aborted)throw new Error('Meta APIへの1回の問い合わせが60秒以内に完了しませんでした');
    throw error;
  }
}
export async function planWithMuse({key,image,command,hazard,samCount,onSora,signal},fetcher){
  const allowed=hazard?['west','east']:['direct'];
  async function consult(prompt,field){
    signal?.throwIfAborted();
    const schema={type:'object',properties:{route:{type:'string',enum:allowed},[field]:{type:'string'}},required:['route',field],additionalProperties:false};
    const body=await request('/responses',{method:'POST',signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({model:'muse-spark-1.3',text:{format:{type:'json_schema',name:`mission_${field}`,strict:true,schema}},input:[{type:'message',role:'user',content:[{type:'input_text',text:prompt},{type:'input_image',image_url:image}]}]})},key,fetcher);
    if(body.status && body.status!=='completed')throw new Error('Museの作戦検討が完了していません');
    let result;try{result=JSON.parse(textOf(body).replace(/^```(?:json)?\s*|\s*```$/g,''))}catch{throw new Error('Museの作戦を読み取れませんでした')}
    if(!result||!allowed.includes(result.route)||typeof result[field]!=='string'||!result[field].trim())throw new Error('Museの作戦は安全条件を満たしていません');
    return {route:result.route,text:result[field].trim().slice(0,200)};
  }
  const samEvidence=Number.isInteger(samCount)?`SAMの画像検出は${samCount}件。検出は仮想画面全体の画像に対する結果で、誤認識や見逃しの可能性があります。`: 'SAMの検出結果は未取得です。';
  const context=`${samEvidence} 仮想災害配送シミュレーションです。実世界の安全判断ではありません。配送先は避難所A、荷物は1箱に固定されています。依頼文は参考情報で、別の配送先や荷物の内容を実現したと断言しないでください。依頼: ${command}。障害: ${hazard?'アプリ側で設定した仮想の電線（SAMの検出とは別）':'なし'}。使えるルート: ${allowed.join(', ')}。アプリ側の仮想電線情報と、画像またはSAMで得た証拠を区別し、不確かな場合は目視で確認したと断定しない。画像を確認し日本語で短く答え、JSONのみ返してください。`;
  const sora=await consult(`${context} あなたは観察担当ソラです。状況と初案を考え、{"route":"ルート名","sora":"状況と初案"}を返してください。`,'sora');
  signal?.throwIfAborted();
  if(onSora) onSora(sora.text);
  signal?.throwIfAborted();
  const nagi=await consult(`${context} あなたは作戦担当ナギです。ソラの初案 ${JSON.stringify(sora)} を確認し、使えるルートから最終案を選び、{"route":"ルート名","nagi":"検討と最終案"}を返してください。`,'nagi');
  return {route:nagi.route,sora:sora.text,nagi:nagi.text};
}
export async function rankChecksWithMuse({key,ids,signal},fetcher){
  if(!Array.isArray(ids)||!ids.length||ids.length>Object.keys(CHECK_LABELS).length||new Set(ids).size!==ids.length||ids.some(id=>!Object.hasOwn(CHECK_LABELS,id)))throw new Error('確認項目が不正です');
  const schema={type:'object',properties:{ordered_ids:{type:'array',items:{type:'string',enum:ids}}},required:['ordered_ids'],additionalProperties:false};
  const text=`災害対応の準備で未確認の項目を確認する順に並べてください。候補：${JSON.stringify(ids.map(id=>({id,label:CHECK_LABELS[id]})))}。すべてのIDを重複なく一度ずつ返してください。安全や飛行可否を判断せず、指定されたJSONだけを返してください。`;
  const body=await request('/responses',{method:'POST',signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({model:'muse-spark-1.3',text:{format:{type:'json_schema',name:'check_order',strict:true,schema}},input:[{type:'message',role:'user',content:[{type:'input_text',text}]}]})},key,fetcher);
  if(body.status&&body.status!=='completed')throw new Error('Museの確認が完了していません');
  let result;try{result=JSON.parse(textOf(body))}catch{throw new Error('Museの確認項目を読み取れません')}
  const order=result?.ordered_ids;if(!Array.isArray(order)||order.length!==ids.length||new Set(order).size!==ids.length||order.some(id=>!ids.includes(id)))throw new Error('Museの確認項目が不正です');return order;
}
export function validRouteEvidence(evidence){
  if(!evidence||Array.isArray(evidence)||typeof evidence!=='object'||Object.keys(evidence).sort().join(',')!=='A,B')return false;
  return ['A','B'].every(side=>{const r=evidence[side];return r&&typeof r==='object'&&!Array.isArray(r)&&Object.keys(r).sort().join(',')==='blocked,maxGap,observed,total,unknown'&&Number.isInteger(r.total)&&r.total>0&&r.total<=49&&Number.isInteger(r.observed)&&r.observed>=0&&Number.isInteger(r.unknown)&&r.unknown>=0&&r.observed+r.unknown===r.total&&Number.isInteger(r.blocked)&&r.blocked>=0&&r.blocked<=r.observed&&Number.isFinite(r.maxGap)&&r.maxGap>=0&&r.maxGap<=20000});
}
export function validFleetEvidence(input){
  if(!input||typeof input!=='object'||Array.isArray(input)||!['affected,candidates,unaffected','affected,candidates,representatives,unaffected','affected,candidates,distances,representatives,unaffected'].includes(Object.keys(input).sort().join(',')))return false;
  const {affected,unaffected,candidates,representatives,distances}=input;
  if(!Number.isInteger(affected)||affected<1||affected>10000||!Number.isInteger(unaffected)||unaffected<0||unaffected>10000)return false;
  if(!candidates||typeof candidates!=='object'||Array.isArray(candidates)||Object.keys(candidates).sort().join(',')!=='A,B')return false;
  if(representatives!==undefined&&(!representatives||Array.isArray(representatives)||typeof representatives!=='object'||Object.keys(representatives).sort().join(',')!=='A,B'))return false;
  if(distances!==undefined&&(!distances||Array.isArray(distances)||typeof distances!=='object'||Object.keys(distances).sort().join(',')!=='A,B'))return false;
  return ['A','B'].every(key=>{
    const r=candidates[key];
    const base=!!r&&typeof r==='object'&&!Array.isArray(r)&&
      Object.keys(r).sort().join(',')==='avoidsHazard,blocked,maxGap,observed,routes,total,unknown'&&
      r.routes===affected&&Number.isInteger(r.total)&&r.total>=0&&r.total<=1000000&&
      Number.isInteger(r.observed)&&r.observed>=0&&Number.isInteger(r.unknown)&&r.unknown>=0&&
      r.observed+r.unknown===r.total&&Number.isInteger(r.blocked)&&r.blocked>=0&&r.blocked<=r.observed&&
      Number.isFinite(r.maxGap)&&r.maxGap>=0&&r.maxGap<=20000&&typeof r.avoidsHazard==='boolean';
    if(!base)return false;
    if(representatives!==undefined&&representatives[key]!==null){
      const one=representatives[key];
      if(!(!!one&&typeof one==='object'&&!Array.isArray(one)&&Object.keys(one).sort().join(',')==='blocked,maxGap,observed,total,unknown'&&
        Number.isInteger(one.total)&&one.total>0&&one.total<=r.total&&Number.isInteger(one.observed)&&one.observed>=0&&
        Number.isInteger(one.unknown)&&one.unknown>=0&&one.observed+one.unknown===one.total&&one.observed<=r.observed&&one.unknown<=r.unknown&&
        Number.isInteger(one.blocked)&&one.blocked>=0&&one.blocked<=one.observed&&one.blocked<=r.blocked&&Number.isFinite(one.maxGap)&&one.maxGap>=0&&one.maxGap<=r.maxGap))return false;
    }
    if(distances===undefined||distances[key]===null)return true;
    const d=distances[key],one=d?.representative;
    const validLength=n=>Number.isSafeInteger(n)&&n>=0&&n<=10000000000;
    return !!d&&typeof d==='object'&&!Array.isArray(d)&&Object.keys(d).sort().join(',')==='outboundM,representative,returnM,routes,totalM'&&d.routes===affected&&
      [d.outboundM,d.returnM,d.totalM].every(validLength)&&Math.abs(d.outboundM+d.returnM-d.totalM)<=1&&
      !!one&&typeof one==='object'&&!Array.isArray(one)&&Object.keys(one).sort().join(',')==='outboundM,returnM,totalM'&&
      [one.outboundM,one.returnM,one.totalM].every(validLength)&&Math.abs(one.outboundM+one.returnM-one.totalM)<=1&&
      one.outboundM<=d.outboundM+1&&one.returnM<=d.returnM+1&&one.totalM<=d.totalM+1;
  });
}
export async function planFleetTextBenchmark({key,evidence,signal},fetcher){
  if(!validFleetEvidence(evidence)||!Object.hasOwn(evidence,'distances'))throw new Error('比較用の点検情報が不正です');
  const schema={type:'object',properties:{choice:{type:'string',enum:['A','B','none']},reason:{type:'string'}},required:['choice','reason'],additionalProperties:false};
  const text=`これは実飛行に使わない架空の比較試験です。画像はありません。次の候補データだけを検討してください。Aは元の施設、Bは別の施設への仮想経路です。候補が条件を満たすには、avoidsHazard=true、total>0、observed=total、unknown=0、blocked=0、maxGap<=29、対応するdistancesがnullでない必要があります。どちらも不適合ならnoneを選んでください。条件を満たしても現場の安全や施設の受入は未確認です。点検情報: ${JSON.stringify(evidence)}。指定のJSONだけで選択と短い理由を返してください。`;
  const body=await request('/responses',{method:'POST',signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({model:'muse-spark-1.3',text:{format:{type:'json_schema',name:'fleet_text_benchmark',strict:true,schema}},input:[{type:'message',role:'user',content:[{type:'input_text',text}]}]})},key,fetcher);
  if(body.status&&body.status!=='completed')throw new Error('Museの比較回答が完了していません');
  let result;try{result=JSON.parse(textOf(body))}catch{throw new Error('Museの比較回答を読み取れません')}
  if(!result||Object.keys(result).sort().join(',')!=='choice,reason'||!['A','B','none'].includes(result.choice)||typeof result.reason!=='string'||!result.reason.trim()||result.reason.length>240)throw new Error('Museの比較回答が不正です');
  return {choice:result.choice,reason:result.reason.trim()};
}
export async function planFleetWithMuse({key,image,evidence,signal},fetcher){
  if(typeof image!=='string'||!image.startsWith('data:image/png;base64,')||!validFleetEvidence(evidence))throw new Error('機体の共有情報が不正です');
  const schema={type:'object',properties:{choice:{type:'string',enum:['A','B','none']},reason:{type:'string'}},required:['choice','reason'],additionalProperties:false};
  const distanceContext=evidence.distances===undefined?'候補の距離は未計測です。':'distancesはアプリが経路座標の全区間から計算した概算地表距離（m）で、全対象機の合計と代表機1機の往路・復路・往復です。nullは不明です。';
  const context=`架空の100機配送シミュレーションです。障害はアプリが作った仮想区域で、現場の発見ではありません。画像は実地図の現在のライブ映像ではありません。Aは元の施設への迂回、Bは別の公開施設への迂回です。画像の線は代表機1機の候補で全機の経路ではありません。共有情報の candidates は影響を受ける全機の往復点検合計、representatives は画像に描いた各案の代表機1機だけの往復点検です。nullは未点検です。${distanceContext} 点検点数の大小だけで経路の優劣を判断しないでください。距離は実際の飛行距離・時間・安全の証拠ではありません。共有・点検情報: ${JSON.stringify(evidence)}。電線、点検地点の間、施設の受入、実飛行の安全は未確認です。これは仮想配送だけの候補比較で、実飛行の許可や安全の判断ではありません。実世界の情報が未確認であることを維持し、提供された集計だけを根拠にA、B、または候補なしのnoneを選んでください。仮想候補の点検が不十分な場合や比較できない場合はnoneを選べます。距離や未確認情報を推測して断定しないでください。短い日本語の理由を付けてJSONのみ返してください。`;
  async function ask(prompt){
    signal?.throwIfAborted();
    const body=await request('/responses',{method:'POST',signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({model:'muse-spark-1.3',text:{format:{type:'json_schema',name:'fleet_coordination',strict:true,schema}},input:[{type:'message',role:'user',content:[{type:'input_text',text:prompt},{type:'input_image',image_url:image}]}]})},key,fetcher);
    if(body.status&&body.status!=='completed')throw new Error('Museの相談が完了していません');
    let result;try{result=JSON.parse(textOf(body))}catch{throw new Error('Museの相談結果を読み取れません')}
    if(!result||Object.keys(result).sort().join(',')!=='choice,reason'||!['A','B','none'].includes(result.choice)||typeof result.reason!=='string'||!result.reason.trim()||result.reason.length>240)throw new Error('Museの相談結果が不正です');
    return {choice:result.choice,reason:result.reason.trim()};
  }
  const sora=await ask(context+' 観察担当ソラとして候補を選んでください。');
  const nagi=await ask(context+' ソラの回答は '+JSON.stringify(sora)+'。作戦担当ナギとして再検討してください。');
  return {sora,nagi};
}
export async function planMapDetour({key,image,evidence,signal},fetcher){
  if(typeof image!=='string'||!image.startsWith('data:image/png;base64,'))throw new Error('画像が不正です');
  if(evidence!==undefined&&!validRouteEvidence(evidence))throw new Error('点検結果が不正です');
  const choices=evidence===undefined?['A','B']:['A','B','none'];
  const schema={type:'object',properties:{choice:{type:'string',enum:choices}},required:['choice'],additionalProperties:false};
  const ask=async prompt=>{
    signal?.throwIfAborted();
    const body=await request('/responses',{method:'POST',signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({model:'muse-spark-1.3',text:{format:{type:'json_schema',name:'map_detour',strict:true,schema}},input:[{type:'message',role:'user',content:[{type:'input_text',text:prompt},{type:'input_image',image_url:image}]}]})},key,fetcher);
    if(body.status&&body.status!=='completed')throw new Error('Museの相談が完了していません');
    let result;try{result=JSON.parse(textOf(body))}catch{throw new Error('Museの回答を読み取れません')}
    if(!choices.includes(result?.choice))throw new Error('Museの回答が不正です');return result.choice;
  };
  const measured=evidence===undefined?'':`建物モデル点検結果（total=点数、observed=高さを取得した点数、unknown=高さなしの点数で道路・空地・未取得を含みます、blocked=仮想高度付近以上の表面が見つかった点数、maxGap=最大間隔m）: ${JSON.stringify(evidence)}。高さなしは安全やデータ取得失敗の証明ではありません。どちらも選べなければnoneを選んでください。`;
  const context=`これは実地図上の架空の配送シミュレーションです。画像中の異なる色で示した仮想迂回案AとBを見て、デモで再生する候補を選んでください。地図は現場のライブ映像ではなく、電線、点検地点間、風、飛行規制、安全性は確認できません。選択は実際の飛行の推奨や許可ではありません。${measured}JSONのみ返してください。`;
  const sora=await ask(`${context} 観察担当ソラとして${choices.join('、')}から選んでください。`);
  const nagi=await ask(`${context} ソラの選択は${sora}です。作戦担当ナギとして再検討し${choices.join('、')}から選んでください。`);
  if(evidence===undefined)return {sora,nagi};
  const report=evidence[nagi];
  const validation=nagi==='none'?{state:'stopped',reason:'相談の回答は候補なしでした'}:!report||report.observed===0||report.unknown>0||report.blocked>0||report.maxGap>29?{state:'rejected',reason:'点検地点の不足、障害候補、または点検間隔により採用できません'}:{state:'accepted',reason:'指定された点検条件を満たしました。実際の飛行の安全性は未確認です'};
  return {sora,nagi,validation};
}
export async function consultMapWithMuse({key,image,supply,quantity,flood=null,observation,fieldReports,facilityReports,bulletin,infrastructureReports,evidenceRefs,signal},fetcher){
  if(!mapConsultInputValid(supply,quantity)||!mapFloodInputValid(flood)||(observation!==undefined&&!validateConsultObservation(observation,Date.now()))||(fieldReports!==undefined&&!validateConsultFieldReports(fieldReports,Date.now()))||(facilityReports!==undefined&&!validateConsultFacilityReports(facilityReports,Date.now()))||(bulletin!==undefined&&!validateConsultFloodBulletin(bulletin,Date.now()))||(infrastructureReports!==undefined&&!validateConsultInfrastructureReports(infrastructureReports,Date.now()))||typeof image!=='string'||!image.startsWith('data:image/png;base64,'))throw new Error('入力が不正です');
  const hasFloodRef=evidenceRefs?.some?.(ref=>ref.kind==='flood')===true;
  if((observation!==undefined||fieldReports!==undefined||facilityReports!==undefined||bulletin!==undefined||infrastructureReports!==undefined)&&!evidenceRefs||evidenceRefs!==undefined&&(!validateConsultEvidenceRefs(evidenceRefs,hasFloodRef,observation!==undefined,fieldReports!==undefined,facilityReports!==undefined,bulletin!==undefined,infrastructureReports!==undefined)||(!hasFloodRef&&flood!==null)))throw new Error('相談の参照IDが不正です');
  const ask=async(name,schema,prompt)=>{
    signal?.throwIfAborted();
    if(fieldReports!==undefined&&!validateConsultFieldReports(fieldReports,Date.now()))throw new Error('現地報告の期限または日時を再確認してください');
    if(facilityReports!==undefined&&!validateConsultFacilityReports(facilityReports,Date.now()))throw new Error('施設報告の期限または日時を再確認してください');
    if(bulletin!==undefined&&!validateConsultFloodBulletin(bulletin,Date.now()))throw new Error('洪水予報の取得時刻を再確認してください');
    if(infrastructureReports!==undefined&&!validateConsultInfrastructureReports(infrastructureReports,Date.now()))throw new Error('設備報告の期限を再確認してください');
    if(observation!==undefined&&!validateConsultObservation(observation,Date.now()))throw new Error('気象観測の日時を再確認してください');
    const timestamp=`相談送信時刻（サーバー時刻）：${new Date().toISOString()}。時刻の正確性は未検証です。情報の発表・観測時刻と区別してください。`;
    const body=await request('/responses',{method:'POST',signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({model:'muse-spark-1.3',text:{format:{type:'json_schema',name,strict:true,schema}},input:[{type:'message',role:'user',content:[{type:'input_text',text:`${timestamp}${prompt}`},{type:'input_image',image_url:image}]}]})},key,fetcher);
    if(body.status&&body.status!=='completed')throw new Error('Museの画像確認が完了していません');
    try{return JSON.parse(textOf(body))}catch{throw new Error('Museの画像確認を読み取れません')}
  };
  const refsContext=evidenceRefs?`入力参照ID（与えられた入力を識別するだけで現地検証ではない）：${evidenceRefs.map(ref=>`${ref.kind} ${ref.id}`).join('、')}。` : '';
  const obsContext=observation?`別途提供された気象庁観測所の地上観測：${JSON.stringify(observation)}。distanceMetersは地図の基準点から観測所までの概算直線距離、referenceKindのfacilityは選択した施設の公開座標、model_centerは建物モデルの範囲中心です。referenceKindがない場合は基準点の種類は不明です。観測データに施設名・住所・座標は含まれません。rainは観測前10分間、rain1hは観測前1時間、rain24hは観測前24時間の降水量mm、windは観測前10分間の平均風速m/sです。項目がない場合やnullは未提供または欠測です。施設や上空の実測値ではなく現在の安全を示しません。`:'近隣観測データは提供されていません。';
  const fieldContext=fieldReports?`別途入力された人の報告（未検証）：${JSON.stringify(fieldReports)}。statusのwater_seenは水が見えた、no_water_seenは水が見えなかった、uncertainは不明との申告です。scopeは申告された対象範囲であり、同じ分類でも同じ場所や同じ時刻の報告とは限りません。日時は利用者が入力したものです。内容や報告者は確認されていません。異なる報告は一つに決めつけず、過去の想定図と現況を混同しないでください。水が見えないとの報告は安全を示しません。`:'人の現地報告は提供されていません。';
  const facilityContext=facilityReports?`別途入力された施設の受け入れに関する人の報告（未検証）：${JSON.stringify(facilityReports)}。内容と報告者は確認されていません。conditionalの具体的な条件は送信されていません。着地点や数量も人の申告で、現場や実際の受入可能性を確認したものではありません。correctionIndexは配列の0から始まる訂正対象の番号、correctionTargetOmittedは期限切れ等で訂正対象が含まれないことを表します。異なる報告を勝手に一つに決めず、必要な条件や確認先を人に再確認してください。`:'施設受け入れに関する人の報告は提供されていません。';
  const bulletinContext=bulletin?`利用者が選択した気象庁の洪水予報電文からアプリが抽出したデータ（元電文は確認してください）：${JSON.stringify(bulletin)}。対象施設との対応は未確認です。現況は電文中の観測時点で、時間後は電文中の予測、欠測は不明です。水位が0件でも水位情報が存在しない証拠ではありません。異なる値があっても正しい方を決めつけず、元電文を確認してください。後続の訂正や現在の浸水・飛行安全は不明で、この入力を現在の状態として断定しないでください。`:'洪水予報電文は提供されていません。';
  const infrastructureContext=infrastructureReports?`利用者が選択した人の設備報告（未検証）：${JSON.stringify(infrastructureReports)}。位置・場所の説明・確認先は含まれません。どの経路や施設に関係するか不明です。日時は利用者の入力で未検証です。地図画像は現場映像ではなく、報告を画像内の候補と結び付けないでください。not_seenは確認範囲で見えなかったという申告で、設備がない証拠ではありません。訂正番号は本人による関連付けで、報告者と内容の正確性は未確認です。複数の報告を勝手に一つに決めず、実際の安全を推定しないでください。`:'人の設備報告は提供されていません。';
  const context=`これはPLATEAU等の3D地図画像であり、現場のライブ映像ではありません。入力は物資の種類 ${JSON.stringify(supply)}、数量 ${JSON.stringify(quantity)}箱です。施設の公開座標1地点の洪水想定（想定最大規模）の参考区分は ${JSON.stringify(flood)} です。nullは不明であり、安全を意味しません。これは過去の想定図の着色で、現在の浸水や施設全体の状態ではありません。位置誤差や未提供もあります。浸水、電線、空域、施設の受入、飛行の安全を画像から断定しないでください。${obsContext}${fieldContext}${facilityContext}${bulletinContext}${infrastructureContext}${refsContext}`;
  const densitySchema={type:'object',properties:{density:{type:'string',enum:['dense','sparse','unclear']}},required:['density'],additionalProperties:false};
  const first=await ask('map_observation',densitySchema,`${context} 画像内の建物の見え方をdense、sparse、unclearから選び、JSONで返してください。`);
  if(!first||!['dense','sparse','unclear'].includes(first.density))throw new Error('画像の観察結果が不正です');
  const orderSchema={type:'object',properties:{ordered_ids:{type:'array',items:{type:'string',enum:MAP_CHECK_IDS}},...(evidenceRefs?{cited_ids:{type:'array',items:{type:'string',enum:evidenceRefs.map(ref=>ref.id)}}}:{})},required:evidenceRefs?['ordered_ids','cited_ids']:['ordered_ids'],additionalProperties:false};
  const second=await ask('map_checks',orderSchema,`${context} 観察担当は画像内の建物の見え方を ${first.density} と分類しました。次の未確認項目を確認する順に、重複なく全て返してください：${JSON.stringify(MAP_CHECK_IDS.map(id=>({id,label:CHECK_LABELS[id]})))}。${evidenceRefs?'確認順を考える際に参照した入力IDだけを重複なくcited_idsで返してください。不明なら空配列にしてください。':''}`);
  const result={density:first.density,ordered_ids:second?.ordered_ids};describeMapConsult(result);
  if(evidenceRefs){if(!validateConsultCitations(evidenceRefs,second?.cited_ids))throw new Error('Museの参照IDを確認できません');result.cited_ids=[...second.cited_ids]}
  return result;
}
export function parseBoxes(text){
  const regex=/<\|box;x1=(\d+);y1=(\d+);x2=(\d+);y2=(\d+);w=(\d+);h=(\d+)\|>/g;
  return [...text.matchAll(regex)].map(m=>m.slice(1).map(Number)).filter(values=>values.every(Number.isSafeInteger)).filter(([x1,y1,x2,y2,w,h])=>w>0&&h>0&&x1<x2&&y1<y2&&x2<=w&&y2<=h).map(([x1,y1,x2,y2,w,h])=>({x1,y1,x2,y2,w,h}));
}
export async function readSamEventStream(body,{maxBytes=12_000_000}={}){
  if(!body?.getReader)throw new Error('SAMの応答を受信できません');
  const reader=body.getReader(),decoder=new TextDecoder();
  let pending='',text='',bytes=0,completed=false;
  function consume(block){
    const data=block.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');
    if(!data||data==='[DONE]')return;
    let event;try{event=JSON.parse(data)}catch{throw new Error('SAMの応答形式が不正です')}
    if(event.type==='response.output_text.delta'){
      if(typeof event.delta!=='string')throw new Error('SAMの応答形式が不正です');
      text+=event.delta;
    }else if(event.type==='response.failed'||event.type==='error')throw new Error('SAMの認識に失敗しました');
    else if(event.type==='response.completed'){
      if(event.response?.status!=='completed')throw new Error('SAMの認識が完了していません');
      completed=true;
    }
  }
  try{
    while(!completed){
      const chunk=await reader.read();bytes+=chunk.value?.byteLength||0;
      if(bytes>maxBytes)throw new Error('SAMの応答が大きすぎます');
      pending+=decoder.decode(chunk.value||new Uint8Array(),{stream:!chunk.done});
      const blocks=pending.split(/\r?\n\r?\n/);pending=blocks.pop();
      for(const block of blocks){consume(block);if(completed)break}
      if(chunk.done){if(pending.trim())throw new Error('SAMの応答が途中で終了しました');break}
    }
    if(!completed)throw new Error('SAMの応答が途中で終了しました');
    return text;
  }finally{await reader.cancel().catch(()=>{});reader.releaseLock()}
}
export async function segmentWithSam({key,image,signal},fetcher){
  if(!key)throw new Error('Meta APIキーが設定されていません');
  const deadline=AbortSignal.timeout(60000);
  let text;
  try{
    const response=await (fetcher||fetch)(BASE+'/responses',{method:'POST',signal:signal?AbortSignal.any([signal,deadline]):deadline,headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json',Accept:'text/event-stream'},body:JSON.stringify({model:'sam-3.1',stream:true,input:[{type:'message',role:'user',content:[{type:'input_text',text:'overhead power lines'},{type:'input_image',image_url:image}]}]})});
    if(!response.ok)throw new Error(`Meta API エラー (${response.status})`);
    if(!response.headers?.get('content-type')?.includes('text/event-stream'))throw new Error('SAMの応答形式が不正です');
    text=await readSamEventStream(response.body);
  }catch(error){if(deadline.aborted&&!signal?.aborted)throw new Error('Meta APIへの1回の問い合わせが60秒以内に完了しませんでした');throw error}
  if(!text.trim())return [];
  const boxes=parseBoxes(text);
  if(!boxes.length||boxes.length!==(text.match(/<\|box/g)||[]).length)throw new Error('SAMの認識形式を読み取れませんでした');
  return boxes;
}
export async function transcribeWithMuse({key,wav,signal},fetcher){
  const form=new FormData();form.append('request',new Blob([JSON.stringify({model:'muse-voice-transcribe-1.0',audioEncoding:'WAV',mode:'PUSH_TO_TALK',languageBias:['Japanese']})],{type:'application/json'}));form.append('audio',new Blob([wav],{type:'audio/wav'}),'request.wav');
  const data=await request('/asr/transcribe',{method:'POST',signal,headers:{Accept:'application/json'},body:form},key,fetcher);
  const transcript=typeof data.transcript==='string'?data.transcript.trim():'';if(!transcript)throw new Error('音声を認識できませんでした');return transcript;
}
