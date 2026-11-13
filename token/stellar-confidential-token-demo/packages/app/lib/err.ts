import { humanizeContractError, parseContractErrorCode } from "stellar-confidential-token-sdk";

/**
 * Overrides for SDK messages that assume a configuration the demo doesn't
 * always have. The SDK words 3602 for an allowlist, but a blocklist token
 * refuses with the same code.
 */
const OVERRIDES: Record<number, string> = {
  3602:
    "This account is not permitted by the token's compliance policy. Ask the policy's manager to allow (or unblock) it.",
};

/** Best-effort extraction of a raw message string from any thrown value. */
function rawMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  if (e && typeof e === "object") {
    const o = e as { message?: unknown; code?: unknown };
    if (typeof o.message === "string") {
      return o.code !== undefined ? `${o.message} (code ${String(o.code)})` : o.message;
    }
    try {
      return JSON.stringify(e);
    } catch {
      /* fall through to String() */
    }
  }
  return String(e);
}

/**
 * Render an unknown thrown value as a human-readable string.
 *
 * Not everything thrown is an `Error`. The Stellar SDK's JSON-RPC client throws
 * the raw JSON-RPC error object (`throw response.data.error`), i.e. a plain
 * `{ code, message }` — `String(e)` on that yields the useless "[object
 * Object]". This unwraps the common shapes (Error, `{ message }`,
 * `{ code, message }`) so RPC failures surface their actual message.
 *
 * When the message carries an on-chain contract error (`Error(Contract, #NNNN)`,
 * e.g. a frozen account or insufficient authorization), it is replaced with a
 * plain-language explanation instead of the raw HostError + diagnostic dump.
 */
export function errMsg(e: unknown): string {
  const raw = rawMessage(e);
  const code = parseContractErrorCode(raw);
  return (code !== null ? OVERRIDES[code] : undefined) ?? humanizeContractError(raw) ?? raw;
}
