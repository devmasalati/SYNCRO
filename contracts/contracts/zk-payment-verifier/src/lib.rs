#![no_std]

mod verifier;

#[cfg(test)]
mod test;

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Bytes, BytesN, Env,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    InvalidProofLength = 1,
    NullifierAlreadyUsed = 2,
    ProofVerificationFailed = 3,
    InvalidTimeWindow = 4,
    InvalidAmountThreshold = 5,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Nullifier(BytesN<32>),
    Commitment(BytesN<32>),
}

#[contract]
pub struct ZkPaymentVerifier;

#[contractimpl]
impl ZkPaymentVerifier {
    /// Verify a ZK payment proof and record the commitment + nullifier on success.
    ///
    /// Arguments:
    ///   proof_bytes       — 64-byte proof: proof_key(32) || response(32)
    ///   commitment        — public commitment to the payment (hides amount + secret)
    ///   nullifier         — unique nullifier derived from the same secret; prevents replay
    ///   amount_threshold  — maximum payment amount the proof is valid for (positive)
    ///   time_window_start — earliest ledger timestamp at which the proof is valid
    ///   time_window_end   — latest  ledger timestamp at which the proof is valid
    ///
    /// Emits `zk_verify / success` with `(commitment, nullifier, amount_threshold)` on success.
    /// Returns `Err` on any failure; never stores state unless the proof is valid.
    pub fn verify(
        env: Env,
        proof_bytes: Bytes,
        commitment: BytesN<32>,
        nullifier: BytesN<32>,
        amount_threshold: i128,
        time_window_start: u64,
        time_window_end: u64,
    ) -> Result<bool, Error> {
        if proof_bytes.len() != 64 {
            return Err(Error::InvalidProofLength);
        }

        if amount_threshold <= 0 {
            return Err(Error::InvalidAmountThreshold);
        }

        if time_window_start >= time_window_end {
            return Err(Error::InvalidTimeWindow);
        }

        // Reject replayed nullifiers before doing any crypto work.
        if env
            .storage()
            .persistent()
            .has(&DataKey::Nullifier(nullifier.clone()))
        {
            return Err(Error::NullifierAlreadyUsed);
        }

        // Reject already-verified commitments.
        if env
            .storage()
            .persistent()
            .has(&DataKey::Commitment(commitment.clone()))
        {
            return Err(Error::NullifierAlreadyUsed);
        }

        let valid = verifier::verify_proof(
            &env,
            &proof_bytes,
            &commitment,
            &nullifier,
            amount_threshold,
            time_window_start,
            time_window_end,
        );

        if !valid {
            return Err(Error::ProofVerificationFailed);
        }

        // Persist nullifier and commitment to prevent replay.
        env.storage()
            .persistent()
            .set(&DataKey::Nullifier(nullifier.clone()), &true);
        env.storage()
            .persistent()
            .set(&DataKey::Commitment(commitment.clone()), &true);

        // Emit verification event without exposing private inputs.
        env.events().publish(
            (symbol_short!("zk_verify"), symbol_short!("success")),
            (commitment, nullifier, amount_threshold),
        );

        Ok(true)
    }

    /// Returns true if the nullifier has already been consumed.
    pub fn is_nullifier_used(env: Env, nullifier: BytesN<32>) -> bool {
        env.storage()
            .persistent()
            .has(&DataKey::Nullifier(nullifier))
    }

    /// Returns true if the commitment has already been verified.
    pub fn is_commitment_verified(env: Env, commitment: BytesN<32>) -> bool {
        env.storage()
            .persistent()
            .has(&DataKey::Commitment(commitment))
    }
}
