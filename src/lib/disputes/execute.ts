import { AirwallexError } from "../airwallex/client";
import { onceForOperation } from "../airwallex/idempotency";
import { requestApproval, resolveApproval } from "../approvals/approvals";
import { recordDecision } from "../audit/audit";
import type { Db } from "../db/client";
import { PLATFORM_ACCOUNTS } from "../ledger/accounts";
import { postEntry } from "../ledger/ledger";
import { format } from "../money/money";
import { PLATFORM_TENANT_ID } from "../tenancy";
import { getDispute, type DisputeDecision, type DisputeDeps } from "./agent";
import { DEFAULT_DISPUTE_POLICY } from "./assess";
import { buildEvidencePdf } from "./packet";
import { availableDocuments, getOrder, orderSummary } from "./records";

/** Books a cost of a dispute against the platform's cash, exactly once. */
export async function book(db: Db, key: string, account: { code: string; type: "expense" }, minor: number, currency: string, description: string) {
  if (minor <= 0) return;
  await postEntry(db, {
    idempotencyKey: key,
    kind: "dispute",
    description,
    lines: [
      { tenantId: PLATFORM_TENANT_ID, account, amountMinor: minor, currency },
      { tenantId: PLATFORM_TENANT_ID, account: PLATFORM_ACCOUNTS.cash, amountMinor: -minor, currency },
    ],
  });
}

