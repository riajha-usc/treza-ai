export type AccountType = "asset" | "liability" | "equity" | "revenue" | "expense";

/**
 * Chart of accounts. Platform accounts belong to the platform tenant.
 * Seller accounts belong to each seller tenant and represent what the
 * platform owes that seller, so a seller's books never mix with another's.
 */
export const PLATFORM_ACCOUNTS = {
  cash: { code: "platform_cash", type: "asset" },
  funding: { code: "platform_funding", type: "equity" },
  revenue: { code: "platform_revenue", type: "revenue" },
  bridgeReceivable: { code: "bridge_receivable", type: "asset" },
  cardSpend: { code: "card_spend", type: "expense" },
  disputeLosses: { code: "dispute_losses", type: "expense" },
  disputeFees: { code: "dispute_fees", type: "expense" },
  disputeHold: { code: "dispute_hold", type: "liability" },
} as const satisfies Record<string, { code: string; type: AccountType }>;

export const SELLER_ACCOUNTS = {
  payable: { code: "seller_payable", type: "liability" },
  reserve: { code: "seller_reserve", type: "liability" },
} as const satisfies Record<string, { code: string; type: AccountType }>;

/** Debit-normal accounts grow with debits; the rest grow with credits. */
export function isDebitNormal(type: AccountType): boolean {
  return type === "asset" || type === "expense";
}
