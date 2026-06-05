import { createHmac, timingSafeEqual } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { DaemonError, ErrorCodes } from "@daemon/platform-types";
import type { TenantContextHeaders } from "../platform/tenant-context";
import { IngestService, type IngestRecord } from "./ingest.service";

@Injectable()
export class IngestWebhookService {
  constructor(private readonly ingestService: IngestService) {}

  verifySignature(
    rawBody: string,
    signatureHeader: string | undefined,
  ): void {
    const secret = process.env.DAEMON_WEBHOOK_HMAC_SECRET;
    if (!secret) return;
    if (!signatureHeader) {
      throw new DaemonError(
        ErrorCodes.UNAUTHORIZED,
        "missing X-Daemon-Signature",
        401,
      );
    }
    const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
    const provided = signatureHeader.replace(/^sha256=/, "");
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(provided, "utf8");
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new DaemonError(ErrorCodes.UNAUTHORIZED, "invalid webhook signature", 401);
    }
  }

  normalizePayload(body: unknown): IngestRecord[] {
    if (Array.isArray(body)) {
      return body.filter(isIngestRecord);
    }
    if (typeof body === "object" && body !== null) {
      const obj = body as Record<string, unknown>;
      if (Array.isArray(obj.records)) {
        return obj.records.filter(isIngestRecord);
      }
      if (typeof obj.ontologyId === "string") {
        return [
          {
            ontologyId: obj.ontologyId,
            entityId: typeof obj.entityId === "string" ? obj.entityId : undefined,
            entityType:
              typeof obj.entityType === "string" ? obj.entityType : undefined,
            properties: (() => {
              const raw =
                typeof obj.properties === "object" && obj.properties !== null
                  ? obj.properties
                  : typeof obj.payload === "object" && obj.payload !== null
                    ? obj.payload
                    : {};
              return raw as Record<string, unknown>;
            })(),
          },
        ];
      }
    }
    throw new DaemonError(
      ErrorCodes.VALIDATION,
      "webhook body must be records array or entity payload",
      400,
    );
  }

  async ingest(
    ctx: TenantContextHeaders,
    sourceId: string,
    records: IngestRecord[],
  ) {
    return this.ingestService.ingestRecords(ctx, sourceId, records);
  }
}

function isIngestRecord(value: unknown): value is IngestRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as IngestRecord).ontologyId === "string"
  );
}
