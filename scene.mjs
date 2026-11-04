import * as THREE from '/vendor/three.module.js';
import {GLTFLoader} from '/vendor/addons/loaders/GLTFLoader.js';
import {positionAt,cropAround} from './mission.mjs';
import {deliveryPose} from './delivery.mjs';

// The scene uses the same coordinates and building footprints as the mission validator.
export function createWorld(canvas, buildings) {
  const renderer=new THREE.WebGLRenderer({canvas,antialias:true,preserveDrawingBuffer:true});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure=1.05;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;
  const scene=new THREE.Scene();scene.background=new THREE.Color(0x9faeb4);scene.fog=new THREE.Fog(0xa5b5ba,45,110);
  const camera=new THREE.PerspectiveCamera(47,1,.1,200);
  // Optional sky: older running servers can still render the base scene until restarted.
  let sky=null,skyApplied=false;
  fetch('/assets/overcast.hdr',{method:'HEAD'}).then(response=>{if(!response.ok)return null;return import('/vendor/addons/loaders/HDRLoader.js')}).then(module=>{
    if(!module)return;new module.HDRLoader().load('/assets/overcast.hdr',texture=>{texture.mapping=THREE.EquirectangularReflectionMapping;sky=texture},undefined,()=>{});
  }).catch(()=>{});
  const hemi=new THREE.HemisphereLight(0xe6f0f2,0x475554,2.2);scene.add(hemi);
  const sun=new THREE.DirectionalLight(0xfff5df,2);sun.position.set(-12,30,-10);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);sun.shadow.camera.left=-35;sun.shadow.camera.right=35;sun.shadow.camera.top=35;sun.shadow.camera.bottom=-35;sun.shadow.camera.far=100;sun.shadow.bias=-.0003;sun.target.position.set(0,0,14);scene.add(sun,sun.target);
  const mat=(color,roughness=.8,metalness=0)=>new THREE.MeshStandardMaterial({color,roughness,metalness});
  const textures=new THREE.TextureLoader();const wallTexture=textures.load('/assets/plaster.jpg');wallTexture.colorSpace=THREE.SRGBColorSpace;const roadTexture=textures.load('/assets/asphalt.jpg');roadTexture.colorSpace=THREE.SRGBColorSpace;roadTexture.wrapS=roadTexture.wrapT=THREE.RepeatWrapping;roadTexture.repeat.set(1,2);
  const concrete=mat(0xb2b6af),asphalt=mat(0x848b89),water=mat(0x9a9c83,.24,.16),roof=mat(0x4c5354),dark=mat(0x272d30,.55,.32),orange=mat(0xdc6b23),white=mat(0xd5d7d1),glass=mat(0x566e75,.25,.35);
  asphalt.map=roadTexture;
  function cube(parent,x,y,z,w,h,d,m){const obj=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),m);obj.position.set(x,y+h/2,z);obj.castShadow=h>.2;obj.receiveShadow=true;parent.add(obj);return obj}
  function rod(parent,a,b,r,m){const start=new THREE.Vector3(...a),end=new THREE.Vector3(...b),delta=end.clone().sub(start);const obj=new THREE.Mesh(new THREE.CylinderGeometry(r,r,delta.length(),8),m);obj.position.copy(start.add(end).multiplyScalar(.5));obj.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize());parent.add(obj);return obj}
  cube(scene,0,-.35,14,80,.23,95,mat(0x797b70));
  for(const x of [-16,-8,0,8,16])cube(scene,x,-.08,14,1.8,.03,80,asphalt);
  for(const z of [-4,4,12,20,28,36])cube(scene,0,-.08,z,60,.03,1.4,asphalt);
  // Shallow muddy floodwater with broad, low-contrast surface glints.
  const waterCanvas=document.createElement('canvas');waterCanvas.width=512;waterCanvas.height=512;
  const wctx=waterCanvas.getContext('2d');wctx.fillStyle='#a9aaa0';wctx.fillRect(0,0,512,512);
  for(let i=0;i<330;i++){const x=(i*113)%512,y=(i*197)%512,len=4+(i%7)*3;wctx.strokeStyle=i%3?'#d4dad133':'#65736b33';wctx.lineWidth=i%5===0?2:1;wctx.beginPath();wctx.moveTo(x,y);wctx.bezierCurveTo(x+len*.3,y-1,x+len*.7,y+1,x+len,y);wctx.stroke()}
  const waterMap=new THREE.CanvasTexture(waterCanvas);waterMap.colorSpace=THREE.SRGBColorSpace;waterMap.wrapS=waterMap.wrapT=THREE.RepeatWrapping;waterMap.repeat.set(7,8);water.map=waterMap;
  water.transparent=true;water.opacity=.75;water.depthWrite=false;
  const flood=cube(scene,0,.19,14,80,.01,95,water);flood.renderOrder=2;
  // Low and mid-rise buildings follow the mission's existing collision map.
  const residential=[],windowPositions=[];buildings.forEach((b,i)=>{const g=new THREE.Group();g.position.set(b.x,0,b.z);scene.add(g);const body=mat([0xb4b6b1,0x9eaaa8,0xc7c5bc,0x898f8c][i%4]);body.map=wallTexture;cube(g,0,0,0,b.w,b.h,b.d,body);cube(g,0,b.h,0,b.w+.1,.15,b.d+.1,roof);
    const ySafe=h=>Math.min(.8,h*.25);const floors=Math.max(1,Math.floor(b.h/1.65));for(let y=0;y<floors;y++)for(let x=-b.w*.3;x<b.w*.4;x+=.85){windowPositions.push([b.x+x,.8+y*1.55+.275,b.z-b.d/2-.025,0])}
    for(let y=0;y<floors;y++)for(let z=-b.d*.3;z<b.d*.4;z+=.85){windowPositions.push([b.x+b.w/2+.025,.8+y*1.55+.275,b.z+z,Math.PI/2])}
    if(b.h<5.8){
      if(residential.length<20)residential.push({group:g,building:b});
      for(const side of [-1,1]){const slope=cube(g,side*b.w*.25,b.h+.18,0,b.w*.55,.1,b.d+.28,roof);slope.rotation.z=-side*.35}
      cube(g,0,.05,-b.d/2-.04,.58,1.1,.07,dark);
      // Eaves and rain gutters give small houses a recognisable roofline.
      rod(g,[-b.w/2-.12,b.h+.18,-b.d/2-.17],[b.w/2+.12,b.h+.18,-b.d/2-.17],.025,dark);
      cube(g,0,.8+ySafe(b.h),-b.d/2-.06,b.w*.6,.045,.11,concrete);
    }else{
      cube(g,0,b.h+.14,0,b.w*.3,.15,b.d*.3,roof);
      for(let floor=1;floor<floors;floor++){
        const base=.45+floor*1.55;cube(g,0,base,-b.d/2-.14,b.w*.78,.07,.28,concrete);
        rod(g,[-b.w*.38,base+.45,-b.d/2-.28],[b.w*.38,base+.45,-b.d/2-.28],.018,dark);
        for(const x of [-b.w*.35,0,b.w*.35])rod(g,[x,base,-b.d/2-.28],[x,base+.45,-b.d/2-.28],.016,dark);
      }
    }
  });
  // One shared mesh keeps the repeated windows inexpensive to render.
  const windows=new THREE.InstancedMesh(new THREE.BoxGeometry(.42,.55,.04),glass,windowPositions.length),matrix=new THREE.Matrix4();
  windowPositions.forEach(([x,y,z,angle],i)=>{matrix.makeRotationY(angle);matrix.setPosition(x,y,z);windows.setMatrixAt(i,matrix)});windows.instanceMatrix.needsUpdate=true;windows.receiveShadow=true;scene.add(windows);
  // CC0 architectural detail is loaded asynchronously; the plain geometry remains a fallback.
  let windowAsset=null,decorated=false;canvas.dataset.detailStatus='loading';
  new GLTFLoader().load('/assets/urban/facade.gltf',gltf=>{windowAsset=gltf.scene.getObjectByName('window_centered_small_01')||null;canvas.dataset.detailStatus=windowAsset?'loaded':'unavailable'},undefined,()=>{canvas.dataset.detailStatus='unavailable'});
  function addResidentialDetail(){
    if(!windowAsset||decorated)return;decorated=true;canvas.dataset.detailStatus='ready';
    for(const {group,building:b} of residential){
      const instance=windowAsset.clone(true);instance.position.set(0,0,0);instance.updateMatrixWorld(true);
      const box=new THREE.Box3().setFromObject(instance),size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());
      if(!size.x||!size.y)continue;
      instance.position.sub(center);const frame=new THREE.Group();frame.add(instance);
      const scale=Math.min(.65/size.x,.9/size.y);frame.scale.setScalar(scale);
      frame.position.set(b.w*.2,1.45,-b.d/2-.055);group.add(frame);
    }
  }
  // Street furniture and partially flooded vehicles add a readable human scale.
  const vehiclePaint=mat(0xb5c5c4,.32,.4),tyre=mat(0x202526);
  for(const [x,z] of [[-8,5],[8,19],[-12,25]]){
    const car=new THREE.Group();car.position.set(x,.06,z);scene.add(car);
    cube(car,0,0,0,1.05,.42,2.1,vehiclePaint);cube(car,0,.4,-.12,.9,.38,1.05,glass);
    for(const side of [-1,1])for(const end of [-.65,.65]){const wheel=new THREE.Mesh(new THREE.CylinderGeometry(.2,.2,.12,12),tyre);wheel.rotation.z=Math.PI/2;wheel.position.set(side*.56,.14,end);car.add(wheel)}
  }
  for(const x of [-10,10]) for(const z of [3,11,19,27]){
    rod(scene,[x,0,z],[x,6,z],.065,dark);rod(scene,[x-.35,5.7,z],[x+.35,5.7,z],.04,dark);
  }
  const rippleMat=new THREE.LineBasicMaterial({color:0xa4bab4,transparent:true,opacity:.25});
  for(let i=0;i<60;i++){const x=Math.sin(i*13.3)*19,z=(i*7.13)%45-5,y=.205;const geo=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x,y,z),new THREE.Vector3(x+.3+(i%4)*.22,y,z)]);scene.add(new THREE.Line(geo,rippleMat))}
  // School roof and helipad represent the fixed shelter destination.
  cube(scene,4,0,23,5,1.5,4,concrete);cube(scene,4,1.51,23,4.8,.04,3.8,roof);
  // A small school-like evacuation center, with windows and a clear rooftop landing area.
  for(let x=2.1;x<=5.9;x+=.65)for(const y of [.24,.8])cube(scene,x,y,20.97,.43,.33,.05,glass);
  cube(scene,4,.02,20.91,.75,.65,.08,dark);
  for(const z of [21.15,24.85]){rod(scene,[1.65,1.6,z],[6.35,1.6,z],.025,white);for(const x of [1.7,3.2,4.8,6.3])rod(scene,[x,1.5,z],[x,1.62,z],.02,white)}
  for(const x of [1.65,6.35])rod(scene,[x,1.6,21.15],[x,1.6,24.85],.025,white);
  const pad=new THREE.Mesh(new THREE.RingGeometry(.65,.72,36),new THREE.MeshBasicMaterial({color:0xe6a851,side:THREE.DoubleSide}));pad.rotation.x=-Math.PI/2;pad.position.set(4,1.58,23);scene.add(pad);
  // The wire is a known simulated hazard. Segmentation is independently reported.
  const hazard=new THREE.Group();scene.add(hazard);
  for(const x of [-1.85,1.85]){rod(hazard,[x,0,16],[x,6.6,16],.09,dark);rod(hazard,[x-.5,6.15,16],[x+.5,6.15,16],.055,dark)}
  for(let z=15.8;z<=16.21;z+=.2)rod(hazard,[-1.85,5.2,z],[1.85,5.2,z],.025,dark);
  hazard.visible=true;
  // Six-rotor utility drone with a suspended relief case.
  const drone=new THREE.Group();scene.add(drone);cube(drone,0,-.2,0,.9,.35,1.05,dark);cube(drone,0,.15,0,.68,.18,.8,roof);cube(drone,0,-.05,-.55,.34,.2,.15,glass);
  // Sensor, service panels and cargo frame give the vehicle a practical industrial silhouette.
  const panel=mat(0x41484b,.55,.55), lens=mat(0x172a30,.15,.55), trim=mat(0x151a1b,.48,.5);
  const shell=new THREE.Mesh(new THREE.CylinderGeometry(.48,.5,.92,6),panel);shell.rotation.x=Math.PI/2;shell.rotation.y=Math.PI/6;shell.position.set(0,.16,0);drone.add(shell);
  cube(drone,0,.39,0,.48,.035,.5,trim);cube(drone,0,-.18,-.63,.38,.26,.24,trim);
  for(const x of [-.09,.09]){const lensFace=new THREE.Mesh(new THREE.SphereGeometry(.06,12,8),lens);lensFace.position.set(x,-.035,-.77);drone.add(lensFace)}
  for(const x of [-.27,.27])for(const z of [-.25,.25]){const pin=new THREE.Mesh(new THREE.SphereGeometry(.018,8,6),white);pin.position.set(x,.43,z);drone.add(pin)}
  const propellers=[];
  for(const x of [-1,1]) for(const z of [-.65,0,.65]) {rod(drone,[x*.25,0,z*.55],[x*1.05,0,z],.055,dark);cube(drone,x*.85,-.05,z*.85,.2,.12,.12,orange);const motor=new THREE.Mesh(new THREE.CylinderGeometry(.11,.11,.15,12),dark);motor.position.set(x*1.05,.08,z);drone.add(motor);const rotor=new THREE.Group();rotor.position.set(x*1.05,.18,z);for(const side of [-1,1]){const blade=new THREE.Shape();blade.moveTo(0,0);blade.quadraticCurveTo(side*.2,.045,side*.48,.035);blade.quadraticCurveTo(side*.5,0,side*.46,-.035);blade.quadraticCurveTo(side*.2,-.045,0,0);const prop=new THREE.Mesh(new THREE.ShapeGeometry(blade,8),trim);prop.rotation.x=-Math.PI/2;prop.position.y=.02;rotor.add(prop)}drone.add(rotor);propellers.push(rotor)}
  for(const x of [-.45,.45]){rod(drone,[x,-.2,-.35],[x*1.3,-.8,-.38],.035,dark);rod(drone,[x,-.2,.35],[x*1.3,-.8,.38],.035,dark);rod(drone,[x*1.3,-.8,-.55],[x*1.3,-.8,.55],.035,dark)}
  const cable=rod(drone,[0,-.25,0],[0,-.9,0],.018,dark);const cargo=new THREE.Group();drone.add(cargo);cube(cargo,0,-.2,0,.75,.4,.6,white);cube(cargo,0,-.2,0,.07,.41,.61,orange);
  cube(cargo,0,.19,0,.77,.035,.62,trim);for(const z of [-.28,.28]){cube(cargo,0,-.15,z,.77,.03,.025,trim)}
  for(const x of [-.28,.28]){rod(cargo,[x,.21,-.2],[0,.5,0],.012,trim);rod(cargo,[x,.21,.2],[0,.5,0],.012,trim)}
  const pathMat=new THREE.LineDashedMaterial({color:0xffa34e,dashSize:.3,gapSize:.2});const pathGeometry=new THREE.BufferGeometry();pathGeometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(46*3),3));pathGeometry.setAttribute('lineDistance',new THREE.BufferAttribute(new Float32Array(46),1));const path=new THREE.Line(pathGeometry,pathMat);scene.add(path);
  const originalGeometry=new THREE.BufferGeometry();const originalPoints=[];for(let i=0;i<=45;i++){const p=positionAt(.4+.6*i/45,'direct');originalPoints.push(new THREE.Vector3(p.x,5.2,p.z))}originalGeometry.setFromPoints(originalPoints);const originalPath=new THREE.Line(originalGeometry,new THREE.LineDashedMaterial({color:0xd3d6d1,transparent:true,opacity:.5,dashSize:.2,gapSize:.2}));originalPath.computeLineDistances();scene.add(originalPath);originalPath.visible=false;
  const target=new THREE.Vector3(0,3,12),desired=new THREE.Vector3(),shelterScreen=new THREE.Vector3();let prev=performance.now(),lastView='wide';
  function update(run,view,t){
    if(!run){addResidentialDetail();if(sky&&!skyApplied){scene.background=sky;scene.environment=sky;scene.backgroundIntensity=.55;scene.environmentIntensity=.45;skyApplied=true}}
    const w=canvas.clientWidth,h=canvas.clientHeight;if(!w||!h)return;if(canvas.width!==Math.floor(w*renderer.getPixelRatio())||canvas.height!==Math.floor(h*renderer.getPixelRatio())){renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix()}
    const p=run?.position||{x:-2,z:1},height=5.2,bob=['landing','complete'].includes(run?.state)?0:Math.sin(t/600)*.04;drone.position.set(p.x,height+bob,p.z);propellers.forEach((r,i)=>r.rotation.y=t*.02*(i%2?1:-1));
    const pose=deliveryPose(run?.state,run?.landingProgress);cargo.position.y=pose.parcelY-height;const cableLength=height-.25-(pose.parcelY+.5);cable.visible=pose.attached;cable.scale.y=cableLength/.65;cable.position.y=-.25-cableLength/2;
    hazard.visible=true;originalPath.visible=!!run?.hazard&&!['complete','landing'].includes(run.state);
    if(run?.state==='flying'){const start=run.progress||0,end=run.hazard?1:.4,positions=pathGeometry.getAttribute('position'),distances=pathGeometry.getAttribute('lineDistance');let distance=0,previous=null;for(let i=0;i<=45;i++){const pos=positionAt(start+(end-start)*i/45,run.hazard?run.route:'direct');positions.setXYZ(i,pos.x,5.24,pos.z);if(previous)distance+=Math.hypot(pos.x-previous.x,pos.z-previous.z);distances.setX(i,distance);previous=pos}positions.needsUpdate=true;distances.needsUpdate=true;path.visible=true}else path.visible=false;
    const focus=view==='wide'?new THREE.Vector3(0,2.5,13):new THREE.Vector3(p.x,4.5,p.z+3);
    if(view==='wide')desired.set(25,26,-23);else if(view==='close')desired.set(p.x+4,7.8,p.z-7);else desired.set(p.x+7,9,p.z-11);
    const dt=Math.min(.1,(t-prev)/1000);prev=t;const alpha=1-Math.exp(-dt*2.5);if(run?.state!=='replanning'){camera.position.lerp(desired,alpha);target.lerp(focus,alpha)}else if(lastView!==view){camera.position.copy(desired);target.copy(focus)}lastView=view;camera.lookAt(target);renderer.render(scene,camera);shelterScreen.set(4,1.6,23).project(camera);return {x:(shelterScreen.x*.5+.5)*w,y:(-.5*shelterScreen.y+.5)*h,visible:shelterScreen.z<1&&Math.abs(shelterScreen.x)<.95&&Math.abs(shelterScreen.y)<.95};
  }
  camera.position.set(25,26,-23);camera.lookAt(target);
  function hazardCrop(){
    const points=[[-1.85,5.2,16],[1.85,5.2,16]].map(p=>new THREE.Vector3(...p).project(camera));
    if(points.some(p=>p.z < -1 || p.z > 1))return null;
    return cropAround(points.map(p=>({x:p.x*.5+.5,y:.5-p.y*.5})));
  }
  return {update,hazardCrop};
}
