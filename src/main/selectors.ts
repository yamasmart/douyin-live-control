// ============================================================================
//  中控台选择器 —— ✅ 已 spike 实证(2026-06-25, 豆姐严选沫檬专场直播态)
// ============================================================================
//
//  与 OMS 直播中控模块【共用同一份】真实选择器（见记忆 project_live_control）。
//  页面无 iframe，内容在主文档。设计系统 = 字节 auxo。
//  ⚠️ 带 hash 后缀的类名（如 greyBtnStyle-<hash> / -d7a4a8）后缀是动态的，
//     只依赖这里挑出的稳定部分；讲解/取消讲解/下架按钮必须按【文案精确】区分。
// ============================================================================

/** 中控台 URL（已确认）。可被 profile.controlUrl 覆盖。 */
export const DEFAULT_CONTROL_URL = 'https://buyin.jinritemai.com/dashboard/live/control';

/**
 * 达人工作台登录页（已确认，2026-06-26 用户给的权威地址）。
 * 二维码 = 该页 `open.douyin.com/qrconnect` iframe 里的 data:image 图，extractQrDataUrl 可直接抓。
 * ⚠️ 带 log_out=1，仅在【确认未登录】时才导航过去，已登录别碰（会登出）。
 */
export const LOGIN_URL = 'https://buyin.jinritemai.com/mpa/account/login?log_out=1&type=24';

/**
 * 登录态判定：未登录时打开中控台会被重定向到登录/passport 页。
 * URL 命中这些片段 = 未登录（落到登录页）。
 */
export const LOGIN_URL_HINTS = ['passport', '/login', 'sso', 'account/login', 'authorize'];

/** 已登录标记：中控台 header 里的达人名（账号识别用，可选；spike: header 末尾文本=达人名）。 */
export const NICKNAME_SELECTOR_TODO = 'TODO_SPIKE::中控台header达人名';

export const Selectors = {
  // —— 商品行（按序号）—————————————————————————————————————————
  /** 商品行容器：rpa_ 前缀稳定语义类、无 hash，专为自动化留。DOM 顺序=显示序号顺序。 */
  productRow: '.rpa_lc__live-goods__goods-item',
  /** 行内可编辑序号框（权威序号值，1号行=“1”）。校验用，定位主要靠 nth。 */
  productIndexInput: '.indexWrapper-d7a4a8 input',

  // —— 讲解 / 取消讲解（行内按钮，必须按文案精确过滤）——————————————
  // 行内按钮均为 button.lvc2-grey-btn，第一个是空 dropdown 触发器，会取错；
  // 必须用 getByRole('button',{name, exact:true})。⚠️别碰文案「下架」。
  explainButtonName: '讲解',
  cancelExplainButtonName: '取消讲解',
  /** 讲解中标记（备用校验）。 */
  explainingTagText: '讲解中',

  // —— 发评论（公屏, P0）—————————————————————————————————————————
  // 直接填文本 + Enter 发送，不走「快捷回复」预设。
  commentPlaceholder: '回复观众或直接发评，enter一键发送',
  // ⚠️ 另一个 textarea.auxo-input「输入消息，主播可在主播看板上看到」=给主播留言，别用。

  // —— 中控台预设快捷回复（仅用于把预设文本同步进评论规则，不点它发送）————
  /** 评论框左下角「快捷回复」☰图标，唯一。⚠️别点 #input-comment-block-id(那是@提及，下拉是空的)。 */
  quickReplyTrigger: '.selector-d44d4b',
  /** 预设项（下拉 portal 到 body，全局读；需过滤 offsetParent!==null 取可见项）。 */
  presetItem: 'li.auxo-dropdown-menu-item',
  presetItemText: '.auxo-dropdown-menu-title-content',

  // —— 公屏评论监控（P2）—————————————————————————————————————————
  commentPanel: '.commentV2-f6325f',
  commentList: '.commentList-f6325f',
  commentItem: '.commentItem-c29372',

  // —— 超级福袋（P1, 简化方案：内容人工预配在「待开始」，自动只点「开始活动」发布）——
  /** 直播工具区里「超级福袋」卡片（带 onclick），按标题文案过滤。 */
  fuwuToolCard: '.liveTools-c73aae .container-cb110d',
  fuwuToolTitleText: '超级福袋',
  /** 点开后的「超级福袋-活动管理」抽屉。 */
  fuwuDrawerBody: '.buyin-drawer-body',
  /** 「开始活动」按钮（每个待开始福袋一个），按文案匹配。 */
  fuwuStartButtonName: '开始活动',
  /** 关抽屉。 */
  fuwuDrawerClose: '.buyin-drawer-close',
  fuwuDrawerMask: '.buyin-drawer-mask',

  // —— 弹窗（违规/通知）安全关闭：只点这些“知悉/忽略”类文案，绝不点执行类按钮 ——
  popupDismissTexts: ['我知道了', '知道了', '我已知悉', '忽略', '稍后处理'] as string[],
  // —— 福袋发布可能的二次确认 ——
  confirmTexts: ['确定', '确认', '开始'] as string[],
} as const;
