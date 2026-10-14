// embed.js — MiniLM sentence embeddings via transformers.js (pinned 3.8.1) in a Web Worker.
// The model (Xenova/all-MiniLM-L6-v2, 8-bit, ~23 MB) comes from the Hugging Face hub on first use
// and is cached by the browser afterwards.

let worker = null, seq = 0, loadP = null;
const pending = new Map();

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./embed-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      const p = pending.get(data.id);
      if (!p) return;
      if (data.type === 'progress') { p.onProgress && p.onProgress(data.p); return; }
      pending.delete(data.id);
      data.type === 'error' ? p.reject(new Error(data.message)) : p.resolve(data);
    };
    worker.onerror = e => { for (const p of pending.values()) p.reject(new Error(e.message || 'worker failed')); pending.clear(); };
  }
  return worker;
}

function call(msg, onProgress) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject, onProgress });
    getWorker().postMessage({ ...msg, id });
  });
}

export function loadModel(onProgress) {
  if (!loadP) {
    loadP = call({ type: 'load' }, onProgress);
    loadP.catch(() => { loadP = null; });
  }
  return loadP;
}

/** Normalised 384-d vectors, one Float32Array per input string. */
export async function embed(texts) {
  if (!texts.length) return [];
  await loadModel();
  return (await call({ type: 'embed', texts })).vecs;
}

export function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}
