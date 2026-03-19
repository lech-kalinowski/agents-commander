/**
 * Virtual terminal emulator with full color/style support.
 * Processes raw PTY output (ANSI/xterm escape sequences) and maintains
 * a grid of styled character cells. Output includes embedded ANSI SGR
 * codes so blessed renders colors and attributes correctly.
 *
 * Supports: SGR colors (8/16/256/truecolor), cursor movement, erase ops,
 * scroll regions (DECSTBM), alternate screen buffer, insert/delete lines,
 * wide characters, zero-width joiners/combiners, mouse mode tracking.
 */

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

// ── Style representation ─────────────────────────────────────────

interface CellStyle {
  fg: number;  // -1 = default, 0-255 = indexed, >=256 = packed RGB (256 + r<<16 + g<<8 + b)
  bg: number;
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  reverse: boolean;
}

const DEFAULT_STYLE: CellStyle = {
  fg: -1, bg: -1,
  bold: false, dim: false, italic: false, underline: false, reverse: false,
};

interface Cell {
  char: string;   // '' for wide-char placeholder (second column)
  style: CellStyle;
}

// ── Style helpers ────────────────────────────────────────────────

function cloneStyle(s: CellStyle): CellStyle {
  return { fg: s.fg, bg: s.bg, bold: s.bold, dim: s.dim, italic: s.italic, underline: s.underline, reverse: s.reverse };
}

function stylesEqual(a: CellStyle, b: CellStyle): boolean {
  return a.fg === b.fg && a.bg === b.bg && a.bold === b.bold &&
    a.dim === b.dim && a.italic === b.italic && a.underline === b.underline &&
    a.reverse === b.reverse;
}

function isDefaultStyle(s: CellStyle): boolean {
  return s.fg === -1 && s.bg === -1 && !s.bold && !s.dim &&
    !s.italic && !s.underline && !s.reverse;
}

/** Build an ANSI SGR escape sequence for a style. */
function styleToAnsi(style: CellStyle): string {
  if (isDefaultStyle(style)) return '\x1b[0m';

  const p: number[] = [0]; // reset first
  if (style.bold) p.push(1);
  if (style.dim) p.push(2);
  if (style.italic) p.push(3);
  if (style.underline) p.push(4);
  if (style.reverse) p.push(7);

  // Foreground
  if (style.fg >= 0 && style.fg < 8) p.push(30 + style.fg);
  else if (style.fg >= 8 && style.fg < 16) p.push(90 + style.fg - 8);
  else if (style.fg >= 16 && style.fg < 256) p.push(38, 5, style.fg);
  else if (style.fg >= 256) {
    const c = style.fg - 256;
    p.push(38, 2, (c >> 16) & 0xFF, (c >> 8) & 0xFF, c & 0xFF);
  }

  // Background
  if (style.bg >= 0 && style.bg < 8) p.push(40 + style.bg);
  else if (style.bg >= 8 && style.bg < 16) p.push(100 + style.bg - 8);
  else if (style.bg >= 16 && style.bg < 256) p.push(48, 5, style.bg);
  else if (style.bg >= 256) {
    const c = style.bg - 256;
    p.push(48, 2, (c >> 16) & 0xFF, (c >> 8) & 0xFF, c & 0xFF);
  }

  return `\x1b[${p.join(';')}m`;
}

/** Determine terminal display width of a character (1 or 2). */
function charWidth(ch: string): 1 | 2 {
  const cp = ch.codePointAt(0) ?? 0;
  if (cp < 0x1100) return 1;
  if (
    (cp >= 0x1100 && cp <= 0x115F) ||
    (cp >= 0x231A && cp <= 0x231B) ||
    (cp >= 0x2329 && cp <= 0x232A) ||
    (cp >= 0x23E9 && cp <= 0x23F3) ||
    (cp >= 0x23F8 && cp <= 0x23FA) ||
    (cp >= 0x25FD && cp <= 0x25FE) ||
    (cp >= 0x2614 && cp <= 0x2615) ||
    (cp >= 0x2648 && cp <= 0x2653) ||
    (cp >= 0x267F && cp <= 0x267F) ||
    (cp >= 0x2693 && cp <= 0x2693) ||
    (cp >= 0x26A1 && cp <= 0x26A1) ||
    (cp >= 0x26AA && cp <= 0x26AB) ||
    (cp >= 0x26BD && cp <= 0x26BE) ||
    (cp >= 0x26C4 && cp <= 0x26C5) ||
    (cp >= 0x26D4 && cp <= 0x26D4) ||
    (cp >= 0x26EA && cp <= 0x26EA) ||
    (cp >= 0x26F2 && cp <= 0x26F3) ||
    (cp >= 0x26F5 && cp <= 0x26F5) ||
    (cp >= 0x26FA && cp <= 0x26FA) ||
    (cp >= 0x2702 && cp <= 0x27B0) ||
    (cp >= 0x2934 && cp <= 0x2935) ||
    (cp >= 0x2B05 && cp <= 0x2B07) ||
    (cp >= 0x2B1B && cp <= 0x2B1C) ||
    (cp >= 0x2B50 && cp <= 0x2B50) ||
    (cp >= 0x2B55 && cp <= 0x2B55) ||
    (cp >= 0x2E80 && cp <= 0xA4CF && cp !== 0x303F) ||
    (cp >= 0xAC00 && cp <= 0xD7AF) ||
    (cp >= 0xF900 && cp <= 0xFAFF) ||
    (cp >= 0xFE10 && cp <= 0xFE6F) ||
    (cp >= 0xFF01 && cp <= 0xFF60) ||
    (cp >= 0xFFE0 && cp <= 0xFFE6) ||
    (cp >= 0x1F000 && cp <= 0x1FAFF) ||
    (cp >= 0x20000 && cp <= 0x3FFFF)
  ) return 2;
  return 1;
}

/** Check if codepoint is a zero-width character (variation selectors, ZWJ, combining marks). */
function isZeroWidth(cp: number): boolean {
  return (
    (cp >= 0xFE00 && cp <= 0xFE0F) ||   // Variation Selectors
    (cp >= 0xE0100 && cp <= 0xE01EF) ||  // Variation Selectors Supplement
    cp === 0x200D ||                      // Zero Width Joiner
    cp === 0x200B ||                      // Zero Width Space
    cp === 0x200C ||                      // Zero Width Non-Joiner
    cp === 0x200E ||                      // LTR Mark
    cp === 0x200F ||                      // RTL Mark
    (cp >= 0x0300 && cp <= 0x036F) ||    // Combining Diacritical Marks
    (cp >= 0x1AB0 && cp <= 0x1AFF) ||    // Combining Diacritical Marks Extended
    (cp >= 0x20D0 && cp <= 0x20FF) ||    // Combining Diacritical Marks for Symbols
    (cp >= 0xFE20 && cp <= 0xFE2F)       // Combining Half Marks
  );
}

// ── Saved screen state for alternate buffer ─────────────────────

interface SavedScreen {
  grid: Cell[][];
  scrollback: string[];
  cursorRow: number;
  cursorCol: number;
  style: CellStyle;
  scrollTop: number;
  scrollBottom: number;
}

// ── VTerm ────────────────────────────────────────────────────────

export class VTerm {
  private cols: number;
  private rows: number;
  private grid: Cell[][];
  private cursorRow = 0;
  private cursorCol = 0;
  private scrollback: string[] = [];
  private maxScrollback: number;
  private buf = '';
  private style: CellStyle = { ...DEFAULT_STYLE };
  private savedCursor: { row: number; col: number; style: CellStyle } | null = null;

  // ── Scroll region ─────────────────────────────────────────────
  private scrollTop = 0;
  private scrollBottom: number;

  // ── Alternate screen buffer ───────────────────────────────────
  private altScreenSaved: SavedScreen | null = null;
  private _inAltScreen = false;

  // ── Mouse mode ────────────────────────────────────────────────
  /** Mouse tracking mode requested by the running agent.
   *  0 = off, 1000 = normal, 1002 = button-event, 1003 = any-event */
  private _mouseMode = 0;
  /** Whether SGR extended mouse encoding (\x1b[?1006h) is active. */
  private _mouseSgr = false;
  /** Cursor visibility (DECTCEM mode 25). Default: visible. */
  private _cursorVisible = true;

  /** True when the agent is using the alternate screen buffer (TUI mode). */
  get inAltScreen(): boolean { return this._inAltScreen; }

  /** True when the agent has enabled any mouse tracking mode. */
  get mouseEnabled(): boolean { return this._mouseMode > 0; }
  /** True when SGR mouse encoding is active (preferred for coords > 223). */
  get mouseSgr(): boolean { return this._mouseSgr; }
  get mouseMode(): number { return this._mouseMode; }
  /** True when the cursor should be displayed (DECTCEM mode 25). */
  get cursorVisible(): boolean { return this._cursorVisible; }
  /** Current cursor row (0-based). */
  get curRow(): number { return this.cursorRow; }
  /** Current cursor column (0-based). */
  get curCol(): number { return this.cursorCol; }

  constructor(cols = DEFAULT_COLS, rows = DEFAULT_ROWS, maxScrollback = 2000) {
    this.cols = cols;
    this.rows = rows;
    this.scrollBottom = rows - 1;
    this.maxScrollback = maxScrollback;
    this.grid = this.makeGrid();
  }

  private makeGrid(): Cell[][] {
    return Array.from({ length: this.rows }, () => this.makeRow());
  }

  private makeRow(): Cell[] {
    return Array.from({ length: this.cols }, (): Cell => ({
      char: ' ', style: cloneStyle(DEFAULT_STYLE),
    }));
  }

  resize(cols: number, rows: number): void {
    const oldGrid = this.grid;
    this.cols = cols;
    this.rows = rows;
    this.grid = this.makeGrid();
    for (let r = 0; r < Math.min(oldGrid.length, rows); r++) {
      for (let c = 0; c < Math.min(oldGrid[r].length, cols); c++) {
        this.grid[r][c] = oldGrid[r][c];
      }
    }
    this.cursorRow = Math.min(this.cursorRow, rows - 1);
    this.cursorCol = Math.min(this.cursorCol, cols - 1);
    this.scrollTop = 0;
    this.scrollBottom = rows - 1;
  }

  /** Feed raw data from the PTY. */
  write(data: string): void {
    this.buf += data;
    this.process();
  }

  /** Get all lines (scrollback + visible grid) with ANSI SGR codes.
   *  @param showCursor If true, render a visible cursor block at the cursor position
   *    regardless of DECTCEM state. Useful for focused terminal panels where TUI apps
   *    hide the terminal cursor and render their own (which our VTerm can't relay). */
  getLines(showCursor = false): string[] {
    // In alternate screen mode, no scrollback — just the grid
    const lines = this._inAltScreen ? [] : [...this.scrollback];
    const renderCursor = showCursor || this._cursorVisible;
    for (let r = 0; r < this.grid.length; r++) {
      if (renderCursor && r === this.cursorRow) {
        lines.push(this.renderRowWithCursor(this.grid[r], this.cursorCol));
      } else {
        lines.push(this.renderRow(this.grid[r]));
      }
    }
    return lines;
  }

  getTail(n: number): string[] {
    const all = this.getLines();
    return all.slice(-n);
  }

  /** Return visible grid rows as plain text (no SGR codes, trailing whitespace trimmed). */
  getGridPlainLines(): string[] {
    return this.grid.map((row) => this.renderRowPlain(row));
  }

  /** Number of lines that have scrolled off the visible grid. */
  get scrollbackLength(): number { return this.scrollback.length; }

  /** Get a scrollback line as plain text (SGR stripped). */
  getScrollbackPlain(index: number): string {
    const raw = this.scrollback[index] ?? '';
    // Scrollback lines contain SGR codes only (no cursor positioning)
    return raw.replace(/\x1b\[[0-9;]*m/g, '');
  }

  /** Render a grid row as plain text (no escape codes). */
  private renderRowPlain(row: Cell[]): string {
    let last = row.length - 1;
    while (last >= 0 && row[last].char === ' ' && row[last].style.bg === -1) last--;
    let out = '';
    for (let i = 0; i <= last; i++) {
      out += row[i].char === '' ? '' : row[i].char; // skip wide-char placeholders
    }
    return out;
  }

  // ── Rendering ──────────────────────────────────────────────────

  /** Convert a row of cells to a string with embedded ANSI SGR codes. */
  private renderRow(row: Cell[]): string {
    const parts: string[] = [];
    let cur: CellStyle = { ...DEFAULT_STYLE };
    let styled = false;

    // Find last non-empty cell (trim trailing spaces without bg).
    let last = row.length - 1;
    while (last >= 0) {
      const c = row[last];
      if (c.char !== ' ' || c.style.bg !== -1) break;
      last--;
    }

    for (let i = 0; i <= last; i++) {
      const cell = row[i];
      if (cell.char === '') continue; // wide-char placeholder

      if (!stylesEqual(cur, cell.style)) {
        if (isDefaultStyle(cell.style) && styled) {
          parts.push('\x1b[0m');
          styled = false;
        } else if (!isDefaultStyle(cell.style)) {
          parts.push(styleToAnsi(cell.style));
          styled = true;
        }
        cur = cell.style;
      }
      parts.push(cell.char);
    }

    if (styled) parts.push('\x1b[0m');
    return parts.join('');
  }

  /** Render a row with a visible block cursor at the given column. */
  private renderRowWithCursor(row: Cell[], curCol: number): string {
    const parts: string[] = [];
    let cur: CellStyle = { ...DEFAULT_STYLE };
    let styled = false;

    // Ensure we render at least up to the cursor position
    let last = row.length - 1;
    while (last >= 0) {
      const c = row[last];
      if (c.char !== ' ' || c.style.bg !== -1) break;
      last--;
    }
    if (curCol > last) last = curCol;

    for (let i = 0; i <= last; i++) {
      const cell = row[i];
      if (cell.char === '') continue; // wide-char placeholder

      if (i === curCol) {
        // Render cursor as inverse video block
        if (styled) { parts.push('\x1b[0m'); styled = false; }
        parts.push('\x1b[7m'); // reverse video
        parts.push(cell.char === ' ' ? ' ' : cell.char);
        parts.push('\x1b[0m');
        cur = { ...DEFAULT_STYLE };
        continue;
      }

      if (!stylesEqual(cur, cell.style)) {
        if (isDefaultStyle(cell.style) && styled) {
          parts.push('\x1b[0m');
          styled = false;
        } else if (!isDefaultStyle(cell.style)) {
          parts.push(styleToAnsi(cell.style));
          styled = true;
        }
        cur = cell.style;
      }
      parts.push(cell.char);
    }

    if (styled) parts.push('\x1b[0m');
    return parts.join('');
  }

  // ── Processing ─────────────────────────────────────────────────

  private process(): void {
    const buf = this.buf;
    if (!buf) return;

    let i = 0;
    while (i < buf.length) {
      const ch = buf[i];

      // ── Escape sequences ───────────────────────────────────
      if (ch === '\x1b') {
        const remaining = buf.slice(i);

        // CSI: ESC [ ... letter
        // Params may use colons as sub-parameter separators (modern SGR)
        const csiMatch = remaining.match(/^\x1b\[([?!>]?)([0-9;:]*)([ -/]*[A-Za-z@`])/);
        if (csiMatch) {
          // Normalize colons to semicolons for handleCSI (sub-params are
          // treated as regular params — good enough for SGR color support)
          this.handleCSI(csiMatch[1], csiMatch[2].replace(/:/g, ';'), csiMatch[3]);
          i += csiMatch[0].length;
          continue;
        }

        // OSC: ESC ] ... (ST or BEL)
        const oscMatch = remaining.match(/^\x1b\]([^\x07\x1b]*)(\x07|\x1b\\)/);
        if (oscMatch) {
          i += oscMatch[0].length;
          continue;
        }

        // DCS: ESC P ... ST  (Device Control String — e.g. tmux, sixel)
        const dcsMatch = remaining.match(/^\x1bP([^\x1b]*)(\x1b\\)/);
        if (dcsMatch) {
          i += dcsMatch[0].length;
          continue;
        }

        // APC: ESC _ ... ST  (Application Program Command)
        const apcMatch = remaining.match(/^\x1b_([^\x1b]*)(\x1b\\)/);
        if (apcMatch) {
          i += apcMatch[0].length;
          continue;
        }

        // ESC 7 — save cursor
        if (remaining.length >= 2 && remaining[1] === '7') {
          this.savedCursor = { row: this.cursorRow, col: this.cursorCol, style: cloneStyle(this.style) };
          i += 2;
          continue;
        }

        // ESC 8 — restore cursor
        if (remaining.length >= 2 && remaining[1] === '8') {
          if (this.savedCursor) {
            this.cursorRow = this.savedCursor.row;
            this.cursorCol = this.savedCursor.col;
            this.style = cloneStyle(this.savedCursor.style);
          }
          i += 2;
          continue;
        }

        // ESC M — reverse index (move cursor up, scroll if at top of region)
        if (remaining.length >= 2 && remaining[1] === 'M') {
          if (this.cursorRow === this.scrollTop) {
            this.scrollDown();
          } else if (this.cursorRow > 0) {
            this.cursorRow--;
          }
          i += 2;
          continue;
        }

        // ESC c — full reset
        if (remaining.length >= 2 && remaining[1] === 'c') {
          this.grid = this.makeGrid();
          this.cursorRow = 0;
          this.cursorCol = 0;
          this.style = { ...DEFAULT_STYLE };
          this.scrollTop = 0;
          this.scrollBottom = this.rows - 1;
          i += 2;
          continue;
        }

        // SS2/SS3: ESC N / ESC O — single-shift character set
        if (remaining.length >= 2 && (remaining[1] === 'N' || remaining[1] === 'O')) {
          if (remaining.length >= 3) {
            i += 3;
            continue;
          }
          this.buf = remaining;
          return;
        }

        // ESC ( / ESC ) — character set selection (3 bytes: ESC, designator, charset)
        if (remaining.length >= 2 && (remaining[1] === '(' || remaining[1] === ')')) {
          if (remaining.length >= 3) {
            i += 3;
            continue;
          }
          this.buf = remaining;
          return;
        }

        // ESC = / ESC > — keypad mode
        if (remaining.length >= 2 && (remaining[1] === '=' || remaining[1] === '>')) {
          i += 2;
          continue;
        }

        // ── Incomplete escape detection ──────────────────────
        if (remaining.length === 1) {
          this.buf = remaining;
          return;
        }

        if (remaining[1] === '[' || remaining[1] === ']' ||
            remaining[1] === 'P' || remaining[1] === '_') {
          if (remaining.length < 4096) {
            this.buf = remaining;
            return;
          }
          i += 1;
          continue;
        }

        i += 2;
        continue;
      }

      // ── Control characters ─────────────────────────────────
      if (ch === '\r') {
        this.cursorCol = 0;
        i++;
        continue;
      }

      if (ch === '\n') {
        this.lineFeed();
        i++;
        continue;
      }

      if (ch === '\b') {
        if (this.cursorCol > 0) this.cursorCol--;
        i++;
        continue;
      }

      if (ch === '\t') {
        this.cursorCol = Math.min(this.cols - 1, (this.cursorCol + 8) & ~7);
        i++;
        continue;
      }

      // ── Bulk processing of printable characters ────────────
      // Find the next control char or ESC
      let nextControl = buf.indexOf('\x1b', i);
      const nextR = buf.indexOf('\r', i);
      const nextN = buf.indexOf('\n', i);
      const nextB = buf.indexOf('\b', i);
      const nextT = buf.indexOf('\t', i);

      const candidates = [nextControl, nextR, nextN, nextB, nextT].filter(idx => idx !== -1);
      nextControl = candidates.length > 0 ? Math.min(...candidates) : buf.length;

      const chunk = buf.slice(i, nextControl);
      for (let j = 0; j < chunk.length; ) {
        const cp = chunk.codePointAt(j) ?? 0;
        if (cp < 32) { j++; continue; }

        if (isZeroWidth(cp)) {
          if (this.cursorCol > 0) {
            const char = String.fromCodePoint(cp);
            this.grid[this.cursorRow][this.cursorCol - 1].char += char;
          }
          j += cp > 0xFFFF ? 2 : 1;
          continue;
        }

        const printChar = cp > 0xFFFF ? String.fromCodePoint(cp) : chunk[j];
        const w = charWidth(printChar);

        if (this.cursorCol + w > this.cols) {
          this.cursorCol = 0;
          this.lineFeed();
        }

        this.grid[this.cursorRow][this.cursorCol] = {
          char: printChar,
          style: cloneStyle(this.style),
        };

        if (w === 2 && this.cursorCol + 1 < this.cols) {
          this.grid[this.cursorRow][this.cursorCol + 1] = { char: '', style: cloneStyle(this.style) };
        }

        this.cursorCol += w;
        if (this.cursorCol >= this.cols) this.cursorCol = this.cols - 1;
        j += cp > 0xFFFF ? 2 : 1;
      }

      i = nextControl;
    }

    this.buf = '';
  }

  // ── Line feed / scroll ─────────────────────────────────────────

  private lineFeed(): void {
    if (this.cursorRow < this.scrollBottom) {
      this.cursorRow++;
    } else if (this.cursorRow === this.scrollBottom) {
      this.scrollUp();
    }
    // If cursor is below scroll region, just move down if possible
    else if (this.cursorRow < this.rows - 1) {
      this.cursorRow++;
    }
  }

  /** Scroll content up within the scroll region by one line. */
  private scrollUp(): void {
    // Push top row to scrollback only for full-screen scroll in main buffer
    if (this.scrollTop === 0 && this.scrollBottom === this.rows - 1 && !this._inAltScreen) {
      this.scrollback.push(this.renderRow(this.grid[0]));
      if (this.scrollback.length > this.maxScrollback) {
        this.scrollback.shift();
      }
    }
    // Remove top row of scroll region
    this.grid.splice(this.scrollTop, 1);
    // Insert blank row at bottom of scroll region
    this.grid.splice(this.scrollBottom, 0, this.makeRow());
  }

  /** Scroll content down within the scroll region by one line. */
  private scrollDown(): void {
    // Remove bottom row of scroll region
    this.grid.splice(this.scrollBottom, 1);
    // Insert blank row at top of scroll region
    this.grid.splice(this.scrollTop, 0, this.makeRow());
  }

  // ── Alternate screen buffer ──────────────────────────────────

  private enterAltScreen(): void {
    if (this._inAltScreen) return;
    this.altScreenSaved = {
      grid: this.grid,
      scrollback: this.scrollback,
      cursorRow: this.cursorRow,
      cursorCol: this.cursorCol,
      style: cloneStyle(this.style),
      scrollTop: this.scrollTop,
      scrollBottom: this.scrollBottom,
    };
    this.grid = this.makeGrid();
    this.scrollback = [];
    this.cursorRow = 0;
    this.cursorCol = 0;
    this.scrollTop = 0;
    this.scrollBottom = this.rows - 1;
    this._inAltScreen = true;
  }

  private leaveAltScreen(): void {
    if (!this._inAltScreen || !this.altScreenSaved) return;
    this.grid = this.altScreenSaved.grid;
    this.scrollback = this.altScreenSaved.scrollback;
    this.cursorRow = this.altScreenSaved.cursorRow;
    this.cursorCol = this.altScreenSaved.cursorCol;
    this.style = this.altScreenSaved.style;
    this.scrollTop = this.altScreenSaved.scrollTop;
    this.scrollBottom = this.altScreenSaved.scrollBottom;
    this.altScreenSaved = null;
    this._inAltScreen = false;
  }

  // ── CSI handler ────────────────────────────────────────────────

  private handleCSI(prefix: string, params: string, suffix: string): void {
    const cmd = suffix.charAt(suffix.length - 1);
    const nums = params ? params.split(';').map((n) => parseInt(n, 10) || 0) : [];
    const n = nums[0] || 1;

    switch (cmd) {
      case 'A': // Cursor up
        this.cursorRow = Math.max(0, this.cursorRow - n);
        break;
      case 'B': // Cursor down
        this.cursorRow = Math.min(this.rows - 1, this.cursorRow + n);
        break;
      case 'C': // Cursor forward
        this.cursorCol = Math.min(this.cols - 1, this.cursorCol + n);
        break;
      case 'D': // Cursor back
        this.cursorCol = Math.max(0, this.cursorCol - n);
        break;
      case 'E': // Cursor next line
        this.cursorCol = 0;
        this.cursorRow = Math.min(this.rows - 1, this.cursorRow + n);
        break;
      case 'F': // Cursor previous line
        this.cursorCol = 0;
        this.cursorRow = Math.max(0, this.cursorRow - n);
        break;
      case 'G': // Cursor horizontal absolute
        this.cursorCol = Math.min(this.cols - 1, Math.max(0, n - 1));
        break;
      case 'H': // Cursor position
      case 'f':
        this.cursorRow = Math.min(this.rows - 1, Math.max(0, (nums[0] || 1) - 1));
        this.cursorCol = Math.min(this.cols - 1, Math.max(0, (nums[1] || 1) - 1));
        break;
      case 'd': // VPA — Vertical Position Absolute (line position)
        this.cursorRow = Math.min(this.rows - 1, Math.max(0, n - 1));
        break;
      case 'J': // Erase in display
        this.eraseDisplay(nums[0] || 0);
        break;
      case 'K': // Erase in line
        this.eraseLine(nums[0] || 0);
        break;
      case 'X': // ECH — Erase characters (replace with spaces, cursor doesn't move)
        {
          const row = this.grid[this.cursorRow];
          const end = Math.min(this.cols, this.cursorCol + n);
          for (let c = this.cursorCol; c < end; c++) {
            row[c] = { char: ' ', style: cloneStyle(DEFAULT_STYLE) };
          }
        }
        break;
      case 'L': // IL — Insert lines (within scroll region)
        {
          const count = Math.min(n, this.scrollBottom - this.cursorRow + 1);
          for (let j = 0; j < count; j++) {
            this.grid.splice(this.scrollBottom, 1);
            this.grid.splice(this.cursorRow, 0, this.makeRow());
          }
        }
        break;
      case 'M': // DL — Delete lines (within scroll region)
        {
          const count = Math.min(n, this.scrollBottom - this.cursorRow + 1);
          for (let j = 0; j < count; j++) {
            this.grid.splice(this.cursorRow, 1);
            this.grid.splice(this.scrollBottom, 0, this.makeRow());
          }
        }
        break;
      case 'P': // DCH — Delete characters
        {
          const row = this.grid[this.cursorRow];
          row.splice(this.cursorCol, n);
          while (row.length < this.cols) row.push({ char: ' ', style: cloneStyle(DEFAULT_STYLE) });
        }
        break;
      case '@': // ICH — Insert characters
        {
          const row = this.grid[this.cursorRow];
          for (let j = 0; j < n; j++) {
            row.splice(this.cursorCol, 0, { char: ' ', style: cloneStyle(DEFAULT_STYLE) });
          }
          row.length = this.cols;
        }
        break;
      case 'S': // SU — Scroll up (content moves up, blank lines appear at bottom)
        for (let j = 0; j < n; j++) this.scrollUp();
        break;
      case 'T': // SD — Scroll down (content moves down, blank lines appear at top)
        for (let j = 0; j < n; j++) this.scrollDown();
        break;
      case 'b': // REP — Repeat the preceding graphic character n times
        if (this.cursorCol > 0) {
          const prevChar = this.grid[this.cursorRow][this.cursorCol - 1].char;
          if (prevChar && prevChar !== ' ') {
            for (let j = 0; j < n; j++) {
              if (this.cursorCol >= this.cols) break;
              this.grid[this.cursorRow][this.cursorCol] = {
                char: prevChar,
                style: cloneStyle(this.style),
              };
              this.cursorCol++;
            }
            if (this.cursorCol >= this.cols) this.cursorCol = this.cols - 1;
          }
        }
        break;
      case 'm': // SGR — Select Graphic Rendition
        this.handleSGR(nums);
        break;
      case 's': // Save cursor position (ANSI.SYS)
        this.savedCursor = { row: this.cursorRow, col: this.cursorCol, style: cloneStyle(this.style) };
        break;
      case 'u': // Restore cursor position (ANSI.SYS)
        if (this.savedCursor) {
          this.cursorRow = this.savedCursor.row;
          this.cursorCol = this.savedCursor.col;
          this.style = cloneStyle(this.savedCursor.style);
        }
        break;
      case 'r': // DECSTBM — Set scroll region
        if (nums.length >= 2 && nums[0] > 0 && nums[1] > 0) {
          this.scrollTop = Math.max(0, nums[0] - 1);
          this.scrollBottom = Math.min(this.rows - 1, nums[1] - 1);
        } else {
          // Reset scroll region to full screen
          this.scrollTop = 0;
          this.scrollBottom = this.rows - 1;
        }
        // DECSTBM moves cursor to home
        this.cursorRow = 0;
        this.cursorCol = 0;
        break;
      case 'h': // SM / DECSET — Set mode (DEC private modes)
        if (prefix === '?') {
          for (const p of nums) {
            if (p === 25) this._cursorVisible = true;    // DECTCEM
            if (p === 1049 || p === 47 || p === 1047) this.enterAltScreen();
            if (p === 1000 || p === 1002 || p === 1003) this._mouseMode = p;
            if (p === 1006) this._mouseSgr = true;
          }
        }
        break;
      case 'l': // RM / DECRST — Reset mode
        if (prefix === '?') {
          for (const p of nums) {
            if (p === 25) this._cursorVisible = false;   // DECTCEM
            if (p === 1049 || p === 47 || p === 1047) this.leaveAltScreen();
            if (p === 1000 || p === 1002 || p === 1003) {
              if (this._mouseMode === p) this._mouseMode = 0;
            }
            if (p === 1006) this._mouseSgr = false;
          }
        }
        break;
      case 'n': // DSR — Device status report
      case 'c': // DA — Send device attributes
      case 'q': // DECSCUSR — Set cursor style
      case 't': // XTWINOPS — Window manipulation
        break;
      default:
        break;
    }
  }

  // ── SGR (color/style) handler ──────────────────────────────────

  private handleSGR(nums: number[]): void {
    if (nums.length === 0) nums = [0];

    let i = 0;
    while (i < nums.length) {
      const p = nums[i];
      switch (p) {
        case 0:
          this.style = { ...DEFAULT_STYLE };
          break;
        case 1: this.style.bold = true; break;
        case 2: this.style.dim = true; break;
        case 3: this.style.italic = true; break;
        case 4: this.style.underline = true; break;
        case 7: this.style.reverse = true; break;
        case 8: break; // Hidden — not tracked
        case 9: break; // Strikethrough — not tracked
        case 21: this.style.bold = false; break;
        case 22: this.style.bold = false; this.style.dim = false; break;
        case 23: this.style.italic = false; break;
        case 24: this.style.underline = false; break;
        case 27: this.style.reverse = false; break;
        case 28: break; // Reveal (hidden off)
        case 29: break; // Strikethrough off
        // Standard foreground colors
        case 30: case 31: case 32: case 33:
        case 34: case 35: case 36: case 37:
          this.style.fg = p - 30;
          break;
        case 38: // Extended foreground
          if (i + 1 < nums.length && nums[i + 1] === 5 && i + 2 < nums.length) {
            this.style.fg = nums[i + 2];
            i += 2;
          } else if (i + 1 < nums.length && nums[i + 1] === 2 && i + 4 < nums.length) {
            this.style.fg = 256 + ((nums[i + 2] & 0xFF) << 16) + ((nums[i + 3] & 0xFF) << 8) + (nums[i + 4] & 0xFF);
            i += 4;
          }
          break;
        case 39: this.style.fg = -1; break;
        // Standard background colors
        case 40: case 41: case 42: case 43:
        case 44: case 45: case 46: case 47:
          this.style.bg = p - 40;
          break;
        case 48: // Extended background
          if (i + 1 < nums.length && nums[i + 1] === 5 && i + 2 < nums.length) {
            this.style.bg = nums[i + 2];
            i += 2;
          } else if (i + 1 < nums.length && nums[i + 1] === 2 && i + 4 < nums.length) {
            this.style.bg = 256 + ((nums[i + 2] & 0xFF) << 16) + ((nums[i + 3] & 0xFF) << 8) + (nums[i + 4] & 0xFF);
            i += 4;
          }
          break;
        case 49: this.style.bg = -1; break;
        // Bright foreground colors
        case 90: case 91: case 92: case 93:
        case 94: case 95: case 96: case 97:
          this.style.fg = p - 90 + 8;
          break;
        // Bright background colors
        case 100: case 101: case 102: case 103:
        case 104: case 105: case 106: case 107:
          this.style.bg = p - 100 + 8;
          break;
        default:
          break;
      }
      i++;
    }
  }

  // ── Erase operations ───────────────────────────────────────────

  private eraseDisplay(mode: number): void {
    switch (mode) {
      case 0: // From cursor to end
        this.eraseLine(0);
        for (let r = this.cursorRow + 1; r < this.rows; r++) {
          this.grid[r] = this.makeRow();
        }
        break;
      case 1: // From start to cursor
        for (let r = 0; r < this.cursorRow; r++) {
          this.grid[r] = this.makeRow();
        }
        for (let c = 0; c <= this.cursorCol; c++) {
          this.grid[this.cursorRow][c] = { char: ' ', style: cloneStyle(DEFAULT_STYLE) };
        }
        break;
      case 2: // Entire display
      case 3: // Entire display + scrollback (xterm)
        this.grid = this.makeGrid();
        break;
    }
  }

  private eraseLine(mode: number): void {
    const row = this.grid[this.cursorRow];
    switch (mode) {
      case 0: // From cursor to end
        for (let c = this.cursorCol; c < this.cols; c++) {
          row[c] = { char: ' ', style: cloneStyle(DEFAULT_STYLE) };
        }
        break;
      case 1: // From start to cursor
        for (let c = 0; c <= this.cursorCol; c++) {
          row[c] = { char: ' ', style: cloneStyle(DEFAULT_STYLE) };
        }
        break;
      case 2: // Entire line
        this.grid[this.cursorRow] = this.makeRow();
        break;
    }
  }
}
