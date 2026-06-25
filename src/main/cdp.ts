// CDP 连接层：用 playwright-core 连回【本 app 自身的 Chromium】（main.ts 已开调试端口），
// 按 window.__lcid 找到属于某账号的内置浏览器页面。
// 全程共用一个 Playwright Browser 连接（连的是自己，连一次用到退出），各账号靠 page 区分。

import { chromium, Browser, Page } from 'playwright-core';
import { DEBUG_PORT } from './account-window';

export interface CdpSession {
  page: Page;
}

let shared: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (shared && shared.isConnected()) return shared;
  shared = await chromium.connectOverCDP(`http://127.0.0.1:${DEBUG_PORT}`);
  return shared;
}

/** 在 app 的所有页面里找到 window.__lcid === profileId 的那个（账号的中控台页）。 */
export async function connectToAccount(
  profileId: string,
  timeoutMs = 20000,
): Promise<CdpSession> {
  const browser = await getBrowser();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const ctx of browser.contexts()) {
      for (const page of ctx.pages()) {
        try {
          const id = await page.evaluate(() => (window as unknown as { __lcid?: string }).__lcid);
          if (id === profileId) return { page };
        } catch {
          // 页面正在导航，下一轮再试
        }
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('未能连接到该账号的内置浏览器页面，请重试');
}

/** 退出时断开对自身 Chromium 的 Playwright 连接（不影响 app 本身）。 */
export async function disconnectShared(): Promise<void> {
  if (shared) {
    await shared.close().catch(() => {});
    shared = null;
  }
}
