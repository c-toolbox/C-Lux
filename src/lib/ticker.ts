// Matches the server tick rate; posting faster only adds requests the engine never sees.
export const CAPTURE_INTERVAL_MS = 1000 / 30;

// A metronome living on the audio rendering thread. Browsers throttle timers in hidden
// tabs down to about one tick a second, which starves the server of frames and makes the
// lights stall; the audio thread keeps its own clock and is never throttled. It passes
// its input through untouched so it can sit in the graph without colouring the signal.
const TICKER_NAME = 'capture-ticker';
const TICKER_MODULE = `
registerProcessor('${TICKER_NAME}', class extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.period = options.processorOptions.period;
    this.next = 0;
  }
  process() {
    if (currentTime >= this.next) {
      this.next = currentTime + this.period;
      this.port.postMessage(0);
    }
    return true;
  }
});
`;

// Call `onTick` about every `CAPTURE_INTERVAL_MS`, from the audio thread where possible
// and from a timer where the worklet cannot be loaded (no support, or a CSP blocking
// blobs). Returns a function that stops the ticker.
export async function startTicker(
  context: AudioContext,
  onTick: () => void
): Promise<() => void> {
  const period = CAPTURE_INTERVAL_MS / 1000;

  try {
    const url = URL.createObjectURL(
      new Blob([TICKER_MODULE], { type: 'text/javascript' })
    );
    try {
      await context.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }

    const ticker = new AudioWorkletNode(context, TICKER_NAME, {
      processorOptions: { period }
    });
    // A node is only rendered while it reaches the destination; the processor writes
    // nothing, so what arrives there is silence.
    ticker.connect(context.destination);
    ticker.port.onmessage = onTick;

    return () => {
      ticker.port.onmessage = null;
      ticker.disconnect();
    };
  } catch {
    const timer = setInterval(onTick, CAPTURE_INTERVAL_MS);
    return () => clearInterval(timer);
  }
}

// The same metronome for callers that have no audio graph of their own, wrapping a
// context created purely to borrow its clock.
export async function startStandaloneTicker(onTick: () => void): Promise<() => void> {
  const context = new AudioContext();
  await context.resume();
  const stop = await startTicker(context, onTick);
  return () => {
    stop();
    void context.close();
  };
}
