import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as readiness from './readiness.mjs';

const make=id=>({id,area:'東京都荒川区',startedAt:'2026-11-03T10:00:00.000Z',finishedAt:'2026-11-03T10:10:00.000Z',total:2,delivered:1,stopped:1,events:[],units:[{id:'a'},{id:'b'}]});
test('fleet history retains previous results and never silently drops them at capacity',()=>{
 let raw=null;for(let i=0;i<20;i++)raw=readiness.appendLargeFleetRecord(raw,make(`run-${i}`));
 const rows=JSON.parse(raw);assert.equal(rows.length,20);assert.equal(rows.at(-1).id,'run-0');
 assert.throws(()=>readiness.appendLargeFleetRecord(raw,make('run-20')),/上限/);assert.equal(JSON.parse(raw).length,20);
});
test('fleet history rejects invalid storage and ID collisions while allowing an exact retry',()=>{
 const record=make('run-1'),raw=readiness.appendLargeFleetRecord(null,record);
 assert.equal(readiness.appendLargeFleetRecord(raw,record),raw);
 assert.throws(()=>readiness.appendLargeFleetRecord(raw,{...record,stopped:0}),/ID/);
 assert.throws(()=>readiness.appendLargeFleetRecord('{',record));
 assert.throws(()=>readiness.appendLargeFleetRecord(raw,{...record,id:'bad id'}));
});
