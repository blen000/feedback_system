import Image from "next/image";

/** Visual identity: logo, wordmark and the hanging "system by" badge. */

export const BANK_NAME = process.env.NEXT_PUBLIC_BANK_NAME || "Customer Feedback";
/** Optional owner badge in the corner of standalone screens. Set NEXT_PUBLIC_SYSTEM_BY="" to hide it. */
export const SYSTEM_BY = process.env.NEXT_PUBLIC_SYSTEM_BY ?? "EPMO";

/** The organization logo (public/image/Logo.png). Size it with className, e.g. "size-10". */
export function BrandMark({ className = "size-10" }: { className?: string }) {
  return (
    <Image
      src="/image/Logo.png"
      alt=""
      width={128}
      height={128}
      unoptimized
      priority
      className={`${className} shrink-0 object-contain`}
    />
  );
}

export function Wordmark({ className = "text-xl" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-3 font-medium text-foreground ${className}`}>
      <BrandMark className="size-[1.6em]" />
      <span className="leading-tight">{BANK_NAME}</span>
    </span>
  );
}

/** Ribbon hanging from a string at the top-left corner of standalone screens. */
export function SystemBadge() {
  if (!SYSTEM_BY) return null;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute left-6 top-0 z-10 hidden flex-col items-center sm:flex md:left-[54px]"
    >
      <span className="h-[78px] w-px bg-[#e0a11a]" />
      <div
        className="relative flex h-[120px] w-[100px] flex-col items-center pt-9 text-white drop-shadow-md"
        style={{
          clipPath: "polygon(0 0, 100% 0, 100% 82%, 50% 100%, 0 82%)",
          background: "linear-gradient(180deg, #d9a21f 0%, #b9761a 55%, #96541a 100%)",
        }}
      >
        <span
          className="pointer-events-none absolute inset-[5px] border border-white/25"
          style={{ clipPath: "polygon(0 0, 100% 0, 100% 80%, 50% 98%, 0 80%)" }}
        />
        <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-white/85">System by</span>
        <span className="mt-1 text-lg font-extrabold uppercase tracking-[0.16em]">{SYSTEM_BY}</span>
      </div>
    </div>
  );
}
