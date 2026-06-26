// Electron 主进程入口：建窗口、装 IPC、生命周期收尾。

import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { join } from 'node:path';
import { autoUpdater } from 'electron-updater';
import { Store } from './store';
import { Manager } from './manager';
import { Profile } from './types';
import { IPC } from './ipc-channels';
import { DEBUG_PORT, closeAllWindows } from './account-window';
import { disconnectShared } from './cdp';

const RELEASES_URL = 'https://github.com/yamasmart/douyin-live-control/releases/latest';

function sendUpdate(payload: Record<string, unknown>): void {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(IPC.updateStatus, payload);
}

/**
 * 自动更新（基于 electron-updater + GitHub Releases）：
 * - Windows：自动下载、下载完成后提示「重启安装」（NSIS 无需签名即可静默更新）。
 * - macOS：未做 Apple 开发者签名/公证，Squirrel 无法静默安装 → 只检测+提示，引导去下载页手动更新。
 */
function setupAutoUpdate(): void {
  const isWin = process.platform === 'win32';
  autoUpdater.autoDownload = isWin; // 仅 Windows 自动下载
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => sendUpdate({ state: 'checking' }));
  autoUpdater.on('update-available', (info) => {
    if (isWin) {
      sendUpdate({ state: 'available', version: info.version });
    } else {
      // Mac：无法静默更新，提示去下载页。
      sendUpdate({ state: 'manual', version: info.version, url: RELEASES_URL });
    }
  });
  autoUpdater.on('update-not-available', () => sendUpdate({ state: 'none' }));
  autoUpdater.on('download-progress', (p) =>
    sendUpdate({ state: 'downloading', percent: Math.round(p.percent) }),
  );
  autoUpdater.on('update-downloaded', (info) =>
    sendUpdate({ state: 'downloaded', version: info.version }),
  );
  autoUpdater.on('error', (err) =>
    sendUpdate({ state: 'error', message: String((err as Error)?.message ?? err) }),
  );
}

async function checkForUpdates(manual = false): Promise<void> {
  if (!app.isPackaged) {
    if (manual) sendUpdate({ state: 'none', dev: true });
    return;
  }
  try {
    await autoUpdater.checkForUpdates();
  } catch (e) {
    // 本地手工组装的包没有 app-update.yml 会走到这里；静默忽略，仅手动检查时上报。
    if (manual) sendUpdate({ state: 'error', message: String((e as Error)?.message ?? e) });
  }
}

// 把 userData 钉死到稳定的 ASCII 目录：Electron 默认用 app 名作配置目录，
// 一旦改名（productName 变更）配置与登录态就会"丢"到旧目录；固定路径可避免，且绕开中文路径隐患。
app.setPath('userData', join(app.getPath('appData'), 'douyin-live-control'));

// 开启本 app 自身 Chromium 的远程调试端口，供 Playwright 连回来驱动内置浏览器窗口。
// 仅监听本机回环，外部无法访问。必须在 app ready 之前设置。
app.commandLine.appendSwitch('remote-debugging-port', String(DEBUG_PORT));
app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1');

let manager: Manager;

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1180,
    height: 820,
    title: `抖音直播中控群控 v${app.getVersion()}`,
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(join(__dirname, '../renderer/index.html'));
}

const APP_NAME = '抖音直播中控群控';
const APP_COPYRIGHT = 'Copyright © 2026 潮向未来传媒科技. 保留所有权利。';

function registerIpc(): void {
  ipcMain.handle(IPC.appInfo, () => ({
    name: APP_NAME,
    version: app.getVersion(),
    copyright: APP_COPYRIGHT,
  }));
  ipcMain.handle(IPC.getConfig, () => manager.getConfig());
  ipcMain.handle(IPC.getStatuses, () => manager.getStatuses());
  ipcMain.handle(IPC.getLoginStatuses, () => manager.getLoginStatuses());
  ipcMain.handle(IPC.login, (_e, id: string) => manager.login(id));
  ipcMain.handle(IPC.checkLogin, (_e, id: string) => manager.checkLogin(id));
  ipcMain.handle(IPC.showWindow, (_e, id: string) => manager.showWindow(id));
  ipcMain.handle(IPC.hideWindow, (_e, id: string) => manager.hideWindow(id));
  ipcMain.handle(IPC.upsertProfile, (_e, p: Profile) => manager.upsertProfile(p));
  ipcMain.handle(IPC.deleteProfile, (_e, id: string) => manager.deleteProfile(id));
  ipcMain.handle(IPC.start, (_e, id: string) => manager.start(id));
  ipcMain.handle(IPC.stop, (_e, id: string) => manager.stop(id));
  ipcMain.handle(IPC.shutdown, (_e, id: string) => manager.shutdown(id));
  ipcMain.handle(IPC.manualExplain, (_e, id: string, seq: number) =>
    manager.manualExplain(id, seq),
  );
  ipcMain.handle(IPC.manualComment, (_e, id: string, opts: { presetName?: string; text?: string }) =>
    manager.manualComment(id, opts),
  );
  ipcMain.handle(IPC.listGoods, (_e, id: string) => manager.listGoods(id));
  ipcMain.handle(IPC.listQuickReplies, (_e, id: string) => manager.listQuickReplies(id));
  ipcMain.handle(IPC.getLogs, (_e, id: string) => manager.getLogs(id));
  ipcMain.handle(IPC.clearLogs, (_e, id: string) => manager.clearLogs(id));
  ipcMain.handle(IPC.checkUpdate, () => checkForUpdates(true));
  ipcMain.handle(IPC.quitAndInstall, () => {
    try {
      autoUpdater.quitAndInstall();
    } catch {
      /* ignore */
    }
  });
  ipcMain.handle(IPC.openExternal, (_e, url: string) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
  });
}

app.whenReady().then(() => {
  const store = new Store(app.getPath('userData'));
  manager = new Manager(store, app.getPath('userData'));
  registerIpc();
  createWindow();
  setupAutoUpdate();
  // 启动后延迟检查更新，避免和首屏渲染抢资源。
  setTimeout(() => void checkForUpdates(false), 5000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async (e) => {
  e.preventDefault();
  await manager?.shutdownAll().catch(() => {});
  await disconnectShared().catch(() => {});
  closeAllWindows();
  app.exit(0);
});
