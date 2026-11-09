"use client";

import { useMutation } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";
import { DataCard, ResponsiveData } from "@/components/admin/admin-shared";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import { errorMessage } from "@/lib/errors";

export type AdminUser = FunctionReturnType<typeof api.users.adminList>[number];

/** Everyone who signed in, with the Trusted Lender switch. No emails: admins don't need them. */
export function UsersTable({ users }: { users: AdminUser[] }) {
  const setTrusted = useMutation(api.users.setTrustedLender);
  const [busy, setBusy] = useState<Id<"users"> | null>(null);
  const sorted = [...users].sort((a, b) => a.name.localeCompare(b.name));

  async function toggle(user: AdminUser, trusted: boolean) {
    setBusy(user._id);
    try {
      await setTrusted({ userId: user._id, trusted });
      toast.success(trusted ? `${user.name} is now a Trusted Lender` : `${user.name} is no longer a Trusted Lender`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const trustedSwitch = (user: AdminUser, idSuffix: string) => (
    <Switch
      id={`trusted-${user._id}-${idSuffix}`}
      checked={user.trustedLender}
      disabled={busy === user._id}
      onCheckedChange={(checked) => void toggle(user, checked)}
      aria-label={`Trusted Lender: ${user.name}`}
    />
  );

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        A Trusted Lender badge shows on that person&apos;s tools for everyone signed in.
      </p>
      <ResponsiveData
        table={
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Name</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="text-right">Active listings</TableHead>
                <TableHead className="pr-4 text-right">Trusted Lender</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((user) => (
                <TableRow key={user._id}>
                  <TableCell className="pl-4 font-medium">{user.name}</TableCell>
                  <TableCell>
                    <RoleBadge role={user.role} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{user.activeListings}</TableCell>
                  <TableCell className="pr-4 text-right">{trustedSwitch(user, "table")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        }
        cards={sorted.map((user) => (
          <DataCard key={user._id} className="flex-row items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 font-semibold break-words">
                {user.name} <RoleBadge role={user.role} />
              </p>
              <p className="text-sm text-muted-foreground">
                {user.activeListings} active {user.activeListings === 1 ? "listing" : "listings"}
              </p>
            </div>
            <label className="flex shrink-0 items-center gap-2 text-sm">
              Trusted
              {trustedSwitch(user, "card")}
            </label>
          </DataCard>
        ))}
      />
    </div>
  );
}

function RoleBadge({ role }: { role: "user" | "admin" }) {
  return role === "admin" ? (
    <Badge variant="secondary">Admin</Badge>
  ) : (
    <span className="text-sm text-muted-foreground">Member</span>
  );
}
