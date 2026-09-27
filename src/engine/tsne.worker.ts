/// <reference lib="webworker" />
import { TSNE } from './tsne';

export type TsneRequest =
  | {
      type: 'start';
      runId: number;
      data: Float32Array;
      n: number;
      d: number;
      perplexity: number;
      epsilon: number;
      iterations: number;
    }
  | { type: 'pause' | 'resume' | 'stop' };

export type TsneResponse =
  | { type: 'progress'; runId: number; iteration: number; total: number; coords: Float32Array; done: boolean }
  | { type: 'error'; runId: number; message: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

let tsne: TSNE | null = null;
let runId = 0;
let total = 0;
let paused = false;
let timer: ReturnType<typeof setTimeout> | null = null;

function post(done: boolean) {
  if (!tsne) return;
  const coords = Float32Array.from(tsne.Y);
  const msg: TsneResponse = { type: 'progress', runId, iteration: tsne.iteration, total, coords, done };
  ctx.postMessage(msg, [coords.buffer]);
}

function loop() {
  timer = null;
  if (!tsne || paused) return;
  const start = performance.now();
  while (tsne.iteration < total && performance.now() - start < 24) tsne.step();
  const done = tsne.iteration >= total;
  post(done);
  if (!done) timer = setTimeout(loop, 0);
}

ctx.onmessage = (e: MessageEvent<TsneRequest>) => {
  const msg = e.data;
  if (msg.type === 'start') {
    if (timer) clearTimeout(timer);
    runId = msg.runId;
    total = msg.iterations;
    paused = false;
    try {
      tsne = new TSNE(msg.data, msg.n, msg.d, { perplexity: msg.perplexity, epsilon: msg.epsilon, seed: 7 });
      post(false);
      timer = setTimeout(loop, 0);
    } catch (err) {
      ctx.postMessage({ type: 'error', runId, message: String(err) } satisfies TsneResponse);
    }
  } else if (msg.type === 'pause') {
    paused = true;
  } else if (msg.type === 'resume') {
    if (paused) {
      paused = false;
      if (!timer) timer = setTimeout(loop, 0);
    }
  } else if (msg.type === 'stop') {
    tsne = null;
    if (timer) clearTimeout(timer);
    timer = null;
  }
};
