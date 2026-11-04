import {test} from 'node:test';
import assert from 'node:assert/strict';
import {tileFor,selectFloodShelters,DATA,areaByCode,buildingYears,catalogAreas,tilesetRegion,tilesForBounds,jmaOffice,weatherSummary,straightDistance} from './geo-data.mjs';
import {createWeatherMonitor} from './geo-data.mjs';

test('suspended weather requests cannot publish after returning and refresh uses a new request',async()=>{
 const pending=[],shown=[];const monitor=createWeatherMonitor({load:signal=>new Promise(resolve=>pending.push({signal,resolve})),onResult:value=>shown.push(value),onFailure:()=>{},schedule:()=>1,cancel:()=>{}});
 const first=monitor.refresh();monitor.suspend();assert.equal(pending[0].signal.aborted,true);await monitor.refresh();assert.equal(pending.length,1);
 const next=monitor.resume();assert.equal(pending.length,2);pending[0].resolve('old');pending[1].resolve('new');await Promise.all([first,next]);assert.deepEqual(shown,['new']);monitor.stop();
});
import * as geo from './geo-data.mjs';

test('flood forecast area matching uses exact official municipality codes and never treats missing as safe',()=>{
 const table={version:'20260527',areas:[{code:'830304003200',name:'石神井川',municipalities:['1311800','1311700']},{code:'810103003100',name:'豊平川',municipalities:['0110000']}]};
 assert.deepEqual(geo.floodForecastAreaRelation(table,'830304003200','13118'),{state:'listed',name:'石神井川'});
 assert.equal(geo.floodForecastAreaRelation(table,'830304003200','13106').state,'unknown');
 assert.equal(geo.floodForecastAreaRelation(table,'810103003100','01101').state,'unknown');
 assert.equal(geo.floodForecastAreaRelation(table,'000000000000','13118').state,'unknown');
 assert.equal(geo.floodForecastAreaRelation(null,'830304003200','13118').state,'unknown');
 assert.equal(geo.floodForecastAreaRelation(table,'830304003200','invalid').state,'unknown');
 assert.equal(geo.floodForecastAreaRelation({...table,areas:[...table.areas,table.areas[0]]},'830304003200','13118').state,'unknown');
});

test('the bundled JMA area table relates Shakujii River to Arakawa ward only as a listed municipality',async()=>{
 const {readFile}=await import('node:fs/promises'),table=JSON.parse(await readFile(new URL('./jma-river-areas-20260527.json',import.meta.url),'utf8'));
 assert.equal(table.areas.length,338);assert.deepEqual(geo.floodForecastAreaRelation(table,'830304003200','13118'),{state:'listed',name:'石神井川'});
 assert.equal(geo.floodForecastAreaRelation(table,'830303000103','13118').state,'unknown');
});

test('a representative facility stays near the middle of a municipality despite remote outliers',()=>{
  const shelters=[
    {name:'remote',latitude:36.1,longitude:136.1},
    {name:'west',latitude:36.55,longitude:136.65},
    {name:'middle',latitude:36.56,longitude:136.66},
    {name:'east',latitude:36.57,longitude:136.67},
    {name:'far',latitude:37,longitude:137},
  ];
  assert.equal(geo.representativeShelter(shelters).name,'middle');
  assert.equal(geo.representativeShelter([]),null);
  assert.equal(geo.representativeShelter([{latitude:NaN,longitude:0}]),null);
});

test('weather monitor retries after a failed request and stops cleanly',async()=>{
  assert.equal(typeof geo.createWeatherMonitor,'function');
  let attempts=0,scheduled=null,received=[],failures=0;
  const monitor=geo.createWeatherMonitor({load:async()=>{attempts++;if(attempts===1)throw Error('offline');return 'fresh data'},onResult:value=>received.push(value),onFailure:()=>failures++,schedule:callback=>(scheduled=callback,1),cancel:()=>{scheduled=null}});
  await monitor.refresh();assert.equal(failures,1);assert.ok(scheduled);
  const repeat=scheduled;scheduled=null;await repeat();assert.deepEqual(received,['fresh data']);assert.ok(scheduled);
  monitor.stop();assert.equal(scheduled,null);await monitor.refresh();assert.equal(attempts,2);
});
test('weather monitor ignores a result arriving after the region is changed',async()=>{
  let release,seen=[];const monitor=geo.createWeatherMonitor({load:()=>new Promise(resolve=>{release=resolve}),onResult:value=>seen.push(value),onFailure:()=>{},schedule:()=>assert.fail('stopped monitor rescheduled'),cancel:()=>{}});
  const pending=monitor.refresh();monitor.stop();release('old region');await pending;assert.deepEqual(seen,[]);
});
test('official JMA warning links use the selected municipality',()=>{
  assert.equal(typeof geo.jmaWarningLink,'function');
  assert.equal(geo.jmaWarningLink('13118'),'https://www.jma.go.jp/bosai/warning/#area_type=class20s&area_code=1311800');
  assert.throws(()=>geo.jmaWarningLink('not-a-code'));
});
test('only the identified rain product is read from the new warning feed',()=>{
  assert.equal(typeof geo.jmaRainProduct,'function');
  const rain={dataTypeCode:'VPWW55',reportDatetime:'2026-11-01T15:00:00+09:00',headlineText:'大雨'};
  assert.equal(geo.jmaRainProduct([{dataTypeCode:'VPWW58',headlineText:'暴風'},rain]),rain);
  assert.throws(()=>geo.jmaRainProduct([{dataTypeCode:'VPWW58'}]));
  assert.throws(()=>geo.jmaRainProduct([rain,rain]));
  assert.throws(()=>geo.jmaRainProduct({reportDatetime:rain.reportDatetime}));
});

test('straight-line ground distance is approximate and rejects invalid points',()=>{
  assert.equal(straightDistance({latitude:35,longitude:139},{latitude:35,longitude:139}),0);
  assert.ok(Math.abs(straightDistance({latitude:0,longitude:0},{latitude:0,longitude:1})-111195)<20);
  assert.throws(()=>straightDistance({latitude:100,longitude:0},{latitude:0,longitude:0}));
});

test('finds the issuing office through JMA regional hierarchy',()=>{
  const areas={class20s:{'1311800':{parent:'130012'}},class15s:{'130012':{parent:'130010'}},class10s:{'130010':{parent:'130000'}},offices:{'130000':{name:'東京都'}}};
  assert.equal(jmaOffice(areas,'13118'),'130000');assert.equal(jmaOffice(areas,'99999'),null);
});
test('old or malformed weather data cannot be presented as current',()=>{
  assert.equal(weatherSummary({reportDatetime:'2020-01-01T00:00:00Z',headlineText:'情報'},Date.parse('2026-11-01T00:00:00Z')).fresh,false);
  assert.throws(()=>weatherSummary({reportDatetime:'invalid'},Date.now()));
});

test('catalog keeps only real municipality building datasets and deduplicates years',()=>{
  const rows={datasets:[{type_en:'bldg',format:'3D Tiles',pref:'北海道',city:'札幌市',city_code:'01100',ward:'中央区',ward_code:'01101'}, {type_en:'bldg',format:'3D Tiles',pref:'北海道',city:'札幌市',city_code:'01100',ward:'中央区',ward_code:'01101'}, {type_en:'fld',format:'3D Tiles',city_code:'12345'}]};
  assert.deepEqual(catalogAreas(rows),[{code:'01101',cityCode:'01100',area:'北海道札幌市中央区',areaPrefix:'北海道札幌市中央区'}]);
});
test('textured building filter uses only the latest known year and valid LOD2 or LOD3 entries',()=>{
  const base={type_en:'bldg',format:'3D Tiles',pref:'東京都',city:'台東区',city_code:'13106'};
  const data={datasets:[{...base,year:2024,lod:'3',texture:true},{...base,year:2025,lod:'2',texture:false},{...base,year:2025,lod:'3',texture:true},{...base,city_code:'13107',year:2024,lod:'2',texture:true},{...base,city_code:'13107',year:2025,lod:'2',texture:false},{...base,city_code:'13108',year:2025,lod:'1',texture:true},{...base,city_code:'13109',year:null,lod:'3',texture:true},{...base,city_code:'bad',year:2025,lod:'3',texture:true}]};
  assert.deepEqual([...geo.catalogTexturedAreas(data)],['13106']);
  assert.throws(()=>geo.catalogTexturedAreas({datasets:null}));
});
test('locates a city from its geographic tileset bounds and limits shelter requests',()=>{
  const r=tilesetRegion({root:{children:[{boundingVolume:{region:[2.43,.62,2.44,.63,0,100]}}]}});
  assert.ok(r.longitude>139&&r.longitude<140);assert.ok(r.latitude>35&&r.latitude<37);
  assert.equal(tilesetRegion({root:{children:[]}}),null);
  assert.throws(()=>tilesForBounds({west:-100,east:100,south:-60,north:60},10,9));
});

test('reads survey years from dataset identifiers and leaves unknown years unknown',()=>{
  assert.deepEqual(buildingYears({root:{children:[{content:{uri:'https://example/13118_arakawa_pref_2025_citygml_x/tileset.json'}}]}}),[2025]);
  assert.deepEqual(buildingYears({root:{children:[{content:{uri:'https://example/unknown/tileset.json'}}]}}),[]);
});
test('reads available building detail levels from child dataset identifiers without guessing',()=>{
  const data={root:{children:[{content:{uri:'https://example/13106_bldg_3dtiles_lod3/tileset.json'}},{content:{uri:'https://example/other_lod2_no_texture/tileset.json'}},{content:{uri:'https://example/unknown/tileset.json'}}]}};
  assert.deepEqual(geo.buildingLevels(data),[2,3]);
  assert.deepEqual(geo.buildingLevels({root:{children:[{content:{uri:'https://example/unknown'}}]}}),[]);
});

test('study areas use known municipal codes and reject unconfigured places',()=>{
  assert.equal(areaByCode('13118').area,'東京都荒川区');
  assert.equal(areaByCode('13101').area,'東京都千代田区');
  assert.throws(()=>areaByCode('99999'));
});
test('maps the Arakawa study point to the documented GSI zoom 10 tile',()=>{
  assert.deepEqual(tileFor(35.735,139.78,10),{z:10,x:909,y:403});
  assert.throws(()=>tileFor(90,0,10));
});
test('retains only usable flood-site records in the study municipality',()=>{
  const data={features:[
    {geometry:{type:'Point',coordinates:[139.78,35.73]},properties:{name:'テスト校',address:'東京都荒川区西日暮里1',disaster1:1}},
    {geometry:{type:'Point',coordinates:[139.78,35.73]},properties:{name:'他の地域',address:'東京都台東区1',disaster1:1}},
    {geometry:{type:'Point',coordinates:[999,35]},properties:{name:'不正な地点',address:'東京都荒川区1',disaster1:1}},
    {geometry:{type:'Point',coordinates:[139.78,35.73]},properties:{name:'別の災害',address:'東京都荒川区1',disaster1:0}},
  ]};
  assert.deepEqual(selectFloodShelters(data,DATA.areaPrefix).map(s=>s.name),['テスト校']);
  assert.throws(()=>selectFloodShelters({},DATA.areaPrefix));
});


test('building mode uses only the selected municipality and rejects invalid choices',()=>{
  assert.match(geo.buildingDataUrl('13106','detailed'),/13106-bldg-maxlod2-latest\/tileset\.json$/);
  assert.match(geo.buildingDataUrl('13106','highest'),/13106-bldg-maxlod3-latest\/tileset\.json$/);
  assert.match(geo.buildingDataUrl('13106','simple'),/13106-bldg-lod1-latest\/tileset\.json$/);
  assert.throws(()=>geo.buildingDataUrl('13106','unknown'));
  assert.throws(()=>geo.buildingDataUrl('13106/../../','simple'));
});


test('rain layer accepts only fresh observed JMA times, not forecasts or malformed entries',()=>{
  const now=Date.parse('2026-11-01T10:12:00Z');
  const observed={basetime:'20261101101000',validtime:'20261101101000',elements:['hrpns','hrpns_nd']};
  assert.equal(geo.jmaRainTime([observed],now),'20261101101000');
  assert.throws(()=>geo.jmaRainTime([{...observed,validtime:'20261101103000'}],now));
  assert.throws(()=>geo.jmaRainTime([{...observed,validtime:'20261101090000',basetime:'20261101090000'}],now));
  assert.throws(()=>geo.jmaRainTime([{...observed,elements:['hrpns']}],now));
});
test('rain missing-data mask rejects unsupported shapes and preserves coverage holes',()=>{
  const geometry={type:'Polygon',coordinates:[[[-45,85],[315,85],[315,-85],[-45,-85]],[[139,35],[140,35],[140,36],[139,36],[139,35]]]};
  const mask=geo.jmaRainMask({type:'FeatureCollection',features:[{geometry,properties:{level:'NoData'}}]});
  assert.equal(mask.length,1);assert.equal(mask[0].points.length,5);
  assert.throws(()=>geo.jmaRainMask({type:'FeatureCollection',features:[]}));
  assert.throws(()=>geo.jmaRainMask({type:'FeatureCollection',features:[{geometry:{...geometry,type:'MultiPolygon'},properties:{level:'NoData'}}]}));
});


test('cancelled rain tile requests are retried rather than reported as missing',async()=>{
  let failures=0,changes=0;const cancel={state:'cancelled'};
  const request=geo.rainTileRequest(()=>Promise.reject(new Error('cancelled')),(_image,_x,_y,_z,failed)=>failed?'missing':'image',()=>failures++,()=>changes++,r=>r?.state==='cancelled');
  await assert.rejects(request(1,1,10,cancel),/cancelled/);
  assert.equal(failures,0);assert.equal(changes,0);
  assert.equal(await request(1,1,10,{state:'failed'}),'missing');
  assert.equal(failures,1);assert.equal(changes,1);
});
test('rain tiles that change the rendered frame notify the consultation lifecycle',async()=>{
  let changes=0;const request=geo.rainTileRequest(()=>Promise.resolve('rain'),image=>image,()=>{},()=>changes++,()=>false);
  assert.equal(await request(1,1,10,{}),'rain');assert.equal(changes,1);
});
