/**
 * Stages the three Kit 04 demo disputes in your Airwallex sandbox and lets
 * the dispute agent handle them. Sandbox only: no real money moves.
 *
 *   node --env-file=.env --import tsx scripts/stage-disputes.mts
 */
import { getApp } from "../src/lib/app";
import { stageDemoDisputes } from "../src/lib/disputes/pipeline";

const { disputes, db } = await getApp();
for (const line of await stageDemoDisputes(disputes)) console.log(line);
await db.close();
