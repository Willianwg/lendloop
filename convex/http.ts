// HTTP actions for n8n. All routes are HMAC-signed with N8N_TO_CONVEX_SECRET; see
// lib/httpSigned.ts. Bodies are validated with zod here; the idempotency rules live in automation.ts.
import { httpRouter } from "convex/server";
import { z } from "zod";
import { internal } from "./_generated/api";
import { isIsoDate, todayUtc } from "./lib/dates";
import { invalidBody, json, parseBody, signedRoute } from "./lib/httpSigned";

const id = z.string().min(1).max(200);
const resultStatus = z.enum(["sent", "failed"]);
const notFound = () => json(404, { error: "not_found" });

const http = httpRouter();

http.route({
  path: "/automation/notifications/claim",
  method: "POST",
  handler: signedRoute(async (ctx, body) => {
    const { eventId } = parseBody(z.object({ eventId: id }), body);
    const result = await ctx.runMutation(internal.automation.claimNotification, { eventId });
    if (!result.found) return notFound();
    return json(200, result.proceed ? { proceed: true } : { proceed: false, reason: result.reason });
  }),
});

http.route({
  path: "/automation/notifications/result",
  method: "POST",
  handler: signedRoute(async (ctx, body) => {
    const args = parseBody(z.object({ eventId: id, status: resultStatus, executionId: id }), body);
    const result = await ctx.runMutation(internal.automation.recordNotificationResult, args);
    return result.found ? json(200, { recorded: result.recorded }) : notFound();
  }),
});

http.route({
  path: "/automation/overdue-loans",
  method: "GET",
  handler: signedRoute(async (ctx) => {
    const today = todayUtc();
    const loans = await ctx.runQuery(internal.automation.overdueLoans, { today });
    return json(200, { today, loans });
  }),
});

http.route({
  path: "/automation/reminders",
  method: "POST",
  handler: signedRoute(async (ctx, body) => {
    const args = parseBody(
      z.object({ reminderKey: z.string().max(250), loanId: id, status: resultStatus, executionId: id }),
      body,
    );
    // The key must be exactly `${loanId}:${YYYY-MM-DD}`: one reminder per loan per day.
    const prefix = `${args.loanId}:`;
    const date = args.reminderKey.slice(prefix.length);
    if (!args.reminderKey.startsWith(prefix) || !isIsoDate(date)) invalidBody();
    const result = await ctx.runMutation(internal.automation.recordReminder, args);
    return result.found ? json(200, { recorded: result.recorded }) : notFound();
  }),
});

http.route({
  path: "/automation/errors",
  method: "POST",
  handler: signedRoute(async (ctx, body) => {
    const args = parseBody(
      z.object({
        workflowName: z.string().min(1).max(500),
        nodeName: z.string().max(500).optional(),
        executionId: id,
        message: z.string().max(10_000),
      }),
      body,
    );
    const result = await ctx.runMutation(internal.automation.recordWorkflowError, args);
    return json(200, result);
  }),
});

export default http;
