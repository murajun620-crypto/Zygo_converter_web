import {fftReal, surfaceStats, computePSD} from './analysis.js';

export function fftComplex(real, imaginary = new Float64Array(real.length), inverse = false) {
  if (real.length !== imaginary.length || !real.length) throw new Error('FFT 配列の長さが不正です。');
  const a = fftReal(real), b = fftReal(imaginary), n = real.length;
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let k = 0; k < n; k++) {const j = inverse ? (n - k) % n : k, scale = inverse ? n : 1; re[k] = (a.re[j] - b.im[j]) / scale; im[k] = (a.im[j] + b.re[j]) / scale;}
  return {re, im};
}

export function fft2(real, cols, rows, imaginary, inverse = false) {
  if (real.length !== cols * rows) throw new Error('2D FFT の寸法が不正です。');
  const re = Float64Array.from(real), im = imaginary ? Float64Array.from(imaginary) : new Float64Array(real.length);
  for (let y = 0; y < rows; y++) {const start = y * cols, f = fftComplex(re.subarray(start, start + cols), im.subarray(start, start + cols), inverse); re.set(f.re, start); im.set(f.im, start);}
  for (let x = 0; x < cols; x++) {const a = Float64Array.from({length: rows}, (_, y) => re[y * cols + x]), b = Float64Array.from({length: rows}, (_, y) => im[y * cols + x]), f = fftComplex(a, b, inverse); for (let y = 0; y < rows; y++) {re[y * cols + x] = f.re[y]; im[y * cols + x] = f.im[y];}}
  return {re, im};
}

function solve(matrix, rhs) {
  const n = rhs.length, a = matrix.map((row, i) => [...row, rhs[i]]);
  for (let j = 0; j < n; j++) {
    let p = j; for (let i = j + 1; i < n; i++) if (Math.abs(a[i][j]) > Math.abs(a[p][j])) p = i;
    if (Math.abs(a[p][j]) < 1e-10) throw new Error('有効点の配置から選択した形状をフィットできません。');
    [a[p], a[j]] = [a[j], a[p]]; const d = a[j][j]; for (let k = j; k <= n; k++) a[j][k] /= d;
    for (let i = 0; i < n; i++) if (i !== j) {const d = a[i][j]; for (let k = j; k <= n; k++) a[i][k] -= d * a[j][k];}
  }
  return a.map(row => row[n]);
}
export function removeForm(phase, cols, rows, form) {
  const basis = (x, y) => form === 'piston' ? [1] : form === 'sphere' ? [1, x, y, x*x + y*y] : form === 'cylinder-x' ? [1, x, y, x*x] : form === 'cylinder-y' ? [1, x, y, y*y] : [1, x, y, x*x, x*y, y*y];
  if (!['none', 'piston', 'sphere', 'cylinder-x', 'cylinder-y', 'quadratic'].includes(form)) throw new Error('形状補正が不正です。');
  const out = new Float64Array(phase.length), span = Math.max(cols - 1, rows - 1), count = basis(0,0).length;
  const matrix = Array.from({length: count}, () => Array(count).fill(0)), rhs = Array(count).fill(0);
  if (form !== 'none') {
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {const z = phase[y*cols+x]; if (!Number.isFinite(z)) continue; const b = basis((x-(cols-1)/2)/span,(y-(rows-1)/2)/span); for (let i=0;i<count;i++) {rhs[i]+=z*b[i]; for (let j=0;j<count;j++) matrix[i][j]+=b[i]*b[j];}}
  }
  const coefficients = form === 'none' ? [] : solve(matrix,rhs);
  for (let y=0;y<rows;y++) for(let x=0;x<cols;x++) {const b=basis((x-(cols-1)/2)/span,(y-(rows-1)/2)/span); out[(rows-1-y)*cols+x]=phase[y*cols+x]-b.reduce((s,v,i)=>s+v*(coefficients[i]??0),0);}
  return {rawSurface:out,coefficients};
}

export function filterGain(f, options) {
  const {filter='off', cutoffLow=0.01, cutoffHigh=0.1, rolloff='gaussian'} = options;
  const low = fc => rolloff === 'sharp' ? (f <= fc ? 1 : 0) : Math.exp(-Math.log(2)*(f/fc)**2);
  if (filter==='off') return 1;
  if (filter==='lowpass') return low(cutoffHigh);
  if (filter==='highpass') return 1-low(cutoffLow);
  const band = (1-low(cutoffLow))*low(cutoffHigh);
  return filter==='bandpass' ? band : 1-band;
}
// Fill isolated gaps along X, then Y. Filled points are used only by FFT and masked again afterward.
function fillGaps(data, cols, rows) {
  const out=Float64Array.from(data);
  function fill(indices) {const good=indices.filter(i=>Number.isFinite(out[i])); if(!good.length)return; let j=0; for(let k=0;k<indices.length;k++) {const i=indices[k]; if(Number.isFinite(out[i]))continue; while(j<good.length-1&&good[j+1]<i)j++; const a=good[j],b=good[Math.min(j+1,good.length-1)]; out[i]=i<=good[0]?out[good[0]]:i>=good.at(-1)?out[good.at(-1)]:out[a]+(out[b]-out[a])*(i-a)/(b-a);}}
  for(let y=0;y<rows;y++)fill(Array.from({length:cols},(_,x)=>y*cols+x));
  for(let x=0;x<cols;x++)fill(Array.from({length:rows},(_,y)=>y*cols+x));
  if(out.some(z=>!Number.isFinite(z)))throw new Error('FFT の欠損補間に失敗しました。');
  return out;
}
export function filterSurface(data, cols, rows, dx, options) {
  if(!options.filter||options.filter==='off') return Float64Array.from(data);
  if(!['lowpass','highpass','bandpass','bandreject'].includes(options.filter)||!['gaussian','sharp'].includes(options.rolloff??'gaussian')||!['periodic','reflect'].includes(options.edge??'reflect'))throw new Error('FFT フィルター設定が不正です。');
  const low=options.cutoffLow,high=options.cutoffHigh,nyquist=1/(2*dx);
  if(options.filter!=='lowpass'&&(!(low>0)||low>nyquist))throw new Error('低周波カットオフは 0 より大きく Nyquist 以下にしてください。');
  if(options.filter!=='highpass'&&(!(high>0)||high>nyquist))throw new Error('高周波カットオフは 0 より大きく Nyquist 以下にしてください。');
  if(options.filter.startsWith('band')&&low>=high)throw new Error('帯域の低周波カットオフは高周波カットオフより小さくしてください。');
  const reflect=(options.edge??'reflect')==='reflect', cw=reflect?2*cols-2:cols,rh=reflect?2*rows-2:rows;
  if(cw*rh>2_000_000)throw new Error('反射拡張後の FFT は 200 万点までです。「周期境界」を選ぶか小さい測定を使用してください。');
  const filled=fillGaps(data,cols,rows),input=Float64Array.from({length:cw*rh},(_,i)=>{let x=i%cw,y=Math.floor(i/cw);if(x>=cols)x=cw-x;if(y>=rows)y=rh-y;return filled[y*cols+x];});
  const f=fft2(input,cw,rh);
  for(let y=0;y<rh;y++)for(let x=0;x<cw;x++){const fx=(x<=cw/2?x:x-cw)/(cw*dx),fy=(y<=rh/2?y:y-rh)/(rh*dx),i=y*cw+x,g=filterGain(Math.hypot(fx,fy),options);f.re[i]*=g;f.im[i]*=g;}
  const filtered=fft2(f.re,cw,rh,f.im,true),out=new Float64Array(data.length);
  for(let y=0;y<rows;y++)for(let x=0;x<cols;x++)out[y*cols+x]=Number.isFinite(data[y*cols+x])?filtered.re[y*cw+x]:NaN;
  return out;
}

export function spectrum2D(data,cols,rows,dx,window='hann') {
  const stats=surfaceStats(data),input=new Float64Array(data.length);let energy=0,weight=0;
  for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){const i=y*cols+x,w=window==='hann'?(0.5-0.5*Math.cos(2*Math.PI*x/cols))*(0.5-0.5*Math.cos(2*Math.PI*y/rows)):1;if(Number.isFinite(data[i])){input[i]=(data[i]-stats.mean)*w;energy+=w*w;weight+=w;}}
  if(!energy){if(window==='hann')return {...spectrum2D(data,cols,rows,dx,'boxcar'),requestedWindow:'hann',windowFallback:true};throw new Error('2D FFT の窓内に有効点がありません。');}
  const f=fft2(input,cols,rows),power=new Float64Array(data.length),amplitude=new Float64Array(data.length),fx=Float64Array.from({length:cols},(_,x)=>(x-Math.floor(cols/2))/(cols*dx)),fy=Float64Array.from({length:rows},(_,y)=>(y-Math.floor(rows/2))/(rows*dx));
  const dfX=1/(cols*dx),dfY=1/(rows*dx),dr=Math.max(dfX,dfY),bins=Math.floor((1/(2*dx))/dr)+1,radial=new Float64Array(bins),counts=new Uint32Array(bins);
  let peak=0,peakX=0,peakY=0,total=0,cos2=0,sin2=0;
  for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){const a=((y+Math.ceil(rows/2))%rows)*cols+(x+Math.ceil(cols/2))%cols,i=y*cols+x,q=f.re[a]**2+f.im[a]**2,r=Math.hypot(fx[x],fy[y]),p=q*dx*dx/energy;power[i]=p;amplitude[i]=Math.sqrt(q)/weight;if(r===0)continue;const k=Math.round(r/dr);if(k<bins&&r<=1/(2*dx)){radial[k]+=p;counts[k]++;total+=p;cos2+=p*Math.cos(2*Math.atan2(fy[y],fx[x]));sin2+=p*Math.sin(2*Math.atan2(fy[y],fx[x]));if(p>peak){peak=p;peakX=fx[x];peakY=fy[y];}}}
  for(let k=0;k<bins;k++)radial[k]=counts[k]?radial[k]/counts[k]:NaN;
  return {power,amplitude,fx,fy,dfX,dfY,window,missing:stats.n<data.length,validPercent:stats.validPercent,unit:'nm²·µm²',frequencies:Float64Array.from({length:bins-1},(_,k)=>(k+1)*dr),radial:radial.slice(1),peakFrequency:Math.hypot(peakX,peakY),peakWavelength:peak>0?1/Math.hypot(peakX,peakY):NaN,wavevectorAngle:((Math.atan2(peakY,peakX)*180/Math.PI)%180+180)%180,anisotropy:total>0?Math.hypot(cos2,sin2)/total:NaN,principalAngle:total>0?((Math.atan2(sin2,cos2)*90/Math.PI)%180+180)%180:NaN};
}

export function extractProfile(result,line) {
  const {cols,rows,dx,surface}=result,{x0,y0,x1,y1}=line,maxX=(cols-1)*dx,maxY=(rows-1)*dx;
  if(![x0,y0,x1,y1].every(Number.isFinite)||Math.min(x0,x1,y0,y1)<0||Math.max(x0,x1)>maxX+1e-8||Math.max(y0,y1)>maxY+1e-8)throw new Error('断面の端点は測定範囲内の座標で指定してください。');
  const length=Math.hypot(x1-x0,y1-y0);if(length<=0)throw new Error('断面の始点と終点を離してください。');
  const intervals=Math.max(1,Math.ceil(length/dx-1e-10)),distance=new Float64Array(intervals+1),height=new Float64Array(intervals+1),x=new Float64Array(intervals+1),y=new Float64Array(intervals+1);
  for(let k=0;k<=intervals;k++){const t=k/intervals;distance[k]=t*length;x[k]=x0+(x1-x0)*t;y[k]=y0+(y1-y0)*t;const xx=Math.max(0,Math.min(cols-1,x[k]/dx)),yy=Math.max(0,Math.min(rows-1,y[k]/dx)),a=Math.floor(xx),b=Math.floor(yy),u=xx-a,v=yy-b;let z=0;const points=[[a,b,(1-u)*(1-v)],[Math.min(a+1,cols-1),b,u*(1-v)],[a,Math.min(b+1,rows-1),(1-u)*v],[Math.min(a+1,cols-1),Math.min(b+1,rows-1),u*v]];for(const [px,py,w] of points)if(w>1e-12)z+=surface[py*cols+px]*w;height[k]=z;}
  return {...line,distance,height,x,y,length,file:result.name};
}
export function heightDistribution(data,bins=60) {
  const stats=surfaceStats(data),width=(stats.max-stats.min)/bins||1,counts=new Uint32Array(bins),centers=Float64Array.from({length:bins},(_,i)=>stats.min+(i+0.5)*width);let m3=0,m4=0;
  for(const z of data)if(Number.isFinite(z)){counts[Math.min(bins-1,Math.floor((z-stats.min)/width))]++;const a=(z-stats.mean)/stats.sq;m3+=a**3;m4+=a**4;}
  return {centers,counts,ssk:stats.sq>0?m3/stats.n:NaN,sku:stats.sq>0?m4/stats.n:NaN};
}
export function researchAnalysis(data,cols,rows,dx,window,heightData=data) {
  const opts={mode:'density',window,missing:'interpolate'};
  return {window,spectrum:spectrum2D(data,cols,rows,dx,window),distribution:heightDistribution(heightData),x:computePSD(data,cols,rows,dx,{...opts,direction:'x'}),y:computePSD(data,cols,rows,dx,{...opts,direction:'y'})};
}
export function bandRMS(psd,minWavelength,maxWavelength) {
  if(!(minWavelength>0)||!(maxWavelength>minWavelength))throw new Error('波長帯は 0 < 最短波長 < 最長波長で指定してください。');
  let variance=0,bins=0;for(let i=0;i<psd.frequencies.length;i++){const f=psd.frequencies[i];if(f>=1/maxWavelength&&f<=1/minWavelength&&Number.isFinite(psd.mean[i])){variance+=psd.mean[i]*psd.df;bins++;}}
  return {rms:bins?Math.sqrt(Math.max(0,variance)):NaN,bins};
}
