import {test} from 'node:test';
import assert from 'node:assert/strict';
import {configureSpeech,trackSpeech} from './speech.mjs';

test('roles use separate Japanese voices when available',()=>{
  const voices=[{lang:'en-US',name:'English'},{lang:'ja-JP',name:'First'},{lang:'ja-JP',name:'Second'}];
  const sora=configureSpeech({},'ソラ',voices),nagi=configureSpeech({},'ナギ',voices);
  assert.equal(sora.voice.name,'First');assert.equal(nagi.voice.name,'Second');assert.notEqual(sora.pitch,nagi.pitch);
});
test('one or no Japanese voices still produces role-specific settings',()=>{
  const voice={lang:'ja-JP'};
  assert.equal(configureSpeech({},'ナギ',[voice]).voice,voice);
  assert.equal(configureSpeech({},'管制',[]).lang,'ja-JP');
});

test('highlights and reveals the message currently spoken, and clears it on end or error',()=>{
  const classes=new Set(),row={isConnected:true,classList:{add:x=>classes.add(x),remove:x=>classes.delete(x)},getBoundingClientRect:()=>({top:180})};
  const radio={scrollTop:0,clientHeight:90,getBoundingClientRect:()=>({top:100})};
  let enabled=true,errors=0;const utterance=trackSpeech({},row,radio,()=>enabled,()=>errors++);
  utterance.onstart();assert.equal(classes.has('speaking'),true);assert.equal(radio.scrollTop,50);
  utterance.onend();assert.equal(classes.has('speaking'),false);
  utterance.onstart();utterance.onerror();assert.equal(classes.has('speaking'),false);assert.equal(errors,1);
  utterance.onstart();utterance.onerror({error:'interrupted'});assert.equal(classes.has('speaking'),false);assert.equal(errors,1);
  utterance.onerror({error:'canceled'});assert.equal(errors,1);
  enabled=false;utterance.onstart();utterance.onerror();assert.equal(classes.has('speaking'),false);assert.equal(errors,1);
});

test('subtitle follows the message when speech actually starts',()=>{
  const row={isConnected:true,classList:{add(){},remove(){}},getBoundingClientRect:()=>({top:0})};
  const radio={scrollTop:0,clientHeight:0,getBoundingClientRect:()=>({top:0})};
  let starts=0;const utterance=trackSpeech({},row,radio,()=>true,()=>{},()=>starts++);
  assert.equal(starts,0);utterance.onstart();assert.equal(starts,1);
  row.isConnected=false;utterance.onstart();assert.equal(starts,1);
});
