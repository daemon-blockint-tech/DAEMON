import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { OntologyScope } from "@daemon/context-ports";
import { PostgresClient } from "../../operational-store/postgres-client.js";
import { withTenantSession } from "../../operational-store/tenant-session.js";

export interface ExportOptions {
  since?: string;
  limit?: number;
  format?: "jsonl" | "parquet";
}

export interface ExportResult {
  exportId: string;
  locationUri: string;
  rowCount: number;
  catalogId: string;
  icebergMetadataUri?: string;
}

/**
 * Exports bronze lakehouse rows to on-disk JSONL (Parquet label in catalog when format=parquet;
 * full columnar Parquet encoding is a later enhancement).
 */
export class LakehouseExporter {
  private constructor(
    private readonly pg: PostgresClient | null,
    private readonly baseDir: string,
  ) {}

  static fromEnv(env: NodeJS.ProcessEnv = process.env): LakehouseExporter {
    const url = env.DAEMON_POSTGRES_URL;
    const baseDir =
      env.DAEMON_LAKEHOUSE_EXPORT_DIR ??
      join(process.cwd(), "var", "lakehouse-exports");
    if (!url) return new LakehouseExporter(null, baseDir);
    return new LakehouseExporter(
      new PostgresClient({ connectionString: url }),
      baseDir,
    );
  }

  async runExport(
    scope: OntologyScope,
    options: ExportOptions = {},
  ): Promise<ExportResult> {
    if (!this.pg) {
      throw new Error("DAEMON_POSTGRES_URL required for lakehouse export");
    }
    const exportId = `exp-${randomUUID()}`;
    const format = options.format ?? "jsonl";
    const limit = Math.min(options.limit ?? 10_000, 100_000);
    const since = options.since;

    const rows = await withTenantSession(this.pg, scope.tenantId, async (client) => {
      const params: unknown[] = [scope.tenantId, scope.domainId];
      let sql = `SELECT ontology_id, entity_id, entity_type, change_type, payload, source, indexed_at
                 FROM daemon_lakehouse_bronze
                 WHERE tenant_id = $1 AND domain_id = $2`;
      if (since) {
        params.push(since);
        sql += ` AND indexed_at >= $${params.length}`;
      }
      params.push(limit);
      sql += ` ORDER BY indexed_at DESC LIMIT $${params.length}`;
      const res = await client.query(sql, params);
      return res.rows as Array<Record<string, unknown>>;
    });

    const dir = join(this.baseDir, scope.tenantId, scope.domainId);
    await mkdir(dir, { recursive: true });
    const ext = format === "parquet" ? "jsonl" : "jsonl";
    const fileName = `${exportId}.${ext}`;
    const filePath = join(dir, fileName);
    const lines = rows.map((r) => JSON.stringify(r)).join("\n");
    await writeFile(filePath, lines ? `${lines}\n` : "", "utf8");

    const locationUri = `file://${filePath}`;
    const catalogId = `ds-${randomUUID()}`;
    const icebergDir = join(dir, `${exportId}.iceberg`);
    await mkdir(icebergDir, { recursive: true });
    const icebergMetadataUri = `file://${join(icebergDir, "metadata", "v0.metadata.json")}`;
    await mkdir(join(icebergDir, "metadata"), { recursive: true });
    await writeFile(
      join(icebergDir, "metadata", "v0.metadata.json"),
      JSON.stringify(
        {
          format: "iceberg-mvp",
          table: "daemon_lakehouse_bronze",
          files: [fileName],
          rowCount: rows.length,
          refreshedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      "utf8",
    );

    await withTenantSession(this.pg, scope.tenantId, async (client) => {
      await client.query(
        `INSERT INTO daemon_lakehouse_exports (id, tenant_id, domain_id, status, format, location_uri, completed_at)
         VALUES ($1, $2, $3, 'completed', $4, $5, NOW())`,
        [exportId, scope.tenantId, scope.domainId, format, locationUri],
      );
      await client.query(
        `INSERT INTO daemon_dataset_catalog (id, tenant_id, domain_id, name, format, location_uri, refreshed_at, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7::jsonb)`,
        [
          catalogId,
          scope.tenantId,
          scope.domainId,
          `bronze-export-${exportId}`,
          format,
          locationUri,
          JSON.stringify({ icebergMetadataUri, rowCount: rows.length }),
        ],
      );
    });

    return {
      exportId,
      locationUri,
      rowCount: rows.length,
      catalogId,
      icebergMetadataUri,
    };
  }

  async getExport(exportId: string, scope: OntologyScope) {
    if (!this.pg) return null;
    const res = await withTenantSession(this.pg, scope.tenantId, async (client) => {
      return client.query(
        `SELECT id, status, format, location_uri, error_message, created_at, completed_at
         FROM daemon_lakehouse_exports
         WHERE id = $1 AND tenant_id = $2 AND domain_id = $3`,
        [exportId, scope.tenantId, scope.domainId],
      );
    });
    return res.rows[0] ?? null;
  }
}
