import type { OpenCodeAgentProfile } from './types.js';
import path from 'node:path';

export interface OpenCodeLaunchConfig {
  args: string[];
  env: Record<string, string>;
  configurationError?: string;
}

const CONTROL_CHAR_RE = /[\u0000-\u001f\u007f]/u;
const AGENT_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;

function includesOption(args: readonly string[], longName: string, shortName?: string): boolean {
  return args.some((arg) => (
    arg === longName ||
    arg.startsWith(`${longName}=`) ||
    (shortName !== undefined && (arg === shortName || arg.startsWith(`${shortName}=`)))
  ));
}

export function validateOpenCodeModel(model: string): string | null {
  if (CONTROL_CHAR_RE.test(model) || /\s/u.test(model)) {
    return 'OpenCode model must not contain whitespace or control characters';
  }
  const separator = model.indexOf('/');
  if (separator <= 0 || separator === model.length - 1) {
    return 'OpenCode model must use the full provider/model form';
  }
  return null;
}

/**
 * Convert an OpenCode profile to literal argv/environment values. Nothing in
 * this adapter is joined into a shell command, and environment values are
 * intentionally absent from validation messages.
 */
export function buildOpenCodeLaunchConfig(
  profile: OpenCodeAgentProfile,
  baseArgs: readonly string[],
  baseEnv: Readonly<Record<string, string>>,
): OpenCodeLaunchConfig {
  const args = [...baseArgs];
  const env = { ...baseEnv };
  const errors: string[] = [];

  if (profile.model) {
    const modelError = validateOpenCodeModel(profile.model);
    if (modelError) errors.push(modelError);
    if (includesOption(args, '--model', '-m')) {
      errors.push('OpenCode profile model conflicts with a model flag in args');
    } else if (!modelError) {
      args.push('--model', profile.model);
    }
  }

  if (profile.agent) {
    if (!AGENT_NAME_RE.test(profile.agent)) {
      errors.push('OpenCode agent name must be an identifier using letters, numbers, dot, dash, or underscore');
    }
    if (includesOption(args, '--agent')) {
      errors.push('OpenCode profile agent conflicts with an agent flag in args');
    } else if (AGENT_NAME_RE.test(profile.agent)) {
      args.push('--agent', profile.agent);
    }
  }

  if (profile.configPath) {
    if (CONTROL_CHAR_RE.test(profile.configPath)) {
      errors.push('OpenCode configPath must not contain control characters');
    } else if (!path.isAbsolute(profile.configPath)) {
      errors.push('OpenCode configPath must be an absolute path');
    } else {
      env.OPENCODE_CONFIG = profile.configPath;
    }
  }

  return {
    args,
    env,
    ...(errors.length > 0 ? { configurationError: errors.join('; ') } : {}),
  };
}
