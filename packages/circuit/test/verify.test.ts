// End-to-end: load the attestation fixture (with `_plaintexts` sidecar
// attached by AttestPurchaseBrowser's download), parse it into circuit
// inputs, execute (witness generation catches constraint failures before
// paying bb.js prove time), prove, verify.
//
// If the fixture is missing the sidecar, skipIf fires per test with a
// console note on how to regenerate. We deliberately don't re-run the
// browser XPath extractor at test time (jsdom's DOMParser doesn't
// byte-match libxml2's, which is the only representation Primus'
// attestor hashed).

import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import {
  AttestationProver,
  loadCircuit,
  parseAttestation,
  type PrimusAttestation,
} from "../src/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(HERE, "fixtures");
const ATT_PATH = resolve(FIXTURES, "attestation-amazon.json");

// Detect the sidecar synchronously at module load time — vitest evaluates
// `skipIf` before `beforeAll`, so an async flag in beforeAll would always
// read as false.
const FIXTURE_HAS_PLAINTEXTS = (() => {
  try {
    const parsed = JSON.parse(readFileSync(ATT_PATH, "utf-8")) as PrimusAttestation;
    return parsed._plaintexts !== undefined;
  } catch {
    return false;
  }
})();

if (!FIXTURE_HAS_PLAINTEXTS) {
  console.warn(
    `[verify.test] fixture ${ATT_PATH} has no \`_plaintexts\` sidecar - ` +
      `skipping prove/verify. Regenerate by running the frontend ` +
      `(\`pnpm --filter @amazon-zktls/frontend dev\`), completing an attestation, ` +
      `and clicking "Download attestation.json"; the new file ` +
      `includes the plaintexts the Noir circuit needs as private inputs.`,
  );
}

async function loadInputs() {
  const att = JSON.parse(await readFile(ATT_PATH, "utf-8")) as PrimusAttestation;
  return parseAttestation(att, att._plaintexts!);
}

describe("amazon-zktls verify", () => {
  let prover: AttestationProver;

  beforeAll(async () => {
    const circuit = await loadCircuit();
    prover = new AttestationProver({ circuit });
    await prover.init();
  });

  afterAll(async () => {
    await prover?.destroy();
  });

  it.skipIf(!FIXTURE_HAS_PLAINTEXTS)(
    "parses the attestation into circuit inputs",
    async () => {
      const att = JSON.parse(await readFile(ATT_PATH, "utf-8")) as PrimusAttestation;
      const inputs = parseAttestation(att, att._plaintexts!);
      expect(inputs.public_key_x).toHaveLength(32);
      expect(inputs.public_key_y).toHaveLength(32);
      expect(inputs.signature).toHaveLength(64);
      expect(inputs.hash).toHaveLength(32);
      expect(inputs.request_url.len).toBe(att.request.url.length);
    },
  );

  it.skipIf(!FIXTURE_HAS_PLAINTEXTS)(
    "executes the circuit (witness generation) without failing a constraint",
    async () => {
      const inputs = await loadInputs();
      await expect(prover.execute(inputs)).resolves.toBeDefined();
    },
  );

  it.skipIf(!FIXTURE_HAS_PLAINTEXTS)(
    "proves and verifies end-to-end",
    async () => {
      const inputs = await loadInputs();
      const proof = await prover.prove(inputs);
      expect(proof.proof).toBeInstanceOf(Uint8Array);
      expect(proof.publicInputs.length).toBeGreaterThan(0);
      const ok = await prover.verify(proof);
      expect(ok).toBe(true);
    },
  );
});
