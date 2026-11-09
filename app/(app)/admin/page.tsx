import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminConsole, AdminSkeleton } from "@/components/admin/admin-console";

export const metadata: Metadata = { title: "Admin" };

// The console reads the tab from the URL (useSearchParams), which needs a Suspense boundary
// under Cache Components. Access is enforced by Convex, not by this page.
export default function AdminPage() {
  return (
    <Suspense fallback={<AdminSkeleton />}>
      <AdminConsole />
    </Suspense>
  );
}
