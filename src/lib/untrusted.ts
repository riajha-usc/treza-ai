/**
 * Text Treza reads comes from other parties: vendor terms, carrier logs,
 * seller notes. Any of it may carry instructions aimed at an automated
 * reviewer. Code never follows such text, and this check makes it visible.
 */
const PATTERNS = [
  /ignore (?:all |any |the )?(?:previous|prior|above|earlier) (?:instructions|rules|guidance|messages)/i,
  /disregard (?:all |any |the )?(?:previous|prior|above|earlier|other) (?:instructions|rules|evidence|messages)/i,
  /\bnote to the (?:ai|model|assistant|system)(?: reviewer)?\b/i,
  /\b(?:ai|llm|model|automated|assistant) reviewer\b/i,
  /\bsystem prompt\b/i,
  /\byou are an? (?:ai|assistant|language model)\b/i,
  /\b(?:attention|instructions? (?:for|to)|message (?:for|to)) (?:the )?(?:ai|assistant|model|reviewer)\b/i,
];

/** The first phrase addressed to a machine reviewer, or null when the text reads as plain business content. */
export function instructionsToReviewer(text: string): string | null {
  for (const p of PATTERNS) {
    const m = text.match(p);
    if (m) return m[0];
  }
  return null;
}
