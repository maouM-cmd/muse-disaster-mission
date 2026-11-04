import {test} from 'node:test';
import assert from 'node:assert/strict';
import {initialCamera,beginFlight,selectCamera,deliveryCamera,mapObstacleCamera} from './camera.mjs';
import * as camera from './camera.mjs';
test('turning follows the shortest angle and is smooth across north',()=>{
  assert.equal(typeof camera.smoothHeading,'function');
  const from=179*Math.PI/180,to=-179*Math.PI/180;
  const next=camera.smoothHeading(from,to,0.1);
  assert.ok(next>from&&next<Math.PI+Math.PI/180);
  assert.equal(camera.smoothHeading(1,2,0),1);
  assert.ok(Math.abs(camera.smoothHeading(0,Math.PI/2,1)-Math.PI/2)<0.02);
});
test('map follow camera pulls back in portrait and keeps the delivery view closer',()=>{
  assert.equal(typeof camera.mapFollowOffset,'function');
  const wide=camera.mapFollowOffset(870,720),portrait=camera.mapFollowOffset(390,590),delivery=camera.mapFollowOffset(390,590,true);
  const distance=point=>Math.hypot(point.x,point.y,point.z);
  assert.ok(distance(portrait)>distance(wide)*1.5);
  assert.ok(distance(delivery)<distance(portrait));
  assert.deepEqual(camera.mapFollowOffset(0,0),wide);
});
test('delivery stays closer than flight with a shallower rear angle',()=>{
  const flight=camera.mapFollowOffset(870,720),delivery=camera.mapFollowOffset(870,720,true);
  assert.ok(flight.y<0&&flight.z>0&&flight.z/Math.hypot(flight.x,flight.y)<0.36);
  const angle=delivery.z/Math.hypot(delivery.x,delivery.y);
  assert.ok(delivery.y<0&&angle>.35&&angle<.55);
});
test('starts wide, follows automatically at takeoff, and respects a manual switch through delivery',()=>{
  let c=initialCamera();assert.equal(c.view,'wide');c=beginFlight(c);assert.equal(c.view,'follow');
  c=selectCamera(c,'wide');c=deliveryCamera(c);assert.equal(c.view,'wide');assert.equal(c.manual,true);
});
test('automatic chase gives a wide view for an obstacle while respecting manual choices',()=>{
  assert.equal(mapObstacleCamera(beginFlight()).view,'wide');
  assert.equal(mapObstacleCamera(selectCamera(beginFlight(),'follow')).view,'follow');
  assert.equal(mapObstacleCamera(selectCamera(beginFlight(),'wide')).view,'wide');
});
test('map obstacle close-up is a manual view that can return to the wide view',()=>{
  const close=camera.selectMapCamera(beginFlight(),'wire');
  assert.deepEqual(close,{view:'wire',manual:true});
  assert.deepEqual(camera.mapObstacleCamera(close),close);
  assert.deepEqual(camera.selectMapCamera(close,'wide'),{view:'wide',manual:true});
  assert.throws(()=>camera.selectMapCamera(close,'invalid'));
  assert.equal(camera.mapWireRange(50),35);
  assert.equal(camera.mapWireRange(140),70);
  assert.equal(camera.mapWireRange(20000),110);
});
test('delivery close-up only applies in follow view and invalid selections are rejected',()=>{
  let c=beginFlight(initialCamera());c=deliveryCamera(c);assert.equal(c.view,'close');
  assert.throws(()=>selectCamera(c,'unknown'));assert.equal(selectCamera(c,'follow').view,'follow');
});
