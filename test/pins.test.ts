import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ARTIFACT_NAMES } from "#domain/artifacts/artifacts.js";
import { ENGINE_COMMIT } from "#shared/constants/engine.constants.js";

test("pins.json is consistent with TypeScript engine constants and artifacts list", async () => {
  const root = join(import.meta.dirname, "..");
  const pins = JSON.parse(
    await readFile(join(root, "scripts/pins.json"), "utf8"),
  );
  assert.equal(pins.engine.commit, ENGINE_COMMIT);

  // Validate allowed artifacts list in client.py
  const clientPy = await readFile(join(root, "scripts/client.py"), "utf8");
  for (const name of ARTIFACT_NAMES) {
    assert.ok(
      clientPy.includes(name),
      `client.py should include artifact ${name}`,
    );
  }

  // Validate allowed artifacts list in validate-artifacts.py
  const valPy = await readFile(
    join(root, "scripts/validate-artifacts.py"),
    "utf8",
  );
  assert.ok(valPy.includes("alignment.json"));
  assert.ok(valPy.includes("words.json"));
  assert.ok(valPy.includes("metadata.json"));
});
