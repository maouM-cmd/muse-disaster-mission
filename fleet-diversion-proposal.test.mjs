import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createFleet,setDestinationCheck,advanceFleet,stopFleet} from './fleet-engine.mjs';
import {createVirtualHazard,reportVirtualHazard,buildDetourCandidates,recordMuseChoice,createDiversionProposal,isDiversionProposalCurrent} from './fleet-coordination.mjs';

const origin={latitude:35.681,longitude:139.767};
const facilities=[{id:'a',name:'施設A',latitude:35.682,longitude:139.768},{id:'b',name:'施設B',latitude:35.69,longitude:139.771},{id:'c',name:'施設C',latitude:35.675,longitude:139.76}];
const pass={ok:true,surfaceHeight:12,evidence:{total:2,observed:2,unknown:0,maxGap:29,blockedIndices:[]}};
function setup(){
  const fleet=createFleet({origin,destinations:facilities,count:6});
  for(const facility of facilities)setDestinationCheck(fleet,facility.id,pass,0);
  advanceFleet(fleet,100);
  const coord=reportVirtualHazard(fleet,createVirtualHazard({id:'h',latitude:35.6855,longitude:139.769,radiusM:200}),100);
  const candidate=buildDetourCandidates(fleet,coord,100).B;
  assert.ok(coord.heldIds.length>0&&candidate.valid);
  recordMuseChoice(coord,{side:'B',source:'Muse',at:100});
  return {fleet,coord,candidate,runId:'run-1',modelVersion:1};
}

test('proposal shows each destination and affected box count without moving the fleet',()=>{
  const context=setup(),before=structuredClone(context.fleet);
  const proposal=createDiversionProposal(context);
  assert.equal(proposal.affected,context.coord.heldIds.length);
  assert.equal(proposal.destinations.reduce((sum,d)=>sum+d.boxes,0),proposal.affected);
  assert.ok(proposal.destinations.every(d=>d.name&&Number.isFinite(d.latitude)&&Number.isFinite(d.longitude)));
  assert.deepEqual(context.fleet,before);
  assert.equal(isDiversionProposalCurrent(proposal,context),true);
});

test('changed run, model, candidate, held position or stop invalidates approval',()=>{
  for(const change of ['run','model','candidate','position','destination','stopped']){
    const context=setup(),proposal=createDiversionProposal(context);
    if(change==='run')context.runId='run-2';
    if(change==='model')context.modelVersion++;
    if(change==='candidate')context.candidate.routes[context.coord.heldIds[0]].path[0].latitude+=.0001;
    if(change==='position')context.fleet.aircraft.find(u=>u.id===context.coord.heldIds[0]).position.latitude+=.0001;
    if(change==='destination')context.fleet.aircraft.find(u=>u.id===context.coord.heldIds[0]).destination={...context.fleet.aircraft.find(u=>u.id===context.coord.heldIds[0]).destination,name:'別の施設'};
    if(change==='stopped')stopFleet(context.fleet,'利用者が停止');
    assert.equal(isDiversionProposalCurrent(proposal,context),false,change);
  }
});

test('proposal rejects a candidate that no longer matches the stored route or held aircraft',()=>{
  const context=setup();
  context.candidate.routes[context.coord.heldIds[0]].destinationId='unknown';
  assert.throws(()=>createDiversionProposal(context));
});

test('proposal rejects a route whose start or end no longer matches its held aircraft or facility',()=>{
  for(const part of ['start','end','return']){
    const context=setup(),id=context.coord.heldIds[0];
    const route=context.candidate.routes[id];
    if(part==='start')route.path[0].latitude+=.0001;
    if(part==='end')route.path.at(-1).latitude+=.0001;
    if(part==='return')route.returnPath.at(-1).latitude+=.0001;
    context.coord.candidates.B=structuredClone(context.candidate);
    assert.throws(()=>createDiversionProposal(context),part);
  }
});

test('proposal rejects duplicate aircraft identity or duplicate destination identity',()=>{
  for(const part of ['aircraft','destination']){
    const context=setup();
    if(part==='aircraft')context.fleet.aircraft.push({...context.fleet.aircraft[0]});
    if(part==='destination')context.fleet.destinations=[...context.fleet.destinations,{...context.fleet.destinations[0]}];
    assert.throws(()=>createDiversionProposal(context),part);
  }
});

test('another reported virtual hazard invalidates a pending proposal',()=>{
  const context=setup(),proposal=createDiversionProposal(context);
  const route=context.candidate.routes[context.coord.heldIds[0]];
  reportVirtualHazard(context.fleet,createVirtualHazard({id:'second',latitude:route.destination.latitude,longitude:route.destination.longitude,radiusM:50}),100);
  assert.equal(isDiversionProposalCurrent(proposal,context),false);
});

test('a forged proposal with altered displayed counts is not accepted',()=>{
  const context=setup(),proposal=createDiversionProposal(context);
  assert.equal(isDiversionProposalCurrent({...proposal,affected:99,destinations:[{...proposal.destinations[0],boxes:99}]},context),false);
});

test('proposal rejects an alternate facility whose name is only whitespace',()=>{
  const context=setup(),id=context.coord.heldIds[0],destinationId=context.candidate.routes[id].destinationId;
  context.fleet.destinations=context.fleet.destinations.map(d=>d.id===destinationId?{...d,name:' '}:d);
  for(const route of Object.values(context.candidate.routes))if(route.destinationId===destinationId)route.destination.name=' ';
  context.coord.candidates.B=structuredClone(context.candidate);
  assert.throws(()=>createDiversionProposal(context));
});
