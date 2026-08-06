# 아임웹 삽입용 법인회생 가능성 예비진단

재무제표 PDF를 사용자의 브라우저 안에서 직접 읽고 주요 재무수치를 추출한 뒤, 지급불능 위험과 계속기업 가능성을 정량적으로 비교하는 정적 웹페이지입니다.

## 핵심 구조

- 입력과 결과 화면: 아임웹 페이지의 코드 위젯 안 `iframe`
- 페이지 호스팅: GitHub Pages
- PDF 분석: 브라우저 안의 PDF.js, 스캔본은 Tesseract.js OCR 보조 분석
- 파일 저장·외부 전송: 없음
- 진단 방식: 입력값을 기반으로 한 규칙형 예비진단

GitHub Pages는 서버가 아니라 정적 호스팅이므로 OpenAI 같은 외부 AI API의 비밀키를 안전하게 보관할 수 없습니다. 이 버전은 API 키 없이 동작하며, 이용자의 재무제표가 GitHub나 별도 서버로 전송되지 않습니다.

## GitHub Pages에 올리기

1. 새 GitHub 저장소를 만듭니다.
2. 이 폴더의 `index.html`, `styles.css`, `app.js`, `vendor` 폴더를 저장소 최상위에 업로드합니다.
3. GitHub 저장소의 **Settings → Pages**로 이동합니다.
4. **Build and deployment → Source**를 `Deploy from a branch`로 선택합니다.
5. `main` 브랜치와 `/(root)`를 선택하고 저장합니다.
6. 표시되는 `https://사용자명.github.io/저장소명/` 주소를 복사합니다.

## 아임웹 코드 위젯에 삽입하기

아래 코드를 아임웹의 코드 위젯에 붙여넣고 `src`를 실제 GitHub Pages 주소로 바꿉니다.

```html
<div style="width:100%;overflow:hidden;">
  <iframe
    id="recovery-diagnosis-frame"
    src="https://cho7711.github.io/corporate-recovery-check/"
    title="법인회생 가능성 예비진단"
    style="display:block;width:100%;height:1500px;border:0;background:#f7f5ef;"
    loading="lazy"
  ></iframe>
</div>

<script>
  window.addEventListener("message", function (event) {
    if (event.origin !== "https://cho7711.github.io") return;
    if (!event.data || event.data.type !== "CORP_RECOVERY_RESIZE") return;
    var frame = document.getElementById("recovery-diagnosis-frame");
    if (frame && Number(event.data.height)) {
      frame.style.height = Math.max(900, Number(event.data.height)) + "px";
    }
  });
</script>
```

삽입 코드의 `event.origin` 조건은 `cho7711.github.io`에서 온 높이 조정 메시지만 허용합니다.

## PDF 자동 추출 범위

현재 아래 항목의 일반적인 한글 계정명을 인식합니다.

- 유동자산, 유동부채, 자산총계, 부채총계
- 매출액, 영업이익(손실), 당기순이익(손실)
- 현금 및 현금성자산, 이자비용, 영업활동 현금흐름

PDF 표 구조에 따라 숫자가 잘못 연결될 수 있어, 결과 계산 전에 반드시 입력값을 사용자가 확인하도록 설계했습니다. 이미지로 스캔된 PDF는 최대 10페이지까지 브라우저 OCR을 시도하며, 인식이 제한적인 항목은 사용자가 직접 입력할 수 있습니다. OCR 실행 시 엔진과 한글 언어 데이터만 외부 CDN에서 내려받고 문서 이미지는 외부로 전송하지 않습니다.

## 운영 전 확인사항

- 페이지의 상호·로고·상담 연결 문구를 실제 서비스에 맞게 수정
- 변호사 또는 회계사의 진단 문구와 산식 검토
- 실제 재무제표 여러 종류로 추출 정확도 테스트
- 개인정보처리방침 및 서비스 이용 고지 연결
- 아임웹 모바일 화면에서 `iframe` 높이와 여백 확인

이 도구의 결과는 법원의 회생절차 개시 또는 인가를 예측하거나 보장하는 법률 의견이 아닙니다.
