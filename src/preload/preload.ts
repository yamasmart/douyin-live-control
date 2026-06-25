// preload：通过 contextBridge 暴露受限 API 给渲染进程（contextIsolation 安全模式）。

import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../main/ipc-channels';
import type { AppConfig, Profile, ProfileStatus, LoginInfo } from '../main/types';

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
  onStatusUpdate: (cb: (s: ProfileStatus) => void): void => {
    ipcRenderer.on(IPC.statusUpdate, (_e, s: ProfileStatus) => cb(s));
  },
  onLoginUpdate: (cb: (info: LoginInfo) => void): void => {
    ipcRenderer.on(IPC.loginUpdate, (_e, info: LoginInfo) => cb(info));
  },
};

contextBridge.exposeInMainWorld('lc', api);

export type LcApi = typeof api;
