import test from 'node:test';
import assert from 'node:assert/strict';
import {mapSimulationPath, virtualWireGeometry, mapSimulationPosition,mapDroneParts,routeSamplePoints,routeSampleReport,routeSampleMarkers,canReplayMapRoute,straightDistance,secondFleetDestination,secondFleetCandidates} from './geo-data.mjs';

test('fictional wires cross the direct path but not either fictional detour',()=>{
  const intersect=(a,b,c,d)=>{
    const cross=(p,q,r)=>(q.longitude-p.longitude)*(r.latitude-p.latitude)-(q.latitude-p.latitude)*(r.longitude-p.longitude);
    return cross(a,b,c)*cross(a,b,d)<=0&&cross(c,d,a)*cross(c,d,b)<=0;
  };
  for(const end of [{latitude:35.7306,longitude:139.77},{latitude:35.74,longitude:139.78},{latitude:35.83,longitude:139.77}]){
    const start={latitude:35.73,longitude:139.77},wires=virtualWireGeometry(start,end);
    assert.equal(wires.length,3);
    for(const wire of wires){
      assert.equal(wire.length,9);
      assert.ok(wire.every(p=>Number.isFinite(p.height)));
      assert.ok(wire[4].height<wire[0].height);
      assert.ok(straightDistance(wire[0],wire.at(-1))<=71);
      const route=mapSimulationPath(start,end);
      assert.ok(intersect(route.direct.at(-1),end,wire[0],wire.at(-1)));
      for(const side of ['A','B']){
        const path=mapSimulationPath(start,end,side).detour;
        assert.ok(path.slice(1).every((p,i)=>!intersect(path[i],p,wire[0],wire.at(-1))));
      }
    }
  }
  assert.throws(()=>virtualWireGeometry({latitude:35,longitude:139},{latitude:35,longitude:139}));
});

test('a second virtual delivery uses the nearest distinct available facility',()=>{
  const origin={latitude:35.74,longitude:139.78};
  const points=[{name:'選択済',latitude:35.742,longitude:139.78},{name:'近い',latitude:35.741,longitude:139.78},{name:'遠い',latitude:35.75,longitude:139.78},{name:'同じ',latitude:35.742,longitude:139.78},{name:'不正',latitude:null,longitude:139.78}];
  assert.equal(secondFleetDestination(points,origin,0)?.name,'近い');
  assert.equal(secondFleetDestination([points[0]],origin,0),null);
  assert.equal(secondFleetDestination(points,null,0),null);
  assert.equal(secondFleetDestination(points,origin,99),null);
});
test('the second aircraft offers only distinct, in-range facilities in distance order',()=>{
  const origin={latitude:35.74,longitude:139.78};
  const shelters=[{name:'一号',latitude:35.742,longitude:139.78},{name:'遠い',latitude:35.75,longitude:139.78},{name:'近い',latitude:35.741,longitude:139.78},{name:'同じ場所',latitude:35.742,longitude:139.78},{name:'遠すぎ',latitude:36.74,longitude:139.78},{name:'不正',latitude:null,longitude:139.78}];
  assert.deepEqual(secondFleetCandidates(shelters,origin,0).map(item=>item.name),['近い','遠い']);
  assert.deepEqual(secondFleetCandidates(shelters,null,0),[]);
  assert.deepEqual(secondFleetCandidates(shelters,origin,99),[]);
});
test('sample threshold follows the simulated aircraft altitude',()=>{
  assert.deepEqual(routeSampleReport([180,190,undefined],190).blockedIndices,[1]);
  assert.deepEqual(routeSampleReport([180,190,undefined]).blockedIndices,[0,1]);
  assert.throws(()=>routeSampleReport([180],NaN));
});

test('the selected points define a connected detour around a simulated midpoint obstacle',()=>{
  const start={latitude:35.73,longitude:139.77},end={latitude:35.74,longitude:139.78};
  const route=mapSimulationPath(start,end);
  assert.deepEqual(route.direct[0],start);
  assert.deepEqual(route.detour.at(-1),end);
  assert.deepEqual(route.direct.at(-1),route.detour[0]);
  assert.ok(route.detour[1].longitude < route.obstacle.longitude);
  assert.notDeepEqual(route.detour[1],route.obstacle);
  assert.deepEqual(mapSimulationPosition(route.direct,0),start);
  assert.deepEqual(mapSimulationPosition(route.detour,1),end);
});

test('invalid, coincident or overly distant points cannot start a map simulation',()=>{
  const p={latitude:35.73,longitude:139.77};
  assert.throws(()=>mapSimulationPath(p,p));
  assert.throws(()=>mapSimulationPath(p,{latitude:36.73,longitude:139.77}));
  assert.throws(()=>mapSimulationPath(p,{latitude:Infinity,longitude:139.77}));
  assert.throws(()=>mapSimulationPosition([p],.5));
});
test('A and B produce opposite connected detours around the same obstacle',()=>{
  const start={latitude:35.73,longitude:139.77},end={latitude:35.74,longitude:139.78};
  const a=mapSimulationPath(start,end,'A'),b=mapSimulationPath(start,end,'B');
  assert.deepEqual(a.obstacle,b.obstacle);assert.deepEqual(a.detour[0],b.detour[0]);
  assert.ok(a.detour[1].longitude<b.detour[1].longitude);
  assert.deepEqual(a.detour.at(-1),b.detour.at(-1));assert.throws(()=>mapSimulationPath(start,end,'safe'));
});
test('the visual aircraft has six rotors and a suspended relief case',()=>{
  const parts=mapDroneParts(),rotors=parts.filter(p=>p.kind==='rotor'),cargo=parts.find(p=>p.kind==='cargo');
  assert.equal(rotors.length,6);assert.equal(new Set(rotors.map(p=>`${p.offset[0]},${p.offset[1]}`)).size,6);
  assert.ok(cargo);assert.ok(cargo.offset[2]<0);assert.ok(parts.every(p=>p.size.every(n=>Number.isFinite(n)&&n>0)));
});
test('each rotor has an arm connected to its center',()=>{
  const parts=mapDroneParts(),arms=parts.filter(part=>part.kind==='arm'),rotors=parts.filter(part=>part.kind==='rotor');
  assert.equal(arms.length,rotors.length);
  for(const rotor of rotors){
    const connected=arms.some(arm=>{
      if(!Number.isFinite(arm.yaw))return false;
      const dx=Math.cos(arm.yaw)*arm.size[0]/2,dy=-Math.sin(arm.yaw)*arm.size[0]/2;
      return [1,-1].some(sign=>Math.hypot(arm.offset[0]+sign*dx-rotor.offset[0],arm.offset[1]+sign*dy-rotor.offset[1])<.01);
    });
    assert.ok(connected,`rotor at ${rotor.offset.slice(0,2)} has no supporting arm`);
  }
});
test('short routes retain each corner and sample at intervals no greater than 30 metres',()=>{
  const path=[{latitude:35.73,longitude:139.77},{latitude:35.731,longitude:139.771},{latitude:35.732,longitude:139.771}];
  const plan=routeSamplePoints(path);assert.deepEqual(plan.points[0],path[0]);assert.deepEqual(plan.points.at(-1),path.at(-1));
  assert.ok(plan.points.some(point=>straightDistance(point,path[1])<.001));assert.ok(plan.maxGap<=30.01);
  const actual=Math.max(...plan.points.slice(1).map((p,i)=>straightDistance(p,plan.points[i])));
  assert.ok(Math.abs(actual-plan.maxGap)<.001);
});
test('long routes cap work while reporting the real largest gap instead of claiming 30 metres',()=>{
  const path=[{latitude:35.7,longitude:139.7},{latitude:35.75,longitude:139.7},{latitude:35.8,longitude:139.75},{latitude:35.81,longitude:139.76}];
  const plan=routeSamplePoints(path);assert.ok(plan.points.length<=49);assert.ok(plan.maxGap>30);
  for(const corner of path)assert.ok(plan.points.some(point=>straightDistance(point,corner)<.001));
  const actual=Math.max(...plan.points.slice(1).map((p,i)=>straightDistance(p,plan.points[i])));
  assert.ok(Math.abs(actual-plan.maxGap)<.001);
});
test('a tall sampled surface is flagged while missing samples stay unknown',()=>{
  const report=routeSampleReport([30,undefined,176,100]);
  assert.equal(report.observed,3);assert.equal(report.unknown,1);assert.deepEqual(report.blockedIndices,[2]);
  const incomplete=routeSampleReport([undefined,30]);assert.equal(incomplete.unknown,1);assert.deepEqual(incomplete.blockedIndices,[]);
  assert.throws(()=>routeSampleReport('bad'));
});
test('map markers distinguish sampled heights, missing data, and high surfaces without claiming safety',()=>{
  const points=[{latitude:35,longitude:139},{latitude:35.1,longitude:139},{latitude:35.2,longitude:139}];
  const marks=routeSampleMarkers(points,[20,undefined,175]);
  assert.deepEqual(marks.map(mark=>mark.state),['observed','unknown','high']);
  assert.deepEqual(marks.map(mark=>mark.point),points);
  assert.throws(()=>routeSampleMarkers(points,[20]));
  assert.throws(()=>routeSampleMarkers([],[]));
});
test('the simulation requires a current route inspection and refuses known high samples',()=>{
  const reports={A:{...routeSampleReport([20,180]),total:2,maxGap:20},B:{...routeSampleReport([undefined,20]),total:2,maxGap:20}};
  assert.equal(canReplayMapRoute(reports,'A'),false);assert.equal(canReplayMapRoute(reports,'B'),false);
  assert.equal(canReplayMapRoute({B:{...routeSampleReport([10,20]),total:2,maxGap:20}},'B'),true);
  assert.equal(canReplayMapRoute(null,'A'),false);assert.equal(canReplayMapRoute(reports,'other'),false);
  assert.equal(canReplayMapRoute({A:routeSampleReport([undefined,undefined])},'A'),false);
  assert.equal(canReplayMapRoute({...reports,stale:true},'B'),false);
});
