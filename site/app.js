import {hitLine, dragLine, frameQueue} from './interaction.js';
import {datFiles, installFileDrop} from './upload.js';
import {installHelp} from './help.js?v=histogram-1';
import {fftView,parseWavelengths,displayColors,sampleSpectrum,pointerFrequency} from './fft-view.js?v=auto-color-1';
import {MAX_PIXELS} from './analysis.js';
import {extractProfile, bandRMS} from './advanced.js';
import {heatmap, surface3d, profileChart, slopeMap, psdChart, palette, setup, seriesChart, histogramChart, drawProfileLines,fftMap,drawFFTProbe,surfaceColorRange} from './charts.js?v=histogram-1';
import {zip, csv, meanRows, metadata, psdWorkbook, summaryWorkbook, surfaceCSV, safeName, download, pngBytes, profileWorkbook, plotPSDWorkbook, spectrumCSV, researchWorkbook} from './export.js';
const $ = id => document.getElementById(id);
let results = [], failures = [], selected = 0, sources = new Map(), busy = false, exporting = false, worker, pending, nextId = 0, cancelled = false, activeTab = 'surface';
let azimuth = -0.7, elevation = 0.65, profiles = [], profileSerial = 0;
let fftRendered=null,fftSample=null,fftPinned=false;
const canvasIds = ['surface2d', 'surface3d', 'profile', 'intensity', 'slope_x', 'slope_y', 'psdPlot', 'fftPlot', 'radialPlot', 'xyPSD', 'cumulativePlot', 'histogramPlot'];
const active = () => results[selected];
function notify(message, error = false) {$('notification').textContent = message; $('notification').classList.toggle('error', error); $('notification').hidden = !message;}
function getOptions() {
  const limit = Number($('limit').value); if (!Number.isFinite(limit) || limit <= 0 || limit > 1e6) throw new Error('クリップ上限は 0 より大きく、1,000,000 nm 以下で指定してください。');
  const wavelength = $('cutoffUnit').value === 'wavelength', low = Number($('cutoffLow').value), high = Number($('cutoffHigh').value);
  return {form: $('form').value, plane: $('form').value === 'plane', filter: $('filter').value, cutoffLow: wavelength ? 1 / low : low, cutoffHigh: wavelength ? 1 / high : high, cutoffInputUnit: $('cutoffUnit').value, rolloff: $('rolloff').value, edge: $('edge').value, researchWindow: $('researchWindow').value, psdInput: $('psdInput').value, mode: $('mode').value, direction: $('direction').value, clip: $('clip').checked, limit, window: $('window').value, missing: $('missing').value};
}
let appliedDisplayLimit=null;
function displayLimit() {if($('displayLimit').checkValidity())appliedDisplayLimit=$('displayLimit').value===''?null:Number($('displayLimit').value);return appliedDisplayLimit;}
const autoSurfaceRanges=new WeakMap();
function surfaceRange(r){const limit=displayLimit();if(limit!==null)return surfaceColorRange([],limit);if(!autoSurfaceRanges.has(r))autoSurfaceRanges.set(r,surfaceColorRange(r.surface));return autoSurfaceRanges.get(r);}
function paintSurface(r,canvases,lines){const range=surfaceRange(r);heatmap(canvases.surface2d,r.surface,r.cols,r.rows,r.dx,{range,colormap:$('colormap').value,lines});surface3d(canvases.surface3d,r,{azimuth,elevation,range,colormap:$('colormap').value});if(canvases.surface2d===$('surface2d'))$('surfaceColorHint').textContent=`${range.mode==='auto'?'Auto（全域のmin〜max）':'指定範囲'}: ${range.min.toPrecision(5)}〜${range.max.toPrecision(5)} nm · 2D / 3D共通。空欄でAuto。数値入力で±指定値。`;}
function modeUI() {
  $('filterOptions').hidden = $('filter').value === 'off'; $('cutoffLow').disabled = $('filter').value === 'lowpass'; $('cutoffHigh').disabled = $('filter').value === 'highpass';
  $('psdInputHint').textContent=$('psdInput').value==='processed'?'マップと同じ形状補正・FFTフィルター・クリップを適用します。補正でスペクトルも変わります。':$('psdInput').value==='raw'?'未補正の高さ。FFTフィルター・クリップなし。傾きによる長波長成分を含みます。':'平面補正のみ。FFTフィルター・高さクリップは適用しません。';
  const legacy = $('mode').value === 'legacy'; $('standardOptions').hidden = legacy;
  $('modeHint').textContent = legacy ? '元コードと同じ FFT・係数・ゼロ埋め。入力は別設定です。元処理の再現には「マップと同じ補正後」を選びます。' : '各ラインの平均を除去。窓のエネルギーで正規化し、Nyquist 成分も含めた片側 PSD を計算します。';
}
function buttons() {
  $('files').disabled = busy; $('demo').disabled = busy; $('testData').disabled = busy; $('reanalyze').disabled = busy || !results.length; $('downloadAll').disabled = busy || exporting || !results.length;
  for (const id of ['excel', 'meanCSV', 'surfaceCSV', 'parameters', 'singleZip', 'summary', 'remove']) $(id).disabled = busy || exporting;
  document.querySelectorAll('[data-png], #profileExcel, #psdExcel, #compareExcel, #researchExcel, #fftCSV, #addProfile').forEach(b => b.disabled = busy || exporting || !results.length);
}
function startWorker() {
  worker = new Worker(new URL('./worker.js', import.meta.url), {type: 'module'});
  worker.onmessage = ({data}) => {if (pending && pending.id === data.id) {const p = pending; pending = null; data.error ? p.reject(new Error(data.error)) : p.resolve(data.result);}};
  worker.onerror = event => {if (pending) {pending.reject(new Error(event.message || '解析 Worker の起動に失敗しました。')); pending = null;} worker.terminate(); worker = null;};
}
function calculate(source, options) {
  if (!worker) startWorker();
  return new Promise((resolve, reject) => {const id = ++nextId; pending = {id, resolve, reject}; const buffer = source.buffer?.slice(0); worker.postMessage({id, name: source.name, buffer, synthetic: source.synthetic, options}, buffer ? [buffer] : []);});
}
async function processQueue(queue, replace = false) {
  if (busy) {notify('現在の処理が完了してから追加してください。'); return;}
  let options; try {options = getOptions();} catch (e) {notify(e.message, true); return;}
  if (queue.length > 20 || (!replace && results.length + queue.length > 20)) {notify('一度に保持できるデータは 20 件です。結果を保存・削除してから追加してください。', true); return;}
  if (queue.reduce((s, q) => s + (q.file?.size ?? q.buffer?.byteLength ?? 0), 0) > 64 * 1024 * 1024) {notify('一回の選択は合計 64 MB 以下にしてください。', true); return;}
  if (replace) {results = []; failures = []; sources = new Map(); selected = 0;}
  busy = true; cancelled = false; buttons(); notify(''); $('progressArea').hidden = false; $('progress').max = queue.length;
  let totalPixels = results.reduce((s, r) => s + r.surface.length, 0), added = 0;
  try {
    for (let i = 0; i < queue.length && !cancelled; i++) {
      const source = {...queue[i]}; $('progressText').textContent = `${i + 1} / ${queue.length}　${source.name} を解析中…`; $('progress').value = i;
      try {
        if (source.file) {if (source.file.size > 32 * 1024 * 1024) throw new Error('1 ファイルの上限は 32 MB です。'); source.buffer = await source.file.arrayBuffer(); delete source.file;}
        if (cancelled) break;
        const result = await calculate(source, options); if (cancelled) break;
        if (totalPixels + result.surface.length > MAX_PIXELS) throw new Error('保持する全データの合計上限（200 万点）を超えました。結果を保存・削除してから追加してください。');
        totalPixels += result.surface.length; const key = source.key ?? crypto.randomUUID(); source.key = key; result.key = key; sources.set(key, source); results.push(result); selected = results.length - 1; added++;
        renderFiles(); renderActive();
      } catch (e) {if (cancelled) break; failures.push({name: source.name, error: e.message}); renderFiles();}
      $('progress').value = i + 1;
    }
  } finally {if(replace)profiles=profiles.filter(p=>results.some(r=>r.key===p.key)); busy = false; buttons(); $('progressArea').hidden = true; renderFiles(); renderActive(); notify(`${cancelled ? '処理を中止しました。' : '解析完了。'} 成功 ${added} 件 / 失敗 ${failures.length} 件。${failures.length ? '\n失敗の詳細は左のファイル一覧をご確認ください。' : ''}`, failures.length > 0);}
}
function renderFiles() {
  $('fileCount').textContent = `${results.length} FILES`; const list = $('fileList'); list.replaceChildren();
  results.forEach((r, i) => {const b = document.createElement('button'); b.className = 'file-item' + (i === selected ? ' active' : ''); b.type = 'button'; const icon = document.createElement('span'); icon.className = 'file-icon'; icon.textContent = 'DAT'; const label = document.createElement('span'), name = document.createElement('strong'), meta = document.createElement('small'); name.textContent = r.name; meta.textContent = `${r.cols} × ${r.rows} · ${r.dx.toFixed(4)} µm`; label.append(name, meta); b.append(icon, label); b.title = r.name; b.onclick = () => {selected = i; renderFiles(); renderActive();}; list.append(b);});
  for (const f of failures) {const p = document.createElement('p'); p.className = 'failed-item'; p.textContent = `${f.name}: ${f.error}`; list.append(p);}
  if (!results.length && !failures.length) {const p = document.createElement('p'); p.className = 'muted small'; p.textContent = 'ファイルを選ぶと、ここに解析結果が並びます。'; list.append(p);}
  $('compareCount').textContent = results.length;
}
function paint(r, canvases, row = Math.min(r.rows - 1, Math.floor(r.rows / 2) + 2), profileOverride = null) {
  const current=r.key===active()?.key, draft=current?draftLine(r):{x0:0,y0:row*r.dx,x1:(r.cols-1)*r.dx,y1:row*r.dx,name:'Current',draft:true,color:'#263545'};
  const lines=[...profiles.filter(p=>p.key===r.key&&p.visible),draft];
  paintSurface(r,canvases,lines);
  const series=profileOverride??(current?profileSeries():[extractProfile(r,draft)]);
  try {seriesChart(canvases.profile,series.map(p=>({x:p.distance,y:p.height,color:p.color,name:p.name,draft:p.draft})),{limits:current?profileAxes():{}});} catch(e){notify(e.message,true);}
  if(r.iw&&r.ih)heatmap(canvases.intensity,r.intensity,r.iw,r.ih,r.dx,{gray:true,unit:'a.u.'});
  else {const c=setup(canvases.intensity);c.fillStyle='#718093';c.fillText('Intensity data is not included in this DAT.',220,260);}
  slopeMap(canvases.slope_x,r,'x');slopeMap(canvases.slope_y,r,'y');
  psdChart(canvases.psdPlot,[r],{all:$('allLines').checked,wavelength:$('psdAxis').value==='wavelength'});
  paintResearch(r,canvases);
}
function renderActive() {
  const r = active(); $('empty').hidden = Boolean(r); $('results').hidden = !r; if (!r) {buttons(); return;}
  $('activeName').textContent = r.name; $('activeMeta').textContent = `${r.cols} × ${r.rows} pixels　 /　${((r.cols - 1) * r.dx).toFixed(1)} × ${((r.rows - 1) * r.dx).toFixed(1)} µm　 /　d = ${r.dx.toFixed(5)} µm`;
  const forms={none:'なし',piston:'平均高さ',plane:'平面',sphere:'球面（2次近似）','cylinder-x':'X曲率円筒（2次近似）','cylinder-y':'Y曲率円筒（2次近似）',quadratic:'一般2次曲面'},o=r.options; $('correctionDetails').textContent=`適用済み: 形状 ${forms[o.form??(o.plane?'plane':'none')]} / FFT ${o.filter??'off'}${o.filter&&o.filter!=='off'?` · fcLow ${o.cutoffLow.toPrecision(4)} / fcHigh ${o.cutoffHigh.toPrecision(4)} 1/µm · ${o.rolloff} · ${o.edge}`:''}`;
  for (const [id, value] of Object.entries({sq: r.stats.sq, sa: r.stats.sa, pv: r.stats.pv, valid: r.stats.validPercent})) $(id).textContent = value.toFixed(id === 'valid' ? 1 : 3);
  if($('row').dataset.key!==r.key){$('row').dataset.key=r.key;resetDraft(r);}
  configureProfile(r); paint(r,Object.fromEntries(canvasIds.map(id=>[id,$(id)])),Number($('row').value));
  renderProfileList(); renderResearchDetails(r);
  document.querySelectorAll('.slope-note').forEach(el => el.textContent = r.options.mode === 'legacy' ? '元コード互換 · nm/pixel · |微分| > 10 を 0 に置換' : 'サンプリング間隔で換算 · nm/µm · 中央差分');
  const p = r.psd, sc=r.psdConditions;
  $('psdDetails').textContent = `${r.options.mode === 'legacy' ? '元コード互換' : '標準片側 PSD'} / ${p.direction.toUpperCase()} 方向　｜　使用 ${p.used} / ${p.lines} ライン　｜　Δf = ${p.df.toPrecision(5)} 1/µm　｜　Nyquist = ${p.nyquist.toPrecision(5)} 1/µm\n${r.options.mode === 'legacy' ? `ゼロ埋め ${p.zeroFilled} ライン。DC と Nyquist を除外。` : `欠損で除外 ${p.skipped} / 補間 ${p.interpolated} ライン。ライン平均を除去。窓: ${r.options.window}。`}${sc.clip ? ` 高さを ±${r.options.limit} nm にクリップ（${sc.clipped} 点）。` : ' 高さのクリップなし。'}
PSD入力: ${spectralLabel(r)}。 PSD は nm²·µm。${p.used === 0 ? '\n有効な PSD ラインがありません。欠損の補間または方向の変更を検討してください。' : ''}`;
  renderComparison(); buttons();
}
function renderComparison() {
  psdChart($('comparePlot'), results,{wavelength:$('psdAxis').value==='wavelength'}); $('compareLegend').replaceChildren(); $('comparisonTable').replaceChildren();
  results.forEach((r, i) => {const label = document.createElement('span'), swatch = document.createElement('span'); swatch.style.cssText = `width:18px;height:2px;background:${palette[i % palette.length]}`; label.append(swatch, document.createTextNode(r.name)); $('compareLegend').append(label); const tr = document.createElement('tr'); [r.name, r.stats.sq.toFixed(3), r.stats.pv.toFixed(3), r.dx.toFixed(5), `${r.options.mode} / ${r.psd.direction} / ${spectralLabel(r)}`, (()=>{try{const b=bandSummary(r);return `${metric(b.x.rms)} / ${metric(b.y.rms)}`;}catch{return '—';}})(), metric(r.research.spectrum.anisotropy), `${metric(r.research.distribution.ssk)} / ${metric(r.research.distribution.sku)}`].forEach(value => {const td = document.createElement('td'); td.textContent = value; tr.append(td);}); $('comparisonTable').append(tr);});
}
function selectTab(tab) {
  activeTab = tab; document.querySelectorAll('[data-tab]').forEach(b => {const on = b.dataset.tab === tab; b.classList.toggle('active', on); b.setAttribute('aria-selected', on);});
  for (const t of ['surface', 'psd', 'research', 'compare', 'export']) $(t + 'Panel').hidden = t !== tab;
}
async function saveJob(action) {if (exporting || busy) return; exporting = true; buttons(); notify('保存ファイルを生成中…'); try {await action(); notify('保存ファイルを生成しました。');} catch (e) {notify(`保存に失敗しました: ${e.message}`, true);} finally {exporting = false; buttons();}}
async function saveZip(items) {
  for(const r of items)fftExportSettings(r); // Validate display settings before generating any archive.
  const entries = [{name: 'PSD_summary.xlsx', data: summaryWorkbook(items, failures, items.map(r=>bandSummary(r)))}, {name: 'README.txt', data: 'Zygo Surface Lab\nHeight: nm; lateral coordinates: um; PSD: nm^2*um.\nEach dataset includes analysis parameters. Summary statistics use unclipped valid values.\nPNG figures use the selected display range. Surface CSV contains analysis heights.\n'}];
  for (let i = 0; i < items.length; i++) {
    const r = items[i], prefix = `${String(i + 1).padStart(2, '0')}_${safeName(r.name)}`; notify(`${i + 1}/${items.length} 保存ファイルを生成中: ${r.name}`);
    const canvases = Object.fromEntries(canvasIds.map(id => [id, document.createElement('canvas')]));
    const row = r.key === active()?.key ? Number($('row').value) : Math.min(r.rows - 1, Math.floor(r.rows / 2) + 2);
    const saved = profiles.filter(p=>p.key===r.key&&p.visible).map(p=>extractProfile(r,p)); saved.push(extractProfile(r,r.key===active()?.key?draftLine(r):{x0:0,y0:row*r.dx,x1:(r.cols-1)*r.dx,y1:row*r.dx,name:'Current'}));
    paint(r, canvases, row, saved);
    for (const [id, canvas] of Object.entries(canvases)) entries.push({name: `${prefix}/${id}.png`, data: await pngBytes(canvas)});
    const overview = document.createElement('canvas'), c = setup(overview, 1800, 1740); c.fillStyle = '#243346'; c.font = '22px sans-serif'; c.fillText(r.name, 30, 38);
    const labels = ['2D Surface', '3D Surface', 'Line Profiles', 'Intensity', 'X Slope', 'Y Slope'];
    canvasIds.slice(0, 6).forEach((id, k) => {const x = (k % 2) * 900, y = 60 + Math.floor(k / 2) * 560; c.font = '18px sans-serif'; c.fillText(labels[k], x + 30, y + 18); c.drawImage(canvases[id], x, y + 20, 900, 540);});
    entries.push({name:`${prefix}/profiles.xlsx`,data:profileWorkbook(saved,[r],r.key===active()?.key?profileAxes():{})},{name:`${prefix}/research.xlsx`,data:researchWorkbook(r,bandSummary(r),{wavelength:$('psdAxis').value==='wavelength'})},{name:`${prefix}/2d_psd.csv`,data:spectrumCSV(r,'power')},{name:`${prefix}/2d_amplitude.csv`,data:spectrumCSV(r,'amplitude')});
    entries.push({name: `${prefix}/allfigs.png`, data: await pngBytes(overview)}, {name: `${prefix}/psd.xlsx`, data: psdWorkbook(r,{wavelength:$('psdAxis').value==='wavelength'})}, {name: `${prefix}/mean_psd.csv`, data: csv(meanRows(r))}, {name: `${prefix}/surface_height_nm.csv`, data: surfaceCSV(r)}, {name: `${prefix}/parameters.json`, data: JSON.stringify({...metadata(r), export_psd_axis:$('psdAxis').value, export_display_limit_nm: displayLimit(),export_surface_color_range:surfaceRange(r), export_profiles:saved.map(p=>({name:p.name,x0:p.x0,y0:p.y0,x1:p.x1,y1:p.y1})),export_colormap:$('colormap').value,export_profile_axes:r.key===active()?.key?profileAxes():{},export_fft_kind:$('fftKind').value,export_fft_log:$('fftLog').checked,export_fft_dc:$('fftDC').checked,export_fft_view:fftExportSettings(r)}, null, 2)});
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  download(items.length === 1 ? `${safeName(items[0].name)}_results.zip` : 'zygo_batch_results.zip', zip(entries), 'application/zip');
}

function profileAxes(){const out={};for(const [id,k] of [['profileXmin','xmin'],['profileXmax','xmax'],['profileYmin','ymin'],['profileYmax','ymax']]){if($(id).value!==''){const v=Number($(id).value);if(!Number.isFinite(v))throw new Error('軸範囲には数値を指定してください。');out[k]=v;}}return out;}
function setCoordinates(p){for(const k of ['x0','y0','x1','y1'])$(k).value=p[k];}
function resetDraft(r){const d=$('profileDirection').value;setCoordinates(d==='y'?{x0:Math.floor(r.cols/2)*r.dx,y0:0,x1:Math.floor(r.cols/2)*r.dx,y1:(r.rows-1)*r.dx}:d==='arbitrary'?{x0:0,y0:0,x1:(r.cols-1)*r.dx,y1:(r.rows-1)*r.dx}:{x0:0,y0:Math.floor(r.rows/2)*r.dx,x1:(r.cols-1)*r.dx,y1:Math.floor(r.rows/2)*r.dx});}
function configureProfile(r){const d=$('profileDirection').value;for(const k of ['x0','x1']){$(k).max=(r.cols-1)*r.dx;$(k).disabled=d==='x';}for(const k of ['y0','y1']){$(k).max=(r.rows-1)*r.dx;$(k).disabled=d==='y';}$('row').disabled=d==='arbitrary';$('row').max=(d==='y'?r.cols:r.rows)-1;$('row').value=Math.round(Number($(d==='y'?'x0':'y0').value)/r.dx);$('rowLabel').textContent=d==='arbitrary'?'任意':`${Number($('row').value)+1}/${d==='y'?r.cols:r.rows}`;$('profileHint').textContent=d==='arbitrary'?'空いた場所で始点から終点へドラッグ。線で移動、端点で向き変更。双線形補間で抽出します。':'マップ上でクリック／ドラッグして位置を指定。横軸は始点からの距離です。';}
function draftLine(r=active()){return {...Object.fromEntries(['x0','y0','x1','y1'].map(k=>[k,Number($(k).value)])),name:'現在の断面',color:'#263545',draft:true,key:r.key,direction:$('profileDirection').value};}
function profileSeries(){const r=active();if(!r)return [];const out=[];for(const p of profiles.filter(p=>p.visible)){const source=results.find(q=>q.key===p.key);if(source)out.push(extractProfile(source,p));}out.push(extractProfile(r,draftLine(r)));return out;}
function renderProfileList(){$('profileList').replaceChildren();for(const p of profiles){const row=document.createElement('div'),label=document.createElement('label'),check=document.createElement('input'),remove=document.createElement('button');check.type='checkbox';check.checked=p.visible;check.onchange=()=>{p.visible=check.checked;renderActive();};label.style.color=p.color;label.title=`(${p.x0.toFixed(2)}, ${p.y0.toFixed(2)}) → (${p.x1.toFixed(2)}, ${p.y1.toFixed(2)}) µm`;label.append(check,document.createTextNode(`${p.name} · ${results.find(r=>r.key===p.key)?.name??'再解析中'}`));remove.className='button subtle';remove.textContent='×';remove.title='断面を削除';remove.onclick=()=>{profiles=profiles.filter(q=>q.id!==p.id);renderActive();};row.append(label,remove);$('profileList').append(row);}}
function spectralLabel(r){const c=r.psdConditions;return `${c.input==='plane'?'平面補正のみ':c.input==='raw'?'未補正':`マップ補正後 (${c.form})`} / FFT ${c.filter} / ${c.clip?`±${r.options.limit} nm`:'クリップなし'}`;}
function fftConfig(r){
  const s=r.research.spectrum,mode=$('fftZoom').value;
  for(const id of ['fftColorMin','fftColorMax'])if(!$(id).checkValidity())throw Error('色のmin/maxには数値か、空欄のAutoを指定してください。');
  return {view:fftView(s,mode,$('fftRange').value),kind:$('fftKind').value,log:$('fftLog').checked,dc:$('fftDC').checked,min:$('fftColorMin').value===''?null:Number($('fftColorMin').value),max:$('fftColorMax').value===''?null:Number($('fftColorMax').value),wavelengths:$('fftRings').checked?parseWavelengths($('fftWavelengths').value):[],colormap:$('colormap').value};
}
function fftExportSettings(r){const q=fftConfig(r),d=displayColors(r.research.spectrum,q);return {frequency_bounds_cycles_per_um:q.view,color_min:d.min,color_max:d.max,color_scale:d.manual?'manual':'full-spectrum',color_min_auto:d.minAuto,color_max_auto:d.maxAuto,kind:q.kind,log10:q.log,dc_visible:q.dc,wavelength_rings_um:q.wavelengths,frequency_pixel_rendering:'nearest neighbour, original FFT bins',csv_scope:'full spectrum; untransformed',frequency_resolution_cycles_per_um:{x:r.research.spectrum.dfX,y:r.research.spectrum.dfY}};}
function renderFFT(r,canvas=$('fftPlot'),probe=true){
  const s=r.research.spectrum,q=fftConfig(r),d=displayColors(s,q),unit=q.log?(q.kind==='power'?'log10(nm²·µm²)':'log10(nm)'):(q.kind==='power'?'nm²·µm²':'nm');
  fftMap(canvas,s,d,{view:q.view,wavelengths:q.wavelengths,colormap:q.colormap,unit,label:q.kind==='power'?'2D PSD':'FFT amplitude'});
  if(canvas===$('fftPlot')){
    $('fftRange').disabled=q.view.mode!=='custom';$('fftRange').max=q.view.nyquist;$('fftRange').min=Math.max(s.dfX,s.dfY);
    if(q.view.mode!=='custom')$('fftRange').value=q.view.mode==='full'?q.view.nyquist:q.view.nyquist/Number(q.view.mode);
    fftProbeFrame.cancel();if(fftRendered?.key!==r.key){fftPinned=false;fftSample=null;}
    fftRendered={key:r.key,s,q,d};if(fftSample)fftSample=sampleSpectrum(s,fftSample.fx,fftSample.fy,q.kind);
    if(probe)drawFFTProbe(canvas,fftSample);updateFFTReadout();
    const v=q.view,half=Math.min(v.xmax-v.xmin,v.ymax-v.ymin)/2;
    $('fftViewNote').textContent=`表示: fx ${v.xmin.toPrecision(4)}〜${v.xmax.toPrecision(4)} / fy ${v.ymin.toPrecision(4)}〜${v.ymax.toPrecision(4)} 1/µm。${v.mode==='full'?'全域。':`軸端付近の波長 ≈ ${(1/half).toPrecision(4)} µm（斜めは異なります）。`} Δfx ${s.dfX.toPrecision(4)} / Δfy ${s.dfY.toPrecision(4)} 1/µm。表示の拡大だけで分解能は増えません。色 min ${d.minAuto?'Auto':'指定値'} ${d.min.toPrecision(5)} / max ${d.maxAuto?'Auto':'指定値'} ${d.max.toPrecision(5)} ${unit}。Autoは全域から算出し、拡大時も共通。円は等波長の目安で、フィルターではありません。CSVは全域の元の数値です。`;
  }
}
function updateFFTReadout(){
  if(!fftSample){$('fftCursor').textContent='画像上で波長・方向を読む。クリック／タップで固定。数値座標でも指定できます。';return;}
  const p=fftSample,q=fftRendered.q,unit=q.kind==='power'?'nm²·µm²':'nm',number=v=>Number.isFinite(v)?v.toPrecision(5):'—';
  $('fftCursor').textContent=`${fftPinned?'固定':'カーソル'} · 最寄りのFFTビン: fx ${number(p.fx)} / fy ${number(p.fy)} 1/µm\n${p.dc?'DC（0周波数） · 波長 ∞ · 方向は定義しません':`波長 ${number(p.wavelength)} µm · 繰り返す方向 ${p.angle.toFixed(2)}° · 筋の向き ${p.stripeAngle.toFixed(2)}°`}\n${q.kind==='power'?'2D PSD':'FFT振幅'} ${number(p.value)} ${unit}（対数変換前）${p.dc&&!q.dc?' · DCは画像では非表示':''}`;
}
function paintResearch(r,canvases){
  const a=r.research,s=a.spectrum,kind=$('fftKind').value,log=$('fftLog').checked,wave=$('psdAxis').value==='wavelength',axis=f=>wave?Float64Array.from(f,v=>1/v):f,xlabel=wave?'Spatial wavelength [µm]':'Spatial frequency [1/µm]';
  try{renderFFT(r,canvases.fftPlot);}catch(e){if(canvases.fftPlot===$('fftPlot')){const c=setup(canvases.fftPlot);c.fillStyle='#a65233';c.fillText('表示範囲または色範囲を修正してください。',180,250);fftRendered=null;fftSample=null;fftPinned=false;updateFFTReadout();notify(e.message,true);}else throw e;}
  seriesChart(canvases.radialPlot,[{x:axis(s.frequencies),y:s.radial}],{log:true,xlabel,ylabel:'2D PSD [nm²·µm²]'});
  seriesChart(canvases.xyPSD,[{x:axis(a.x.frequencies),y:a.x.mean},{x:axis(a.y.frequencies),y:a.y.mean}],{log:true,xlabel,ylabel:'PSD [nm²·µm]'});
  const cumulative=p=>{let v=0;return Float64Array.from(p.mean,q=>{v+=Number.isFinite(q)?q*p.df:0;return Math.sqrt(v);});};
  seriesChart(canvases.cumulativePlot,[{x:axis(a.x.frequencies),y:cumulative(a.x)},{x:axis(a.y.frequencies),y:cumulative(a.y)}],{xlabel,ylabel:'Cumulative RMS [nm]'});histogramChart(canvases.histogramPlot,a.distribution);
}
function bandSummary(r){const min=Number($('bandMin').value),max=Number($('bandMax').value);return {minWavelength:min,maxWavelength:max,x:bandRMS(r.research.x,min,max),y:bandRMS(r.research.y,min,max)};}
const metric=n=>Number.isFinite(n)?n.toFixed(3):'—';
function renderResearchDetails(r){const a=r.research,s=a.spectrum;try{const b=bandSummary(r);$('bandDetails').textContent=`波長 ${b.minWavelength}〜${b.maxWavelength} µm\nX: ${metric(b.x.rms)} nm (${b.x.bins} bins) / Y: ${metric(b.y.rms)} nm (${b.y.bins} bins)\n離散PSDビンを積分。窓: ${a.window}。範囲外の波長は寄与しません。`;}catch(e){$('bandDetails').textContent=e.message;}$('heightDetails').textContent=`Ssk: ${metric(a.distribution.ssk)} / Sku: ${metric(a.distribution.sku)} · クリップ前。極端な点の影響を含みます。`;$('fftDetails').textContent=`入力: ${spectralLabel(r)}\n最大ピークの波長: ${metric(s.peakWavelength)} µm\n周波数ベクトル角: ${metric(s.wavevectorAngle)}° / 筋に相当する向き: ${metric((s.wavevectorAngle+90)%180)}°\n角度集中度: ${metric(s.anisotropy)}（0〜1） / 主軸: ${metric(s.principalAngle)}°\nΔfx ${s.dfX.toPrecision(3)} / Δfy ${s.dfY.toPrecision(3)} 1/µm · ${s.window}窓\n${s.missing?'欠損マスクによるスペクトルの歪みを含みます。':'欠損なし。'}${s.windowFallback?' Hannの窓エネルギーが0のため、2D FFTのみ矩形窓へ切り替えました。':''} 平面除去・窓でピークの高さは変わります。`;}

function receiveFiles(files){
  if(busy){notify('現在の処理が完了してから追加してください。');return;}
  const {accepted,rejected}=datFiles(files);
  if(!accepted.length){notify('.dat ファイルをドロップ／選択してください。',true);return;}
  processQueue(accepted.map(file=>({file,name:file.name}))).then(()=>{if(rejected.length)notify(`${rejected.length} 件は .dat 以外のため追加しませんでした。${failures.length?' DAT の失敗詳細は左側に表示しています。':''}`,true);});
}
$('files').onchange = () => {const list=Array.from($('files').files);$('files').value='';if(list.length)receiveFiles(list);};
$('emptyOpen').onclick = () => $('files').click();
$('dropzone').onkeydown = e => {if(e.key==='Enter'||e.key===' '){e.preventDefault();if(!busy)$('files').click();}};
const resetDrop=installFileDrop(document,{show:()=>{$('dropOverlay').hidden=false;$('dropzone').classList.add('dragging');},hide:()=>{$('dropOverlay').hidden=true;$('dropzone').classList.remove('dragging');},receive:receiveFiles,blocked:()=>busy});
window.addEventListener('blur',resetDrop);
$('demo').onclick = () => processQueue([{name: 'DEMO · 合成表面', synthetic: true}]);
$('testData').onclick = async () => {try {const response = await fetch('/__test-data'); if (!response.ok) throw new Error('ローカルのテスト DAT を取得できません。'); await processQueue([{name: 'E17-C1-1-1.dat', buffer: await response.arrayBuffer()}]);} catch (e) {notify(e.message, true);}};
if (['localhost', '127.0.0.1'].includes(location.hostname)) fetch('/__test-data', {method: 'HEAD'}).then(r => {if (r.ok) $('testData').hidden = false;}).catch(() => {});
$('settings').onsubmit = e => {e.preventDefault(); const queue = results.map(r => sources.get(r.key)); processQueue(queue, true);};
$('settings').onchange = () => {modeUI(); if (results.length && !busy) notify('解析設定が変更されています。「設定を適用して再解析」で結果に反映してください。');};
$('mode').addEventListener('change', () => {$('clip').checked = $('mode').value === 'legacy';});
$('cancel').onclick = () => {cancelled = true; worker?.terminate(); worker = null; pending?.reject(new Error('中止')); pending = null;};
$('remove').onclick = () => {const r = active(); sources.delete(r.key); profiles=profiles.filter(p=>p.key!==r.key); results.splice(selected, 1); selected = Math.min(selected, Math.max(0, results.length - 1)); renderFiles(); renderActive();};
document.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => selectTab(b.dataset.tab));
const surfaceColorFrame=frameQueue(()=>{if(active())try{paintSurface(active(),{surface2d:$('surface2d'),surface3d:$('surface3d')},profileLines());notify('');}catch(e){notify(e.message,true);}});
$('displayLimit').oninput=()=>{if($('displayLimit').checkValidity())surfaceColorFrame.push(true);};
$('displayLimit').onchange=()=>{if(!$('displayLimit').checkValidity()){notify('カラーバー範囲には正の数値か、空欄のAutoを指定してください。',true);return;}surfaceColorFrame.push(true);};
$('surfaceColorAuto').onclick=()=>{$('displayLimit').value='';surfaceColorFrame.push(true);};
function profileLines(){const r=active();return r?[...profiles.filter(p=>p.key===r.key&&p.visible),draftLine(r)]:[];}
function paintProfiles(){
  const r=active();if(!r)return;drawProfileLines($('surface2d'),profileLines());configureProfile(r);
  if(Math.hypot(Number($('x1').value)-Number($('x0').value),Number($('y1').value)-Number($('y0').value))<1e-8)return;
  try{seriesChart($('profile'),profileSeries().map(p=>({x:p.distance,y:p.height,color:p.color,name:p.name})),{limits:profileAxes()});}catch(e){notify(e.message,true);}
}
const profileFrame=frameQueue(()=>paintProfiles());
$('row').oninput=()=>{const r=active();if(!r)return;const d=$('profileDirection').value,n=Number($('row').value);setCoordinates(d==='y'?{x0:n*r.dx,y0:0,x1:n*r.dx,y1:(r.rows-1)*r.dx}:{x0:0,y0:n*r.dx,x1:(r.cols-1)*r.dx,y1:n*r.dx});profileFrame.push(true);};
function mapPoint(e,clamped=false){const c=$('surface2d'),box=c.getBoundingClientRect(),p=c._plotArea;if(!p)return;const x=(e.clientX-box.left)*c.width/box.width,y=(e.clientY-box.top)*c.height/box.height;if(!clamped&&(x<p.left||x>p.left+p.w||y<p.top||y>p.top+p.h))return;return {x:Math.max(0,Math.min((p.cols-1)*p.dx,(x-p.left)/p.w*(p.cols-1)*p.dx)),y:Math.max(0,Math.min((p.rows-1)*p.dx,(1-(y-p.top)/p.h)*(p.rows-1)*p.dx))};}
let gesture;
function updateGesture(point){
  const r=active();if(!gesture||r?.key!==gesture.key)return;
  const g=gesture,width=(r.cols-1)*r.dx,height=(r.rows-1)*r.dx;
  const next=g.part==='new'?{...g.original,x0:g.start.x,y0:g.start.y,x1:point.x,y1:point.y}:dragLine(g.original,g.start,point,g.part,width,height);
  // A zero-length endpoint is not a valid stored cross-section.
  if(g.target&&Math.hypot(next.x1-next.x0,next.y1-next.y0)<1e-8)return;
  if(g.target)Object.assign(g.target,next);else setCoordinates(next);
  paintProfiles();
}
const gestureFrame=frameQueue(updateGesture);
$('surface2d').onpointerdown=e=>{
  const point=mapPoint(e),r=active();if(!point||!r||busy||e.button!==0||gesture)return;
  profileFrame.flush();const c=$('surface2d'),area=c._plotArea,box=c.getBoundingClientRect();
  const hit=hitLine(point,profileLines(),area.w*box.width/c.width/((r.cols-1)*r.dx),area.h*box.height/c.height/((r.rows-1)*r.dx));
  const target=hit?.line.id?profiles.find(p=>p.id===hit.line.id):null,original={...(target??draftLine(r))};
  gesture={key:r.key,target,original,start:point,part:hit?.part??($('profileDirection').value==='arbitrary'?'new':'move'),pointerId:e.pointerId};
  if(!hit&&$('profileDirection').value!=='arbitrary'){
    gesture.start={x:original.x0,y:original.y0};
  }
  c.setPointerCapture(e.pointerId);c.classList.add('profile-dragging');e.preventDefault();
  if(!hit&&gesture.part!=='new')gestureFrame.push(point);
};
$('surface2d').onpointermove=e=>{
  const point=mapPoint(e,Boolean(gesture)),r=active();if(!point||!r)return;
  const z=r.surface[Math.round(point.y/r.dx)*r.cols+Math.round(point.x/r.dx)];$('hoverValue').textContent=`x ${point.x.toFixed(2)} µm / y ${point.y.toFixed(2)} µm / z ${Number.isFinite(z)?z.toFixed(3)+' nm':'欠損'}`;
  if(gesture&&gesture.pointerId===e.pointerId)gestureFrame.push(point);
};
function endGesture(e,cancel=false){
  if(!gesture||gesture.pointerId!==e.pointerId)return;
  const g=gesture;if(cancel){gestureFrame.cancel();if(g.target)Object.assign(g.target,g.original);else setCoordinates(g.original);}else{
    const point=mapPoint(e,true);if(point)gestureFrame.push(point);gestureFrame.flush();
    const p=g.target??draftLine();if(Math.hypot(p.x1-p.x0,p.y1-p.y0)<1e-8)setCoordinates(g.original);
  }
  gesture=null;$('surface2d').classList.remove('profile-dragging');if($('surface2d').hasPointerCapture(e.pointerId))$('surface2d').releasePointerCapture(e.pointerId);paintProfiles();renderProfileList();
}
$('surface2d').onpointerup=e=>endGesture(e);
$('surface2d').onpointercancel=e=>endGesture(e,true);
$('surface2d').onlostpointercapture=e=>{if(gesture)endGesture(e,true);};
let dragging;
$('surface3d').onpointerdown = e => {dragging = {x: e.clientX, y: e.clientY}; $('surface3d').setPointerCapture(e.pointerId);};
$('surface3d').onpointermove = e => {if (!dragging || !active()) return; azimuth += (e.clientX - dragging.x) * 0.008; elevation = Math.max(0.15, Math.min(1.4, elevation + (e.clientY - dragging.y) * 0.008)); dragging = {x: e.clientX, y: e.clientY}; surface3d($('surface3d'), active(), {azimuth, elevation, range: surfaceRange(active()), colormap: $('colormap').value});};
$('surface3d').onpointerup = $('surface3d').onpointercancel = () => {dragging = null;};
for (const id of ['allLines', 'psdAxis']) $(id).onchange = () => {if(active()){psdChart($('psdPlot'),[active()],{all:$('allLines').checked,wavelength:$('psdAxis').value==='wavelength'});if(id==='psdAxis'){paintResearch(active(),Object.fromEntries(canvasIds.map(k=>[k,$(k)])));renderComparison();}}};
document.querySelectorAll('[data-png]').forEach(b => b.onclick = () => saveJob(async () => {if(['surface2d','surface3d'].includes(b.dataset.png))surfaceColorFrame.flush();if(b.dataset.png==='profile')seriesChart($('profile'),profileSeries().map(p=>({x:p.distance,y:p.height,color:p.color,name:p.name,draft:p.draft})),{limits:profileAxes()});if(b.dataset.png==='fftPlot')renderFFT(active(),$('fftPlot'),false);download(`${safeName(active().name)}_${b.dataset.png}.png`, await pngBytes($(b.dataset.png)), 'image/png');if(b.dataset.png==='fftPlot')drawFFTProbe($('fftPlot'),fftSample);}));
$('excel').onclick = () => saveJob(() => download(`${safeName(active().name)}_psd.xlsx`, psdWorkbook(active(),{wavelength:$('psdAxis').value==='wavelength'}), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'));
$('meanCSV').onclick = () => saveJob(() => download(`${safeName(active().name)}_mean_psd.csv`, csv(meanRows(active())), 'text/csv;charset=utf-8'));
$('surfaceCSV').onclick = () => saveJob(() => download(`${safeName(active().name)}_surface.csv`, surfaceCSV(active()), 'text/csv;charset=utf-8'));
$('parameters').onclick = () => saveJob(() => download(`${safeName(active().name)}_parameters.json`, JSON.stringify({...metadata(active()),export_surface_color_range:surfaceRange(active()),export_fft_view:fftExportSettings(active())}, null, 2), 'application/json'));
$('summary').onclick = () => saveJob(() => download('PSD_summary.xlsx', summaryWorkbook(results, failures, results.map(r=>bandSummary(r))), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'));
$('singleZip').onclick = () => saveJob(() => saveZip([active()])); $('downloadAll').onclick = () => saveJob(() => saveZip([...results]));
$('helpButton').onclick = () => $('help').showModal(); $('closeHelp').onclick = () => $('help').close();
window.addEventListener('beforeunload', () => worker?.terminate());
$('profileDirection').onchange=()=>{if(active()){resetDraft(active());renderActive();}};
for(const k of ['x0','y0','x1','y1'])$(k).onchange=()=>{if(!active())return;const d=$('profileDirection').value;if(d==='x'){$('x0').value=0;$('x1').value=(active().cols-1)*active().dx;$(k==='y0'?'y1':'y0').value=$(k).value;}if(d==='y'){$('y0').value=0;$('y1').value=(active().rows-1)*active().dx;$(k==='x0'?'x1':'x0').value=$(k).value;}try{extractProfile(active(),draftLine());renderActive();}catch(e){resetDraft(active());renderActive();notify(e.message,true);}};
for(const k of ['profileXmin','profileXmax','profileYmin','profileYmax'])$(k).onchange=()=>{if(active())renderActive();};
$('resetProfileAxes').onclick=()=>{for(const k of ['profileXmin','profileXmax','profileYmin','profileYmax'])$(k).value='';renderActive();};
$('addProfile').onclick=()=>{try{if(profiles.length>=31)throw new Error('比較する断面は現在の断面を含め32本までです。');const p=draftLine();extractProfile(active(),p);profiles.push({...p,id:++profileSerial,name:$('profileName').value.trim()||`断面 ${profileSerial}`,color:palette[(profileSerial-1)%palette.length],draft:false,visible:true});$('profileName').value='';renderActive();}catch(e){notify(e.message,true);}};
for(const k of ['colormap','fftKind','fftLog','fftDC'])$(k).onchange=()=>{if(k==='fftKind'||k==='fftLog'){$('fftColorMin').value='';$('fftColorMax').value='';}if(active())renderActive();};
for(const k of ['bandMin','bandMax'])$(k).onchange=()=>{if(active()){renderResearchDetails(active());renderComparison();}};
$('researchWindow').onchange=()=>notify('特徴解析の窓を変更しました。「設定を適用して再解析」で反映してください。');
$('cutoffUnit').onchange=()=>{for(const k of ['cutoffLow','cutoffHigh']){const n=Number($(k).value);if(n>0)$(k).value=1/n;}};
const excelType='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
$('profileExcel').onclick=()=>saveJob(()=>download(`${safeName(active().name)}_profiles.xlsx`,profileWorkbook(profileSeries(),results,profileAxes()),excelType));
$('psdExcel').onclick=()=>saveJob(()=>download(`${safeName(active().name)}_psd_plot.xlsx`,psdWorkbook(active(),{wavelength:$('psdAxis').value==='wavelength'}),excelType));
$('compareExcel').onclick=()=>saveJob(()=>download('PSD_comparison_plot.xlsx',plotPSDWorkbook(results,$('psdAxis').value==='wavelength'),excelType));
$('researchExcel').onclick=()=>saveJob(()=>download(`${safeName(active().name)}_research.xlsx`,researchWorkbook(active(),bandSummary(active()),{wavelength:$('psdAxis').value==='wavelength'}),excelType));
$('fftCSV').onclick=()=>saveJob(()=>download(`${safeName(active().name)}_2d_${$('fftKind').value}.csv`,spectrumCSV(active(),$('fftKind').value), 'text/csv;charset=utf-8'));
for(const id of ['fftZoom','fftRange','fftRings','fftWavelengths','fftColorMin','fftColorMax'])$(id).onchange=()=>{if(!active())return;try{renderFFT(active());notify('');}catch(e){notify(e.message,true);}};
const fftColorFrame=frameQueue(()=>{if(active())try{renderFFT(active());notify('');}catch(e){notify(e.message,true);}});
for(const id of ['fftColorMin','fftColorMax'])$(id).oninput=()=>{if($(id).checkValidity())fftColorFrame.push(true);};
$('fftApplyView').onclick=()=>{if(!active())return;try{renderFFT(active());notify('');}catch(e){notify(e.message,true);}};
$('fftResetView').onclick=()=>{$('fftZoom').value='full';$('fftColorMin').value='';$('fftColorMax').value='';if(active())try{renderFFT(active());notify('');}catch(e){notify(e.message,true);}};
function showFFTProbe(point,pin=false){if(!fftRendered||fftRendered.key!==active()?.key)return;fftSample=sampleSpectrum(fftRendered.s,point.fx,point.fy,fftRendered.q.kind);if(pin)fftPinned=true;drawFFTProbe($('fftPlot'),fftSample);updateFFTReadout();}
const fftProbeFrame=frameQueue(point=>showFFTProbe(point));
function fftPoint(e){const c=$('fftPlot'),b=c.getBoundingClientRect();return c._fftArea?pointerFrequency(c._fftArea,{x:(e.clientX-b.left)*c.width/b.width,y:(e.clientY-b.top)*c.height/b.height}):null;}
$('fftPlot').onpointermove=e=>{const point=fftPoint(e);if(point&&!fftPinned)fftProbeFrame.push(point);};
$('fftPlot').onpointerleave=()=>{if(!fftPinned){fftProbeFrame.cancel();fftSample=null;drawFFTProbe($('fftPlot'));updateFFTReadout();}};
$('fftPlot').onpointerdown=e=>{const point=fftPoint(e);if(point){fftProbeFrame.cancel();showFFTProbe(point,true);}};
$('fftProbe').onclick=()=>{try{if(!active())return;const fx=Number($('fftProbeX').value),fy=Number($('fftProbeY').value),s=active().research.spectrum;if($('fftProbeX').value===''||$('fftProbeY').value===''||!Number.isFinite(fx)||!Number.isFinite(fy)||fx<s.fx[0]||fx>s.fx.at(-1)||fy<s.fy[0]||fy>s.fy.at(-1))throw Error('調べる座標はFFTの周波数ビン範囲内で指定してください。');fftProbeFrame.cancel();showFFTProbe({fx,fy},true);}catch(e){notify(e.message,true);}};
$('fftUnpin').onclick=()=>{fftProbeFrame.cancel();fftPinned=false;fftSample=null;drawFFTProbe($('fftPlot'));updateFFTReadout();};
installHelp(); modeUI(); selectTab(activeTab); buttons();
