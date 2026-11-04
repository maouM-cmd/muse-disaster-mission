import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizePastedKey,isPlausibleMetaKey} from './key-input.mjs';

test('removes terminal paste markers without changing the key',()=>{
  const key='LLM_123_example';
  assert.equal(normalizePastedKey(`\x1b[200~${key}\x1b[201~`),key);
  assert.equal(normalizePastedKey(` ${key} `),key);
});
test('does not accept an empty or visually masked key',()=>{
  assert.equal(isPlausibleMetaKey(''),false);
  assert.equal(isPlausibleMetaKey('LLM_123...abcd'),false);
  assert.equal(isPlausibleMetaKey('LLM_123…abcd'),false);
  assert.equal(isPlausibleMetaKey('LLM_123_example'),true);
});
