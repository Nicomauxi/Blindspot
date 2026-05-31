import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAdmin } from "../../auth/middleware.js";
import {
  listNicheAliasGroups,
  createNicheAliasGroup,
  updateNicheAliasGroup,
  deleteNicheAliasGroup,
} from "../../../../src/storage/niches.js";
import { getDb } from "../../db/client.js";

const groupBodySchema = z.object({
  canonical: z.string().trim().min(1).max(100),
  aliases: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
});

export async function nichesRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/niches/groups", { preHandler: requireAdmin }, async (request, reply) => {
    try {
      const groups = await listNicheAliasGroups();
      return reply.status(200).send({ data: groups });
    } catch (err) {
      request.log.error({ err }, "Failed to list niche alias groups");
      return reply.status(500).send({ error: "Database error", error_code: "db_error" });
    }
  });

  app.get("/admin/niches/distinct", { preHandler: requireAdmin }, async (request, reply) => {
    const db = getDb();
    const { data, error } = await db
      .from("leads")
      .select("niche")
      .not("niche", "is", null)
      .order("niche")
      .limit(5000);

    if (error) {
      return reply.status(500).send({ error: "Database error", error_code: "db_error" });
    }

    const distinct = Array.from(
      new Set(
        (data ?? [])
          .map((row: { niche: string | null }) => row.niche)
          .filter((v): v is string => v !== null && v.trim().length > 0)
      )
    ).sort() as string[];

    return reply.status(200).send({ data: distinct, total: distinct.length });
  });

  app.post("/admin/niches/groups", { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = groupBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Validation error", details: parsed.error.flatten().fieldErrors });
    }
    try {
      const group = await createNicheAliasGroup(parsed.data.canonical, parsed.data.aliases);
      return reply.status(201).send({ data: group });
    } catch (err) {
      request.log.error({ err }, "Failed to create niche alias group");
      return reply.status(500).send({ error: "Database error", error_code: "db_error" });
    }
  });

  app.put("/admin/niches/groups/:id", { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = groupBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Validation error", details: parsed.error.flatten().fieldErrors });
    }
    try {
      const group = await updateNicheAliasGroup(id, parsed.data.canonical, parsed.data.aliases);
      return reply.status(200).send({ data: group });
    } catch (err) {
      request.log.error({ err }, "Failed to update niche alias group");
      return reply.status(500).send({ error: "Database error", error_code: "db_error" });
    }
  });

  app.delete("/admin/niches/groups/:id", { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      await deleteNicheAliasGroup(id);
      return reply.status(200).send({ data: { deleted: id } });
    } catch (err) {
      request.log.error({ err }, "Failed to delete niche alias group");
      return reply.status(500).send({ error: "Database error", error_code: "db_error" });
    }
  });
}
