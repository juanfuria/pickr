import { httpError } from './http.js';

// A tiny semaphore: at most `concurrency` functions run at once, at most `queue` wait; beyond that the caller is
// told to come back later rather than pile work onto a one-core box.
export function createLimiter({ concurrency = 2, queue = 32 } = {}) {
  let inFlight = 0;
  const waiting = [];
  const next = () => {
    if (inFlight >= concurrency || waiting.length === 0) return;
    inFlight++;
    const { fn, resolve, reject } = waiting.shift();
    // free the slot before the caller sees the result, so inFlight is accurate the moment a run() settles
    Promise.resolve().then(fn).finally(() => { inFlight--; next(); }).then(resolve, reject);
  };
  return {
    run(fn) {
      if (inFlight >= concurrency && waiting.length >= queue) {
        const err = httpError(503, 'busy');
        err.retryAfter = 2;
        return Promise.reject(err);
      }
      return new Promise((resolve, reject) => { waiting.push({ fn, resolve, reject }); next(); });
    },
    get inFlight() { return inFlight; },
    get waiting() { return waiting.length; },
  };
}
