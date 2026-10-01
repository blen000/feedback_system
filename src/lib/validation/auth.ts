import { z } from "zod";
import { isWeakPassword } from "./common-passwords";

export const emailSchema = z.string().trim().toLowerCase().email("Enter a valid email address.").max(254);

export const PASSWORD_HINT =
  "At least 10 characters with upper- and lower-case letters, a number and a special character.";

export const passwordSchema = z
  .string()
  .min(10, "Use at least 10 characters.")
  .max(128, "Use at most 128 characters.")
  .refine((p) => /[a-z]/.test(p), "Include a lower-case letter.")
  .refine((p) => /[A-Z]/.test(p), "Include an upper-case letter.")
  .refine((p) => /\d/.test(p), "Include a number.")
  .refine((p) => /[^A-Za-z0-9]/.test(p), "Include a special character (for example ! @ # $ -).")
  .refine(
    (p) => !isWeakPassword(p),
    "That password is too common or too simple. Choose something less guessable.",
  );

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
