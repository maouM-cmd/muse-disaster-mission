import test from 'node:test';
import assert from 'node:assert/strict';
import {historicalFloodCase} from './geo-data.mjs';

test('the historical comparison identifies the event, location, capture times, and original GSI sources',()=>{
 const c=historicalFloodCase();assert.equal(c.region,'茨城県常総地区');assert.equal(c.current,false);assert.equal(c.images.length,2);
 assert.deepEqual(c.images.map(x=>x.capture),['2015年9月11日午後','2015年9月15日午前']);
 assert.ok(c.images.every(x=>x.url.startsWith('https://cyberjapandata.gsi.go.jp/xyz/')));
 assert.ok(c.images.every(x=>x.url.includes('/14/14562/6429.png')));
 assert.match(c.source,/^https:\/\/www\.gsi\.go\.jp\//);assert.match(c.reference,/^https:\/\/www\.gsi\.go\.jp\//);
});
test('each call produces detached reference metadata, not mutable shared state',()=>{
 const a=historicalFloodCase();a.images[0].capture='changed';assert.notEqual(historicalFloodCase().images[0].capture,'changed');
});

test('Joso provides a separately sourced NIED image for the same tile with its licensing and timing',()=>{
 const c=historicalFloodCase(), image=c.comparisonImage;
 assert.equal(image.capture,'2015年9月11日・時間帯要確認');assert.equal(image.provider,'防災科学技術研究所');
 assert.equal(image.id,'joso-nied-20150911-am','existing saved records keep their stable identifier');
 assert.equal(image.url,'https://maptile01.bosai.go.jp/h270911_photo_v2/14/14562/6429.png');
 assert.equal(image.license,'https://creativecommons.org/licenses/by/2.1/jp/');
 assert.equal(image.source,'https://ecom-plat.jp/nied-cr/index.php?gid=10132');
});

test('Mabi comparison has two dated GSI images for the same location, not an independent ground truth',async()=>{
 const {historicalMabiFloodCase}=await import('./geo-data.mjs');const c=historicalMabiFloodCase();
 assert.equal(c.id,'mabi-2018');assert.equal(c.current,false);assert.equal(c.region,'岡山県倉敷市真備町周辺');assert.equal(c.independentReference,false);
 assert.deepEqual(c.images.map(x=>x.capture),['2018年7月9日','2018年7月11日']);assert.deepEqual(c.images.map(x=>x.published),['2018年7月11日','2018年7月13日']);
 assert.ok(c.images.every(x=>x.url.includes('/14/14276/6510.png')));assert.ok(c.images.every(x=>x.url.startsWith('https://cyberjapandata.gsi.go.jp/xyz/')));assert.equal(c.reference,'https://www.gsi.go.jp/common/000216843.pdf');
 const changed=historicalMabiFloodCase();changed.images[0].capture='other';assert.notEqual(historicalMabiFloodCase().images[0].capture,'other');
});

test('the separately reported Mabi station location is only approximately within the image tile',async()=>{
 const {historicalMabiFloodCase,slippyTilePoint}=await import('./geo-data.mjs'),c=historicalMabiFloodCase(),point=c.referencePoint;
 assert.equal(point.latitude,34.630589);assert.equal(point.longitude,133.701996);
 assert.match(point.locationSource,/repository\.exst\.jaxa\.jp/);assert.match(point.traceSource,/jsnds\.org/);
 const pixel=slippyTilePoint(c.tile,point);assert.ok(Math.abs(pixel.x-.9263957)<1e-6);assert.ok(Math.abs(pixel.y-.144855)<1e-6);
 assert.equal(slippyTilePoint(c.tile,{latitude:35,longitude:133.7}),null);
 assert.throws(()=>slippyTilePoint(c.tile,{latitude:90,longitude:0}));
 assert.throws(()=>slippyTilePoint({z:14,x:-1,y:6510},point));
});
