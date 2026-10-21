---
name: tts-ops
description: >-
  Operational workflows, diagnostics, health probes, backup, recovery, and
  troubleshooting procedures for the self-hosted-tts service.
---

# Operational Runbook: self-hosted-tts

This skill guides AI agents and operators through common maintenance, health evaluation, debugging, and recovery procedures for `self-hosted-tts`.

---

## 1. Architecture & Service Topology

The service consists of 3 collaborating services:
1. **API (`api`)**: Fastify TypeScript server (port 8080 by default). Dispatches work to SQLite, serves downloads.
2. **Worker (`worker`)**: Standalone TypeScript process invoking the native C engine (`qwen3-tts`). Sequentially claims jobs under a renewable heartbeat lease (`120s` TTL).
3. **Aligner (`aligner`)**: FastAPI Python server (internal port 8081). Houses PyTorch + Wav2Vec2 + CTC segmentation on CPU.

Shared persistence:
- `storage/state.sqlite`: SQLite database (WAL mode).
- `storage/voices/<voice_id>/`: Clean reference audio and `.qvoice` binary profiles.
- `storage/jobs/<job_id>/<token>/`: Attempt artifacts and per-fragment checkpoints (`chunk-<index>/`).

---

## 2. Health & Readiness Verification

### Probing API Liveness
```bash
curl -s http://127.0.0.1:8080/health/live
# Expected: {"status":"ok"}
```

### Probing Full System Readiness
The `/health/ready` probe verifies both that a worker has an active lease lock and that the Python aligner is responding:
```bash
curl -s -w "\nHTTP Status: %{http_code}\n" http://127.0.0.1:8080/health/ready
# Expected: 200 OK {"status":"ready","worker":true,"aligner":true}
```

If it returns `503`:
- Check if worker is running: verify `SELECT * FROM locks WHERE name='worker';` in SQLite.
- Check if aligner is responding: `curl http://127.0.0.1:8081/health` (should return `{"status":"ready"}`).

---

## 3. Worker Troubleshooting & Recovery

### Job Cancellation and Lease Expiration
- Jobs have a maximum retry limit of `3` attempts for transient failures (e.g. temporary aligner timeout).
- If a worker dies abruptly, its lease expires after `120s`. On the next heartbeat/claim cycle, the queue automatically re-queues eligible jobs.
- If a job had completed chunks, its checkpoints are preserved in `storage/jobs/<job_id>/<attempt>/chunk-<index>/`. The next attempt verifies `chunk.json` and `audio.pcm` SHA-256 and skips re-synthesis.

### Storage Space Rejection (`STORAGE_FULL`)
- The API rejects requests with `507 Insufficient Storage` if free disk space is less than `MIN_FREE_BYTES` (default: 2 GB).
- The worker verifies free space before each narration segment.
- To inspect disk usage:
```bash
df -h storage/
```

### Log Inspection
When running under Docker Compose:
```bash
docker compose logs -f --tail=100 worker api aligner
```

Look for structured JSON lines from the worker:
- `{"event":"worker_ready", ...}`
- `{"event":"job_started", "job_id": "...", "kind": "tts", "attempt": 1}`
- `{"event":"job_completed", "job_id": "..."}`
- `{"event":"job_failed", "job_id": "...", "code": "..."}`

---

## 4. Backup & Maintenance

### Creating a Consistent Backup
1. Stop API and Worker containers:
   ```bash
   docker compose stop api worker
   ```
2. Archive `storage/`, `.secrets/`, and `.env` together (including SQLite `-wal` and `-shm` files):
   ```bash
   tar -czvf tts-backup-$(date +%Y%m%d).tar.gz storage/ .secrets/ .env
   ```
3. Restart services:
   ```bash
   docker compose up -d
   ```

### Rotating API Keys
1. Replace contents in `.secrets/api_key` with a new high-entropy string (min 32 chars).
2. Recreate containers:
   ```bash
   docker compose up -d --force-recreate api worker
   ```
3. Update clients with the new key.
