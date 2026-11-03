import { Tag, type Tone } from "./ui";

const PURCHASE: Record<string, [Tone, string]> = {
  received: ["neutral", "Received"],
  pending_approval: ["warn", "Needs approval"],
  approved: ["info", "Approved"],
  card_issued: ["good", "Card active"],
  denied: ["bad", "Denied"],
  failed: ["bad", "Failed"],
};

export function StatusChip({ status }: { status: string }) {
  const [tone, label] = PURCHASE[status] ?? ["neutral", status];
  return <Tag tone={tone}>{label}</Tag>;
}

const TIER: Record<string, Tone> = { low: "good", elevated: "warn", high: "bad", restricted: "bad" };

export function TierTag({ tier }: { tier: string }) {
  return <Tag tone={TIER[tier] ?? "neutral"}>{tier[0].toUpperCase() + tier.slice(1)}</Tag>;
}
