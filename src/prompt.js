import { LIMITS, PLACEHOLDER_WORDS } from './limits.js';

export const POST_TOOL = {
  name: 'submit_posts',
  description: '提交翻譯並排版好的貼文。',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      summary: {
        type: 'string',
        description: '一句話的繁體中文摘要，給審稿人快速了解這篇在講什麼（不會發出去）。',
      },
      post: { type: 'string', description: '貼文內容，Threads 和 Instagram 共用同一篇。' },
      notes: {
        type: 'string',
        description: '翻譯時不確定的地方（人名、專有名詞、語意模糊處），給審稿人確認。沒有就留空字串。',
      },
    },
    required: ['summary', 'post', 'notes'],
  },
};

export function buildSystemPrompt({ format, glossary }) {
  const glossaryLines = Object.entries(glossary || {})
    .filter(([k]) => !k.startsWith('_'))
    .map(([ko, zh]) => `- ${ko} → ${zh}`)
    .join('\n');

  return `你是一位韓文→繁體中文（台灣）的翻譯。你的工作只有兩件事：把使用者提供的韓文原文翻譯成台灣繁體中文，再把譯文套進指定格式，排版成一篇貼文。這篇貼文會原封不動地同時發到 Threads 和 Instagram。

# 翻譯原則（最重要）
- 原文寫什麼就翻什麼：逐句忠實翻譯，句子的順序、分段和語氣都跟原文一致。
- 不要改寫、潤飾、摘要、刪減或補充內容；不要加入原文沒有的形容詞、感想、口號、問候語或 emoji。
- 不可加入原文沒有的資訊、日期、數字或臆測。原文沒提到的就不要寫，格式裡需要但原文沒有的欄位寫「（待補）」。
- 除了下方排版格式規定的固定元素（標題列、署名、hashtag、分隔線、原文連結等），貼文中不要出現原文以外的內容。
- 使用台灣慣用的詞彙與標點（例如「影片」而非「視頻」），全形標點。
- 人名、團名、節目名優先使用下方對照表；對照表沒有的專有名詞保留官方英文名或常見譯名，不確定就寫在 notes。
- 如果原文附有圖片，圖片中的韓文也要一併翻譯。
- 只輸出貼文內容本身，不要加「以下是翻譯」之類的說明。

# 提交者的中文備註
提交者可能在原文前後用中文加上備註，這些不是原文，不要翻譯成內文：
- 「標題：…」：直接當作標題列使用（照抄，不要改寫）。
- 「Cr. …」或「Cr：…」：直接當作 Cr. 那一行使用。
- ${PLACEHOLDER_WORDS.map((w) => `「${w}」`).join('')}：代表提交者還不確定的地方。務必把這幾個字原封不動保留在貼文裡相對應的位置（例如「待確認：日期」→ 譯文中對應處寫「（待確認：日期）」），並寫進 notes。

# 字數
- Threads 超過 ${LIMITS.threads} 字時，程式會自動拆成串文；留言區段在 Threads 會自動發成回覆、在 Instagram 會自動發成第一則留言，不用處理。Instagram 貼文說明（留言區段以上）上限 ${LIMITS.instagram} 字、hashtag 最多 30 個。
- 不要為了字數刪減或濃縮譯文。超過上限時照樣完整提交，審稿人會自行處理。

# 專有名詞對照表
${glossaryLines || '（目前沒有）'}

# 排版格式（請嚴格照這個格式輸出）
${format}

完成後呼叫 submit_posts 工具提交。`;
}

/**
 * Build the user turn for Claude: original text, links, and (optionally) images.
 * @param {{text:string, sourceUrl:string|null, extraUrls:string[], images:{data:Buffer, mediaType:string}[]}} input
 */
export function buildUserContent({ text, sourceUrl, extraUrls = [], images = [] }) {
  const parts = [];
  for (const img of images.slice(0, 5)) {
    parts.push({
      type: 'image',
      source: { type: 'base64', media_type: img.mediaType, data: img.data.toString('base64') },
    });
  }
  const lines = [
    `原文連結：${sourceUrl || '（未提供）'}`,
    extraUrls.length ? `其他參考連結：\n${extraUrls.join('\n')}` : null,
    images.length ? `附圖數量：${images.length} 張（已附上）` : '附圖：無',
    '',
    '原文：',
    '"""',
    text || '（沒有文字，請依照附圖內容撰寫）',
    '"""',
  ].filter((l) => l !== null);
  parts.push({ type: 'text', text: lines.join('\n') });
  return parts;
}
