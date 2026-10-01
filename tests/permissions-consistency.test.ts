import { afterAll, describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  ALL_PERMISSIONS,
  dependentsOf,
  effectiveAssignmentPermissions,
  effectivePermissions,
  incompletePermissions,
  prerequisitesOf,
  SYSTEM_ROLES,
} from "@/lib/rbac/permissions";
import { firstAllowedHref, NAV } from "@/lib/rbac/nav";
import { can } from "@/lib/rbac/authorize";
import { createRole, updateRole } from "@/server/services/roles";
import { actorWith, cleanup, uid } from "./helpers";

afterAll(cleanup);

const read = (p: string) => readFileSync(p, "utf8");
const walk = (d: string): string[] =>
  readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)],
  );

describe("permission catalog vs. what the system enforces", () => {
  const services = walk("src/server/services")
    .map((f) => read(f))
    .join("\n");

  it("every permission is enforced by a service (no decorative permissions)", () => {
    const unused = ALL_PERMISSIONS.filter((p) => !services.includes(`"${p}"`));
    expect(unused).toEqual([]);
  });

  it("every menu item opens a page guarded by the same permission", () => {
    for (const item of NAV.flatMap((g) => g.items)) {
      const file = path.join("src/app/admin/(portal)", item.href.replace("/admin/", ""), "page.tsx");
      expect(existsSync(file), `${item.href} has a page`).toBe(true);
      expect(read(file), item.href).toContain(`pageAccess("${item.permission}")`);
    }
  });

  it("every admin page is guarded, and by a permission that exists", () => {
    const pages = walk("src/app/admin/(portal)").filter((f) => f.endsWith("page.tsx"));
    expect(pages.length).toBeGreaterThan(10);
    for (const f of pages) {
      const m = read(f).match(/pageAccess\("([a-z_.]+)"\)/);
      expect(m, f).not.toBeNull();
      expect(ALL_PERMISSIONS, f).toContain(m![1]);
    }
  });

  it("every permission that opens a menu page is a view permission", () => {
    for (const item of NAV.flatMap((g) => g.items)) expect(item.permission).toMatch(/\.view$/);
  });
});

describe("prerequisites", () => {
  it("every seeded role is complete: nothing is granted without what its page needs", () => {
    for (const role of SYSTEM_ROLES) expect(incompletePermissions(role.permissions), role.key).toEqual([]);
  });

  it("every create/update/delete-style permission needs its group's view permission", () => {
    for (const p of ALL_PERMISSIONS) {
      const [group, action] = p.split(".");
      if (action === "view" || !ALL_PERMISSIONS.includes(`${group}.view` as never)) continue;
      expect(prerequisitesOf(p), p).toContain(`${group}.view`);
    }
  });

  it("computes transitive prerequisites and dependents", () => {
    expect(prerequisitesOf("reports.export").sort()).toEqual(["feedback.view", "reports.view"]);
    expect(dependentsOf("feedback.view")).toEqual(
      expect.arrayContaining(["feedback.export", "reports.view", "reports.export"]),
    );
  });

  it("prerequisites may come from another of the user's roles", () => {
    const [a, b] = effectiveAssignmentPermissions([["feedback.view"], ["feedback.view_contact"]]);
    expect([...a]).toEqual(["feedback.view"]);
    expect([...b]).toEqual(["feedback.view_contact"]);
    const [c] = effectiveAssignmentPermissions([["feedback.view_contact"]]);
    expect([...c]).toEqual([]);
  });

  it("an incomplete grant is reduced, never widened", () => {
    expect([...effectivePermissions(["reports.view", "dashboard.view"])]).toEqual(["dashboard.view"]);
    expect([...effectivePermissions(["feedback.view", "reports.view", "reports.export"])].sort()).toEqual([
      "feedback.view",
      "reports.export",
      "reports.view",
    ]);
    expect([...effectivePermissions(["user.update"])]).toEqual([]);
    expect([...effectivePermissions(["settings.view", "dashboard.view"])]).toEqual(["dashboard.view"]); // unknown dropped
  });
});

describe("what a signed-in user gets", () => {
  it("a role with reports.view but no feedback.view sees no Reports menu and cannot open it", async () => {
    const a = await actorWith({ permissions: ["reports.view", "dashboard.view"], raw: true });
    expect(can(a, "reports.view")).toBe(false);
    expect(can(a, "dashboard.view")).toBe(true);
  });

  it("a role with update permissions but no view permission grants nothing for them", async () => {
    const a = await actorWith({ permissions: ["user.update", "role.delete", "qr.create"], raw: true });
    for (const p of ["user.update", "role.delete", "qr.create"] as const) expect(can(a, p)).toBe(false);
    expect(firstAllowedHref(a)).toBeNull();
  });

  it("the landing page is the first allowed page, not always the dashboard", async () => {
    const onlyQr = await actorWith({ permissions: ["qr.view"] });
    expect(firstAllowedHref(onlyQr)).toBe("/admin/qr-codes");
    const full = await actorWith({ permissions: ["dashboard.view", "qr.view"] });
    expect(firstAllowedHref(full)).toBe("/admin/dashboard");
  });
});

describe("role service refuses incomplete roles", () => {
  it("createRole and updateRole report what is missing", async () => {
    const admin = await actorWith({
      permissions: [
        "role.view",
        "role.create",
        "role.update",
        "feedback.view",
        "reports.view",
        "reports.export",
      ],
    });
    await expect(
      createRole(admin, { key: uid("TR"), name: "Broken", permissions: ["reports.export"] }),
    ).rejects.toMatchObject({ code: "VALIDATION" });

    const ok = await createRole(admin, {
      key: uid("TR"),
      name: "Fine",
      permissions: ["feedback.view", "reports.view"],
    });
    await expect(
      updateRole(admin, ok.id, { name: "Fine", permissions: ["reports.view"] }),
    ).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });
});
