"use client";

import { ErrorPanel } from "../../tools/_lib/error-panel";

export default function ListingsError({ error, retry }: { error: unknown; retry: () => void }) {
  return <ErrorPanel error={error} retry={retry} />;
}
