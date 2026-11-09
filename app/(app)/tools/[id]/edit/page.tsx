import type { Metadata } from "next";
import { Suspense } from "react";
import { FormPage, FormSkeleton } from "../../_lib/form-page";
import { EditTool } from "./edit-tool";

export const metadata: Metadata = { title: "Edit listing" };

export default function EditToolPage() {
  return (
    <FormPage title="Edit listing" description="Changes show up on Browse right away.">
      {/* The tool id is only known at request time. */}
      <Suspense fallback={<FormSkeleton />}>
        <EditTool />
      </Suspense>
    </FormPage>
  );
}
