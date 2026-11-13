/**
 * Confidential-key derivation from a wallet signature, per stellar-confidential
 * docs/sdk/key-derivation.md (signer roots).
 *
 * The root is a SEP-53 signature over `skSigningMessage(token, account)`, and
 * the SDK's `deriveSk` turns it into `sk`. Every conformant client derives the
 * same `sk` for the same (token, account), so the account is recoverable from
 * the Freighter key alone, on any device.
 *
 * The SDK leaves the signer-side obligations to its caller; they live here:
 *   - verify the signature against the account's ed25519 key. A Freighter with
 *     a different account selected would otherwise yield a wrong but usable
 *     `sk`. This also proves Freighter signed the SEP-53 payload;
 *   - obtain it twice and compare, to catch a non-deterministic signer;
 *   - never persist the root. It is equivalent to `sk`. The caller caches `sk`.
 */

import { Keypair } from "@stellar/stellar-sdk";
import { deriveSk, sep53Payload, skSigningMessage } from "stellar-confidential-token-sdk";

import type { MessageSigner } from "./freighter";

/** Derive this account's `sk` on `token` from two Freighter signatures. */
export async function deriveSignerRootSk(
  signer: MessageSigner,
  token: string,
  log: (msg: string) => void,
): Promise<bigint> {
  const account = signer.publicKey;
  const message = skSigningMessage(token, account);
  // Printable ASCII apart from its two `\n` separators, so the string Freighter
  // signs is byte-identical to `message`.
  const text = new TextDecoder().decode(message);
  const payload = sep53Payload(message);
  const key = Keypair.fromPublicKey(account);

  const roots: Uint8Array[] = [];
  for (const attempt of ["first", "second"]) {
    log(`sign the key-derivation message in Freighter (${attempt} of 2)…`);
    const root = await signer.signMessage(text);
    // Typed as Buffer, but stellar-base copies both through its own Buffer;
    // the global one does not exist in the browser bundle.
    if (!key.verify(payload as Buffer, root as Buffer)) {
      throw new Error(
        `Freighter's signature does not verify against ${account}'s key over the SEP-53 payload, so no key was derived`,
      );
    }
    roots.push(root);
  }
  if (!bytesEqual(roots[0]!, roots[1]!)) {
    throw new Error(
      "Freighter returned two different signatures for the same message. Keys derived from a non-deterministic signer cannot be recovered later, so none was derived",
    );
  }
  return deriveSk(roots[0]!, token, account).sk;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}
