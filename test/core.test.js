import { test, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { parseInput, isImageAttachment, isTextAttachment } from '../src/input.js';
import { measure, checkPost, checkPosts, splitThreadText, threadParts } from '../src/limits.js';
import { buildSystemPrompt, buildUserContent } from '../src/prompt.js';
import { buildReviewPayload, readDraft, updateEmbeds, replaceMeta, metaEmbed, isPublished } from '../src/review.js';
import { loadStyle } from '../src/config.js';
import { generatePosts } from '../src/ai.js';
import { publishThreads } from '../src/publish/threads.js';
import { publishInstagram } from '../src/publish/instagram.js';
import { toJpeg, igAspectWarning } from '../src/media.js';
import sharp from 'sharp';

afterEach(() => mock.restoreAll());

test('parseInput splits link and text', () => {
  const r = parseInput('https://x.com/abc/status/1\n\n오늘 컴백 무대!\n\n\n참고 <https://weverse.io/a>.');
  assert.equal(r.sourceUrl, 'https://x.com/abc/status/1');
  assert.deepEqual(r.extraUrls, ['https://weverse.io/a']);
  assert.equal(r.text, '오늘 컴백 무대!\n\n참고 .');
});

test('attachment type detection', () => {
  assert.ok(isImageAttachment({ contentType: 'image/png' }));
  assert.ok(!isImageAttachment({ contentType: 'video/mp4' }));
  assert.ok(isTextAttachment({ contentType: 'text/plain; charset=utf-8', name: 'message.txt' }));
});

test('length limits per platform', () => {
  assert.equal(measure('threads', '你好'), 2);
  assert.equal(checkPost('threads', '中'.repeat(500)).length, 0);
  assert.equal(checkPost('threads', 'a'.repeat(501)).length, 0); // split into a reply chain
  assert.equal(checkPost('instagram', 'a'.repeat(2201)).length, 1);
  const tags = Array.from({ length: 31 }, (_, i) => `#t${i}`).join(' ');
  assert.equal(checkPost('instagram', tags).length, 1);
});

test('prompt includes glossary, format and link policy', () => {
  const { format, glossary } = loadStyle();
  const sys = buildSystemPrompt({ format, glossary });
  assert.match(sys, /직캠 → 飯拍/);
  assert.ok(sys.includes(format));
  assert.match(sys, /原文寫什麼就翻什麼/);
  assert.doesNotMatch(sys, /\bX\b/);
  assert.doesNotMatch(sys, /_說明/);
  const content = buildUserContent({ text: '안녕', sourceUrl: 'https://a.b', images: [{ data: Buffer.from('x'), mediaType: 'image/jpeg' }] });
  assert.equal(content[0].type, 'image');
  assert.match(content[1].text, /안녕/);
});

const posts = { summary: '摘要', notes: '', warnings: [], post: '貼文' };

test('review message round-trips through embeds', () => {
  const payload = buildReviewPayload(posts, { sourceUrl: 'https://src', inputMessageUrl: 'https://discord.com/channels/1/2/3', submittedBy: '<@9>' });
  const message = {
    embeds: payload.embeds.map((e) => e.toJSON()),
    attachments: new Map([['a', { url: 'https://cdn/img.jpg', contentType: 'image/jpeg' }]]),
  };
  const d = readDraft(message);
  assert.equal(payload.embeds.length, 2);
  assert.equal(d.text, '貼文');
  assert.equal(d.sourceUrl, 'https://src');
  assert.equal(d.inputMessageUrl, 'https://discord.com/channels/1/2/3');
  assert.deepEqual(d.images, ['https://cdn/img.jpg']);

  const updated = updateEmbeds(message, { status: { instagram: '✅ 已發布' }, text: '新貼文' });
  const d2 = readDraft({ embeds: updated.map((e) => e.toJSON()), attachments: new Map() });
  assert.ok(isPublished(d2.status.instagram));
  assert.ok(!isPublished(d2.status.threads));
  assert.equal(d2.text, '新貼文');
  assert.equal(d2.sourceUrl, 'https://src');

  const swapped = replaceMeta(updated, metaEmbed({ summary: '新摘要', sourceUrl: 'https://new', inputMessageUrl: 'u', submittedBy: 's' }));
  assert.equal(readDraft({ embeds: swapped.map((e) => e.toJSON()), attachments: new Map() }).sourceUrl, 'https://new');
});

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

test('generatePosts nudges for the tool and keeps over-limit text as a warning', async () => {
  const calls = [];
  const replies = [
    { stop_reason: 'end_turn', content: [{ type: 'text', text: '好的' }] },
    {
      stop_reason: 'tool_use',
      content: [{
        type: 'tool_use', id: 'tu1', name: 'submit_posts',
        input: { post: '中'.repeat(2300), summary: 's', notes: '' },
      }],
    },
  ];
  mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push(JSON.parse(init.body));
    return jsonResponse({
      id: 'msg', type: 'message', role: 'assistant', model: 'm', ...replies[calls.length - 1],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
  });
  const { format, glossary } = loadStyle();
  const out = await generatePosts({ text: '원문', sourceUrl: null }, { apiKey: 'k', model: 'm', format, glossary });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].tool_choice.type, 'auto');
  assert.match(calls[1].messages.at(-1).content, /submit_posts/);
  assert.equal(out.post.length, 2300);
  assert.equal(out.warnings.length, 1);
});

test('splitThreadText breaks at paragraphs, then sentences, within the limit', () => {
  assert.deepEqual(splitThreadText('短文'), ['短文']);
  const paras = ['甲'.repeat(300), '乙'.repeat(300), '丙'.repeat(100)].join('\n\n');
  assert.deepEqual(splitThreadText(paras), ['甲'.repeat(300), `${'乙'.repeat(300)}\n\n${'丙'.repeat(100)}`]);
  const sentences = `${'一'.repeat(299)}。${'二'.repeat(299)}。`;
  assert.deepEqual(splitThreadText(sentences), [`${'一'.repeat(299)}。`, `${'二'.repeat(299)}。`]);
  const parts = splitThreadText('長'.repeat(1200));
  assert.deepEqual(parts.map((p) => p.length), [500, 500, 200]);
});

test('threadParts moves the comment section into replies', () => {
  const post = '主文\n\n#許南俊\n\n— 留言區 —\n🔗 原文連結｜\nhttps://a.b';
  assert.deepEqual(threadParts(post), ['主文\n\n#許南俊', '🔗 原文連結｜\nhttps://a.b']);
  assert.deepEqual(threadParts('只有主文'), ['只有主文']);
  const long = `${'甲'.repeat(400)}\n\n${'乙'.repeat(400)}\n— 留言區 —\n連結`;
  assert.deepEqual(threadParts(long), ['甲'.repeat(400), '乙'.repeat(400), '連結']);
});

test('long Threads post continues as a reply chain', async () => {
  const created = [];
  let n = 0;
  mock.method(globalThis, 'fetch', async (url, init = {}) => {
    const u = new URL(url);
    const params = init.body ? Object.fromEntries(new URLSearchParams(init.body)) : Object.fromEntries(u.searchParams);
    if (u.pathname.endsWith('/threads')) {
      created.push(params);
      return jsonResponse({ id: `c${created.length}` });
    }
    if (u.pathname.endsWith('/threads_publish')) return jsonResponse({ id: `post${++n}` });
    if (params.fields === 'permalink') return jsonResponse({ permalink: 'https://threads.net/p/1' });
    return jsonResponse({ status: 'FINISHED' });
  });
  const text = ['甲'.repeat(400), '乙'.repeat(400), '丙'.repeat(400)].join('\n\n');
  const r = await publishThreads({ text, imageUrls: [] }, { userId: 'U', token: 'T' });
  assert.equal(created.length, 3);
  assert.equal(created[0].reply_to_id, undefined);
  assert.equal(created[1].reply_to_id, 'post1');
  assert.equal(created[2].reply_to_id, 'post2');
  assert.equal(r.url, 'https://threads.net/p/1');
  assert.equal(r.warning, null);
});

test('Threads carousel flow: children → carousel → publish', async () => {
  const seen = [];
  let n = 0;
  mock.method(globalThis, 'fetch', async (url, init = {}) => {
    const u = new URL(url);
    const params = init.body ? Object.fromEntries(new URLSearchParams(init.body)) : Object.fromEntries(u.searchParams);
    seen.push([init.method, u.pathname, params]);
    if (u.pathname.endsWith('/threads')) return jsonResponse({ id: `c${++n}` });
    if (u.pathname.endsWith('/threads_publish')) return jsonResponse({ id: 'post1' });
    if (params.fields === 'permalink') return jsonResponse({ permalink: 'https://threads.net/p/1' });
    return jsonResponse({ status: 'FINISHED' });
  });
  const r = await publishThreads({ text: 'hi', imageUrls: ['https://a', 'https://b'] }, { userId: 'U', token: 'T' });
  assert.equal(r.url, 'https://threads.net/p/1');
  const carousel = seen.find(([, , p]) => p.media_type === 'CAROUSEL');
  assert.equal(carousel[2].children, 'c1,c2');
  assert.equal(carousel[2].text, 'hi');
});

test('Instagram refuses text-only and surfaces API errors', async () => {
  await assert.rejects(publishInstagram({ text: 'x', imageUrls: [] }, { userId: 'U', token: 'T' }), /至少需要一張圖片/);
  mock.method(globalThis, 'fetch', async () => jsonResponse({ error: { message: 'Invalid token' } }, 400));
  await assert.rejects(publishInstagram({ text: 'x', imageUrls: ['https://a'] }, { userId: 'U', token: 'T' }), /Invalid token/);
});

test('images are converted to JPEG and ratio checked', async () => {
  const png = await sharp({ create: { width: 2000, height: 500, channels: 3, background: '#f00' } }).png().toBuffer();
  const out = await toJpeg(png);
  assert.equal(out.width, 1440);
  assert.equal((await sharp(out.data).metadata()).format, 'jpeg');
  assert.match(igAspectWarning(out, 0), /超出 IG 允許範圍/);
  assert.equal(igAspectWarning({ width: 1080, height: 1350 }, 0), null);
});

test('checkPosts aggregates', () => {
  assert.equal(checkPosts('').length, 2);
  assert.equal(checkPosts('中'.repeat(600)).length, 0);
  assert.equal(checkPosts('中'.repeat(2300)).length, 1);
});
