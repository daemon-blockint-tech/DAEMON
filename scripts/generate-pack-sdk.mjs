#!/usr/bin/env node
/**
 * Generate typed entity/action helpers from ontology pack YAML.
 *
 * Usage:
 *   node scripts/generate-pack-sdk.mjs [--pack foundation] [--out packages/sdk/src/generated]
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

function parseArgs(argv) {
  let packId = "foundation";
  let outDir = join(root, "packages/sdk/src/generated");
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--pack" && argv[i + 1]) packId = argv[++i];
    else if (argv[i] === "--out" && argv[i + 1]) outDir = resolve(root, argv[++i]);
  }
  return { packId, outDir };
}

function tsType(yamlType) {
  switch (yamlType) {
    case "string":
      return "string";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "object":
      return "Record<string, unknown>";
    default:
      return "unknown";
  }
}

function loadEntityDefs(packDir) {
  const entitiesDir = join(packDir, "entities");
  const files = readdirSync(entitiesDir)
    .filter((f) => f.endsWith(".yaml"))
    .sort();
  const defs = [];
  for (const file of files) {
    const raw = parseYaml(readFileSync(join(entitiesDir, file), "utf8"));
    const entityType = raw.entityType;
    const fields = raw.fields ?? [];
    defs.push({ entityType, fields });
  }
  defs.sort((a, b) => a.entityType.localeCompare(b.entityType));
  return defs;
}

function loadPackMeta(packDir) {
  return parseYaml(readFileSync(join(packDir, "pack.yaml"), "utf8"));
}

function loadActions(repoRoot) {
  const raw = parseYaml(
    readFileSync(join(repoRoot, "configs/governance/action-catalog.yaml"), "utf8"),
  );
  const actions = raw.actions ?? [];
  const seen = new Set();
  const unique = [];
  for (const a of actions) {
    const key = `${a.id}:${a.resource}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ action: a.id, resource: a.resource, effect: a.effect ?? "allow" });
  }
  unique.sort(
    (x, y) => x.action.localeCompare(y.action) || x.resource.localeCompare(y.resource),
  );
  return unique;
}

function emitEntities(packId, defs) {
  const lines = [
    "/** Generated from configs/ontology/packs — do not edit by hand. */",
    "",
    `export const ONTOLOGY_ID = ${JSON.stringify(packId)} as const;`,
    "",
    "export type FoundationEntityType =",
    defs.length
      ? `  ${defs.map((d) => JSON.stringify(d.entityType)).join(" |\n  ")};`
      : "  never;",
    "",
  ];
  for (const { entityType, fields } of defs) {
    const iface = `${entityType}Properties`;
    lines.push(`export interface ${iface} {`);
    for (const f of fields.sort((a, b) => a.name.localeCompare(b.name))) {
      const opt = f.required ? "" : "?";
      lines.push(`  ${f.name}${opt}: ${tsType(f.type)};`);
    }
    lines.push("}");
    lines.push("");
  }
  return lines.join("\n") + "\n";
}

function emitActions(actions) {
  const lines = [
    "/** Generated from configs/governance/action-catalog.yaml — do not edit by hand. */",
    "",
    "export interface CatalogAction {",
    "  action: string;",
    "  resource: string;",
    "  effect: string;",
    "}",
    "",
    "export const FOUNDATION_ACTIONS: CatalogAction[] = [",
  ];
  for (const a of actions) {
    lines.push(
      `  { action: ${JSON.stringify(a.action)}, resource: ${JSON.stringify(a.resource)}, effect: ${JSON.stringify(a.effect)} },`,
    );
  }
  lines.push("];", "");
  return lines.join("\n") + "\n";
}

function emitClient(packId, defs) {
  const lines = [
    "/** Generated pack client helpers — do not edit by hand. */",
    "import type { DaemonClient } from \"../../client.js\";",
    "import type { EntityRecord, EntityListPage } from \"../../types.js\";",
    `import { ONTOLOGY_ID } from \"./entities.js\";`,
    "",
    "export const ontologyId = ONTOLOGY_ID;",
    "",
  ];
  for (const { entityType } of defs) {
    const key = entityType;
    lines.push(`export const ${key} = {`);
    lines.push(
      `  async read(client: DaemonClient, entityId: string): Promise<EntityRecord> {`,
    );
    lines.push(`    return client.readEntity(entityId, ontologyId);`);
    lines.push("  },");
    lines.push(
      `  async list(client: DaemonClient, params?: { limit?: number; cursor?: string; updatedAfter?: string }): Promise<EntityListPage> {`,
    );
    lines.push(
      `    return client.listEntities({ ontologyId, entityType: ${JSON.stringify(entityType)}, ...params });`,
    );
    lines.push("  },");
    lines.push("};", "");
  }
  return lines.join("\n") + "\n";
}

function main() {
  const { packId, outDir } = parseArgs(process.argv.slice(2));
  const packDir = join(root, "configs/ontology/packs", packId);
  if (!existsSync(packDir)) {
    console.error(`Pack not found: ${packDir}`);
    process.exit(1);
  }
  const meta = loadPackMeta(packDir);
  const ontologyId = meta.ontologyId ?? packId;
  const defs = loadEntityDefs(packDir);
  const actions = loadActions(root);
  const packOut = join(outDir, packId);
  mkdirSync(packOut, { recursive: true });
  writeFileSync(join(packOut, "entities.ts"), emitEntities(ontologyId, defs));
  writeFileSync(join(packOut, "actions.ts"), emitActions(actions));
  writeFileSync(join(packOut, "client.ts"), emitClient(ontologyId, defs));
  writeFileSync(
    join(packOut, "index.ts"),
    [
      "/** Generated pack barrel — do not edit by hand. */",
      'export * from "./entities.js";',
      'export * from "./actions.js";',
      'export * from "./client.js";',
      "",
    ].join("\n"),
  );
  console.log(`generate-pack-sdk: wrote ${packOut} (${defs.length} entities)`);
}

main();
