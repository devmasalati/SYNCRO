#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Ledger as _, Address, Bytes, BytesN, Env};

// ── Off-chain proof helpers (mirror the prover logic) ─────────────────────────

const COMMIT_DOMAIN: &[u8; 32] =
    b"zkpay-commit\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00";

const NULL_DOMAIN: &[u8; 32] =
    b"zkpay-null\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00";

fn sha256_two(env: &Env, a: &BytesN<32>, b: &BytesN<32>) -> BytesN<32> {
    let mut input = Bytes::new(env);
    input.append(&a.clone().into());
    input.append(&b.clone().into());
    env.crypto().sha256(&input)
}

fn hash_domain_key(env: &Env, domain: &[u8; 32], key: &BytesN<32>) -> BytesN<32> {
    let domain_bn: BytesN<32> = BytesN::from_array(env, domain);
    sha256_two(env, &domain_bn, key)
}

fn derive_commitments(env: &Env, proof_key: &BytesN<32>) -> (BytesN<32>, BytesN<32>) {
    let commitment = hash_domain_key(env, COMMIT_DOMAIN, proof_key);
    let nullifier = hash_domain_key(env, NULL_DOMAIN, proof_key);
    (commitment, nullifier)
}

fn build_proof(
    env: &Env,
    proof_key: &BytesN<32>,
    commitment: &BytesN<32>,
    nullifier: &BytesN<32>,
    amount_threshold: i128,
    time_window_start: u64,
    time_window_end: u64,
) -> Bytes {
    // params = amount_threshold(16 BE) || time_start(8 BE) || time_end(8 BE) || 0-pad
    let mut params = [0u8; 32];
    params[0..16].copy_from_slice(&amount_threshold.to_be_bytes());
    params[16..24].copy_from_slice(&time_window_start.to_be_bytes());
    params[24..32].copy_from_slice(&time_window_end.to_be_bytes());

    // context = SHA256(commitment || nullifier || params)
    let mut ctx_input = Bytes::new(env);
    ctx_input.append(&commitment.clone().into());
    ctx_input.append(&nullifier.clone().into());
    ctx_input.append(&BytesN::<32>::from_array(env, &params).into());
    let context: BytesN<32> = env.crypto().sha256(&ctx_input);

    // s = SHA256(proof_key || context)
    let s: BytesN<32> = sha256_two(env, proof_key, &context);

    // proof = proof_key(32) || s(32)
    let mut proof = Bytes::new(env);
    proof.append(&proof_key.clone().into());
    proof.append(&s.into());
    proof
}

/// Create an env with ledger timestamp set to 1_000 (inside the default test window [0, 5_000]).
fn setup() -> (Env, Address) {
    let env = Env::default();
    env.ledger().with_mut(|li| {
        li.timestamp = 1_000;
    });
    let contract_id = env.register_contract(None, ZkPaymentVerifier);
    (env, contract_id)
}

/// Produce a proof_key that looks like a real derived key for a given seed byte.
fn make_proof_key(env: &Env, seed: u8) -> BytesN<32> {
    let seed_bytes: Bytes = BytesN::<32>::from_array(env, &[seed; 32]).into();
    env.crypto().sha256(&seed_bytes)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[test]
fn test_valid_proof_accepted() {
    let (env, id) = setup();
    let client = ZkPaymentVerifierClient::new(&env, &id);

    let proof_key = make_proof_key(&env, 1);
    let (commitment, nullifier) = derive_commitments(&env, &proof_key);
    let proof = build_proof(&env, &proof_key, &commitment, &nullifier, 1_000_000, 500, 2_000);

    assert_eq!(
        client.verify(&proof, &commitment, &nullifier, &1_000_000_i128, &500_u64, &2_000_u64),
        true
    );
}

#[test]
fn test_nullifier_stored_after_verification() {
    let (env, id) = setup();
    let client = ZkPaymentVerifierClient::new(&env, &id);

    let proof_key = make_proof_key(&env, 2);
    let (commitment, nullifier) = derive_commitments(&env, &proof_key);
    let proof = build_proof(&env, &proof_key, &commitment, &nullifier, 500, 0, 5_000);

    assert!(!client.is_nullifier_used(&nullifier));
    client.verify(&proof, &commitment, &nullifier, &500_i128, &0_u64, &5_000_u64);
    assert!(client.is_nullifier_used(&nullifier));
}

#[test]
fn test_commitment_stored_after_verification() {
    let (env, id) = setup();
    let client = ZkPaymentVerifierClient::new(&env, &id);

    let proof_key = make_proof_key(&env, 3);
    let (commitment, nullifier) = derive_commitments(&env, &proof_key);
    let proof = build_proof(&env, &proof_key, &commitment, &nullifier, 500, 0, 5_000);

    assert!(!client.is_commitment_verified(&commitment));
    client.verify(&proof, &commitment, &nullifier, &500_i128, &0_u64, &5_000_u64);
    assert!(client.is_commitment_verified(&commitment));
}

#[test]
fn test_nullifier_deduplication_rejects_replay() {
    let (env, id) = setup();
    let client = ZkPaymentVerifierClient::new(&env, &id);

    let proof_key = make_proof_key(&env, 4);
    let (commitment, nullifier) = derive_commitments(&env, &proof_key);
    let proof = build_proof(&env, &proof_key, &commitment, &nullifier, 500, 0, 5_000);

    client.verify(&proof, &commitment, &nullifier, &500_i128, &0_u64, &5_000_u64);

    let result = client.try_verify(&proof, &commitment, &nullifier, &500_i128, &0_u64, &5_000_u64);
    assert_eq!(result, Err(Ok(Error::NullifierAlreadyUsed)));
}

#[test]
fn test_tampered_proof_rejected() {
    let (env, id) = setup();
    let client = ZkPaymentVerifierClient::new(&env, &id);

    let proof_key = make_proof_key(&env, 5);
    let (commitment, nullifier) = derive_commitments(&env, &proof_key);

    // Proof with entirely wrong r and s values — not derived from proof_key.
    let bad_r = BytesN::<32>::from_array(&env, &[0xde; 32]);
    let bad_s = BytesN::<32>::from_array(&env, &[0xad; 32]);
    let mut tampered = Bytes::new(&env);
    tampered.append(&bad_r.into());
    tampered.append(&bad_s.into());

    let result = client.try_verify(&tampered, &commitment, &nullifier, &500_i128, &0_u64, &5_000_u64);
    assert_eq!(result, Err(Ok(Error::ProofVerificationFailed)));
}

#[test]
fn test_wrong_commitment_rejected() {
    let (env, id) = setup();
    let client = ZkPaymentVerifierClient::new(&env, &id);

    let proof_key = make_proof_key(&env, 6);
    let (commitment, nullifier) = derive_commitments(&env, &proof_key);
    let proof = build_proof(&env, &proof_key, &commitment, &nullifier, 500, 0, 5_000);
    let wrong_commitment = BytesN::<32>::from_array(&env, &[0xde; 32]);

    let result = client.try_verify(&proof, &wrong_commitment, &nullifier, &500_i128, &0_u64, &5_000_u64);
    assert_eq!(result, Err(Ok(Error::ProofVerificationFailed)));
}

#[test]
fn test_wrong_nullifier_rejected() {
    let (env, id) = setup();
    let client = ZkPaymentVerifierClient::new(&env, &id);

    let proof_key = make_proof_key(&env, 7);
    let (commitment, nullifier) = derive_commitments(&env, &proof_key);
    let proof = build_proof(&env, &proof_key, &commitment, &nullifier, 500, 0, 5_000);
    let wrong_nullifier = BytesN::<32>::from_array(&env, &[0xab; 32]);

    let result = client.try_verify(&proof, &commitment, &wrong_nullifier, &500_i128, &0_u64, &5_000_u64);
    assert_eq!(result, Err(Ok(Error::ProofVerificationFailed)));
}

#[test]
fn test_proof_outside_time_window_rejected() {
    let env = Env::default();
    // Ledger timestamp = 10_000, outside the window [0, 5_000].
    env.ledger().with_mut(|li| {
        li.timestamp = 10_000;
    });
    let id = env.register_contract(None, ZkPaymentVerifier);
    let client = ZkPaymentVerifierClient::new(&env, &id);

    let proof_key = make_proof_key(&env, 8);
    let (commitment, nullifier) = derive_commitments(&env, &proof_key);
    let proof = build_proof(&env, &proof_key, &commitment, &nullifier, 500, 0, 5_000);

    let result = client.try_verify(&proof, &commitment, &nullifier, &500_i128, &0_u64, &5_000_u64);
    assert_eq!(result, Err(Ok(Error::ProofVerificationFailed)));
}

#[test]
fn test_invalid_amount_threshold_rejected() {
    let (env, id) = setup();
    let client = ZkPaymentVerifierClient::new(&env, &id);

    let proof_key = make_proof_key(&env, 9);
    let (commitment, nullifier) = derive_commitments(&env, &proof_key);
    let proof = build_proof(&env, &proof_key, &commitment, &nullifier, 500, 0, 5_000);

    let result = client.try_verify(&proof, &commitment, &nullifier, &0_i128, &0_u64, &5_000_u64);
    assert_eq!(result, Err(Ok(Error::InvalidAmountThreshold)));
}

#[test]
fn test_invalid_time_window_rejected() {
    let (env, id) = setup();
    let client = ZkPaymentVerifierClient::new(&env, &id);

    let proof_key = make_proof_key(&env, 10);
    let (commitment, nullifier) = derive_commitments(&env, &proof_key);
    // Build proof for a valid window, but submit with inverted window (start > end).
    let proof = build_proof(&env, &proof_key, &commitment, &nullifier, 500, 0, 5_000);

    let result = client.try_verify(&proof, &commitment, &nullifier, &500_i128, &2_000_u64, &1_000_u64);
    assert_eq!(result, Err(Ok(Error::InvalidTimeWindow)));
}

#[test]
fn test_proof_wrong_length_rejected() {
    let (env, id) = setup();
    let client = ZkPaymentVerifierClient::new(&env, &id);

    let proof_key = make_proof_key(&env, 11);
    let (commitment, nullifier) = derive_commitments(&env, &proof_key);

    // 32-byte proof — missing the response half.
    let short_proof: Bytes = proof_key.into();

    let result = client.try_verify(&short_proof, &commitment, &nullifier, &500_i128, &0_u64, &5_000_u64);
    assert_eq!(result, Err(Ok(Error::InvalidProofLength)));
}

#[test]
fn test_mismatched_threshold_rejects_proof() {
    let (env, id) = setup();
    let client = ZkPaymentVerifierClient::new(&env, &id);

    let proof_key = make_proof_key(&env, 12);
    let (commitment, nullifier) = derive_commitments(&env, &proof_key);
    // Proof built for threshold=500, submitted with threshold=999.
    let proof = build_proof(&env, &proof_key, &commitment, &nullifier, 500, 0, 5_000);

    let result = client.try_verify(&proof, &commitment, &nullifier, &999_i128, &0_u64, &5_000_u64);
    assert_eq!(result, Err(Ok(Error::ProofVerificationFailed)));
}

#[test]
fn test_independent_proofs_do_not_interfere() {
    let (env, id) = setup();
    let client = ZkPaymentVerifierClient::new(&env, &id);

    let pk_a = make_proof_key(&env, 20);
    let (cm_a, nl_a) = derive_commitments(&env, &pk_a);
    let proof_a = build_proof(&env, &pk_a, &cm_a, &nl_a, 100, 0, 5_000);

    let pk_b = make_proof_key(&env, 21);
    let (cm_b, nl_b) = derive_commitments(&env, &pk_b);
    let proof_b = build_proof(&env, &pk_b, &cm_b, &nl_b, 200, 0, 5_000);

    assert_eq!(
        client.verify(&proof_a, &cm_a, &nl_a, &100_i128, &0_u64, &5_000_u64),
        true
    );
    assert_eq!(
        client.verify(&proof_b, &cm_b, &nl_b, &200_i128, &0_u64, &5_000_u64),
        true
    );

    assert!(client.is_nullifier_used(&nl_a));
    assert!(client.is_nullifier_used(&nl_b));
}
