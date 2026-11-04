import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

async function guidedHarness(){
  const source=await readFile(new URL('./app.js',import.meta.url),'utf8');
  const code=source.slice(source.indexOf('/* Guided tutorial, staged selection'));
  const elements=new Map();
  let observer;
  function element(id){
    if(!elements.has(id)){
      const classes=new Set(),listeners={};
      elements.set(id,{
        id,hidden:false,disabled:false,value:'',textContent:'',dataset:{},attributes:{},selectedOptions:[],
        classList:{add:x=>classes.add(x),remove:x=>classes.delete(x),contains:x=>classes.has(x),toggle(x,on){if(on===undefined)on=!classes.has(x);on?classes.add(x):classes.delete(x);return on;}},
        setAttribute(name,value){this.attributes[name]=value;if(name==='data-stage')this.dataset.stage=value;},
        removeAttribute(name){delete this.attributes[name];},
        addEventListener(type,fn){(listeners[type]??=[]).push(fn);},
        click(){for(const fn of listeners.click||[])fn({target:this});},
        focus(){},querySelectorAll(){return [];},contains(){return false;}
      });
    }
    return elements.get(id);
  }
  const shell=element('shell');
  element('map-panel').hidden=true;
  element('tutorial-overlay').hidden=true;
  element('map-sim-stop').hidden=true;
  element('map-sim-stop').disabled=true;
  element('map-sim-consult').hidden=true;
  element('map-sim-detour').hidden=true;
  element('map-sim-alternate').hidden=true;
  element('map-origin').textContent='出発地点：未選択';
  element('draft-destination').textContent='配送先を選択してください';
  element('map-area-title').textContent='東京都荒川区 ／ 実地図';
  const document={getElementById:element,querySelector:()=>shell,addEventListener(){}};
  class MutationObserver{constructor(fn){observer=fn;}observe(){}}
  const window={matchMedia:()=>({matches:false}),dispatchEvent(){}};
  vm.runInNewContext(code,{document,window,MutationObserver,Event:class{},setTimeout:fn=>fn(),requestAnimationFrame(){}});
  return {element,shell,changed(){observer?.();}};
}

test('guided setup prevents skipping missing selections and preserves them on back',async()=>{
  const h=await guidedHarness(),e=h.element;
  e('map-panel').hidden=false;
  e('enter-realmap').click();
  assert.equal(e('tutorial-overlay').hidden,false);
  e('tutorial-skip').click();
  e('stage-next').click();
  assert.equal(e('map-panel').dataset.stage,'2');
  e('stage-next').click();
  assert.equal(e('map-panel').dataset.stage,'2');
  assert.match(e('stage-error').textContent,/配送先が未選択/);
  e('shelter-select').value='0';
  e('shelter-select').selectedOptions=[{textContent:'原中学校 — 東京都荒川区'}];
  e('stage-next').click();
  assert.equal(e('map-panel').dataset.stage,'3');
  e('stage-next').click();
  assert.match(e('stage-error').textContent,/出発地点が未選択/);
  e('map-origin').textContent='出発地点：選択済み';
  e('stage-next').click();
  assert.equal(e('map-panel').dataset.stage,'4');
  assert.match(e('stage-desc').textContent,/原中学校/);
  e('stage-back').click();
  e('stage-back').click();
  assert.equal(e('shelter-select').value,'0');
});

test('flight closes the information panel while preserving stop and status',async()=>{
  const h=await guidedHarness(),e=h.element;
  e('map-panel').hidden=false;
  e('enter-realmap').click();
  e('tutorial-skip').click();
  e('map-sim-status').textContent='仮想障害の手前で停止';
  e('map-fleet-state').textContent='2号機：配送中';
  e('map-sim-stop').hidden=false;
  e('map-sim-stop').disabled=false;
  let stopped=false;
  e('map-sim-stop').addEventListener('click',()=>{stopped=true;});
  h.changed();
  assert.equal(h.shell.classList.contains('panel-collapsed'),true);
  assert.match(e('mini-status').textContent,/1号機.*仮想障害/);
  assert.match(e('mini-fleet').textContent,/2号機.*配送中/);
  assert.equal(e('mini-stop').hidden,false);
  e('mini-stop').click();
  assert.equal(stopped,true);
  e('mini-expand').click();
  assert.equal(h.shell.classList.contains('panel-collapsed'),false);
});
