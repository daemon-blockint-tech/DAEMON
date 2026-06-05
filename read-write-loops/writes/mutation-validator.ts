import type { WriteCommand } from "./command-gateway.js";
import { DaemonError, ErrorCodes } from "@daemon/platform-types";
import { assertWriteLogicAllowed } from "./write-logic-guard.js";

export class MutationValidator {
  validate(cmd: WriteCommand): void {
    if (!cmd.session?.subjectId) {
      throw new DaemonError(ErrorCodes.UNAUTHORIZED, "missing subject", 401);
    }
    if (Object.keys(cmd.patch).length === 0) {
      throw new DaemonError(ErrorCodes.VALIDATION, "empty patch", 400);
    }
    const forbidden = ["__proto__", "constructor"];
    for (const key of Object.keys(cmd.patch)) {
      if (forbidden.includes(key)) {
        throw new DaemonError(ErrorCodes.VALIDATION, `forbidden key: ${key}`, 400);
      }
    }
    assertWriteLogicAllowed(cmd);
  }
}
