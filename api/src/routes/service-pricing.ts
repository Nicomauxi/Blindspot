import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb } from "../db/client.js";
import { requireAuth, requireAdmin, getAuthUser } from "../auth/middleware.js";

const upsertSchema = z.object({
  service_type: z.string().min(1),
  monthly_fee: z.number().int().min(0),
  currency: z.string().length(3).optional(),
  notes: z.string().nullable().optional(),
});

// Constrain :service_type to safe slug-like values (alphanumeric, dash, underscore).
const serviceTypeParamsSchema = {
  type: "object" as const,
  properties: {
    service_type: { type: "string", minLength: 1, maxLength: 80, pattern: "^[a-zA-Z0-9_-]+$" },
  },
  required: ["service_type"],
  additionalProperties: false,
};

export async function servicePricingRoutes(app: FastifyInstance): Promise<void> {
  // GET /service-pricing — returns pricing for the authenticated user
  app.get("/service-pricing", { preHandler: requireAuth }, async (request, reply) => {
    const db = getDb();
    const authUser = getAuthUser(request);

    // Admins see their own pricing (they set the base); CMs see their own or fall back to admin
    const { data, error } = await db
      .from("service_pricing")
      .select("*")
      .eq("user_id", authUser.id)
      .order("service_type");

    if (error) {
      return reply.status(500).send({ error: "Database error", error_code: "db_error" });
    }

    return reply.status(200).send({ data: data ?? [] });
  });

  // GET /service-pricing/:service_type — single entry for the authenticated user
  app.get("/service-pricing/:service_type", {
    preHandler: requireAuth,
    schema: { params: serviceTypeParamsSchema },
  }, async (request, reply) => {
    const { service_type } = request.params as { service_type: string };
    const db = getDb();
    const authUser = getAuthUser(request);

    const { data, error } = await db
      .from("service_pricing")
      .select("*")
      .eq("user_id", authUser.id)
      .eq("service_type", service_type)
      .maybeSingle();

    if (error) {
      return reply.status(500).send({ error: "Database error", error_code: "db_error" });
    }

    if (!data) {
      return reply.status(404).send({ error: "Not found", error_code: "not_found" });
    }

    return reply.status(200).send({ data });
  });

  // PUT /service-pricing/:service_type — upsert a pricing entry (admin only)
  app.put(
    "/service-pricing/:service_type",
    {
      preHandler: requireAdmin,
      schema: { params: serviceTypeParamsSchema },
    },
    async (request, reply) => {
      const { service_type } = request.params as { service_type: string };
      const parseResult = upsertSchema.safeParse(
        Object.assign({}, request.body, { service_type })
      );
      if (!parseResult.success) {
        return reply.status(400).send({
          error: "Validation error",
          error_code: "validation_error",
          details: parseResult.error.flatten().fieldErrors,
        });
      }

      const db = getDb();
      const authUser = getAuthUser(request);
      const now = new Date().toISOString();

      const { data, error } = await db
        .from("service_pricing")
        .upsert({
          user_id: authUser.id,
          service_type,
          monthly_fee: parseResult.data.monthly_fee,
          currency: parseResult.data.currency ?? "UYU",
          notes: parseResult.data.notes ?? null,
          updated_at: now,
        }, { onConflict: "user_id,service_type" })
        .select()
        .single();

      if (error) {
        request.log.error({ error }, "service_pricing upsert error");
        return reply.status(500).send({ error: "Database error", error_code: "db_error" });
      }

      return reply.status(200).send({ data });
    }
  );

  // DELETE /service-pricing/:service_type — admin only
  app.delete(
    "/service-pricing/:service_type",
    {
      preHandler: requireAdmin,
      schema: { params: serviceTypeParamsSchema },
    },
    async (request, reply) => {
      const { service_type } = request.params as { service_type: string };
      const db = getDb();
      const authUser = getAuthUser(request);

      const { error } = await db
        .from("service_pricing")
        .delete()
        .eq("user_id", authUser.id)
        .eq("service_type", service_type);

      if (error) {
        return reply.status(500).send({ error: "Database error", error_code: "db_error" });
      }

      return reply.status(204).send();
    }
  );
}
