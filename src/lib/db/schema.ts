/**
 * Drizzle schema for the `mcpist` Postgres schema.
 *
 * Mirrors database/migrations/00000000000001_baseline.sql 1:1. The migration
 * file is the source of truth; this file is the TS view that drizzle-orm
 * uses for query building and type inference. We don't generate migrations
 * from this — keep the raw SQL authoritative.
 */

import {
  pgSchema,
  text,
  uuid,
  boolean,
  timestamp,
  primaryKey,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const mcpist = pgSchema("mcpist");

export const users = mcpist.table("users", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  clerkId: text("clerk_id").notNull().unique(),
  email: text("email"),
  displayName: text("display_name"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const apiKeys = mcpist.table(
  "api_keys",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    jwtKid: text("jwt_kid").notNull().unique(),
    keyPrefix: text("key_prefix").notNull(),
    name: text("name").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userIdIdx: index("api_keys_user_id_idx").on(t.userId),
  }),
);

export const userCredentials = mcpist.table(
  "user_credentials",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    module: text("module").notNull(),
    encrypted: text("encrypted").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.module] }),
  }),
);

export const toolSettings = mcpist.table(
  "tool_settings",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    toolId: text("tool_id").notNull(),
    enabled: boolean("enabled").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.toolId] }),
  }),
);

export const oauthApps = mcpist.table("oauth_apps", {
  provider: text("provider").primaryKey(),
  clientId: text("client_id").notNull(),
  encryptedClientSecret: text("encrypted_client_secret").notNull(),
  redirectUri: text("redirect_uri"),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

