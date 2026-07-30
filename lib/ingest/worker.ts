/**
 * Helpers for the self-chaining ingestion worker.
 *
 * A roll is processed one page per serverless invocation (Vercel Hobby caps
 * functions at ~60s). Each step, after saving its page, triggers the next step
 * by POSTing to /api/jobs/step. These helpers build that self-call and guard the
 * worker endpoint with a shared secret (steps run without a user session).
 */

export const WORKER_SECRET = process.env.INGEST_WORKER_SECRET ?? "";

/** Reconstruct this deployment's absolute origin from the incoming request. */
export function originFromHeaders(headers: Headers): string {
  const host = headers.get("x-forwarded-host") ?? headers.get("host") ?? "";
  const proto = headers.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}`;
}

export function workerAuthorized(headers: Headers): boolean {
  // Constant secret comparison is fine here — it's a deploy-internal token.
  return WORKER_SECRET.length > 0 && headers.get("x-worker-secret") === WORKER_SECRET;
}

/**
 * Fire the next step. Returns the fetch promise so the caller can hand it to
 * `after()` / `waitUntil()`, which keeps the invocation alive until the request
 * is actually sent (a bare fire-and-forget can be dropped when the lambda freezes).
 */
export function kickStep(origin: string, jobId: number): Promise<unknown> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-worker-secret": WORKER_SECRET,
  };
  // Every *.vercel.app deployment sits behind Vercel Deployment Protection (SSO),
  // which would bounce this server-to-server self-call to the login wall before
  // it reaches the handler. The automation bypass secret (auto-exposed as this
  // system env) lets an internal request through. Absent locally — harmless.
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (bypass) {
    headers["x-vercel-protection-bypass"] = bypass;
    headers["x-vercel-set-bypass-cookie"] = "false";
  }
  return fetch(`${origin}/api/jobs/step`, {
    method: "POST",
    headers,
    body: JSON.stringify({ jobId }),
    // Don't wait on the downstream response; we only need it dispatched.
    keepalive: true,
  }).catch((e) => {
    console.error("[worker] kickStep failed:", (e as Error).message);
  });
}
