import type { EntityId, OntologyId } from "@daemon/platform-types";
import { defaultOntology, defaultScope, type EntityRecord } from "@daemon/ontology";
import type { ProductRuntime } from "../shared/product-runtime.js";

export interface QueryWizardRequest {
  query: string;
  ontologyId?: OntologyId;
  limit?: number;
  /** When set, only entities with this property key are considered. */
  property?: string;
  /** Exact match on `property` (string/number/boolean coerced to string). */
  propertyValue?: string;
  mode?: "hybrid" | "keyword";
}

function matchesPropertyFilters(
  record: EntityRecord,
  req: QueryWizardRequest,
): boolean {
  if (req.property) {
    if (!(req.property in record.properties)) {
      return false;
    }
    if (req.propertyValue !== undefined) {
      const actual = String(record.properties[req.property]);
      if (actual !== req.propertyValue) {
        return false;
      }
    }
  }
  return true;
}

function substringFallback(
  records: EntityRecord[],
  needle: string,
  limit: number,
): EntityRecord[] {
  const q = needle.toLowerCase();
  return records
    .filter((record) => {
      const hay = JSON.stringify(record.properties).toLowerCase();
      return hay.includes(q);
    })
    .slice(0, limit);
}

/**
 * Ontology-backed search for analytics workflows. Uses scoped hybrid index when
 * available; falls back to substring match on listed entities.
 */
export class QueryWizard {
  constructor(private readonly runtime: ProductRuntime) {}

  async search(req: QueryWizardRequest): Promise<EntityRecord[]> {
    this.runtime.assertAllowed("query", "analytics");
    const ont = req.ontologyId ?? defaultOntology();
    const needle = req.query.trim();
    if (!needle) {
      return [];
    }
    const limit = req.limit ?? 50;
    const scope = this.runtime.scope ?? defaultScope();

    if (this.runtime.search) {
      const hits = await this.runtime.search.search(scope, {
        query: needle,
        limit: limit * 2,
        ontologyId: ont,
        mode: req.mode,
      });
      const records: EntityRecord[] = [];
      for (const hit of hits) {
        const record = this.runtime.store.get(
          scope,
          hit.ontologyId as OntologyId,
          hit.entityId as EntityId,
        );
        if (!record) continue;
        if (!matchesPropertyFilters(record, req)) continue;
        records.push(record);
        if (records.length >= limit) break;
      }
      if (records.length > 0) {
        return records;
      }
    }

    const listed = this.runtime.store.list(scope, ont);
    const filtered = listed.filter((r) => matchesPropertyFilters(r, req));
    return substringFallback(filtered, needle, limit);
  }
}
