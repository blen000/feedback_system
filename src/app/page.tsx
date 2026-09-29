import { redirect } from "next/navigation";

// Customers only ever arrive through a QR link (/f/[code]); the bare domain leads staff to the portal.
export default function Home() {
  redirect("/admin/dashboard");
}
