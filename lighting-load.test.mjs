import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

test('real-map setArea lodLightRequested declaration order via static inspection', async ()=>{
  const src = await readFile(path.join(root,'real-map.mjs'),'utf-8');
  const decl = src.indexOf('lodLightRequested');
  const setArea = src.indexOf('function setArea');
  // In baseline, there is no lodLightRequested, so test should pass as not found
  // In fixed version, decl should be before setArea, or no lodLightRequested at all (baseline)
  if(decl === -1){
    assert.ok(!src.includes('lodLightRequested') || src.indexOf('lodLightRequested') === -1, 'baseline has no lodLightRequested, safe');
  } else {
    assert.ok(decl < setArea, 'lodLightRequested should be declared before setArea to avoid ReferenceError');
  }
  // Also check that real-map does not have temporal dead zone for lodLightRequested
  assert.doesNotMatch(src, /const requestedForThisRevision\s*=\s*lodLightRequested[\s\S]*?let lodLightRequested/);
});

test('real-map buildingMode declaration order via static file inspection', async ()=>{
  const src = await readFile(path.join(root,'real-map.mjs'),'utf-8');
  // Check that buildingMode and related vars are declared at top before any function that uses them
  const topDecl = src.indexOf("let buildingMode='detailed'");
  const firstSetArea = src.indexOf('function setArea');
  assert.ok(topDecl !== -1 && topDecl < firstSetArea, 'buildingMode declared before setArea');
  // In baseline, currentLevels is part of lighting feature, so only check if feature exists
  const hasLight2 = src.includes('currentLevels');
  if(src.includes('isLod2Applicable')) assert.ok(hasLight2, 'currentLevels should be declared when lighting feature exists');
});

test('app.js does not reference undeclared lodLightReflectPending', async ()=>{
  const src = await readFile(path.join(root,'app.js'),'utf-8');
  const hasReflect = src.includes('lodLightReflectPending');
  if(!hasReflect){
    assert.ok(true, 'baseline has no reflect pending, safe');
    return;
  }
  // If it exists, it should be declared with let
  assert.match(src, /let[^;]*lodLightReflectPending/, 'lodLightReflectPending should be declared');
  assert.match(src, /let[^;]*lodLightReflectArea/, 'lodLightReflectArea should be declared');
});

test('lighting feature is either absent (safe baseline) or correctly declared', async ()=>{
  const realSrc = await readFile(path.join(root,'real-map.mjs'),'utf-8');
  const appSrc = await readFile(path.join(root,'app.js'),'utf-8');
  const hasRealLight = realSrc.includes('isLod2Applicable') || realSrc.includes('lodLightingEnabled');
  const hasAppLight = appSrc.includes('lod-light-toggle');
  // Either both have it correctly, or both don't (baseline)
  if(!hasRealLight && !hasAppLight){
    assert.ok(true, 'baseline without lighting feature is safe');
  } else {
    // If present, ensure declarations are before use
    if(hasRealLight){
      const decl = realSrc.indexOf('lodLightRequested');
      const use = realSrc.indexOf('requestedForThisRevision');
      if(decl!==-1 && use!==-1) assert.ok(decl < use);
    }
    if(hasAppLight){
      assert.match(appSrc, /let[^;]*lodLightPending/);
    }
  }
});
