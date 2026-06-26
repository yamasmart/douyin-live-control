// 平台 provider 抽象：把"抖音专用"的中控台逻辑抽象成统一接口，
// 每个平台（抖音/小红书/拼多多/淘宝/视频号）实现同一套方法，
// controller / manager / UI 全部平台无关，新增平台只加一个 provider 文件。

import type { Page } from 'playwright-core';

export type PlatformId = 'douyin' | 'xiaohongshu' | 'pinduoduo' | 'taobao' | 'shipinhao';

export interface GoodsItem {
  seq: number;
  name: string;
}

/** 一个平台的中控台能力实现。所有方法都接收一个已加载到该平台页面的 Playwright Page。 */
export interface Provider {
  readonly id: PlatformId;
  /** 展示名，如「抖音 · 巨量百应」。 */
  readonly name: string;
  /** 默认中控台地址（profile.controlUrl 为空时用它）。 */
  readonly defaultControlUrl: string;
  /** 登录页地址（确认未登录时才导航过去）。 */
  readonly loginUrl: string;

  // —— 登录态 / 二维码 / 安全验证 ——————————————————————————
  /** 等登录态落定后判定 in/out（避免重定向瞬态误判）。 */
  resolveLoginState(page: Page, timeoutMs?: number): Promise<'in' | 'out'>;
  isLoggedIn(page: Page): Promise<boolean>;
  /** 抓登录二维码（data:image），只给人工端小窗扫。 */
  extractQrDataUrl(page: Page): Promise<string>;
  /** 扫码后是否弹出了需要人工完成的安全验证。 */
  needsVerify(page: Page): Promise<boolean>;
  /** 当前 URL 是否在登录页。 */
  isOnLoginPage(url: string): boolean;
  /** 当前 URL 是否已进入该平台已登录后台（非登录页）。 */
  isOnBackend(url: string): boolean;

  // —— 直播操作 ——————————————————————————————————————————
  /** 直播态检测（讲解按钮只在直播中出现）。 */
  isLive(page: Page): Promise<boolean>;
  /** 弹第 seq 号商品讲解（已讲解先取消再点=重弹）。 */
  clickExplain(page: Page, seq: number): Promise<void>;
  /** 发一条公屏评论。 */
  sendComment(page: Page, text: string): Promise<void>;
  /** 发布一个待开始福袋/红包/抽奖。 */
  startFuwu(page: Page): Promise<void>;
  /** 读公屏评论（P2）。 */
  readScreenComments(page: Page): Promise<string[]>;
  /** 关违规/通知类弹窗（只点知悉/忽略类）。 */
  dismissPopups(page: Page): Promise<void>;
  /** 处理防挂机/安全保护弹窗（拦截点击的那种），返回是否处理了。 */
  dismissIdleGuard(page: Page): Promise<boolean>;
  /** 读当前商品列表 [{seq,name}]，供「同步商品名」。 */
  listGoods(page: Page): Promise<GoodsItem[]>;
  /** 读中控台已配的快捷回复预设文本，供「同步快捷回复」。 */
  readQuickReplyPresets(page: Page): Promise<string[]>;
}

/** 平台元数据（供界面选择；available=false 表示选择器待 spike，暂不可用）。 */
export interface PlatformMeta {
  id: PlatformId;
  name: string;
  available: boolean;
  /** 不可用时的说明。 */
  note?: string;
}
