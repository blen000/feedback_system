/** Errors safe to surface to the caller. Anything else is treated as an internal error. */
export class AppError extends Error {
  constructor(
    message: string,
    readonly code: "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION" | "CONFLICT" | "RATE_LIMITED",
    readonly fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const unauthenticated = () => new AppError("Please sign in to continue.", "UNAUTHENTICATED");
export const forbidden = (message = "You do not have permission to perform this action.") =>
  new AppError(message, "FORBIDDEN");
export const notFound = (what = "Record") => new AppError(`${what} was not found.`, "NOT_FOUND");
export const conflict = (message: string) => new AppError(message, "CONFLICT");
export const rateLimited = () => new AppError("Too many attempts. Please try again later.", "RATE_LIMITED");
export const invalid = (message: string, fieldErrors?: Record<string, string[]>) =>
  new AppError(message, "VALIDATION", fieldErrors);
