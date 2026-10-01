import { z } from "zod";
import { locationIdSchema } from "./location";

export const createQrSchema = z.object({
  label: z.string().trim().min(2, "Enter a label.").max(120),
  scopeType: z.enum(["DISTRICT", "BRANCH", "DEPARTMENT"]),
  locationId: locationIdSchema,
});

export const updateQrSchema = z.object({
  label: z.string().trim().min(2, "Enter a label.").max(120),
  isActive: z.boolean(),
});

export type CreateQrInput = z.infer<typeof createQrSchema>;
