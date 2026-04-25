// Standalone proving entrypoint. Same shape we'll lift into an Aztec
// private function later.

use amazon_zktls_lib::{Contents, Hashes, MAX_URL_LEN, verify};

fn main(
    public_key_x: pub [u8; 32],
    public_key_y: pub [u8; 32],
    hash: pub [u8; 32],
    signature: [u8; 64],
    allowed_url: pub BoundedVec<u8, MAX_URL_LEN>,
    request_url: pub BoundedVec<u8, MAX_URL_LEN>,
    hashes: pub Hashes,
    contents: Contents,
) {
    verify(
        public_key_x,
        public_key_y,
        hash,
        signature,
        allowed_url,
        request_url,
        hashes,
        contents,
    );
}
