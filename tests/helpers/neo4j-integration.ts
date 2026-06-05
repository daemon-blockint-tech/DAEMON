import type { TestContext } from "node:test";
import { Neo4jGraphStore } from "@daemon/data-platform/graph-store/neo4j-graph-store";

export const DEFAULT_NEO4J_DEV = {
  uri: "bolt://127.0.0.1:7687",
  user: "neo4j",
  password: "daemon-dev-neo4j",
} as const;

/**
 * Skip when Neo4j is not configured or not accepting connections.
 */
export async function skipUnlessNeo4jReady(
  t: Pick<TestContext, "skip">,
): Promise<Neo4jGraphStore | undefined> {
  const uri = process.env.DAEMON_NEO4J_URI ?? DEFAULT_NEO4J_DEV.uri;
  const user =
    process.env.DAEMON_NEO4J_USER ?? DEFAULT_NEO4J_DEV.user;
  const password =
    process.env.DAEMON_NEO4J_PASSWORD ?? DEFAULT_NEO4J_DEV.password;
  if (!uri) {
    t.skip("DAEMON_NEO4J_URI not set — start compose.dev.yaml neo4j service");
    return undefined;
  }
  const store = new Neo4jGraphStore({ uri, user, password });
  try {
    const ok = await store.ping();
    if (!ok) {
      t.skip(`Neo4j not reachable (${uri})`);
      return undefined;
    }
  } catch {
    t.skip("Neo4j not reachable — run `pnpm run dev:up`");
    return undefined;
  }
  return store;
}
