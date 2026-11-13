extern crate std;

use soroban_sdk::{
    contract, contractimpl,
    testutils::Address as _,
    token::{StellarAssetClient, TokenClient},
    xdr::ToXdr,
    Address, Bytes, BytesN, Env,
};
use stellar_confidential::{
    auditor::{storage as auditor_storage, ConfidentialAuditor, ConfidentialAuditorClient},
    storage as confidential,
    verifier::{CircuitType, ConfidentialVerifier},
    RegisterData, RegisterPayload,
};
use stellar_contract_utils::crypto::grumpkin::Grumpkin;

use crate::contract::{VanillaTokenContract, VanillaTokenContractClient};

const AUDITOR_ID: u32 = 0;

#[contract]
struct MockVerifier;

#[contractimpl(contracttrait)]
impl ConfidentialVerifier for MockVerifier {
    fn register_verification_key(_e: &Env, _ct: CircuitType, _vk: Bytes, _op: Address) {}

    fn update_verification_key(_e: &Env, _ct: CircuitType, _vk: Bytes, _op: Address) {}

    fn verify_proof(_e: &Env, _ct: CircuitType, _pi: Bytes, _proof: Bytes) -> bool {
        true
    }
}

#[contract]
struct MockAuditor;

#[contractimpl(contracttrait)]
impl ConfidentialAuditor for MockAuditor {
    fn register_key(e: &Env, auditor_id: u32, point: BytesN<64>, _operator: Address) {
        auditor_storage::register_key(e, auditor_id, &point);
    }

    fn rotate_key(_e: &Env, _auditor_id: u32, _new_point: BytesN<64>, _operator: Address) {}
}

struct Harness<'a> {
    e: Env,
    sac: StellarAssetClient<'a>,
    verifier: Address,
    auditor: Address,
    token: VanillaTokenContractClient<'a>,
}

fn setup<'a>() -> Harness<'a> {
    let e = Env::default();
    e.mock_all_auths();

    let sac = e.register_stellar_asset_contract_v2(Address::generate(&e));
    let sac = StellarAssetClient::new(&e, &sac.address());
    let verifier = e.register(MockVerifier, ());
    let auditor = e.register(MockAuditor, ());
    ConfidentialAuditorClient::new(&e, &auditor).register_key(
        &AUDITOR_ID,
        &Grumpkin::generator(&e),
        &Address::generate(&e),
    );

    let token =
        e.register(VanillaTokenContract, (sac.address.clone(), verifier.clone(), auditor.clone()));

    Harness { token: VanillaTokenContractClient::new(&e, &token), sac, verifier, auditor, e }
}

fn register_data(e: &Env) -> Bytes {
    RegisterData {
        payload: RegisterPayload { y: Grumpkin::generator(e), pvk: Grumpkin::generator(e) },
        proof: Bytes::new(e),
    }
    .to_xdr(e)
}

#[test]
fn constructor_binds_the_asset_and_registries() {
    let h = setup();

    h.e.as_contract(&h.token.address, || {
        assert_eq!(confidential::get_underlying_asset(&h.e), h.sac.address);
        assert_eq!(confidential::get_verifier(&h.e), h.verifier);
        assert_eq!(confidential::get_auditor(&h.e), h.auditor);
        // Set from the token's own address: the binding every circuit checks.
        confidential::get_address_as_field_element(&h.e);
    });
}

#[test]
fn register_deposit_and_merge_need_no_permission() {
    let h = setup();
    let alice = Address::generate(&h.e);
    h.sac.mint(&alice, &1_000);

    h.token.register(&alice, &AUDITOR_ID, &register_data(&h.e));
    assert_eq!(h.token.confidential_balance(&alice).auditor_id, AUDITOR_ID);

    h.token.deposit(&alice, &alice, &400);
    h.token.merge(&alice);

    let underlying = TokenClient::new(&h.e, &h.sac.address);
    assert_eq!(underlying.balance(&alice), 600);
    assert_eq!(underlying.balance(&h.token.address), 400);
}
