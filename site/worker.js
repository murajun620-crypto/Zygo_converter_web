import {readDat, analyze, syntheticDat} from './analysis.js';
self.onmessage = ({data}) => {
  try {const parsed = data.synthetic ? syntheticDat() : readDat(data.buffer, data.name); self.postMessage({id: data.id, result: analyze(parsed, data.options)});}
  catch (error) {self.postMessage({id: data.id, error: error.message});}
};
