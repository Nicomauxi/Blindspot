import { createClient, type SupabaseClient } from "@supabase/supabase-js";

class _NoopWebSocket extends EventTarget {
  static CONNECTING = 0 as const;
  static OPEN = 1 as const;
  static CLOSING = 2 as const;
  static CLOSED = 3 as const;
  readyState: number = _NoopWebSocket.CLOSED;
  close(): void {}
  send(_data: unknown): void {}
}

let _client: SupabaseClient | null = null;

export function getDb(): SupabaseClient {
  if (_client) return _client;

  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_SERVICE_ROLE_KEY"];

  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  }

  _client = createClient(url, key, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    realtime: { transport: _NoopWebSocket as any },
  });

  return _client;
}
