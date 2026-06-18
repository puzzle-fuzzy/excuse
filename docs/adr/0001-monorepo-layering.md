# ADR 0001: Monorepo Layering

## Status

Accepted (2026-06-19)

## Context

The excuse platform has grown to 17+ packages and 3 apps. Without clear layering rules, import creep erodes testability and creates circular dependencies.

## Decision

Two-layer architecture:

1. **BASE layer** (`@excuse/shared`) — types, logger, env helpers, input limits, constants. Zero runtime dependencies. Every other package may import from shared.

2. **Pure packages** (`task-engine`, `workflow-engine`, `events`, `gateway`, `metrics`, `rate-limit`, `subtitle-engine`, `auth`, `error-recovery`, `provider-health`) — domain logic with zero IO imports. Depend only on `shared`. Use Adapter injection for external IO.

3. **Runtime packages** (`db`, `provider`, `storage`, `ffmpeg`, `billing`, `canvas-engine`, `canvas-runtime`, `prompt-engine`) — may depend on shared and each other.

4. **Apps** (`server`, `worker`, `client`) — top-level. Wire adapters to real implementations.

## Constraints

- Pure packages must not import `@excuse/db`, `@excuse/provider`, `@excuse/storage`, `@excuse/ffmpeg`, or any `apps/` module.
- Enforced by `scripts/check-package-boundaries.ts` in CI.
- `canvas-runtime` is transitioning: temporary exemption for `adapter-types.ts` until all types are inlined.

## Consequences

- Clear mental model for where new code belongs.
- Pure packages are trivially testable (no database, no network).
- Boundary violations caught at CI time.
