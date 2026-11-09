"use client";

import { useMutation } from "convex/react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { parseCategory } from "@/components/category-filter";
import { ToolForm } from "@/components/tool-form";
import { api } from "@/convex/_generated/api";

export function NewTool() {
  const router = useRouter();
  const create = useMutation(api.tools.create);
  const category = parseCategory(useSearchParams().get("category"));

  return (
    <ToolForm
      initial={{ category }}
      submitLabel="List tool"
      pendingLabel="Listing…"
      cancelHref="/me/listings"
      onSubmit={async (values) => {
        await create(values);
        toast.success("Tool listed", { description: `${values.name} is on the shelf.` });
        router.push("/me/listings");
      }}
    />
  );
}
