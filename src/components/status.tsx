import { Chip } from "./ui";

const TONE: Record<string, "good" | "warn" | "bad" | "neutral" | "accent"> = {
  card_issued: "good",
  approved: "accent",
  pending_approval: "warn",
  denied: "bad",
  failed: "bad",
  received: "neutral",
};

const LABEL: Record<string, string> = {
  card_issued: "card issued",
  pending_approval: "needs approval",
};

export function StatusChip({ status }: { status: string }) {
  return <Chip tone={TONE[status] ?? "neutral"}>{LABEL[status] ?? status}</Chip>;
}
