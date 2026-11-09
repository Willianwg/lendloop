import { CATEGORIES, CONDITIONS } from "@/convex/lib/constants";

const categoryLabels: Record<string, string> = Object.fromEntries(CATEGORIES.map((c) => [c.value, c.label]));
const conditionLabels: Record<string, string> = Object.fromEntries(CONDITIONS.map((c) => [c.value, c.label]));

/** "power_tools" → "Power tools". Unknown values are shown as they are. */
export function formatCategory(value: string): string {
  return categoryLabels[value] ?? value;
}

/** "good" → "Good". Unknown values are shown as they are. */
export function formatCondition(value: string): string {
  return conditionLabels[value] ?? value;
}
