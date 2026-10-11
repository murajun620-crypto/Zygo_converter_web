import {removeForm, filterSurface, researchAnalysis} from './advanced.js';
// Independent implementation of MetroPro DAT decoding. Reference: prysm 0.21.1 io.
export const DEFAULT_OPTIONS = Object.freeze({plane: true, mode: 'legacy', clip: true, limit: 10, window: 'boxcar', missing: 'skip', direction: 'x'});
export const MAX_PIXELS = 2_000_000;

export function readDat(buffer, name = 'surface.dat') {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 834) throw new Error('DAT ヘッダーが不足しています。Zygo バイナリー DAT を選択してください。');
  if (buffer.byteLength > 32 * 1024 * 1024) throw new Error('1 ファイルの上限は 32 MB です。');
  const v = new DataView(buffer), u16 = o => v.getUint16(o), u32 = o => v.getUint32(o), f32 = o => v.getFloat32(o);
  const magic = u32(0), format = u16(4), header = u32(6);
  if (!([0x881b036f, 0x881b0370, 0x881b0371].includes(magic)) || ![1, 2, 3].includes(format) || magic !== 0x881b036e + format) throw new Error('未対応形式です。MetroPro バイナリー DAT (format 1–3) に対応しています。DATX / ASCII DAT は対象外です。');
  if (header < 834 || header > buffer.byteLength) throw new Error('DAT ヘッダーのサイズが不正です。');
  const cols = u16(68), rows = u16(70), iw = u16(52), ih = u16(54), buckets = u16(56) || 1;
  if (cols < 2 || rows < 2 || cols * rows > MAX_PIXELS) throw new Error('表面データは縦横 2 点以上、合計 200 万点以下である必要があります。');
  if (iw * ih > MAX_PIXELS) throw new Error('Intensity の上限は 200 万画素です。');
  const intensityBytes = iw * ih * buckets * 2, phaseBytes = cols * rows * 4;
  if (u32(60) !== intensityBytes || u32(72) !== phaseBytes || header + intensityBytes + phaseBytes > buffer.byteLength) throw new Error('データ領域のサイズが一致しません。ファイルが破損・切断されている可能性があります。');
  const dx = f32(184) * 1e6, S = f32(164), W = f32(168), O = f32(176), R = [4096, 32768, 131072][u16(218)];
  if (!R || ![dx, S, W, O].every(x => Number.isFinite(x) && x > 0)) throw new Error('サンプリング間隔または高さ換算係数が不正です。');
  const factor = W * S * O / R * 1e9;
  const phase = new Float64Array(cols * rows);
  let valid = 0;
  for (let i = 0; i < phase.length; i++) {const n = v.getInt32(header + intensityBytes + i * 4); phase[i] = n >= 2147483640 ? NaN : n * factor; if (Number.isFinite(phase[i])) valid++;}
  if (valid < 3) throw new Error('有効な高さデータが 3 点未満です。');
  const intensity = new Float64Array(iw * ih);
  // Camera words are little endian, matching prysm 0.21.1 on Windows. First bucket.
  for (let y = 0; y < ih; y++) for (let x = 0; x < iw; x++) intensity[(ih - 1 - y) * iw + x] = v.getUint16(header + (y * iw + x) * 2, true);
  return {name, cols, rows, dx, phase, intensity, iw, ih, meta: {format, header, buckets, wavelength_nm: W * 1e9, timestamp: u32(76), valid, total: phase.length, intensityEndian: 'little'}};
}

function solve3(matrix, rhs) {
  const a = matrix.map((r, i) => [...r, rhs[i]]);
  for (let c = 0; c < 3; c++) {
    let p = c; for (let r = c + 1; r < 3; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    if (Math.abs(a[p][c]) < 1e-12) throw new Error('有効点の配置から平面を決定できません。');
    [a[c], a[p]] = [a[p], a[c]];
    const scale = a[c][c]; for (let j = c; j < 4; j++) a[c][j] /= scale;
    for (let r = 0; r < 3; r++) if (r !== c) {const k = a[r][c]; for (let j = c; j < 4; j++) a[r][j] -= k * a[c][j];}
  }
  return a.map(r => r[3]);
}

export function surfaceStats(data) {
  let n = 0, mean = 0, m2 = 0, min = Infinity, max = -Infinity;
  for (const z of data) if (Number.isFinite(z)) {n++; const delta = z - mean; mean += delta / n; m2 += delta * (z - mean); min = Math.min(min, z); max = Math.max(max, z);}
  let abs = 0; for (const z of data) if (Number.isFinite(z)) abs += Math.abs(z - mean);
  return {n, mean, min, max, pv: max - min, sq: Math.sqrt(m2 / n), sa: abs / n, validPercent: n / data.length * 100};
}

export function prepareSurface(parsed, options = DEFAULT_OPTIONS) {
  const {cols, rows, phase} = parsed, coefficients = [0, 0, 0];
  const form = options.form ?? (options.plane ? 'plane' : 'none');
  if (form !== 'plane') {
    const fitted = removeForm(phase, cols, rows, form), rawSurface = filterSurface(fitted.rawSurface, cols, rows, parsed.dx, options);
    const surface = Float64Array.from(rawSurface, z => options.clip ? Math.max(-options.limit, Math.min(options.limit, z)) : z);
    let clipped = 0; for (let i=0;i<surface.length;i++) if(Number.isFinite(rawSurface[i])&&surface[i]!==rawSurface[i])clipped++;
    return {...fitted, rawSurface, surface, clipped, stats: surfaceStats(rawSurface)};
  }
  // Centered, scaled coordinates avoid ill-conditioned normal equations.
  if (form === 'plane') {
    let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sz = 0, sxz = 0, syz = 0;
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const z = phase[y * cols + x]; if (!Number.isFinite(z)) continue;
      const xx = x / (cols - 1) - 0.5, yy = y / (rows - 1) - 0.5;
      n++; sx += xx; sy += yy; sxx += xx * xx; syy += yy * yy; sxy += xx * yy; sz += z; sxz += xx * z; syz += yy * z;
    }
    coefficients.splice(0, 3, ...solve3([[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]], [sxz, syz, sz]));
  }
  const rawSurface = new Float64Array(phase.length), surface = new Float64Array(phase.length);
  let clipped = 0;
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const z = phase[y * cols + x] - (coefficients[0] * (x / (cols - 1) - 0.5) + coefficients[1] * (y / (rows - 1) - 0.5) + coefficients[2]);
    const i = (rows - 1 - y) * cols + x; rawSurface[i] = z;
    surface[i] = options.clip ? Math.max(-options.limit, Math.min(options.limit, z)) : z;
    if (Number.isFinite(z) && surface[i] !== z) clipped++;
  }
  const filtered = filterSurface(rawSurface, cols, rows, parsed.dx, options);
  clipped = 0; for(let i=0;i<surface.length;i++){surface[i]=options.clip?Math.max(-options.limit,Math.min(options.limit,filtered[i])):filtered[i];if(Number.isFinite(filtered[i])&&surface[i]!==filtered[i])clipped++;}
  return {surface, rawSurface: filtered, coefficients, clipped, stats: surfaceStats(filtered)};
}

function radixFFT(re, im, inverse = false) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) {[re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]];}}
  for (let len = 2; len <= n; len *= 2) {
    const angle = (inverse ? 2 : -2) * Math.PI / len, wr0 = Math.cos(angle), wi0 = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let wr = 1, wi = 0;
      for (let j = 0; j < len / 2; j++) {const a = i + j, b = a + len / 2, tr = wr * re[b] - wi * im[b], ti = wr * im[b] + wi * re[b]; re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti; const next = wr * wr0 - wi * wi0; wi = wr * wi0 + wi * wr0; wr = next;}
    }
  }
  if (inverse) for (let i = 0; i < n; i++) {re[i] /= n; im[i] /= n;}
}

// Bluestein transform: exact original N, including non-power-of-two dimensions.
export function fftReal(input) {
  const n = input.length;
  if ((n & (n - 1)) === 0) {const re = Float64Array.from(input), im = new Float64Array(n); radixFFT(re, im); return {re, im};}
  let m = 1; while (m < 2 * n - 1) m *= 2;
  const ar = new Float64Array(m), ai = new Float64Array(m), br = new Float64Array(m), bi = new Float64Array(m);
  for (let k = 0; k < n; k++) {const a = Math.PI * ((k * k) % (2 * n)) / n, c = Math.cos(a), s = Math.sin(a); ar[k] = input[k] * c; ai[k] = -input[k] * s; br[k] = c; bi[k] = s; if (k) {br[m - k] = c; bi[m - k] = s;}}
  radixFFT(ar, ai); radixFFT(br, bi);
  for (let k = 0; k < m; k++) {const r = ar[k] * br[k] - ai[k] * bi[k]; ai[k] = ar[k] * bi[k] + ai[k] * br[k]; ar[k] = r;}
  radixFFT(ar, ai, true);
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let k = 0; k < n; k++) {const a = Math.PI * ((k * k) % (2 * n)) / n, c = Math.cos(a), s = Math.sin(a); re[k] = ar[k] * c + ai[k] * s; im[k] = ai[k] * c - ar[k] * s;}
  return {re, im};
}

function interpolateLine(line) {
  const valid = []; for (let i = 0; i < line.length; i++) if (Number.isFinite(line[i])) valid.push(i);
  if (valid.length < 2) return false;
  for (let i = 0; i < valid[0]; i++) line[i] = line[valid[0]];
  for (let j = 1; j < valid.length; j++) {const a = valid[j - 1], b = valid[j]; for (let i = a + 1; i < b; i++) line[i] = line[a] + (line[b] - line[a]) * (i - a) / (b - a);}
  for (let i = valid.at(-1) + 1; i < line.length; i++) line[i] = line[valid.at(-1)];
  return true;
}

export function computePSD(data, cols, rows, dx, options) {
  const legacy = options.mode === 'legacy', alongX = options.direction !== 'y', n = alongX ? cols : rows, lines = alongX ? rows : cols;
  const bins = legacy ? Math.floor(n / 2) : Math.floor(n / 2) + 1;
  const frequencies = Float64Array.from({length: bins - 1}, (_, i) => (i + 1) / (n * dx));
  const weights = Float64Array.from({length: n}, (_, i) => !legacy && options.window === 'hann' ? 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n) : 1);
  const energy = weights.reduce((s, w) => s + w * w, 0), powers = [], indices = [];
  let skipped = 0, interpolated = 0, zeroFilled = 0;
  for (let l = 0; l < lines; l++) {
    const line = Float64Array.from({length: n}, (_, i) => alongX ? data[l * cols + i] : data[i * cols + l]);
    const count = line.reduce((s, z) => s + Number.isFinite(z), 0);
    if (legacy) {if (count < n) zeroFilled++; for (let i = 0; i < n; i++) if (!Number.isFinite(line[i])) line[i] = 0;}
    else if (count !== n) {if (options.missing !== 'interpolate' || !interpolateLine(line)) {skipped++; continue;} interpolated++;}
    if (!legacy) {const mean = line.reduce((s, z) => s + z, 0) / n; for (let i = 0; i < n; i++) line[i] = (line[i] - mean) * weights[i];}
    const {re, im} = fftReal(line), psd = new Float64Array(bins - 1);
    for (let k = 1; k < bins; k++) {const coefficient = legacy ? 2 * Math.PI * dx / n : dx / energy * ((n % 2 === 0 && k === n / 2) ? 1 : 2); psd[k - 1] = coefficient * (re[k] * re[k] + im[k] * im[k]);}
    powers.push(psd); indices.push(l);
  }
  const mean = new Float64Array(bins - 1);
  if (powers.length) for (let k = 0; k < mean.length; k++) {for (const p of powers) mean[k] += p[k]; mean[k] /= powers.length;}
  else mean.fill(NaN);
  return {frequencies, mean, powers, indices, used: powers.length, skipped, interpolated, zeroFilled, n, lines, df: 1 / (n * dx), nyquist: 1 / (2 * dx), unit: 'nm²·µm', direction: options.direction, mode: options.mode};
}

export function analyze(parsed, opts = {}) {
  const options = {...DEFAULT_OPTIONS, ...opts};
  if(options.researchWindow&&!['boxcar','hann'].includes(options.researchWindow))throw new Error('特徴解析の窓設定が不正です。');
  if (!['legacy', 'density'].includes(options.mode) || !['x', 'y'].includes(options.direction) || !['boxcar', 'hann'].includes(options.window) || !['skip', 'interpolate'].includes(options.missing) || !Number.isFinite(options.limit) || options.limit <= 0) throw new Error('解析設定が不正です。');
  // Preserve the original API default for numerical compatibility; the UI explicitly
  // selects plane-only as its initial spectral input.
  options.psdInput ??= 'processed';
  if(!['plane','raw','processed'].includes(options.psdInput))throw new Error('PSD入力の設定が不正です。');
  const prepared = prepareSurface(parsed, options);
  const baseline = options.psdInput==='processed' ? prepared : prepareSurface(parsed, {
    ...options, form: options.psdInput==='plane'?'plane':'none', filter:'off', clip:false
  });
  const psdConditions = {input:options.psdInput, form:options.psdInput==='processed'?(options.form??(options.plane?'plane':'none')):options.psdInput==='plane'?'plane':'none',
    filter:options.psdInput==='processed'?(options.filter??'off'):'off', clip:options.psdInput==='processed'&&options.clip,
    clipped:options.psdInput==='processed'?prepared.clipped:0};
  const psd = computePSD(baseline.surface, parsed.cols, parsed.rows, parsed.dx, options);
  const research = researchAnalysis(baseline.surface, parsed.cols, parsed.rows, parsed.dx, options.researchWindow ?? 'hann', prepared.rawSurface);
  return {...parsed, ...prepared, options, psdConditions, psd, research};
}

export function slope(data, cols, rows, direction, dx = 1, legacy = false) {
  const out = new Float64Array(data.length);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const i = y * cols + x, step = direction === 'x' ? 1 : cols, pos = direction === 'x' ? x : y, n = direction === 'x' ? cols : rows;
    const z = pos === 0 ? data[i + step] - data[i] : pos === n - 1 ? data[i] - data[i - step] : (data[i + step] - data[i - step]) / 2;
    out[i] = legacy ? (Math.abs(z) > 10 ? 0 : z) : z / dx;
  }
  return out;
}

export function syntheticDat() {
  const cols = 128, rows = 96, dx = 2.5, phase = new Float64Array(cols * rows), intensity = new Float64Array(cols * rows);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {const i = y * cols + x; phase[i] = 4 * Math.sin(2 * Math.PI * 8 * x / cols) + 2 * Math.cos(2 * Math.PI * 5 * y / rows) + 0.05 * x + 0.025 * y; intensity[i] = 170 + 35 * Math.sin(x / 12) * Math.cos(y / 18);}
  return {name: 'DEMO · 合成表面', cols, rows, dx, phase, intensity, iw: cols, ih: rows, meta: {format: 'synthetic', wavelength_nm: 632.8, valid: phase.length, total: phase.length, timestamp: 0}};
}
