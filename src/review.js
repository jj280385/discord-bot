import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { LIMITS, LEGACY_LABELS, PLATFORMS, PLATFORM_LABELS, checkPost, measure, threadParts, instagramParts } from './limits.js';

/**
 * The review message is the single source of truth for a draft: one embed holds
 * the post (shared by every platform) plus a status field per platform, so the
 * bot needs no database and survives restarts.
 */

export const REACTIONS = {
  '✅': ['threads', 'instagram'],
  '💬': ['threads'],
  '🧵': ['threads'], // drafts posted before the emoji change
  '📷': ['instagram'],
};
export const DISCARD_REACTION = '❌';
export const ARCHIVE_REACTION = '📦';
export const REACTION_ORDER = ['✅', '💬', '📷', '📦', '❌'];

const COLORS = { post: 0x101010, meta: 0x5865f2, done: 0x57f287 };
const PENDING = '🕓 待審核';

const POST_TAG = 'post';

export function postEmbed(text, status = {}) {
  const counts = PLATFORMS.map((p) => {
    const parts = p === 'threads' ? threadParts(text) : [];
    if (parts.length > 1) return `${PLATFORM_LABELS[p]} 主文＋${parts.length - 1} 則回覆`;
    const over = checkPost(p, text).length > 0;
    if (p === 'instagram') {
      const { caption, comment } = instagramParts(text);
      return `${PLATFORM_LABELS[p]} ${over ? '⚠️ ' : ''}${measure(p, caption)}/${LIMITS[p]}${comment ? '＋留言' : ''}`;
    }
    return `${PLATFORM_LABELS[p]} ${over ? '⚠️ ' : ''}${measure(p, text)}/${LIMITS[p]}`;
  });
  return new EmbedBuilder()
    .setColor(COLORS.post)
    .setTitle(`貼文　${counts.join('　')}`)
    .setDescription(text || '（空白）')
    .addFields(PLATFORMS.map((p) => ({ name: PLATFORM_LABELS[p], value: status[p] || PENDING, inline: true })))
    .setFooter({ text: POST_TAG });
}

/**
 * Videos too large for the bot to copy into the draft stay on the original
 * message; this field records where they go in the post and which attachment they are.
 */
const VIDEO_REFS = '🎬 影片在原始訊息';
const VIDEO_REF_RE = /第 (\d+) 個：(.+)（id (\d+)）/g;

export function metaEmbed({ summary, notes, warnings, sourceUrl, inputMessageUrl, submittedBy, videoRefs }) {
  const e = new EmbedBuilder()
    .setColor(COLORS.meta)
    .setTitle('📝 待發文草稿')
    .setDescription(summary || '（無摘要）')
    .addFields(
      { name: '原文連結', value: sourceUrl || '（未提供）', inline: false },
      { name: '原始訊息', value: inputMessageUrl, inline: true },
      { name: '提交者', value: submittedBy, inline: true },
    )
    .setFooter({ text: 'meta' });
  if (videoRefs?.length) {
    const list = videoRefs.map((r) => `第 ${r.pos + 1} 個：${r.name}（id ${r.id}）`).join('\n');
    e.addFields({ name: VIDEO_REFS, value: `超過 Discord 上傳上限，發布時直接用原始訊息裡的影片，**發布前請不要刪掉原始訊息**。\n${list}`.slice(0, 1024) });
  }
  if (notes) e.addFields({ name: '🔎 請確認', value: notes.slice(0, 1024) });
  if (warnings?.length) e.addFields({ name: '⚠️ 字數問題', value: warnings.join('\n').slice(0, 1024) });
  e.addFields({
    name: '操作方式',
    value: '✅ 全部發布　💬 只發 Threads　📷 只發 IG　📦 只搬到已發文、不發布　❌ 捨棄\n要修改文字請按下方「編輯」。',
  });
  return e;
}

/** `allowEdit` keeps 編輯 usable on published drafts, so placeholders can be fixed before archiving. */
export function draftButtons(disabled = false, { allowEdit = false } = {}) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('draft:edit').setLabel('編輯').setEmoji('✏️').setStyle(ButtonStyle.Secondary).setDisabled(disabled && !allowEdit),
      new ButtonBuilder().setCustomId('draft:regen').setLabel('重新生成').setEmoji('🔄').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
    ),
  ];
}

export function buildReviewPayload(posts, meta, files = []) {
  return {
    embeds: [metaEmbed({ ...posts, ...meta }), postEmbed(posts.post)],
    components: draftButtons(),
    files,
  };
}

/** The tidy record posted to the published channel once every platform is done. */
export function buildArchivePayload(draft, files = []) {
  const field = (n) => draft.meta?.fields.find((f) => f.name === n)?.value;
  const record = new EmbedBuilder()
    .setColor(COLORS.done)
    .setTitle('✅ 已發文')
    .setDescription(draft.meta?.description || '（無摘要）')
    .addFields(
      ...PLATFORMS.map((p) => ({ name: PLATFORM_LABELS[p], value: draft.status[p].slice(0, 1024), inline: false })),
      { name: '原文連結', value: field('原文連結') || '（未提供）', inline: false },
      { name: '提交者', value: field('提交者') || '—', inline: true },
    );
  if (draft.videoRefs?.length) record.addFields({ name: '🎬 影片', value: '檔案超過 Discord 上傳上限，這裡沒有保留，請到貼文連結觀看。' });
  const post = new EmbedBuilder().setColor(COLORS.post).setTitle('貼文內容').setDescription(draft.text || '（空白）');
  return { embeds: [record, post], files, allowedMentions: { parse: [] } };
}

/** Read a draft back out of a review message. */
export function readDraft(message) {
  const draft = { text: '', status: {}, meta: null, media: [], videoRefs: [] };
  for (const embed of message.embeds) {
    const tag = embed.footer?.text || '';
    if (tag === 'meta') {
      draft.meta = embed;
      const field = (n) => embed.fields.find((f) => f.name === n)?.value;
      draft.sourceUrl = field('原文連結');
      draft.inputMessageUrl = field('原始訊息');
      draft.videoRefs = [...(field(VIDEO_REFS) || '').matchAll(VIDEO_REF_RE)].map(([, pos, name, id]) => ({ pos: pos - 1, name, id }));
      continue;
    }
    if (tag !== POST_TAG) continue;
    const desc = embed.description || '';
    draft.text = desc === '（空白）' ? '' : desc;
    for (const p of PLATFORMS) {
      const labels = [PLATFORM_LABELS[p], LEGACY_LABELS[p]];
      draft.status[p] = embed.fields.find((f) => labels.includes(f.name))?.value || PENDING;
    }
  }
  // Attachment order is the posting order, with images and videos mixed.
  draft.media = [...message.attachments.values()]
    .map((a) => {
      const type = (a.contentType || '').split('/')[0];
      return type === 'image' || type === 'video' ? { type, url: a.url, name: a.name } : null;
    })
    .filter(Boolean);
  return draft;
}

export const isPublished = (status = '') => status.startsWith('✅');
export const isDiscarded = (draft) => Object.values(draft.status).some((s) => s.startsWith('🗑️'));

/** Return new embeds with the given platform statuses and/or post text replaced. */
export function updateEmbeds(message, { status = {}, text } = {}) {
  return message.embeds.map((embed) => {
    if (embed.footer?.text !== POST_TAG) return EmbedBuilder.from(embed);
    const current = readDraft({ embeds: [embed], attachments: new Map() });
    return postEmbed(text ?? current.text, { ...current.status, ...status });
  });
}

/** Replace the meta embed (used after regenerating). */
export function replaceMeta(embeds, newMeta) {
  return embeds.map((e) => ((e.data?.footer?.text ?? e.footer?.text) === 'meta' ? newMeta : e));
}
