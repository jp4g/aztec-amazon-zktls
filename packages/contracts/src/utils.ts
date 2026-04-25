// Token-amount helper. `wad(10n, 6n)` = 10 * 10^6 (USDC scale).
export const wad = (n: bigint = 1n, decimals: bigint = 18n): bigint =>
  n * 10n ** decimals;
