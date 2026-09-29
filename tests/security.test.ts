import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

// No session cookie: every privileged action must refuse.
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "10.55.55.55" }),
  cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));

const ROOT = path.resolve(__dirname, "..");
const src = (...p: string[]) => path.join(ROOT, "src", ...p);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/** Actions that are intentionally callable without a session. */
const PUBLIC_ACTIONS = new Set(["public.ts", "auth.ts"]);

describe("server actions require an authenticated session", () => {
  const files = readdirSync(src("server", "actions")).filter(
    (f) => f.endsWith(".ts") && f !== "helpers.ts" && !PUBLIC_ACTIONS.has(f),
  );

  it("has action modules to check", () => {
    expect(files.length).toBeGreaterThanOrEqual(5);
  });

  for (const file of files) {
    it(`${file}: every exported action refuses when signed out`, async () => {
      const mod = (await import(`@/server/actions/${file.replace(/\.ts$/, "")}`)) as Record<string, unknown>;
      const actions = Object.entries(mod).filter(([, v]) => typeof v === "function") as [
        string,
        (...a: unknown[]) => Promise<{ ok: boolean; error?: string }>,
      ][];
      expect(actions.length).toBeGreaterThan(0);
      for (const [name, fn] of actions) {
        const res = await fn("00000000-0000-4000-8000-000000000000", {}, {});
        expect(res.ok, `${file}#${name} must reject an unauthenticated caller`).toBe(false);
        expect(res.error, `${file}#${name}`).toMatch(/session/i);
      }
    });
  }

  it("every 'use server' module is either listed here or checked above", () => {
    const all = walk(src()).filter(
      (f) => f.endsWith(".ts") && readFileSync(f, "utf8").startsWith('"use server"'),
    );
    for (const f of all) {
      const base = path.basename(f);
      expect(
        files.includes(base) || PUBLIC_ACTIONS.has(base),
        `${f} is a server-action module that the security test does not cover`,
      ).toBe(true);
    }
  });
});

describe("route handlers authenticate", () => {
  it("every admin route.ts calls getAuthContext", () => {
    const routes = walk(src("app")).filter((f) => path.basename(f) === "route.ts");
    expect(routes.length).toBeGreaterThanOrEqual(3);
    for (const r of routes) {
      const code = readFileSync(r, "utf8");
      const usesGuard = code.includes("getAuthContext") || code.includes("exportResponse");
      expect(usesGuard, `${r} must authenticate`).toBe(true);
    }
    // and the shared helper does
    expect(readFileSync(src("lib", "export", "respond.ts"), "utf8")).toContain("getAuthContext");
  });

  it("anonymous calls to the export handlers are rejected with 401", async () => {
    const { GET } = await import("@/app/admin/feedback/export/route");
    const res = await GET(new Request("http://localhost/admin/feedback/export?format=csv"));
    expect(res.status).toBe(401);
    const res2 = await (
      await import("@/app/admin/reports/export/route")
    ).GET(new Request("http://localhost/admin/reports/export"));
    expect(res2.status).toBe(401);
  });
});

describe("code hygiene", () => {
  const code = walk(src()).filter(
    (f) =>
      /\.(ts|tsx)$/.test(f) &&
      !f.includes(`${path.sep}generated${path.sep}`) &&
      !f.includes(`${path.sep}components${path.sep}ui${path.sep}`),
  );

  it("never evaluates dynamic code or builds SQL from strings", () => {
    for (const f of code) {
      const text = readFileSync(f, "utf8");
      expect(text, f).not.toMatch(/\beval\(|new Function\(|\$queryRawUnsafe|\$executeRawUnsafe/);
    }
  });

  it("only uses dangerouslySetInnerHTML for server-generated QR SVG", () => {
    const users = code.filter((f) => readFileSync(f, "utf8").includes("dangerouslySetInnerHTML"));
    expect(users.map((f) => path.basename(path.dirname(f)))).toEqual(["[id]"]); // qr-print/[id]/page.tsx only
    expect(users[0]).toContain("qr-print");
  });

  it("does not expose secrets through NEXT_PUBLIC_ variables", () => {
    for (const f of code) {
      const text = readFileSync(f, "utf8");
      expect(text, f).not.toMatch(/NEXT_PUBLIC_[A-Z_]*(SECRET|PASSWORD|TOKEN|KEY)/);
    }
    expect(readFileSync(path.join(ROOT, ".env.example"), "utf8")).not.toMatch(
      /NEXT_PUBLIC_[A-Z_]*(SECRET|PASSWORD|TOKEN|KEY)/,
    );
  });

  it("keeps client components away from the database and server-only modules", () => {
    for (const f of code) {
      const text = readFileSync(f, "utf8");
      if (!text.startsWith('"use client"')) continue;
      // `import type` is erased at build time, so only runtime imports matter
      const runtimeImports = text.match(/^import (?!type\b)[^;]*?from "[^"]+";/gm) ?? [];
      for (const imp of runtimeImports) {
        expect(imp, f).not.toMatch(/@\/lib\/db\/prisma|@\/lib\/auth\/(session|crypto)|@\/server\/services\//);
      }
    }
  });

  it("never logs credentials or session tokens", () => {
    for (const f of code) {
      const text = readFileSync(f, "utf8");
      expect(text, f).not.toMatch(/console\.(log|info|debug)\([^)]*(password|token|secret)/i);
    }
  });
});
