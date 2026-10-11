import {computePSD, surfaceStats, prepareSurface, slope} from './analysis.js';
import {spectrum2D, extractProfile, filterSurface, heightDistribution, bandRMS} from './advanced.js';

// Educational surfaces are generated locally and use the same numerical routines as DAT analysis.
export const SIZE = 64, DX = 2.5, SPAN = (SIZE - 1) * DX;
const TAU = 2 * Math.PI, colors = ['#137c80','#d46b35','#7952b3'];
const wave = (x, wavelength, amplitude = 3) => amplitude * Math.cos(TAU * x / wavelength);
function noise() {
  let seed = 48179;
  const uniform = () => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return (seed + .5) / 4294967296;};
  const out = Float64Array.from({length: SIZE * SIZE}, () => Math.sqrt(-2 * Math.log(uniform())) * Math.cos(TAU * uniform()));
  const s = surfaceStats(out); return out.map(z => (z - s.mean) * (3 / Math.sqrt(2)) / s.sq);
}
const random = noise();
// Rounded Gaussian grooves: a teaching model of scratches, not a polishing simulation.
// Share positions/depths/widths/lengths between cases to isolate directional differences.
export function scratchFeatures(id) {
  const directions={'scratch-vertical':90,'scratch-horizontal':0,'scratch-diagonal':45,'scratch-random':null};
  if(!Object.hasOwn(directions,id))throw new Error(`Unknown scratch case: ${id}`);
  let seed=76043;
  const uniform=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return (seed+.5)/4294967296;};
  return Array.from({length:18},()=>{
    const x=SPAN*uniform(),y=SPAN*uniform(),depth=4+10*uniform(),sigma=2.5+1.5*uniform(),length=110+90*uniform(),phase=TAU*uniform(),u=uniform();
    return {x,y,depth,sigma,length,phase,angle:directions[id]===null?180*u:directions[id]+20*(u-.5)};
  });
}
const scratchIds=['scratch-vertical','scratch-horizontal','scratch-diagonal','scratch-random'];
const scratches=Object.fromEntries(scratchIds.map(id=>{
  const features=scratchFeatures(id).map(g=>({...g,c:Math.cos(g.angle*Math.PI/180),s:Math.sin(g.angle*Math.PI/180)}));
  const data=Float64Array.from({length:SIZE*SIZE},(_,i)=>{
    const x=i%SIZE*DX,y=Math.floor(i/SIZE)*DX;
    let height=.12*random[i];
    for(const g of features){const rx=x-g.x,ry=y-g.y,along=rx*g.c+ry*g.s,across=-rx*g.s+ry*g.c;
      height-=g.depth*Math.exp(-.5*(across/g.sigma)**2-(along/(g.length/2))**8)*(1+.1*Math.sin(TAU*along/g.length+g.phase));
    }
    return height;
  });
  return [id,data];
}));
export const cases = {
  flat: ['凹凸のない平坦面', () => 0],
  short: ['20 µm間隔の縦筋', (x) => wave(x,20)],
  long: ['40 µm間隔の縦筋', (x) => wave(x,40)],
  horizontal: ['20 µm間隔の横筋', (x,y) => wave(y,20)],
  diagonal: ['斜め45°の筋（間隔28.3 µm）', (x,y) => 3*Math.cos(TAU*(x+y)/40)],
  random: ['方向のないランダムな凹凸', (x,y,i) => random[i]],
  pit: ['局所的な深い谷', (x,y) => -20*Math.exp(-((x-80)**2+(y-80)**2)/(2*4**2))],
  valley: ['ランダム面＋深い谷', (x,y,i) => random[i]-25*Math.exp(-((x-80)**2+(y-80)**2)/(2*6**2))],
  peak: ['ランダム面＋高い突起', (x,y,i) => random[i]+25*Math.exp(-((x-80)**2+(y-80)**2)/(2*6**2))],
  tilt: ['傾いた面＋20 µmの筋', (x,y) => .12*(x-80)+.07*(y-80)+wave(x,20)],
  bowl: ['曲がった面＋20 µmの筋', (x,y) => .002*((x-80)**2+(y-80)**2)+wave(x,20)],
  mixed: ['80 µmのうねり＋20 µmの筋', x => wave(x,80)+wave(x,20,1.5)],
  leakage: ['測定幅に収まらない23 µm周期', x => wave(x,23)],
  gap: ['20 µmの筋＋測れていない帯', x => x>=70&&x<90?NaN:wave(x,20)],
  tall: ['振幅6 nm・20 µmの筋', x => wave(x,20,6)],
  'scratch-vertical':['垂直に偏ったスクラッチ（角度・深さにばらつき）',(x,y,i)=>scratches['scratch-vertical'][i]],
  'scratch-horizontal':['水平に偏ったスクラッチ（角度・深さにばらつき）',(x,y,i)=>scratches['scratch-horizontal'][i]],
  'scratch-diagonal':['斜め45°に偏ったスクラッチ（角度・深さにばらつき）',(x,y,i)=>scratches['scratch-diagonal'][i]],
  'scratch-random':['方向・深さがランダムなスクラッチ',(x,y,i)=>scratches['scratch-random'][i]]
};
export function exampleSurface(id) {
  if (!cases[id]) throw new Error(`Unknown synthetic case: ${id}`);
  return Float64Array.from({length:SIZE*SIZE},(_,i)=>cases[id][1]((i%SIZE)*DX,Math.floor(i/SIZE)*DX,i));
}
export function examplePSD(data, direction='x', window='boxcar', missing='interpolate') {
  return computePSD(data,SIZE,SIZE,DX,{mode:'density',direction,window,missing});
}
export function exampleCorrection(data, form) {
  const phase = Float64Array.from({length:data.length},(_,i)=>data[(SIZE-1-Math.floor(i/SIZE))*SIZE+i%SIZE]);
  return prepareSurface({phase,cols:SIZE,rows:SIZE,dx:DX},{form,filter:'off',clip:false}).rawSurface;
}
export function exampleHighPass(data) {
  return filterSurface(data,SIZE,SIZE,DX,{filter:'highpass',cutoffLow:1/40,rolloff:'gaussian',edge:'periodic'});
}
export const groups = {
  surface:['flat','short','diagonal','random','pit'], profile:['short','horizontal','diagonal','pit'],
  intensity:['flat'], slope:['short','horizontal','diagonal'], stats:['short','long','random','pit'],
  form:['tilt','bowl'], filter:['mixed'], psd:['short','long','random','pit'],
  window:['leakage','gap'], clip:['tall'], fft:['short','horizontal','diagonal','random'],
  radial:['short','random'], xy:['short','horizontal','diagonal','random'],
  cumulative:['mixed','short','long'], distribution:['random','valley','peak'],
  band:['mixed','short','long'], compare:['long','random']
};
// Scratches are useful across views; intensity/form/filter/clip retain their focused examples.
for(const topic of ['surface','profile','slope','stats','psd','window','fft','radial','xy','cumulative','distribution','band','compare'])groups[topic].push(...scratchIds);
function element(tag,text,className) {const node=document.createElement(tag);if(text)node.textContent=text;if(className)node.className=className;return node;}
const fmt = value => Number.isFinite(value)?value.toFixed(2):'—';
function statsText(data) {const s=surfaceStats(data);return `Sq ${fmt(s.sq)} nm · Sa ${fmt(s.sa)} nm · PV ${fmt(s.pv)} nm`;}
function panel(grid,title,caption,draw) {
  const figure=element('figure',null,'example-figure'),h=element('h4',title),canvas=element('canvas');
  canvas.width=440;canvas.height=310;canvas.setAttribute('role','img');canvas.setAttribute('aria-label',`${title}。${caption}`);
  figure.append(h,canvas,element('figcaption',caption));grid.append(figure);draw(canvas);
}
function palette(t) {
  t=Math.max(0,Math.min(1,t));const low=[44,101,156],mid=[247,249,250],high=[213,92,39],a=t<.5?low:mid,b=t<.5?mid:high,u=t<.5?t*2:(t-.5)*2;
  return a.map((v,i)=>Math.round(v+(b[i]-v)*u));
}
function map(canvas,data,{limit=null,range=null,lines=false,frequency=false,gray=false,label='高さ [nm]'}={}) {
  const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,440,310);
  const left=54,top=16,w=252,h=252,bar=324,finite=Array.from(data).filter(Number.isFinite);
  const max=range?.[1]??limit??Math.max(...finite.map(Math.abs),1e-12),min=range?.[0]??(gray?0:-max);
  const off=document.createElement('canvas');off.width=SIZE;off.height=SIZE;const c=off.getContext('2d'),pixels=c.createImageData(SIZE,SIZE);
  for(let y=0;y<SIZE;y++)for(let x=0;x<SIZE;x++) {const z=data[(SIZE-1-y)*SIZE+x],i=4*(y*SIZE+x),t=Math.max(0,Math.min(1,(z-min)/(max-min))),rgb=Number.isFinite(z)?gray?[t*255,t*255,t*255]:palette(t):[194,200,205];pixels.data.set([...rgb,255],i);}
  c.putImageData(pixels,0,0);ctx.imageSmoothingEnabled=false;ctx.drawImage(off,left,top,w,h);ctx.strokeStyle='#c3cdd7';ctx.strokeRect(left,top,w,h);
  ctx.font='12px "Segoe UI", sans-serif';ctx.fillStyle='#47586a';ctx.textAlign='center';
  const extent=SPAN,df=1/(SIZE*DX),freqMin=-(SIZE/2+.5)*df;
  const ticks=frequency?[-SIZE/2*df,-.1,0,.1,(SIZE/2-1)*df]:[0,40,80,120,SPAN];
  for(const tick of ticks){const t=frequency?(tick-freqMin)/(SIZE*df):tick/extent,value=String(Number(tick.toFixed(frequency?3:1)));ctx.fillText(value,left+w*t,top+h+19);ctx.textAlign='right';ctx.fillText(value,left-8,top+h*(1-t)+4);ctx.textAlign='center';}
  ctx.fillText(frequency?'fx [1/µm]':'X [µm]',left+w/2,305);ctx.save();ctx.translate(13,top+h/2);ctx.rotate(-Math.PI/2);ctx.fillText(frequency?'fy [1/µm]':'Y [µm]',0,0);ctx.restore();
  for(let j=0;j<h;j++){const t=1-j/h,rgb=gray?[t*255,t*255,t*255]:palette(t);ctx.fillStyle=`rgb(${rgb.join(',')})`;ctx.fillRect(bar,top+j,13,1);}
  ctx.textAlign='left';ctx.fillStyle='#47586a';ctx.fillText(fmt(max),bar+20,top+9);ctx.fillText(fmt(min),bar+20,top+h);ctx.fillText(gray?'':fmt((min+max)/2),bar+20,top+h/2+4);
  ctx.save();ctx.translate(422,top+h/2);ctx.rotate(-Math.PI/2);ctx.textAlign='center';ctx.fillText(label,0,0);ctx.restore();
  if(lines){const pairs=[[[0,.5],[1,.5]],[[.5,0],[.5,1]],[[0,0],[1,1]]];pairs.forEach((pair,i)=>{ctx.beginPath();ctx.strokeStyle=colors[i];ctx.lineWidth=1.5;for(const [j,p] of pair.entries()){const a=left+w*p[0],b=top+h*(1-p[1]);if(j)ctx.lineTo(a,b);else ctx.moveTo(a,b);}ctx.stroke();ctx.fillStyle=colors[i];ctx.textAlign='left';ctx.fillText(['X','Y','任意'][i],left+w*pair[1][0]-22,top+h*(1-pair[1][1])+14);});}
}
function curve(canvas,series,{log=false,xlabel='距離 [µm]',ylabel='高さ [nm]',xrange=null,yrange=null}={}) {
  const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,440,310);
  const l=66,t=22,w=352,h=228,values=series.flatMap(s=>Array.from(s.y).filter(Number.isFinite));
  const max=Math.max(0,...values),floor=max*1e-8;
  const transformX=v=>log?Math.log10(v):v,transformY=v=>log?Math.log10(Math.max(v,floor)):v;
  if(log&&max<=1e-25){ctx.font='15px "Segoe UI",sans-serif';ctx.fillStyle='#627287';ctx.textAlign='center';ctx.fillText('凹凸なし → PSD = 0',220,155);return;}
  let xmin,xmax,ymin,ymax;
  if(log){[xmin,xmax]=(xrange??[5,160]).map(transformX);[ymin,ymax]=(yrange??[floor,max*2]).map(transformY);}
  else {const xs=series.flatMap(s=>Array.from(s.x).filter(Number.isFinite));[xmin,xmax]=xrange??[Math.min(...xs),Math.max(...xs)];[ymin,ymax]=yrange??[Math.min(0,...values),Math.max(0,...values)];if(ymax-ymin<1e-9){ymin-=1;ymax+=1;}else{const pad=(ymax-ymin)*.1;ymin-=pad;ymax+=pad;}}
  const px=v=>l+w*(transformX(v)-xmin)/(xmax-xmin),py=v=>t+h-h*(transformY(v)-ymin)/(ymax-ymin);
  ctx.font='12px "Segoe UI",sans-serif';ctx.lineWidth=1;
  const xticks=log?[5,10,20,40,80,160]:Array.from({length:5},(_,i)=>xmin+(xmax-xmin)*i/4);
  for(const v of xticks){const x=px(v);ctx.strokeStyle='#e7edf2';ctx.beginPath();ctx.moveTo(x,t);ctx.lineTo(x,t+h);ctx.stroke();ctx.fillStyle='#47586a';ctx.textAlign='center';ctx.fillText(log?String(v):String(Number(v.toFixed(1))),x,t+h+20);}
  const yticks=log?Array.from({length:5},(_,i)=>10**(ymax-(ymax-ymin)*i/4)):Array.from({length:5},(_,i)=>ymin+(ymax-ymin)*i/4);
  for(const v of yticks){const y=py(v);ctx.strokeStyle='#e7edf2';ctx.beginPath();ctx.moveTo(l,y);ctx.lineTo(l+w,y);ctx.stroke();ctx.fillStyle='#47586a';ctx.textAlign='right';ctx.fillText(log?v.toExponential(0):String(Number(v.toFixed(1))),l-8,y+4);}
  ctx.save();ctx.beginPath();ctx.rect(l,t,w,h);ctx.clip();
  for(const [j,s] of series.entries()){ctx.beginPath();ctx.strokeStyle=s.color??colors[j%3];ctx.lineWidth=1.8;let started=false;for(let i=0;i<s.x.length;i++){const x=s.x[i],y=s.y[i];if(!Number.isFinite(x)||!Number.isFinite(y)||log&&x<=0){started=false;continue;}if(!started){ctx.moveTo(px(x),py(y));started=true;}else ctx.lineTo(px(x),py(y));}ctx.stroke();}ctx.restore();
  ctx.strokeStyle='#b5c2cc';ctx.strokeRect(l,t,w,h);ctx.fillStyle='#47586a';ctx.textAlign='center';ctx.fillText(xlabel,l+w/2,300);ctx.save();ctx.translate(16,t+h/2);ctx.rotate(-Math.PI/2);ctx.fillText(ylabel,0,0);ctx.restore();
}
const psdSeries=(psd,name,color)=>({x:Float64Array.from(psd.frequencies,f=>1/f),y:psd.mean,name,color});
function psdPanel(grid,title,series,caption,ylabel='PSD [nm²·µm]') {panel(grid,title,caption,c=>curve(c,series,{log:true,xlabel:'空間波長 [µm]',ylabel}));}
function profile(data,direction='x') {
  const line=direction==='x'?{x0:0,y0:80,x1:SPAN,y1:80}:direction==='y'?{x0:80,y0:0,x1:80,y1:SPAN}:{x0:0,y0:0,x1:SPAN,y1:SPAN};
  const p=extractProfile({surface:data,cols:SIZE,rows:SIZE,dx:DX,name:'説明用合成面'},line);return {x:p.distance,y:p.height};
}
function cumulative(p){let sum=0;return {x:Float64Array.from(p.frequencies,f=>1/f),y:Float64Array.from(p.mean,v=>Math.sqrt(sum+=v*p.df))};}
const scratchSpectra=Object.fromEntries(scratchIds.map(id=>[id,spectrum2D(scratches[id],SIZE,SIZE,DX,'hann')]));
const scratchColorTop=Math.log10(Math.max(...scratchIds.map(id=>Math.max(...scratchSpectra[id].power))));
function fftPanel(grid,data,id=null){
  const scratch=scratchIds.includes(id),s=scratch?scratchSpectra[id]:spectrum2D(data,SIZE,SIZE,DX,'boxcar'),max=Math.max(...s.power),top=scratch?scratchColorTop:Math.log10(max),logPower=s.power.map(p=>Math.log10(Math.max(p,10**(top-8))));
  if(scratch)logPower[Math.floor(SIZE/2)*SIZE+Math.floor(SIZE/2)]=NaN;
  const caption=scratch?`Hann窓・DC非表示・4例で共通の色範囲。角度集中度 ${fmt(s.anisotropy)}、周波数の主軸 ${fmt(s.principalAngle)}°${id==='scratch-random'?'（方向の偏りが弱く、傷の代表方向とは解釈しません）':`（傷に相当する向き ${fmt((s.principalAngle+90)%180)}°）`}。有限長・角度・幅のばらつきにより帯が広がります。最大の1点を傷の向きと決めつけません。`:`対称な2点は同じ周期。ピーク波長 ${fmt(s.peakWavelength)} µm、繰り返す方向 ${fmt(s.wavevectorAngle)}°。中心からの方向は筋に直交。`;
  panel(grid,scratch?'② 2D FFTで傷の方向性を見る':'② 2D FFTで筋の向きを見る',caption,c=>map(c,logPower,{frequency:true,gray:true,range:[top-8,top],label:'log₁₀ 2D PSD [nm²·µm²]'}));return s;
}

export function renderExamples(topic,host) {
  const ids=groups[topic];if(!ids)throw new Error(`Missing example group: ${topic}`);
  const section=element('section',null,'help-examples'),label=element('label','解析する表面の例'),select=element('select');select.setAttribute('aria-label','説明用の表面例');
  for(const id of ids){const option=element('option',cases[id][0]);option.value=id;select.append(option);}label.append(select);
  const note=element('p','説明用の合成データです（実測DATではありません）。64 × 64点、画素間隔2.5 µm。図の数値はアプリと同じ解析処理で計算します。','example-note'),takeaway=element('p',null,'example-takeaway'),grid=element('div',null,'example-grid');
  section.append(label,note,takeaway,grid);host.append(section);
  function draw(){const id=select.value,data=exampleSurface(id),scratch=scratchIds.includes(id),p=examplePSD(data,'x',scratch?'hann':'boxcar');grid.replaceChildren();
    if(!scratch)note.textContent='説明用の合成データです（実測DATではありません）。64 × 64点、画素間隔2.5 µm。図の数値はアプリと同じ解析処理で計算します。';
    const surface=(title='① 表面マップ',d=data,caption=statsText(d),opts={})=>panel(grid,title,caption,c=>map(c,d,opts));
    const profiles=(title,datasets,caption)=>panel(grid,title,caption,c=>curve(c,datasets));
    const psds=(title,sets,caption)=>psdPanel(grid,title,sets,caption);
    let text='';
    if(scratch){
      const directional=id!=='scratch-random',py=examplePSD(data,'y','hann');
      const direction={'scratch-vertical':'垂直（90°）','scratch-horizontal':'水平（0°）','scratch-diagonal':'斜め（45°）'}[id];
      text=directional?`${direction}を中心に角度が約±10°ばらつく傷です。傷を横切る方向では高さが大きく変わり、FFTには傷と直交する方向に広がった帯が現れます。傷の間隔は一定ではないため、等間隔の筋のような鋭い周期ピークにはなりません。`:'方向も深さもランダムな傷です。FFTのパワーは多方向に広がりますが、傷の本数が有限で交差・配置にも偏りがあるため、完全な円対称や角度集中度0にはなりません。';
      note.textContent='研磨スクラッチを模した合成データ（実測ではありません）。64 × 64点、間隔2.5 µm。18本のガウス形の溝。各溝の公称深さ4〜14 nm、半値全幅約6〜9.4 µm、長さ110〜200 µm。深さは溝に沿っても±10%変化し、端はなだらか。交差部は溝を足すため個々の深さより深くなります。4例は位置・深さ・幅・長さ・背景を共通にし、方向だけを変更。モデルは研磨過程の再現ではありません。';
      if(topic==='compare'){
        const ref=exampleSurface('scratch-vertical');text='垂直に偏った傷を基準に、方向の違いを比較します。個々の溝の深さなどは共通でも、交差と測定領域の切り取り方でSq・PVは変わります。同じSqを仮定せず、表示された値とPSDを比較しましょう。';
        surface('① 基準：垂直に偏った傷',ref,statsText(ref),{limit:40});surface('② 選択した傷の面',data,statsText(data),{limit:40});psds('③ X方向のPSDを比較',[psdSeries(examplePSD(ref,'x','hann')),psdSeries(p)],'緑 = 垂直の傷、橙 = 選択例。同じHann窓・測定幅・画素間隔。方向別のPSDなので、X方向だけで等方性を決めません。');
      }else{
        surface('① スクラッチのある表面',data,`${statsText(data)}。4例で高さの色範囲は±40 nm共通。${topic==='profile'?'緑 = X、橙 = Y、紫 = 任意線。':''}`,{limit:40,lines:topic==='profile'});
        if(['surface','profile'].includes(topic))profiles('② 3方向の断面を比較',['x','y','arbitrary'].map((d,i)=>({...profile(data,d),color:colors[i]})),'緑 = X ／ 橙 = Y ／ 紫 = 斜め。横軸は実距離。深さや間隔は傷ごとに異なり、切る場所によって見える谷も変わります。');
        if(['fft','psd','xy','radial','stats','window','band','cumulative'].includes(topic)){
          const s=fftPanel(grid,data,id);
          if(topic==='radial')psdPanel(grid,'③ 方向をまとめた放射平均',[{x:Float64Array.from(s.frequencies,f=>1/f),y:s.radial}],'傷の幅・長さ・間隔に関係する広い波長域を含みます。方向情報は平均で消えるため、2D FFTも確認します。','2D PSD [nm²·µm²]');
          else if(topic==='window')psds('③ 矩形窓とHann窓',[psdSeries(examplePSD(data)),psdSeries(p)],'緑 = 矩形窓、橙 = Hann窓。有限長の傷と測定端の不連続でも漏れが生じます。窓による違いを傷そのものの差と混同しません。');
          else psds('③ X / Yの標準PSD',[psdSeries(p),psdSeries(py)],'緑 = X、橙 = Y。Hann窓・各ライン平均除去。垂直の傷は主にX、水平の傷は主にYで変化。斜めやランダム例は両方向に成分があり、方向の判断には2D FFTも使います。');
        }
        if(topic==='slope')for(const d of ['x','y'])surface(`${d==='x'?'②':'③'} ${d.toUpperCase()}方向微分`,slope(data,SIZE,SIZE,d,DX,false),'谷の底より、傷の両側の斜面で大きな傾きが現れます。傷に直交する微分が強くなります。',{label:'傾き [nm/µm]'});
        if(topic==='distribution'){const dist=heightDistribution(data);text+=' 傷や交差部の深い谷は、高さ分布の低い側の裾に表れます。ただし高さ分布だけでは傷の向きは分かりません。';panel(grid,'② 傷が高さ分布に与える影響',`Ssk ${fmt(dist.ssk)} · Sku ${fmt(dist.sku)}。全点を使用。交差部も含む表面全体の分布で、個々の傷の深さの分布ではありません。`,c=>curve(c,[{x:dist.centers,y:dist.counts}],{xlabel:'高さ [nm]',ylabel:'点の数'}));}
        if(['band','cumulative'].includes(topic))panel(grid,'④ X / Yの累積RMS',`緑 = X、橙 = Y。右から左へ読む。10–30 µm帯 X ${fmt(bandRMS(p,10,30).rms)} / Y ${fmt(bandRMS(py,10,30).rms)} nm。傷の深さそのものではなく、この波長帯の凹凸の寄与です。`,c=>curve(c,[{...cumulative(p),color:colors[0]},{...cumulative(py),color:colors[1]}],{xlabel:'空間波長 [µm] · 右から左へ',ylabel:'累積RMS [nm]',xrange:[0,160]}));
      }
      grid.append(element('p','スクラッチ例のPSD・2D FFTは平均除去＋Hann窓（窓比較の矩形例を除く）。2D FFTの色範囲は4例で共通、DCは非表示。対数描画の下限より小さい値は色だけを下限に揃え、計算値は変更しません。角度集中度は本アプリ独自の指標で、ISOのStrではありません。','example-note example-full'));
    }
    else if(topic==='surface'){note.textContent='説明用の合成データです（実測DATではありません）。64 × 64点、画素間隔2.5 µm。図の数値はアプリと同じ解析処理で計算します。';text=id==='flat'?'平らなら全点が同じ色。周期的な筋は縞、ランダムな凹凸はまだら、局所的な谷は小さな斑点になります。':'色の並びから凹凸の位置と広がりを見て、断面で実際の高さを確かめましょう。';surface();profiles('② X方向で切った断面',[profile(data)],'Y = 80 µmを通る横線。深い谷も、この線が谷を通らなければ見えません。');}
    else if(topic==='profile'){text='切る方向で見える周期が変わります。筋を横切る線では波が現れ、筋に沿う線では高さがほぼ変わりません。';surface('① 切る位置・向き',data,'緑 = X方向、橙 = Y方向、紫 = 斜めの任意線。',{lines:true});profiles('② 3方向の断面を重ねる',['x','y','arbitrary'].map((d,i)=>({...profile(data,d),color:colors[i]})),'緑：X ／ 橙：Y ／ 紫：任意。横軸は各線の始点からの実距離。斜め線は長くなります。');}
    else if(topic==='psd'){text=id==='short'||id==='long'?`筋の間隔が${id==='short'?20:40} µmなら、同じ波長にPSDの山が現れます。20と40 µmの例はSqが同じでもピーク位置が違います。`:'周期が一定でない面は、PSDが広い波長に分布します。局所的な谷も一つの周期だけでは表せません。';surface();profiles('② X方向の断面',[profile(data)],'周期と高さを目で確かめます。');psds('③ X方向の標準PSD',[psdSeries(p)],'矩形窓・各ラインの平均除去。横軸は波長、縦軸は周波数に対する密度。');}
    else if(topic==='fft'||topic==='radial'||topic==='xy'){text='筋の向きと、凹凸が繰り返す向きは90°違います。縦筋の例ではX方向だけに高さが変化します。';surface();const s=fftPanel(grid,data);if(topic==='radial')psdPanel(grid,'③ 方向をまとめた放射平均',[{x:Float64Array.from(s.frequencies,f=>1/f),y:s.radial}],'同じ半径の2D PSDを平均。方向情報が消えるため、2D画像と併せて判断します。','2D PSD [nm²·µm²]');if(topic==='xy')psds('③ X / Yの標準PSD',[psdSeries(p),psdSeries(examplePSD(data,'y'))],'緑 = X、橙 = Y。高さが変化しない方向のPSDは0（表示下限）です。');}
    else if(topic==='stats'){const a=exampleSurface('short');text='Sqは凹凸の大きさを一つの値にまとめます。同じSqでも、筋の間隔や傷の形は違うことがあります。PVは小さな領域の深い傷にも敏感です。';surface('① 比較基準：20 µmの筋',a,statsText(a),{limit:20});surface('② 選択した表面',data,statsText(data),{limit:20});psds('③ 同じSqでもPSDは変わる',[psdSeries(examplePSD(a)),psdSeries(p)],'緑 = 基準、橙 = 選択例。局所的な谷はPVが大きくても、全面のSqは小さくなる場合があります。');}
    else if(topic==='form'){const corrected=exampleCorrection(data,id==='tilt'?'plane':'sphere');text=id==='tilt'?'設置の傾きを差し引くと、小さな筋が読みやすくなります。筋もフィットに少し寄与するため、補正後が元の正弦波と完全一致するとは限りません。':'浅い曲面を2次近似で差し引きます。実際のうねりも差し引かれるため、補正条件を揃えて比較しましょう。';surface('① 補正前',data,statsText(data),{limit:20});surface('② 補正後',corrected,statsText(corrected),{limit:20});profiles('③ 補正前後の断面',[profile(data),profile(corrected)],'緑 = 補正前、橙 = 補正後。同じ位置・同じ高さ軸で比較。');}
    else if(topic==='filter'){const filtered=exampleHighPass(data);text='カットオフ40 µmのHigh Passで、80 µmのうねりが弱くなり、20 µmの筋が残ります。Gaussianなので境界で一気には切れません。';surface('① 元の表面',data,statsText(data),{limit:4.5});surface('② High Pass後',filtered,statsText(filtered),{limit:4.5});psds('③ どの波長が弱くなったか',[psdSeries(p),psdSeries(examplePSD(filtered))],'緑 = 元の面、橙 = フィルター後。周期境界の説明例。アプリで同じ比較をするにはPSD入力を「マップと同じ補正後」にします。');}
    else if(topic==='window'){surface();if(id==='leakage'){text='23 µmの波は160 µmの測定周期に整数回収まらず、端がつながりません。Hann窓は遠い波長への漏れを抑えますが、山の周辺を広げます。';psds('② 矩形窓とHann窓',[psdSeries(p),psdSeries(examplePSD(data,'x','hann'))],'緑 = 矩形窓、橙 = Hann窓。ピーク高さだけを比べず、窓の条件を揃えます。');}else {text='帯状の欠損では全てのXラインに穴があるため、ライン除外では使えるXラインが0本です。補間しても失われた周期を正確には復元できません。';psds('② 欠損なしと線形補間',[psdSeries(examplePSD(exampleSurface('short'))),psdSeries(p)],'緑 = 欠損なし、橙 = 欠損を直線で補間。欠損が人工的な周期成分を作ります。');}}
    else if(topic==='clip'){const clipped=data.map(z=>Math.max(-2,Math.min(2,z)));text='高さを±2 nmに切り詰めると、滑らかな波の山と谷が平らになります。この形の変化が、本来なかった短い波長の成分を作ります。';profiles('① クリップ前後の断面',[profile(data),profile(clipped)],'緑 = 振幅6 nmの元の波、橙 = ±2 nmクリップ。');psds('② 新しい周期成分が出る',[psdSeries(p),psdSeries(examplePSD(clipped))],'20 µmだけだったPSDに、約6.67 µm（3倍の周波数）などの山が加わります。');}
    else if(topic==='intensity'){const intensity=Float64Array.from({length:data.length},(_,i)=>220-180*Math.exp(-(((i%SIZE)*DX-80)**2+(Math.floor(i/SIZE)*DX-80)**2)/(2*15**2)));text='同じ平らな高さでも、反射や測定状態でカメラの明るさは違って見えます。暗い斑点をそのまま「深い穴」と読んではいけません。';surface('① 高さは平坦',data,'全点0 nm。');surface('② 明るさが変わる模式画像',intensity,'説明用の模式図で、装置の光学モデルではありません。高さへの換算はできません。',{gray:true,limit:255,label:'明るさ [相対値]'});}
    else if(topic==='slope'){text='高さが急に変わる場所ほど微分が大きくなります。縦筋ならX微分に縞が現れ、Y微分はほぼ0になります。';surface();for(const direction of ['x','y'])surface(`${direction==='x'?'②':'③'} ${direction.toUpperCase()}方向微分`,slope(data,SIZE,SIZE,direction,DX,false),'筋の山・谷では傾き0、山と谷の間では傾きが大きい。',{label:'傾き [nm/µm]'});}
    else if(topic==='distribution'){const dist=heightDistribution(data);text=id==='random'?'ランダムな凹凸は左右がほぼ対称な高さ分布になります。この有限サンプルではSskは0付近、Skuは3付近です。':id==='valley'?'深い谷が加わると低い高さ側へ裾が伸び、Sskは負に傾きます。極端な点が増えるためSkuも大きくなります。':'高い突起が加わると高い高さ側へ裾が伸び、Sskは正に傾きます。';surface();panel(grid,'② 高さの出現頻度',`Ssk ${fmt(dist.ssk)} · Sku ${fmt(dist.sku)}。全有効点を使用。`,c=>curve(c,[{x:dist.centers,y:dist.counts}],{xlabel:'高さ [nm]',ylabel:'点の数'}));}
    else if(topic==='band'||topic==='cumulative'){text='長い波長から短い波長へ足すと、含まれる凹凸のRMSが増えます。波長表示では右から左へ読みます。';surface();psds('② どの波長が寄与するか',[psdSeries(p)],`10–30 µm帯：${fmt(bandRMS(p,10,30).rms)} nm ／ 40–100 µm帯：${fmt(bandRMS(p,40,100).rms)} nm。矩形窓。`);panel(grid,'③ 累積RMS（右 → 左）','周波数の刻み幅Δfを掛けて積分。波長の刻み幅は使いません。',c=>curve(c,[cumulative(p)],{xlabel:'空間波長 [µm] · 右から左へ',ylabel:'累積RMS [nm]',xrange:[0,160]}));}
    else if(topic==='compare'){const a=exampleSurface('short');text='この2面はどちらもSq ≈ 2.12 nmですが、筋の間隔や周期の揃い方が違います。粗さの数値に加えてPSDやマップを見ると、その違いが分かります。';surface('① 試料A：20 µmの筋',a,statsText(a),{limit:7});surface('② 試料B：選択例',data,statsText(data),{limit:7});psds('③ 試料のPSDを比較',[psdSeries(examplePSD(a)),psdSeries(p)],'緑 = A、橙 = B。同じ測定幅・画素間隔・矩形窓で比較。');}
    takeaway.textContent=text;
    if(!scratch&&['psd','fft','radial','xy','stats','filter','window','clip','band','cumulative','compare'].includes(topic))grid.append(element('p','説明図は、特記した例を除き平均除去＋矩形窓を使用。アプリ初期設定のHann窓ではピークの幅と高さが変わります。対数図の描画下限は最大値の10⁻⁸（計算値は変更しません）。','example-note example-full'));
  }
  select.onchange=draw;draw();
}
