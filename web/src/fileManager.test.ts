import { expect, test } from "bun:test";
import { revealInFileManager, revealMenuLabel } from "./fileManager";

function fakeClient() {
  const calls: Array<[string, unknown]> = [];
  return {
    calls,
    client: {
      isCurrent: () => true,
      call: async (method: string, params?: unknown) => {
        calls.push([method, params]);
        return {};
      },
    },
  };
}

test("labels name the host's file manager", () => {
  expect(revealMenuLabel(false, "windows")).toBe("Reveal in File Explorer");
  expect(revealMenuLabel(true, "windows")).toBe("Open in File Explorer");
  expect(revealMenuLabel(false, "mac")).toBe("Reveal in Finder");
  expect(revealMenuLabel(true, "mac")).toBe("Open in Finder");
  expect(revealMenuLabel(false, "linux")).toBe("Open containing folder");
  expect(revealMenuLabel(true, "linux")).toBe("Open folder");
});

test("checkout paths stay workspace-scoped", async () => {
  const { calls, client } = fakeClient();
  await revealInFileManager(client, "w1", "docs/guide.md");
  expect(calls).toEqual([
    ["file.reveal", { workspace_id: "w1", path: "docs/guide.md" }],
  ]);
});

test("absolute paths use the filesystem scope", async () => {
  const { calls, client } = fakeClient();
  await revealInFileManager(client, "w1", "C:\\Users\\me\\notes.md");
  await revealInFileManager(client, "w1", "/home/me/notes");
  expect(calls).toEqual([
    [
      "file.reveal",
      {
        workspace_id: "w1",
        path: "C:\\Users\\me\\notes.md",
        scope: "filesystem",
      },
    ],
    [
      "file.reveal",
      { workspace_id: "w1", path: "/home/me/notes", scope: "filesystem" },
    ],
  ]);
});
