import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { globalRegistry } from "@daemon/ontology";
import { ontologyId, entityId } from "@daemon/platform-types";
import { AnalyticsController } from "./analytics.controller.js";
import { AnalyticsService } from "./analytics.service.js";

describe("AnalyticsController", () => {
  it("search and dashboard endpoints return analytics payloads", () => {
    const ont = ontologyId(`gw-analytics-${Date.now()}`);
    globalRegistry.register(ont, { status: "active", tag: "alpha" }, entityId("ga-1"));
    const controller = new AnalyticsController(new AnalyticsService());
    const report = controller.searchReport("alpha", ont, undefined, undefined, undefined, "GW");
    assert.equal(report.rowCount, 1);
    assert.equal(report.title, "GW");
    const dash = controller.dashboard(ont, "status");
    assert.equal(
      (dash.widgets.find((w) => w.id === "entity-count")?.data as { total: number }).total,
      1,
    );
    const entities = controller.searchEntities("alpha", ont);
    assert.equal(entities.length, 1);
  });
});
