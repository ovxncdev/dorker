import { OutputWriter, formatNumber, formatDuration } from './output.js';

const output = new OutputWriter({
  directory: './test-output',
  prefix: 'test',
  format: 'txt'
});

console.log('Testing Output Writer\n');

// Write some URLs
output.writeUrl('https://example1.com/admin', { dork: 'inurl:admin' });
output.writeUrl('https://example2.com/login', { dork: 'inurl:login' });
output.writeUrls(['https://site1.com', 'https://site2.com', 'https://site3.com'], 'test dork');

// Write domains
output.writeDomains(['example1.com', 'example2.com', 'site1.com']);

console.log('Files created in:', output.getOutputDir());
console.log('Counts:', output.getCounts());

// Test formatters
console.log('\nFormatter tests:');
console.log('  formatNumber(1234567):', formatNumber(1234567));
console.log('  formatDuration(3661000):', formatDuration(3661000));
console.log('  formatDuration(125000):', formatDuration(125000));

await output.close();
console.log('\n✓ Output test complete');
console.log('Check:', output.getOutputDir());
