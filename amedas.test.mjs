import {test} from 'node:test';
import assert from 'node:assert/strict';
import {amedasObservation,amedasTimeKey,createObservationMonitor} from './geo-data.mjs';

const stations={a:{kjName:'近い地点',lat:[35,42],lon:[139,48]},b:{kjName:'遠い地点',lat:[35,50],lon:[139,55]}};
const readings={a:{wind:[3.2,0],precipitation10m:[0.5,0]},b:{wind:[4,0]}};
const time='2026-11-01T14:20:00+09:00';

test('changing the reference point cancels the previous observation and rejects late results',async()=>{
  const pending=[],shown=[],loading=[],scheduled=[];
  const monitor=createObservationMonitor({load:(point,signal)=>new Promise(resolve=>pending.push({point,signal,resolve})),onLoading:ref=>loading.push(ref.label),onResult:(value,ref,current)=>shown.push({value,label:ref.label,current}),onFailure:()=>assert.fail('unexpected failure'),schedule:fn=>(scheduled.push(fn),scheduled.length),cancel:()=>{}});
  const first=monitor.set({latitude:35.7,longitude:139.8},'地域中心');
  const second=monitor.set({latitude:35.8,longitude:139.9},'施設B');
  assert.deepEqual(loading,['地域中心','施設B']);assert.equal(pending[0].signal.aborted,true);
  pending[0].resolve('古い結果');pending[1].resolve('新しい結果');await Promise.all([first,second]);
  assert.deepEqual(shown.map(item=>[item.value,item.label]),[['新しい結果','施設B']]);
  const current=shown[0].current;assert.equal(current(),true);
  monitor.set({latitude:35.9,longitude:140},'施設C');assert.equal(current(),false);
  monitor.stop();assert.equal(pending[2].signal.aborted,true);
});

test('a failed facility observation retries without restoring another location',async()=>{
  const events=[];let next=null,attempt=0;
  const monitor=createObservationMonitor({load:async()=>{if(++attempt===1)throw new Error('offline');return '復旧'},onLoading:ref=>events.push(`確認中:${ref.label}`),onResult:(value,ref)=>events.push(`${ref.label}:${value}`),onFailure:(_error,ref)=>events.push(`失敗:${ref.label}`),schedule:fn=>(next=fn,1),cancel:()=>{next=null}});
  await monitor.set({latitude:35.8,longitude:139.9},'施設B');
  assert.deepEqual(events,['確認中:施設B','失敗:施設B']);assert.ok(next);
  const retry=next;next=null;await retry();assert.equal(events.at(-1),'施設B:復旧');monitor.stop();
});

test('suspending observations rejects delayed results and resumes only the latest point',async()=>{
 const pending=[],shown=[];const monitor=createObservationMonitor({load:(point,signal)=>new Promise(resolve=>pending.push({point,signal,resolve})),onLoading:()=>{},onResult:(value,ref)=>shown.push([value,ref.label]),onFailure:()=>{},schedule:()=>1,cancel:()=>{}});
 const old=monitor.set({latitude:35.7,longitude:139.8},'古い地点');monitor.suspend();assert.equal(pending[0].signal.aborted,true);
 await monitor.set({latitude:35.8,longitude:139.9},'新しい地点');assert.equal(pending.length,1);
 const resumed=monitor.resume();assert.equal(pending.length,2);pending[0].resolve('古い結果');pending[1].resolve('新しい結果');await Promise.all([old,resumed]);
 assert.deepEqual(shown,[['新しい結果','新しい地点']]);monitor.stop();
});
test('observation reference kind follows the current point through suspend and resume',async()=>{
 const seen=[];const monitor=createObservationMonitor({load:async()=>({}),onLoading:()=>{},onResult:(_,ref)=>seen.push(ref.kind),onFailure:()=>{},schedule:()=>1,cancel:()=>{}});
 await monitor.set({latitude:35.7,longitude:139.8},'中心','model_center');monitor.suspend();await monitor.set({latitude:35.8,longitude:139.9},'施設','facility');await monitor.resume();
 assert.deepEqual(seen,['model_center','facility']);assert.throws(()=>monitor.set({latitude:35.7,longitude:139.8},'場所','wrong'));monitor.stop();
});

test('shows fresh observations from the nearest reporting station and marks distance',()=>{
  const result=amedasObservation(stations,readings,{latitude:35.7,longitude:139.8},time,Date.parse('2026-11-01T05:35:00Z'));
  assert.equal(result.station,'近い地点');assert.equal(result.wind,3.2);assert.equal(result.rain,0.5);
  assert.equal(result.latitude,35.7);assert.equal(result.longitude,139.8);
  assert.ok(result.distance<1);assert.equal(result.fresh,true);
  assert.equal(amedasTimeKey(time),'20261101142000');
});

test('accumulated rainfall remains separate by observation period and invalid values are unknown',()=>{
 const origin={latitude:35.7,longitude:139.8},now=Date.parse(time);
 const reading={a:{wind:[3.2,0],precipitation10m:[0.5,0],precipitation1h:[2.5,0],precipitation24h:[7,0]}};
 const result=amedasObservation(stations,reading,origin,time,now);assert.equal(result.rain,0.5);assert.equal(result.rain1h,2.5);assert.equal(result.rain24h,7);
 const bad=amedasObservation(stations,{a:{wind:[3.2,0],precipitation10m:[0,0],precipitation1h:[-2,0],precipitation24h:[10,5]}},origin,time,now);
 assert.equal(bad.rain,0);assert.equal(bad.rain1h,null);assert.equal(bad.rain24h,null);
 const missing=amedasObservation(stations,{a:{wind:[3.2,0]}},origin,time,now);assert.equal(missing.rain1h,null);assert.equal(missing.rain24h,null);
});

test('a nearby station with only accumulated rainfall remains available without inventing missing values',()=>{
 const origin={latitude:35.7,longitude:139.8},now=Date.parse(time);
 const result=amedasObservation(stations,{a:{wind:[1,5],precipitation10m:[null,0],precipitation1h:[0,0],precipitation24h:[7,0]}},origin,time,now);
 assert.equal(result.station,'近い地点');assert.equal(result.wind,null);assert.equal(result.rain,null);assert.equal(result.rain1h,0);assert.equal(result.rain24h,7);
 assert.equal(amedasObservation(stations,{a:{precipitation1h:[5,5],precipitation24h:[-1,0]}},origin,time,now),null);
});

test('never presents old, future, bad-quality or absent values as current',()=>{
  const origin={latitude:35.7,longitude:139.8};
  assert.equal(amedasObservation(stations,readings,origin,time,Date.parse('2026-11-01T06:00:01Z')).fresh,false);
  assert.equal(amedasObservation(stations,readings,origin,time,Date.parse('2026-11-01T05:10:00Z')).fresh,false);
  assert.equal(amedasObservation(stations,readings,origin,time,Date.parse(time)-60000).fresh,false);
  const r=amedasObservation(stations,{a:{wind:[3.2,5],precipitation10m:[null,0]}},origin,time,Date.parse('2026-11-01T05:25:00Z'));
  assert.equal(r,null);
  assert.equal(amedasObservation(stations,readings,{latitude:20,longitude:140},time,Date.parse('2026-11-01T05:25:00Z')),null);
  assert.throws(()=>amedasTimeKey('not-a-time'));
});

test('invalid calendar dates and normalized time strings are rejected',()=>{
 for(const value of ['2026-02-30T14:20:00+09:00','2026-11-31T14:20:00+09:00','2026-11-01T24:00:00+09:00','2026-11-01T14:60:00+09:00'])assert.throws(()=>amedasTimeKey(value));
 assert.equal(amedasTimeKey('2024-02-29T14:20:00+09:00'),'20240229142000');
});

test('malformed station degree-minute coordinates are never treated as nearby observations',()=>{
 const origin={latitude:35.7,longitude:139.8},now=Date.parse(time);
 for(const changed of [{lat:[34,102],lon:[139,48]},{lat:[36,-18],lon:[139,48]},{lat:[35,42],lon:[138,108]},{lat:[90,1],lon:[139,48]}]){
  assert.equal(amedasObservation({a:{kjName:'不正な地点',...changed}},readings,origin,time,now),null);
 }
});
