import { describe, expect, it } from 'vitest';
import {
  detectCodexDecision,
  fingerprintCodexVisibleGrid,
} from '../../src/hardware/codex-decision.js';

const commandPrompt = (selectedOption: 1 | 2 | 3): string[] => [
  'Would you like to run the following command?',
  '',
  'Reason: Check the release build',
  '$ npm run verify',
  '',
  `${selectedOption === 1 ? '›' : ' '} 1. Yes, proceed (y)`,
  `${selectedOption === 2 ? '›' : ' '} 2. Yes, and don\'t ask again for commands that start with npm run`,
  `${selectedOption === 3 ? '›' : ' '} 3. No, and tell Codex what to do differently (esc)`,
];

describe('Codex decision prompt detection', () => {
  it('detects a selected one-time command approval', () => {
    const grid = [...commandPrompt(1), '', ''];

    expect(detectCodexDecision(grid, 'approve')).toMatchObject({
      action: 'approve',
      promptLineIndex: 0,
      selectedLineIndex: 5,
      selectedOption: 1,
      selectedLabel: 'Yes, proceed (y)',
    });
    expect(detectCodexDecision(grid, 'reject')).toBeNull();
  });

  it('detects a selected rejection and not an approval', () => {
    const grid = commandPrompt(3);

    expect(detectCodexDecision(grid, 'reject')).toMatchObject({
      action: 'reject',
      selectedOption: 3,
      selectedLabel: 'No, and tell Codex what to do differently (esc)',
    });
    expect(detectCodexDecision(grid, 'approve')).toBeNull();
  });

  it('supports the concrete edit prompt and its exact confirmation footer', () => {
    const grid = [
      '│ Would you like to make the following edits?',
      '│ src/app.ts (+2 -1)',
      '│   1. Yes, proceed (y)',
      '│ ❯ 2. Cancel [esc]',
      '',
      '│ Press enter to confirm or esc to cancel',
    ];

    expect(detectCodexDecision(grid, 'reject')).toMatchObject({
      promptLineIndex: 0,
      selectedLineIndex: 3,
      selectedOption: 2,
    });
  });

  it('accepts only the exact known Codex footer beneath a complete menu', () => {
    const officialShape = [
      ...commandPrompt(1),
      '',
      'Press enter to confirm or esc to cancel',
      '',
    ];
    expect(detectCodexDecision(officialShape, 'approve')).toMatchObject({
      selectedOption: 1,
      selectedLabel: 'Yes, proceed (y)',
    });

    const unknownFooter = [...commandPrompt(1), 'Press return to approve'];
    expect(detectCodexDecision(unknownFooter, 'approve')).toBeNull();
  });

  it('accepts ASCII selection markers in a numbered Codex prompt', () => {
    const grid = [
      'Do you want to run this command?',
      '> 1) Allow once',
      '  2) No',
    ];

    expect(detectCodexDecision(grid, 'approve')).toMatchObject({
      selectedOption: 1,
      selectedLabel: 'Allow once',
    });
  });

  it('never treats persistent or remembered access as one-time approval', () => {
    expect(detectCodexDecision(commandPrompt(2), 'approve')).toBeNull();

    const traps = [
      'Yes, always allow',
      'Approve for this session',
      'Yes, grant full access',
      'Allow this workspace',
      'Yes, remember this choice',
    ];

    for (const trap of traps) {
      const grid = [
        'Would you like to run this command?',
        `› 1. ${trap}`,
        '  2. No',
      ];
      expect(detectCodexDecision(grid, 'approve'), trap).toBeNull();
    }
  });

  it('rejects persistent-scope questions even when the selected label is Yes', () => {
    const grid = [
      'Would you like to trust this workspace?',
      '› 1. Yes',
      '  2. No',
    ];

    expect(detectCodexDecision(grid, 'approve')).toBeNull();
    expect(detectCodexDecision(grid, 'reject')).toBeNull();
  });

  it('rejects persistent scope described in prompt context above ordinary labels', () => {
    const grid = [
      'Do you want to run this command?',
      'This approval grants full access for this session',
      '› 1. Yes',
      '  2. No',
    ];

    expect(detectCodexDecision(grid, 'approve')).toBeNull();
    expect(detectCodexDecision(grid, 'reject')).toBeNull();
  });

  it('fails closed for multiple, missing, malformed, or non-numbered selections', () => {
    const multiple = commandPrompt(1);
    multiple[7] = '› 3. No';

    expect(detectCodexDecision(multiple, 'approve')).toBeNull();
    expect(detectCodexDecision(commandPrompt(1).map((line) => line.replace('›', ' ')), 'approve')).toBeNull();
    expect(detectCodexDecision([
      'Would you like to run this command?',
      '› Yes, proceed',
      '  No',
    ], 'approve')).toBeNull();
    expect(detectCodexDecision([
      'Would you like to run this command?',
      '› 2. Yes, proceed',
      '  3. No',
    ], 'approve')).toBeNull();
  });

  it('fails closed for unknown positive and negative wording', () => {
    expect(detectCodexDecision([
      'Would you like to execute this command?',
      '› 1. Sure, go ahead',
      '  2. Go back',
    ], 'approve')).toBeNull();

    expect(detectCodexDecision([
      'Would you like to execute this command?',
      '  1. Yes',
      '› 2. No approval needed; grant access',
    ], 'reject')).toBeNull();
  });

  it('uses the latest recognized prompt and rejects stale selections above it', () => {
    const grid = [
      ...commandPrompt(1),
      'Command completed.',
      'Do you want to run this command?',
      '  1. Yes',
      '› 2. No',
    ];

    expect(detectCodexDecision(grid, 'reject')).toMatchObject({
      promptLineIndex: 9,
      selectedLineIndex: 11,
      selectedOption: 2,
    });
    expect(detectCodexDecision(grid, 'approve')).toBeNull();
  });

  it('rejects a stale answered prompt followed by even one line of output', () => {
    for (let outputLines = 1; outputLines <= 6; outputLines += 1) {
      const stale = [
        ...commandPrompt(1),
        ...Array.from({ length: outputLines }, (_, index) => `output ${index}`),
      ];
      expect(detectCodexDecision(stale, 'approve'), `${outputLines} output lines`).toBeNull();
    }

    expect(detectCodexDecision([
      ...commandPrompt(1),
      '  4. No',
    ], 'approve')).toBeNull();
  });

  it('rejects stray content inside a menu and terminal control sequences', () => {
    expect(detectCodexDecision([
      'Would you like to run this command?',
      '› 1. Yes',
      'unexpected status update',
      '  2. No',
    ], 'approve')).toBeNull();

    expect(detectCodexDecision([
      'Would you like to run this command?',
      '\u001b[32m› 1. Yes\u001b[0m',
      '  2. No',
    ], 'approve')).toBeNull();
  });

  it('fails closed for non-canonical menu ordering and invalid runtime actions', () => {
    expect(detectCodexDecision([
      'Would you like to run this command?',
      '  1. No',
      '› 2. Yes',
    ], 'approve')).toBeNull();

    expect(detectCodexDecision(commandPrompt(1), 'later' as 'approve')).toBeNull();
  });
});

describe('visible-grid fingerprinting', () => {
  it('is stable across equivalent string and line-array input', () => {
    const lines = ['alpha  ', '', 'omega'];

    expect(fingerprintCodexVisibleGrid(lines.join('\n'))).toBe(fingerprintCodexVisibleGrid(lines));
    expect(fingerprintCodexVisibleGrid(lines)).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('covers blank rows, row boundaries, and trailing spaces', () => {
    const baseline = fingerprintCodexVisibleGrid(['ab', 'c', '']);

    expect(fingerprintCodexVisibleGrid(['a', 'bc', ''])).not.toBe(baseline);
    expect(fingerprintCodexVisibleGrid(['ab', 'c'])).not.toBe(baseline);
    expect(fingerprintCodexVisibleGrid(['ab ', 'c', ''])).not.toBe(baseline);
  });
});
