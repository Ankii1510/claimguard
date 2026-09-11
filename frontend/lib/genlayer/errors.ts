/**
 * GenLayer/RPC-specific error classification for ClaimGuard.
 *
 * Ported (scoped down) from a sister GenLayer project (WorkResolve) that
 * hit these exact failure modes on a live deployment and had to work out
 * what they actually meant.
 */

/** EIP-1474 JSON-RPC error code -32001 ("Resource not found") / viem's
 * `ResourceNotFoundRpcError` (shortMessage: "Requested resource not
 * found."). This is the raw error GenLayer's node sends back for a
 * `gen_call`/write whose target contract address doesn't exist ON THE
 * NETWORK THE CLIENT IS TALKING TO. Two very different real causes produce
 * the exact same message:
 *   1. GenLayer Studio's testnet is periodically reset - every previously
 *      deployed contract (and its address) is wiped, so a contract
 *      address that used to work simply stops existing.
 *   2. `NEXT_PUBLIC_CONTRACT_ADDRESS` points at a contract that was
 *      deployed to a *different* GenLayer network than the one this app
 *      is configured to talk to (e.g. deployed while genlayer-cli was
 *      pointed at a different network than NEXT_PUBLIC_GENLAYER_RPC_URL).
 * Before this was recognized, it fell through to a generic error, showing
 * the raw viem message verbatim - confusing and not actionable. This
 * matcher checks both the RPC error code and the message text, since some
 * wallets re-wrap the original error and only preserve the text.
 */
const RESOURCE_NOT_FOUND_CODE = -32001;

export function isResourceNotFoundError(error: unknown): boolean {
  if (typeof error === "object" && error !== null) {
    const code = (error as { code?: unknown }).code;
    if (code === RESOURCE_NOT_FOUND_CODE) return true;
    const cause = (error as { cause?: unknown }).cause;
    if (cause && cause !== error && isResourceNotFoundError(cause)) return true;
  }
  const message = extractMessage(error) ?? "";
  return /requested resource not found|contract not found/i.test(message);
}

export function friendlyResourceNotFoundMessage(contractAddress: string): string {
  return (
    `Contract ${contractAddress} was not found on this GenLayer network. ` +
    "This almost always means GenLayer Studio's testnet was reset (it wipes " +
    "every deployed contract periodically), or the configured address belongs " +
    "to a different network. Redeploy contracts/claim_guard.py on Studio and " +
    "update NEXT_PUBLIC_CONTRACT_ADDRESS to the new address (see docs/DEPLOYMENT.md)."
  );
}

/** Thrown when a transaction was accepted and reached a terminal status, but
 * its execution actually failed (a `gl.vm.UserError` raised in the
 * contract, or validators failing to reach consensus) - as opposed to the
 * transaction never being submitted at all. Without this distinction, a
 * reverted submit_claim/verify_claim/challenge_claim/consume_verdict call
 * could resolve its promise "successfully" while having done nothing
 * on-chain, showing a false success toast. */
export class ContractRevertError extends Error {
  constructor(
    public readonly rawReason: string,
  ) {
    super(rawReason);
    this.name = "ContractRevertError";
  }
}

function extractMessage(error: unknown): string | undefined {
  if (!error) return undefined;
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (typeof error === "object") {
    const obj = error as { message?: unknown; shortMessage?: unknown };
    if (typeof obj.shortMessage === "string") return obj.shortMessage;
    if (typeof obj.message === "string") return obj.message;
  }
  return undefined;
}
