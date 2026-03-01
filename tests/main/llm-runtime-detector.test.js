import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'module';
import { EventEmitter } from 'events';

const require = createRequire(import.meta.url);
const detector = require('../../src/main/llm-runtime-detector.js');

/**
 * Create a mock http module whose request() returns a controllable
 * IncomingMessage + ClientRequest pair.
 */
function createMockHttp() {
  const mockRequest = vi.fn();
  return { request: mockRequest };
}

/**
 * Wire mockHttp.request so the next call resolves with `body` as JSON.
 */
function mockHttpSuccess(mockHttp, body) {
  mockHttp.request.mockImplementation((_opts, cb) => {
    const res = new EventEmitter();
    const req = new EventEmitter();
    req.destroy = vi.fn();
    req.end = vi.fn(() => {
      process.nextTick(() => {
        cb(res);
        res.emit('data', JSON.stringify(body));
        res.emit('end');
      });
    });
    return req;
  });
}

/**
 * Wire mockHttp.request so the next call emits an 'error' (ECONNREFUSED).
 */
function mockHttpError(mockHttp, code = 'ECONNREFUSED') {
  mockHttp.request.mockImplementation((_opts, _cb) => {
    const req = new EventEmitter();
    req.destroy = vi.fn();
    req.end = vi.fn(() => {
      process.nextTick(() => {
        const err = new Error('connect ECONNREFUSED');
        err.code = code;
        req.emit('error', err);
      });
    });
    return req;
  });
}

/**
 * Wire mockHttp.request so the next call emits a 'timeout'.
 */
function mockHttpTimeout(mockHttp) {
  mockHttp.request.mockImplementation((_opts, _cb) => {
    const req = new EventEmitter();
    req.destroy = vi.fn();
    req.end = vi.fn(() => {
      process.nextTick(() => req.emit('timeout'));
    });
    return req;
  });
}

describe('llm-runtime-detector', () => {
  let mockHttp;

  beforeEach(() => {
    mockHttp = createMockHttp();
    detector._setDepsForTest({ http: mockHttp });
  });

  afterEach(() => {
    detector._resetForTest();
  });

  // ═══ OLLAMA ═══

  describe('detectOllamaModels()', () => {
    it('returns models when Ollama is running', async () => {
      mockHttpSuccess(mockHttp, {
        models: [
          { name: 'llama3:8b', size: 4700000000 },
          { name: 'codellama:7b', size: 3800000000 },
        ],
      });
      const result = await detector.detectOllamaModels();
      expect(result.running).toBe(true);
      expect(result.models).toEqual(['llama3:8b', 'codellama:7b']);
    });

    it('returns empty when Ollama is not running (ECONNREFUSED)', async () => {
      mockHttpError(mockHttp, 'ECONNREFUSED');
      const result = await detector.detectOllamaModels();
      expect(result.running).toBe(false);
      expect(result.models).toEqual([]);
    });

    it('returns empty on timeout', async () => {
      mockHttpTimeout(mockHttp);
      const result = await detector.detectOllamaModels();
      expect(result.running).toBe(false);
      expect(result.models).toEqual([]);
    });

    it('returns empty when response is not valid JSON', async () => {
      mockHttp.request.mockImplementation((_opts, cb) => {
        const res = new EventEmitter();
        const req = new EventEmitter();
        req.destroy = vi.fn();
        req.end = vi.fn(() => {
          process.nextTick(() => {
            cb(res);
            res.emit('data', 'not json');
            res.emit('end');
          });
        });
        return req;
      });
      const result = await detector.detectOllamaModels();
      expect(result.running).toBe(false);
      expect(result.models).toEqual([]);
    });

    it('returns empty when models array is missing', async () => {
      mockHttpSuccess(mockHttp, { version: '0.1.0' });
      const result = await detector.detectOllamaModels();
      expect(result.running).toBe(false);
      expect(result.models).toEqual([]);
    });

    it('filters out entries with no name', async () => {
      mockHttpSuccess(mockHttp, {
        models: [{ name: 'phi3:mini' }, { size: 1000 }, { name: '' }],
      });
      const result = await detector.detectOllamaModels();
      expect(result.running).toBe(true);
      expect(result.models).toEqual(['phi3:mini']);
    });

    it('calls correct host/port/path', async () => {
      mockHttpSuccess(mockHttp, { models: [] });
      await detector.detectOllamaModels();
      const opts = mockHttp.request.mock.calls[0][0];
      expect(opts.hostname).toBe('127.0.0.1');
      expect(opts.port).toBe(11434);
      expect(opts.path).toBe('/api/tags');
      expect(opts.method).toBe('GET');
    });
  });

  // ═══ LM STUDIO ═══

  describe('detectLMStudioModels()', () => {
    it('returns models when LM Studio is running', async () => {
      mockHttpSuccess(mockHttp, {
        object: 'list',
        data: [
          { id: 'lmstudio-community/Meta-Llama-3-8B-Q4', object: 'model' },
          { id: 'TheBloke/CodeLlama-7B-GGUF', object: 'model' },
        ],
      });
      const result = await detector.detectLMStudioModels();
      expect(result.running).toBe(true);
      expect(result.models).toEqual([
        'lmstudio-community/Meta-Llama-3-8B-Q4',
        'TheBloke/CodeLlama-7B-GGUF',
      ]);
    });

    it('returns empty when LM Studio is not running', async () => {
      mockHttpError(mockHttp, 'ECONNREFUSED');
      const result = await detector.detectLMStudioModels();
      expect(result.running).toBe(false);
      expect(result.models).toEqual([]);
    });

    it('returns empty on timeout', async () => {
      mockHttpTimeout(mockHttp);
      const result = await detector.detectLMStudioModels();
      expect(result.running).toBe(false);
      expect(result.models).toEqual([]);
    });

    it('calls correct host/port/path', async () => {
      mockHttpSuccess(mockHttp, { data: [] });
      await detector.detectLMStudioModels();
      const opts = mockHttp.request.mock.calls[0][0];
      expect(opts.hostname).toBe('127.0.0.1');
      expect(opts.port).toBe(1234);
      expect(opts.path).toBe('/v1/models');
      expect(opts.method).toBe('GET');
    });

    it('returns empty when data array is missing', async () => {
      mockHttpSuccess(mockHttp, { object: 'list' });
      const result = await detector.detectLMStudioModels();
      expect(result.running).toBe(false);
      expect(result.models).toEqual([]);
    });
  });
});
