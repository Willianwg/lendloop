import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { EnsureUser } from "@/components/ensure-user";

// Signed-in area. proxy.ts sends anonymous visitors to sign in before this renders.
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell>
      <EnsureUser />
      {children}
    </AppShell>
  );
}
