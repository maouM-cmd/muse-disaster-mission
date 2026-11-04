export const initialCamera=()=>({view:'wide',manual:false});
export const beginFlight=()=>({view:'follow',manual:false});
export function selectCamera(state,view){if(!['wide','follow'].includes(view))throw new Error('Unknown camera');return {view,manual:true}}
export function selectMapCamera(state,view){return view==='wire'?{view,manual:true}:selectCamera(state,view)}
export const mapWireRange=distance=>Math.max(35,Math.min(110,distance*.5));
export function deliveryCamera(state){return state.view==='follow'?{...state,view:'close'}:state}
export function mapObstacleCamera(state){return state.manual?state:{view:'wide',manual:false}}
export function smoothHeading(current,target,seconds){
  const delta=Math.atan2(Math.sin(target-current),Math.cos(target-current));
  return current+delta*(1-Math.exp(-5*Math.max(0,seconds)));
}
export function mapFollowOffset(width,height,close=false){
  const aspect=Number.isFinite(width)&&Number.isFinite(height)&&width>0&&height>0?width/height:1.2;
  const scale=Math.min(2.5,Math.max(1,1.2/aspect)),base=close?{x:5,y:-17,z:7}:{x:6,y:-20,z:5};
  return {x:base.x*scale,y:base.y*scale,z:base.z*scale};
}
