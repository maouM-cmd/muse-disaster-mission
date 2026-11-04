import {test} from 'node:test';
import assert from 'node:assert/strict';
import {officialMapLinks} from './geo-data.mjs';

test('links open official risk and rain maps around the selected point',()=>{
  const links=officialMapLinks({latitude:35.73512,longitude:139.78123});
  const flood=new URL(links.flood),inund=new URL(links.inundation),rain=new URL(links.rain);
  assert.equal(flood.origin,'https://www.jma.go.jp');assert.match(flood.hash,/lat:35\.735/);assert.match(flood.hash,/lon:139\.781/);assert.match(flood.hash,/elements:flood/);
  assert.match(inund.hash,/elements:inund/);assert.match(rain.hash,/elements:hrpns/);
});
test('invalid or missing positions cannot generate misleading location links',()=>{
  assert.throws(()=>officialMapLinks(null));assert.throws(()=>officialMapLinks({latitude:91,longitude:140}));
  assert.throws(()=>officialMapLinks({latitude:'35',longitude:140}));
});
