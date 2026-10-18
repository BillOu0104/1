process.env.BROWSER_BASELINE_COMMIT = '762ae5024c8369a8ffca3c187b602ee3ff7d5827';
process.env.BROWSER_BASELINE_LABEL = 'v021';
process.env.BROWSER_CANDIDATE_LABEL = 'v03';
process.env.BROWSER_OUTPUT ??= 'docs/benchmarks/browser-v03.json';
await import('./browser.mjs');
