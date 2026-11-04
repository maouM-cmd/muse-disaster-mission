import {test} from 'node:test';import assert from 'node:assert/strict';
import {readPlanStream} from './plan-stream.mjs';
function stream(chunks){return new Response(new ReadableStream({start(controller){for(const chunk of chunks)controller.enqueue(chunk);controller.close()}}))}
test('handles split Japanese characters and emits observations before the final result',async()=>{
  const bytes=new TextEncoder().encode('{"type":"sora","text":"障害を確認"}\n{"type":"result","result":{"route":"east"}}\n');
  const said=[];const result=await readPlanStream(stream([bytes.slice(0,27),bytes.slice(27,28),bytes.slice(28)]),text=>said.push(text));
  assert.deepEqual(said,['障害を確認']);assert.equal(result.route,'east');
});
test('does not accept an unfinished stream as a successful plan',async()=>{
  const bytes=new TextEncoder().encode('{"type":"sora","text":"確認"}\n');
  await assert.rejects(readPlanStream(stream([bytes]),()=>{}),/最終結果/);
  await assert.rejects(readPlanStream(stream([new TextEncoder().encode('{"type":"result"')]),()=>{}),/途中/);
});
test('surfaces a review failure after an observation',async()=>{
  const bytes=new TextEncoder().encode('{"type":"sora","text":"確認"}\n{"type":"error","error":"確認失敗"}\n');
  await assert.rejects(readPlanStream(stream([bytes]),()=>{}),/確認失敗/);
});
