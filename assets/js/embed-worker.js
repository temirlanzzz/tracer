// embed-worker.js — runs MiniLM off the main thread so the page stays responsive.
const TJS = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';
const MODEL = 'Xenova/all-MiniLM-L6-v2';
let ex = null, device = '';

self.onmessage = async ({ data }) => {
  const { id, type } = data;
  try {
    if (type === 'load') {
      if (!ex) {
        const { pipeline, env } = await import(TJS);
        env.allowLocalModels = false;
        const progress_callback = p => self.postMessage({ id, type: 'progress', p: { status: p.status, file: p.file, loaded: p.loaded, total: p.total } });
        ex = await pipeline('feature-extraction', MODEL, { dtype: 'q8', progress_callback });
        device = 'wasm';
      }
      self.postMessage({ id, type: 'done', device });
    } else if (type === 'embed') {
      const out = [];
      for (let i = 0; i < data.texts.length; i += 16) {
        const t = await ex(data.texts.slice(i, i + 16), { pooling: 'mean', normalize: true });
        const [n, d] = t.dims;
        for (let k = 0; k < n; k++) out.push(t.data.slice(k * d, (k + 1) * d));
      }
      self.postMessage({ id, type: 'done', vecs: out }, out.map(v => v.buffer));
    }
  } catch (e) {
    self.postMessage({ id, type: 'error', message: String(e && e.message || e) });
  }
};
