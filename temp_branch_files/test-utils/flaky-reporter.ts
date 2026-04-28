import type {
  Reporter,
  TestCase,
  TestResult,
  FullResult,
} from '@playwright/test/reporter';
import * as fs from 'fs';
import * as path from 'path';

interface FlakyTestRecord {
  testName: string;
  projectName: string;
  failures: number;
  totalRuns: number;
  lastFailure: string;
  flakeRate: number;
  status: 'stable' | 'flaky' | 'investigating';
}

class FlakyReporter implements Reporter {
  private flakyTests: Map<string, FlakyTestRecord> = new Map();
  private outputPath = path.join(process.cwd(), 'test-results', 'flaky-tests.json');

  onBegin() {
    // Load existing flaky test data if available
    if (fs.existsSync(this.outputPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(this.outputPath, 'utf-8'));
        this.flakyTests = new Map(Object.entries(data));
      } catch (error) {
        console.warn('Failed to load existing flaky test data:', error);
      }
    }
  }

  onTestEnd(test: TestCase, result: TestResult) {
    const testKey = `${test.parent.project()?.name || 'unknown'}:${test.titlePath().join(' > ')}`;
    const record = this.flakyTests.get(testKey) || {
      testName: test.titlePath().join(' > '),
      projectName: test.parent.project()?.name || 'unknown',
      failures: 0,
      totalRuns: 0,
      lastFailure: '',
      flakeRate: 0,
      status: 'stable' as const,
    };

    record.totalRuns++;

    // Check if test failed or was retried
    if (result.status === 'failed' || result.status === 'timedOut') {
      record.failures++;
      record.lastFailure = new Date().toISOString();
    }

    // Calculate flake rate
    record.flakeRate = record.failures / record.totalRuns;

    // Update status based on flake rate
    if (record.flakeRate > 0.3 && record.totalRuns >= 10) {
      record.status = 'flaky';
    } else if (record.flakeRate === 0 && record.totalRuns >= 20) {
      record.status = 'stable';
    }

    this.flakyTests.set(testKey, record);
  }

  onEnd(result: FullResult) {
    // Ensure output directory exists
    const outputDir = path.dirname(this.outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Save flaky test data
    const data = Object.fromEntries(this.flakyTests);
    fs.writeFileSync(this.outputPath, JSON.stringify(data, null, 2));

    // Generate report
    const flakyTestsArray = Array.from(this.flakyTests.values())
      .filter((record) => record.status === 'flaky')
      .sort((a, b) => b.flakeRate - a.flakeRate);

    if (flakyTestsArray.length > 0) {
      console.log('\n⚠️  Flaky Tests Detected:\n');
      
      const critical = flakyTestsArray.filter((t) => t.flakeRate > 0.5);
      const warning = flakyTestsArray.filter((t) => t.flakeRate >= 0.3 && t.flakeRate <= 0.5);

      if (critical.length > 0) {
        console.log('🔴 Critical (>50% flake rate):');
        critical.forEach((test) => {
          console.log(
            `  - [${test.projectName}] ${test.testName} - ${(test.flakeRate * 100).toFixed(1)}% (${test.failures}/${test.totalRuns} failures)`
          );
        });
        console.log('');
      }

      if (warning.length > 0) {
        console.log('🟡 Warning (30-50% flake rate):');
        warning.forEach((test) => {
          console.log(
            `  - [${test.projectName}] ${test.testName} - ${(test.flakeRate * 100).toFixed(1)}% (${test.failures}/${test.totalRuns} failures)`
          );
        });
        console.log('');
      }

      console.log(`Full report saved to: ${this.outputPath}\n`);
    }
  }
}

export default FlakyReporter;
