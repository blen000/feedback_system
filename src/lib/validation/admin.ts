import { z } from "zod";
import { emailSchema, passwordSchema } from "./auth";

const uuid = z.string().uuid();
const code = z
  .string()
  .trim()
  .toUpperCase()
  .min(2, "Code must be at least 2 characters.")
  .max(32)
  .regex(/^[A-Z0-9_-]+$/, "Use letters, numbers, dash or underscore only.");
const name = z.string().trim().min(2, "Name must be at least 2 characters.").max(120);

// ── Organization ──
export const districtSchema = z.object({ code, name, isActive: z.boolean().default(true) });

export const branchSchema = z.object({
  code,
  name,
  districtId: uuid,
  address: z.string().trim().max(200).optional().nullable(),
  city: z.string().trim().max(80).optional().nullable(),
  isActive: z.boolean().default(true),
});

export const departmentSchema = z.object({
  code,
  name,
  /** null/undefined = Head Office */
  districtId: uuid.optional().nullable(),
  isActive: z.boolean().default(true),
});

// ── Roles ──
export const roleSchema = z.object({
  key: z
    .string()
    .trim()
    .toUpperCase()
    .min(3)
    .max(40)
    .regex(/^[A-Z][A-Z0-9_]*$/, "Use UPPER_SNAKE_CASE."),
  name,
  description: z.string().trim().max(300).optional().nullable(),
  permissions: z.array(z.string().min(3).max(60)).max(200),
});

// ── Users ──
export const scopeSchema = z
  .object({
    roleId: uuid,
    scopeType: z.enum(["ALL", "DISTRICT", "BRANCH", "DEPARTMENT"]),
    districtId: uuid.optional().nullable(),
    branchId: uuid.optional().nullable(),
    departmentId: uuid.optional().nullable(),
  })
  .superRefine((v, ctx) => {
    const need = { ALL: null, DISTRICT: "districtId", BRANCH: "branchId", DEPARTMENT: "departmentId" }[
      v.scopeType
    ];
    for (const f of ["districtId", "branchId", "departmentId"] as const) {
      if (f === need && !v[f]) ctx.addIssue({ code: "custom", path: [f], message: "Select a location." });
      if (f !== need && v[f])
        ctx.addIssue({ code: "custom", path: [f], message: "Not allowed for this scope." });
    }
  });

export const roleAssignmentsSchema = z.array(scopeSchema).min(1, "Assign at least one role.").max(20);

export const createUserSchema = z.object({
  email: emailSchema,
  name,
  /** required only when email is not configured; otherwise the user chooses one via the invitation link */
  password: passwordSchema.optional(),
  assignments: roleAssignmentsSchema,
});

/** Step-up: the acting administrator confirms with their own password. */
export const resetUserPasswordSchema = z.object({
  currentPassword: z.string().min(1, "Enter your password.").max(128),
});

export const updateUserSchema = z.object({
  name,
  assignments: roleAssignmentsSchema,
});

export type DistrictInput = z.infer<typeof districtSchema>;
export type BranchInput = z.infer<typeof branchSchema>;
export type DepartmentInput = z.infer<typeof departmentSchema>;
export type RoleInput = z.infer<typeof roleSchema>;
export type ScopeInput = z.infer<typeof scopeSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
