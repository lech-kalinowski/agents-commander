import path from 'node:path';

export type CtrlGAction = 'open-vim' | 'pass-through' | 'show-guide';

export interface CtrlGContext {
  activePanel: 'file' | 'terminal' | 'other';
  hasSelectedFile: boolean;
  terminalRunning: boolean;
}

export interface ExternalEditorLaunchSpec {
  label: string;
  command: string;
  args: string[];
}

export function resolveCtrlGAction(context: CtrlGContext): CtrlGAction {
  if (context.activePanel === 'terminal' && context.terminalRunning) {
    return 'pass-through';
  }

  if (context.activePanel === 'file' && context.hasSelectedFile) {
    return 'open-vim';
  }

  return 'show-guide';
}

export function buildVimLaunchSpec(filePath: string): ExternalEditorLaunchSpec {
  return {
    label: `Vim: ${path.basename(filePath)}`,
    command: 'vim',
    args: [filePath],
  };
}
