import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

function required(key) {
  const v = process.env[key]?.trim();
  if (!v) throw new Error(`缺少環境變數 ${key}（請參考 .env.example）`);
  return v;
}
const optional = (key) => process.env[key]?.trim() || '';
const list = (key) => optional(key).split(',').map((s) => s.trim()).filter(Boolean);

export function loadConfig() {
  const cfg = {
    root: ROOT,
    discordToken: required('DISCORD_TOKEN'),
    inputChannelId: required('INPUT_CHANNEL_ID'),
    reviewChannelId: required('REVIEW_CHANNEL_ID'),
    reviewerRoleIds: list('REVIEWER_ROLE_IDS'),
    anthropicKey: required('ANTHROPIC_API_KEY'),
    model: optional('CLAUDE_MODEL') || 'claude-sonnet-5-5',
    dryRun: optional('DRY_RUN').toLowerCase() === 'true',
    threads: { userId: optional('THREADS_USER_ID') || 'me', token: optional('THREADS_ACCESS_TOKEN') },
    instagram: { userId: optional('IG_USER_ID') || 'me', token: optional('IG_ACCESS_TOKEN') },
  };
  cfg.enabled = {
    threads: Boolean(cfg.threads.token),
    instagram: Boolean(cfg.instagram.token),
  };
  return cfg;
}

/** Format & glossary are re-read on every draft so edits apply without a restart. */
export function loadStyle(root = ROOT) {
  const format = fs.readFileSync(path.join(root, 'config/format.md'), 'utf8');
  const glossary = JSON.parse(fs.readFileSync(path.join(root, 'config/glossary.json'), 'utf8'));
  return { format, glossary };
}
