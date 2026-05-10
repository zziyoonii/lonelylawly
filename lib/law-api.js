const fs = require('fs');
const path = require('path');

function fetchLawSummary() {
  try {
    const cacheFile = path.join(__dirname, 'law-data-cache.json');
    const data = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    return Promise.resolve(data.summary || '');
  } catch {
    return Promise.resolve('');
  }
}

module.exports = { fetchLawSummary };
