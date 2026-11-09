import { fail } from "./errors";

// Control characters (CR/LF, NUL, ...) and invisible formatting characters (bidi overrides,
// zero-width joiners) let a name or tool name spoof text in the UI or inject lines into email
// headers. `multiline` allows plain line breaks, for descriptions only. The zero-width joiner
// (U+200D) is allowed because composed emoji like 👨‍🔧 need it.
const UNSAFE = /(?!\u200D)[\p{Cc}\p{Cf}]/u;
const UNSAFE_EXCEPT_NEWLINES = /(?![\n\u200D])[\p{Cc}\p{Cf}]/u;

/**
 * Trims `value` and enforces a length range counted in characters (not UTF-16 units).
 * Rejects control and format characters; `multiline` allows "\n" (and normalizes "\r\n").
 */
export function cleanText(value: string, field: string, min: number, max: number, multiline = false): string {
  const trimmed = (multiline ? value.replace(/\r\n?/g, "\n") : value).trim();
  if ((multiline ? UNSAFE_EXCEPT_NEWLINES : UNSAFE).test(trimmed)) {
    fail("INVALID", `${field} contains characters that aren't allowed`);
  }
  const length = [...trimmed].length;
  if (length < min || length > max) fail("INVALID", `${field} must be ${min}–${max} characters`);
  return trimmed;
}
