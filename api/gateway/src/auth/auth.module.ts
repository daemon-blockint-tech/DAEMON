import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { PolicyService } from "../policy/policy.service";
import { AuthService } from "./auth.service";
import { AuthGuard } from "./auth.guard";
import { PolicyGuard } from "./policy.guard";

/**
 * Registers dev-grade authentication and policy enforcement as global guards.
 *
 * `AuthGuard` runs first: it resolves any supplied session and attaches it to
 * the request, rejecting {@link Protected} routes without credentials.
 * `PolicyGuard` runs next: it enforces an allow decision for protected routes.
 * Open routes (health, read) pass both guards untouched.
 */
@Module({
  providers: [
    {
      provide: AuthService,
      useFactory: () => AuthService.create(process.env),
    },
    PolicyService,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: PolicyGuard },
  ],
  exports: [AuthService],
})
export class AuthModule {}
