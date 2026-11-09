// Client-side rules for the listing form. They mirror convex/tools.ts (trimmed, counted in
// characters rather than UTF-16 units); the server stays the authority.
import { TOOL_DESCRIPTION_MAX, TOOL_NAME_MAX } from "@/convex/lib/constants";

export { TOOL_DESCRIPTION_MAX, TOOL_NAME_MAX };

/** Length after trimming, in characters ("João" is 4, an emoji is 1). */
export function charCount(value: string): number {
  return [...value.trim()].length;
}

export type ToolTextErrors = { name?: string; description?: string };

export function validateToolText(input: { name: string; description: string }): ToolTextErrors {
  const errors: ToolTextErrors = {};
  const name = charCount(input.name);
  if (name === 0) errors.name = "Give the tool a name.";
  else if (name > TOOL_NAME_MAX) errors.name = `Keep the name to ${TOOL_NAME_MAX} characters or fewer.`;
  const description = charCount(input.description);
  if (description === 0) errors.description = "Add a short description.";
  else if (description > TOOL_DESCRIPTION_MAX) {
    errors.description = `Keep the description to ${TOOL_DESCRIPTION_MAX} characters or fewer.`;
  }
  return errors;
}

/** "Ana Souza" → "Ana". Cards show the owner's first name only. */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || "A neighbor";
}
