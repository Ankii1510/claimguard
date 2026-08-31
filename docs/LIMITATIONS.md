# Limitations

An honest accounting of what ClaimGuard is and is not. This pairs with
[SECURITY.md](SECURITY.md) - that doc covers adversarial threats, this
one covers intrinsic limits of the design.

## Scope

ClaimGuard is a research demo of one idea: settle a verdict on a
natural-language claim via GenLayer's multi-validator AI consensus, with
on-chain source governance and a stake-based challenge path. It is not
a general-purpose fact-checking engine, oracle, or arbitration system.

## Known limits

### 1. LLM consensus is slow and expensive

Every `verify_claim` and `challenge_claim` call:

- Fetches every source URL via `gl.nondet.web.render` (each fetch is a
  nondet operation, runs on multiple validators).
- Runs an LLM on the fetched content.
- Runs validators until they accept the leader's proposal via
  `prompt_non_comparative`.

Realistic wall-clock time on Studio testnet: 20 to 60 seconds per
verification. Cost in testnet GEN: roughly proportional to source count
and validator rounds.

Implication: ClaimGuard is not suitable for high-throughput verification
of large claim backlogs. Each verdict is a deliberate, expensive
operation.

### 2. UNCERTAIN verdicts are common

When sources are thin, outdated, paywalled, or contradictory, the LLM
is trained to output UNCERTAIN. In practice this means:

- A claim with weak sources reliably returns UNCERTAIN.
- The challenge path can re-verify with new sources, but if no good
  sources exist, the verdict stays UNCERTAIN.
- UNCERTAIN is not a failure - it is the honest answer. But it means the
  contract is most useful for claims with strong public evidence, not
  for cutting-edge or niche topics.

### 3. Confidence scores are not calibrated

`confidence` (0-100) is whatever the LLM self-reports. We have not
calibrated these scores against historical accuracy. A confidence of 95
means "the LLM feels confident", not "this verdict is correct 95% of
the time".

Implication: do not aggregate confidence across verdicts as if it were
a probability. Use it as a coarse ordinal signal only.

### 4. Source reputation is per-domain, not per-article

`vote_source("reuters.com", True)` affects every article on reuters.com
the same way. A single bad article from a generally reliable source
does not damage the source's reputation, because reputation is on the
domain.

Implication: a domain can be a generally reliable source that
occasionally publishes a bad article, and the contract will treat the
bad article as equally authoritative.

### 5. One vote per address

No stake, no reputation weighting, no time decay. A determined attacker
can create many addresses (cheap on Studio) and swing any source's
reputation.

This is documented as a security issue in [SECURITY.md](SECURITY.md#3-source-governance-capture-sybil-attack).
It is also an intrinsic design choice: a full Sybil-resistant voting
system would require identity attestation or stake, neither of which
ClaimGuard has.

### 6. No escrow withdrawal

The contract tracks owed balances in `escrow` but does not include a
`withdraw_escrow` method. The accounting is correct, but the actual
transfer of value off the contract is not implemented.

This means today, escrow entries are mostly useful as a transparent
audit log, not as a way to move GEN between addresses. Adding
withdrawal is straightforward (one new write method) but out of scope
for the current demo.

### 7. The challenge path runs the LLM again

`challenge_claim` does not trust the original verdict - it re-runs the
entire verification flow with counter-evidence appended. This is the
right design (the LLM may have missed something the first time) but
it doubles the LLM cost.

Implication: do not challenge unless you have new evidence worth the
LLM spend.

### 8. No batching, no streaming

The contract verifies one claim per transaction. If you submit 100
claims, you pay 100x the LLM cost. There is no batched verification.

### 9. Web fetch failures abort the whole verification

If `gl.nondet.web.render` raises on any source, the contract captures
it as `"[ERROR] could not fetch this source"` and continues, but if the
LLM is then misled by the placeholder, the verdict may be wrong.

A more robust design would retry failed fetches, fall back to a cached
copy, or reject the claim until sources are reachable. ClaimGuard does
none of these.

### 10. Storage growth

`claims`, `votes`, `escrow`, `consumers`, `sources`, and `challenges`
all grow monotonically. There is no pruning. Eventually a busy
deployment will pay rent on a long tail of old records.

For a demo this is fine. For a production system you would need an
archival strategy.

### 11. Address case sensitivity

Composite keys (`<owner_hex>:<claim_id>`) preserve the case of
`Address.as_hex`. If your integration passes a different case (for
example, lowercased) you will get "Claim not found" even though the
claim exists.

The contract does not normalize on read. See [ARCHITECTURE.md](ARCHITECTURE.md#composite-keys)
for the rationale.

### 12. UNICODE and special characters

The contract does not sanitize claim text or counter-evidence for
control characters. A claim with embedded null bytes, RTL override
characters, or zero-width spaces will be stored and rendered as-is.
This is generally fine for honest users but could be used for display
spoofing in downstream UIs that render raw claim text.

### 13. Single-chain

ClaimGuard is deployed on GenLayer. There is no cross-chain
verification. A claim settled on GenLayer is not automatically
attested on Ethereum, Base, or anywhere else.

## What we would build next

In rough priority order:

1. **`withdraw_escrow`** - one new write method that actually transfers
   owed amounts out of the contract.
2. **Stake-weighted source voting** - require stake to vote, weight
   votes by the voter's reputation.
3. **Time-decayed reputation** - older votes count less.
4. **Batched verification** - verify N claims in one LLM call where
   the claims share sources.
5. **Calibrated confidence** - track historical accuracy per verdict
   category and rescale confidence against empirical base rates.
6. **Cross-chain attestation** - emit events that other chains can
   verify (EVM log, or a hash on IPFS).
7. **Appeal path** - allow a second challenge with a higher stake if
   the first challenge was upheld.
8. **Per-article reputation** - reputation on `(domain, article_hash)`
   instead of just `domain`.

## When not to use ClaimGuard

- For medical, legal, or financial decisions: no. Verdicts are LLM
  judgments over cited sources, not expert consensus.
- For real-time fact-checking: no. Verification is too slow (20-60s).
- For censorship-resistant truth: no. Source governance can be captured.
- As the sole arbiter of a dispute: no. The challenge path is a
  re-verification, not an appeal to a higher authority.

When ClaimGuard is a reasonable choice:

- Demonstrating the Intelligent Contract primitive
- Building a community-curated evidence registry
- Settling truth claims in low-stakes games or social products
- Research into AI consensus mechanics
