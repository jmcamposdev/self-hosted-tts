# Extension & Scaling Guide

This guide details the procedures for extending `self-hosted-tts` while maintaining Clean Code architecture.

## 1. Adding a New Voice Setting

1. **Schema & Types**:
   - Edit [`src/domain/settings/settings.schema.ts`](file:///Users/josemaria/Developer/Github/self-hosted-tts/src/domain/settings/settings.schema.ts) and add the field to `settingsSchema`.
   - If a default value exists, declare it in `DEFAULT_SETTINGS`.
2. **Checkpoint Invalidation Safety**:
   - If the new setting alters the generated audio, ensure it is preserved in `ResolvedSettings`. It will automatically be included in `chunkFingerprint` in [`src/worker/pipelines/narration/checkpoint.ts`](file:///Users/josemaria/Developer/Github/self-hosted-tts/src/worker/pipelines/narration/checkpoint.ts).
3. **Engine Parameters**:
   - Add the parameter to `SynthesizeInput` in [`src/infra/engine/engine.types.ts`](file:///Users/josemaria/Developer/Github/self-hosted-tts/src/infra/engine/engine.types.ts) and pass it to the C engine CLI in `QwenEngine.synthesize`.

## 2. Adding a New HTTP Endpoint

1. **Service Layer**:
   - Implement the use case in [`src/api/services/`](file:///Users/josemaria/Developer/Github/self-hosted-tts/src/api/services/).
2. **Route Registration**:
   - Register the endpoint in `src/api/routes/` and attach the Zod validation schema using `jsonSchema(...)`.
3. **Presenter**:
   - When exposing domain objects, sanitize and map them via presenters in `src/api/presenters/`.

## 3. Adding a New Job Type

1. **Domain Types**:
   - Add the new identifier to `JobKind` in [`src/domain/job/job.types.ts`](file:///Users/josemaria/Developer/Github/self-hosted-tts/src/domain/job/job.types.ts).
2. **Pipeline Implementation**:
   - Create a class implementing `JobPipeline` in `src/worker/pipelines/`.
3. **Worker Registration**:
   - Instantiate the pipeline in the `Worker` constructor ([`src/worker/worker.ts`](file:///Users/josemaria/Developer/Github/self-hosted-tts/src/worker/worker.ts)) within `this.pipelines`.

## 4. Adding a Database Migration

1. **Declare DDL**:
   - Open [`src/persistence/migrations.ts`](file:///Users/josemaria/Developer/Github/self-hosted-tts/src/persistence/migrations.ts) and append raw SQL as a new item in `MIGRATIONS`.
   - Never modify or remove an existing migration index.
2. **Automated Migration**:
   - The runner automatically runs pending migrations sequentially based on `PRAGMA user_version`.
