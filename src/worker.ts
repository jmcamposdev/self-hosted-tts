import { pathToFileURL } from "node:url";
import { loadConfiguration } from "./config/config.js";
import { Worker } from "./worker/worker.js";

export { Worker };

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const worker = new Worker(loadConfiguration());
  for (const sig of ["SIGTERM", "SIGINT"] as const)
    process.once(sig, () => worker.stop());
  await worker.run();
}
