import {test} from 'node:test';
import assert from 'node:assert/strict';
import {positionAt,overlapsHazard,progressBeforeReplan,makeCity,intersectsBuilding,intersectsFlightPath,isValidRoute,mapCropBoxes,fitImage} from './mission.mjs';

test('city contains a mix of low homes and taller buildings',()=>{
  const buildings=makeCity();
  assert.ok(buildings.filter(b=>b.h<=4).length>buildings.length/2);
  assert.ok(buildings.some(b=>b.h>=8));
});

test('the drone body and rotors have clearance on either detour',()=>{
  const buildings=makeCity();
  for(const route of ['east','west']){
    assert.equal(buildings.some(building=>intersectsFlightPath(building,route,1.8)),false);
    assert.equal(intersectsFlightPath({x:0,z:16,w:3.6,d:2.2,h:5.2},route,1.5),false);
  }
});

test('reroute remains continuous and clears the simulated obstacle', () => {
  for (const edge of [.4,.57,.78]) {
    const before=positionAt(edge-.000001,true), after=positionAt(edge+.000001,true);
    assert.ok(Math.hypot(before.x-after.x,before.z-after.z)<.001);
  }
  for(let i=0;i<=1000;i++) assert.equal(overlapsHazard(positionAt(i/1000,true)),false);
  const destination=positionAt(1,true);
  assert.ok(Math.abs(destination.x-4)<1e-9 && destination.z===23);
});

test('a suspended tab cannot skip the obstacle observation', () => {
  assert.equal(progressBeforeReplan(1, false), .4);
  assert.equal(progressBeforeReplan(.7, true), .7);
  assert.equal(progressBeforeReplan(2, true), 1);
});

test('both proposed detours avoid the obstruction and reach the shelter', () => {
  for (const route of ['east','west']) {
    for(let i=0;i<=1000;i++) assert.equal(overlapsHazard(positionAt(i/1000,route)),false);
    assert.ok(Math.abs(positionAt(1,route).x-4)<1e-9);
  }
});

test('the full detours avoid the simulated hazard while the direct route crosses it',()=>{
  // Use a tall footprint to conservatively check the entire horizontal path.
  const hazard={x:0,z:16,w:3.6,d:2.2,h:5.2};
  assert.equal(intersectsFlightPath(hazard,'direct',0),true);
  for(const route of ['east','west'])assert.equal(intersectsFlightPath(hazard,route,0),false);
});

test('both flight paths clear the actual generated buildings', () => {
  const city = makeCity();
  assert.ok(city.length > 40, 'the city still contains buildings');
  for (const route of ['east', 'west']) for(let i=0;i<=2000;i++) {
    const position=positionAt(i/2000,route);
    assert.ok(!city.some(building=>intersectsBuilding(position,building)), `building intersects ${route} at ${i/2000}`);
  }
  for(const route of ['east','west'])assert.ok(city.every(building=>!intersectsFlightPath(building,route,.6)));
});

test('continuous path checking catches a narrow building between sampled points',()=>{
  const p=positionAt(.5005,'east');
  const tiny={x:p.x,z:p.z,w:.00001,d:.00001,h:6};
  assert.equal(intersectsBuilding(positionAt(.5,'east'),tiny,0),false);
  assert.equal(intersectsBuilding(positionAt(.501,'east'),tiny,0),false);
  assert.equal(intersectsFlightPath(tiny,'east',0),true);
  assert.equal(intersectsFlightPath({...tiny,h:1},'east',0),false);
});

test('route validation rejects unavailable or blocked routes before movement',()=>{
  const city=makeCity();
  assert.equal(isValidRoute('direct',false,city),true);
  assert.equal(isValidRoute('direct',true,city),false);
  assert.equal(isValidRoute('other',true,city),false);
  for(const route of ['east','west'])assert.equal(isValidRoute(route,true,city),true);
  const at=positionAt(.5,'east'),obstacle={x:at.x,z:at.z,w:1,d:1,h:10};
  assert.equal(isValidRoute('east',true,[obstacle]),false);
  const later=positionAt(.7,'direct'),laterBuilding={x:later.x,z:later.z,w:1,d:1,h:10};
  assert.equal(isValidRoute('direct',false,[laterBuilding]),true);
});

test('maps a detection from the central crop to full scene coordinates',()=>{
  const [box]=mapCropBoxes([{x1:100,y1:200,x2:600,y2:700,w:800,h:800}],{x:.25,y:.3,w:.5,h:.5});
  assert.equal(box.x1,.3125);assert.equal(box.y1,.425);assert.equal(box.x2,.625);assert.equal(box.y2,.7375);
});
test('image resizing preserves aspect ratio and never enlarges small images',()=>{
  assert.deepEqual(fitImage(2048,1024,1024),{width:1024,height:512});
  assert.deepEqual(fitImage(400,800,1024),{width:400,height:800});
  assert.throws(()=>fitImage(0,500,1024));
});

