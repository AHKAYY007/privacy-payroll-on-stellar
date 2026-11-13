//! # Confidential Blocklist Policy Example
//!
//! The inverse of `allowlist-policy`: a standalone [`Policy`] registry whose
//! `is_authorized` returns `false` only for accounts a `manager` has blocked.
//! Membership state, its TTL extension, and the `UserBlocked` /
//! `UserUnblocked` events come from [`BlockList`].
//!
//! Not part of the upstream examples. It mirrors `allowlist-policy`'s shape
//! (constructor, `manager` role, an `operator` argument on every mutation) so
//! that a client handles both policies alike.
//!
//! `is_authorized` ignores its `token` argument, so one registry serves every
//! token whose `ComplianceConfig::policy` points at it.
use soroban_sdk::{contract, contractimpl, symbol_short, Address, Env, Symbol, Vec};
use stellar_access::access_control::{self as access_control, AccessControl};
use stellar_confidential::compliance::Policy;
use stellar_macros::only_role;
use stellar_tokens::fungible::blocklist::BlockList;

const MANAGER_ROLE: Symbol = symbol_short!("manager");

#[contract]
pub struct BlocklistPolicyContract;

#[contractimpl]
impl BlocklistPolicyContract {
    pub fn __constructor(e: &Env, admin: Address, manager: Address) {
        access_control::set_admin(e, &admin);
        access_control::grant_role_no_auth(e, &manager, &MANAGER_ROLE, &admin);
    }

    /// Blocks `account`. A no-op when `account` is already blocked.
    ///
    /// # Arguments
    ///
    /// * `e` - Access to the Soroban environment.
    /// * `account` - The address to block.
    /// * `operator` - The `manager` role holder authorizing the call.
    ///
    /// # Events
    ///
    /// * topics - `["user_blocked", user: Address]`
    /// * data - `[]`
    #[only_role(operator, "manager")]
    pub fn block(e: &Env, account: Address, operator: Address) {
        BlockList::block_user(e, &account);
    }

    /// Unblocks `account`. A no-op when `account` is not blocked.
    ///
    /// # Arguments
    ///
    /// * `e` - Access to the Soroban environment.
    /// * `account` - The address to unblock.
    /// * `operator` - The `manager` role holder authorizing the call.
    ///
    /// # Events
    ///
    /// * topics - `["user_unblocked", user: Address]`
    /// * data - `[]`
    #[only_role(operator, "manager")]
    pub fn unblock(e: &Env, account: Address, operator: Address) {
        BlockList::unblock_user(e, &account);
    }

    /// Returns whether `account` is blocked.
    ///
    /// # Arguments
    ///
    /// * `e` - Access to the Soroban environment.
    /// * `account` - The address to check.
    pub fn blocked(e: &Env, account: Address) -> bool {
        BlockList::blocked(e, &account)
    }
}

#[contractimpl]
impl Policy for BlocklistPolicyContract {
    fn is_authorized(e: Env, account: Address, _token: Address) -> bool {
        !BlockList::blocked(&e, &account)
    }
}

#[contractimpl(contracttrait)]
impl AccessControl for BlocklistPolicyContract {}
