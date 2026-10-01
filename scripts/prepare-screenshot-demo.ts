#!/usr/bin/env bun
import { execFileSync } from "node:child_process";
import {
  cpSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const repository = realpathSync(fileURLToPath(new URL("..", import.meta.url)));
const template = join(repository, "scripts/screenshot-demo/project");
const marker = ".roamgate-screenshot-demo.json";
const identity = { kind: "roamgate-screenshot-demo", version: 1 };

function contains(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return (
    path === "" ||
    (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path))
  );
}

function canonicalDestination(path: string): string {
  let parent = dirname(path);
  const missing = [basename(path)];
  while (!lstatIfPresent(parent)) {
    missing.unshift(basename(parent));
    parent = dirname(parent);
  }
  return join(realpathSync(parent), ...missing);
}

function git(directory: string, ...args: string[]): string {
  // Ignore personal Git identities, hooks, templates, config and GIT_* overrides.
  const empty = process.platform === "win32" ? "NUL" : "/dev/null";
  return execFileSync("git", ["-c", `core.attributesFile=${empty}`, ...args], {
    cwd: directory,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_ATTR_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: empty,
      GIT_AUTHOR_NAME: "Demo",
      GIT_AUTHOR_EMAIL: "demo@example.invalid",
      GIT_COMMITTER_NAME: "Demo",
      GIT_COMMITTER_EMAIL: "demo@example.invalid",
      GIT_AUTHOR_DATE: "2026-01-01T12:00:00+0000",
      GIT_COMMITTER_DATE: "2026-01-01T12:00:00+0000",
      GIT_TERMINAL_PROMPT: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

export function prepareScreenshotDemo({
  directory,
  scene = "review",
  reset = false,
}: {
  directory: string;
  scene?: "base" | "review";
  reset?: boolean;
}): { directory: string; backup?: string } {
  if (scene !== "base" && scene !== "review") {
    throw new Error("Scene must be base or review.");
  }
  const requested = resolve(directory);
  if (contains(repository, requested) || contains(requested, repository)) {
    throw new Error("Choose a destination outside the Roamgate checkout.");
  }
  const destination = canonicalDestination(requested);
  if (contains(repository, destination) || contains(destination, repository)) {
    throw new Error("Choose a destination outside the Roamgate checkout.");
  }
  mkdirSync(dirname(destination), { recursive: true });
  let backup: string | undefined;
  if (lstatIfPresent(destination)) {
    if (!reset)
      throw new Error(
        "Destination exists; use --reset to preserve it and start again.",
      );
    if (!lstatSync(destination).isDirectory()) {
      throw new Error("Refusing to reset a symlink or non-directory.");
    }
    const markerPath = join(destination, marker);
    if (!lstatIfPresent(markerPath)?.isFile()) {
      throw new Error("Refusing to reset a directory without the demo marker.");
    }
    const saved = JSON.parse(readFileSync(markerPath, "utf8"));
    if (saved.kind !== identity.kind || saved.version !== identity.version) {
      throw new Error("Refusing to reset an unrecognized demo directory.");
    }
    backup = `${destination}.saved-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    renameSync(destination, backup);
  }
  // mkdir without recursive mode refuses a concurrently created destination.
  let created: ReturnType<typeof lstatSync> | undefined;
  try {
    mkdirSync(destination);
    created = lstatSync(destination);
    for (const name of readdirSync(template)) {
      cpSync(join(template, name), join(destination, name), {
        recursive: true,
        errorOnExist: true,
        force: false,
      });
    }
    writeFileSync(join(destination, marker), `${JSON.stringify(identity)}\n`);
    git(destination, "init", "--quiet", "--initial-branch=main", "--template=");
    mkdirSync(join(destination, ".git/info"), { recursive: true });
    writeFileSync(join(destination, ".git/info/exclude"), `/${marker}\n`);
    git(destination, "config", "user.name", "Demo");
    git(destination, "config", "user.email", "demo@example.invalid");
    git(destination, "config", "commit.gpgsign", "false");
    git(destination, "add", ".");
    git(destination, "commit", "--quiet", "-m", "Create Northstar task board");
    git(destination, "switch", "--quiet", "-c", "feat/status-filter");
    if (scene === "review") {
      git(
        destination,
        "apply",
        join(repository, "scripts/screenshot-demo/feature.patch"),
      );
    }
    return { directory: destination, backup };
  } catch (error) {
    const current = lstatIfPresent(destination);
    if (
      created &&
      current?.isDirectory() &&
      current.dev === created.dev &&
      current.ino === created.ino
    ) {
      rmSync(destination, { recursive: true, force: true });
    }
    let recovery = "";
    if (backup) {
      if (!lstatIfPresent(destination)) {
        renameSync(backup, destination);
        recovery = " Original demo restored.";
      } else {
        recovery = ` Previous demo preserved: ${backup}`;
      }
    }
    throw new Error(
      `Preparation failed: ${(error as Error).message}${recovery}`,
      { cause: error },
    );
  }
}

function lstatIfPresent(path: string) {
  try {
    return lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

if (import.meta.main) {
  try {
    const { values } = parseArgs({
      options: {
        dir: {
          type: "string",
          default: join(tmpdir(), "roamgate-demo", "northstar"),
        },
        scene: { type: "string", default: "review" },
        reset: { type: "boolean", default: false },
        help: { type: "boolean" },
      },
      strict: true,
      allowPositionals: false,
    });
    if (values.help) {
      console.log(
        "Usage: bun run demo:prepare [--scene base|review] [--dir PATH] [--reset]",
      );
    } else {
      if (values.scene !== "base" && values.scene !== "review") {
        throw new Error("Scene must be base or review.");
      }
      const result = prepareScreenshotDemo({
        directory: values.dir!,
        scene: values.scene,
        reset: values.reset,
      });
      if (result.backup)
        console.log(`Previous demo preserved: ${result.backup}`);
      console.log(`Northstar (${values.scene}): ${result.directory}`);
      console.log("Run bun test and bun run dev from that directory.");
      console.log(
        "Use a dedicated OS account or VM for privacy-safe Herdr and agent screenshots.",
      );
    }
  } catch (error) {
    console.error(`demo:prepare: ${(error as Error).message}`);
    process.exitCode = 1;
  }
}
