use aztec::macros::aztec;

#[aztec]
pub contract AttestorKeyOracle {
    use aztec::{
        macros::{
            functions::{external, initializer},
            storage::storage,
        },
        protocol::address::AztecAddress,
        state_vars::{Map, PublicImmutable},
    };

    #[storage]
    struct Storage<Context> {
        admin: PublicImmutable<AztecAddress, Context>,
        // Set of allowed attestor pubkey hashes. Each slot is initialized
        // once via `add_key`. Reading an uninitialized slot reverts.
        allowed: Map<Field, PublicImmutable<bool, Context>, Context>,
    }

    #[external("public")]
    #[initializer]
    fn constructor(admin: AztecAddress) {
        self.storage.admin.initialize(admin);
    }

    #[external("public")]
    fn add_key(pubkey_hash: Field) {
        let admin = self.storage.admin.read();
        assert(self.msg_sender() == admin, "only admin");
        self.storage.allowed.at(pubkey_hash).initialize(true);
    }

    // Read from a private context. Reverts with
    // "Trying to read from uninitialized PublicImmutable" if the key has
    // never been admin-registered. So the caller can rely on a returned
    // bool always being `true`.
    #[external("private")]
    fn is_allowed(pubkey_hash: Field) -> bool {
        self.storage.allowed.at(pubkey_hash).read()
    }
}
