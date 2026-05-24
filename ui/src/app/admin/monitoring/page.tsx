import { redirect } from "next/navigation";

export default function MonitoringRedirectPage() {
  redirect("/admin/operations#monitoring");
}
