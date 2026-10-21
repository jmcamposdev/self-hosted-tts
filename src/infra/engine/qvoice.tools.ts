import { MAX_PROFILE_BYTES } from "../../shared/constants/limits.constants.js";
import {
  QVOICE_HIDDEN_SIZE,
  QVOICE_HIDDEN_SIZE_OFFSET,
  QVOICE_MAGIC,
  QVOICE_MIN_BYTES,
} from "../../shared/constants/engine.constants.js";
import { Fault } from "../../shared/errors/fault.js";

/** Accepts only a 1.7B-compatible `.qvoice` profile of sane size. */
export function assertQvoiceProfile(profile: Buffer): void {
  if (
    profile.length < QVOICE_MIN_BYTES ||
    profile.toString("ascii", 0, 4) !== QVOICE_MAGIC ||
    profile.readUInt32LE(QVOICE_HIDDEN_SIZE_OFFSET) !== QVOICE_HIDDEN_SIZE ||
    profile.length > MAX_PROFILE_BYTES
  )
    throw new Fault(
      "INVALID_PROFILE",
      "Cloned profile is incompatible with 1.7B",
    );
}
