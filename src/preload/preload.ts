// preload：通过 contextBridge 暴露受限 API 给渲染进程（contextIsolation 安全模式）。

import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../main/ipc-channels';
import type { AppConfig, Profile, ProfileStatus, LoginInfo, LogEvent } from '../main/types';

const api = {
  appInfo: (): Promise<{ name: string; version: string; copyright: string }> =>
    ipcRenderer.invoke(IPC.appInfo),
  getConfig: (): Promise<AppConfig> => ipcRenderer.invoke(IPC.getConfig),
  getStatuses: (): Promise<ProfileStatus[]> => ipcRenderer.invoke(IPC.getStatuses),
  upsertProfile: (p: Profile): Promise<void> => ipcRenderer.invoke(IPC.upsertProfile, p),
  deleteProfile: (id: string): Promise<void> => ipcRenderer.invoke(IPC.deleteProfile, id),
  start: (id: string): Promise<void> => ipcRenderer.invoke(IPC.start, id),
  stop: (id: string): Promise<void> => ipcRenderer.invoke(IPC.stop, id),
  shutdown: (id: string): Promise<void> => ipcRenderer.invoke(IPC.shutdown, id),
  manualExplain: (id: string, seq: number): Promise<void> =>
    ipcRenderer.invoke(IPC.manualExplain, id, seq),
  manualComment: (id: string, opts: { presetName?: string; text?: string }): Promise<void> =>
    ipcRenderer.invoke(IPC.manualComment, id, opts),
  // 从中控台同步真实数据
  listGoods: (id: string): Promise<Array<{ seq: number; name: string }>> =>
    ipcRenderer.invoke(IPC.listGoods, id),
  listQuickReplies: (id: string): Promise<string[]> =>
    ipcRenderer.invoke(IPC.listQuickReplies, id),
  // 登录 / Cookie 机制
  login: (id: string): Promise<void> => ipcRenderer.invoke(IPC.login, id),
  checkLogin: (id: string): Promise<void> => ipcRenderer.invoke(IPC.checkLogin, id),
  getLoginStatuses: (): Promise<LoginInfo[]> => ipcRenderer.invoke(IPC.getLoginStatuses),
  showWindow: (id: string): Promise<void> => ipcRenderer.invoke(IPC.showWindow, id),
  hideWindow: (id: string): Promise<void> => ipcRenderer.invoke(IPC.hideWindow, id),
  // 运行日志
  getLogs: (id: string): Promise<LogEvent[]> => ipcRenderer.invoke(IPC.getLogs, id),
  clearLogs: (id: string): Promise<void> => ipcRenderer.invoke(IPC.clearLogs, id),
  // 自动更新
  checkUpdate: (): Promise<void> => ipcRenderer.invoke(IPC.checkUpdate),
  quitAndInstall: (): Promise<void> => ipcRenderer.invoke(IPC.quitAndInstall),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke(IPC.openExternal, url),
  onStatusUpdate: (cb: (s: ProfileStatus) => void): void => {
    ipcRenderer.on(IPC.statusUpdate, (_e, s: ProfileStatus) => cb(s));
  },
  onLoginUpdate: (cb: (info: LoginInfo) => void): void => {
    ipcRenderer.on(IPC.loginUpdate, (_e, info: LoginInfo) => cb(info));
  },
  onLogEvent: (cb: (e: LogEvent) => void): void => {
    ipcRenderer.on(IPC.logEvent, (_e, ev: LogEvent) => cb(ev));
  },
  onUpdateStatus: (cb: (s: Record<string, unknown>) => void): void => {
    ipcRenderer.on(IPC.updateStatus, (_e, s: Record<string, unknown>) => cb(s));
  },
};

contextBridge.exposeInMainWorld('lc', api);

export type LcApi = typeof api;
