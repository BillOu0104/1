process.env.BROWSER_BASELINE_COMMIT = '39d830bdcbf13bc0c4c7e0e799115c42b6303265';
process.env.BROWSER_BASELINE_LABEL = 'v02';
process.env.BROWSER_CANDIDATE_LABEL = 'v021';
process.env.BROWSER_OUTPUT ??= 'docs/benchmarks/browser-v021.json';
await import('./browser.mjs');
