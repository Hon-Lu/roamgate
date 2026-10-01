import { afterAll, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareScreenshotDemo } from "./prepare-screenshot-demo";

const temporary = mkdtempSync(join(tmpdir(), "roamgate-demo-test-"));
afterAll(() => rmSync(temporary, { recursive: true, force: true }));

function git(directory: string, ...args: string[]) {
  return execFileSync("git", args, {
    cwd: directory,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
    },
  }).trim();
}

test("base and review have reproducible Git history, real passing tests and a fixed diff", () => {
  const base = prepareScreenshotDemo({
    directory: join(temporary, "base"),
    scene: "base",
  });
  const review = prepareScreenshotDemo({
    directory: join(temporary, "review"),
  });
  const repeat = prepareScreenshotDemo({
    directory: join(temporary, "repeat"),
  });
  expect(git(base.directory, "status", "--porcelain")).toBe("");
  expect(git(base.directory, "rev-parse", "HEAD")).toBe(
    git(review.directory, "rev-parse", "HEAD"),
  );
  expect(git(review.directory, "rev-parse", "HEAD")).toBe(
    git(repeat.directory, "rev-parse", "HEAD"),
  );
  expect(git(review.directory, "diff")).toBe(git(repeat.directory, "diff"));
  expect(git(review.directory, "diff", "--name-only").split("\n")).toEqual([
    "app.ts",
    "index.html",
    "styles.css",
    "tasks.test.ts",
    "tasks.ts",
  ]);
  expect(git(base.directory, "log", "-1", "--format=%an <%ae>")).toBe(
    "Demo <demo@example.invalid>",
  );
  expect(git(base.directory, "remote")).toBe("");
  expect(git(review.directory, "branch", "--show-current")).toBe(
    "feat/status-filter",
  );
  for (const demo of [base, review]) {
    const result = Bun.spawnSync([process.execPath, "test"], {
      cwd: demo.directory,
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode, result.stderr.toString()).toBe(0);
  }
});

test("reset preserves edits in a sibling backup and restores the requested scene", () => {
  const directory = join(temporary, "reset");
  prepareScreenshotDemo({ directory });
  writeFileSync(join(directory, "notes.txt"), "Keep my review notes.\n");
  const reset = prepareScreenshotDemo({
    directory,
    scene: "base",
    reset: true,
  });
  expect(reset.backup).toBeDefined();
  expect(readFileSync(join(reset.backup!, "notes.txt"), "utf8")).toBe(
    "Keep my review notes.\n",
  );
  expect(existsSync(join(directory, "notes.txt"))).toBe(false);
  expect(git(directory, "status", "--porcelain")).toBe("");
});

test("existing unrelated directories, checkout paths and symlink destinations are refused", () => {
  const foreign = join(temporary, "foreign");
  mkdirSync(foreign);
  writeFileSync(join(foreign, "keep.txt"), "keep");
  expect(() => prepareScreenshotDemo({ directory: foreign })).toThrow(
    "Destination exists",
  );
  expect(() =>
    prepareScreenshotDemo({ directory: foreign, reset: true }),
  ).toThrow("without the demo marker");
  expect(readFileSync(join(foreign, "keep.txt"), "utf8")).toBe("keep");
  const checkout = fileURLToPath(new URL("..", import.meta.url));
  expect(() =>
    prepareScreenshotDemo({ directory: checkout, reset: true }),
  ).toThrow("outside the Roamgate checkout");
  const link = join(temporary, "link");
  symlinkSync(foreign, link, "junction");
  expect(() => prepareScreenshotDemo({ directory: link, reset: true })).toThrow(
    "symlink",
  );
  const parentLink = join(temporary, "checkout-link");
  symlinkSync(checkout, parentLink, "junction");
  expect(() =>
    prepareScreenshotDemo({ directory: join(parentLink, "demo-copy") }),
  ).toThrow("outside the Roamgate checkout");
  expect(existsSync(join(checkout, "demo-copy"))).toBe(false);
  expect(() =>
    prepareScreenshotDemo({ directory: join(parentLink, "demo-copy/nested") }),
  ).toThrow("outside the Roamgate checkout");
  expect(existsSync(join(checkout, "demo-copy"))).toBe(false);
});

test.skipIf(process.platform === "win32")(
  "failed preparation never removes a replacement directory",
  () => {
    const directory = join(temporary, "replacement");
    const bin = join(temporary, "replacement-bin");
    mkdirSync(bin);
    writeFileSync(
      join(bin, "git"),
      `#!${process.execPath}\nimport { renameSync, mkdirSync, writeFileSync } from "node:fs";\nconst path = process.cwd();\nrenameSync(path, path + ".moved");\nmkdirSync(path);\nwriteFileSync(path + "/keep.txt", "keep replacement");\nprocess.exit(1);\n`,
      { mode: 0o755 },
    );
    const result = Bun.spawnSync(
      [
        process.execPath,
        fileURLToPath(new URL("prepare-screenshot-demo.ts", import.meta.url)),
        "--dir",
        directory,
      ],
      {
        env: { PATH: bin },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    expect(result.exitCode).toBe(1);
    expect(readFileSync(join(directory, "keep.txt"), "utf8")).toBe(
      "keep replacement",
    );
  },
);

test("a failed reset restores the original directory", () => {
  const directory = join(temporary, "rollback");
  prepareScreenshotDemo({ directory });
  writeFileSync(join(directory, "notes.txt"), "preserve on failure");
  const result = Bun.spawnSync(
    [
      process.execPath,
      fileURLToPath(new URL("prepare-screenshot-demo.ts", import.meta.url)),
      "--dir",
      directory,
      "--reset",
    ],
    {
      env: {
        PATH: join(temporary, "missing-bin"),
        SystemRoot: process.env.SystemRoot,
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  expect(result.exitCode).toBe(1);
  expect(readFileSync(join(directory, "notes.txt"), "utf8")).toBe(
    "preserve on failure",
  );
  expect(
    readdirSync(temporary).filter((name) => name.startsWith("rollback.saved-")),
  ).toEqual([]);
});

test("inherited Git config, identity and repository overrides do not leak into the demo", () => {
  const directory = join(temporary, "hostile-git-environment");
  const config = join(temporary, "personal.gitconfig");
  writeFileSync(
    config,
    "[user]\nname = Private User\nemail = private@example.invalid\n[commit]\ngpgsign = true\n",
  );
  const result = Bun.spawnSync(
    [
      process.execPath,
      fileURLToPath(new URL("prepare-screenshot-demo.ts", import.meta.url)),
      "--dir",
      directory,
      "--scene",
      "base",
    ],
    {
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        GIT_CONFIG_GLOBAL: config,
        GIT_DIR: join(temporary, "nonexistent.git"),
        GIT_AUTHOR_NAME: "Private User",
        GIT_AUTHOR_EMAIL: "private@example.invalid",
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  expect(result.exitCode, result.stderr.toString()).toBe(0);
  expect(git(directory, "log", "-1", "--format=%an <%ae>")).toBe(
    "Demo <demo@example.invalid>",
  );
});
