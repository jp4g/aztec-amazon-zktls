// amazon_zktls_lib - direct verifier for Primus' hashing-mode attestations.
//
// Does three things per attestation:
//   1. ECDSA secp256k1 signature over the canonical message hash (reproduced
//      off-circuit by the TS parser; circuit just verifies it).
//   2. Constrained prefix check: request URL starts with the allowed URL.
//   3. Per-field sha256: sha256(plaintext_i) == hashes.i for every field.
//
// v1 targets Amazon's order-summary print page, so fields are hardcoded by
// name (shipment_status / product_title / ship_to / grand_total) with
// distinct MAX_* bounds picked from observed outer-HTML lengths. A single
// shared MAX_CONTENT_LEN would waste sha256 constraints padding the short
// fields; keeping each bound tight drops the hashing cost roughly to the
// sum of the individual maxes rather than 4 * max(maxes). When the set of
// fields changes, edit `Contents` / `Hashes` / `verify` together.

use sha256::sha256_var;

pub global MAX_URL_LEN: u32 = 128;

// Per-field outer-HTML byte ceilings. Picked generously above what the
// current Amazon template emits. Shrink once we have the actual max across
// fixtures, or grow here (and the TS parser's matching constants) if a new
// field / longer template is added.
pub global MAX_SHIPMENT_STATUS_LEN: u32 = 256;
pub global MAX_PRODUCT_TITLE_LEN: u32 = 1024;
pub global MAX_SHIP_TO_LEN: u32 = 1024;
// grandTotal is wrapped in several <span> layers of Amazon styling, so
// the outer HTML ends up ~90 bytes even though the visible text is "$x.xx".
pub global MAX_GRAND_TOTAL_LEN: u32 = 128;

// Private inputs: the actual outer-HTML strings the attestor hashed.
pub struct Contents {
    pub shipment_status: BoundedVec<u8, MAX_SHIPMENT_STATUS_LEN>,
    pub product_title: BoundedVec<u8, MAX_PRODUCT_TITLE_LEN>,
    pub ship_to: BoundedVec<u8, MAX_SHIP_TO_LEN>,
    pub grand_total: BoundedVec<u8, MAX_GRAND_TOTAL_LEN>,
}

// Public inputs: the sha256 digests that were signed inside `attestation.data`.
pub struct Hashes {
    pub shipment_status: [u8; 32],
    pub product_title: [u8; 32],
    pub ship_to: [u8; 32],
    pub grand_total: [u8; 32],
}

pub fn verify(
    public_key_x: [u8; 32],
    public_key_y: [u8; 32],
    hash: [u8; 32],
    signature: [u8; 64],
    allowed_url: BoundedVec<u8, MAX_URL_LEN>,
    request_url: BoundedVec<u8, MAX_URL_LEN>,
    hashes: Hashes,
    contents: Contents,
) {
    // 1. Attestor signature.
    assert(
        std::ecdsa_secp256k1::verify_signature(
            public_key_x, public_key_y, signature, hash,
        ),
        "attestor signature invalid",
    );

    // 2. request_url starts with allowed_url. Loop is bounded by MAX_URL_LEN;
    // `if j < allowed_len` folds the tail after the prefix.
    let allowed_len = allowed_url.len();
    assert(request_url.len() >= allowed_len, "request_url shorter than prefix");
    let allowed_bytes = allowed_url.storage();
    let request_bytes = request_url.storage();
    for j in 0..MAX_URL_LEN {
        if j < allowed_len {
            assert_eq(request_bytes[j], allowed_bytes[j], "URL prefix mismatch");
        }
    }

    // 3. Per-field sha256. Unrolled: each call is bounded by that field's
    // own MAX_*_LEN, so shipment_status's hash loop doesn't pay the cost of
    // product_title's ceiling and vice versa.
    assert(
        sha256_var(
            contents.shipment_status.storage(),
            contents.shipment_status.len() as u32,
        ) == hashes.shipment_status,
        "shipment_status sha256 mismatch",
    );
    assert(
        sha256_var(
            contents.product_title.storage(),
            contents.product_title.len() as u32,
        ) == hashes.product_title,
        "product_title sha256 mismatch",
    );
    assert(
        sha256_var(
            contents.ship_to.storage(),
            contents.ship_to.len() as u32,
        ) == hashes.ship_to,
        "ship_to sha256 mismatch",
    );
    assert(
        sha256_var(
            contents.grand_total.storage(),
            contents.grand_total.len() as u32,
        ) == hashes.grand_total,
        "grand_total sha256 mismatch",
    );
}
