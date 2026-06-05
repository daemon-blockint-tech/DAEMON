import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { entityId, ontologyId } from "@daemon/platform-types";
import { OntologyRegistry } from "../../ontology/registry/ontology-registry.js";
import { Abac } from "../../security-governance/policy/abac.js";
import { RowLevelPolicy } from "../../security-governance/policy/row-level-policy.js";

describe("tenant and domain isolation", () => {
  it("same entity id in different tenants does not collide", () => {
    const reg = new OntologyRegistry();
    const id = entityId("shared-1");
    const ont = ontologyId("foundation");
    reg.register({
      scope: { tenantId: "inst-alpha", domainId: "foundation" },
      ontologyId: ont,
      entityId: id,
      entityType: "Party",
      properties: { displayName: "Alpha", entityType: "Party" },
    });
    reg.register({
      scope: { tenantId: "ent-beta", domainId: "foundation" },
      ontologyId: ont,
      entityId: id,
      entityType: "Party",
      properties: { displayName: "Beta", entityType: "Party" },
    });
    const a = reg.get(
      { tenantId: "inst-alpha", domainId: "foundation" },
      ont,
      id,
    );
    const b = reg.get(
      { tenantId: "ent-beta", domainId: "foundation" },
      ont,
      id,
    );
    assert.equal(a?.properties.displayName, "Alpha");
    assert.equal(b?.properties.displayName, "Beta");
    assert.equal(reg.list({ tenantId: "inst-alpha", domainId: "foundation" }).length, 1);
    assert.equal(reg.list({ tenantId: "ent-beta", domainId: "foundation" }).length, 1);
  });

  it("same entity id in different domains under one tenant does not collide", () => {
    const reg = new OntologyRegistry();
    const id = entityId("domain-shared-1");
    const ont = ontologyId("foundation");
    reg.register({
      scope: { tenantId: "default", domainId: "foundation" },
      ontologyId: ont,
      entityId: id,
      entityType: "Party",
      properties: { displayName: "Foundation view", entityType: "Party" },
    });
    reg.register({
      scope: { tenantId: "default", domainId: "aml-compliance" },
      ontologyId: ont,
      entityId: id,
      entityType: "Party",
      properties: { displayName: "AML view", entityType: "Party" },
    });
    const foundation = reg.get(
      { tenantId: "default", domainId: "foundation" },
      ont,
      id,
    );
    const aml = reg.get(
      { tenantId: "default", domainId: "aml-compliance" },
      ont,
      id,
    );
    assert.equal(foundation?.properties.displayName, "Foundation view");
    assert.equal(aml?.properties.displayName, "AML view");
  });

  it("logistics domain isolates shipment records from foundation domain", () => {
    const reg = new OntologyRegistry();
    const id = entityId("ship-iso-1");
    const ont = ontologyId("foundation");
    reg.register({
      scope: { tenantId: "logistics-pilot", domainId: "foundation" },
      ontologyId: ont,
      entityId: id,
      entityType: "Party",
      properties: { displayName: "Foundation party", entityType: "Party" },
    });
    reg.register({
      scope: { tenantId: "logistics-pilot", domainId: "logistics" },
      ontologyId: ont,
      entityId: id,
      entityType: "Shipment",
      properties: {
        displayName: "Logistics shipment",
        entityType: "Shipment",
        status: "open",
      },
    });
    const party = reg.get(
      { tenantId: "logistics-pilot", domainId: "foundation" },
      ont,
      id,
    );
    const shipment = reg.get(
      { tenantId: "logistics-pilot", domainId: "logistics" },
      ont,
      id,
    );
    assert.equal(party?.properties.displayName, "Foundation party");
    assert.equal(shipment?.properties.displayName, "Logistics shipment");
  });
});

describe("tenant policy boundaries (ABAC + RLS)", () => {
  it("row-level policy hides rows from other tenants", () => {
    const policy = new RowLevelPolicy();
    const rows = [
      { id: "a1", tenantId: "inst-alpha", ownerId: "analyst-1" },
      { id: "b1", tenantId: "ent-beta", ownerId: "analyst-2" },
    ];
    const alphaVisible = policy.filter(rows, {
      tenantId: "inst-alpha",
      subjectId: "analyst-1",
      roles: ["analyst"],
    });
    assert.deepEqual(
      alphaVisible.map((r) => r.id),
      ["a1"],
    );
  });

  it("ABAC allows read only when subject and resource tenant match", () => {
    const abac = new Abac([
      {
        id: "tenant-scoped-read",
        action: "read",
        effect: "allow",
        match: [
          { attribute: "subject.tenantId", operator: "eq", value: "inst-alpha" },
          { attribute: "resource.tenantId", operator: "eq", value: "inst-alpha" },
        ],
      },
    ]);
    const allowed = abac.evaluate({
      action: "read",
      subject: { tenantId: "inst-alpha" },
      resource: { tenantId: "inst-alpha" },
    });
    assert.equal(allowed.effect, "allow");
    const denied = abac.evaluate({
      action: "read",
      subject: { tenantId: "inst-alpha" },
      resource: { tenantId: "ent-beta" },
    });
    assert.equal(denied.effect, "deny");
  });
});
