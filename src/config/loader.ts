import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { AppConfig } from './types.js';
import { defaultConfig } from './defaults.js';

const CONFIG_DIR = path.join(os.homedir(), '.agents-commander');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function mergeObjects(
  defaults: Record<string, unknown>,
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...defaults };

  for (const key of Object.keys(overrides)) {
    const defaultValue = result[key];
    const overrideValue = overrides[key];

    if (isPlainObject(defaultValue) && isPlainObject(overrideValue)) {
      result[key] = mergeObjects(defaultValue, overrideValue);
    } else {
      result[key] = overrideValue;
    }
  }

  return result;
}

function deepMerge(defaults: AppConfig, overrides: Record<string, unknown>): AppConfig {
  return mergeObjects(defaults as unknown as Record<string, unknown>, overrides) as unknown as AppConfig;
}

export function loadConfig(): AppConfig {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      if (isPlainObject(parsed)) {
        return deepMerge(defaultConfig, parsed);
      }
    }
  } catch {
    // Fall through to defaults
  }
  return { ...defaultConfig };
}

export function saveConfig(config: AppConfig): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
}
