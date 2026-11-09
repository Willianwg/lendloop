import type { Metadata } from "next";
import { LoanBoard } from "@/components/loan-card";

export const metadata: Metadata = { title: "Incoming requests" };

export default function IncomingPage() {
  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Incoming requests</h1>
        <p className="mt-1 text-muted-foreground">Neighbors asking to borrow your tools, and the loans you have out.</p>
      </header>
      <LoanBoard source="incoming" />
    </div>
  );
}
