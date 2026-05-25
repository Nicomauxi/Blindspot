"use client";

import { useEffect, useState, useCallback } from "react";
import {
  listUsers,
  createUser,
  patchUser,
  deleteUser,
  type User,
} from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { formatRelative } from "@/lib/utils";

type ModalState =
  | { type: "closed" }
  | { type: "create" }
  | { type: "edit"; user: User }
  | { type: "confirm_deactivate"; user: User }
  | { type: "confirm_reactivate"; user: User }
  | { type: "confirm_delete"; user: User }
  | { type: "reset_password"; user: User };

export default function UsersPage() {
  const token = useAuthStore((s) => s.token);
  const [users, setUsers] = useState<User[]>([]);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>({ type: "closed" });

  const load = useCallback(
    async (cursor?: string) => {
      if (!token) return;
      setLoading(true);
      try {
        const res = await listUsers(token, cursor);
        if (cursor) {
          setUsers((prev) => [...prev, ...res.data]);
        } else {
          setUsers(res.data);
        }
        setTotal(res.total);
        setNextCursor(res.next_cursor);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error al cargar usuarios");
      } finally {
        setLoading(false);
      }
    },
    [token]
  );

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="max-w-4xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">
          Usuarios{" "}
          <span className="text-gray-400 text-base font-normal">({total})</span>
        </h1>
        <button
          onClick={() => setModal({ type: "create" })}
          className="bg-brand-600 text-white text-sm px-4 py-2 rounded hover:bg-brand-700 transition-colors"
        >
          + Crear usuario
        </button>
      </div>

      {error && (
        <div className="bg-red-50 text-red-700 rounded px-4 py-3 text-sm">{error}</div>
      )}

      <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
        <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
            <tr>
              <th className="px-4 py-3 text-left">Email</th>
              <th className="px-4 py-3 text-left">Rol</th>
              <th className="px-4 py-3 text-left">Activo</th>
              <th className="px-4 py-3 text-left">Último login</th>
              <th className="px-4 py-3 text-left">Filtro</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {users.map((u) => (
              <tr key={u.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium">{u.email}</td>
                <td className="px-4 py-3">
                  <span
                    className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      u.role === "admin"
                        ? "bg-purple-100 text-purple-700"
                        : "bg-blue-100 text-blue-700"
                    }`}
                  >
                    {u.role}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      u.active
                        ? "bg-green-100 text-green-700"
                        : "bg-gray-100 text-gray-500"
                    }`}
                  >
                    {u.active ? "✓" : "✗"}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-500 text-xs">
                  {formatRelative(u.last_login_at)}
                </td>
                <td className="px-4 py-3 text-gray-500 text-xs">
                  {u.lead_filter
                    ? JSON.stringify(u.lead_filter).slice(0, 40)
                    : u.role === "admin"
                    ? "—"
                    : "sin filtro"}
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-2 justify-end">
                    <button
                      onClick={() => setModal({ type: "edit", user: u })}
                      className="text-xs text-brand-600 hover:underline"
                    >
                      Editar
                    </button>
                    <button
                      onClick={() =>
                        setModal({ type: "reset_password", user: u })
                      }
                      className="text-xs text-gray-500 hover:underline"
                    >
                      Reset pwd
                    </button>
                    {u.active ? (
                      <button
                        onClick={() =>
                          setModal({ type: "confirm_deactivate", user: u })
                        }
                        className="text-xs text-amber-600 hover:underline"
                      >
                        Desactivar
                      </button>
                    ) : (
                      <button
                        onClick={() =>
                          setModal({ type: "confirm_reactivate", user: u })
                        }
                        className="text-xs text-green-600 hover:underline"
                      >
                        Reactivar
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {users.length === 0 && !loading && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                  Sin usuarios
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
        {nextCursor && (
          <div className="px-4 py-3 border-t text-center">
            <button
              onClick={() => void load(nextCursor)}
              disabled={loading}
              className="text-sm text-brand-600 hover:underline disabled:opacity-50"
            >
              Cargar más
            </button>
          </div>
        )}
      </div>

      {/* Modals */}
      {modal.type === "create" && (
        <CreateUserModal
          token={token!}
          onClose={() => setModal({ type: "closed" })}
          onSuccess={() => {
            setModal({ type: "closed" });
            void load();
          }}
        />
      )}

      {modal.type === "edit" && (
        <EditUserModal
          token={token!}
          user={modal.user}
          onClose={() => setModal({ type: "closed" })}
          onSuccess={() => {
            setModal({ type: "closed" });
            void load();
          }}
        />
      )}

      {modal.type === "reset_password" && (
        <ResetPasswordModal
          token={token!}
          user={modal.user}
          onClose={() => setModal({ type: "closed" })}
          onSuccess={() => setModal({ type: "closed" })}
        />
      )}

      {modal.type === "confirm_deactivate" && (
        <ConfirmModal
          title="Desactivar usuario"
          message={`Esto revoca el acceso de ${modal.user.email} inmediatamente. Sus tokens activos quedan inválidos.`}
          confirmLabel="Desactivar"
          confirmClass="bg-amber-600 hover:bg-amber-700"
          onCancel={() => setModal({ type: "closed" })}
          onConfirm={async () => {
            await patchUser(token!, modal.user.id, { active: false });
            setModal({ type: "closed" });
            void load();
          }}
        />
      )}

      {modal.type === "confirm_reactivate" && (
        <ConfirmModal
          title="Reactivar usuario"
          message={`¿Reactivar el acceso de ${modal.user.email}?`}
          confirmLabel="Reactivar"
          confirmClass="bg-green-600 hover:bg-green-700"
          onCancel={() => setModal({ type: "closed" })}
          onConfirm={async () => {
            await patchUser(token!, modal.user.id, { active: true });
            setModal({ type: "closed" });
            void load();
          }}
        />
      )}

      {modal.type === "confirm_delete" && (
        <ConfirmModal
          title="Eliminar usuario"
          message={`Solo desactivar es reversible. ¿Eliminar definitivamente a ${modal.user.email}?`}
          confirmLabel="Eliminar"
          confirmClass="bg-red-600 hover:bg-red-700"
          onCancel={() => setModal({ type: "closed" })}
          onConfirm={async () => {
            await deleteUser(token!, modal.user.id);
            setModal({ type: "closed" });
            void load();
          }}
        />
      )}
    </div>
  );
}

function CreateUserModal({
  token,
  onClose,
  onSuccess,
}: {
  token: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "cm">("cm");
  const [filterRaw, setFilterRaw] = useState("");
  const [ackUnrestricted, setAckUnrestricted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      let lead_filter: Record<string, unknown> | null | undefined;
      if (role === "cm") {
        if (filterRaw.trim() === "") {
          setError("CM requiere un lead_filter");
          return;
        }
        lead_filter = JSON.parse(filterRaw) as Record<string, unknown>;
      }
      await createUser(token, {
        email,
        password,
        role,
        lead_filter,
        acknowledge_unrestricted: ackUnrestricted,
      });
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal title="Crear usuario" onClose={onClose}>
      <form onSubmit={(e) => void submit(e)} className="space-y-4">
        <Field label="Email">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="input"
            required
          />
        </Field>
        <Field label="Password inicial">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="input"
            required
            minLength={8}
          />
        </Field>
        <Field label="Rol">
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as "admin" | "cm")}
            className="input"
          >
            <option value="cm">CM</option>
            <option value="admin">Admin</option>
          </select>
        </Field>
        {role === "cm" && (
          <>
            <Field label="lead_filter (JSON)">
              <textarea
                value={filterRaw}
                onChange={(e) => setFilterRaw(e.target.value)}
                className="input font-mono text-xs"
                rows={3}
                placeholder='{"contact_tier":["A","B"]}'
              />
            </Field>
            {filterRaw.trim() === "{}" && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={ackUnrestricted}
                  onChange={(e) => setAckUnrestricted(e.target.checked)}
                />
                Sin restricciones (mostrar todos los leads)
              </label>
            )}
          </>
        )}
        {error && <p className="text-red-600 text-sm">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="text-sm px-4 py-2 border rounded hover:bg-gray-50"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={loading}
            className="text-sm px-4 py-2 bg-brand-600 text-white rounded hover:bg-brand-700 disabled:opacity-50"
          >
            {loading ? "Creando…" : "Crear"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function EditUserModal({
  token,
  user,
  onClose,
  onSuccess,
}: {
  token: string;
  user: User;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [filterRaw, setFilterRaw] = useState(
    user.lead_filter ? JSON.stringify(user.lead_filter, null, 2) : ""
  );
  const [ackUnrestricted, setAckUnrestricted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const lead_filter =
        user.role === "cm" && filterRaw.trim()
          ? (JSON.parse(filterRaw) as Record<string, unknown>)
          : undefined;
      await patchUser(token, user.id, {
        lead_filter,
        acknowledge_unrestricted: ackUnrestricted,
      });
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal title={`Editar ${user.email}`} onClose={onClose}>
      <form onSubmit={(e) => void submit(e)} className="space-y-4">
        {user.role === "cm" && (
          <>
            <Field label="lead_filter (JSON)">
              <textarea
                value={filterRaw}
                onChange={(e) => setFilterRaw(e.target.value)}
                className="input font-mono text-xs"
                rows={4}
              />
            </Field>
            {filterRaw.trim() === "{}" && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={ackUnrestricted}
                  onChange={(e) => setAckUnrestricted(e.target.checked)}
                />
                Sin restricciones
              </label>
            )}
          </>
        )}
        {error && <p className="text-red-600 text-sm">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="text-sm px-4 py-2 border rounded hover:bg-gray-50"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={loading}
            className="text-sm px-4 py-2 bg-brand-600 text-white rounded hover:bg-brand-700 disabled:opacity-50"
          >
            {loading ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ResetPasswordModal({
  token,
  user,
  onClose,
  onSuccess,
}: {
  token: string;
  user: User;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await patchUser(token, user.id, { password });
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal title={`Reset password — ${user.email}`} onClose={onClose}>
      <form onSubmit={(e) => void submit(e)} className="space-y-4">
        <Field label="Nueva contraseña">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="input"
            required
            minLength={8}
          />
        </Field>
        {error && <p className="text-red-600 text-sm">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="text-sm px-4 py-2 border rounded hover:bg-gray-50"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={loading}
            className="text-sm px-4 py-2 bg-brand-600 text-white rounded hover:bg-brand-700 disabled:opacity-50"
          >
            {loading ? "Cambiando…" : "Cambiar"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ConfirmModal({
  title,
  message,
  confirmLabel,
  confirmClass,
  onCancel,
  onConfirm,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  confirmClass: string;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handle() {
    setLoading(true);
    try {
      await onConfirm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal title={title} onClose={onCancel}>
      <p className="text-sm text-gray-700 mb-4">{message}</p>
      {error && <p className="text-red-600 text-sm mb-2">{error}</p>}
      <div className="flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="text-sm px-4 py-2 border rounded hover:bg-gray-50"
        >
          Cancelar
        </button>
        <button
          onClick={() => void handle()}
          disabled={loading}
          className={`text-sm px-4 py-2 text-white rounded disabled:opacity-50 ${confirmClass}`}
        >
          {loading ? "…" : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="font-semibold text-gray-900">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            ✕
          </button>
        </div>
        <div className="px-6 py-4">{children}</div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {children}
    </div>
  );
}
