// 运行日志存储（镜像 OMS live_control_events + _log_event）：
// 每账号一个内存环形缓冲（最近 N 条）+ 追加到 JSONL 文件持久化，启动时回读。
// 主进程写入后通过回调广播给界面实时刷新。

import { appendFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { LogEvent, LogType } from './types';

const MAX_PER_PROFILE = 500; // 每账号内存里保留的条数
const TRIM_AT_LINES = 4000; // 文件超过这么多行就压缩重写

export class LogStore {
  private file: string;
  private byProfile = new Map<string, LogEvent[]>();
  private onAppend: (e: LogEvent) => void;
  private lineCount = 0;

  constructor(appDataRoot: string, onAppend: (e: LogEvent) => void) {
    this.onAppend = onAppend;
    const dir = join(appDataRoot, 'logs');
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, 'events.jsonl');
    this.load();
  }

  private load(): void {
    if (!existsSync(this.file)) return;
    try {
      const lines = readFileSync(this.file, 'utf8').split('\n').filter(Boolean);
      this.lineCount = lines.length;
      for (const line of lines) {
        try {
          const e = JSON.parse(line) as LogEvent;
          this.pushMem(e);
        } catch {
          /* 跳过坏行 */
        }
      }
    } catch {
      /* 读不了就算了 */
    }
  }

  private pushMem(e: LogEvent): void {
    let arr = this.byProfile.get(e.profileId);
    if (!arr) {
      arr = [];
      this.byProfile.set(e.profileId, arr);
    }
    arr.push(e);
    if (arr.length > MAX_PER_PROFILE) arr.splice(0, arr.length - MAX_PER_PROFILE);
  }

  /** 记一条日志：写内存 + 追加文件 + 广播。best-effort，绝不影响主流程。 */
  append(profileId: string, type: LogType, detail: string): void {
    const e: LogEvent = { profileId, ts: Date.now(), type, detail: (detail || '').slice(0, 300) };
    this.pushMem(e);
    try {
      appendFileSync(this.file, JSON.stringify(e) + '\n');
      this.lineCount += 1;
      if (this.lineCount > TRIM_AT_LINES) this.trim();
    } catch {
      /* 写文件失败不致命 */
    }
    try {
      this.onAppend(e);
    } catch {
      /* 广播失败不致命 */
    }
  }

  /** 文件过大时压缩：只保留各账号内存里的最近条目，按时间排序重写。 */
  private trim(): void {
    try {
      const all: LogEvent[] = [];
      for (const arr of this.byProfile.values()) all.push(...arr);
      all.sort((a, b) => a.ts - b.ts);
      writeFileSync(this.file, all.map((e) => JSON.stringify(e)).join('\n') + '\n');
      this.lineCount = all.length;
    } catch {
      /* ignore */
    }
  }

  /** 取某账号日志（按时间升序）。 */
  get(profileId: string): LogEvent[] {
    return [...(this.byProfile.get(profileId) ?? [])];
  }

  clear(profileId: string): void {
    this.byProfile.set(profileId, []);
    this.trim();
  }
}
