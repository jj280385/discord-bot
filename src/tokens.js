import fs from 'node:fs';
import path from 'node:path';
import { refreshThreadsToken } from './publish/threads.js';
import { refreshInstagramToken } from './publish/instagram.js';

/**
 * Meta long-lived tokens expire after ~60 days. The bot refreshes them on start-up
 * and every few days, saving the new token to data/tokens.json (mount this folder
 * as a volume when deploying). If you put a brand-new token in .env, it wins.
 */

let file;
let cache;

function load() {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    cache = {};
  }
  return cache;
}

function save() {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(cache, null, 2));
}

export function initTokens(root) {
  file = path.join(root, 'data/tokens.json');
  cache = null;
}

export function getToken(name, envToken) {
  const entry = load()[name];
  if (entry && entry.envToken === envToken && entry.token) return entry.token;
  return envToken;
}

const REFRESHERS = { threads: refreshThreadsToken, instagram: refreshInstagramToken };

export async function refreshTokens(cfg, log = console) {
  for (const name of ['threads', 'instagram']) {
    if (!cfg.enabled[name]) continue;
    const envToken = cfg[name].token;
    try {
      const { access_token, expires_in } = await REFRESHERS[name](getToken(name, envToken));
      load()[name] = {
        envToken,
        token: access_token,
        expiresAt: new Date(Date.now() + expires_in * 1000).toISOString(),
        refreshedAt: new Date().toISOString(),
      };
      save();
      log.info?.(`[tokens] ${name} token 已更新，到期日 ${load()[name].expiresAt}`);
    } catch (err) {
      // A token must be at least 24h old to be refreshed, so failures right after setup are normal.
      log.warn?.(`[tokens] ${name} token 更新失敗：${err.message}`);
    }
  }
}
