import test from 'node:test';
import assert from 'node:assert/strict';

test('saved image reviews retain validated candidate boxes and match only the exact original file hash', async()=>{
 const {createPhotoMetadata,createPhotoReview,appendPhotoReview,decodePhotoReviews,photoReviewMatchesFile}=await import('./readiness.mjs');
 const metadata=createPhotoMetadata({kind:'training',time:'',visibility:'unknown',latitude:'',longitude:'',accuracy:'',direction:'unknown',calibration:'unknown',width:900,height:540});
 const base={version:2,id:'review-1',frameId:'frame-1',receivedAt:'2026-11-02T00:00:00.000Z',recordedAt:'2026-11-02T00:01:00.000Z',boxCount:1,metadata,sentSize:{width:900,height:540},imageHash:'a'.repeat(64),boxes:[{x1:5,y1:8,x2:300,y2:90,w:900,h:540}]};
 const record=createPhotoReview(base),raw=appendPhotoReview(null,record);assert.deepEqual(decodePhotoReviews(raw).records,[record]);
 assert.equal(photoReviewMatchesFile(record,'a'.repeat(64)),true);assert.equal(photoReviewMatchesFile(record,'b'.repeat(64)),false);assert.equal(raw.includes('base64'),false);
 assert.throws(()=>createPhotoReview({...base,boxes:[{...base.boxes[0],x2:901}]}));assert.throws(()=>createPhotoReview({...base,boxCount:0}));assert.throws(()=>createPhotoReview({...base,imageHash:'bad'}));
});
import {createPhotoScan,createPhotoMetadata} from './readiness.mjs';

test('photo timestamps reject impossible dates and retain valid local and zoned instants',()=>{
 const base={kind:'field',visibility:'unknown',latitude:'',longitude:'',accuracy:'',direction:'unknown',calibration:'unknown',width:100,height:100};
 for(const time of ['2026-02-30T12:00','2026-02-29T12:00:00Z','2026-04-31T08:00:00+09:00','2026-01-01T24:00','2026-01-01','not a date'])assert.throws(()=>createPhotoMetadata({...base,time}));
 assert.equal(createPhotoMetadata({...base,time:'2024-02-29T12:00:00+09:00'}).time,'2024-02-29T03:00:00.000Z');
 assert.equal(createPhotoMetadata({...base,time:'2024-02-29T12:00'}).time,new Date('2024-02-29T12:00').toISOString());
});

test('self-reported image limitations survive storage without changing legacy records',async()=>{
 const {createPhotoReview,appendPhotoReview,decodePhotoReviews}=await import('./readiness.mjs');
 const base={kind:'field',time:'',visibility:'unknown',latitude:'',longitude:'',accuracy:'',direction:'unknown',calibration:'unknown',width:900,height:540};
 const metadata=createPhotoMetadata({...base,limitations:['occluded','thin_wires']});
 const record=createPhotoReview({version:1,id:'limits-1',frameId:'frame-1',receivedAt:'2026-11-02T00:00:00.000Z',recordedAt:'2026-11-02T00:01:00.000Z',boxCount:0,metadata,sentSize:{width:900,height:540}});
 assert.deepEqual(decodePhotoReviews(appendPhotoReview(null,record)).records[0].metadata.limitations,['occluded','thin_wires']);
 assert.equal(Object.hasOwn(createPhotoMetadata(base),'limitations'),false);
 for(const bad of [['invented'],['occluded','occluded'],['thin_wires','occluded'],null])assert.throws(()=>createPhotoMetadata({...base,limitations:bad}));
});
const a={id:'a',image:'data:image/png;base64,AAAA',width:100,height:80};
const b={id:'b',image:'data:image/png;base64,BBBB',width:90,height:60};
const box={x1:1,y1:2,x2:7,y2:8,w:100,h:80};
test('an image is sent only on explicit run and empty output is inconclusive',async()=>{
 const calls=[],events=[];const scan=createPhotoScan({request:async(image)=>{calls.push(image);return []},onChange:s=>events.push(s)});
 await scan.run();assert.equal(calls.length,0);scan.setImage(a);assert.equal(calls.length,0);
 await scan.run();assert.equal(calls.length,1);assert.equal(events.at(-1).phase,'done');assert.equal(events.at(-1).boxes.length,0);assert.match(events.at(-1).message,/結果を確認できない/);assert.match(events.at(-1).message,/ないことを意味しません/);
});
test('replacing the image cancels the old request and ignores the late result',async()=>{
 let resolve,signal;const events=[];const scan=createPhotoScan({request:(_image,s)=>{signal=s;return new Promise(r=>resolve=r)},onChange:s=>events.push(s)});
 scan.setImage(a);const pending=scan.run();scan.setImage(b);assert.equal(signal.aborted,true);resolve([box]);await pending;
 assert.equal(events.at(-1).phase,'ready');assert.equal(events.at(-1).id,'b');assert.deepEqual(events.at(-1).boxes,[]);
});
test('invalid or failed model results do not produce detections',async()=>{
 const events=[];const scan=createPhotoScan({request:async()=>[{...box,x2:101}],onChange:s=>events.push(s)});scan.setImage(a);await scan.run();assert.equal(events.at(-1).phase,'error');assert.deepEqual(events.at(-1).boxes,[]);
 const failed=createPhotoScan({request:async()=>{throw new Error('offline')},onChange:s=>events.push(s)});failed.setImage(a);await failed.run();assert.equal(events.at(-1).phase,'error');assert.match(events.at(-1).message,/失敗/);
});
test('the image and boxes are validated and previous results clear on reset',async()=>{
 const events=[];const scan=createPhotoScan({request:async()=>[box],onChange:s=>events.push(s)});
 assert.throws(()=>scan.setImage({...a,image:'https://example.com/x.png'}));assert.throws(()=>scan.setImage({...a,width:0}));
 scan.setImage(a);await scan.run();assert.equal(events.at(-1).boxes.length,1);scan.clear();assert.equal(events.at(-1).phase,'empty');assert.deepEqual(events.at(-1).boxes,[]);
});

test('photo preparation scales down without stretching and rejects invalid dimensions',async()=>{
 const {photoScanDimensions}=await import('./readiness.mjs');
 assert.deepEqual(photoScanDimensions(4000,2000),{width:1024,height:512});
 assert.deepEqual(photoScanDimensions(320,640),{width:320,height:640});
 assert.throws(()=>photoScanDimensions(0,100));assert.throws(()=>photoScanDimensions(20001,20));
});

test('photo context remains explicitly self-reported and unknown fields remain unknown',()=>{
 const base={kind:'field',visibility:'obscured',time:'2026-11-01T05:20:00Z',latitude:'35.7',longitude:'139.8',accuracy:'50',direction:'north',calibration:'unknown',width:4000,height:2000};
 const value=createPhotoMetadata(base,Date.parse('2026-11-02T00:00:00Z'));
 assert.deepEqual(value.position,{latitude:35.7,longitude:139.8,accuracy:50});assert.equal(value.direction,'north');assert.equal(value.calibration,'unknown');assert.equal(value.selfReported,true);assert.deepEqual(value.originalSize,{width:4000,height:2000});
 const missing=createPhotoMetadata({...base,time:'',latitude:'',longitude:'',accuracy:'',direction:'unknown'},Date.parse('2026-11-02T00:00:00Z'));
 assert.equal(missing.position,null);assert.equal(missing.time,null);assert.equal(missing.direction,'unknown');
 for(const bad of [{latitude:'35',longitude:''},{latitude:'91'}, {longitude:'181'}, {accuracy:'-1'}, {accuracy:'20',latitude:'',longitude:''},{direction:'safest'},{time:'2027-01-01T00:00:00Z'}])assert.throws(()=>createPhotoMetadata({...base,...bad},Date.parse('2026-11-02T00:00:00Z')));
});

test('photo source and third-party transfer permission remain self-reported and survive saved review',async()=>{
 const {createPhotoReview,appendPhotoReview,decodePhotoReviews}=await import('./readiness.mjs');
 const base={kind:'historical',visibility:'unknown',time:'',latitude:'',longitude:'',accuracy:'',direction:'unknown',calibration:'unknown',width:900,height:540,source:'公開画像の資料名',permission:'unknown'};
 const metadata=createPhotoMetadata(base);assert.equal(metadata.source,'公開画像の資料名');assert.equal(metadata.permission,'unknown');assert.equal(metadata.selfReported,true);
 const review=createPhotoReview({version:1,id:'source-1',frameId:'frame-1',receivedAt:'2026-11-02T00:00:00.000Z',recordedAt:'2026-11-02T00:01:00.000Z',boxCount:0,metadata,sentSize:{width:900,height:540}});
 assert.deepEqual(decodePhotoReviews(appendPhotoReview(null,review)).records,[review]);
 assert.throws(()=>createPhotoMetadata({...base,permission:'verified'}));assert.throws(()=>createPhotoMetadata({...base,source:'a'.repeat(161)}));
});

test('an explicitly saved photo review retains uncertainty and metadata without saving image pixels',async()=>{
 const {createPhotoReview,appendPhotoReview,decodePhotoReviews}=await import('./readiness.mjs');
 const meta=createPhotoMetadata({kind:'field',visibility:'obscured',time:'2026-11-01T05:20:00Z',latitude:'35.7',longitude:'139.8',accuracy:'50',direction:'north',calibration:'unknown',width:4000,height:2000},Date.parse('2026-11-02T00:00:00Z'));
 const review=createPhotoReview({version:1,id:'record-1',frameId:'frame-1',receivedAt:'2026-11-02T00:00:00.000Z',recordedAt:'2026-11-02T00:01:00.000Z',boxCount:0,metadata:meta,sentSize:{width:1024,height:512}});
 const raw=appendPhotoReview(null,review);assert.deepEqual(decodePhotoReviews(raw).records,[review]);assert.equal(raw.includes('base64'),false);assert.equal(review.boxCount,0);assert.equal(review.metadata.visibility,'obscured');
 assert.throws(()=>appendPhotoReview(raw,review));
 assert.throws(()=>createPhotoReview({...review,image:'data:image/png;base64,AAAA'}));
 assert.throws(()=>createPhotoReview({...review,sentSize:{width:1,height:1}}));
 assert.throws(()=>createPhotoReview({...review,boxCount:-1}));
 assert.throws(()=>createPhotoReview({...review,frameId:undefined}));
 assert.throws(()=>createPhotoReview({...review,recordedAt:'2026-11-01T00:00:00.000Z'}));
 const tampered=JSON.parse(raw);tampered[0].metadata.position.latitude=91;assert.equal(decodePhotoReviews(JSON.stringify(tampered)).status,'corrupt');
});
