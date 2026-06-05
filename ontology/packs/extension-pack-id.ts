import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { configsPath } from "../paths.js";

/** Safe extension pack directory names (no path segments). */
export const EXTENSION_PACK_ID_PATTERN = /^[a-z0-9_-]+$/;

export function extensionsPackRoot(): string {
  return configsPath("ontology", "packs", "extensions");
}

export function listKnownExtensionPackIds(): string[] {
  const root = extensionsPackRoot();
  if (!existsSync(root)) {
    return [];
  }
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => EXTENSION_PACK_ID_PATTERN.test(name))
    .sort();
}

/**
 * Validates an extension pack id before any join/read under configs/ontology/packs/extensions/.
 */
export function assertValidExtensionPackId(extensionId: string): void {
  if (!EXTENSION_PACK_ID_PATTERN.test(extensionId)) {
    throw new Error(
      `invalid extension pack id "${extensionId}" (expected ${EXTENSION_PACK_ID_PATTERN})`,
    );
  }
  const packDir = join(extensionsPackRoot(), extensionId);
  const manifestPath = join(packDir, "pack.yaml");
  if (!existsSync(manifestPath)) {
    const known = listKnownExtensionPackIds();
    const hint =
      known.length > 0 ? `; known packs: ${known.join(", ")}` : "; no extension packs on disk";
    throw new Error(`unknown extension pack "${extensionId}"${hint}`);
  }
}
