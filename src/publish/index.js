import { publishThreads } from './threads.js';
import { publishInstagram } from './instagram.js';
import { getToken } from '../tokens.js';
import { threadParts } from '../limits.js';

export async function publishTo(platform, { text, imageUrls }, cfg) {
  if (!cfg.enabled[platform]) {
    throw new Error('尚未設定這個平台的帳號金鑰（.env）');
  }
  if (cfg.dryRun) {
    const parts = platform === 'threads' ? threadParts(text) : [text];
    parts.forEach((part, i) => {
      const label = parts.length > 1 ? ` (${i + 1}/${parts.length}${i ? ' 回覆' : ''})` : '';
      console.log(`[DRY_RUN] ${platform}${label}\n${part}`);
    });
    console.log(`images: ${imageUrls.length}`);
    if (platform === 'instagram' && imageUrls.length === 0) {
      throw new Error('Instagram 不能發純文字貼文，至少需要一張圖片');
    }
    return { id: 'dry-run', url: null };
  }
  switch (platform) {
    case 'threads':
      return publishThreads({ text, imageUrls }, { ...cfg.threads, token: getToken('threads', cfg.threads.token) });
    case 'instagram':
      return publishInstagram({ text, imageUrls }, { ...cfg.instagram, token: getToken('instagram', cfg.instagram.token) });
    default:
      throw new Error(`未知平台 ${platform}`);
  }
}
