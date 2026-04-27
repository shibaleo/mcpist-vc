/**
 * Module registry — maps module-name → Module implementation.
 *
 * Modules self-register on import; the registry is populated at module load
 * time. This keeps the cold-start path cheap (no dynamic discovery) and lets
 * tree-shaking drop unused modules in builds where we narrow the registry.
 */

import type { Module } from "./types";

const registry = new Map<string, Module>();

export function registerModule(mod: Module): void {
  if (registry.has(mod.name)) {
    console.warn(`[mcp] module already registered: ${mod.name} (overwriting)`);
  }
  registry.set(mod.name, mod);
}

export function getModule(name: string): Module | undefined {
  return registry.get(name);
}

export function listModules(): Module[] {
  return Array.from(registry.values());
}
