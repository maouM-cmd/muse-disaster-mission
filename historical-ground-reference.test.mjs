import test from 'node:test';import assert from 'node:assert/strict';
import * as geo from './geo-data.mjs';
test('historical ground photo is a separate reference with camera point, sources and unknown image alignment',()=>{
 assert.equal(typeof geo.historicalGroundReference,'function');const r=geo.historicalGroundReference();
 assert.equal(r.caseId,'joso-2015');assert.equal(r.current,false);assert.equal(r.cameraTimeZone,'unknown');assert.equal(r.cameraDirection,'unknown');assert.equal(r.aerialExactTime,'unknown');
 assert.equal(r.ground.source,'https://ecom-plat.jp/nied-cr/index.php?gid=10132');assert.equal(r.ground.license,'https://creativecommons.org/licenses/by/2.1/jp/');
 assert.equal(r.ground.url,'/assets/historical/nied-20150911-112705.jpg');assert.equal(r.aerial.url,'https://cyberjapandata.gsi.go.jp/xyz/20150911dol2/14/14562/6430.png');
 const point=geo.slippyTilePoint(r.tile,r.cameraPoint);assert.ok(point&&Math.abs(point.x-.508)<.001&&Math.abs(point.y-.145)<.001);
});
