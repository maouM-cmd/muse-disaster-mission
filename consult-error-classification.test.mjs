import test from 'node:test';import assert from 'node:assert/strict';import {createServer} from './server.mjs';

test('map consultation distinguishes input rejection from model failure without exposing upstream text',async t=>{
 let calls=0;const server=createServer({active:true,key:'fixture',mapConsult:async()=>{calls++;throw new Error('private upstream detail')}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base=`http://127.0.0.1:${server.address().port}`,post=body=>fetch(base+'/api/map-consult',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body}),valid={image:'data:image/png;base64,AA==',supply:null,quantity:null};
 let response=await post(JSON.stringify({...valid,unexpected:'x'}));assert.equal(response.status,400);assert.equal((await response.json()).code,'input_rejected');assert.equal(calls,0);
 response=await post('{broken');assert.equal(response.status,400);assert.equal((await response.json()).code,'input_rejected');assert.equal(calls,0);
 response=await post(JSON.stringify(valid));assert.equal(response.status,502);const failed=await response.json();assert.equal(failed.code,'consultation_failed');assert.doesNotMatch(JSON.stringify(failed),/private upstream detail/);assert.equal(calls,1);
});
test('known provider authentication and rate-limit errors yield safe actionable messages',async t=>{
 let failure='Meta API エラー (401)';const server=createServer({active:true,key:'fixture',mapConsult:async()=>{throw new Error(failure)}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base=`http://127.0.0.1:${server.address().port}`,post=()=>fetch(base+'/api/map-consult',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({image:'data:image/png;base64,AA==',supply:null,quantity:null})});
 let response=await post();assert.equal(response.status,502);assert.match((await response.json()).error,/認証または利用権限/);failure='Meta API エラー (429)';response=await post();assert.match((await response.json()).error,/利用制限/);
});
