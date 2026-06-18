# ADR 0002: Canvas Runtime Adapters

## Status

Accepted (2026-06-19)

## Context

`@excuse/canvas-runtime` phase functions were directly importing `@excuse/db`, `@excuse/provider`, `@excuse/storage`, and `@excuse/ffmpeg`. This made phases hard to test and created inconsistency with the adapter injection pattern used by `task-engine` and `workflow-engine`.

## Decision

Phase functions receive all IO dependencies through typed adapter interfaces:

```typescript
interface CanvasRuntimeAdapters {
  llm: CanvasRuntimeLlmClient       // DashScopeClient duck type
  provider: CanvasRuntimeProviderAdapter  // getModelById + validateAndMerge
  repo: CanvasRuntimeRepoAdapter    // 20 DB repository functions
  storage: CanvasRuntimeStorageAdapter   // AssetStorage duck type
  ffmpeg: CanvasRuntimeFfmpegAdapter     // concatVideos + mixBgmTrack
}
```

Worker/server apps create real adapters via factory functions. Tests create fake adapters inline.

The `adapter-types.ts` file serves as a translation layer (temporarily imports from IO packages). Over time, its types will be inlined to eliminate the IO imports entirely.

## Constraints

- Phase files (`phases/*.ts`) must not import `@excuse/db`, `@excuse/provider`, `@excuse/storage`, or `@excuse/ffmpeg`.
- Enforced by `scripts/check-package-boundaries.ts` with a temporary exemption for `adapter-types.ts`.

## Consequences

- Canvas phase tests run without database or real provider (62 tests pass with fake adapters).
- New phases follow the same pattern by construction.
- Worker/server adapter factories provide single-point debug injection.
