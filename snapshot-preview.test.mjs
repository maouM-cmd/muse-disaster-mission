import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as readiness from './readiness.mjs';

const identity={area:'13118',name:'原中学校',address:'東京都荒川区架空'};
const now=Date.parse('2026-11-04T06:00:00.000Z');
test('saved overview separates historical public data and human reports without treating them as current',()=>{
 assert.equal(typeof readiness.decodePilotEvidencePreview,'function');const snapshot=readiness.createPilotEvidenceSnapshot({identity,areaReady:true,now,evidence:{weather:'stale'},observationText:'観測所の詳細'});
 snapshot.items.push({id:'field:1',kind:'human_report',scope:'nearby_road',state:'expired',reportedValue:'water_seen',observedAt:'2026-11-04T05:00:00.000Z',expiresAt:'2026-11-04T05:30:00.000Z',declaredSource:'訓練報告'});
 const preview=readiness.decodePilotEvidencePreview(JSON.stringify(snapshot));
 assert.equal(preview.trust,'unverified_file');assert.equal(preview.savedAt,'2026-11-04T06:00:00.000Z');
 assert.equal(preview.area,'13118');assert.equal(preview.facility,'原中学校');
 assert.ok(preview.rows.some(row=>row.kind==='public_warning'&&row.fields.state==='stale'));
 const human=preview.rows.find(row=>row.kind==='human_report');assert.equal(human.fields.reportedValue,'water_seen');assert.equal(human.fields.observedAt,'2026-11-04T05:00:00.000Z');assert.equal(human.fields.declaredSource,'訓練報告');
 assert.equal(preview.currentConditions,'not-established');
});
test('saved overview bounds display, skips unsupported data and preserves unsafe markup only as plain text',()=>{
 assert.equal(typeof readiness.decodePilotEvidencePreview,'function');const snapshot=readiness.createPilotEvidenceSnapshot({identity,areaReady:true,now});
 snapshot.items.push({kind:'human_report',scope:'<img src=x onerror=alert(1)>',reportedValue:'water_seen',observedAt:'2026-02-30T01:00:00Z',note:'secret not exported'});
 snapshot.items.push(...Array.from({length:100},(_,i)=>({kind:'human_report',scope:'report '+i,state:'reported'})));
 snapshot.items.push({kind:'made-up',scope:'ignored'});
 const preview=readiness.decodePilotEvidencePreview(JSON.stringify(snapshot));assert.equal(preview.rows.length,60);assert.ok(preview.omitted>0);
 const row=preview.rows.find(item=>item.fields.scope?.startsWith('<img'));assert.ok(row);assert.equal(row.fields.observedAt,undefined);assert.equal(row.fields.note,undefined);
 assert.throws(()=>readiness.decodePilotEvidencePreview('{broken'),/invalid_snapshot/);
 assert.throws(()=>readiness.decodePilotEvidencePreview(JSON.stringify({...snapshot,createdAt:'2026-02-30T01:00:00Z'})),/invalid_snapshot/);
});
test('suspicious snapshot fields and omitted context are flagged without accepting them as current facts',()=>{
 const snapshot=readiness.createPilotEvidenceSnapshot({identity,areaReady:true,now});
 snapshot.items.push({id:'facility:suspicious',kind:'human_report',scope:'別の施設',state:'available',reportedValue:'available',observedAt:'2026-02-30T01:00:00Z',expiresAt:'2026-11-04T05:00:00.000Z',expected:1000000000,corrects:'facility:old',followups:[{kind:'confirm',state:'planned'}]});
 const preview=readiness.decodePilotEvidencePreview(JSON.stringify(snapshot)),row=preview.rows.find(item=>item.id==='facility:suspicious');
 for(const warning of ['invalid_time','expired_at_save','scope_mismatch','numeric_invalid','details_omitted'])assert.ok(row.warnings.includes(warning),warning);
 assert.equal(preview.incomplete,true);assert.equal(row.fields.observedAt,undefined);assert.equal(preview.currentConditions,'not-established');
 snapshot.items.push({id:'field:bad',kind:'human_report',scope:'違う地点',state:'expired',observedAt:'2026-11-04T05:00:00Z',expiresAt:'2026-11-04T07:00:00Z'});
 const other=readiness.decodePilotEvidencePreview(JSON.stringify(snapshot)).rows.find(item=>item.id==='field:bad');assert.ok(other.warnings.includes('scope_unrecognized'));assert.ok(other.warnings.includes('expiry_mismatch'));
});

test('saved rainfall totals retain their periods and implausible values are flagged',()=>{
 const snapshot=readiness.createPilotEvidenceSnapshot({identity,areaReady:true,now});
 snapshot.items.push({id:'test:observation',kind:'public_observation',state:'observed',rain:0.5,rain1h:2.5,rain24h:7});
 let row=readiness.decodePilotEvidencePreview(JSON.stringify(snapshot)).rows.find(item=>item.id==='test:observation');
 assert.equal(row.fields.rain,0.5);assert.equal(row.fields.rain1h,2.5);assert.equal(row.fields.rain24h,7);assert.equal(row.warnings.length,0);
 snapshot.items.at(-1).rain24h=-3;row=readiness.decodePilotEvidencePreview(JSON.stringify(snapshot)).rows.find(item=>item.id==='test:observation');assert.ok(row.warnings.includes('numeric_invalid'));
});

test('saved field category differences remain historical and reject unsupported categories',()=>{
 const snapshot=readiness.createPilotEvidenceSnapshot({identity,areaReady:true,now}),group=snapshot.items.find(row=>row.id==='reports:field');
 group.differingScopes=['nearby_road'];let row=readiness.decodePilotEvidencePreview(JSON.stringify(snapshot)).rows.find(item=>item.id==='reports:field');
 assert.deepEqual(row.differingScopes,['nearby_road']);assert.equal(row.warnings.length,0);
 group.differingScopes=['nearby_road','nearby_road'];row=readiness.decodePilotEvidencePreview(JSON.stringify(snapshot)).rows.find(item=>item.id==='reports:field');
 assert.equal(row.differingScopes,undefined);assert.ok(row.warnings.includes('field_unreadable'));
 delete group.differingScopes;row=readiness.decodePilotEvidencePreview(JSON.stringify(snapshot)).rows.find(item=>item.id==='reports:field');assert.equal(row.differingScopes,undefined);
});
