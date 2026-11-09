import type { Metadata } from "next";
import { Suspense } from "react";
import { LoanDetail, LoanDetailSkeleton } from "./loan-detail";

export const metadata: Metadata = { title: "Loan" };

// Loan ids are only known at request time, so the params are read inside Suspense
// (Cache Components); the shell around them is still prerendered.
export default function LoanPage({ params }: PageProps<"/loans/[id]">) {
  return (
    <Suspense fallback={<LoanDetailSkeleton />}>
      {params.then(({ id }) => (
        <LoanDetail loanId={id} />
      ))}
    </Suspense>
  );
}
