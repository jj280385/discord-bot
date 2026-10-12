import { graphRequest, waitUntilReady, waitOptions } from './graph.js';
import { threadParts } from '../limits.js';

const HOST = 'https://graph.threads.net/v1.0';

/**
 * The comment section and any text over 500 characters continue as a chain of
 * replies under the first post.
 */
export async function publishThreads({ text, media }, { userId, token }) {
  const [first, ...rest] = threadParts(text);
  const base = `${HOST}/${userId}`;
  const create = (params) => graphRequest('POST', `${base}/threads`, { ...params, access_token: token });
  const ready = (id, wait) =>
    waitUntilReady(async () => {
      const r = await graphRequest('GET', `${HOST}/${id}`, { fields: 'status,error_message', access_token: token });
      if (r.status === 'ERROR' && r.error_message) throw new Error(r.error_message);
      return r.status;
    }, wait);
  const item = (m) => (m.type === 'video' ? { media_type: 'VIDEO', video_url: m.url } : { media_type: 'IMAGE', image_url: m.url });
  const wait = waitOptions(media);

  let creationId;
  if (media.length === 0) {
    ({ id: creationId } = await create({ media_type: 'TEXT', text: first }));
  } else if (media.length === 1) {
    ({ id: creationId } = await create({ ...item(media[0]), text: first }));
  } else {
    const children = [];
    for (const m of media.slice(0, 20)) {
      const { id } = await create({ ...item(m), is_carousel_item: 'true' });
      children.push(id);
    }
    await Promise.all(children.map((id) => ready(id, wait)));
    ({ id: creationId } = await create({ media_type: 'CAROUSEL', children: children.join(','), text: first }));
  }

  const publish = async (creation, w) => {
    await ready(creation, w);
    const { id } = await graphRequest('POST', `${base}/threads_publish`, { creation_id: creation, access_token: token });
    return id;
  };

  const id = await publish(creationId, wait);
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
