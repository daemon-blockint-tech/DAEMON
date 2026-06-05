#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { basename } from "node:path";

function usage(): void {
  console.error(`Usage: daemon-agent push --file <path> --source <sourceId> [options]

Options:
  --gateway <url>     Gateway base URL (default DAEMON_GATEWAY_URL or http://127.0.0.1:3000)
  --api-key <key>     DAEMON_API_KEY or --api-key
  --tenant <id>       X-Daemon-Tenant (default: default)
  --domain <id>       X-Daemon-Domain (default: foundation)
  --ontology <id>     ontologyId when sending raw JSONL rows
  --entity-type <t>   entityType for all rows
`);
  process.exit(1);
}

function parseArgs(argv: string[]) {
  const opts: Record<string, string> = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "push") {
      positional.push(a);
      continue;
    }
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        opts[key] = next;
        i++;
      } else {
        opts[key] = "true";
      }
    }
  }
  return { opts, positional };
}

async function main(): Promise<void> {
  const { opts, positional } = parseArgs(process.argv.slice(2));
  if (positional[0] !== "push" || !opts.file) usage();

  const gateway =
    opts.gateway ??
    process.env.DAEMON_GATEWAY_URL ??
    "http://127.0.0.1:3000";
  const apiKey = opts["api-key"] ?? process.env.DAEMON_API_KEY;
  const sourceId = opts.source ?? "agent";
  const tenant = opts.tenant ?? "default";
  const domain = opts.domain ?? "foundation";
  const ontologyId = opts.ontology;
  const entityType = opts["entity-type"];

  const text = readFileSync(opts.file, "utf8");
  const records: Record<string, unknown>[] = [];
  if (opts.file.endsWith(".json")) {
    const parsed = JSON.parse(text) as unknown;
    if (Array.isArray(parsed)) {
      for (const row of parsed) {
        if (typeof row === "object" && row !== null) {
          records.push(row as Record<string, unknown>);
        }
      }
    }
  } else {
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      records.push(JSON.parse(trimmed) as Record<string, unknown>);
    }
  }

  const body = ontologyId
    ? {
        sourceId,
        records: records.map((row) => ({
          ontologyId,
          entityId: String(row.id ?? row.entityId ?? `${basename(opts.file)}-${records.indexOf(row)}`),
          entityType: entityType ?? (row.entityType as string | undefined),
          properties: row,
        })),
      }
    : { sourceId, records };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Daemon-Tenant": tenant,
    "X-Daemon-Domain": domain,
  };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const res = await fetch(`${gateway.replace(/\/$/, "")}/v1/ingest/records`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error("ingest failed", res.status, json);
    process.exit(1);
  }
  console.log(JSON.stringify(json, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
