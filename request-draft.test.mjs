import {test} from 'node:test';
import assert from 'node:assert/strict';
import {requestDraft,simulationManifest,suggestRequest,suggestShelters} from './readiness.mjs';

test('facility suggestions require an explicit complete name and preserve ambiguous matches',()=>{
  const list=[{name:'原中学校',address:'荒川区A'},{name:'第四中学校',address:'荒川区B'},{name:'原中学校グラウンド',address:'荒川区C'},{name:'原中学校',address:'荒川区D'}];
  assert.deepEqual(suggestShelters('原中学校に水を十二箱届けて',list),[0,3]);
  assert.deepEqual(suggestShelters('原中学校グラウンドに水を届けて',list),[2]);
  assert.deepEqual(suggestShelters('原中学校と第四中学校へ届けて',list),[0,1,3]);
  assert.deepEqual(suggestShelters('原中に届けて',list),[]);
  assert.deepEqual(suggestShelters('原中学校ではなく別の場所へ',list),[]);
  assert.deepEqual(suggestShelters('原中学校に届けて',[]),[]);
  assert.deepEqual(suggestShelters('原 中学校に届けて',[list[0]]),[0]);
});

test('a complete draft remains unsubmitted and requires independent flight checks',()=>{
  const result=requestDraft({area:'東京都荒川区',shelter:'第一避難場所',supply:'water',quantity:'12'});
  assert.equal(result.complete,true);
  assert.equal(result.status,'下書き・未送信');
  assert.equal(result.supply,'飲料水');
  assert.equal(result.quantity,12);
  assert.equal(result.destination,'第一避難場所');
  assert.equal(result.flight,'判断不可');
});

test('missing or malformed details cannot create a complete draft',()=>{
  for(const quantity of ['','0','-1','1.5','10001','3e2']){
    assert.equal(requestDraft({area:'東京都荒川区',shelter:'施設',supply:'water',quantity}).complete,false);
  }
  assert.equal(requestDraft({area:'東京都荒川区',shelter:'',supply:'water',quantity:'1'}).complete,false);
  assert.equal(requestDraft({area:'',shelter:'施設',supply:'water',quantity:'1'}).complete,false);
  assert.equal(requestDraft({area:'東京都荒川区',shelter:'施設',supply:'other',quantity:'1'}).complete,false);
});
test('a virtual delivery takes a one-box snapshot of the explicitly selected request',()=>{
  const form={area:'東京都荒川区',shelter:'原中学校',supply:'water',quantity:'12'};
  const trip=simulationManifest(form);form.quantity='30';form.supply='food';
  assert.deepEqual(trip,{destination:'原中学校',supply:'飲料水',requested:12,boxes:1});
  assert.deepEqual(simulationManifest({...form,quantity:'0'}),{destination:'',supply:'',requested:null,boxes:1});
  assert.deepEqual(simulationManifest({transcript:'水を12箱'}),{destination:'',supply:'',requested:null,boxes:1});
});
test('suggests only an explicit single supply and exact box count',()=>{
  assert.deepEqual(suggestRequest('避難所へ水を１２箱届けて'),{supply:'water',label:'飲料水',quantity:12});
  assert.deepEqual(suggestRequest('毛布を二十三箱お願いします'),{supply:'blanket',label:'毛布',quantity:23});
  assert.deepEqual(suggestRequest('水害の地域に食料を3箱届けて'),{supply:'food',label:'食料',quantity:3});
  for(const text of ['水を2箱と食料を3箱','水を2〜3箱','水は不要、食料を3箱','水を1.5箱','水を1箱か2箱','水を届けて','水位が2箱','水を0箱','水を10001箱','水を二二箱'])assert.equal(suggestRequest(text),null,text);
});
