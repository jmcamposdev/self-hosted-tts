---
name: extend-tts
description: >-
  Step-by-step developer guide and recipes for extending self-hosted-tts: adding
  voice settings, HTTP endpoints, worker pipelines, and database migrations.
---

# Extension Recipes: self-hosted-tts

This skill outlines exact patterns and protocols for safely extending `self-hosted-tts` while adhering to its Clean Code conventions.

---

## 1. Naming & Architectural Conventions

Files must follow strict suffixes:
- `*.types.ts`: Pure interfaces/types (zero runtime code).
- `*.schema.ts`: Zod schemas and inferred runtime types.
- `*.tools.ts`: Deterministic, side-effect-free pure functions.
- `*.repository.ts`: SQLite table queries and mutations.
- `*.service.ts`: Application use cases (Fastify-agnostic).
- `*.routes.ts`: HTTP route definitions.
- `*.pipeline.ts`: Worker multi-stage job pipelines.
- `*.constants.ts`: Domain constants, limits, and identifiers.

---

## 2. Recipe: Adding a New Voice Setting

1. **Schema & Types**:
   - In `src/domain/settings/settings.schema.ts`, add the field to `settingsSchema`.
   - If default exists, add it to `DEFAULT_SETTINGS`.
2. **Checkpoint Invalidation Safety**:
   - If the new setting alters acoustic output, ensure it is in `ResolvedSettings`.
   - `chunkFingerprint()` in `src/worker/pipelines/narration/checkpoint.ts` hashes `settings`. The new field will automatically be accounted for without breaking existing valid checkpoints if backwards-compatible fallback is defined.
3. **Engine Execution**:
   - In `src/infra/engine/engine.types.ts`, add the parameter to `SynthesizeInput`.
   - In `src/infra/engine/qwen-engine.ts`, append the CLI argument when calling the C binary.

---

## 3. Recipe: Adding a New HTTP Endpoint

1. **Implement Service Method**:
   - Add business logic in the corresponding service in `src/api/services/` (e.g. `VoiceService` or `JobService`). Keep it Fastify-agnostic.
2. **Define Route**:
   - In `src/api/routes/`, register the route handler.
   - Use `jsonSchema(yourZodSchema)` to provide OpenAPI documentation.
3. **Response Formatting**:
   - If exposing domain entities, route them through presenters (`src/api/presenters/`) to avoid leaking internal storage columns or private paths.

---

## 4. Recipe: Adding a New Job Type

1. **Update Domain Enum**:
   - In `src/domain/job/job.types.ts`, add the new kind to `JobKind` (e.g., `"clone" | "tts" | "cleanup"`).
2. **Implement Pipeline**:
   - Create `src/worker/pipelines/<name>.pipeline.ts` implementing `JobPipeline`.
   - Must expose:
     ```typescript
     readonly kind = "<name>" as const;
     async run(context: JobContext): Promise<void>
     ```
3. **Register in Worker**:
   - In `src/worker/worker.ts`, add an instance of the pipeline to `this.pipelines` map.

---

## 5. Recipe: Adding a Database Migration

1. **Append Migration**:
   - Open `src/persistence/migrations.ts`.
   - Append raw DDL SQL as a new element in the `MIGRATIONS` array.
   - *Never edit or delete an existing migration string*.
2. **Automatic Execution**:
   - The migration runner checks `PRAGMA user_version` on startup and sequentially executes missing migration indices within an immediate transaction.
