/**
 * File I/O for River stream reader.
 * Mirrors gallery chat parser.ts — accepted extensions + isAcceptedFile gate.
 */

export interface LoadedFile {
  /** Markdown source streamed into Markdown.createStream(). */
  source: string;
  /** Display name. */
  fileName: string;
}

/** File extensions offered by picker and accepted by drop zone. */
export const ACCEPTED_EXTENSIONS = '.md,.markdown,.txt';

/**
 * Does this file look like Markdown source we should load?
 * Extension, not MIME (see gallery chat parser.ts for rationale).
 */
export function isAcceptedFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return ACCEPTED_EXTENSIONS.split(',').some((ext) => name.endsWith(ext));
}

export async function loadFile(file: File): Promise<LoadedFile> {
  return { source: await file.text(), fileName: file.name };
}
