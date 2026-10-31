import type { Queryable } from "../db/client";
import { chargeInWeek, type PurchaseOption } from "./options";

export interface CashFlow {
  week: number;
  amountMinor: number;
  description: string;
}

export interface Projection {
  optionId: string;
  weeklyBalancesMinor: number[];
  lowestBalanceMinor: number;
  /** First week the balance drops below the reserve floor, or null if it never does. */
  firstBreachWeek: number | null;
}

/** Projects weekly cash for one option. Pure arithmetic, no model. */
export function projectCash(input: {
  startingBalanceMinor: number;
  flows: CashFlow[];
  weeks: number;
  reserveFloorMinor: number;
  option: PurchaseOption;
}): Projection {
  const balances: number[] = [];
  let balance = input.startingBalanceMinor;
  let firstBreachWeek: number | null = null;
  for (let week = 1; week <= input.weeks; week++) {
    for (const f of input.flows) if (f.week === week) balance += f.amountMinor;
    balance -= chargeInWeek(input.option, week);
    balances.push(balance);
    if (firstBreachWeek === null && balance < input.reserveFloorMinor) firstBreachWeek = week;
  }
  return {
    optionId: input.option.id,
    weeklyBalancesMinor: balances,
    lowestBalanceMinor: Math.min(...balances),
    firstBreachWeek,
  };
}

export async function loadCash(
  q: Queryable,
  tenantId: string,
  currency: string,
): Promise<{ startingBalanceMinor: number; source: string; flows: CashFlow[] }> {
  const [position] = await q.query<{ balance_minor: number; source: string }>(
    "SELECT balance_minor, source FROM cash_positions WHERE tenant_id = $1 AND currency = $2",
    [tenantId, currency],
  );
  const flows = await q.query<{ week: number; amount_minor: number; description: string }>(
    "SELECT week, amount_minor, description FROM cash_flows WHERE tenant_id = $1 AND currency = $2 ORDER BY week",
    [tenantId, currency],
  );
  return {
    startingBalanceMinor: position?.balance_minor ?? 0,
    source: position?.source ?? "none",
    flows: flows.map((f) => ({ week: f.week, amountMinor: f.amount_minor, description: f.description })),
  };
}
