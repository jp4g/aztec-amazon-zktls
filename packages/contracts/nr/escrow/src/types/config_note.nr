use aztec::{
    macros::notes::note,
    oracle::random::random,
    protocol::{
        address::AztecAddress,
        traits::{Deserialize, Packable, Serialize},
    },
};
use poseidon::poseidon2::Poseidon2;

#[derive(Eq, Serialize, Deserialize, Packable)]
#[note]
pub struct ConfigNote {
    pub owner: AztecAddress,
    pub payment_token: AztecAddress,
    pub amount: u128,
    pub asin: Field,
    pub address_commitment: Field,
    pub oracle_address: AztecAddress,
    pub randomness: Field,
}

impl ConfigNote {
    pub fn new(
        owner: AztecAddress,
        payment_token: AztecAddress,
        amount: u128,
        asin: Field,
        address_commitment: Field,
        oracle_address: AztecAddress,
    ) -> Self {
        Self {
            owner,
            payment_token,
            amount,
            asin,
            address_commitment,
            oracle_address,
            // Safety: random() is an oracle call for note randomness
            randomness: unsafe { random() },
        }
    }

    pub fn get_nullifier(self, deposit: bool) -> Field {
        let serialized = self.serialize();
        let preimage = serialized.concat([deposit as Field]);
        Poseidon2::hash(preimage, 8)
    }
}
