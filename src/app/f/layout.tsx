import type { Metadata } from "next";

// Customer pages are reachable only through a printed QR code; keep them out of search engines.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  title: "Share your feedback",
};

export default function PublicLayout({ children }: LayoutProps<"/f">) {
  return <div className="min-h-screen bg-muted/30">{children}</div>;
}
