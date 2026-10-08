// Small helper shared by the Threads and Instagram publishers (both are Meta Graph APIs).

export async function graphRequest(method, url, params = {}) {
  let res;
  if (method === 'GET') {
    const u = new URL(url);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    res = await fetch(u, { method });
  } else {
    res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params),
    });
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) {
    const msg = body.error?.error_user_msg || body.error?.message || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return body;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Poll a media container until it is ready to publish.
 * @param {() => Promise<string>} getStatus returns FINISHED / IN_PROGRESS / ERROR / EXPIRED
 */
export async function waitUntilReady(getStatus, { timeoutMs = 90_000, intervalMs = 3_000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const status = await getStatus();
    if (status === 'FINISHED' || status === 'PUBLISHED') return;
    if (status === 'ERROR' || status === 'EXPIRED') throw new Error(`媒體處理失敗（${status}）`);
    await sleep(intervalMs);
  }
  throw new Error('媒體處理逾時');
}
