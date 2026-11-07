// Coordinates are physical micrometres; hit testing uses displayed CSS pixels.
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export function rectangleFromPoints(start,end,width,height) {
  const a={x:clamp(start.x,0,width),y:clamp(start.y,0,height)},b={x:clamp(end.x,0,width),y:clamp(end.y,0,height)};
  return {x0:Math.min(a.x,b.x),x1:Math.max(a.x,b.x),y0:Math.min(a.y,b.y),y1:Math.max(a.y,b.y)};
}
export function surfacePoint(result,x,y) {
  const {cols,rows,dx,surface}=result;
  if(!Number.isFinite(x)||!Number.isFinite(y)||x<0||y<0||x>(cols-1)*dx||y>(rows-1)*dx)throw Error('計測点はマップ内で指定してください。');
  const column=Math.round(x/dx),row=Math.round(y/dx);
  return {column,row,x:column*dx,y:row*dx,z:surface[row*cols+column]};
}
export function surfaceMeasurement(a,b){return {dx:b.x-a.x,dy:b.y-a.y,distance:Math.hypot(b.x-a.x,b.y-a.y),heightDifference:Number.isFinite(a.z)&&Number.isFinite(b.z)?b.z-a.z:NaN};}
export function profilePoint(profile,distance){
  if(!Number.isFinite(distance)||!profile.distance.length||distance<profile.distance[0]||distance>profile.distance.at(-1))throw Error('計測位置は選択した断面の距離範囲内にしてください。');
  let lo=0,hi=profile.distance.length-1;while(lo<hi){const mid=Math.floor((lo+hi)/2);if(profile.distance[mid]<distance)lo=mid+1;else hi=mid;}
  const i=lo>0&&Math.abs(profile.distance[lo-1]-distance)<Math.abs(profile.distance[lo]-distance)?lo-1:lo;
  return {index:i,distance:profile.distance[i],height:profile.height[i]};
}
export function versionFromHTML(html){
  const tag=(String(html).match(/<meta\b[^>]*>/gi)??[]).find(t=>/\bname\s*=\s*["']app-version["']/i.test(t));
  const version=tag?.match(/\bcontent\s*=\s*["']([^"']+)["']/i)?.[1];
  if(!version||!/^[a-z0-9][a-z0-9._-]{0,79}$/i.test(version))throw Error('更新情報を確認できませんでした。');
  return version;
}
export function updateURL(current,version){
  if(!/^[a-z0-9][a-z0-9._-]{0,79}$/i.test(version))throw Error('更新情報が不正です。');
  const url=new URL('./',current);url.searchParams.set('v',version);return url.href;
}
export function lineDirection(p) {
  return Math.abs(p.y1-p.y0)<1e-8 ? 'x' : Math.abs(p.x1-p.x0)<1e-8 ? 'y' : 'arbitrary';
}
export function hitLine(point, lines, scaleX, scaleY, tolerance=8) {
  let closest;
  for (const p of [...lines].reverse()) {
    const ax=(point.x-p.x0)*scaleX, ay=(point.y-p.y0)*scaleY;
    const bx=(p.x1-p.x0)*scaleX, by=(p.y1-p.y0)*scaleY, length=bx*bx+by*by;
    const t=length?clamp((ax*bx+ay*by)/length,0,1):0;
    const distance=Math.hypot(ax-t*bx,ay-t*by);
    if (distance>tolerance || (closest && closest.distance<=distance)) continue;
    const direction=p.direction??lineDirection(p);
    const part=direction==='arbitrary' && Math.hypot(ax,ay)<=tolerance ? 'start'
      : direction==='arbitrary' && Math.hypot(ax-bx,ay-by)<=tolerance ? 'end' : 'move';
    closest={line:p,part,distance};
  }
  return closest;
}
export function dragLine(original, start, point, part, width, height) {
  const p={...original}, direction=original.direction??lineDirection(original);
  if(part==='start'||part==='end') {
    const suffix=part==='start'?'0':'1';p['x'+suffix]=clamp(point.x,0,width);p['y'+suffix]=clamp(point.y,0,height);
  } else {
    const dx=direction==='x'?0:clamp(point.x-start.x,-Math.min(p.x0,p.x1),width-Math.max(p.x0,p.x1));
    const dy=direction==='y'?0:clamp(point.y-start.y,-Math.min(p.y0,p.y1),height-Math.max(p.y0,p.y1));
    p.x0+=dx;p.x1+=dx;p.y0+=dy;p.y1+=dy;
  }
  return p;
}
// One pending frame, latest pointer sample wins. Flush on pointerup; discard on cancel.
export function frameQueue(draw, request=cb=>requestAnimationFrame(cb), cancel=id=>cancelAnimationFrame(id)) {
  let scheduled=null, latest;
  const run=()=>{scheduled=null;const value=latest;latest=undefined;if(value!==undefined)draw(value);};
  return {push(value){latest=value;if(scheduled===null)scheduled=request(run);},flush(){if(scheduled!==null)cancel(scheduled);run();},cancel(){if(scheduled!==null)cancel(scheduled);scheduled=null;latest=undefined;}};
}
