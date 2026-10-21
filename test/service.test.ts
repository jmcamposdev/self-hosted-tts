import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store, type Voice } from "#store.js";
import { createApi } from "#api.js";
import { configuration } from "#config.js";
import { defaults, validateAlignment, Fault } from "#contracts.js";
import { splitText, srt, wav, command } from "#media.js";

async function setup() {
  const data = await mkdtemp(join(tmpdir(), "tts-test-"));
  const config = configuration({
    DATA_DIR: data,
    API_KEY: "test-only-key-with-at-least-32-characters",
    MIN_FREE_BYTES: "0",
  });
  const store = new Store(data);
  return {
    data,
    config,
    store,
    cleanup: async () => {
      store.db.close();
      await rm(data, { recursive: true, force: true });
    },
  };
}
function voice(store: Store): Voice {
  store.db
    .prepare(
      "INSERT INTO voices VALUES('v','Narrador','ready',?,'/reference','/profile',?)",
    )
    .run(JSON.stringify(defaults), Date.now());
  return store.voice("v")!;
}

test("durable queue, idempotency, single worker and fencing across leases", async () => {
  const x = await setup();
  try {
    const v = voice(x.store),
      j = x.store.enqueue("tts", v, { text: "Hola" }, 100, "request-a");
    assert.equal(
      x.store.enqueue("tts", v, { text: "Hola" }, 100, "request-a").id,
      j.id,
    );
    assert.throws(
      () => x.store.enqueue("tts", v, { text: "Otro" }, 100, "request-a"),
      /different request/,
    );
    const old = x.store.claim("worker-one", 10000)!;
    assert.equal(old.id, j.id);
    const second = new Store(x.data);
    assert.equal(second.claim("worker-two", 10000), undefined);
    x.store.db.prepare("UPDATE locks SET until_ms=0").run();
    x.store.db.prepare("UPDATE jobs SET lease_until=0 WHERE id=?").run(j.id);
    const recovered = second.claim("worker-two", 10000)!;
    assert.equal(recovered.id, j.id);
    assert.equal(recovered.attempts, 2);
    assert.notEqual(recovered.token, old.token);
    assert.throws(() => x.store.finish(old, "/old", 1000), /lease lost/i);
    assert.throws(() => x.store.checkpoint(old, 0, "x", "/old"), /lease lost/i);
    second.finish(recovered, "/result", 1000);
    assert.equal(x.store.job(j.id)!.status, "succeeded");
    second.db.close();
  } finally {
    await x.cleanup();
  }
});
test("cancelled expired running job is terminal; transient failures retry at most twice", async () => {
  const x = await setup();
  try {
    const v = voice(x.store),
      j = x.store.enqueue("tts", v, { text: "Hola" }, 100);
    let running = x.store.claim("one", 10000)!;
    x.store.fail(running, new Fault("TEMP", "temporary", 503, true), 1000);
    assert.equal(x.store.job(j.id)!.status, "queued");
    running = x.store.claim("one", 10000)!;
    x.store.fail(running, new Fault("TEMP", "temporary", 503, true), 1000);
    running = x.store.claim("one", 10000)!;
    x.store.fail(running, new Fault("TEMP", "temporary", 503, true), 1000);
    assert.equal(x.store.job(j.id)!.status, "failed");
    const j2 = x.store.enqueue("tts", v, { text: "Otro" }, 100);
    running = x.store.claim("one", 10000)!;
    x.store.db
      .prepare("UPDATE jobs SET cancel_requested=1,lease_until=0 WHERE id=?")
      .run(j2.id);
    x.store.claim("one", 10000);
    assert.equal(x.store.job(j2.id)!.status, "cancelled");
  } finally {
    await x.cleanup();
  }
});
test("API authentication, immutable job snapshot, validation and expired artifact denial", async () => {
  const x = await setup(),
    v = voice(x.store),
    app = await createApi(x.config);
  const headers = { authorization: "Bearer " + x.config.key };
  try {
    assert.equal((await app.inject({ url: "/v1/voices" })).statusCode, 401);
    assert.equal(
      (
        await app.inject({
          url: "/v1/voices",
          headers: { "xi-api-key": x.config.key },
        })
      ).statusCode,
      200,
    );
    assert.equal((await app.inject({ url: "/docs/json" })).statusCode, 200);
    const request = {
      method: "POST" as const,
      url: "/v1/text-to-speech/v",
      headers,
      payload: { text: "Hola, año 1945.", voice_settings: { speed: 1.08 } },
    };
    const response = await app.inject(request);
    assert.equal(response.statusCode, 202);
    const id = response.json().job_id;
    assert.equal(
      (
        await app.inject({
          ...request,
          payload: { text: "Hola", voice_settings: { speed: 3 } },
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (await app.inject({ ...request, payload: { text: "[sad] Hola" } }))
        .statusCode,
      400,
    );
    assert.equal(
      (
        await app.inject({
          ...request,
          payload: { text: "Hola", voice_settings: { stability: 0.5 } },
        })
      ).statusCode,
      400,
    );
    await app.inject({
      method: "PATCH",
      url: "/v1/voices/v",
      headers,
      payload: { voice_settings: { speed: 1.2 } },
    });
    assert.equal(
      JSON.parse(x.store.job(id)!.snapshot_json).defaults_json,
      v.defaults_json,
    );
    assert.equal(
      (await app.inject({ method: "DELETE", url: "/v1/voices/v", headers }))
        .statusCode,
      409,
    );
    assert.ok(response.headers["x-request-id"]);
    assert.equal(x.store.job(id)!.request_id, response.headers["x-request-id"]);
    assert.equal(response.json().request_id, response.headers["x-request-id"]);
    const dir = join(x.data, "jobs", id, "result");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "alignment.json"), "{}");
    x.store.db
      .prepare(
        "UPDATE jobs SET status='succeeded',artifact_dir=?,expires_at=? WHERE id=?",
      )
      .run(dir, Date.now() + 10000, id);
    assert.equal(
      (await app.inject({ url: `/v1/jobs/${id}/result`, headers })).statusCode,
      200,
    );
    assert.equal(
      (
        await app.inject({
          url: `/v1/jobs/${id}/artifacts/alignment.json`,
          headers,
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (
        await app.inject({
          url: `/v1/jobs/${id}/artifacts/reference.upload`,
          headers,
        })
      ).statusCode,
      404,
    );
    x.store.db.prepare("UPDATE jobs SET expires_at=1 WHERE id=?").run(id);
    assert.equal(
      (
        await app.inject({
          url: `/v1/jobs/${id}/artifacts/alignment.json`,
          headers,
        })
      ).statusCode,
      410,
    );
    assert.equal(
      (await app.inject({ method: "DELETE", url: `/v1/jobs/${id}`, headers }))
        .statusCode,
      204,
    );
    assert.equal(x.store.job(id)!.request_json, "{}");
    assert.equal(x.store.job(id)!.snapshot_json, "{}");
  } finally {
    await app.close();
    await x.cleanup();
  }
});
test("voice upload is durable and atomic when queue rejects a request", async () => {
  const x = await setup(),
    app = await createApi({ ...x.config, maxQueue: 0 });
  try {
    const boundary = "tts-test-boundary";
    const payload = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="name"\r\n\r\nNarrador\r\n--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="../../bad.wav"\r\nContent-Type: audio/wav\r\n\r\n`,
      ),
      wav(Buffer.alloc(6 * 48000)),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const res = await app.inject({
      method: "POST",
      url: "/v1/voices",
      headers: {
        authorization: "Bearer " + x.config.key,
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload,
    });
    assert.equal(res.statusCode, 429);
    assert.equal(
      x.store.db.prepare("SELECT count(*) AS n FROM voices").get()!.n,
      0,
    );
  } finally {
    await app.close();
    await x.cleanup();
  }
});
test("segmentation preserves exact Unicode text and paragraph pause without dropped characters", () => {
  const text =
    "Árbol y España. " +
    "Otra frase con tildes y ñ. ".repeat(30) +
    "\n\nÚltimo párrafo.";
  const segments = splitText(text, 250);
  assert.equal(segments.map((s) => s.text).join(""), text);
  assert.ok(segments.every((s) => Array.from(s.text).length <= 300));
  assert.ok(segments.some((s) => s.pauseMs === 250));
  assert.equal(segments.at(-1)!.pauseMs, 0);
  assert.throws(() => splitText("a".repeat(301), 250), /single word/);
  const leading = splitText("\n\nHola mundo.\n\nAdiós.", 250);
  assert.equal(leading.length, 2);
  assert.equal(leading[0].text, "\n\nHola mundo.\n\n");
});
test("timeline validation rejects mismatches, overruns and non-monotonic characters", () => {
  const a = {
    characters: ["H", "i"],
    character_start_times_seconds: [0, 0.1],
    character_end_times_seconds: [0.1, 0.2],
  };
  validateAlignment(a, "Hi", 0.2);
  assert.throws(() => validateAlignment(a, "Hola", 0.2));
  assert.throws(() => validateAlignment(a, "Hi", 0.1));
  assert.throws(() =>
    validateAlignment(
      { ...a, character_start_times_seconds: [0.1, 0] },
      "Hi",
      0.2,
    ),
  );
  assert.match(
    srt([{ word: "Hola.", start: 0, end: 0.5, score: 1 }]),
    /00:00:00,000 --> 00:00:00,500/,
  );
});
test("subprocess timeout terminates computation and reports retryable failure", async () => {
  await assert.rejects(
    command(
      process.execPath,
      ["-e", "setInterval(()=>{},1000)"],
      new AbortController().signal,
      100,
    ),
    (e) => e instanceof Fault && e.code === "STAGE_TIMEOUT" && e.transient,
  );
});
test("correlation ID propagation from HTTP request to database and job endpoints", async () => {
  const x = await setup(),
    v = voice(x.store),
    app = await createApi(x.config);
  try {
    const customReqId = "trace-corr-id-9988";
    const res = await app.inject({
      method: "POST",
      url: `/v1/text-to-speech/${v.id}`,
      headers: {
        authorization: "Bearer " + x.config.key,
        "x-request-id": customReqId,
      },
      payload: { text: "Testing correlation ID." },
    });
    assert.equal(res.statusCode, 202);
    assert.equal(res.headers["x-request-id"], customReqId);
    const body = res.json();
    assert.equal(body.request_id, customReqId);

    const job = x.store.job(body.job_id);
    assert.ok(job);
    assert.equal(job.request_id, customReqId);

    // GET /v1/jobs/:id exposes request_id
    const getJob = await app.inject({
      method: "GET",
      url: `/v1/jobs/${body.job_id}`,
      headers: { authorization: "Bearer " + x.config.key },
    });
    assert.equal(getJob.statusCode, 200);
    assert.equal(getJob.json().request_id, customReqId);
  } finally {
    await x.cleanup();
  }
});
