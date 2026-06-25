// Electron 主进程入口：建窗口、装 IPC、生命周期收尾。

import { app, BrowserWindow, ipcMain } from 'electron';
import { join } from 'node:path';
import { Store } from './store';
import { Manager } from './manager';
import { Profile } from './types';
import { IPC } from './ipc-channels';
import { DEBUG_PORT, closeAllWindows } from './account-window';
import { disconnectShared } from './cdp';

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
const APP_COPYRIGHT = 'Copyright © 2026 抖音直播中控群控. 保留所有权利。';

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
}

app.whenReady().then(() => {
  const store = new Store(app.getPath('userData'));
  manager = new Manager(store, app.getPath('userData'));
  registerIpc();
  createWindow();

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
