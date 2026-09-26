import type { ConnectionClient } from "./api";
import {
  detectShortcutPlatform,
  type ShortcutPlatform,
} from "./shortcutBindings";
import { store, useStoreSelector } from "./store";

type RevealClient = Pick<ConnectionClient, "call" | "isCurrent">;

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

// The server opens the file manager on its own desktop, so only a browser on
// that machine, talking to a local Herdr, is offered the menu item.
export function useCanRevealInFileManager() {
  const local = useStoreSelector((state) => {
    const connection = state.connections.find(
      (candidate) => candidate.id === state.activeConnectionId,
    );
    return connection !== undefined && !connection.ssh_destination;
  });
  return local && LOOPBACK_HOSTS.has(location.hostname);
}

// The browser runs on the server's machine, so its platform names the file
// manager that opens.
export function revealMenuLabel(
  directory: boolean,
  platform: ShortcutPlatform = detectShortcutPlatform(),
) {
  if (platform === "linux") {
    return directory ? "Open folder" : "Open containing folder";
  }
  const fileManager = platform === "mac" ? "Finder" : "File Explorer";
  return directory ? `Open in ${fileManager}` : `Reveal in ${fileManager}`;
}

/** Files open their containing folder; directories open themselves. */
export async function revealInFileManager(
  client: RevealClient,
  workspaceId: string,
  path: string,
) {
  try {
    await client.call("file.reveal", {
      workspace_id: workspaceId,
      path,
      ...(/^(?:\/|[a-z]:[\\/])/i.test(path) ? { scope: "filesystem" } : {}),
    });
  } catch (error) {
    if (!client.isCurrent()) return;
    store.notify({
      kind: "error",
      message: "Failed to open folder",
      detail: (error as Error).message,
    });
  }
}
