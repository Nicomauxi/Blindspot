import { describe, expect, it } from "vitest";
import { isAdminRouteAllowed } from "../../ui/src/lib/admin-access";

describe("admin route access", () => {
  it("allows CM on shared admin pages", () => {
    expect(isAdminRouteAllowed("/admin", "cm")).toBe(true);
    expect(isAdminRouteAllowed("/admin/leads", "cm")).toBe(true);
    expect(isAdminRouteAllowed("/admin/outreach", "cm")).toBe(true);
  });

  it("blocks CM on admin-only pages and nested routes", () => {
    expect(isAdminRouteAllowed("/admin/discovery", "cm")).toBe(false);
    expect(isAdminRouteAllowed("/admin/users/123", "cm")).toBe(false);
    expect(isAdminRouteAllowed("/admin/audit-log/export", "cm")).toBe(false);
  });

  it("allows admins everywhere", () => {
    expect(isAdminRouteAllowed("/admin/discovery", "admin")).toBe(true);
    expect(isAdminRouteAllowed("/admin/users", "admin")).toBe(true);
  });
});
