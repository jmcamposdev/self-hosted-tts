# Working in this repository

This is an independent private TTS service. Do not modify youtube-ai or the upstream C engine as part of routine work here.

- Use Node 24 and Python 3.11. `npm run build`, `npm test`, and `npm run test:python` are the application checks. FFmpeg is required for worker orchestration tests.
- Read `docs/decisions.md` before changing models, voice profile handling or alignment. Read `docs/validation.md` before making readiness or accuracy claims.
- Keep model weights, voice references/profiles, narration, audio, SQLite files, API keys and raw host logs out of Git. `.env`, `.secrets`, `models` and `storage` are private runtime data.
- Develop code locally. Deploy that source to a test host for builds and verification; do not independently evolve source on the server.
- Never fabricate alignment timings for an entire narration to make a job succeed. Preserve the original text and identify projected symbol/number positions in metadata.
- Preserve job fencing, immutable snapshots and per-fragment checkpoints. Test cancellation and recovery when changing orchestration.
- The application targets Linux ARM64/DOTPROD first. A successful macOS test does not establish ARM Linux behavior or VPS throughput.
- Use only this Compose project's services when deploying or restarting. Do not stop, prune or reconfigure unrelated Docker projects.
- Treat human listening, a real 30-minute run and independently annotated timing accuracy as explicit release gates. Automated contract checks do not satisfy those gates.

## Architecture & Code Conventions

- The codebase strictly follows Clean Code, separation of layers, and single responsibility principles.
- Required file naming suffixes:
  - `*.types.ts`: Pure TypeScript types, interfaces, and domain/infra unions (no runtime logic).
  - `*.schema.ts`: Zod validation schemas (`z.infer` exported).
  - `*.tools.ts`: Deterministic, side-effect-free pure utility functions.
  - `*.repository.ts`: SQLite table queries and mutations (encapsulating raw SQL).
  - `*.service.ts`: Application use cases decoupled from Fastify and transport details.
  - `*.routes.ts`: HTTP route definitions.
  - `*.pipeline.ts`: Worker multi-stage job orchestration pipelines.
  - `*.constants.ts`: Canonical domain limits, identifiers, and audio parameters.
- Refer to `docs/architecture.md` and `docs/extending.md` for architectural patterns and extension recipes.
