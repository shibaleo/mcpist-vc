/**
 * Trello module — registers tools with the MCP module registry.
 *
 * Auth model: API key + personal token, stored in user_credentials as a
 * JSON envelope. See tools.ts for the credential lookup. OAuth 1.0a is
 * NOT supported — for a single-user setup the personal-token flow is
 * dramatically simpler.
 */

import {
  type Module,
  type Tool,
  type ToolAnnotations,
  type ModuleContext,
  ANNOTATE_READ_ONLY,
  ANNOTATE_CREATE,
  ANNOTATE_UPDATE,
} from "@/lib/mcp/types";
import { registerModule } from "@/lib/mcp/modules";
import schemas from "./schemas.json";
import * as handlers from "./tools";

const ANNOTATION_MAP: Record<string, ToolAnnotations> = {
  readOnly: ANNOTATE_READ_ONLY,
  create: ANNOTATE_CREATE,
  update: ANNOTATE_UPDATE,
};

const MODULE_DESCRIPTIONS = {
  "en-US": "Trello — boards, lists, cards, comments. API-key + personal-token auth.",
  "ja-JP": "Trello — ボード・リスト・カード・コメント。API キー + 個人トークン認証。",
};

const HANDLER_MAP: Record<
  string,
  (ctx: ModuleContext, params: Record<string, unknown>) => Promise<string>
> = {
  test_connection: (ctx) => handlers.testConnection(ctx),
  list_boards: (ctx, p) => handlers.listBoards(ctx, p),
  list_lists: (ctx, p) => handlers.listLists(ctx, p),
  list_cards: (ctx, p) => handlers.listCards(ctx, p),
  get_card: (ctx, p) => handlers.getCard(ctx, p),
  search: (ctx, p) => handlers.search(ctx, p),
  create_card: (ctx, p) => handlers.createCard(ctx, p),
  update_card: (ctx, p) => handlers.updateCard(ctx, p),
  add_comment: (ctx, p) => handlers.addComment(ctx, p),
};

interface ToolSchemaEntry {
  id: string;
  name: string;
  descriptions: Record<string, string>;
  annotation: keyof typeof ANNOTATION_MAP;
  inputSchema: Tool["inputSchema"];
}

const tools: Tool[] = (schemas.tools as unknown as ToolSchemaEntry[]).map((t) => ({
  id: t.id,
  name: t.name,
  description: t.descriptions["en-US"],
  descriptions: t.descriptions,
  inputSchema: t.inputSchema,
  annotations: ANNOTATION_MAP[t.annotation],
}));

const trelloModule: Module = {
  name: "trello",
  description: MODULE_DESCRIPTIONS["en-US"],
  descriptions: MODULE_DESCRIPTIONS,
  apiVersion: "v1",
  tools,
  async executeTool(ctx, toolName, params) {
    const fn = HANDLER_MAP[toolName];
    if (!fn) throw new Error(`unknown tool: ${toolName}`);
    return fn(ctx, params);
  },
};

registerModule(trelloModule);
