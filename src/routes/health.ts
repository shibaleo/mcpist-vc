/**
 * /api/v1/health — fast liveness probe. Reports which env vars are set
 * so deploy misconfigurations are visible without poking other endpoints.
 */

import { Hono } from "hono";
import { getAppUrl } from "@/lib/app-url";

const app = new Hono().get("/", (c) =>
  c.json({
    status: "ok",
    env: {
      hasClerkPK: !!process.env.VITE_CLERK_PUBLISHABLE_KEY,
      hasClerkSK: !!process.env.CLERK_SECRET_KEY,
      hasJwtKey: !!process.env.SERVER_JWT_SIGNING_KEY,
      hasPgUrl: !!process.env.MCPIST_DATABASE_URL,
      appUrl: getAppUrl(c.req.raw),
    },
    runtime: {
      node: process.version,
      cwd: process.cwd(),
    },
  }),
);

export default app;
