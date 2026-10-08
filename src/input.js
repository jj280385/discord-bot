const URL_RE = /https?:\/\/[^\s<>]+/gi;
const TRAILING_PUNCT = /[)\]>.,，。!！?？'"」』]+$/;

/**
 * Split a submitted message into the source link(s) and the original article text.
 * The first URL is treated as the source post; the rest are kept as extra references.
 */
export function parseInput(content = '') {
  const rawUrls = content.match(URL_RE) || [];
  const urls = rawUrls.map((u) => u.replace(TRAILING_PUNCT, ''));

  let text = content;
  for (const u of urls) text = text.split(u).join('');
  text = text
    .replace(/<\s*>/g, '') // leftovers from <https://...> link suppression
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return {
    sourceUrl: urls[0] ?? null,
    extraUrls: [...new Set(urls.slice(1))],
    text,
  };
}

const IMAGE_TYPES = /^image\/(jpeg|png|webp|gif|heic|heif)/i;

export function isImageAttachment(att) {
  if (att.contentType) return IMAGE_TYPES.test(att.contentType);
  return /\.(jpe?g|png|webp|gif|heic|heif)$/i.test(att.name || '');
}

/** Discord turns long pastes into a "message.txt" attachment. */
export function isTextAttachment(att) {
  if (att.contentType) return att.contentType.startsWith('text/plain');
  return /\.txt$/i.test(att.name || '');
}
