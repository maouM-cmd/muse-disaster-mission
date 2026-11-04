import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createBrief} from './readiness.mjs';

test('the memo records the selected shelter flood estimate with its limits and source',()=>{
  const text=createBrief({created:'2026-11-01T05:00:00.000Z',shelter:'原中学校',address:'東京都荒川区町屋',facilityFlood:{shelter:'原中学校',address:'東京都荒川区町屋',state:'ready',depth:'3.0〜5.0m',checkedAt:'2026-11-01T04:59:00.000Z'}});
  assert.match(text,/施設座標の洪水想定.*3.0〜5.0m/);
  assert.match(text,/2026-11-01T04:59:00.000Z/);
  assert.match(text,/公開座標.*1地点/);
  assert.match(text,/現在の浸水.*施設全体/);
  assert.match(text,/https:\/\/disaportal\.gsi\.go\.jp/);
});
test('the memo never carries another shelter or a malformed flood result',()=>{
  const base={created:'2026-11-01T05:00:00.000Z',shelter:'大門小学校',address:'東京都荒川区町屋',facilityFlood:{shelter:'原中学校',address:'東京都荒川区町屋',state:'ready',depth:'3.0〜5.0m',checkedAt:'2026-11-01T04:59:00.000Z'}};
  assert.doesNotMatch(createBrief(base),/3\.0〜5\.0m/);
  assert.match(createBrief(base),/施設座標の洪水想定：未確認/);
  base.facilityFlood={...base.facilityFlood,shelter:'大門小学校',depth:'安全'};
  assert.match(createBrief(base),/施設座標の洪水想定：未確認/);
  base.facilityFlood={shelter:base.shelter,address:base.address,state:'loading'};
  assert.match(createBrief(base),/施設座標の洪水想定：確認中/);
});

test('a local snapshot retains evidence and unknowns without presenting it as an order',()=>{
  const text=createBrief({created:'2026-11-01T05:00:00.000Z',area:'東京都荒川区',shelter:'原中学校',address:'東京都荒川区町屋',supply:'water',quantity:'12',request:'水を届けて',ids:['flood','airspace'],observation:'東京 14:50観測',buildings:'建物モデル 2025年度'});
  assert.match(text,/下書き・未送信/);assert.match(text,/判断不可/);
  assert.match(text,/原中学校/);assert.match(text,/東京都荒川区町屋/);assert.match(text,/飲料水 12箱/);
  assert.match(text,/現在の浸水状況は未確認/);assert.match(text,/飛行規制・飛行許可は未確認/);
  assert.match(text,/東京 14:50観測/);assert.match(text,/2025年度/);
  assert.match(text,/2026-11-01T05:00:00.000Z/);
});

test('an incomplete or unavailable snapshot reports unknowns instead of success',()=>{
  const text=createBrief({created:'2026-11-01T05:00:00.000Z',ids:[]});
  assert.match(text,/施設未選択/);assert.match(text,/物資未選択/);assert.match(text,/数量未入力/);
  assert.match(text,/確認項目を取得できていません/);
  assert.match(text,/依頼送信|依頼は送信/);
});
