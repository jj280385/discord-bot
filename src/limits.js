export const PLATFORMS = ['threads', 'instagram'];

export const PLATFORM_LABELS = {
  threads: '💬 Threads',
  instagram: '📷 Instagram',
};

// Labels used before the emoji change; drafts posted earlier still carry them.
export const LEGACY_LABELS = {
  threads: '🧵 Threads',
};

// Character limits per platform.
export const LIMITS = {
  threads: 500,
  instagram: 2200,
};

const IG_MAX_HASHTAGS = 30;

export function measure(platform, text = '') {
  return [...text].length;
}

export function countHashtags(text = '') {
  return (text.match(/#[^\s#]+/g) || []).length;
}

/**
 * Split a long Threads post into chunks of at most `limit` characters, breaking
 * at paragraphs first, then lines, then sentences, and only cutting mid-sentence
 * as a last resort. The first chunk is the post; the rest are posted as replies.
 */
export function splitThreadText(text = '', limit = LIMITS.threads) {
  const chunks = [];
  let cur = '';
  const push = () => {
    if (cur.trim()) chunks.push(cur.trim());
    cur = '';
  };
  const add = (piece, sep) => {
    const next = cur ? cur + sep + piece : piece;
    if ([...next].length > limit) return false;
    cur = next;
    return true;
  };
  for (const para of text.split(/\n{2,}/)) {
    if (add(para, '\n\n')) continue;
    push();
    for (const line of para.split('\n')) {
      if (add(line, '\n')) continue;
      push();
      for (const sentence of line.match(/[^。！？!?]+[。！？!?]*/g) || [line]) {
        if (add(sentence, '')) continue;
        push();
        let rest = [...sentence];
        while (rest.length > limit) {
          chunks.push(rest.slice(0, limit).join(''));
          rest = rest.slice(limit);
        }
        cur = rest.join('');
      }
    }
  }
  push();
  return chunks;
}

// The "— 留言區 —" line from config/format.md marks where the comment section starts.
const COMMENT_MARKER = /^[ \t]*[—–-]+[ \t]*留言區[ \t]*[—–-]+[ \t]*$/m;

/** Split a post at the comment marker. The marker line itself is dropped. */
export function splitComment(text = '') {
  const m = text.match(COMMENT_MARKER);
  if (!m) return { main: text.trim(), comment: '' };
  return { main: text.slice(0, m.index).trim(), comment: text.slice(m.index + m[0].length).trim() };
}

/**
 * Threads posts in order: the main text (split if over the limit), then the
 * comment section as replies.
 */
export function threadParts(text = '') {
  const { main, comment } = splitComment(text);
  const mainParts = splitThreadText(main);
  const comments = splitThreadText(comment);
  return mainParts.length ? [...mainParts, ...comments] : comments;
}

/** Instagram: the caption, plus the comment section posted as the first comment. */
export function instagramParts(text = '') {
  const { main, comment } = splitComment(text);
  return main ? { caption: main, comment } : { caption: comment, comment: '' };
}

// Words that mean a person still has to check something before it goes out.
export const PLACEHOLDER_WORDS = ['待確認', '確認中', '待審查', '待補', '待查'];

/** Placeholder words found in the post (empty if none). */
export function findPlaceholders(text = '') {
  return PLACEHOLDER_WORDS.filter((w) => text.includes(w));
}

/** Returns a list of human-readable problems (empty if all good). */
export function checkPost(platform, text = '') {
  const problems = [];
  if (!text.trim()) problems.push(`${platform}: 內容是空的`);
  // Long Threads posts are split into a reply chain, so only IG has a hard limit.
  if (platform === 'instagram') {
    const { caption, comment } = instagramParts(text);
    const len = measure(platform, caption);
    if (len > LIMITS.instagram) problems.push(`instagram: ${len}/${LIMITS.instagram} 字，超過上限`);
    const commentLen = measure(platform, comment);
    if (commentLen > LIMITS.instagram) problems.push(`instagram 留言: ${commentLen}/${LIMITS.instagram} 字，超過上限`);
    if (countHashtags(caption) > IG_MAX_HASHTAGS) {
      problems.push(`instagram: hashtag 有 ${countHashtags(caption)} 個，上限 ${IG_MAX_HASHTAGS} 個`);
    }
  }
  return problems;
}

/** The same post goes to every platform, so check it against each limit. */
export function checkPosts(text = '') {
  return PLATFORMS.flatMap((p) => checkPost(p, text));
}
