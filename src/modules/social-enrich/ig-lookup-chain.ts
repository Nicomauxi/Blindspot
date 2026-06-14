// Cadena de proveedores de snippet de IG (la "cola entre fuentes gratis").
// Prueba cada proveedor en orden y devuelve el primer perfil no-null. Cada proveedor
// comparte la firma de lookup, así que agregar uno nuevo (ej. una API con cuota) es
// sumarlo al array — el resto del pipeline no cambia.
//
// Estado 2026: la única fuente $0 + legal + a-escala es SearXNG self-hosted (agrega
// buscadores internamente, resiliente al anti-bot de un engine puntual). DuckDuckGo
// directo queda como fallback débil (su anti-bot bloquea la IP tras pocas queries).
import type { SocialProfileData } from "./social-fusion.js";
import { fetchInstagramSnippetViaSearxng } from "./searxng-snippet.js";
import { fetchInstagramSnippet } from "./duckduckgo-snippet.js";

export type IgLookup = (
  username: string,
  opts: { throttleMs?: number }
) => Promise<SocialProfileData | null>;

export interface NamedProvider {
  name: string;
  lookup: IgLookup;
}

// Prueba los proveedores en orden; el primero que devuelve un perfil corta la cadena.
// Degrada con gracia: si un proveedor lanza, se lo trata como null y se sigue al siguiente.
export function createIgLookupChain(providers: NamedProvider[]): IgLookup {
  return async (username, opts) => {
    for (const provider of providers) {
      try {
        const profile = await provider.lookup(username, opts);
        if (profile) return profile;
      } catch {
        // proveedor caído → siguiente
      }
    }
    return null;
  };
}

// Cadena por defecto. SearXNG primario (resiliente). DDG se incluye solo si
// includeDuckDuckGo=true (por defecto NO: su anti-bot lo vuelve ruido que gasta throttle).
export function defaultIgLookupChain(opts: { includeDuckDuckGo?: boolean } = {}): IgLookup {
  const providers: NamedProvider[] = [
    { name: "searxng", lookup: (u, o) => fetchInstagramSnippetViaSearxng(u, o) },
  ];
  if (opts.includeDuckDuckGo) {
    providers.push({ name: "duckduckgo", lookup: (u, o) => fetchInstagramSnippet(u, o) });
  }
  return createIgLookupChain(providers);
}
