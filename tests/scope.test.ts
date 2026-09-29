import { describe, expect, it } from "vitest";
import {
  branchWhere,
  departmentWhere,
  locationWhere,
  resolveScope,
  scopeCoversTarget,
  type Assignment,
} from "@/lib/rbac/scope";

const a = (over: Partial<Assignment> & Pick<Assignment, "scopeType">): Assignment => ({
  roleKey: "R",
  districtId: null,
  branchId: null,
  departmentId: null,
  permissions: new Set(["feedback.view"]),
  ...over,
});

describe("resolveScope", () => {
  it("is empty when no assignment grants the permission", () => {
    const s = resolveScope(
      [a({ scopeType: "ALL", permissions: new Set(["dashboard.view"]) })],
      "feedback.view",
    );
    expect(s.all).toBe(false);
    expect(s.districtIds.size + s.branchIds.size + s.departmentIds.size).toBe(0);
  });

  it("unions scopes of every granting assignment", () => {
    const s = resolveScope(
      [a({ scopeType: "DISTRICT", districtId: "d1" }), a({ scopeType: "BRANCH", branchId: "b9" })],
      "feedback.view",
    );
    expect([...s.districtIds]).toEqual(["d1"]);
    expect([...s.branchIds]).toEqual(["b9"]);
  });

  it("ignores assignments whose role lacks the permission (role without permission grants nothing)", () => {
    const s = resolveScope(
      [a({ scopeType: "ALL", permissions: new Set() }), a({ scopeType: "BRANCH", branchId: "b1" })],
      "feedback.view",
    );
    expect(s.all).toBe(false);
    expect([...s.branchIds]).toEqual(["b1"]);
  });
});

describe("scopeCoversTarget", () => {
  const district = resolveScope([a({ scopeType: "DISTRICT", districtId: "d1" })], "feedback.view");
  const branch = resolveScope([a({ scopeType: "BRANCH", branchId: "b1" })], "feedback.view");
  const all = resolveScope([a({ scopeType: "ALL" })], "feedback.view");

  it("district scope covers its branches but not another district's", () => {
    expect(scopeCoversTarget(district, { type: "BRANCH", branchId: "bx", districtId: "d1" })).toBe(true);
    expect(scopeCoversTarget(district, { type: "BRANCH", branchId: "by", districtId: "d2" })).toBe(false);
    expect(scopeCoversTarget(district, { type: "DISTRICT", districtId: "d2" })).toBe(false);
  });

  it("branch scope covers only that branch and never its district", () => {
    expect(scopeCoversTarget(branch, { type: "BRANCH", branchId: "b1", districtId: "d1" })).toBe(true);
    expect(scopeCoversTarget(branch, { type: "BRANCH", branchId: "b2", districtId: "d1" })).toBe(false);
    expect(scopeCoversTarget(branch, { type: "DISTRICT", districtId: "d1" })).toBe(false);
  });

  it("only ALL scope covers Head Office / bank-wide targets", () => {
    expect(scopeCoversTarget(all, { type: "ALL" })).toBe(true);
    expect(scopeCoversTarget(district, { type: "ALL" })).toBe(false);
    expect(scopeCoversTarget(district, { type: "DEPARTMENT", departmentId: "h", districtId: null })).toBe(
      false,
    );
  });
});

describe("where builders", () => {
  it("ALL scope adds no restriction", () => {
    const all = resolveScope([a({ scopeType: "ALL" })], "feedback.view");
    expect(branchWhere(all)).toEqual({});
    expect(locationWhere(all)).toEqual({});
  });

  it("scoped users are filtered by district and branch ids in the query", () => {
    const s = resolveScope(
      [a({ scopeType: "DISTRICT", districtId: "d1" }), a({ scopeType: "BRANCH", branchId: "b7" })],
      "feedback.view",
    );
    expect(branchWhere(s)).toEqual({ OR: [{ districtId: { in: ["d1"] } }, { id: { in: ["b7"] } }] });
    expect(locationWhere(s)).toEqual({ OR: [{ districtId: { in: ["d1"] } }, { branchId: { in: ["b7"] } }] });
  });

  it("no access yields a filter that matches nothing", () => {
    const none = resolveScope([], "feedback.view");
    expect(branchWhere(none)).toEqual({ id: { in: [] } });
    expect(departmentWhere(none)).toEqual({ id: { in: [] } });
    expect(locationWhere(none)).toEqual({ id: { in: [] } });
  });
});
