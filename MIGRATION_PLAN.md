# mcpist-vc Migration Plan

mcpist (Vercel + Cloudflare Workers + Render) → **Vercel monolithic + Vite + Hono + TypeScript** への全面リライト計画。
本リポジトリは新規構築先。旧 [mcpist](../mcpist) は移行完了後 archive。

**前提**: 旧 mcpist は実運用していないため **ダウンタイム / 並行運用は考慮不要**。完成次第 cutover。

## 1. ゴール

1. **配信先を Vercel 1 つに統一**: 旧 console (Vercel) + worker (CF Workers) + server (Render Docker) を Vercel Functions に集約
2. **Cold start を <1s に短縮** (旧 Render free 30-60s から)
3. **言語と構成を data-drills-vc と統一**: TypeScript + Vite + Hono + Vercel Function (Node-style handler) の単一パターン
4. **MCP transport は Streamable HTTP のみ** (SSE は Vercel Functions の stateless モデルと非互換のため廃止)
5. **18 モジュールを TS で再実装**、最優先で `postgresql` を完成

### 非ゴール

- MCP の **tool ID / Name / inputSchema は 1:1 維持** (旧 Go の定義をそのまま JSON 化して読み込む)
- DB スキーマ変更なし (旧 [mcpist/database/migrations/](../mcpist/database/migrations/) をそのままコピー)

## 2. アーキテクチャ決定

### 2.1 全体パターン (= data-drills-vc と同一)

| レイヤー | 採用技術 |
|---|---|
| **Frontend** | Vite + React 19 + TanStack Router + TanStack Query + Clerk (`@clerk/react`) + shadcn/ui (Radix + Tailwind) |
| **Backend (API)** | Hono 4 + Drizzle ORM + Neon serverless (HTTP) |
| **Vercel Function entry** | `api/[...slug].ts` (catch-all) → `_bundle.mjs` (esbuild) → `src/server-entry.ts` (Node-style `(req, res)` adapter で IncomingMessage → fetch Request → `app.fetch`) |
| **MCP transport** | Streamable HTTP only (`POST /api/v1/mcp` JSON-RPC) |
| **Build** | `vite build && node scripts/build-api.mjs` |
| **vercel.json** | `/api/(.*) → /api` rewrite + SPA fallback |

旧 mcpist の monorepo 構成 (apps/console + apps/worker + apps/server) は **廃止**。1 つの Vite + Hono アプリに統合。

### 2.2 認証

旧 2 段認証 (Clerk → Worker → Gateway JWT → Server) を 1 段に簡略化:

| 経由 | Header | 検証 |
|---|---|---|
| Browser → Vercel | `Authorization: Bearer <Clerk JWT>` | `jose.createRemoteJWKSet` で Clerk JWKS 検証 |
| MCP Client → Vercel | `Authorization: Bearer mcpist_<Ed25519 JWT>` | server-side JWKS 検証 |
| Stripe → Vercel | `Stripe-Signature` | `stripe.webhooks.constructEvent` |

Hono の middleware で `c.set("authResult", result)` する pattern (data-drills-vc 流用)。

### 2.3 DB 接続

- mcpist 自身の DB (Neon): `@neondatabase/serverless` (HTTP) + Drizzle ORM
- ユーザの任意 PostgreSQL (PG モジュール経由): `postgres-js` (TCP, invocation-scoped)

```ts
// src/lib/db/index.ts
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";
const sql = neon(process.env.DATABASE_URL!);
export const db = drizzle(sql, { schema });
```

### 2.4 Credential 暗号化の互換性 (要検証)

旧 Go `db.InitEncryptionKey()` (AES-256-GCM) で保存済みの credential を新 TS 実装で **復号できることが必須**。Phase 2 で実機検証 (NG なら format 調整)。

```ts
// pseudo
const key = base64Decode(process.env.CREDENTIAL_ENCRYPTION_KEY!);
const cipherKey = await crypto.subtle.importKey("raw", key, "AES-GCM", false, ["decrypt"]);
const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, cipherKey, ciphertext);
```

### 2.5 環境変数 (Vercel に集約)

| 変数 | 用途 |
|---|---|
| `DATABASE_URL` | Neon HTTP URL |
| `CREDENTIAL_ENCRYPTION_KEY` | AES-256-GCM (旧 Go と同 base64) |
| `VITE_CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` / `CLERK_JWKS_URL` | Clerk |
| `SERVER_JWT_SIGNING_KEY` (Ed25519 seed) | API Key 発行 + 検証 |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Stripe |
| `GRAFANA_LOKI_URL` / `_USER` / `_API_KEY` | Loki push (任意) |
| 各モジュールの `*_CLIENT_ID` / `*_CLIENT_SECRET` (Notion, GitHub, Google, ...) | OAuth flow |
| ~~`GATEWAY_SIGNING_KEY`~~ / ~~`SERVER_URL`~~ | 廃止 |

## 3. ディレクトリ構成 (target)

旧 monorepo 廃止。data-drills-vc に倣った single-app 構成:

```
mcpist-vc/
├── api/
│   ├── _bundle.mjs                        (esbuild 出力, git-ignored)
│   └── [...slug].ts                       (Vercel Function catch-all → _bundle.mjs)
├── src/
│   ├── app/
│   │   └── (pages)/                       (UI ページ — settings / credentials / api-keys / usage / prompts)
│   ├── components/
│   │   ├── ui/                            (shadcn/ui Radix wrappers)
│   │   ├── layout/
│   │   ├── auth/                          (Clerk 連携)
│   │   └── mcp/                           (モジュール一覧 / OAuth ボタン)
│   ├── hooks/
│   │   └── queries/                       (TanStack Query フック)
│   ├── lib/
│   │   ├── auth.ts                        (Clerk JWT + API Key 検証)
│   │   ├── credentials/                   (AES-256-GCM 暗号化/復号)
│   │   ├── db/
│   │   │   ├── index.ts                   (Neon + Drizzle)
│   │   │   └── schema.ts                  (旧 SQL から drizzle-kit pull)
│   │   ├── mcp/
│   │   │   ├── handler.ts                 (initialize / tools/list / tools/call dispatcher)
│   │   │   ├── transport.ts               (Streamable HTTP — POST /api/v1/mcp)
│   │   │   ├── modules.ts                 (Module registry)
│   │   │   ├── types.ts                   (Tool / Module / JsonRpc 型)
│   │   │   └── modules/
│   │   │       ├── postgresql/            ★ Phase 4 最優先
│   │   │       │   ├── index.ts
│   │   │       │   ├── tools.ts           (7 tool handlers)
│   │   │       │   └── schemas.json       (旧 Go から export した tool 定義)
│   │   │       ├── notion/
│   │   │       └── ...
│   │   ├── observability/                 (Loki push)
│   │   ├── oauth/                         (各 provider 共通の OAuth flow)
│   │   ├── stripe/                        (webhook + customer 管理)
│   │   ├── hono-app.ts                    (Hono app 全体組み立て)
│   │   ├── rpc-client.ts                  (フロント用 hc<AppType>)
│   │   └── query-client.ts
│   ├── routes/                            (Hono ルート)
│   │   ├── health.ts                      (/api/v1/health)
│   │   ├── me/
│   │   │   ├── credentials.ts             (/api/v1/me/credentials)
│   │   │   ├── api-keys.ts
│   │   │   ├── usage.ts
│   │   │   ├── prompts.ts
│   │   │   └── oauth.ts
│   │   ├── mcp.ts                         (/api/v1/mcp — Streamable HTTP)
│   │   └── webhooks/
│   │       └── stripe.ts
│   ├── main.tsx
│   ├── router.tsx                         (TanStack Router)
│   ├── server-entry.ts                    (Node-style handler → app.fetch)
│   └── vite-env.d.ts
├── scripts/
│   └── build-api.mjs                      (esbuild → api/_bundle.mjs)
├── database/
│   └── migrations/                        (旧 mcpist/database から copy)
├── docs/
│   └── module-port-template.md
├── package.json
├── pnpm-lock.yaml
├── vite.config.ts                         (data-drills-vc 流用 — Hono dev plugin あり)
├── vercel.json                            (rewrites + functions config)
├── tsconfig.json
├── components.json                        (shadcn/ui)
├── drizzle.config.ts
├── postcss.config.mjs
├── index.html
├── MIGRATION_PLAN.md
├── README.md
└── .gitignore
```

## 4. フェーズ別実装手順

旧 console (Next.js) は**実運用していない**ため並行運用不要。一気通貫で完成させる。

### Phase 0: 下準備 (半日)

- [ ] mcpist-vc 用 Vercel project 作成 (Pro plan: maxDuration 300s)
- [ ] Neon DB の HTTP-driver URL 取得 (旧 mcpist と同 DB をそのまま流用)
- [ ] `.gitignore` 整備 (Vercel / Vite / Node)

### Phase 1: スケルトン bootstrap (1 日) ← data-drills-vc 構造を流用

- [ ] [package.json](package.json) — data-drills-vc 流用、依存を mcpist 用に調整 (`@clerk/react`, `drizzle-orm`, `@neondatabase/serverless`, `postgres`, `pdf-lib` は不要, `stripe`, `jose`, `@octokit/rest`, `@notionhq/client`, `googleapis`, etc.)
- [ ] [vite.config.ts](vite.config.ts) — data-drills-vc 同 (Hono dev plugin 同梱)
- [ ] [tsconfig.json](tsconfig.json) — `@/*` alias で data-drills-vc 同
- [ ] [vercel.json](vercel.json) — `/api/(.*) → /api` rewrite + SPA fallback
- [ ] [scripts/build-api.mjs](scripts/build-api.mjs) — esbuild で `_bundle.mjs` 生成 (data-drills-vc 同)
- [ ] [api/[...slug].ts](api/[...slug].ts) — re-export from `_bundle.mjs`
- [ ] [src/server-entry.ts](src/server-entry.ts) — Node-style `(req, res)` adapter (data-drills-vc 流用)
- [ ] [src/main.tsx](src/main.tsx) + [src/router.tsx](src/router.tsx) — TanStack Router skeleton
- [ ] [src/lib/hono-app.ts](src/lib/hono-app.ts) — Hono app skeleton (auth middleware + req-trace)
- [ ] Clerk 連携 ([@clerk/react](https://clerk.com/docs/quickstarts/react)) のプロバイダー設置
- [ ] shadcn/ui 初期化 (`pnpm dlx shadcn@latest init`)
- [ ] **動作確認**: `pnpm dev` で空ページが起動 + Hono `/api/v1/health` が応答

### Phase 2: 共通基盤 (2-3 日)

- [ ] [src/lib/db/](src/lib/db/) — Drizzle schema (旧 [mcpist/database/migrations/](../mcpist/database/migrations/) をコピー → `drizzle-kit pull` で TS 化)
- [ ] [src/lib/auth.ts](src/lib/auth.ts) — Clerk JWT 検証 (data-drills-vc の `auth.ts` を base に Clerk-only 化) + API Key (Ed25519 JWT) 検証
- [ ] [src/lib/credentials/](src/lib/credentials/) — AES-256-GCM 暗号化/復号
- [ ] [src/lib/observability/](src/lib/observability/) — Loki push (旧 worker からほぼコピー)
- [ ] **互換テスト** ★必須: ステージング DB に保存済みの暗号化 credential を新コードで復号できることを確認

### Phase 3: MCP プロトコル基盤 (1-2 日)

- [ ] [src/lib/mcp/types.ts](src/lib/mcp/types.ts) — Tool / Module interface, JSON-RPC types, MCP enums
- [ ] [src/lib/mcp/handler.ts](src/lib/mcp/handler.ts) — `initialize` / `initialized` / `tools/list` / `tools/call` / `prompts/list` / `prompts/get` ディスパッチャ
- [ ] [src/lib/mcp/transport.ts](src/lib/mcp/transport.ts) — Streamable HTTP (POST `/api/v1/mcp` で JSON-RPC 受信 → 同期処理 → JSON-RPC レスポンス)
- [ ] [src/lib/mcp/modules.ts](src/lib/mcp/modules.ts) — Module registry (動的登録)
- [ ] [src/routes/mcp.ts](src/routes/mcp.ts) — Hono mount
- [ ] **疎通テスト**: dummy module で `tools/list` 0 件レスポンス → Claude Code から `initialize` 成功確認

### Phase 4: PostgreSQL モジュール ★ 最優先 (1-2 日)

旧 [mcpist/apps/server/internal/modules/postgresql/module.go](../mcpist/apps/server/internal/modules/postgresql/module.go) を移植。

7 tool を 1:1 で TS 再実装:

| Tool ID | 動作 | Annotations |
|---|---|---|
| `postgresql:test_connection` | 接続テスト → version + 接続情報 | ReadOnly |
| `postgresql:list_schemas` | スキーマ一覧 (`include_system` opt) | ReadOnly |
| `postgresql:list_tables` | テーブル一覧 + 推定行数 (`schema`, `include_views` opt) | ReadOnly |
| `postgresql:describe_table` | カラム / 制約 / インデックス | ReadOnly |
| `postgresql:query` | SELECT / WITH のみ | ReadOnly |
| `postgresql:execute` | INSERT / UPDATE / DELETE | Destructive |
| `postgresql:execute_ddl` | DROP / TRUNCATE / ALTER / CREATE / GRANT / REVOKE | Destructive |

実装ポイント:
- DB driver: `postgres-js` (TCP 直接接続) — 任意 PostgreSQL に対応するため Neon HTTP は使えない
- 接続は invocation 毎に open → query → close
- `connectTimeout: 10s` / `queryTimeout: 30s` (旧 Go と同)
- Connection string は credentials broker から取得 (userId + module="postgresql")
- `validateConnectionString`: localhost 禁止 (SSRF 対策), scheme 制限, DB 名必須 — 旧 Go ロジックそのまま
- `isDDL` / `isWriteOperation` / `isSelectOnly` は旧 Go の正規表現を JS に移植
- Tool 定義は旧 Go から JSON export → [src/lib/mcp/modules/postgresql/schemas.json](src/lib/mcp/modules/postgresql/schemas.json) として import

完了基準:
- [ ] Vercel preview に deploy 済み
- [ ] Claude Code から `mcpist:postgresql:list_tables` で実 DB のテーブル一覧取得
- [ ] `mcpist:postgresql:query` で SELECT 結果取得
- [ ] DDL 系で許可/拒否ロジックが旧と一致

### Phase 5: REST API 移植 (3-4 日)

`/v1/me/*` を Hono route として移植:

- [ ] `/v1/me/credentials` (GET / POST / DELETE)
- [ ] `/v1/me/api-keys` (GET / POST / DELETE) — JWT API key 発行・失効
- [ ] `/v1/me/usage` (GET) — usage_log
- [ ] `/v1/me/prompts` (GET / POST / PUT / DELETE)
- [ ] `/v1/me/oauth/start` (GET) — provider 別 OAuth URL 生成
- [ ] `/v1/me/oauth/callback` (GET) — token 保存
- [ ] `/v1/openapi.yaml` (GET) — 旧 ogen と同 spec
- [ ] `/api/webhooks/stripe` (POST)

OpenAPI spec は旧 [mcpist/apps/server/api/openapi/server-openapi.yaml](../mcpist/apps/server/api/openapi/server-openapi.yaml) を流用。フロント側は **Hono RPC client** (`hc<AppType>()`) で型推論される (data-drills-vc と同 pattern)。

### Phase 6: UI 全面リライト (3-5 日)

旧 [mcpist/apps/console](../mcpist/apps/console) のページを Vite + TanStack Router に移植:

- [ ] **Layout** — Sidebar, header, user menu (Clerk `<UserButton />`)
- [ ] **Modules** ページ — 18 モジュールの ON/OFF + OAuth 接続 UI
- [ ] **Credentials** ページ — モジュール毎の connection string / OAuth token 状態
- [ ] **API Keys** ページ — 発行 / 失効 / 利用ログ
- [ ] **Usage** ページ — 月別 tool 呼び出し回数 + Recharts
- [ ] **Prompts** ページ — Markdown プロンプトの CRUD
- [ ] **Settings** ページ — Plan / Subscription (Stripe billing portal)

各ページは `useXxx()` フック経由で Hono RPC client を叩く (data-drills-vc の `hooks/queries/` と同パターン)。

### Phase 7: ローカル検証 (1-2 日)

- [ ] `pnpm dev` で console + API 一体起動
- [ ] PG モジュール (Phase 4 完了済) を Claude Code から接続して全 7 tool 動作確認
- [ ] OAuth 連携 (新規 + 既存 credential 復号互換)
- [ ] API Key 発行 → MCP 呼び出し
- [ ] Stripe webhook (test mode)
- [ ] Usage log の記録

### Phase 8: Vercel preview deploy (1 日)

- [ ] `vercel link` + `.env` を `.env paste` 機能で Vercel に投入
- [ ] `vercel --prod=false`
- [ ] preview URL で Claude Code 接続テスト
- [ ] 数日 dogfooding

### Phase 9: モジュール継続移植 (各 1-2 時間 × 17 個 ≒ 1 週間)

PG が完成した後、優先順:

1. [ ] `notion` (`@notionhq/client`)
2. [ ] `github` (`@octokit/rest`)
3. [ ] `google_drive` / `google_calendar` / `google_docs` / `google_sheets` / `google_apps_script` / `google_tasks` (`googleapis` SDK 共通, OAuth 共通)
4. [ ] `jira` / `confluence` (Atlassian REST)
5. [ ] `supabase` (REST + service key)
6. [ ] `airtable` (`airtable` SDK)
7. [ ] `microsoft_todo` (Microsoft Graph)
8. [ ] `ticktick` / `todoist` / `trello` / `asana` (各 REST)
9. [ ] `grafana` (REST)
10. [ ] `dropbox` (`dropbox` SDK)

各モジュールテンプレ ([docs/module-port-template.md](docs/module-port-template.md)):
1. 旧 `module.go` の tool 定義を JSON export
2. `modules/<name>/index.ts` で tool 配列読み込み + handler 実装
3. OAuth flow は `lib/oauth/` の共通ヘルパー
4. Module registry に登録
5. Integration test (実 OAuth で実 API)

### Phase 10: 本番 cutover + archive (1 日)

- [ ] DNS / カスタムドメインを Vercel に切替
- [ ] MCP クライアント設定の URL 切替 (内部利用のみ なので影響軽微)
- [ ] Production deploy: `vercel --prod`
- [ ] 旧 mcpist リポジトリ README に「mcpist-vc に移行済み」のバナー追加
- [ ] 旧 worker / server コードは git history に残し main から削除
- [ ] 旧 Render service と CF Worker を停止

## 5. リスクと未確定事項

### 5.1 Credential 暗号化の互換性 ★最大のリスク

旧 Go AES-256-GCM のフォーマット (IV 長, ciphertext + tag の連結順序) が新 TS 実装と完全一致する必要。Phase 2 で必ず実機検証。NG なら Phase 4 着手前に解決。

### 5.2 PG モジュールの connection storm

ユーザの DB に大量 invocation が来た場合に TCP 接続を開きすぎる懸念。
- 初期: 各 invocation で新規接続 → close (シンプル)
- 必要なら: pgbouncer 推奨を docs に
- Vercel Function 自体は warm 時に process 再利用するので、module-scope cache + `idle_timeout: 20s` で実質 pooling 可能

### 5.3 18 モジュールの OAuth client redirect URI

旧 callback URL = `https://<worker-domain>/v1/me/oauth/callback`
新 callback URL = `https://<vercel-domain>/api/v1/me/oauth/callback`

各 OAuth provider (Notion, GitHub, Google, Jira, Confluence, Microsoft, Asana, Trello, Dropbox, TickTick, Todoist) で **新 redirect URI を追加登録**。実運用していないので旧を消すのは任意。

### 5.4 Stripe webhook signature

raw body での `stripe.webhooks.constructEvent` 検証。Hono の `c.req.raw.text()` で raw を取得する pattern (Next.js Route Handler とは取り方が違う) を確認。

### 5.5 Cost

Vercel Pro $20/month + Neon (現状継続) — 旧 Render free $0 + CF free $0 から $20/month の純増。MCP server を**実運用する場合**は妥当 (Render cold start 排除の対価)。

## 6. 完了の定義

- [ ] mcpist-vc が Vercel に deploy 済み、production URL から:
  - Console UI が動く (login / settings / OAuth 連携)
  - Claude Code から MCP 接続できる (Streamable HTTP)
  - PG モジュールの 7 tool 全動作
  - 主要モジュール (PG + Notion + GitHub + Google Drive) 動作
- [ ] 残り 14 モジュールは Phase 9 で継続移植
- [ ] 旧 CF Worker と Render Docker をシャットダウンできる
- [ ] cold start <1s
- [ ] mcpist-vc の README に開発・deploy 手順
- [ ] 旧 mcpist は read-only archive

## 7. 推奨進行

**最初の 1 週間で Phase 0-4 完走 → PG モジュール preview deploy で動く** ところまで。

Phase 5-8 で REST API + UI + ローカル検証 を 2 週間目に。Phase 9 残モジュール継続。3 週間目に本番 cutover 目標。
