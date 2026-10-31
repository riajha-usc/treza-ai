import { z } from "zod";

/**
 * One way to pay for a purchase, for example monthly or annual billing.
 * Options come from the vendor's terms, read by the model, then checked
 * against the source text in code before anything relies on them.
 */
export const PurchaseOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  billing: z.enum(["one_time", "monthly", "annual"]),
  /** Amount of each charge, in minor units. */
  chargeMinor: z.number().int().positive(),
  currency: z.string().length(3),
  /** Months the tenant is locked in. One-time purchases use 0. */
  commitmentMonths: z.number().int().min(0).max(36),
  cancellable: z.boolean(),
});
export type PurchaseOption = z.infer<typeof PurchaseOptionSchema>;

/** Total paid over a horizon, so options can be compared on cost. */
export function costOverMonths(option: PurchaseOption, months: number): number {
  switch (option.billing) {
    case "one_time":
      return option.chargeMinor;
    case "monthly":
      return option.chargeMinor * months;
    case "annual":
      return option.chargeMinor * Math.ceil(months / 12);
  }
}

/** Cash leaving in a given week (1-based), assuming billing starts in week 1. */
export function chargeInWeek(option: PurchaseOption, week: number): number {
  switch (option.billing) {
    case "one_time":
    case "annual":
      return week === 1 ? option.chargeMinor : 0;
    case "monthly":
      // Charges in weeks 1, 5, 9, ... approximate a monthly cycle.
      return (week - 1) % 4 === 0 ? option.chargeMinor : 0;
  }
}
