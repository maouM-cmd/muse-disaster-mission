import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as delivery from './delivery.mjs';
import {canReplayMapRoute} from './geo-data.mjs';
import {deliveryPose,mapDeliveryPose,mapPartHeight,validMapSurface,readMapSurface,readRouteSamples} from './delivery.mjs';
import {mapDroneParts} from './geo-data.mjs';
test('rescue aircraft frame surrounds the cargo and keeps six paired spinning rotors',()=>{
  const parts=mapDroneParts(),supports=parts.filter(p=>p.kind==='skid-support'),rails=parts.filter(p=>p.kind==='skid');
  assert.equal(supports.length,4);assert.ok(supports.every(p=>p.size[2]>1.4&&Math.abs(p.pitch)>0));
  assert.equal(rails.length,2);assert.ok(rails.every(p=>Math.abs(p.offset[0])>.7&&p.offset[2]<-1.4));
  assert.equal(parts.filter(p=>p.kind==='rotor').length,6);
  assert.equal(parts.filter(p=>p.kind==='blade'&&p.spin===1).length,12);
  assert.equal(parts.filter(p=>p.kind==='cable').length,2);
});
test('second aircraft direction points to the shelter outbound and base on return only',()=>{
  const start={latitude:35.7,longitude:139.7},end={latitude:35.8,longitude:139.8};
  assert.equal(delivery.secondFlightTarget('outbound',start,end),end);
  assert.equal(delivery.secondFlightTarget('returning',start,end),start);
  for(const phase of ['checking','waiting','delivery','ascent','home','stopped','unavailable'])assert.equal(delivery.secondFlightTarget(phase,start,end),null);
});
test('virtual proximity checks the full movement segment and fails closed on invalid positions',()=>{
  const p=(x,y,z=0)=>({x,y,z});
  assert.equal(delivery.virtualAircraftApproach(p(0,0),p(100,0),p(50,29)),true);
  assert.equal(delivery.virtualAircraftApproach(p(0,0),p(100,0),p(50,30)),true);
  assert.equal(delivery.virtualAircraftApproach(p(0,0),p(100,0),p(50,31)),false);
  assert.equal(delivery.virtualAircraftApproach(p(0,0),p(0,0),p(0,0,30)),true);
  assert.equal(delivery.virtualAircraftApproach(p(0,0),p(0,0),p(0,0,31)),false);
  assert.equal(delivery.virtualAircraftApproach(p(0,0),p(10,0),p(50,0)),false);
  assert.equal(delivery.virtualAircraftApproach(p(0,0),p(NaN,0),p(50,0)),true);
  assert.equal(delivery.virtualAircraftApproach(null,p(10,0),p(50,0)),true);
});
test('an illustrative water overlay is hidden during capture and restored even on error',()=>{
  const water={show:true};
  assert.equal(delivery.withHiddenOverlay(water,()=>water.show),false);
  assert.equal(water.show,true);
  assert.throws(()=>delivery.withHiddenOverlay(water,()=>{throw new Error('capture failed')}));
  assert.equal(water.show,true);
  water.show=false;delivery.withHiddenOverlay(water,()=>assert.equal(water.show,false));assert.equal(water.show,false);
  assert.equal(delivery.withHiddenOverlay(null,()=>42),42);
});
test('water and direction overlays are both hidden during image capture and restored',()=>{
  const water={show:true},direction={show:true};
  assert.throws(()=>delivery.withHiddenOverlay(water,()=>delivery.withHiddenOverlay(direction,()=>{
    assert.equal(water.show,false);assert.equal(direction.show,false);throw new Error('capture failed');
  })));
  assert.equal(water.show,true);assert.equal(direction.show,true);
});
test('building failure interrupts active movement and lowering without reporting completion',()=>{
  for(const [phase,expected] of [['preflight','preflight-unavailable'],['direct','direct-unavailable'],['detour','detour-unavailable'],['surface-check','surface-unavailable'],['delivery','surface-unavailable']]){
    const probe=new AbortController(),surface=new AbortController();let cancellations=0;
    const run={phase,probeController:probe,surfaceController:surface};
    assert.equal(delivery.interruptForBuildingFailure(run,()=>cancellations++),expected);
    assert.equal(run.phase,expected);assert.equal(cancellations,1);assert.ok(probe.signal.aborted);assert.ok(surface.signal.aborted);
  }
  for(const phase of ['obstacle','complete'])assert.equal(delivery.interruptForBuildingFailure({phase},()=>assert.fail('inactive')),null);
});
test('departure model inspection stops on high samples and preserves unknown counts',async()=>{
  const result=await delivery.inspectDepartureSamples(()=>Promise.resolve([20,undefined,174]),3);
  assert.equal(result.decision,'unavailable');assert.deepEqual(result.report,{observed:2,unknown:1,blockedIndices:[]});
  const blocked=await delivery.inspectDepartureSamples(()=>Promise.resolve([20,175,undefined]),3);
  assert.equal(blocked.decision,'blocked');assert.deepEqual(blocked.report.blockedIndices,[1]);
  assert.equal((await delivery.inspectDepartureSamples(()=>Promise.resolve([undefined,undefined]),2)).decision,'unavailable');
  await assert.rejects(delivery.inspectDepartureSamples(()=>Promise.reject(new Error('offline')),2),/offline/);
  await assert.rejects(delivery.inspectDepartureSamples(()=>Promise.resolve([1]),2),/形式/);
});
test('the parcel reaches the shelter roof before it is released',()=>{
  const start=deliveryPose('landing',0), midway=deliveryPose('landing',.5), end=deliveryPose('landing',1), done=deliveryPose('complete',1);
  assert.ok(start.parcelY>midway.parcelY && midway.parcelY>end.parcelY);
  assert.ok(Math.abs(end.parcelY-.2-1.5)<1e-9);assert.equal(end.attached,true);
  assert.ok(Math.abs(done.parcelY-.2-1.5)<1e-9);assert.equal(done.attached,false);
});
test('map parcel descends continuously to the sampled model surface before release',()=>{
  const start=mapDeliveryPose(35,0),hover=mapDeliveryPose(35,.4),end=mapDeliveryPose(35,1);
  assert.equal(start.droneHeight,180);assert.equal(hover.droneHeight,43);assert.equal(end.droneHeight,43);
  assert.ok(start.parcelHeight>hover.parcelHeight&&hover.parcelHeight>end.parcelHeight);
  assert.ok(Math.abs(end.parcelHeight-.275-35)<1e-9);assert.ok(end.cableLength>hover.cableLength);
});
test('a second virtual drone can lower from its own cruise altitude',()=>{
  const start=mapDeliveryPose(35,0,195),end=mapDeliveryPose(35,1,195);
  assert.equal(start.droneHeight,195);assert.equal(end.droneHeight,43);assert.equal(end.parcelHeight,35.275);
  assert.throws(()=>mapDeliveryPose(35,.5,40));
});
test('each second drone actually delivers, climbs and returns after its delay',()=>{
  assert.deepEqual(delivery.secondDroneMotion(0),{phase:'waiting',progress:0});
  assert.deepEqual(delivery.secondDroneMotion(2500),{phase:'outbound',progress:0});
  assert.deepEqual(delivery.secondDroneMotion(14500),{phase:'delivery',progress:0});
  assert.deepEqual(delivery.secondDroneMotion(22500),{phase:'ascent',progress:0});
  assert.deepEqual(delivery.secondDroneMotion(26500),{phase:'returning',progress:0});
  assert.deepEqual(delivery.secondDroneMotion(38500),{phase:'home',progress:1});
  assert.throws(()=>delivery.secondDroneMotion(-1));
});
test('the parcel and its attached lid keep their relative positions throughout lowering',()=>{
  const parcel={kind:'cargo',offset:[0,0,-1.15]},lid={kind:'cargo-lid',offset:[0,0,-.86]};
  for(const progress of [0,.4,.7,1]){
    const pose=mapDeliveryPose(35,progress);
    assert.ok(Math.abs(mapPartHeight(lid,pose)-mapPartHeight(parcel,pose)-.29)<1e-9);
    assert.equal(mapPartHeight(parcel,pose),pose.cargoOffset);
  }
  assert.equal(mapPartHeight(lid,null),-.86);
});
test('all relief case details stay attached while the case is lowered',()=>{
  const parts=mapDroneParts(),cargo=parts.find(part=>part.kind==='cargo');
  for(const part of parts.filter(part=>part.kind.startsWith('cargo-'))){
    for(const progress of [0,.4,.7,1]){
      const pose=mapDeliveryPose(35,progress);
      assert.ok(Math.abs((mapPartHeight(part,pose)-mapPartHeight(cargo,pose))-(part.offset[2]-cargo.offset[2]))<1e-9);
    }
  }
});
test('missing, ambiguous ellipsoid-only or unreachable surface heights cannot create a delivery pose',()=>{
  for(const value of [undefined,null,NaN,0,.1,-20,175,200])assert.equal(validMapSurface(value),false);
  assert.equal(validMapSurface(35),true);assert.throws(()=>mapDeliveryPose(undefined,.5));assert.throws(()=>mapDeliveryPose(35,NaN));
});
test('surface reading refuses unknown values and can be cancelled while the model loads',async()=>{
  assert.equal(await readMapSurface(()=>Promise.resolve(35)),35);
  await assert.rejects(readMapSurface(()=>Promise.resolve(undefined)),/表面/);
  let finish;const controller=new AbortController();
  const reading=readMapSurface(()=>new Promise(resolve=>{finish=resolve}),{signal:controller.signal});
  await Promise.resolve();controller.abort();finish(35);
  await assert.rejects(reading,error=>error.name==='AbortError');
});
test('a model sampling timeout is distinguished from an unknown surface',async()=>{
  await assert.rejects(readMapSurface(()=>new Promise(()=>{}),{timeoutMs:5}),/時間内に.*点検.*完了しません/);
  await assert.rejects(readRouteSamples(()=>new Promise(()=>{}),1,{timeoutMs:5}),/時間内に.*点検.*完了しません/);
  await assert.rejects(readMapSurface(()=>Promise.resolve(undefined)),/施設付近のモデル表面が不明/);
});
test('a timed-out model read does not release the shared queue before the underlying read ends',async()=>{
  const q=delivery.createSamplingQueue({waitMs:1000});let finish,secondStarted=false;
  const pending=new Promise(resolve=>{finish=resolve});
  const first=q.run(()=>readRouteSamples(()=>pending,1,{timeoutMs:5}));
  await assert.rejects(first,/時間内に.*点検.*完了しません/);
  const second=q.run(async()=>{secondStarted=true;return 'second'});
  await new Promise(resolve=>setTimeout(resolve,20));assert.equal(secondStarted,false);
  finish([42]);assert.equal(await second,'second');assert.equal(secondStarted,true);
});
test('an aborted model read keeps the shared queue until the underlying read ends',async()=>{
  const q=delivery.createSamplingQueue({waitMs:1000}),controller=new AbortController();let finish,secondStarted=false;
  const pending=new Promise(resolve=>{finish=resolve});const first=q.run(()=>readRouteSamples(()=>pending,1,{signal:controller.signal}));
  await new Promise(resolve=>setTimeout(resolve,5));controller.abort();await assert.rejects(first,error=>error.name==='AbortError');
  const second=q.run(async()=>{secondStarted=true;return 'second'});await new Promise(resolve=>setTimeout(resolve,20));assert.equal(secondStarted,false);
  finish([42]);assert.equal(await second,'second');
});
test('while an underlying timed-out read remains unfinished later checks report a queue timeout',async()=>{
  const q=delivery.createSamplingQueue({waitMs:15});let finish,started=false;
  const pending=new Promise(resolve=>{finish=resolve});
  await assert.rejects(q.run(()=>readRouteSamples(()=>pending,1,{timeoutMs:5})),/時間内/);
  await assert.rejects(q.run(()=>{started=true}),/待機が長引いた/);assert.equal(started,false);
  finish([42]);await new Promise(resolve=>setTimeout(resolve,0));assert.equal(await q.run(()=>42),42);
});
test('a late underlying rejection releases the queue without creating an unhandled rejection',async()=>{
  const q=delivery.createSamplingQueue({waitMs:1000});let fail,started=false;
  const pending=new Promise((_,reject)=>{fail=reject});await assert.rejects(q.run(()=>readRouteSamples(()=>pending,1,{timeoutMs:5})),/時間内/);
  const next=q.run(()=>{started=true;return 42});await new Promise(resolve=>setTimeout(resolve,10));assert.equal(started,false);
  fail(new Error('late sample error'));assert.equal(await next,42);
});
test('an abort before sampling starts does not launch the underlying read',async()=>{
  const controller=new AbortController();let started=false;
  const result=readRouteSamples(()=>{started=true;return [1] },1,{signal:controller.signal});controller.abort();
  await assert.rejects(result,error=>error.name==='AbortError');assert.equal(started,false);
});
test('a queued task is not launched if cancellation arrives as its turn begins',async()=>{
  const q=delivery.createSamplingQueue();let checks=0,started=false;
  const signal={get aborted(){return ++checks>1},addEventListener(){},removeEventListener(){}};
  await assert.rejects(q.run(()=>{started=true},{signal}),error=>error.name==='AbortError');assert.equal(started,false);
});
test('route sample reads preserve unknowns and reject incomplete or cancelled responses',async()=>{
  assert.deepEqual(await readRouteSamples(()=>Promise.resolve([10,undefined,200]),3),[10,null,200]);
  await assert.rejects(readRouteSamples(()=>Promise.resolve([10]),3),/形式/);
  let finish;const controller=new AbortController();const reading=readRouteSamples(()=>new Promise(resolve=>{finish=resolve}),2,{signal:controller.signal});
  await Promise.resolve();controller.abort();finish([1,2]);await assert.rejects(reading,error=>error.name==='AbortError');
});
test('model samples become unavailable if building data fails while reading',async()=>{
  for(const route of [false,true]){
    let available=true;
    const sample=()=>Promise.resolve().then(()=>{available=false;return route?[30]:30});
    const options={isModelAvailable:()=>available};
    await assert.rejects(route?readRouteSamples(sample,1,options):readMapSurface(sample,options),/建物データ/);
  }
});
test('a later building-data failure clears completed route results and markers',()=>{
  assert.equal(typeof delivery.invalidateRouteInspection,'function');
  const oldMarkers=[{id:1},{id:2}],removed=[];
  const run={phase:'obstacle',probes:{A:{blockedIndices:[]}},probeMarkers:[...oldMarkers]};
  assert.equal(delivery.invalidateRouteInspection(run,marker=>removed.push(marker)),true);
  assert.equal(run.probes,null);
  assert.deepEqual(run.probeMarkers,[]);
  assert.deepEqual(removed,oldMarkers);
  assert.equal(delivery.invalidateRouteInspection(run,()=>assert.fail('nothing left to remove')),false);
});
test('a cancelled waiter does not let the next inspection overtake the running one',async()=>{
  const q=delivery.createSamplingQueue();
  let releaseFirst;
  const firstGate=new Promise(resolve=>{releaseFirst=resolve});
  const running=[];
  const first=q.run(async()=>{running.push('first-start');await firstGate;running.push('first-end');return 'first'}, {});
  for(let i=0;i<5;i++)await new Promise(r=>setImmediate(r));
  const abandon=new AbortController();
  const second=q.run(async()=>{running.push('second');return 'second'}, {signal:abandon.signal});
  abandon.abort();
  await assert.rejects(second,/中止しました/);
  let thirdRan=false;
  const third=q.run(async()=>{thirdRan=true;running.push('third');return 'third'}, {});
  for(let i=0;i<5;i++)await new Promise(r=>setImmediate(r));
  assert.equal(thirdRan,false,'third must wait while first still runs');
  assert.deepEqual(running,['first-start']);
  releaseFirst();
  assert.equal(await first,'first');
  assert.equal(await third,'third');
  assert.deepEqual(running,['first-start','first-end','third']);
});
test('a model failure does not make a previously blocked simulated route playable',()=>{
  const run={phase:'obstacle',probes:{A:{blockedIndices:[2],observed:10},B:{blockedIndices:[],observed:10}},probeMarkers:[{}]};
  assert.equal(canReplayMapRoute(run.probes,'A'),false);
  assert.equal(delivery.invalidateRouteInspection(run,()=>{}),true);
  assert.equal(canReplayMapRoute(run.probes,'A'),false);
  assert.equal(canReplayMapRoute(run.probes,'B'),false);
  assert.equal(run.probes.stale,true);
  assert.equal(run.probes.A.observed,undefined);
  assert.equal(delivery.invalidateRouteInspection(run,()=>assert.fail('already invalidated')),false);
});
