import type { PurchaseOption } from "./options";
import { toMajor } from "../money/money";

/** Airwallex authorization_controls, built entirely in code from the chosen option. */
export interface CardControls {
  allowed_transaction_count: "SINGLE" | "MULTIPLE";
  transaction_limits: {
    currency: string;
    limits: { amount: number; interval: "PER_TRANSACTION" | "MONTHLY" | "ALL_TIME" }[];
  };
  allowed_currencies: string[];
  allowed_merchant_categories: string[];
  active_to: string;
}

/**
 * Turns the decision into limits the card network enforces. A monthly plan
 * gets a card that can never be charged the annual price: the annual charge
 * exceeds the per-transaction limit and declines at authorization.
 */
export function buildCardControls(input: {
  option: PurchaseOption;
  merchantCategoryCode: string;
  reconsiderAfterDays: number;
  now?: Date;
}): CardControls {
  const { option } = input;
  const now = input.now ?? new Date();
  const activeTo = new Date(now.getTime() + input.reconsiderAfterDays * 86_400_000);
  const charge = toMajor(option.chargeMinor, option.currency);
  const months = Math.max(1, Math.ceil(input.reconsiderAfterDays / 30));

  const limits: CardControls["transaction_limits"]["limits"] =
    option.billing === "monthly"
      ? [
          { amount: charge, interval: "PER_TRANSACTION" },
          { amount: charge, interval: "MONTHLY" },
          // PER_TRANSACTION is not cumulative, so cap total spend too.
          { amount: toMajor(option.chargeMinor * months, option.currency), interval: "ALL_TIME" },
        ]
      : [
          { amount: charge, interval: "PER_TRANSACTION" },
          { amount: charge, interval: "ALL_TIME" },
        ];

  return {
    allowed_transaction_count: option.billing === "monthly" ? "MULTIPLE" : "SINGLE",
    transaction_limits: { currency: option.currency, limits },
    allowed_currencies: [option.currency],
    allowed_merchant_categories: [input.merchantCategoryCode],
    active_to: activeTo.toISOString(),
  };
}
