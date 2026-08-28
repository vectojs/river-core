/**
 * Generation guard for asynchronous work — mirrors chat async-generation.ts (26 lines).
 */

export class AsyncGeneration {
  private generation = 0;
  private destroyed = false;

  next(): number {
    if (this.destroyed) return this.generation;
    this.generation += 1;
    return this.generation;
  }

  isCurrent(generation: number): boolean {
    return !this.destroyed && generation === this.generation;
  }

  destroy(): void {
    this.destroyed = true;
    this.generation += 1;
  }
}
