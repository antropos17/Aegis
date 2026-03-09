import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock window.aegis before importing the module
const mockOpenThreatReport = vi.fn();

// Set up a minimal browser-like environment
globalThis.window = {
  aegis: {
    openThreatReport: mockOpenThreatReport,
  },
};

describe('threat-report', () => {
  let openThreatReport;

  beforeEach(async () => {
    vi.resetModules();
    mockOpenThreatReport.mockClear();
    const mod = await import('../../src/renderer/lib/utils/threat-report.js');
    openThreatReport = mod.openThreatReport;
  });

  it('sends structured data with all fields', () => {
    const result = {
      riskRating: 'HIGH',
      summary: 'Suspicious activity detected',
      findings: ['Finding 1', 'Finding 2'],
      recommendations: ['Action 1'],
    };
    const counts = { totalFiles: 100, totalSensitive: 5, totalAgents: 3, totalNet: 10 };

    openThreatReport(result, counts);

    expect(mockOpenThreatReport).toHaveBeenCalledTimes(1);
    const data = mockOpenThreatReport.mock.calls[0][0];
    expect(data).toEqual({
      riskRating: 'HIGH',
      summary: 'Suspicious activity detected',
      findings: ['Finding 1', 'Finding 2'],
      recommendations: ['Action 1'],
      counts: { totalFiles: 100, totalSensitive: 5, totalAgents: 3, totalNet: 10 },
    });
  });

  it('passes counts through correctly', () => {
    const result = { riskRating: 'LOW', summary: 'All clear' };
    const counts = { totalFiles: 42, totalSensitive: 7, totalAgents: 2, totalNet: 15 };

    openThreatReport(result, counts);

    const data = mockOpenThreatReport.mock.calls[0][0];
    expect(data.counts).toEqual(counts);
  });

  it('does not generate HTML — passes raw data for main process to escape', () => {
    const result = {
      riskRating: '<script>alert("xss")</script>',
      summary: 'Test <b>bold</b> & "quotes"',
      findings: ['<img onerror=alert(1)>'],
      recommendations: ['Use "proper" escaping & sanitization'],
    };
    const counts = { totalFiles: 1, totalSensitive: 0, totalAgents: 1, totalNet: 0 };

    openThreatReport(result, counts);

    const data = mockOpenThreatReport.mock.calls[0][0];
    // Data is passed as-is — escaping happens in main process
    expect(data.riskRating).toBe('<script>alert("xss")</script>');
    expect(data.summary).toBe('Test <b>bold</b> & "quotes"');
    expect(data.findings[0]).toBe('<img onerror=alert(1)>');
    expect(typeof data).toBe('object');
  });

  it('handles missing findings gracefully', () => {
    const result = {
      riskRating: 'CLEAR',
      summary: 'Nothing found',
      findings: [],
      recommendations: [],
    };
    const counts = { totalFiles: 0, totalSensitive: 0, totalAgents: 0, totalNet: 0 };

    openThreatReport(result, counts);

    const data = mockOpenThreatReport.mock.calls[0][0];
    expect(data.riskRating).toBe('CLEAR');
    expect(data.findings).toEqual([]);
    expect(data.recommendations).toEqual([]);
  });

  it('handles undefined findings/recommendations', () => {
    const result = {
      riskRating: 'LOW',
      summary: 'Minimal activity',
      // findings and recommendations are undefined
    };
    const counts = { totalFiles: 1, totalSensitive: 0, totalAgents: 1, totalNet: 0 };

    openThreatReport(result, counts);

    const data = mockOpenThreatReport.mock.calls[0][0];
    expect(data.riskRating).toBe('LOW');
    expect(data.findings).toBeUndefined();
    expect(data.recommendations).toBeUndefined();
  });

  it('passes risk rating through without modification', () => {
    const levels = ['CLEAR', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

    for (const level of levels) {
      mockOpenThreatReport.mockClear();
      openThreatReport(
        { riskRating: level, summary: 'test' },
        { totalFiles: 0, totalSensitive: 0, totalAgents: 0, totalNet: 0 },
      );
      const data = mockOpenThreatReport.mock.calls[0][0];
      expect(data.riskRating).toBe(level);
    }
  });

  it('passes null values through for main process to handle', () => {
    openThreatReport(
      { riskRating: null, summary: null },
      { totalFiles: 0, totalSensitive: 0, totalAgents: 0, totalNet: 0 },
    );
    const data = mockOpenThreatReport.mock.calls[0][0];
    expect(data.riskRating).toBeNull();
    expect(data.summary).toBeNull();
  });

  it('preserves newlines in summary for main process to convert', () => {
    openThreatReport(
      { riskRating: 'LOW', summary: 'Line one\nLine two\nLine three' },
      { totalFiles: 0, totalSensitive: 0, totalAgents: 0, totalNet: 0 },
    );
    const data = mockOpenThreatReport.mock.calls[0][0];
    expect(data.summary).toBe('Line one\nLine two\nLine three');
  });
});
