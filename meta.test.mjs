import {test} from 'node:test';import assert from 'node:assert/strict';import {parseBoxes,planWithMuse,segmentWithSam,transcribeWithMuse,rankChecksWithMuse,consultMapWithMuse,planMapDetour,validRouteEvidence} from './meta.mjs';
const response=text=>async()=>({ok:true,json:async()=>({output:[{content:[{type:'output_text',text}]}]})});
const samResponse=(text='',status='completed')=>new Response((text?'data: '+JSON.stringify({type:'response.output_text.delta',delta:text})+'\n\n':'')+'data: '+JSON.stringify({type:'response.completed',response:{status}})+'\n\n',{headers:{'Content-Type':'text/event-stream'}});
test('map detour sends measured candidate evidence and accepts stopping',async()=>{
  const evidence={A:{total:3,observed:2,unknown:1,blocked:0,maxGap:20},B:{total:3,observed:3,unknown:0,blocked:1,maxGap:25}};
  const calls=[];const fetcher=async(_url,options)=>{calls.push(JSON.parse(options.body));return response('{"choice":"none"}')()};
  assert.deepEqual(await planMapDetour({key:'test',image:'data:image/png;base64,AA==',evidence},fetcher),{sora:'none',nagi:'none',validation:{state:'stopped',reason:'相談の回答は候補なしでした'}});
  for(const call of calls){const prompt=call.input[0].content[0].text;assert.match(prompt,/"observed":2/);assert.match(prompt,/"blocked":1/);assert.match(prompt,/none/);assert.match(prompt,/道路・空地・未取得/)}
});
test('map detour preserves a model choice but rejects a candidate with unverified or blocked samples',async()=>{
  const evidence={A:{total:3,observed:2,unknown:1,blocked:0,maxGap:20},B:{total:3,observed:3,unknown:0,blocked:1,maxGap:25}};
  const result=await planMapDetour({key:'test',image:'data:image/png;base64,AA==',evidence},response('{"choice":"A"}'));
  assert.equal(result.nagi,'A');assert.equal(result.validation.state,'rejected');
  const tooWide={...evidence,A:{total:3,observed:3,unknown:0,blocked:0,maxGap:30}};
  const rejected=await planMapDetour({key:'test',image:'data:image/png;base64,AA==',evidence:tooWide},response('{"choice":"A"}'));
  assert.equal(rejected.validation.state,'rejected');
  const good={...evidence,A:{total:3,observed:3,unknown:0,blocked:0,maxGap:25}};
  assert.equal((await planMapDetour({key:'test',image:'data:image/png;base64,AA==',evidence:good},response('{"choice":"A"}'))).validation.state,'accepted');
});
test('route evidence requires complete bounded numerical reports without extra fields',()=>{
  const report={total:3,observed:2,unknown:1,blocked:0,maxGap:20};
  assert.equal(validRouteEvidence({A:report,B:report}),true);
  for(const invalid of [null,{}, {A:report,B:{...report,total:50}}, {A:report,B:{...report,unknown:2}}, {A:report,B:{...report,blocked:3}}, {A:report,B:{...report,maxGap:-1}}, {A:report,B:{...report,notes:'location'}}])assert.equal(!!validRouteEvidence(invalid),false);
});
test('mixed Muse selections retain both decisions without implying an unverified route was approved',async()=>{
  const report={total:3,observed:3,unknown:0,blocked:0,maxGap:20};let calls=0;
  const fetcher=async()=>response(++calls===1?'{"choice":"none"}':'{"choice":"A"}')();
  assert.deepEqual(await planMapDetour({key:'test',image:'data:image/png;base64,AA==',evidence:{A:report,B:report}},fetcher),{sora:'none',nagi:'A',validation:{state:'accepted',reason:'指定された点検条件を満たしました。実際の飛行の安全性は未確認です'}});
  await assert.rejects(planMapDetour({key:'test',image:'data:image/png;base64,AA=='},response('{"choice":"none"}')),/不正/);
});
test('map detour asks both Muse roles to choose between the pictured simulated options',async()=>{
  const calls=[];const fetcher=async(_url,options)=>{calls.push(JSON.parse(options.body));return response(calls.length===1?'{"choice":"A"}':'{"choice":"B"}')()};
  const result=await planMapDetour({key:'test',image:'data:image/png;base64,AA=='},fetcher);
  assert.deepEqual(result,{sora:'A',nagi:'B'});assert.equal(calls.length,2);
  for(const call of calls){assert.equal(call.model,'muse-spark-1.3');assert.equal(call.input[0].content[1].image_url,'data:image/png;base64,AA==');assert.match(call.input[0].content[0].text,/仮想/)}
  assert.match(calls[1].input[0].content[0].text,/A/);
});
test('map detour rejects incomplete or invalid responses without a final choice',async()=>{
  let calls=0;const fetcher=async()=>response(++calls===1?'{"choice":"A"}':'{"choice":"safe"}')();
  await assert.rejects(planMapDetour({key:'test',image:'data:image/png;base64,AA=='},fetcher),/不正/);
  await assert.rejects(planMapDetour({key:'test',image:'wrong'},fetcher),/不正/);
});
test('a cancelled or incomplete first map detour response cannot trigger the second model',async()=>{
  let count=0;const controller=new AbortController();
  const cancelled=async()=>{count++;controller.abort();return response('{"choice":"A"}')()};
  await assert.rejects(planMapDetour({key:'test',image:'data:image/png;base64,AA==',signal:controller.signal},cancelled));assert.equal(count,1);
  count=0;const incomplete=async()=>{count++;return {ok:true,json:async()=>({status:'incomplete',output:[]})}};
  await assert.rejects(planMapDetour({key:'test',image:'data:image/png;base64,AA=='},incomplete),/完了していません/);assert.equal(count,1);
});
test('map consultation uses the actual image and restricted supply data in both model calls',async()=>{
  const calls=[];const fetcher=async(_url,options)=>{calls.push(JSON.parse(options.body));return response(calls.length===1?'{"density":"dense"}':'{"ordered_ids":["flood","shelter_open","obstacles","airspace","communications"]}')()};
  const result=await consultMapWithMuse({key:'test',image:'data:image/png;base64,AA==',supply:'water',quantity:12},fetcher);
  assert.equal(result.density,'dense');assert.equal(result.ordered_ids.length,5);assert.equal(calls.length,2);
  for(const call of calls){assert.equal(call.model,'muse-spark-1.3');assert.equal(call.input[0].content[1].image_url,'data:image/png;base64,AA==');assert.match(call.input[0].content[0].text,/water/);assert.match(call.input[0].content[0].text,/12/)}
});
test('Muse receives the selected flood category with its uncertainty, without location details',async()=>{
  const calls=[];const fetcher=async(_url,options)=>{calls.push(JSON.parse(options.body));return response(calls.length===1?' {"density":"dense"}':'{"ordered_ids":["flood","shelter_open","obstacles","airspace","communications"]}')()};
  await consultMapWithMuse({key:'test',image:'data:image/png;base64,AA==',supply:'water',quantity:2,flood:'3.0〜5.0m'},fetcher);
  for(const call of calls){const prompt=call.input[0].content[0].text;assert.match(prompt,/3\.0〜5\.0m/);assert.match(prompt,/想定/);assert.match(prompt,/現在の浸水/);assert.doesNotMatch(prompt,/荒川|原中学校/)}
  await assert.rejects(consultMapWithMuse({key:'test',image:'data:image/png;base64,AA==',supply:null,quantity:null,flood:'安全'},fetcher),/不正/);
});
test('map consultation rejects unsafe or incomplete model output',async()=>{
  let n=0;const fetcher=async()=>response(++n===1?'{"density":"dense"}':'{"ordered_ids":["flood","flood","safe","airspace","communications"]}')();
  await assert.rejects(consultMapWithMuse({key:'test',image:'data:image/png;base64,AA==',supply:null,quantity:null},fetcher),/不正/);
  await assert.rejects(consultMapWithMuse({key:'test',image:'data:image/png;base64,AA==',supply:'unlisted',quantity:1},fetcher),/不正/);
});
test('map consultation stops if the first response is incomplete or cancelled',async()=>{
  let calls=0;const incomplete=async()=>{calls++;return {ok:true,json:async()=>({status:'incomplete',output:[]})}};
  await assert.rejects(consultMapWithMuse({key:'test',image:'data:image/png;base64,AA==',supply:null,quantity:null},incomplete),/完了していません/);assert.equal(calls,1);
  const controller=new AbortController();calls=0;
  const cancelled=async()=>{calls++;controller.abort();return response('{"density":"dense"}')()};
  await assert.rejects(consultMapWithMuse({key:'test',image:'data:image/png;base64,AA==',supply:null,quantity:null,signal:controller.signal},cancelled));assert.equal(calls,1);
});
test('Muse can only order the exact checklist IDs and cannot introduce claims',async()=>{
  const args={key:'test',ids:['flood','airspace','shelter_open']};
  const result=await rankChecksWithMuse(args,response('{"ordered_ids":["airspace","flood","shelter_open"]}'));
  assert.deepEqual(result,['airspace','flood','shelter_open']);
  await assert.rejects(rankChecksWithMuse(args,response('{"ordered_ids":["flood","flood","airspace"]}')),/確認項目/);
  await assert.rejects(rankChecksWithMuse(args,response('{"ordered_ids":["flood","airspace","safe"]}')),/確認項目/);
});
test('parses only valid SAM boxes',()=>{assert.deepEqual(parseBoxes('<0f>0<|box;x1=1;y1=2;x2=30;y2=40;w=100;h=100|>'),[{x1:1,y1:2,x2:30,y2:40,w:100,h:100}]);assert.deepEqual(parseBoxes('<|box;x1=3;y1=2;x2=130;y2=40;w=100;h=100|>'),[])});
test('rejects unsafe direct route after obstacle',async()=>{const request={key:'test',image:'data:image/png;base64,AA==',command:'water',hazard:true};await assert.rejects(planWithMuse(request,response('{"route":"direct","sora":"確認","nagi":"直進"}')),/安全条件/)});
test('returns a valid Muse reroute with image and hazard context',async()=>{
  let payload;
  const fetcher=async(url,options)=>{payload=JSON.parse(options.body);return response('{"route":"west","sora":"障害を確認","nagi":"西側を迂回"}')()};
  const result=await planWithMuse({key:'test',image:'data:image/png;base64,AA==',command:'届けて',hazard:true},fetcher);
  assert.equal(result.route,'west');assert.equal(payload.model,'muse-spark-1.3');assert.equal(payload.input[0].content[1].type,'input_image');
});
test('accepts the eastern detour and rejects a detour before the incident',async()=>{
  const input={key:'test',image:'data:image/png;base64,AA==',command:'届けて',hazard:true};
  const reply=response('{"route":"east","sora":"障害を確認","nagi":"東へ迂回"}');
  assert.equal((await planWithMuse(input,reply)).route,'east');
  await assert.rejects(planWithMuse({...input,hazard:false},reply),/安全条件/);
});
test('the second agent reviews the first and can choose a different safe route',async()=>{
  const bodies=[];
  const fetcher=async(_url,options)=>{bodies.push(JSON.parse(options.body));const answer=bodies.length===1?'{"route":"west","sora":"西が候補"}':'{"route":"east","nagi":"東を選択"}';return response(answer)()};
  const plan=await planWithMuse({key:'test',image:'data:image/png;base64,AA==',command:'届けて',hazard:true},fetcher);
  assert.equal(bodies.length,2);assert.equal(plan.route,'east');assert.match(bodies[1].input[0].content[0].text,/西が候補/);
  for(const [index,field] of ['sora','nagi'].entries()){
    const format=bodies[index].text.format;assert.equal(format.type,'json_schema');assert.equal(format.strict,true);
    assert.deepEqual(format.schema.required,['route',field]);assert.deepEqual(format.schema.properties.route.enum,['west','east']);
    assert.equal(format.schema.additionalProperties,false);
  }
});
test('both agents receive the actual SAM count, including a zero detection',async()=>{
  const prompts=[];
  const fetcher=async(_url,options)=>{prompts.push(JSON.parse(options.body).input[0].content[0].text);return response('{"route":"west","sora":"確認","nagi":"迂回"}')()};
  await planWithMuse({key:'test',image:'data:image/png;base64,AA==',command:'届けて',hazard:true,samCount:0},fetcher);
  assert.equal(prompts.length,2);for(const prompt of prompts){assert.match(prompt,/SAMの画像検出は0件/);assert.match(prompt,/配送先は避難所A、荷物は1箱に固定/)}
});
test('a failure from the reviewing agent cannot become a successful plan',async()=>{
  let calls=0;
  const fetcher=async()=>++calls===1?response('{"route":"west","sora":"西が候補"}')():{ok:false,status:503};
  await assert.rejects(planWithMuse({key:'test',image:'data:image/png;base64,AA==',command:'届けて',hazard:true},fetcher),/503/);
  assert.equal(calls,2);
});
test('an incomplete model response cannot become a successful plan even with valid JSON',async()=>{
  let calls=0;
  const fetcher=async()=>{calls++;return {ok:true,json:async()=>({status:'incomplete',output:[{content:[{type:'output_text',text:'{"route":"direct","sora":"出発できます"}'}]}]})}};
  await assert.rejects(planWithMuse({key:'test',image:'data:image/png;base64,AA==',command:'届けて',hazard:false},fetcher),/完了していません/);
  assert.equal(calls,1);
});
test('cancel after the first observation prevents a second model call',async()=>{
  let calls=0;const controller=new AbortController();
  const fetcher=async()=>{calls++;return response('{"route":"west","sora":"障害"}')()};
  await assert.rejects(planWithMuse({key:'test',image:'data:image/png;base64,AA==',command:'届けて',hazard:true,signal:controller.signal,onSora:()=>controller.abort()},fetcher));
  assert.equal(calls,1);
});
test('reports upstream failures without exposing response contents',async()=>{
  const fetcher=async()=>({ok:false,status:429});
  await assert.rejects(segmentWithSam({key:'test',image:'data:image/png;base64,AA=='},fetcher),/429/);
});
test('SAM is asked for the visible power lines rather than an unrelated object',async()=>{
  let request;
  const fetcher=async(_url,options)=>{request=JSON.parse(options.body);return samResponse('<0f>0<|box;x1=1;y1=2;x2=30;y2=40;w=100;h=100|>')};
  const boxes=await segmentWithSam({key:'test',image:'data:image/png;base64,AA=='},fetcher);
  assert.equal(request.input[0].content[0].text,'overhead power lines');assert.equal(request.stream,true);assert.equal(boxes.length,1);
});

test('planning distinguishes the simulated power line from SAM evidence',async()=>{
  const prompts=[];const fetcher=async(_url,options)=>{const payload=JSON.parse(options.body);prompts.push(payload.input[0].content[0].text);return new Response(JSON.stringify({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(prompts.length===1?{route:'west',sora:'確認'}:{route:'west',nagi:'迂回'})}]}]}),{status:200})};
  await planWithMuse({key:'test',image:'data:image/png;base64,AA==',command:'届けて',hazard:true,samCount:0},fetcher);
  assert.match(prompts[0],/仮想の電線/);assert.match(prompts[0],/0件/);assert.match(prompts[0],/目視で確認したと断定しない/);
});
test('SAM completed empty result is zero detections, while incomplete or malformed results fail',async()=>{
  const input={key:'test',image:'data:image/png;base64,AA=='};
  assert.deepEqual(await segmentWithSam(input,async()=>samResponse()),[]);
  await assert.rejects(segmentWithSam(input,async()=>samResponse('','incomplete')),/完了していません/);
  await assert.rejects(segmentWithSam(input,async()=>samResponse('unexpected')),/読み取れません/);
});
test('SAM refuses a partial answer when any candidate box is malformed or out of range',async()=>{
  const input={key:'test',image:'data:image/png;base64,AA=='};
  const valid='<|box;x1=1;y1=2;x2=30;y2=40;w=100;h=100|>';
  for(const broken of [
    '<|box;x1=1;y1=2;x2=130;y2=40;w=100;h=100|>',
    '<|box;x1=1;y1=2;x2=bad;y2=40;w=100;h=100|>',
    '<|box;x1=1;y1=2;',
    `<|box;x1=1;y1=2;x2=30;y2=40;w=${'9'.repeat(310)};h=100|>`,
  ]) await assert.rejects(segmentWithSam(input,async()=>samResponse(`<0f>0${valid}${broken}`)),/読み取れません/);
  const boxes=await segmentWithSam(input,async()=>samResponse(`<0f>0${valid}${valid}`));
  assert.equal(boxes.length,2);
});
test('push-to-talk transcription reads the top-level transcript and rejects silence',async()=>{
  const fetcher=async()=>({ok:true,json:async()=>({transcript:'水を届けて',turns:[]})});
  assert.equal(await transcribeWithMuse({key:'test',wav:new Uint8Array([1,2])},fetcher),'水を届けて');
  await assert.rejects(transcribeWithMuse({key:'test',wav:new Uint8Array([1])},async()=>({ok:true,json:async()=>({transcript:'',turns:[]})})),/認識できません/);
});
