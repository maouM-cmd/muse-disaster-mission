export const AREAS=Object.freeze([
  {code:'13118',area:'東京都荒川区',areaPrefix:'東京都荒川区',latitude:35.735,longitude:139.78},
  {code:'13101',area:'東京都千代田区',areaPrefix:'東京都千代田区',latitude:35.694,longitude:139.754},
  {code:'13106',area:'東京都台東区',areaPrefix:'東京都台東区',latitude:35.713,longitude:139.78},
]);
export function areaByCode(code){const area=AREAS.find(item=>item.code===code);if(!area)throw new Error('この地域はまだ利用できません');return area}
export function parseZonedTimestamp(value){
 if(typeof value!=='string')return null;
 const m=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-](\d{2}):(\d{2}))$/.exec(value);if(!m)return null;
 const [,year,month,day,hour,minute,second,zone,offsetHour,offsetMinute]=m,y=Number(year),mo=Number(month),d=Number(day),h=Number(hour),mi=Number(minute),s=Number(second);
 const leap=y%4===0&&(y%100!==0||y%400===0),days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
 if(mo<1||mo>12||d<1||d>days[mo-1]||h>23||mi>59||s>59)return null;
 if(zone!=='Z'&&(Number(offsetHour)>14||Number(offsetMinute)>59||(Number(offsetHour)===14&&Number(offsetMinute)>0)))return null;
 const parsed=Date.parse(value);return Number.isFinite(parsed)?parsed:null;
}
export function floodForecastAreaRelation(table,forecastCode,municipalityCode){
  const unknown={state:'unknown'};
  if(!table||table.version!=='20260527'||!Array.isArray(table.areas)||table.areas.length===0||table.areas.length>1000||typeof forecastCode!=='string'||!/^\d{12}$/.test(forecastCode)||typeof municipalityCode!=='string'||!/^\d{5}$/.test(municipalityCode))return unknown;
  const ids=new Set();for(const row of table.areas){if(!row||typeof row.code!=='string'||!/^\d{12}$/.test(row.code)||ids.has(row.code)||typeof row.name!=='string'||!row.name.trim()||!Array.isArray(row.municipalities)||!row.municipalities.length||row.municipalities.some(code=>typeof code!=='string'||!/^\d{7}$/.test(code)))return unknown;ids.add(row.code)}
  const row=table.areas.find(item=>item.code===forecastCode);return row?.municipalities.includes(municipalityCode+'00')?{state:'listed',name:row.name}:unknown;
}
export function floodBulletinWaterValues(root){
  const main='http://xml.kishou.go.jp/jmaxml1/',bodyNs='http://xml.kishou.go.jp/jmaxml1/body/meteorology1/',elementNs='http://xml.kishou.go.jp/jmaxml1/elementBasis1/';
  const children=(parent,space,name)=>Array.from(parent?.children||[]).filter(node=>node.namespaceURI===space&&node.localName===name),one=(parent,space,name)=>children(parent,space,name)[0],text=(parent,space,name)=>one(parent,space,name)?.textContent?.trim().slice(0,200)||'';
  const rows=[];let truncated=false;if(root?.namespaceURI!==main||root.localName!=='Report')return {rows,truncated};
  const body=one(root,bodyNs,'Body');
  for(const group of children(body,bodyNs,'MeteorologicalInfos').filter(node=>node.getAttribute('type')==='水位・流量情報'))for(const series of children(group,bodyNs,'TimeSeriesInfo')){
    const times=new Map();for(const item of children(one(series,bodyNs,'TimeDefines'),bodyNs,'TimeDefine')){const id=item.getAttribute('timeId');if(!id)continue;const at=text(item,bodyNs,'DateTime'),label=text(item,bodyNs,'Name'),validTime=parseZonedTimestamp(at)!==null;if(times.has(id))times.set(id,null);else times.set(id,{at:validTime?at:'',label})}
    for(const item of children(series,bodyNs,'Item')){
      const station=one(item,bodyNs,'Station'),name=text(station,bodyNs,'Name'),code=text(station,bodyNs,'Code'),codes=children(station,bodyNs,'Code'),stationCodeType=codes.length===1?codes[0].getAttribute('type')||'':'',location=text(station,bodyNs,'Location'),kind=one(item,bodyNs,'Kind');
      for(const property of children(kind,bodyNs,'Property'))for(const part of children(property,bodyNs,'WaterLevelPart'))for(const level of children(part,elementNs,'WaterLevel')){
        if(level.getAttribute('type')!=='水位')continue;
        if(rows.length>=100){truncated=true;continue}
        const time=times.get(level.getAttribute('refID'))||null;
        rows.push({station:name,code,stationCodeType,location,time:time?.at||'',label:time?.label||'',value:level.textContent.trim().slice(0,100),unit:(level.getAttribute('unit')||'').slice(0,30),condition:(level.getAttribute('condition')||'').slice(0,100)});
      }
    }
  }
  return {rows,truncated};
}
export function officialMapLinks(point){
  if(!Number.isFinite(point?.latitude)||!Number.isFinite(point?.longitude)||Math.abs(point.latitude)>90||Math.abs(point.longitude)>180)throw new Error('地点の座標が不正です');
  const center=`zoom:12/lat:${point.latitude.toFixed(3)}/lon:${point.longitude.toFixed(3)}/colordepth:normal`;
  return {flood:`https://www.jma.go.jp/bosai/risk/#${center}/elements:flood`,inundation:`https://www.jma.go.jp/bosai/risk/#${center}/elements:inund`,rain:`https://www.jma.go.jp/bosai/nowc/#${center}/elements:hrpns`};
}
// This path is a visual exercise over the map, not a real flight plan.
export function mapSimulationPath(start,end,side='A'){
  const valid=p=>Number.isFinite(p?.latitude)&&Number.isFinite(p?.longitude)&&Math.abs(p.latitude)<80&&Math.abs(p.longitude)<=180;
  if(!valid(start)||!valid(end)||!['A','B'].includes(side))throw new Error('地点または仮想ルートが不正です');
  const distance=straightDistance(start,end);
  if(distance<50||distance>20000||Math.abs(start.longitude-end.longitude)>180)throw new Error('地点間は50m以上20km以内にしてください');
  const midLat=(start.latitude+end.latitude)/2*Math.PI/180,scale=Math.cos(midLat);
  const x=(end.longitude-start.longitude)*scale,y=end.latitude-start.latitude;
  const point=(t,offset=0)=>({latitude:start.latitude+(end.latitude-start.latitude)*t+x*offset,longitude:start.longitude+(end.longitude-start.longitude)*t-y*offset/scale});
  const stop=point(.35);
  const offset=side==='A'?.22:-.22;
  return {direct:[{...start},stop],obstacle:point(.5),detour:[stop,point(.42,offset),point(.65,offset),{...end}]};
}
// Fictional illustration only: these coordinates are not observations of real wires.
export function virtualWireGeometry(start,end){
  mapSimulationPath(start,end);
  const distance=straightDistance(start,end),scale=Math.cos((start.latitude+end.latitude)/2*Math.PI/180);
  const x=(end.longitude-start.longitude)*scale,y=end.latitude-start.latitude;
  const span=Math.min(.12,35/distance),step=Math.min(.01,1.5/distance);
  return [-1,0,1].map(strand=>Array.from({length:9},(_,i)=>{
    const u=i/4-1,t=.5+strand*step,offset=u*span;
    return {latitude:start.latitude+(end.latitude-start.latitude)*t+x*offset,longitude:start.longitude+(end.longitude-start.longitude)*t-y*offset/scale,height:180+strand*1.1-(1-u*u)};
  }));
}
export function mapSimulationPosition(path,progress){
  if(!Array.isArray(path)||path.length<2||!Number.isFinite(progress))throw new Error('経路が不正です');
  const p=Math.max(0,Math.min(1,progress))*(path.length-1),i=Math.min(path.length-2,Math.floor(p)),f=p-i,a=path[i],b=path[i+1];
  if(!a||!b||![a.latitude,a.longitude,b.latitude,b.longitude].every(Number.isFinite))throw new Error('経路が不正です');
  return {latitude:a.latitude+(b.latitude-a.latitude)*f,longitude:a.longitude+(b.longitude-a.longitude)*f};
}
export function routeSamplePoints(path){
  if(!Array.isArray(path)||path.length<2||path.length>10||path.some(p=>!Number.isFinite(p?.latitude)||!Number.isFinite(p?.longitude)||Math.abs(p.latitude)>90||Math.abs(p.longitude)>180))throw new Error('経路が不正です');
  const segments=path.slice(1).map((end,i)=>({start:path[i],end,distance:straightDistance(path[i],end),steps:1}));
  if(segments.some(s=>Math.abs(s.start.longitude-s.end.longitude)>180))throw new Error('経路が不正です');
  let steps=segments.length;
  while(steps<48){const largest=segments.reduce((a,b)=>a.distance/a.steps>=b.distance/b.steps?a:b);if(largest.distance/largest.steps<=29)break;largest.steps++;steps++}
  const points=[{...path[0]}];let maxGap=0;
  for(const {start:a,end:b,steps:count} of segments){
    for(let step=1;step<=count;step++){const t=step/count,point={latitude:a.latitude+(b.latitude-a.latitude)*t,longitude:a.longitude+(b.longitude-a.longitude)*t};maxGap=Math.max(maxGap,straightDistance(points.at(-1),point));points.push(point)}
  }
  return {points,maxGap};
}
const ROUTE_SURFACE_LIMIT=175;
export function routeSampleReport(heights,limit=ROUTE_SURFACE_LIMIT){
  if(!Array.isArray(heights)||!heights.length||!Number.isFinite(limit))throw new Error('確認結果が不正です');
  const blockedIndices=[];let observed=0;
  heights.forEach((height,index)=>{if(Number.isFinite(height)){observed++;if(height>=limit)blockedIndices.push(index)}});
  return {observed,unknown:heights.length-observed,blockedIndices};
}
export function routeSampleMarkers(points,heights){
  if(!Array.isArray(points)||!points.length||!Array.isArray(heights)||points.length!==heights.length)throw new Error('点検結果が不正です');
  return points.map((point,index)=>({point,state:!Number.isFinite(heights[index])?'unknown':heights[index]>=ROUTE_SURFACE_LIMIT?'high':'observed'}));
}
export function routeReportComplete(report){
  return Number.isInteger(report?.total)&&report.total>0&&report.observed===report.total&&report.unknown===0&&Number.isFinite(report.maxGap)&&report.maxGap>=0&&report.maxGap<=29&&Array.isArray(report.blockedIndices)&&report.blockedIndices.length===0;
}
export function canReplayMapRoute(reports,side){
  return ['A','B'].includes(side)&&!reports?.stale&&routeReportComplete(reports?.[side]);
}
export function mapDroneParts(){
  const parts=[
    {kind:'body',offset:[0,0,-.06],size:[.82,1.3,.32],color:'#343b3e'},
    {kind:'hull',shape:'ellipsoid',offset:[0,0,.10],size:[1.02,1.54,.48],color:'#424b4d'},
    {kind:'panel',offset:[0,0,.34],size:[.65,1.06,.12],color:'#606b6c'},
    {kind:'panel',offset:[0,-.24,.42],size:[.47,.48,.04],color:'#242d30'},
    {kind:'panel',offset:[-.38,0,.17],size:[.12,1.12,.16],color:'#242d30'},
    {kind:'panel',offset:[.38,0,.17],size:[.12,1.12,.16],color:'#242d30'},
    {kind:'panel',offset:[0,.29,.415],size:[.50,.07,.035],color:'#df792c'},
    {kind:'panel',offset:[0,-.53,.415],size:[.50,.05,.035],color:'#df792c'},
    {kind:'sensor',offset:[0,.78,-.08],size:[.42,.22,.25],color:'#17262c'},
    {kind:'sensor',shape:'ellipsoid',offset:[-.1,.91,-.06],size:[.11,.07,.11],color:'#8ab7c1'},
    {kind:'sensor',shape:'ellipsoid',offset:[.1,.91,-.06],size:[.11,.07,.11],color:'#8ab7c1'},
    {kind:'sensor',shape:'ellipsoid',offset:[0,.81,-.22],size:[.23,.22,.23],color:'#1c2b31'},
    {kind:'sensor',shape:'ellipsoid',offset:[0,.91,-.22],size:[.12,.07,.12],color:'#668f9c'},
    {kind:'panel',offset:[0,.885,-.06],size:[.38,.035,.30],color:'#141d21'},
    {kind:'panel',offset:[0,.91,-.29],size:[.23,.04,.05],color:'#ed9b43'},
    {kind:'panel',offset:[0,-.66,.08],size:[.46,.04,.25],color:'#20292c'},
    {kind:'panel',offset:[0,-.685,.08],size:[.055,.025,.17],color:'#e5782e'},
    {kind:'panel',offset:[-.30,0,.425],size:[.055,.98,.025],color:'#df792c'},
    {kind:'panel',offset:[.30,0,.425],size:[.055,.98,.025],color:'#df792c'},
    {kind:'panel',offset:[0,-.08,.445],size:[.26,.48,.025],color:'#273135'},
    {kind:'battery',offset:[0,-.43,.43],size:[.48,.28,.10],color:'#20292c'},
    {kind:'cargo',offset:[0,0,-1.15],size:[.8,1,.55],color:'#d6d9d3'},
    {kind:'cargo-mark',offset:[0,0,-1.15],size:[.85,.13,.57],color:'#ec7827'},
    {kind:'cargo-lid',offset:[0,0,-.86],size:[.84,1.04,.055],color:'#4e5959'},
    {kind:'cargo-foot',offset:[0,0,-1.44],size:[.84,1.04,.055],color:'#4e5959'},
    {kind:'cargo-strap',offset:[-.3,0,-1.15],size:[.055,1.04,.59],color:'#353f40'},
    {kind:'cargo-strap',offset:[.3,0,-1.15],size:[.055,1.04,.59],color:'#353f40'},
    {kind:'cargo-reflector',offset:[0,.525,-1.15],size:[.38,.025,.16],color:'#ef9b44'},
    {kind:'cargo-panel',offset:[0,.538,-1.15],size:[.60,.02,.34],color:'#bbc2be'},
    {kind:'cargo-handle',offset:[0,.552,-1.08],size:[.28,.03,.05],color:'#364144'},
    {kind:'cargo-reflector',offset:[0,.553,-1.29],size:[.19,.02,.045],color:'#f29642'},
    {kind:'cargo-panel',offset:[0,-.538,-1.15],size:[.60,.02,.34],color:'#bbc2be'},
    {kind:'cargo-handle',offset:[0,-.552,-1.08],size:[.28,.03,.05],color:'#364144'},
    {kind:'cable',offset:[-.29,0,-.62],size:[.035,.035,.7],color:'#20272a'},
    {kind:'cable',offset:[.29,0,-.62],size:[.035,.035,.7],color:'#20272a'},
    {kind:'skid',offset:[-.79,0,-1.52],size:[.09,1.62,.09],color:'#20272a'},
    {kind:'skid',offset:[.79,0,-1.52],size:[.09,1.62,.09],color:'#20272a'},
    {kind:'skid-crossbar',offset:[0,-.74,-1.52],size:[1.66,.07,.07],color:'#293336'},
    {kind:'skid-crossbar',offset:[0,.74,-1.52],size:[1.66,.07,.07],color:'#293336'}
  ];
  for(const x of [-1,1])for(const z of [-1,1])parts.push({kind:'lens',shape:'ellipsoid',offset:[x*.095,.918,-.06+z*.065],size:[.075,.04,.075],color:'#7da7b2'});
  for(const y of [-.25,-.15,-.05,.05,.15])parts.push({kind:'vent',offset:[0,y,.462],size:[.18,.025,.018],color:'#111b1e'});
  for(const x of [-1,1])for(const y of [-1,1]){
    parts.push({kind:'skid-support',offset:[x*.60,y*.5,-.78],size:[.10,.10,1.53],pitch:x*.25,color:'#20272a'});
    parts.push({kind:'skid-joint',shape:'ellipsoid',offset:[x*.79,y*.5,-1.52],size:[.17,.17,.17],color:'#435052'});
    parts.push({kind:'cargo-corner',offset:[x*.39,y*.49,-1.41],size:[.13,.13,.09],color:'#303a3c'});
    parts.push({kind:'cargo-corner',offset:[x*.39,y*.49,-.89],size:[.13,.13,.09],color:'#303a3c'});
    parts.push({kind:'cargo-guard',offset:[x*.4,y*.5,-1.15],size:[.07,.07,.58],color:'#394345'});
  }
  for(const x of [-1,1])for(const y of [-1.1,0,1.1]){
    const x0=x*.2,y0=y*.32,x1=x*1.4,y1=y,dx=x1-x0,dy=y1-y0;
    parts.push({kind:'arm',offset:[(x0+x1)/2,(y0+y1)/2,.03],size:[Math.hypot(dx,dy),.19,.19],yaw:-Math.atan2(dy,dx),color:'#20272a'});
    parts.push({kind:'arm-band',offset:[x0+dx*.68,y0+dy*.68,.03],size:[.19,.205,.205],yaw:-Math.atan2(dy,dx),color:'#d87128'});
    parts.push({kind:'arm-joint',shape:'ellipsoid',offset:[x0+dx*.12,y0+dy*.12,.03],size:[.22,.22,.20],color:'#465153'});
    parts.push({kind:'rotor',offset:[x*1.4,y,.15],size:[.42,.42,.18],color:'#424b4e'});
    parts.push({kind:'motor-band',offset:[x*1.4,y,.05],size:[.44,.44,.04],color:'#da742b'});
    parts.push({kind:'motor-band',offset:[x*1.4,y,.25],size:[.30,.30,.05],color:'#1b2225'});
    parts.push({kind:'motor-cap',shape:'ellipsoid',offset:[x*1.4,y,.285],size:[.19,.19,.08],color:'#697779'});
    parts.push({kind:'blade',offset:[x*1.4,y,.27],size:[1.05,.095,.035],color:'#101719',spin:1});
    parts.push({kind:'blade',offset:[x*1.4,y,.27],size:[1.05,.095,.035],color:'#101719',spin:1,phase:Math.PI/2});
    parts.push({kind:'lamp',offset:[x*1.3,y*.93,-.02],size:[.15,.16,.1],color:'#f28b36'});
  }
  return parts;
}
export const DATA=Object.freeze({
  area:'東京都荒川区',areaPrefix:'東京都荒川区',latitude:35.735,longitude:139.78,
  buildings:'https://api.plateauview.mlit.go.jp/datacatalog/3dtiles/{code}-bldg-maxlod2-latest/tileset.json',
  basemap:'https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png',
  photomap:'https://cyberjapandata.gsi.go.jp/xyz/{layer}/{z}/{x}/{y}.{format}',
  plateauPhoto:'https://tile.plateauview.mlit.go.jp/tiles/plateau-ortho-2023/{z}/{x}/{y}.png',
  floodRisk:'https://disaportaldata.gsi.go.jp/raster/01_flood_l2_shinsuishin_data/{z}/{x}/{y}.png',
  shelters:'https://cyberjapandata.gsi.go.jp/xyz/skhb01/{z}/{x}/{y}.geojson',
  catalog:'https://api.plateauview.mlit.go.jp/datacatalog/plateau-datasets'
});
export function buildingDataUrl(code,mode='detailed'){
  if(typeof code!=='string'||!/^\d{5}$/.test(code)||!['detailed','highest','simple'].includes(mode))throw new Error('建物データの指定が不正です');
  const url=DATA.buildings.replace('{code}',code);
  return mode==='detailed'?url:url.replace('-maxlod2-',mode==='highest'?'-maxlod3-':'-lod1-');
}
export function jmaRainTime(rows,now=Date.now()){
  if(!Array.isArray(rows)||!Number.isFinite(now))throw new Error('雨雲データの時刻が不正です');
  const times=rows.filter(r=>r?.basetime===r?.validtime&&Array.isArray(r.elements)&&r.elements.includes('hrpns')&&r.elements.includes('hrpns_nd')).map(r=>r.validtime).filter(t=>typeof t==='string'&&/^\d{14}$/.test(t)).sort().reverse();
  for(const value of times){
    const iso=`${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6,8)}T${value.slice(8,10)}:${value.slice(10,12)}:${value.slice(12,14)}.000Z`,time=Date.parse(iso);
    if(Number.isFinite(time)&&new Date(time).toISOString()===iso&&now-time>=-120000&&now-time<=1200000)return value;
  }
  throw new Error('新しい雨雲の解析時刻を確認できません');
}
export function jmaRainMask(data){
  const feature=data?.features?.[0],geometry=feature?.geometry,rings=geometry?.coordinates;
  if(data?.type!=='FeatureCollection'||data.features.length!==1||feature?.properties?.level!=='NoData'||geometry?.type!=='Polygon'||!Array.isArray(rings)||!Array.isArray(rings[0])||rings[0].length!==4||JSON.stringify(rings[0])!==JSON.stringify([[-45,85],[315,85],[315,-85],[-45,-85]]))throw new Error('雨雲の欠測情報を確認できません');
  return rings.slice(1).map(ring=>{
    if(!Array.isArray(ring)||ring.length<4)throw new Error('雨雲の欠測情報が不正です');
    const points=ring.map(p=>{if(!Array.isArray(p)||p.length<2||!Number.isFinite(p[0])||!Number.isFinite(p[1])||Math.abs(p[0])>180||Math.abs(p[1])>85)throw new Error('雨雲の欠測情報が不正です');const rad=p[1]*Math.PI/180;return [(p[0]+180)/360,(1-Math.asinh(Math.tan(rad))/Math.PI)/2]});
    let minX=1,maxX=0,minY=1,maxY=0;for(const [x,y] of points){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y)}
    return {points,minX,maxX,minY,maxY};
  });
}
export function rainTileRequest(request,render,onFailure,onChange,isCancelled){
  return (x,y,level,requestInfo)=>{
    if(level<4)return Promise.resolve(render(null,x,y,level,true));
    let pending;try{pending=request(x,y,level,requestInfo)}catch(error){pending=Promise.reject(error)}
    if(pending===undefined)return undefined;
    return Promise.resolve(pending).then(image=>{const canvas=render(image,x,y,level,false);onChange();return canvas}).catch(error=>{if(isCancelled(requestInfo))throw error;onFailure();const canvas=render(null,x,y,level,true);onChange();return canvas});
  };
}
export function withImageryFallback(request,blank,onMissing){
  return (x,y,level,signal)=>{
    if(level<14)return Promise.resolve(blank);
    let result;try{result=request(x,y,level,signal)}catch{onMissing();return Promise.resolve(blank)}
    return result===undefined?undefined:Promise.resolve(result).catch(()=>{onMissing();return blank});
  };
}
export const FLOOD_IMAGERY_BOUNDS=Object.freeze({west:122,south:20,east:154,north:46});
export function tileFor(lat,lon,z){
  if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>85.0511||Math.abs(lon)>180||!Number.isInteger(z)||z<0||z>22)throw new Error('地図座標が不正です');
  const n=2**z,rad=lat*Math.PI/180;
  return {z,x:Math.min(n-1,Math.floor((lon+180)/360*n)),y:Math.min(n-1,Math.max(0,Math.floor((1-Math.asinh(Math.tan(rad))/Math.PI)*n/2)))};
}
export function floodPixelFor(point){
  const z=17,{x,y}=tileFor(point?.latitude,point?.longitude,z),n=2**z;
  const wx=Math.min(n*256-1,Math.floor((point.longitude+180)/360*n*256));
  const rad=point.latitude*Math.PI/180;
  const wy=Math.min(n*256-1,Math.max(0,Math.floor((1-Math.asinh(Math.tan(rad))/Math.PI)/2*n*256)));
  return {z,x,y,px:wx-x*256,py:wy-y*256};
}
export function floodDepthFromPixel(pixel){
  if(!pixel||pixel.length!==4||pixel[3]!==255)return null;
  const colors={'247,245,169':'0.5m未満','255,216,192':'0.5〜3.0m','255,183,183':'3.0〜5.0m','255,145,145':'5.0〜10.0m','242,133,201':'10.0〜20.0m','220,122,220':'20.0m以上'};
  return colors[Array.from(pixel).slice(0,3).join(',')]||null;
}
export function selectFloodShelters(data,prefix){
  if(!Array.isArray(data?.features))throw new Error('避難場所データを読み取れません');
  return data.features.flatMap(f=>{const p=f?.properties,g=f?.geometry,c=g?.coordinates;
    if(g?.type!=='Point'||!Array.isArray(c)||!Number.isFinite(c[0])||!Number.isFinite(c[1])||Math.abs(c[0])>180||Math.abs(c[1])>90||p?.disaster1!==1||typeof p.address!=='string'||!p.address.startsWith(prefix)||typeof p.name!=='string'||!p.name.trim())return [];
    return [{name:p.name,address:p.address,longitude:c[0],latitude:c[1]}];
  });
}
export function representativeShelter(shelters){
  if(!Array.isArray(shelters))return null;
  const valid=shelters.filter(s=>Number.isFinite(s?.latitude)&&Number.isFinite(s?.longitude)&&Math.abs(s.latitude)<=90&&Math.abs(s.longitude)<=180);
  if(!valid.length)return null;
  const median=values=>values.sort((a,b)=>a-b)[Math.floor(values.length/2)];
  const center={latitude:median(valid.map(s=>s.latitude)),longitude:median(valid.map(s=>s.longitude))};
  return valid.reduce((best,s)=>straightDistance(center,s)<straightDistance(center,best)?s:best);
}
export function filterShelters(shelters,query){
  const term=String(query||'').normalize('NFKC').trim().toLocaleLowerCase('ja-JP');
  return shelters.flatMap((s,index)=>`${s.name} ${s.address}`.normalize('NFKC').toLocaleLowerCase('ja-JP').includes(term)?[{...s,index}]:[]);
}
export function nearbyShelters(shelters,origin,query){
  try{straightDistance(origin,origin)}catch{return []}
  return filterShelters(shelters,query).flatMap(item=>{try{return [{...item,distance:straightDistance(origin,item)}]}catch{return []}})
    .sort((a,b)=>a.distance-b.distance||a.index-b.index).slice(0,3);
}
export function secondFleetCandidates(shelters,origin,primaryIndex){
  if(!Array.isArray(shelters)||!Number.isInteger(primaryIndex)||!shelters[primaryIndex])return [];
  const primary=shelters[primaryIndex];
  try{straightDistance(origin,primary)}catch{return []}
  return shelters.flatMap((item,index)=>{
    try{const distance=straightDistance(origin,item),separation=straightDistance(primary,item);return index!==primaryIndex&&distance>=50&&distance<=20000&&separation>=50?[{...item,index,distance}]:[]}catch{return []}
  }).sort((a,b)=>a.distance-b.distance||a.index-b.index);
}
export function secondFleetDestination(shelters,origin,primaryIndex){return secondFleetCandidates(shelters,origin,primaryIndex)[0]||null}
export function buildingYears(data){
  const children=Array.isArray(data?.root?.children)?data.root.children:[];
  return [...new Set(children.flatMap(c=>{const uri=c?.content?.uri;if(typeof uri!=='string')return [];const match=uri.match(/_(20\d{2})_citygml_/);return match?[Number(match[1])]:[]}))].sort();
}
export function buildingLevels(data){
  const children=Array.isArray(data?.root?.children)?data.root.children:[];
  return [...new Set(children.flatMap(child=>{const uri=child?.content?.uri;if(typeof uri!=='string')return [];const match=uri.match(/_lod([1-3])(?:_|\/|$)/i);return match?[Number(match[1])]:[]}))].sort();
}
export function catalogAreas(data){
  if(!Array.isArray(data?.datasets))throw new Error('地域一覧の形式が不正です');
  const items=new Map();
  for(const row of data.datasets){
    const code=row.ward_code||row.city_code;
    if(row.type_en!=='bldg'||row.format!=='3D Tiles'||!/^\d{5}$/.test(code)||typeof row.pref!=='string'||typeof row.city!=='string')continue;
    const area=row.pref+row.city+(typeof row.ward==='string'?row.ward:'');
    if(area.length>80)continue;items.set(code,{code,cityCode:row.city_code,area,areaPrefix:area});
  }
  return [...items.values()].sort((a,b)=>a.code.localeCompare(b.code));
}
export function catalogTexturedAreas(data){
  if(!Array.isArray(data?.datasets))throw new Error('地域一覧の形式が不正です');
  const latest=new Map();
  for(const row of data.datasets){
    const code=row.ward_code||row.city_code,year=row.year;
    if(row.type_en!=='bldg'||row.format!=='3D Tiles'||!/^\d{5}$/.test(code)||!Number.isInteger(year)||year<2000||year>2100)continue;
    const previous=latest.get(code);if(!previous||year>previous.year)latest.set(code,{year,textured:false});
    const item=latest.get(code);if(year===item.year&&row.texture===true&&['2','3'].includes(String(row.lod)))item.textured=true;
  }
  return new Set([...latest].filter(([,item])=>item.textured).map(([code])=>code));
}
export function tilesetRegion(data){
  const candidates=[data?.root,...(data?.root?.children||[])].flatMap(item=>Array.isArray(item?.boundingVolume?.region)?[item.boundingVolume.region]:[]);
  const valid=candidates.filter(a=>a.length>=4&&a.slice(0,4).every(Number.isFinite)&&a[0]<a[2]&&a[1]<a[3]);
  if(!valid.length)return null;const deg=180/Math.PI;
  const west=Math.min(...valid.map(a=>a[0]))*deg,east=Math.max(...valid.map(a=>a[2]))*deg,south=Math.min(...valid.map(a=>a[1]))*deg,north=Math.max(...valid.map(a=>a[3]))*deg;
  if(west< -180||east>180||south< -85||north>85)return null;
  return {west,east,south,north,longitude:(west+east)/2,latitude:(south+north)/2};
}
export function tilesForBounds(bounds,z,maxTiles=9){
  const nw=tileFor(bounds.north,bounds.west,z),se=tileFor(bounds.south,bounds.east,z),count=(se.x-nw.x+1)*(se.y-nw.y+1);
  if(count<1||count>maxTiles)throw new Error('対象地域が広いため、施設データを一括取得できません');
  const tiles=[];for(let x=nw.x;x<=se.x;x++)for(let y=nw.y;y<=se.y;y++)tiles.push({z,x,y});return tiles;
}

export function jmaOffice(areas,municipalityCode){
  if(!/^\d{5}$/.test(municipalityCode))return null;
  const municipal=areas?.class20s?.[`${municipalityCode}00`];if(!municipal)return null;
  const parent=municipal.parent,level15=areas?.class15s?.[parent],level10=areas?.class10s?.[level15?.parent||parent];
  const code=level10?.parent;return code&&areas?.offices?.[code]?code:null;
}
export function jmaWarningLink(code){
  if(typeof code!=='string'||!/^\d{5}$/.test(code))throw new Error('地域コードが不正です');
  return `https://www.jma.go.jp/bosai/warning/#area_type=class20s&area_code=${code}00`;
}
export function jmaRainProduct(data){
  if(!Array.isArray(data))throw new Error('大雨情報の形式を確認できません');
  const rain=data.filter(row=>row?.dataTypeCode==='VPWW55');
  if(rain.length!==1)throw new Error('大雨情報を特定できません');
  return rain[0];
}
// Preserve the agency's municipality-level wording; do not infer warning validity or safety.
export function jmaMunicipalRainExcerpt(product,municipalityCode){
 if(product?.dataTypeCode!=='VPWW55'||typeof municipalityCode!=='string'||!/^\d{5}$/.test(municipalityCode))return null;
 const items=product?.warning?.class20Items;if(!Array.isArray(items)||items.length>3000)return null;
 const scope=`${municipalityCode}00`,matching=items.filter(item=>item?.areaCode===scope);
 if(matching.length!==1||!Array.isArray(matching[0].kinds)||!matching[0].kinds.length||matching[0].kinds.length>20)return null;
 const kinds=[];
 for(const item of matching[0].kinds){
  if(!item||typeof item.status!=='string'||!item.status.trim()||item.status.length>100||!(item.code===undefined||typeof item.code==='string'&&/^\d{1,10}$/.test(item.code)))return null;
  kinds.push({code:item.code??null,status:item.status.trim()});
 }
 const text=value=>typeof value==='string'&&value.length<=100&&value.trim()?value.trim():null;
 const timestamp=value=>parseZonedTimestamp(value)!==null?value:null;
 return {scope,kinds,infoType:text(product.infoType),office:text(product.publishingOffice),published:timestamp(product.reportDatetime),controlAt:timestamp(product.controlDatetime)};
}
export function jmaBulletinState(infoType){
 return infoType==='取消'?'cancelled':['発表','訂正'].includes(infoType)?'usable':'unknown';
}
export function jmaWarningProofMatches(product,proof){
 if(!product||!proof||product.dataTypeCode!=='VPWW55'||!['発表','訂正','取消'].includes(product.infoType)||product.infoType!==proof.infoType||typeof product.publishingOffice!=='string'||!product.publishingOffice||product.publishingOffice!==proof.office)return false;
 for(const [a,b] of [[product.controlDatetime,proof.controlAt],[product.reportDatetime,proof.published]]){const left=parseZonedTimestamp(a),right=parseZonedTimestamp(b);if(left===null||right===null||left!==right)return false}
 return true;
}
export function jmaWarningProofState(product,proof){
 if(!jmaWarningProofMatches(product,proof))return 'unknown';
 return proof.status==='通常'?'normal':proof.status==='訓練'?'training':proof.status==='試験'?'test':'unknown';
}
export function selectJmaWarningProof(results){
 if(!Array.isArray(results)||!results.length||results.some(item=>!item?.available||!['normal','training','test','unmatched'].includes(item.state)))return 'unknown';
 const known=[...new Set(results.map(item=>item.state).filter(state=>state!=='unmatched'))];
 return known.length===1?known[0]:'unknown';
}
export function jmaWarningFeedUrls(xml,office){
 if(typeof xml!=='string'||xml.length>5000000||/<!DOCTYPE/i.test(xml)||typeof office!=='string'||!/^\d{6}$/.test(office)||typeof DOMParser==='undefined')return [];
 const doc=new DOMParser().parseFromString(xml,'application/xml'),root=doc.documentElement,atom='http://www.w3.org/2005/Atom';if(root.localName!=='feed'||root.namespaceURI!==atom||doc.querySelector('parsererror'))return [];
 const isTarget=value=>{try{const url=new URL(value);return url.protocol==='https:'&&url.hostname==='www.data.jma.go.jp'&&!url.port&&!url.username&&!url.password&&!url.search&&!url.hash&&url.href===value&&new RegExp(`^/developer/xml/data/[0-9]{14}_[0-9]+_VPWW55_${office}\\.xml$`).test(url.pathname)}catch{return false}};
 const candidates=[];for(const entry of Array.from(root.children)){
  if(entry.localName!=='entry'||entry.namespaceURI!==atom)continue;
  const fields=Array.from(entry.children),ids=fields.filter(node=>node.localName==='id'&&node.namespaceURI===atom),dates=fields.filter(node=>node.localName==='updated'&&node.namespaceURI===atom),values=ids.map(node=>node.textContent.trim());
  if(!values.some(isTarget))continue;
  if(values.length!==1||dates.length!==1)return [];
  const updated=parseZonedTimestamp(dates[0].textContent.trim());if(updated===null)return [];
  candidates.push({url:values[0],updated});
 }
 candidates.sort((a,b)=>b.updated-a.updated);return [...new Set(candidates.map(item=>item.url))].slice(0,3);
}
export function parseJmaWarningProof(xml){
 if(typeof xml!=='string'||xml.length>1000000||/<!DOCTYPE/i.test(xml)||typeof DOMParser==='undefined')return null;
 const doc=new DOMParser().parseFromString(xml,'application/xml'),root=doc.documentElement,main='http://xml.kishou.go.jp/jmaxml1/',headNs='http://xml.kishou.go.jp/jmaxml1/informationBasis1/';
 if(root.localName!=='Report'||root.namespaceURI!==main||doc.querySelector('parsererror'))return null;
 const only=(parent,ns,name)=>{const nodes=Array.from(parent?.children||[]).filter(node=>node.namespaceURI===ns&&node.localName===name);return nodes.length===1?nodes[0]:null},text=(parent,ns,name)=>only(parent,ns,name)?.textContent?.trim()||'';
 const control=only(root,main,'Control'),head=only(root,headNs,'Head');if(text(control,main,'Title')!=='気象警報・注意報（Ｒ０６）（大雨）'||text(head,headNs,'InfoKind')!=='気象警報・注意報')return null;
 return {status:text(control,main,'Status'),controlAt:text(control,main,'DateTime'),office:text(control,main,'PublishingOffice'),published:text(head,headNs,'ReportDateTime'),infoType:text(head,headNs,'InfoType')};
}
export function createWeatherMonitor({load,onResult,onFailure,interval=300000,schedule=setTimeout,cancel=clearTimeout}){
  let stopped=false,suspended=false,controller=null,timer=null;
  function cancelPending(){controller?.abort();controller=null;if(timer!==null){cancel(timer);timer=null}}
  async function refresh(){
    if(stopped||suspended||controller)return;
    if(timer!==null){cancel(timer);timer=null}
    const active=new AbortController();controller=active;
    try{const result=await load(active.signal);if(!stopped&&controller===active)onResult(result)}
    catch(error){if(!stopped&&!active.signal.aborted&&controller===active)onFailure(error)}
    finally{if(controller===active){controller=null;if(!stopped)timer=schedule(()=>{timer=null;return refresh()},interval)}}
  }
  return {refresh,suspend(){if(stopped)return;suspended=true;cancelPending()},resume(){if(stopped||!suspended)return;suspended=false;return refresh()},stop(){stopped=true;cancelPending()}};
}
export function createObservationMonitor({load,onLoading,onResult,onFailure,interval=600000,schedule=setTimeout,cancel=clearTimeout}){
  let active=null,version=0,suspended=false,latest=null;
  function cancelActive(){version++;active?.stop();active=null}
  function stop(){cancelActive();latest=null}
  function set(point,label,kind=undefined){
    straightDistance(point,point);if(typeof label!=='string'||!label.trim()||(kind!==undefined&&!['model_center','facility'].includes(kind)))throw new Error('観測地点の説明が不正です');
    cancelActive();const id=version,ref={point:{latitude:point.latitude,longitude:point.longitude},label,kind};latest=ref;const current=()=>id===version;
    onLoading(ref);
    if(suspended)return;
    active=createWeatherMonitor({interval,schedule,cancel,load:signal=>load(ref.point,signal),onResult:value=>{if(current())onResult(value,ref,current)},onFailure:error=>{if(current())onFailure(error,ref)}});
    return active.refresh();
  }
  return {set,stop,suspend(){suspended=true;cancelActive()},resume(){if(!suspended)return;suspended=false;if(latest)return set(latest.point,latest.label,latest.kind)}};
}
export function weatherSummary(data,now){
  const published=parseZonedTimestamp(data?.reportDatetime);if(published===null||!Number.isFinite(now))throw new Error('発表時刻を確認できません');
  const age=now-published;return {published,headline:typeof data.headlineText==='string'?data.headlineText.trim():'',fresh:age>=-300000&&age<=6*3600000};
}
export function amedasTimeKey(text){
  const m=typeof text==='string'&&text.trim().match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\+09:00$/);
  const timestamp=m?Date.parse(text.trim()):NaN;
  if(!m||!Number.isFinite(timestamp)||new Date(timestamp+9*3600000).toISOString().slice(0,19)!==text.trim().slice(0,19))throw new Error('観測時刻を確認できません');
  return m.slice(1).join('');
}
export function amedasObservation(stations,readings,origin,time,now){
  amedasTimeKey(time);
  if(!Number.isFinite(now)||!stations||!readings)throw new Error('観測情報が不正です');
  const published=Date.parse(time),age=now-published;
  let nearest=null;
  for(const [id,station] of Object.entries(stations)){
    const lat=station?.lat,lon=station?.lon,row=readings[id];
    const validCoordinate=(parts,max)=>Array.isArray(parts)&&parts.length===2&&Number.isInteger(parts[0])&&parts[0]>=0&&parts[0]<=max&&Number.isFinite(parts[1])&&parts[1]>=0&&parts[1]<60&&(parts[0]<max||parts[1]===0);
    if(!validCoordinate(lat,90)||!validCoordinate(lon,180)||!row||typeof station.kjName!=='string')continue;
    const value=(v)=>Array.isArray(v)&&v[1]===0&&Number.isFinite(v[0])&&v[0]>=0?v[0]:null;
    const wind=value(row.wind),rain=value(row.precipitation10m),rain1h=value(row.precipitation1h),rain24h=value(row.precipitation24h);if([wind,rain,rain1h,rain24h].every(item=>item===null))continue;
    const latitude=lat[0]+lat[1]/60,longitude=lon[0]+lon[1]/60;
    let distance;try{distance=straightDistance(origin,{latitude,longitude})}catch{continue}
    if(distance>30000||nearest&&distance>=nearest.distance)continue;
    nearest={stationId:id,station:station.kjName,latitude,longitude,distance,wind,rain,rain1h,rain24h,published,fresh:age>=0&&age<=1800000};
  }
  return nearest;
}
// Great-circle distance between two surface positions; not a route or flight clearance.
export function straightDistance(a,b){
  for(const point of [a,b])if(!Number.isFinite(point?.latitude)||!Number.isFinite(point?.longitude)||Math.abs(point.latitude)>90||Math.abs(point.longitude)>180)throw new Error('地点の座標が不正です');
  const radians=Math.PI/180,lat1=a.latitude*radians,lat2=b.latitude*radians,dlat=(b.latitude-a.latitude)*radians,dlon=(b.longitude-a.longitude)*radians;
  const h=Math.sin(dlat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dlon/2)**2;
  return 2*6371008.8*Math.asin(Math.min(1,Math.sqrt(h)));
}

// Small, explicitly scoped pilot catalogue. Locations come from MLIT station metadata;
// these static entries do not contain water-level readings.
const PILOT_RIVER_STATIONS=Object.freeze([
  Object.freeze({id:'iwabuchi-upper',name:'岩淵水門（上）',river:'荒川',jmaCode:'83030400010000006',latitude:35+47/60+15/3600,longitude:139+43/60+38/3600,metadataUrl:'https://www1.river.go.jp/cgi-bin/SiteInfo.exe?ID=303041283309040',levelUrl:'https://www.river.go.jp/kawabou/pc/tm?ofcCd=21281&itmkndCd=004&obsCd=00006'}),
  Object.freeze({id:'nishiarai',name:'西新井',river:'荒川',latitude:35+45/60+35/3600,longitude:139+47/60+35/3600,metadataUrl:'https://www1.river.go.jp/cgi-bin/SiteInfo.exe?ID=303041283309070',levelUrl:'https://www.river.go.jp/kawabou/pc/tm?ofcCd=21281&itmkndCd=004&obsCd=00008'})
]);
export function riverPilotStations(area){return area==='13118'?PILOT_RIVER_STATIONS.map(item=>({...item})):[]}
// An approximate surface distance only; not a flow distance or flood assessment.
export function riverStationDistance(station,facility){
  try{return straightDistance(station,facility)}catch{return null}
}
// This is a curated correspondence between two official catalogues, not a live observation.
export function floodBulletinStationContext(item,area,facility){
  const station=item?.stationCodeType==='水位観測所'?riverPilotStations(area).find(entry=>entry.jmaCode&&entry.jmaCode===item?.code&&entry.name===item?.station):null;
  return station?{state:'matched',station,distance:riverStationDistance(station,facility)}:{state:'unknown'};
}
export function validateRiverPilotNote(note,station,now=Date.now()){
 if(!note||!station||note.stationId!==station.id||note.reference!==station.levelUrl)return null;
 if(typeof note.value!=='number'||!Number.isFinite(note.value)||Math.abs(note.value)>1000)return null;
 const at=typeof note.at==='string'?Date.parse(note.at):NaN;
 if(!Number.isFinite(at)||!Number.isFinite(now)||at>now+300000)return null;
 return {stationId:note.stationId,value:note.value,at:note.at,reference:note.reference};
}
// Hand-entered records; a review deadline is not a water-level validity guarantee.
export function createRiverLogEntry(input,station){
 const validTime=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
 if(!input||!station||input.stationId!==station.id||input.reference!==station.levelUrl||!Number.isFinite(input.value)||Math.abs(input.value)>1000||!validTime(input.at)||!validTime(input.recordedAt)||Date.parse(input.at)>Date.parse(input.recordedAt)||!(input.reviewBy===null||validTime(input.reviewBy)&&Date.parse(input.reviewBy)>Date.parse(input.recordedAt)))throw new Error('水位メモの数値・日時を確認してください');
 const entry={kind:'manual-river-note',stationId:station.id,reference:station.levelUrl,value:input.value,at:input.at,recordedAt:input.recordedAt,reviewBy:input.reviewBy};
 if(Object.hasOwn(input,'datum')){if(!['unknown','gauge_zero','TP','AP','other'].includes(input.datum))throw new Error('水位の基準を確認してください');entry.datum=input.datum}
 return entry;
}
export function riverLogState(record,now=Date.now()){
 if(!Number.isFinite(now)||now<Date.parse(record.recordedAt))return 'time_unknown';
 if(record.reviewBy===null)return 'review_unspecified';
 return now>=Date.parse(record.reviewBy)?'review_due':'review_due_later';
}
export function decodeRiverLog(raw,station){
 if(raw===null||raw===undefined)return {status:'ok',records:[]};
 try{
  const records=JSON.parse(raw);if(!Array.isArray(records)||records.length>20)throw new Error();
  for(const item of records){const clean=createRiverLogEntry(item,station),keys=Object.keys(clean);if(Object.keys(item).length!==keys.length||keys.some(key=>!Object.hasOwn(item,key)||item[key]!==clean[key]))throw new Error()}
  return {status:'ok',records};
 }catch{return {status:'corrupt',records:[]}}
}
export function appendRiverLog(raw,entry,station){
 const history=decodeRiverLog(raw,station),clean=createRiverLogEntry(entry,station);
 if(history.status!=='ok'||history.records.length>=20)throw new Error('保存済み記録の確認が必要です');
 if(history.records.some(item=>item.at===clean.at&&item.value===clean.value&&(item.datum??'unknown')===(clean.datum??'unknown')))throw new Error('同じ観測日時・値・基準のメモが既にあります');
 return JSON.stringify([clean,...history.records]);
}

// Historical reference imagery only. Both tile URLs use the same z/x/y; the
// tile area is not an automatically detected or independently verified flood extent.
export function historicalFloodCase(){
  return {
    id:'joso-2015',event:'平成27年9月関東・東北豪雨',region:'茨城県常総地区',current:false,
    center:{latitude:36.072343,longitude:139.971171},tile:{z:14,x:14562,y:6429},
    source:'https://www.gsi.go.jp/BOUSAI/H27.taihuu18gou.html',
    reference:'https://www.gsi.go.jp/common/000107662.pdf',
    metadata:'https://cyberjapandata.gsi.go.jp/development/ichiran.html',
    comparisonImage:{id:'joso-nied-20150911-am',capture:'2015年9月11日・時間帯要確認',provider:'防災科学技術研究所',url:'https://maptile01.bosai.go.jp/h270911_photo_v2/14/14562/6429.png',source:'https://ecom-plat.jp/nied-cr/index.php?gid=10132',license:'https://creativecommons.org/licenses/by/2.1/jp/'},
    images:[
      {id:'joso-20150911-pm',capture:'2015年9月11日午後',published:'2015年9月12日',url:'https://cyberjapandata.gsi.go.jp/xyz/20150911dol2/14/14562/6429.png'},
      {id:'joso-20150915-am',capture:'2015年9月15日午前',published:'2015年9月16日',url:'https://cyberjapandata.gsi.go.jp/xyz/20150915dol/14/14562/6429.png'}
    ]
  };
}
// EXIF is an approximate camera position, not the photographed water's location.
export function historicalGroundReference(){
  return {caseId:'joso-2015',current:false,tile:{z:14,x:14562,y:6430},cameraPoint:{latitude:36.0642833333333,longitude:139.9769833333333},cameraTime:'2015-09-11 11:27:05',cameraTimeZone:'unknown',cameraDirection:'unknown',aerialCapture:'2015-09-11 afternoon',aerialExactTime:'unknown',
    ground:{url:'/assets/historical/nied-20150911-112705.jpg',source:'https://ecom-plat.jp/nied-cr/index.php?gid=10132',license:'https://creativecommons.org/licenses/by/2.1/jp/'},
    aerial:{url:'https://cyberjapandata.gsi.go.jp/xyz/20150911dol2/14/14562/6430.png',source:'https://www.gsi.go.jp/BOUSAI/H27.taihuu18gou.html'}};
}
export function slippyTilePoint(tile,point){
  if(!Number.isInteger(tile?.z)||tile.z<0||tile.z>24||!Number.isInteger(tile.x)||!Number.isInteger(tile.y)||tile.x<0||tile.y<0||tile.x>=2**tile.z||tile.y>=2**tile.z||!Number.isFinite(point?.latitude)||Math.abs(point.latitude)>85.05112878||!Number.isFinite(point?.longitude)||Math.abs(point.longitude)>180)throw new Error('地点またはタイルが不正です');
  const n=2**tile.z,lat=point.latitude*Math.PI/180,x=(point.longitude+180)/360*n-tile.x,y=(1-Math.asinh(Math.tan(lat))/Math.PI)/2*n-tile.y;
  return x>=0&&x<1&&y>=0&&y<1?{x,y}:null;
}
export function historicalMabiFloodCase(){
  return {
    id:'mabi-2018',event:'平成30年7月豪雨',region:'岡山県倉敷市真備町周辺',current:false,
    tile:{z:14,x:14276,y:6510},independentReference:false,
    referencePoint:{latitude:34.630589,longitude:133.701996,locationSource:'https://repository.exst.jaxa.jp/dspace/bitstream/a-is/1037273/1/AA2140166000.pdf',traceSource:'https://www.jsnds.org/ssk/ssk_38_2_147.pdf'},
    source:'https://www.gsi.go.jp/BOUSAI/H30.taihuu7gou.html',
    reference:'https://www.gsi.go.jp/common/000216843.pdf',
    metadata:'https://cyberjapandata.gsi.go.jp/development/ichiran.html',
    images:[
      {capture:'2018年7月9日',published:'2018年7月11日',url:'https://cyberjapandata.gsi.go.jp/xyz/201807H3007gouu_takahashigawa_0709do/14/14276/6510.png'},
      {capture:'2018年7月11日',published:'2018年7月13日',url:'https://cyberjapandata.gsi.go.jp/xyz/201807H3007gouu_takahashigawa_0711do/14/14276/6510.png'}
    ]
  };
}
