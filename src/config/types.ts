export interface Theme {
  name: string;
  panel: {
    bg: string;
    fg: string;
    border: { fg: string };
    borderFocus: { fg: string };
    header: { bg: string; fg: string };
    selected: { bg: string; fg: string };
    cursor: { bg: string; fg: string };
    directory: { fg: string };
    executable: { fg: string };
  };
  functionBar: { bg: string; fg: string; key: { bg: string; fg: string } };
  statusBar: { bg: string; fg: string };
  menuBar: { bg: string; fg: string };
  dialog: { bg: string; fg: string; border: { fg: string } };
  editor: { bg: string; fg: string; lineNumber: { fg: string }; cursor: { bg: string; fg: string } };
}

export interface OrchestrationConfig {
  gridScanDelay: number;
  injectionGrace: number;
  initDelay: number;
  claudeSubmitDelay: number;
  ackTimeout: number;
  dedupWindow: number;
  maxContentLines: number;
}

export interface AppConfig {
  theme: string;
  panelCount: 2 | 3 | 4;
  showHidden: boolean;
  sortBy: 'name' | 'size' | 'date' | 'ext';
  sortAscending: boolean;
  watchDebounce: number;
  editor: { tabSize: number; wordWrap: boolean };
  agents: Record<string, { command: string; args: string[]; env: Record<string, string> }>;
  orchestration?: Partial<OrchestrationConfig>;
}
