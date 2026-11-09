import type { Metadata } from "next";
import { Suspense } from "react";
import { FormPage, FormSkeleton } from "../_lib/form-page";
import { NewTool } from "./new-tool";

export const metadata: Metadata = { title: "List a tool" };

export default function NewToolPage() {
  return (
    <FormPage title="List a tool" description="Neighbors see it on Browse and can ask to borrow it.">
      {/* NewTool reads ?category= to preselect it, so it renders at request time. */}
      <Suspense fallback={<FormSkeleton />}>
        <NewTool />
      </Suspense>
    </FormPage>
  );
}
