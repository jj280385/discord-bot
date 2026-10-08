import Anthropic from '@anthropic-ai/sdk';
import { POST_TOOL, buildSystemPrompt, buildUserContent } from './prompt.js';
import { checkPosts } from './limits.js';

const MAX_ATTEMPTS = 3;

/**
 * Translate + format the original article into one post shared by all platforms.
 * Over-limit posts are not shortened by the AI (the translation must stay
 * faithful); the problems are returned as warnings for the reviewer instead.
 */
export async function generatePosts(input, { apiKey, model, format, glossary }) {
  const client = new Anthropic({ apiKey });
  const system = buildSystemPrompt({ format, glossary });
  const messages = [{ role: 'user', content: buildUserContent(input) }];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // Current models reject a forced tool_choice, so the tool is offered with
    // "auto" and the system prompt tells Claude to submit through it.
    const res = await client.messages.create({
      model,
      max_tokens: 16000,
      system,
      tools: [POST_TOOL],
      tool_choice: { type: 'auto' },
      messages,
    });

    if (res.stop_reason === 'refusal') throw new Error('AI 拒絕處理這篇內容');
    if (res.stop_reason === 'max_tokens') throw new Error('AI 回覆太長被截斷，請重新生成');

    const call = res.content.find((b) => b.type === 'tool_use');
    if (call) {
      const posts = {
        summary: String(call.input.summary || '').trim(),
        post: String(call.input.post || '').trim(),
        notes: String(call.input.notes || '').trim(),
      };
      return { ...posts, warnings: checkPosts(posts.post) };
    }

    messages.push({ role: 'assistant', content: res.content });
    messages.push({ role: 'user', content: `請呼叫 ${POST_TOOL.name} 工具提交貼文。` });
  }
  throw new Error('AI 沒有回傳貼文內容');
}
