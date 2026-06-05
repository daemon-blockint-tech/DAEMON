import { tokenize } from "../semantic-layer/semantic-index.js";
import type { TextEmbedder } from "./text-embedder.js";

/**
 * Deterministic, dependency-free embedding pipeline. Hashes tokens into a
 * fixed-width bag-of-words vector and L2-normalizes it. Deterministic output is
 * essential so tests and the Rust shim can be compared for parity.
 */
export class EmbeddingPipeline implements TextEmbedder {
  readonly dimension: number;

  constructor(dimension = 64) {
    if (dimension <= 0) throw new Error("dimension must be > 0");
    this.dimension = dimension;
  }

  private hash(token: string): number {
    let h = 2166136261;
    for (let i = 0; i < token.length; i++) {
      h ^= token.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return Math.abs(h) % this.dimension;
  }

  embed(text: string): number[] {
    const vector = new Array<number>(this.dimension).fill(0);
    for (const token of tokenize(text)) {
      vector[this.hash(token)] += 1;
    }
    const norm = Math.sqrt(vector.reduce((s, v) => s + v * v, 0));
    if (norm === 0) return vector;
    return vector.map((v) => v / norm);
  }
}
