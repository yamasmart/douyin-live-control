// 中控台原子操作：讲解 / 评论 / 福袋 / 读公屏 / 直播态检测 / 关弹窗。
// 选择器实证见 selectors.ts（与 OMS worker live_control.py 同一份逻辑，TS 写法照抄）。

import { Page } from 'playwright-core';
import { Selectors, LOGIN_URL_HINTS } from './selectors';

/**
 * 登录态检测（对应 OMS 的 buyin 登录校验）：不导航，只看当前 URL。
 * 未登录会被重定向出 buyin 域（实测落 www.douyinec.com）=> 不在 buyin 域即未登录。
 * 页面由调用方先 ensureWindow 加载到中控台。真实登录页确切特征待真未登录态精修。
 */
export async function isLoggedIn(page: Page): Promise<boolean> {
  return (await resolveLoginState(page)) === 'in';
}

/**
 * 等登录态落定再判，避免「未登录态加载 /control → 重定向 douyinec」之间的瞬态误判。
 * 持续观察：一旦离开 buyin 域 / 落到登录页 / 出现登录二维码 => 立刻判未登录；
 * 在 buyin 后台稳定 timeoutMs 都没跳走 => 已登录。
 */
export async function resolveLoginState(page: Page, timeoutMs = 6000): Promise<'in' | 'out'> {
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const url = page.url().toLowerCase();
    if (!url.includes('buyin.jinritemai.com')) return 'out';
    if (LOGIN_URL_HINTS.some((h) => url.includes(h))) return 'out';
    const qr = await extractQrDataUrl(page).catch(() => '');
    if (qr) return 'out';
    await page.waitForTimeout(700);
  }
  return 'in';
}

/**
 * 扫码后「安全验证/二次验证」强特征词（移植自 OMS _VERIFY_MARKERS）。
 * 刻意只取登录页本身不会出现的词，避开登录页自带的「发送验证码/手机号/手机登录」误判。
 */
const VERIFY_MARKERS = [
  '安全验证', '身份验证', '二次验证', '账号安全', '为了你的账号安全',
  '完成验证', '请完成验证', '验证身份', '选择验证方式', '其他验证方式',
  '验证码已发送', '更换验证方式', '扫脸', '人脸验证', '验证手机号',
];

/** 扫码后是否弹出了需要人工完成的安全验证（短信/手机号/扫脸等）。 */
export async function needsVerify(page: Page): Promise<boolean> {
  try {
    const txt = await page.evaluate(() => (document.body ? document.body.innerText : ''));
    return VERIFY_MARKERS.some((m) => txt.includes(m));
  } catch {
    return false;
  }
}

/**
 * 提取登录二维码（参考 OMS：只给人工端一个二维码扫，不打开整页）。
 * 直接读 DOM：优先近正方形的 <img>（data: 或 qr/code/login 链接），
 * 否则取 <canvas>.toDataURL —— 二者都不依赖窗口可见/绘制，故内置窗口可全程隐藏。
 * 找不到返回空串。
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
              /* canvas 被跨域污染，跳过 */
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
 * 防挂机/账号安全保护弹窗（"检测到您长时间未操作，系统已自动唤起保护机制"）：
 * 该 role=dialog 会拦截全页点击，导致讲解/评论点不动 30s 超时。检测到就点「恢复」解锁。
 * 返回是否点了（供上层记日志）。点「恢复」是安全动作（仅恢复会话，不做任何业务操作）。
 */
export async function dismissIdleGuard(page: Page): Promise<boolean> {
  try {
    const modal = page
      .locator('.auxo-modal-wrap, [role="dialog"]')
      .filter({ hasText: Selectors.idleGuardText });
    if (await modal.count()) {
      const resume = modal.getByRole('button', {
        name: Selectors.idleGuardResumeButton,
        exact: true,
      });
      if (await resume.count()) {
        await resume.first().click().catch(() => {});
        await page.waitForTimeout(400);
        return true;
      }
    }
  } catch {
    /* ignore */
  }
  return false;
}

const VIRTUAL_SCROLL_PX = 1200;

/**
 * 弹商品（讲解）：定位第 seq 行；已在讲解先取消再点（=重弹）。
 * 行内第一个 lvc2-grey-btn 是空 dropdown，必须用 role+name(exact) 精确过滤，
 * 才能区分「讲解」vs「取消讲解」vs「下架」。
 */
export async function clickExplain(page: Page, seq: number): Promise<void> {
  await dismissIdleGuard(page); // 先解掉可能挡住点击的防挂机弹窗
  const rows = page.locator(Selectors.productRow);
  let count = await rows.count();

  // 列表可能虚拟化（只渲染可见行）：要的序号超出已渲染范围时，先滚动再试。
  if (seq > count) {
    await page.mouse.wheel(0, VIRTUAL_SCROLL_PX);
    await page.waitForTimeout(600);
    count = await rows.count();
  }
  if (seq > count) {
    throw new Error(`商品行不足：要第 ${seq} 号，当前仅渲染 ${count} 行`);
  }

  const row = rows.nth(seq - 1);
  await row.scrollIntoViewIfNeeded().catch(() => {});

  const cancel = row.getByRole('button', {
    name: Selectors.cancelExplainButtonName,
    exact: true,
  });
  if (await cancel.count()) {
    await cancel.first().click(); // 已讲解 => 先取消
    await page.waitForTimeout(800); // 等态切回「讲解」
  }
  await row
    .getByRole('button', { name: Selectors.explainButtonName, exact: true })
    .first()
    .click();
}

/** 发评论（公屏）：填文本 + Enter。不走「快捷回复」预设。 */
export async function sendComment(page: Page, text: string): Promise<void> {
  const t = text.trim();
  if (!t) return;
  await dismissIdleGuard(page); // 先解掉可能挡住点击的防挂机弹窗
  const box = page.getByPlaceholder(Selectors.commentPlaceholder);
  await box.click();
  await box.fill(t);
  await box.press('Enter');
}

/**
 * 超级福袋（P1, 简化）：福袋内容人工预配在「待开始」列表，
 * 自动化只打开活动管理抽屉、点第一个「开始活动」发布一个，再关抽屉。
 * ⚠️ 这是真发福袋（真实奖品），但属用户设定的预期动作、按其节奏自动发。
 */
export async function startFuwu(page: Page): Promise<void> {
  const card = page
    .locator(Selectors.fuwuToolCard)
    .filter({ hasText: Selectors.fuwuToolTitleText });
  await card.first().click();

  const drawer = page.locator(Selectors.fuwuDrawerBody);
  await drawer.waitFor({ state: 'visible', timeout: 5000 });

  const startBtn = drawer.getByRole('button', { name: Selectors.fuwuStartButtonName });
  if ((await startBtn.count()) === 0) {
    await closeFuwuDrawer(page);
    throw new Error('无「待开始」福袋可发布');
  }
  await startBtn.first().click();
  await confirmIfPresent(page); // 可能的二次确认
  await closeFuwuDrawer(page);
}

async function closeFuwuDrawer(page: Page): Promise<void> {
  const close = page.locator(Selectors.fuwuDrawerClose);
  if (await close.count()) {
    await close.first().click().catch(() => {});
    return;
  }
  await page.locator(Selectors.fuwuDrawerMask).first().click().catch(() => {});
}

async function confirmIfPresent(page: Page): Promise<void> {
  for (const t of Selectors.confirmTexts) {
    const btn = page.getByRole('button', { name: t, exact: true });
    if (await btn.count()) {
      await btn.first().click().catch(() => {});
      return;
    }
  }
}

/**
 * 读取中控台当前直播商品列表 [{seq, name}]（移植 OMS `_list_goods`，用于「同步商品名」）。
 * seq 取行内序号框的值（无效则用 DOM 顺序兜底）；name 从行 innerText 里剔除按钮/价格/数字等噪音行后取第一条。
 */
export async function listGoods(page: Page): Promise<Array<{ seq: number; name: string }>> {
  return page.evaluate(
    ({ rowSel, idxSel }) => {
      const noise =
        /^(讲解中|取消讲解|讲解|下架|更多数据|ID|运费险|物流提醒|未设提词|设置卖点|到手价|售出\/库存|成交金额|曝光成交率)$/;
      return Array.from(document.querySelectorAll(rowSel)).map((r, i) => {
        const inp = r.querySelector(idxSel) as HTMLInputElement | null;
        const raw = (inp?.value || '').trim();
        const seq = /^\d+$/.test(raw) ? parseInt(raw, 10) : i + 1;
        const lines = ((r as HTMLElement).innerText || '')
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean);
        const name =
          lines.find(
            (l) =>
              !noise.test(l) &&
              !/^¥/.test(l) &&
              !/^[\d.]+[万%]?$/.test(l) &&
              !/^\d+\/[\d.]+万?$/.test(l),
          ) || '';
        return { seq, name };
      });
    },
    { rowSel: Selectors.productRow, idxSel: Selectors.productIndexInput },
  );
}

/** 读公屏评论（P2）：拉当前可见评论文本，喂上层 AI。 */
export async function readScreenComments(page: Page): Promise<string[]> {
  return page.locator(`${Selectors.commentPanel} ${Selectors.commentItem}`).allInnerTexts();
}

/**
 * 直播态检测：讲解/取消讲解按钮只在【直播进行中】才出现 => 在=直播中。
 * start 前置检测 + 循环里检测下播都用它。
 */
export async function isLive(page: Page): Promise<boolean> {
  const explain = page.getByRole('button', {
    name: Selectors.explainButtonName,
    exact: true,
  });
  if (await explain.count()) return true;
  const cancel = page.getByRole('button', {
    name: Selectors.cancelExplainButtonName,
    exact: true,
  });
  return (await cancel.count()) > 0;
}

/**
 * 尽力关掉违规/通知弹窗：只点「我知道了/知道了/我已知悉/忽略/稍后处理」，
 * 绝不点执行类按钮。被弹窗挡的操作靠 Playwright 自动等待 + 下轮重试兜底。
 * ⚠️ 违规弹窗确切选择器未抓（出现时机随机），靠文案匹配兜底。
 */
export async function dismissPopups(page: Page): Promise<void> {
  for (const t of Selectors.popupDismissTexts) {
    const btn = page.getByRole('button', { name: t });
    if (await btn.count()) {
      await btn.first().click().catch(() => {});
    }
  }
}

/**
 * 读中控台预设快捷回复（仅用于把预设文本同步进评论规则，不点它发送）。
 * 触发器=评论框左下角「快捷回复」☰图标；下拉 portal 到 body，全局读可见 li。
 */
export async function readQuickReplyPresets(page: Page): Promise<string[]> {
  const trigger = page.locator(Selectors.quickReplyTrigger);
  if ((await trigger.count()) === 0) return [];
  await trigger.first().click();
  await page.waitForTimeout(300);
  const texts = await page.evaluate(
    ({ item, text }) =>
      Array.from(document.querySelectorAll(item))
        .filter((li) => (li as HTMLElement).offsetParent !== null)
        .map((li) => (li.querySelector(text) || li).textContent?.trim() || '')
        .filter(Boolean),
    { item: Selectors.presetItem, text: Selectors.presetItemText },
  );
  await page.keyboard.press('Escape').catch(() => {});
  return texts;
}
