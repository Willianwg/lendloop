"use client";

import { SignInButton, useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { Button } from "@/components/ui/button";

/** Signed out: open Clerk's sign-in modal. Signed in: go into the app. */
export function LandingCta({ size = "lg" }: { size?: "default" | "lg" }) {
  const { isLoaded, isSignedIn } = useAuth();
  const className = size === "lg" ? "h-11 px-5 text-base" : undefined;

  if (isLoaded && isSignedIn) {
    return (
      <Button asChild size={size} className={className}>
        <Link href="/tools">Open LendLoop</Link>
      </Button>
    );
  }
  return (
    <SignInButton mode="modal" forceRedirectUrl="/tools">
      <Button size={size} className={className} disabled={!isLoaded}>
        Sign in to lend or borrow
      </Button>
    </SignInButton>
  );
}
