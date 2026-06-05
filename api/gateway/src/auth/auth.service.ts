import { Injectable } from "@nestjs/common";
import {
  DaemonError,
  ErrorCodes,
  type DaemonSession,
  type SessionId,
} from "@daemon/platform-types";

export interface AuthHeaders {
  "x-api-key"?: string;
  authorization?: string;
  "x-daemon-session"?: string;
}

interface ApiKeyRecord {
  key: string;
  subjectId: string;
  tenantId: string;
  roles: string[];
}

/**
 * Dev-grade authentication: resolves a {@link DaemonSession} from one of
 * three credential carriers, in priority order:
 *
 * 1. `x-daemon-session` — a pre-issued session JSON (used by internal services).
 * 2. `x-api-key` — matched against `DAEMON_API_KEYS` (or a built-in dev key).
 * 3. `authorization: Bearer <jwt>` — decoded (unverified) only in `dev` mode.
 *
 * Production OIDC/JWKS verification is intentionally out of scope per the plan.
 */
@Injectable()
export class AuthService {
  private readonly apiKeys: ReadonlyMap<string, ApiKeyRecord>;
  private readonly mode: string;

  constructor(env: NodeJS.ProcessEnv) {
    this.mode = env.DAEMON_AUTH_MODE ?? "dev";
    this.apiKeys = AuthService.parseApiKeys(env.DAEMON_API_KEYS, this.mode);
  }

  /** Nest and tests should use this; avoids DI on `process.env`. */
  static create(env: NodeJS.ProcessEnv = process.env): AuthService {
    return new AuthService(env);
  }

  /** Resolves a session, or `null` when no credential is present. Throws on malformed credentials. */
  resolveSession(headers: AuthHeaders): DaemonSession | null {
    const raw = headers["x-daemon-session"];
    if (raw) {
      return this.fromSessionHeader(raw);
    }

    const apiKey = headers["x-api-key"];
    if (apiKey) {
      return this.fromApiKey(apiKey);
    }

    const authorization = headers.authorization;
    if (authorization) {
      return this.fromBearer(authorization);
    }

    return null;
  }

  private fromSessionHeader(raw: string): DaemonSession {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new DaemonError(ErrorCodes.UNAUTHORIZED, "malformed x-daemon-session header", 401);
    }
    return AuthService.coerceSession(parsed);
  }

  private fromApiKey(apiKey: string): DaemonSession {
    const record = this.apiKeys.get(apiKey);
    if (!record) {
      throw new DaemonError(ErrorCodes.UNAUTHORIZED, "unknown api key", 401);
    }
    return {
      sessionId: `apikey:${record.key}` as SessionId,
      subjectId: record.subjectId,
      tenantId: record.tenantId,
      roles: [...record.roles],
      issuedAt: new Date().toISOString(),
    };
  }

  private fromBearer(authorization: string): DaemonSession {
    const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
    if (!match) {
      throw new DaemonError(ErrorCodes.UNAUTHORIZED, "invalid authorization scheme", 401);
    }
    if (this.mode !== "dev") {
      throw new DaemonError(
        ErrorCodes.UNAUTHORIZED,
        "bearer tokens require dev auth mode",
        401,
      );
    }
    const claims = AuthService.decodeJwtClaims(match[1]);
    return {
      sessionId: `jwt:${String(claims.sub ?? "anonymous")}` as SessionId,
      subjectId: String(claims.sub ?? "anonymous"),
      tenantId: String(claims.tenant ?? claims.tid ?? "default"),
      roles: AuthService.coerceRoles(claims.roles),
      issuedAt: new Date().toISOString(),
    };
  }

  private static decodeJwtClaims(token: string): Record<string, unknown> {
    const parts = token.split(".");
    if (parts.length !== 3) {
      throw new DaemonError(ErrorCodes.UNAUTHORIZED, "malformed jwt", 401);
    }
    try {
      const payload = Buffer.from(parts[1], "base64url").toString("utf8");
      const claims = JSON.parse(payload) as unknown;
      if (typeof claims !== "object" || claims === null) {
        throw new Error("non-object claims");
      }
      return claims as Record<string, unknown>;
    } catch {
      throw new DaemonError(ErrorCodes.UNAUTHORIZED, "undecodable jwt payload", 401);
    }
  }

  private static coerceSession(value: unknown): DaemonSession {
    if (typeof value !== "object" || value === null) {
      throw new DaemonError(ErrorCodes.UNAUTHORIZED, "session must be an object", 401);
    }
    const candidate = value as Record<string, unknown>;
    const subjectId = candidate.subjectId;
    const tenantId = candidate.tenantId;
    if (typeof subjectId !== "string" || typeof tenantId !== "string") {
      throw new DaemonError(
        ErrorCodes.UNAUTHORIZED,
        "session requires subjectId and tenantId",
        401,
      );
    }
    return {
      sessionId: (typeof candidate.sessionId === "string"
        ? candidate.sessionId
        : `session:${subjectId}`) as SessionId,
      subjectId,
      tenantId,
      roles: AuthService.coerceRoles(candidate.roles),
      issuedAt:
        typeof candidate.issuedAt === "string"
          ? candidate.issuedAt
          : new Date().toISOString(),
    };
  }

  private static coerceRoles(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value.filter((entry): entry is string => typeof entry === "string");
    }
    return [];
  }

  private static parseApiKeys(
    raw: string | undefined,
    mode: string,
  ): Map<string, ApiKeyRecord> {
    const keys = new Map<string, ApiKeyRecord>();
    if (raw) {
      for (const entry of raw.split(",").map((part) => part.trim()).filter(Boolean)) {
        const [key, subjectId = "service", tenantId = "default", roleList = ""] =
          entry.split(":");
        if (!key) {
          continue;
        }
        keys.set(key, {
          key,
          subjectId,
          tenantId,
          roles: roleList.split("|").map((role) => role.trim()).filter(Boolean),
        });
      }
    }
    if (keys.size === 0 && mode === "dev") {
      keys.set("daemon-dev-key", {
        key: "daemon-dev-key",
        subjectId: "dev",
        tenantId: "default",
        roles: ["admin"],
      });
    }
    return keys;
  }
}
