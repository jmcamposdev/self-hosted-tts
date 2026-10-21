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

## Convenciones de Código y Arquitectura

- La base de código sigue principios Clean Code, separación de capas y responsabilidades únicas.
- Sufijos de archivos:
  - `*.types.ts`: Tipos puros, interfaces y uniones de dominio/infraestructura (sin lógica en runtime).
  - `*.schema.ts`: Esquemas de validación Zod (`z.infer` exportado).
  - `*.tools.ts`: Funciones puras y utilidades deterministas libres de estado o dependencias directas.
  - `*.repository.ts`: Acceso y mutaciones a base de datos (SQLite exclusivo).
  - `*.service.ts`: Casos de uso desacoplados de Fastify y transporte.
  - `*.routes.ts`: Definición de endpoints HTTP.
  - `*.pipeline.ts`: Orquestación multietapa de trabajos del Worker.
  - `*.constants.ts`: Constantes de dominio, límites y audio.
- Consulte `docs/architecture.md` y `docs/extending.md` para patrones de diseño y guías de extensión.
