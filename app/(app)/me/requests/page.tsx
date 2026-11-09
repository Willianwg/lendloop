import type { Metadata } from "next";
import { LoanBoard } from "@/components/loan-card";

export const metadata: Metadata = { title: "Your requests" };

export default function RequestsPage() {
  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Your requests</h1>
        <p className="mt-1 text-muted-foreground">Tools you asked to borrow, and where each request stands.</p>
      </header>
      <LoanBoard source="myRequests" />
    </div>
  );
}
