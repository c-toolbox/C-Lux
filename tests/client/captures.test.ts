import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { audioFrame } from '../../shared/audio';
import { DEFAULT_VIDEO_GEOMETRY, videoStrip } from '../../shared/video';
import {
  AUDIO_INPUT_DEVICE,
  AUDIO_INPUT_SYSTEM,
  AUDIO_TYPE,
  type PatternParameters,
  VIDEO_TYPE
} from '../../src/lib/api';
import { startAudioCapture } from '../../src/lib/audio';
import {
  captureOf,
  DRAFT_CAPTURE,
  duplicateCapture,
  renameCapture,
  setVideoSettings,
  startAudio,
  startVideo,
  stopCapture,
  syncCaptures
} from '../../src/lib/captures';
import {
  startVideoCapture,
  VIDEO_INPUT_CAMERA,
  VIDEO_INPUT_NDI,
  VIDEO_SAMPLING_FISHEYE,
  VIDEO_SAMPLING_STRIP
} from '../../src/lib/video';

vi.mock('../../src/lib/audio', () => ({ startAudioCapture: vi.fn() }));
vi.mock('../../src/lib/video', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/video')>()),
  startVideoCapture: vi.fn()
}));

const startAudioMock = vi.mocked(startAudioCapture);
const startVideoMock = vi.mocked(startVideoCapture);

const audio = (name: string, input: number) =>
  ({ type: AUDIO_TYPE, name, input }) as unknown as PatternParameters;

const video = (name: string, input: number, sampling: number, radius = 1) =>
  ({
    type: VIDEO_TYPE,
    name,
    input,
    sampling,
    ndiSource: '',
    ...DEFAULT_VIDEO_GEOMETRY,
    radius
  }) as unknown as PatternParameters;

const removeVideo = vi.fn();

interface FakeStream {
  clone: () => FakeStream;
}
const fakeStream = (): FakeStream => ({ clone: vi.fn(fakeStream) });
const asStream = (stream: FakeStream) => stream as unknown as MediaStream;

beforeEach(() => {
  startAudioMock.mockImplementation(({ stream }) =>
    Promise.resolve({ stop: vi.fn(), stream: stream ?? asStream(fakeStream()) })
  );
  startVideoMock.mockImplementation(({ video, stream }) => {
    video.srcObject = stream ?? asStream(fakeStream());
    return Promise.resolve({ stop: vi.fn() });
  });
  vi.stubGlobal('document', {
    createElement: () => ({ style: {}, remove: removeVideo, srcObject: null }),
    body: { append: vi.fn() }
  });
});

afterEach(() => {
  syncCaptures([]);
  stopCapture(DRAFT_CAPTURE);
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('audio captures', () => {
  it('keeps running while the pattern asks for the same source', async () => {
    await startAudio('Mic', 'input');
    syncCaptures([audio('Mic', AUDIO_INPUT_DEVICE)]);
    expect(captureOf('Mic')?.kind).toBe('audio');
  });

  it('stops when the pattern is gone or asks for another source', async () => {
    await startAudio('Mic', 'input');
    const { stop } = captureOf('Mic')!;
    syncCaptures([audio('Mic', AUDIO_INPUT_SYSTEM)]);
    expect(stop).toHaveBeenCalled();
    expect(captureOf('Mic')).toBeUndefined();

    await startAudio('Mic', 'input');
    syncCaptures([]);
    expect(captureOf('Mic')).toBeUndefined();
  });

  it('feeds the new name after a rename', async () => {
    await startAudio('Old', 'system');
    renameCapture('Old', 'New');
    expect(captureOf('Old')).toBeUndefined();
    expect(captureOf('New')?.name).toBe('New');
    expect(startAudioMock.mock.calls[0][0].pattern()).toBe('New');
  });

  it('publishes its frames to the page for previews', async () => {
    await startAudio('Mic', 'system');
    const bands = new Array<number>(32).fill(0.5);
    startAudioMock.mock.calls[0][0].onFrame(bands, 0.25);
    bands.fill(0);
    expect(audioFrame('Mic').level).toBe(0.25);
    expect(audioFrame('Mic').bands[0]).toBe(0.5);
  });

  it('holds a draft back from the server until it is renamed', async () => {
    await startAudio(DRAFT_CAPTURE, 'system');
    const [[options]] = startAudioMock.mock.calls;
    expect(options.pattern()).toBeNull();

    syncCaptures([]);
    expect(captureOf(DRAFT_CAPTURE)).toBeDefined();

    renameCapture(DRAFT_CAPTURE, 'Added');
    expect(options.pattern()).toBe('Added');
  });

  it('drops a start that finishes after it was stopped', async () => {
    const stop = vi.fn();
    let resolve = (_handle: { stop: () => void; stream: MediaStream }) =>
      undefined as void;
    startAudioMock.mockImplementation(() => new Promise((r) => (resolve = r)));
    const starting = startAudio('Mic', 'system');
    stopCapture('Mic');
    resolve({ stop, stream: asStream(fakeStream()) });
    await starting;
    expect(stop).toHaveBeenCalled();
    expect(captureOf('Mic')).toBeUndefined();
  });

  it('copies onto a duplicate from a clone of the same stream', async () => {
    await startAudio('Mic', 'input');
    const original = captureOf('Mic')!.stream as unknown as FakeStream;
    await duplicateCapture('Mic', 'Mic copy');

    const copy = captureOf('Mic copy');
    expect(copy?.kind === 'audio' && copy.source).toBe('input');
    expect(original.clone).toHaveBeenCalled();
    expect(startAudioMock.mock.calls[1][0].stream).toBeDefined();
    expect(captureOf('Mic')).toBeDefined();
  });

  it('copies nothing onto a duplicate of a pattern that is not capturing', async () => {
    await duplicateCapture('Mic', 'Mic copy');
    expect(captureOf('Mic copy')).toBeUndefined();
  });

  it('forgets a capture the browser ended', async () => {
    await startAudio('Mic', 'system');
    startAudioMock.mock.calls[0][0].onEnded();
    expect(captureOf('Mic')).toBeUndefined();
  });

  it('replaces a capture started again for the same pattern', async () => {
    await startAudio('Mic', 'system');
    const first = captureOf('Mic')!;
    await startAudio('Mic', 'input');
    expect(first.stop).toHaveBeenCalled();
    expect(captureOf('Mic')).not.toBe(first);
  });
});

describe('video captures', () => {
  it('samples with the settings it was last given', async () => {
    await startVideo('Cam', 'camera', VIDEO_SAMPLING_FISHEYE, DEFAULT_VIDEO_GEOMETRY);
    const [[options]] = startVideoMock.mock.calls;
    setVideoSettings('Cam', VIDEO_SAMPLING_STRIP, {
      ...DEFAULT_VIDEO_GEOMETRY,
      stripY: 0.25
    });
    expect(options.sampling()).toBe(VIDEO_SAMPLING_STRIP);
    expect(options.geometry().stripY).toBe(0.25);
  });

  it('goes back to the saved settings on a sync', async () => {
    await startVideo('Cam', 'camera', VIDEO_SAMPLING_STRIP, DEFAULT_VIDEO_GEOMETRY);
    const [[options]] = startVideoMock.mock.calls;
    syncCaptures([video('Cam', VIDEO_INPUT_CAMERA, VIDEO_SAMPLING_FISHEYE, 0.8)]);
    expect(options.sampling()).toBe(VIDEO_SAMPLING_FISHEYE);
    expect(options.geometry().radius).toBe(0.8);
  });

  it('stops when the pattern switches to NDI', async () => {
    await startVideo('Cam', 'camera', VIDEO_SAMPLING_STRIP, DEFAULT_VIDEO_GEOMETRY);
    syncCaptures([video('Cam', VIDEO_INPUT_NDI, VIDEO_SAMPLING_STRIP)]);
    expect(captureOf('Cam')).toBeUndefined();
  });

  it('publishes its strips to the page for previews', async () => {
    await startVideo('Cam', 'screen', VIDEO_SAMPLING_STRIP, DEFAULT_VIDEO_GEOMETRY);
    const [[options]] = startVideoMock.mock.calls;
    options.onStrip(2, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]));
    expect(videoStrip('Cam')).toEqual({
      width: 2,
      rgb: new Uint8Array([1, 2, 3, 4, 5, 6])
    });
  });

  it('copies its aim onto a duplicate', async () => {
    await startVideo('Cam', 'camera', VIDEO_SAMPLING_STRIP, DEFAULT_VIDEO_GEOMETRY);
    setVideoSettings('Cam', VIDEO_SAMPLING_STRIP, {
      ...DEFAULT_VIDEO_GEOMETRY,
      stripY: 0.3
    });
    await duplicateCapture('Cam', 'Cam copy');

    const [, [options]] = startVideoMock.mock.calls;
    expect(options.stream).toBeDefined();
    expect(options.sampling()).toBe(VIDEO_SAMPLING_STRIP);
    expect(options.geometry().stripY).toBe(0.3);
  });

  it('removes its hidden video element when stopped', async () => {
    await startVideo('Cam', 'screen', VIDEO_SAMPLING_STRIP, DEFAULT_VIDEO_GEOMETRY);
    stopCapture('Cam');
    expect(removeVideo).toHaveBeenCalled();
  });
});
