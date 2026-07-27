import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const MEDIAPIPE_PREFIX = "/mediapipe/";

const CONTENT_TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".wasm": "application/wasm",
  ".task": "application/octet-stream",
  ".data": "application/octet-stream",
  ".bin": "application/octet-stream",
};

/**
 * Serves the vendored MediaPipe runtime straight off disk during `vite dev`.
 *
 * The worker asks MediaPipe for the ESM WASM loader, and MediaPipe fetches it
 * with a runtime `import(url)`. In dev that request reaches Vite's transform
 * middleware, which refuses anything under `public/` ("should not be imported
 * from source code") and the whole AUTO pipeline fails to initialize. The
 * assets genuinely are static files that must be served verbatim, so this
 * middleware answers `/mediapipe/*` before the transform middleware ever sees
 * it. Production is unaffected: `vite build` copies `public/` as-is and the
 * same URLs resolve to plain static files.
 *
 * Unvendored paths fall through to the next middleware, so a missing asset
 * still 404s and the worker falls back to the CDN as designed.
 */
function serveVendoredMediapipe(): Plugin {
  let publicDir = "";
  let mediapipeRoot = "";

  return {
    name: "gesturedrive:serve-vendored-mediapipe",
    apply: "serve",
    configResolved(config) {
      publicDir = config.publicDir;
      mediapipeRoot = path.join(publicDir, "mediapipe");
    },
    // Registered directly (not from a returned callback) so it is installed
    // ahead of Vite's internal middlewares rather than after them.
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url;
        const method = req.method ?? "GET";
        if (!url || !url.startsWith(MEDIAPIPE_PREFIX)) return next();
        if (method !== "GET" && method !== "HEAD") return next();

        // MediaPipe appends `?fallback=cpu` to force the loader module to be
        // evaluated a second time, so the query has to be ignored here.
        const pathname = url.split(/[?#]/, 1)[0] ?? "";
        let filePath: string;
        try {
          filePath = path.join(publicDir, decodeURIComponent(pathname));
        } catch {
          return next();
        }
        // Never serve outside the vendored directory.
        if (!filePath.startsWith(mediapipeRoot + path.sep)) return next();

        void stat(filePath).then(
          (stats) => {
            if (!stats.isFile()) {
              next();
              return;
            }
            res.setHeader(
              "Content-Type",
              CONTENT_TYPES[path.extname(filePath)] ?? "application/octet-stream",
            );
            res.setHeader("Content-Length", String(stats.size));
            res.setHeader("Cache-Control", "no-cache");
            if (method === "HEAD") {
              res.end();
              return;
            }
            createReadStream(filePath).pipe(res);
          },
          () => next(),
        );
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), serveVendoredMediapipe()],
  server: { host: true },
});
