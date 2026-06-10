import { createHmac, timingSafeEqual } from "node:crypto";
import { DaemonError, ErrorCodes } from "@daemon/platform-types";
import { isProductionPolicyMode } from "../policy/policy-mode";

/**
 * Verifies `X-Daemon-Signature` for machine ingress webhooks; fail-closed when required.
 *
 * Uses constant-length hex buffers (64 bytes for SHA-256) so that timingSafeEqual
 * is never preceded by a length comparison that leaks the expected HMAC value.
 */
export function verifyWebhookHmacSignature(
  rawBody: string,
  signatureHeader: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const secret = env.DAEMON_WEBHOOK_HMAC_SECRET;
  const requireHmac =
    env.DAEMON_WEBHOOK_REQUIRE_HMAC === "1" || isProductionPolicyMode(env);
  if (!secret) {
    if (requireHmac) {
      throw new DaemonError(
        ErrorCodes.UNAUTHORIZED,
        "webhook-auth-unconfigured",
        env.NODE_ENV === "production" ? 503 : 401,
      );
    }
    return;
  }
  if (!signatureHeader) {
    throw new DaemonError(
      ErrorCodes.UNAUTHORIZED,
      "missing X-Daemon-Signature",
      401,
    );
  }
  const expectedHex = createHmac("sha256", secret).update(rawBody).digest("hex");
  const providedHex = signatureHeader.replace(/^sha256=/i, "").toLowerCase();

  // Allocate fixed 64-byte buffers (SHA-256 hex is always 64 chars) so that
  // timingSafeEqual never sees differing lengths — preventing timing oracle.
  const a = Buffer.alloc(64, 0);
  const b = Buffer.alloc(64, 0);
  Buffer.from(expectedHex, "ascii").copy(a, 0, 0, Math.min(64, expectedHex.length));
  Buffer.from(providedHex, "ascii").copy(b, 0, 0, Math.min(64, providedHex.length));

  if (!timingSafeEqual(a, b)) {
    throw new DaemonError(ErrorCodes.UNAUTHORIZED, "invalid webhook signature", 401);
  }
}
