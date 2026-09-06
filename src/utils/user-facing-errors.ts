const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/g;

export function sanitizeUserText(value: unknown, maxLength = 180): string {
  const normalized = String(value ?? '')
    .replace(CONTROL_CHARACTERS, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
}

interface ErrorDetails {
  code?: string;
  message?: string;
  completed?: number;
  total?: number;
  recoveryPath?: string;
}

export function formatUserError(action: string, error: unknown): string {
  const details = (
    error && typeof error === 'object'
      ? error as ErrorDetails
      : { message: String(error ?? '') }
  );
  const progress = Number.isInteger(details.completed) && Number.isInteger(details.total)
    ? ` (${details.completed}/${details.total} completed)`
    : '';
  const recovery = details.recoveryPath
    ? ` Original retained at: ${sanitizeUserText(details.recoveryPath, 260)}.`
    : '';

  let reason: string;
  switch (details.code) {
    case 'EEXIST':
    case 'FILE_CONFLICT':
      reason = 'destination already exists';
      break;
    case 'EACCES':
    case 'EPERM':
      reason = 'permission denied';
      break;
    case 'ENOENT':
      reason = 'file or directory no longer exists';
      break;
    case 'ENOSPC':
      reason = 'not enough disk space';
      break;
    case 'EXDEV':
      reason = 'cross-filesystem move canceled because metadata cannot be preserved';
      break;
    case 'EINVAL':
    case 'INVALID_ENTRY_NAME':
      reason = sanitizeUserText(details.message || 'invalid name');
      break;
    case 'FILE_CHANGED':
      reason = 'file changed on disk; reopen it before saving';
      break;
    default:
      reason = sanitizeUserText(details.message || 'unexpected error');
      break;
  }

  const summary = `${action} failed${progress}: ${reason}`;
  if (!recovery) return sanitizeUserText(summary, 220);
  return sanitizeUserText(
    `${summary}${/[.!?]$/u.test(summary) ? '' : '.'}${recovery}`,
    420,
  );
}
