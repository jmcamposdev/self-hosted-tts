import type { z } from "zod";
import type { settingsSchema } from "./settings.schema.js";

/** User-supplied (partial) voice settings. */
export type Settings = z.infer<typeof settingsSchema>;

/** Settings after merging defaults, voice and request. `seed` stays optional until derived. */
export type ResolvedSettings = Required<Omit<Settings, "seed">> &
  Pick<Settings, "seed">;
