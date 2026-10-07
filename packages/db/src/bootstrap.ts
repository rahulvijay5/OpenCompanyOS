import { eq } from "drizzle-orm";
import type { Database } from "./client.js";
import { tenantMembers, tenants, users } from "./schema.js";

const LOCAL_TENANT_SLUG = "local";
const LOCAL_USER_EMAIL = "local@opencompanyos.dev";

export type LocalBootstrap = {
  tenantId: string;
  userId: string;
};

/** Ensures a local tenant/user exist for development without auth. */
export async function ensureLocalTenant(db: Database): Promise<LocalBootstrap> {
  const existingTenant = await db.query.tenants.findFirst({
    where: eq(tenants.slug, LOCAL_TENANT_SLUG),
  });

  let tenantId = existingTenant?.id;
  if (!tenantId) {
    const [created] = await db
      .insert(tenants)
      .values({
        name: "Local Development",
        slug: LOCAL_TENANT_SLUG,
      })
      .returning({ id: tenants.id });
    if (!created) {
      throw new Error("Failed to create local tenant");
    }
    tenantId = created.id;
  }

  const existingUser = await db.query.users.findFirst({
    where: eq(users.email, LOCAL_USER_EMAIL),
  });

  let userId = existingUser?.id;
  if (!userId) {
    const [created] = await db
      .insert(users)
      .values({
        email: LOCAL_USER_EMAIL,
        name: "Local Developer",
      })
      .returning({ id: users.id });
    if (!created) {
      throw new Error("Failed to create local user");
    }
    userId = created.id;
  }

  const membership = await db.query.tenantMembers.findFirst({
    where: (table, { and, eq: equals }) =>
      and(equals(table.tenantId, tenantId), equals(table.userId, userId)),
  });

  if (!membership) {
    await db.insert(tenantMembers).values({
      tenantId,
      userId,
      role: "owner",
    });
  }

  return { tenantId, userId };
}
