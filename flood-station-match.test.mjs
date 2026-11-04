import test from 'node:test';
import assert from 'node:assert/strict';
import {floodBulletinStationContext} from './geo-data.mjs';

test('official station code and name must match before mapping to a facility distance',()=>{
 const observation={station:'岩淵水門（上）',code:'83030400010000006',stationCodeType:'水位観測所'},facility={name:'架空の施設',latitude:35.73,longitude:139.78};
 const matched=floodBulletinStationContext(observation,'13118',facility);
 assert.equal(matched.state,'matched');assert.equal(matched.station.name,observation.station);assert.ok(matched.distance>0&&matched.distance<30000);
 for(const item of [{...observation,code:'83030400010000007'},{...observation,station:'別の観測所'},{...observation,stationCodeType:'別の番号'},{station:'岩淵水門（上）',code:''}])assert.equal(floodBulletinStationContext(item,'13118',facility).state,'unknown');
 assert.equal(floodBulletinStationContext(observation,'13106',facility).state,'unknown');
 const noFacility=floodBulletinStationContext(observation,'13118',null);assert.equal(noFacility.state,'matched');assert.equal(noFacility.distance,null);
 assert.equal(floodBulletinStationContext(observation,'13118',{latitude:1000,longitude:1}).distance,null);
});
