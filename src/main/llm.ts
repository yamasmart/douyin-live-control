// 调大模型的功能统一走 OpenAI 兼容 /chat/completions 端点（BYO-key，用户自填）。
// 每个用到大模型的功能都是 AI_TASKS 里一个独立任务：设置页可单独换模型、改提示词、看用途备注，
// 不借用别的任务的配置；任务没单独配时回退到默认模型 + 内置提示词。
// 无第三方 SDK，直接用 Node 内置 fetch。

import { AiConfig, AiTaskId, AiTaskMeta } from './types';

const COMMENT_EXPAND_PROMPT =
  '你是直播间氛围运营，据本场商品写一条带节奏、突出卖点和福利、引导下单的口播式短评论；' +
  '口语化、可含 0-1 个 emoji；严格不超过 50 个字；' +
  '只输出评论本身，不要引号、解释、换行、序号；' +
  '规避医疗功效、绝对化用语（最/第一/国家级等）等违禁词。';

/**
 * AI 任务登记表，设置页按此逐个露出。新增任何调大模型的功能：types.ts 的 AiTaskId 加 id，
 * 这里登记名称 / 用途备注 / 内置提示词，调用处用 resolveTask(该 id) 取配置。
 */
export const AI_TASKS: AiTaskMeta[] = [
  {
    id: 'comment_expand',
    label: '快捷评论 · AI 扩写',
    desc:
      '用途：「快捷评论」每行的 AI 按钮——据本场商品名生成一条、或在该行已有草稿上扩写一条 ≤50 字的口播式短评论。' +
      '支持自定义提示词（留空用内置）；不论提示词怎么写，输出都会取首行并截到 50 字以内。',
    defaultPrompt: COMMENT_EXPAND_PROMPT,
  },
];

const REQUEST_TIMEOUT_MS = 30000;
const MAX_CHARS = 50;

export interface ExpandInput {
  /** 本场商品名（讲解列表里的商品备注名）。 */
  productNames: string[];
  /** 已有草稿，有则在其基础上扩写。 */
  seed?: string;
}

/** 某任务的生效配置：任务自己的模型 / 提示词优先，没填回退默认模型 / 内置提示词。 */
export function resolveTask(ai: AiConfig | undefined, id: AiTaskId) {
  const meta = AI_TASKS.find((t) => t.id === id);
  if (!meta) throw new Error(`未登记的 AI 任务：${id}`);
  const own = ai?.tasks?.[id];
  return {
    baseUrl: ai?.baseUrl?.trim() ?? '',
    apiKey: ai?.apiKey?.trim() ?? '',
    model: own?.model?.trim() || ai?.model?.trim() || '',
    prompt: own?.prompt?.trim() || meta.defaultPrompt,
  };
}

/** 生成/扩写一条快捷评论（AI 任务 comment_expand）。未配置 AI 或无商品名时抛出可读错误。 */
export async function expandComment(ai: AiConfig | undefined, input: ExpandInput): Promise<string> {
  const cfg = resolveTask(ai, 'comment_expand');
  if (!cfg.apiKey || !cfg.baseUrl || !cfg.model) {
    throw new Error('未配置 AI：请先在右上角「设置」里填写接口地址、API 密钥和模型');
  }
  const products = (input.productNames || []).map((s) => s.trim()).filter(Boolean);
  if (!products.length) {
    throw new Error('本场没有商品名：请先在「定时讲解」里加商品并点「同步商品名」，AI 才知道卖什么');
  }

  const userLines = [`本场商品：${products.join('、')}`];
  const seed = input.seed?.trim();
  if (seed) userLines.push(`已有草稿：${seed}`);

  const url = cfg.baseUrl.replace(/\/+$/, '') + '/chat/completions';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        messages: [
          { role: 'system', content: cfg.prompt },
          { role: 'user', content: userLines.join('\n') },
        ],
        temperature: 0.9,
        max_tokens: 200,
      }),
      signal: controller.signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new Error('AI 接口超时（30s），请检查网络或接口地址');
    throw new Error(`AI 接口连接失败：${(e as Error).message ?? e}`);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`AI 接口报错 ${res.status}：${body.slice(0, 200)}`);
  }
  const data = (await res.json().catch(() => ({}))) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const out = tidy(data.choices?.[0]?.message?.content ?? '');
  if (!out) throw new Error('AI 没有返回有效评论，请重试');
  return out;
}

/** 兜底清洗：取首行、去引号/序号/列表前缀、按码点硬截到 50 字（不切坏中文/emoji）。 */
function tidy(raw: string): string {
  let s = (raw || '')
    .split('\n')
    .map((x) => x.trim())
    .find(Boolean) || '';
  s = s.replace(/^["“”'']+/, '').replace(/["“”'']+$/, ''); // 去首尾引号
  s = s.replace(/^\s*\d+[.、)．]\s*/, ''); // 去数字序号前缀
  s = s.replace(/^[-*·•]\s*/, ''); // 去列表符号
  s = s.trim();
  const cp = [...s];
  if (cp.length > MAX_CHARS) s = cp.slice(0, MAX_CHARS).join('');
  return s.trim();
}
