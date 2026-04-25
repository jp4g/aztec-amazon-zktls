# `@amazon-zktls/contracts`

Aztec contracts that consume the `@amazon-zktls/circuit` zkTLS verifier:

- **`AmazonEscrow`** - per-order private escrow. Order creator deposits a USDC bounty
  bound to a specific `(asin, address_commitment)`. A filler claims the bounty by
  submitting a Primus zkTLS attestation; the contract re-runs `amazon_zktls_lib::verify`
  inline and pays the filler if outputs match.
- **`AttestorKeyOracle`** - admin-curated registry of allowed attestor pubkey hashes.
  Read privately from the escrow's `fill_order`; reading an unregistered key reverts.

Pinned to Aztec **v4.2.0-aztecnr-rc.2** (matching aztec-standards tag).

## Layout

```
packages/contracts/
├── nr/
│   ├── Nargo.toml                # workspace
│   ├── escrow/                   # AmazonEscrow
│   └── attestor_key_oracle/      # AttestorKeyOracle
├── deps/aztec-standards/         # git submodule, tag v4.2.0-aztecnr-rc.2
├── scripts/add_artifacts.ts      # post-codegen: copy JSON, fix imports
├── src/
│   ├── artifacts/{escrow,oracle,token}/   # generated, gitignored
│   ├── contract.ts               # deploy/deposit/fill TS helpers
│   └── constants.ts              # TOKEN_METADATA, EscrowConfig
└── test/escrow.test.ts           # vitest happy-path against localnet
```

## Build

```sh
git submodule update --init --recursive
pnpm install
pnpm --filter @amazon-zktls/contracts build
```

The build chains: `aztec compile` (workspace + token) -> `aztec codegen` -> `tsx scripts/add_artifacts.ts` (post-process imports). All `aztec` calls run with `PATH=$HOME/.aztec/current/bin:$PATH` so they pick up aztec's bundled nargo (beta.18). The repo's system nargo is beta.20 and aztec-nr v4.2.0 doesn't compile under it.

## Test

The test runs the **real** verifier path - secp256k1 sigverify + four sha256s + URL prefix
check inside one private function, then a private->private USDC transfer. Expect minutes
per tx.

```sh
# Terminal 1
aztec start --local-network

# Terminal 2 (wait for :8080 to respond)
pnpm --filter @amazon-zktls/contracts test
```

Test setup:

1. Loads `packages/circuit/test/fixtures/attestation-amazon.json`.
2. Derives the order's `asin` (10 ASCII bytes packed LE), `address_commitment`
   (poseidon2 over packed shipTo lines), and `attestor_pubkey_hash`
   (poseidon2(pack_bytes(public_key_x ‖ public_key_y))) so the order config
   matches what `verify(...)` will produce.
3. Spins up two `EmbeddedWallet`s. Account 1 = minter + order creator,
   account 2 = filler. Each wallet has its own PXE - the OTC pubkey-pattern
   requires `registerContract(instance, artifact, secretKey)` on every
   wallet that reads the escrow's notes.
4. Deploys USDC, mints to account 1.
5. Deploys the oracle, registers the fixture's pubkey hash.
6. Deploys a fresh escrow with the order params, registers it on wallet 2.
7. Account 1 deposits the bounty.
8. Account 2 calls `fill_order(...)` with the full circuit input set.
9. Asserts account 2 received the bounty.

## Out of scope

- Switching the oracle from `PublicImmutable` to `DelayedPublicMutable` for
  key revocation.
- Per-field tightened `MAX_*` bounds in `amazon_zktls_lib`.
- Sponsored fee payment / testnet flow.
- Negative-path tests (double-fill rejection, asin mismatch, unregistered
  attestor, etc).
