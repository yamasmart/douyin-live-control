// 平台 provider 注册表 + 平台清单。新增平台：写一个 provider 文件、在 REGISTRY 注册、
// 把 PLATFORMS 里对应项 available 改 true 即可，controller/manager/UI 无需改动。

import { Provider, PlatformId, PlatformMeta } from './types';
import { douyin } from './douyin';

const REGISTRY: Partial<Record<PlatformId, Provider>> = {
  douyin,
  // 待接入（各加一个 provider 文件后在此注册）：
  // xiaohongshu, pinduoduo, taobao, shipinhao
};

/** 界面可选平台清单。available=false 表示选择器待直播态 spike，暂不可选。 */
export const PLATFORMS: PlatformMeta[] = [
  { id: 'douyin', name: '抖音 · 巨量百应', available: true },
  { id: 'xiaohongshu', name: '小红书 · 千帆', available: false, note: '选择器待直播态 spike' },
  { id: 'pinduoduo', name: '拼多多 · 多多直播', available: false, note: '选择器待直播态 spike' },
  { id: 'taobao', name: '淘宝直播', available: false, note: '风控强，待接入' },
  { id: 'shipinhao', name: '视频号', available: false, note: '部分功能绑定电脑版微信，待验证' },
];

export const DEFAULT_PLATFORM: PlatformId = 'douyin';

/** 取平台 provider；未接入的平台抛清晰错误（上层 try/catch 会显示给用户）。 */
export function getProvider(id: PlatformId | undefined): Provider {
  const p = REGISTRY[id ?? DEFAULT_PLATFORM];
  if (!p) throw new Error(`平台「${id}」暂未接入（选择器待 spike）`);
  return p;
}

export function platformName(id: PlatformId | undefined): string {
  return PLATFORMS.find((p) => p.id === id)?.name ?? String(id ?? DEFAULT_PLATFORM);
}
