/** The wall clock, read once here at the edge and passed in: domain code never reads it. */
export const systemClock = { now: () => new Date() };
