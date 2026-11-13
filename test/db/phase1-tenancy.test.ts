import { afterAll, describe, expect, it } from "vitest";
import { adminSql, asAnon, asUser, createAuthUser, expectPgError } from "../support/db";
import { addMember, createCompany } from "../support/fixtures";
import { db } from "@/server/db/client";
import { listMemberships, loadTenantCtx, updateOrganizationSettings, getOrganization } from "@/server/domain/organizations";
import { createCustomer, getCustomer, listCustomers, setCustomerArchived, updateCustomer } from "@/server/domain/customers";
import { acceptInvitation, changeMemberRole, createInvitation, listMembers, removeMember } from "@/server/domain/members";
import { AppError } from "@/server/errors";

afterAll(async () => {
  await db().end();
  await adminSql.end();
});

describe("organizations", () => {
  it("creates an organization with the creator as owner", async () => {
    const { orgId, owner, ctx } = await createCompany("Alpha Heating");
    expect(ctx.role).toBe("owner");
    const memberships = await listMemberships(owner);
    expect(memberships).toEqual([{ organizationId: orgId, organizationName: "Alpha Heating", role: "owner" }]);
    const [audit] = await adminSql`select action from public.audit_events where organization_id = ${orgId}`;
    expect(audit.action).toBe("organization.created");
  });

  it("supports multiple organizations per user with explicit context", async () => {
    const { owner } = await createCompany("Multi One");
    const { orgId: secondOrg, ctx: other } = await createCompany("Multi Two");
    // invite owner of Multi One into Multi Two as technician
    const inv = await createInvitation(other, { email: owner.email, role: "technician" });
    const joined = await acceptInvitation(owner, inv.token);
    expect(joined).toBe(secondOrg);
    const memberships = await listMemberships(owner);
    expect(memberships.map((m) => [m.organizationName, m.role])).toEqual([
      ["Multi One", "owner"],
      ["Multi Two", "technician"],
    ]);
  });

  it("rejects settings updates from technicians", async () => {
    const { orgId } = await createCompany("Settings Co");
    const tech = await addMember(orgId, "technician");
    await expect(updateOrganizationSettings(tech, {
      name: "Hacked", industry: "hvac", timezone: "UTC", estimateValidityDays: "30",
    })).rejects.toMatchObject({ code: "forbidden" });
    // Even bypassing app-level checks, RLS blocks it.
    const res = await asUser(tech.userId, (tx) => tx`update public.organizations set name = 'Hacked' where id = ${orgId}`);
    expect(res.count).toBe(0);
  });

  it("stores tax rate as basis points", async () => {
    const { ctx } = await createCompany("Tax Co");
    await updateOrganizationSettings(ctx, {
      name: "Tax Co", industry: "plumbing", timezone: "America/Chicago", estimateValidityDays: "14", defaultTaxRatePercent: "8.25",
    });
    const org = await getOrganization(ctx);
    expect(org.defaultTaxRateBps).toBe(825);
    expect(org.industry).toBe("plumbing");
  });
});

describe("tenant isolation (Company A vs Company B)", () => {
  it("prevents Company A from reading, modifying, or creating Company B data", async () => {
    const a = await createCompany("Company A");
    const b = await createCompany("Company B");
    const bCustomer = await createCustomer(b.ctx, { name: "B's Customer", email: "b@example.test" });

    // A cannot load a tenant context for B.
    expect(await loadTenantCtx(a.owner, b.orgId)).toBeNull();

    // Forged context (A's identity, B's org id) — RLS still blocks everything.
    const forged = { ...a.ctx, organizationId: b.orgId, role: "owner" as const };
    await expect(getCustomer(forged, bCustomer)).rejects.toBeInstanceOf(AppError);
    expect((await listCustomers(forged, {})).customers).toHaveLength(0);
    await expect(updateCustomer(forged, bCustomer, { name: "Pwned" })).rejects.toMatchObject({ code: "not_found" });
    // RLS WITH CHECK rejects the insert (Postgres 42501, surfaced to users as "forbidden").
    await expect(createCustomer(forged, { name: "Injected" })).rejects.toMatchObject({ code: "42501" });

    // Raw SQL as A.
    await asUser(a.owner.userId, async (tx) => {
      expect(await tx`select * from public.customers where id = ${bCustomer}`).toHaveLength(0);
      expect(await tx`select * from public.organizations where id = ${b.orgId}`).toHaveLength(0);
      expect(await tx`select * from public.organization_members where organization_id = ${b.orgId}`).toHaveLength(0);
      expect(await tx`select * from public.audit_events where organization_id = ${b.orgId}`).toHaveLength(0);
      expect((await tx`update public.customers set name = 'x' where id = ${bCustomer}`).count).toBe(0);
      expect((await tx`delete from public.customers where id = ${bCustomer}`).count).toBe(0);
    });
    await expectPgError(
      asUser(a.owner.userId, (tx) => tx`insert into public.organization_members (organization_id, user_id, role) values (${b.orgId}, ${a.owner.userId}, 'owner')`),
      "42501",
    );
    await expectPgError(
      asUser(a.owner.userId, (tx) => tx`insert into public.audit_events (organization_id, actor_user_id, actor_type, action) values (${b.orgId}, ${a.owner.userId}, 'user', 'fake')`),
      "42501",
    );
    // B's record is untouched.
    const [row] = await adminSql`select name from public.customers where id = ${bCustomer}`;
    expect(row.name).toBe("B's Customer");
  });

  it("hides other organizations' member profiles", async () => {
    const a = await createCompany("Profile A");
    const b = await createCompany("Profile B");
    const visible = await asUser(a.owner.userId, (tx) => tx`select id from public.profiles where id = ${b.owner.userId}`);
    expect(visible).toHaveLength(0);
  });

  it("gives anonymous Data API clients no table access", async () => {
    await expectPgError(asAnon((tx) => tx`select * from public.customers`), "42501");
    await expectPgError(asAnon((tx) => tx`select * from public.organizations`), "42501");
  });

  it("does not let a user grant themselves platform administration", async () => {
    const u = await createAuthUser();
    await expectPgError(asUser(u.userId, (tx) => tx`insert into public.platform_administrators (user_id) values (${u.userId})`), "42501");
  });
});

describe("customers", () => {
  it("persists customers and finds them by search", async () => {
    const { ctx } = await createCompany("Search Co");
    const id = await createCustomer(ctx, { name: "Maria Gonzales", email: "MARIA@Example.test", phone: "555-0100", city: "Austin" });
    await createCustomer(ctx, { name: "Robert Chen", companyName: "Chen Properties" });
    // New transaction / "refresh"
    const c = await getCustomer(ctx, id);
    expect(c.email).toBe("maria@example.test");
    expect((await listCustomers(ctx, { q: "gonz" })).customers.map((x) => x.name)).toEqual(["Maria Gonzales"]);
    expect((await listCustomers(ctx, { q: "Chen Prop" })).customers.map((x) => x.name)).toEqual(["Robert Chen"]);
    expect((await listCustomers(ctx, { q: "555-0100" })).customers).toHaveLength(1);
    expect((await listCustomers(ctx, {})).total).toBe(2);
  });

  it("validates input", async () => {
    const { ctx } = await createCompany("Validate Co");
    await expect(createCustomer(ctx, { name: "  " })).rejects.toThrow();
    await expect(createCustomer(ctx, { name: "Ok", email: "not-an-email" })).rejects.toThrow();
  });

  it("allows only owners/admins to archive", async () => {
    const { orgId, ctx } = await createCompany("Archive Co");
    const tech = await addMember(orgId, "technician");
    const id = await createCustomer(tech, { name: "Created by tech" });
    await updateCustomer(tech, id, { name: "Edited by tech" });
    await expect(setCustomerArchived(tech, id, true)).rejects.toMatchObject({ code: "forbidden" });
    await expectPgError(asUser(tech.userId, (tx) => tx`update public.customers set archived_at = now() where id = ${id}`), "42501");
    await setCustomerArchived(ctx, id, true);
    expect((await listCustomers(ctx, {})).customers).toHaveLength(0);
    expect((await listCustomers(ctx, { status: "archived" })).customers).toHaveLength(1);
    await setCustomerArchived(ctx, id, false);
    expect((await listCustomers(ctx, {})).customers).toHaveLength(1);
  });
});

describe("members and roles", () => {
  it("enforces invitation email match and single use", async () => {
    const { ctx } = await createCompany("Invite Co");
    const invitee = await createAuthUser({ email: "invitee@example.test" });
    const stranger = await createAuthUser();
    const inv = await createInvitation(ctx, { email: "invitee@example.test", role: "technician" });
    await expect(acceptInvitation(stranger, inv.token)).rejects.toMatchObject({ code: "validation" });
    await acceptInvitation(invitee, inv.token);
    await expect(acceptInvitation(invitee, inv.token)).rejects.toMatchObject({ code: "validation" });
    expect((await listMembers(ctx)).map((m) => m.role).sort()).toEqual(["owner", "technician"]);
  });

  it("requires a verified email to accept invitations", async () => {
    const { ctx } = await createCompany("Verify Co");
    const unverified = await createAuthUser({ email: "unverified@example.test", confirmed: false });
    const inv = await createInvitation(ctx, { email: "unverified@example.test", role: "technician" });
    await expect(acceptInvitation(unverified, inv.token)).rejects.toMatchObject({ code: "validation" });
  });

  it("protects the last owner and owner-only role changes", async () => {
    const { orgId, ctx } = await createCompany("Owner Co");
    const admin = await addMember(orgId, "admin");
    const members = await listMembers(ctx);
    const ownerMember = members.find((m) => m.role === "owner")!;
    const adminMember = members.find((m) => m.role === "admin")!;
    await expect(changeMemberRole(admin, ownerMember.id, "technician")).rejects.toMatchObject({ code: "forbidden" });
    await expectPgError(asUser(admin.userId, (tx) => tx`update public.organization_members set role = 'owner' where id = ${adminMember.id}`), "42501");
    await expect(removeMember(ctx, ownerMember.id)).rejects.toMatchObject({ code: "23514" });
    await changeMemberRole(ctx, adminMember.id, "owner");
    await removeMember(ctx, ownerMember.id); // original owner leaves; one owner remains
    expect((await listMembers(admin)).map((m) => m.role)).toEqual(["owner"]);
  });
});

describe("audit log", () => {
  it("is append-only even for owners", async () => {
    const { orgId, owner } = await createCompany("Audit Co");
    const [ev] = await adminSql`select id from public.audit_events where organization_id = ${orgId} limit 1`;
    // No update/delete policies: RLS filters the row out, so nothing changes.
    expect((await asUser(owner.userId, (tx) => tx`update public.audit_events set action = 'x' where id = ${ev.id}`)).count).toBe(0);
    // No delete policy: RLS filters the row out, so nothing is deleted.
    expect((await asUser(owner.userId, (tx) => tx`delete from public.audit_events where id = ${ev.id}`)).count).toBe(0);
    await expectPgError(adminSql`delete from public.audit_events where id = ${ev.id}`, "42501");
    await expectPgError(adminSql`update public.audit_events set action = 'x' where id = ${ev.id}`, "42501");
  });
});
