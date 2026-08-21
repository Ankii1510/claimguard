"""Tests for ClaimGuard - an on-chain fact-checking oracle.

Covers:
- claim submission + verification (original flow)
- source governance (reputation voting + rejection gate)
- challenge path (stake, overturn, uphold, forfeit)
- consequential consume (fee flows to owner, recorded)
"""

import json

from tests.direct.conftest import to_hex


def _setup_verdict_mocks(vm, verdict, confidence, reasoning):
    """Register web + LLM mocks for claim verification."""
    vm.mock_web(
        r".*example\.com.*",
        {"status": 200, "body": "This is the evidence page content."},
    )
    vm.mock_llm(
        r".*fact-checking engine.*",
        json.dumps(
            {"verdict": verdict, "confidence": confidence, "reasoning": reasoning}
        ),
    )


# ---------------------------------------------------------------------------
# Original flow
# ---------------------------------------------------------------------------

def test_submit_claim(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/claim_guard.py")
    direct_vm.sender = direct_alice

    claim_id = contract.submit_claim(
        "The sky is blue.", "https://example.com/sky\nhttps://example.com/colors"
    )

    assert claim_id == "1"
    assert contract.get_claim_count() == 1


def test_submit_empty_claim_fails(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/claim_guard.py")
    direct_vm.sender = direct_alice

    with direct_vm.expect_revert("Claim text cannot be empty"):
        contract.submit_claim("   ", "https://example.com/a")


def test_verify_true(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/claim_guard.py")
    direct_vm.sender = direct_alice
    alice = to_hex(direct_alice)

    contract.submit_claim("The sky is blue.", "https://example.com/sky")
    _setup_verdict_mocks(direct_vm, "TRUE", 95, "The evidence confirms the claim.")

    contract.verify_claim("1")

    claim = contract.get_claims()[alice]["1"]
    assert claim["has_resolved"] is True
    assert claim["verdict"] == "TRUE"
    assert claim["confidence"] == "95"
    assert claim["reasoning"] == "The evidence confirms the claim."
    assert claim["challenge_status"] == "none"


def test_verify_false(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/claim_guard.py")
    direct_vm.sender = direct_alice
    alice = to_hex(direct_alice)

    contract.submit_claim("The sky is green.", "https://example.com/sky")
    _setup_verdict_mocks(direct_vm, "FALSE", 90, "The evidence contradicts the claim.")

    contract.verify_claim("1")

    claim = contract.get_claims()[alice]["1"]
    assert claim["verdict"] == "FALSE"
    assert claim["has_resolved"] is True


def test_verify_uncertain(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/claim_guard.py")
    direct_vm.sender = direct_alice
    alice = to_hex(direct_alice)

    contract.submit_claim("Aliens visited earth.", "https://example.com/aliens")
    _setup_verdict_mocks(direct_vm, "UNCERTAIN", 40, "Not enough evidence.")

    contract.verify_claim("1")

    claim = contract.get_claims()[alice]["1"]
    assert claim["verdict"] == "UNCERTAIN"


def test_verify_already_verified_fails(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/claim_guard.py")
    direct_vm.sender = direct_alice

    contract.submit_claim("The sky is blue.", "https://example.com/sky")
    _setup_verdict_mocks(direct_vm, "TRUE", 95, "Confirmed.")

    contract.verify_claim("1")

    with direct_vm.expect_revert("Claim already verified"):
        contract.verify_claim("1")


def test_counter_increments_across_users(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    contract = direct_deploy("contracts/claim_guard.py")

    direct_vm.sender = direct_alice
    assert contract.submit_claim("Claim A", "https://example.com/a") == "1"

    direct_vm.sender = direct_bob
    assert contract.submit_claim("Claim B", "https://example.com/b") == "2"

    assert contract.get_claim_count() == 2


# ---------------------------------------------------------------------------
# Source governance
# ---------------------------------------------------------------------------

def test_vote_source_updates_reputation(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/claim_guard.py")

    direct_vm.sender = direct_alice
    contract.vote_source("example.com", True)
    direct_vm.sender = direct_bob
    contract.vote_source("example.com", True)

    src = contract.get_source("example.com")
    assert src["up_votes"] == "2"
    assert src["down_votes"] == "0"
    assert src["reputation"] == 2


def test_vote_source_negative_reputation(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract = direct_deploy("contracts/claim_guard.py")

    direct_vm.sender = direct_alice
    contract.vote_source("example.com", False)
    direct_vm.sender = direct_bob
    contract.vote_source("example.com", False)
    direct_vm.sender = direct_charlie
    contract.vote_source("example.com", False)

    src = contract.get_source("example.com")
    assert src["reputation"] == -3


def test_vote_source_one_vote_per_address(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/claim_guard.py")

    direct_vm.sender = direct_alice
    contract.vote_source("example.com", True)
    # Same address votes again, switching to downvote: net should be -1, not 0.
    contract.vote_source("example.com", False)

    src = contract.get_source("example.com")
    assert src["up_votes"] == "0"
    assert src["down_votes"] == "1"
    assert src["reputation"] == -1


def test_submit_rejects_negative_reputation_source(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    contract = direct_deploy("contracts/claim_guard.py")

    # Community downvotes example.com into negative reputation.
    for addr in (direct_alice, direct_bob, direct_charlie):
        direct_vm.sender = addr
        contract.vote_source("example.com", False)

    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("Source rejected by community governance"):
        contract.submit_claim("The sky is blue.", "https://example.com/sky")


# ---------------------------------------------------------------------------
# Challenge path
# ---------------------------------------------------------------------------

def _settled_claim(direct_vm, contract, owner, verdict="TRUE"):
    direct_vm.sender = owner
    contract.submit_claim("The sky is blue.", "https://example.com/sky")
    _setup_verdict_mocks(direct_vm, verdict, 95, "Evidence confirms.")
    contract.verify_claim("1")


def test_challenge_overturns_verdict(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/claim_guard.py")
    _settled_claim(direct_vm, contract, direct_alice, verdict="TRUE")
    alice = to_hex(direct_alice)
    bob = to_hex(direct_bob)

    # Bob challenges; re-analysis now returns FALSE.
    direct_vm.clear_mocks()
    direct_vm.sender = direct_bob
    direct_vm.value = 20
    _setup_verdict_mocks(direct_vm, "FALSE", 90, "Evidence contradicts after review.")

    challenge_id = contract.challenge_claim("1", "https://example.com/counter")

    claim = contract.get_claims()[alice]["1"]
    assert challenge_id == "1"
    assert claim["verdict"] == "FALSE"
    assert claim["challenge_status"] == "overturned"
    assert claim["challenged_by"] == bob

    # Challenger wins: escrow doubled stake (20 * 2 = 40).
    assert contract.get_escrow(bob) == 40


def test_challenge_upheld_forfeits_stake(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/claim_guard.py")
    _settled_claim(direct_vm, contract, direct_alice, verdict="TRUE")
    alice = to_hex(direct_alice)

    # Bob challenges; re-analysis still returns TRUE.
    direct_vm.clear_mocks()
    direct_vm.sender = direct_bob
    direct_vm.value = 15
    _setup_verdict_mocks(direct_vm, "TRUE", 95, "Evidence confirms.")

    contract.challenge_claim("1", "https://example.com/counter")

    claim = contract.get_claims()[alice]["1"]
    assert claim["challenge_status"] == "upheld"
    assert claim["verdict"] == "TRUE"

    # Owner receives the forfeited stake.
    assert contract.get_escrow(alice) == 15


def test_challenge_requires_stake(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/claim_guard.py")
    _settled_claim(direct_vm, contract, direct_alice, verdict="TRUE")

    direct_vm.sender = direct_bob
    direct_vm.value = 1  # below CHALLENGE_STAKE (10)

    with direct_vm.expect_revert("Insufficient stake"):
        contract.challenge_claim("1", "https://example.com/counter")


def test_challenge_unresolved_claim_fails(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/claim_guard.py")
    direct_vm.sender = direct_alice
    contract.submit_claim("The sky is blue.", "https://example.com/sky")

    direct_vm.sender = direct_bob
    direct_vm.value = 20
    with direct_vm.expect_revert("not resolved"):
        contract.challenge_claim("1", "https://example.com/counter")


# ---------------------------------------------------------------------------
# Consequential consume
# ---------------------------------------------------------------------------

def test_consume_verdict(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/claim_guard.py")
    _settled_claim(direct_vm, contract, direct_alice, verdict="TRUE")
    alice = to_hex(direct_alice)

    direct_vm.sender = direct_bob
    direct_vm.value = 5

    result = contract.consume_verdict("1")

    assert result["verdict"] == "TRUE"
    assert result["claim_id"] == "1"

    # Consumer recorded.
    assert to_hex(direct_bob) in contract.get_consumers("1")
    # Fee flows to the claim owner.
    assert contract.get_escrow(alice) == 5


def test_consume_requires_fee(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/claim_guard.py")
    _settled_claim(direct_vm, contract, direct_alice, verdict="TRUE")

    direct_vm.sender = direct_bob
    direct_vm.value = 0

    with direct_vm.expect_revert("Insufficient fee"):
        contract.consume_verdict("1")


def test_consume_unresolved_fails(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/claim_guard.py")
    direct_vm.sender = direct_alice
    contract.submit_claim("The sky is blue.", "https://example.com/sky")

    direct_vm.sender = direct_bob
    direct_vm.value = 5
    with direct_vm.expect_revert("not settled"):
        contract.consume_verdict("1")
