FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim AS api
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 DATA_DIR=/data
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
USER node
CMD ["node", "dist/api.js"]

FROM debian:bookworm-slim AS engine
ARG QWEN_COMMIT=ef339be58a778b062e1c14382347964552eae007
RUN apt-get update && apt-get install -y --no-install-recommends build-essential git ca-certificates libopenblas-dev && rm -rf /var/lib/apt/lists/*
RUN git init /opt/qwen && cd /opt/qwen && git remote add origin https://github.com/gabriele-mastrapasqua/qwen3-tts.git && git fetch --depth=1 origin "$QWEN_COMMIT" && git checkout --detach FETCH_HEAD
WORKDIR /opt/qwen
RUN test "$(uname -m)" = aarch64 && make blas ARCH_FLAGS=-march=armv8.2-a+dotprod -j2 && ./qwen_tts --caps && ./qwen_tts --self-test

FROM node:24-bookworm-slim AS worker
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg libopenblas0-pthread ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production DATA_DIR=/data
COPY --from=engine /opt/qwen/qwen_tts /opt/qwen/qwen_tts
COPY --from=engine /opt/qwen/LICENSE /opt/qwen/LICENSE
COPY --from=engine /opt/qwen/presets /opt/qwen/presets
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
ENV QWEN_BINARY=/opt/qwen/qwen_tts QWEN_CWD=/opt/qwen BASE_MODEL_DIR=/models/base CUSTOM_MODEL_DIR=/models/custom OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1
USER node
CMD ["node", "dist/worker.js"]
