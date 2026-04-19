import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { resolveTranscribeConfig } from '../src/core/transcription.ts';

describe('resolveTranscribeConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.TRANSCRIBE_BASE_URL;
    delete process.env.TRANSCRIBE_MODEL;
    delete process.env.GROQ_API_KEY;
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test('returns groq provider when GROQ_API_KEY is set', () => {
    process.env.GROQ_API_KEY = 'gsk-test';

    const config = resolveTranscribeConfig();

    expect(config.provider).toBe('groq');
    expect(config.apiKey).toBe('gsk-test');
    expect(config.baseURL).toBeUndefined();
    expect(config.isCustomBaseUrl).toBe(false);
  });

  test('returns openai provider when only OPENAI_API_KEY is set', () => {
    process.env.OPENAI_API_KEY = 'sk-test';

    const config = resolveTranscribeConfig();

    expect(config.provider).toBe('openai');
    expect(config.apiKey).toBe('sk-test');
  });

  test('uses local provider when TRANSCRIBE_BASE_URL is set', () => {
    process.env.TRANSCRIBE_BASE_URL = 'http://192.168.1.217:8000/v1';

    const config = resolveTranscribeConfig();

    expect(config.provider).toBe('local');
    expect(config.baseURL).toBe('http://192.168.1.217:8000/v1');
    expect(config.isCustomBaseUrl).toBe(true);
    expect(config.apiKey).toBe('***'); // Dummy key for local servers
  });

  test('env vars override config file for local server', () => {
    process.env.TRANSCRIBE_MODEL = 'mlx-community/parakeet-tdt_ctc-110m';

    const config = resolveTranscribeConfig();

    expect(config.model).toBe('mlx-community/parakeet-tdt_ctc-110m');
  });

  test('defaults to whisper-1 model when not specified', () => {
    process.env.GROQ_API_KEY = 'gsk-test';

    const config = resolveTranscribeConfig();

    expect(config.model).toBe('whisper-1');
  });

  test('prefers groq over openai when both keys are set', () => {
    process.env.GROQ_API_KEY = 'gsk-test';
    process.env.OPENAI_API_KEY = 'sk-test';

    const config = resolveTranscribeConfig();

    expect(config.provider).toBe('groq');
  });

  test('trims whitespace from config values', () => {
    process.env.TRANSCRIBE_BASE_URL = '  http://192.168.1.217:8000/v1  ';
    process.env.TRANSCRIBE_MODEL = '  custom-model  ';

    const config = resolveTranscribeConfig();

    expect(config.baseURL).toBe('http://192.168.1.217:8000/v1');
    expect(config.model).toBe('custom-model');
  });

  test('local server takes precedence over cloud providers', () => {
    process.env.TRANSCRIBE_BASE_URL = 'http://localhost:8000/v1';
    process.env.GROQ_API_KEY = 'gsk-test';

    const config = resolveTranscribeConfig();

    expect(config.provider).toBe('local');
  });
});
