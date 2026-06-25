// 数据模型 —— 镜像 OMS 直播中控模块的 DB schema（LiveControlProfile / Product / Comment），
// 但本软件落地为本地 JSON 配置，不连数据库。参考 project_live_control / project_live_control_standalone。

/** 一个直播账号档案：对应一个本机 Chrome profile（独立 user-data-dir + 调试端口）。 */
export interface Profile {
  id: string;
  /** 展示名，比如「LL美妆-主号」。影刀靠达人名含 LL 判品牌，这里仅展示用。 */
  name: string;
  /** 中控台地址，可被覆盖；默认见 selectors.ts 的 DEFAULT_CONTROL_URL。 */
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
}
