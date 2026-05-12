const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { jsonrepair } = require('jsonrepair');

// ── .env 파일 자동 로드 (npm 없이 직접 파싱)
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  let raw = fs.readFileSync(envPath, 'utf8');
  if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1); // BOM 제거
  raw.split(/\r?\n/).forEach(line => {
    line = line.trim();
    if (!line || line.startsWith('#')) return;
    const eq = line.indexOf('=');
    if (eq < 0) return;
    const key = line.slice(0, eq).trim();
    const val = line.slice(eq + 1).trim();
    if (key) process.env[key] = val;
  });
  console.log('✅ .env 파일 로드 완료');
}

const PORT = process.env.PORT || 3001;

// ── 1. URL 캐시 (메모리, 1시간 유효)
const urlCache = new Map();
const CACHE_TTL = 60 * 60 * 1000;

// ── IP별 요청 제한 (시간당 5회)
const rateLimit = new Map();
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW = 60 * 60 * 1000;
function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimit.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimit.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count++;
  return true;
}

function getCached(key) {
  const item = urlCache.get(key);
  if (!item) return null;
  if (Date.now() - item.time > CACHE_TTL) { urlCache.delete(key); return null; }
  return item.text;
}
function setCache(key, text) {
  urlCache.set(key, { text, time: Date.now() });
}

// ── 2. URL 크롤링
function fetchUrl(targetUrl, redirectCount = 0) {
  if (redirectCount > 5) return Promise.reject(new Error('리다이렉트 초과'));
  return new Promise((resolve, reject) => {
    const parsed = new URL(targetUrl);
    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.request({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
      },
      timeout: 12000,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = res.headers.location.startsWith('http')
          ? res.headers.location
          : `${parsed.protocol}//${parsed.hostname}${res.headers.location}`;
        fetchUrl(next, redirectCount + 1).then(resolve).catch(reject);
        return;
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve(data));
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('요청 시간 초과 (12초)')); });
    req.on('error', reject);
    req.end();
  });
}

// ── 3. HTML → 텍스트
function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ── 4. 핵심 섹션 추출 (토큰 절감)
const KEYWORDS = [
  '개인정보', '수집', '이용', '제공', '위탁', '파기', '보유', '처리',
  '동의', '권리', '의무', '제한', '금지', '책임', '손해', '위반',
  '제3자', '광고', '마케팅', '위치', '결제', '환불', '계정', '해지',
  '쿠키', '로그', '행태', '분석', '연동', '소셜', '로그인',
];

function extractRelevantSections(text, maxLength = 6000) {
  if (text.length <= maxLength) return text;
  const sentences = text.split(/(?<=[.。\n])\s+/);
  const topPart = sentences.slice(0, 20).join(' ');
  const relevant = sentences
    .map(s => ({ s, score: KEYWORDS.reduce((acc, kw) => acc + (s.includes(kw) ? 1 : 0), 0) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 80)
    .map(x => x.s)
    .join(' ');
  return (topPart + '\n\n[핵심 조항 발췌]\n' + relevant).substring(0, maxLength);
}
// ── 법령 API 캐시 (24시간)
const lawCache = new Map();
const LAW_CACHE_TTL = 24 * 60 * 60 * 1000;

const LAW_LIST = [
  { name: '개인정보보호법', lsiSeq: '270351' },
  { name: '정보통신망법',   lsiSeq: '277377' },
  { name: '전자상거래법',   lsiSeq: '269055' },
];

function fetchLawText(lsiSeq) {
  const oc = process.env.LAW_API_OC;
  if (!oc) return Promise.resolve('(법령 API 키 미설정)');

  const cached = lawCache.get(lsiSeq);
  if (cached && Date.now() - cached.time < LAW_CACHE_TTL) return Promise.resolve(cached.text);

  return new Promise((resolve) => {
    const path = `/DRF/lawService.do?OC=${oc}&target=law&MST=${lsiSeq}&type=XML`;
    const req = https.request({
      hostname: 'www.law.go.kr',
      path,
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 15000,
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        // XML에서 조문 내용만 추출
        const text = data
          .replace(/<조문부호>[^<]*<\/조문부호>/g, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s{2,}/g, ' ')
          .trim()
          .substring(0, 8000);
        lawCache.set(lsiSeq, { text, time: Date.now() });
        console.log(`[법령] ${lsiSeq} 로드 완료 (${text.length}자)`);
        resolve(text);
      });
    });
    req.on('error', (e) => { console.error(`[법령 오류] ${lsiSeq}: ${e.message}`); resolve('(법령 로드 실패)'); });
    req.on('timeout', () => { req.destroy(); resolve('(법령 로드 시간 초과)'); });
    req.end();
  });
}

async function loadAllLaws() {
  const results = await Promise.all(LAW_LIST.map(l => fetchLawText(l.lsiSeq)));
  return LAW_LIST.map((l, i) => `[${l.name}]\n${results[i]}`).join('\n\n');
}

// 서버 시작 시 법령 미리 로드
loadAllLaws().then(() => console.log('✅ 법령 데이터 로드 완료'));

// ── 5. Gemini Flash API 호출
async function callGemini(tosText, ppText, plan, lawText = '') {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY 환경변수가 설정되지 않았습니다.\n' +
      '▶ API 키 발급: https://aistudio.google.com/app/apikey\n' +
      '▶ 실행 방법: set GEMINI_API_KEY=여기에키입력 && node server.js'
    );
  }

  const tosExtracted = tosText ? extractRelevantSections(tosText) : '(미제공)';
  const ppExtracted  = ppText  ? extractRelevantSections(ppText)  : '(미제공)';

  const prompt = `당신은 한국 법률 기반 서비스 운영 준법 검토 전문가입니다.
서비스 기획안과 현재 이용약관/개인정보 처리방침을 비교하여 준법 검토를 수행합니다.
반드시 아래 JSON 형식으로만 응답하세요. 코드블록 없이 순수 JSON만 출력하세요.

{
  "verdict": "pass | partial | fail",
  "summary": "전체 검토 요약 2-3문장",
  "stats": { "ok": 숫자, "warning": 숫자, "critical": 숫자 },
  "issues": [
    {
      "title": "이슈 제목",
      "category": "이용약관 | 개인정보처리방침 | 공통",
      "severity": "critical | warning | info | ok",
      "description": "구체적인 문제 설명",
      "relatedClauses": ["관련 조항명"],
      "actions": ["선행 작업 1", "선행 작업 2"]
    }
  ],
  "overallRecommendation": "종합 권고 사항",
  "noticePeriod": "7일 | 30일",
  "noticeChannels": ["이메일", "서비스 내 공지", "띠배너/팝업"],
  "noticeReason": "공지 기간 및 채널 판단 근거 2-3문장",
  "noticeDraft": {
    "type": "이용약관 | 개인정보처리방침 | 이용약관 및 개인정보처리방침 중 해당하는 것",
    "keyPoints": [
      "실제 개정이 필요한 핵심 내용 1 (구체적으로, 예: 위치정보 수집 항목 신규 추가)",
      "실제 개정이 필요한 핵심 내용 2 (구체적으로, 예: 광고 파트너사 행동 데이터 제3자 제공 명시)",
      "실제 개정이 필요한 핵심 내용 3"
    ]
  }
}

[noticeDraft 작성 기준]
- noticeDraft는 반드시 포함하세요.
- keyPoints는 issues 중 severity가 critical/warning인 항목 기반으로 3-5개 작성하세요.
- "OOO 조항 추가", "OOO 수집 항목 신규 명시" 처럼 구체적으로 작성하세요. 추상적 표현 금지.
- verdict가 pass이면 keyPoints는 빈 배열 []로 반환하세요.

[noticePeriod 판단 기준 — 약관규제법 · 전자상거래법 · 개인정보보호법]
30일 전 공지 (회원에게 불리한 변경):
- 이용요금 신설 또는 인상
- 서비스 기능 축소 또는 삭제
- 이용자 책임 강화 또는 면책 범위 축소
- 개인정보 수집 항목 추가
- 개인정보 제3자 제공 범위 확대
- 개인정보 보유기간 연장
- 위약금/환불 정책 불리하게 변경
- 계정 정지/해지 사유 추가
- 분쟁해결 방식 변경 (재판관할 등)
- 서비스 유료 전환
- 광고성 정보 수신 동의 범위 확대
- 민감정보(위치, 생체, 아동 정보 등) 신규 수집

7일 전 공지 (회원에게 유리하거나 중립적인 변경):
- 서비스 기능 추가 또는 개선
- 이용자 권리 강화
- 개인정보 보유기간 단축
- 오탈자 및 문구 수정
- 법령 개정에 따른 단순 반영
- 회사 명칭/주소 등 기본정보 변경
- UI/UX 개선으로 이용 편의 증가

전체 이슈를 종합하여 가장 엄격한 기준을 적용하세요.
(예: critical 또는 30일 대상 이슈가 하나라도 있으면 → 30일)

[noticeChannels 판단 기준]
이메일 (전체 회원 개별 통보) 필수:
- 30일 공지 대상인 모든 변경사항
- 개인정보 처리방침 중요 변경 (수집항목 추가, 제3자 제공 확대)
- 유료 서비스 관련 변경
- 민감정보 신규 수집

서비스 내 공지 (공지사항 게시) 필수:
- 모든 약관 변경사항 (7일/30일 무관)

띠배너/팝업 권장:
- 30일 공지 대상 중 서비스 이용에 즉각 영향을 주는 변경
- 로그인 후 반드시 인지해야 하는 중요 변경
- 신규 기능 도입으로 추가 동의가 필요한 경우
- UI/UX 변경으로 이용 방식이 달라지는 경우

noticeChannels는 위 기준을 종합해 해당되는 채널을 모두 배열로 반환하세요.

---
## 참조 법령 (최신 현행)
${lawText || '(미로드)'}

## 서비스 기획안
${plan}

## 이용약관 (핵심 발췌)
${tosExtracted}

## 개인정보 처리방침 (핵심 발췌)
${ppExtracted}`;

  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 8192,
    },
  });

  console.log(`[Gemini] 요청 전송 중... (입력 약 ${Math.round(prompt.length / 4).toLocaleString()} 토큰 예상)`);

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 30000,
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);

          // 오류 응답 처리
          if (parsed.error) {
            return reject(new Error(`Gemini 오류: ${parsed.error.message}`));
          }

          const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
          if (!text) return reject(new Error('Gemini 응답이 비어있습니다: ' + data.substring(0, 300)));

          console.log(`[Gemini] 응답 수신 완료 (${text.length}자)`);
          resolve(text);
        } catch(e) {
          reject(new Error('Gemini 응답 파싱 실패: ' + data.substring(0, 300)));
        }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('Gemini API 응답 시간 초과')); });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── HTTP 서버
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const parsed = url.parse(req.url, true);

  // ── favicon & 이미지 (logo.png 등)
  const imgDir = path.join(__dirname, 'image.png');
  const publicDir = path.join(__dirname, 'public');
  const pathname = (parsed.pathname || '').split('?')[0];
  if (pathname === '/favicon.ico') {
    const faviconPath = path.join(publicDir, 'favicon.ico');
    if (fs.existsSync(faviconPath)) {
      res.writeHead(200, { 'Content-Type': 'image/x-icon' });
      res.end(fs.readFileSync(faviconPath));
      return;
    }
    res.writeHead(404); res.end();
    return;
  }
  if (pathname.startsWith('/images/')) {
    const relPath = pathname.slice('/images/'.length).replace(/\.\./g, '');
    const filePath = path.join(imgDir, relPath);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      const mimes = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
      res.writeHead(200, { 'Content-Type': mimes[ext] || 'application/octet-stream' });
      res.end(fs.readFileSync(filePath));
      return;
    }
  }

  // ── robots.txt
  if (pathname === '/robots.txt') {
    const base = (process.env.CANONICAL_URL || '').replace(/\/$/, '') || `http://localhost:${PORT}`;
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`User-agent: *\nAllow: /\nSitemap: ${base.replace(/\/$/, '')}/sitemap.xml\n`);
    return;
  }
  // ── sitemap.xml
  if (pathname === '/sitemap.xml') {
    const base = (process.env.CANONICAL_URL || '').replace(/\/$/, '') || `http://localhost:${PORT}`;
    res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8' });
    res.end(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${base}/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url></urlset>`);
    return;
  }
  // ── 정적 파일 (index.html) + SEO/GA/AdSense 환경변수 주입
  if (parsed.pathname === '/' || parsed.pathname === '/index.html') {
    const filePath = path.join(__dirname, 'public', 'index.html');
    if (!fs.existsSync(filePath)) {
      res.writeHead(404); res.end('index.html 파일이 없습니다. server.js와 같은 폴더에 넣어주세요.'); return;
    }
    let html = fs.readFileSync(filePath, 'utf8');
    const gaId = process.env.GA_MEASUREMENT_ID || '';
    const adsenseId = process.env.ADSENSE_CLIENT_ID || '';
    const canonicalUrl = process.env.CANONICAL_URL || '';
    html = html.replace('<!-- {{GA4_SCRIPT}} -->', gaId
      ? `<!-- GA4 --><script async src="https://www.googletagmanager.com/gtag/js?id=${gaId}"></script><script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${gaId}',{send_page_view:true});</script>`
      : '<!-- GA4: GA_MEASUREMENT_ID 미설정 -->');
    html = html.replace('<!-- {{ADSENSE_SCRIPT}} -->', adsenseId
      ? `<!-- AdSense --><script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${adsenseId}" crossorigin="anonymous"></script>`
      : '<!-- AdSense: ADSENSE_CLIENT_ID 미설정 -->');
    html = html.replace('{{CANONICAL_LINK}}', canonicalUrl
      ? `<link rel="canonical" href="${canonicalUrl}">`
      : '');
    const tossLink = process.env.TOSS_TRANSFER_LINK || 'supertoss://send?bank=092&accountNo=100007262511';
    html = html.replace(/\{\{TOSS_TRANSFER_LINK\}\}/g, tossLink);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  // ── URL 크롤링 API: GET /fetch?url=... 또는 /api/fetch?url=...
  if ((parsed.pathname === '/fetch' || parsed.pathname === '/api/fetch') && req.method === 'GET') {
    const targetUrl = parsed.query.url;
    if (!targetUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'url 파라미터가 필요합니다' }));
      return;
    }

    const cached = getCached(targetUrl);
    if (cached) {
      console.log(`[캐시 HIT] ${targetUrl}`);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, text: cached, length: cached.length, cached: true }));
      return;
    }

    try {
      console.log(`[크롤링] ${targetUrl}`);
      const html = await fetchUrl(targetUrl);
      const text = htmlToText(html);
      setCache(targetUrl, text);
      console.log(`[완료] ${text.length.toLocaleString()}자 → 캐시 저장`);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, text, length: text.length, cached: false }));
    } catch(e) {
      console.error(`[크롤링 오류] ${e.message}`);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ── 분석 API: POST /analyze 또는 /api/analyze
  if ((parsed.pathname === '/analyze' || parsed.pathname === '/api/analyze') && req.method === 'POST') {
    const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
    if (!checkRateLimit(ip)) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '요청이 너무 많습니다. 1시간 후 다시 시도해주세요.' }));
      return;
    }
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 100 * 1024) { req.destroy(); }
    });
    req.on('end', async () => {
      try {
        if (body.length > 100 * 1024) throw new Error('요청 크기가 너무 큽니다 (최대 100KB)');
        let { tosText, ppText, plan } = JSON.parse(body);
        if (!plan) throw new Error('기획안이 없습니다');
        if (plan.length > 5000) plan = plan.substring(0, 5000);

        const lawText = await loadAllLaws();
        const raw = await callGemini(tosText || '', ppText || '', plan, lawText);

        // JSON 추출 (Gemini가 가끔 마크다운 코드블록으로 감쌀 수 있음)
        const cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
        const match = cleaned.match(/\{[\s\S]*\}/);
        if (!match) throw new Error('JSON 파싱 실패. 응답: ' + cleaned.substring(0, 200));

        // JSON 안전 파싱 (제어문자 제거)
        let jsonStr = match[0]
          .replace(/[\u0000-\u001F\u007F]/g, ' ')  // 제어문자 제거
          .replace(/,(\s*[}\]])/g, '$1');           // trailing comma 제거

        let result;
        try {
          result = JSON.parse(jsonStr);
        } catch {
          try {
            jsonStr = jsonrepair(jsonStr);
            result = JSON.parse(jsonStr);
          } catch (e2) {
            throw new Error('JSON 파싱 실패. AI 응답 형식 오류: ' + e2.message);
          }
        }
        console.log('[noticeDraft]', JSON.stringify(result.noticeDraft, null, 2));
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: true, result }));
      } catch(e) {
        console.error(`[분석 오류] ${e.message}`);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log('');
  console.log('✅ 준법 검토기 서버 시작! (Gemini Flash 무료 티어)');
  console.log(`👉 브라우저: http://localhost:${PORT}`);
  console.log('');

  if (!process.env.GEMINI_API_KEY) {
    console.log('⚠️  GEMINI_API_KEY가 설정되지 않았습니다!');
    console.log('');
    console.log('1. API 키 발급 (무료):');
    console.log('   https://aistudio.google.com/app/apikey');
    console.log('');
    console.log('2. 서버 재시작:');
    console.log('   Windows: set GEMINI_API_KEY=발급받은키 && node server.js');
    console.log('   Mac/Linux: GEMINI_API_KEY=발급받은키 node server.js');
  } else {
    console.log('🔑 GEMINI_API_KEY 확인됨');
    console.log('');
    console.log('💡 무료 티어 제한: 분당 15회 요청');
    console.log('   테스트 용도로는 충분합니다!');
  }

  console.log('');
  console.log('📦 적용된 최적화:');
  console.log('   · Gemini Flash 무료 티어');
  console.log('   · 핵심 섹션 추출 (토큰 절감)');
  console.log('   · URL 캐싱 1시간');
  console.log('');
  console.log('종료: Ctrl+C');
});