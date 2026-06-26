// 内置浏览器窗口管理：每个直播账号一个 Electron BrowserWindow，
// 用 session 分区（partition: persist:lc-<id>）隔离各账号的 buyin 登录态/cookie。
// 中控台直接加载在软件自己的 Chromium 里，不依赖、不启动本机外部 Chrome。
//
// 为了让 Playwright 能从 app 的调试端口里认出「哪个页面属于哪个账号」，
// 每次页面加载后注入 window.__lcid = <profileId>，cdp.ts 据此匹配。

import { BrowserWindow } from 'electron';
import { join } from 'node:path';
import { Profile } from './types';
import { getProvider } from './providers';

/** app 级远程调试端口（在 main.ts 启动前通过命令行开关开启），Playwright 连回自身 Chromium。 */
export const DEBUG_PORT = 9333;

const windows = new Map<string, BrowserWindow>();

export function partitionFor(profileId: string): string {
  return `persist:lc-${profileId}`;
}

/** 创建（或取回已存在的）账号内置浏览器窗口；show=true 时置前可见（登录扫码用）。 */
export function ensureWindow(profile: Profile, opts: { show: boolean }): BrowserWindow {
  const existing = windows.get(profile.id);
  if (existing && !existing.isDestroyed()) {
    if (opts.show) {
      existing.show();
      existing.focus();
    }
    return existing;
  }

  const controlUrl = profile.controlUrl || getProvider(profile.platform).defaultControlUrl;
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: opts.show,
    title: `中控台 · ${profile.name}`,
    webPreferences: {
      partition: partitionFor(profile.id),
      // 这是目标网站本身，不挂我们的 preload，保持纯净。
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // 每次（重新）加载完成后注入 lcid 标记，供 Playwright 匹配该账号的页面。
  const inject = () => {
    win.webContents
      .executeJavaScript(`window.__lcid=${JSON.stringify(profile.id)};`, true)
      .catch(() => {});
  };
  win.webContents.on('dom-ready', inject);
  win.webContents.on('did-navigate', inject);
  win.webContents.on('did-navigate-in-page', inject);

  // 拦截非 http(s) 的自定义协议跳转（如抖音登录页发起的 bytedance://dispatch_message/
  // 唤起本机抖音客户端）：内置浏览器不认这些 scheme，否则会被丢给 macOS 弹出
  // 「未设定用来打开 URL …的应用程序」对话框。一律静默拦掉，不影响扫码登录。
  const isWeb = (u: string) =>
    /^https?:\/\//i.test(u) || u === 'about:blank' || u.startsWith('data:');
  // ⚠️ bytedance:// 由登录页里的 open.douyin.com 子 iframe 发起，
  //    will-navigate 只覆盖主框架；必须用 will-frame-navigate 覆盖所有框架(含iframe)。
  win.webContents.on('will-frame-navigate', (e) => {
    if (!isWeb(e.url)) e.preventDefault();
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!isWeb(url)) e.preventDefault();
  });
  win.webContents.on('will-redirect', (e, url) => {
    if (!isWeb(url)) e.preventDefault();
  });
  // window.open / target=_blank：外部协议直接拦，其余在本窗口内打开。
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isWeb(url)) win.loadURL(url).catch(() => {});
    return { action: 'deny' };
  });

  win.on('closed', () => windows.delete(profile.id));
  win.loadURL(controlUrl).catch(() => {});

  windows.set(profile.id, win);
  return win;
}

export function getWindow(id: string): BrowserWindow | undefined {
  const w = windows.get(id);
  return w && !w.isDestroyed() ? w : undefined;
}

export function showWindow(id: string): void {
  const w = getWindow(id);
  if (w) {
    w.show();
    w.focus();
  }
}

export function hideWindow(id: string): void {
  getWindow(id)?.hide();
}

export function closeWindow(id: string): void {
  const w = getWindow(id);
  if (w) w.close();
  windows.delete(id);
}

export function closeAllWindows(): void {
  for (const id of [...windows.keys()]) closeWindow(id);
}

// —— 二维码登录小窗（只给人工端扫码，不展示整页）—————————————————
export function openQrWindow(accountName: string): BrowserWindow {
  const win = new BrowserWindow({
    width: 340,
    height: 470,
    resizable: false,
    minimizable: false,
    maximizable: false,
    title: `扫码登录 · ${accountName}`,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  win.loadFile(join(__dirname, '../renderer/login.html')).catch(() => {});
  return win;
}

// 直接改 DOM（executeJavaScript 在主世界执行、不受页面 CSP script-src 限制）。
export function setQr(win: BrowserWindow, dataUrl: string): void {
  if (win.isDestroyed()) return;
  win.webContents
    .executeJavaScript(
      `(()=>{const i=document.getElementById('qr');if(i){i.src=${JSON.stringify(
        dataUrl,
      )};i.style.display='block';}const m=document.getElementById('msg');if(m)m.textContent='请用抖音 App 扫码登录';})()`,
    )
    .catch(() => {});
}

export function setQrMsg(win: BrowserWindow, msg: string): void {
  if (win.isDestroyed()) return;
  win.webContents
    .executeJavaScript(
      `(()=>{const m=document.getElementById('msg');if(m)m.textContent=${JSON.stringify(msg)};})()`,
    )
    .catch(() => {});
}

export function closeQrWindow(win: BrowserWindow): void {
  if (!win.isDestroyed()) win.close();
}
