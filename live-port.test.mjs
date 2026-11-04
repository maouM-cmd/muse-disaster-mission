import {test} from 'node:test';
import assert from 'node:assert/strict';
import {livePort} from './live-port.mjs';
test('live server defaults to 4385 and can use a separate fixed local port',()=>{
  assert.equal(livePort(),4385);assert.equal(livePort('4387'),4387);
  for(const value of ['0','65536','abc','1.5'])assert.throws(()=>livePort(value));
});
