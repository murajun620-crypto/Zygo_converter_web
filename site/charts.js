import {slope} from './analysis.js';
import {spectrumBounds,ringVisibility} from './fft-view.js';
const ink = '#526174', grid = '#e7edf2', teal = '#137c80';
export const palette = ['#137c80', '#b36f31', '#725ab5', '#d35173', '#3d74aa', '#7b8f39'];
export function setup(canvas, width = 900, height = 540) {
  canvas.width = width; canvas.height = height;
  const c = canvas.getContext('2d'); c.fillStyle = '#ffffff'; c.fillRect(0, 0, width, height); c.font = '13px sans-serif'; c.lineWidth = 1; return c;
}
function text(c, label, x, y, align = 'left', color = ink) {c.fillStyle = color; c.textAlign = align; c.fillText(label, x, y);}
function line(c, x1, y1, x2, y2, color = grid) {c.strokeStyle = color; c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();}
const fmt = n => Math.abs(n) >= 1e4 || (Math.abs(n) < 0.01 && n !== 0) ? n.toExponential(1) : Number(n.toFixed(2)).toString();
const maps = {viridis:[[68,1,84],[59,82,139],[33,145,140],[94,201,98],[253,231,37]],cividis:[[0,32,77],[65,78,108],[125,124,120],[188,173,108],[255,233,69]],turbo:[[48,18,59],[50,110,220],[24,220,165],[164,252,60],[249,155,30],[180,4,38]],coolwarm:[[59,76,192],[141,176,254],[221,221,221],[244,154,123],[180,4,38]]};
function color(z, lo, hi, gray = false, map = 'jet') {
  if (!Number.isFinite(z)) return [237, 241, 244];
  const t = Math.max(0, Math.min(1, (z - lo) / (hi - lo || 1)));
  if (gray || map === 'gray') return Array(3).fill(Math.round(255 * t));
  if (maps[map]) {const stops=maps[map],a=t*(stops.length-1),i=Math.min(stops.length-2,Math.floor(a)),u=a-i;return stops[i].map((v,k)=>Math.round(v*(1-u)+stops[i+1][k]*u));}
  // Jet-compatible range for visual comparison with the Python figures.
  const channel = k => Math.round(255 * Math.max(0, Math.min(1, 1.5 - Math.abs(4 * t - k))));
  return [channel(3), channel(2), channel(1)];
}
function bounds(values) {let lo = Infinity, hi = -Infinity; for (const v of values) if (Number.isFinite(v)) {lo = Math.min(lo, v); hi = Math.max(hi, v);} return Number.isFinite(lo) ? [lo, hi === lo ? lo + 1 : hi] : [0, 1];}

export function heatmap(canvas, values, cols, rows, dx, {limit, gray = false, unit = 'nm', profile = null, axes = true, colormap = 'jet', lines = [], frequencies = null} = {}) {
  const c = setup(canvas), [lo, hi] = limit ? [-limit, limit] : bounds(values);
  const off = document.createElement('canvas'); off.width = cols; off.height = rows;
  const cc = off.getContext('2d'), pixels = cc.createImageData(cols, rows);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {const j = (y * cols + x) * 4, rgb = color(values[(rows - 1 - y) * cols + x], lo, hi, gray, colormap); pixels.data.set([...rgb, 255], j);}
  cc.putImageData(pixels, 0, 0);
  const maxW = 685, maxH = 390, spanX=frequencies?frequencies.fx.at(-1)-frequencies.fx[0]+frequencies.dfX:cols,spanY=frequencies?frequencies.fy.at(-1)-frequencies.fy[0]+frequencies.dfY:rows, scale = Math.min(maxW / spanX, maxH / spanY), w = spanX * scale, h = spanY * scale, left = 75 + (maxW - w) / 2, top = 35 + (maxH - h) / 2;
  c.imageSmoothingEnabled = false; c.drawImage(off, left, top, w, h);
  c.strokeStyle = '#c7d2db'; c.strokeRect(left, top, w, h);
  if (axes) {
    for (let k = 0; k <= 4; k++) {const t = k / 4,ix=Math.round(t*(cols-1)),iy=Math.round(t*(rows-1)); text(c, fmt(frequencies ? frequencies.fx[ix] : t * (cols - 1) * dx), left + w * (frequencies?(ix+0.5)/cols:t), top + h + 23, 'center'); text(c, fmt(frequencies ? frequencies.fy[iy] : t * (rows - 1) * dx), left - 12, top + h * (1-(frequencies?(iy+0.5)/rows:t)) + 4, 'right');}
    text(c, frequencies ? 'fx [cycles/µm]' : 'x [µm]', left + w / 2, top + h + 50, 'center'); c.save(); c.translate(left - 58, top + h / 2); c.rotate(-Math.PI / 2); text(c, frequencies ? 'fy [cycles/µm]' : 'y [µm]', 0, 0, 'center'); c.restore();
  }
  const barX = 804, barW = 16;
  for (let k = 0; k < h; k++) {c.fillStyle = `rgb(${color(hi - (hi - lo) * k / h, lo, hi, gray, colormap)})`; c.fillRect(barX, top + k, barW, 1);}
  text(c, unit, barX + 8, top - 12, 'center'); for (let k = 0; k <= 4; k++) text(c, fmt(hi - (hi - lo) * k / 4), barX + 22, top + k * h / 4 + 4);
  if (profile !== null) {const yy = top + (1 - profile / (rows - 1)) * h; c.setLineDash([7, 5]); line(c, left, yy, left + w, yy, '#ffffff'); c.setLineDash([]); line(c, left, yy + 2, left + w, yy + 2, '#263545');}
  canvas._plotArea = {left, top, w, h, cols, rows, dx};
  if(lines.length){const background=document.createElement('canvas');background.width=canvas.width;background.height=canvas.height;background.getContext('2d').drawImage(canvas,0,0);canvas._surfaceBackground=background;drawProfileLines(canvas,lines);}
}

export function surface3d(canvas, result, {azimuth = -0.7, elevation = 0.65, limit = 10, colormap = 'jet'} = {}) {
  const c = setup(canvas), {surface: z, cols, rows, dx} = result;
  const maxSpan = Math.max(cols - 1, rows - 1) * dx;
  const project = (x, y, h) => {const xx = (x / (cols - 1) - 0.5) * (cols - 1) * dx / maxSpan, yy = (y / (rows - 1) - 0.5) * (rows - 1) * dx / maxSpan, a = xx * Math.cos(azimuth) - yy * Math.sin(azimuth), b = xx * Math.sin(azimuth) + yy * Math.cos(azimuth); return [450 + a * 540, 250 - (b * Math.sin(elevation) + h / limit * 0.18 * Math.cos(elevation)) * 340, b];};
  const step = Math.max(1, Math.ceil(Math.max(cols, rows) / 90)), faces = [];
  for (let y = 0; y < rows - 1; y += step) for (let x = 0; x < cols - 1; x += step) {
    const x1 = Math.min(x + step, cols - 1), y1 = Math.min(y + step, rows - 1), corners = [[x, y], [x1, y], [x1, y1], [x, y1]], heights = corners.map(([xx, yy]) => z[yy * cols + xx]);
    if (!heights.every(Number.isFinite)) continue;
    const points = corners.map(([xx, yy], i) => project(xx, yy, Math.max(-limit, Math.min(limit, heights[i]))));
    faces.push({points, depth: points.reduce((s, p) => s + p[2], 0) / 4, z: heights.reduce((s, v) => s + v, 0) / 4});
  }
  faces.sort((a, b) => b.depth - a.depth);
  for (const f of faces) {c.fillStyle = `rgb(${color(f.z, -limit, limit, false, colormap)})`; c.beginPath(); f.points.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y)); c.closePath(); c.fill();}
  const o = project(0, 0, -limit), x = project(cols - 1, 0, -limit), y = project(0, rows - 1, -limit), h = project(0, 0, limit);
  [x, y, h].forEach(p => line(c, ...o.slice(0, 2), ...p.slice(0, 2), '#8797a9'));
  text(c, 'x', Math.max(25, Math.min(875, x[0])), Math.min(480, x[1] + 22), 'center'); text(c, 'y', Math.max(25, Math.min(875, y[0])), Math.min(480, y[1] + 22), 'center'); text(c, 'z', Math.max(25, h[0] - 12), Math.max(40, h[1] - 12), 'center');
  text(c, `x: ${fmt((cols - 1) * dx)} µm   /   y: ${fmt((rows - 1) * dx)} µm   /   z: ±${fmt(limit)} nm`, 450, 24, 'center');
  text(c, '3D preview · z scale is exaggerated', 450, 519, 'center');
  for(let k=0;k<260;k++){c.fillStyle=`rgb(${color(limit-2*limit*k/260,-limit,limit,false,colormap)})`;c.fillRect(820,110+k,16,1);}text(c,'nm',828,95,'center');for(let k=0;k<=4;k++)text(c,fmt(limit-2*limit*k/4),842,114+k*65);
}

function frame(c, {xmin, xmax, ymin, ymax, log = false, xlabel, ylabel}) {
  const left = 92, top = 35, w = 740, h = 408;
  if (xmax <= xmin) xmax = xmin + 1; if (ymax <= ymin) ymax = ymin + 1;
  const X = x => left + ((log ? Math.log10(x) : x) - xmin) / (xmax - xmin) * w, Y = y => top + h - ((log ? Math.log10(y) : y) - ymin) / (ymax - ymin) * h;
  if (log) {
    for (let k = Math.ceil(xmin); k <= Math.floor(xmax); k++) {const xx = X(10 ** k); line(c, xx, top, xx, top + h); text(c, `1e${k}`, xx, top + h + 24, 'center');}
    for (let k = Math.ceil(ymin); k <= Math.floor(ymax); k++) {const yy = Y(10 ** k); line(c, left, yy, left + w, yy); text(c, `1e${k}`, left - 12, yy + 4, 'right');}
    c.strokeStyle = grid; c.strokeRect(left, top, w, h);
  } else for (let k = 0; k <= 5; k++) {const t = k / 5, xx = xmin + t * (xmax - xmin), yy = ymin + t * (ymax - ymin); line(c, left + t * w, top, left + t * w, top + h); line(c, left, top + (1 - t) * h, left + w, top + (1 - t) * h); text(c, fmt(xx), left + t * w, top + h + 24, 'center'); text(c, fmt(yy), left - 12, top + (1 - t) * h + 4, 'right');}
  text(c, xlabel, left + w / 2, 500, 'center'); c.save(); c.translate(23, top + h / 2); c.rotate(-Math.PI / 2); text(c, ylabel, 0, 0, 'center'); c.restore();
  return {X, Y, left, top, w, h};
}
function curve(c, xs, ys, f, color, width = 2, log = false, dash = []) {
  c.save(); c.beginPath(); c.rect(f.left, f.top, f.w, f.h); c.clip(); c.strokeStyle = color; c.lineWidth = width; c.beginPath(); let active = false;
  c.setLineDash(dash); for (let i = 0; i < xs.length; i++) {if (!Number.isFinite(ys[i]) || (log && (ys[i] <= 0 || xs[i] <= 0))) {active = false; continue;} const x = f.X(xs[i]), y = f.Y(ys[i]); active ? c.lineTo(x, y) : c.moveTo(x, y); active = true;} c.stroke(); c.restore();
}
export function profileChart(canvas, result, row) {
  const c = setup(canvas), values = result.surface.slice(row * result.cols, (row + 1) * result.cols), [lo, hi] = bounds(values), span = hi - lo;
  const f = frame(c, {xmin: 0, xmax: (result.cols - 1) * result.dx, ymin: lo - span * 0.1, ymax: hi + span * 0.1, xlabel: 'x [µm]', ylabel: 'Height [nm]'});
  const xs = Float64Array.from({length: result.cols}, (_, i) => i * result.dx); curve(c, xs, values, f, teal); text(c, `y = ${fmt(row * result.dx)} µm · row ${row + 1}`, 110, 24);
}
export function psdChart(canvas, series, {all = false, wavelength = false} = {}) {
  const c = setup(canvas); let xlo = Infinity, xhi = -Infinity, ylo = Infinity, yhi = -Infinity;
  for (const {psd} of series) for (let i = 0; i < psd.mean.length; i++) if (psd.mean[i] > 0) {const x = wavelength ? 1 / psd.frequencies[i] : psd.frequencies[i]; xlo = Math.min(xlo, x); xhi = Math.max(xhi, x); ylo = Math.min(ylo, psd.mean[i]); yhi = Math.max(yhi, psd.mean[i]);}
  if (!Number.isFinite(ylo)) {text(c, 'No PSD: no complete / interpolatable lines, or zero power.', 450, 250, 'center'); return;}
  const f = frame(c, {xmin: Math.log10(xlo), xmax: Math.log10(xhi), ymin: Math.floor(Math.log10(ylo)) - 1, ymax: Math.ceil(Math.log10(yhi)) + 1, log: true, xlabel: wavelength ? 'Spatial wavelength [µm]' : 'Spatial frequency [1/µm]', ylabel: 'PSD [nm²·µm]'});
  series.forEach((r, j) => {const xs = wavelength ? Float64Array.from(r.psd.frequencies, x => 1 / x) : r.psd.frequencies; if (all && series.length === 1) {const stride = Math.max(1, Math.ceil(r.psd.powers.length / 120)); for (let i = 0; i < r.psd.powers.length; i += stride) curve(c, xs, r.psd.powers[i], f, '#c6cdd3', 0.8, true);} curve(c, xs, r.psd.mean, f, palette[j % palette.length], 2.5, true);});
}
export function slopeMap(canvas, result, direction) {
  const legacy = result.options.mode === 'legacy', values = slope(result.surface, result.cols, result.rows, direction, result.dx, legacy);
  heatmap(canvas, values, result.cols, result.rows, result.dx, {gray: true, unit: legacy ? 'nm/pixel' : 'nm/µm'});
}

export function seriesChart(canvas, series, {xlabel='Distance along line [µm]',ylabel='Height [nm]',log=false,limits={}}={}) {
  const named=series.filter(s=>s.name), xs=series.flatMap(s=>Array.from(s.x).filter(v=>Number.isFinite(v)&&(!log||v>0))),ys=series.flatMap(s=>Array.from(s.y).filter(v=>Number.isFinite(v)&&(!log||v>0)));
  if(!xs.length||!ys.length){text(setup(canvas),'No finite data in the selected spectrum / profile.',180,250);return;}
  let [xmin,xmax]=bounds(xs),[ymin,ymax]=bounds(ys);if(log){xmin=Math.log10(xmin);xmax=Math.log10(xmax);ymin=Math.log10(ymin);ymax=Math.log10(ymax);}else{const pad=(ymax-ymin)*0.08;ymin-=pad;ymax+=pad;}
  for(const k of ['xmin','xmax','ymin','ymax'])if(limits[k]!==undefined&&!Number.isFinite(limits[k]))throw new Error('断面グラフの軸範囲は数値で指定してください。');
  xmin=limits.xmin??xmin;xmax=limits.xmax??xmax;ymin=limits.ymin??ymin;ymax=limits.ymax??ymax;
  if(xmin>=xmax||ymin>=ymax)throw new Error('軸の min は max より小さくしてください。');
  const c=setup(canvas,900,540+(named.length?Math.ceil(named.length/3)*22:0));
  const f=frame(c,{xmin,xmax,ymin,ymax,xlabel,ylabel,log});series.forEach((s,i)=>curve(c,s.x,s.y,f,s.color??palette[i%palette.length],2,log));
  named.forEach((s,i)=>{const x=65+(i%3)*280,y=537+Math.floor(i/3)*22;c.setLineDash([]);line(c,x,y-4,x+25,y-4,s.color??palette[i%palette.length]);c.setLineDash([]);text(c,s.name.length>32?s.name.slice(0,30)+'…':s.name,x+34,y);});
}
export function histogramChart(canvas,distribution) {
  const c=setup(canvas),[xmin,xmax]=bounds(distribution.centers),ymax=Math.max(...distribution.counts)*1.1||1,f=frame(c,{xmin,xmax,ymin:0,ymax,xlabel:'Height before clipping [nm]',ylabel:'Pixel count'}),step=distribution.centers.length>1?distribution.centers[1]-distribution.centers[0]:1;
  c.save();c.beginPath();c.rect(f.left,f.top,f.w,f.h);c.clip();c.fillStyle=teal;for(let k=0;k<distribution.counts.length;k++){const x=f.X(distribution.centers[k]-step/2),w=Math.max(1,f.X(distribution.centers[k]+step/2)-x-1),y=f.Y(distribution.counts[k]);c.fillRect(x,y,w,f.top+f.h-y);}c.restore();
}

export function drawProfileLines(canvas, lines) {
  const c=canvas.getContext('2d'),p=canvas._plotArea;if(!p||!canvas._surfaceBackground)return;
  c.clearRect(0,0,canvas.width,canvas.height);c.drawImage(canvas._surfaceBackground,0,0);
  const X=x=>p.left+x/((p.cols-1)*p.dx)*p.w,Y=y=>p.top+(1-y/((p.rows-1)*p.dx))*p.h;
  const cssWidth=canvas.getBoundingClientRect?.().width||canvas.width,scale=canvas.width/cssWidth;
  c.save();c.lineWidth=1*scale;c.setLineDash([]);
  for(const q of lines){c.lineWidth=1.8*scale;line(c,X(q.x0),Y(q.y0),X(q.x1),Y(q.y1),'#ffffffb0');c.lineWidth=0.9*scale;line(c,X(q.x0),Y(q.y0),X(q.x1),Y(q.y1),q.color??teal);text(c,q.name??'',X(q.x0)+4,Y(q.y0)-7,'left',q.color??teal);
    if(q.direction==='arbitrary'||(q.x0!==q.x1&&q.y0!==q.y1)){c.fillStyle=q.color??teal;for(const [x,y] of [[q.x0,q.y0],[q.x1,q.y1]]){c.beginPath();c.arc(X(x),Y(y),2.5*scale,0,Math.PI*2);c.fill();}}
  }c.restore();
}

const fftNumber=v=>v===0?'0':Math.abs(v)<.001||Math.abs(v)>=1e4?v.toExponential(2):Number(v.toFixed(4)).toString();
export function fftMap(canvas,s,display,{view,wavelengths=[],colormap='viridis',unit='log₁₀(nm²·µm²)',label='2D PSD'}={}) {
  const c=setup(canvas,900,600),cols=s.fx.length,rows=s.fy.length,full=spectrumBounds(s);
  const maxW=685,maxH=390,spanX=view.xmax-view.xmin,spanY=view.ymax-view.ymin,scale=Math.min(maxW/spanX,maxH/spanY),w=spanX*scale,h=spanY*scale,left=75+(maxW-w)/2,top=35+(maxH-h)/2;
  const X=x=>left+(x-view.xmin)*scale,Y=y=>top+(view.ymax-y)*scale;
  const off=document.createElement('canvas');off.width=cols;off.height=rows;const cc=off.getContext('2d'),pixels=cc.createImageData(cols,rows);
  for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){const rgb=color(display.values[(rows-1-y)*cols+x],display.min,display.max,false,colormap);pixels.data.set([...rgb,255],4*(y*cols+x));}cc.putImageData(pixels,0,0);
  // Crop source bin cells at their real frequency edges; nearest-neighbour rendering only.
  const xmin=Math.max(view.xmin,full.xmin),xmax=Math.min(view.xmax,full.xmax),ymin=Math.max(view.ymin,full.ymin),ymax=Math.min(view.ymax,full.ymax);
  c.imageSmoothingEnabled=false;
  if(xmin<xmax&&ymin<ymax)c.drawImage(off,(xmin-full.xmin)/s.dfX,(full.ymax-ymax)/s.dfY,(xmax-xmin)/s.dfX,(ymax-ymin)/s.dfY,X(xmin),Y(ymax),(xmax-xmin)*scale,(ymax-ymin)*scale);
  c.save();c.beginPath();c.rect(left,top,w,h);c.clip();
  const cssWidth=canvas.getBoundingClientRect?.().width||canvas.width,screenScale=canvas.width/cssWidth;
  const visibleRings=wavelengths.filter(lambda=>ringVisibility(view,lambda));
  for(const lambda of visibleRings){
    const radius=scale/lambda;
    for(const [stroke,width] of [['#243346aa',1.8],['#ffffffd9',.7]]){c.strokeStyle=stroke;c.lineWidth=width*screenScale;c.beginPath();c.arc(X(0),Y(0),radius,0,2*Math.PI);c.stroke();}
  }c.restore();
  c.font='13px sans-serif';c.strokeStyle='#c7d2db';c.strokeRect(left,top,w,h);
  const symmetric=view.mode!=='full';
  for(let k=0;k<=4;k++){const t=k/4,x=symmetric?view.xmin+t*spanX:s.fx[0]+t*(s.fx.at(-1)-s.fx[0]),y=symmetric?view.ymin+t*spanY:s.fy[0]+t*(s.fy.at(-1)-s.fy[0]);text(c,fftNumber(x),X(x),top+h+23,'center');text(c,fftNumber(y),left-12,Y(y)+4,'right');}
  text(c,'fx [cycles/µm]',left+w/2,top+h+50,'center');c.save();c.translate(left-58,top+h/2);c.rotate(-Math.PI/2);text(c,'fy [cycles/µm]',0,0,'center');c.restore();
  const barX=804;for(let k=0;k<h;k++){c.fillStyle=`rgb(${color(display.max-(display.max-display.min)*k/h,display.min,display.max,false,colormap)})`;c.fillRect(barX,top+k,16,1);}text(c,unit,barX+8,top-12,'center');for(let k=0;k<=4;k++)text(c,fmt(display.max-(display.max-display.min)*k/4),barX+22,top+k*h/4+4);
  text(c,`${label} · fx ${fftNumber(view.xmin)} to ${fftNumber(view.xmax)} / fy ${fftNumber(view.ymin)} to ${fftNumber(view.ymax)} cycles/µm`,450,514,'center');
  text(c,`Δfx ${fftNumber(s.dfX)} / Δfy ${fftNumber(s.dfY)} cycles/µm · Original FFT bins · Equal frequency scale on X/Y`,450,538,'center');
  text(c,`Color ${fftNumber(display.min)} to ${fftNumber(display.max)} ${unit} · ${display.manual?'manual':'full-spectrum scale'} · Window ${s.window}`,450,560,'center');
  text(c,wavelengths.length?`Visible rings, outer to inner: ${visibleRings.map(fftNumber).join(', ')||'none'} µm${visibleRings.length<wavelengths.length?' (other rings outside view)':''}`:'Wavelength rings: off',450,582,'center');
  canvas._fftArea={left,top,w,h,view};const background=document.createElement('canvas');background.width=canvas.width;background.height=canvas.height;background.getContext('2d').drawImage(canvas,0,0);canvas._fftBackground=background;
}
export function drawFFTProbe(canvas,sample=null) {
  const p=canvas._fftArea,background=canvas._fftBackground;if(!p||!background)return;
  const c=canvas.getContext('2d');c.clearRect(0,0,canvas.width,canvas.height);c.drawImage(background,0,0);
  if(!sample||sample.fx<p.view.xmin||sample.fx>p.view.xmax||sample.fy<p.view.ymin||sample.fy>p.view.ymax)return;
  const x=p.left+(sample.fx-p.view.xmin)/(p.view.xmax-p.view.xmin)*p.w,y=p.top+(p.view.ymax-sample.fy)/(p.view.ymax-p.view.ymin)*p.h;
  c.save();c.beginPath();c.rect(p.left,p.top,p.w,p.h);c.clip();c.strokeStyle='#243346';c.lineWidth=3;c.beginPath();c.arc(x,y,7,0,Math.PI*2);c.stroke();c.strokeStyle='#fff';c.lineWidth=1.4;c.stroke();c.restore();
}
