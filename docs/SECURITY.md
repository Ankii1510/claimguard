# Security

Threat model, mitigations, and responsible disclosure for ClaimGuard. This
is a research demo, not a production system - read this carefully before
relying on any verdict for a consequential decision.

## What ClaimGuard guarantees

A verdict (TRUE / FALSE / UNCERTAIN) on a claim means:

1. The contract fetched the cited web sources.
2. An LLM proposed a verdict based on the fetched content.
3. Multiple AI validators independently judged the proposal against
   explicit criteria and accepted it.
4. The verdict and reasoning are now public and immutable on-chain.

A verdict does **not** mean:

- The cited sources are accurate or unbiased.
- The LLM understood the claim correctly.
- The validators did not share a common blind spot.
- The verdict would still hold a week from now.

## What ClaimGuard does not guarantee

- **Truth in absolute terms.** Verdicts are best-effort judgments over
  the cited sources at the time of verification.
- **Liveness.** Sources may be unreachable, slow, or changed. Verification
  fails (`AI consensus did not return a verdict`) when sources are
  unreliable.
- **Calibrated confidence.** `confidence` is an LLM self-report (0-100),
  not a calibrated probability.
- **Censorship resistance.** Source governance can be captured by a
  motivated group (see [Threats](#threats)).

## Threats and mitigations

### 1. LLM hallucination

The LLM may invent facts that are not in the cited sources. Mitigations
already in place:

- Validators are run on the same LLM with explicit criteria requiring
  evidence-justified verdicts. An invented fact is likely to fail
  validation.
- The contract prompt explicitly forbids inventing facts and mandates
  UNCERTAIN when evidence is thin.
- We use `prompt_non_comparative`, which lets validators reject
  hallucinated responses by comparing to the criteria.

Not mitigated:

- All validators run on the same model family, so a model-wide hallucination
  would not be caught.
- Confabulations that sound plausible and reference real-looking URLs may
  pass validation.

### 2. Validator collusion

If a majority of validators collude, they can settle arbitrary verdicts.
Mitigations:

- GenLayer's consensus design rotates validators across transactions.
  Static collusion is harder than dynamic.
- The challenge path allows anyone with stake to force a re-verification.

Not mitigated:

- A validator majority could vote down an honest challenge.
- A persistent colluding majority can settle wrong verdicts consistently.

### 3. Source governance capture (Sybil attack)

Source reputation is one vote per address. An attacker who controls many
addresses can drive any domain's reputation negative, blocking all claims
that cite it, or positive, artificially legitimising it.

Mitigations:

- Switching your vote costs gas, so flipping many addresses repeatedly
  costs real value.
- `MIN_REPUTATION` is 0, so neutral sources are not blocked by default -
  capture is required to actively harm a domain.

Not mitigated:

- Cheap address generation on Studio testnet makes Sybil attacks
  trivial.
- There is no stake or economic cost to voting.
- There is no time decay or vote weighting.

Recommended hardening for production:

- Require stake to vote on sources.
- Weight votes by the voter's own reputation across other domains.
- Time-decay old votes so Sybil attacks decay naturally.

### 4. Source-quality gaming

A submitter who controls a domain can publish fabricated "evidence" that
looks authoritative. The LLM cannot tell the difference between a
legitimate Reuters article and a convincing forgery.

Mitigations:

- Community downvotes on the source domain reduce its reputation over
  time, eventually triggering the `MIN_REPUTATION` gate.
- The challenge path lets anyone with stake re-verify against
  counter-evidence.

Not mitigated:

- The first verifier may settle a verdict based on the forged source
  before the community has time to downvote it.
- Reputation damage is slow; a single bad verdict may already be on-chain.

### 5. Web page manipulation

Between submission and verification, an attacker who controls a cited
URL can replace its content. The LLM will then see attacker-controlled
text and may produce an attacker-favoured verdict.

Mitigations:

- Use sources with strong integrity guarantees (e.g. content-addressed
  archives like IPFS or Arweave). ClaimGuard does not enforce this.
- Cross-reference multiple independent sources.

Not mitigated:

- A submitter who controls the URL can time the attack.
- The contract cannot distinguish a captured page from a legitimate edit.

### 6. Stake griefing

A challenger can stake a minimum challenge repeatedly to force LLM costs
on the claim owner (who wants to defend). The stake economics:

- Challenger wins: refund + reward (stake * 2 back to challenger).
- Challenger loses: stake forfeited to claim owner.

So the challenger has skin in the game. But if stakes are small relative
to LLM costs, griefing is still profitable.

Not mitigated:

- No minimum stake beyond CHALLENGE_STAKE (10).
- The system does not refund LLM costs to the claim owner.

### 7. Reentrancy and reordering

The contract does not perform external calls (no `gl.message.call` or
similar), so classical reentrancy is not applicable. All state changes
happen synchronously within a single transaction.

### 8. Frontend / wallet phishing

The frontend is the usual attack surface: malicious browser extensions,
DNS hijacks, fake Studio URLs. Mitigations:

- Frontend is open source; review before connecting your wallet.
- Always verify the Studio URL in your browser address bar.
- Never sign transactions you do not understand.

### 9. JSON deserialization

The contract deserializes claim JSON from `self.claims.get(key)`. If an
attacker could write to `self.claims` (they cannot via the public API),
they could inject malformed JSON. Since `submit_claim` is the only path
that writes claim records, and it always serializes via
`_serialize_claim`, the risk is contained.

## Reporting vulnerabilities

If you find a security issue in ClaimGuard, please report it privately
before disclosing publicly:

- GitHub: open a draft security advisory at
  https://github.com/Ankii1510/claimguard/security/advisories/new
- Email: open an issue and request a private contact channel

Please include:

- A clear description of the issue
- Reproduction steps (test code, transaction hashes)
- Impact assessment (what an attacker could do)
- Suggested fix (if any)

We aim to acknowledge reports within 7 days and ship a fix or
mitigation within 30 days, depending on severity.

## Out of scope

The following are intentionally not security issues:

- LLM accuracy in absolute terms (see [LIMITATIONS.md](LIMITATIONS.md))
- Studio testnet resets (infrastructure-level, not contract-level)
- Gas costs being high (LLM consensus is expensive by design)
- Lack of a `withdraw_escrow` method (a missing feature, not a vuln)

## Audit status

ClaimGuard has not been audited by a third-party security firm. It is
research code that demonstrates the GenLayer Intelligent Contract
primitive. Do not use it for high-stakes decisions without your own
review.
