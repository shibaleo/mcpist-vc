/**
 * Trello module tool handlers.
 *
 * Auth uses the simpler API-key + personal-token flow rather than OAuth 1.0a.
 * The user pastes both into the Credentials page (manual JSON entry):
 *
 *   { "apiKey": "<from https://trello.com/app-key>", "token": "<personal token>" }
 *
 * Every API call appends ?key=...&token=... to the request URL — Trello
 * doesn't use a Bearer header.
 */

import { getModuleCredentials } from "@/lib/credentials/broker";
import type { ModuleContext } from "@/lib/mcp/types";

const BASE_URL = "https://api.trello.com/1";
const REQUEST_TIMEOUT_MS = 30_000;

interface TrelloAuth {
  apiKey: string;
  token: string;
}

async function getAuth(ctx: ModuleContext): Promise<TrelloAuth> {
  const creds = await getModuleCredentials(ctx.userId, "trello");
  if (!creds) throw new Error("Trello credentials not configured");
  // The broker normalises common spellings (apiKey, api_key) into apiKey,
  // and (token) is also a recognised field — see normalize() in broker.ts.
  const apiKey = creds.apiKey;
  const token = creds.token ?? creds.accessToken;
  if (!apiKey || !token) {
    throw new Error(
      'Trello credentials must include both "apiKey" and "token"',
    );
  }
  return { apiKey, token };
}

/** Build a Trello API URL with auth + arbitrary extra query params. */
function buildUrl(
  auth: TrelloAuth,
  path: string,
  query?: Record<string, string | number | boolean | undefined | null>,
): string {
  const url = new URL(`${BASE_URL}${path}`);
  url.searchParams.set("key", auth.apiKey);
  url.searchParams.set("token", auth.token);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== "") {
        url.searchParams.set(k, String(v));
      }
    }
  }
  return url.toString();
}

async function request<T = unknown>(
  url: string,
  init?: RequestInit & { errorContext?: string },
): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `${init?.errorContext ?? "Trello"} ${res.status}: ${body.slice(0, 300)}`,
      );
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** Coerce comma-separated input or array into the comma-joined form Trello expects. */
function joinIds(ids: unknown): string | undefined {
  if (Array.isArray(ids)) return ids.length ? ids.join(",") : undefined;
  if (typeof ids === "string" && ids.length > 0) return ids;
  return undefined;
}

// ── Tool implementations ──────────────────────────────────────────────────

export async function testConnection(ctx: ModuleContext): Promise<string> {
  const auth = await getAuth(ctx);
  const me = await request<{
    id: string;
    username: string;
    fullName: string;
    email?: string;
  }>(buildUrl(auth, "/members/me", { fields: "username,fullName,email" }));
  return JSON.stringify({
    success: true,
    user_id: me.id,
    username: me.username,
    full_name: me.fullName,
    email: me.email ?? null,
  });
}

export async function listBoards(
  ctx: ModuleContext,
  params: Record<string, unknown>,
): Promise<string> {
  const auth = await getAuth(ctx);
  const filter =
    typeof params.filter === "string" && params.filter !== ""
      ? params.filter
      : "open";
  const boards = await request<
    Array<{ id: string; name: string; url: string; closed: boolean }>
  >(
    buildUrl(auth, "/members/me/boards", {
      filter,
      fields: "name,url,closed,dateLastActivity",
    }),
  );
  return JSON.stringify({
    boards: boards.map((b) => ({
      id: b.id,
      name: b.name,
      url: b.url,
      closed: b.closed,
    })),
  });
}

export async function listLists(
  ctx: ModuleContext,
  params: Record<string, unknown>,
): Promise<string> {
  const boardId = params.board_id;
  if (typeof boardId !== "string" || !boardId) {
    throw new Error("board_id is required");
  }
  const auth = await getAuth(ctx);
  const filter =
    typeof params.filter === "string" && params.filter !== ""
      ? params.filter
      : "open";
  const lists = await request<
    Array<{ id: string; name: string; closed: boolean; pos: number }>
  >(
    buildUrl(auth, `/boards/${encodeURIComponent(boardId)}/lists`, {
      filter,
      fields: "name,closed,pos",
    }),
  );
  return JSON.stringify({ board_id: boardId, lists });
}

export async function listCards(
  ctx: ModuleContext,
  params: Record<string, unknown>,
): Promise<string> {
  const listId = typeof params.list_id === "string" ? params.list_id : "";
  const boardId = typeof params.board_id === "string" ? params.board_id : "";
  if (!listId && !boardId) {
    throw new Error("either list_id or board_id is required");
  }
  const auth = await getAuth(ctx);
  const filter =
    typeof params.filter === "string" && params.filter !== ""
      ? params.filter
      : "open";

  // Cards endpoint differs between list and board scopes; both share the
  // same shape on the response side.
  const path = listId
    ? `/lists/${encodeURIComponent(listId)}/cards`
    : `/boards/${encodeURIComponent(boardId)}/cards`;

  const cards = await request<
    Array<{
      id: string;
      name: string;
      idList: string;
      due: string | null;
      closed: boolean;
      url: string;
      shortUrl: string;
    }>
  >(
    buildUrl(auth, path, {
      filter,
      fields: "name,idList,due,closed,url,shortUrl,labels,idMembers",
    }),
  );
  return JSON.stringify({
    scope: listId ? { list_id: listId } : { board_id: boardId },
    cards,
  });
}

export async function getCard(
  ctx: ModuleContext,
  params: Record<string, unknown>,
): Promise<string> {
  const cardId = params.card_id;
  if (typeof cardId !== "string" || !cardId) {
    throw new Error("card_id is required");
  }
  const auth = await getAuth(ctx);
  const card = await request<unknown>(
    buildUrl(auth, `/cards/${encodeURIComponent(cardId)}`, {
      members: "true",
      member_fields: "username,fullName",
      checklists: "all",
      checklist_fields: "name,pos",
      attachments: "true",
    }),
  );
  return JSON.stringify(card);
}

export async function search(
  ctx: ModuleContext,
  params: Record<string, unknown>,
): Promise<string> {
  const query = params.query;
  if (typeof query !== "string" || !query) {
    throw new Error("query is required");
  }
  const auth = await getAuth(ctx);
  const modelTypes =
    typeof params.model_types === "string" && params.model_types !== ""
      ? params.model_types
      : "cards,boards";
  const result = await request<unknown>(
    buildUrl(auth, "/search", {
      query,
      modelTypes,
      cards_limit: 50,
      boards_limit: 20,
    }),
  );
  return JSON.stringify(result);
}

export async function createCard(
  ctx: ModuleContext,
  params: Record<string, unknown>,
): Promise<string> {
  const listId = params.list_id;
  const name = params.name;
  if (typeof listId !== "string" || !listId) throw new Error("list_id is required");
  if (typeof name !== "string" || !name) throw new Error("name is required");
  const auth = await getAuth(ctx);
  const url = buildUrl(auth, "/cards", {
    idList: listId,
    name,
    desc: typeof params.desc === "string" ? params.desc : undefined,
    due: typeof params.due === "string" ? params.due : undefined,
    pos: typeof params.position === "string" ? params.position : undefined,
    idMembers: joinIds(params.id_members),
    idLabels: joinIds(params.id_labels),
  });
  const created = await request<{
    id: string;
    name: string;
    url: string;
    shortUrl: string;
    idList: string;
  }>(url, { method: "POST" });
  return JSON.stringify({ success: true, card: created });
}

export async function updateCard(
  ctx: ModuleContext,
  params: Record<string, unknown>,
): Promise<string> {
  const cardId = params.card_id;
  if (typeof cardId !== "string" || !cardId) {
    throw new Error("card_id is required");
  }
  const auth = await getAuth(ctx);

  // Trello accepts an empty string `due=` to clear a due date — we honour
  // that contract rather than treating empty-string as "skip".
  const dueProvided = "due" in params && typeof params.due === "string";
  const closedProvided =
    "closed" in params && typeof params.closed === "boolean";

  const queryParams: Record<string, string | number | boolean | undefined | null> = {
    name: typeof params.name === "string" ? params.name : undefined,
    desc: typeof params.desc === "string" ? params.desc : undefined,
    idList: typeof params.id_list === "string" ? params.id_list : undefined,
    idMembers: joinIds(params.id_members),
    idLabels: joinIds(params.id_labels),
  };
  if (dueProvided) queryParams.due = params.due as string;
  if (closedProvided) queryParams.closed = params.closed as boolean;

  const url = buildUrl(auth, `/cards/${encodeURIComponent(cardId)}`, queryParams);
  const updated = await request<{
    id: string;
    name: string;
    idList: string;
    closed: boolean;
    due: string | null;
    url: string;
  }>(url, { method: "PUT" });
  return JSON.stringify({ success: true, card: updated });
}

export async function addComment(
  ctx: ModuleContext,
  params: Record<string, unknown>,
): Promise<string> {
  const cardId = params.card_id;
  const text = params.text;
  if (typeof cardId !== "string" || !cardId) throw new Error("card_id is required");
  if (typeof text !== "string" || !text) throw new Error("text is required");
  const auth = await getAuth(ctx);
  const url = buildUrl(
    auth,
    `/cards/${encodeURIComponent(cardId)}/actions/comments`,
    { text },
  );
  const action = await request<{
    id: string;
    date: string;
    data: { text: string };
  }>(url, { method: "POST" });
  return JSON.stringify({
    success: true,
    comment_id: action.id,
    posted_at: action.date,
  });
}
