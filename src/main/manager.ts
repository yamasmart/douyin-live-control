// 控制器管理器：持有 Store 和每个 profile 的 LiveController，向界面广播状态。

import { BrowserWindow } from 'electron';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { Store } from './store';
import { LiveController } from './controller';
import { LogStore } from './log-store';
import { Profile, ProfileStatus, LoginInfo, LogEvent, LogType } from './types';
import { IPC } from './ipc-channels';
import {
  ensureWindow,
  showWindow,
  hideWindow,
  openQrWindow,
  setQr,
  closeQrWindow,
} from './account-window';
import { connectToAccount, CdpSession } from './cdp';
import {
  isLoggedIn,
  extractQrDataUrl,
  needsVerify,
  listGoods,
  readQuickReplyPresets,
} from './actions';
import { DEFAULT_CONTROL_URL, LOGIN_URL } from './selectors';

const LOGIN_POLL_MS = 3000;
const LOGIN_TIMEOUT_MS = 180000;

export class Manager {
  private store: Store;
  private appDataRoot: string;
  private controllers = new Map<string, LiveController>();
  private latestStatus = new Map<string, ProfileStatus>();
  private loginInfo = new Map<string, LoginInfo>();
  private logs: LogStore;

  constructor(store: Store, appDataRoot: string) {
    this.store = store;
    this.appDataRoot = appDataRoot;
    this.logs = new LogStore(appDataRoot, (e) => this.broadcastLog(e));
  }

  private broadcastLog(e: LogEvent): void {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send(IPC.logEvent, e);
  }

  getLogs(id: string): LogEvent[] {
    return this.logs.get(id);
  }

  clearLogs(id: string): void {
    this.logs.clear(id);
  }

  /** 记一条运行日志（控制器/登录流程调用）。 */
  private log(profileId: string, type: LogType, detail: string): void {
    this.logs.append(profileId, type, detail);
  }

  private broadcast(s: ProfileStatus): void {
    this.latestStatus.set(s.profileId, s);
    for (const w of BrowserWindow.getAllWindows()) {
      w.webContents.send(IPC.statusUpdate, s);
    }
  }

  private controllerFor(profile: Profile): LiveController {
    let c = this.controllers.get(profile.id);
    if (!c) {
      c = new LiveController(
        profile,
        this.appDataRoot,
        (s) => this.broadcast(s),
        (type, detail) => this.log(profile.id, type, detail),
      );
      this.controllers.set(profile.id, c);
    }
    return c;
  }

  getConfig() {
    return this.store.getConfig();
  }

  getStatuses(): ProfileStatus[] {
    return [...this.latestStatus.values()];
  }

  // —— 登录 / Cookie 机制（参考 OMS buyin 登录态）—————————————————
  getLoginStatuses(): LoginInfo[] {
    // 把持久化的 lastLoginAt 也带上初值，界面首屏可见。
    const out = new Map<string, LoginInfo>();
    for (const p of this.store.getConfig().profiles) {
      out.set(p.id, {
        profileId: p.id,
        status: p.lastLoginAt ? 'logged_in' : 'unknown',
        lastLoginAt: p.lastLoginAt,
        nickname: p.nickname,
      });
    }
    for (const [id, info] of this.loginInfo) out.set(id, info); // 运行时最新覆盖
    return [...out.values()];
  }

  private broadcastLogin(info: LoginInfo): void {
    this.loginInfo.set(info.profileId, info);
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send(IPC.loginUpdate, info);
  }

  /** 每账号的 storageState 快照文件（OMS Account.stateFile 的本地等价物）。 */
  private stateFile(id: string): string {
    return join(this.appDataRoot, 'states', `${id}.json`);
  }

  /**
   * 打开账号专属 Chrome 到中控台（未登录会跳登录页），用户手动扫码/登录；
   * 后台轮询直到登录成功，落 storageState 快照 + 记 lastLoginAt。
   */
  async login(id: string): Promise<void> {
    const profile = this.store.getProfile(id);
    if (!profile) throw new Error(`profile 不存在: ${id}`);
    this.broadcastLogin({
      profileId: id,
      status: 'checking',
      message: '正在生成登录二维码…',
    });
    void this.runLogin(profile); // 后台跑，不阻塞 IPC
  }

  private async runLogin(profile: Profile): Promise<void> {
    let qrWin: import('electron').BrowserWindow | null = null;
    let fellBack = false;
    try {
      // 隐藏的中控台窗（用户只看到二维码小窗，看不到整页）。
      const session = await this.openSession(profile, { show: false });

      // 先判是否已登录（分区有 cookie / 抖音 SSO 直接进后台）；已登录就别碰登录页(带 log_out)。
      if (await isLoggedIn(session.page)) {
        await this.persistLogin(profile, session);
        this.broadcastLogin({ profileId: profile.id, status: 'logged_in', lastLoginAt: profile.lastLoginAt });
        return;
      }

      // 未登录 => 导航到达人工作台登录页（二维码在此页 open.douyin qrconnect iframe）。
      await session.page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});
      await session.page.waitForTimeout(1500);

      const controlUrl = profile.controlUrl || DEFAULT_CONTROL_URL;
      const start = Date.now();
      const deadline = start + LOGIN_TIMEOUT_MS;
      let lastQr = '';
      let verifyShown = false;
      while (Date.now() < deadline) {
        if (qrWin && qrWin.isDestroyed()) {
          this.broadcastLogin({ profileId: profile.id, status: 'logged_out', message: '已取消登录' });
          return;
        }
        const url = session.page.url().toLowerCase();
        const onLogin = ['passport', '/login', 'sso', 'account/login', 'authorize'].some((h) =>
          url.includes(h),
        );
        const onBuyin = url.includes('buyin.jinritemai.com') && !onLogin;
        const qr = await extractQrDataUrl(session.page).catch(() => '');

        if (onBuyin && !qr) {
          // 扫码成功，已离开登录页进入 buyin 后台 => 登录成功，回到中控台备用。
          await session.page.goto(controlUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
          await this.persistLogin(profile, session);
          this.broadcastLogin({ profileId: profile.id, status: 'logged_in', lastLoginAt: profile.lastLoginAt });
          this.log(profile.id, 'login', '扫码登录成功');
          if (qrWin) closeQrWindow(qrWin);
          if (profile.background) hideWindow(profile.id);
          return;
        }

        // 扫码后可能要安全验证（短信/手机号/扫脸）=> 显示真实页面让用户直接完成。
        if (!verifyShown && (await needsVerify(session.page))) {
          verifyShown = true;
          if (qrWin) {
            closeQrWindow(qrWin);
            qrWin = null;
          }
          showWindow(profile.id);
          this.broadcastLogin({
            profileId: profile.id,
            status: 'checking',
            message: '需要安全验证，请在弹出的页面完成（短信验证码/手机号验证等）',
          });
        }

        if (!verifyShown) {
          if (qr) {
            if (!qrWin) qrWin = openQrWindow(profile.name);
            // 每轮都推一次：小窗 login.html 首次可能还没加载完，重发确保显示出来。
            lastQr = qr;
            setQr(qrWin, qr);
          } else if (!qrWin && !fellBack && Date.now() - start > 12000) {
            // 12s 还没提取到二维码 => 回退：显示登录页窗口，让人工自行扫码。
            fellBack = true;
            showWindow(profile.id);
            this.broadcastLogin({ profileId: profile.id, status: 'checking', message: '未能提取二维码，已打开登录页，请直接扫码' });
          }
        }
        await new Promise((r) => setTimeout(r, LOGIN_POLL_MS));
      }
      this.broadcastLogin({ profileId: profile.id, status: 'logged_out', message: '登录超时，请重试' });
      if (qrWin) closeQrWindow(qrWin);
    } catch (e) {
      this.broadcastLogin({
        profileId: profile.id,
        status: 'logged_out',
        message: String((e as Error).message ?? e),
      });
      if (qrWin) closeQrWindow(qrWin);
    }
  }

  /** 一次性检测登录态（不轮询、不展示整页，用于界面「检测」按钮 / 启动前）。 */
  async checkLogin(id: string): Promise<void> {
    const profile = this.store.getProfile(id);
    if (!profile) throw new Error(`profile 不存在: ${id}`);
    this.broadcastLogin({ profileId: id, status: 'checking' });
    try {
      const session = await this.openSession(profile, { show: false });
      const ok = await isLoggedIn(session.page);
      if (ok) await this.persistLogin(profile, session);
      this.broadcastLogin({
        profileId: id,
        status: ok ? 'logged_in' : 'logged_out',
        lastLoginAt: profile.lastLoginAt,
      });
    } catch (e) {
      this.broadcastLogin({
        profileId: id,
        status: 'logged_out',
        message: String((e as Error).message ?? e),
      });
    }
  }

  // —— 从中控台同步真实数据（参考 OMS goods / quick-replies 接口）——————
  /** 读中控台当前商品列表 [{seq,name}]，供界面「同步商品名」按 seq 回填备注名。需已登录。 */
  async listGoods(id: string): Promise<Array<{ seq: number; name: string }>> {
    const profile = this.store.getProfile(id);
    if (!profile) throw new Error(`profile 不存在: ${id}`);
    const session = await this.openSession(profile, { show: false });
    if (!(await isLoggedIn(session.page))) throw new Error('账号未登录，请先登录再同步');
    return listGoods(session.page);
  }

  /** 读中控台已配的快捷回复预设文本，供界面「同步快捷回复」逐条转成评论规则。需已登录。 */
  async listQuickReplies(id: string): Promise<string[]> {
    const profile = this.store.getProfile(id);
    if (!profile) throw new Error(`profile 不存在: ${id}`);
    const session = await this.openSession(profile, { show: false });
    if (!(await isLoggedIn(session.page))) throw new Error('账号未登录，请先登录再同步');
    return readQuickReplyPresets(session.page);
  }

  private async openSession(profile: Profile, opts: { show: boolean }): Promise<CdpSession> {
    // 在 app 内置浏览器窗口打开该账号中控台，再用 CDP 连回自身 Chromium。
    ensureWindow(profile, opts);
    return connectToAccount(profile.id);
  }

  showWindow(id: string): void {
    const p = this.store.getProfile(id);
    if (p) ensureWindow(p, { show: true });
    showWindow(id);
  }

  hideWindow(id: string): void {
    hideWindow(id);
  }

  /** 落 storageState 快照（OMS 同款 cookie 持久化）+ 记 lastLoginAt。 */
  private async persistLogin(profile: Profile, session: CdpSession): Promise<void> {
    const file = this.stateFile(profile.id);
    mkdirSync(dirname(file), { recursive: true });
    await session.page.context().storageState({ path: file }).catch(() => {});
    profile.lastLoginAt = Date.now();
    this.store.upsertProfile(profile);
    const c = this.controllers.get(profile.id);
    if (c) c.updateProfile(profile);
  }

  upsertProfile(profile: Profile): void {
    this.store.upsertProfile(profile);
    const c = this.controllers.get(profile.id);
    if (c) c.updateProfile(profile);
  }

  deleteProfile(id: string): void {
    const c = this.controllers.get(id);
    if (c) void c.shutdown();
    this.controllers.delete(id);
    this.latestStatus.delete(id);
    this.store.deleteProfile(id);
  }

  async start(id: string): Promise<void> {
    const profile = this.store.getProfile(id);
    if (!profile) throw new Error(`profile 不存在: ${id}`);
    await this.controllerFor(profile).start();
  }

  async stop(id: string): Promise<void> {
    await this.controllers.get(id)?.stop();
  }

  async shutdown(id: string): Promise<void> {
    await this.controllers.get(id)?.shutdown();
  }

  async manualExplain(id: string, seq: number): Promise<void> {
    const profile = this.store.getProfile(id);
    if (!profile) throw new Error(`profile 不存在: ${id}`);
    await this.controllerFor(profile).manualExplain(seq);
  }

  async manualComment(id: string, opts: { presetName?: string; text?: string }): Promise<void> {
    const profile = this.store.getProfile(id);
    if (!profile) throw new Error(`profile 不存在: ${id}`);
    await this.controllerFor(profile).manualComment(opts);
  }

  async shutdownAll(): Promise<void> {
    for (const c of this.controllers.values()) await c.shutdown();
  }
}
