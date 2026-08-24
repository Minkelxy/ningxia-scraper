// Ambient type declarations for packages without official types

declare module "simhash-js" {
  /**
   * Compute a 64-bit simhash fingerprint of the given text.
   * Returns a 16-character lowercase hex string (64 bits).
   */
  export function fingerprint(text: string, kgramLength?: number): string;

  /**
   * Compute the Hamming distance between two hex-encoded simhash fingerprints
   * (each must be a 16-char hex string representing 64 bits).
   */
  export function hammingDistance(a: string, b: string): number;
}
