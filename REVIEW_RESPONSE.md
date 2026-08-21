# ClaimGuard - Review Response

Thanks for the review. The feedback is fair: the first version let a claimant
pick their own evidence set with no quality checks and gave settled verdicts no
consequences. That gap is now closed. Three new mechanisms are live in the
contract (https://github.com/Ankii1510/claimguard):

## 1. Transparent source governance
- Every source domain now has on-chain reputation, built from community
  up/down votes via `vote_source(domain, reliable)` (one vote per address).
- `submit_claim` is gated: a claim whose sources carry negative reputation is
  rejected before any verdict is computed.
- `get_source(domain)` exposes each domain's vote tallies and net reputation.

## 2. Challenge path
- Any independent party can contest a settled verdict by staking value through
  `challenge_claim(claim_id, counter_evidence)`.
- The contract re-runs verification against the original sources plus the
  challenger's counter-evidence, under the same equivalence-principle consensus.
- If the verdict changes, the record is corrected and the challenger is
  rewarded; if it is upheld, the challenger's stake is forfeited to the claim
  owner. Every challenge is auditable via `get_challenges()`.

## 3. Consequential consumption
- Downstream parties consume settled verdicts through `consume_verdict(claim_id)`,
  paying a fee that is credited to the claim owner.
- Each consumption is recorded on-chain (`get_consumers(claim_id)`), and accrued
  balances are claimable (`get_escrow(address)`), so a verified verdict now
  carries real economic weight in a downstream workflow.

## Verification
- `genvm-lint check contracts/claim_guard.py` passes.
- Direct-mode test suite: 46 passing (18 ClaimGuard tests covering submission,
  verification, source-governance rejection, challenge overturn/uphold, stake
  forfeiture, and consumption fees).
