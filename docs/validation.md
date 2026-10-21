# Validation & Verification

## Automated Testing Scope

`npm test` validates core API, persistence, and worker orchestration scenarios:

- Authentication and token timing-safe checks.
- Unsupported settings rejection.
- Immutable voice snapshots at queue time.
- Queue limits, single active worker, and idempotent requests.
- Worker lease fencing and retry limits.
- Expiration and download protection.
- Checkpoint persistence and transparent resume without speech re-synthesis.
- Golden characterization test for alignment projection and chunk fingerprinting.
- Verification of `pins.json` consistency across `Dockerfile` and TypeScript constants.

`npm run test:python` verifies:

- Number and date expansion into spoken Spanish.
- Unicode offset preservation and mapping.
- Rejection of invalid dates and numbers exceeding length boundaries.
- Explicit CTC word delimiter preservation (`|`).
- Timeline monotonicity and derived symbol anchor logic.

## Production Release Gates

While unit and integration tests prove orchestration contracts, unattended production readiness requires completing and documenting:

1. **Human Listening Check**: Auditory evaluation of at least two cloned voices across multiple paragraphs (checking voice identity, pronunciation, and segment transitions).
2. **Long-Form 30-Minute Run**: Execution of a continuous 30-minute narration verifying audio integrity (no drifts, dropped words, or audio artifacts).
3. **Boundary Annotation Accuracy**: At least 50 words independently hand-annotated (100 onset/end timestamps), achieving p95 boundary error under 200 ms. Compare annotations with:
   ```bash
   python3 scripts/evaluate-boundaries.py --words download/words.json --reference manual-reference.json
   ```
4. **Host Monitoring**: Memory, disk, and CPU tracking during a prolonged narration run.
