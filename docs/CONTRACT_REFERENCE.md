# Contract Reference

Full API reference for the ClaimGuard Intelligent Contract. Every method,
its kind (write / view / payable), parameters, return value, error cases,
and a usage example.

Source of truth: `contracts/claim_guard.py`. This document is regenerated
by hand when the contract changes.

## Conventions

- All string parameters are trimmed by the contract where it makes sense
  (empty string after strip is rejected).
- All address parameters use EIP-55 checksummed hex via `Address.as_hex`.
  Composite keys are case-sensitive on the owner/voter side and lowercase
  on the domain side.
- Numeric values use `u256` for storage counters and decimal `str` for
  monetary amounts (escrow, stake, fee). Conversion to `int` happens at
  call boundaries.
- Errors are raised via `gl.vm.UserError("...")` with a human-readable
  message. The SDK surfaces these as reverts.

## Source governance

### `vote_source(domain: str, reliable: bool) -> None`

- Kind: write
- Mutates: `sources`, `votes`

Vote a source domain up (reliable=True) or down (reliable=False). One vote
per address. Switching your previous vote (up to down or down to up) is
allowed - the old vote is undone before the new vote is applied.

Errors:

- `"Source domain cannot be empty"` - domain is whitespace or empty.

Example:

```python
contract.vote_source("reuters.com", True)   # upvote
contract.vote_source("reuters.com", False)  # switch to downvote
```

### `get_source(domain: str) -> dict`

- Kind: view

Returns:

```python
{
    "domain": "<domain>",
    "up_votes": "<decimal str>",
    "down_votes": "<decimal str>",
    "reputation": <int>,   # up - down
}
```

Unknown domains return `up_votes="0"`, `down_votes="0"`, `reputation=0`.

## Claim lifecycle

### `submit_claim(claim_text: str, source_urls: str) -> str`

- Kind: write
- Returns: new claim id as decimal string

Record a claim and its sources. The contract:

1. Trims claim_text, rejects if empty.
2. Splits source_urls on newlines, strips whitespace per line, drops empty
   lines. Requires at least MIN_SOURCES (1) URL.
3. Reduces each URL to its domain. Every domain must have reputation >=
   MIN_REPUTATION (0) or the submission is rejected.
4. Auto-creates `Source` entries for any domains that don't exist yet
   (reputation starts at 0).
5. Increments `claim_count`, returns the new id as a string.

Errors:

- `"Claim text cannot be empty"`
- `"At least one source is required"`
- `"Source rejected by community governance: <domain>"`

Example:

```python
claim_id = contract.submit_claim(
    "Ethereum moved to proof-of-stake in 2022.",
    "https://ethereum.org/en/roadmap/merge/\nhttps://example.com/pos-explainer",
)
```

### `verify_claim(claim_id: str) -> None`

- Kind: write
- Mutates: `claims`

Fetch the claim's source URLs, run an LLM to judge the claim TRUE / FALSE /
UNCERTAIN, and settle via GenLayer AI consensus (multi-validator).

Errors:

- `"Claim not found"` - claim_id does not exist for this caller.
- `"Claim already verified"` - has_resolved is already True.
- `"AI consensus did not return a verdict. Validators did not accept the
  leader's response. Try again with more reliable sources."` - validators
  rejected the proposed verdict. Common when sources are slow or
  unreachable.

Example:

```python
contract.verify_claim(claim_id)
```

### `get_claim_count() -> int`

- Kind: view

Total claims submitted across all owners.

### `get_claims() -> dict`

- Kind: view

Returns:

```python
{
    "<owner_hex>": {
        "<claim_id>": {
            "id": "<claim_id>",
            "text": "<claim_text>",
            "source_urls": "<newline-joined>",
            "verdict": "TRUE" | "FALSE" | "UNCERTAIN" | "",
            "confidence": "<decimal str>",
            "reasoning": "<short sentence>",
            "has_resolved": <bool>,
            "challenge_status": "none" | "overturned" | "upheld",
            "challenged_by": "<hex address or empty>",
        },
        ...
    },
    ...
}
```

## Challenge path

### `challenge_claim(claim_id: str, counter_evidence: str) -> str`

- Kind: write, payable
- Returns: new challenge id as decimal string
- Stake: must be at least CHALLENGE_STAKE (10)

Contest a settled verdict by staking value. The contract:

1. Finds the claim by id across all owners.
2. Rejects if not resolved or if already challenged.
3. Re-runs verification with the original sources plus counter_evidence
   appended.
4. If the new verdict differs from the old, the verdict is corrected
   (`challenge_status = "overturned"`) and the challenger is credited
   `stake * 2` in escrow.
5. If the new verdict matches the old, the verdict stays
   (`challenge_status = "upheld"`) and the stake is forfeited to the
   claim owner.
6. A `Challenge` record is written for audit.

Errors:

- `"Insufficient stake to challenge"` - value < CHALLENGE_STAKE.
- `"Claim not found"`
- `"Claim is not resolved yet"`
- `"Claim already challenged"`

Example:

```python
contract.challenge_claim(
    claim_id=claim_id,
    counter_evidence="https://example.com/contradicting-evidence",
)
```

### `get_challenges() -> dict`

- Kind: view

Returns `{challenge_id: {id, claim_id, challenger, counter_evidence,
stake, outcome, resolved}}`. Outcome is `"won"` or `"lost"`.

## Consequential consume

### `consume_verdict(claim_id: str) -> dict`

- Kind: write, payable
- Fee: must be at least CONSUME_FEE (1)

Consume a settled verdict in a downstream workflow. The contract:

1. Credits the consume fee to the claim owner's escrow.
2. Appends the consumer's address to the consumer list for that claim
   (no duplicates).
3. Returns the verdict.

Errors:

- `"Insufficient fee to consume verdict"`
- `"Claim not found"`
- `"Verdict not settled yet"`

Returns:

```python
{
    "claim_id": "<claim_id>",
    "verdict": "TRUE" | "FALSE" | "UNCERTAIN",
    "confidence": "<decimal str>",
    "reasoning": "<short sentence>",
}
```

### `get_consumers(claim_id: str) -> list`

- Kind: view

List of hex addresses that have consumed this verdict. Empty list if
never consumed.

### `get_escrow(addr_hex: str) -> int`

- Kind: view

Claimable balance for an address. Includes consume fees credited (if you
are a claim owner) and forfeited challenge stakes (if a challenger lost
against your claim). Returns 0 for unknown addresses.

Note: there is no `withdraw_escrow` method in the current contract - see
[LIMITATIONS.md](LIMITATIONS.md).

## Events

The contract does not emit named events. All state changes are readable
via the view methods. If you need to react to specific transitions
(a claim verified, a challenge filed, a verdict consumed), poll the
relevant view and diff.

## Cost considerations

- `submit_claim`: small write, no LLM cost. Gas roughly proportional to
  number of source URLs (each one creates a `Source` record if new).
- `verify_claim`: LLM consensus cost. The contract fetches every source
  URL via `gl.nondet.web.render`, runs an LLM, and runs validators until
  they accept the verdict. This is the most expensive operation.
- `challenge_claim`: same LLM cost as verify_claim plus the stake
  accounting.
- `consume_verdict`: small write, no LLM cost.

The LLM consensus is multi-validator by design, so verify and challenge
are intentionally slow (tens of seconds) and expensive. Treat them as
deliberate, consequential operations - not as cheap RPCs.

## Composite key gotchas

If you are integrating with this contract directly:

1. Claim keys are `"<owner_hex>:<claim_id>"` and case-sensitive on owner.
   Use the exact `Address.as_hex` value from your caller.
2. Vote keys are `"<domain>:<voter_hex>"` with domain lowercased.
3. The `_find_claim` helper walks `claims.keys()` looking for `:<id>`
   suffix. This is O(n) over all claims - fine for a demo, not for
   scale.

See [ARCHITECTURE.md](ARCHITECTURE.md#storage-layout) for the full
storage model.
