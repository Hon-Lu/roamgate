import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { observeDialogsForGlobalMenu } from "./useCloseGlobalMenuForDialog";

// happy-dom does not paint stacking contexts. Guard the intended ordering here;
// real elementFromPoint overlap checks remain part of phone browser acceptance.
test("menus cover the editor without blocking More-to-Tabs navigation", async () => {
  const css = await Bun.file(
    new URL("../styles/layout/mobile-nav.css", import.meta.url),
  ).text();
  const topbar = await Bun.file(
    new URL("../styles/layout/topbar.css", import.meta.url),
  ).text();
  const connection = await Bun.file(
    new URL("./ConnectionSwitcher.css", import.meta.url),
  ).text();
  expect(css).toMatch(/\.mobile-bottom-bar\s*\{[^}]*z-index: 131;/);
  expect(topbar).toMatch(/\.topbar\s*\{[^}]*z-index: 120;/);
  expect(css).toMatch(
    /\.topbar:has\(\.config-dropdown\)\s*\{[^}]*z-index: 134;/,
  );
  expect(css).toMatch(/\.mobile-more-backdrop\s*\{[^}]*z-index: 130;/);
  expect(css).toMatch(/\.mobile-controls-stack\s*\{[^}]*z-index: 132;/);
  expect(connection).toMatch(
    /\.connection-switcher-popover\s*\{[^}]*z-index: 140;/,
  );
});

test("global menus yield to nested, new and revealed dialogs, and unsubscribe", async () => {
  const browser = new Window();
  try {
    const root = browser.document.body;
    root.innerHTML =
      '<div class="app"><div class="modal-backdrop" hidden></div></div>';
    const dialog = root.querySelector(".modal-backdrop")!;
    let closes = 0;
    const stop = observeDialogsForGlobalMenu(
      root as unknown as HTMLElement,
      () => closes++,
    );
    expect(closes).toBe(0);
    dialog.removeAttribute("hidden");
    await browser.happyDOM.whenAsyncComplete();
    expect(closes).toBe(1);
    stop();
    dialog.remove();
    root.firstElementChild!.appendChild(dialog);
    await browser.happyDOM.whenAsyncComplete();
    expect(closes).toBe(1);
    const stopExisting = observeDialogsForGlobalMenu(
      root as unknown as HTMLElement,
      () => closes++,
    );
    expect(closes).toBe(2);
    stopExisting();
    dialog.remove();
    const stopNew = observeDialogsForGlobalMenu(
      root as unknown as HTMLElement,
      () => closes++,
    );
    root.firstElementChild!.appendChild(dialog);
    await browser.happyDOM.whenAsyncComplete();
    expect(closes).toBe(3);
    stopNew();
  } finally {
    await browser.happyDOM.close();
  }
});
