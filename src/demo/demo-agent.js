#!/usr/bin/env node

import readline from 'node:readline';

const ROLE_NAMES = Object.freeze({
  coordinator: 'Demo Coordinator',
  reviewer: 'Demo Reviewer',
});
const DEFAULT_PHASE_DELAY_MS = 1200;

function parseArguments(arguments_) {
  let role = null;
  let delay = DEFAULT_PHASE_DELAY_MS;

  for (let index = 0; index < arguments_.length; index += 1) {
    const value = arguments_[index];
    if (value === '--role') {
      role = arguments_[index + 1] ?? null;
      index += 1;
    } else if (value === '--delay') {
      const parsed = Number(arguments_[index + 1]);
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > 10_000) {
        throw new Error('--delay must be an integer from 0 to 10000');
      }
      delay = parsed;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
  }

  if (!(role in ROLE_NAMES)) {
    throw new Error('--role must be coordinator or reviewer');
  }
  return { role, delay };
}

function normalizeInput(value) {
  return value
    .replaceAll('\u001b[200~', '')
    .replaceAll('\u001b[201~', '')
    .replace(/[\u0000-\u0009\u000b\u000c\u000e-\u001a\u001c-\u001f\u007f]/g, '')
    .trim();
}

function protocol(kind, content, target) {
  const marker = kind === 'SEND'
    ? `===COMMANDER:SEND:generic:${target}===`
    : `===COMMANDER:${kind}===`;
  process.stdout.write(`${marker}\n${content}\n===COMMANDER:END===\n`);
}

function finishAfter(delay) {
  setTimeout(() => {
    process.stdout.write('Offline demo role complete.\n');
    process.exit(0);
  }, delay);
}

let options;
try {
  options = parseArguments(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`demo-agent: ${error.message}\n`);
  process.exit(2);
}

const { role, delay } = options;
let state = role === 'coordinator' ? 'waiting-start' : 'waiting-task';
let inputBuffer = '';
process.stdout.write(
  role === 'coordinator'
    ? `${ROLE_NAMES[role]} ready. Type START to begin the offline demo.\n`
    : `${ROLE_NAMES[role]} ready. Waiting for the coordinator.\n`,
);

const input = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
  terminal: false,
});

input.on('line', (rawLine) => {
  const line = normalizeInput(rawLine);
  if (!line) return;
  inputBuffer = `${inputBuffer} ${line}`
    .replace(/\s+/g, ' ')
    .trim()
    .slice(-4096);
  const compactInput = inputBuffer.replace(/\s+/g, '');

  if (role === 'coordinator') {
    if (state === 'waiting-start' && line.toUpperCase() === 'START') {
      state = 'waiting-reply';
      inputBuffer = '';
      protocol(
        'SEND',
        'Review brief.md and confirm that the deterministic total is 42.',
        2,
      );
      return;
    }

    if (
      state === 'waiting-reply'
      && compactInput.includes('[FromDemoReviewerinPanel2')
      && compactInput.includes('Deterministicreviewpassed:')
      && compactInput.includes('equals42.')
    ) {
      state = 'complete';
      protocol('STATUS', 'Conference demo complete: SEND, STATUS, and REPLY verified.');
      input.close();
      finishAfter(delay);
    }
    return;
  }

  if (
    state === 'waiting-task'
    && compactInput.includes('[FromDemoCoordinatorinPanel1')
    && compactInput.includes('Reviewbrief.md')
    && compactInput.includes('deterministictotalis42.')
  ) {
    state = 'reporting';
    inputBuffer = '';
    protocol('STATUS', 'Demo Reviewer checked the seeded workspace: total is 42.');
    setTimeout(() => {
      state = 'complete';
      protocol(
        'REPLY',
        'Deterministic review passed: calculateTotal([19, 23]) equals 42.',
      );
      input.close();
      finishAfter(delay);
    }, delay);
  }
});
