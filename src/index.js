import {
  ActionRowBuilder,
  AttachmentBuilder,
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  ModalBuilder,
  Partials,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { loadConfig, loadStyle } from './config.js';
import { parseInput, isImageAttachment, isTextAttachment } from './input.js';
import { generatePosts } from './ai.js';
import { toJpeg, igAspectWarning, download } from './media.js';
import { PLATFORMS, checkPost, checkPosts, findPlaceholders } from './limits.js';
import {
  REACTIONS,
  DISCARD_REACTION,
  ARCHIVE_REACTION,
  REACTION_ORDER,
  buildReviewPayload,
  buildArchivePayload,
  readDraft,
  updateEmbeds,
  replaceMeta,
  metaEmbed,
  draftButtons,
  isPublished,
  isDiscarded,
} from './review.js';
import { publishTo } from './publish/index.js';
import { initTokens, refreshTokens } from './tokens.js';

const cfg = loadConfig();
initTokens(cfg.root);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ],
  // Partials let the bot react to emoji on drafts posted before a restart.
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

const MAX_IMAGES = 10;
const busy = new Set();

class UserError extends Error {}

// ---------- Draft creation ----------

async function buildDraft(inputMessage) {
  const parsed = parseInput(inputMessage.content);
  const attachments = [...inputMessage.attachments.values()];

  let text = parsed.text;
  for (const att of attachments.filter(isTextAttachment)) {
    text += `\n${(await download(att.url)).toString('utf8')}`;
  }
  text = text.trim();

  const imageAtts = attachments.filter(isImageAttachment);
  const images = [];
  for (const att of imageAtts.slice(0, MAX_IMAGES)) {
    images.push(await toJpeg(await download(att.url)));
  }

  if (!text && images.length === 0) {
    throw new UserError('請貼上韓文原文和原文連結（也可以附上圖片）。');
  }

  const { format, glossary } = loadStyle(cfg.root);
  const posts = await generatePosts(
    { ...parsed, text, images: images.map((i) => ({ data: i.data, mediaType: 'image/jpeg' })) },
    { apiKey: cfg.anthropicKey, model: cfg.model, format, glossary },
  );

  const imageWarnings = images.map(igAspectWarning).filter(Boolean);
  if (imageAtts.length > MAX_IMAGES) imageWarnings.push(`只保留前 ${MAX_IMAGES} 張圖片`);
  if (images.length === 0) imageWarnings.push('沒有圖片：Instagram 無法發布純文字貼文');
  // Markers the submitter typed (「待確認」…) must survive translation so the draft stays blocked.
  const typed = findPlaceholders(text).filter((w) => !posts.post.includes(w));
  if (typed.length) posts.post = `【${typed.join('、')}：提交者標記，請確認後刪除這行】\n${posts.post}`;
  const placeholders = findPlaceholders(posts.post);
  if (placeholders.length) imageWarnings.push(`內文有「${placeholders.join('、')}」，需要人工確認，改掉之前不會發布或搬到已發文`);
  posts.warnings = [...posts.warnings, ...imageWarnings];

  return { posts, parsed, images };
}

async function handleInput(message) {
  await message.react('⏳').catch(() => {});
  try {
    const { posts, parsed, images } = await buildDraft(message);
    const reviewChannel = await client.channels.fetch(cfg.reviewChannelId);
    const files = images.map((img, i) => new AttachmentBuilder(img.data, { name: `image-${i + 1}.jpg` }));
    const review = await reviewChannel.send(
      buildReviewPayload(
        posts,
        { sourceUrl: parsed.sourceUrl, inputMessageUrl: message.url, submittedBy: `<@${message.author.id}>` },
        files,
      ),
    );
    for (const emoji of REACTION_ORDER) {
      if (emoji === ARCHIVE_REACTION && !cfg.publishedChannelId) continue;
      await review.react(emoji);
    }
    await message.reactions.cache.get('⏳')?.users.remove(client.user.id).catch(() => {});
    await message.react('✅').catch(() => {});
    await message.reply({ content: `草稿已送到待發文區：${review.url}`, allowedMentions: { repliedUser: false } });
  } catch (err) {
    console.error('[draft]', err);
    await message.reactions.cache.get('⏳')?.users.remove(client.user.id).catch(() => {});
    await message.react('⚠️').catch(() => {});
    const msg = err instanceof UserError ? err.message : `產生草稿失敗：${err.message}`;
    await message.reply({ content: msg, allowedMentions: { repliedUser: false } }).catch(() => {});
  }
}

// ---------- Review & publishing ----------

async function isReviewer(guild, userId) {
  if (cfg.reviewerRoleIds.length === 0) return true;
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return false;
  return (
    member.permissions.has(PermissionFlagsBits.Administrator) ||
    member.roles.cache.some((r) => cfg.reviewerRoleIds.includes(r.id))
  );
}

const isDraftMessage = (m) => m.channelId === cfg.reviewChannelId && m.author?.id === client.user.id;
const stamp = (userId) => `by <@${userId}> · <t:${Math.floor(Date.now() / 1000)}:f>`;

async function handlePublish(message, platforms, userId) {
  if (busy.has(message.id)) return;
  busy.add(message.id);
  try {
    const draft = readDraft(message);
    if (isDiscarded(draft)) return;
    if (await blockIfPlaceholders(message, draft, userId)) return;
    const todo = platforms.filter((p) => !isPublished(draft.status[p]));
    if (todo.length === 0) {
      // Drafts published before the published channel was set up: re-pressing
      // the emoji moves them over without posting anything again.
      if (cfg.publishedChannelId && PLATFORMS.every((p) => isPublished(draft.status[p]))) await archiveDraft(message);
      return;
    }

    const status = {};
    const ready = [];
    for (const p of todo) {
      const problems = checkPost(p, draft.text);
      if (problems.length) status[p] = `⚠️ 未發布：${problems.join('；')}（請先按「編輯」修改）`;
      else {
        status[p] = '⏳ 發布中…';
        ready.push(p);
      }
    }
    await message.edit({ embeds: updateEmbeds(message, { status }) });

    const results = await Promise.allSettled(
      ready.map((p) => publishTo(p, { text: draft.text, imageUrls: draft.images }, cfg)),
    );
    const summary = [];
    results.forEach((r, i) => {
      const p = ready[i];
      if (r.status === 'fulfilled') {
        const link = r.value.url ? ` · [查看貼文](${r.value.url})` : cfg.dryRun ? '（DRY_RUN 測試模式）' : '';
        const warning = r.value.warning ? `\n⚠️ ${r.value.warning.slice(0, 600)}` : '';
        status[p] = `✅ 已發布${link} ${stamp(userId)}${warning}`;
        summary.push(`✅ ${p}${r.value.url ? ` ${r.value.url}` : ''}${warning}`);
      } else {
        console.error(`[publish:${p}]`, r.reason);
        status[p] = `❌ 失敗：${String(r.reason?.message || r.reason).slice(0, 700)}\n（移除再重按 emoji 可重試）`;
        summary.push(`❌ ${p}：${r.reason?.message || r.reason}`);
      }
    });

    const fresh = await message.fetch();
    const after = readDraft({ embeds: updateEmbeds(fresh, { status }).map((e) => e.toJSON()), attachments: new Map() });
    const allDone = PLATFORMS.every((p) => isPublished(after.status[p]));
    const edited = await fresh.edit({ embeds: updateEmbeds(fresh, { status }), components: draftButtons(allDone, { allowEdit: true }) });
    if (allDone && cfg.publishedChannelId) {
      try {
        await archiveDraft(edited);
        return;
      } catch (err) {
        console.error('[archive]', err);
        summary.push(`⚠️ 無法整理到已發文頻道：${err.message}（草稿先保留在這裡）`);
      }
    }
    if (summary.length) {
      await fresh.reply({ content: `<@${userId}> 發布結果：\n${summary.join('\n')}`, allowedMentions: { users: [userId] } });
    }
  } finally {
    busy.delete(message.id);
  }
}

/**
 * Move a fully published draft to the published channel: the record (results,
 * post text, images), then the original submission. Afterwards the draft, the
 * original message and the bot's replies to it are deleted so only unfinished
 * work stays in the input and review channels.
 */
async function archiveDraft(message) {
  const draft = readDraft(message);
  const files = [];
  for (const [i, url] of draft.images.entries()) {
    files.push(new AttachmentBuilder(await download(url), { name: `image-${i + 1}.jpg` }));
  }
  const input = await fetchInputMessage(draft.inputMessageUrl).catch(() => null);

  const channel = await client.channels.fetch(cfg.publishedChannelId);
  const record = await channel.send(buildArchivePayload(draft, files));
  if (input) await record.reply(await originalPayload(input));

  await deleteWithReplies(message);
  if (input) await deleteWithReplies(input).catch((err) => console.error('[archive:input]', err));
}

/** The original submission as searchable text; long originals also go in a .txt file. */
async function originalPayload(input) {
  let text = input.content;
  for (const att of [...input.attachments.values()].filter(isTextAttachment)) {
    text += `\n${(await download(att.url)).toString('utf8')}`;
  }
  text = text.trim() || '（只有圖片）';
  const header = `📄 原文（<@${input.author.id}> 提交於 <t:${Math.floor(input.createdTimestamp / 1000)}:f>）\n`;
  const fits = [...header + text].length <= 2000;
  return {
    content: fits ? header + text : `${header}${[...text].slice(0, 1500).join('')}…\n（全文見附檔）`,
    files: fits ? [] : [new AttachmentBuilder(Buffer.from(text, 'utf8'), { name: '原文.txt' })],
    allowedMentions: { parse: [] },
  };
}

/** Delete a message together with the bot's replies to it (e.g. earlier publish results). */
async function deleteWithReplies(message) {
  const later = await message.channel.messages.fetch({ after: message.id, limit: 100 });
  const replies = later.filter((m) => m.author.id === client.user.id && m.reference?.messageId === message.id);
  for (const m of replies.values()) await m.delete().catch(() => {});
  await message.delete();
}

/**
 * Drafts still containing placeholders like 「待確認」 are neither published nor
 * archived; the reviewer is told to check them by hand instead.
 */
async function blockIfPlaceholders(message, draft, userId) {
  const words = findPlaceholders(draft.text);
  if (words.length === 0) return false;
  const allDone = PLATFORMS.every((p) => isPublished(draft.status[p]));
  await message.edit({ components: draftButtons(allDone, { allowEdit: true }) }).catch(() => {});
  await message.reply({
    content: `<@${userId}> 貼文裡還有「${words.join('、')}」，需要人工確認。請按「✏️ 編輯」修改後再按一次 emoji（這次沒有發布，也沒有搬到已發文）。`,
    allowedMentions: { users: [userId] },
  });
  return true;
}

/** 📦: move the draft to the published channel without posting the remaining platforms. */
async function handleArchiveOnly(message, userId) {
  if (busy.has(message.id)) return;
  busy.add(message.id);
  try {
    const draft = readDraft(message);
    if (await blockIfPlaceholders(message, draft, userId)) return;
    const status = {};
    for (const p of PLATFORMS) {
      if (!isPublished(draft.status[p])) status[p] = `📦 未發布（只搬到已發文）${stamp(userId)}`;
    }
    const edited = await message.edit({ embeds: updateEmbeds(message, { status }) });
    await archiveDraft(edited);
  } catch (err) {
    console.error('[archive]', err);
    await message.reply({ content: `<@${userId}> 無法搬到已發文頻道：${err.message}`, allowedMentions: { users: [userId] } }).catch(() => {});
  } finally {
    busy.delete(message.id);
  }
}

async function handleDiscard(message, userId) {
  const draft = readDraft(message);
  const status = {};
  for (const p of PLATFORMS) if (!isPublished(draft.status[p])) status[p] = `🗑️ 已捨棄 ${stamp(userId)}`;
  await message.edit({ embeds: updateEmbeds(message, { status }), components: draftButtons(true) });
}

client.on(Events.MessageReactionAdd, async (reaction, user) => {
  if (user.bot) return;
  try {
    if (reaction.partial) await reaction.fetch();
    const message = reaction.message.partial ? await reaction.message.fetch() : reaction.message;
    if (!isDraftMessage(message)) return;

    const emoji = reaction.emoji.name;
    if (!REACTIONS[emoji] && emoji !== DISCARD_REACTION && emoji !== ARCHIVE_REACTION) return;
    if (emoji === ARCHIVE_REACTION && !cfg.publishedChannelId) return;
    if (!(await isReviewer(message.guild, user.id))) {
      await reaction.users.remove(user.id).catch(() => {});
      return;
    }
    if (emoji === DISCARD_REACTION) await handleDiscard(message, user.id);
    else if (emoji === ARCHIVE_REACTION) await handleArchiveOnly(message, user.id);
    else await handlePublish(message, REACTIONS[emoji], user.id);
  } catch (err) {
    console.error('[reaction]', err);
  }
});

// ---------- Buttons & modal (edit / regenerate) ----------

async function fetchInputMessage(url) {
  const m = url?.match(/channels\/(\d+)\/(\d+)\/(\d+)/);
  if (!m) throw new UserError('找不到原始訊息連結');
  const channel = await client.channels.fetch(m[2]);
  return channel.messages.fetch(m[3]);
}

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isButton() && interaction.customId.startsWith('draft:')) {
      if (!(await isReviewer(interaction.guild, interaction.user.id))) {
        return interaction.reply({ content: '只有審稿人可以操作。', flags: MessageFlags.Ephemeral });
      }
      const message = interaction.message;
      const draft = readDraft(message);

      if (interaction.customId === 'draft:edit') {
        const modal = new ModalBuilder().setCustomId(`edit:${message.id}`).setTitle('編輯貼文');
        const input = new TextInputBuilder()
          .setCustomId('post')
          .setLabel('貼文（IG 上限 2200 字，Threads 會自動串文）')
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(4000)
          .setRequired(true);
        if (draft.text) input.setValue(draft.text);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        return interaction.showModal(modal);
      }

      if (interaction.customId === 'draft:regen') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const input = await fetchInputMessage(draft.inputMessageUrl);
        const { posts, parsed } = await buildDraft(input);
        const text = PLATFORMS.every((p) => isPublished(draft.status[p])) ? undefined : posts.post;
        const submittedBy = draft.meta.fields.find((f) => f.name === '提交者')?.value || '—';
        const meta = metaEmbed({ ...posts, sourceUrl: parsed.sourceUrl, inputMessageUrl: input.url, submittedBy });
        await message.edit({ embeds: replaceMeta(updateEmbeds(message, { text }), meta) });
        return interaction.editReply('已重新生成（已發布的平台不會變動）。');
      }
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('edit:')) {
      const channel = await client.channels.fetch(cfg.reviewChannelId);
      const message = await channel.messages.fetch(interaction.customId.slice(5));
      const draft = readDraft(message);
      const text = interaction.fields.getTextInputValue('post').trim();
      // Clear "⚠️ 未發布" / "❌ 失敗" notes once the text is edited.
      const status = Object.fromEntries(
        PLATFORMS
          .filter((p) => !isPublished(draft.status[p]) && !draft.status[p].startsWith('🗑️'))
          .map((p) => [p, `🕓 待審核（${interaction.user.username} 已編輯）`]),
      );
      await message.edit({ embeds: updateEmbeds(message, { text, status }) });
      const problems = checkPosts(text);
      return interaction.reply({
        content: problems.length ? `已儲存，但還有問題：\n${problems.join('\n')}` : '已儲存修改 ✅',
        flags: MessageFlags.Ephemeral,
      });
    }
  } catch (err) {
    console.error('[interaction]', err);
    const content = err instanceof UserError ? err.message : `發生錯誤：${err.message}`;
    if (interaction.deferred || interaction.replied) await interaction.editReply(content).catch(() => {});
    else await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
  }
});

// ---------- Input channel ----------

client.on(Events.MessageCreate, (message) => {
  if (message.author.bot || message.channelId !== cfg.inputChannelId) return;
  handleInput(message);
});

client.once(Events.ClientReady, async (c) => {
  console.log(`已登入：${c.user.tag}${cfg.dryRun ? '（DRY_RUN 測試模式，不會真的發文）' : ''}`);
  console.log(`已啟用平台：${PLATFORMS.filter((p) => cfg.enabled[p]).join(', ') || '（無）'}`);
  await refreshTokens(cfg, console);
  setInterval(() => refreshTokens(cfg, console), 3 * 24 * 60 * 60 * 1000);
});

client.login(cfg.discordToken);
