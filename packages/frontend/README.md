# `@amazon-zktls/frontend`

Next.js + React app that drives the end-to-end zkTLS flow for an Amazon
order:

1. **Attest** — uses `@primuslabs/zktls-js-sdk` + the Primus Chrome
   extension to notarize an Amazon order-summary page. Produces a
   signed attestation JSON with sha256 digests of `shipmentStatus`,
   `productTitle`, `shipTo`, `grandTotal`.
2. **Prove** — runs the Noir circuit from
   [`@amazon-zktls/circuit`](../circuit/) directly in the browser via
   `@aztec/bb.js`'s WasmWorker backend. Produces a proof + four public
   outputs the downstream escrow flow consumes: `asin`, `grand_total`
   (cents), `address_commitment`, `nullifier`.

## How it works

1. The browser collects an `orderID` and the user's amazon.com session
   cookies (no Amazon login on this site — you paste DevTools cookies).
2. The browser POSTs to `/api/primus/attest` (server-only).
3. The server uses `@primuslabs/network-core-sdk` to:
   - submit an on-chain task on Base Sepolia (the SDK signs/sends a tx with
     the server's internal key — never a user wallet),
   - hand the request `(amazon URL + Cookie header)` and a list of XPath
     resolves to a Primus attestor running in a Phala TEE,
   - poll the attestor for the result + signature.
4. The attestor proxies the TLS connection to amazon.com, decrypts the
   response inside the enclave, runs each XPath, computes
   `sha256(extracted_outer_html)`, and signs the bundle.
5. The server returns `{attestation, privateData}` to the browser.
   `privateData[i].content` is the plaintext outer-HTML the attestor saw;
   the attestation contains the matching signed sha256.

The Noir circuit's job (out of scope here): re-hash each `content` with
SHA-256, equate to the signed digest, ECDSA-verify the attestor signature,
and slice fields like the ASIN out of the outer-HTML byte string.

## Prereqs

- Node.js 18+, `pnpm`.
- A Primus Developer Hub project — get `appId` + `appSecret` at
  https://dev.primuslabs.xyz. 100 free proofs per `appId`.
- An EOA with Base Sepolia testnet ETH (the SDK fee per `submitTask` is
  small; ~10 gwei × default gas).
- An amazon.com session you can pull cookies for (DevTools → Application →
  Cookies → `https://www.amazon.com`).

## Run

```bash
cp .env.local.example .env.local   # fill in PRIMUS_* (appId/appSecret/templateId)
# from the repo root
pnpm install
pnpm --filter @amazon-zktls/circuit build:nr   # compile the Noir circuit once
pnpm --filter @amazon-zktls/frontend dev       # http://localhost:3000
```

Whenever you change Noir code under `packages/circuit/nr`, rerun
`build:nr` and refresh the browser — the compiled bytecode JSON is
imported directly into the bundle.

## Cross-origin isolation (required for fast proving)

Multi-threaded WASM inside the browser uses `SharedArrayBuffer`, which
the platform only exposes when the page is *cross-origin-isolated*.
This frontend's `next.config.ts` sets the two headers needed:

```
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Opener-Policy:   same-origin
```

You can verify isolation in DevTools → Application → Frames → top
frame → "Cross-Origin Isolated: true". Without isolation,
`window.crossOriginIsolated` is `false` and the prove component
falls back to single-threaded WASM (much slower); the prover logs a
warning either way.

If you embed cross-origin sub-resources (CDN scripts, third-party
images, etc.) they need to opt in with
`Cross-Origin-Resource-Policy: cross-origin` or `crossorigin="anonymous"`
attributes — otherwise the browser blocks them under COEP.

The prove component picks `threads = navigator.hardwareConcurrency`
when isolation is on, `1` otherwise.

## XPath dialect

Primus' attestor parser is a restricted XPath 1.0 subset, learned the hard
way from runtime errors:

- `//*[@id="X"]/tag[N]/tag[N]/...` — id-anchored wildcard descendant, then
  pure child-axis. Every element step requires an explicit `[N]` index.
- Predicates: only `[@id="X"]` works. `[@class="X"]`,
  `[@data-component="X"]`, etc. trip `OtherError|basic_string`.
- No XPath functions anywhere — no `normalize-space`, `text()`,
  `contains()`, `substring*()`, `last()`, parens for grouping.
- Returns the matched element's outer HTML (open tag + attrs + inner +
  close), not its text content.

`scripts/test_xpaths.py` validates each path against `example-order.html`
using libxml2 (the same parser the attestor links) and prints the exact
bytes the attestor will hash. Run after any path change — the live
attestation costs gas; this doesn't.

```bash
python3 scripts/test_xpaths.py
```

## Trust model

`algorithmType: "proxytls"` means the attestor sees plaintext briefly inside
its Phala TEE — you're trusting Phala's TEE attestation, not pure
cryptography. To remove the TEE assumption, switch the route's `attMode` to
`"mpctls"` and `noProxy: true`; the user (here, the server) then runs
multi-party computation with the attestor and neither side ever holds
plaintext. Slower handshake, more sites block it.

## Files

- `app/api/primus/sign/route.ts` — server-side `appSecret` signer for the
  attestation request.
- `components/AttestPurchaseBrowser.tsx` — orchestrates the
  `@primuslabs/zktls-js-sdk` flow: build request, sign on the server,
  hand off to the extension, verify, capture per-field outer-HTML.
- `components/ProveAttestation.tsx` — runs the Noir circuit
  end-to-end in-browser. Imports the compiled bytecode from
  `@amazon-zktls/circuit/nr/target/amazon_zktls_bin.json` and the
  parser/prover/decoders from `@amazon-zktls/circuit`.
- `next.config.ts` — COEP/COOP headers, `transpilePackages` for bb.js
  + noir_js, plus the `serverExternalPackages` carve-outs that keep
  `network-core-sdk` / `ethers` out of the server bundle.

## Out of scope

- The Noir circuit itself lives under `packages/circuit`. See the
  `README.md` there for the verifier shape, the address-commitment
  spec, and the public-input layout.
