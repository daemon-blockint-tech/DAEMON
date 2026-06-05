#!/usr/bin/env node
/**
 * Minimal MCP stdio server — proxies ontology/lakehouse/search tools to the Nest gateway.
 * Env: DAEMON_GATEWAY_URL (default http://127.0.0.1:3000), DAEMON_API_KEY, X-Daemon-Tenant/Domain via env.
 */
import { createInterface } from "node:readline";

const GATEWAY = process.env.DAEMON_GATEWAY_URL ?? "http://127.0.0.1:3000";
const TENANT = process.env.DAEMON_TENANT ?? "default";
const DOMAIN = process.env.DAEMON_DOMAIN ?? "foundation";
const API_KEY = process.env.DAEMON_API_KEY ?? "daemon-dev-key";

const TOOLS = [
  {
    name: "search",
    description: "Hybrid/keyword search over the ontology index",
    inputSchema: {
      type: "object",
      properties: {
        q: { type: "string" },
        limit: { type: "number" },
      },
      required: ["q"],
    },
  },
  {
    name: "getEntity",
    description: "Read a single entity by id and ontologyId",
    inputSchema: {
      type: "object",
      properties: {
        entityId: { type: "string" },
        ontologyId: { type: "string" },
      },
      required: ["entityId", "ontologyId"],
    },
  },
  {
    name: "lakehouseEvents",
    description: "List lakehouse change events",
    inputSchema: {
      type: "object",
      properties: {
        since: { type: "string" },
        limit: { type: "number" },
      },
    },
  },
  {
    name: "queryAsk",
    description: "Natural-language ontology query (when enabled)",
    inputSchema: {
      type: "object",
      properties: {
        question: { type: "string" },
        ontologyId: { type: "string" },
      },
      required: ["question"],
    },
  },
];

function headers() {
  return {
    "content-type": "application/json",
    "x-daemon-api-key": API_KEY,
    "x-daemon-tenant": TENANT,
    "x-daemon-domain": DOMAIN,
  };
}

async function gateway(method, path, body) {
  const res = await fetch(`${GATEWAY}${path}`, {
    method,
    headers: headers(),
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${res.status} ${text}`);
  }
  return text ? JSON.parse(text) : {};
}

async function callTool(name, args) {
  switch (name) {
    case "search": {
      const q = new URLSearchParams({ q: args.q });
      if (args.limit != null) q.set("limit", String(args.limit));
      return gateway("GET", `/v1/search?${q}`);
    }
    case "getEntity":
      return gateway(
        "GET",
        `/v1/read/entities/${encodeURIComponent(args.entityId)}?ontologyId=${encodeURIComponent(args.ontologyId)}`,
      );
    case "lakehouseEvents": {
      const q = new URLSearchParams();
      if (args.since) q.set("since", args.since);
      if (args.limit != null) q.set("limit", String(args.limit));
      const suffix = q.size ? `?${q}` : "";
      return gateway("GET", `/v1/lakehouse/events${suffix}`);
    }
    case "queryAsk":
      return gateway("POST", "/v1/query/ask", {
        question: args.question,
        ontologyId: args.ontologyId ?? "foundation",
      });
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

function send(msg) {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

function handle(msg) {
  const { id, method, params } = msg;
  if (method === "initialize") {
    send({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "daemon-ontology-mcp", version: "0.1.0" },
      },
    });
    return;
  }
  if (method === "notifications/initialized") return;
  if (method === "tools/list") {
    send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
    return;
  }
  if (method === "tools/call") {
    const name = params?.name;
    const args = params?.arguments ?? {};
    callTool(name, args)
      .then((data) => {
        send({
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
          },
        });
      })
      .catch((err) => {
        send({
          jsonrpc: "2.0",
          id,
          error: { code: -32000, message: String(err?.message ?? err) },
        });
      });
    return;
  }
  send({
    jsonrpc: "2.0",
    id,
    error: { code: -32601, message: `Method not found: ${method}` },
  });
}

const rl = createInterface({ input: process.stdin, terminal: false });
rl.on("line", (line) => {
  if (!line.trim()) return;
  try {
    handle(JSON.parse(line));
  } catch (e) {
    send({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: String(e) },
    });
  }
});
