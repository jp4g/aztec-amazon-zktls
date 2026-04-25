// End-to-end: load a real attestation fixture (with `_plaintexts` sidecar
// attached by AttestPurchaseBrowser's download), parse it into circuit
// inputs, execute (witness generation catches constraint failures before
// paying bb.js prove time), prove, verify.
//
// If the fixture pre-dates the sidecar, the tests skip with a note on how
// to regenerate. We deliberately don't re-run the browser XPath extractor
// at test time (jsdom's DOMParser doesn't byte-match libxml2's, which is
// the only representation Primus' attestor hashed).

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
const ATT_PATH = resolve(FIXTURES, "attestation-1777082410431.json");

async function loadFixture(): Promise<{
  att: PrimusAttestation;
  plaintexts: Record<string, string> | null;
}> {
  const att = JSON.parse(await readFile(ATT_PATH, "utf-8")) as PrimusAttestation;
  return { att, plaintexts: att._plaintexts ?? null };
}

describe("amazon-zktls verify", () => {
  let prover: AttestationProver;
  let fixtureHasPlaintexts = false;

  beforeAll(async () => {
    const { plaintexts } = await loadFixture();
    fixtureHasPlaintexts = plaintexts !== null;
    if (!fixtureHasPlaintexts) {
      // Surface the skip reason once at the top of the test run so the user
      // isn't chasing three identical "skipped" entries.
      console.warn(
        `[verify.test] fixture ${ATT_PATH} has no \`_plaintexts\` sidecar — ` +
          `skipping prove/verify. Regenerate by running the frontend ` +
          `(\`pnpm --filter @amazon-zktls/frontend dev\`), completing an attestation, ` +
          `and clicking "Download attestation.json"; the new file ` +
          `includes the plaintexts the Noir circuit needs as private inputs.`,
      );
    }
    const circuit = await loadCircuit();
    prover = new AttestationProver({ circuit });
    await prover.init();
  });

  afterAll(async () => {
    await prover?.destroy();
  });

  it.skipIf(() => !fixtureHasPlaintexts)(
    "parses the attestation into circuit inputs",
    async () => {
      const { att, plaintexts } = await loadFixture();
      const inputs = parseAttestation(att, plaintexts!);
      expect(inputs.public_key_x).toHaveLength(32);
      expect(inputs.public_key_y).toHaveLength(32);
      expect(inputs.signature).toHaveLength(64);
      expect(inputs.hash).toHaveLength(32);
      expect(inputs.request_url.len).toBe(att.request.url.length);
    },
  );

  it.skipIf(() => !fixtureHasPlaintexts)(
    "executes the circuit (witness generation) without failing a constraint",
    async () => {
      const { att, plaintexts } = await loadFixture();
      const inputs = parseAttestation(att, plaintexts!);
      await expect(prover.execute(inputs)).resolves.toBeDefined();
    },
  );

  it.skipIf(() => !fixtureHasPlaintexts)(
    "proves and verifies end-to-end",
    async () => {
      const { att, plaintexts } = await loadFixture();
      const inputs = parseAttestation(att, plaintexts!);
      const proof = await prover.prove(inputs);
      expect(proof.proof).toBeInstanceOf(Uint8Array);
      expect(proof.publicInputs.length).toBeGreaterThan(0);
      const ok = await prover.verify(proof);
      expect(ok).toBe(true);
    },
  );
});
