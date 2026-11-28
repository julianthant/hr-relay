export function createLogWriterBatch<Entry>(maxWaitMs: number, write: (rows: readonly Entry[]) => void, acknowledge: (through: number) => void) {
  let timer: ReturnType<typeof setTimeout> | undefined, through = 0;
  const queued: Entry[] = [];
  const drain = () => {
    clearTimeout(timer);
    timer = undefined;
    if (queued.length > 0) {
      write(queued);
      queued.length = 0;
    }
  };
  const flush = (sequence = through) => {
    drain();
    acknowledge(sequence);
  };
  return {
    append(sequence: number, mutation: Entry, stepEnd: boolean) {
      through = sequence;
      queued.push(mutation);
      if (stepEnd || queued.length >= 50) flush();
      else timer ??= setTimeout(flush, maxWaitMs);
    },
    drain,
    flush,
  };
}
