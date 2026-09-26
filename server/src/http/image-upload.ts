import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sshCommandArgv } from "../bridge/ssh-command";

// Local pastes collect in one Roamgate folder under the OS temp directory.
// The returned path is absolute in the host's native form, so an agent in any
// shell or on any drive opens the same file. A bare "/tmp" is drive-relative
// on Windows.
export function defaultImageUploadDirectory() {
  return join(tmpdir(), "roamgate", "images");
}

export function createImageUploadHandler(args: {
  sshHost: () => string | undefined;
  localDirectory?: () => string;
}) {
  return async function handleImageUpload(req: Request): Promise<Response> {
    try {
      const buf = new Uint8Array(await req.arrayBuffer());
      if (buf.length === 0) {
        return Response.json({ error: "empty body" }, { status: 400 });
      }
      if (buf.length > 25 * 1024 * 1024) {
        return Response.json(
          { error: "image too large (>25MB)" },
          { status: 413 },
        );
      }
      const ext =
        (req.headers.get("x-image-ext") || "png")
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "") || "png";
      const name = `img-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}.${ext}`;
      const sshHost = args.sshHost();

      if (sshHost) {
        const remotePath = `/tmp/${name}`;
        const proc = Bun.spawn(sshCommandArgv(sshHost, `cat > ${remotePath}`), {
          stdin: buf,
          stdout: "pipe",
          stderr: "pipe",
        });
        const code = await proc.exited;
        if (code !== 0) {
          const err = await new Response(proc.stderr).text();
          return Response.json(
            { error: `ssh upload failed: ${err.trim() || `exit ${code}`}` },
            { status: 502 },
          );
        }
        return Response.json({ path: remotePath, remote: true });
      }

      const directory =
        args.localDirectory?.() ?? defaultImageUploadDirectory();
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const localPath = join(directory, name);
      await Bun.write(localPath, buf);
      return Response.json({ path: localPath, remote: false });
    } catch (e) {
      return Response.json({ error: (e as Error).message }, { status: 500 });
    }
  };
}
