import { expect, jest, test } from "bun:test";
import { Terminal } from "@xterm/xterm";
import {
  TerminalCursorMover,
  terminalCursorMoveSequence,
} from "./terminalCursorMove";

const LEFT = "\x1b[D";
const RIGHT = "\x1b[C";

// Writes a screen, then places the cursor at a zero-based cell.
async function screen(text: string, cursor: { row: number; col: number }) {
  const term = new Terminal({ allowProposedApi: true, cols: 20, rows: 4 });
  await new Promise<void>((resolve) =>
    term.write(`${text}\x1b[${cursor.row + 1};${cursor.col + 1}H`, resolve),
  );
  return term;
}

test("moves left and right along the cursor's row", async () => {
  const term = await screen("$ echo hello", { row: 0, col: 12 });
  try {
    const buffer = term.buffer.active;
    expect(terminalCursorMoveSequence(buffer, { line: 0, col: 7 }, false)).toBe(
      LEFT.repeat(5),
    );
    expect(
      terminalCursorMoveSequence(buffer, { line: 0, col: 12 }, false),
    ).toBe("");
  } finally {
    term.dispose();
  }
});

test("counts a wide character once", async () => {
  const wide = String.fromCodePoint(0x4e2d, 0x6587);
  const term = await screen(`> ${wide}ab`, { row: 0, col: 2 });
  try {
    const buffer = term.buffer.active;
    // Both CJK characters take two cells each; "a" starts at column 6.
    expect(terminalCursorMoveSequence(buffer, { line: 0, col: 6 }, false)).toBe(
      RIGHT.repeat(2),
    );
    // The right half of a wide character lands on the character itself.
    expect(terminalCursorMoveSequence(buffer, { line: 0, col: 5 }, false)).toBe(
      RIGHT,
    );
  } finally {
    term.dispose();
  }
});

test("stops at the end of the row's text", async () => {
  const term = await screen("$ ls", { row: 0, col: 2 });
  try {
    expect(
      terminalCursorMoveSequence(
        term.buffer.active,
        { line: 0, col: 15 },
        false,
      ),
    ).toBe(RIGHT.repeat(2));
  } finally {
    term.dispose();
  }
});

test("uses application cursor keys when the app enables them", async () => {
  const term = await screen("$ ls", { row: 0, col: 4 });
  try {
    expect(
      terminalCursorMoveSequence(term.buffer.active, { line: 0, col: 2 }, true),
    ).toBe("\x1bOD\x1bOD");
  } finally {
    term.dispose();
  }
});

test("counts across rows of a wrapped command", async () => {
  // Thirty characters after the prompt wrap onto a second 20-column row.
  const term = await screen(`$ ${"a".repeat(30)}`, { row: 1, col: 12 });
  try {
    expect(
      terminalCursorMoveSequence(
        term.buffer.active,
        { line: 0, col: 5 },
        false,
      ),
    ).toBe(LEFT.repeat(27));
  } finally {
    term.dispose();
  }
});

test("skips the indent of a continuation row", async () => {
  // Agent prompts indent wrapped text to line up after the prompt.
  const rows = `> ${"a".repeat(18)}\x1b[2;1H  ${"b".repeat(5)}`;
  const term = await screen(rows, { row: 1, col: 7 });
  try {
    expect(
      terminalCursorMoveSequence(
        term.buffer.active,
        { line: 0, col: 5 },
        false,
      ),
    ).toBe(LEFT.repeat(20));
  } finally {
    term.dispose();
  }
});

test("treats blank rows, rules, and the alternate screen as outside input", async () => {
  const rule = String.fromCodePoint(0x2500).repeat(8);
  for (const text of ["output\r\n\r\n$ ls", `output\r\n${rule}\r\n$ ls`]) {
    const term = await screen(text, { row: 2, col: 4 });
    try {
      expect(
        terminalCursorMoveSequence(
          term.buffer.active,
          { line: 0, col: 2 },
          false,
        ),
      ).toBeNull();
    } finally {
      term.dispose();
    }
  }
  const term = await screen("$ ls\x1b[?1049h", { row: 0, col: 0 });
  try {
    expect(
      terminalCursorMoveSequence(
        term.buffer.active,
        { line: 0, col: 0 },
        false,
      ),
    ).toBeNull();
  } finally {
    term.dispose();
  }
});

// A line editor holding an explicit newline after 18 characters. Crossing it
// takes one more arrow key than the first estimate counts.
function newlineEditor() {
  const rows = [`> ${"a".repeat(18)}`, `  ${"b".repeat(5)}`];
  const editor = { caret: 24 };
  const position = () =>
    editor.caret <= 18
      ? { line: 0, col: 2 + editor.caret }
      : { line: 1, col: 2 + editor.caret - 19 };
  const listeners = new Set<() => void>();
  const row = (text: string) => ({
    length: 20,
    getCell: (col: number) => ({
      getWidth: () => 1,
      getChars: () => text[col] ?? "",
    }),
    translateToString: () => text,
  });
  const term = {
    buffer: {
      active: {
        type: "normal",
        baseY: 0,
        viewportY: 0,
        get cursorY() {
          return position().line;
        },
        get cursorX() {
          return position().col;
        },
        getLine: (line: number) =>
          rows[line] === undefined ? undefined : row(rows[line]),
      },
    },
    modes: { applicationCursorKeysMode: false },
    input(data: string) {
      const left = data.split(LEFT).length - 1;
      const right = data.split(RIGHT).length - 1;
      editor.caret = Math.max(0, Math.min(24, editor.caret - left + right));
      // The app reports its cursor back after the input arrives.
      queueMicrotask(() => {
        for (const listener of listeners) listener();
      });
    },
    onCursorMove(listener: () => void) {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
  };
  return {
    editor,
    term: term as unknown as ConstructorParameters<
      typeof TerminalCursorMover
    >[0],
  };
}

async function settleCursor() {
  for (let i = 0; i < 3; i++) await Promise.resolve();
  jest.advanceTimersByTime(1000);
  for (let i = 0; i < 3; i++) await Promise.resolve();
}

test("corrects a cross-row estimate from the reported cursor", async () => {
  jest.useFakeTimers();
  try {
    const { editor, term } = newlineEditor();
    const mover = new TerminalCursorMover(term);

    // Tapping column 5 of the first row targets caret 3.
    expect(mover.moveTo({ line: 0, col: 5 })).toBe(true);
    expect(editor.caret).toBe(4);
    await settleCursor();
    expect(editor.caret).toBe(3);
    await settleCursor();
    expect(editor.caret).toBe(3);
  } finally {
    jest.useRealTimers();
  }
});

test("stops correcting once cancelled", async () => {
  jest.useFakeTimers();
  try {
    const { editor, term } = newlineEditor();
    const mover = new TerminalCursorMover(term);

    expect(mover.moveTo({ line: 0, col: 5 })).toBe(true);
    mover.cancel();
    await settleCursor();
    expect(editor.caret).toBe(4);
  } finally {
    jest.useRealTimers();
  }
});
