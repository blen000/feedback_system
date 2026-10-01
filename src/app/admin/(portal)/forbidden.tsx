import { AccessDenied } from "@/components/admin/page-header";

/** Rendered (with HTTP 403) when a signed-in user opens an admin page they hold no permission for. */
export default function Forbidden() {
  return <AccessDenied />;
}
