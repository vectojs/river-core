import { describe, expect, test } from 'bun:test';
import { createStreamState, tickStream, tokenize } from '../src/index';

describe('StreamModel', () => {
  test('tokenize splits text', () => {
    const tokens = tokenize('hello world');
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens.join('')).toBe('hello world');
  });

  test('tickStream advances cursor', () => {
    const state = createStreamState();
    state.content = 'hello world';
    state.tokens = tokenize(state.content);
    state.fileName = 'test.md';
    state.status = 'streaming';
    state.tokenRate = 1000;
    const chunk = tickStream(state, 10);
    expect(chunk.length).toBeGreaterThan(0);
  });

  test('isAcceptedFile gate', async () => {
    const { isAcceptedFile } = await import('../src/model/fileIo');
    const mdFile = new File(['# hi'], 'note.md', { type: 'text/markdown' });
    const pngFile = new File([''], 'image.png', { type: 'image/png' });
    expect(isAcceptedFile(mdFile)).toBe(true);
    expect(isAcceptedFile(pngFile)).toBe(false);
  });
});
