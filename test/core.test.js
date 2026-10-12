import { test, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { parseInput, isImageAttachment, isVideoAttachment, isTextAttachment } from '../src/input.js';
import { measure, checkPost, checkPosts, splitThreadText, threadParts, instagramParts, findPlaceholders } from '../src/limits.js';
import { buildSystemPrompt, buildUserContent } from '../src/prompt.js';
import { buildReviewPayload, buildArchivePayload, readDraft, updateEmbeds, replaceMeta, metaEmbed, isPublished } from '../src/review.js';
import { loadStyle } from '../src/config.js';
import { generatePosts } from '../src/ai.js';
import { publishThreads } from '../src/publish/threads.js';
import { publishInstagram } from '../src/publish/instagram.js';
import { toJpeg, igAspectWarning, padToIgRatio } from '../src/media.js';
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
  assert.ok(isVideoAttachment({ contentType: 'video/mp4' }));
  assert.ok(isVideoAttachment({ contentType: 'video/quicktime' }));
  assert.ok(isVideoAttachment({ name: 'clip.MOV' }));
  assert.ok(!isVideoAttachment({ contentType: 'video/webm' }));
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
    attachments: new Map([
      ['a', { url: 'https://cdn/img.jpg', name: 'image-1.jpg', contentType: 'image/jpeg' }],
      ['b', { url: 'https://cdn/v.mp4', name: 'video-2.mp4', contentType: 'video/mp4' }],
      ['c', { url: 'https://cdn/x.txt', name: 'x.txt', contentType: 'text/plain' }],
    ]),
  };
  const d = readDraft(message);
  assert.equal(payload.embeds.length, 2);
  assert.equal(d.text, '貼文');
  assert.equal(d.sourceUrl, 'https://src');
  assert.equal(d.inputMessageUrl, 'https://discord.com/channels/1/2/3');
  assert.deepEqual(d.media, [
    { type: 'image', url: 'https://cdn/img.jpg', name: 'image-1.jpg' },
    { type: 'video', url: 'https://cdn/v.mp4', name: 'video-2.mp4' },
  ]);

  const updated = updateEmbeds(message, { status: { instagram: '✅ 已發布' }, text: '新貼文' });
  const d2 = readDraft({ embeds: updated.map((e) => e.toJSON()), attachments: new Map() });
  assert.ok(isPublished(d2.status.instagram));
  assert.ok(!isPublished(d2.status.threads));
  assert.equal(d2.text, '新貼文');
  assert.equal(d2.sourceUrl, 'https://src');

  const swapped = replaceMeta(updated, metaEmbed({ summary: '新摘要', sourceUrl: 'https://new', inputMessageUrl: 'u', submittedBy: 's' }));
  assert.equal(readDraft({ embeds: swapped.map((e) => e.toJSON()), attachments: new Map() }).sourceUrl, 'https://new');
});

const img = (url) => ({ type: 'image', url });
const vid = (url) => ({ type: 'video', url });

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
  const r = await publishThreads({ text, media: [] }, { userId: 'U', token: 'T' });
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
  const r = await publishThreads({ text: 'hi', media: [img('https://a'), img('https://b')] }, { userId: 'U', token: 'T' });
  assert.equal(r.url, 'https://threads.net/p/1');
  const carousel = seen.find(([, , p]) => p.media_type === 'CAROUSEL');
  assert.equal(carousel[2].children, 'c1,c2');
  assert.equal(carousel[2].text, 'hi');
});

test('Instagram refuses text-only and surfaces API errors', async () => {
  await assert.rejects(publishInstagram({ text: 'x', media: [] }, { userId: 'U', token: 'T' }), /至少需要一張圖片/);
  mock.method(globalThis, 'fetch', async () => jsonResponse({ error: { message: 'Invalid token' } }, 400));
  await assert.rejects(publishInstagram({ text: 'x', media: [img('https://a')] }, { userId: 'U', token: 'T' }), /Invalid token/);
});

test('Instagram posts the comment section as the first comment', async () => {
  const seen = [];
  mock.method(globalThis, 'fetch', async (url, init = {}) => {
    const u = new URL(url);
    const params = init.body ? Object.fromEntries(new URLSearchParams(init.body)) : Object.fromEntries(u.searchParams);
    seen.push([u.pathname, params]);
    if (u.pathname.endsWith('/media')) return jsonResponse({ id: 'c1' });
    if (u.pathname.endsWith('/media_publish')) return jsonResponse({ id: 'post1' });
    if (u.pathname.endsWith('/comments')) return jsonResponse({ id: 'cm1' });
    if (params.fields === 'permalink') return jsonResponse({ permalink: 'https://instagram.com/p/1' });
    return jsonResponse({ status_code: 'FINISHED' });
  });
  const text = '主文\n\n#許南俊\n\n— 留言區 —\n🔗 原文連結｜\nhttps://a.b';
  const r = await publishInstagram({ text, media: [img('https://a')] }, { userId: 'U', token: 'T' });
  assert.equal(seen.find(([path]) => path.endsWith('/media'))[1].caption, '主文\n\n#許南俊');
  const comment = seen.find(([path]) => path.endsWith('/comments'));
  assert.equal(comment[0], '/v23.0/post1/comments');
  assert.equal(comment[1].message, '🔗 原文連結｜\nhttps://a.b');
  assert.equal(r.url, 'https://instagram.com/p/1');
  assert.equal(r.warning, null);
});

test('instagramParts drops the marker and keeps text without one as caption', () => {
  assert.deepEqual(instagramParts('甲\n— 留言區 —\n乙'), { caption: '甲', comment: '乙' });
  assert.deepEqual(instagramParts('甲'), { caption: '甲', comment: '' });
});

test('images are converted to JPEG and padded into IG ratio', async () => {
  const wide = await sharp({ create: { width: 2000, height: 500, channels: 3, background: '#f00' } }).png().toBuffer();
  const out = await toJpeg(wide);
  assert.equal(out.width, 1440);
  assert.equal((await sharp(out.data).metadata()).format, 'jpeg');
  assert.equal(igAspectWarning(out, 0), null);

  const tall = await sharp({ create: { width: 1440, height: 2160, channels: 3, background: '#f00' } }).png().toBuffer();
  const portrait = await toJpeg(tall);
  assert.equal(igAspectWarning(portrait, 0), null);
  assert.ok(Math.abs(portrait.width / portrait.height - 0.8) < 0.01);

  assert.deepEqual(padToIgRatio({ width: 1080, height: 1350 }), { top: 0, bottom: 0, left: 0, right: 0 });
  assert.deepEqual(padToIgRatio({ width: 1440, height: 2160 }), { top: 0, bottom: 0, left: 144, right: 144 });
  assert.match(igAspectWarning({ width: 1440, height: 2160 }, 0), /超出 IG 允許範圍/);
});

test('archive payload carries summary, results, links and post text', () => {
  const review = buildReviewPayload(
    { summary: '新代言', post: '主文', notes: '', warnings: [] },
    { sourceUrl: 'https://src', inputMessageUrl: 'https://discord.com/channels/1/2/3', submittedBy: '<@9>' },
  );
  const draft = readDraft({ embeds: review.embeds.map((e) => e.toJSON()), attachments: new Map() });
  draft.status = { threads: '✅ 已發布 · [查看貼文](https://threads.net/p/1)', instagram: '✅ 已發布 · [查看貼文](https://instagram.com/p/1)' };
  const { embeds } = buildArchivePayload(draft);
  const [record, post] = embeds.map((e) => e.toJSON());
  assert.equal(record.description, '新代言');
  assert.match(record.fields.find((f) => f.name.includes('Threads')).value, /threads\.net/);
  assert.equal(record.fields.find((f) => f.name === '原文連結').value, 'https://src');
  assert.equal(post.description, '主文');
});

test('drafts posted with the old 🧵 label are still read', () => {
  const old = { footer: { text: 'post' }, description: '主文', fields: [{ name: '🧵 Threads', value: '✅ 已發布' }] };
  const draft = readDraft({ embeds: [old], attachments: new Map() });
  assert.equal(draft.status.threads, '✅ 已發布');
});

test('placeholders that need a manual check are detected', () => {
  assert.deepEqual(findPlaceholders('日期（待補）\n成員名待確認'), ['待確認', '待補']);
  assert.deepEqual(findPlaceholders('正常內文'), []);
});

test('checkPosts aggregates', () => {
  assert.equal(checkPosts('').length, 2);
  assert.equal(checkPosts('中'.repeat(600)).length, 0);
  assert.equal(checkPosts('中'.repeat(2300)).length, 1);
});

/** Mock Meta: record every POST, answer container status checks with FINISHED. */
function mockMeta(statusField) {
  const posts = [];
  let n = 0;
  mock.method(globalThis, 'fetch', async (url, init = {}) => {
    const u = new URL(url);
    if (init.body) {
      const params = Object.fromEntries(new URLSearchParams(init.body));
      posts.push([u.pathname, params]);
      return jsonResponse({ id: /publish$/.test(u.pathname) ? 'post1' : `c${++n}` });
    }
    if (u.searchParams.get('fields') === 'permalink') return jsonResponse({ permalink: 'https://p/1' });
    return jsonResponse({ [statusField]: 'FINISHED' });
  });
  return posts;
}

test('Threads posts a single video and mixes video into carousels', async () => {
  let posts = mockMeta('status');
  await publishThreads({ text: 'hi', media: [vid('https://v')] }, { userId: 'U', token: 'T' });
  assert.deepEqual(posts[0][1], { media_type: 'VIDEO', video_url: 'https://v', text: 'hi', access_token: 'T' });

  mock.restoreAll();
  posts = mockMeta('status');
  await publishThreads({ text: 'hi', media: [img('https://a'), vid('https://v')] }, { userId: 'U', token: 'T' });
  assert.equal(posts[0][1].media_type, 'IMAGE');
  assert.deepEqual([posts[1][1].media_type, posts[1][1].video_url, posts[1][1].is_carousel_item], ['VIDEO', 'https://v', 'true']);
  assert.equal(posts[2][1].media_type, 'CAROUSEL');
});

test('Instagram posts a single video as a Reel and video carousel items as VIDEO', async () => {
  let posts = mockMeta('status_code');
  await publishInstagram({ text: 'hi', media: [vid('https://v')] }, { userId: 'U', token: 'T' });
  const reel = posts.find(([path]) => path.endsWith('/media'))[1];
  assert.deepEqual([reel.media_type, reel.video_url, reel.caption], ['REELS', 'https://v', 'hi']);

  mock.restoreAll();
  posts = mockMeta('status_code');
  await publishInstagram({ text: 'hi', media: [vid('https://v'), img('https://a')] }, { userId: 'U', token: 'T' });
  const [video, image, carousel] = posts.filter(([path]) => path.endsWith('/media')).map(([, p]) => p);
  assert.deepEqual([video.media_type, video.video_url, video.is_carousel_item], ['VIDEO', 'https://v', 'true']);
  assert.deepEqual([image.media_type, image.image_url], [undefined, 'https://a']);
  assert.equal(carousel.children, 'c1,c2');
});

test('Instagram surfaces why Meta could not process a video', async () => {
  mock.method(globalThis, 'fetch', async (url, init = {}) => {
    if (init.body) return jsonResponse({ id: 'c1' });
    return jsonResponse({ status_code: 'ERROR', status: 'ERROR: video codec not supported' });
  });
  await assert.rejects(
    publishInstagram({ text: 'hi', media: [vid('https://v')] }, { userId: 'U', token: 'T' }),
    /媒體處理失敗：ERROR: video codec not supported/,
  );
});

test('videos left on the original message round-trip through the draft', () => {
  const videoRefs = [{ pos: 1, name: 'clip（1）.mp4', id: '123' }, { pos: 3, name: 'b.mov', id: '456' }];
  const payload = buildReviewPayload(posts, { sourceUrl: 'https://src', inputMessageUrl: 'u', submittedBy: 's', videoRefs });
  const d = readDraft({ embeds: payload.embeds.map((e) => e.toJSON()), attachments: new Map() });
  assert.deepEqual(d.videoRefs, videoRefs);
  assert.deepEqual(readDraft({ embeds: buildReviewPayload(posts, { inputMessageUrl: 'u', submittedBy: 's' }).embeds.map((e) => e.toJSON()), attachments: new Map() }).videoRefs, []);
  const archived = buildArchivePayload({ ...d, status: { threads: '✅', instagram: '✅' } }).embeds[0].toJSON();
  assert.ok(archived.fields.some((f) => f.name === '🎬 影片'));
});
