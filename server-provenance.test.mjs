import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createServer} from './server.mjs';

function post(base,path,payload){
  return new Promise((resolve,reject)=>{
    const req=http.request(base+path,{method:'POST',headers:{Origin:base,'Content-Type':'application/json'}},res=>{
      let body='';res.setEncoding('utf8');res.on('data',part=>body+=part);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(body)}));
    });req.on('error',reject);req.end(JSON.stringify(payload));
  });
}

test('built-in adapters label responses as server-reported Muse with simulated upstream responses',async t=>{
  const original=globalThis.fetch;let calls=0;
  globalThis.fetch=async(_url,options)=>{
    calls++;const name=JSON.parse(options.body).text.format.name;
    const value=name==='map_observation'?{density:'unclear'}:name==='map_checks'?{ordered_ids:['flood','obstacles','airspace','shelter_open','communications']}:{choice:'A',reason:'fixed upstream response'};
    return {ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(value)}]}]})};
  };
  const server=createServer({active:true,key:'not-a-real-key'});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{globalThis.fetch=original;await new Promise(resolve=>server.close(resolve))});
  const base=`http://127.0.0.1:${server.address().port}`,image='data:image/png;base64,AA==';
  const candidate={routes:1,total:2,observed:2,unknown:0,blocked:0,maxGap:20,avoidsHazard:true};
  const fleet=await post(base,'/api/fleet-plan',{image,evidence:{affected:1,unaffected:0,candidates:{A:candidate,B:candidate}}});
  const map=await post(base,'/api/map-consult',{image,supply:null,quantity:null});
  assert.equal(fleet.status,200);assert.equal(fleet.body.provenance,'muse');
  assert.equal(map.status,200);assert.equal(map.body.provenance,'muse');assert.equal(calls,4);
});

test('capabilities indicate supported protocol while status reports disabled connection',async t=>{
  const server=createServer({active:false});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  const [status,capabilities]=await Promise.all([fetch(base+'/api/status').then(r=>r.json()),fetch(base+'/api/map-capabilities').then(r=>r.json())]);
  assert.equal(status.enabled,false);assert.equal(capabilities.mapConsult,true);assert.equal(capabilities.fleetPlan,true);
  assert.equal((await post(base,'/api/map-consult',{})).status,503);
});
