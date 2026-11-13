extern crate std;

use soroban_sdk::{
    testutils::{Address as _, Events},
    Address, Env, Event,
};
use stellar_tokens::fungible::blocklist::{UserBlocked, UserUnblocked};

use crate::contract::{BlocklistPolicyContract, BlocklistPolicyContractClient};

fn create_client<'a>(
    e: &Env,
    admin: &Address,
    manager: &Address,
) -> BlocklistPolicyContractClient<'a> {
    let address = e.register(BlocklistPolicyContract, (admin, manager));
    BlocklistPolicyContractClient::new(e, &address)
}

#[test]
fn block_and_unblock_round_trip() {
    let e = Env::default();
    e.mock_all_auths();
    let admin = Address::generate(&e);
    let manager = Address::generate(&e);
    let client = create_client(&e, &admin, &manager);
    let alice = Address::generate(&e);

    assert!(!client.blocked(&alice));

    client.block(&alice, &manager);
    let events = e.events().all();
    assert_eq!(events.events().len(), 1);
    assert_eq!(
        events.events().first().unwrap(),
        &UserBlocked { user: alice.clone() }.to_xdr(&e, &client.address)
    );
    assert!(client.blocked(&alice));

    client.unblock(&alice, &manager);
    let events = e.events().all();
    assert_eq!(events.events().len(), 1);
    assert_eq!(
        events.events().first().unwrap(),
        &UserUnblocked { user: alice.clone() }.to_xdr(&e, &client.address)
    );
    assert!(!client.blocked(&alice));
}

#[test]
fn repeated_block_and_unblock_are_no_ops() {
    let e = Env::default();
    e.mock_all_auths();
    let admin = Address::generate(&e);
    let manager = Address::generate(&e);
    let client = create_client(&e, &admin, &manager);
    let alice = Address::generate(&e);
    let bob = Address::generate(&e);

    client.block(&alice, &manager);
    client.block(&alice, &manager);
    assert_eq!(e.events().all().events().len(), 0);
    assert!(client.blocked(&alice));

    client.unblock(&alice, &manager);
    client.unblock(&alice, &manager);
    assert_eq!(e.events().all().events().len(), 0);
    assert!(!client.blocked(&alice));

    client.unblock(&bob, &manager);
    assert_eq!(e.events().all().events().len(), 0);
    assert!(!client.blocked(&bob));
}

#[test]
fn is_authorized_is_the_complement_of_membership_for_every_token() {
    let e = Env::default();
    e.mock_all_auths();
    let admin = Address::generate(&e);
    let manager = Address::generate(&e);
    let client = create_client(&e, &admin, &manager);
    let alice = Address::generate(&e);
    let bob = Address::generate(&e);
    let token_a = Address::generate(&e);
    let token_b = Address::generate(&e);

    assert!(client.is_authorized(&alice, &token_a));

    client.block(&alice, &manager);
    assert!(!client.is_authorized(&alice, &token_a));
    assert!(!client.is_authorized(&alice, &token_b));
    assert!(client.is_authorized(&bob, &token_a));

    client.unblock(&alice, &manager);
    assert!(client.is_authorized(&alice, &token_a));
    assert!(client.is_authorized(&alice, &token_b));
}

#[test]
#[should_panic(expected = "Error(Contract, #2000)")]
fn block_by_non_manager_panics() {
    let e = Env::default();
    e.mock_all_auths();
    let admin = Address::generate(&e);
    let manager = Address::generate(&e);
    let client = create_client(&e, &admin, &manager);

    client.block(&Address::generate(&e), &admin);
}

#[test]
#[should_panic(expected = "Error(Contract, #2000)")]
fn unblock_by_non_manager_panics() {
    let e = Env::default();
    e.mock_all_auths();
    let admin = Address::generate(&e);
    let manager = Address::generate(&e);
    let client = create_client(&e, &admin, &manager);
    let alice = Address::generate(&e);
    client.block(&alice, &manager);

    client.unblock(&alice, &Address::generate(&e));
}
