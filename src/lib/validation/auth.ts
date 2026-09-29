import { z } from "zod";

export const emailSchema = z.string().trim().toLowerCase().email("Enter a valid email address.").max(254);

export const passwordSchema = z
  .string()
  .min(10, "Use at least 10 characters.")
  .max(128, "Use at most 128 characters.")
  .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), "Include at least one letter and one number.");

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password.").max(128),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match.",
  });
