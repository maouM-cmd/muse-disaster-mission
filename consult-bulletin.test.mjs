import test from 'node:test';import assert from 'node:assert/strict';
import {consultFloodBulletin,validateConsultFloodBulletin,consultBulletinIssueAge,consultEvidenceRefs,validateConsultEvidenceRefs,createConsultAudit,finishConsultAudit,finishUncertainConsultAudit,decodeConsultAudits,appendConsultAudit,recordConsultReview} from './readiness.mjs';
import {consultMapWithMuse} from './meta.mjs';import {createServer} from './server.mjs';
const now=Date.parse('2026-11-04T08:00:00.000Z');
const source={url:'https://www.data.jma.go.jp/developer/xml/data/20261104074000_0_VXKO50_000000.xml',issuedAt:'2026-11-04T07:40:00Z',retrievedAt:'2026-11-04T07:50:00.000Z',event:'830304000100',serial:'1',bulletinType:'発表',controlStatus:'通常',water:{truncated:false,rows:[{station:'秘匿しないが送らない名称',location:'地名',stationCodeType:'水位観測所',code:'83030400010000006',time:'2026-11-04T07:30:00Z',label:'現況',value:'1.25',unit:'m',condition:'正常'},{station:'同じ観測所',location:'地名',stationCodeType:'水位観測所',code:'83030400010000006',time:'2026-11-04T08:30:00Z',label:'１時間後',value:'',unit:'m',condition:'欠測'}]}};
test('issue age reflects publication time rather than the time it was fetched',()=>{
 assert.deepEqual(consultBulletinIssueAge(source.issuedAt,now),{state:'elapsed',minutes:20});
 assert.deepEqual(consultBulletinIssueAge('2026-10-30T08:00:00Z',now),{state:'elapsed',minutes:7200});
 assert.deepEqual(consultBulletinIssueAge('2026-11-04T08:01:00Z',now),{state:'clock',minutes:null});
 assert.deepEqual(consultBulletinIssueAge('2026-02-30T08:00:00Z',now),{state:'unknown',minutes:null});
});
test('a bulletin is converted into bounded, opt-in information without location names or free text',()=>{
 const value=consultFloodBulletin(source,now);assert.ok(value);assert.equal(validateConsultFloodBulletin(value,now),true);assert.equal(value.levels[0].value,'1.25');assert.equal(value.levels[1].value,null);assert.equal(value.levels[1].condition,'欠測');assert.doesNotMatch(JSON.stringify(value),/秘匿|地名|location|stationName/);
 for(const bad of [{...source,controlStatus:'訓練'},{...source,bulletinType:'取消'},{...source,retrievedAt:'2026-11-04T05:00:00Z'},{...source,issuedAt:'2026-02-30T07:40:00Z'},{...source,url:'https://evil.example/x.xml'},{...source,water:{...source.water,truncated:true}},{...source,water:{truncated:false,rows:[{...source.water.rows[0],unit:'feet'}]}},{...source,water:{truncated:false,rows:[{...source.water.rows[0],condition:'欠測',value:'9'}]}}])assert.equal(consultFloodBulletin(bad,now),null);
 assert.equal(validateConsultFloodBulletin({...value,extra:'private'},now),false);
});
test('bulletin references and audit preserve exactly what was sent without claiming current conditions',()=>{
 const bulletin=consultFloodBulletin(source,now),refs=consultEvidenceRefs('req',false,false,false,false,true);assert.equal(validateConsultEvidenceRefs(refs,false,false,false,false,true),true);
 const audit=createConsultAudit({id:'req',capturedAt:new Date(now).toISOString(),area:'13118',payload:{supply:null,quantity:null,bulletin}}),done=finishConsultAudit(audit,{density:'unclear',ordered_ids:['flood','obstacles','airspace','shelter_open','communications'],cited_ids:['req:bulletin']},new Date(now+1000).toISOString());
 assert.equal(decodeConsultAudits(JSON.stringify([done])).status,'ok');assert.deepEqual(done.inputs.find(row=>row.kind==='bulletin').value,bulletin);assert.doesNotMatch(JSON.stringify(done),/秘匿|地名/);
});
test('interrupted attempts retain intended input without inventing delivery or a model response',()=>{
 const bulletin=consultFloodBulletin(source,now),draft=createConsultAudit({id:'interrupted',capturedAt:new Date(now).toISOString(),area:'13118',payload:{supply:null,quantity:null,bulletin}});
 const uncertain=finishUncertainConsultAudit(draft,new Date(now+1000).toISOString());assert.equal(uncertain.status,'uncertain');assert.equal(Object.hasOwn(uncertain,'output'),false);assert.equal(Object.hasOwn(uncertain,'receivedAt'),false);
 const raw=appendConsultAudit(null,uncertain),decoded=decodeConsultAudits(raw);assert.equal(decoded.status,'ok');assert.deepEqual(decoded.records[0],uncertain);assert.throws(()=>recordConsultReview(raw,uncertain,'consider',new Date(now+2000).toISOString()));
 assert.equal(decodeConsultAudits(JSON.stringify([{...uncertain,output:{density:'dense'}}])).status,'corrupt');assert.equal(decodeConsultAudits(JSON.stringify([{...uncertain,receivedAt:new Date(now+1000).toISOString()}])).status,'corrupt');
});
test('twenty valid long bulletin records fit without overwriting older records',()=>{
 const longSource={...source,water:{truncated:false,rows:Array.from({length:30},()=>({...source.water.rows[0],code:'123456789012345678901234567890',time:'2026-11-04T07:30:00.000Z',value:'123.123'}))}},bulletin=consultFloodBulletin(longSource,now);let raw=null;
 for(let i=0;i<20;i++){const draft=createConsultAudit({id:`long-${i}`,capturedAt:new Date(now).toISOString(),area:'13118',payload:{supply:null,quantity:null,bulletin}});raw=appendConsultAudit(raw,finishUncertainConsultAudit(draft,new Date(now+1000).toISOString()))}
 assert.ok(raw.length>100000);assert.equal(decodeConsultAudits(raw).records.length,20);assert.equal(JSON.parse(raw).at(-1).requestId,'long-0');
});
test('model receives the source as time-bounded evidence, not an instruction or local safety finding',async()=>{
 const at=Date.now(),copy={...source,issuedAt:new Date(at-60000).toISOString(),retrievedAt:new Date(at-10000).toISOString(),water:{truncated:false,rows:source.water.rows.map((row,i)=>({...row,time:new Date(at+(i?3600000:-120000)).toISOString()}))}},bulletin=consultFloodBulletin(copy,at),refs=consultEvidenceRefs('live',false,false,false,false,true),prompts=[];
 await consultMapWithMuse({key:'fixture',image:'data:image/png;base64,AA==',supply:null,quantity:null,bulletin,evidenceRefs:refs},async(_url,options)=>{prompts.push(JSON.parse(options.body).input[0].content[0].text);return {ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(prompts.length===1?{density:'unclear'}:{ordered_ids:['flood','obstacles','airspace','shelter_open','communications'],cited_ids:['live:bulletin']})}]}]})}});
 assert.match(prompts[1],/対象施設との対応は未確認/);assert.match(prompts[1],/現在の浸水/);assert.match(prompts[1],/live:bulletin/);assert.match(prompts[1],/相談送信時刻（端末時刻）|相談送信時刻（サーバー時刻）/);assert.doesNotMatch(prompts[1],/秘匿|地名/);
});
test('server requires a valid bulletin, matching references, and explicit capability',async t=>{
 let calls=0;const server=createServer({active:true,key:'fixture',mapConsult:async()=>{calls++;return {density:'unclear',ordered_ids:['flood','obstacles','airspace','shelter_open','communications'],cited_ids:['req:bulletin']}}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base=`http://127.0.0.1:${server.address().port}`,at=Date.now(),bulletin=consultFloodBulletin({...source,issuedAt:new Date(at-60000).toISOString(),retrievedAt:new Date(at-10000).toISOString()},at),payload={image:'data:image/png;base64,AA==',supply:null,quantity:null,bulletin,evidenceRefs:consultEvidenceRefs('req',false,false,false,false,true)};
 const post=data=>fetch(base+'/api/map-consult',{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify(data)});
 assert.equal((await post({...payload,bulletin:{...bulletin,extra:'personal'}})).status,400);assert.equal((await post({...payload,evidenceRefs:consultEvidenceRefs('req',false)})).status,400);assert.equal(calls,0);assert.equal((await post(payload)).status,200);assert.equal(calls,1);assert.equal((await (await fetch(base+'/api/map-capabilities')).json()).mapConsultBulletin,true);
});
