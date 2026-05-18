import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb } from "../db/client.js";
import { requireAdmin, getAuthUser } from "../auth/middleware.js";
import bcrypt from "bcryptjs";

const permissiveUuid = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    "Invalid UUID"
  );

const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(["admin", "cm"]).default("cm"),
  lead_filter: z.record(z.string(), z.unknown()).nullable().optional(),
  acknowledge_unrestricted: z.boolean().optional(),
});

const patchUserSchema = z.object({
  email: z.string().email().optional(),
  password: z.string().min(8).optional(),
  active: z.boolean().optional(),
  role: z.enum(["admin", "cm"]).optional(),
  lead_filter: z.record(z.string(), z.unknown()).nullable().optional(),
  acknowledge_unrestricted: z.boolean().optional(),
});

const listQuerySchema = z.object({
  cursor: permissiveUuid.optional(),
  limit: z
    .string()
    .optional()
    .transform((v) => Math.min(Number(v ?? "50"), 200))
    .pipe(z.number().int().min(1).max(200)),
});

function validateLeadFilter(
  role: string,
  lead_filter: Record<string, unknown> | null | undefined,
  acknowledge_unrestricted: boolean | undefined
): string | null {
  if (role !== "cm") return null;
  if (lead_filter === undefined) return null;
  if (lead_filter === null) return "lead_filter_required";
  if (Object.keys(lead_filter).length === 0 && !acknowledge_unrestricted) {
    return "lead_filter_empty_requires_ack";
  }
  // Check for empty arrays in known array fields
  for (const [k, v] of Object.entries(lead_filter)) {
    if (Array.isArray(v) && v.length === 0) {
      return "lead_filter_array_empty";
    }
  }
  return null;
}

async function writeAuditLog(
  actorId: string,
  actorRole: string,
  action: string,
  targetType: string,
  targetId: string,
  diff?: Record<string, unknown>,
  ip?: string,
  userAgent?: string
): Promise<void> {
  const db = getDb();
  await db.from("audit_log").insert({
    actor_user_id: actorId,
    actor_role: actorRole,
    action,
    target_type: targetType,
    target_id: targetId,
    diff: diff ?? null,
    ip_address: ip ?? null,
    user_agent: userAgent ?? null,
  });
}

export async function usersRoutes(app: FastifyInstance): Promise<void> {
  // GET /users — admin only
  app.get("/users", { preHandler: requireAdmin }, async (request, reply) => {
    const parseResult = listQuerySchema.safeParse(request.query);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: "Invalid query",
        error_code: "invalid_query",
      });
    }
    const { cursor, limit } = parseResult.data;
    const db = getDb();

    let query = db
      .from("users")
      .select("id, email, role, lead_filter, active, created_at, updated_at, last_login_at", {
        count: "exact",
      })
      .order("created_at", { ascending: false })
      .limit(limit + 1);

    if (cursor) {
      const { data: cursorRow } = await db
        .from("users")
        .select("created_at")
        .eq("id", cursor)
        .single();
      if (cursorRow) {
        query = query.lt("created_at", (cursorRow as { created_at: string }).created_at);
      }
    }

    const { data, error, count } = await query;
    if (error) {
      return reply.status(500).send({ error: "Database error", error_code: "db_error" });
    }

    const rows = data ?? [];
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore
      ? (page[page.length - 1] as { id: string } | undefined)?.id ?? null
      : null;

    return reply.status(200).send({ data: page, next_cursor: nextCursor, total: count ?? 0 });
  });

  // GET /users/:id — admin only
  app.get("/users/:id", { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const db = getDb();
    const { data, error } = await db
      .from("users")
      .select("id, email, role, lead_filter, active, created_at, updated_at, last_login_at")
      .eq("id", id)
      .single();

    if (error || !data) {
      return reply.status(404).send({ error: "User not found", error_code: "not_found" });
    }

    return reply.status(200).send({ data });
  });

  // POST /users — admin only
  app.post("/users", { preHandler: requireAdmin }, async (request, reply) => {
    const parseResult = createUserSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: "Validation error",
        error_code: "validation_error",
        details: parseResult.error.flatten().fieldErrors,
      });
    }

    const { email, password, role, lead_filter, acknowledge_unrestricted } = parseResult.data;

    const filterError = validateLeadFilter(role, lead_filter, acknowledge_unrestricted);
    if (filterError) {
      return reply.status(400).send({
        error: "Invalid lead_filter",
        error_code: filterError,
      });
    }

    const authUser = getAuthUser(request);
    const hash = await bcrypt.hash(password, 12);
    const db = getDb();

    const { data: user, error: insertError } = await db
      .from("users")
      .insert({
        email,
        password_hash: hash,
        role,
        lead_filter: lead_filter ?? null,
        active: true,
      })
      .select("id, email, role, lead_filter, active, created_at")
      .single();

    if (insertError) {
      if (insertError.code === "23505") {
        return reply.status(409).send({
          error: "Email already exists",
          error_code: "email_conflict",
        });
      }
      return reply.status(500).send({ error: "Database error", error_code: "db_error" });
    }

    await writeAuditLog(
      authUser.id,
      authUser.role,
      "user.create",
      "user",
      (user as { id: string }).id,
      { email, role },
      request.ip,
      request.headers["user-agent"]
    );

    return reply.status(201).send({ data: user });
  });

  // PATCH /users/:id — admin only
  app.patch("/users/:id", { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parseResult = patchUserSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: "Validation error",
        error_code: "validation_error",
        details: parseResult.error.flatten().fieldErrors,
      });
    }

    const db = getDb();
    const { data: existing, error: fetchError } = await db
      .from("users")
      .select("id, email, role, lead_filter, active")
      .eq("id", id)
      .single();

    if (fetchError || !existing) {
      return reply.status(404).send({ error: "User not found", error_code: "not_found" });
    }

    const patch = parseResult.data;
    const effectiveRole =
      patch.role ?? (existing as { role: string }).role;

    if ("lead_filter" in patch) {
      const filterError = validateLeadFilter(
        effectiveRole,
        patch.lead_filter,
        patch.acknowledge_unrestricted
      );
      if (filterError) {
        return reply.status(400).send({
          error: "Invalid lead_filter",
          error_code: filterError,
        });
      }
    }

    const authUser = getAuthUser(request);
    const update: Record<string, unknown> = {};
    const diffBefore: Record<string, unknown> = {};
    const diffAfter: Record<string, unknown> = {};

    if (patch.email !== undefined) {
      diffBefore["email"] = (existing as { email: string }).email;
      diffAfter["email"] = patch.email;
      update["email"] = patch.email;
    }
    if (patch.password !== undefined) {
      update["password_hash"] = await bcrypt.hash(patch.password, 12);
    }
    if (patch.active !== undefined) {
      diffBefore["active"] = (existing as { active: boolean }).active;
      diffAfter["active"] = patch.active;
      update["active"] = patch.active;
    }
    if (patch.role !== undefined) {
      diffBefore["role"] = (existing as { role: string }).role;
      diffAfter["role"] = patch.role;
      update["role"] = patch.role;
    }
    if ("lead_filter" in patch) {
      diffBefore["lead_filter"] = (existing as { lead_filter: unknown }).lead_filter;
      diffAfter["lead_filter"] = patch.lead_filter;
      update["lead_filter"] = patch.lead_filter;
    }

    if (Object.keys(update).length === 0) {
      return reply.status(400).send({ error: "No fields to update", error_code: "empty_patch" });
    }

    const { data: updated, error: updateError } = await db
      .from("users")
      .update(update)
      .eq("id", id)
      .select("id, email, role, lead_filter, active, updated_at")
      .single();

    if (updateError) {
      if (updateError.code === "23505") {
        return reply.status(409).send({ error: "Email already exists", error_code: "email_conflict" });
      }
      return reply.status(500).send({ error: "Database error", error_code: "db_error" });
    }

    // Determine audit action
    const action = patch.password
      ? "user.password_reset"
      : patch.active === false
      ? "user.deactivate"
      : patch.active === true
      ? "user.reactivate"
      : patch.role
      ? "user.role_change"
      : "lead_filter" in patch
      ? "lead_filter.update"
      : "user.update";

    await writeAuditLog(
      authUser.id,
      authUser.role,
      action,
      "user",
      id,
      { before: diffBefore, after: diffAfter },
      request.ip,
      request.headers["user-agent"]
    );

    return reply.status(200).send({ data: updated });
  });

  // DELETE /users/:id — admin only
  app.delete("/users/:id", { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const authUser = getAuthUser(request);

    if (id === authUser.id) {
      return reply.status(400).send({
        error: "Cannot delete yourself",
        error_code: "self_delete_forbidden",
      });
    }

    const db = getDb();
    const { data: existing } = await db
      .from("users")
      .select("id, email, role")
      .eq("id", id)
      .single();

    if (!existing) {
      return reply.status(404).send({ error: "User not found", error_code: "not_found" });
    }

    // Write audit log BEFORE destructive action
    await writeAuditLog(
      authUser.id,
      authUser.role,
      "user.delete",
      "user",
      id,
      { email: (existing as { email: string }).email, role: (existing as { role: string }).role },
      request.ip,
      request.headers["user-agent"]
    );

    const { error: deleteError } = await db.from("users").delete().eq("id", id);
    if (deleteError) {
      return reply.status(500).send({ error: "Database error", error_code: "db_error" });
    }

    return reply.status(204).send();
  });
}
