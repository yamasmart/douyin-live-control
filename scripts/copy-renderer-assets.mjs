// 把 renderer 的静态资源（html/css）拷进 dist，供 Electron 加载。
import { mkdirSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'dist', 'renderer');
mkdirSync(outDir, { recursive: true });

for (const f of ['index.html', 'styles.css', 'login.html']) {
  copyFileSync(join(root, 'src', 'renderer', f), join(outDir, f));
}
console.log('[copy-renderer-assets] copied index.html, styles.css -> dist/renderer');
