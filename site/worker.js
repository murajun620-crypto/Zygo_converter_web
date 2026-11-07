import {readDat, analyze, syntheticDat, syntheticWaferDat} from './analysis.js?v=wafer-roi-2';
self.onmessage = ({data}) => {
  try {const parsed = data.synthetic ? (data.synthetic==='wafer-edge'?syntheticWaferDat():syntheticDat()) : readDat(data.buffer, data.name); self.postMessage({id: data.id, result: analyze(parsed, data.options)});}
  catch (error) {self.postMessage({id: data.id, error: error.message});}
};
