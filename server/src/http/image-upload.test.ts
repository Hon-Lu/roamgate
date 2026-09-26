import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join } from "node:path";
import {
  createImageUploadHandler,
  defaultImageUploadDirectory,
} from "./image-upload";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function uploadDirectory() {
  const root = await mkdtemp(join(tmpdir(), "roamgate-image-upload-"));
  roots.push(root);
  return join(root, "roamgate", "images");
}

function upload(bytes: number[], ext?: string) {
  return new Request("http://localhost/api/upload-image", {
    method: "POST",
    headers: ext ? { "x-image-ext": ext } : {},
    body: new Uint8Array(bytes),
  });
}

test("local pastes default to a Roamgate folder under the OS temp directory", () => {
  expect(defaultImageUploadDirectory()).toBe(
    join(tmpdir(), "roamgate", "images"),
  );
});

test("local pastes are written to the upload folder with a native absolute path", async () => {
  const directory = await uploadDirectory();
  const handle = createImageUploadHandler({
    sshHost: () => undefined,
    localDirectory: () => directory,
  });
  const bytes = [137, 80, 78, 71];

  const response = await handle(upload(bytes, "PNG"));
  const body = (await response.json()) as { path: string; remote: boolean };

  expect(response.status).toBe(200);
  expect(body.remote).toBe(false);
  expect(isAbsolute(body.path)).toBe(true);
  expect(dirname(body.path)).toBe(directory);
  expect(basename(body.path)).toMatch(/^img-\d+-[a-z0-9]+\.png$/);
  expect([...(await readFile(body.path))]).toEqual(bytes);
});

test("unsafe extension characters are dropped from the file name", async () => {
  const directory = await uploadDirectory();
  const handle = createImageUploadHandler({
    sshHost: () => undefined,
    localDirectory: () => directory,
  });

  const response = await handle(upload([1], "../j.p-g"));
  const body = (await response.json()) as { path: string };

  expect(dirname(body.path)).toBe(directory);
  expect(basename(body.path)).toMatch(/^img-\d+-[a-z0-9]+\.jpg$/);
});

test("empty uploads are rejected without creating the folder", async () => {
  const directory = await uploadDirectory();
  const handle = createImageUploadHandler({
    sshHost: () => undefined,
    localDirectory: () => directory,
  });

  const response = await handle(upload([]));

  expect(response.status).toBe(400);
  expect(await Bun.file(directory).exists()).toBe(false);
});
