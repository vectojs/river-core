import { describe, expect, test } from 'bun:test';
import {
  AsyncGeneration,
  collectDocumentText,
  createStreamState,
  findMatches,
  isAcceptedFile,
  lineAt,
  rewindStream,
  tickStream,
  tokenize,
  ACCEPTED_EXTENSIONS,
} from '../src/index';
import type { SearchEntity } from '../src/model/searchIndex';

function named(name: string): File {
  return { name } as File;
}

type FakeProjection = {
  text: string;
  contentY?: number;
  lines?: Array<{
    text: string;
    y?: number;
    lineHeight?: number;
    separatorAfter?: string;
  }>;
};

function fakeEntity(
  y: number,
  projection: FakeProjection | null,
  children: SearchEntity[] = [],
): SearchEntity {
  return {
    y,
    children,
    getContentProjection: () => projection,
  };
}

// ---------------------------------------------------------------------------
// tokenize — gallery chat/state.ts:101-107
// ---------------------------------------------------------------------------

describe('tokenize (simulated LLM tokenizer)', () => {
  test('concatenating the tokens reproduces the input exactly', () => {
    const s = 'Hello, **world**!\n\nA new line.';
    expect(tokenize(s).join('')).toBe(s);
  });

  test('splits English words with trailing space as one token', () => {
    expect(tokenize('hi there')).toEqual(['hi ', 'there']);
  });

  test('groups Chinese characters 1-2 per token', () => {
    const cjk = '你好世界';
    const tokens = tokenize(cjk);
    expect(tokens.join('')).toBe(cjk);
    for (const t of tokens) expect(t.length).toBeLessThanOrEqual(2);
  });

  test('empty string yields no tokens', () => {
    expect(tokenize('')).toEqual([]);
  });

  test('an image span is one atomic token however long its URL', () => {
    // data: URI can run to hundreds of thousands of base64 chars — would
    // "type out" as minutes of gibberish if split. Whole span must be one token.
    const src = `![alt](data:image/png;base64,${'AAAA+/'.repeat(200)})`;
    expect(tokenize(src)).toEqual([src]);
  });

  test('a single image token can exceed the stream buffer default', () => {
    const DEFAULT_MAX_BUFFERED_CHARS = 64 * 1024;
    const src = `![alt](data:image/png;base64,${'A'.repeat(70_000)})`;
    const tokens = tokenize(src);
    expect(tokens).toHaveLength(1);
    expect(tokens[0].length).toBeGreaterThan(DEFAULT_MAX_BUFFERED_CHARS);
    expect(src.length).toBeGreaterThanOrEqual(tokens[0].length);
  });

  test('image token atomicity would fail if split at punctuation', () => {
    // This is the fidelity gate: if the image regex were after the word rule,
    // the data URI would be shattered on every + / = and produce thousands of tokens.
    const src = 'prefix ![a](data:image/png;base64,AAA+/BBB==) suffix';
    const tokens = tokenize(src);
    const imageTokens = tokens.filter((t) => t.startsWith('!['));
    expect(imageTokens).toHaveLength(1);
    expect(imageTokens[0]).toBe('![a](data:image/png;base64,AAA+/BBB==)');
    // The surrounding text must also round-trip
    expect(tokens.join('')).toBe(src);
  });
});

// ---------------------------------------------------------------------------
// tickStream / rewindStream — gallery chat/state.ts:57-86
// ---------------------------------------------------------------------------

describe('tickStream', () => {
  function streaming(content: string, tokenRate: number) {
    const state = createStreamState();
    state.content = content;
    state.tokens = tokenize(content);
    state.status = 'streaming';
    state.tokenRate = tokenRate;
    return state;
  }

  test('returns revealed chunk which is a prefix of the source', () => {
    const state = streaming('abcde', 1000);
    const chunk = tickStream(state, 3);
    expect(chunk.length).toBeGreaterThan(0);
    expect(state.content.startsWith(chunk)).toBe(true);
  });

  test('consecutive ticks return only what is new, never accumulated text', () => {
    const state = streaming('abcdef', 1000);
    const first = tickStream(state, 2);
    const second = tickStream(state, 2);
    expect(state.content.startsWith(first + second)).toBe(true);
    expect(second).not.toContain(first);
  });

  test('transitions to done once all tokens are consumed', () => {
    const state = streaming('ab', 100_000);
    expect(tickStream(state, 1000)).toBe('ab');
    expect(state.status).toBe('done');
  });

  test('does not loop on its own — caller drives replay', () => {
    const state = streaming('ab', 100_000);
    state.loop = true;
    expect(tickStream(state, 1000)).toBe('ab');
    expect(state.status).toBe('done');
  });

  test('a non-streaming state never advances', () => {
    const state = streaming('abcde', 1000);
    state.status = 'paused';
    expect(tickStream(state, 100)).toBe('');
    expect(state.cursor).toBe(0);
  });

  test('a tick too short to complete a token reveals nothing (accumulator)', () => {
    const state = streaming('abcde', 100);
    expect(tickStream(state, 1)).toBe('');
    expect(state.cursor).toBe(0);
    // Accumulator should hold fractional progress; next tick may complete.
    expect(state.accumulator).toBeGreaterThan(0);
    expect(state.accumulator).toBeLessThan(1);
  });

  test('accumulator carries fractional tokens across ticks', () => {
    // "a b c ..." yields 10 tokens ("a ", "b ", ...). Use spaced content so
    // each char is its own token and fractional accumulation is observable.
    const state = streaming('a b c d e f g h i j', 100); // 0.1 token/ms
    expect(tickStream(state, 5)).toBe(''); // 0.5 token — not enough
    expect(tickStream(state, 5)).toBe('a '); // now 1.0 — emits one token
    expect(state.cursor).toBe(1);
  });
});

describe('rewindStream', () => {
  test('resets playback position without discarding source', () => {
    const state = createStreamState();
    state.content = 'abc';
    state.tokens = tokenize('abc');
    state.fileName = 'doc.md';
    state.status = 'streaming';
    state.tokenRate = 100_000;
    expect(tickStream(state, 1000)).toBe('abc');
    expect(state.cursor).toBe(state.tokens.length);

    rewindStream(state);
    expect(state.cursor).toBe(0);
    expect(state.accumulator).toBe(0);
    expect(state.content).toBe('abc');
    expect(state.fileName).toBe('doc.md');
  });
});

// ---------------------------------------------------------------------------
// fileIo — gallery chat/parser.ts:21-44
// ---------------------------------------------------------------------------

describe('isAcceptedFile gates the destructive load path', () => {
  test('accepts every extension the picker filter advertises', () => {
    for (const ext of ACCEPTED_EXTENSIONS.split(',')) {
      expect(isAcceptedFile(named(`notes${ext}`))).toBe(true);
    }
  });

  test('accepts .md, .markdown and .txt', () => {
    expect(isAcceptedFile(named('README.md'))).toBe(true);
    expect(isAcceptedFile(named('README.markdown'))).toBe(true);
    expect(isAcceptedFile(named('notes.txt'))).toBe(true);
  });

  test('is case-insensitive', () => {
    expect(isAcceptedFile(named('README.MD'))).toBe(true);
    expect(isAcceptedFile(named('NOTES.Txt'))).toBe(true);
  });

  test('rejects the SVG that a dragged display formula hands over', () => {
    expect(isAcceptedFile(named('download.svg'))).toBe(false);
  });

  test('rejects binaries that would load as mojibake', () => {
    for (const name of ['photo.png', 'scan.pdf', 'archive.zip', 'clip.mp4']) {
      expect(isAcceptedFile(named(name))).toBe(false);
    }
  });

  test('rejects an extensionless file', () => {
    expect(isAcceptedFile(named('LICENSE'))).toBe(false);
  });

  test('matches the final extension, not one embedded in the stem', () => {
    expect(isAcceptedFile(named('notes.md.png'))).toBe(false);
    expect(isAcceptedFile(named('report.txt.zip'))).toBe(false);
    expect(isAcceptedFile(named('my.md.notes.md'))).toBe(true);
  });
});

describe('loadFile', () => {
  test('reads source and preserves fileName', async () => {
    const { loadFile } = await import('../src/model/fileIo');
    const file = new File(['# hello\nworld'], 'doc.md', {
      type: 'text/markdown',
    });
    const loaded = await loadFile(file);
    expect(loaded.source).toBe('# hello\nworld');
    expect(loaded.fileName).toBe('doc.md');
  });
});

// ---------------------------------------------------------------------------
// AsyncGeneration — gallery chat/async-generation.ts
// ---------------------------------------------------------------------------

describe('AsyncGeneration', () => {
  test('supersedes an older overlapping operation', () => {
    const gate = new AsyncGeneration();
    const older = gate.next();
    const newer = gate.next();
    expect(gate.isCurrent(older)).toBe(false);
    expect(gate.isCurrent(newer)).toBe(true);
  });

  test('invalidates pending work when destroyed', () => {
    const gate = new AsyncGeneration();
    const pending = gate.next();
    gate.destroy();
    expect(gate.isCurrent(pending)).toBe(false);
    expect(gate.next()).toBe(pending + 1);
    expect(gate.isCurrent(pending + 1)).toBe(false);
  });

  test('a close continuation cannot publish after a newer generation starts', () => {
    const gate = new AsyncGeneration();
    const closeGen = gate.next();
    gate.next();
    expect(gate.isCurrent(closeGen)).toBe(false);
  });

  test('destroy then next returns stale generation and isCurrent false', () => {
    const gate = new AsyncGeneration();
    const g1 = gate.next();
    gate.destroy();
    const after = gate.next();
    expect(after).toBe(g1 + 1);
    expect(gate.isCurrent(after)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// searchIndex — gallery chat/search.ts (pure port)
// ---------------------------------------------------------------------------

describe('collectDocumentText', () => {
  test('collects rendered lines and accumulated entity offsets', () => {
    const root = fakeEntity(0, null, [
      fakeEntity(10, null, [
        fakeEntity(4, {
          text: 'hello world',
          lines: [
            { text: 'hello ', y: 2, lineHeight: 18, separatorAfter: ' ' },
            { text: 'world', y: 20, lineHeight: 18 },
          ],
        }),
      ]),
      fakeEntity(40, { text: 'second block' }),
    ]);

    const doc = collectDocumentText(root);

    expect(doc.text).toBe('hello  world\nsecond block');
    expect(doc.lines).toEqual([
      { start: 0, end: 6, y: 16, height: 18 },
      { start: 7, end: 12, y: 34, height: 18 },
      { start: 13, end: 25, y: 40, height: 20 },
    ]);
  });
});

describe('findMatches', () => {
  const doc = {
    text: 'Alpha beta\nGamma beta',
    lines: [
      { start: 0, end: 10, y: 12, height: 20 },
      { start: 11, end: 21, y: 48, height: 22 },
    ],
  };

  test('matches case-insensitively and resolves each match to a line', () => {
    expect(findMatches(doc, 'BETA')).toEqual([
      { index: 6, length: 4, y: 12, height: 20 },
      { index: 17, length: 4, y: 48, height: 22 },
    ]);
  });

  test('returns no matches for an empty query', () => {
    expect(findMatches(doc, '   ')).toEqual([]);
  });

  test('does not return overlapping occurrences', () => {
    expect(
      findMatches({ text: 'aaaa', lines: [{ start: 0, end: 4, y: 0, height: 20 }] }, 'aa'),
    ).toEqual([
      { index: 0, length: 2, y: 0, height: 20 },
      { index: 2, length: 2, y: 0, height: 20 },
    ]);
  });
});

describe('lineAt', () => {
  const doc = {
    text: 'one\ntwo',
    lines: [
      { start: 0, end: 3, y: 10, height: 20 },
      { start: 4, end: 7, y: 40, height: 20 },
    ],
  };

  test('returns the preceding line for a separator offset', () => {
    expect(lineAt(doc, 3)?.y).toBe(10);
  });

  test('returns undefined before the first line', () => {
    expect(lineAt(doc, -1)).toBeUndefined();
  });

  test('returns correct line for mid-document offset', () => {
    expect(lineAt(doc, 5)?.y).toBe(40);
  });
});
