"use client";

import { ErrorPanel } from "./_lib/error-panel";

export default function ToolsError({ error, retry }: { error: unknown; retry: () => void }) {
  return <ErrorPanel error={error} retry={retry} />;
}
