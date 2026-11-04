import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pilotFacilityKey, validatePilotFacilityRecord} from './readiness.mjs';

test('facility notes are bound to area and facility and reject missing identity',()=>{
  assert.equal(pilotFacilityKey('13118','School','Tokyo'),pilotFacilityKey('13118','School','Tokyo'));
  assert.notEqual(pilotFacilityKey('13118','School','Tokyo'),pilotFacilityKey('13101','School','Tokyo'));
  assert.equal(pilotFacilityKey('13118','','Tokyo'),null);
});
test('only explicit local notes with matching identity and valid times are shown',()=>{
  const identity={area:'13118',name:'School',address:'Tokyo'};
  const record={...identity,status:'available',at:'2026-11-03T12:00:00.000Z',source:'施設への確認'};
  assert.deepEqual(validatePilotFacilityRecord(record,identity),record);
  assert.equal(validatePilotFacilityRecord(record,{...identity,area:'13101'}),null);
  assert.equal(validatePilotFacilityRecord({...record,status:'safe'},identity),null);
  assert.equal(validatePilotFacilityRecord({...record,at:'invalid'},identity),null);
});

