import { EventEmitter } from 'node:events';

export interface AppEvents {
  'file:changed': { path: string; type: 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir' };
  'panel:focus': { panelIndex: number };
  'panel:refresh': { panelIndex: number };
  'agent:status': { sessionId: string; status: string };
  'app:quit': void;
}

export const appEvents = new EventEmitter();
appEvents.setMaxListeners(50);
