export function positionAt(progress, route) {
  const p = Math.max(0, Math.min(1, progress));
  let x;
  if (!route || route === 'direct' || p <= .4) x = -2 + 4*p;
  else {
    const side = route === 'east' ? 4 : -4;
    if (p <= .57) x = -.4 + (side + .4)*(p-.4)/.17;
    else if (p <= .84) x = side;
    else x = side + (4-side)*(p-.84)/.16;
  }
  return {x, z: 1 + p*22};
}

export function overlapsHazard(position) {
  return Math.abs(position.x) < 1.8 && Math.abs(position.z-16) < 1.1;
}

// Never skip the observation stop when a background tab resumes late.
export function progressBeforeReplan(progress, hazard) {
  return hazard ? Math.min(progress, 1) : Math.min(progress, .4);
}

export function fitImage(width,height,maxEdge) {
  if(width<=0||height<=0||maxEdge<=0)throw new Error('Invalid image dimensions');
  const scale=Math.min(1,maxEdge/Math.max(width,height));
  return {width:Math.max(1,Math.round(width*scale)),height:Math.max(1,Math.round(height*scale))};
}

// Maps SAM coordinates from a fixed central crop back to the full scene.
export function mapCropBoxes(boxes, crop) {
  return boxes.map(b=>({
    x1:crop.x+crop.w*b.x1/b.w, y1:crop.y+crop.h*b.y1/b.h,
    x2:crop.x+crop.w*b.x2/b.w, y2:crop.y+crop.h*b.y2/b.h,
    w:1, h:1,
  }));
}

export function intersectsBuilding(position, building, clearance = .6) {
  return building.h >= 5.2 - clearance &&
    Math.abs(position.x - building.x) <= building.w / 2 + clearance &&
    Math.abs(position.z - building.z) <= building.d / 2 + clearance;
}

// Each path is piecewise linear, so intersect each entire segment with the expanded footprint.
export function intersectsFlightPath(building, route, clearance = .6, until = 1) {
  if (building.h < 5.2 - clearance) return false;
  const bounds = [[building.x-building.w/2-clearance, building.x+building.w/2+clearance],
    [building.z-building.d/2-clearance, building.z+building.d/2+clearance]];
  const end=Math.max(0,Math.min(1,until));
  const points = [...[0,.4,.57,.84].filter(p=>p<end),end].map(p=>positionAt(p,route));
  for (let i=0;i<points.length-1;i++) {
    let enter=0, exit=1;
    for (const [axis,[min,max]] of ['x','z'].map((axis,index)=>[axis,bounds[index]])) {
      const start=points[i][axis], delta=points[i+1][axis]-start;
      if (delta===0) { if(start<min||start>max){enter=1;exit=0;break} continue; }
      const a=(min-start)/delta,b=(max-start)/delta;
      enter=Math.max(enter,Math.min(a,b));exit=Math.min(exit,Math.max(a,b));
    }
    if(enter<=exit)return true;
  }
  return false;
}

export function isValidRoute(route, hazard, buildings) {
  if(!(hazard?['east','west']:['direct']).includes(route))return false;
  const until=hazard?1:.4;
  if(buildings.some(building=>intersectsFlightPath(building,route,1.8,until)))return false;
  const obstruction={x:0,z:16,w:3.6,d:2.2,h:5.2};
  return !hazard||!intersectsFlightPath(obstruction,route,1.5);
}

export function makeCity() {
  const random = i => { const n = Math.sin(i * 143.321) * 43758.545; return n - Math.floor(n); };
  const buildings = [];
  for (let x = -5; x <= 5; x++) for (let z = -1; z <= 8; z++) {
    if ((x === 0 || x === 1) && z < 7) continue;
    const i = (x + 6) * 20 + z;
    const building = {x:x*4+(random(i)-.5)*1.1,z:z*4,w:2+random(i+2)*1.5,d:2+random(i+4),h:random(i+5)<.68?2.5+random(i+6)*1.4:5+random(i+7)*6};
    const blocksRoute = ['east','west'].some(route=>intersectsFlightPath(building,route,1.8));
    if (!blocksRoute) buildings.push(building);
  }
  return buildings;
}

// The region is chosen from the simulation's known wire coordinates, not a SAM detection.
export function cropAround(points){
  if(!points.length||points.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)))return null;
  const left=Math.min(...points.map(p=>p.x)),right=Math.max(...points.map(p=>p.x));
  const top=Math.min(...points.map(p=>p.y)),bottom=Math.max(...points.map(p=>p.y));
  if(left>1||right<0||top>1||bottom<0)return null;
  const cx=(left+right)/2,cy=(top+bottom)/2,w=Math.min(1,Math.max(.3,right-left+.16)),h=Math.min(1,Math.max(.25,bottom-top+.16));
  const x=Math.min(1-w,Math.max(0,cx-w/2)),y=Math.min(1-h,Math.max(0,cy-h/2));
  return {x,y,w,h};
}
