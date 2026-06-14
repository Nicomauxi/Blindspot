import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { getDb } from "../db/client.js";

interface LoginBody {
  email: string;
  password: string;
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: LoginBody }>("/auth/login", {
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    schema: {
      body: {
        type: "object",
        required: ["email", "password"],
        properties: {
          email: { type: "string" },
          password: { type: "string" },
        },
      },
    },
  }, async (request, reply) => {
    const { email, password } = request.body;

    const db = getDb();
    const { data: user, error } = await db
      .from("users")
      .select("id, email, password_hash, role, active, token_version")
      .eq("email", email)
      .single();

    if (error || !user) {
      return reply.status(401).send({ error: "Invalid credentials", error_code: "invalid_credentials" });
    }

    if (!user.active) {
      return reply.status(401).send({ error: "Account inactive", error_code: "account_inactive" });
    }

    const valid = await bcrypt.compare(password, user.password_hash as string);
    if (!valid) {
      return reply.status(401).send({ error: "Invalid credentials", error_code: "invalid_credentials" });
    }

    await db
      .from("users")
      .update({ last_login_at: new Date().toISOString() })
      .eq("id", user.id);

    // N71: tv = token_version (revocación server-side); auth_time = login original
    // (capa la cadena de refresh — el access token renovable sin límite era un
    // refresh token eterno).
    const token = app.jwt.sign(
      { user_id: user.id, email: user.email, tv: (user.token_version as number | null) ?? 0, auth_time: Date.now() },
      { expiresIn: "24h" }
    );

    return reply.send({ token, role: user.role });
  });

  app.post("/auth/refresh", {
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
  }, async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch {
      return reply.status(401).send({ error: "Invalid token", error_code: "invalid_token" });
    }

    const db = getDb();
    const { data: user } = await db
      .from("users")
      .select("id, email, active, token_version")
      .eq("id", request.user.user_id)
      .single();

    if (!user?.active) {
      return reply.status(401).send({ error: "Account inactive", error_code: "account_inactive" });
    }

    const payload = request.user as { user_id: string; email: string; tv?: number; auth_time?: number };
    // N71: token revocado (token_version bumpeado) no se renueva.
    if (((user.token_version as number | null) ?? 0) !== (payload.tv ?? 0)) {
      return reply.status(401).send({ error: "Token revoked", error_code: "token_revoked" });
    }
    // N71: la cadena de refresh expira a los 30 días del login original — re-login.
    const REFRESH_CHAIN_MAX_MS = 30 * 24 * 60 * 60 * 1000;
    const authTime = payload.auth_time ?? Date.now();
    if (Date.now() - authTime > REFRESH_CHAIN_MAX_MS) {
      return reply.status(401).send({ error: "Session expired, login again", error_code: "session_expired" });
    }

    const token = app.jwt.sign(
      { user_id: payload.user_id, email: payload.email, tv: payload.tv ?? 0, auth_time: authTime },
      { expiresIn: "24h" }
    );

    return reply.send({ token });
  });
}
