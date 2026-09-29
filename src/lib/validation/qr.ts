import { z } from "zod";

export const createQrSchema = z.object({
  label: z.string().trim().min(2, "Enter a label.").max(120),
  scopeType: z.enum(["DISTRICT", "BRANCH", "DEPARTMENT"]),
  locationId: z.string().uuid("Select a location."),
});

export const updateQrSchema = z.object({
  label: z.string().trim().min(2, "Enter a label.").max(120),
  isActive: z.boolean(),
});

export type CreateQrInput = z.infer<typeof createQrSchema>;
