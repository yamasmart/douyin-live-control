// 跨平台通用的 Playwright 小工具：登录二维码提取、登录态域名判定、按文案关弹窗、
// body 文本特征命中。各 provider 复用这些，避免每个平台重复实现。

import { Page } from 'playwright-core';

/**
 * 提取登录二维码：优先近正方形 <img>（data: 或含 qr/code/login 的链接），否则 <canvas>.toDataURL。
 * 不依赖窗口可见/绘制 —— 所有平台登录页的二维码都是这种结构，可通用。找不到返回空串。
 */
export async function extractQrDataUrl(page: Page): Promise<string> {
  for (const frame of page.frames()) {
    const data = await frame
      .evaluate(() => {
        const sq = (r: DOMRect) => r.width >= 100 && Math.abs(r.width - r.height) < r.width * 0.3;
        for (const im of Array.from(document.querySelectorAll('img'))) {
          const r = im.getBoundingClientRect();
          const s = (im as HTMLImageElement).src || '';
          if (sq(r) && (s.startsWith('data:image') || /qr|code|login/i.test(s))) return s;
        }
        for (const c of Array.from(document.querySelectorAll('canvas'))) {
          const r = c.getBoundingClientRect();
          if (sq(r)) {
            try {
              return (c as HTMLCanvasElement).toDataURL('image/png');
            } catch {
              /* canvas 跨域污染，跳过 */
            }
          }
        }
        return '';
      })
      .catch(() => '');
    if (data) return data;
  }
  return '';
}

/**
 * 通用登录态判定：等重定向落定，一旦离开后台域 / 落到登录页 / 出现二维码 => 未登录；
 * 在后台域稳定 timeoutMs 没跳走 => 已登录。规避「加载中控台→重定向登录页」的瞬态误判。
 */
export async function resolveLoginStateByDomain(
  page: Page,
  opts: { backendHost: string; loginHints: string[] },
  timeoutMs = 6000,
): Promise<'in' | 'out'> {
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const url = page.url().toLowerCase();
    if (!url.includes(opts.backendHost)) return 'out';
    if (opts.loginHints.some((h) => url.includes(h))) return 'out';
    if (await extractQrDataUrl(page).catch(() => '')) return 'out';
    await page.waitForTimeout(700);
  }
  return 'in';
}

/** body 文本是否命中任意特征词（安全验证检测等通用）。 */
export async function bodyHasAny(page: Page, markers: string[]): Promise<boolean> {
  try {
    const txt = await page.evaluate(() => (document.body ? document.body.innerText : ''));
    return markers.some((m) => txt.includes(m));
  } catch {
    return false;
  }
}

/** 按文案点掉"知悉/忽略"类弹窗按钮（只点这些，绝不点执行类）。 */
export async function dismissByTexts(page: Page, texts: string[]): Promise<void> {
  for (const t of texts) {
    const btn = page.getByRole('button', { name: t });
    if (await btn.count()) {
      await btn.first().click().catch(() => {});
    }
  }
}
