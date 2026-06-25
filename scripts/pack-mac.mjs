// 本地组装 macOS .app —— 不依赖网络、不依赖 electron-builder 下载。
// 用 node_modules 里现成的 Electron 运行时，套上我们的应用代码，
// 输出一个可双击运行的「抖音直播中控群控.app」。
//
// 跑：node scripts/pack-mac.mjs   （需先 npm run build）

import {
  cpSync,
  rmSync,
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const appName = pkg.productName || pkg.name; // 抖音直播中控群控
const appId = (pkg.build && pkg.build.appId) || 'com.future.livecontrol';

const runtime = join(root, 'node_modules', 'electron', 'dist', 'Electron.app');
if (!existsSync(runtime)) {
  console.error('找不到 Electron 运行时：' + runtime + '\n请先 npm install（或 node node_modules/electron/install.js）');
  process.exit(1);
}
if (!existsSync(join(root, 'dist', 'main', 'main.js'))) {
  console.error('找不到 dist/main/main.js，请先 npm run build');
  process.exit(1);
}

const outDir = join(root, 'out');
const appPath = join(outDir, `${appName}.app`);

console.log('[pack] 清理旧产物…');
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

console.log('[pack] 复制 Electron 运行时…');
// ⚠️ 必须用 BSD `cp -R` 原样保留 .framework 里的相对软链（Current->A 等）；
//    node 的 cpSync 会把软链解析成绝对路径，破坏框架结构 → 签名失效、icudtl.dat 加载失败。
execFileSync('cp', ['-R', runtime, appPath]);

const contents = join(appPath, 'Contents');
const resources = join(contents, 'Resources');

// 1) 删掉 Electron 自带的默认应用，换成我们的。
rmSync(join(resources, 'default_app.asar'), { force: true });

// 2) 放入应用代码到 Contents/Resources/app/
const appOut = join(resources, 'app');
mkdirSync(appOut, { recursive: true });
cpSync(join(root, 'dist'), join(appOut, 'dist'), { recursive: true });

// 精简版 package.json（只留运行所需字段）。
const runtimePkg = {
  name: pkg.name,
  productName: pkg.productName,
  version: pkg.version,
  description: pkg.description,
  author: pkg.author,
  main: pkg.main,
};
writeFileSync(join(appOut, 'package.json'), JSON.stringify(runtimePkg, null, 2));

// 3) 仅打入运行时依赖 playwright-core（无子依赖）。
console.log('[pack] 打入 playwright-core…');
mkdirSync(join(appOut, 'node_modules'), { recursive: true });
cpSync(
  join(root, 'node_modules', 'playwright-core'),
  join(appOut, 'node_modules', 'playwright-core'),
  { recursive: true },
);

// 4) 改名可执行文件 Electron -> 抖音直播中控群控，并改 Info.plist。
const macOS = join(contents, 'MacOS');
const exeOld = join(macOS, 'Electron');
const exeNew = join(macOS, appName);
if (existsSync(exeOld)) renameSync(exeOld, exeNew);

const plistPath = join(contents, 'Info.plist');
let plist = readFileSync(plistPath, 'utf8');
const setKey = (key, val) => {
  const re = new RegExp(`(<key>${key}</key>\\s*<string>)[^<]*(</string>)`);
  if (re.test(plist)) plist = plist.replace(re, `$1${val}$2`);
};
setKey('CFBundleExecutable', appName);
setKey('CFBundleName', appName);
setKey('CFBundleDisplayName', appName);
setKey('CFBundleIdentifier', appId);
setKey('CFBundleVersion', pkg.version);
setKey('CFBundleShortVersionString', pkg.version);
writeFileSync(plistPath, plist);

// 5) ad-hoc 签名（本机自产、无需开发者证书；软链已修正，深签可过）。
console.log('[pack] ad-hoc 签名…');
try {
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'pipe' });
  execFileSync('codesign', ['-v', appPath], { stdio: 'pipe' });
  console.log('[pack] 签名校验通过。');
} catch (e) {
  console.warn('[pack] 签名未完全通过（本机仍可运行）：', String(e.message || e).split('\n')[0]);
}

console.log('\n✅ 完成：' + appPath);
console.log('   双击即可打开（首次右键→打开 以绕过未签名拦截）。');
