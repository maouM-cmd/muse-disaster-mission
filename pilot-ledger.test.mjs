import test from 'node:test';import assert from 'node:assert/strict';
import {buildPilotEvidenceLedger,createPilotEvidenceSnapshot,createFloodFieldReport,createFacilityReport,createFacilityReceipt} from './readiness.mjs';
import * as readiness from './readiness.mjs';
import {riverPilotStations,createRiverLogEntry} from './geo-data.mjs';
import {createInfrastructureReport,appendInfrastructureReport} from './infrastructure-reports.mjs';

test('field report category differences appear in the evidence ledger without asserting identical locations',()=>{
 const input={...identity,status:'water_seen',scope:'nearby_road',observedAt:'2026-11-03T11:30:00.000Z',expiresAt:'2026-11-03T12:30:00.000Z',organization:'訓練',source:'訓練',note:''};
 const first=createFloodFieldReport({...input,id:'field-a'},now),second=createFloodFieldReport({...input,id:'field-b',status:'no_water_seen',observedAt:'2026-11-03T11:40:00.000Z'},now);
 const raw=JSON.stringify([first,second]);
 const make=time=>buildPilotEvidenceLedger({identity,areaReady:true,fieldRaw:raw,now:time}).find(row=>row.id==='reports:field');
 assert.deepEqual(make(now).differingScopes,['nearby_road']);assert.deepEqual(make(Date.parse(input.expiresAt)).differingScopes,[]);
 const invalid=buildPilotEvidenceLedger({identity,areaReady:true,fieldRaw:'{bad',now}).find(row=>row.id==='reports:field');assert.equal(invalid.differingScopes,null);
});
const now=Date.parse('2026-11-03T12:00:00Z');
const identity={area:'13118',name:'学校',address:'東京都荒川区架空99'};
test('the pilot ledger records which official feed was read and flags a delayed recent feed',()=>{
 const base={state:'available',updatedAt:'2026-11-03T11:59:00.000Z',retrievedAt:'2026-11-03T11:59:00.000Z',count:0,skipped:0};
 const row=feed=>buildPilotEvidenceLedger({identity,areaReady:true,now,floodFeed:feed}).find(item=>item.id==='jma:flood-feed');
 assert.equal(row({...base,feedType:'recent'}).feedType,'recent');assert.equal(row({...base,feedType:'recent'}).state,'available');
 assert.equal(row({...base,feedType:'recent',updatedAt:'2026-11-03T11:54:00.000Z'}).state,'stale');
 assert.equal(row({...base,feedType:'long',updatedAt:'2026-11-03T11:54:00.000Z'}).state,'available');
 assert.equal(row({...base,feedType:'other'}).state,'unknown');
 assert.equal(row({state:'unknown'}).feedType,null);assert.equal(row({state:'loading'}).state,'loading');assert.equal(row({state:'error'}).state,'error');
 assert.equal(row(base).feedType,'long');
 assert.equal(createPilotEvidenceSnapshot({identity,areaReady:true,now,floodFeed:{...base,feedType:'recent'}}).items.find(x=>x.id==='jma:flood-feed').feedType,'recent');
});
test('a saved scenario snapshot can be inspected without becoming current data',()=>{
 assert.equal(typeof readiness.decodeScenarioSnapshot,'function');
 const facilityPosition={...identity,latitude:35.73,longitude:139.78},gsiScenario={identity,latitude:35.73,longitude:139.78,retrievedAt:'2026-11-03T11:59:00.000Z',rows:[{river:'架空川',riverCode:'123',subRiverCode:'_',officeCode:'456',depth:2.5,scale:0}]};
 const record=createPilotEvidenceSnapshot({identity,areaReady:true,facilityPosition,gsiScenario,now});
 const result=readiness.decodeScenarioSnapshot(JSON.stringify(record));
 assert.equal(result.facility,'学校');assert.equal(result.area,'13118');assert.equal(result.values[0].depth,2.5);assert.equal(result.trust,'unverified_file');
 for(const mutated of [{...record,version:2},{...record,kind:'wrong'},{...record,items:[...record.items,record.items.find(i=>i.id==='gsi:facility-scenario')]},{...record,createdAt:'bad'},{...record,scope:{...record.scope,facility:'別施設'}}])assert.throws(()=>readiness.decodeScenarioSnapshot(JSON.stringify(mutated)));
 const broken=structuredClone(record);broken.items.find(i=>i.id==='gsi:facility-scenario').values[0].depth=-1;assert.throws(()=>readiness.decodeScenarioSnapshot(JSON.stringify(broken)));
 assert.throws(()=>readiness.decodeScenarioSnapshot('{broken'));assert.throws(()=>readiness.decodeScenarioSnapshot(' '.repeat(1024*1024+1)));
 const absent=createPilotEvidenceSnapshot({identity,areaReady:true,now});assert.equal(readiness.decodeScenarioSnapshot(JSON.stringify(absent)).state,'unknown');
});
test('the saved evidence snapshot includes only the matching facility point and keeps scenario provenance',()=>{
 const facilityPosition={...identity,latitude:35.73,longitude:139.78};
 const result={identity,latitude:35.73,longitude:139.78,retrievedAt:'2026-11-03T11:59:00.000Z',rows:[{river:'架空川',riverCode:'123',subRiverCode:'_',officeCode:'456',depth:2.5,scale:0}]};
 const args={identity,areaReady:true,facilityPosition,gsiScenario:result,now};
 const row=createPilotEvidenceSnapshot(args).items.find(x=>x.id==='gsi:facility-scenario');
 assert.equal(row.state,'available');assert.equal(row.retrievedAt,result.retrievedAt);assert.equal(row.updatedAt,null);assert.equal(row.values[0].depth,2.5);assert.equal(row.currentConditions,'not-established');assert.doesNotMatch(JSON.stringify(row),/東京都荒川区架空99|35\.73|139\.78/);
 for(const overrides of [{areaReady:false},{identity:{...identity,name:'別施設'}},{facilityPosition:{...facilityPosition,latitude:35.74}},{gsiScenario:{...result,retrievedAt:'bad'}},{gsiScenario:{...result,rows:[{...result.rows[0],depth:-1}]}}]){
  const other=buildPilotEvidenceLedger({...args,...overrides}).find(x=>x.id==='gsi:facility-scenario');assert.ok(!other||other.state==='unknown');assert.ok(!other?.values);
 }
 const empty=buildPilotEvidenceLedger({...args,gsiScenario:{...result,rows:[]}}).find(x=>x.id==='gsi:facility-scenario');assert.equal(empty.state,'empty');assert.equal(empty.currentConditions,'not-established');
});
test('unverified infrastructure reports are included only for the selected ready area',()=>{
 const report=createInfrastructureReport({id:'test-1',area:'13118',location:'架空の道路',item:'wire',status:'damaged',source:'架空の確認',observedAt:'2026-11-03T10:00:00.000Z',recordedAt:'2026-11-03T11:00:00.000Z',expiresAt:'2026-11-03T11:30:00.000Z',corrects:null},now),raw=appendInfrastructureReport(null,report,'13118',now);
 const args={identity,areaReady:true,infrastructureRaw:raw,now},rows=buildPilotEvidenceLedger(args),entry=rows.find(row=>row.kind==='manual_infrastructure_report');assert.equal(entry.location,'架空の道路');assert.equal(entry.state,'expired');assert.equal(entry.source,'架空の確認');assert.equal(entry.corrects,null);assert.equal(createPilotEvidenceSnapshot(args).items.find(row=>row.id===entry.id).item,'wire');
 assert.equal(buildPilotEvidenceLedger({...args,areaReady:false}).some(row=>row.kind==='manual_infrastructure_report'),false);assert.equal(buildPilotEvidenceLedger({...args,identity:{...identity,area:'13106'}}).some(row=>row.kind==='manual_infrastructure_report'),false);
 const outside=createInfrastructureReport({...report,id:'other-1',area:'15222'},now),otherRaw=appendInfrastructureReport(null,outside,'15222',now);assert.ok(buildPilotEvidenceLedger({...args,identity:{...identity,area:'15222'},infrastructureRaw:otherRaw}).some(row=>row.kind==='manual_infrastructure_report'));
});
test('a report retains links to all human-stated corrections without choosing a winner',()=>{
 const base={area:'13118',location:'架空の道路',item:'wire',source:'架空の確認',observedAt:'2026-11-03T10:00:00.000Z',recordedAt:'2026-11-03T11:00:00.000Z',expiresAt:'2026-11-03T13:00:00.000Z'},original=createInfrastructureReport({...base,id:'one',status:'damaged',corrects:null},now),a=createInfrastructureReport({...base,id:'two',status:'uncertain',corrects:'one'},now),b=createInfrastructureReport({...base,id:'three',status:'present',corrects:'one'},now);
 let raw=null;for(const report of [original,a,b])raw=appendInfrastructureReport(raw,report,'13118',now);
 const items=buildPilotEvidenceLedger({identity,areaReady:true,infrastructureRaw:raw,now}),first=items.find(row=>row.id==='infrastructure:manual:one');
 assert.deepEqual(first.correctedBy,['infrastructure:manual:three','infrastructure:manual:two']);assert.equal(first.state,'reported');assert.equal(items.find(row=>row.id==='infrastructure:manual:two').corrects,first.id);assert.equal(items.find(row=>row.id==='infrastructure:manual:three').corrects,first.id);
 assert.deepEqual(items.find(row=>row.id==='infrastructure:manual:two').changes,[{field:'status',before:'damaged',after:'uncertain'}]);assert.deepEqual(first.changes,[]);
});
test('bulletin water provenance only links a known station and matching selected facility',()=>{
 const position={name:identity.name,address:identity.address,latitude:35.73,longitude:139.78};
 const level={station:'岩淵水門（上）',code:'83030400010000006',stationCodeType:'水位観測所',location:'北区',time:'2025-08-07T06:30:00+09:00',label:'現況',value:'4.22',unit:'m',condition:''};
 const bulletin={index:0,url:'https://www.data.jma.go.jp/developer/xml/data/20250806214000_0_VXKO50_000000.xml',issuedAt:'2025-08-07T06:40:00+09:00',retrievedAt:'2026-11-03T11:50:00.000Z',bulletinType:'発表',controlStatus:'通常',water:{rows:[level],truncated:false}};
 const get=(extra={})=>buildPilotEvidenceLedger({identity,areaReady:true,facilityPosition:position,floodBulletins:[bulletin],now,...extra}).find(r=>r.kind==='public_flood_bulletin').water.stationContexts[0];
 const match=get();assert.equal(match.state,'matched');assert.equal(match.stationId,'iwabuchi-upper');assert.equal(match.targetFacility,'学校');assert.ok(match.distanceMeters>0);assert.match(match.sourceUrl,/www1\.river\.go\.jp/);assert.ok(Number.isFinite(match.latitude)&&Number.isFinite(match.longitude));
 assert.equal(get({facilityPosition:{...position,name:'別施設'}}).distanceMeters,null);assert.equal(get({facilityPosition:{...position,latitude:999}}).distanceMeters,null);
 assert.equal(get({areaReady:false}).state,'unknown');assert.equal(get({identity:{...identity,area:'13106'}}).state,'unknown');
 const wrong={...bulletin,water:{rows:[{...level,code:'83030400010000007'}],truncated:false}};assert.equal(get({floodBulletins:[wrong]}).state,'unknown');
 const snapshot=createPilotEvidenceSnapshot({identity,areaReady:true,facilityPosition:position,floodBulletins:[bulletin],now});assert.doesNotMatch(JSON.stringify(snapshot),/東京都荒川区架空99/);assert.ok(!JSON.stringify(snapshot).includes('35.73'));
});
test('flood bulletin water records retain original categories, times, values and missing data without asserting present conditions',()=>{
 const base={index:1,url:'https://www.data.jma.go.jp/developer/xml/data/20250806214000_0_VXKO50_000000.xml',issuedAt:'2025-08-07T06:40:00+09:00',retrievedAt:'2026-11-03T11:50:00.000Z',bulletinType:'発表',controlStatus:'通常',event:'840410000100',serial:'1',office:'気象台'};
 const row={station:'津沢',code:'84041000010000010',stationCodeType:'水位観測所',location:'小矢部市',time:'2025-08-07T06:30:00+09:00',label:'現況',value:'4.22',unit:'m',condition:''};
 const missing={...row,time:'2025-08-07T07:30:00+09:00',label:'１時間後',value:'',condition:'欠測'};
 const get=item=>buildPilotEvidenceLedger({identity,areaReady:true,floodBulletins:[item],now}).find(r=>r.kind==='public_flood_bulletin');
 const result=get({...base,water:{rows:[row,missing],truncated:false}});assert.equal(result.waterStatus,'included');assert.deepEqual(result.water.rows,[row,missing]);assert.equal(result.water.truncated,false);assert.equal(result.latestStatus,'not-established');
 for(const bad of [{...base,bulletinType:'取消'},{...base,bulletinType:'unknown'},{...base,controlStatus:'訓練'}]){const result=get({...bad,water:{rows:[row],truncated:false}});assert.equal(result.waterStatus,'suppressed');assert.equal(result.water,undefined)}
 for(const bad of [{rows:[{...row,value:'x'.repeat(101)}],truncated:false},{rows:Array(101).fill(row),truncated:false},{rows:[row],truncated:'no'}]){const result=get({...base,water:bad});assert.equal(result.waterStatus,'unknown');assert.equal(result.water,undefined)}
});
test('opened flood bulletins retain their own official source, type, issue and retrieval time',()=>{
 const url='https://www.data.jma.go.jp/developer/xml/data/20251118064500_0_VXKO50_000000.xml';
 const item={index:0,url,issuedAt:'2026-11-03T11:30:00+00:00',retrievedAt:'2026-11-03T11:50:00.000Z',bulletinType:'取消',controlStatus:'訓練',event:'830303000103',serial:'1',office:'気象台'};
 const rows=buildPilotEvidenceLedger({identity,areaReady:true,floodBulletins:[item],now});const row=rows.find(r=>r.kind==='public_flood_bulletin');
 assert.equal(row.sourceUrl,url);assert.equal(row.bulletinType,'取消');assert.equal(row.controlStatus,'訓練');assert.equal(row.issuedAt,item.issuedAt);assert.equal(row.retrievedAt,item.retrievedAt);assert.equal(row.event,item.event);assert.equal(row.latestStatus,'not-established');assert.equal(row.locationMatch,'not-assessed');
 const invalid=[{...item,url:'https://evil.example/20251118064500_0_VXKO50_000000.xml'},{...item,url:url+'?x=1'},{...item,index:-1},{...item,retrievedAt:'bad'}];
 for(const value of invalid)assert.equal(buildPilotEvidenceLedger({identity,areaReady:true,floodBulletins:[value],now}).some(r=>r.kind==='public_flood_bulletin'),false);
 const old=buildPilotEvidenceLedger({identity,areaReady:true,floodBulletins:[item],now:now+7200000}).find(r=>r.kind==='public_flood_bulletin');assert.equal(old.state,'stale');
 const future=buildPilotEvidenceLedger({identity,areaReady:true,floodBulletins:[{...item,issuedAt:'2026-11-03T12:10:00Z'}],now}).find(r=>r.kind==='public_flood_bulletin');assert.equal(future.state,'time_unknown');
 const impossible=buildPilotEvidenceLedger({identity,areaReady:true,floodBulletins:[{...item,issuedAt:'2026-02-30T10:00:00+09:00'}],now}).find(r=>r.kind==='public_flood_bulletin');assert.equal(impossible.state,'time_unknown');assert.equal(impossible.issuedAt,null);
});
test('national flood feed evidence preserves retrieval and update times, without claiming local applicability',()=>{
 const feed={state:'available',updatedAt:'2026-11-03T11:45:00.000Z',retrievedAt:'2026-11-03T11:50:00.000Z',count:2,skipped:1};
 const get=(floodFeed=feed,time=now)=>buildPilotEvidenceLedger({identity,areaReady:true,floodFeed,now:time}).find(row=>row.id==='jma:flood-feed');
 const row=get();assert.equal(row.scope,'national');assert.equal(row.kind,'public_flood_feed');assert.equal(row.state,'partial');assert.equal(row.updatedAt,feed.updatedAt);assert.equal(row.retrievedAt,feed.retrievedAt);assert.equal(row.count,2);assert.equal(row.skipped,1);assert.equal(row.locationMatch,'not-assessed');assert.equal(row.zeroDoesNotProveNoForecast,true);assert.equal(row.latestStatus,'not-established');
 assert.equal(get({...feed,count:0,skipped:0}).state,'available');assert.equal(get({...feed,skipped:0},now+7200000).state,'stale');
 for(const state of ['loading','error','unknown']){const item=get({state,...feed,state});assert.equal(item.state,state);assert.equal(item.count,undefined);assert.equal(item.updatedAt,null)}
 for(const bad of [{...feed,count:-1},{...feed,skipped:0.5},{...feed,updatedAt:'bad'},{...feed,updatedAt:'2026-02-30T10:00:00+09:00'},{...feed,retrievedAt:'2026-11-03T12:06:00.000Z'},{...feed,updatedAt:'2026-11-03T12:05:30.000Z'}]){const item=get(bad);assert.equal(item.state,'unknown');assert.equal(item.count,undefined)}
 const snapshot=createPilotEvidenceSnapshot({identity,areaReady:false,floodFeed:feed,now});assert.equal(snapshot.items.find(item=>item.id==='jma:flood-feed').scope,'national');assert.equal(snapshot.currentConditions,'not-established');
});
test('receipt evidence and follow-up are unverified human reports, with free text notes excluded',()=>{
 const receipt={id:'r1',...createFacilityReceipt({...identity,reportedAt:'2026-11-03T10:00:00.000Z',source:'訓練確認先',supply:'water',expected:12,received:5,status:'partial',note:'非公開メモ'},now),followups:[{kind:'redelivery',state:'planned',at:'2026-11-03T11:00:00.000Z',note:'非公開対応'}]};
 const snapshot=createPilotEvidenceSnapshot({identity,areaReady:true,receiptRaw:JSON.stringify([receipt]),now});
 const group=snapshot.items.find(row=>row.id==='reports:receipt'),row=snapshot.items.find(row=>row.id==='receipt:r1');
 assert.equal(group.count,1);assert.equal(row.kind,'human_receipt');assert.equal(row.state,'reported');assert.equal(row.receiptStatus,'partial');assert.equal(row.expected,12);assert.equal(row.received,5);assert.equal(row.declaredSource,'訓練確認先');
 assert.deepEqual(row.followups,[{kind:'redelivery',state:'planned',at:'2026-11-03T11:00:00.000Z'}]);assert.equal(snapshot.currentConditions,'not-established');assert.doesNotMatch(JSON.stringify(snapshot),/非公開|東京都荒川区架空99/);
});
test('receipt evidence does not leak across facilities or during loading and exposes corrupt storage',()=>{
 const receipt={id:'r2',...createFacilityReceipt({...identity,reportedAt:'2026-11-03T10:00:00.000Z',source:'訓練',supply:'food',expected:3,received:null,status:'unconfirmed',note:''},now)};
 for(const extra of [{areaReady:false},{identity:{...identity,name:'別の施設'},areaReady:true},{areaReady:true,receiptRaw:'{bad'}]){
  const rows=buildPilotEvidenceLedger({identity,receiptRaw:JSON.stringify([receipt]),now,...extra});assert.equal(rows.some(row=>row.kind==='human_receipt'),false);assert.notEqual(rows.find(row=>row.id==='reports:receipt').state,'ok');
 }
});
test('ledger separates scenario, observations and human reports without inventing times',()=>{
 const field=createFloodFieldReport({...identity,id:'field-1',status:'water_seen',scope:'facility_point',observedAt:'2026-11-03T11:00:00Z',expiresAt:'2026-11-03T13:00:00Z',organization:'訓練',source:'報告',note:''},now);
 const facility={id:'facility-1',...createFacilityReport({...identity,status:'available',confirmedAt:'2026-11-03T11:00:00Z',expiresAt:'2026-11-03T13:00:00Z',organization:'訓練',source:'確認',supply:null,quantity:null,landing:'unknown',condition:''},now)};
 const rows=buildPilotEvidenceLedger({identity,areaReady:true,evidence:{buildings:'available',shelters:'available',weather:'stale'},forecast:{shelter:identity.name,address:identity.address,state:'ready',depth:'0.5m未満',checkedAt:'2026-11-03T11:59:00.000Z'},facilityRaw:JSON.stringify([facility]),fieldRaw:JSON.stringify([field]),observationText:'観測の詳細',fetchStartedAt:'2026-11-03T11:50:00.000Z',now});
 const building=rows.find(r=>r.id==='map:buildings'),flood=rows.find(r=>r.id==='scenario:facility'),human=rows.find(r=>r.id==='field:field-1'),report=rows.find(r=>r.id==='facility:facility-1');
 assert.equal(rows.find(r=>r.id==='map:observation').scope,'observation_reference');assert.equal(rows.find(r=>r.id==='map:warning').state,'stale');assert.equal(building.updatedAt,null);assert.equal(building.fetchStartedAt,'2026-11-03T11:50:00.000Z');assert.equal(flood.kind,'scenario');assert.equal(flood.updatedAt,null);assert.equal(human.kind,'human_report');assert.equal(human.observedAt,field.observedAt);assert.equal(report.expiresAt,facility.expiresAt);
});
test('a loading area, mismatched facility and unreadable storage never reuse old evidence',()=>{
 const rows=buildPilotEvidenceLedger({identity,areaReady:false,evidence:{buildings:'available'},forecast:{shelter:'別施設',address:'',state:'ready',depth:'0.5m未満'},facilityRaw:'{bad',fieldRaw:'{bad',now});
 assert.notEqual(rows.find(r=>r.id==='map:buildings').state,'available');assert.notEqual(rows.find(r=>r.id==='scenario:facility').state,'available');assert.equal(rows.find(r=>r.id==='reports:facility').state,'unavailable');
 const ready=buildPilotEvidenceLedger({identity,areaReady:true,facilityRaw:'{bad',fieldRaw:'{bad',now});assert.equal(ready.find(r=>r.id==='reports:facility').state,'corrupt');assert.equal(ready.find(r=>r.id==='reports:field').state,'corrupt');
});
test('river ledger distinguishes hand-entered notes, source and review times from current observations',()=>{
 const station=riverPilotStations('13118')[0];
 const entry=createRiverLogEntry({stationId:station.id,reference:station.levelUrl,value:1.25,at:'2026-11-03T10:00:00.000Z',recordedAt:'2026-11-03T11:00:00.000Z',reviewBy:'2026-11-03T11:30:00.000Z'},station);
 const rows=buildPilotEvidenceLedger({identity,areaReady:true,riverStationId:station.id,riverRaw:JSON.stringify([entry]),now});
 const group=rows.find(r=>r.id==='river:manual'),record=rows.find(r=>r.kind==='manual_river_note');
 assert.equal(group.kind,'manual_river_group');assert.equal(group.count,1);assert.equal(group.scope,`${station.river}・${station.name}`);
 assert.equal(record.kind,'manual_river_note');assert.equal(record.state,'review_due');assert.equal(record.value,1.25);assert.equal(record.observedAt,entry.at);assert.equal(record.recordedAt,entry.recordedAt);assert.equal(record.reviewBy,entry.reviewBy);assert.equal(record.sourceUrl,station.levelUrl);
});
test('same station and instant links bulletin water to the manual note without assessing a discrepancy',()=>{
 const station=riverPilotStations('13118')[0],at='2026-11-03T10:00:00.000Z',entry=createRiverLogEntry({stationId:station.id,reference:station.levelUrl,value:1.25,at,recordedAt:'2026-11-03T11:00:00.000Z',reviewBy:null,datum:'AP'},station);
 const water={station:station.name,code:station.jmaCode,stationCodeType:'水位観測所',location:'北区',time:'2026-11-03T19:00:00+09:00',label:'現況',value:'2.50',unit:'m',condition:'正常'};
 const bulletin={index:0,url:'https://www.data.jma.go.jp/developer/xml/data/20261103101000_0_VXKO50_000000.xml',issuedAt:'2026-11-03T10:10:00Z',retrievedAt:'2026-11-03T11:50:00.000Z',bulletinType:'発表',controlStatus:'通常',water:{rows:[water],truncated:false}};
 const get=overrides=>buildPilotEvidenceLedger({identity,areaReady:true,riverStationId:station.id,riverRaw:JSON.stringify([entry]),floodBulletins:[bulletin],now,...overrides}).find(x=>x.kind==='manual_river_note');
 const row=get({});assert.equal(row.relatedLevels.length,1);assert.equal(row.relatedLevels[0].value,'2.50');assert.equal(row.relatedLevels[0].datum,'unknown');assert.equal(row.relatedLevels[0].sourceUrl,bulletin.url);assert.equal(row.conflict,false);assert.equal(row.relatedLevelsTruncated,false);
 for(const bad of [{...water,label:'１時間後'},{...water,time:'2026-11-03T19:01:00+09:00'},{...water,code:'83030400010000007'},{...water,stationCodeType:'不明'}])assert.equal(get({floodBulletins:[{...bulletin,water:{rows:[bad],truncated:false}}]}).relatedLevels.length,0);
 assert.equal(get({floodBulletins:[{...bulletin,bulletinType:'取消'}]}).relatedLevels.length,0);
 assert.equal(get({floodBulletins:[{...bulletin,controlStatus:'訓練'}]}).relatedLevels.length,0);
 assert.equal(get({floodBulletins:[{...bulletin,water:{rows:[{...water,station:'別の観測所'}],truncated:false}}]}).relatedLevels.length,0);
 const many=get({floodBulletins:[{...bulletin,water:{rows:Array(22).fill(water),truncated:true}}]});assert.equal(many.relatedLevels.length,20);assert.equal(many.relatedLevelsTruncated,true);assert.equal(many.relatedLevels[0].sourceTruncated,true);
});
test('river evidence export includes self-reported datum and keeps older unknown notes distinct',()=>{
 const station=riverPilotStations('13118')[0],base={stationId:station.id,reference:station.levelUrl,value:1.25,at:'2026-11-03T10:00:00.000Z',recordedAt:'2026-11-03T11:00:00.000Z',reviewBy:null},old=createRiverLogEntry(base,station),current=createRiverLogEntry({...base,datum:'AP'},station);
 const rows=buildPilotEvidenceLedger({identity,areaReady:true,riverStationId:station.id,riverRaw:JSON.stringify([old,current]),now}).filter(x=>x.kind==='manual_river_note');assert.equal(rows.length,2);assert.equal(rows[0].datum,'unknown');assert.equal(rows[1].datum,'AP');assert.notEqual(rows[0].id,rows[1].id);
});
test('legacy and explicitly unknown notes from different records remain distinct without a false conflict',()=>{
 const station=riverPilotStations('13118')[0],base={stationId:station.id,reference:station.levelUrl,value:1.25,at:'2026-11-03T10:00:00.000Z',recordedAt:'2026-11-03T11:00:00.000Z',reviewBy:null},old=createRiverLogEntry(base,station),other=createRiverLogEntry({...base,recordedAt:'2026-11-03T11:01:00.000Z',datum:'unknown'},station);
 const rows=buildPilotEvidenceLedger({identity,areaReady:true,riverStationId:station.id,riverRaw:JSON.stringify([old,other]),now}).filter(x=>x.kind==='manual_river_note');assert.equal(rows.length,2);assert.equal(new Set(rows.map(x=>x.id)).size,2);assert.ok(rows.every(x=>x.datum==='unknown'&&!x.conflict));
});
test('distinct entries recovered from different screens do not share a display ID',()=>{
 const station=riverPilotStations('13118')[0],base={stationId:station.id,reference:station.levelUrl,value:1.25,at:'2026-11-03T10:00:00.000Z',recordedAt:'2026-11-03T11:00:00.000Z',reviewBy:null,datum:'AP'},a=createRiverLogEntry(base,station),b=createRiverLogEntry({...base,recordedAt:'2026-11-03T11:01:00.000Z'},station);
 const rows=buildPilotEvidenceLedger({identity,areaReady:true,riverStationId:station.id,riverRaw:JSON.stringify([a,b]),now}).filter(x=>x.kind==='manual_river_note');assert.equal(new Set(rows.map(x=>x.id)).size,2);assert.ok(rows.every(x=>!x.conflict));
});
test('a river note keeps its display identity when another note is inserted ahead of it',()=>{
 const station=riverPilotStations('13118')[0],make=(value,at)=>createRiverLogEntry({stationId:station.id,reference:station.levelUrl,value,at,recordedAt:'2026-11-03T11:00:00.000Z',reviewBy:null},station);
 const old=make(1,'2026-11-03T09:00:00.000Z'),newer=make(2,'2026-11-03T10:00:00.000Z');
 const get=records=>buildPilotEvidenceLedger({identity,areaReady:true,riverStationId:station.id,riverRaw:JSON.stringify(records),now}).find(r=>r.kind==='manual_river_note'&&r.value===1).id;
 assert.equal(get([old]),get([newer,old]));
});
test('river ledger does not reuse another area or invalid stored notes',()=>{
 const station=riverPilotStations('13118')[0];
 for(const args of [{areaReady:false,riverRaw:'[]'},{identity:{...identity,area:'13101'},areaReady:true,riverRaw:'[]'},{areaReady:true,riverRaw:'{bad'}]){
  const rows=buildPilotEvidenceLedger({identity,riverStationId:station.id,...args,now});
  assert.notEqual(rows.find(r=>r.id==='river:manual').state,'ok');assert.equal(rows.some(r=>r.kind==='manual_river_note'),false);
 }
});

test('nearby weather observation retains values and distinct observation and retrieval times only while usable',()=>{
 const observation={area:'13118',stationId:'44132',station:'訓練観測所',referenceLabel:'建物モデル範囲の中心',distance:1234,latitude:35.7,longitude:139.8,observedAt:'2026-11-03T11:50:00.000Z',retrievedAt:'2026-11-03T11:52:00.000Z',rain:0,wind:3.2};
 const get=(extra={})=>buildPilotEvidenceLedger({identity,areaReady:true,observation,now,...extra}).find(row=>row.id==='map:observation');
 const row=get();assert.equal(row.state,'observed');assert.equal(row.station,'訓練観測所');assert.equal(row.stationId,'44132');assert.equal(row.observedAt,observation.observedAt);assert.equal(row.retrievedAt,observation.retrievedAt);assert.equal(row.rain,0);assert.equal(row.wind,3.2);
 for(const args of [{now:Date.parse('2026-11-03T12:21:00Z')},{areaReady:false},{identity:{...identity,area:'13101'}},{observation:{...observation,wind:-1}},{observation:{...observation,retrievedAt:'not-time'}}]){
  const bad=get(args);assert.notEqual(bad.state,'observed');assert.equal(bad.rain,undefined);assert.equal(bad.wind,undefined);
 }
 for(const changed of [{retrievedAt:'2026-11-03T11:49:00.000Z'},{retrievedAt:'2026-11-03T12:01:00.000Z'},{observedAt:'2026-11-03T12:01:00.000Z',retrievedAt:'2026-11-03T12:01:00.000Z'}]){
  assert.equal(get({observation:{...observation,...changed}}).state,'unknown');
 }
});

test('rainfall periods are saved separately, never sent to Muse implicitly and invalid additions remain unknown',()=>{
 const observation={area:'13118',stationId:'44132',station:'訓練観測所',referenceLabel:'中心',distance:1000,latitude:35.7,longitude:139.8,observedAt:'2026-11-03T11:50:00.000Z',retrievedAt:'2026-11-03T11:52:00.000Z',rain:0,wind:3.2,rain1h:2.5,rain24h:7};
 const make=o=>buildPilotEvidenceLedger({identity,areaReady:true,observation:o,now}).find(row=>row.id==='map:observation');
 const row=make(observation);assert.equal(row.rain1h,2.5);assert.equal(row.rain24h,7);
 const sent=readiness.mapObservationContext(observation,'13118',now);assert.equal(Object.hasOwn(sent,'rain1h'),false);assert.equal(Object.hasOwn(sent,'rain24h'),false);
 const bad=make({...observation,rain1h:-1,rain24h:'unknown'});assert.equal(bad.rain1h,null);assert.equal(bad.rain24h,null);
 const missing=make({...observation,rain1h:undefined,rain24h:undefined});assert.equal(missing.rain1h,null);assert.equal(missing.rain24h,null);
});
test('the evidence ledger retains an observation when only accumulated rainfall is known',()=>{
 const observation={area:'13118',stationId:'44132',station:'訓練観測所',referenceLabel:'中心',distance:1000,latitude:35.7,longitude:139.8,observedAt:'2026-11-03T11:50:00.000Z',retrievedAt:'2026-11-03T11:52:00.000Z',rain:null,wind:null,rain1h:0,rain24h:7};
 const row=buildPilotEvidenceLedger({identity,areaReady:true,observation,now}).find(item=>item.id==='map:observation');
 assert.equal(row.state,'observed');assert.equal(row.rain,null);assert.equal(row.wind,null);assert.equal(row.rain1h,0);assert.equal(row.rain24h,7);
});

test('evidence snapshot fixes a timestamp and preserves uncertainty without exporting the facility address',()=>{
 const privateIdentity={...identity,address:'東京都荒川区架空99'};
 const snapshot=createPilotEvidenceSnapshot({identity:privateIdentity,areaReady:true,evidence:{buildings:'available'},forecast:{shelter:privateIdentity.name,address:privateIdentity.address,state:'ready',depth:'0.5m未満',checkedAt:'2026-11-03T11:59:00.000Z'},now});
 assert.equal(snapshot.kind,'pilot-evidence-snapshot');assert.equal(snapshot.createdAt,'2026-11-03T12:00:00.000Z');assert.equal(snapshot.scope.area,'13118');assert.equal(snapshot.scope.facility,'学校');
 assert.equal(snapshot.items.find(item=>item.id==='scenario:facility').kind,'scenario');assert.equal(snapshot.items.find(item=>item.id==='scenario:facility').updatedAt,null);
 assert.equal(snapshot.items.find(item=>item.id==='map:observation').state,'unknown');assert.equal(JSON.stringify(snapshot).includes(privateIdentity.address),false);
 assert.equal(snapshot.referenceIds,'display-only');assert.equal(snapshot.currentConditions,'not-established');
 assert.match(snapshot.notice,/保存時点/);assert.match(snapshot.notice,/報告の正確さ/);
 assert.match(snapshot.noticeEn,/not established/);
});
test('snapshot made during region loading does not retain a previously selected facility',()=>{
 const snapshot=createPilotEvidenceSnapshot({identity,areaReady:false,evidence:{buildings:'available'},now});
 assert.equal(snapshot.scope.area,null);assert.equal(snapshot.scope.facility,null);assert.notEqual(snapshot.items.find(x=>x.id==='map:buildings').state,'available');
 assert.throws(()=>createPilotEvidenceSnapshot({identity,areaReady:true,now:NaN}));
});
