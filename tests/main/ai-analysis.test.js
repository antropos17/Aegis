import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'module';
import { EventEmitter } from 'events';
import Module from 'module';

const require = createRequire(import.meta.url);

// Intercept CJS require for 'https' by patching Module._cache
const mockRequest = vi.fn();
const fakeHttps = { request: mockRequest };

// Store original https module
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'https') return fakeHttps;
  return originalLoad.apply(this, arguments);
};

describe('ai-analysis', () => {
  let analysis;

  beforeEach(() => {
    mockRequest.mockReset();
    // Clear the module from require cache to get fresh module state
    const modPath = require.resolve('../../src/main/ai-analysis.js');
    delete require.cache[modPath];
    analysis = require('../../src/main/ai-analysis.js');
  });

  function setupState(overrides = {}) {
    const state = {
      getSettings: () => ({ anthropicApiKey: 'test-key', ...(overrides.settings || {}) }),
      activityLog: overrides.activityLog || [],
      getLatestAgents: () => overrides.agents || [],
      getLatestNetConnections: () => overrides.netConns || [],
      getAnomalyScores: overrides.getAnomalyScores || (() => ({})),
    };
    analysis.init(state);
    return state;
  }

  function mockHttpSuccess(body) {
    const res = new EventEmitter();
    const req = new EventEmitter();
    req.write = vi.fn();
    req.end = vi.fn();
    req.setTimeout = vi.fn();
    req.destroy = vi.fn();

    mockRequest.mockImplementation((opts, cb) => {
      process.nextTick(() => {
        cb(res);
        process.nextTick(() => {
          res.emit('data', JSON.stringify(body));
          res.emit('end');
        });
      });
      return req;
    });
    return req;
  }

  function mockHttpError(errorMsg) {
    const req = new EventEmitter();
    req.write = vi.fn();
    req.end = vi.fn();
    req.setTimeout = vi.fn();
    req.destroy = vi.fn();

    mockRequest.mockImplementation(() => {
      process.nextTick(() => req.emit('error', new Error(errorMsg)));
      return req;
    });
    return req;
  }

  function mockHttpTimeout() {
    const req = new EventEmitter();
    req.write = vi.fn();
    req.end = vi.fn();
    req.destroy = vi.fn();
    let timeoutCb;
    req.setTimeout = vi.fn((ms, cb) => { timeoutCb = cb; });

    mockRequest.mockImplementation(() => {
      process.nextTick(() => timeoutCb());
      return req;
    });
    return req;
  }

  function mockHttpBadBody(rawStr) {
    const res = new EventEmitter();
    const req = new EventEmitter();
    req.write = vi.fn();
    req.end = vi.fn();
    req.setTimeout = vi.fn();
    req.destroy = vi.fn();

    mockRequest.mockImplementation((opts, cb) => {
      process.nextTick(() => {
        cb(res);
        process.nextTick(() => {
          res.emit('data', rawStr);
          res.emit('end');
        });
      });
      return req;
    });
    return req;
  }

  describe('analyzeAgentActivity', () => {
    it('returns error when no API key configured', async () => {
      analysis.init({
        getSettings: () => ({}),
        activityLog: [],
        getLatestAgents: () => [],
        getLatestNetConnections: () => [],
      });
      const result = await analysis.analyzeAgentActivity('TestAgent');
      expect(result.success).toBe(false);
      expect(result.error).toBe('No API key configured');
    });

    it('returns error when API key is empty string', async () => {
      analysis.init({
        getSettings: () => ({ anthropicApiKey: '' }),
        activityLog: [],
        getLatestAgents: () => [],
        getLatestNetConnections: () => [],
      });
      const result = await analysis.analyzeAgentActivity('TestAgent');
      expect(result.success).toBe(false);
    });

    it('makes HTTPS request with correct headers', async () => {
      setupState({
        agents: [{ agent: 'TestAgent', pid: 100, process: 'test', category: 'ai', parentChain: ['vscode'] }],
      });
      mockHttpSuccess({ content: [{ text: '{"summary":"ok"}' }] });

      await analysis.analyzeAgentActivity('TestAgent');

      expect(mockRequest).toHaveBeenCalledTimes(1);
      const opts = mockRequest.mock.calls[0][0];
      expect(opts.hostname).toBe('api.anthropic.com');
      expect(opts.path).toBe('/v1/messages');
      expect(opts.method).toBe('POST');
      expect(opts.headers['x-api-key']).toBe('test-key');
      expect(opts.headers['anthropic-version']).toBe('2023-06-01');
    });

    it('returns structured result on valid JSON response', async () => {
      setupState({
        agents: [{ agent: 'TestAgent', pid: 100, process: 'test', category: 'ai' }],
      });
      mockHttpSuccess({
        content: [{ text: '{"summary":"All clear","riskLevel":"LOW","findings":["nothing"]}' }],
      });

      const result = await analysis.analyzeAgentActivity('TestAgent');
      expect(result.success).toBe(true);
      expect(result.structured.summary).toBe('All clear');
      expect(result.structured.riskLevel).toBe('LOW');
    });

    it('returns success without structured when JSON extraction fails', async () => {
      setupState({ agents: [{ agent: 'TestAgent', pid: 100, process: 'test', category: 'ai' }] });
      mockHttpSuccess({ content: [{ text: 'plain text no json here' }] });

      const result = await analysis.analyzeAgentActivity('TestAgent');
      expect(result.success).toBe(true);
      expect(result.analysis).toBeDefined();
      expect(result.structured).toBeUndefined();
    });

    it('handles API error response', async () => {
      setupState();
      mockHttpSuccess({ error: { message: 'Invalid API key' } });

      const result = await analysis.analyzeAgentActivity('TestAgent');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid API key');
    });

    it('handles unexpected API response format', async () => {
      setupState();
      mockHttpSuccess({ something: 'unexpected' });

      const result = await analysis.analyzeAgentActivity('TestAgent');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Unexpected API response');
    });

    it('handles network error', async () => {
      setupState();
      mockHttpError('ECONNREFUSED');

      const result = await analysis.analyzeAgentActivity('TestAgent');
      expect(result.success).toBe(false);
      expect(result.error).toBe('ECONNREFUSED');
    });

    it('handles request timeout', async () => {
      setupState();
      const req = mockHttpTimeout();

      const result = await analysis.analyzeAgentActivity('TestAgent');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Request timed out');
      expect(req.destroy).toHaveBeenCalled();
    });

    it('handles malformed API response body', async () => {
      setupState();
      mockHttpBadBody('{{{{ not json at all');

      const result = await analysis.analyzeAgentActivity('TestAgent');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Failed to parse API response');
    });

    it('extracts JSON from markdown code fences', async () => {
      setupState({ agents: [{ agent: 'TestAgent', pid: 100, process: 'test', category: 'ai' }] });
      mockHttpSuccess({
        content: [{ text: '```json\n{"summary":"fenced","riskLevel":"HIGH"}\n```' }],
      });

      const result = await analysis.analyzeAgentActivity('TestAgent');
      expect(result.success).toBe(true);
      expect(result.structured.summary).toBe('fenced');
    });

    it('extracts JSON embedded in prose', async () => {
      setupState({ agents: [{ agent: 'TestAgent', pid: 100, process: 'test', category: 'ai' }] });
      mockHttpSuccess({
        content: [{ text: 'Here is the analysis: {"summary":"embedded","riskLevel":"LOW"} Hope this helps!' }],
      });

      const result = await analysis.analyzeAgentActivity('TestAgent');
      expect(result.success).toBe(true);
      expect(result.structured.summary).toBe('embedded');
    });

    it('handles agent not found in agents list', async () => {
      setupState({ agents: [] });
      mockHttpSuccess({ content: [{ text: '{"summary":"ok"}' }] });

      const result = await analysis.analyzeAgentActivity('MissingAgent');
      expect(result.success).toBe(true);
    });

    it('handles agent with no parentChain', async () => {
      setupState({ agents: [{ agent: 'TestAgent', pid: 100, process: 'test', category: 'ai' }] });
      mockHttpSuccess({ content: [{ text: '{"summary":"ok"}' }] });

      const result = await analysis.analyzeAgentActivity('TestAgent');
      expect(result.success).toBe(true);
    });

    it('includes sensitive and network details in request body', async () => {
      setupState({
        activityLog: [
          { agent: 'TestAgent', sensitive: true, file: '/home/.ssh/id_rsa', reason: 'SSH key', action: 'read' },
          { agent: 'Other', sensitive: false, file: '/tmp/a.js', action: 'read' },
        ],
        agents: [{ agent: 'TestAgent', pid: 100, process: 'test', category: 'ai' }],
        netConns: [
          { agent: 'TestAgent', remoteIp: '1.2.3.4', remotePort: 443, domain: 'api.com', flagged: true, state: 'ESTAB' },
        ],
      });
      mockHttpSuccess({ content: [{ text: '{"summary":"ok"}' }] });

      await analysis.analyzeAgentActivity('TestAgent');

      expect(mockRequest).toHaveBeenCalledTimes(1);
    });
  });

  describe('analyzeSessionActivity', () => {
    it('returns error when no API key', async () => {
      analysis.init({
        getSettings: () => ({}),
        activityLog: [],
        getLatestAgents: () => [],
        getLatestNetConnections: () => [],
      });
      const result = await analysis.analyzeSessionActivity();
      expect(result.success).toBe(false);
      expect(result.error).toContain('API key');
    });

    it('returns structured session analysis on valid response', async () => {
      setupState({
        activityLog: [
          { agent: 'Claude', sensitive: true, reason: 'SSH key', file: '/ssh/key', action: 'read' },
        ],
        agents: [{ agent: 'Claude', pid: 100, parentChain: ['vscode'] }],
        netConns: [{ agent: 'Claude', remoteIp: '1.2.3.4', remotePort: 443, domain: 'api.com', flagged: false }],
        getAnomalyScores: () => ({ Claude: 15 }),
      });

      mockHttpSuccess({
        content: [{
          text: JSON.stringify({
            summary: 'Session safe',
            findings: ['Minor activity'],
            riskRating: 'LOW',
            riskJustification: 'Normal',
            recommendations: ['Monitor'],
          }),
        }],
      });

      const result = await analysis.analyzeSessionActivity();
      expect(result.success).toBe(true);
      expect(result.summary).toBe('Session safe');
      expect(result.findings).toEqual(['Minor activity']);
      expect(result.riskRating).toBe('LOW');
      expect(result.recommendations).toEqual(['Monitor']);
    });

    it('returns raw text as summary when JSON extraction fails', async () => {
      setupState();
      mockHttpSuccess({ content: [{ text: 'Just plain text response' }] });

      const result = await analysis.analyzeSessionActivity();
      expect(result.success).toBe(true);
      expect(result.summary).toContain('plain text');
      expect(result.riskRating).toBe('UNKNOWN');
    });

    it('handles API error in session analysis', async () => {
      setupState();
      mockHttpSuccess({ error: { message: 'Rate limited' } });

      const result = await analysis.analyzeSessionActivity();
      expect(result.success).toBe(false);
      expect(result.error).toBe('Rate limited');
    });

    it('handles missing getAnomalyScores gracefully', async () => {
      const state = {
        getSettings: () => ({ anthropicApiKey: 'key' }),
        activityLog: [{ agent: 'A', sensitive: false, file: 'f', action: 'r' }],
        getLatestAgents: () => [{ agent: 'A', pid: 1 }],
        getLatestNetConnections: () => [],
      };
      analysis.init(state);
      mockHttpSuccess({ content: [{ text: '{"summary":"ok","riskRating":"CLEAR"}' }] });

      const result = await analysis.analyzeSessionActivity();
      expect(result.success).toBe(true);
    });

    it('handles timeout for session analysis', async () => {
      setupState();
      mockHttpTimeout();

      const result = await analysis.analyzeSessionActivity();
      expect(result.success).toBe(false);
      expect(result.error).toContain('timed out');
    });

    it('includes config access events in analysis', async () => {
      setupState({
        activityLog: [
          { agent: 'Claude', sensitive: true, reason: 'AI agent config: .cursor', file: '/cfg', action: 'read' },
        ],
        agents: [{ agent: 'Claude', pid: 1, parentChain: [] }],
      });
      mockHttpSuccess({ content: [{ text: '{"summary":"ok","riskRating":"LOW"}' }] });

      const result = await analysis.analyzeSessionActivity();
      expect(result.success).toBe(true);
    });

    it('handles unexpected API response in session analysis', async () => {
      setupState();
      mockHttpSuccess({ weird: 'format' });

      const result = await analysis.analyzeSessionActivity();
      expect(result.success).toBe(false);
      expect(result.error).toBe('Unexpected API response');
    });

    it('handles malformed response body in session analysis', async () => {
      setupState();
      mockHttpBadBody('not json {{{');

      const result = await analysis.analyzeSessionActivity();
      expect(result.success).toBe(false);
      expect(result.error).toBe('Failed to parse API response');
    });

    it('handles network error in session analysis', async () => {
      setupState();
      mockHttpError('ECONNRESET');

      const result = await analysis.analyzeSessionActivity();
      expect(result.success).toBe(false);
      expect(result.error).toBe('ECONNRESET');
    });
  });
});
