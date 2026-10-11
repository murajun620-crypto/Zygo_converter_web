// Display geometry only. These functions never filter, resample or change the spectrum.
export function spectrumBounds(s) {
  return {xmin:s.fx[0]-s.dfX/2,xmax:s.fx.at(-1)+s.dfX/2,ymin:s.fy[0]-s.dfY/2,ymax:s.fy.at(-1)+s.dfY/2};
}
export function fftView(s,mode='full',range=null) {
  const full=spectrumBounds(s),nyquist=Math.min(s.fx.length*s.dfX,s.fy.length*s.dfY)/2;
  if(mode==='full')return {...full,mode,nyquist};
  if(!['2','5','10','custom'].includes(mode))throw Error('FFT表示範囲が不正です。');
  const extent=mode==='custom'?Number(range):nyquist/Number(mode);
  if(!Number.isFinite(extent)||extent<=0||extent>nyquist*(1+1e-10))throw Error(`FFT表示範囲は0より大きく、Nyquist (${nyquist.toPrecision(4)} 1/µm) 以下にしてください。`);
  if(extent+1e-12<Math.max(s.dfX,s.dfY))throw Error(`表示範囲は少なくとも1ビン幅 (${Math.max(s.dfX,s.dfY).toPrecision(4)} 1/µm) にしてください。拡大しても分解能は増えません。`);
  return {xmin:-extent,xmax:extent,ymin:-extent,ymax:extent,mode,nyquist};
}
export function parseWavelengths(text) {
  if(!String(text).trim())return [];
  const values=String(text).trim().split(/[,、，;；\s]+/).map(Number);
  if(values.length>8||values.some(v=>!Number.isFinite(v)||v<=0))throw Error('等波長の円は、正の波長を最大8個、カンマで区切って指定してください。');
  return [...new Set(values)].sort((a,b)=>a-b);
}
export function displayColors(s,{kind='power',log=true,dc=false,min=null,max=null}={}) {
  if(!['power','amplitude'].includes(kind))throw Error('FFT表示量が不正です。');
  const values=Float64Array.from(s[kind],v=>log?(v>0?Math.log10(v):NaN):v);
  if(!dc)values[Math.floor(s.fy.length/2)*s.fx.length+Math.floor(s.fx.length/2)]=NaN;
  let lo=Infinity,hi=-Infinity;
  for(const v of values)if(Number.isFinite(v)){lo=Math.min(lo,v);hi=Math.max(hi,v);}
  if(!Number.isFinite(lo)){lo=log?-1:0;hi=log?0:1;}
  if(lo===hi)hi=lo+1;
  const manual=min!==null||max!==null;
  if(manual){if(min!==null&&!Number.isFinite(min)||max!==null&&!Number.isFinite(max))throw Error('色範囲には数値か空欄のAutoを指定してください。');lo=min??lo;hi=max??hi;if(lo>=hi)throw Error('色範囲は min < max にしてください。空欄は全域の値からAutoで求めます。');}
  return {values,min:lo,max:hi,manual,minAuto:min===null,maxAuto:max===null};
}
export function frequencyInfo(fx,fy) {
  const frequency=Math.hypot(fx,fy),dc=frequency===0;
  const angle=dc?null:((Math.atan2(fy,fx)*180/Math.PI)%180+180)%180;
  return {fx,fy,frequency,wavelength:dc?Infinity:1/frequency,angle,stripeAngle:dc?null:(angle+90)%180,dc};
}
export function sampleSpectrum(s,fx,fy,kind='power') {
  if(!Number.isFinite(fx)||!Number.isFinite(fy))throw Error('調べる周波数には数値を指定してください。');
  // Probe the original FFT bin, not an interpolated or zero-padded value.
  const x=Math.max(0,Math.min(s.fx.length-1,Math.round((fx-s.fx[0])/s.dfX))),y=Math.max(0,Math.min(s.fy.length-1,Math.round((fy-s.fy[0])/s.dfY)));
  const index=y*s.fx.length+x;
  return {...frequencyInfo(s.fx[x],s.fy[y]),x,y,index,value:s[kind][index]};
}
export function pointerFrequency(area,point) {
  const tx=(point.x-area.left)/area.w,ty=(point.y-area.top)/area.h;
  if(tx<0||tx>1||ty<0||ty>1)return null;
  return {fx:area.view.xmin+tx*(area.view.xmax-area.view.xmin),fy:area.view.ymax-ty*(area.view.ymax-area.view.ymin)};
}
export function ringVisibility(view,wavelength) {
  const radius=1/wavelength,nearX=view.xmin>0?view.xmin:view.xmax<0?-view.xmax:0,nearY=view.ymin>0?view.ymin:view.ymax<0?-view.ymax:0;
  const near=Math.hypot(nearX,nearY),far=Math.max(...[view.xmin,view.xmax].flatMap(x=>[view.ymin,view.ymax].map(y=>Math.hypot(x,y))));
  return radius>=near&&radius<=far;
}
