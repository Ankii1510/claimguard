# FAQ

Common questions about ClaimGuard. If your question is not here, open an
issue on GitHub.

## What does ClaimGuard actually do?

ClaimGuard lets anyone submit a natural-language claim plus web sources,
then settles a verdict (TRUE / FALSE / UNCERTAIN) via multi-validator AI
consensus on GenLayer. The verdict, confidence score, and reasoning are
recorded on-chain and can be challenged by staking value or consumed by
downstream parties by paying a fee.

In one line: an on-chain, stake-secured, AI-judged fact registry.

## How is this different from a fact-checking API?

A fact-checking API gives you an answer. ClaimGuard gives you an answer
plus:

- **Immutability** - the verdict is on-chain, cannot be retroactively
  edited, and is publicly auditable.
- **Consensus** - multiple AI validators independently judged the
  proposal against explicit criteria.
- **Source governance** - domains have on-chain reputation built from
  community votes. A claim with a negatively-reputed source is rejected.
- **Challenge path** - anyone with stake can force a re-verification
  with new evidence.
- **Consequential consumption** - downstream parties can pay to read a
  verdict, and that payment flows to the claim owner.

None of these are impossible with traditional infrastructure, but
together they require a blockchain-level settlement layer.

## What happens if two AI validators disagree?

The contract uses `gl.eq_principle.prompt_non_comparative`, which works
like this:

1. A leader validator proposes an answer.
2. Other validators independently judge the proposal against written
   criteria.
3. If validators accept the proposal (vote "this matches the criteria"),
   consensus is reached and the answer is committed.

If the leader's answer is wrong, validators can reject it by voting
"this does not match the criteria". The transaction then fails with
`Undetermined` and the user can retry.

The alternative, `gl.eq_principle.strict_eq`, requires validators to
produce byte-identical output. This is wrong for LLM calls because LLM
outputs are non-deterministic even at temperature 0. We use
`prompt_non_comparative` specifically to avoid the false failure mode
where two slightly-different-but-equally-correct JSON responses cause
an `Undetermined` revert.

See [ARCHITECTURE.md](ARCHITECTURE.md#consensus-why-prompt_non_comparative-not-strict_eq)
for the full rationale.

## Can a verdict be changed?

Yes, by `challenge_claim` with stake. The challenge path:

1. Requires a stake of at least CHALLENGE_STAKE (10 units).
2. Re-runs verification with the original sources plus the
   challenger's counter-evidence.
3. If the new verdict differs from the old, the verdict is corrected
   (`overturned`) and the challenger is refunded stake + an equal reward.
4. If the new verdict matches the old, the challenge is `upheld` and
   the stake is forfeited to the claim owner.

A claim can be challenged at most once (`challenge_status` moves from
`"none"` to either `"overturned"` or `"upheld"`).

## How do fees flow?

There are two value flows:

1. **Consume fee** - when a downstream party calls `consume_verdict`,
   they pay CONSUME_FEE (1 unit). This is credited to the claim owner
   via the escrow map.
2. **Forfeited challenge stake** - if a challenger loses (verdict
   unchanged), their stake is forfeited to the claim owner via the
   escrow map.

The contract does not include a `withdraw_escrow` method, so the
balance is tracked but not actually transferred off the contract. See
[LIMITATIONS.md](LIMITATIONS.md#6-no-escrow-withdrawal).

## Is this production-ready?

No. ClaimGuard is a research demo. It demonstrates the Intelligent
Contract primitive but does not include:

- A withdrawal method for escrow balances
- Sybil-resistant source voting
- Calibrated confidence scores
- An appeals path beyond a single challenge
- Third-party security audit
- Stress testing at scale

For high-stakes decisions (medical, legal, financial), do not rely on
any ClaimGuard verdict without your own review.

## How can I add my own source governance rules?

The current governance rules are:

- One vote per address.
- Vote up or down, can switch.
- Reputation is `up_votes - down_votes`.
- A claim is rejected if any source has reputation below
  `MIN_REPUTATION` (currently 0).

The constants `MIN_SOURCES`, `MIN_REPUTATION`, `CHALLENGE_STAKE`, and
`CONSUME_FEE` are at the top of `contracts/claim_guard.py`. You can:

- **Tune the thresholds** - raise MIN_REPUTATION to require positive
  reputation, raise CHALLENGE_STAKE to make challenges more expensive.
- **Add stake to voting** - modify `vote_source` to require a payable
  stake that is slashed if the vote is reverted quickly.
- **Time-decay reputation** - store a timestamp with each vote and
  weight by age.

For more ambitious changes (cross-domain reputation, delegation, etc.),
fork the contract and design a new storage layout. The flattened
`TreeMap[str, str]` with JSON encoding is a good starting pattern but
will need adaptation for richer queries.

## Why GenLayer and not Ethereum?

Ethereum contracts cannot read web pages or call LLMs. To get an
"AI-judged fact-checking oracle" on Ethereum, you would need:

1. An off-chain oracle to fetch sources and run the LLM.
2. A mechanism for the on-chain contract to trust the oracle (signing,
   slashing, reputation, etc).
3. Some way to settle disagreements (challenge period, multi-oracle
   consensus).

GenLayer's Intelligent Contracts can do steps 1 and 2 natively. The
contract fetches sources, calls the LLM, and settles via multi-validator
AI consensus all in a single on-chain transaction. This collapses the
"oracle problem" for fact-checking into the contract itself.

The trade-off is that you inherit GenLayer's consensus model. If that
model does not fit your use case (you want cryptographic certainty,
not AI judgment), GenLayer is the wrong tool.

## Where can I see it running?

- Live contract: `0x32b9C530822E4D8Da5918B9A431b625066B03d6D` on
  GenLayer Studio
- Live frontend: https://claimguard-frontend.vercel.app/

Both are demo deployments. The Studio testnet is periodically reset.

## How do I report a bug or suggest a feature?

- Bugs and security issues: see [SECURITY.md](SECURITY.md#reporting-vulnerabilities)
- Feature requests: open an issue on GitHub
- General questions: GitHub Discussions

## What's the license?

MIT. See [LICENSE](../LICENSE) for the full text.
