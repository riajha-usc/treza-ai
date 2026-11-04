/**
 * Text Treza reads comes from other parties: vendor terms, carrier logs,
 * seller notes. Any of it may carry instructions aimed at an automated
 * reviewer. Code never follows such text, and this check makes it visible.
 */
const PATTERNS = [
  /ignore (?:all |any |the )?(?:previous|prior|above|earlier) (?:instructions|rules|guidance|messages)/i,
  /disregard (?:all |any |the )?(?:previous|prior|above|earlier|other) (?:instructions|rules|evidence|messages)/i,
  /\b(?:previous|prior|earlier) (?:instructions|rules|guidance) (?:are void|do not apply|no longer apply)\b/i,
  /\bnote to the (?:ai|model|assistant|system)(?: reviewer)?\b/i,
  /\b(?:ai|llm|model|automated|assistant) reviewer\b/i,
  /\breviewer bot\b/i,
  /\bsystem prompt\b/i,
  /\bhidden instructions?\b/i,
  /\byou are (?:a|an|the) (?:helpful )?(?:ai|assistant|language model|reviewer|agent|dispute agent|purchase agent)\b/i,
  /\bas an? (?:ai|assistant|language model|automated system)\b/i,
  /\b(?:attention|instructions? (?:for|to)|message (?:for|to)|this (?:message|note) is for) (?:the )?(?:ai|assistant|model|reviewer|language model|automated (?:system|reviewer))\b/i,
  /\b(?:for|to) the (?:ai|language model|automated (?:reviewer|system))\b/i,
  /\battention,? (?:ai|automated system)\b/i,
  /\binstruct (?:your|the) (?:model|ai|assistant)\b/i,
  /(?:^|[\s[<!-]+)assistant\s*[:\]]/i,
];

/** Undoes cheap disguises: A.I. for AI, N0te for Note. */
const normalise = (text: string) =>
  text
    .replace(/\b([a-z])\.([a-z])\.(?=\s|$)/gi, "$1$2")
    .replace(/(?<=[a-z])0(?=[a-z])/gi, "o")
    .replace(/(?<=[a-z])1(?=[a-z])/gi, "l")
    .replace(/(?<=[a-z])3(?=[a-z])/gi, "e");

/** The first phrase addressed to a machine reviewer, or null when the text reads as plain business content. */
export function instructionsToReviewer(text: string): string | null {
  const t = normalise(text);
  for (const p of PATTERNS) {
    const m = t.match(p);
    if (m) return m[0].trim();
  }
  return null;
}
