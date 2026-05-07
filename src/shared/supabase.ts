import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { getConfig } from "./config.js";

// Node 20 has no native WebSocket; Supabase realtime throws at init time.
// We don't use realtime subscriptions — this stub satisfies the constructor.
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

export function getSupabase(): SupabaseClient {
  if (_client) return _client;
  const config = getConfig();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  // `any` justified: Node 20 EventTarget types don't satisfy Supabase's
  // WebSocketLikeConstructor — we never use realtime subscriptions.
  _client = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    realtime: { transport: _NoopWebSocket as any },
  });
  return _client;
}
