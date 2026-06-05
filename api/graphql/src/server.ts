import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { graphql } from "graphql";
import { schema } from "./schema.js";

interface GraphQLRequest {
  query: string;
  variables?: Record<string, unknown>;
  operationName?: string;
}

/**
 * Builds the GraphQL HTTP server. It executes operations against the shared
 * {@link schema}, which reads the same ontology registry as the gateway. The
 * server is returned unstarted so tests can bind an ephemeral port.
 *
 * - `GET /health`   — liveness probe
 * - `POST /graphql` — standard `{ query, variables }` execution
 */
export function createGraphQLServer(): Server {
  return createServer((req, res) => {
    handle(req, res).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      sendJson(res, 500, { errors: [{ message }] });
    });
  });
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const method = req.method ?? "GET";
  const path = (req.url ?? "/").split("?")[0];

  if (method === "GET" && path === "/health") {
    return sendJson(res, 200, { status: "ok" });
  }

  if (method === "POST" && path === "/graphql") {
    const body = await readJson<GraphQLRequest>(req);
    if (!body || typeof body.query !== "string") {
      return sendJson(res, 400, { errors: [{ message: "query is required" }] });
    }
    const result = await graphql({
      schema,
      source: body.query,
      variableValues: body.variables,
      operationName: body.operationName,
    });
    return sendJson(res, 200, result);
  }

  sendJson(res, 404, { errors: [{ message: `no route for ${method} ${path}` }] });
}

function readJson<T>(req: IncomingMessage): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (!raw) return resolve(undefined);
      try {
        resolve(JSON.parse(raw) as T);
      } catch {
        resolve(undefined);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}
