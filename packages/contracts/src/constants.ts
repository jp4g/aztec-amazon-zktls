import { AztecAddress } from "@aztec/aztec.js/addresses";

export const TOKEN_METADATA = {
  usdc: { name: "USD Coin", symbol: "USDC", decimals: 6 },
} as const;

export type EscrowConfig = {
  owner: AztecAddress;
  payment_token: AztecAddress;
  amount: bigint;
  asin: bigint;
  address_commitment: bigint;
  oracle_address: AztecAddress;
  randomness: bigint;
};
