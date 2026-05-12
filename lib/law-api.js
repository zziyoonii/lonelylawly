const http = require('http');
const fs = require('fs');
const path = require('path');

const LAWS = [
  { name: '개인정보 보호법',                             mst: '161067' },
  { name: '개인정보 보호법 시행령',                      mst: '161068' },
  { name: '약관의 규제에 관한 법률',                     mst: '12989'  },
  { name: '전자상거래 등에서의 소비자보호에 관한 법률',   mst: '70156'  },
];

const KEY_ARTICLES = {
  '개인정보 보호법': ['제15조', '제17조', '제18조', '제20조', '제21조', '제22조', '제23조', '제24조', '제26조', '제30조', '제37조'],
  '개인정보 보호법 시행령': ['제14조', '제14조의2', '제15조', '제17조'],
  '약관의 규제에 관한 법률': ['제3조', '제6조', '제7조', '제8조', '제9조', '제10조', '제11조'],
  '전자상거래 등에서의 소비자보호에 관한 법률': ['제10조', '제11조', '제13조', '제17조', '제18조', '제21조'],
};

// 메모리 캐시 (24시간)
let memCache = null;
let memCacheAt = 0;
const CACHE_TTL = 24 * 60 * 60 * 1000;

function fetchLawText(oc, mst) {
  return new Promise((resolve) => {
    const reqPath = `/DRF/lawService.do?OC=${encodeURIComponent(oc)}&target=law&MST=${mst}&type=JSON`;
    const req = http.request({
      hostname: 'www.law.go.kr',
      path: reqPath,
      method: 'GET',
      timeout: 20000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; LawFormBot/1.0)',
        'Accept': 'application/json',
      },
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve(null); }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
    req.end();
  });
}

function formatArticle(a) {
  const num = a?.조문번호 ?? '';
  const title = a?.조문제목 ?? '';
  const content = a?.조문내용 ?? a?.조항내용 ?? '';
  return `${num} ${title}\n${content}`.trim();
}

function extractArticles(lawJson, lawName) {
  if (!lawJson) return '';
  const keyList = KEY_ARTICLES[lawName] || [];
  const articles = lawJson?.law?.조문?.조문내용 ?? lawJson?.법령?.조문?.조문내용 ?? [];
  const arr = Array.isArray(articles) ? articles : [articles];
  const filtered = arr.filter(a => {
    const title = a?.조문제목 ?? a?.조문번호 ?? '';
    return keyList.some(k => title.includes(k.replace('제', '').replace('조', '')));
  });
  return (filtered.length === 0 ? arr.slice(0, 10) : filtered).map(formatArticle).join('\n\n');
}

async function fetchFromApi(oc) {
  const sections = [];
  for (const law of LAWS) {
    const json = await fetchLawText(oc, law.mst);
    const text = extractArticles(json, law.name);
    sections.push(`[${law.name}]\n${text || '(데이터 없음)'}`);
  }
  return sections.join('\n\n---\n\n');
}

function readStaticCache() {
  try {
    const cacheFile = path.join(__dirname, 'law-data-cache.json');
    const data = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    return data.summary || '';
  } catch {
    return '';
  }
}

async function fetchLawSummary() {
  // 메모리 캐시 유효하면 바로 반환
  if (memCache && Date.now() - memCacheAt < CACHE_TTL) {
    return memCache;
  }

  const oc = process.env.LAW_API_OC;
  if (oc) {
    try {
      const summary = await fetchFromApi(oc);
      if (summary) {
        memCache = summary;
        memCacheAt = Date.now();
        return summary;
      }
    } catch {
      // API 실패 시 정적 캐시로 fallback
    }
  }

  return readStaticCache();
}

module.exports = { fetchLawSummary };
