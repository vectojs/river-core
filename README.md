# @vectojs/river-core

Pure-TS streaming model for River (LLM typewriter) — no Canvas, DOM, or storage imports beyond `File` for `isAcceptedFile` gate. Tested with `bun test`.

- `StreamState` + `createStreamState` / `tickStream` / `rewindStream` / `tokenize` — playback state and tokenizer (mirrors `gallery/src/creations/chat/state.ts`)
- `fileIo` — `ACCEPTED_EXTENSIONS`, `isAcceptedFile`, `loadFile` (extension gate, both picker and drop must use)
- `AsyncGeneration` — generation guard for cancellable async work (mirrors `chat/async-generation.ts`)

## Usage

```ts
import { createStreamState, tickStream, tokenize } from "@vectojs/river-core";
const state = createStreamState();
state.content = "# hello";
state.tokens = tokenize(state.content);
state.status = "streaming";
const chunk = tickStream(state, 16.67);
```

## Development

```bash
bun install
bun run check
bun test
bun run build
```
