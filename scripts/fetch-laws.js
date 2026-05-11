/**
 * 로컬 전용 법령 본문 갱신 스크립트
 * 실행: npm run fetch-laws
 * 필요: .env 파일에 LAW_API_OC 설정
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// .env 파일 직접 읽기 (dotenv 패키지 없이)
try {
  const envFile = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
  envFile.split('\n').forEach(line => {
    const [key, ...vals] = line.trim().split('=');
    if (key && vals.length) process.env[key] = vals.join('=');
  });
} catch { /* .env 없으면 환경변수에서 직접 읽음 */ }

const OC = process.env.LAW_API_OC;
if (!OC) {
  console.error('오류: .env 파일에 LAW_API_OC가 설정되어 있지 않습니다.');
  process.exit(1);
}

// 가져올 법령 목록 (법령 ID는 law.go.kr 검색 후 MST 번호)
const LAWS = [
  { name: '개인정보 보호법',                             mst: '270351' },
  { name: '개인정보 보호법 시행령',                      mst: '273745' },
  { name: '약관의 규제에 관한 법률',                     mst: '260021' },
  { name: '전자상거래 등에서의 소비자보호에 관한 법률',   mst: '282793' },
];

// 준법 검토에 필요한 핵심 조문만 추출
const KEY_ARTICLES = {
  '개인정보 보호법': ['제15조', '제17조', '제18조', '제20조', '제21조', '제22조', '제23조', '제24조', '제26조', '제30조', '제37조'],
  '개인정보 보호법 시행령': ['제14조', '제14조의2', '제15조', '제17조'],
  '약관의 규제에 관한 법률': ['제3조', '제6조', '제7조', '제8조', '제9조', '제10조', '제11조'],
  '전자상거래 등에서의 소비자보호에 관한 법률': ['제10조', '제11조', '제13조', '제17조', '제18조', '제21조'],
};

function fetchLawText(mst) {
  return new Promise((resolve) => {
    const reqPath = `/DRF/lawService.do?OC=${encodeURIComponent(OC)}&target=law&MST=${mst}&type=JSON`;
    const req = https.request({
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
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(null);
        }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', (e) => { console.warn('  연결 오류:', e.message); resolve(null); });
    req.end();
  });
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

  if (filtered.length === 0) {
    return arr.slice(0, 10).map(formatArticle).join('\n\n');
  }

  return filtered.map(formatArticle).join('\n\n');
}

function formatArticle(a) {
  const num = a?.조문번호 ?? '';
  const title = a?.조문제목 ?? '';
  const content = a?.조문내용 ?? a?.조항내용 ?? '';
  return `${num} ${title}\n${content}`.trim();
}

async function main() {
  console.log('법령 본문 가져오는 중...\n');

  const sections = [];

  for (const law of LAWS) {
    process.stdout.write(`  ${law.name} ... `);
    const json = await fetchLawText(law.mst);

    if (!json) {
      console.log('실패 (건너뜀)');
      sections.push(`[${law.name}]\n(데이터 없음)`);
      continue;
    }

    const text = extractArticles(json, law.name);
    sections.push(`[${law.name}]\n${text}`);
    console.log(`완료 (${text.length}자)`);
  }

  const summary = sections.join('\n\n---\n\n');
  const cacheFile = path.join(__dirname, '..', 'lib', 'law-data-cache.json');

  fs.writeFileSync(cacheFile, JSON.stringify({
    summary,
    builtAt: new Date().toISOString(),
    note: '법령 본문 자동 수집 — scripts/fetch-laws.js로 갱신',
  }, null, 2));

  console.log(`\n완료! law-data-cache.json 업데이트됨 (${summary.length}자)`);
  console.log('이제 git add lib/law-data-cache.json && git push 하세요.');
}

main().catch(console.error);
