import { AccessDenied } from "@/components/admin/page-header";

/** HTTP 403 page for routes outside the admin portal layout (for example the print sheet). */
export default function Forbidden() {
  return <AccessDenied />;
}
