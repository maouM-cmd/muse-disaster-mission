import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

async function callConsult(v3){
  const source=await readFile(new URL('./app.js',import.meta.url),'utf8');
  const code=source.slice(source.indexOf('async function consultLargeFleet('),source.indexOf('function renderLargeFleet(data)'));
  const sent=[],notices=[],inputs=[];
  const context={real:true,realMode:true,mapFleetPlanAvailable:true,mapFleetEvidenceV2:true,mapFleetEvidenceV3:v3,AbortSignal,
    realMap:{capture:()=>({image:'fixture-image',view:'v1'}),isViewCurrent:view=>view==='v1'},
    api:async(_route,payload)=>{sent.push(payload);return {sora:{},nagi:{}}}};
  vm.runInNewContext(code,context);
  await context.consultLargeFleet({affected:1,representatives:{A:null,B:null},distances:{A:null,B:null}},new AbortController().signal,text=>notices.push(text),input=>inputs.push(input));
  return {sent:sent[0],notices,inputs};
}

test('old servers receive compatible evidence and disclose that distance was not sent',async()=>{
  const {sent,notices,inputs}=await callConsult(false);
  assert.equal('distances' in sent.evidence,false);
  assert.ok('representatives' in sent.evidence);
  assert.match(notices.join(' '),/距離.*Muse.*送/);
  assert.equal(inputs[0].image,sent.image);assert.equal(inputs[0].distanceIncluded,false);
});

test('distance-capable servers receive the distances without the legacy warning',async()=>{
  const {sent,notices,inputs}=await callConsult(true);
  assert.ok('distances' in sent.evidence);
  assert.equal(notices.length,0);
  assert.equal(inputs[0].image,sent.image);assert.equal(inputs[0].distanceIncluded,true);
});
