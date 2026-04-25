// Post-processing for `aztec codegen` output.
//
// `aztec codegen` produces .ts wrappers that import a sibling .json by a path
// relative to the *target/* directory. We move both .ts and .json under
// src/artifacts/<name>/ and rewrite the import to a flat sibling reference.
//
// Mirrors aztec-otc-desk/packages/contracts/scripts/add_artifacts.ts but
// runs on Node (tsx) instead of bun, and handles three contracts.

import { copyFile, readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const contractsDir = resolve(here, "..");

type Artifact = {
  /** Source .json under nr/target or codegen --outdir. */
  jsonSrc: string;
  /** Source .ts under codegen --outdir. */
  tsSrc: string;
  /** Destination directory under src/artifacts/. */
  destDir: string;
  /** Final flat .json filename inside destDir. */
  destJson: string;
  /** Final flat .ts filename inside destDir. */
  destTs: string;
  /** The relative-path string emitted by codegen for the JSON import. */
  importNeedle: string;
};

const artifacts: Artifact[] = [
  {
    jsonSrc: "nr/target/amazon_escrow-AmazonEscrow.json",
    tsSrc: "src/artifacts/escrow/AmazonEscrow.ts",
    destDir: "src/artifacts/escrow",
    destJson: "AmazonEscrow.json",
    destTs: "AmazonEscrow.ts",
    importNeedle: "../../../nr/target/amazon_escrow-AmazonEscrow.json",
  },
  {
    jsonSrc: "nr/target/attestor_key_oracle-AttestorKeyOracle.json",
    tsSrc: "src/artifacts/oracle/AttestorKeyOracle.ts",
    destDir: "src/artifacts/oracle",
    destJson: "AttestorKeyOracle.json",
    destTs: "AttestorKeyOracle.ts",
    importNeedle:
      "../../../nr/target/attestor_key_oracle-AttestorKeyOracle.json",
  },
  {
    jsonSrc: "deps/aztec-standards/target/token_contract-Token.json",
    tsSrc: "src/artifacts/token/Token.ts",
    destDir: "src/artifacts/token",
    destJson: "Token.json",
    destTs: "Token.ts",
    importNeedle:
      "../../../deps/aztec-standards/target/token_contract-Token.json",
  },
];

async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

async function copyArtifact(art: Artifact): Promise<void> {
  const destDirAbs = join(contractsDir, art.destDir);
  await ensureDir(destDirAbs);

  const jsonDest = join(destDirAbs, art.destJson);
  await copyFile(join(contractsDir, art.jsonSrc), jsonDest);
  console.log(`  json  ${art.jsonSrc} -> ${art.destDir}/${art.destJson}`);

  // The .ts is already in destDir (codegen --outdir put it there). Just fix
  // its JSON import path.
  const tsAbs = join(contractsDir, art.tsSrc);
  const before = await readFile(tsAbs, "utf-8");
  const after = before.split(art.importNeedle).join(`./${art.destJson}`);
  if (after === before) {
    console.warn(
      `  warn  ${art.tsSrc} did not contain expected import "${art.importNeedle}"`,
    );
  }
  await writeFile(tsAbs, after, "utf-8");
  console.log(`  ts    fixed import in ${art.tsSrc}`);
}

async function main(): Promise<void> {
  console.log("post-processing aztec codegen output:");
  for (const art of artifacts) {
    console.log(`- ${art.destDir}/${art.destJson}`);
    await copyArtifact(art);
  }
  console.log("done.");
}

main().catch((err) => {
  console.error("add_artifacts failed:", err);
  process.exit(1);
});
