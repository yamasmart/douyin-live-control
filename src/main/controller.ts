// 每个直播账号一个 LiveController（镜像 OMS worker 的 LiveController）：
//   - 用 app 内置浏览器窗口（Electron Chromium）+ CDP 拿到中控台 page（不依赖外部 Chrome）
//   - 每个商品一个独立间隔计时器（比影刀那种扁平 ~30s 串行大循环更灵活：账号并发、每商品间隔可各异）
//   - 快捷评论按 cadence + batchCount 发
//   - 福袋(P1)/公屏AI(P2) 各自占位循环
//   - 定时回报状态（心跳）给界面

import { Profile, ProfileStatus, RunStatus } from './types';
import { ensureWindow, closeWindow, hideWindow } from './account-window';
import { connectToAccount, CdpSession } from './cdp';
import {
  clickExplain,
  sendComment,
  startFuwu,
  readScreenComments,
  isLive,
  isLoggedIn,
  dismissPopups,
} from './actions';

/** 连续多少次检测到非直播态判定为下播（每 12s 一次 => 36s）。镜像 OMS。 */
const NON_LIVE_STREAK_TO_STOP = 3;
const DETECT_INTERVAL_MS = 12000;

type StatusListener = (s: ProfileStatus) => void;

export class LiveController {
  private profile: Profile;
  private appDataRoot: string;
  private onStatus: StatusListener;

  private session: CdpSession | null = null;
  private timers: NodeJS.Timeout[] = [];
  private heartbeat: NodeJS.Timeout | null = null;
  private detect: NodeJS.Timeout | null = null;
  private nonLiveStreak = 0;
  private status: ProfileStatus;

  constructor(profile: Profile, appDataRoot: string, onStatus: StatusListener) {
    this.profile = profile;
    this.appDataRoot = appDataRoot;
    this.onStatus = onStatus;
    this.status = {
      profileId: profile.id,
      runStatus: 'stopped',
      lastFired: {},
      lastHeartbeat: Date.now(),
    };
  }

  getStatus(): ProfileStatus {
    return { ...this.status, lastFired: { ...this.status.lastFired } };
  }

  /** 不重启浏览器地热更新配置（间隔/评论/序号改了 restart loops 即可）。 */
  updateProfile(p: Profile): void {
    this.profile = p;
    if (this.status.runStatus === 'running') {
      this.clearLoops();
      this.startLoops();
    }
  }

  async start(): Promise<void> {
    if (this.status.runStatus === 'running' || this.status.runStatus === 'connecting') return;
    this.setStatus('connecting');
    try {
      // 在 app 内置浏览器里打开该账号的中控台（不启动外部 Chrome），再用 CDP 连回自身。
      ensureWindow(this.profile, { show: !this.profile.background });
      this.session = await connectToAccount(this.profile.id);

      // 登录态前置校验：未登录（被重定向到登录页）不挂循环（镜像 OMS 的 buyin 登录校验）。
      if (!(await isLoggedIn(this.session.page))) {
        await this.stop();
        this.setStatus('error', '账号未登录巨量百应，请先点「登录」完成扫码登录后再启动');
        return;
      }

      // 直播态前置检测：讲解按钮只在直播进行中出现；未开播不挂循环（镜像 OMS）。
      await dismissPopups(this.session.page).catch(() => {});
      if (!(await isLive(this.session.page))) {
        await this.stop();
        this.setStatus('error', '未检测到直播（讲解按钮未出现），请确认该账号已开播后再启动');
        return;
      }

      // 后台运行：进入运行态后隐藏内置浏览器窗口，只留主控制台。
      if (this.profile.background) hideWindow(this.profile.id);

      this.nonLiveStreak = 0;
      this.setStatus('running');
      this.startLoops();
      this.startHeartbeat();
      this.startDetectLoop();
    } catch (e) {
      this.setStatus('error', String((e as Error).message ?? e));
    }
  }

  async stop(): Promise<void> {
    this.clearLoops();
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
    if (this.detect) {
      clearInterval(this.detect);
      this.detect = null;
    }
    // 仅松开 page 引用；不关内置浏览器窗口（登录态/页面保留，方便再启动）。
    this.session = null;
    this.setStatus('stopped');
  }

  /** 关掉本控制器并连带关闭内置浏览器窗口（界面「彻底停止」用）。 */
  async shutdown(): Promise<void> {
    await this.stop();
    closeWindow(this.profile.id);
  }

  // —— 手动单次操作（界面按钮）————————————————————————————————
  async manualExplain(seq: number): Promise<void> {
    await this.safeRun(`manual-explain-${seq}`, () => clickExplain(this.requirePage(), seq));
  }

  async manualComment(opts: { presetName?: string; text?: string }): Promise<void> {
    const text = (opts.text?.trim() || opts.presetName?.trim()) ?? '';
    await this.safeRun('manual-comment', () => sendComment(this.requirePage(), text));
  }

  // —— 内部 —————————————————————————————————————————————————
  private startLoops(): void {
    for (const product of this.profile.products) {
      if (!product.enabled) continue;
      const ms = Math.max(1, product.intervalSec) * 1000;
      const t = setInterval(() => {
        this.safeRun(`product-${product.id}`, () =>
          clickExplain(this.requirePage(), product.seq),
        );
      }, ms);
      this.timers.push(t);
    }

    for (const c of this.profile.comments) {
      if (!c.enabled) continue;
      const ms = Math.max(1, c.cadenceSec) * 1000;
      const t = setInterval(() => {
        this.safeRun(`comment-${c.id}`, async () => {
          const text = (c.text?.trim() || c.presetName?.trim()) ?? '';
          for (let i = 0; i < Math.max(1, c.batchCount); i++) {
            await sendComment(this.requirePage(), text);
          }
        });
      }, ms);
      this.timers.push(t);
    }

    const fuwu = this.profile.fuwu;
    if (fuwu?.enabled) {
      const t = setInterval(() => {
        this.safeRun('fuwu', () => startFuwu(this.requirePage()));
      }, Math.max(1, fuwu.intervalSec) * 1000);
      this.timers.push(t);
    }

    const ai = this.profile.screenAi;
    if (ai?.enabled) {
      const t = setInterval(() => {
        this.safeRun('screen-ai', async () => {
          const comments = await readScreenComments(this.requirePage());
          // TODO(P2): 接 LLM 决策 -> sendComment 回复。当前仅占位读取。
          void comments;
        });
      }, Math.max(1, ai.pollSec) * 1000);
      this.timers.push(t);
    }
  }

  private clearLoops(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  private startHeartbeat(): void {
    this.heartbeat = setInterval(() => {
      this.status.lastHeartbeat = Date.now();
      this.emit();
    }, 5000);
  }

  /**
   * 下播自停 + 顺手关弹窗：每 12s 检测一次直播态，连续 NON_LIVE_STREAK_TO_STOP 次
   * 非直播态 = 已下播 => 自动停止。镜像 OMS（OMS 因无头会 reload 破 DOM 滞后；
   * 本软件用真实 Chrome、DOM 实时更新，无需 reload）。
   */
  private startDetectLoop(): void {
    this.detect = setInterval(async () => {
      if (!this.session) return;
      try {
        await dismissPopups(this.session.page).catch(() => {});
        if (await isLive(this.session.page)) {
          this.nonLiveStreak = 0;
          return;
        }
        this.nonLiveStreak += 1;
        if (this.nonLiveStreak >= NON_LIVE_STREAK_TO_STOP) {
          await this.stop();
          this.setStatus('stopped', '检测到已下播，已自动停止');
        }
      } catch {
        // 检测失败不致命，下轮再试。
      }
    }, DETECT_INTERVAL_MS);
  }

  /** 包一层 try/catch：单次操作失败（含选择器未 spike）只记 message，不让控制器崩。 */
  private async safeRun(key: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
      this.status.lastFired[key] = Date.now();
      if (this.status.runStatus === 'running') this.status.message = undefined;
      this.emit();
    } catch (e) {
      this.status.message = `${key}: ${(e as Error).message ?? e}`;
      this.emit();
    }
  }

  private requirePage() {
    if (!this.session) throw new Error('未连接中控台');
    return this.session.page;
  }

  private setStatus(runStatus: RunStatus, message?: string): void {
    this.status.runStatus = runStatus;
    this.status.message = message;
    this.emit();
  }

  private emit(): void {
    this.onStatus(this.getStatus());
  }
}
