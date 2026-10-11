// Coordinates are physical micrometres; hit testing uses displayed CSS pixels.
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
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
