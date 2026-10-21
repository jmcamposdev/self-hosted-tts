import { pathToFileURL } from "node:url";
import { loadConfiguration } from "./config/config.js";
import { createApi } from "./api/server.js";

export { createApi };

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const config = loadConfiguration();
  const app = await createApi(config);
  for (const sig of ["SIGTERM", "SIGINT"] as const)
    process.once(sig, () => void app.close());
  await app.listen({ port: config.port, host: config.host });
}
