# aztec-amazon-zktls

Next.js + TypeScript app that produces a Primus zkTLS attestation proving a
specific Amazon order — shipment status, product title (with embedded ASIN),
shipping address, and grand total — for the Amazon account whose session
cookies are pasted into the form. The signed attestation JSON is the intended
input to a Noir circuit (`zktls-verification-noir`'s
`verify_attestation_hashing` flow); the circuit itself is **not** in this
repo.

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
cp .env.local.example .env.local   # fill in PRIMUS_* and the signer key
pnpm install
pnpm dev                            # http://localhost:3000
```

Optional: pre-fill the form by setting the `NEXT_PUBLIC_AMAZON_*` vars in
`.env.local` (also gitignored). The form leaves any blank field empty.

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

- `app/api/primus/attest/route.ts` — full attest flow (init / submitTask /
  attest / verifyAndPollTaskResult / pull `getPlainResponse`).
- `components/AttestPurchase.tsx` — form + result panel + download button.
- `scripts/test_xpaths.py` — local XPath smoke test.
- `example-order.html` — fixture used by the smoke test.
