// 渲染进程：账号列表 + 配置表单 + 启停/手动 + 实时状态。纯 TS，无框架。
import type { LcApi } from '../preload/preload';
import type {
  AppConfig,
  Profile,
  Product,
  CommentPreset,
  ProfileStatus,
  LoginInfo,
} from '../main/types';

declare global {
  interface Window {
    lc: LcApi;
  }
}
const lc = window.lc;

let config: AppConfig = { profiles: [] };
let selectedId: string | null = null;
const statuses = new Map<string, ProfileStatus>();
const logins = new Map<string, LoginInfo>();

const uid = () => Math.random().toString(36).slice(2, 9);

function newProfile(): Profile {
  return {
    id: uid(),
    name: '新账号',
    controlUrl: '',
    products: [],
    comments: [],
    fuwu: { enabled: false, intervalSec: 900 },
    screenAi: { enabled: false, pollSec: 15 },
  };
}

async function loadAppInfo(): Promise<void> {
  try {
    const info = await lc.appInfo();
    // 版权信息后面跟版本号。
    (document.getElementById('copyright') as HTMLElement).textContent =
      `${info.copyright}  ·  v${info.version}`;
  } catch {
    // 取不到不致命，界面用 index.html 里的默认值。
  }
}

async function refresh(): Promise<void> {
  config = await lc.getConfig();
  for (const s of await lc.getStatuses()) statuses.set(s.profileId, s);
  for (const l of await lc.getLoginStatuses()) logins.set(l.profileId, l);
  render();
}

function statusOf(id: string): ProfileStatus {
  return (
    statuses.get(id) ?? { profileId: id, runStatus: 'stopped', lastFired: {} }
  );
}

function loginOf(id: string): LoginInfo {
  return logins.get(id) ?? { profileId: id, status: 'unknown' };
}

const LOGIN_LABEL: Record<string, string> = {
  unknown: '未知',
  checking: '登录中…',
  logged_in: '已登录',
  logged_out: '未登录',
};

function fmtTime(ts?: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(
    d.getMinutes(),
  ).padStart(2, '0')}`;
}

function renderList(): void {
  const el = document.getElementById('profileList')!;
  el.innerHTML = '';

  const add = document.createElement('button');
  add.className = 'primary';
  add.textContent = '＋ 新建账号';
  add.style.width = '100%';
  add.style.marginBottom = '12px';
  add.onclick = async () => {
    const p = newProfile();
    await lc.upsertProfile(p);
    selectedId = p.id;
    await refresh();
  };
  el.appendChild(add);

  for (const p of config.profiles) {
    const st = statusOf(p.id);
    const item = document.createElement('div');
    item.className = 'profile-item' + (p.id === selectedId ? ' active' : '');
    item.onclick = () => {
      selectedId = p.id;
      render();
    };
    const lg = loginOf(p.id);
    item.innerHTML = `
      <div class="name"><span class="dot ${st.runStatus}"></span>${escapeHtml(p.name)}</div>
      <div class="meta"><span>${escapeHtml(st.runStatus)}</span><span class="login ${lg.status}">${LOGIN_LABEL[lg.status]}</span></div>`;
    el.appendChild(item);
  }
}

function renderDetail(): void {
  const host = document.getElementById('detail')!;
  if (!selectedId) {
    host.innerHTML = '<div class="empty">从左侧选择或新建一个直播账号</div>';
    return;
  }
  const p = config.profiles.find((x) => x.id === selectedId);
  if (!p) {
    host.innerHTML = '<div class="empty">账号已删除</div>';
    return;
  }
  const st = statusOf(p.id);

  host.innerHTML = '';

  const lg = loginOf(p.id);
  const loggedIn = lg.status === 'logged_in';
  const runLabel =
    ({ stopped: '已停止', connecting: '连接中…', running: '运行中', error: '异常' } as Record<
      string,
      string
    >)[st.runStatus] ?? st.runStatus;
  const msg = st.message || lg.message || '';
  const toolbar = document.createElement('div');
  toolbar.className = 'card toolbar';
  toolbar.innerHTML = `
    <div class="tb-group">
      <span class="tb-label">账号登录</span>
      <span class="pill login ${lg.status}"><i></i>${LOGIN_LABEL[lg.status]}${
        lg.lastLoginAt ? ` · ${fmtTime(lg.lastLoginAt)}` : ''
      }</span>
      <button class="primary" id="btnLogin">扫码登录</button>
      <button class="ghost" id="btnCheck">检测</button>
    </div>
    <div class="tb-group">
      <span class="tb-label">运行控制</span>
      <button class="go" id="btnStart"${loggedIn ? '' : ' disabled'}>▶ 启动</button>
      <button class="ghost" id="btnStop">■ 停止</button>
      <span class="pill run ${st.runStatus}"><i></i>${runLabel}</span>
      <span class="tb-sep"></span>
      <label class="inline"><input type="checkbox" id="bg"${
        p.background ? ' checked' : ''
      }/> 后台运行</label>
      <button class="ghost" id="btnShow">显示窗口</button>
      <button class="ghost danger" id="btnClose">关闭窗口</button>
    </div>
    ${msg ? `<div class="tb-msg ${st.runStatus === 'error' ? 'err' : ''}">${escapeHtml(msg)}</div>` : ''}`;
  host.appendChild(toolbar);
  toolbar.querySelector<HTMLButtonElement>('#btnLogin')!.onclick = () => lc.login(p.id);
  toolbar.querySelector<HTMLButtonElement>('#btnCheck')!.onclick = () => lc.checkLogin(p.id);
  toolbar.querySelector<HTMLButtonElement>('#btnStart')!.onclick = () => lc.start(p.id);
  toolbar.querySelector<HTMLButtonElement>('#btnStop')!.onclick = () => lc.stop(p.id);
  toolbar.querySelector<HTMLButtonElement>('#btnShow')!.onclick = () => lc.showWindow(p.id);
  toolbar.querySelector<HTMLButtonElement>('#btnClose')!.onclick = () => lc.shutdown(p.id);
  toolbar.querySelector<HTMLInputElement>('#bg')!.onchange = (e) => {
    const on = (e.target as HTMLInputElement).checked;
    save(p, { background: on });
    if (on) lc.hideWindow(p.id);
    else lc.showWindow(p.id);
  };

  host.appendChild(basicsCard(p));
  host.appendChild(productsCard(p));
  host.appendChild(commentsCard(p));
  host.appendChild(advancedCard(p));

  const delBtn = document.createElement('button');
  delBtn.className = 'danger';
  delBtn.textContent = '删除该账号';
  delBtn.onclick = async () => {
    await lc.deleteProfile(p.id);
    selectedId = null;
    await refresh();
  };
  host.appendChild(delBtn);
}

function basicsCard(p: Profile): HTMLElement {
  const card = el('div', 'card');
  card.innerHTML = '<h3>基本信息</h3>';
  card.appendChild(field('账号名', p.name, (v) => save(p, { name: v })));
  card.appendChild(
    field('中控台地址', p.controlUrl, (v) => save(p, { controlUrl: v }), 'https://buyin.jinritemai.com/dashboard/live/control'),
  );
  return card;
}

function productsCard(p: Profile): HTMLElement {
  const card = el('div', 'card');
  card.appendChild(cardHead('定时讲解', '同步商品名', () => syncGoods(p)));
  const table = document.createElement('table');
  table.innerHTML =
    '<tr><th>启用</th><th>序号</th><th>标签</th><th>间隔(秒)</th><th>手动</th><th></th></tr>';
  for (const prod of p.products) {
    const tr = document.createElement('tr');
    tr.appendChild(cellCheck(prod.enabled, (v) => saveProduct(p, prod, { enabled: v })));
    tr.appendChild(cellNum(prod.seq, (v) => saveProduct(p, prod, { seq: v })));
    tr.appendChild(cellText(prod.label, (v) => saveProduct(p, prod, { label: v })));
    tr.appendChild(cellNum(prod.intervalSec, (v) => saveProduct(p, prod, { intervalSec: v })));
    const manualTd = document.createElement('td');
    const mb = btn('弹', 'small', () => lc.manualExplain(p.id, prod.seq));
    manualTd.appendChild(mb);
    tr.appendChild(manualTd);
    const delTd = document.createElement('td');
    delTd.appendChild(
      btn('✕', 'small danger', () => save(p, { products: p.products.filter((x) => x !== prod) })),
    );
    tr.appendChild(delTd);
    table.appendChild(tr);
  }
  card.appendChild(table);
  card.appendChild(
    btn('＋ 加一个商品', 'small add', () => {
      const prod: Product = {
        id: uid(),
        seq: p.products.length + 1,
        label: '',
        intervalSec: 120,
        enabled: true,
      };
      save(p, { products: [...p.products, prod] });
    }),
  );
  return card;
}

function commentsCard(p: Profile): HTMLElement {
  const card = el('div', 'card');
  card.appendChild(cardHead('快捷评论', '同步快捷回复', () => syncReplies(p)));
  const table = document.createElement('table');
  table.innerHTML =
    '<tr><th>启用</th><th>预设短语名</th><th>或文本</th><th>节奏(秒)</th><th>条数</th><th>手动</th><th></th></tr>';
  for (const c of p.comments) {
    const tr = document.createElement('tr');
    tr.appendChild(cellCheck(c.enabled, (v) => saveComment(p, c, { enabled: v })));
    tr.appendChild(cellText(c.presetName ?? '', (v) => saveComment(p, c, { presetName: v })));
    tr.appendChild(cellText(c.text ?? '', (v) => saveComment(p, c, { text: v })));
    tr.appendChild(cellNum(c.cadenceSec, (v) => saveComment(p, c, { cadenceSec: v })));
    tr.appendChild(cellNum(c.batchCount, (v) => saveComment(p, c, { batchCount: v })));
    const manualTd = document.createElement('td');
    manualTd.appendChild(
      btn('发', 'small', () => lc.manualComment(p.id, { presetName: c.presetName, text: c.text })),
    );
    tr.appendChild(manualTd);
    const delTd = document.createElement('td');
    delTd.appendChild(
      btn('✕', 'small danger', () => save(p, { comments: p.comments.filter((x) => x !== c) })),
    );
    tr.appendChild(delTd);
    table.appendChild(tr);
  }
  card.appendChild(table);
  card.appendChild(
    btn('＋ 加一条评论', 'small add', () => {
      const c: CommentPreset = {
        id: uid(),
        presetName: '',
        text: '',
        cadenceSec: 30,
        batchCount: 3,
        enabled: true,
      };
      save(p, { comments: [...p.comments, c] });
    }),
  );
  return card;
}

function advancedCard(p: Profile): HTMLElement {
  const card = el('div', 'card');
  card.innerHTML = '<h3>超级福袋 / 公屏AI</h3>';
  const fuwu = p.fuwu ?? { enabled: false, intervalSec: 900 };
  card.appendChild(
    checkboxLine('定时发布超级福袋', fuwu.enabled, (v) =>
      save(p, { fuwu: { ...fuwu, enabled: v } }),
    ),
  );
  card.appendChild(
    // 界面用分钟更直观；内部仍存秒（intervalSec），这里做换算。
    numField('福袋发布间隔（分钟）', Math.round(fuwu.intervalSec / 60), (min) =>
      save(p, { fuwu: { ...fuwu, intervalSec: Math.max(1, min) * 60 } }),
    ),
  );
  const ai = p.screenAi ?? { enabled: false, pollSec: 15 };
  card.appendChild(
    checkboxLine('公屏 AI 回复', ai.enabled, (v) =>
      save(p, { screenAi: { ...ai, enabled: v } }),
    ),
  );
  return card;
}

// —— 从中控台同步真实数据（复刻 OMS：同步商品名 / 同步快捷回复）——————
/** 卡片标题行：左标题 + 右侧同步按钮。 */
function cardHead(title: string, syncLabel: string, onSync: () => void): HTMLElement {
  const head = el('div', 'card-head');
  const h = document.createElement('h3');
  h.textContent = title;
  head.appendChild(h);
  head.appendChild(btn('⟳ ' + syncLabel, 'small sync', onSync));
  return head;
}

/** 读中控台真实商品列表，按序号把真实商品名回填进各商品规则的标签。需账号已登录。 */
async function syncGoods(p: Profile): Promise<void> {
  if (!p.products.length) {
    notify('请先在「定时讲解」里加商品，再点同步', 'info');
    return;
  }
  try {
    const goods = await lc.listGoods(p.id);
    const map = new Map(goods.map((g) => [g.seq, g.name]));
    let n = 0;
    for (const prod of p.products) {
      const nm = map.get(prod.seq);
      if (nm) {
        prod.label = nm;
        n += 1;
      }
    }
    if (!n) {
      notify('未匹配到对应序号的商品，请确认序号与中控台一致', 'info');
      return;
    }
    await lc.upsertProfile(p);
    render();
    notify(`已按序号同步 ${n} 个商品名`, 'ok');
  } catch (e) {
    notify(syncErr(e), 'err');
  }
}

/** 读中控台已配的快捷回复预设，去重后逐条转成评论规则（默认未启用，确认后再勾选）。需账号已登录。 */
async function syncReplies(p: Profile): Promise<void> {
  try {
    const presets = await lc.listQuickReplies(p.id);
    const uniq = [...new Set(presets.map((s) => s.trim()).filter(Boolean))];
    if (!uniq.length) {
      notify('中控台没有读到预设快捷回复', 'info');
      return;
    }
    const existing = new Set(
      p.comments.map((c) => (c.text || c.presetName || '').trim()).filter(Boolean),
    );
    const toAdd = uniq.filter((s) => !existing.has(s));
    if (!toAdd.length) {
      notify('预设快捷回复已全部同步过', 'info');
      return;
    }
    for (const text of toAdd) {
      p.comments.push({
        id: uid(),
        presetName: '',
        text,
        cadenceSec: 60,
        batchCount: 1,
        enabled: false,
      });
    }
    await lc.upsertProfile(p);
    render();
    notify(`已同步 ${toAdd.length} 条快捷回复（默认未启用，确认后再勾选）`, 'ok');
  } catch (e) {
    notify(syncErr(e), 'err');
  }
}

/** IPC 错误信息常被包成「Error invoking remote method …: Error: 真实信息」，取最后一段。 */
function syncErr(e: unknown): string {
  const m = String((e as Error)?.message ?? e);
  const i = m.lastIndexOf('Error: ');
  return i >= 0 ? m.slice(i + 7) : m;
}

/** 轻量 toast 提示（无第三方组件）。 */
function notify(msg: string, type: 'ok' | 'info' | 'err' = 'info'): void {
  let host = document.getElementById('toast');
  if (!host) {
    host = el('div');
    host.id = 'toast';
    document.body.appendChild(host);
  }
  const t = el('div', 'toast-item ' + type);
  t.textContent = msg;
  host.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

// —— 持久化辅助 ————————————————————————————————————————————
async function save(p: Profile, patch: Partial<Profile>): Promise<void> {
  Object.assign(p, patch);
  await lc.upsertProfile(p);
  render();
}
function saveProduct(p: Profile, prod: Product, patch: Partial<Product>): void {
  Object.assign(prod, patch);
  void lc.upsertProfile(p);
}
function saveComment(p: Profile, c: CommentPreset, patch: Partial<CommentPreset>): void {
  Object.assign(c, patch);
  void lc.upsertProfile(p);
}

// —— 小组件 ————————————————————————————————————————————————
function el(tag: string, cls?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}
function field(
  label: string,
  value: string,
  onChange: (v: string) => void,
  placeholder = '',
): HTMLElement {
  const wrap = el('div', 'field');
  wrap.innerHTML = `<label>${label}</label>`;
  const input = document.createElement('input');
  input.value = value;
  input.placeholder = placeholder;
  input.onchange = () => onChange(input.value);
  wrap.appendChild(input);
  return wrap;
}
function numField(label: string, value: number, onChange: (v: number) => void): HTMLElement {
  return field(label, String(value), (v) => onChange(parseInt(v, 10) || 0));
}
function cellText(value: string, onChange: (v: string) => void): HTMLElement {
  const td = document.createElement('td');
  const input = document.createElement('input');
  input.value = value;
  input.onchange = () => onChange(input.value);
  td.appendChild(input);
  return td;
}
function cellNum(value: number, onChange: (v: number) => void): HTMLElement {
  const td = document.createElement('td');
  const input = document.createElement('input');
  input.value = String(value);
  input.style.width = '70px';
  input.onchange = () => onChange(parseInt(input.value, 10) || 0);
  td.appendChild(input);
  return td;
}
function cellCheck(value: boolean, onChange: (v: boolean) => void): HTMLElement {
  const td = document.createElement('td');
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = value;
  input.style.width = 'auto';
  input.onchange = () => onChange(input.checked);
  td.appendChild(input);
  return td;
}
function checkboxLine(label: string, value: boolean, onChange: (v: boolean) => void): HTMLElement {
  const wrap = el('div', 'field row');
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = value;
  input.style.width = 'auto';
  input.onchange = () => onChange(input.checked);
  const span = document.createElement('span');
  span.textContent = label;
  wrap.appendChild(input);
  wrap.appendChild(span);
  return wrap;
}
function btn(text: string, cls: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = cls;
  b.textContent = text;
  b.onclick = onClick;
  return b;
}
function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
}

function render(): void {
  renderList();
  renderDetail();
}

const HELP_STEPS: Array<[string, string]> = [
  ['1. 新建账号', '点左侧「＋ 新建账号」，填一个好认的账号名。多账号各自独立、互不影响。'],
  ['2. 登录', '点「登录」，在弹出的二维码窗口用抖音 App 扫码。登录态变绿「已登录」即成功，登录态会自动保存，下次无需重扫。'],
  ['3. 定时讲解', '在「定时讲解」里加商品：序号=直播商品列表里的第几号，间隔=每隔多少秒自动点一次该商品讲解。'],
  ['4. 快捷评论', '在「快捷评论」里加话术：节奏=每隔多少秒发一轮，条数=每轮发几条。'],
  ['5. 超级福袋', '先在巨量百应中控台把福袋配好、放进「待开始」；这里勾选并设发布间隔，软件会定时点「开始活动」发布一个。'],
  ['6. 启动', '账号开播后点「启动」（讲解按钮只在直播进行中出现，未开播会提示）。下播后自动停止。'],
  ['7. 后台运行', '勾选「后台运行」后，启动时会隐藏该账号的浏览器窗口、只留本控制台；需要查看时点「显示窗口」。'],
  ['8. 手动操作', '每个商品行的「弹」=立即讲解该商品；每条评论的「发」=立即发送一次。'],
];

function toggleHelp(): void {
  const existed = document.getElementById('helpModal');
  if (existed) {
    existed.remove();
    return;
  }
  const mask = el('div');
  mask.id = 'helpModal';
  mask.className = 'help-mask';
  const panel = el('div', 'help-panel');
  const rows = HELP_STEPS.map(
    ([t, d]) => `<div class="help-row"><b>${t}</b><span>${d}</span></div>`,
  ).join('');
  panel.innerHTML = `<div class="help-head"><h2>操作说明</h2><button class="small" id="helpClose">关闭</button></div>${rows}`;
  mask.appendChild(panel);
  mask.onclick = (e) => {
    if (e.target === mask) mask.remove();
  };
  document.body.appendChild(mask);
  document.getElementById('helpClose')!.onclick = () => mask.remove();
}

lc.onStatusUpdate((s) => {
  statuses.set(s.profileId, s);
  render();
});

lc.onLoginUpdate((info) => {
  logins.set(info.profileId, info);
  render();
});

document.getElementById('btnHelp')!.onclick = toggleHelp;

loadAppInfo();
refresh();
