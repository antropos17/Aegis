import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'main',
          include: ['tests/main/**/*.test.js', 'tests/shared/**/*.test.js'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'renderer',
          include: ['tests/renderer/**/*.test.js'],
          environment: 'node',
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: [
        'src/main/logger.js',
        'src/main/audit-logger.js',
        'src/main/config-manager.js',
        'src/main/baselines.js',
        'src/main/process-utils.js',
        'src/main/process-scanner.js',
        'src/main/file-watcher.js',
        'src/main/network-monitor.js',
        'src/main/platform/posix-shared.js',
        'src/main/platform/linux.js',
        'src/main/platform/darwin.js',
        'src/main/platform/win32.js',
        'src/main/platform/index.js',
        'src/main/anomaly-detector.js',
        'src/main/ai-analysis.js',
        'src/main/exports.js',
        'src/main/tray-icon.js',
        'src/main/ipc-handlers.js',
        'src/renderer/lib/utils/risk-scoring.js',
        'src/renderer/lib/utils/threat-report.js',
        'src/renderer/lib/stores/toast.js',
        'src/shared/constants.js',
      ],
    },
  },
});
