# 抖音直播中控群控 · douyin-live-control

装在本机的**独立自包含**直播中控软件：Electron 桌面应用 + **内置浏览器**（自带 Chromium），对抖音**巨量百应直播中控台**（`buyin.jinritemai.com`）做自动化——**定时讲解 / 快捷评论 / 福袋 / 公屏 AI 回复**。

> **零外部依赖、装上即用**：不依赖本机 Chrome，中控台直接跑在软件自己的内置浏览器里；多账号各自独立、互不串号；配置存本地。

## 特性

- **多账号群控**：每个账号 = 一个内置浏览器窗口 + 独立 session 分区（`persist:lc-<id>`），登录态各自持久化、互不干扰。
- **定时讲解**：按序号自动点直播商品列表第 N 行的「讲解」（已讲解先取消再重弹），列表虚拟化时自动滚动。
- **快捷评论**：按节奏 / 条数自动发自配话术；可一键从中控台同步已配的快捷回复。
- **同步商品名**：一键把直播间真实商品名按序号回填进讲解规则的标签。
- **超级福袋**：福袋内容人工预配在中控台「待开始」，软件按间隔（默认 15 分钟）自动点「开始活动」发布。
- **下播自停**：每 12s 检测直播态，连续 3 次非直播态自动停止。
- **后台运行**：可隐藏内置浏览器窗口，只留主控制台。
- **扫码登录**：只弹一个二维码小窗，扫码即可；偶发的安全验证（短信/手机号/扫脸）会自动弹出真实页面让人工完成。

> ⚠️ **讲解按钮只在直播进行中出现**：必须该账号已开播再点「启动」；未开播启动会提示并不挂循环。

## 驱动方式

app 启动时开一个**仅本机回环**的调试端口，用 playwright-core `connectOverCDP` 连回**自身 Chromium**，按注入的 `window.__lcid` 找到每个账号的页面来驱动。选择器逻辑（`getByRole` / `getByPlaceholder`）稳定可维护。

## 运行（开发）

```bash
npm install
npm start          # 构建 + 启 Electron
npm run typecheck  # 仅类型检查
npm run build      # 仅构建到 dist/
```

首次：界面「新建账号」→ 填账号名 → 点「登录」→ 在弹出的二维码小窗里用抖音 App 扫码。登录态存进该账号专属分区、持久保存。登录态变绿后「启动」按钮解锁。

## 打包

**macOS（本地、无需联网下载）**：

```bash
npm run pack:mac   # 用本地 Electron 运行时组装出可双击的 .app（含 ad-hoc 签名），产物在 out/
```

**electron-builder（出安装包，需联网）**：

```bash
npm run dist:mac   # Mac：.dmg + .zip
npm run dist:win   # Windows：nsis(.exe) + portable(单 .exe)
```

> Windows 安装包最好在 Windows 机器或 CI 上打。图标默认用 Electron 自带，要换放 `assets/icon.icns` / `assets/icon.ico` 并在 `package.json` 的 `build.mac.icon` / `build.win.icon` 指回去。

## 架构

```
src/main/
  main.ts            Electron 主进程入口 + 开自身调试端口 + IPC 注册 + 生命周期
  manager.ts         控制器/登录管理器：持有 Store + 各账号 LiveController + 登录态广播 + 数据同步
  controller.ts      LiveController：每账号一个，内置窗口 + 每商品独立计时 + 评论节奏 + 心跳 + 下播自停
  account-window.ts  内置浏览器窗口管理：每账号一个 BrowserWindow + session 分区隔离 + 注入 __lcid
  cdp.ts             playwright-core connectOverCDP 连回自身 Chromium，按 __lcid 找账号页面
  actions.ts         讲解/评论/福袋/读公屏/登录态/直播态/关弹窗/读商品/读快捷回复 原子操作
  selectors.ts       中控台选择器
  store.ts           本地 JSON 配置持久化
  types.ts           数据模型（Profile / Product / Comment + 登录态）
  ipc-channels.ts    IPC 通道名（preload/renderer/main 共享）
src/preload/preload.ts   contextBridge 暴露受限 API
src/renderer/            配置界面（纯 TS，无框架）
scripts/pack-mac.mjs     本地组装 macOS .app
```

登录态：真正的持久 cookie 在各账号 session 分区里；另存一份 storageState 快照 `<userData>/states/<id>.json`。

## 许可与版权

本软件采用 **[MIT License](LICENSE)**：**任何人都可以自由使用、复制、修改、分发本软件**——唯一要求是**在所有副本中保留版权声明与许可声明（不得去除版权信息）**。

```
Copyright (c) 2026 Shane（抖音直播中控群控）
```

## 免责声明

本工具仅供学习与自有账号的运营效率提升使用。请遵守抖音 / 巨量百应的平台规则与相关法律法规，因使用本工具产生的一切后果由使用者自行承担。
