import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  createTestDir,
  createTestConfig,
  createMockAlignerServer,
  insertTestVoice,
} from "./test-helpers.js";
import { createApi } from "#api/server.js";
import { Store } from "#persistence/store.js";
import { ARTIFACT_NAMES, ARTIFACT_MIME } from "#domain/artifacts/artifacts.js";

test("API voices routes: validation errors, 404s, patch and delete conflicts", async () => {
  const { dir, cleanup } = await createTestDir("tts-api-voices-");
  const alignerMock = await createMockAlignerServer();
  try {
    const config = createTestConfig(dir, { ALIGNER_URL: alignerMock.url });
    const app = await createApi(config);
    const store = new Store(dir);
    const headers = { authorization: `Bearer ${config.key}` };

    // GET /v1/voices/:id when not found -> 404
    const notFound = await app.inject({
      method: "GET",
      url: "/v1/voices/non-existent-voice",
      headers,
    });
    assert.equal(notFound.statusCode, 404);

    // Insert active voice
    insertTestVoice(store, "active-v", "ready");

    // GET /v1/voices/:id -> 200
    const found = await app.inject({
      method: "GET",
      url: "/v1/voices/active-v",
      headers,
    });
    assert.equal(found.statusCode, 200);
    assert.equal(found.json().voice_id, "active-v");

    // PATCH /v1/voices/:id with invalid schema -> 400
    const badPatch = await app.inject({
      method: "PATCH",
      url: "/v1/voices/active-v",
      headers,
      payload: { voice_settings: { speed: 100 } }, // Speed max is 2.0
    });
    assert.equal(badPatch.statusCode, 400);

    // PATCH non-existent -> 404
    const patch404 = await app.inject({
      method: "PATCH",
      url: "/v1/voices/ghost",
      headers,
      payload: { name: "Ghost" },
    });
    assert.equal(patch404.statusCode, 404);

    // Enqueue an active job for active-v, then try DELETE -> 409 Conflict
    store.jobs.enqueue(
      "tts",
      store.voices.find("active-v")!,
      { text: "Hi" },
      10,
    );
    const conflictDelete = await app.inject({
      method: "DELETE",
      url: "/v1/voices/active-v",
      headers,
    });
    assert.equal(conflictDelete.statusCode, 409);

    // Insert another voice with no jobs -> DELETE returns 204
    insertTestVoice(store, "idle-v", "ready");
    const okDelete = await app.inject({
      method: "DELETE",
      url: "/v1/voices/idle-v",
      headers,
    });
    assert.equal(okDelete.statusCode, 204);

    // GET deleted voice -> 404
    const getDeleted = await app.inject({
      method: "GET",
      url: "/v1/voices/idle-v",
      headers,
    });
    assert.equal(getDeleted.statusCode, 404);
  } finally {
    await alignerMock.close();
    await cleanup();
  }
});

test("API jobs routes: cancel, purge, artifact downloads and invalid artifact names", async () => {
  const { dir, cleanup } = await createTestDir("tts-api-jobs-");
  const alignerMock = await createMockAlignerServer();
  try {
    const config = createTestConfig(dir, { ALIGNER_URL: alignerMock.url });
    const app = await createApi(config);
    const store = new Store(dir);
    const headers = { authorization: `Bearer ${config.key}` };

    insertTestVoice(store, "v-jobs", "ready");
    const v = store.voices.find("v-jobs")!;

    // Enqueue job
    const job = store.jobs.enqueue("tts", v, { text: "Testing jobs api" }, 10);

    // GET /v1/jobs/missing -> 404
    const j404 = await app.inject({
      method: "GET",
      url: "/v1/jobs/missing-job-id",
      headers,
    });
    assert.equal(j404.statusCode, 404);

    // DELETE on queued/active job -> 202 cancellation_requested
    const delActive = await app.inject({
      method: "DELETE",
      url: `/v1/jobs/${job.id}`,
      headers,
    });
    assert.equal(delActive.statusCode, 202);
    assert.equal(delActive.json().status, "cancellation_requested");

    // POST /v1/jobs/:id/cancel -> 200
    const cancelRes = await app.inject({
      method: "POST",
      url: `/v1/jobs/${job.id}/cancel`,
      headers,
    });
    assert.equal(cancelRes.statusCode, 200);

    // Create a succeeded job with mock artifact files
    const job2 = store.jobs.enqueue("tts", v, { text: "Artifacts test" }, 10);
    const claimed = store.jobs.claim("worker-artifacts", 60000)!;
    const artDir = join(dir, "jobs", job2.id, "result");
    await mkdir(artDir, { recursive: true });

    // Populate all 6 artifact files
    for (const name of ARTIFACT_NAMES) {
      await writeFile(join(artDir, name), `mock content for ${name}`);
    }
    store.jobs.finish(claimed, artDir, 60000);

    // Download every artifact and check Content-Type
    for (const name of ARTIFACT_NAMES) {
      const artRes = await app.inject({
        method: "GET",
        url: `/v1/jobs/${job2.id}/artifacts/${name}`,
        headers,
      });
      assert.equal(artRes.statusCode, 200);
      assert.equal(artRes.headers["content-type"], ARTIFACT_MIME[name]);
      assert.ok(artRes.body.length > 0);
    }

    // Invalid artifact name -> 404 ARTIFACT_NOT_FOUND
    const badArt = await app.inject({
      method: "GET",
      url: `/v1/jobs/${job2.id}/artifacts/illegal.sh`,
      headers,
    });
    assert.equal(badArt.statusCode, 404);

    // DELETE on succeeded job -> 204
    const delFinished = await app.inject({
      method: "DELETE",
      url: `/v1/jobs/${job2.id}`,
      headers,
    });
    assert.equal(delFinished.statusCode, 204);
  } finally {
    await alignerMock.close();
    await cleanup();
  }
});

test("API health routes: /health/live and /health/ready 200 vs 503", async () => {
  const { dir, cleanup } = await createTestDir("tts-api-health-");
  const alignerMock = await createMockAlignerServer();
  try {
    const config = createTestConfig(dir, { ALIGNER_URL: alignerMock.url });
    const app = await createApi(config);
    const store = new Store(dir);

    // Live is always 200
    const live = await app.inject({ url: "/health/live" });
    assert.equal(live.statusCode, 200);
    assert.equal(live.json().status, "ok");

    // Ready when worker has NO lease -> 503
    const readyNoWorker = await app.inject({ url: "/health/ready" });
    assert.equal(readyNoWorker.statusCode, 503);
    assert.equal(readyNoWorker.json().status, "starting");
    assert.equal(readyNoWorker.json().worker, false);

    // Give worker active lease
    store.locks.acquire("worker-active", 60000);
    const readyOk = await app.inject({ url: "/health/ready" });
    assert.equal(readyOk.statusCode, 200);
    assert.equal(readyOk.json().status, "ready");
    assert.equal(readyOk.json().worker, true);
    assert.equal(readyOk.json().aligner, true);
  } finally {
    await alignerMock.close();
    await cleanup();
  }

  // Ready when aligner is down -> 503
  const { dir: dir2, cleanup: cleanup2 } = await createTestDir(
    "tts-api-health-down-",
  );
  try {
    const config2 = createTestConfig(dir2, {
      ALIGNER_URL: "http://127.0.0.1:54329",
    });
    const app2 = await createApi(config2);
    const store2 = new Store(dir2);
    store2.locks.acquire("worker-active", 60000);

    const readyBadAligner = await app2.inject({ url: "/health/ready" });
    assert.equal(readyBadAligner.statusCode, 503);
    assert.equal(readyBadAligner.json().aligner, false);
  } finally {
    await cleanup2();
  }
});
