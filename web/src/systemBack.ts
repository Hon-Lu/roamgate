import { useEffect, useRef } from "react";
import { useLayoutPreferences } from "./layoutPreferences";

/**
 * How a layer stacks for the phone's Back: a panel (Composer, a mobile view
 * such as Workspaces or Files) sits below a popup (the tab sheet). Back
 * closes the highest open layer; equal levels close newest first.
 */
export type SystemBackLevel = "panel" | "popup";
const LEVELS: Record<SystemBackLevel, number> = { panel: 0, popup: 1 };

type Layer = { level: number; order: number; close: () => void };

/**
 * Lets the phone's Back gesture or button close an open mobile layer before
 * it leaves the page. While any layer is open, the current history entry is
 * one guard entry at the current URL. Back pops it and closes only the top
 * layer; the guard returns while layers remain. When the last layer closes
 * on screen, the guard is removed again, so the next Back leaves the page in
 * one press.
 */
export function useSystemBack(
  open: boolean,
  close: () => void,
  level: SystemBackLevel,
) {
  const { mobile } = useLayoutPreferences();
  const closeRef = useRef(close);
  closeRef.current = close;
  const active = mobile && open;

  useEffect(() => {
    if (!active) return;
    const layer: Layer = {
      level: LEVELS[level],
      order: ++openings,
      close: () => closeRef.current(),
    };
    layers.add(layer);
    scheduleReconcile();
    return () => {
      layers.delete(layer);
      scheduleReconcile();
    };
  }, [active, level]);
}

const GUARD = "roamgateBack";
const BASE = "roamgateBackBase";
const layers = new Set<Layer>();
let openings = 0;
let guards = 0;
let previousState: unknown;
let forwardBase: string | undefined;
// A real document departure is not an on-screen React unmount.
let leaving = false;
let reconcileScheduled = false;
// history.back() is asynchronous; until our own Back lands, the current entry
// is stale and a popstate is ours, not the user's.
let backPending = false;

function isGuard(state: unknown) {
  return typeof state === "object" && state !== null && GUARD in state;
}

function baseId(state: unknown): string | undefined {
  if (typeof state !== "object" || state === null || !(BASE in state)) return;
  const value = (state as Record<string, unknown>)[BASE];
  return typeof value === "string" ? value : undefined;
}

// Effects of one React commit run together; reconcile once after all of them,
// so layers that open and close in the same commit settle as one change.
function scheduleReconcile() {
  if (reconcileScheduled) return;
  reconcileScheduled = true;
  queueMicrotask(reconcile);
}

function reconcile() {
  reconcileScheduled = false;
  if (backPending || leaving) return;
  const guarded = isGuard(window.history.state);
  if (layers.size > 0) forwardBase = undefined;
  if (layers.size > 0 && !guarded) {
    const state: unknown = window.history.state;
    // Pair the entries so an obsolete guard can be crossed in either direction.
    const base = {
      ...(typeof state === "object" && state ? state : {}),
      [BASE]: `${Date.now()}:${++guards}`,
    };
    window.history.replaceState(base, "");
    window.history.pushState({ ...base, [GUARD]: true }, "");
    previousState = window.history.state;
  } else if (layers.size === 0 && guarded && forwardBase === undefined) {
    backPending = true;
    window.history.back();
  }
}

if (typeof window !== "undefined") {
  previousState = window.history.state;
  window.addEventListener("pagehide", () => {
    leaving = true;
    forwardBase = undefined;
  });
  window.addEventListener("pageshow", () => {
    leaving = false;
    previousState = window.history.state;
    scheduleReconcile();
  });
  // A restored/reloaded guard has no UI state of its own. Return to its base
  // without pushing another entry or truncating valid Forward history.
  scheduleReconcile();
  window.addEventListener("popstate", (event) => {
    const from = previousState;
    previousState = event.state;
    if (backPending) {
      backPending = false;
      reconcile();
      return;
    }
    if (forwardBase !== undefined) {
      const id = forwardBase;
      forwardBase = undefined;
      if (
        layers.size === 0 &&
        !isGuard(event.state) &&
        baseId(event.state) === id
      ) {
        backPending = true;
        window.history.back();
        return;
      }
    }
    const id = baseId(event.state);
    if (
      layers.size === 0 &&
      isGuard(event.state) &&
      id !== undefined &&
      !isGuard(from) &&
      baseId(from) === id
    ) {
      // Continue Forward past an empty guard. At the end, its next Back skips
      // the paired base instead of consuming an extra press.
      forwardBase = id;
      window.history.forward();
      return;
    }
    if (isGuard(event.state) || layers.size === 0) {
      scheduleReconcile();
      return;
    }
    let top: Layer | undefined;
    for (const layer of layers)
      if (
        !top ||
        layer.level > top.level ||
        (layer.level === top.level && layer.order > top.order)
      )
        top = layer;
    // The user's Back already removed the guard: nothing to undo.
    layers.delete(top!);
    top!.close();
    scheduleReconcile();
  });
}
