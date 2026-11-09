import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Re-sends outbox rows that a crash left in `pending` (see delivery.sweepStuck).
crons.interval("retry stuck loan-event deliveries", { minutes: 5 }, internal.delivery.sweepStuck, {});

export default crons;
