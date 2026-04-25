use aztec::macros::aztec;

pub mod types;

#[aztec]
pub contract AmazonEscrow {
    use aztec::{
        macros::{
            functions::{external, initializer},
            storage::storage,
        },
        messages::message_delivery::MessageDelivery,
        protocol::address::AztecAddress,
        state_vars::SinglePrivateImmutable,
    };
    use token_contract::Token;
    use attestor_key_oracle::AttestorKeyOracle;
    use amazon_zktls_lib::{MAX_URL_LEN, PublicOutputs, verify};
    use amazon_zktls_lib::internal::{pack_bytes, poseidon2};
    use crate::types::config_note::ConfigNote;
    use crate::types::circuit_args::{ContractContents, ContractHashes, ContractShipToHints};

    #[storage]
    struct Storage<Context> {
        config: SinglePrivateImmutable<ConfigNote, Context>,
    }

    #[external("private")]
    #[initializer]
    fn constructor(
        payment_token: AztecAddress,
        amount: u128,
        asin: Field,
        address_commitment: Field,
        oracle_address: AztecAddress,
    ) {
        let config = ConfigNote::new(
            self.address,
            payment_token,
            amount,
            asin,
            address_commitment,
            oracle_address,
        );
        self.storage.config.initialize(config).deliver(MessageDelivery.ONCHAIN_CONSTRAINED);
    }

    /**
     * Order creator deposits the bounty amount in the payment token.
     */
    #[external("private")]
    fn deposit_tokens(_nonce: Field) {
        let config = self.storage.config.get_note();
        let caller = self.msg_sender();

        self.call(Token::at(config.payment_token).transfer_private_to_private(
            caller,
            self.address,
            config.amount,
            _nonce,
        ));

        let deposit_nullifier = self.storage.config.get_note().get_nullifier(true);
        self.context.push_nullifier(deposit_nullifier);
    }

    /**
     * Filler claims the bounty by submitting a Primus zkTLS attestation.
     * Same private-input shape as `circuit/nr/bin/src/main.nr` - we re-run
     * the verifier inline rather than verifying a recursive proof.
     */
    #[external("private")]
    fn fill_order(
        public_key_x: [u8; 32],
        public_key_y: [u8; 32],
        hash: [u8; 32],
        signature: [u8; 64],
        allowed_url: BoundedVec<u8, MAX_URL_LEN>,
        request_url: BoundedVec<u8, MAX_URL_LEN>,
        recipient: [u8; 20],
        timestamp: u64,
        hashes: ContractHashes,
        contents: ContractContents,
        ship_to_hints: ContractShipToHints,
        grand_total_len: u32,
    ) {
        let config = self.storage.config.get_note();
        let caller = self.msg_sender();

        // (1) Run the full attestation verifier inline. Asserts signature,
        //     URL prefix, and the per-field sha256 bindings.
        let outputs: PublicOutputs = verify(
            public_key_x,
            public_key_y,
            hash,
            signature,
            allowed_url,
            request_url,
            recipient,
            timestamp,
            hashes.to_lib(),
            contents.to_lib(),
            ship_to_hints.to_lib(),
            grand_total_len,
        );

        // (2) Bind the proof to this order.
        assert(outputs.asin == config.asin, "asin mismatch");
        assert(
            outputs.address_commitment == config.address_commitment,
            "address commitment mismatch",
        );

        // (3) Attestor pubkey gate. Pack 64 pubkey bytes (x then y) and
        //     poseidon2 - same recipe as the circuit's signature nullifier
        //     applied to pubkey bytes. The oracle's read() reverts on an
        //     unregistered key, so a returned `true` is the only path past.
        let mut pubkey_bytes: [u8; 64] = [0; 64];
        for i in 0..32 {
            pubkey_bytes[i] = public_key_x[i];
        }
        for i in 0..32 {
            pubkey_bytes[32 + i] = public_key_y[i];
        }
        let pubkey_hash = poseidon2(pack_bytes(pubkey_bytes));
        let is_valid = self.call(
            AttestorKeyOracle::at(config.oracle_address).is_allowed(pubkey_hash),
        );
        assert(is_valid, "attestor not allowed");

        // (4) Cross-order proof replay protection.
        self.context.push_nullifier(outputs.nullifier);

        // (5) Pay the filler.
        self.call(Token::at(config.payment_token).transfer_private_to_private(
            self.address,
            caller,
            config.amount,
            0,
        ));

        // (6) Order-level fill nullifier - prevents double-fill of THIS
        //     escrow even if a second valid attestation existed.
        let fill_nullifier = config.get_nullifier(false);
        self.context.push_nullifier(fill_nullifier);
    }

    #[external("utility")]
    unconstrained fn get_config() -> ConfigNote {
        self.storage.config.view_note()
    }
}
