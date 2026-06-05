/** Production policy: upstream engine required; no dev defaults. */
export function isProductionPolicyMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === "production" || env.DAEMON_POLICY_MODE === "prod";
}

export function isPolicySkipUpstream(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.DAEMON_POLICY_SKIP_UPSTREAM === "1" || env.DAEMON_POLICY_SKIP_UPSTREAM === "true";
}

/** Actions that must receive an upstream policy decision in production. */
export function requiresUpstreamPolicyDecision(
  action: string,
  resource: string,
): boolean {
  return (
    action === "write" ||
    (action === "query" && resource === "ontology-nl")
  );
}
