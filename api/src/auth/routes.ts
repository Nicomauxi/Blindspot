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
      .select("id, email, password_hash, role, active")
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

    const token = app.jwt.sign({ user_id: user.id, email: user.email }, { expiresIn: "24h" });

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
      .select("id, email, active")
      .eq("id", request.user.user_id)
      .single();

    if (!user?.active) {
      return reply.status(401).send({ error: "Account inactive", error_code: "account_inactive" });
    }

    const token = app.jwt.sign(
      { user_id: request.user.user_id, email: request.user.email },
      { expiresIn: "24h" }
    );

    return reply.send({ token });
  });
}
