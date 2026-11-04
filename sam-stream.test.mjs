import test from 'node:test';
import assert from 'node:assert/strict';
import {readSamEventStream} from './meta.mjs';
const ev = object => `data: ${JSON.stringify(object)}\r\n\r\n`;
const stream = chunks => new ReadableStream({ start(c) { for (const chunk of chunks) c.enqueue(new TextEncoder().encode(chunk)); c.close(); } });
test('joins split streamed tokens and accepts only a completed response', async()=>{
 const raw=ev({type:'response.output_text.delta',delta:'<0f>1<|box;x1=1;y1=2;'})+ev({type:'response.output_text.delta',delta:'x2=30;y2=40;w=100;h=100|>'})+ev({type:'response.completed',response:{status:'completed'}});
 assert.equal(await readSamEventStream(stream([raw.slice(0,31),raw.slice(31,90),raw.slice(90)])),'<0f>1<|box;x1=1;y1=2;x2=30;y2=40;w=100;h=100|>');
});
test('zero matches require completion, while errors and truncation are failures',async()=>{
 assert.equal(await readSamEventStream(stream([ev({type:'response.completed',response:{status:'completed'}})])),'');
 await assert.rejects(readSamEventStream(stream([ev({type:'response.output_text.delta',delta:'partial'})])),/途中/);
 await assert.rejects(readSamEventStream(stream([ev({type:'response.failed',response:{status:'failed'}})])),/失敗/);
 await assert.rejects(readSamEventStream(stream(['data: {not-json}\n\n'])),/形式/);
 await assert.rejects(readSamEventStream(stream([ev({type:'response.completed',response:{status:'incomplete'}})])),/完了/);
});
test('bounds streamed data and rejects malformed deltas',async()=>{
 await assert.rejects(readSamEventStream(stream([ev({type:'response.output_text.delta',delta:42})])),/形式/);
 await assert.rejects(readSamEventStream(stream(['data: '+ 'x'.repeat(500)+'\n\n']),{maxBytes:100}),/大き/);
});
