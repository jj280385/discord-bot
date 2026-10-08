export const PLATFORMS = ['threads', 'instagram'];

export const PLATFORM_LABELS = {
  threads: '🧵 Threads',
  instagram: '📷 Instagram',
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

/**
 * Threads posts in order: the main text (split if over the limit), then the
 * comment section as replies. The marker line itself is dropped.
 */
export function threadParts(text = '') {
  const m = text.match(COMMENT_MARKER);
  if (!m) return splitThreadText(text);
  const main = splitThreadText(text.slice(0, m.index));
  const comments = splitThreadText(text.slice(m.index + m[0].length));
  return main.length ? [...main, ...comments] : comments;
}

/** Returns a list of human-readable problems (empty if all good). */
export function checkPost(platform, text = '') {
  const problems = [];
  const len = measure(platform, text);
  if (!text.trim()) problems.push(`${platform}: 內容是空的`);
  // Long Threads posts are split into a reply chain, so only IG has a hard limit.
  if (platform !== 'threads' && len > LIMITS[platform]) {
    problems.push(`${platform}: ${len}/${LIMITS[platform]} 字，超過上限`);
  }
  if (platform === 'instagram' && countHashtags(text) > IG_MAX_HASHTAGS) {
    problems.push(`instagram: hashtag 有 ${countHashtags(text)} 個，上限 ${IG_MAX_HASHTAGS} 個`);
  }
  return problems;
}

/** The same post goes to every platform, so check it against each limit. */
export function checkPosts(text = '') {
  return PLATFORMS.flatMap((p) => checkPost(p, text));
}
