import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './tests/visual',
    testMatch: 'ui-regression.spec.js',
    fullyParallel: false,
    workers: 1,
    retries: process.env.CI ? 1 : 0,
    timeout: 30_000,
    preserveOutput: 'always',
    expect: {
        timeout: 5_000,
    },
    outputDir: 'test-results/ui-regression',
    reporter: [
        ['line'],
        ['html', { open: 'never', outputFolder: 'playwright-report' }],
    ],
    use: {
        browserName: 'chromium',
        colorScheme: 'dark',
        deviceScaleFactor: 1,
        locale: 'ko-KR',
        screenshot: 'only-on-failure',
        trace: 'retain-on-failure',
    },
});
