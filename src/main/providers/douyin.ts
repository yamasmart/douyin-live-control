// 抖音 · 巨量百应 直播中控台 provider。
// 选择器 ✅ 已 spike 实证(2026-06-25 真实直播态)；防挂机弹窗 2026-06-26 真机补。
// 页面无 iframe，设计系统=字节 auxo。⚠️带 hash 后缀的类名只依赖稳定部分；
// 讲解/取消讲解/下架按钮必须按【文案精确】区分。

import { Page } from 'playwright-core';
import { Provider, GoodsItem } from './types';
import {
  extractQrDataUrl,
  resolveLoginStateByDomain,
  bodyHasAny,
  dismissByTexts,
} from './shared';

const BACKEND_HOST = 'buyin.jinritemai.com';
const CONTROL_URL = 'https://buyin.jinritemai.com/dashboard/live/control';
// 达人工作台登录页（用户给的权威地址）。⚠️带 log_out=1，仅在确认未登录时才导航。
const LOGIN_URL = 'https://buyin.jinritemai.com/mpa/account/login?log_out=1&type=24';
const LOGIN_HINTS = ['passport', '/login', 'sso', 'account/login', 'authorize'];

const S = {
  productRow: '.rpa_lc__live-goods__goods-item',
  productIndexInput: '.indexWrapper-d7a4a8 input',
  explainButtonName: '讲解',
  cancelExplainButtonName: '取消讲解',
  commentPlaceholder: '回复观众或直接发评，enter一键发送',
  quickReplyTrigger: '.selector-d44d4b',
  presetItem: 'li.auxo-dropdown-menu-item',
  presetItemText: '.auxo-dropdown-menu-title-content',
  commentPanel: '.commentV2-f6325f',
  commentItem: '.commentItem-c29372',
  fuwuToolCard: '.liveTools-c73aae .container-cb110d',
  fuwuToolTitleText: '超级福袋',
  fuwuDrawerBody: '.buyin-drawer-body',
  fuwuStartButtonName: '开始活动',
  fuwuDrawerClose: '.buyin-drawer-close',
  fuwuDrawerMask: '.buyin-drawer-mask',
  popupDismissTexts: ['我知道了', '知道了', '我已知悉', '忽略', '稍后处理'],
  confirmTexts: ['确定', '确认', '开始'],
  idleGuardText: '长时间未操作',
  idleGuardResumeButton: '恢复',
};

const VERIFY_MARKERS = [
  '安全验证', '身份验证', '二次验证', '账号安全', '为了你的账号安全',
  '完成验证', '请完成验证', '验证身份', '选择验证方式', '其他验证方式',
  '验证码已发送', '更换验证方式', '扫脸', '人脸验证', '验证手机号',
];

const VIRTUAL_SCROLL_PX = 1200;

async function closeFuwuDrawer(page: Page): Promise<void> {
  const close = page.locator(S.fuwuDrawerClose);
  if (await close.count()) {
    await close.first().click().catch(() => {});
    return;
  }
  await page.locator(S.fuwuDrawerMask).first().click().catch(() => {});
}

async function confirmIfPresent(page: Page): Promise<void> {
  for (const t of S.confirmTexts) {
    const btn = page.getByRole('button', { name: t, exact: true });
    if (await btn.count()) {
      await btn.first().click().catch(() => {});
      return;
    }
  }
}

export const douyin: Provider = {
  id: 'douyin',
  name: '抖音 · 巨量百应',
  defaultControlUrl: CONTROL_URL,
  loginUrl: LOGIN_URL,

  resolveLoginState(page, timeoutMs) {
    return resolveLoginStateByDomain(page, { backendHost: BACKEND_HOST, loginHints: LOGIN_HINTS }, timeoutMs);
  },
  async isLoggedIn(page) {
    return (await this.resolveLoginState(page)) === 'in';
  },
  extractQrDataUrl,
  needsVerify(page) {
    return bodyHasAny(page, VERIFY_MARKERS);
  },
  isOnLoginPage(url) {
    return LOGIN_HINTS.some((h) => url.toLowerCase().includes(h));
  },
  isOnBackend(url) {
    const u = url.toLowerCase();
    return u.includes(BACKEND_HOST) && !this.isOnLoginPage(u);
  },

  async isLive(page) {
    const explain = page.getByRole('button', { name: S.explainButtonName, exact: true });
    if (await explain.count()) return true;
    const cancel = page.getByRole('button', { name: S.cancelExplainButtonName, exact: true });
    return (await cancel.count()) > 0;
  },

  async clickExplain(page, seq) {
    await this.dismissIdleGuard(page); // 先解掉可能挡住点击的防挂机弹窗
    const rows = page.locator(S.productRow);
    let count = await rows.count();
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
    const cancel = row.getByRole('button', { name: S.cancelExplainButtonName, exact: true });
    if (await cancel.count()) {
      await cancel.first().click();
      await page.waitForTimeout(800);
    }
    await row.getByRole('button', { name: S.explainButtonName, exact: true }).first().click();
  },

  async sendComment(page, text) {
    const t = text.trim();
    if (!t) return;
    await this.dismissIdleGuard(page);
    const box = page.getByPlaceholder(S.commentPlaceholder);
    await box.click();
    await box.fill(t);
    await box.press('Enter');
  },

  async startFuwu(page) {
    const card = page.locator(S.fuwuToolCard).filter({ hasText: S.fuwuToolTitleText });
    await card.first().click();
    const drawer = page.locator(S.fuwuDrawerBody);
    await drawer.waitFor({ state: 'visible', timeout: 5000 });
    const startBtn = drawer.getByRole('button', { name: S.fuwuStartButtonName });
    if ((await startBtn.count()) === 0) {
      await closeFuwuDrawer(page);
      throw new Error('无「待开始」福袋可发布');
    }
    await startBtn.first().click();
    await confirmIfPresent(page);
    await closeFuwuDrawer(page);
  },

  async readScreenComments(page) {
    return page.locator(`${S.commentPanel} ${S.commentItem}`).allInnerTexts();
  },

  async dismissPopups(page) {
    await dismissByTexts(page, S.popupDismissTexts);
  },

  async dismissIdleGuard(page) {
    try {
      const modal = page.locator('.auxo-modal-wrap, [role="dialog"]').filter({ hasText: S.idleGuardText });
      if (await modal.count()) {
        const resume = modal.getByRole('button', { name: S.idleGuardResumeButton, exact: true });
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
  },

  async listGoods(page): Promise<GoodsItem[]> {
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
      { rowSel: S.productRow, idxSel: S.productIndexInput },
    );
  },

  async readQuickReplyPresets(page) {
    const trigger = page.locator(S.quickReplyTrigger);
    if ((await trigger.count()) === 0) return [];
    await trigger.first().click();
    await page.waitForTimeout(300);
    const texts = await page.evaluate(
      ({ item, text }) =>
        Array.from(document.querySelectorAll(item))
          .filter((li) => (li as HTMLElement).offsetParent !== null)
          .map((li) => (li.querySelector(text) || li).textContent?.trim() || '')
          .filter(Boolean),
      { item: S.presetItem, text: S.presetItemText },
    );
    await page.keyboard.press('Escape').catch(() => {});
    return texts;
  },
};
