import type { Readable, Writable } from 'node:stream';

import type { McpServer } from './server';

/** Une ligne plus longue que cela n'est pas un message raisonnable : elle est jetée (le tampon ne grossit pas sans fin). */
export const MAX_LINE_CHARS = 1_000_000;

export type StdioOptions = {
  input: Readable;
  output: Writable;
  server: McpServer;
  log?: (message: string) => void;
};

/**
 * Transport « stdio » de MCP : un message JSON par ligne, dans les deux sens. `output` ne reçoit QUE des réponses du
 * protocole ; tout diagnostic passe par `log` (stderr). Résout quand l'entrée est fermée et que tout est répondu.
 */
export function runStdio({ input, output, server, log }: StdioOptions): Promise<void> {
  const pending = new Set<Promise<void>>();
  let buffer = '';
  let discarding = false;

  const answer = (line: string): void => {
    const task = server
      .handle(line)
      .then((reply) => {
        if (reply !== undefined) output.write(`${reply}\n`);
      })
      .catch(() => log?.('a message could not be processed'))
      .finally(() => pending.delete(task));
    pending.add(task);
  };

  const feed = (chunk: string): void => {
    buffer += chunk;
    for (let end = buffer.indexOf('\n'); end !== -1; end = buffer.indexOf('\n')) {
      const line = buffer.slice(0, end).replace(/\r$/, '');
      buffer = buffer.slice(end + 1);
      if (discarding) discarding = false;
      else if (line.trim() !== '') answer(line);
    }
    if (buffer.length > MAX_LINE_CHARS) {
      log?.('a message exceeded the maximum size and was dropped');
      buffer = '';
      discarding = true;
    }
  };

  return new Promise((resolve) => {
    input.setEncoding('utf8');
    input.on('data', (chunk: string) => feed(chunk));
    input.on('end', () => {
      if (buffer.trim() !== '' && !discarding) answer(buffer);
      void Promise.all(pending).then(() => resolve());
    });
  });
}
