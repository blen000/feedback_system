import { BANK_NAME, SystemBadge, Wordmark } from "@/components/brand/brand";

/** Standalone screen layout: quiet off-white page, corner badge, and a compact left-aligned card. */
export function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <main className="relative flex min-h-screen flex-1 flex-col items-center justify-center bg-[#faf9f7] px-4 py-10 dark:bg-background">
      <SystemBadge />
      <div className="w-full max-w-[400px] rounded-[8px] border bg-card px-6 py-9 shadow-[0_1px_3px_rgba(0,0,0,0.06)] sm:px-8">
        <Wordmark className="text-lg" />
        <h1 className="mt-9 text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">{subtitle}</p>
        <div className="mt-7">{children}</div>
      </div>
      <p className="mt-6 text-sm text-muted-foreground/80">Secured by {BANK_NAME}</p>
    </main>
  );
}
