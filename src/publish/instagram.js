import { graphRequest, waitUntilReady } from './graph.js';

// Instagram API with Instagram Login (no Facebook Page required).
const HOST = 'https://graph.instagram.com/v23.0';

export async function publishInstagram({ text, imageUrls }, { userId, token }) {
  if (imageUrls.length === 0) {
    throw new Error('Instagram 不能發純文字貼文，至少需要一張圖片');
  }
  const base = `${HOST}/${userId}`;
  const create = (params) => graphRequest('POST', `${base}/media`, { ...params, access_token: token });
  const ready = (id) =>
    waitUntilReady(async () => {
      const r = await graphRequest('GET', `${HOST}/${id}`, { fields: 'status_code', access_token: token });
      return r.status_code;
    });

  let creationId;
  if (imageUrls.length === 1) {
    ({ id: creationId } = await create({ image_url: imageUrls[0], caption: text }));
  } else {
    const children = [];
    for (const url of imageUrls.slice(0, 10)) {
      const { id } = await create({ image_url: url, is_carousel_item: 'true' });
      children.push(id);
    }
    await Promise.all(children.map(ready));
    ({ id: creationId } = await create({ media_type: 'CAROUSEL', children: children.join(','), caption: text }));
  }

  await ready(creationId);
  const { id } = await graphRequest('POST', `${base}/media_publish`, { creation_id: creationId, access_token: token });
  const { permalink } = await graphRequest('GET', `${HOST}/${id}`, { fields: 'permalink', access_token: token }).catch(() => ({}));
  return { id, url: permalink || null };
}

export async function refreshInstagramToken(token) {
  return graphRequest('GET', 'https://graph.instagram.com/refresh_access_token', {
    grant_type: 'ig_refresh_token',
    access_token: token,
  });
}
