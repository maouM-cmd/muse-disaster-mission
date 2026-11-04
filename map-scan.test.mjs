import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createMapScan} from './readiness.mjs';

test('an empty SAM result remains inconclusive and does not show boxes',async()=>{
  const statuses=[],display=[];
  const scan=createMapScan({capture:()=>({image:'image',view:1}),current:()=>true,request:async()=>[],onStatus:s=>statuses.push(s),onBoxes:b=>display.push(b)});
  await scan.run();
  assert.match(statuses.at(-1),/検出できません/);assert.match(statuses.at(-1),/電線がない/);
  assert.deepEqual(display.at(-1),[]);
});

test('a changed view cancels and discards a delayed model response',async()=>{
  let resolveRequest,signal;const statuses=[],display=[];
  const scan=createMapScan({capture:()=>({image:'image',view:1}),current:()=>true,request:(_image,s)=>{signal=s;return new Promise(resolve=>{resolveRequest=resolve})},onStatus:s=>statuses.push(s),onBoxes:b=>display.push(b)});
  const pending=scan.run();scan.invalidate();assert.equal(signal.aborted,true);
  resolveRequest([{x1:1,y1:1,x2:5,y2:5,w:10,h:10}]);await pending;
  assert.deepEqual(display.at(-1),[]);assert.match(statuses.at(-1),/画面が変わ/);
});

test('a stale or malformed model response cannot produce overlay boxes',async()=>{
  const display=[],statuses=[];
  const scan=createMapScan({capture:()=>({image:'image',view:1}),current:()=>false,request:async()=>[{x1:1,y1:1,x2:5,y2:5,w:10,h:10}],onStatus:s=>statuses.push(s),onBoxes:b=>display.push(b)});
  await scan.run();assert.deepEqual(display.at(-1),[]);assert.match(statuses.at(-1),/画面が変わ/);
  const bad=createMapScan({capture:()=>({image:'image',view:1}),current:()=>true,request:async()=>[{x1:0,y1:0,x2:500,y2:1,w:10,h:10}],onStatus:s=>statuses.push(s),onBoxes:b=>display.push(b)});
  await bad.run();assert.deepEqual(display.at(-1),[]);assert.match(statuses.at(-1),/不正/);
});
