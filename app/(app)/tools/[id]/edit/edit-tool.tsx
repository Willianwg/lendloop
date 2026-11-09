"use client";

import { useMutation, useQuery } from "convex/react";
import { SearchX } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { ToolForm } from "@/components/tool-form";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui-kit/empty-state";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { FormSkeleton } from "../../_lib/form-page";
import { useViewerReady } from "../../_lib/use-viewer-ready";

export function EditTool() {
  const { id } = useParams<{ id: string }>();
  const toolId = id as Id<"tools">; // a malformed id fails the query's validator → error.tsx
  const router = useRouter();
  const ready = useViewerReady();
  const tool = useQuery(api.tools.get, ready ? { toolId } : "skip");
  const update = useMutation(api.tools.update);

  if (tool === undefined) return <FormSkeleton />;
  if (tool === null || !tool.isMine) {
    return (
      <EmptyState
        icon={SearchX}
        className="border-0 py-6"
        title={tool === null ? "This listing is gone" : "This isn't your listing"}
        description={
          tool === null
            ? "It was deleted or removed, so there's nothing to edit."
            : "Only the owner can edit a listing."
        }
        action={
          <Button asChild variant="outline" size="lg" className="h-10 px-4">
            <Link href="/me/listings">Back to your listings</Link>
          </Button>
        }
      />
    );
  }

  return (
    <ToolForm
      // The form keeps its own state: a live update to the listing doesn't overwrite typing.
      key={tool._id}
      initial={tool}
      submitLabel="Save changes"
      pendingLabel="Saving…"
      cancelHref="/me/listings"
      onSubmit={async (values) => {
        await update({ toolId: tool._id, ...values });
        toast.success("Changes saved");
        router.push("/me/listings");
      }}
    />
  );
}
