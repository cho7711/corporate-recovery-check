import * as pdfjsLib from "./vendor/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = "./vendor/pdf.worker.min.mjs";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const clamp = (value, min = 0, max = 100) => Math.min(max, Math.max(min, value));

const fileInput = $("#pdf-file");
const dropzone = $("#dropzone");
const uploadStatus = $("#upload-status");
const verifySection = $("#verify-section");
const resultSection = $("#result-section");
const form = $("#diagnosis-form");

const aliases = {
  currentAssets: ["유동자산", "유동 자산"],
  currentLiabilities: ["유동부채", "유동 부채"],
  totalAssets: ["자산총계", "자산 총계", "자산합계"],
  totalLiabilities: ["부채총계", "부채 총계", "부채합계"],
  revenue: ["매출액", "영업수익", "수익(매출액)", "매출"],
  operatingProfit: ["영업이익(손실)", "영업이익", "영업손실"],
  netIncome: ["당기순이익(손실)", "당기순이익", "당기순손실", "분기순이익"],
  cash: ["현금및현금성자산", "현금 및 현금성자산", "현금성자산"],
  interestExpense: ["이자비용", "금융비용"],
  operatingCashFlow: ["영업활동으로인한현금흐름", "영업활동 현금흐름", "영업활동현금흐름"],
};

const sample = {
  companyName: "주식회사 새봄",
  fiscalYear: new Date().getFullYear() - 1,
  amountUnit: "1000000",
  currentAssets: 1580,
  currentLiabilities: 3270,
  totalAssets: 6240,
  totalLiabilities: 7080,
  revenue: 8120,
  operatingProfit: 360,
  netIncome: -520,
  cash: 190,
  interestExpense: 280,
  operatingCashFlow: 310,
};

function updateStep(step) {
  $$(".steps li").forEach((item, index) => {
    item.classList.toggle("active", index + 1 === step);
    item.classList.toggle("complete", index + 1 < step);
  });
}

function announceHeight() {
  window.parent.postMessage(
    { type: "CORP_RECOVERY_RESIZE", height: Math.ceil(document.body.getBoundingClientRect().height) },
    "*",
  );
}

const resizeObserver = new ResizeObserver(() => announceHeight());
resizeObserver.observe(document.body);
window.addEventListener("load", announceHeight);

function parseNumber(value) {
  if (typeof value === "number") return value;
  if (!value) return 0;
  let cleaned = String(value).trim().replace(/,/g, "").replace(/\s/g, "");
  let negative = false;
  if (/^\(.*\)$/.test(cleaned) || /^[△▲]/.test(cleaned)) negative = true;
  cleaned = cleaned.replace(/[()△▲]/g, "");
  const number = Number(cleaned);
  return Number.isFinite(number) ? (negative ? -Math.abs(number) : number) : 0;
}

function findNumbers(text) {
  const matches = text.match(/[△▲-]?\s*\(?\d{1,3}(?:,\d{3})+(?:\.\d+)?\)?|[△▲-]?\s*\(?\d+(?:\.\d+)?\)?/g) || [];
  return matches
    .map((raw) => ({ raw, value: parseNumber(raw) }))
    .filter(({ raw, value }) => Math.abs(value) > 0 && !(value >= 1900 && value <= 2100 && !raw.includes(",")));
}

function extractMetric(lines, names) {
  for (const name of names) {
    const normalizedName = name.replace(/\s/g, "");
    const candidates = lines.filter((line) => line.replace(/\s/g, "").includes(normalizedName));
    for (const line of candidates) {
      if (/%|비율/.test(line)) continue;
      const compact = line.replace(/\s/g, "");
      const index = compact.indexOf(normalizedName);
      const trailing = compact.slice(index + normalizedName.length);
      const numbers = findNumbers(trailing);
      if (numbers.length) {
        const firstLooksLikeNoteNumber =
          numbers.length >= 2 &&
          Math.abs(numbers[0].value) < 100 &&
          !numbers[0].raw.includes(",") &&
          (numbers[1].raw.includes(",") || Math.abs(numbers[1].value) >= 100);
        return numbers[firstLooksLikeNoteNumber ? 1 : 0].value;
      }
    }
  }
  return null;
}

function itemsToLines(items) {
  const rows = [];
  for (const item of items) {
    if (!item.str || !item.str.trim()) continue;
    const x = item.transform?.[4] || 0;
    const y = item.transform?.[5] || 0;
    let row = rows.find((entry) => Math.abs(entry.y - y) < 2.5);
    if (!row) {
      row = { y, items: [] };
      rows.push(row);
    }
    row.items.push({ x, text: item.str.trim() });
  }
  return rows
    .sort((a, b) => b.y - a.y)
    .map((row) => row.items.sort((a, b) => a.x - b.x).map((item) => item.text).join(" "));
}

async function readPdf(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
  const allLines = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    allLines.push(...itemsToLines(content.items));
  }
  return { lines: allLines, pages: pdf.numPages, text: allLines.join("\n") };
}

function detectUnit(text) {
  const compact = text.replace(/\s/g, "");
  if (/단위[:：]?백만원/.test(compact)) return "1000000";
  if (/단위[:：]?천원/.test(compact)) return "1000";
  if (/단위[:：]?원/.test(compact)) return "1";
  return "1000000";
}

function detectYear(text) {
  const years = [...text.matchAll(/20\d{2}/g)].map((match) => Number(match[0]));
  const current = new Date().getFullYear();
  return years.find((year) => year >= 2000 && year <= current) || current - 1;
}

function setFormValues(values) {
  Object.entries(values).forEach(([name, value]) => {
    const input = form.elements.namedItem(name);
    if (input && "value" in input && value !== null && value !== undefined) input.value = String(value);
  });
}

function showVerification({ scroll = true } = {}) {
  verifySection.hidden = false;
  resultSection.hidden = true;
  updateStep(2);
  announceHeight();
  if (scroll) setTimeout(() => verifySection.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
}

async function handleFile(file) {
  if (!file) return;
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    alert("PDF 파일만 업로드할 수 있습니다.");
    return;
  }
  if (file.size > 25 * 1024 * 1024) {
    alert("파일 크기는 25MB 이하여야 합니다.");
    return;
  }

  dropzone.hidden = true;
  uploadStatus.hidden = false;
  $("#status-title").textContent = "재무제표를 읽고 있습니다…";
  $("#status-detail").textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)}MB`;

  try {
    const result = await readPdf(file);
    const extracted = {};
    let found = 0;
    Object.entries(aliases).forEach(([key, names]) => {
      const value = extractMetric(result.lines, names);
      extracted[key] = value ?? "";
      if (value !== null) found += 1;
    });
    extracted.amountUnit = detectUnit(result.text);
    extracted.fiscalYear = detectYear(result.text);
    setFormValues(extracted);
    $("#status-title").textContent = found >= 4 ? "주요 재무수치를 찾았습니다" : "PDF 확인이 완료되었습니다";
    $("#status-detail").textContent = found >= 4
      ? `${file.name} · ${result.pages}페이지 · ${found}개 항목 자동 추출`
      : `${file.name} · 문자인식이 제한적입니다. 아래에서 수치를 직접 입력해주세요.`;
    showVerification();
  } catch (error) {
    console.error(error);
    $("#status-title").textContent = "자동 추출이 어려운 PDF입니다";
    $("#status-detail").textContent = `${file.name} · 아래에서 수치를 직접 입력해주세요.`;
    showVerification();
  }
}

fileInput.addEventListener("change", (event) => handleFile(event.target.files?.[0]));
dropzone.addEventListener("dragover", (event) => { event.preventDefault(); dropzone.classList.add("dragging"); });
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragging"));
dropzone.addEventListener("drop", (event) => {
  event.preventDefault();
  dropzone.classList.remove("dragging");
  handleFile(event.dataTransfer.files?.[0]);
});

$("#remove-file").addEventListener("click", () => {
  fileInput.value = "";
  uploadStatus.hidden = true;
  dropzone.hidden = false;
  verifySection.hidden = true;
  resultSection.hidden = true;
  updateStep(1);
  announceHeight();
});

$("#sample-button").addEventListener("click", () => {
  setFormValues(sample);
  uploadStatus.hidden = false;
  dropzone.hidden = true;
  $("#status-title").textContent = "샘플 재무정보를 불러왔습니다";
  $("#status-detail").textContent = "가상의 제조기업 수치입니다. 자유롭게 수정해보세요.";
  showVerification();
});

function getFormData() {
  const data = Object.fromEntries(new FormData(form));
  const numericKeys = Object.keys(aliases);
  numericKeys.forEach((key) => { data[key] = parseNumber(data[key]); });
  data.fiscalYear = parseNumber(data.fiscalYear);
  return data;
}

function pct(value, digits = 1) {
  if (!Number.isFinite(value)) return value === Infinity ? "자본잠식" : "-";
  return `${value.toFixed(digits)}%`;
}

function multiple(value) {
  if (!Number.isFinite(value)) return "-";
  return `${value.toFixed(2)}배`;
}

function diagnose(data) {
  const equity = data.totalAssets - data.totalLiabilities;
  const currentRatio = data.currentLiabilities ? (data.currentAssets / data.currentLiabilities) * 100 : NaN;
  const debtRatio = equity > 0 ? (data.totalLiabilities / equity) * 100 : Infinity;
  const operatingMargin = data.revenue ? (data.operatingProfit / data.revenue) * 100 : NaN;
  const interestCoverage = data.interestExpense > 0 ? data.operatingProfit / data.interestExpense : NaN;
  const liabilityToAsset = data.totalAssets ? data.totalLiabilities / data.totalAssets : 0;

  let distress = 12;
  if (Number.isFinite(currentRatio) && currentRatio < 100) distress += currentRatio < 50 ? 24 : 16;
  if (equity < 0) distress += 28;
  else if (liabilityToAsset > 0.8) distress += 16;
  if (data.netIncome < 0) distress += 10;
  if (data.operatingProfit < 0) distress += 9;
  if (data.arrears === "yes") distress += 14;
  if (data.attachment === "yes") distress += 10;
  if (data.taxArrears === "yes") distress += 7;
  distress = Math.round(clamp(distress));

  let viability = 42;
  if (data.revenue > 0) viability += 13;
  if (data.operatingProfit > 0) viability += 16;
  else if (data.operatingProfit < 0) viability -= 17;
  if (data.operatingCashFlow > 0) viability += 12;
  else if (data.operatingCashFlow < 0) viability -= 12;
  if (data.businessContinuing === "yes") viability += 12;
  else viability -= 25;
  if (Number.isFinite(operatingMargin) && operatingMargin >= 3) viability += 5;
  viability = Math.round(clamp(viability));

  let restructure = 55;
  if (data.cash > 0 && data.currentLiabilities && data.cash / data.currentLiabilities >= 0.08) restructure += 8;
  if (data.operatingCashFlow > 0) restructure += 12;
  if (data.operatingProfit > 0) restructure += 8;
  if (data.attachment === "yes") restructure -= 14;
  if (data.taxArrears === "yes") restructure -= 8;
  if (equity < 0) restructure -= 6;
  restructure = Math.round(clamp(restructure));

  let fit = Math.round(8 + distress * 0.47 + viability * 0.33 + restructure * 0.12);
  if (viability < 35) fit = Math.min(fit, 54);
  if (distress < 35) fit = Math.min(fit, 62);
  fit = clamp(fit, 10, 94);

  let title;
  let emphasis;
  let kicker;
  let summary;
  if (distress >= 55 && viability >= 55) {
    title = "회생절차 검토 가치가";
    emphasis = "높습니다";
    kicker = "회생절차 검토 구간";
    summary = "재무적 위기는 확인되지만 영업과 현금창출 기반이 남아 있어, 채무조정 후 계속기업가치를 검토할 실익이 있습니다.";
  } else if (distress >= 55) {
    title = "긴급한 위기 대응과";
    emphasis = "사업성 검토가 필요합니다";
    kicker = "긴급 전문가 검토 구간";
    summary = "지급불능 위험이 높고 현재 사업성 지표도 약합니다. 보전처분 필요성과 함께 회생·파산·매각 대안을 동시에 비교해야 합니다.";
  } else if (viability >= 55) {
    title = "자율 구조조정을";
    emphasis = "먼저 검토하세요";
    kicker = "사전 구조조정 검토 구간";
    summary = "계속기업 가능성은 양호하고 위기 수준은 아직 제한적입니다. 회생신청 전 금융기관 협의, 워크아웃, 비용개선 방안을 우선 검토할 수 있습니다.";
  } else {
    title = "종합 상담으로";
    emphasis = "대안을 비교하세요";
    kicker = "추가자료 검토 구간";
    summary = "현재 입력만으로는 회생절차 적합성을 단정하기 어렵습니다. 채무 만기, 담보, 수주잔고와 자금계획을 추가해 대안을 비교해야 합니다.";
  }

  const findings = [];
  if (equity < 0) findings.push({ risk: true, text: `부채가 자산을 ${Math.abs(equity).toLocaleString("ko-KR")}만큼 초과해 완전자본잠식 가능성이 있습니다.` });
  else if (liabilityToAsset > 0.8) findings.push({ risk: true, text: `부채가 총자산의 ${(liabilityToAsset * 100).toFixed(1)}%로 재무 레버리지가 높은 편입니다.` });
  else findings.push({ risk: false, text: `자산이 부채를 상회해 장부상 순자산이 남아 있습니다.` });
  if (Number.isFinite(currentRatio)) findings.push({ risk: currentRatio < 100, text: currentRatio < 100 ? `유동비율이 ${currentRatio.toFixed(1)}%로 단기채무 대응 부담이 큽니다.` : `유동비율이 ${currentRatio.toFixed(1)}%로 단기 유동성은 비교적 안정적입니다.` });
  if (data.operatingProfit > 0) findings.push({ risk: false, text: `영업이익이 발생해 채무조정 이후 사업 유지 가능성을 뒷받침합니다.` });
  else findings.push({ risk: true, text: `영업손실이 발생해 손익개선 방안과 구체적인 매출 근거가 필요합니다.` });
  if (data.operatingCashFlow > 0) findings.push({ risk: false, text: `영업활동 현금흐름이 양수여서 회생계획 수행재원 검토에 유리합니다.` });
  if (data.attachment === "yes" || data.arrears === "yes") findings.push({ risk: true, text: `연체 또는 집행절차가 확인되어 자금 유출과 채권자 조치에 대한 신속한 대응이 필요합니다.` });

  return { equity, currentRatio, debtRatio, operatingMargin, interestCoverage, distress, viability, restructure, fit, title, emphasis, kicker, summary, findings: findings.slice(0, 4) };
}

function renderResult(data, result) {
  $("#result-kicker").textContent = result.kicker;
  $("#result-title").innerHTML = `${result.title} <em>${result.emphasis}</em>`;
  $("#result-summary").textContent = result.summary;
  $("#fit-score").textContent = result.fit;
  $("#score-ring").style.setProperty("--score", result.fit);

  const flags = [];
  flags.push(data.businessContinuing === "yes" ? "영업 계속 중" : "영업 중단 상태");
  flags.push(result.equity < 0 ? "자본잠식 가능" : "순자산 보유");
  if (data.arrears === "yes") flags.push("연체 발생");
  if (data.operatingProfit > 0) flags.push("영업이익 발생");
  $("#result-flags").innerHTML = flags.map((flag) => `<span>${flag}</span>`).join("");

  const axes = [
    ["distress", result.distress],
    ["viability", result.viability],
    ["restructure", result.restructure],
  ];
  axes.forEach(([key, value]) => {
    $(`#${key}-value`).textContent = value;
    setTimeout(() => { $(`#${key}-bar`).style.width = `${value}%`; }, 100);
  });

  $("#current-ratio").textContent = pct(result.currentRatio);
  $("#debt-ratio").textContent = pct(result.debtRatio);
  $("#operating-margin").textContent = pct(result.operatingMargin);
  $("#interest-coverage").textContent = multiple(result.interestCoverage);
  $("#findings-list").innerHTML = result.findings
    .map((finding) => `<li class="${finding.risk ? "risk" : "positive"}">${finding.text}</li>`)
    .join("");
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = getFormData();
  if (data.totalAssets <= 0 || data.totalLiabilities < 0 || data.revenue <= 0) {
    alert("자산총계, 부채총계, 매출액을 올바르게 입력해주세요.");
    return;
  }
  const result = diagnose(data);
  renderResult(data, result);
  resultSection.hidden = false;
  updateStep(3);
  announceHeight();
  setTimeout(() => resultSection.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
});

$("#restart-button").addEventListener("click", () => {
  form.reset();
  resultSection.hidden = true;
  verifySection.hidden = true;
  uploadStatus.hidden = true;
  dropzone.hidden = false;
  fileInput.value = "";
  updateStep(1);
  window.scrollTo({ top: 0, behavior: "smooth" });
  announceHeight();
});

$("#print-button").addEventListener("click", () => window.print());
