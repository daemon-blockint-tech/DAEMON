import { Injectable } from "@nestjs/common";
import type { PolicyDecision } from "@daemon/platform-types";
import {
  isPolicySkipUpstream,
  isProductionPolicyMode,
  requiresUpstreamPolicyDecision,
} from "./policy-mode.js";

function devDefaultDecision(action: string, resource: string): PolicyDecision {
  const allowed =
    ((action === "read" || action === "write") && resource === "entity") ||
    (action === "query" && (resource === "analytics" || resource === "ontology-nl")) ||
    (action === "ingest" && resource.startsWith("ingest"));
  return {
    effect: allowed ? "allow" : "deny",
    reason: allowed ? "dev-default" : "no rule",
  };
}

function denyClosed(reason: string): PolicyDecision {
  return { effect: "deny", reason };
}

@Injectable()
export class PolicyService {
  async check(action: string, resource: string): Promise<PolicyDecision> {
    const env = process.env;
    const url = env.POLICY_ENGINE_URL;
    const skipUpstream = isPolicySkipUpstream(env);
    const prod = isProductionPolicyMode(env);
    const sensitive = requiresUpstreamPolicyDecision(action, resource);

    if (prod && !url) {
      return denyClosed("policy-engine-unconfigured");
    }

    if (prod && sensitive && skipUpstream) {
      return denyClosed("upstream-policy-required");
    }

    let upstreamAttempted = false;
    if (url && !skipUpstream) {
      upstreamAttempted = true;
      try {
        const res = await fetch(`${url}/check`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action, resource }),
        });
        if (res.ok) {
          return (await res.json()) as PolicyDecision;
        }
      } catch {
        // unreachable — fail closed in production, dev fallback otherwise
      }
      if (prod) {
        return denyClosed("policy-engine-unreachable");
      }
    }

    if (!prod && (!url || skipUpstream || upstreamAttempted)) {
      return devDefaultDecision(action, resource);
    }

    return denyClosed("policy-denied");
  }
}
