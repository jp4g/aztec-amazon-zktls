// Stateful wrapper around noir_js + bb.js. Keeps the Noir executor and the
// UltraHonk backend alive across proofs so callers don't pay init cost per
// call. Exposes a small API now (init / execute / prove / verify); future
// work lives here too — poseidon commitments, recursion, etc.

import { Noir, type CompiledCircuit, type InputMap } from "@noir-lang/noir_js";
import { UltraHonkBackend, type ProofData } from "@aztec/bb.js";
import type { CircuitInputs } from "./types.js";

export interface ProverInit {
  circuit: CompiledCircuit;
}

export class AttestationProver {
  private readonly circuit: CompiledCircuit;
  private noir: Noir | null = null;
  private backend: UltraHonkBackend | null = null;

  constructor(init: ProverInit) {
    this.circuit = init.circuit;
  }

  // Lazy init so constructing the prover is free. First call loads the
  // Noir executor (WASM) and spins up the bb.js backend on the bytecode.
  async init(): Promise<void> {
    if (this.noir && this.backend) return;
    this.noir = new Noir(this.circuit);
    this.backend = new UltraHonkBackend(this.circuit.bytecode);
  }

  // Run the circuit in-process to get the witness — useful for catching
  // constraint failures before paying bb.js prove time.
  async execute(inputs: CircuitInputs): Promise<{ witness: Uint8Array; returnValue: unknown }> {
    if (!this.noir) await this.init();
    const { witness, returnValue } = await this.noir!.execute(inputs as unknown as InputMap);
    return { witness, returnValue };
  }

  async prove(inputs: CircuitInputs): Promise<ProofData> {
    if (!this.backend || !this.noir) await this.init();
    const { witness } = await this.noir!.execute(inputs as unknown as InputMap);
    return this.backend!.generateProof(witness);
  }

  async verify(proof: ProofData): Promise<boolean> {
    if (!this.backend) await this.init();
    return this.backend!.verifyProof(proof);
  }

  // Release WASM resources. Call once when the prover won't be reused.
  async destroy(): Promise<void> {
    await this.backend?.destroy();
    this.backend = null;
    this.noir = null;
  }
}
