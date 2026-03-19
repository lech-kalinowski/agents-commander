export type PanelMode = 'file' | 'terminal' | 'preview';

export interface PanelState {
  index: number;
  mode: PanelMode;
  focused: boolean;
  currentPath: string;
}
