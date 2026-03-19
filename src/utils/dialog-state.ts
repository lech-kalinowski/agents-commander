/**
 * Shared dialog state — prevents global key handlers from firing
 * while a dialog is open.
 */
let depth = 0;

export function enterDialog(): void { depth++; }
export function leaveDialog(): void { depth = Math.max(0, depth - 1); }
export function isDialogActive(): boolean { return depth > 0; }
