export const ACTION_TAG = { challenge: ["info", "Challenge"], accept: ["neutral", "Accept"], escalate: ["warn", "Needs a person"] } as const;

/** Final dispute outcomes get a color; everything in flight stays neutral. */
export const STATUS_TONE = (status: string) => (status === "WON" ? "good" : status === "LOST" ? "bad" : "neutral");
