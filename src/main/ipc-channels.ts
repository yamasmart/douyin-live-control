// preload / renderer / main 共享的 IPC 通道名（纯字符串，无 node 依赖，可被浏览器侧 bundle）。
export const IPC = {
  appInfo: 'app:info',
  getConfig: 'config:get',
  upsertProfile: 'profile:upsert',
  deleteProfile: 'profile:delete',
  start: 'control:start',
  stop: 'control:stop',
  shutdown: 'control:shutdown',
  manualExplain: 'control:manualExplain',
  manualComment: 'control:manualComment',
  // 从中控台同步真实数据
  listGoods: 'sync:goods',
  listQuickReplies: 'sync:quickReplies',
  // 运行日志
  getLogs: 'log:get',
  clearLogs: 'log:clear',
  getStatuses: 'status:getAll',
  // 登录 / Cookie 机制
  login: 'login:start',
  checkLogin: 'login:check',
  getLoginStatuses: 'login:getAll',
  showWindow: 'win:show',
  hideWindow: 'win:hide',
  // 主进程 -> 渲染进程 的推送。
  statusUpdate: 'status:update',
  loginUpdate: 'login:update',
  logEvent: 'log:event',
  // 自动更新
  updateStatus: 'update:status',
  checkUpdate: 'update:check',
  quitAndInstall: 'update:install',
  openExternal: 'shell:openExternal',
} as const;
