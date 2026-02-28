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

  it('generates HTML with risk rating', () => {
    const result = {
      riskRating: 'HIGH',
      summary: 'Suspicious activity detected',
      findings: ['Finding 1', 'Finding 2'],
      recommendations: ['Action 1'],
    };
    const counts = { totalFiles: 100, totalSensitive: 5, totalAgents: 3, totalNet: 10 };

    openThreatReport(result, counts);

    expect(mockOpenThreatReport).toHaveBeenCalledTimes(1);
    const html = mockOpenThreatReport.mock.calls[0][0];
    expect(html).toContain('AEGIS Threat Analysis Report');
    expect(html).toContain('HIGH');
    expect(html).toContain('Suspicious activity detected');
    expect(html).toContain('Finding 1');
    expect(html).toContain('Finding 2');
    expect(html).toContain('Action 1');
  });

  it('shows correct counts in the report', () => {
    const result = { riskRating: 'LOW', summary: 'All clear' };
    const counts = { totalFiles: 42, totalSensitive: 7, totalAgents: 2, totalNet: 15 };

    openThreatReport(result, counts);

    const html = mockOpenThreatReport.mock.calls[0][0];
    expect(html).toContain('42');
    expect(html).toContain('7');
    expect(html).toContain('2');
    expect(html).toContain('15');
  });

  it('HTML-escapes values to prevent XSS', () => {
    const result = {
      riskRating: '<script>alert("xss")</script>',
      summary: 'Test <b>bold</b> & "quotes"',
      findings: ['<img onerror=alert(1)>'],
      recommendations: ['Use "proper" escaping & sanitization'],
    };
    const counts = { totalFiles: 1, totalSensitive: 0, totalAgents: 1, totalNet: 0 };

    openThreatReport(result, counts);

    const html = mockOpenThreatReport.mock.calls[0][0];
    expect(html).not.toContain('<script>alert("xss")</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp;');
    expect(html).toContain('&quot;');
    expect(html).not.toContain('<img onerror');
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

    const html = mockOpenThreatReport.mock.calls[0][0];
    expect(html).toContain('CLEAR');
    // No FINDINGS section when empty
    expect(html).not.toContain('FINDINGS');
  });

  it('handles undefined findings/recommendations', () => {
    const result = {
      riskRating: 'LOW',
      summary: 'Minimal activity',
      // findings and recommendations are undefined
    };
    const counts = { totalFiles: 1, totalSensitive: 0, totalAgents: 1, totalNet: 0 };

    openThreatReport(result, counts);

    const html = mockOpenThreatReport.mock.calls[0][0];
    expect(html).toContain('LOW');
    expect(html).not.toContain('FINDINGS');
    expect(html).not.toContain('RECOMMENDATIONS');
  });

  it('uses correct color for each risk level', () => {
    const levels = {
      CLEAR: '#38A169',
      LOW: '#38A169',
      MEDIUM: '#ED8936',
      HIGH: '#ED8936',
      CRITICAL: '#E53E3E',
    };

    for (const [level, color] of Object.entries(levels)) {
      mockOpenThreatReport.mockClear();
      openThreatReport(
        { riskRating: level, summary: 'test' },
        { totalFiles: 0, totalSensitive: 0, totalAgents: 0, totalNet: 0 },
      );
      const html = mockOpenThreatReport.mock.calls[0][0];
      expect(html).toContain(color);
    }
  });

  it('falls back to orange for unknown risk rating', () => {
    openThreatReport(
      { riskRating: 'UNKNOWN', summary: 'test' },
      { totalFiles: 0, totalSensitive: 0, totalAgents: 0, totalNet: 0 },
    );
    const html = mockOpenThreatReport.mock.calls[0][0];
    expect(html).toContain('#ED8936'); // fallback color
  });

  it('handles null/undefined summary with UNKNOWN fallback', () => {
    openThreatReport(
      { riskRating: null, summary: null },
      { totalFiles: 0, totalSensitive: 0, totalAgents: 0, totalNet: 0 },
    );
    const html = mockOpenThreatReport.mock.calls[0][0];
    expect(html).toContain('UNKNOWN');
  });

  it('converts newlines in summary to <br> tags', () => {
    openThreatReport(
      { riskRating: 'LOW', summary: 'Line one\nLine two\nLine three' },
      { totalFiles: 0, totalSensitive: 0, totalAgents: 0, totalNet: 0 },
    );
    const html = mockOpenThreatReport.mock.calls[0][0];
    expect(html).toContain('<br>');
  });
});
