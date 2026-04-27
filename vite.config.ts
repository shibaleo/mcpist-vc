import "dotenv/config";
import { defineConfig, type Plugin, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

/**
 * Serve Hono API routes from the Vite dev server so `pnpm dev` runs UI + API
 * together. ssrLoadModule keeps the alias resolver and HMR active for routes.
 */
function honoDevServer(): Plugin {
  return {
    name: "hono-dev-server",
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/api")) return next();

        try {
          const mod = await server.ssrLoadModule("/src/lib/hono-app.ts");
          const app = mod.default;

          const url = new URL(req.url, `http://${req.headers.host}`);
          const headers = new Headers();
          for (const [key, value] of Object.entries(req.headers)) {
            if (value)
              headers.set(
                key,
                Array.isArray(value) ? value.join(", ") : value,
              );
          }

          let body: Uint8Array | undefined;
          if (req.method !== "GET" && req.method !== "HEAD") {
            body = await new Promise<Uint8Array>((resolve) => {
              const chunks: Buffer[] = [];
              req.on("data", (chunk: Buffer) => chunks.push(chunk));
              req.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
            });
          }

          const request = new Request(url.toString(), {
            method: req.method,
            headers,
            ...(body ? { body } : {}),
          } as RequestInit);

          const response: Response = await app.fetch(request);

          res.statusCode = response.status;
          response.headers.forEach((value: string, key: string) => {
            res.setHeader(key, value);
          });

          const arrayBuffer = await response.arrayBuffer();
          res.end(Buffer.from(arrayBuffer));
        } catch (err) {
          console.error("API error:", err);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.end("Internal Server Error");
          }
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), honoDevServer()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
});
