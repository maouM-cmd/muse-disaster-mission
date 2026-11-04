import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assessReadiness,labelsForOrder} from './readiness.mjs';
import * as readiness from './readiness.mjs';
test('bulletin retrieval age distinguishes old data and clock errors without calling data current',()=>{
 const fetched='2026-11-04T00:00:00.000Z',t=Date.parse(fetched);
 assert.equal(readiness.bulletinRetrievalAge(fetched,t),'recent');
 assert.equal(readiness.bulletinRetrievalAge(fetched,t+7199999),'recent');
 assert.equal(readiness.bulletinRetrievalAge(fetched,t+7200000),'old');
 assert.equal(readiness.bulletinRetrievalAge(fetched,t-300001),'clock');
 assert.equal(readiness.bulletinRetrievalAge('invalid',t),'unknown');
 assert.equal(readiness.bulletinRetrievalAge(fetched,NaN),'unknown');
});
test('route comparison shows observed, unknown and high samples without implying safety',()=>{
  const reports={A:{total:12,observed:10,unknown:2,blockedIndices:[2],maxGap:29},B:{total:9,observed:0,unknown:9,blockedIndices:[],maxGap:28}};
  const a=readiness.mapRouteSummary(reports,'A');
  assert.match(a,/取得10\/12/);assert.match(a,/不明2/);assert.match(a,/高い表面1/);assert.match(a,/約29m/);assert.doesNotMatch(a,/安全/);
  assert.match(readiness.mapRouteSummary(reports,'B'),/取得0\/9/);
  assert.match(readiness.mapRouteSummary({...reports,stale:true},'A'),/利用できません/);
  assert.match(readiness.mapRouteSummary(null,'A',true),/点検中/);
  assert.match(readiness.mapRouteSummary({A:{...reports.A,unknown:99}},'A'),/利用できません/);
});
test('second facility flood lookup cancels stale results and keeps unknown separate from zero',async()=>{
  const pending=[],states=[];
  const tracker=readiness.createFacilityFloodTracker({read:(point,signal)=>new Promise((resolve,reject)=>pending.push({point,signal,resolve,reject})),onChange:value=>states.push(value)});
  const a={name:'施設A',address:'住所A',latitude:35.7,longitude:139.7},b={name:'施設B',address:'住所B',latitude:35.71,longitude:139.7};
  tracker.select(a);await Promise.resolve();tracker.select(b);await Promise.resolve();
  assert.equal(pending[0].signal.aborted,true);
  pending[0].resolve('3.0〜5.0m');pending[1].resolve(null);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(states.at(-1).name,'施設B');assert.equal(states.at(-1).state,'unknown');
  tracker.select(b);await Promise.resolve();assert.equal(pending.length,2);
  tracker.select(b,{force:true});await Promise.resolve();pending[2].reject(new Error('offline'));await new Promise(resolve=>setImmediate(resolve));
  assert.equal(states.at(-1).state,'error');tracker.select(null);assert.equal(states.at(-1),null);
});
test('second drone distance changes target on return and excludes inactive or invalid state',()=>{
  assert.deepEqual(readiness.fleetPosition('outbound',150,200),{target:'配送先',distance:'約 150 m',progress:25});
  assert.deepEqual(readiness.fleetPosition('delivery',0,200),{target:'配送先',distance:'約 0 m',progress:100});
  assert.deepEqual(readiness.fleetPosition('returning',150,200),{target:'出発地点',distance:'約 150 m',progress:25});
  assert.deepEqual(readiness.fleetPosition('home',0,200),{target:'出発地点',distance:'約 0 m',progress:100});
  for(const phase of ['checking','waiting','stopped','unavailable'])assert.equal(readiness.fleetPosition(phase,100,200),null);
  for(const distance of [null,-1,NaN,Infinity])assert.equal(readiness.fleetPosition('outbound',distance,200),null);
  assert.equal(readiness.fleetPosition('outbound',100,0),null);
});

test('simulation milestones distinguish completion from a failed landing check',()=>{
  assert.deepEqual(readiness.mapMissionSteps('preflight'),['current','pending','pending','pending']);
  assert.deepEqual(readiness.mapMissionSteps('preflight-blocked'),['blocked','pending','pending','pending']);
  assert.deepEqual(readiness.mapMissionSteps('preflight-unavailable'),['blocked','pending','pending','pending']);
  assert.deepEqual(readiness.mapMissionSteps('direct-unavailable'),['blocked','pending','pending','pending']);
  assert.deepEqual(readiness.mapMissionSteps('detour-unavailable'),['done','done','blocked','pending']);
  assert.deepEqual(readiness.mapMissionSteps('direct'),['current','pending','pending','pending']);
  assert.deepEqual(readiness.mapMissionSteps('obstacle'),['done','current','pending','pending']);
  assert.deepEqual(readiness.mapMissionSteps('detour'),['done','done','current','pending']);
  assert.deepEqual(readiness.mapMissionSteps('delivery'),['done','done','done','current']);
  assert.deepEqual(readiness.mapMissionSteps('surface-unavailable'),['done','done','done','blocked']);
  assert.deepEqual(readiness.mapMissionSteps('complete'),['done','done','done','done']);
  assert.deepEqual(readiness.mapMissionSteps('error'),['pending','pending','pending','pending']);
});

test('simulated straight-line distance is labeled and rejects unknown values',()=>{
  assert.equal(readiness.mapMissionDistance(1234),'約 1.23 km');
  assert.equal(readiness.mapMissionDistance(456.7),'約 457 m');
  assert.equal(readiness.mapMissionDistance(null),'—');
  assert.equal(readiness.mapMissionDistance(-1),'—');
});

test('mission evidence keeps the sampled unknowns and selection source visible',()=>{
  assert.equal(readiness.mapMissionEvidence(null,null),'');
  const departure={total:11,unknown:2};
  assert.match(readiness.mapMissionEvidence(departure,null),/出発 11点・不明2点/);
  const route={side:'B',total:24,unknown:3,source:'Muse'};
  const text=readiness.mapMissionEvidence(departure,route);
  assert.match(text,/出発 11点・不明2点/);assert.match(text,/B案 24点・不明3点/);assert.match(text,/出所.*不明/);assert.match(text,/点と点の間・電線は未確認/);
  assert.match(readiness.mapMissionEvidence(null,{...route,provenance:'fixture'}),/試験用/);
  assert.match(readiness.mapMissionEvidence(null,{...route,provenance:'muse'}),/Muse.*申告/);
  assert.match(readiness.mapMissionEvidence(null,{...route,source:'manual'}),/手動選択/);
  assert.equal(readiness.mapMissionEvidence({total:0,unknown:0},{side:'X',total:1,unknown:0,source:'Muse'}),'');
});
test('second drone status names its destination, independent progress and failure',()=>{
  assert.equal(readiness.fleetStatus(null),'');
  assert.match(readiness.fleetStatus({name:'第二施設',phase:'outbound',report:{total:9,unknown:2}}),/第二施設.*配送中/);
  assert.match(readiness.fleetStatus({name:'第二施設',phase:'outbound',report:{total:9,unknown:2}}),/9点・不明2点/);
  assert.match(readiness.fleetStatus({name:'第二施設',phase:'stopped',message:'点検失敗'}),/中止.*点検失敗/);
  assert.match(readiness.fleetStatus({phase:'unavailable',message:'候補なし'}),/候補なし/);
  assert.match(readiness.fleetStatus({name:'第二施設',phase:'home'}),/帰還/);
});

test('source overview distinguishes loading, failures, stale data, and hidden flood layers',()=>{
  assert.equal(typeof readiness.sourceOverview,'function');
  const rows=readiness.sourceOverview({buildings:'available',shelters:'error',weather:'stale',risk:'error'},false);
  assert.deepEqual(rows.map(row=>row.value),['モデル表示中','取得できず','発表が古い','非表示・取得失敗の履歴あり']);
  assert.equal(readiness.sourceOverview({buildings:'loading'},true)[0].value,'取得中');
  assert.equal(readiness.sourceOverview({risk:'reference'},true)[3].value,'重ね表示・範囲未確認');
  assert.equal(readiness.sourceOverview({},true)[1].value,'未確認');
});

test('map notice names unavailable sources without implying that missing hazards are safe',()=>{
  assert.equal(typeof readiness.sourceNotice,'function');
  const missing=assessReadiness({buildings:'error',shelters:'loading',weather:'stale',risk:'error'});
  const notice=readiness.sourceNotice(missing.ids);
  for(const name of ['建物','施設','洪水想定図','気象'])assert.ok(notice.includes(name));
  assert.match(notice,/取得中|未確認/);
  const ready=assessReadiness({buildings:'available',shelters:'available',weather:'current',risk:'reference'});
  assert.equal(readiness.sourceNotice(ready.ids),'');
  assert.notEqual(readiness.sourceNotice(null),'');
});

test('only a complete permutation of current checks can be shown',()=>{
  assert.deepEqual(labelsForOrder(['flood','airspace'],['airspace','flood']),['飛行規制・飛行許可は未確認','現在の浸水状況は未確認']);
  assert.throws(()=>labelsForOrder(['flood','airspace'],['flood','flood']));
  assert.throws(()=>labelsForOrder(['flood','airspace'],['flood','safe']));
});
test('map and directory availability cannot establish safe flight or open shelter',()=>{
  const result=assessReadiness({buildings:'available',shelters:'available',weather:'current',risk:'reference'});
  assert.equal(result.state,'判断不可');assert.ok(result.reasons.some(x=>x.includes('飛行規制')));assert.ok(result.reasons.some(x=>x.includes('受入')));
  assert.ok(result.ids.includes('airspace'));assert.ok(result.ids.includes('shelter_open'));
});
test('stale or failed sources remain explicit unknowns',()=>{
  const result=assessReadiness({buildings:'error',shelters:'loading',weather:'stale',risk:'error'});
  assert.ok(result.reasons.some(x=>x.includes('建物')));assert.ok(result.reasons.some(x=>x.includes('気象')));assert.ok(result.reasons.some(x=>x.includes('想定')));
});

test('view frame diagnostics separate size drift from camera drift', ()=>{
  const m16=[1,0,0,0,0,1,0,0,0,0,1,0,10,20,30,1];
  assert.match(readiness.describeViewFrameChange({width:800,height:600,matrix:m16},{width:800,height:600,matrix:m16}),/カメラ一致/);
  assert.match(readiness.describeViewFrameChange({width:800,height:600,matrix:m16},{width:800,height:601,matrix:m16}),/画面サイズ不一致/);
  const moved=[...m16];moved[12]=10.5;moved[13]=21;
  assert.match(readiness.describeViewFrameChange({width:800,height:600,matrix:m16},{width:800,height:600,matrix:moved}),/カメラ差分2件/);
  assert.match(readiness.describeViewFrameChange(null,null),/比較できず/);
});

test('view frames tolerate float noise but reject real camera changes', ()=>{
  const m16=[1,0,0,0,0,1,0,0,0,0,1,0,10,20,30,1];
  const frame=(matrix,width=800,height=600)=>({width,height,matrix});
  assert.equal(readiness.isViewFrameCurrent(frame(m16),frame(m16)), true);
  const noise=[...m16];noise[0]+=2e-7;noise[12]+=1e-9;
  assert.equal(readiness.isViewFrameCurrent(frame(m16),frame(noise)), true);
  const posDrift=[...m16];posDrift[12]+=0.5;
  assert.equal(readiness.isViewFrameCurrent(frame(m16),frame(posDrift)), false);
  const drag=[...m16];drag[0]+=8e-4;
  assert.equal(readiness.isViewFrameCurrent(frame(m16),frame(drag)), false);
  const moved=[...m16];moved[12]+=100;
  assert.equal(readiness.isViewFrameCurrent(frame(m16),frame(moved)), false);
  assert.equal(readiness.isViewFrameCurrent(frame(m16),frame(m16,801)), false);
  assert.equal(readiness.isViewFrameCurrent(null,frame(m16)), false);
  assert.equal(readiness.isViewFrameCurrent(frame(m16),null), false);
});
test('view diagnostics report precise rotation and position drift', ()=>{
  const m16=[1,0,0,0,0,1,0,0,0,0,1,0,10,20,30,1];
  const drift=[...m16];drift[0]+=2.3e-7;drift[12]+=0.5;
  const text=readiness.describeViewFrameChange({width:708,height:884,matrix:m16},{width:708,height:884,matrix:drift});
  assert.match(text,/カメラ差分2件/);
  assert.match(text,/最大差 向き/);assert.match(text,/位置/);
  assert.match(text,/\[0\]差2\.3e-7/);
});
