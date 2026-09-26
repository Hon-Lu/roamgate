import type { IBuffer, IBufferLine, Terminal } from "@xterm/xterm";

const BOX_DRAWING_FIRST = 0x2500;
const BOX_DRAWING_LAST = 0x257f;
const CURSOR_SETTLE_MS = 120;
const CURSOR_REPLY_TIMEOUT_MS = 1000;
const MAX_MOVE_ROUNDS = 4;

/** A cell addressed by its buffer line, not its viewport row. */
export type TerminalBufferCell = { line: number; col: number };

/** The column of the row's first visible character. */
function textStart(line: IBufferLine) {
  for (let col = 0; col < line.length; col++) {
    if (line.getCell(col)?.getChars().trim()) return col;
  }
  return line.length;
}

/** The column just past the row's last visible character. */
function textEnd(line: IBufferLine) {
  for (let col = line.length - 1; col >= 0; col--) {
    const cell = line.getCell(col);
    if (cell && cell.getWidth() > 0 && cell.getChars().trim()) {
      return col + cell.getWidth();
    }
  }
  return 0;
}

// Blank rows and box-drawing rules, such as the edges of an agent's prompt,
// bound the input.
function isInputRow(line: IBufferLine | undefined) {
  const text = line?.translateToString(true).trim() ?? "";
  return Array.from(text).some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < BOX_DRAWING_FIRST || code > BOX_DRAWING_LAST;
  });
}

/**
 * Endpoint frames carry no soft-wrap information, so the cursor's input is
 * taken to span the rows around it up to a blank row or a box-drawing rule.
 */
function inputContains(buffer: IBuffer, cursorLine: number, line: number) {
  const step = line < cursorLine ? -1 : 1;
  for (let row = cursorLine; row !== line; ) {
    row += step;
    if (!isInputRow(buffer.getLine(row))) return false;
  }
  return true;
}

/**
 * Counts arrow presses between two cells, reading row by row. Leading blanks
 * on a following row are taken as the indent an app gives continuation lines.
 */
function charactersBetween(
  buffer: IBuffer,
  from: TerminalBufferCell,
  to: TerminalBufferCell,
) {
  let characters = 0;
  for (let row = from.line; row <= to.line; row++) {
    const line = buffer.getLine(row);
    if (!line) continue;
    const start = row === from.line ? from.col : textStart(line);
    const end = row === to.line ? to.col : textEnd(line);
    for (let col = start; col < end; col++) {
      if (line.getCell(col)?.getWidth() !== 0) characters++;
    }
  }
  return characters;
}

/**
 * Returns the arrow keys estimated to move a line editor's cursor to a cell
 * ("" when it is already there), or null when the cell is outside the
 * cursor's input. Arrow keys move by character, so a wide character's two
 * cells count once, and cells past the end of a row's text stop there.
 * Across rows the estimate misses the key that crosses an explicit newline;
 * TerminalCursorMover corrects it from the reported cursor.
 */
export function terminalCursorMoveSequence(
  buffer: IBuffer,
  target: TerminalBufferCell,
  applicationCursorKeys: boolean,
): string | null {
  if (buffer.type !== "normal") return null;
  const cursor = { line: buffer.baseY + buffer.cursorY, col: buffer.cursorX };
  if (!inputContains(buffer, cursor.line, target.line)) return null;
  const line = buffer.getLine(target.line);
  if (!line) return null;

  const reachableEnd =
    target.line === cursor.line
      ? Math.max(textEnd(line), cursor.col)
      : textEnd(line);
  let col = Math.min(target.col, reachableEnd);
  // A tap on the right half of a wide character lands on the character.
  if (col > 0 && line.getCell(col)?.getWidth() === 0) col--;
  const goal = { line: target.line, col };

  const forward =
    goal.line > cursor.line ||
    (goal.line === cursor.line && goal.col > cursor.col);
  const characters = forward
    ? charactersBetween(buffer, cursor, goal)
    : charactersBetween(buffer, goal, cursor);
  const key = `\x1b${applicationCursorKeys ? "O" : "["}${forward ? "C" : "D"}`;
  return key.repeat(characters);
}

type CursorTerminal = Pick<
  Terminal,
  "buffer" | "modes" | "input" | "onCursorMove"
>;

/**
 * Moves a line editor's cursor to a tapped cell with arrow keys. Each round
 * waits for the app to report the cursor back, then re-estimates from there.
 * Once the cursor reaches the tapped row, one exact same-row correction ends
 * the move, which keeps an unreachable cell from bouncing the cursor.
 */
export class TerminalCursorMover {
  private generation = 0;

  constructor(private readonly term: CursorTerminal) {}

  /** Starts a move, or returns false when the cell is outside the input. */
  moveTo(target: TerminalBufferCell): boolean {
    const sequence = this.sequence(target);
    if (sequence === null) return false;
    const generation = ++this.generation;
    void this.run(target, sequence, generation);
    return true;
  }

  /** Stops a move in progress, for example when the user types. */
  cancel(): void {
    this.generation++;
  }

  private sequence(target: TerminalBufferCell) {
    return terminalCursorMoveSequence(
      this.term.buffer.active,
      target,
      this.term.modes.applicationCursorKeysMode,
    );
  }

  private cursor() {
    const buffer = this.term.buffer.active;
    return { line: buffer.baseY + buffer.cursorY, col: buffer.cursorX };
  }

  private async run(
    target: TerminalBufferCell,
    first: string,
    generation: number,
  ) {
    let sequence: string | null = first;
    for (let round = 0; sequence && round < MAX_MOVE_ROUNDS; round++) {
      const before = this.cursor();
      const finalRound = before.line === target.line;
      this.term.input(sequence, true);
      await this.cursorSettled();
      if (generation !== this.generation || finalRound) return;
      const after = this.cursor();
      if (after.line === before.line && after.col === before.col) return;
      sequence = this.sequence(target);
    }
  }

  /** Resolves once the cursor stops moving or the app does not reply. */
  private cursorSettled() {
    return new Promise<void>((resolve) => {
      const done = () => {
        subscription.dispose();
        resolve();
      };
      let timer = setTimeout(done, CURSOR_REPLY_TIMEOUT_MS);
      const subscription = this.term.onCursorMove(() => {
        clearTimeout(timer);
        timer = setTimeout(done, CURSOR_SETTLE_MS);
      });
    });
  }
}
