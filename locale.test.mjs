import {test} from 'node:test';
import assert from 'node:assert/strict';
import {translateInterfaceText,resolveInterfaceLanguage} from './readiness.mjs';

test('language selection accepts Japanese and English, defaults safely',()=>{
  assert.equal(resolveInterfaceLanguage('en-US'),'en');assert.equal(resolveInterfaceLanguage('ja'),'ja');assert.equal(resolveInterfaceLanguage('fr'),'ja');
});

test('English interface translates mission choices and simulated status without changing names',()=>{
  assert.equal(translateInterfaceText('配送先を選ぶ','en'),'Choose a destination');
  assert.match(translateInterfaceText('移動中 4機　相談待ち 12機　停止 0機　予備 88機','en'),/In flight 4.*Awaiting consultation 12.*Stopped 0.*Spare 88/);
  assert.equal(translateInterfaceText('原中学校','en'),'Hara Junior High School');
  assert.equal(translateInterfaceText('原中学校へ 飲料水 12箱','en'),'Supplies to Hara Junior High School: Drinking water — 12 boxes');
  assert.equal(translateInterfaceText('出発地点：35.7, 139.7（現地状況は未確認）','en'),'Launch point: 35.7, 139.7 (on-site conditions unverified)');
  assert.equal(translateInterfaceText('停止理由：利用者が仮想配送を停止しました（12機）','en'),'Stop reason: simulation stopped by the user (12 drones)');
  assert.match(translateInterfaceText('原中学校への依頼 飲料水 12箱：配送中・準備中 0箱／停止 0箱／荷下ろし中断・所在不明 0箱／仮想荷下ろし済 元施設 0箱・別施設 12箱／未割当 0箱。予備 88機。','en'),/Simulated unloaded original facility 0 boxes・other facilities 12 boxes/);
  assert.equal(translateInterfaceText('停止理由：不明な独自の理由（2機）','en'),'Stop reason (Japanese original): 不明な独自の理由（2機）');
  assert.equal(translateInterfaceText('候補なし','ja'),'候補なし');
});

test('free-form Muse responses are not invented or attributed to a translator',()=>{
  const raw='Museの回答（説明は未検証）：ナギ（最終提案）：候補なし。理由：詳細不明の独自の文章';
  const english=translateInterfaceText(raw,'en');
  assert.match(english,/Muse response/);assert.match(english,/詳細不明の独自の文章/);assert.match(english,/Japanese original/);
});

test('English supply requests can be reviewed without inventing destinations',async()=>{
  const {suggestRequest,suggestShelters}=await import('./readiness.mjs');
  assert.deepEqual(suggestRequest('Deliver 12 boxes of water'),{supply:'water',label:'飲料水',quantity:12});
  assert.deepEqual(suggestRequest('Deliver twelve boxes of water'),{supply:'water',label:'飲料水',quantity:12});
  assert.equal(suggestRequest('Do not deliver 12 boxes of water'),null);
  assert.equal(suggestRequest('Deliver 12 boxes of water and food'),null);
  assert.deepEqual(suggestShelters('Deliver to Hara Junior High School',[{name:'原中学校'},{name:'別の施設'}]),[0]);
  assert.deepEqual(suggestShelters('Do not deliver to Hara Junior High School',[{name:'原中学校'}]),[]);
});
