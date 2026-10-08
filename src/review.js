import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { LIMITS, PLATFORMS, PLATFORM_LABELS, checkPost, measure, threadParts } from './limits.js';

/**
 * The review message is the single source of truth for a draft: one embed holds
 * the post (shared by every platform) plus a status field per platform, so the
 * bot needs no database and survives restarts.
 */

export const REACTIONS = {
  '✅': ['threads', 'instagram'],
  '🧵': ['threads'],
  '📷': ['instagram'],
};
export const DISCARD_REACTION = '❌';
export const REACTION_ORDER = ['✅', '🧵', '📷', '❌'];

const COLORS = { post: 0x101010, meta: 0x5865f2 };
const PENDING = '🕓 待審核';

const POST_TAG = 'post';

export function postEmbed(text, status = {}) {
  const counts = PLATFORMS.map((p) => {
    const parts = p === 'threads' ? threadParts(text) : [];
    if (parts.length > 1) return `${PLATFORM_LABELS[p]} 主文＋${parts.length - 1} 則回覆`;
    const over = checkPost(p, text).length > 0;
    return `${PLATFORM_LABELS[p]} ${over ? '⚠️ ' : ''}${measure(p, text)}/${LIMITS[p]}`;
  });
  return new EmbedBuilder()
    .setColor(COLORS.post)
    .setTitle(`貼文　${counts.join('　')}`)
    .setDescription(text || '（空白）')
    .addFields(PLATFORMS.map((p) => ({ name: PLATFORM_LABELS[p], value: status[p] || PENDING, inline: true })))
    .setFooter({ text: POST_TAG });
}

export function metaEmbed({ summary, notes, warnings, sourceUrl, inputMessageUrl, submittedBy }) {
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
  if (notes) e.addFields({ name: '🔎 請確認', value: notes.slice(0, 1024) });
  if (warnings?.length) e.addFields({ name: '⚠️ 字數問題', value: warnings.join('\n').slice(0, 1024) });
  e.addFields({
    name: '操作方式',
    value: '✅ 全部發布　🧵 只發 Threads　📷 只發 IG　❌ 捨棄\n要修改文字請按下方「編輯」。',
  });
  return e;
}

export function draftButtons(disabled = false) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('draft:edit').setLabel('編輯').setEmoji('✏️').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
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

/** Read a draft back out of a review message. */
export function readDraft(message) {
  const draft = { text: '', status: {}, meta: null, images: [] };
  for (const embed of message.embeds) {
    const tag = embed.footer?.text || '';
    if (tag === 'meta') {
      draft.meta = embed;
      const field = (n) => embed.fields.find((f) => f.name === n)?.value;
      draft.sourceUrl = field('原文連結');
      draft.inputMessageUrl = field('原始訊息');
      continue;
    }
    if (tag !== POST_TAG) continue;
    const desc = embed.description || '';
    draft.text = desc === '（空白）' ? '' : desc;
    for (const p of PLATFORMS) {
      draft.status[p] = embed.fields.find((f) => f.name === PLATFORM_LABELS[p])?.value || PENDING;
    }
  }
  draft.images = [...message.attachments.values()]
    .filter((a) => (a.contentType || '').startsWith('image/'))
    .map((a) => a.url);
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
