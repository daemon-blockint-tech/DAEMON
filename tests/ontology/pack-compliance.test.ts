import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loadFoundationPack } from "../../ontology/packs/load-pack.js";
import { PackResolver } from "../../ontology/packs/pack-resolver.js";
import { DomainCatalog } from "../../ontology/tenancy/domain-catalog.js";
import { TenantRegistry } from "../../ontology/tenancy/tenant-registry.js";

describe("foundation ontology pack", () => {
  it("loads manifest and entity models", () => {
    const pack = loadFoundationPack();
    assert.equal(pack.manifest.ontologyId, "foundation");
    assert.ok(pack.models.has("Party"));
    assert.ok(pack.models.has("Case"));
    const party = pack.models.get("Party")!;
    const bad = party.validate({ displayName: 42 });
    assert.equal(bad.valid, false);
    const good = party.validate({ displayName: "Acme" });
    assert.equal(good.valid, true);
  });

  it("resolves pack for inst-alpha tenant", () => {
    const tenants = TenantRegistry.fromYamlFile();
    const resolver = new PackResolver(DomainCatalog.fromYamlFile());
    const tenant = tenants.require("inst-alpha");
    const resolved = resolver.resolve(tenant, "foundation");
    assert.equal(resolved.ontologyId, "foundation");
    assert.ok(resolved.entityTypes.includes("Event"));
    assert.ok(resolved.relations.has("Link"));
    assert.ok(resolved.junctions.has("CaseEvent"));
  });

  it("merges logistics-commercial extension when domain declares extensionPack", () => {
    const catalog = DomainCatalog.fromYamlFile();
    const resolver = new PackResolver(catalog);
    const tenant = {
      id: "logistics-pilot",
      displayName: "Logistics pilot",
      enabledDomains: ["logistics"],
    };
    const resolved = resolver.resolve(tenant, "logistics");
    assert.ok(resolved.entityTypes.includes("Party"));
    assert.ok(resolved.entityTypes.includes("Account"));
    assert.ok(resolved.entityTypes.includes("Shipment"));
    assert.ok(resolved.entityTypes.includes("Opportunity"));
    assert.ok(resolved.entityTypes.includes("Conversation"));
    for (const p1 of [
      "Lead",
      "Pipeline",
      "Activity",
      "AccountPlan",
      "Signal",
      "Trip",
      "Dispatch",
      "RoutingDecision",
    ]) {
      assert.ok(resolved.entityTypes.includes(p1), `missing P1 type ${p1}`);
      assert.ok(resolved.models.has(p1), `missing P1 model ${p1}`);
    }
    assert.ok(resolved.models.has("Shipment"));
    assert.ok(resolved.models.has("Opportunity"));
    assert.ok(resolved.junctions.has("ShipmentLeg"));
    const leg = resolved.junctions.get("ShipmentLeg")!;
    const ok = leg.validateMembership({
      junctionType: "ShipmentLeg",
      leftEntityId: "s1",
      rightEntityId: "m1",
      leftEntityType: "Shipment",
      rightEntityType: "Manifest",
    });
    assert.equal(ok.valid, true);
  });

  it("merges aml-compliance extension when domain declares extensionPack", () => {
    const catalog = DomainCatalog.fromYamlFile();
    const resolver = new PackResolver(catalog);
    const tenant = {
      id: "test-aml",
      displayName: "Test AML",
      enabledDomains: ["aml-compliance"],
    };
    const resolved = resolver.resolve(tenant, "aml-compliance");
    assert.ok(resolved.entityTypes.includes("Party"));
    assert.ok(resolved.entityTypes.includes("Alert"));
    assert.ok(resolved.models.has("Alert"));
  });

  it("loads relations and junctions with endpoint validation", () => {
    const pack = loadFoundationPack();
    const link = pack.relations.get("Link")!;
    const bad = link.validateLinkProperties({
      linkType: "relates",
      fromEntityId: "a",
      toEntityId: "b",
      fromEntityType: "NotReal",
    });
    assert.equal(bad.valid, false);
    const good = link.validateLinkProperties({
      linkType: "relates",
      fromEntityId: "a",
      toEntityId: "b",
      fromEntityType: "Case",
      toEntityType: "Event",
    });
    assert.equal(good.valid, true);

    const junction = pack.junctions.get("CaseEvent")!;
    const jBad = junction.validateMembership({
      junctionType: "CaseEvent",
      leftEntityId: "c1",
      rightEntityId: "e1",
      leftEntityType: "Party",
      rightEntityType: "Party",
    });
    assert.equal(jBad.valid, false);
  });
});
