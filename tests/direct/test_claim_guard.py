"""Tests for ClaimGuard - an on-chain fact-checking oracle."""

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
