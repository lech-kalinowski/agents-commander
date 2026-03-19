import fs from 'node:fs';
import path from 'node:path';
import type { SkillFile } from './types.js';

const SKILL_FILES: { pattern: string; agent: string; name: string }[] = [
  { pattern: 'CLAUDE.md', agent: 'Claude Code', name: 'Claude Instructions' },
  { pattern: '.claude/settings.json', agent: 'Claude Code', name: 'Claude Settings' },
  { pattern: '.claude/commands', agent: 'Claude Code', name: 'Claude Custom Commands' },
  { pattern: 'GEMINI.md', agent: 'Gemini CLI', name: 'Gemini Instructions' },
  { pattern: '.cursorrules', agent: 'Cursor', name: 'Cursor Rules' },
  { pattern: '.clinerules', agent: 'Cline', name: 'Cline Rules' },
  { pattern: '.aider.conf.yml', agent: 'Aider', name: 'Aider Config' },
  { pattern: '.github/copilot-instructions.md', agent: 'GitHub Copilot', name: 'Copilot Instructions' },
  { pattern: 'AGENTS.md', agent: 'Codex CLI', name: 'Codex Instructions' },
  { pattern: '.opencode.json', agent: 'OpenCode', name: 'OpenCode Config' },
];

export function discoverSkillFiles(projectRoot: string): SkillFile[] {
  return SKILL_FILES.map((sf) => {
    const fullPath = path.join(projectRoot, sf.pattern);
    return {
      path: fullPath,
      agent: sf.agent,
      name: sf.name,
      exists: fs.existsSync(fullPath),
    };
  });
}

export function getExistingSkillFiles(projectRoot: string): SkillFile[] {
  return discoverSkillFiles(projectRoot).filter((sf) => sf.exists);
}

export function createSkillFile(filePath: string, template: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, template, 'utf-8');
}
