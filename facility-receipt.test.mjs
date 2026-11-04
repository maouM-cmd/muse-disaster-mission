import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createFacilityReceipt} from './readiness.mjs';
const now=Date.parse('2026-11-03T12:00:00Z');
const base={area:'13118',name:'原中学校',address:'東京都荒川区',reportedAt:'2026-11-03T11:30:00Z',source:'施設担当組織からの報告',supply:'water',expected:12,received:12,status:'received',note:''};
test('a human receipt report records quantities independently of simulated delivery',()=>{
 const r=createFacilityReceipt(base,now);assert.equal(r.status,'received');assert.equal(r.received,12);assert.equal(r.expected,12);
});
test('invalid, inconsistent, or future receipt reports cannot become completed deliveries',()=>{
 assert.throws(()=>createFacilityReceipt({...base,status:'received',received:3},now));
 assert.throws(()=>createFacilityReceipt({...base,status:'partial',received:12},now));
 assert.throws(()=>createFacilityReceipt({...base,status:'not_received',received:1},now));
 assert.throws(()=>createFacilityReceipt({...base,status:'received',received:13},now));
 assert.throws(()=>createFacilityReceipt({...base,reportedAt:'2026-11-04T00:00:00Z'},now));
 assert.throws(()=>createFacilityReceipt({...base,source:''},now));
});
test('impossible or unzoned receipt times are not silently normalized',()=>{
 for(const reportedAt of ['2026-02-30T10:00:00Z','2026-04-31T10:00:00Z','2026-11-03T11:30:00'])assert.throws(()=>createFacilityReceipt({...base,reportedAt},now));
});
test('unknown saved receipt fields prevent destructive rewriting',async()=>{
 const {decodeFacilityReceipts,appendFacilityReceipt}=await import('./readiness.mjs'),identity={area:base.area,name:base.name,address:base.address},first={id:'a',...createFacilityReceipt(base,now),futureField:'must keep'},raw=JSON.stringify([first]),second={id:'b',...createFacilityReceipt({...base,status:'partial',received:3},now)};
 assert.equal(decodeFacilityReceipts(raw,identity).status,'corrupt');assert.throws(()=>appendFacilityReceipt(raw,second,identity));assert.equal(JSON.parse(raw)[0].futureField,'must keep');
});

test('receipt reports stay bound to a facility and corrupt storage is not overwritten',async()=>{
 const {decodeFacilityReceipts,appendFacilityReceipt}=await import('./readiness.mjs');
 const identity={area:base.area,name:base.name,address:base.address};const record={id:'a',...createFacilityReceipt(base,now)};
 const raw=appendFacilityReceipt(null,record,identity);assert.equal(decodeFacilityReceipts(raw,identity).receipts[0].status,'received');
 assert.equal(decodeFacilityReceipts(raw,{...identity,name:'別施設'}).status,'corrupt');
 assert.throws(()=>appendFacilityReceipt('{',record,identity));assert.throws(()=>appendFacilityReceipt(raw,{...record,id:'b'},identity),/同じ/);
});

test('follow-up is attached to a receipt without replacing the original or asserting delivery',async()=>{
 const {appendFacilityReceipt,decodeFacilityReceipts,appendFacilityReceiptFollowup}=await import('./readiness.mjs');
 const identity={area:base.area,name:base.name,address:base.address},receipt={id:'receipt-a',...createFacilityReceipt({...base,status:'partial',received:3},now)};
 const raw=appendFacilityReceipt(null,receipt,identity),action={kind:'handoff',state:'planned',at:'2026-11-03T11:40:00.000Z',note:'窓口の確認を予定'};
 const updated=appendFacilityReceiptFollowup(raw,receipt,identity,action,now),record=decodeFacilityReceipts(updated,identity).receipts[0];
 assert.equal(record.status,'partial');assert.equal(record.received,3);assert.deepEqual(record.followups,[action]);
 assert.throws(()=>appendFacilityReceiptFollowup(updated,receipt,identity,action,now),/変わりました/);
 assert.throws(()=>appendFacilityReceiptFollowup(raw,receipt,{...identity,name:'別施設'},action,now));
 assert.throws(()=>appendFacilityReceiptFollowup(raw,receipt,identity,{...action,at:'2026-11-03T10:00:00.000Z'},now));
 assert.throws(()=>appendFacilityReceiptFollowup(raw,receipt,identity,{...action,state:'verified'},now));
 assert.throws(()=>appendFacilityReceiptFollowup(raw,receipt,identity,{...action,at:'2026-11-03T13:00:00.000Z'},now));
 const tampered=JSON.parse(updated);tampered[0].followups[0].state='verified';assert.equal(decodeFacilityReceipts(JSON.stringify(tampered),identity).status,'corrupt');
});
