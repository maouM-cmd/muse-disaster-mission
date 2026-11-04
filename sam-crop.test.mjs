import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cropAround} from './mission.mjs';
test('pads and clips a visible simulated wire region',()=>{
  const r=cropAround([{x:.3,y:.4},{x:.6,y:.5}]);
  assert.ok(r.x<.3&&r.y<.4&&r.x+r.w>.6&&r.y+r.h>.5);
  assert.ok(r.x>=0&&r.y>=0&&r.x+r.w<=1&&r.y+r.h<=1);
});
test('does not request a crop for a wire entirely outside the image',()=>{
  assert.equal(cropAround([{x:1.4,y:.2},{x:1.7,y:.3}]),null);
});
