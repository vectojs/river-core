/**
 * StreamState — single source of truth for the streaming session.
 * Mirrors gallery chat state.ts (CTX-0052 analysis) — pure playback logic.
 */

export type StreamStatus = 'idle' | 'streaming' | 'paused' | 'done';

export interface StreamState {
  /** Full Markdown source of the loaded file. */
  content: string;
  /** `content` split into playback units. */
  tokens: string[];
  /** Display name of the loaded file. */
  fileName: string;
  /** Index of the next token to stream. */
  cursor: number;
  /** Current play state. */
  status: StreamStatus;
  /** Tokens per second (1 token ≈ 1 character for benchmark). */
  tokenRate: number;
  /** Accumulated fractional token count from last frame. */
  accumulator: number;
  /** Whether to loop when done. */
  loop: boolean;
}

export function createStreamState(): StreamState {
  return {
    content: '',
    tokens: [],
    fileName: '',
    cursor: 0,
    status: 'idle',
    tokenRate: 100,
    accumulator: 0,
    loop: false,
  };
}

/**
 * Advance stream by `dt` ms, returning text revealed this tick.
 */
export function tickStream(state: StreamState, dt: number): string {
  if (state.status !== 'streaming') return '';
  if (state.cursor >= state.tokens.length) {
    state.status = 'done';
    return '';
  }

  const tokensPerMs = state.tokenRate / 1000;
  state.accumulator += tokensPerMs * dt;
  const toAdd = Math.floor(state.accumulator);
  state.accumulator -= toAdd;

  if (toAdd === 0) return '';

  const end = Math.min(state.cursor + toAdd, state.tokens.length);
  let chunk = '';
  for (let i = state.cursor; i < end; i++) chunk += state.tokens[i];
  state.cursor = end;

  if (state.cursor >= state.tokens.length) state.status = 'done';
  return chunk;
}

/** Rewind playback to start without touching loaded source. */
export function rewindStream(state: StreamState): void {
  state.cursor = 0;
  state.accumulator = 0;
}

/**
 * Split text into tokens simulating an LLM tokenizer.
 * - ![alt](url): whole span one token (data URI guard)
 * - Chinese 1-2 chars per token
 * - English words with trailing space / punctuation
 */
export function tokenize(text: string): string[] {
  if (!text) return [];
  const regex =
    /!\[[^\]]*\]\([^)]*\)|[一-龥]{1,2}|[a-zA-Z0-9]+(?:'[a-zA-Z]+)?\s*|[^一-龥a-zA-Z0-9\s]|\s+/g;
  const matches = text.match(regex);
  return matches ?? [text];
}
