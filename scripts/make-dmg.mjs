// 本地打 macOS 安装包 .dmg —— 不依赖 electron-builder/网络，用系统自带 hdiutil。
// 把签好名的 .app 和「应用程序」快捷方式装进 dmg，做成经典「拖进 Applications」安装盘。
//
// 跑：node scripts/make-dmg.mjs   （需先 npm run build && node scripts/pack-mac.mjs）

import { rmSync, mkdirSync, existsSync, symlinkSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const appName = pkg.productName || pkg.name;
const version = pkg.version;

const appPath = join(root, 'out', `${appName}.app`);
if (!existsSync(appPath)) {
  console.error('找不到 ' + appPath + '\n请先 npm run build && node scripts/pack-mac.mjs');
  process.exit(1);
}

const staging = join(root, 'out', 'dmg-staging');
const dmgPath = join(root, 'out', `${appName}-${version}-arm64.dmg`);

console.log('[dmg] 准备暂存目录…');
rmSync(staging, { recursive: true, force: true });
rmSync(dmgPath, { force: true });
mkdirSync(staging, { recursive: true });

console.log('[dmg] 放入 .app + 「应用程序」快捷方式…');
execFileSync('cp', ['-R', appPath, join(staging, `${appName}.app`)]);
symlinkSync('/Applications', join(staging, 'Applications'));

console.log('[dmg] 生成 dmg（UDZO 压缩）…');
execFileSync('hdiutil', [
  'create',
  '-volname', appName,
  '-srcfolder', staging,
  '-ov',
  '-format', 'UDZO',
  dmgPath,
]);

rmSync(staging, { recursive: true, force: true });
console.log('\n✅ 安装包已生成：' + dmgPath);
