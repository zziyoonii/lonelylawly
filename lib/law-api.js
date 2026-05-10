const http = require('http');
const fs = require('fs');
const path = require('path');

const LAW_QUERIES = [
  '개인정보보호법',
  '개인정보 보호법 시행령',
  '약관의 규제에 관한 법률',
  '전자상거래 등에서의 소비자보호에 관한 법률',
];

const CACHE_MS = 24 * 60 * 60 * 1000; // 24시간
let runtimeCache = null;
let runtimeCacheTime = 0;

function loadBuildCache() {
  try {
    const cacheFile = path.join(__dirname, 'law-data-cache.json');
    const data = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    return data.summary || '';
  } catch {
    return null;
  }
}

function fetchLawList(oc, query) {
  return new Promise((resolve) => {
    const reqPath = `/DRF/lawSearch.do?OC=${encodeURIComponent(oc)}&target=law&type=JSON&query=${encodeURIComponent(query)}&display=5&sort=efdes`;
    const req = http.request({
      hostname: 'www.law.go.kr',
      path: reqPath,
      method: 'GET',
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; LawFormBot/1.0)',
        'Accept': 'application/json',
      },
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          let list = json?.law ?? json?.Law ?? [];
          if (!Array.isArray(list)) list = list ? [list] : [];
          resolve(list.slice(0, 3).map(l => ({
            name: l.법령명한글 ?? l['법령명한글'] ?? l.법령명 ?? '',
            effDate: l.시행일자 ?? l['시행일자'],
            amend: l.제개정구분명 ?? l['제개정구분명'] ?? '',
          })).filter(l => l.name));
        } catch {
          resolve([]);
        }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve([]); });
    req.on('error', () => resolve([]));
    req.end();
  });
}

async function fetchLawSummary(oc) {
  // 빌드 시점에 저장된 캐시 우선 사용
  const buildCache = loadBuildCache();
  if (buildCache !== null) return buildCache;

  // 빌드 캐시 없으면 런타임 API 호출 (로컬 개발 환경)
  if (runtimeCache && Date.now() - runtimeCacheTime < CACHE_MS) return runtimeCache;

  const ocVal = oc || process.env.LAW_API_OC;
  if (!ocVal) return '';

  const results = [];
  for (const q of LAW_QUERIES) {
    const list = await fetchLawList(ocVal, q);
    if (list.length > 0) {
      const lines = list.map(l => {
        const eff = String(l.effDate || '').replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');
        return `- ${l.name}: ${l.amend || '현행'} (시행 ${eff})`;
      });
      results.push(`[${q}]\n${lines.join('\n')}`);
    }
  }

  runtimeCache = results.length > 0 ? results.join('\n\n') : '';
  runtimeCacheTime = Date.now();
  return runtimeCache;
}

module.exports = { fetchLawSummary };
