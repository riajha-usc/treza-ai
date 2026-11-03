/** Console times are shown in Pacific time, the hackathon's time zone, so server and browser agree. */
const ZONE = "America/Los_Angeles";

const clock = new Intl.DateTimeFormat("en-US", { timeZone: ZONE, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
const stamp = new Intl.DateTimeFormat("en-US", { timeZone: ZONE, month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const day = new Intl.DateTimeFormat("en-US", { timeZone: ZONE, month: "short", day: "numeric", year: "numeric" });

export const time = (iso: string | Date) => clock.format(new Date(iso));
export const dateTime = (iso: string | Date) => stamp.format(new Date(iso));
export const date = (iso: string | Date) => day.format(new Date(iso));
