import { fileURLToPath } from "node:url";

const port = Number(Bun.argv[2] ?? 4317);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("Use a port number from 1 to 65535");
}

const build = await Bun.build({
  entrypoints: [fileURLToPath(new URL("app.ts", import.meta.url))],
  target: "browser",
});
if (!build.success) throw new Error("Unable to build the local board script");
const script = await build.outputs[0].text();
const routes: Record<string, string> = {
  "/": "index.html",
  "/index.html": "index.html",
  "/styles.css": "styles.css",
  "/assets/board-map.svg": "assets/board-map.svg",
};

Bun.serve({
  hostname: "127.0.0.1",
  port,
  fetch(request) {
    const pathname = new URL(request.url).pathname;
    if (pathname === "/app.js") {
      return new Response(script, {
        headers: { "Content-Type": "application/javascript" },
      });
    }
    const file = routes[pathname];
    return file
      ? new Response(Bun.file(new URL(file, import.meta.url)))
      : new Response("Not found", { status: 404 });
  },
});
console.log(`Northstar preview: http://127.0.0.1:${port}`);
