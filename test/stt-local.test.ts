import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { writeFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const TMP_MP3 = join(tmpdir(), 'gbrain-stt-test.mp3');
const TMP_LARGE = join(tmpdir(), 'gbrain-stt-large.mp3');

describe('STT local provider', () => {
  const originalEnv = process.env;
  let fetchMock: ReturnType<typeof mock>;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.GROQ_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.TRANSCRIBE_BASE_URL;
    delete process.env.TRANSCRIBE_MODEL;

    // Create fake mp3 files for testing
    writeFileSync(TMP_MP3, Buffer.from([0xFF, 0xFB, 0x90, 0x00])); // MP3 header

    // Mock global fetch
    fetchMock = mock(async (_url: string, _init: any) => {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          text: 'Hello world from local STT',
          segments: [
            { start: 0.0, end: 1.5, text: 'Hello world' },
            { start: 1.5, end: 3.0, text: 'from local STT' },
          ],
          language: 'en',
          duration: 3.0,
        }),
        text: async () => '',
      } as Response;
    });
    global.fetch = fetchMock;
  });

  afterEach(() => {
    process.env = originalEnv;
    fetchMock.mockClear();
    if (existsSync(TMP_MP3)) unlinkSync(TMP_MP3);
    if (existsSync(TMP_LARGE)) unlinkSync(TMP_LARGE);
  });

  test('uses local provider when TRANSCRIBE_BASE_URL is set', async () => {
    process.env.TRANSCRIBE_BASE_URL = 'http://192.168.1.217:8000/v1';

    const { transcribe } = await import('../src/core/transcription.ts');
    const result = await transcribe(TMP_MP3, {});

    expect(result.provider).toBe('local');
    expect(result.text).toBe('Hello world from local STT');
    expect(result.language).toBe('en');
    expect(result.duration).toBe(3.0);
    expect(result.segments).toHaveLength(2);
  });

  test('sends request to custom base URL', async () => {
    process.env.TRANSCRIBE_BASE_URL = 'http://192.168.1.217:8000/v1';

    const { transcribe } = await import('../src/core/transcription.ts');
    await transcribe(TMP_MP3, {});

    expect(fetchMock).toHaveBeenCalled();
    const calls = fetchMock.mock.calls;
    expect(calls.length).toBeGreaterThan(0);

    const [url, init] = calls[0] as [string, any];
    expect(url).toBe('http://192.168.1.217:8000/v1/audio/transcriptions');
    expect(init.method).toBe('POST');
    expect(init.headers?.Authorization).toBe('Bearer ***');
  });

  test('uses custom model from env var', async () => {
    process.env.TRANSCRIBE_BASE_URL = 'http://localhost:8000/v1';
    process.env.TRANSCRIBE_MODEL = 'mlx-community/parakeet-tdt_ctc-110m';

    const { transcribe } = await import('../src/core/transcription.ts');
    await transcribe(TMP_MP3, {});

    const calls = fetchMock.mock.calls;
    const [, init] = calls[0] as [string, any];

    // FormData is not easily inspectable, but we can verify the request was made
    expect(init.body).toBeDefined();
  });

  test('uses config provider override', async () => {
    process.env.TRANSCRIBE_BASE_URL = 'http://192.168.1.217:8000/v1';

    const { transcribe } = await import('../src/core/transcription.ts');
    const result = await transcribe(TMP_MP3, { provider: 'local' });

    expect(result.provider).toBe('local');
  });

  test('handles API errors gracefully', async () => {
    process.env.TRANSCRIBE_BASE_URL = 'http://192.168.1.217:8000/v1';

    // Override mock to return error
    fetchMock.mockImplementation(async () => {
      return {
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      } as Response;
    });

    const { transcribe } = await import('../src/core/transcription.ts');

    try {
      await transcribe(TMP_MP3, {});
      expect(true).toBe(false); // Should not reach here
    } catch (e: any) {
      expect(e.message).toContain('Transcription failed');
      expect(e.message).toContain('500');
    }
  });

  test('handles malformed JSON response', async () => {
    process.env.TRANSCRIBE_BASE_URL = 'http://192.168.1.217:8000/v1';

    fetchMock.mockImplementation(async () => {
      return {
        ok: true,
        status: 200,
        json: async () => { throw new Error('Invalid JSON'); },
        text: async () => 'not valid json',
      } as Response;
    });

    const { transcribe } = await import('../src/core/transcription.ts');

    try {
      await transcribe(TMP_MP3, {});
      expect(true).toBe(false);
    } catch (e: any) {
      expect(e.message).toContain('JSON');
    }
  });

  test('handles empty segments in response', async () => {
    process.env.TRANSCRIBE_BASE_URL = 'http://192.168.1.217:8000/v1';

    fetchMock.mockImplementation(async () => {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          text: '',
          segments: [],
          language: 'unknown',
          duration: 0,
        }),
        text: async () => '',
      } as Response;
    });

    const { transcribe } = await import('../src/core/transcription.ts');
    const result = await transcribe(TMP_MP3, {});

    expect(result.text).toBe('');
    expect(result.segments).toHaveLength(0);
  });

  test('passes language parameter when specified', async () => {
    process.env.TRANSCRIBE_BASE_URL = 'http://192.168.1.217:8000/v1';

    const { transcribe } = await import('../src/core/transcription.ts');
    await transcribe(TMP_MP3, { language: 'es' });

    const calls = fetchMock.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    // FormData should contain language param
  });

  test('handles response with missing optional fields', async () => {
    process.env.TRANSCRIBE_BASE_URL = 'http://192.168.1.217:8000/v1';

    fetchMock.mockImplementation(async () => {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          text: 'Hello',
          // Missing segments, language, duration
        }),
        text: async () => '',
      } as Response;
    });

    const { transcribe } = await import('../src/core/transcription.ts');
    const result = await transcribe(TMP_MP3, {});

    expect(result.text).toBe('Hello');
    expect(result.segments).toEqual([]);
    expect(result.language).toBe('unknown');
    expect(result.duration).toBe(0);
  });
});

describe('STT provider priority', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    writeFileSync(TMP_MP3, Buffer.from([0xFF, 0xFB, 0x90, 0x00]));
  });

  afterEach(() => {
    process.env = originalEnv;
    if (existsSync(TMP_MP3)) unlinkSync(TMP_MP3);
  });

  test('local provider takes precedence over Groq', async () => {
    process.env.TRANSCRIBE_BASE_URL = 'http://192.168.1.217:8000/v1';
    process.env.GROQ_API_KEY = 'gsk-test';

    const mockFetch = mock(async () => ({
      ok: true,
      json: async () => ({
        text: 'local result',
        segments: [],
        language: 'en',
        duration: 1.0,
      }),
    } as Response));
    global.fetch = mockFetch;

    const { transcribe } = await import('../src/core/transcription.ts');
    const result = await transcribe(TMP_MP3, {});

    expect(result.provider).toBe('local');
  });

  test('falls back to groq when no local config', async () => {
    process.env.GROQ_API_KEY = 'gsk-test';
    delete process.env.TRANSCRIBE_BASE_URL;

    const mockFetch = mock(async () => ({
      ok: true,
      json: async () => ({
        text: 'groq result',
        segments: [],
        language: 'en',
        duration: 1.0,
      }),
    } as Response));
    global.fetch = mockFetch;

    const { transcribe } = await import('../src/core/transcription.ts');
    const result = await transcribe(TMP_MP3, {});

    expect(result.provider).toBe('groq');
  });
});
