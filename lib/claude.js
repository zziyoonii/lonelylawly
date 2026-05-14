const https = require('https');
const { extractRelevantSections } = require('./extract');
const { fetchLawSummary } = require('./law-api');

async function callClaude(tosText, ppText, planRaw) {
  const plan = planRaw && planRaw.length > 5000 ? planRaw.substring(0, 5000) : planRaw;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다.');
  }

  const tosExtracted = tosText ? extractRelevantSections(tosText) : '(미제공)';
  const ppExtracted = ppText ? extractRelevantSections(ppText) : '(미제공)';

  let lawContext = '';
  try {
    const summary = await fetchLawSummary();
    if (summary) lawContext = `\n[국가법령정보센터 기준 최신 법령 현황]\n${summary}\n위 법령의 최신 시행일·개정 현황을 참고하여 검토하세요.\n\n`;
  } catch (e) {
    console.warn('[law-api]', e.message);
  }

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
${lawContext}
---

## 서비스 기획안
${plan}

## 이용약관 (핵심 발췌)
${tosExtracted}

## 개인정보 처리방침 (핵심 발췌)
${ppExtracted}`;

  const body = JSON.stringify({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 8192,
    messages: [{ role: 'user', content: prompt }],
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      timeout: 60000,
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) return reject(new Error(`Claude 오류: ${parsed.error.message}`));
          const text = parsed.content?.[0]?.text;
          if (!text) return reject(new Error('Claude 응답이 비어있습니다'));
          resolve(text);
        } catch (e) {
          reject(new Error('Claude 응답 파싱 실패'));
        }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('Claude API 응답 시간 초과')); });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

module.exports = { callClaude };
