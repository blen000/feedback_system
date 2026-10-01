import { z } from "zod";

/** Sentinel for "All branches / districts / departments" in a location field. Expanded server-side. */
export const ALL_LOCATIONS = "all";

/** A location id, or ALL_LOCATIONS meaning every location of that kind the actor may configure. */
export const locationIdSchema = z.union([z.string().uuid(), z.literal(ALL_LOCATIONS)]);
