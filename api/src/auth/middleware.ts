import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { getDb } from "../db/client.js";

export interface AuthUser {
  id: string;
  email: string;
  role: "admin" | "cm";
  lead_filter: Record<string, unknown> | null;
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    user: { user_id: string; email: string };
  }
}

export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    await request.jwtVerify();
  } catch {
    return reply.status(401).send({ error: "Unauthorized", error_code: "invalid_token" });
  }

  const db = getDb();
  const { data: user, error } = await db
    .from("users")
    .select("id, email, role, lead_filter, active")
    .eq("id", request.user.user_id)
    .single();

  if (error || !user) {
    return reply.status(401).send({ error: "User not found", error_code: "user_not_found" });
  }

  if (!user.active) {
    return reply.status(401).send({ error: "Account inactive", error_code: "account_inactive" });
  }

  (request as FastifyRequest & { authUser: AuthUser }).authUser = {
    id: user.id,
    email: user.email,
    role: user.role as "admin" | "cm",
    lead_filter: user.lead_filter as Record<string, unknown> | null,
  };
}

export async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  await requireAuth(request, reply);
  const authUser = (request as FastifyRequest & { authUser?: AuthUser }).authUser;
  if (!authUser || authUser.role !== "admin") {
    return reply.status(403).send({ error: "Forbidden", error_code: "admin_required" });
  }
}

export function getAuthUser(request: FastifyRequest): AuthUser {
  const user = (request as FastifyRequest & { authUser?: AuthUser }).authUser;
  if (!user) throw new Error("requireAuth not called before getAuthUser");
  return user;
}

export function registerAuthPlugin(app: FastifyInstance): void {
  app.decorateRequest("authUser", null);
}
