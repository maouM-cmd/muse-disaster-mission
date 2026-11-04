import test from 'node:test';
import assert from 'node:assert/strict';
import * as geo from './geo-data.mjs';

test('the flood map pixel uses the public shelter coordinate at zoom 17',()=>{
  assert.equal(typeof geo.floodPixelFor,'function');
  assert.deepEqual(geo.floodPixelFor({latitude:35.751075,longitude:139.779438}),{z:17,x:116428,y:51581,px:35,py:243});
  assert.throws(()=>geo.floodPixelFor({latitude:90,longitude:139}));
});
test('only opaque exact official flood colors produce an indicative depth',()=>{
  assert.equal(typeof geo.floodDepthFromPixel,'function');
  assert.equal(geo.floodDepthFromPixel([255,183,183,255]),'3.0〜5.0m');
  assert.equal(geo.floodDepthFromPixel([247,245,169,255]),'0.5m未満');
  assert.equal(geo.floodDepthFromPixel([255,216,192,255]),'0.5〜3.0m');
  assert.equal(geo.floodDepthFromPixel([255,145,145,255]),'5.0〜10.0m');
  assert.equal(geo.floodDepthFromPixel([242,133,201,255]),'10.0〜20.0m');
  assert.equal(geo.floodDepthFromPixel([220,122,220,255]),'20.0m以上');
  assert.equal(geo.floodDepthFromPixel([255,183,183,0]),null);
  assert.equal(geo.floodDepthFromPixel([255,183,182,255]),null);
  assert.equal(geo.floodDepthFromPixel([0,0,0,0]),null);
});

test('the flood imagery bounds include Japanese extremes but only request Japan at the root level',()=>{
  const bounds=geo.FLOOD_IMAGERY_BOUNDS;
  assert.ok(bounds && bounds.west<=123 && bounds.east>=154 && bounds.south<=20 && bounds.north>=46);
  assert.deepEqual(geo.tileFor(bounds.south,bounds.west,2),geo.tileFor(bounds.north,bounds.east,2));
  assert.deepEqual(geo.tileFor(bounds.south,bounds.west,2),{z:2,x:3,y:1});
});

test('missing optional aerial tiles leave the underlying imagery visible',async()=>{
  assert.equal(typeof geo.withImageryFallback,'function');
  const blank={},image={},calls=[];
  const request=geo.withImageryFallback((x,y,z)=>{calls.push([x,y,z]);return z===17?Promise.reject(new Error('missing')):Promise.resolve(image)},blank,()=>calls.push('missing'));
  assert.equal(await request(1,2,13),blank);
  assert.equal(await request(1,2,17),blank);
  assert.equal(await request(1,2,18),image);
  assert.deepEqual(calls,[[1,2,17],'missing',[1,2,18]]);
});
test('a throttled aerial request remains retryable',()=>{
  assert.equal(typeof geo.withImageryFallback,'function');
  const request=geo.withImageryFallback(()=>undefined,{},()=>assert.fail('not an error'));
  assert.equal(request(1,2,17),undefined);
});
