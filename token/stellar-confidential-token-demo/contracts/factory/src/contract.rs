//! # Confidential Token Factory Example
//!
//! A permissionless factory that deploys the compliant token from
//! `examples/confidential/compliant-token` and the allowlist policy from
//! `examples/confidential/allowlist-policy`. Each deployed address is bound to
//! its constructor arguments through the factory's namespace: only this
//! contract can create in that namespace, and the chain salt hashes the
//! constructor arguments, so a third party cannot occupy a configuration's
//! address with different arguments.
//!
//! The verifier and auditor registries are passed per deployment rather than
//! deployed here, since tokens share them.
//!
//! ## Demo superset
//!
//! This is upstream's `examples/confidential/factory` at v0.8.0, extended
//! append-only with two demo-owned kinds: the vanilla token (`vanilla-token`)
//! and the blocklist policy (`blocklist-policy`). The upstream functions are
//! unchanged in the first `#[contractimpl]` block. The constructor and the
//! added functions live in the second one, so a diff against upstream stays
//! readable on every `stellar-confidential` bump.
//!
//! The added kinds hash `((kind, args), salt)` where upstream hashes
//! `(args, salt)`. Without the tag, `deploy_blocklist(a, m, s)` would derive
//! the same address as `deploy_allowlist(a, m, s)`, since the chain salt does
//! not cover the wasm hash, and whichever came second would fail.

// `#[contracttype]` re-emits `DataKey`, so the allow must sit above it: every
// variant names a wasm hash.
#![allow(clippy::enum_variant_names)]

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, xdr::ToXdr, Address, BytesN,
    ContractExecutable, Env, IntoVal, Symbol, Val, Vec,
};
use stellar_confidential::compliance::ComplianceConfig;

#[contracttype]
enum DataKey {
    TokenWasmHash,
    AllowlistWasmHash,
    VanillaTokenWasmHash,
    BlocklistWasmHash,
}

const VANILLA_KIND: Symbol = symbol_short!("vanilla");
const BLOCKLIST_KIND: Symbol = symbol_short!("blocklist");

#[contract]
pub struct ConfidentialFactoryContract;

#[contractimpl]
impl ConfidentialFactoryContract {
    /// Returns the address `deploy_token` creates for these arguments, whether
    /// or not the token exists yet.
    ///
    /// # Arguments
    ///
    /// * `admin` - The token's access-control admin.
    /// * `underlying_asset` - The SEP-41 token backing confidential balances.
    /// * `verifier` - The confidential verifier registry.
    /// * `auditor` - The confidential auditor registry.
    /// * `compliance` - The token's initial compliance configuration.
    /// * `salt` - Caller-chosen value that lets one configuration have several
    ///   tokens.
    pub fn predict_token_address(
        e: &Env,
        admin: Address,
        underlying_asset: Address,
        verifier: Address,
        auditor: Address,
        compliance: ComplianceConfig,
        salt: u32,
    ) -> Address {
        let args = (admin, underlying_asset, verifier, auditor, compliance).into_val(e);
        predict(e, &args, salt)
    }

    /// Returns the address `deploy_allowlist` creates for these arguments,
    /// whether or not the allowlist exists yet.
    ///
    /// # Arguments
    ///
    /// * `admin` - The allowlist's access-control admin.
    /// * `manager` - The account granted the `manager` role.
    /// * `salt` - Caller-chosen value that lets one configuration have several
    ///   allowlists.
    pub fn predict_allowlist_address(
        e: &Env,
        admin: Address,
        manager: Address,
        salt: u32,
    ) -> Address {
        let args = (admin, manager).into_val(e);
        predict(e, &args, salt)
    }

    /// Deploys a compliant token and returns its address, which is the address
    /// `predict_token_address` returns for the same arguments.
    ///
    /// # Arguments
    ///
    /// * `admin` - The token's access-control admin.
    /// * `underlying_asset` - The SEP-41 token backing confidential balances.
    /// * `verifier` - The confidential verifier registry.
    /// * `auditor` - The confidential auditor registry.
    /// * `compliance` - The token's initial compliance configuration; its
    ///   `policy` binds an existing policy contract, or none.
    /// * `salt` - Caller-chosen value that lets one configuration have several
    ///   tokens.
    pub fn deploy_token(
        e: &Env,
        admin: Address,
        underlying_asset: Address,
        verifier: Address,
        auditor: Address,
        compliance: ComplianceConfig,
        salt: u32,
    ) -> Address {
        let args = (admin, underlying_asset, verifier, auditor, compliance).into_val(e);
        deploy(e, &DataKey::TokenWasmHash, args, salt)
    }

    /// Deploys an allowlist policy and returns its address, which is the
    /// address `predict_allowlist_address` returns for the same arguments.
    ///
    /// # Arguments
    ///
    /// * `admin` - The allowlist's access-control admin.
    /// * `manager` - The account granted the `manager` role.
    /// * `salt` - Caller-chosen value that lets one configuration have several
    ///   allowlists.
    pub fn deploy_allowlist(e: &Env, admin: Address, manager: Address, salt: u32) -> Address {
        let args = (admin, manager).into_val(e);
        deploy(e, &DataKey::AllowlistWasmHash, args, salt)
    }

    /// Deploys an allowlist policy and a compliant token whose
    /// `compliance.policy` points at it, and returns both addresses in that
    /// order. They are the addresses `predict_allowlist_address` and
    /// `predict_token_address` return for the same arguments.
    ///
    /// # Arguments
    ///
    /// * `policy_admin` - The allowlist's access-control admin.
    /// * `policy_manager` - The account granted the allowlist's `manager` role.
    /// * `token_admin` - The token's access-control admin.
    /// * `underlying_asset` - The SEP-41 token backing confidential balances.
    /// * `verifier` - The confidential verifier registry.
    /// * `auditor` - The confidential auditor registry.
    /// * `sac_passthrough` - The token's `compliance.sac_passthrough`.
    /// * `salt` - Caller-chosen value passed to both deployments.
    #[allow(clippy::too_many_arguments)]
    pub fn deploy_allowlist_and_token(
        e: &Env,
        policy_admin: Address,
        policy_manager: Address,
        token_admin: Address,
        underlying_asset: Address,
        verifier: Address,
        auditor: Address,
        sac_passthrough: bool,
        salt: u32,
    ) -> (Address, Address) {
        let policy = Self::deploy_allowlist(e, policy_admin, policy_manager, salt);
        let compliance = ComplianceConfig { policy: Some(policy.clone()), sac_passthrough };
        let token = Self::deploy_token(
            e,
            token_admin,
            underlying_asset,
            verifier,
            auditor,
            compliance,
            salt,
        );
        (policy, token)
    }
}

// ################## DEMO SUPERSET ##################

#[contractimpl]
impl ConfidentialFactoryContract {
    /// Pins the hashes of the wasms that every deployment instantiates.
    ///
    /// # Arguments
    ///
    /// * `token_wasm_hash` - Hash of a compliant-token wasm that is already
    ///   uploaded on this network.
    /// * `allowlist_wasm_hash` - Hash of an allowlist-policy wasm that is
    ///   already uploaded on this network.
    /// * `vanilla_token_wasm_hash` - Hash of a vanilla-token wasm that is
    ///   already uploaded on this network.
    /// * `blocklist_wasm_hash` - Hash of a blocklist-policy wasm that is
    ///   already uploaded on this network.
    pub fn __constructor(
        e: &Env,
        token_wasm_hash: BytesN<32>,
        allowlist_wasm_hash: BytesN<32>,
        vanilla_token_wasm_hash: BytesN<32>,
        blocklist_wasm_hash: BytesN<32>,
    ) {
        e.storage().instance().set(&DataKey::TokenWasmHash, &token_wasm_hash);
        e.storage().instance().set(&DataKey::AllowlistWasmHash, &allowlist_wasm_hash);
        e.storage().instance().set(&DataKey::VanillaTokenWasmHash, &vanilla_token_wasm_hash);
        e.storage().instance().set(&DataKey::BlocklistWasmHash, &blocklist_wasm_hash);
    }

    /// Returns the address `deploy_vanilla_token` creates for these
    /// arguments, whether or not the token exists yet.
    ///
    /// # Arguments
    ///
    /// * `underlying_asset` - The SEP-41 token backing confidential balances.
    /// * `verifier` - The confidential verifier registry.
    /// * `auditor` - The confidential auditor registry.
    /// * `salt` - Caller-chosen value that lets one configuration have several
    ///   tokens.
    pub fn predict_vanilla_token_address(
        e: &Env,
        underlying_asset: Address,
        verifier: Address,
        auditor: Address,
        salt: u32,
    ) -> Address {
        let args = (underlying_asset, verifier, auditor).into_val(e);
        predict(e, &tagged(e, VANILLA_KIND, &args), salt)
    }

    /// Returns the address `deploy_blocklist` creates for these arguments,
    /// whether or not the blocklist exists yet.
    ///
    /// # Arguments
    ///
    /// * `admin` - The blocklist's access-control admin.
    /// * `manager` - The account granted the `manager` role.
    /// * `salt` - Caller-chosen value that lets one configuration have several
    ///   blocklists.
    pub fn predict_blocklist_address(
        e: &Env,
        admin: Address,
        manager: Address,
        salt: u32,
    ) -> Address {
        let args = (admin, manager).into_val(e);
        predict(e, &tagged(e, BLOCKLIST_KIND, &args), salt)
    }

    /// Deploys a vanilla token and returns its address, which is the address
    /// `predict_vanilla_token_address` returns for the same arguments.
    ///
    /// # Arguments
    ///
    /// * `underlying_asset` - The SEP-41 token backing confidential balances.
    /// * `verifier` - The confidential verifier registry.
    /// * `auditor` - The confidential auditor registry.
    /// * `salt` - Caller-chosen value that lets one configuration have several
    ///   tokens.
    pub fn deploy_vanilla_token(
        e: &Env,
        underlying_asset: Address,
        verifier: Address,
        auditor: Address,
        salt: u32,
    ) -> Address {
        let args = (underlying_asset, verifier, auditor).into_val(e);
        deploy_tagged(e, &DataKey::VanillaTokenWasmHash, VANILLA_KIND, args, salt)
    }

    /// Deploys a blocklist policy and returns its address, which is the
    /// address `predict_blocklist_address` returns for the same arguments.
    ///
    /// # Arguments
    ///
    /// * `admin` - The blocklist's access-control admin.
    /// * `manager` - The account granted the `manager` role.
    /// * `salt` - Caller-chosen value that lets one configuration have several
    ///   blocklists.
    pub fn deploy_blocklist(e: &Env, admin: Address, manager: Address, salt: u32) -> Address {
        let args = (admin, manager).into_val(e);
        deploy_tagged(e, &DataKey::BlocklistWasmHash, BLOCKLIST_KIND, args, salt)
    }

    /// Deploys a blocklist policy and a compliant token whose
    /// `compliance.policy` points at it, and returns both addresses in that
    /// order. They are the addresses `predict_blocklist_address` and
    /// `predict_token_address` return for the same arguments.
    ///
    /// # Arguments
    ///
    /// * `policy_admin` - The blocklist's access-control admin.
    /// * `policy_manager` - The account granted the blocklist's `manager` role.
    /// * `token_admin` - The token's access-control admin.
    /// * `underlying_asset` - The SEP-41 token backing confidential balances.
    /// * `verifier` - The confidential verifier registry.
    /// * `auditor` - The confidential auditor registry.
    /// * `sac_passthrough` - The token's `compliance.sac_passthrough`.
    /// * `salt` - Caller-chosen value passed to both deployments.
    #[allow(clippy::too_many_arguments)]
    pub fn deploy_blocklist_and_token(
        e: &Env,
        policy_admin: Address,
        policy_manager: Address,
        token_admin: Address,
        underlying_asset: Address,
        verifier: Address,
        auditor: Address,
        sac_passthrough: bool,
        salt: u32,
    ) -> (Address, Address) {
        let policy = Self::deploy_blocklist(e, policy_admin, policy_manager, salt);
        let compliance = ComplianceConfig { policy: Some(policy.clone()), sac_passthrough };
        let token = Self::deploy_token(
            e,
            token_admin,
            underlying_asset,
            verifier,
            auditor,
            compliance,
            salt,
        );
        (policy, token)
    }
}

/// `(kind, args)`: the salt input of a demo-owned kind. Upstream's kinds hash
/// a bare `args`, whose first element is an `Address`, never a `Symbol`.
fn tagged(e: &Env, kind: Symbol, args: &Vec<Val>) -> Vec<Val> {
    (kind, args.clone()).into_val(e)
}

/// `deploy`, with the salt taken over `(kind, args)`. The constructor still
/// receives the bare `args`.
fn deploy_tagged(e: &Env, wasm: &DataKey, kind: Symbol, args: Vec<Val>, salt: u32) -> Address {
    let wasm_hash: BytesN<32> =
        e.storage().instance().get(wasm).expect("every wasm hash is set in __constructor");

    e.deployer()
        .with_current_contract(chain_salt(e, &tagged(e, kind, &args), salt))
        .deploy_contract(ContractExecutable::Wasm(wasm_hash), args)
}

// ################## UPSTREAM HELPERS ##################

fn predict(e: &Env, args: &Vec<Val>, salt: u32) -> Address {
    e.deployer().with_current_contract(chain_salt(e, args, salt)).deployed_address()
}

fn deploy(e: &Env, wasm: &DataKey, args: Vec<Val>, salt: u32) -> Address {
    let wasm_hash: BytesN<32> =
        e.storage().instance().get(wasm).expect("every wasm hash is set in __constructor");

    e.deployer()
        .with_current_contract(chain_salt(e, &args, salt))
        .deploy_contract(ContractExecutable::Wasm(wasm_hash), args)
}

/// SHA-256 of the XDR of `(args, salt)`.
fn chain_salt(e: &Env, args: &Vec<Val>, salt: u32) -> BytesN<32> {
    let salt_data: Vec<Val> = (args.clone(), salt).into_val(e);

    e.crypto().sha256(&salt_data.to_xdr(e)).to_bytes()
}
