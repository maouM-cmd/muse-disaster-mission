import test from 'node:test';
import assert from 'node:assert/strict';
import {updateLocalHistory,pilotFacilityKey,createFacilityReport,appendFacilityReport,decodeFacilityReports,createExerciseRecord,appendExerciseRecord,decodeExerciseRecords,mergeLocalHistories,createPhotoMetadata,createPhotoReview,appendPhotoReview,decodePhotoReviews,appendLargeFleetRecord} from './readiness.mjs';
import {createConsultAudit,finishConsultAudit,appendConsultAudit,recordConsultReview} from './readiness.mjs';
import {createInfrastructureReport,appendInfrastructureReport,decodeInfrastructureReports} from './infrastructure-reports.mjs';

function fakeStore(){const data=new Map();return {getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)}}
function fakeLocks(){const tails=new Map();return {request(name,options,callback){const previous=tails.get(name)||Promise.resolve(),next=previous.catch(()=>{}).then(()=>callback());tails.set(name,next);return next}}}
function fakeVersions(){const data=new Map();return {async read(key){return data.has(key)?{exists:true,value:data.get(key)}:{exists:false}},async write(key,value){data.set(key,value)},close(){}}}
test('concurrent infrastructure reports survive and stale deletion is refused',async()=>{
 const storage=fakeStore(),locks=fakeLocks(),versions=fakeVersions(),area='15222',key=`muse-infrastructure-reports-v1:${area}`,now=Date.parse('2026-11-04T12:00:00Z');
 const make=id=>createInfrastructureReport({id,area,location:'架空の道路',item:'wire',status:'uncertain',source:'架空の報告',observedAt:'2026-11-04T10:00:00.000Z',recordedAt:'2026-11-04T11:00:00.000Z',expiresAt:'2026-11-04T13:00:00.000Z',corrects:null},now);
 await updateLocalHistory({storage,locks,versions,key,update:raw=>appendInfrastructureReport(raw,make('a'),area,now)});const expected=storage.getItem(key);
 await Promise.all(['b','c'].map(id=>updateLocalHistory({storage,locks,versions,key,update:raw=>appendInfrastructureReport(raw,make(id),area,now)})));
 assert.equal(decodeInfrastructureReports(storage.getItem(key),area).records.length,3);await assert.rejects(updateLocalHistory({storage,locks,versions,key,expected,update:()=>null}),/確認後に記録が変わりました/);
});
test('concurrent tabletop records survive and stale deletion is refused',async()=>{
 const storage=fakeStore(),locks=fakeLocks(),versions=fakeVersions(),key='muse-tabletop-training-v1';
 const make=notes=>createExerciseRecord({scenario:'facility-refused',decision:'hold',observed:['facility'],notes,startedAt:'2026-11-03T10:00:00.000Z',finishedAt:'2026-11-03T10:01:00.000Z'});
 await updateLocalHistory({storage,locks,versions,key,update:raw=>appendExerciseRecord(raw,make('first'))});
 const expected=storage.getItem(key);
 await Promise.all(['second','third'].map(note=>updateLocalHistory({storage,locks,versions,key,update:raw=>appendExerciseRecord(raw,make(note))})));
 assert.deepEqual(decodeExerciseRecords(storage.getItem(key)).records.map(record=>record.notes),['third','second','first']);
 await assert.rejects(updateLocalHistory({storage,locks,versions,key,expected,update:()=>null}),/確認後に記録が変わりました/);
 assert.equal(decodeExerciseRecords(storage.getItem(key)).records.length,3);
 assert.equal(mergeLocalHistories(key,expected,storage.getItem(key)).mode,'manual');
});
test('concurrent photo reviews survive and a deletion based on old contents is refused',async()=>{
 const storage=fakeStore(),locks=fakeLocks(),versions=fakeVersions(),key='muse-photo-reviews-v1',time='2026-11-02T00:00:00.000Z';
 const metadata=createPhotoMetadata({kind:'training',visibility:'unknown',time:'',latitude:'',longitude:'',accuracy:'',direction:'unknown',calibration:'unknown',width:90,height:60},Date.parse(time));
 const make=id=>createPhotoReview({version:1,id,frameId:id,receivedAt:time,recordedAt:time,boxCount:0,metadata,sentSize:{width:90,height:60}});
 await updateLocalHistory({storage,locks,versions,key,update:raw=>appendPhotoReview(raw,make('first'))});const expected=storage.getItem(key);
 await Promise.all(['second','third'].map(id=>updateLocalHistory({storage,locks,versions,key,update:raw=>appendPhotoReview(raw,make(id))})));
 assert.equal(decodePhotoReviews(storage.getItem(key)).records.length,3);
 await assert.rejects(updateLocalHistory({storage,locks,versions,key,expected,update:()=>null}),/確認後に記録が変わりました/);
 assert.equal(decodePhotoReviews(storage.getItem(key)).records.length,3);
});
test('concurrent fleet results are retained and stale deletion is refused',async()=>{
 const storage=fakeStore(),locks=fakeLocks(),versions=fakeVersions(),key='muse-large-fleet-history-v1';
 const make=id=>({id,area:'荒川区',startedAt:'2026-11-03T10:00:00Z',finishedAt:'2026-11-03T10:01:00Z',total:1,delivered:0,stopped:1,events:[],units:[{id:'one'}]});
 await updateLocalHistory({storage,locks,versions,key,update:raw=>appendLargeFleetRecord(raw,make('a'))});const expected=storage.getItem(key);
 await Promise.all(['b','c'].map(id=>updateLocalHistory({storage,locks,versions,key,update:raw=>appendLargeFleetRecord(raw,make(id))})));
 assert.deepEqual(JSON.parse(storage.getItem(key)).map(row=>row.id),['c','b','a']);
 await assert.rejects(updateLocalHistory({storage,locks,versions,key,expected,update:()=>null}),/確認後に記録が変わりました/);
 assert.equal(JSON.parse(storage.getItem(key)).length,3);
});
test('concurrent consultation records are serialized without discarding either response',async()=>{
 const storage=fakeStore(),locks=fakeLocks(),versions=fakeVersions(),key='muse-map-consult-audits-v1',time='2026-11-03T10:00:00.000Z';
 const make=id=>finishConsultAudit(createConsultAudit({id,capturedAt:time,area:'13118',payload:{supply:null,quantity:null}}),{density:'dense',ordered_ids:['flood','obstacles','airspace','shelter_open','communications']},time);
 await Promise.all(['first','second'].map(id=>updateLocalHistory({storage,locks,versions,key,update:raw=>appendConsultAudit(raw,make(id))})));
 assert.deepEqual(JSON.parse(storage.getItem(key)).map(item=>item.requestId),['second','first']);
});
test('concurrent human decisions never silently replace a decision made in another tab',async()=>{
 const storage=fakeStore(),locks=fakeLocks(),versions=fakeVersions(),key='muse-map-consult-audits-v1',at='2026-11-03T10:00:00.000Z';
 const audit=finishConsultAudit(createConsultAudit({id:'review',capturedAt:at,area:'13118',payload:{supply:null,quantity:null}}),{density:'dense',ordered_ids:['flood','obstacles','airspace','shelter_open','communications']},at);
 await updateLocalHistory({storage,locks,versions,key,update:raw=>appendConsultAudit(raw,audit)});
 const results=await Promise.allSettled(['hold','reject'].map(choice=>updateLocalHistory({storage,locks,versions,key,update:raw=>recordConsultReview(raw,audit,choice,'2026-11-03T10:01:00.000Z')})));
 assert.deepEqual(results.map(r=>r.status),['fulfilled','rejected']);assert.deepEqual(JSON.parse(storage.getItem(key))[0].reviews,[{choice:'hold',at:'2026-11-03T10:01:00.000Z'}]);
});
test('two queued appends read the latest value inside the shared lock',async()=>{
 const storage=fakeStore(),locks=fakeLocks(),versions=fakeVersions(),key='muse-risk-review-v1:13118';
 await Promise.all(['a','b'].map(value=>updateLocalHistory({storage,locks,versions,key,update:raw=>JSON.stringify([...JSON.parse(raw||'[]'),value])})));
 assert.deepEqual(JSON.parse(storage.getItem(key)),['a','b']);
});
test('two-aircraft history is serialized and preserves both concurrent outcomes',async()=>{
 const storage=fakeStore(),locks=fakeLocks(),versions=fakeVersions(),key='muse.teamDetour.東京都荒川区';
 await Promise.all(['first','second'].map(value=>updateLocalHistory({storage,locks,versions,key,update:raw=>JSON.stringify([...JSON.parse(raw||'[]'),value])})));
 assert.deepEqual(JSON.parse(storage.getItem(key)),['first','second']);
});
test('a pending operation with a changed view, an unavailable lock or an expired wait never writes',async()=>{
 const storage=fakeStore(),versions=fakeVersions(),key='muse-risk-review-v1:13118';let resume;const held={request:(_name,_options,cb)=>new Promise((resolve,reject)=>{resume=()=>Promise.resolve().then(cb).then(resolve,reject)})};
 let current=true;const pending=updateLocalHistory({storage,locks:held,versions,key,stillCurrent:()=>current,update:()=>'{"x":1}'});current=false;resume();await assert.rejects(pending);assert.equal(storage.getItem(key),null);
 await assert.rejects(updateLocalHistory({storage,locks:null,versions,key,update:()=>'unsafe'}));assert.equal(storage.getItem(key),null);
 let late;const ignoresAbort={request:(_name,_options,cb)=>new Promise((resolve,reject)=>{late=()=>Promise.resolve().then(cb).then(resolve,reject)})};const timeout=updateLocalHistory({storage,locks:ignoresAbort,versions,key,waitMs:5,update:()=>'unsafe'});await new Promise(r=>setTimeout(r,20));late();await assert.rejects(timeout);assert.equal(storage.getItem(key),null);
});
test('deletion refuses to remove records added since confirmation',async()=>{
 const storage=fakeStore(),locks=fakeLocks(),versions=fakeVersions(),key='muse-river-log-v2:iwabuchi-upper';storage.setItem(key,'old');const expected=storage.getItem(key);storage.setItem(key,'old and new');
 await assert.rejects(updateLocalHistory({storage,locks,versions,key,expected,update:()=>null}));assert.equal(storage.getItem(key),'old and new');
 await updateLocalHistory({storage,locks,versions,key,expected:'old and new',update:()=>null});assert.equal(storage.getItem(key),null);
});
test('storage failures are reported and do not prevent a later attempt',async()=>{
 const base=fakeStore(),locks=fakeLocks(),versions=fakeVersions(),key='muse-risk-review-v1:13118';let deny=true;
 const storage={...base,setItem:(k,v)=>{if(deny)throw new Error('quota');base.setItem(k,v)}};
 await assert.rejects(updateLocalHistory({storage,locks,versions,key,update:()=>'first'}),/quota/);assert.equal(base.getItem(key),null);
 deny=false;await updateLocalHistory({storage,locks,versions,key,update:()=>'second'});assert.equal(base.getItem(key),'second');
});
test('facility records with Japanese names and addresses retain both concurrent reports',async()=>{
 const storage=fakeStore(),locks=fakeLocks(),versions=fakeVersions(),identity={area:'13118',name:'原中学校',address:'東京都荒川区町屋5-12-6'},key=pilotFacilityKey(identity.area,identity.name,identity.address)+':report-v2';
 const base={...identity,status:'available',confirmedAt:'2026-11-03T10:00:00.000Z',expiresAt:'2026-11-03T12:00:00.000Z',organization:'訓練',source:'電話',supply:null,quantity:null,landing:'unknown',condition:''};
 const reports=['available','unavailable'].map(status=>createFacilityReport({...base,status},Date.parse('2026-11-03T11:00:00Z')));
 await Promise.all(reports.map((report,index)=>updateLocalHistory({storage,locks,versions,key,update:raw=>appendFacilityReport(raw,{id:index?'two':'one',...report},identity)})));
 assert.deepEqual(decodeFacilityReports(storage.getItem(key),identity).reports.map(x=>x.id),['two','one']);
 await assert.rejects(updateLocalHistory({storage,locks,versions,key:'muse-pilot-facility-v1:malformed:report-v2',update:()=>null}));
});
test('a stale local view waits for the committed version and never overwrites a mismatch',async()=>{
 const storage=fakeStore(),locks=fakeLocks(),versions=fakeVersions(),key='muse-risk-review-v1:13118';
 storage.setItem(key,'old');await versions.write(key,'newer');
 const pending=updateLocalHistory({storage,locks,versions,key,waitMs:500,update:raw=>raw+'+added'});
 setTimeout(()=>storage.setItem(key,'newer'),30);await pending;assert.equal(storage.getItem(key),'newer+added');
 storage.setItem(key,'unknown-external-change');await assert.rejects(updateLocalHistory({storage,locks,versions,key,waitMs:40,update:()=> 'overwrite'}));assert.equal(storage.getItem(key),'unknown-external-change');
});
test('a failed consistency commit leaves the local value intact and rejects later overwrites',async()=>{
 const storage=fakeStore(),locks=fakeLocks(),base=fakeVersions(),key='muse-risk-review-v1:13118';let writes=0;
 const versions={read:base.read,close(){},async write(k,v){if(++writes===2)throw new Error('database failed');return base.write(k,v)}};
 await assert.rejects(updateLocalHistory({storage,locks,versions,key,update:()=> 'saved-locally'}),/復旧/);assert.equal(storage.getItem(key),'saved-locally');
 await assert.rejects(updateLocalHistory({storage,locks,versions,key,waitMs:40,update:()=> 'overwrite'}),/一致しない/);assert.equal(storage.getItem(key),'saved-locally');
});
