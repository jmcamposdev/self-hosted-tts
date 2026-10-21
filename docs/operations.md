# Operations & Runbook

## Status & Monitoring

Run `docker compose ps`, query `GET /health/ready`, and inspect container logs:

```bash
docker compose logs --tail=100 -f worker aligner api
```

The API listens only on the loopback interface (`127.0.0.1:8080`). For remote access from another workstation, establish an SSH tunnel (`ssh -N -L 18080:127.0.0.1:8080 SERVER`) or place an authenticated reverse proxy in front of it. Never expose the internal aligner service directly.

## Data & Resources

- `storage/state.sqlite` and WAL/SHM files: voices, jobs, leases, and checkpoints.
- `storage/voices/`: reference audio and extracted `.qvoice` profiles.
- `storage/jobs/`: attempt workspaces and delivered artifacts, retained for 7 days by default.
- `models/`: downloaded model weights.
- `.secrets/api_key` and `.env`: runtime credentials and configuration.

SQLite requires a single host filesystem; never use NFS or distributed network mounts. Memory limits are budgeted as 12 GiB for the worker, 4 GiB for the aligner, and 512 MiB for the API.

The API rejects new jobs with `507` if less than 2 GiB free storage remains. The worker verifies free space before each segment. The queue accepts up to 100 pending/active jobs.

The janitor runs every minute: expired artifacts are marked immediately, physical files are pruned, and scripts/settings in SQLite are scrubbed. Voices and references never expire automatically.

## Restarts & Recovery

Restarting the worker (`docker compose restart worker`) stops synthesis and returns jobs to the queue while preserving completed chunk checkpoints. If a worker process dies abruptly, the job can be reclaimed once its 120-second lease expires. Up to 3 automatic attempts are allowed. Stale workers cannot publish results after losing their lease.

Cancellation is asynchronous and takes at most the heartbeat interval (10 seconds) plus process termination time.

## Backup & Restoration

To take a consistent backup:

1. Stop API and worker: `docker compose stop api worker`.
2. Backup `storage/`, `.secrets/`, and `.env` together.
3. Restart services: `docker compose up -d`.

To restore, maintain file ownership/permissions, restore those three items, verify model weights, and launch Docker Compose.
