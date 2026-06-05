import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { sourcesConfigPath } from "../paths.js";

export type ConnectorType =
  | "file"
  | "http-pull"
  | "postgres-read"
  | "event-subscriber"
  | "s3"
  | "kafka"
  | "jdbc-cdc";

export interface FileConnectorConfig {
  readonly type: "file";
  readonly format: "jsonl" | "csv";
  readonly path: string;
}

export interface HttpPullConnectorConfig {
  readonly type: "http-pull";
  readonly url: string;
  readonly method?: "GET" | "POST";
  readonly headers?: Record<string, string>;
  readonly body?: unknown;
  readonly recordIdKey?: string;
}

export interface PostgresReadConnectorConfig {
  readonly type: "postgres-read";
  readonly sql: string;
  readonly params?: ReadonlyArray<unknown>;
  readonly recordIdColumn?: string;
}

export interface EventSubscriberConnectorConfig {
  readonly type: "event-subscriber";
  readonly subject: string;
  readonly batchSize?: number;
  readonly recordIdKey?: string;
  readonly pullTimeoutMs?: number;
}

export interface S3ConnectorConfig {
  readonly type: "s3";
  readonly bucket: string;
  readonly prefix?: string;
  readonly region?: string;
  readonly format: "jsonl" | "csv";
  readonly keys?: readonly string[];
  readonly recordIdKey?: string;
  readonly endpoint?: string;
}

export interface KafkaConnectorConfig {
  readonly type: "kafka";
  readonly brokers: readonly string[];
  readonly topic: string;
  readonly groupId?: string;
  readonly maxMessages?: number;
  readonly recordIdKey?: string;
}

export interface JdbcCdcConnectorConfig {
  readonly type: "jdbc-cdc";
  readonly table: string;
  readonly cursorColumn: string;
  readonly lastCursor?: string;
  readonly recordIdColumn?: string;
}

export type SourceConnectorConfig =
  | FileConnectorConfig
  | HttpPullConnectorConfig
  | PostgresReadConnectorConfig
  | EventSubscriberConnectorConfig
  | S3ConnectorConfig
  | KafkaConnectorConfig
  | JdbcCdcConnectorConfig;

export interface SourceNormalizeConfig {
  readonly ontologyId: string;
  readonly entityType?: string;
  readonly mapping: Record<string, string>;
  readonly idField?: string;
  readonly meta?: Record<string, unknown>;
}

export interface IngestSourceDefinition {
  readonly id: string;
  readonly enabled: boolean;
  readonly connector: SourceConnectorConfig;
  readonly normalize: SourceNormalizeConfig;
}

interface SourcesYaml {
  sources?: unknown;
}

function assertObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function parseConnector(raw: unknown, sourceId: string): SourceConnectorConfig {
  const obj = assertObject(raw, `source ${sourceId} connector`);
  const type = obj.type;
  if (type === "file") {
    const format = obj.format;
    if (format !== "jsonl" && format !== "csv") {
      throw new Error(`source ${sourceId}: file connector requires format jsonl|csv`);
    }
    const path = obj.path;
    if (typeof path !== "string" || !path.trim()) {
      throw new Error(`source ${sourceId}: file connector requires path`);
    }
    return { type: "file", format, path: path.trim() };
  }
  if (type === "http-pull") {
    const url = obj.url;
    if (typeof url !== "string" || !url.trim()) {
      throw new Error(`source ${sourceId}: http-pull requires url`);
    }
    const method = obj.method;
    if (method !== undefined && method !== "GET" && method !== "POST") {
      throw new Error(`source ${sourceId}: http-pull method must be GET or POST`);
    }
    return {
      type: "http-pull",
      url: url.trim(),
      method: method ?? "GET",
      headers:
        typeof obj.headers === "object" && obj.headers !== null && !Array.isArray(obj.headers)
          ? (obj.headers as Record<string, string>)
          : undefined,
      body: obj.body,
      recordIdKey:
        typeof obj.recordIdKey === "string" ? obj.recordIdKey : undefined,
    };
  }
  if (type === "postgres-read") {
    const sql = obj.sql;
    if (typeof sql !== "string" || !sql.trim()) {
      throw new Error(`source ${sourceId}: postgres-read requires sql`);
    }
    return {
      type: "postgres-read",
      sql: sql.trim(),
      params: Array.isArray(obj.params) ? obj.params : undefined,
      recordIdColumn:
        typeof obj.recordIdColumn === "string" ? obj.recordIdColumn : undefined,
    };
  }
  if (type === "event-subscriber") {
    const subject = obj.subject;
    if (typeof subject !== "string" || !subject.trim()) {
      throw new Error(`source ${sourceId}: event-subscriber requires subject`);
    }
    return {
      type: "event-subscriber",
      subject: subject.trim(),
      batchSize: typeof obj.batchSize === "number" ? obj.batchSize : undefined,
      recordIdKey:
        typeof obj.recordIdKey === "string" ? obj.recordIdKey : undefined,
      pullTimeoutMs:
        typeof obj.pullTimeoutMs === "number" ? obj.pullTimeoutMs : undefined,
    };
  }
  if (type === "s3") {
    const bucket = obj.bucket;
    if (typeof bucket !== "string" || !bucket.trim()) {
      throw new Error(`source ${sourceId}: s3 requires bucket`);
    }
    const format = obj.format;
    if (format !== "jsonl" && format !== "csv") {
      throw new Error(`source ${sourceId}: s3 format must be jsonl|csv`);
    }
    const keys = Array.isArray(obj.keys)
      ? obj.keys.filter((k): k is string => typeof k === "string")
      : undefined;
    return {
      type: "s3",
      bucket: bucket.trim(),
      prefix: typeof obj.prefix === "string" ? obj.prefix : undefined,
      region: typeof obj.region === "string" ? obj.region : undefined,
      format,
      keys,
      recordIdKey:
        typeof obj.recordIdKey === "string" ? obj.recordIdKey : undefined,
      endpoint: typeof obj.endpoint === "string" ? obj.endpoint : undefined,
    };
  }
  if (type === "kafka") {
    const topic = obj.topic;
    if (typeof topic !== "string" || !topic.trim()) {
      throw new Error(`source ${sourceId}: kafka requires topic`);
    }
    const brokersRaw = obj.brokers;
    const brokers = Array.isArray(brokersRaw)
      ? brokersRaw.filter(
          (b): b is string => typeof b === "string" && b.trim().length > 0,
        )
      : typeof obj.broker === "string"
        ? [obj.broker]
        : [];
    if (brokers.length === 0) {
      throw new Error(`source ${sourceId}: kafka requires brokers array`);
    }
    return {
      type: "kafka",
      brokers,
      topic: topic.trim(),
      groupId: typeof obj.groupId === "string" ? obj.groupId : undefined,
      maxMessages:
        typeof obj.maxMessages === "number" ? obj.maxMessages : undefined,
      recordIdKey:
        typeof obj.recordIdKey === "string" ? obj.recordIdKey : undefined,
    };
  }
  if (type === "jdbc-cdc") {
    const table = obj.table;
    const cursorColumn = obj.cursorColumn;
    if (typeof table !== "string" || !table.trim()) {
      throw new Error(`source ${sourceId}: jdbc-cdc requires table`);
    }
    if (typeof cursorColumn !== "string" || !cursorColumn.trim()) {
      throw new Error(`source ${sourceId}: jdbc-cdc requires cursorColumn`);
    }
    return {
      type: "jdbc-cdc",
      table: table.trim(),
      cursorColumn: cursorColumn.trim(),
      lastCursor:
        typeof obj.lastCursor === "string" ? obj.lastCursor : undefined,
      recordIdColumn:
        typeof obj.recordIdColumn === "string"
          ? obj.recordIdColumn
          : undefined,
    };
  }
  throw new Error(
    `source ${sourceId}: unsupported connector type ${String(type)}`,
  );
}

function parseNormalize(raw: unknown, sourceId: string): SourceNormalizeConfig {
  const obj = assertObject(raw, `source ${sourceId} normalize`);
  const ontologyId = obj.ontologyId;
  if (typeof ontologyId !== "string" || !ontologyId.trim()) {
    throw new Error(`source ${sourceId}: normalize.ontologyId is required`);
  }
  const mappingRaw = obj.mapping;
  if (
    typeof mappingRaw !== "object" ||
    mappingRaw === null ||
    Array.isArray(mappingRaw)
  ) {
    throw new Error(`source ${sourceId}: normalize.mapping must be an object`);
  }
  const mapping: Record<string, string> = {};
  for (const [k, v] of Object.entries(mappingRaw)) {
    if (typeof v !== "string" || !v.trim()) {
      throw new Error(`source ${sourceId}: mapping.${k} must be a non-empty string`);
    }
    mapping[k] = v.trim();
  }
  if (Object.keys(mapping).length === 0) {
    throw new Error(`source ${sourceId}: normalize.mapping must not be empty`);
  }
  return {
    ontologyId: ontologyId.trim(),
    entityType:
      typeof obj.entityType === "string" && obj.entityType.trim()
        ? obj.entityType.trim()
        : undefined,
    mapping,
    idField:
      typeof obj.idField === "string" && obj.idField.trim()
        ? obj.idField.trim()
        : undefined,
    meta:
      typeof obj.meta === "object" && obj.meta !== null && !Array.isArray(obj.meta)
        ? (obj.meta as Record<string, unknown>)
        : undefined,
  };
}

function parseSource(raw: unknown): IngestSourceDefinition {
  const obj = assertObject(raw, "source entry");
  const id = obj.id;
  if (typeof id !== "string" || !id.trim()) {
    throw new Error("source id is required");
  }
  const enabled = obj.enabled !== false;
  return {
    id: id.trim(),
    enabled,
    connector: parseConnector(obj.connector, id.trim()),
    normalize: parseNormalize(obj.normalize, id.trim()),
  };
}

export class SourceCatalog {
  private readonly byId: Map<string, IngestSourceDefinition>;

  constructor(sources: readonly IngestSourceDefinition[]) {
    this.byId = new Map();
    for (const source of sources) {
      if (this.byId.has(source.id)) {
        throw new Error(`duplicate ingest source id: ${source.id}`);
      }
      this.byId.set(source.id, source);
    }
  }

  static fromYamlFile(path: string = sourcesConfigPath()): SourceCatalog {
    const text = readFileSync(path, "utf8");
    const doc = parseYaml(text) as SourcesYaml;
    if (!Array.isArray(doc.sources)) {
      throw new Error("sources.yaml must contain a sources array");
    }
    const parsed = doc.sources.map(parseSource);
    const parityFixtures =
      process.env.DAEMON_PARITY_FIXTURES === "1" ||
      process.env.DAEMON_PARITY_FIXTURES === "true";
    const sources = parityFixtures
      ? parsed.map((s) =>
          s.id === "fixture-http-pull" || s.id === "fixture-postgres-read"
            ? { ...s, enabled: true }
            : s,
        )
      : parsed;
    return new SourceCatalog(sources);
  }

  list(): IngestSourceDefinition[] {
    return [...this.byId.values()];
  }

  require(sourceId: string): IngestSourceDefinition {
    const source = this.byId.get(sourceId);
    if (!source) {
      throw new Error(`unknown ingest source: ${sourceId}`);
    }
    if (!source.enabled) {
      throw new Error(`ingest source is disabled: ${sourceId}`);
    }
    return source;
  }
}
