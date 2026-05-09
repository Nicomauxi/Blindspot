import { checkSsl } from "../http.js";

export interface SslSignal {
  valid_https: boolean;
  cert_valid: boolean | null;
}

export function parseSsl(finalUrl: string | null): SslSignal {
  return checkSsl(finalUrl);
}
