# Guía de Extensión y Escalamiento

Esta guía detalla los pasos para ampliar las capacidades del repositorio manteniendo la arquitectura Clean Code.

## 1. Añadir un Nuevo Ajuste de Voz

1. **Constantes y Esquema**:
   - Editar [`src/domain/settings/settings.schema.ts`](file:///Users/josemaria/Developer/Github/self-hosted-tts/src/domain/settings/settings.schema.ts) agregando el campo a `settingsSchema`.
   - Si tiene valor por defecto, definirlo en `DEFAULT_SETTINGS`.
2. **Firma de Checkpoints**:
   - Si el nuevo ajuste influye en la salida de audio del motor, asegurar su inclusión en `ResolvedSettings`. Automáticamente formará parte de `chunkFingerprint` en [`src/worker/pipelines/narration/checkpoint.ts`](file:///Users/josemaria/Developer/Github/self-hosted-tts/src/worker/pipelines/narration/checkpoint.ts).
3. **Paso a Engine**:
   - Mapear el valor en `SynthesizeInput` en [`src/infra/engine/engine.types.ts`](file:///Users/josemaria/Developer/Github/self-hosted-tts/src/infra/engine/engine.types.ts) y pasarlo como argumento CLI en `QwenEngine.synthesize`.

## 2. Añadir un Nuevo Endpoint HTTP

1. **Definir el Servicio**:
   - Añadir el método correspondiente en [`src/api/services/`](file:///Users/josemaria/Developer/Github/self-hosted-tts/src/api/services/).
2. **Registrar la Ruta**:
   - En el archivo de rutas apropiado (`src/api/routes/`), registrar el método HTTP y asociar el schema Zod para validación con `jsonSchema(...)`.
3. **Presenter**:
   - Si devuelve una entidad de dominio, asegurarse de exponer solo campos autorizados mediante los presenters en `src/api/presenters/`.

## 3. Añadir un Nuevo Tipo de Trabajo (Job)

1. **Tipado**:
   - Añadir la clave a `JobKind` en [`src/domain/job/job.types.ts`](file:///Users/josemaria/Developer/Github/self-hosted-tts/src/domain/job/job.types.ts).
2. **Implementar Pipeline**:
   - Crear una clase que implemente `JobPipeline` en `src/worker/pipelines/`.
3. **Registrar en Worker**:
   - Instanciar la pipeline en el constructor de `Worker` ([`src/worker/worker.ts`](file:///Users/josemaria/Developer/Github/self-hosted-tts/src/worker/worker.ts)) dentro del registro `this.pipelines`.

## 4. Añadir una Migración de Base de Datos

1. **Definir DDL**:
   - En [`src/persistence/migrations.ts`](file:///Users/josemaria/Developer/Github/self-hosted-tts/src/persistence/migrations.ts), añadir una nueva entrada al array `MIGRATIONS`.
   - El migrador aplica incrementalmente según `PRAGMA user_version` de forma atómica.
