import test from 'node:test';
import assert from 'node:assert/strict';
import {riverPilotStations,validateRiverPilotNote} from './geo-data.mjs';

test('published stations are limited to the pilot region and have real official source links',()=>{
 const s=riverPilotStations('13118'); assert.equal(s.length,2);
 assert.deepEqual(riverPilotStations('13101'),[]);
 assert.equal(riverPilotStations(null).length,0);
 assert.ok(s.every(v=>v.latitude>35&&v.longitude>139&&v.levelUrl.startsWith('https://www.river.go.jp/')));
});
test('water level notes are user records and bind to the selected official station',()=>{
 const s=riverPilotStations('13118')[0];
 const item={stationId:s.id,value:1.3,at:'2026-01-01T01:00:00.000Z',reference:s.levelUrl};
 assert.deepEqual(validateRiverPilotNote(item,s),item);
 assert.equal(validateRiverPilotNote({...item,stationId:'other'},s),null);
 assert.equal(validateRiverPilotNote({...item,at:'no'},s),null);
 assert.equal(validateRiverPilotNote({...item,value:NaN},s),null);
 assert.equal(validateRiverPilotNote({...item,reference:'https://example.com'},s),null);
});

test('river station distance uses valid selected facility coordinates and never invents missing data',async()=>{
 const {riverStationDistance}=await import('./geo-data.mjs');const station=riverPilotStations('13118')[0];
 assert.equal(riverStationDistance(station,null),null);
 assert.equal(riverStationDistance(station,{latitude:NaN,longitude:139.7}),null);
 assert.equal(riverStationDistance(station,{latitude:91,longitude:139.7}),null);
 assert.equal(riverStationDistance(station,{latitude:station.latitude,longitude:station.longitude}),0);
 const d=riverStationDistance(station,{latitude:station.latitude+0.01,longitude:station.longitude});assert.ok(d>1100&&d<1130);
});
