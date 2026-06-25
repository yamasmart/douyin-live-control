// 本地配置持久化：profiles/products/comments 存成 JSON（替代 OMS 的 DB）。
// 文件落在 Electron 的 userData 目录，跟 chrome-profiles 同级。

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { AppConfig, Profile } from './types';

export class Store {
  private file: string;
  private config: AppConfig;

  constructor(userDataRoot: string) {
    this.file = join(userDataRoot, 'config.local.json');
    this.config = this.load();
  }

  private load(): AppConfig {
    if (existsSync(this.file)) {
      try {
        return JSON.parse(readFileSync(this.file, 'utf-8')) as AppConfig;
      } catch {
        // 损坏则重置，不让软件起不来。
      }
    }
    return { profiles: [] };
  }

  private persist(): void {
    if (!existsSync(dirname(this.file))) mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.config, null, 2), 'utf-8');
  }

  getConfig(): AppConfig {
    return this.config;
  }

  getProfile(id: string): Profile | undefined {
    return this.config.profiles.find((p) => p.id === id);
  }

  upsertProfile(profile: Profile): void {
    const i = this.config.profiles.findIndex((p) => p.id === profile.id);
    if (i >= 0) this.config.profiles[i] = profile;
    else this.config.profiles.push(profile);
    this.persist();
  }

  deleteProfile(id: string): void {
    this.config.profiles = this.config.profiles.filter((p) => p.id !== id);
    this.persist();
  }
}
