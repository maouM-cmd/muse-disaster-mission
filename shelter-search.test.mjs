import {test} from 'node:test';
import assert from 'node:assert/strict';
import {filterShelters} from './geo-data.mjs';
import * as geo from './geo-data.mjs';

test('nearby candidates use distance while retaining map indices and the search filter',()=>{
  assert.equal(typeof geo.nearbyShelters,'function');
  const origin={latitude:35,longitude:139};
  const shelters=[{name:'遠い学校',address:'町A',latitude:35.03,longitude:139},{name:'近い学校',address:'町A',latitude:35.001,longitude:139},{name:'中間施設',address:'町B',latitude:35.01,longitude:139},{name:'座標不明',address:'町A'}];
  assert.deepEqual(geo.nearbyShelters(shelters,origin,'町A').map(item=>item.index),[1,0]);
  const nearby=geo.nearbyShelters(shelters,origin,'');
  assert.deepEqual(nearby.map(item=>item.index),[1,2,0]);
  assert.ok(nearby[0].distance<nearby[1].distance);
  assert.deepEqual(geo.nearbyShelters(shelters,null,''),[]);
  assert.deepEqual(geo.nearbyShelters(shelters,{latitude:100,longitude:139},''),[]);
});

test('finds facilities by name or address while retaining their original map identity',()=>{
  const shelters=[{name:'原中学校',address:'東京都荒川区町屋5丁目'},{name:'第一小学校',address:'東京都荒川区南千住'}];
  assert.deepEqual(filterShelters(shelters,'町屋'),[{index:0,...shelters[0]}]);
  assert.deepEqual(filterShelters(shelters,' 第一 '),[{index:1,...shelters[1]}]);
  assert.equal(filterShelters(shelters,'該当なし').length,0);
  assert.equal(filterShelters(shelters,'').length,2);
});
