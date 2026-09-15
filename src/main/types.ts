// 数据模型 —— 镜像 OMS 直播中控模块的 DB schema（LiveControlProfile / Product / Comment），
// 但本软件落地为本地 JSON 配置，不连数据库。参考 project_live_control / project_live_control_standalone。

import type { PlatformId } from './providers/types';

export type { PlatformId };

/** 一个直播账号档案：对应一个本机 Chrome profile（独立 user-data-dir + 调试端口）。 */
export interface Profile {
  id: string;
  /** 展示名，比如「LL美妆-主号」。 */
  name: string;
  /** 平台（抖音/小红书/视频号/拼多多/淘宝）。缺省视为 douyin（兼容旧档）。 */
  platform?: PlatformId;
  /** 中控台地址，可被覆盖；为空时用所属平台 provider 的默认地址。 */
  controlUrl: string;
  products: Product[];
  comments: CommentPreset[];
  /** 超级福袋（P1）。 */
  fuwu?: FuwuConfig;
  /** 公屏 AI 回复（P2，占位）。 */
  screenAi?: ScreenAiConfig;
  /** 上次确认 buyin 已登录的时间（持久化，用于界面展示登录态是否新鲜）。 */
  lastLoginAt?: number;
  /** 登录账号达人名（持久化展示）。 */
  nickname?: string;
  /** 后台运行：启动时隐藏内置浏览器窗口，只留主控制台界面。 */
  background?: boolean;
}

/** 要循环讲解的商品：seq=直播商品列表里的序号；intervalSec=每隔多少秒点一次该商品「讲解」。 */
export interface Product {
  id: string;
  seq: number;
  label: string;
  intervalSec: number;
  enabled: boolean;
}

/** 快捷评论：用中控台预设快捷短语(presetName)或直接发文本(text)；cadenceSec 节奏、batchCount 每轮条数。 */
export interface CommentPreset {
  id: string;
  /** 二选一：优先 presetName（点中控台「评论设置」里配好的预设短语）。 */
  presetName?: string;
  text?: string;
  cadenceSec: number;
  batchCount: number;
  enabled: boolean;
}

/**
 * 超级福袋（简化方案）：福袋内容人工预先在中控台配好、放「待开始」列表；
 * 自动化只需每隔 intervalSec 点一次「开始活动」发布一个待开始福袋。
 */
export interface FuwuConfig {
  enabled: boolean;
  intervalSec: number;
}

export interface ScreenAiConfig {
  enabled: boolean;
  /** 轮询公屏评论的间隔。 */
  pollSec: number;
  /** 预留：接本地/远程 LLM 的配置。 */
  prompt?: string;
}

export type RunStatus = 'stopped' | 'connecting' | 'running' | 'error';

/** 登录态（对应 OMS 的 buyin 登录态校验）。 */
export type LoginStatus = 'unknown' | 'checking' | 'logged_in' | 'logged_out';

export interface LoginInfo {
  profileId: string;
  status: LoginStatus;
  /** 上次确认已登录的时间。 */
  lastLoginAt?: number;
  /** 已登录账号的达人名（从中控台 header 读，可选）。 */
  nickname?: string;
  message?: string;
}

/** worker 风格的运行态回报（对应 OMS LiveControlProfile.runStatus + 心跳）。 */
export interface ProfileStatus {
  profileId: string;
  runStatus: RunStatus;
  message?: string;
  lastHeartbeat?: number;
  /** 每个商品 / 评论上次触发时间，便于界面显示「下次还有多久」。 */
  lastFired: Record<string, number>;
}

export interface AppConfig {
  profiles: Profile[];
  /** AI 扩写配置（BYO-key，仅存本地）。 */
  ai?: AiConfig;
}

/**
 * AI 扩写（快捷评论）配置：BYO-key —— 用户自填 OpenAI 兼容端点。
 * 本软件是分发给他人安装的桌面应用，不能内置我们自己的密钥，
 * 故由每个用户填自己的 key，仅保存在本机 config.local.json（已 gitignore）。
 */
export interface AiConfig {
  /** OpenAI 兼容接口根地址，如 https://ark.cn-beijing.volces.com/api/v3 。 */
  baseUrl: string;
  /** API 密钥（Bearer）。仅本地保存。 */
  apiKey: string;
  /** 模型 id。 */
  model: string;
}

/** 导出配置备份的结果（取消导出时 IPC 返回 null）。 */
export interface BackupExportResult {
  file: string;
  profiles: number;
  includesApiKey: boolean;
}

/** 导入配置备份的结果（取消导入时 IPC 返回 null）。 */
export interface BackupImportResult {
  added: number;
  updated: number;
  /** 是否同时导入了 AI 设置。 */
  ai: boolean;
}

/** 运行日志事件类型（镜像 OMS live_control_events）。 */
export type LogType =
  | 'start'
  | 'stop'
  | 'explain'
  | 'comment'
  | 'fuwu'
  | 'offline'
  | 'login'
  | 'guard'
  | 'error';

export interface LogEvent {
  profileId: string;
  ts: number;
  type: LogType;
  detail: string;
}
