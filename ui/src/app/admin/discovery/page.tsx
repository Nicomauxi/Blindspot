import { redirect } from "next/navigation";

// Discovery se absorbió en Operaciones (Generar Procesos + Discovery · contexto y mapa).
// El redirect preserva links guardados a /admin/discovery.
export default function DiscoveryRedirectPage() {
  redirect("/admin/operations");
}
