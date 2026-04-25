// Browser-safe surface. `loadCircuit` (Node-only, uses `node:fs`) lives
// at `./load.js`; tests import it directly so the browser bundle never
// pulls `node:fs/promises` through the package barrel.
export * from "./types.js";
export * from "./encode.js";
export * from "./parser.js";
export * from "./prover.js";
export * from "./encode_outputs.js";
