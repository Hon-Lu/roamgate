import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import type { Root } from "react-dom/client";
import type { TerminalInputMode } from "../terminalInputMode";

// Real React commits are essential here: the safety and restore layout effects
// must run in order before Type's synchronous, user-gesture focus handoff.
// Keep module mocks out of the shared test runner and unrelated store tests.
if (process.env.ROAMGATE_INPUT_MODE_DOM_TEST !== "1") {
  test("terminal input preference regressions in an isolated runtime", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, ROAMGATE_INPUT_MODE_DOM_TEST: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (code !== 0) throw new Error(`${stdout}\n${stderr}`);
    expect(code).toBe(0);
  }, 15_000);
} else {
  await registerDomTests();
}

async function registerDomTests() {
  const browser = new Window({ url: "http://localhost" });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({
    window: browser,
    document: browser.document,
    navigator: browser.navigator,
    HTMLElement: browser.HTMLElement,
    Element: browser.Element,
    Node: browser.Node,
    Event: browser.Event,
    CustomEvent: browser.CustomEvent,
    ResizeObserver: browser.ResizeObserver,
    localStorage: browser.localStorage,
    sessionStorage: browser.sessionStorage,
    requestAnimationFrame: browser.requestAnimationFrame.bind(browser),
    cancelAnimationFrame: browser.cancelAnimationFrame.bind(browser),
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      value,
      writable: true,
      configurable: true,
    });
  }
  // Exercise the phone input gate, even when the test runner has no touchscreen.
  browser.matchMedia = ((query: string) => ({
    matches: query.includes("pointer: coarse"),
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => true,
    onchange: null,
  })) as unknown as typeof browser.matchMedia;
  const { act, createElement, StrictMode } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { flushSync } = await import("react-dom");
  const noop = () => {};
  const disposable = () => ({ dispose: noop });
  type Pane = {
    pane_id: string;
    terminal_id: string;
    workspace_id: string;
    tab_id: string;
    agent: string;
  };
  const paneA: Pane = {
    pane_id: "pane-a",
    terminal_id: "terminal-a",
    workspace_id: "workspace-a",
    tab_id: "tab-a",
    agent: "claude",
  };
  const paneB: Pane = {
    ...paneA,
    pane_id: "pane-b",
    terminal_id: "terminal-b",
  };
  const initialState = () => ({
    activeConnectionId: "connection-a",
    defaultConnectionId: "connection-a",
    connectionGeneration: 1,
    connectionPaused: false,
    connections: [{ id: "connection-a", generation: 1 }],
    layout: {
      tab_id: "tab-a",
      focused_pane_id: "pane-a",
      area: { x: 0, y: 0, width: 80, height: 24 },
      panes: [paneA, paneB].map((pane) => ({
        ...pane,
        rect: { x: 0, y: 0, width: 40, height: 24 },
      })),
    },
    panes: [paneA, paneB],
    selectedPaneId: "pane-a",
    status: "connected",
    terminalAttachEpoch: 0,
    endpointAvailability: {},
    error: "",
  });
  let state = initialState();
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  const clients = new Map<string, object>();
  mock.module("../store", () => ({
    store: {
      get: () => state,
      terminalScrollReason: () => null,
      setTerminalEndpoint: noop,
      notify: noop,
      clearNotice: noop,
    },
    useStoreSelector: (selector: (value: typeof state) => unknown) =>
      selector(state),
    shallowEqual: Object.is,
    terminalNavigationLoading: () => false,
  }));
  mock.module("../api", () => ({
    bridge: {
      connection(id: string, runtime: number) {
        const generation = state.connectionGeneration;
        const key = `${id}:${generation}:${runtime}`;
        if (!clients.has(key)) {
          clients.set(key, {
            generation,
            isCurrent: () =>
              state.activeConnectionId === id &&
              state.connectionGeneration === generation &&
              state.connections.find((value) => value.id === id)?.generation ===
                runtime,
            acceptsServerGeneration: () => true,
            call: async (method: string, params: Record<string, unknown>) => {
              calls.push({ method, params });
              return {};
            },
          });
        }
        return clients.get(key);
      },
      onTerminal: () => noop,
      onTerminalClipboard: () => noop,
      onTerminalClosed: () => noop,
    },
  }));
  mock.module("../layoutPreferences", () => ({
    isMobileLayout: () => true,
    LAYOUT_CHANGE_EVENT: "test-layout-change",
  }));
  mock.module("./CreateWorkspaceDialog", () => ({
    CreateWorkspaceDialog: () => null,
  }));
  mock.module("./HerdrSetupCard", () => ({ HerdrSetupCard: () => null }));
  mock.module("./TerminalFileLinkMenu", () => ({
    TerminalFileLinkMenu: () => null,
  }));
  mock.module("./AnnotationComposerPopover", () => ({
    AnnotationComposerPopover: () => null,
  }));
  mock.module("../terminalLinkProvider", () => ({
    registerTerminalLinkProvider: disposable,
  }));
  mock.module("@xterm/addon-clipboard", () => ({ ClipboardAddon: class {} }));
  mock.module("@xterm/addon-unicode-graphemes", () => ({
    UnicodeGraphemesAddon: class {},
  }));
  mock.module("@xterm/addon-fit", () => ({
    FitAddon: class {
      fit() {}
      proposeDimensions() {
        return { cols: 80, rows: 24 };
      }
    },
  }));
  const terminals: FakeTerminal[] = [];
  class FakeTerminal {
    private currentOptions: Record<string, unknown> = {};
    get options() {
      return this.currentOptions;
    }
    set options(value: Record<string, unknown>) {
      Object.assign(this.currentOptions, value);
    }
    cols = 80;
    rows = 24;
    buffer = {
      active: { viewportY: 0, baseY: 0, length: 24, getLine: () => undefined },
    };
    modes = { mouseTrackingMode: "none" };
    element!: HTMLDivElement;
    textarea!: HTMLTextAreaElement;
    onDataCallback: (text: string) => void = noop;
    focusCount = 0;
    disposed = false;
    constructor(options: Record<string, unknown>) {
      this.options = options;
      terminals.push(this);
    }
    open(container: HTMLElement) {
      this.element = document.createElement("div");
      this.element.className = "xterm";
      this.textarea = document.createElement("textarea");
      this.textarea.className = "xterm-helper-textarea";
      this.element.append(this.textarea);
      container.append(this.element);
    }
    focus() {
      this.focusCount++;
      this.textarea.focus();
    }
    blur() {
      this.textarea.blur();
    }
    onData(callback: (text: string) => void) {
      this.onDataCallback = callback;
      return disposable();
    }
    onRender = disposable;
    onSelectionChange = disposable;
    onResize = disposable;
    loadAddon = noop;
    refresh = noop;
    reset = noop;
    clearSelection = noop;
    attachCustomKeyEventHandler = noop;
    hasSelection = () => false;
    getSelection = () => "";
    getSelectionPosition = () => undefined;
    write(_text: string, parsed?: () => void) {
      parsed?.();
    }
    dispose() {
      this.disposed = true;
      this.element.remove();
    }
  }
  mock.module("@xterm/xterm", () => ({ Terminal: FakeTerminal }));
  const { TerminalView } = await import("./TerminalView");
  const { TERMINAL_INPUT_MODE_STORAGE_KEY } = await import(
    "../terminalInputMode"
  );
  const { roamgateLocalStorage } = await import("../browserStorage");
  const storageKey = `roamgate:${TERMINAL_INPUT_MODE_STORAGE_KEY}`;
  let root: Root | null = null;
  let container: HTMLDivElement;
  let open = false;
  let strict = false;
  let explicitPane: string | undefined;
  beforeEach(() => {
    state = initialState();
    calls.length = 0;
    terminals.length = 0;
    clients.clear();
    localStorage.clear();
    sessionStorage.clear();
    open = false;
    strict = false;
    explicitPane = undefined;
  });
  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    root = null;
    document.body.replaceChildren();
    await browser.happyDOM.whenAsyncComplete();
  });
  afterAll(async () => {
    mock.restore();
    await browser.happyDOM.close();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  function render() {
    const view = createElement(TerminalView, {
      paneId: explicitPane,
      terminalTheme: {},
      terminalFontFamily: "monospace",
      terminalFontScale: 1,
      showMobileKeys: false,
      mobileShortcuts: [[], []],
      mobileSideShortcuts: [],
      composerOpen: open,
      onComposerOpenChange(next: boolean) {
        open = next;
        render();
      },
    });
    root!.render(strict ? createElement(StrictMode, null, view) : view);
  }
  async function mount(initiallyOpen = false, strictMode = false) {
    open = initiallyOpen;
    strict = strictMode;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => render());
  }
  const currentTerminal = () => terminals[terminals.length - 1]!;
  const selectedMode = () =>
    [
      ...container.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
    ].find((input) => input.checked)?.value;
  const savedMode = () => localStorage.getItem(storageKey);
  async function click(selector: string) {
    const element = container.querySelector<HTMLElement>(selector);
    expect(element).not.toBeNull();
    await act(async () =>
      element!.dispatchEvent(
        new browser.MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          detail: 1,
        }) as unknown as MouseEvent,
      ),
    );
  }
  const choose = (mode: TerminalInputMode) => click(`input[value="${mode}"]`);
  async function setOpen(next: boolean) {
    open = next;
    await act(async () => render());
  }
  async function patch(values: Partial<typeof state>) {
    state = { ...state, ...values };
    await act(async () => render());
  }
  function expectInputBlocked(term = currentTerminal()) {
    const before = calls.filter(
      (call) => call.method === "terminal.input",
    ).length;
    expect(term.options.disableStdin).toBe(true);
    expect(term.textarea.readOnly).toBe(true);
    act(() => term.onDataCallback("blocked"));
    expect(
      calls.filter((call) => call.method === "terminal.input"),
    ).toHaveLength(before);
  }
  async function typeGesture() {
    // Match MobileSheetHandle's Type click: open+commit, then synchronously focus
    // the dock root, whose handler routes focus, all in one gesture.
    await act(async () => {
      flushSync(() => {
        open = true;
        render();
      });
      const target = container.querySelector<HTMLElement>(".terminal-composer");
      expect(target).not.toBeNull();
      target!.focus({ preventScroll: true });
      // Assert during the gesture, before act can flush any later work.
      if (
        selectedMode() === "direct" &&
        state.status === "connected" &&
        !state.connectionPaused
      ) {
        expect(document.activeElement).toBe(currentTerminal().textarea);
        expect(currentTerminal().options.disableStdin).toBe(false);
      }
    });
  }

  test.each([null, "", "DIRECT", "invalid", "composer"])(
    "opening defaults safely to Composer for stored %s",
    async (value) => {
      if (value !== null) localStorage.setItem(storageKey, value);
      await mount();
      await setOpen(true);
      expect(selectedMode()).toBe("composer");
      expect(savedMode()).toBe(value);
      expectInputBlocked();
    },
  );

  test("Type focuses the native draft immediately for default Composer", async () => {
    await mount();
    await typeGesture();
    expect(selectedMode()).toBe("composer");
    expect(document.activeElement).toBe(
      container.querySelector('[aria-label="Terminal input draft"]'),
    );
    expect(savedMode()).toBeNull();
    expectInputBlocked();
    expect(currentTerminal().focusCount).toBe(0);
  });

  test("manual mode choices survive close and reopen without opening stdin", async () => {
    await mount();
    await setOpen(true);
    await choose("direct");
    expect(selectedMode()).toBe("direct");
    expect(savedMode()).toBe("direct");
    expect(document.activeElement).toBe(currentTerminal().textarea);
    await click('[aria-label="Close terminal input"]');
    expect(container.querySelector(".terminal-composer")).toBeNull();
    expectInputBlocked();
    await setOpen(true);
    expect(selectedMode()).toBe("direct");
    expectInputBlocked();
    await choose("composer");
    expect(savedMode()).toBe("composer");
    await setOpen(false);
    await setOpen(true);
    expect(selectedMode()).toBe("composer");
    expectInputBlocked();
  });

  test("saved Direct restores after unmount and a new closed dock", async () => {
    await mount();
    await setOpen(true);
    await choose("direct");
    await act(async () => root!.unmount());
    root = null;
    await mount();
    await setOpen(true);
    expect(selectedMode()).toBe("direct");
    expect(savedMode()).toBe("direct");
    expectInputBlocked();
  });

  test("an initially open dock restores saved Direct without activating input", async () => {
    localStorage.setItem(storageKey, "direct");
    await mount(true);
    expect(selectedMode()).toBe("direct");
    expect(savedMode()).toBe("direct");
    expectInputBlocked();
    expect(currentTerminal().focusCount).toBe(0);
  });

  test("StrictMode initially-open dock restores Direct without enabling stdin", async () => {
    localStorage.setItem(storageKey, "direct");
    await mount(true, true);
    expect(selectedMode()).toBe("direct");
    expect(savedMode()).toBe("direct");
    expectInputBlocked();
    expect(terminals.every((term) => term.focusCount === 0)).toBe(true);
    await patch({ connectionGeneration: 2 });
    expect(selectedMode()).toBe("composer");
    expect(savedMode()).toBe("direct");
    expectInputBlocked();
    expect(terminals.every((term) => term.focusCount === 0)).toBe(true);
  });

  test("storage-backed Direct restores on first opening after a page reload", async () => {
    // Seed the durable browser key directly, with no remembered module choice.
    localStorage.setItem(storageKey, "direct");
    await mount();
    await typeGesture();
    expect(selectedMode()).toBe("direct");
    expect(savedMode()).toBe("direct");
    expect(currentTerminal().options.disableStdin).toBe(false);
    expect(document.activeElement).toBe(currentTerminal().textarea);
  });

  test("Commands temporarily switches to Composer without saving", async () => {
    await mount();
    await setOpen(true);
    await choose("direct");
    await click('[aria-label="Commands"]');
    expect(selectedMode()).toBe("composer");
    expect(savedMode()).toBe("direct");
    expectInputBlocked();
    await setOpen(false);
    await setOpen(true);
    expect(selectedMode()).toBe("direct");
    expectInputBlocked();
  });

  test.each([
    "status",
    "paused",
    "pane",
    "connection",
    "generation",
    "attach epoch",
    "inactive split",
  ])(
    "%s safety reset preserves saved Direct and blocks stale input",
    async (change) => {
      if (change === "inactive split") explicitPane = "pane-a";
      await mount();
      await setOpen(true);
      await choose("direct");
      const previousTerminal = currentTerminal();
      const previousFocusCount = previousTerminal.focusCount;
      if (change === "status") await patch({ status: "disconnected" });
      if (change === "paused") await patch({ connectionPaused: true });
      if (change === "pane") await patch({ selectedPaneId: "pane-b" });
      if (change === "inactive split")
        await patch({ selectedPaneId: "pane-b" });
      if (change === "connection")
        await patch({
          activeConnectionId: "connection-b",
          connections: [{ id: "connection-b", generation: 1 }],
        });
      if (change === "generation") await patch({ connectionGeneration: 2 });
      if (change === "attach epoch") await patch({ terminalAttachEpoch: 1 });
      expect(selectedMode()).toBe("composer");
      expect(savedMode()).toBe("direct");
      expectInputBlocked();
      expect(currentTerminal().focusCount).toBe(
        currentTerminal() === previousTerminal ? previousFocusCount : 0,
      );
      expect(document.activeElement).not.toBe(currentTerminal().textarea);
      const before = calls.filter(
        (call) => call.method === "terminal.input",
      ).length;
      act(() => previousTerminal.onDataCallback("stale"));
      expect(
        calls.filter((call) => call.method === "terminal.input"),
      ).toHaveLength(before);
    },
  );

  test("reconnect does not reopen Direct until another explicit Type gesture", async () => {
    await mount();
    await setOpen(true);
    await choose("direct");
    await patch({ status: "disconnected" });
    await patch({ status: "connected" });
    expect(selectedMode()).toBe("composer");
    expectInputBlocked();
    expect(currentTerminal().focusCount).toBe(1);
    expect(savedMode()).toBe("direct");
    await setOpen(false);
    await typeGesture();
    expect(selectedMode()).toBe("direct");
    expect(currentTerminal().options.disableStdin).toBe(false);
    expect(currentTerminal().textarea.readOnly).toBe(false);
    act(() => currentTerminal().onDataCallback("new-session"));
    expect(
      calls.filter((call) => call.method === "terminal.input").slice(-1)[0]
        ?.params.terminal_id,
    ).toBe("terminal-a");
  });

  test("Type uses current pane and connection refs after a safe reset", async () => {
    roamgateLocalStorage.setItem(TERMINAL_INPUT_MODE_STORAGE_KEY, "direct");
    await mount();
    await patch({
      selectedPaneId: "pane-b",
      activeConnectionId: "connection-b",
      connections: [{ id: "connection-b", generation: 2 }],
      connectionGeneration: 2,
    });
    await typeGesture();
    expect(selectedMode()).toBe("direct");
    expect(currentTerminal().options.disableStdin).toBe(false);
    expect(document.activeElement).toBe(currentTerminal().textarea);
    act(() => currentTerminal().onDataCallback("current"));
    expect(
      calls.filter((call) => call.method === "terminal.input").slice(-1)[0]
        ?.params.terminal_id,
    ).toBe("terminal-b");
  });

  test("opening while disconnected stays safe and retains the preference", async () => {
    localStorage.setItem(storageKey, "direct");
    await mount();
    await patch({ status: "disconnected" });
    await typeGesture();
    expect(selectedMode()).toBe("composer");
    expect(savedMode()).toBe("direct");
    expectInputBlocked();
    await patch({ status: "connected" });
    expect(selectedMode()).toBe("composer");
    expectInputBlocked();
  });
}
