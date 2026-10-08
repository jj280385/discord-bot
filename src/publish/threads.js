import { graphRequest, waitUntilReady } from './graph.js';
import { threadParts } from '../limits.js';

const HOST = 'https://graph.threads.net/v1.0';

/**
 * The comment section and any text over 500 characters continue as a chain of
 * replies under the first post.
 */
export async function publishThreads({ text, imageUrls }, { userId, token }) {
  const [first, ...rest] = threadParts(text);
  const base = `${HOST}/${userId}`;
  const create = (params) => graphRequest('POST', `${base}/threads`, { ...params, access_token: token });
  const ready = (id) =>
    waitUntilReady(async () => {
      const r = await graphRequest('GET', `${HOST}/${id}`, { fields: 'status,error_message', access_token: token });
      if (r.status === 'ERROR' && r.error_message) throw new Error(r.error_message);
      return r.status;
    });

  let creationId;
  if (imageUrls.length === 0) {
    ({ id: creationId } = await create({ media_type: 'TEXT', text: first }));
  } else if (imageUrls.length === 1) {
    ({ id: creationId } = await create({ media_type: 'IMAGE', image_url: imageUrls[0], text: first }));
  } else {
    const children = [];
    for (const url of imageUrls.slice(0, 20)) {
      const { id } = await create({ media_type: 'IMAGE', image_url: url, is_carousel_item: 'true' });
      children.push(id);
    }
    await Promise.all(children.map(ready));
    ({ id: creationId } = await create({ media_type: 'CAROUSEL', children: children.join(','), text: first }));
  }

  const publish = async (creation) => {
    await ready(creation);
    const { id } = await graphRequest('POST', `${base}/threads_publish`, { creation_id: creation, access_token: token });
    return id;
  };

  const id = await publish(creationId);
  // The main post is already live, so a failed reply must not mark the whole
  // publish as failed (a retry would post the main text twice).
  let warning = null;
  let parentId = id;
  for (const [i, chunk] of rest.entries()) {
    try {
      const { id: replyCreation } = await create({ media_type: 'TEXT', text: chunk, reply_to_id: parentId });
      parentId = await publish(replyCreation);
    } catch (err) {
      warning = `第 ${i + 2}/${rest.length + 1} 則（回覆）發布失敗：${err.message}（請到 Threads 手動補上剩下的內容）`;
      break;
    }
  }

  const { permalink } = await graphRequest('GET', `${HOST}/${id}`, { fields: 'permalink', access_token: token }).catch(() => ({}));
  return { id, url: permalink || null, warning };
}

export async function refreshThreadsToken(token) {
  return graphRequest('GET', 'https://graph.threads.net/refresh_access_token', {
    grant_type: 'th_refresh_token',
    access_token: token,
  });
}
