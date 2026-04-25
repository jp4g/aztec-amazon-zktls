import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { Fr } from "@aztec/aztec.js/fields";
import { getInitialTestAccountsData } from "@aztec/accounts/testing";
import { EmbeddedWallet } from "@aztec/wallets/embedded";
import { AztecAddress } from "@aztec/aztec.js/addresses";

import {
  CIRCUIT_DIMS,
  computeAddressCommitment,
  packBytesNodash,
  parseAttestation,
  poseidon2Hash,
  type PrimusAttestation,
} from "@amazon-zktls/circuit";

import {
  TOKEN_METADATA,
  addOracleKey,
  balanceOfPrivate,
  deployEscrowContract,
  deployOracleContract,
  deployTokenContract,
  depositToEscrow,
  fillOrder,
  getEscrowContract,
  getOracleContract,
  getTokenContract,
  wad,
} from "../src/index.js";

const L2_NODE_URL = process.env.L2_NODE_URL ?? "http://localhost:8080";

// Bounty in USDC (6 decimals).
const ORDER_AMOUNT = wad(100n, 6n); // 100 USDC

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = resolve(
  HERE,
  "../../circuit/test/fixtures/attestation-amazon.json",
);

// Recompute the (asin, address_commitment, attestor_pubkey_hash) Field
// values that `verify(...)` will produce on this fixture, so the order's
// stored config matches what the proof asserts on fill.
async function deriveOrderFields(att: PrimusAttestation) {
  const plaintexts = att._plaintexts;
  if (!plaintexts) {
    throw new Error(
      "fixture missing _plaintexts sidecar - regenerate via the frontend",
    );
  }

  // ASIN: 10 ASCII bytes after `/dp/` in productTitle, packed LE into one Field.
  const productTitle = plaintexts.productTitle;
  const dpIdx = productTitle.indexOf("/dp/");
  if (dpIdx === -1) throw new Error("/dp/ not found in productTitle");
  const asinStr = productTitle.slice(dpIdx + 4, dpIdx + 14);
  if (asinStr.length !== 10) throw new Error("ASIN window too short");
  const asinBytes = new TextEncoder().encode(asinStr);
  const asin = packBytesNodash(asinBytes, 10)[0];

  // Address commitment: extract the 4 trimmed shipTo lines, recompute via
  // the same poseidon2-of-packed-fields recipe the circuit uses.
  const shipTo = plaintexts.shipTo;
  const LI_OPEN = 'class="a-list-item">\n                ';
  const LI_CLOSE = "\n            </span></li>";
  const BR = "<br>";

  const opens: number[] = [];
  for (let i = 0; ; ) {
    const f = shipTo.indexOf(LI_OPEN, i);
    if (f === -1) break;
    opens.push(f + LI_OPEN.length);
    i = f + 1;
  }
  const closes: number[] = [];
  for (let i = 0; ; ) {
    const f = shipTo.indexOf(LI_CLOSE, i);
    if (f === -1) break;
    closes.push(f);
    i = f + 1;
  }
  if (opens.length !== 3 || closes.length !== 3) {
    throw new Error(
      `shipTo template mismatch: ${opens.length} opens, ${closes.length} closes`,
    );
  }
  // <br> sits inside the second <li>, between street and city_state_zip.
  let br = -1;
  for (let i = opens[1]; i < closes[1]; ) {
    const f = shipTo.indexOf(BR, i);
    if (f === -1 || f >= closes[1]) break;
    br = f;
    i = f + 1;
  }
  if (br === -1) throw new Error("<br> not found inside second <li>");

  const name = shipTo.slice(opens[0], closes[0]);
  const street = shipTo.slice(opens[1], br);
  const city_state_zip = shipTo.slice(br + BR.length, closes[1]);
  const country = shipTo.slice(opens[2], closes[2]);

  const addressCommitment = await computeAddressCommitment({
    name,
    street,
    city_state_zip,
    country,
  });

  // Attestor pubkey hash: poseidon2(pack_bytes(public_key_x ‖ public_key_y, 64))
  // - same recipe the contract derives inline.
  const inputs = parseAttestation(att, plaintexts);
  const pubkeyBytes = new Uint8Array(64);
  pubkeyBytes.set(inputs.public_key_x, 0);
  pubkeyBytes.set(inputs.public_key_y, 32);
  const pubkeyHash = await poseidon2Hash(packBytesNodash(pubkeyBytes, 64));

  return { asin, addressCommitment, pubkeyHash, inputs };
}

describe("AmazonEscrow happy path", () => {
  // Account 1: minter + order creator. Account 2: filler.
  // Two TestWallets, each with its own PXE state - the OTC pubkey pattern
  // requires registerContract on every wallet that reads the escrow's notes.
  let wallet1: EmbeddedWallet;
  let wallet2: EmbeddedWallet;
  let account1Address: AztecAddress;
  let account2Address: AztecAddress;

  let usdcAddress: AztecAddress;
  let oracleAddress: AztecAddress;
  let escrow: Awaited<ReturnType<typeof deployEscrowContract>>;
  let circuitInputs: Awaited<ReturnType<typeof deriveOrderFields>>["inputs"];

  beforeAll(async () => {
    const fixture = JSON.parse(
      readFileSync(FIXTURE_PATH, "utf-8"),
    ) as PrimusAttestation;

    const derived = await deriveOrderFields(fixture);
    circuitInputs = derived.inputs;

    const node = createAztecNodeClient(L2_NODE_URL);

    wallet1 = await EmbeddedWallet.create(node, { ephemeral: true });
    wallet2 = await EmbeddedWallet.create(node, { ephemeral: true });

    const initial = await getInitialTestAccountsData();
    if (!initial[0] || !initial[1]) {
      throw new Error("need at least 2 prefunded accounts on the localnet");
    }
    const a1 = await wallet1.createSchnorrAccount(
      initial[0].secret,
      initial[0].salt,
      initial[0].signingKey,
    );
    const a2 = await wallet2.createSchnorrAccount(
      initial[1].secret,
      initial[1].salt,
      initial[1].signingKey,
    );
    account1Address = a1.address;
    account2Address = a2.address;
    await wallet1.registerSender(account2Address, "filler");
    await wallet2.registerSender(account1Address, "creator");

    // USDC.
    const usdc = await deployTokenContract(
      wallet1,
      account1Address,
      TOKEN_METADATA.usdc,
    );
    usdcAddress = usdc.contract.address;
    await usdc.contract
      .withWallet(wallet1)
      .methods.mint_to_private(account1Address, ORDER_AMOUNT)
      .send({ from: account1Address });
    await getTokenContract(wallet2, node, usdcAddress);

    // Oracle. Register the fixture's attestor pubkey hash so fill_order
    // doesn't revert with "uninitialized PublicImmutable".
    const oracle = await deployOracleContract(
      wallet1,
      account1Address,
      account1Address,
    );
    oracleAddress = oracle.contract.address;
    await addOracleKey(
      wallet1,
      account1Address,
      oracle.contract,
      derived.pubkeyHash,
    );
    await getOracleContract(wallet2, node, oracleAddress);

    // Escrow. asin/address_commitment match what verify(...) will compute.
    escrow = await deployEscrowContract(
      wallet1,
      account1Address,
      usdcAddress,
      ORDER_AMOUNT,
      derived.asin,
      derived.addressCommitment,
      oracleAddress,
    );

    // Filler's wallet needs the escrow's secret key to read the config note.
    await getEscrowContract(
      wallet2,
      escrow.contract.address,
      escrow.instance,
      escrow.secretKey,
    );
    await wallet1.registerSender(escrow.contract.address, "escrow");
    await wallet2.registerSender(escrow.contract.address, "escrow");
  }, 10 * 60 * 1000);

  it("creator deposits, filler proves and claims the bounty", async () => {
    const node = createAztecNodeClient(L2_NODE_URL);
    const usdcOnW1 = await getTokenContract(wallet1, node, usdcAddress);
    const usdcOnW2 = await getTokenContract(wallet2, node, usdcAddress);

    expect(await balanceOfPrivate(wallet1, account1Address, usdcOnW1)).toBe(
      ORDER_AMOUNT,
    );
    expect(await balanceOfPrivate(wallet2, account2Address, usdcOnW2)).toBe(0n);

    // Creator deposits the bounty.
    await depositToEscrow(
      wallet1,
      account1Address,
      escrow.contract,
      usdcOnW1,
      ORDER_AMOUNT,
    );
    expect(await balanceOfPrivate(wallet1, account1Address, usdcOnW1)).toBe(0n);

    // Filler runs the verifier and claims. Note circuitInputs.timestamp is a
    // decimal string from parseAttestation; aztec.js wants bigint for u64.
    await fillOrder(wallet2, account2Address, escrow.contract, {
      publicKeyX: circuitInputs.public_key_x,
      publicKeyY: circuitInputs.public_key_y,
      hash: circuitInputs.hash,
      signature: circuitInputs.signature,
      allowedUrl: circuitInputs.allowed_url,
      requestUrl: circuitInputs.request_url,
      recipient: circuitInputs.recipient,
      timestamp: BigInt(circuitInputs.timestamp),
      hashes: circuitInputs.hashes,
      contents: circuitInputs.contents,
      shipToHints: circuitInputs.ship_to_hints,
      grandTotalLen: circuitInputs.grand_total_len,
    });

    expect(await balanceOfPrivate(wallet2, account2Address, usdcOnW2)).toBe(
      ORDER_AMOUNT,
    );
  });
});
