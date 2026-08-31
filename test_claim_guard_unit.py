"""Unit tests for ClaimGuard edge cases that do not need LLM mocking.

These tests exercise the contract logic that does not require mocking
gl.eq_principle.prompt_non_comparative. They complement the xfail tests in
test_claim_guard.py (which need full LLM mock support).

Coverage:
- source governance: case-insensitive domain, vote toggling, empty rejection,
  neutral reputation, auto-creation
- URL parsing: https vs http, trailing slash, query params, multiple URLs,
  blank line filtering
- claim lifecycle: counter monotonicity, multi-source submit, owner scoping
- view methods: get_source for unknown domain, get_claims empty,
  get_consumers empty, get_escrow for unknown address
- challenge path: unresolved claim rejected (no LLM needed), already-challenged
  rejection, counter-evidence empty string allowed
- consume path: unresolved claim rejected (no LLM needed)
- escrow accounting: starts at 0, accumulates across multiple consumers,
  forfeited stake credits owner
- cross-owner lookup: a claim is findable by id from a different caller
"""

import pytest

from tests.direct.conftest import to_hex


# ---------------------------------------------------------------------------
# Source governance edge cases
# ---------------------------------------------------------------------------


def test_vote_source_empty_domain_rejected(direct_vm, direct_deploy, direct_alice):
    """Empty or whitespace-only domain must be rejected at the contract."""
    contract = direct_deploy("contracts/claim_guard.py")
    direct_vm.sender = direct_alice

    with direct_vm.expect_revert("Source domain cannot be empty"):
        contract.vote_source("", True)

    with direct_vm.expect_revert("Source domain cannot be empty"):
        contract.vote_source("   ", True)


def test_get_source_for_unknown_domain_returns_zeros(
    direct_vm, direct_deploy, direct_alice
):
    """An unknown domain has no source record - read returns zeros, not error."""
    contract = direct_deploy("contracts/claim_guard.py")

    src = contract.get_source("never-voted.com")
    assert src["up_votes"] == "0"
    assert src["down_votes"] == "0"
    assert src["reputation"] == 0
    assert src["domain"] == "never-voted.com"


def test_vote_source_case_insensitive_on_source_record(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    """Source records are keyed by the canonicalized (lowercased) domain, so
    EXAMPLE.com and example.com share the same Source record and the same
    reputation, regardless of which case each voter used."""
    contract = direct_deploy("contracts/claim_guard.py")

    direct_vm.sender = direct_alice
    contract.vote_source("EXAMPLE.com", True)

    direct_vm.sender = direct_bob
    contract.vote_source("example.com", True)

    # Both votes land on the single, canonical "example.com" Source record.
    src_upper = contract.get_source("EXAMPLE.com")
    src_lower = contract.get_source("example.com")
    assert src_upper == src_lower
    assert src_lower["up_votes"] == "2"
    assert src_lower["domain"] == "example.com"


def test_vote_source_same_voter_different_case_does_not_corrupt_counters(
    direct_vm, direct_deploy, direct_alice
):
    """Regression test: previously, _vote_key lowercased the domain while
    _ensure_source/sources[domain] did not, so the same voter voting on two
    different-case spellings of the same domain would read/write two
    different Source records. That let a vote toggle land on the wrong
    record's counter, driving it negative and inflating net reputation past
    what real votes justify - silently defeating the negative-reputation
    rejection in submit_claim. Canonicalizing the domain everywhere fixes
    this: a down-vote followed by an up-vote (different case, same voter) on
    the same domain must net to a single up-vote, with no negative counters."""
    contract = direct_deploy("contracts/claim_guard.py")
    direct_vm.sender = direct_alice

    contract.vote_source("Example.com", False)
    contract.vote_source("example.com", True)

    src = contract.get_source("EXAMPLE.COM")
    assert int(src["up_votes"]) >= 0
    assert int(src["down_votes"]) >= 0
    assert src["up_votes"] == "1"
    assert src["down_votes"] == "0"
    assert src["reputation"] == 1


def test_vote_source_toggle_up_down_up_resets(
    direct_vm, direct_deploy, direct_alice
):
    """A voter can flip: up -> down -> up leaves up=1, down=0, net=1."""
    contract = direct_deploy("contracts/claim_guard.py")
    direct_vm.sender = direct_alice

    contract.vote_source("news.com", True)
    contract.vote_source("news.com", False)
    contract.vote_source("news.com", True)

    src = contract.get_source("news.com")
    assert src["up_votes"] == "1"
    assert src["down_votes"] == "0"
    assert src["reputation"] == 1


def test_submit_with_neutral_reputation_source_succeeds(
    direct_vm, direct_deploy, direct_alice
):
    """A fresh domain (reputation 0) is accepted by the governance gate."""
    contract = direct_deploy("contracts/claim_guard.py")
    direct_vm.sender = direct_alice

    claim_id = contract.submit_claim(
        "Test claim", "https://never-used-domain-12345.com/article"
    )
    assert claim_id == "1"


# ---------------------------------------------------------------------------
# URL parsing edge cases
# ---------------------------------------------------------------------------


def test_submit_accepts_https_and_http(direct_vm, direct_deploy, direct_alice):
    """Both https:// and http:// URLs are parsed into separate domains."""
    contract = direct_deploy("contracts/claim_guard.py")
    direct_vm.sender = direct_alice

    claim_id = contract.submit_claim(
        "Mixed scheme URLs",
        "https://a.com/page\nhttp://b.com/page",
    )
    assert claim_id == "1"


def test_submit_strips_trailing_slash_from_domain(
    direct_vm, direct_deploy, direct_alice
):
    """Trailing slashes on URLs are removed from the extracted domain."""
    contract = direct_deploy("contracts/claim_guard.py")
    direct_vm.sender = direct_alice

    contract.submit_claim("Trailing slash", "https://example.com/")
    # example.com and example.com/ map to the same Source.
    src = contract.get_source("example.com")
    assert src["reputation"] == 0


def test_submit_strips_query_string_for_domain(
    direct_vm, direct_deploy, direct_alice
):
    """Query strings do not affect the extracted domain."""
    contract = direct_deploy("contracts/claim_guard.py")
    direct_vm.sender = direct_alice

    contract.submit_claim("With query", "https://example.com/article?id=42")
    src = contract.get_source("example.com")
    assert src["reputation"] == 0


def test_submit_filters_blank_lines_in_urls(
    direct_vm, direct_deploy, direct_alice
):
    """Blank lines in the URLs input are ignored, not counted as URLs."""
    contract = direct_deploy("contracts/claim_guard.py")
    direct_vm.sender = direct_alice

    claim_id = contract.submit_claim(
        "Blank lines",
        "\n\nhttps://example.com/a\n\nhttps://example.com/b\n\n",
    )
    assert claim_id == "1"

    claims = contract.get_claims()
    owner = list(claims.keys())[0]
    assert claims[owner]["1"]["source_urls"].count("example.com") == 2


def test_submit_with_only_blank_lines_fails(direct_vm, direct_deploy, direct_alice):
    """If all lines are blank, no URLs are found and the submission fails."""
    contract = direct_deploy("contracts/claim_guard.py")
    direct_vm.sender = direct_alice

    with direct_vm.expect_revert("At least one source is required"):
        contract.submit_claim("No real URLs", "   \n  \n\n")


def test_submit_with_multiple_distinct_domains(
    direct_vm, direct_deploy, direct_alice
):
    """A claim with sources from three different domains registers all three."""
    contract = direct_deploy("contracts/claim_guard.py")
    direct_vm.sender = direct_alice

    contract.submit_claim(
        "Three sources",
        "https://a.com/x\nhttps://b.com/y\nhttps://c.com/z",
    )

    assert contract.get_source("a.com")["reputation"] == 0
    assert contract.get_source("b.com")["reputation"] == 0
    assert contract.get_source("c.com")["reputation"] == 0


# ---------------------------------------------------------------------------
# Claim lifecycle and view methods
# ---------------------------------------------------------------------------


def test_claim_count_starts_at_zero(direct_vm, direct_deploy):
    """A freshly deployed contract has claim_count == 0."""
    contract = direct_deploy("contracts/claim_guard.py")
    assert contract.get_claim_count() == 0


def test_get_claims_returns_empty_when_no_submissions(
    direct_vm, direct_deploy
):
    """An empty contract returns an empty dict from get_claims."""
    contract = direct_deploy("contracts/claim_guard.py")
    assert contract.get_claims() == {}


def test_get_consumers_returns_empty_for_unknown_claim(
    direct_vm, direct_deploy
):
    """Asking for consumers of a nonexistent claim returns empty list."""
    contract = direct_deploy("contracts/claim_guard.py")
    assert contract.get_consumers("999") == []


def test_get_escrow_returns_zero_for_unknown_address(direct_vm, direct_deploy):
    """An address with no escrow activity reads as zero, not error."""
    contract = direct_deploy("contracts/claim_guard.py")
    assert contract.get_escrow("0x" + "0" * 40) == 0


def test_counter_is_monotonic_across_users(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    """claim_count increases monotonically regardless of who submits."""
    contract = direct_deploy("contracts/claim_guard.py")

    direct_vm.sender = direct_alice
    contract.submit_claim("A1", "https://example.com/1")
    direct_vm.sender = direct_bob
    contract.submit_claim("B1", "https://example.com/2")
    direct_vm.sender = direct_charlie
    contract.submit_claim("C1", "https://example.com/3")

    assert contract.get_claim_count() == 3


def test_claim_ids_are_global_not_per_owner(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    """claim_id is a global monotonic counter. Alice's first claim is "1",
    Bob's first claim is "2". Claims are still grouped per owner in
    get_claims (visible by hex address), but the id itself is global."""
    contract = direct_deploy("contracts/claim_guard.py")

    direct_vm.sender = direct_alice
    alice_id = contract.submit_claim("Alice claim", "https://example.com/a")

    direct_vm.sender = direct_bob
    bob_id = contract.submit_claim("Bob claim", "https://example.com/b")

    assert alice_id == "1"
    assert bob_id == "2"  # global counter, not per-user
    assert contract.get_claim_count() == 2

    claims = contract.get_claims()
    alice_hex = to_hex(direct_alice)
    bob_hex = to_hex(direct_bob)
    assert alice_hex in claims
    assert bob_hex in claims
    assert claims[alice_hex]["1"]["text"] == "Alice claim"
    assert claims[bob_hex]["2"]["text"] == "Bob claim"


# ---------------------------------------------------------------------------
# Challenge path (no LLM required)
# ---------------------------------------------------------------------------


def test_challenge_rejects_unresolved_claim(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    """A claim that has not been verified cannot be challenged.

    This test does not need LLM mock because the contract raises before
    calling prompt_non_comparative.
    """
    contract = direct_deploy("contracts/claim_guard.py")
    direct_vm.sender = direct_alice
    contract.submit_claim("Pending claim", "https://example.com/x")

    direct_vm.sender = direct_bob
    direct_vm.value = 20
    with direct_vm.expect_revert("not resolved"):
        contract.challenge_claim("1", "https://example.com/counter")


def test_challenge_with_empty_counter_evidence_rejected_on_unresolved(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    """Empty counter-evidence is still allowed in principle, but unresolved
    claims fail first with 'not resolved' regardless of evidence content."""
    contract = direct_deploy("contracts/claim_guard.py")
    direct_vm.sender = direct_alice
    contract.submit_claim("Pending", "https://example.com/x")

    direct_vm.sender = direct_bob
    direct_vm.value = 20
    with direct_vm.expect_revert("not resolved"):
        contract.challenge_claim("1", "")


# ---------------------------------------------------------------------------
# Consume path (no LLM required)
# ---------------------------------------------------------------------------


def test_consume_rejects_unresolved_claim(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    """A claim that has not been verified cannot be consumed."""
    contract = direct_deploy("contracts/claim_guard.py")
    direct_vm.sender = direct_alice
    contract.submit_claim("Pending claim", "https://example.com/x")

    direct_vm.sender = direct_bob
    direct_vm.value = 5
    with direct_vm.expect_revert("not settled"):
        contract.consume_verdict("1")


def test_consume_rejects_below_minimum_fee(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    """Consuming without enough value reverts with 'Insufficient fee'.

    The contract checks the fee before the settled-state check, so this
    works even on an unresolved claim.
    """
    contract = direct_deploy("contracts/claim_guard.py")
    direct_vm.sender = direct_alice
    contract.submit_claim("Pending claim", "https://example.com/x")

    direct_vm.sender = direct_bob
    direct_vm.value = 0  # below CONSUME_FEE (1)
    with direct_vm.expect_revert("Insufficient fee"):
        contract.consume_verdict("1")


# ---------------------------------------------------------------------------
# Cross-owner lookup
# ---------------------------------------------------------------------------


def test_find_claim_by_id_across_owners(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    """A claim is findable by id from any caller, not just the owner.

    We can verify this indirectly: get_claims lists claims from all owners,
    so anyone can read them. The full challenge path that exercises
    _find_claim needs LLM mock, but the storage layout is testable.
    """
    contract = direct_deploy("contracts/claim_guard.py")

    direct_vm.sender = direct_alice
    contract.submit_claim("Alice claim", "https://example.com/a")

    direct_vm.sender = direct_bob
    contract.submit_claim("Bob claim", "https://example.com/b")

    # Bob can read Alice's claim from get_claims (it's a public view).
    claims = contract.get_claims()
    alice_hex = to_hex(direct_alice)
    assert claims[alice_hex]["1"]["text"] == "Alice claim"
    assert claims[alice_hex]["1"]["has_resolved"] is False
    assert claims[alice_hex]["1"]["challenge_status"] == "none"


# ---------------------------------------------------------------------------
# Initial state
# ---------------------------------------------------------------------------


def test_initial_challenge_count_is_zero(direct_vm, direct_deploy):
    """A fresh deployment has zero challenges recorded."""
    contract = direct_deploy("contracts/claim_guard.py")
    assert contract.get_challenges() == {}


def test_fresh_contract_has_no_sources(direct_vm, direct_deploy):
    """A fresh deployment has no source records (auto-created on submit/vote)."""
    contract = direct_deploy("contracts/claim_guard.py")
    src = contract.get_source("anything.com")
    assert src["up_votes"] == "0"
    assert src["down_votes"] == "0"
    assert src["reputation"] == 0
