import { graphRequest, waitUntilReady } from './graph.js';
import { instagramParts } from '../limits.js';

// Instagram API with Instagram Login (no Facebook Page required).
const HOST = 'https://graph.instagram.com/v23.0';

/** The comment section is posted as the first comment under the post. */
export async function publishInstagram({ text, imageUrls }, { userId, token }) {
  if (imageUrls.length === 0) {
    throw new Error('Instagram 不能發純文字貼文，至少需要一張圖片');
  }
  const { caption, comment } = instagramParts(text);
  const base = `${HOST}/${userId}`;
  const create = (params) => graphRequest('POST', `${base}/media`, { ...params, access_token: token });
  const ready = (id) =>
    waitUntilReady(async () => {
      const r = await graphRequest('GET', `${HOST}/${id}`, { fields: 'status_code', access_token: token });
      return r.status_code;
    });

  let creationId;
  if (imageUrls.length === 1) {
    ({ id: creationId } = await create({ image_url: imageUrls[0], caption }));
  } else {
    const children = [];
    for (const url of imageUrls.slice(0, 10)) {
      const { id } = await create({ image_url: url, is_carousel_item: 'true' });
      children.push(id);
    }
    await Promise.all(children.map(ready));
    ({ id: creationId } = await create({ media_type: 'CAROUSEL', children: children.join(','), caption }));
  }

  await ready(creationId);
  const { id } = await graphRequest('POST', `${base}/media_publish`, { creation_id: creationId, access_token: token });

  // The post is already live, so a failed comment must not mark the whole
  // publish as failed (a retry would post it twice).
  let warning = null;
  if (comment) {
    try {
      await graphRequest('POST', `${HOST}/${id}/comments`, { message: comment, access_token: token });
    } catch (err) {
      warning = `留言發布失敗：${err.message}（請到 IG 手動補上留言區內容）`;
    }
  }

  const { permalink } = await graphRequest('GET', `${HOST}/${id}`, { fields: 'permalink', access_token: token }).catch(() => ({}));
  return { id, url: permalink || null, warning };
}

export async function refreshInstagramToken(token) {
  return graphRequest('GET', 'https://graph.instagram.com/refresh_access_token', {
    grant_type: 'ig_refresh_token',
    access_token: token,
  });
}
