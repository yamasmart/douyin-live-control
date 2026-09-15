// 配置备份：把账号 / 讲解规则 / 快捷评论 / 福袋等配置导出成一个 .json，换电脑或重装后导入恢复。
// 登录态不在备份里——真正的 cookie 在各账号 session 分区（Partitions/），跟机器走、不跟文件走；
// 导出、导入两头都剥掉 lastLoginAt/nickname，免得新机器上显示「已登录」其实没登录。
// 导入的是外部文件，所有字段按类型校验、数值兜底：坏值若流进 controller，
// Math.max(1, NaN) 仍是 NaN，setInterval(fn, NaN) 会退化成毫秒级狂点。

import {
  AppConfig,
  Profile,
  Product,
  CommentPreset,
  AiConfig,
  AiTaskConfig,
  AiTaskId,
  PlatformId,
} from './types';
import { PLATFORMS } from './providers';
import { AI_TASKS } from './llm';

const APP_ID = 'douyin-live-control';
const KIND = 'config-backup';
const SCHEMA = 1;

export interface BackupFile {
  app: typeof APP_ID;
  kind: typeof KIND;
  schema: number;
  appVersion: string;
  /** UTC ISO 时间（存 UTC，展示时再换北京时间）。 */
  exportedAt: string;
  includesApiKey: boolean;
  profiles: Profile[];
  ai?: Partial<AiConfig>;
}

export interface ParsedBackup {
  profiles: Profile[];
  ai?: Partial<AiConfig>;
}

/** 组装导出内容。includeKey=false 时 AI 设置不带密钥（地址 / 模型 / 各任务配置照带）。 */
export function buildBackup(config: AppConfig, appVersion: string, includeKey: boolean): BackupFile {
  const profiles = (JSON.parse(JSON.stringify(config.profiles)) as Profile[]).map((p) => {
    delete p.lastLoginAt;
    delete p.nickname;
    return p;
  });
  const out: BackupFile = {
    app: APP_ID,
    kind: KIND,
    schema: SCHEMA,
    appVersion,
    exportedAt: new Date().toISOString(),
    includesApiKey: false,
    profiles,
  };
  if (config.ai) {
    const ai = JSON.parse(JSON.stringify(config.ai)) as Partial<AiConfig>;
    if (!includeKey) delete ai.apiKey;
    out.ai = ai;
    out.includesApiKey = includeKey && !!config.ai.apiKey;
  }
  return out;
}

/** 解析并校验备份。也接受旧机器直接拷来的 config.local.json（同样有 profiles 数组）。 */
export function parseBackup(raw: string): ParsedBackup {
  let data: unknown;
  try {
    data = JSON.parse(raw.replace(/^﻿/, '')); // Windows 记事本存的带 BOM
  } catch {
    throw new Error('文件不是有效的 JSON，可能已损坏');
  }
  if (!isObj(data) || !Array.isArray(data.profiles)) {
    throw new Error('这不是本软件的配置备份（没有账号列表）');
  }
  const seen = new Set<string>();
  const profiles: Profile[] = [];
  for (const v of data.profiles) {
    const p = normProfile(v);
    if (!p) continue;
    if (seen.has(p.id)) p.id = rid(); // 文件内重复 id：两个都保留
    seen.add(p.id);
    profiles.push(p);
  }
  const ai = normAi(data.ai);
  if (!profiles.length && !ai) throw new Error('备份里没有可导入的账号或设置');
  return { profiles, ai };
}

/** 导入的 AI 设置并进本机：文件里有值的字段覆盖（各任务逐字段）；文件没带密钥则保留本机已填的。 */
export function mergeAi(local: AiConfig | undefined, incoming: Partial<AiConfig>): AiConfig {
  const out: AiConfig = {
    baseUrl: incoming.baseUrl || local?.baseUrl || '',
    apiKey: incoming.apiKey || local?.apiKey || '',
    model: incoming.model || local?.model || '',
  };
  const tasks: NonNullable<AiConfig['tasks']> = {};
  for (const id of AI_TASK_IDS) {
    const t = taskCfg(
      incoming.tasks?.[id]?.model || local?.tasks?.[id]?.model,
      incoming.tasks?.[id]?.prompt || local?.tasks?.[id]?.prompt,
    );
    if (t) tasks[id] = t;
  }
  if (Object.keys(tasks).length) out.tasks = tasks;
  return out;
}

/** 北京时间 YYYYMMDD-HHmm（导出文件名用，与本机时区解耦）。 */
export function bjStamp(d = new Date()): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return `${parts.year}${parts.month}${parts.day}-${parts.hour}${parts.minute}`;
}

// —— 字段校验 ————————————————————————————————————————————————
const PLATFORM_IDS = new Set<string>(PLATFORMS.map((p) => p.id));
const AI_TASK_IDS: AiTaskId[] = AI_TASKS.map((t) => t.id);

function normProfile(v: unknown): Profile | null {
  if (!isObj(v)) return null;
  const url = str(v.controlUrl).trim();
  const p: Profile = {
    id: str(v.id).trim() || rid(),
    name: str(v.name).trim() || '未命名账号',
    controlUrl: /^https?:\/\//i.test(url) ? url : '', // 只认网页地址，其余回落平台默认
    products: list(v.products, normProduct),
    comments: list(v.comments, normComment),
  };
  const platform = str(v.platform);
  if (PLATFORM_IDS.has(platform)) p.platform = platform as PlatformId;
  const fuwu = v.fuwu;
  if (isObj(fuwu)) {
    p.fuwu = { enabled: fuwu.enabled === true, intervalSec: num(fuwu.intervalSec, 900, 60) };
  }
  const screenAi = v.screenAi;
  if (isObj(screenAi)) {
    p.screenAi = { enabled: screenAi.enabled === true, pollSec: num(screenAi.pollSec, 15, 1) };
    const prompt = str(screenAi.prompt);
    if (prompt) p.screenAi.prompt = prompt;
  }
  if (typeof v.background === 'boolean') p.background = v.background;
  return p;
}

function normProduct(v: unknown): Product | null {
  if (!isObj(v)) return null;
  const seq = finite(v.seq);
  if (seq === undefined || seq < 1) return null; // 没有有效序号的商品规则没有意义
  return {
    id: str(v.id).trim() || rid(),
    seq: Math.round(seq),
    label: str(v.label),
    intervalSec: num(v.intervalSec, 120, 1),
    enabled: v.enabled === true,
  };
}

function normComment(v: unknown): CommentPreset | null {
  if (!isObj(v)) return null;
  return {
    id: str(v.id).trim() || rid(),
    presetName: str(v.presetName),
    text: str(v.text),
    cadenceSec: num(v.cadenceSec, 30, 1),
    batchCount: num(v.batchCount, 1, 1),
    enabled: v.enabled === true,
  };
}

function normAi(v: unknown): Partial<AiConfig> | undefined {
  if (!isObj(v)) return undefined;
  const ai: Partial<AiConfig> = {};
  for (const k of ['baseUrl', 'apiKey', 'model'] as const) {
    const s = str(v[k]).trim();
    if (s) ai[k] = s;
  }
  const rawTasks = v.tasks;
  if (isObj(rawTasks)) {
    const tasks: NonNullable<AiConfig['tasks']> = {};
    for (const id of AI_TASK_IDS) {
      const t = rawTasks[id];
      const cfg = isObj(t) ? taskCfg(str(t.model).trim(), str(t.prompt).trim()) : null;
      if (cfg) tasks[id] = cfg;
    }
    if (Object.keys(tasks).length) ai.tasks = tasks;
  }
  return Object.keys(ai).length ? ai : undefined;
}

/** 单个 AI 任务配置：只留非空字段；全空返回 null（= 走默认模型 + 内置提示词）。 */
function taskCfg(model?: string, prompt?: string): AiTaskConfig | null {
  const cfg: AiTaskConfig = {};
  if (model) cfg.model = model;
  if (prompt) cfg.prompt = prompt;
  return Object.keys(cfg).length ? cfg : null;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** 有限数（数字或数字字符串），否则 undefined。 */
function finite(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

/** 数值字段兜底：非法值回落默认值，合法值取整并夹到下限。 */
function num(v: unknown, fallback: number, min: number): number {
  const n = finite(v);
  return n === undefined ? fallback : Math.max(min, Math.round(n));
}

function list<T>(v: unknown, fn: (x: unknown) => T | null): T[] {
  return Array.isArray(v) ? v.map(fn).filter((x): x is T => x !== null) : [];
}

function rid(): string {
  return Math.random().toString(36).slice(2, 9);
}
