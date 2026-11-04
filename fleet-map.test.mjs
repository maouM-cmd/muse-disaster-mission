import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createFleetMap} from './fleet-map.mjs';
import {validFleetEvidence} from './meta.mjs';

const origin={latitude:35.681,longitude:139.767};
const facilities=[
  {name:'施設A',latitude:35.683,longitude:139.767},
  {name:'施設B',latitude:35.681,longitude:139.770},
  {name:'施設C',latitude:35.684,longitude:139.771},
];
function fakeMap(sample,consult,onUpdate=()=>{}){
  const scheduled=new Map();let next=1;
  const previousRAF=globalThis.requestAnimationFrame,previousCancel=globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame=fn=>{const id=next++;scheduled.set(id,fn);return id};
  globalThis.cancelAnimationFrame=id=>scheduled.delete(id);
  class Collection{
    constructor(){this.items=[]}
    add(item){this.items.push(item);return item}
  }
  const collections=[];
  const C={
    PointPrimitiveCollection:Collection,LabelCollection:Collection,
    Cartesian3:{fromDegrees:(longitude,latitude,height)=>({longitude,latitude,height}),fromDegreesArrayHeights:values=>values},
    Cartographic:{fromDegrees:(longitude,latitude)=>({longitude,latitude})},
    Cartesian2:class{constructor(x,y){this.x=x;this.y=y}},PolylineDashMaterialProperty:class{constructor(options){this.options=options}},
    Color:{fromCssColorString:value=>({value,withAlpha(){return this}}),WHITE:'white'},ArcType:{NONE:0}
  };
  const entities={values:[],add(value){this.values.push(value);return value},remove(value){const i=this.values.indexOf(value);if(i>=0)this.values.splice(i,1)}};
  const viewer={entities,scene:{globe:{},sampleHeightSupported:true,
    sampleHeightMostDetailed:sample,requestRender(){},
    primitives:{add(value){collections.push(value);return value},remove(value){const i=collections.indexOf(value);if(i>=0)collections.splice(i,1)}}
  }};
  const updates=[],model={tiles:{},version:1,available:true},clock={now:1000};
  const map=createFleetMap({C,viewer,withSamplingLock:async(_owner,read)=>read(),modelSnapshot:()=>({...model}),now:()=>clock.now,onUpdate:value=>{updates.push(structuredClone(value));onUpdate(value)},...(consult?{consult}:{})});
  return {map,updates,collections,entities,C,viewer,model,clock,tick(now){const jobs=[...scheduled.values()];scheduled.clear();jobs.forEach(job=>job(now))},cleanup(){map.clear();globalThis.requestAnimationFrame=previousRAF;globalThis.cancelAnimationFrame=previousCancel}};
}
async function flush(){for(let i=0;i<40;i++)await new Promise(resolve=>setImmediate(resolve))}

test('case B withholds one A observation for both proposals and cannot execute A',async()=>{
  const seen=[];
  const h=fakeMap(async points=>points.map(p=>({...p,height:12})),async evidence=>{seen.push(structuredClone(evidence));return {sora:{choice:'A',reason:'try A'},nagi:{choice:'A',reason:'try A'}}});
  try{
    const fleet=h.map.start({origin,facilities,count:12,scenario:'withhold-a'});await flush();
    for(let t=0;t<=4000;t+=100){h.tick(t);await new Promise(resolve=>setImmediate(resolve))}await flush();
    assert.equal(seen.length,2);assert.ok(seen.every(e=>validFleetEvidence(e)&&e.candidates.A.unknown>0));
    assert.ok(!fleet.aircraft.some(unit=>unit.detourActive));
    assert.ok(fleet.aircraft.some(unit=>unit.state==='stopped'));
    const c=h.updates.at(-1).comparison;assert.equal(c.scenario,'withhold-a');assert.notEqual(c.baseline.choice,'A');
  }finally{h.cleanup()}
});

test('never silently replaces the facility selected by the user',()=>{
  const h=fakeMap(async positions=>positions.map(position=>({...position,height:12})));
  try{
    assert.throws(()=>h.map.start({origin,facilities,selectedDestination:origin,count:100}),/選択した配送先/);
  }finally{h.cleanup()}
});

test('a confirmed cargo request assigns only its requested boxes to the selected facility',async()=>{
  const h=fakeMap(async positions=>positions.map(position=>({...position,height:12})));
  try{
    const cargoRequest={supply:'飲料水',quantity:12};
    const fleet=h.map.start({origin,facilities,selectedDestination:facilities[0],count:100,cargoRequest});
    assert.equal(fleet.aircraft.length,12);
    assert.ok(fleet.aircraft.every(unit=>unit.destination.name==='施設A'));
    assert.equal(h.updates.at(-1).cargo.manifest.requested,12);
    assert.equal(h.updates.at(-1).cargo.manifest.spare,88);
    cargoRequest.quantity=99;
    assert.equal(h.updates.at(-1).cargo.manifest.requested,12);
    await flush();
    assert.equal(fleet.summary.waiting,12);
  }finally{h.cleanup()}
});

test('a cargo request can start with one known facility without inventing an alternate',async()=>{
  const h=fakeMap(async positions=>positions.map(position=>({...position,height:12})),async()=>({sora:{choice:'A',reason:'比較'},nagi:{choice:'A',reason:'元の施設'}}));
  try{
    const fleet=h.map.start({origin,facilities:facilities.slice(0,1),selectedDestination:facilities[0],count:100,cargoRequest:{supply:'飲料水',quantity:12}});
    await flush();
    for(let t=0;t<=4000;t+=100){h.tick(t);await new Promise(resolve=>setImmediate(resolve))}
    await flush();
    assert.equal(fleet.aircraft.length,12);
    assert.equal(h.updates.at(-1).comparison.candidates.B.valid,false);
    assert.ok(fleet.aircraft.every(unit=>unit.destination.name==='施設A'));
  }finally{h.cleanup()}
});

test('a cargo request larger than the fleet leaves remaining boxes unassigned',()=>{
  const h=fakeMap(async positions=>positions.map(position=>({...position,height:12})));
  try{
    const fleet=h.map.start({origin,facilities,selectedDestination:facilities[0],count:100,cargoRequest:{supply:'飲料水',quantity:150}});
    assert.equal(fleet.aircraft.length,100);
    assert.equal(h.updates.at(-1).cargo.summary.unassigned,50);
    assert.equal(h.updates.at(-1).cargo.manifest.spare,0);
    assert.ok(fleet.aircraft.every(unit=>unit.destination.name==='施設A'));
  }finally{h.cleanup()}
});

test('a contradictory cargo destination stops the run and reports unknown accounting',async()=>{
  const h=fakeMap(async positions=>positions.map(position=>({...position,height:12})));
  try{
    const fleet=h.map.start({origin,facilities,selectedDestination:facilities[0],count:100,cargoRequest:{supply:'飲料水',quantity:12}});
    await flush();
    fleet.aircraft[0].destinationId='wrong-facility';
    h.tick(0);
    assert.ok(fleet.aircraft.every(unit=>unit.state==='stopped'));
    assert.equal(h.updates.at(-1).active,false);
    assert.match(h.updates.at(-1).cargo.error,/集計を確認できません/);
    assert.equal(h.updates.at(-1).cargo.summary,undefined);
    assert.ok(h.collections[0].items.every(point=>point.color.value==='#ff786d'));
    assert.ok(h.updates.at(-1).events.some(event=>event.text.includes('集計')&&event.text.includes('停止')));
  }finally{h.cleanup()}
});

test('cargo accounting failures remain unknown after a stopped aircraft is selected',async()=>{
  const h=fakeMap(async positions=>positions.map(position=>({...position,height:12})));
  try{
    const fleet=h.map.start({origin,facilities,selectedDestination:facilities[0],count:100,cargoRequest:{supply:'飲料水',quantity:12}});
    await flush();
    const unit=fleet.aircraft[0];
    unit.delivery={ok:true,destinationId:unit.destinationId};
    h.tick(0);
    assert.match(h.updates.at(-1).cargo.error,/集計を確認できません/);
    assert.equal(h.map.select(unit.id),true);
    assert.match(h.updates.at(-1).cargo.error,/集計を確認できません/);
    assert.equal(h.updates.at(-1).cargo.summary,undefined);
  }finally{h.cleanup()}
});

test('fixture responses are recorded as fixture rather than Muse',async()=>{
  const h=fakeMap(async positions=>positions.map(position=>({...position,height:12})),async(_e,_s,_n,onInput)=>{onInput({provenance:'fixture',at:new Date().toISOString(),distanceIncluded:true});return {sora:{choice:'A',reason:'試験'},nagi:{choice:'A',reason:'試験'}}});
  try{h.map.start({origin,facilities,selectedDestination:facilities[0],count:100,cargoRequest:{supply:'飲料水',quantity:12}});await flush();for(let t=0;t<=4000;t+=100){h.tick(t);await new Promise(resolve=>setImmediate(resolve))}await flush();
    assert.ok(h.updates.at(-1).events.some(event=>event.source==='fixture'&&event.text.includes('試験')));assert.equal(h.updates.at(-1).comparison.input.provenance,'fixture');assert.equal(h.updates.at(-1).comparison.choiceSource,'fixture');assert.equal(h.updates.at(-1).events.some(event=>event.source==='Muse'),false);
  }finally{h.cleanup()}
});

test('a cargo request never redirects boxes to another facility without user approval',async()=>{
  const h=fakeMap(async positions=>positions.map(position=>({...position,height:12})),async()=>({sora:{choice:'A',reason:'比較'},nagi:{choice:'B',reason:'別施設'}}));
  try{
    const fleet=h.map.start({origin,facilities,selectedDestination:facilities[0],count:100,cargoRequest:{supply:'飲料水',quantity:12}});
    await flush();
    for(let t=0;t<=4000;t+=100){h.tick(t);await new Promise(resolve=>setImmediate(resolve))}
    await flush();
    assert.ok(h.updates.at(-1).events.some(event=>event.source==='unknown'&&event.text.includes('仮想案B')));
    assert.ok(h.updates.at(-1).pendingDiversion?.id);
    assert.ok(fleet.aircraft.some(unit=>unit.state==='holding'));
    assert.ok(fleet.aircraft.every(unit=>unit.destination.name==='施設A'));
  }finally{h.cleanup()}
});

test('a cargo diversion waits for approval, reinspects, then accounts for each destination',async()=>{
  let samples=0;
  const h=fakeMap(async positions=>{samples++;return positions.map(position=>({...position,height:12}))},async()=>({sora:{choice:'B',reason:'比較'},nagi:{choice:'B',reason:'別施設'}}));
  try{
    const fleet=h.map.start({origin,facilities,selectedDestination:facilities[0],count:100,cargoRequest:{supply:'飲料水',quantity:12}});
    await flush();
    for(let t=0;t<=4000;t+=100){h.tick(t);await new Promise(resolve=>setImmediate(resolve))}
    await flush();
    const proposal=h.updates.at(-1).pendingDiversion;
    assert.ok(proposal?.id);
    assert.equal(proposal.destinations.reduce((n,d)=>n+d.boxes,0),proposal.affected);
    assert.ok(fleet.aircraft.filter(unit=>proposal.unitIds.includes(unit.id)).every(unit=>unit.state==='holding'&&unit.destination.name==='施設A'));
    const before=samples;
    assert.equal(await h.map.resolveDiversion(proposal.id,true),true);
    assert.ok(samples>before,'approval must trigger reinspection');
    assert.ok(fleet.aircraft.some(unit=>unit.destination.name!=='施設A'));
    assert.equal(h.updates.at(-1).cargo.summary.deliveredOriginal,0);
    assert.equal(await h.map.resolveDiversion(proposal.id,true),false);
    for(let t=4100;t<=80000;t+=100){h.tick(t);if(!h.map.active())break}
    const cargo=h.updates.at(-1).cargo;
    assert.equal(cargo.summary.deliveredOriginal,0);
    assert.equal(cargo.summary.deliveredOther,proposal.affected);
    for(const place of proposal.destinations){
      assert.equal(cargo.summary.byFacility.find(item=>item.id===place.id).delivered,place.boxes);
    }
    assert.equal(cargo.assignments.length,proposal.affected);
    assert.equal(h.updates.at(-1).comparison.approval.decision,'accepted');
    assert.equal(h.updates.at(-1).comparison.approval.outcome,'applied');
  }finally{h.cleanup()}
});

test('rejecting a diversion stops affected aircraft without changing their destination',async()=>{
  const h=fakeMap(async positions=>positions.map(position=>({...position,height:12})),async()=>({sora:{choice:'B',reason:'比較'},nagi:{choice:'B',reason:'別施設'}}));
  try{
    const fleet=h.map.start({origin,facilities,selectedDestination:facilities[0],count:100,cargoRequest:{supply:'飲料水',quantity:12}});
    await flush();
    for(let t=0;t<=4000;t+=100){h.tick(t);await new Promise(resolve=>setImmediate(resolve))}
    await flush();
    const proposal=h.updates.at(-1).pendingDiversion;
    assert.ok(proposal?.id);
    assert.equal(await h.map.resolveDiversion(proposal.id,false),true);
    assert.equal(h.updates.at(-1).comparison.approval.outcome,'declined');
    assert.ok(fleet.aircraft.filter(unit=>proposal.unitIds.includes(unit.id)).every(unit=>unit.state==='stopped'&&unit.destination.name==='施設A'));
  }finally{h.cleanup()}
});

test('stale model or held position invalidates a diversion approval',async()=>{
  for(const change of ['model','position']){
    const h=fakeMap(async positions=>positions.map(position=>({...position,height:12})),async()=>({sora:{choice:'B',reason:'比較'},nagi:{choice:'B',reason:'別施設'}}));
    try{
      const fleet=h.map.start({origin,facilities,selectedDestination:facilities[0],count:100,cargoRequest:{supply:'飲料水',quantity:12}});
      await flush();for(let t=0;t<=4000;t+=100){h.tick(t);await new Promise(resolve=>setImmediate(resolve))}await flush();
      const proposal=h.updates.at(-1).pendingDiversion;assert.ok(proposal?.id);
      if(change==='model')h.model.version++;
      if(change==='position')fleet.aircraft.find(unit=>proposal.unitIds.includes(unit.id)).position.latitude+=.0001;
      assert.equal(await h.map.resolveDiversion(proposal.id,true),false,change);
      assert.equal(h.updates.at(-1).comparison.approval.outcome,'failed',change);
      assert.ok(fleet.aircraft.filter(unit=>proposal.unitIds.includes(unit.id)).every(unit=>unit.state==='stopped'),change);
      assert.ok(fleet.aircraft.every(unit=>unit.destination.name==='施設A'),change);
    }finally{h.cleanup()}
  }
});

test('user stop during diversion reinspection prevents late resumption',async()=>{
  let delay=false,release;
  const h=fakeMap(async positions=>{if(delay){await new Promise(resolve=>{release=resolve})}return positions.map(position=>({...position,height:12}))},async()=>{delay=true;return {sora:{choice:'B',reason:'比較'},nagi:{choice:'B',reason:'別施設'}}});
  try{
    const fleet=h.map.start({origin,facilities,selectedDestination:facilities[0],count:100,cargoRequest:{supply:'飲料水',quantity:12}});
    await flush();for(let t=0;t<=4000;t+=100){h.tick(t);await new Promise(resolve=>setImmediate(resolve))}await flush();
    const proposal=h.updates.at(-1).pendingDiversion;assert.ok(proposal?.id);
    const resolving=h.map.resolveDiversion(proposal.id,true);await flush();assert.equal(typeof release,'function');
    h.map.stop('利用者が停止');release();assert.equal(await resolving,false);await flush();
    assert.equal(h.updates.at(-1).comparison.approval.outcome,'cancelled');
    assert.ok(fleet.aircraft.every(unit=>unit.state==='stopped'&&unit.destination.name==='施設A'));
  }finally{h.cleanup()}
});

test('an unanswered diversion expires and stops the affected aircraft',async()=>{
  const h=fakeMap(async positions=>positions.map(position=>({...position,height:12})),async()=>({sora:{choice:'B',reason:'比較'},nagi:{choice:'B',reason:'別施設'}}));
  try{
    const fleet=h.map.start({origin,facilities,selectedDestination:facilities[0],count:100,cargoRequest:{supply:'飲料水',quantity:12}});
    await flush();for(let t=0;t<=4000;t+=100){h.tick(t);await new Promise(resolve=>setImmediate(resolve))}await flush();
    const proposal=h.updates.at(-1).pendingDiversion;assert.ok(proposal?.id);
    h.clock.now+=120001;h.tick(4100);
    assert.ok(fleet.aircraft.filter(unit=>proposal.unitIds.includes(unit.id)).every(unit=>unit.state==='stopped'));
    assert.equal(await h.map.resolveDiversion(proposal.id,true),false);
    assert.ok(h.updates.at(-1).events.some(event=>event.text.includes('時間切れ')));
    assert.equal(h.updates.at(-1).comparison.approval.outcome,'expired');
  }finally{h.cleanup()}
});

test('expiration during reinspection records the reason and never applies the diversion',async()=>{
  let delay=false,release;
  const h=fakeMap(async positions=>{if(delay)await new Promise(resolve=>{release=resolve});return positions.map(position=>({...position,height:12}))},async()=>{delay=true;return {sora:{choice:'B',reason:'比較'},nagi:{choice:'B',reason:'別施設'}}});
  try{
    const fleet=h.map.start({origin,facilities,selectedDestination:facilities[0],count:100,cargoRequest:{supply:'飲料水',quantity:12}});
    await flush();for(let t=0;t<=4000;t+=100){h.tick(t);await new Promise(resolve=>setImmediate(resolve))}await flush();
    const proposal=h.updates.at(-1).pendingDiversion;
    const resolving=h.map.resolveDiversion(proposal.id,true);await flush();
    h.clock.now+=120001;delay=false;release();
    assert.equal(await resolving,false);
    assert.equal(h.updates.at(-1).comparison.approval.outcome,'expired');
    assert.ok(h.updates.at(-1).events.some(event=>event.text.includes('時間切れ')));
    assert.ok(fleet.aircraft.every(unit=>unit.state==='stopped'&&unit.destination.name==='施設A'));
  }finally{h.cleanup()}
});

test('cargo with an unusable original route may ask Muse about a usable alternative',async()=>{
  let calls=0,consults=0;
  const h=fakeMap(async positions=>{
    if(++calls===3)throw new Error('A案の高さを取得できません');
    return positions.map(position=>({...position,height:12}));
  },async()=>{consults++;return {sora:{choice:'B',reason:'比較'},nagi:{choice:'B',reason:'代替'}}});
  try{
    const fleet=h.map.start({origin,facilities,selectedDestination:facilities[0],count:100,cargoRequest:{supply:'飲料水',quantity:12}});
    await flush();
    for(let t=0;t<=4000;t+=100){h.tick(t);await new Promise(resolve=>setImmediate(resolve))}
    await flush();
    assert.equal(consults,1);
    assert.ok(fleet.aircraft.some(unit=>unit.state==='holding'));
    assert.ok(h.updates.at(-1).pendingDiversion?.id);
  }finally{h.cleanup()}
});

test('100 points retain individual identity, shared checks and selectable destination',async()=>{
  const h=fakeMap(async positions=>positions.map(position=>({...position,height:12})));
  try{
    const fleet=h.map.start({origin,facilities,selectedDestination:facilities[0],count:100});
    assert.equal(fleet.aircraft.length,100);
    assert.equal(h.collections[0].items.length,100);
    assert.equal(new Set(h.collections[0].items.map(item=>item.id)).size,100);
    assert.equal(new Set(fleet.aircraft.map(item=>item.destinationId)).size,3);
    await flush();
    assert.equal(fleet.summary.waiting,100);
    h.tick(0);h.tick(100);
    assert.ok(fleet.summary.outbound>0);
    assert.equal(h.map.select('unit-002'),true);
    assert.equal(h.updates.at(-1).selectedId,'unit-002');
    assert.equal(h.map.select('missing'),false);
    assert.throws(()=>h.map.withoutMarkers(()=>{
      assert.equal(h.collections[0].show,false);
      assert.equal(h.collections[1].show,false);
      throw new Error('capture failed');
    }),/capture failed/);
    assert.notEqual(h.collections[0].show,false);
    assert.notEqual(h.collections[1].show,false);
  }finally{h.cleanup()}
});

test('the representative 3D drone follows the selected unit, is hidden from Muse capture, and is removed on clear',async()=>{
  const h=fakeMap(async positions=>positions.map(position=>({...position,height:12})));
  try{
    const fleet=h.map.start({origin,facilities,selectedDestination:facilities[0],count:100});
    await flush();
    const model=h.entities.values.find(entity=>entity.model);
    assert.ok(model,'a 3D model is created for the selected aircraft');
    assert.equal(h.map.select('unit-002'),true);
    const start={...fleet.aircraft.find(unit=>unit.id==='unit-002').position};
    for(let t=0;t<=3000;t+=100)h.tick(t);
    const selected=fleet.aircraft.find(unit=>unit.id==='unit-002');
    assert.notDeepEqual(selected.position,start,'the selected unit moved');
    assert.deepEqual(model.position,{longitude:selected.position.longitude,latitude:selected.position.latitude,height:selected.position.height});
    h.map.withoutMarkers(()=>assert.equal(model.show,false));
    assert.equal(model.show,true);
    h.map.clear();
    assert.ok(!h.entities.values.includes(model));
  }finally{h.cleanup()}
});

test('Cesium heading receives a Cartesian position rather than an entity property',async()=>{
  const h=fakeMap(async positions=>positions.map(position=>({...position,height:12})));
  try{
    h.map.start({origin,facilities,count:100});await flush();
    const model=h.entities.values.find(entity=>entity.model);
    let position=model.position,called=0;
    Object.defineProperty(model,'position',{get(){return {getValue:()=>position}},set(value){position=value}});
    h.C.HeadingPitchRoll=class {constructor(heading){this.heading=heading}};
    h.C.Transforms={headingPitchRollQuaternion(point){called++;assert.ok(Number.isFinite(point.longitude),'requires Cartesian, not a position property');return {}}};
    for(let t=0;t<5000;t+=100)h.tick(t);
    assert.ok(called>0,'movement updated heading');
  }finally{h.cleanup()}
});

test('the selected dot is hidden only after the 3D model is ready',async()=>{
  const h=fakeMap(async positions=>positions.map(position=>({...position,height:12})));
  try{
    let state=1;
    h.C.BoundingSphere=class {};
    h.C.BoundingSphereState={DONE:0,PENDING:1,FAILED:2};
    h.viewer.dataSourceDisplay={getBoundingSphere:()=>state};
    h.map.start({origin,facilities,count:100});await flush();
    assert.equal(h.collections[0].items[0].show,true);
    state=0;h.tick(0);h.tick(1000);h.tick(2000);
    assert.equal(h.collections[0].items[0].show,false);
    assert.equal(h.collections[0].items[1].show,true);
    state=2;h.tick(3000);h.tick(4000);h.tick(5000);
    assert.equal(h.collections[0].items[0].show,true);
  }finally{h.cleanup()}
});

test('an unknown route stops only its assigned aircraft',async()=>{
  const h=fakeMap(async positions=>{
    const endpoint=positions.at(-1);
    return positions.map(position=>({...position,height:Math.abs(endpoint.latitude-facilities[0].latitude)<1e-8?undefined:12}));
  });
  try{
    const fleet=h.map.start({origin,facilities:facilities.slice(0,2),count:100});
    await flush();
    assert.equal(fleet.summary.stopped,50);
    assert.equal(fleet.summary.waiting,50);
    assert.ok(fleet.aircraft.filter(unit=>unit.state==='stopped').every(unit=>!unit.delivery&&unit.reason.includes('不明')));
  }finally{h.cleanup()}
});

test('stopping while a model request is pending prevents late resumption',async()=>{
  let resolve;
  const pending=new Promise(done=>{resolve=done});
  const h=fakeMap(()=>pending);
  try{
    const fleet=h.map.start({origin,facilities,count:100});
    await new Promise(done=>setImmediate(done));
    h.map.stop('利用者が停止');
    assert.equal(fleet.summary.stopped,100);
    assert.equal(h.updates.at(-1).active,false);
    assert.ok(h.updates.at(-1).events.some(event=>event.source==='app'&&event.text.includes('利用者が停止')));
    const eventCount=h.updates.at(-1).events.length;
    h.map.stop('利用者が停止');
    assert.equal(h.updates.at(-1).events.length,eventCount);
    resolve([{height:12}]);
    await flush();
    assert.equal(fleet.summary.stopped,100);
    assert.ok(fleet.aircraft.every(unit=>unit.state==='stopped'&&!unit.delivery));
  }finally{h.cleanup()}
});

test('shared virtual obstacle holds affected units and accepts only checked Muse proposal',async()=>{
  let seen;
  const h=fakeMap(async positions=>positions.map(position=>({...position,height:12})),async evidence=>{
    seen=evidence;return {sora:{choice:'A',reason:'候補Aを比較'},nagi:{choice:'A',reason:'候補Aを選択'}};
  });
  try{
    const fleet=h.map.start({origin,facilities,count:100});
    await flush();
    for(let t=0;t<=4000;t+=100){h.tick(t);await new Promise(resolve=>setImmediate(resolve))}
    await flush();
    assert.ok(seen?.affected>0);
    assert.ok(h.updates.at(-1).selectedId,'the reporting aircraft remains visible as a representative');
    assert.ok(seen.unaffected>0);
    assert.equal(seen.candidates.A.avoidsHazard,true);
    assert.ok(seen.representatives.A.total>0);
    assert.equal(seen.representatives.A.unknown,0);
    assert.ok(seen.representatives.A.total<=seen.candidates.A.total);
    assert.ok(seen.distances.A.totalM>0);
    assert.equal(seen.distances.A.routes,seen.affected);
    const comparison=h.updates.at(-1).comparison;
    assert.equal(comparison.baseline.choice,'A');
    assert.equal(comparison.reply.nagi.reason,'候補Aを選択');
    assert.equal(comparison.verdict.state,'approved');
    assert.ok(Number.isFinite(comparison.baseline.elapsedMs));
    assert.ok(Number.isFinite(comparison.reply.elapsedMs));
    assert.equal(comparison.evidence.distances.A.totalM,seen.distances.A.totalM);
    assert.equal(comparison.affectedIds.length,seen.affected);
    assert.ok(comparison.candidates.A.routes[comparison.affectedIds[0]].path.length>1);
    assert.ok(comparison.candidates.B.routes[comparison.affectedIds[0]].returnPath.length>1);
    assert.ok(comparison.inspections.A.results[comparison.affectedIds[0]].evidence.checkedAt);
    assert.ok(comparison.inspections.B.results[comparison.affectedIds[0]].evidence.checkedAt);
    assert.ok(h.updates.at(-1).events.some(event=>event.source==='unknown'&&event.text.includes('ナギ')));
    assert.ok(fleet.aircraft.some(unit=>unit.detourActive));
    assert.ok(fleet.aircraft.some(unit=>!unit.detourActive&&unit.state!=='holding'));
    assert.ok(h.entities.values.some(entity=>entity.label?.text.includes('仮想障害（演出）')));
    assert.ok(h.entities.values.some(entity=>entity.label?.text.includes('仮想案A・地点のみ再点検、点間未確認')));
    assert.ok(h.entities.values.some(entity=>entity.polyline?.width===8&&entity.polyline.material instanceof h.C.PolylineDashMaterialProperty),'selected simulated route must remain dashed because intervals are not inspected');
  }finally{h.cleanup()}
});

test('a display error immediately after detour approval cannot claim to stop while units continue',async()=>{
  let failed=false;
  const h=fakeMap(async positions=>positions.map(position=>({...position,height:12})),
    async()=>({sora:{choice:'A',reason:'比較'},nagi:{choice:'A',reason:'選択'}}),
    value=>{if(!failed&&value.events.some(event=>event.source==='app'&&event.text.includes('個別承認経路で仮想飛行へ'))){failed=true;throw new Error('表示に失敗')}});
  try{
    const fleet=h.map.start({origin,facilities,count:100});await flush();
    for(let t=0;t<=4000;t+=100){h.tick(t);await new Promise(resolve=>setImmediate(resolve))}
    await flush();
    assert.equal(failed,true);
    assert.equal(h.updates.at(-1).active,false);
    assert.ok(fleet.aircraft.every(unit=>unit.state==='stopped'||unit.state==='complete'));
    assert.ok(h.updates.at(-1).events.some(event=>event.source==='app'&&event.text.includes('全機を停止')));
  }finally{h.cleanup()}
});

test('a compatibility notice from consultation is recorded as an app event',async()=>{
  const h=fakeMap(async positions=>positions.map(position=>({...position,height:12})),async (_evidence,_signal,notice)=>{
    notice('試験：距離は送信されません');
    return {sora:{choice:'A',reason:'比較'},nagi:{choice:'A',reason:'候補'}};
  });
  try{
    h.map.start({origin,facilities,count:100});await flush();
    for(let t=0;t<=4000;t+=100){h.tick(t);await new Promise(resolve=>setImmediate(resolve))}
    await flush();
    assert.ok(h.updates.at(-1).events.some(event=>event.source==='app'&&event.text.includes('距離は送信されません')));
  }finally{h.cleanup()}
});

test('unavailable Muse stops affected units and never fabricates a reply',async()=>{
  const h=fakeMap(async positions=>positions.map(position=>({...position,height:12})),async()=>{throw new Error('Muse未接続')});
  try{
    const fleet=h.map.start({origin,facilities,count:100});
    await flush();
    for(let t=0;t<=4000;t+=100){h.tick(t);await new Promise(resolve=>setImmediate(resolve))}
    await flush();
    assert.ok(fleet.aircraft.some(unit=>unit.state==='stopped'&&unit.reason.includes('Muse未接続')));
    assert.ok(fleet.aircraft.some(unit=>unit.state!=='stopped'));
    assert.ok(!h.updates.at(-1).events.some(event=>['Muse','fixture','unknown'].includes(event.source)));
    assert.ok(!h.entities.values.some(entity=>entity.label?.text.includes('再点検済み')));
  }finally{h.cleanup()}
});

test('a partially invalid two-role reply never records either answer as Muse',async()=>{
  const h=fakeMap(async positions=>positions.map(position=>({...position,height:12})),async()=>({sora:{choice:'A',reason:'正常な形'},nagi:{choice:'C',reason:'不正な候補'}}));
  try{
    const fleet=h.map.start({origin,facilities,count:100});await flush();
    for(let t=0;t<=4000;t+=100){h.tick(t);await new Promise(resolve=>setImmediate(resolve))}
    await flush();
    assert.ok(fleet.aircraft.some(unit=>unit.state==='stopped'&&unit.reason.includes('回答形式')));
    assert.ok(!h.updates.at(-1).events.some(event=>['Muse','fixture','unknown'].includes(event.source)));
  }finally{h.cleanup()}
});

test('a failed candidate reports unobserved route points instead of aircraft count',async()=>{
  let calls=0,seen;
  const h=fakeMap(async positions=>{if(++calls===7)throw new Error('A案の高さを取得できません');return positions.map(position=>({...position,height:12}))},async evidence=>{
    seen=evidence;return {sora:{choice:'B',reason:'Bを比較'},nagi:{choice:'B',reason:'Bを選択'}};
  });
  try{
    h.map.start({origin,facilities,count:100});await flush();
    for(let t=0;t<=4000;t+=100){h.tick(t);await new Promise(resolve=>setImmediate(resolve))}
    await flush();
    assert.ok(seen?.affected>0);
    assert.ok(seen.candidates.A.total>seen.affected);
    assert.equal(seen.candidates.A.unknown,seen.candidates.A.total);
    assert.equal(validFleetEvidence(seen),true);
    assert.ok(h.updates.at(-1).events.some(event=>event.text.includes('A案の高さを取得できません')));
  }finally{h.cleanup()}
});

test('an unavailable alternate facility is reported as a candidate failure, not an inspected route',async()=>{
  let seen;
  const h=fakeMap(async positions=>positions.map(position=>({...position,height:12})),async evidence=>{
    seen=evidence;return {sora:{choice:'A',reason:'Aを比較'},nagi:{choice:'A',reason:'Aを選択'}};
  });
  try{
    const blockedAlternative={name:'施設B',latitude:35.68244,longitude:139.767};
    h.map.start({origin,facilities:[facilities[0],blockedAlternative],selectedDestination:facilities[0],count:100});await flush();
    for(let t=0;t<=4000;t+=100){h.tick(t);await new Promise(resolve=>setImmediate(resolve))}
    await flush();
    assert.equal(seen,undefined);
    const comparison=h.updates.at(-1).comparison;
    assert.equal(comparison.evidence.candidates.B.total,0);
    assert.equal(comparison.evidence.candidates.B.avoidsHazard,false);
    assert.equal(validFleetEvidence(comparison.evidence),true);
    assert.ok(h.updates.at(-1).events.some(event=>event.text.includes('B：確認できず')));
  }finally{h.cleanup()}
});

test('failed post-Muse reinspection preserves the actual cause and stops affected aircraft',async()=>{
  let failRecheck=false;
  const h=fakeMap(async positions=>{
    if(failRecheck)throw new Error('建物データが更新され取得できません');
    return positions.map(position=>({...position,height:12}));
  },async()=>{failRecheck=true;return {sora:{choice:'A',reason:'比較'},nagi:{choice:'A',reason:'候補'}}});
  try{
    const fleet=h.map.start({origin,facilities,count:100});await flush();
    for(let t=0;t<=4000;t+=100){h.tick(t);await new Promise(resolve=>setImmediate(resolve))}
    await flush();
    const stopped=fleet.aircraft.filter(unit=>unit.state==='stopped');
    assert.ok(stopped.length>0);
    assert.ok(stopped.every(unit=>unit.reason.includes('建物データが更新され取得できません')));
    assert.ok(stopped.every(unit=>!unit.reason.includes('点検出所')));
    assert.ok(!stopped.some(unit=>unit.detourActive||unit.delivery?.ok));
    assert.ok(h.updates.at(-1).events.some(event=>event.text.includes('建物データが更新され取得できません')));
  }finally{h.cleanup()}
});

test('unavailable initial route samples explain why both candidates were not sent',async()=>{
  let sampleCalls=0;
  const h=fakeMap(async positions=>{
    if(++sampleCalls>6)throw new Error('建物データへの接続が切れました');
    return positions.map(position=>({...position,height:12}));
  },async()=>{throw new Error('相談してはいけません')});
  try{
    const fleet=h.map.start({origin,facilities,count:100});await flush();
    for(let t=0;t<=4000;t+=100){h.tick(t);await new Promise(resolve=>setImmediate(resolve))}
    await flush();
    const stopped=fleet.aircraft.filter(unit=>unit.state==='stopped');
    assert.ok(stopped.length>0);
    assert.ok(stopped.every(unit=>unit.reason.includes('建物データへの接続が切れました')));
    assert.ok(!h.updates.at(-1).events.some(event=>['Muse','fixture','unknown'].includes(event.source)));
  }finally{h.cleanup()}
});

test('a checked B proposal changes only the affected destinations',async()=>{
  const h=fakeMap(async positions=>positions.map(position=>({...position,height:12})),async()=>({sora:{choice:'A',reason:'比較'},nagi:{choice:'B',reason:'別施設'}}));
  try{
    const fleet=h.map.start({origin,facilities,count:100});
    const before=new Map(fleet.aircraft.map(unit=>[unit.id,unit.destinationId]));
    await flush();
    for(let t=0;t<=4000;t+=100){h.tick(t);await new Promise(resolve=>setImmediate(resolve))}
    await flush();
    assert.ok(fleet.aircraft.some(unit=>unit.detourActive&&unit.destinationId!==before.get(unit.id)));
    assert.ok(fleet.aircraft.some(unit=>!unit.detourActive&&unit.destinationId===before.get(unit.id)));
    assert.ok(h.updates.at(-1).events.some(event=>event.source==='unknown'&&event.text.includes('ソラ（比較）')&&event.text.includes('仮想案A')));
    assert.ok(h.updates.at(-1).events.some(event=>event.source==='unknown'&&event.text.includes('ナギ（最終提案）')&&event.text.includes('仮想案B')));
    assert.ok(h.updates.at(-1).events.some(event=>event.source==='app'&&event.text.includes('ナギの案Bを再点検')));
  }finally{h.cleanup()}
});

test('late Muse reply after user stop cannot restart or be shown as applied',async()=>{
  let resolveReply,sendNotice;
  const pending=new Promise(resolve=>{resolveReply=resolve});
  const h=fakeMap(async positions=>positions.map(position=>({...position,height:12})),(_evidence,_signal,notice)=>{sendNotice=notice;return pending});
  try{
    const fleet=h.map.start({origin,facilities,count:100});
    await flush();
    for(let t=0;t<=4000;t+=100){h.tick(t);await new Promise(resolve=>setImmediate(resolve))}
    h.map.stop('利用者が停止');
    assert.equal(typeof sendNotice,'function');
    sendNotice('遅れて届いた古い通知');
    resolveReply({sora:{choice:'A',reason:'比較'},nagi:{choice:'A',reason:'選択'}});
    await flush();
    assert.ok(fleet.aircraft.every(unit=>unit.state==='stopped'||unit.state==='complete'));
    assert.ok(!h.updates.at(-1).events.some(event=>['Muse','fixture','unknown'].includes(event.source)));
    assert.ok(!h.updates.at(-1).events.some(event=>event.text.includes('遅れて届いた古い通知')));
  }finally{h.cleanup()}
});

test('visible additional models follow real simulated units and stay out of Muse capture',async()=>{
  const h=fakeMap(async positions=>positions.map(position=>({...position,height:12})));
  try{
    const fleet=h.map.start({origin,facilities,count:100});await flush();
    for(let t=0;t<=1200;t+=100)h.tick(t);
    const models=h.entities.values.filter(entity=>entity.model&&!['偵察機（仮想）','中継機（仮想）'].includes(entity.name));
    const support=h.entities.values.filter(entity=>['偵察機（仮想）','中継機（仮想）'].includes(entity.name));
    assert.equal(models.length,8);assert.equal(support.length,2);
    const extras=models.slice(1).filter(entity=>entity.show);
    assert.ok(extras.length>=3,'multiple actual outbound units have models');
    for(const entity of extras)assert.ok(fleet.aircraft.some(unit=>['outbound','holding','stopped'].includes(unit.state)&&unit.position.longitude===entity.position.longitude&&unit.position.latitude===entity.position.latitude));
    assert.throws(()=>h.map.withoutMarkers(()=>{assert.ok([...models,...support].every(entity=>!entity.show));throw new Error('capture failure')}),/capture failure/);
    assert.equal(models.slice(1).filter(entity=>entity.show).length,extras.length);
    h.map.clear();assert.ok([...models,...support].every(entity=>!h.entities.values.includes(entity)));
  }finally{h.cleanup()}
});

test('follow camera waits during Muse consultation and cannot revive after stop',async()=>{
  let called=false,resolveConsult;
  const pending=new Promise(resolve=>{resolveConsult=resolve});
  const h=fakeMap(async positions=>positions.map(position=>({...position,height:12})),async()=>{called=true;return pending});
  try{
    const fromDegrees=h.C.Cartesian3.fromDegrees,fromDegreesArrayHeights=h.C.Cartesian3.fromDegreesArrayHeights;
    h.C.Cartesian3=class{constructor(x,y,z){Object.assign(this,{x,y,z})}};
    h.C.Cartesian3.fromDegrees=fromDegrees;h.C.Cartesian3.fromDegreesArrayHeights=fromDegreesArrayHeights;
    h.map.start({origin,facilities,count:100});await flush();
    assert.equal(h.map.setFollow(true),true);
    for(let t=0;t<=2200;t+=100){h.tick(t);await new Promise(resolve=>setImmediate(resolve))}
    await flush();assert.equal(called,true);assert.equal(h.viewer.trackedEntity,undefined);
    h.map.setFollow(true);assert.equal(h.viewer.trackedEntity,undefined);
    h.map.stop();resolveConsult({sora:{choice:'A',reason:'比較'},nagi:{choice:'A',reason:'元の施設'}});await flush();
    assert.equal(h.viewer.trackedEntity,undefined);assert.equal(h.updates.at(-1).phase,'stopped');
  }finally{h.cleanup()}
});

test('virtual scout report is relayed before affected units are held, and stops with the fleet',async()=>{
  let resolveConsult;
  const pending=new Promise(resolve=>{resolveConsult=resolve});
  const h=fakeMap(async positions=>positions.map(position=>({...position,height:12})),async()=>pending);
  try{
    const fleet=h.map.start({origin,facilities,count:100});await flush();
    for(let t=0;t<=2200;t+=100){h.tick(t);await new Promise(resolve=>setImmediate(resolve))}
    await flush();
    const update=h.updates.at(-1);
    assert.equal(update.support.scout,'仮想障害を報告');
    assert.equal(update.support.relay,'仮想情報を共有');
    assert.ok(update.events.findIndex(e=>e.text.includes('偵察機（仮想）'))<update.events.findIndex(e=>e.text.includes('中継機（仮想）')));
    assert.ok(update.events.some(e=>e.source==='app'&&e.text.includes('実際の無線通信は行っていません')));
    assert.ok(fleet.aircraft.some(unit=>unit.state==='holding'));
    h.map.stop('利用者が停止');
    assert.deepEqual(h.updates.at(-1).support,{scout:'停止',relay:'停止'});
    resolveConsult({sora:{choice:'A',reason:'比較'},nagi:{choice:'A',reason:'元の施設'}});await flush();
    assert.deepEqual(h.updates.at(-1).support,{scout:'停止',relay:'停止'});
    assert.ok(fleet.aircraft.every(unit=>unit.state==='stopped'||unit.state==='complete'));
  }finally{h.cleanup()}
});

test('a failed initial model check stops both support roles without a fictional report',async()=>{
  const h=fakeMap(async()=>{throw new Error('データ取得失敗')});
  try{
    h.map.start({origin,facilities,count:12});await flush();
    for(let t=0;t<=1000;t+=100)h.tick(t);
    const update=h.updates.at(-1);
    assert.deepEqual(update.support,{scout:'停止',relay:'停止'});
    assert.ok(!update.events.some(event=>event.text.includes('仮想障害を報告')));
  }finally{h.cleanup()}
});

test('Muse none causes a different checked virtual route to be tried before stopping',async()=>{
  const routes=[],seenEvidence=[];let calls=0;
  const h=fakeMap(async points=>points.map(p=>({...p,height:12})),async evidence=>{
    seenEvidence.push(structuredClone(evidence));
    routes.push(structuredClone(h.updates.at(-1).comparison.candidates.A));
    calls++;
    return calls===1?{sora:{choice:'none',reason:'最初は比較できません'},nagi:{choice:'none',reason:'別の経路が必要'}}:{sora:{choice:'A',reason:'再検討'},nagi:{choice:'A',reason:'仮想案A'}};
  });
  try{
    const fleet=h.map.start({origin,facilities,count:100});await flush();
    for(let t=0;t<=4000;t+=100){h.tick(t);await new Promise(resolve=>setImmediate(resolve))}await flush();
    assert.equal(calls,2);
    const id=h.updates.at(-1).comparison.affectedIds[0];
    assert.notDeepEqual(routes[0].routes[id].waypoint,routes[1].routes[id].waypoint);
    assert.notEqual(seenEvidence[0].distances.A.representative.totalM,seenEvidence[1].distances.A.representative.totalM);
    assert.ok(fleet.aircraft.some(unit=>unit.detourActive));
    assert.ok(h.updates.at(-1).events.some(event=>event.source==='app'&&event.text.includes('別の')));
    assert.equal(h.updates.at(-1).events.filter(event=>event.source==='unknown').length,4);
    assert.equal(h.updates.at(-1).comparison.previousAttempts[0].reply.nagi.choice,'none');
    assert.equal(h.updates.at(-1).comparison.reply.nagi.choice,'A');
  }finally{h.cleanup()}
});

test('repeated none is bounded and stops affected aircraft without fabricated success',async()=>{
  let calls=0;const h=fakeMap(async points=>points.map(p=>({...p,height:12})),async()=>{calls++;return {sora:{choice:'none',reason:'不明'},nagi:{choice:'none',reason:'不明'}}});
  try{const fleet=h.map.start({origin,facilities,count:100});await flush();for(let t=0;t<=4000;t+=100){h.tick(t);await new Promise(resolve=>setImmediate(resolve))}await flush();
    assert.equal(calls,2);assert.ok(fleet.aircraft.some(unit=>unit.state==='stopped'));assert.ok(!fleet.aircraft.some(unit=>unit.detourActive));
  }finally{h.cleanup()}
});

test('stopping during second Muse consultation discards its late answer',async()=>{
  let calls=0,resolve;const pending=new Promise(done=>{resolve=done});
  const h=fakeMap(async points=>points.map(p=>({...p,height:12})),async()=>{calls++;return calls===1?{sora:{choice:'none',reason:'不明'},nagi:{choice:'none',reason:'不明'}}:pending});
  try{const fleet=h.map.start({origin,facilities,count:100});await flush();for(let t=0;t<=4000;t+=100){h.tick(t);await new Promise(resolve=>setImmediate(resolve))}await flush();
    assert.equal(calls,2);h.map.stop('利用者が停止');resolve({sora:{choice:'A',reason:'比較'},nagi:{choice:'A',reason:'選択'}});await flush();
    assert.ok(fleet.aircraft.every(unit=>unit.state==='stopped'||unit.state==='complete'));assert.ok(!fleet.aircraft.some(unit=>unit.detourActive));
    assert.equal(h.updates.at(-1).events.filter(event=>event.source==='unknown').length,2);
  }finally{h.cleanup()}
});

test('when both initial candidates fail inspection the app tries a newly generated route',async()=>{
  let calls=0,consults=0;
  const h=fakeMap(async points=>{calls++;const blocked=calls===7||calls===9;return points.map(p=>({...p,height:blocked?200:12}))},async()=>{consults++;return {sora:{choice:'A',reason:'再点検'},nagi:{choice:'A',reason:'再点検'}}});
  try{const fleet=h.map.start({origin,facilities,count:100});await flush();for(let t=0;t<=4000;t+=100){h.tick(t);await new Promise(resolve=>setImmediate(resolve))}await flush();
    assert.equal(consults,1);assert.ok(fleet.aircraft.some(unit=>unit.detourActive));
    assert.equal(h.updates.at(-1).comparison.previousAttempts.length,1);
    assert.ok(h.updates.at(-1).events.some(event=>event.text.includes('別の仮想経路を')));
  }finally{h.cleanup()}
});

test('a temporary Muse 504 is retried with a newly checked route',async()=>{
  let calls=0;const h=fakeMap(async points=>points.map(p=>({...p,height:12})),async()=>{calls++;if(calls===1)throw new Error('Meta API エラー (504)');return {sora:{choice:'A',reason:'再相談'},nagi:{choice:'A',reason:'再相談'}}});
  try{const fleet=h.map.start({origin,facilities,count:100});await flush();for(let t=0;t<=4000;t+=100){h.tick(t);await new Promise(resolve=>setImmediate(resolve))}await flush();
    assert.equal(calls,2);assert.ok(fleet.aircraft.some(unit=>unit.detourActive));
    assert.ok(h.updates.at(-1).events.some(event=>event.source==='app'&&event.text.includes('504')));
  }finally{h.cleanup()}
});

test('repeated Muse 504 reports the two attempts and leaves affected drones stopped',async()=>{
  let calls=0;const h=fakeMap(async points=>points.map(p=>({...p,height:12})),async()=>{calls++;throw new Error('Meta API エラー (504)')});
  try{const fleet=h.map.start({origin,facilities,count:100});await flush();for(let t=0;t<=4000;t+=100){h.tick(t);await new Promise(resolve=>setImmediate(resolve))}await flush();
    assert.equal(calls,2);const affected=fleet.aircraft.filter(unit=>unit.state==='stopped');assert.ok(affected.length);assert.ok(affected.every(unit=>unit.reason.includes('2回試しました')&&unit.reason.includes('504')));assert.ok(!affected.some(unit=>unit.detourActive));
  }finally{h.cleanup()}
});
