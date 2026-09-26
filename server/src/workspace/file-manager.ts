import { realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { assertInsideRoot } from "./file-paths";
import { explorerWindows, focusNewExplorerWindow } from "./windows-focus";

export type FileRevealResult = {
  path: string;
  type: "file" | "directory";
};

export function isLoopbackAddress(address: string) {
  return /^(?:127\.|::1$|::ffff:127\.)/.test(address);
}

// Files open their containing folder, selected where the platform's file
// manager supports it; directories open themselves.
export function fileManagerCommand(
  platform: NodeJS.Platform,
  target: string,
  directory: boolean,
): string[] {
  if (platform === "win32") {
    return directory
      ? ["explorer.exe", target]
      : ["explorer.exe", `/select,${target}`];
  }
  if (platform === "darwin") {
    return directory ? ["open", target] : ["open", "-R", target];
  }
  return ["xdg-open", directory ? target : dirname(target)];
}

function spawnFileManager(argv: string[]) {
  const before =
    process.platform === "win32" ? tryExplorerWindows() : undefined;
  // explorer.exe exits non-zero even after opening a window, so only a
  // failure to start the opener is reported.
  const proc = Bun.spawn(argv, {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  });
  proc.unref();
  // Focusing is best effort; the window is open either way.
  if (before) void focusNewExplorerWindow(before).catch(() => {});
}

function tryExplorerWindows() {
  try {
    return explorerWindows();
  } catch {
    return undefined;
  }
}

/**
 * Opens the host's file manager at a workspace path. Relative paths stay
 * inside the checkout; absolute paths come from opt-in filesystem browsing.
 */
export async function revealLocalPath(
  rootPath: string,
  requestedPath: string,
  {
    platform = process.platform,
    spawn = spawnFileManager,
  }: {
    platform?: NodeJS.Platform;
    spawn?: (argv: string[]) => void;
  } = {},
): Promise<FileRevealResult> {
  const rootReal = await realpath(rootPath);
  const requestedAbsolute = isAbsolute(requestedPath);
  const targetReal = await realpath(
    requestedAbsolute ? requestedPath : resolve(rootReal, requestedPath),
  );
  if (!requestedAbsolute) assertInsideRoot(rootReal, targetReal);
  const directory = (await stat(targetReal)).isDirectory();
  const argv = fileManagerCommand(platform, targetReal, directory);
  try {
    spawn(argv);
  } catch (error) {
    throw new Error(
      `Unable to start the file manager (${argv[0]}): ${(error as Error).message}`,
      { cause: error },
    );
  }
  return { path: targetReal, type: directory ? "directory" : "file" };
}
