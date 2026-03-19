import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PromptTemplate } from './types.js';
import { logger } from '../utils/logger.js';

let cachedTemplates: PromptTemplate[] | null = null;

/** Locate the builtin templates directory, same multi-path strategy as findPtyHelper. */
function findBuiltinDir(): string | null {
  const candidates = [
    path.join(process.cwd(), 'src', 'templates', 'builtin'),
    path.join(process.cwd(), 'dist', 'templates'),
  ];
  try {
    const thisDir = path.dirname(fileURLToPath(import.meta.url));
    candidates.push(path.join(thisDir, 'builtin'));
    candidates.push(path.join(thisDir, '..', 'src', 'templates', 'builtin'));
    candidates.push(path.join(thisDir, '..', '..', 'src', 'templates', 'builtin'));
  } catch { /* ignore */ }

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  logger.error('Builtin templates directory not found');
  return null;
}

/** Parse YAML-like frontmatter from a template file (no YAML dependency). */
function parseFrontmatter(raw: string): { meta: Record<string, string | string[] | number>; content: string } {
  const meta: Record<string, string | string[] | number> = {};
  let content = raw;

  if (raw.startsWith('---')) {
    const endIdx = raw.indexOf('---', 3);
    if (endIdx !== -1) {
      const frontBlock = raw.slice(3, endIdx).trim();
      content = raw.slice(endIdx + 3).trim();

      for (const line of frontBlock.split('\n')) {
        const colonIdx = line.indexOf(':');
        if (colonIdx === -1) continue;
        const key = line.slice(0, colonIdx).trim();
        let val = line.slice(colonIdx + 1).trim();

        // Handle arrays: [a, b, c]
        if (val.startsWith('[') && val.endsWith(']')) {
          meta[key] = val.slice(1, -1).split(',').map((s) => s.trim());
        } else if (/^\d+$/.test(val)) {
          meta[key] = parseInt(val, 10);
        } else {
          meta[key] = val;
        }
      }
    }
  }

  return { meta, content };
}

/** Load all .md templates from a directory. */
function loadFromDir(dir: string, source: 'builtin' | 'user'): PromptTemplate[] {
  const templates: PromptTemplate[] = [];

  let files: string[];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
  } catch {
    return templates;
  }

  for (const file of files) {
    const filePath = path.join(dir, file);
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const { meta, content } = parseFrontmatter(raw);
      const id = path.basename(file, '.md');

      templates.push({
        id,
        name: (meta.name as string) || id,
        description: (meta.description as string) || '',
        category: (meta.category as string) || 'other',
        agents: Array.isArray(meta.agents) ? meta.agents : ['any'],
        panels: typeof meta.panels === 'number' ? meta.panels : 1,
        content,
        source,
        filePath,
      });
    } catch (err) {
      logger.error(`Failed to load template ${file}`, err);
    }
  }

  return templates;
}

/** Load all templates — builtin + user (user overrides by id). Cached. */
export function loadTemplates(): PromptTemplate[] {
  if (cachedTemplates) return cachedTemplates;

  const builtin: PromptTemplate[] = [];
  const builtinDir = findBuiltinDir();
  if (builtinDir) {
    builtin.push(...loadFromDir(builtinDir, 'builtin'));
  }

  const userDir = path.join(os.homedir(), '.agents-commander', 'templates');
  const user = loadFromDir(userDir, 'user');

  // User templates override builtin by id
  const merged = new Map<string, PromptTemplate>();
  for (const t of builtin) merged.set(t.id, t);
  for (const t of user) merged.set(t.id, t);

  cachedTemplates = Array.from(merged.values());
  return cachedTemplates;
}

/** Clear the template cache so next loadTemplates() re-reads disk. */
export function refreshTemplates(): void {
  cachedTemplates = null;
}

/** Group templates by category. */
export function getTemplatesByCategory(): Map<string, PromptTemplate[]> {
  const templates = loadTemplates();
  const groups = new Map<string, PromptTemplate[]>();

  for (const t of templates) {
    const list = groups.get(t.category) || [];
    list.push(t);
    groups.set(t.category, list);
  }

  return groups;
}
