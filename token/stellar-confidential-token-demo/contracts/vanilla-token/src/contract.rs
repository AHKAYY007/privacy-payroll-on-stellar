//! # Vanilla Confidential Token Example
//!
//! A [`ConfidentialToken`] with `type Hooks = NoHooks`: no freeze, no policy,
//! no SAC gate, no clawback, and no admin. Nobody can stop an account from
//! transacting or seize its balance once it is constructed.
//!
//! Not part of the upstream examples. A compliant token with
//! `ComplianceConfig { policy: None, .. }` is not equivalent: its hooks still
//! run, and its admin can grant itself `freezer` and `clawback`.
use soroban_sdk::{contract, contractimpl, Address, Bytes, Env};
use stellar_confidential::{
    storage as confidential, ConfidentialAccount, ConfidentialToken, NoHooks, SpenderDelegation,
};

#[contract]
pub struct VanillaTokenContract;

#[contractimpl]
impl VanillaTokenContract {
    /// Binds the token to its underlying asset and registries.
    ///
    /// # Arguments
    ///
    /// * `e` - Access to the Soroban environment.
    /// * `underlying_asset` - The SEP-41 token backing confidential balances.
    /// * `verifier` - The confidential verifier registry.
    /// * `auditor` - The confidential auditor registry.
    pub fn __constructor(e: &Env, underlying_asset: Address, verifier: Address, auditor: Address) {
        confidential::set_underlying_asset(e, &underlying_asset);
        confidential::set_verifier(e, &verifier);
        confidential::set_auditor(e, &auditor);
        confidential::set_address_as_field_element(e);
    }
}

#[contractimpl(contracttrait)]
impl ConfidentialToken for VanillaTokenContract {
    type Hooks = NoHooks;
}
