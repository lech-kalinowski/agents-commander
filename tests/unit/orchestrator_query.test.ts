import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Orchestrator } from '../../src/orchestration/orchestrator.js';
import type { LayoutManager } from '../../src/screen/layout-manager.js';
import type { AgentManager } from '../../src/agents/agent-manager.js';
import type { TerminalPanel } from '../../src/panels/terminal-panel.js';
import type { AgentType } from '../../src/agents/types.js';

describe('Orchestrator QUERY', () => {
  let orchestrator: Orchestrator;
  let mockLayout: any;
  let mockAgentManager: any;
  let mockTerminalPanel: any;

  beforeEach(() => {
    mockTerminalPanel = {
      panelIndex: 0,
      isRunning: true,
      cols: 500,
      sendInput: vi.fn(),
      updatePanelIndex: vi.fn(),
      markProtocolTextAsProcessed: vi.fn(),
      reserveProtocolTextForEcho: vi.fn(),
    };

    mockLayout = {
      panelCount: 2,
      getTerminalPanel: vi.fn().mockReturnValue(mockTerminalPanel),
    };

    mockAgentManager = {
      getAgentType: vi.fn().mockReturnValue('claude'),
      getRunningAgents: vi.fn().mockReturnValue([
        { panelIndex: 0, name: 'Claude Code', type: 'claude', status: 'running' },
        { panelIndex: 1, name: 'Codex CLI', type: 'codex', status: 'running' },
      ]),
    };

    orchestrator = new Orchestrator(mockLayout as any, mockAgentManager as any);
  });

  it('responds to "agents" query', () => {
    const msg = {
      type: 'query' as const,
      sourcePanel: 0,
      sourceAgent: 'Claude Code',
      targetAgent: 'generic' as AgentType,
      targetPanel: -1,
      content: 'agents',
    };

    // Use private method for testing if needed, or trigger via handleAgentMessage
    (orchestrator as any).handleAgentMessage(msg);

    expect(mockTerminalPanel.sendInput).toHaveBeenCalled();
    const sentText = mockTerminalPanel.sendInput.mock.calls[0][0];
    expect(sentText).toContain('Running agents:');
    expect(sentText).toContain('Panel 1: Claude Code');
    expect(sentText).toContain('Panel 2: Codex CLI');
  });

  it('responds to "panels" query', () => {
    const msg = {
      type: 'query' as const,
      sourcePanel: 0,
      sourceAgent: 'Claude Code',
      targetAgent: 'generic' as AgentType,
      targetPanel: -1,
      content: 'panels',
    };

    (orchestrator as any).handleAgentMessage(msg);

    expect(mockTerminalPanel.sendInput).toHaveBeenCalled();
    const sentText = mockTerminalPanel.sendInput.mock.calls[0][0];
    expect(sentText).toContain('Panel layout (2 panels):');
    expect(sentText).toContain('Panel 1: claude (running)');
  });

  it('responds to unknown query with help and updated list', () => {
    const msg = {
      type: 'query' as const,
      sourcePanel: 0,
      sourceAgent: 'Claude Code',
      targetAgent: 'generic' as AgentType,
      targetPanel: -1,
      content: 'something-else',
    };

    (orchestrator as any).handleAgentMessage(msg);

    expect(mockTerminalPanel.sendInput).toHaveBeenCalled();
    const sentText = mockTerminalPanel.sendInput.mock.calls[0][0];
    expect(sentText).toContain('Unknown query "something-else"');
    expect(sentText).toContain('Available queries: agents, panels, status, help, ping');
  });

  it('responds to "status" query', () => {
    const msg = {
      type: 'query' as const,
      sourcePanel: 0,
      sourceAgent: 'Claude Code',
      targetAgent: 'generic' as AgentType,
      targetPanel: -1,
      content: 'status',
    };

    (orchestrator as any).handleAgentMessage(msg);

    expect(mockTerminalPanel.sendInput).toHaveBeenCalled();
    const sentText = mockTerminalPanel.sendInput.mock.calls[0][0];
    expect(sentText).toContain('Status for Claude Code [Panel 1]: running');
  });

  it('responds to "help" query', () => {
    const msg = {
      type: 'query' as const,
      sourcePanel: 0,
      sourceAgent: 'Claude Code',
      targetAgent: 'generic' as AgentType,
      targetPanel: -1,
      content: 'help',
    };

    (orchestrator as any).handleAgentMessage(msg);

    expect(mockTerminalPanel.sendInput).toHaveBeenCalled();
    const sentText = mockTerminalPanel.sendInput.mock.calls[0][0];
    expect(sentText).toContain('Available protocol commands:');
    expect(sentText).toContain('SEND:<type>:<panel>');
    expect(sentText).toContain('QUERY');
    expect(sentText).not.toContain('\n  PING');
  });

  it('responds to "ping" query', () => {
    const msg = {
      type: 'query' as const,
      sourcePanel: 0,
      sourceAgent: 'Claude Code',
      targetAgent: 'generic' as AgentType,
      targetPanel: -1,
      content: 'ping',
    };

    (orchestrator as any).handleAgentMessage(msg);

    expect(mockTerminalPanel.sendInput).toHaveBeenCalled();
    const sentText = mockTerminalPanel.sendInput.mock.calls[0][0];
    expect(sentText).toContain('[Commander] PONG');
  });
});
