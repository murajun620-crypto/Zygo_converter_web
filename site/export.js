const encoder = new TextEncoder();
const crcTable = Uint32Array.from({length: 256}, (_, n) => {let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0;});
function crc32(bytes) {let c = 0xffffffff; for (const b of bytes) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0;}
function concat(arrays) {const out = new Uint8Array(arrays.reduce((s, a) => s + a.length, 0)); let i = 0; for (const a of arrays) {out.set(a, i); i += a.length;} return out;}
export function zip(entries) {
  const local = [], central = []; let offset = 0;
  for (const {name, data} of entries) {
    const filename = encoder.encode(name), bytes = typeof data === 'string' ? encoder.encode(data) : new Uint8Array(data), crc = crc32(bytes);
    const header = new Uint8Array(30), h = new DataView(header.buffer); h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(12, 0x21, true); h.setUint32(14, crc, true); h.setUint32(18, bytes.length, true); h.setUint32(22, bytes.length, true); h.setUint16(26, filename.length, true);
    local.push(header, filename, bytes);
    const record = new Uint8Array(46), v = new DataView(record.buffer); v.setUint32(0, 0x02014b50, true); v.setUint16(4, 20, true); v.setUint16(6, 20, true); v.setUint16(8, 0x0800, true); v.setUint16(14, 0x21, true); v.setUint32(16, crc, true); v.setUint32(20, bytes.length, true); v.setUint32(24, bytes.length, true); v.setUint16(28, filename.length, true); v.setUint32(42, offset, true); central.push(record, filename); offset += header.length + filename.length + bytes.length;
  }
  const directory = concat(central), end = new Uint8Array(22), e = new DataView(end.buffer); e.setUint32(0, 0x06054b50, true); e.setUint16(8, entries.length, true); e.setUint16(10, entries.length, true); e.setUint32(12, directory.length, true); e.setUint32(16, offset, true); return concat([...local, directory, end]);
}
const xml = s => String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'}[c]));
function colName(i) {let name = ''; for (i++; i; i = Math.floor((i - 1) / 26)) name = String.fromCharCode(65 + (i - 1) % 26) + name; return name;}
export function xlsx(sheets) {
  const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const entries = [{name: '[Content_Types].xml', data: `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`}, {name: '_rels/.rels', data: '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'}, {name: 'xl/workbook.xml', data: `<workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${xml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`}, {name: 'xl/_rels/workbook.xml.rels', data: `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`}];
  sheets.forEach((s, i) => {if (s.rows.length > 1048576 || s.rows.some(r => r.length > 16384)) throw new Error('Excel のシート上限を超えています。'); const rows = s.rows.map((r, j) => `<row r="${j + 1}">${r.map((v, k) => {const ref = `${colName(k)}${j + 1}`; return typeof v === 'number' ? (Number.isFinite(v) ? `<c r="${ref}"><v>${v}</v></c>` : `<c r="${ref}"/>`) : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(v ?? '')}</t></is></c>`;}).join('')}</row>`).join(''); entries.push({name: `xl/worksheets/sheet${i + 1}.xml`, data: `<worksheet xmlns="${ns}"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" state="frozen"/></sheetView></sheetViews><sheetData>${rows}</sheetData></worksheet>`});});
  return zip(entries);
}
function safeCell(v) {if (typeof v === 'number') return Number.isFinite(v) ? String(v) : ''; const s = String(v ?? ''); return '"' + (/^[=+@\-\t\r]/.test(s) ? "'" : '') + s.replace(/"/g, '""') + '"';}
export function csv(rows) {return '\ufeff' + rows.map(r => r.map(safeCell).join(',')).join('\r\n');}
export const meanRows = r => [['Spatial frequency [1/um]', 'Spatial wavelength [um]', 'Mean PSD [nm^2*um]'], ...Array.from(r.psd.frequencies, (f, i) => [f, 1 / f, r.psd.mean[i]])];
export function metadata(r) {return {file: r.name, rows: r.rows, cols: r.cols, lateral_resolution_um: r.dx, height_unit: 'nm', psd_unit: r.psd.unit, options: r.options, spectral_input_conditions: r.psdConditions, stats_unclipped: r.stats, clipped_points: r.clipped, psd_used: r.psd.used, psd_skipped: r.psd.skipped, psd_interpolated: r.psd.interpolated, psd_zero_filled: r.psd.zeroFilled, frequency_spacing: r.psd.df, plane_coefficients_normalized_coordinates: (r.options.form??(r.options.plane?'plane':'none'))==='plane'?r.coefficients:null, form_coefficients: r.coefficients, surface_orientation: 'row 0 at y=0, raw DAT rows reversed', metadata: r.meta};}
function parameterRows(r) {return [['Parameter', 'Value'], ...Object.entries(metadata(r)).map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : v]),['Form coefficients', JSON.stringify(r.coefficients)],['Form coordinate basis',r.options.form==='plane'||(!r.options.form&&r.options.plane)?'x/(cols-1)-0.5, y/(rows-1)-0.5, 1':'1, (x-(cols-1)/2)/max(cols-1,rows-1), (y-(rows-1)/2)/max(cols-1,rows-1), and selected quadratic terms'],['Filter implementation','Independent radial FFT filter; Gaussian lowpass amplitude 0.5 at cutoff; highpass 1-lowpass; bandpass product'],['Research window',r.research?.window??'hann'],['2D FFT window used',r.research?.spectrum.window??'hann']];}
export function psdWorkbook(r,{wavelength=false}={}) {
  const sheets = [{name:'Plot Data',rows:xyRows([{name:r.name,x:wavelength?Float64Array.from(r.psd.frequencies,f=>1/f):r.psd.frequencies,y:r.psd.mean}],wavelength?'Wavelength / um':'Spatial frequency / um^-1','PSD / nm^2 um')}, {name: 'Mean PSD', rows: meanRows(r)}, {name: 'Parameters', rows: parameterRows(r)}];
  // Split very tall/wide surfaces into sheets that stay inside Excel's column limit.
  for (let start = 0; start < r.psd.powers.length; start += 240) {const end = Math.min(start + 240, r.psd.powers.length); sheets.push({name: `All PSD ${Math.floor(start / 240) + 1}`, rows: [['Frequency / um^-1', 'Wavelength / um', ...r.psd.indices.slice(start, end).map(i => `${r.psd.direction === 'x' ? 'Row' : 'Column'} ${i + 1} / nm^2 um`)], ...Array.from(r.psd.frequencies, (f, i) => [f, 1 / f, ...r.psd.powers.slice(start, end).map(p => p[i])])]});}
  return xlsx(sheets);
}
export function summaryWorkbook(results, errors = [], bands = []) {
  return xlsx([{name: 'Summary', rows: [['File', 'Status', 'Sq [nm]', 'Sa [nm]', 'PV [nm]', 'Sampling [um]', 'PSD direction', 'PSD mode', 'PSD lines', 'Clipped points', 'Error','Ssk','Sku','Angular concentration','Peak wavelength [um]','Band min wavelength [um]','Band max wavelength [um]','Band RMS X [nm]','Band RMS Y [nm]','Analysis conditions'], ...results.map((r,i) => [r.name, 'success', r.stats.sq, r.stats.sa, r.stats.pv, r.dx, r.psd.direction, r.psd.mode, r.psd.used, r.clipped, '',r.research?.distribution.ssk,r.research?.distribution.sku,r.research?.spectrum.anisotropy,r.research?.spectrum.peakWavelength,bands[i]?.minWavelength,bands[i]?.maxWavelength,bands[i]?.x.rms,bands[i]?.y.rms,JSON.stringify(r.options)]), ...errors.map(e => [e.name, 'failed', '', '', '', '', '', '', '', '', e.error])]}, ...results.map((r, i) => ({name: `Mean PSD ${i + 1}`, rows: [['File', r.name], ...meanRows(r)]}))]);
}
export function surfaceCSV(r) {return csv([['y [um] / x [um]', ...Array.from({length: r.cols}, (_, i) => i * r.dx)], ...Array.from({length: r.rows}, (_, y) => [y * r.dx, ...r.surface.slice(y * r.cols, (y + 1) * r.cols)])]);}
export function safeName(name) {return name.replace(/\.dat$/i, '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/^\.+$/, '_').slice(0, 100) || 'surface';}
let lastDownloadURL;
export function download(name, data, type = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([data], {type})), a = document.createElement('a');
  if (lastDownloadURL) URL.revokeObjectURL(lastDownloadURL); lastDownloadURL = url;
  // Keep a real download link so browsers blocking an automatic download can retry.
  const link = document.getElementById('downloadLink');
  if (link) {link.href = url; link.download = name; link.textContent = `↓ ${name}`; link.parentElement.hidden = false;}
  a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
}
export async function pngBytes(canvas) {const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png')); if (!blob) throw new Error('PNG の生成に失敗しました。'); return new Uint8Array(await blob.arrayBuffer());}

export function xyRows(series,xlabel,ylabel) {
  if(series.length>32)throw new Error('PlotLauncher 用の出力は 32 系列までです。');
  const n=Math.max(0,...series.map(s=>s.x.length));return [series.flatMap(s=>[`${s.name} ${xlabel}`,`${s.name} ${ylabel}`]),...Array.from({length:n},(_,k)=>series.flatMap(s=>[s.x[k]??NaN,s.y[k]??NaN]))];
}
export function profileWorkbook(profiles,results,limits={}) {
  return xlsx([{name:'Plot Data',rows:xyRows(profiles.map(p=>({name:p.name,x:p.distance,y:p.height})),'Distance / um','Height / nm')},{name:'Lines',rows:[['Name','File','Start X [um]','Start Y [um]','End X [um]','End Y [um]','Length [um]','Samples'],...profiles.map(p=>[p.name,p.file,p.x0,p.y0,p.x1,p.y1,p.length,p.distance.length])]},{name:'Parameters',rows:[['Parameter','Value'],['Plot axis limits',JSON.stringify(limits)],['Sampling','Bilinear interpolation; interval <= DAT dx; NaN if required neighbor missing'],...results.map(r=>[r.name,JSON.stringify(metadata(r))])]}]);
}
export function plotPSDWorkbook(results,wavelength=false) {
  return xlsx([{name:'Plot Data',rows:xyRows(results.map(r=>({name:r.name,x:wavelength?Float64Array.from(r.psd.frequencies,f=>1/f):r.psd.frequencies,y:r.psd.mean})),wavelength?'Wavelength / um':'Spatial frequency / um^-1','PSD / nm^2 um')},{name:'Parameters',rows:[['File','Analysis conditions'],...results.map(r=>[r.name,JSON.stringify(metadata(r))])]}]);
}
export function spectrumCSV(r,kind='power') {
  const s=r.research.spectrum;return csv([['fy [1/um] / fx [1/um]',...s.fx],...Array.from(s.fy,(f,y)=>[f,...s[kind].slice(y*r.cols,(y+1)*r.cols)])]);
}
export function researchWorkbook(r,band,{wavelength=false}={}) {
  const a=r.research,s=a.spectrum,d=a.distribution,axis=f=>wavelength?Float64Array.from(f,v=>1/v):f,label=wavelength?'Wavelength / um':'Spatial frequency / um^-1',cumulative=p=>{let v=0;return Float64Array.from(p.mean,q=>{v+=Number.isFinite(q)?q*p.df:0;return Math.sqrt(v);});};
  return xlsx([{name:'Plot Data',rows:xyRows([{name:'X',x:axis(a.x.frequencies),y:a.x.mean},{name:'Y',x:axis(a.y.frequencies),y:a.y.mean}],label,'PSD / nm^2 um')},{name:'Radial 2D PSD',rows:xyRows([{name:r.name,x:axis(s.frequencies),y:s.radial}],label,'2D PSD / nm^2 um^2')},{name:'Cumulative RMS',rows:xyRows([{name:'X',x:axis(a.x.frequencies),y:cumulative(a.x)},{name:'Y',x:axis(a.y.frequencies),y:cumulative(a.y)}],label,'Cumulative RMS / nm')},{name:'Height distribution',rows:[['Height / nm','Pixel count'],...Array.from(d.centers,(z,i)=>[z,d.counts[i]])]},{name:'Research metrics',rows:[['Parameter','Value'],['Ssk',d.ssk],['Sku',d.sku],['Angular anisotropy (own metric)',s.anisotropy],['Wavevector principal angle [deg]',s.principalAngle],['Peak wavelength [um]',s.peakWavelength],['Band',JSON.stringify(band)],['2D PSD normalization','dx^2 |FFT(w*(z-mean))|^2 / sum(valid*w^2); two-sided; no doubling'],['2D FFT missing','Zero fill after mean removal and window; mask leakage may affect spectrum']]},{name:'Parameters',rows:parameterRows(r)}]);
}
