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
const OCR_MAX_PAGES = 10;
const OCR_RENDER_SCALE = 2.8;
const OCR_DARK_PIXEL_THRESHOLD = 185;
const TESSERACT_CDN = "https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/tesseract.min.js";

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

function formatAmount(value) {
  if (value === null || value === undefined || value === "") return "";

  const original = String(value);
  let raw = original.trim().replace(/,/g, "").replace(/\s/g, "");
  let sign = "";

  if (/^\(.*\)$/.test(raw) || /^[△▲]/.test(raw)) {
    sign = "-";
    raw = raw.replace(/[()△▲]/g, "");
  } else if (raw.startsWith("-")) {
    sign = "-";
    raw = raw.slice(1);
  }

  if (!/^\d*(?:\.\d*)?$/.test(raw) || raw === "") return original;

  const [integerPart = "0", decimalPart] = raw.split(".");
  const integer = (integerPart || "0").replace(/^0+(?=\d)/, "");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}${grouped}${decimalPart !== undefined ? `.${decimalPart}` : ""}`;
}

function formatKoreanGroup(group) {
  if (group >= 1000 && group % 1000 === 0) return `${group / 1000}천`;
  if (group >= 100 && group % 100 === 0) return `${group / 100}백`;
  if (group >= 10 && group % 10 === 0) return `${group / 10}십`;
  return group.toLocaleString("ko-KR");
}

function formatKoreanWon(value, multiplier = 1) {
  if (value === null || value === undefined || String(value).trim() === "") return "";

  const numeric = parseNumber(value) * parseNumber(multiplier);
  if (!Number.isFinite(numeric)) return "";

  let remaining = Math.round(Math.abs(numeric));
  if (remaining === 0) return "0원";

  const largeUnits = ["", "만", "억", "조", "경"];
  const parts = [];
  let unitIndex = 0;
  while (remaining > 0 && unitIndex < largeUnits.length) {
    const group = remaining % 10000;
    if (group > 0) parts.unshift(`${formatKoreanGroup(group)}${largeUnits[unitIndex]}`);
    remaining = Math.floor(remaining / 10000);
    unitIndex += 1;
  }

  const sign = numeric < 0 ? "마이너스 " : "";
  return `${sign}${parts.join(" ")} 원`;
}

function updateKoreanAmount(name) {
  const input = form.elements.namedItem(name);
  const output = document.querySelector(`[data-amount-korean="${name}"]`);
  if (!input || !("value" in input) || !output) return;
  output.textContent = formatKoreanWon(input.value, $("#amount-unit").value);
}

function updateAllKoreanAmounts() {
  Object.keys(aliases).forEach(updateKoreanAmount);
}

function findNumbers(text) {
  const matches = text.match(/[△▲-]?\s*(?:\(\s*)?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\s*\)?/g) || [];
  return matches
    .map((raw) => ({ raw, value: parseNumber(raw) }))
    .filter(({ raw, value }) => Math.abs(value) > 0 && !(value >= 1900 && value <= 2100 && !raw.includes(",")));
}

function normalizeLabel(value) {
  return String(value).replace(/[^가-힣A-Za-z]/g, "").toLowerCase();
}

function editDistance(left, right) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = previous[0];
    previous[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const above = previous[rightIndex];
      const substitution = diagonal + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1);
      previous[rightIndex] = Math.min(previous[rightIndex] + 1, previous[rightIndex - 1] + 1, substitution);
      diagonal = above;
    }
  }
  return previous[right.length];
}

function fuzzyIncludes(text, target) {
  if (text.includes(target)) return true;
  const maxDistance = target.length >= 8 ? 2 : 1;
  const minLength = Math.max(2, target.length - maxDistance);
  const maxLength = target.length + maxDistance;
  for (let length = minLength; length <= maxLength; length += 1) {
    for (let start = 0; start + length <= text.length; start += 1) {
      if (editDistance(text.slice(start, start + length), target) <= maxDistance) return true;
    }
  }
  return false;
}

function extractMetric(lines, names) {
  for (const name of names) {
    const looseName = name
      .replace(/\s/g, "")
      .split("")
      .map((character) => character.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("\\s*");
    const namePattern = new RegExp(looseName);
    for (const line of lines) {
      if (/%|비율/.test(line)) continue;
      const match = line.match(namePattern);
      let trailing;
      if (match && match.index !== undefined) {
        trailing = line.slice(match.index + match[0].length);
      } else {
        const numberStart = line.search(/[△▲-]?\s*(?:\(\s*)?\d/);
        if (numberStart <= 0) continue;
        const recognizedLabel = normalizeLabel(line.slice(0, numberStart));
        if (!fuzzyIncludes(recognizedLabel, normalizeLabel(name))) continue;
        trailing = line.slice(numberStart);
      }
      const numbers = findNumbers(trailing);
      if (numbers.length) {
        const firstLooksLikeNoteNumber =
          numbers.length >= 3 &&
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
    const tolerance = Math.max(3.5, Math.min(6, (item.height || 10) * 0.45));
    let row = rows.find((entry) => Math.abs(entry.y - y) < tolerance);
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
  return { lines: allLines, pages: pdf.numPages, text: allLines.join("\n"), pdf };
}

function loadTesseract() {
  if (globalThis.Tesseract) return Promise.resolve(globalThis.Tesseract);
  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-tesseract-loader="true"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(globalThis.Tesseract), { once: true });
      existing.addEventListener("error", () => reject(new Error("OCR 엔진을 불러오지 못했습니다.")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = TESSERACT_CDN;
    script.async = true;
    script.crossOrigin = "anonymous";
    script.dataset.tesseractLoader = "true";
    script.onload = () => resolve(globalThis.Tesseract);
    script.onerror = () => reject(new Error("OCR 엔진을 불러오지 못했습니다."));
    document.head.appendChild(script);
  });
}

async function readScannedPdf(pdf, onProgress) {
  const Tesseract = await loadTesseract();
  if (!Tesseract?.createWorker) throw new Error("OCR 엔진을 초기화하지 못했습니다.");

  const totalPages = Math.min(pdf.numPages, OCR_MAX_PAGES);
  let currentPage = 1;
  const worker = await Tesseract.createWorker(["kor", "eng"], 1, {
    logger(message) {
      if (message.status === "recognizing text") {
        onProgress(currentPage, totalPages, Math.round((message.progress || 0) * 100));
      }
    },
  });
  await worker.setParameters({
    tessedit_pageseg_mode: Tesseract.PSM.AUTO,
    preserve_interword_spaces: "1",
    user_defined_dpi: "300",
  });
  const numericWorker = await Tesseract.createWorker(["eng"], 1);
  await numericWorker.setParameters({
    tessedit_pageseg_mode: Tesseract.PSM.SINGLE_LINE,
    tessedit_char_whitelist: "0123456789,.-()",
    preserve_interword_spaces: "1",
    user_defined_dpi: "300",
  });
  const ocrLines = [];
  const standardMetrics = {};

  function findGridLines(canvas, pixels) {
    const left = Math.floor(canvas.width * 0.05);
    const right = Math.floor(canvas.width * 0.95);
    const top = Math.floor(canvas.height * 0.19);
    const bottom = Math.floor(canvas.height * 0.82);
    const minimumDarkPixels = (right - left) * 0.62;
    const candidates = [];

    for (let y = top; y < bottom; y += 1) {
      let darkPixels = 0;
      for (let x = left; x < right; x += 1) {
        if (pixels.data[(y * canvas.width + x) * 4] === 0) darkPixels += 1;
      }
      if (darkPixels >= minimumDarkPixels) candidates.push(y);
    }

    const groups = [];
    for (const y of candidates) {
      const group = groups.at(-1);
      if (group && y <= group.at(-1) + 1) group.push(y);
      else groups.push([y]);
    }
    return groups.map((group) => Math.round(group.reduce((sum, y) => sum + y, 0) / group.length));
  }

  async function recognizeAmountCell(canvas, gridLines, firstDataBoundary, rowIndex, side) {
    const upperLine = gridLines[firstDataBoundary + rowIndex];
    const lowerLine = gridLines[firstDataBoundary + rowIndex + 1];
    if (!Number.isFinite(upperLine) || !Number.isFinite(lowerLine)) return null;

    const xStartRatio = side === "left" ? 0.345 : 0.77;
    const xEndRatio = side === "left" ? 0.49 : 0.918;
    const sourceX = Math.floor(canvas.width * xStartRatio);
    const sourceY = upperLine + 4;
    const sourceWidth = Math.floor(canvas.width * (xEndRatio - xStartRatio));
    const sourceHeight = Math.max(8, lowerLine - upperLine - 8);
    const amountCanvas = document.createElement("canvas");
    const amountContext = amountCanvas.getContext("2d", { alpha: false });
    amountCanvas.width = sourceWidth * 3;
    amountCanvas.height = sourceHeight * 3;
    amountContext.imageSmoothingEnabled = true;
    amountContext.imageSmoothingQuality = "high";
    amountContext.drawImage(
      canvas,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      0,
      0,
      amountCanvas.width,
      amountCanvas.height,
    );
    const variants = [
      { name: "single-line", mode: Tesseract.PSM.SINGLE_LINE },
      { name: "raw-line", mode: Tesseract.PSM.RAW_LINE },
    ];

    const candidates = [];
    for (const variant of variants) {
      await numericWorker.setParameters({ tessedit_pageseg_mode: variant.mode });
      const recognition = await numericWorker.recognize(amountCanvas);
      const raw = recognition.data.text || "";
      const digits = raw.replace(/\D/g, "");
      if (digits) candidates.push({
        name: variant.name,
        raw: raw.trim(),
        digits,
        confidence: recognition.data.confidence || 0,
      });
    }

    const primaryCandidate = candidates.find((candidate) => candidate.name === "single-line");
    const rawLineCandidate = candidates.find((candidate) => candidate.name === "raw-line");
    const selectedCandidate = primaryCandidate?.confidence >= 40
      ? primaryCandidate
      : (rawLineCandidate || primaryCandidate);
    const selectedDigits = selectedCandidate?.digits || "";
    const value = selectedDigits ? Number(selectedDigits) * (/[-△▲]/.test(primaryCandidate?.raw || "") ? -1 : 1) : null;
    return Number.isFinite(value) ? value : null;
  }

  try {
    for (currentPage = 1; currentPage <= totalPages; currentPage += 1) {
      onProgress(currentPage, totalPages, 0);
      const page = await pdf.getPage(currentPage);
      const viewport = page.getViewport({ scale: OCR_RENDER_SCALE });
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d", { alpha: false });
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvasContext: context, viewport }).promise;
      const amountSourceCanvas = document.createElement("canvas");
      const amountSourceContext = amountSourceCanvas.getContext("2d", { alpha: false });
      amountSourceCanvas.width = canvas.width;
      amountSourceCanvas.height = canvas.height;
      amountSourceContext.drawImage(canvas, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      for (let offset = 0; offset < pixels.data.length; offset += 4) {
        const luminance =
          pixels.data[offset] * 0.299 +
          pixels.data[offset + 1] * 0.587 +
          pixels.data[offset + 2] * 0.114;
        const value = luminance < OCR_DARK_PIXEL_THRESHOLD ? 0 : 255;
        pixels.data[offset] = value;
        pixels.data[offset + 1] = value;
        pixels.data[offset + 2] = value;
        pixels.data[offset + 3] = 255;
      }
      context.putImageData(pixels, 0, 0);

      const gridLines = findGridLines(canvas, pixels);
      const tableRegions = gridLines.length >= 36
        ? [
            { left: 0.055, top: 0.17, width: 0.47, height: 0.69 },
            { left: 0.495, top: 0.17, width: 0.45, height: 0.69 },
          ]
        : [{ left: 0, top: 0, width: 1, height: 1 }];
      const recognitionSourceCanvas = gridLines.length >= 36 ? canvas : amountSourceCanvas;
      await worker.setParameters({
        tessedit_pageseg_mode: gridLines.length >= 36 ? Tesseract.PSM.AUTO : Tesseract.PSM.SINGLE_BLOCK,
      });
      for (const region of tableRegions) {
        const sourceX = Math.floor(canvas.width * region.left);
        const sourceY = Math.floor(canvas.height * region.top);
        const sourceWidth = Math.floor(canvas.width * region.width);
        const sourceHeight = Math.floor(canvas.height * region.height);
        const regionCanvas = document.createElement("canvas");
        const regionContext = regionCanvas.getContext("2d", { alpha: false });
        regionCanvas.width = sourceWidth;
        regionCanvas.height = sourceHeight;
        regionContext.drawImage(
          recognitionSourceCanvas,
          sourceX,
          sourceY,
          sourceWidth,
          sourceHeight,
          0,
          0,
          sourceWidth,
          sourceHeight,
        );
        const recognition = await worker.recognize(regionCanvas);
        ocrLines.push(...(recognition.data.text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
      }

      if (gridLines.length >= 36) {
        const firstDataBoundary = gridLines[0] / canvas.height < 0.218 ? 2 : 1;
        const possibleBalance = await recognizeAmountCell(amountSourceCanvas, gridLines, firstDataBoundary, 20, "right");
        const totalsAgree = possibleBalance > 0;

        if (totalsAgree) {
          standardMetrics.currentAssets = await recognizeAmountCell(amountSourceCanvas, gridLines, firstDataBoundary, 0, "left");
          standardMetrics.cash = await recognizeAmountCell(amountSourceCanvas, gridLines, firstDataBoundary, 2, "left");
          standardMetrics.totalAssets = possibleBalance;
          const directCurrentLiabilities = await recognizeAmountCell(amountSourceCanvas, gridLines, firstDataBoundary, 31, "left");
          const noncurrentLiabilities = await recognizeAmountCell(amountSourceCanvas, gridLines, firstDataBoundary, 7, "right");
          standardMetrics.totalLiabilities = await recognizeAmountCell(amountSourceCanvas, gridLines, firstDataBoundary, 9, "right");
          const calculatedCurrentLiabilities = standardMetrics.totalLiabilities - noncurrentLiabilities;
          standardMetrics.currentLiabilities = calculatedCurrentLiabilities > 0
            ? calculatedCurrentLiabilities
            : directCurrentLiabilities;
        } else {
          standardMetrics.revenue = await recognizeAmountCell(amountSourceCanvas, gridLines, firstDataBoundary, 0, "left");
          standardMetrics.operatingProfit = await recognizeAmountCell(amountSourceCanvas, gridLines, firstDataBoundary, 32, "left");
          const directInterestExpense = await recognizeAmountCell(amountSourceCanvas, gridLines, firstDataBoundary, 7, "right");
          const nonoperatingIncome = await recognizeAmountCell(amountSourceCanvas, gridLines, firstDataBoundary, 33, "left");
          const incomeBeforeTax = await recognizeAmountCell(amountSourceCanvas, gridLines, firstDataBoundary, 15, "right");
          const otherNonoperatingExpenses = [];
          for (const rowIndex of [8, 10, 11, 13, 14]) {
            otherNonoperatingExpenses.push(
              await recognizeAmountCell(amountSourceCanvas, gridLines, firstDataBoundary, rowIndex, "right"),
            );
          }
          const calculatedNonoperatingExpenses =
            standardMetrics.operatingProfit + nonoperatingIncome - incomeBeforeTax;
          const calculatedInterestExpense = calculatedNonoperatingExpenses - otherNonoperatingExpenses.reduce(
            (sum, value) => sum + (value || 0),
            0,
          );
          standardMetrics.interestExpense = calculatedInterestExpense > 0
            ? calculatedInterestExpense
            : directInterestExpense;
          standardMetrics.netIncome = await recognizeAmountCell(amountSourceCanvas, gridLines, firstDataBoundary, 17, "right");
        }
      }
      page.cleanup();
    }
  } finally {
    await worker.terminate();
    await numericWorker.terminate();
  }

  return { lines: ocrLines, text: ocrLines.join("\n"), standardMetrics, pages: pdf.numPages, ocrPages: totalPages };
}

function collectMetrics(lines) {
  const extracted = {};
  let found = 0;
  Object.entries(aliases).forEach(([key, names]) => {
    const value = extractMetric(lines, names);
    extracted[key] = value ?? "";
    if (value !== null) found += 1;
  });
  return { extracted, found };
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
    if (input && "value" in input && value !== null && value !== undefined) {
      input.value = name in aliases ? formatAmount(value) : String(value);
    }
  });
  updateAllKoreanAmounts();
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

  let pdfDocument;
  try {
    const result = await readPdf(file);
    pdfDocument = result.pdf;
    let { extracted, found } = collectMetrics(result.lines);
    let extractionLabel = "텍스트";

    if (found < 4) {
      $("#status-title").textContent = "스캔 문서를 문자로 변환하고 있습니다…";
      $("#status-detail").textContent = `${file.name} · OCR 엔진 준비 중 · 문서는 외부로 전송되지 않습니다.`;
      try {
        const ocrResult = await readScannedPdf(result.pdf, (page, total, progress) => {
          $("#status-detail").textContent = `${file.name} · OCR ${page}/${total}페이지 · ${progress}%`;
        });
        const ocrMetrics = collectMetrics(ocrResult.lines);
        Object.entries(ocrResult.standardMetrics || {}).forEach(([key, value]) => {
          if (value !== null && value !== undefined) ocrMetrics.extracted[key] = value;
        });
        ocrMetrics.found = Object.values(ocrMetrics.extracted).filter(
          (value) => value !== "" && value !== null && value !== undefined,
        ).length;
        if (ocrMetrics.found > found) {
          extracted = ocrMetrics.extracted;
          found = ocrMetrics.found;
          extractionLabel = `OCR ${ocrResult.ocrPages}페이지`;
          result.text = ocrResult.text;
        }
      } catch (ocrError) {
        console.warn("OCR fallback failed", ocrError);
      }
    }

    extracted.amountUnit = detectUnit(result.text);
    extracted.fiscalYear = detectYear(result.text);
    setFormValues(extracted);
    $("#status-title").textContent = found >= 4 ? "주요 재무수치를 찾았습니다" : "PDF 확인이 완료되었습니다";
    $("#status-detail").textContent = found >= 4
      ? `${file.name} · ${extractionLabel} 분석 · ${found}개 항목 자동 추출`
      : `${file.name} · 자동 인식이 제한적입니다. 아래에서 수치를 직접 입력해주세요.`;
    showVerification();
  } catch (error) {
    console.error(error);
    $("#status-title").textContent = "자동 추출이 어려운 PDF입니다";
    $("#status-detail").textContent = `${file.name} · 아래에서 수치를 직접 입력해주세요.`;
    showVerification();
  } finally {
    if (typeof pdfDocument?.destroy === "function") await pdfDocument.destroy();
    else if (typeof pdfDocument?.cleanup === "function") await pdfDocument.cleanup();
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

Object.keys(aliases).forEach((name) => {
  const input = form.elements.namedItem(name);
  if (input && "value" in input) {
    input.addEventListener("input", () => updateKoreanAmount(name));
    input.addEventListener("blur", () => {
      input.value = formatAmount(input.value);
      updateKoreanAmount(name);
    });
  }
});

$("#amount-unit").addEventListener("change", updateAllKoreanAmounts);

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

  const needScore = distress;
  let passScore = Math.round(viability * 0.55 + restructure * 0.35 + 10);
  if (equity < 0) passScore -= 4;
  if (Number.isFinite(currentRatio) && currentRatio < 50) passScore -= 5;
  if (data.businessContinuing === "no") passScore -= 10;
  if (data.operatingProfit < 0) passScore -= 8;
  if (data.operatingCashFlow < 0) passScore -= 8;
  if (data.arrears === "yes") passScore -= 3;
  if (data.attachment === "yes") passScore -= 6;
  if (data.taxArrears === "yes") passScore -= 4;
  passScore = Math.round(clamp(passScore, 5, 95));

  let title;
  let emphasis;
  let kicker;
  let summary;
  if (needScore >= 60 && passScore >= 60) {
    title = "법인회생 필요성이 높고";
    emphasis = "신청 통과 가능성도 있습니다";
    kicker = "법인회생 우선 검토 구간";
    summary = `법인회생 필요성은 ${needScore}점, 신청 통과 가능성은 ${passScore}점입니다. 재무적 위기와 신청 필요성이 확인되며, 영업 지속성과 채무조정 여력도 남아 있어 전문가와 구체적인 신청 준비를 검토할 수 있습니다.`;
  } else if (needScore >= 60) {
    title = "법인회생 필요성은 높지만";
    emphasis = "통과 가능성 보완이 필요합니다";
    kicker = "긴급 보완 검토 구간";
    summary = `법인회생 필요성은 ${needScore}점으로 높지만 신청 통과 가능성은 ${passScore}점입니다. 신청 전에 영업개선안, 자금계획, 채권자 협의와 회생계획 수행재원을 보완해야 합니다.`;
  } else if (passScore >= 60) {
    title = "신청 통과 여력은 있으나";
    emphasis = "현재 필요성은 낮습니다";
    kicker = "사전 구조조정 우선 구간";
    summary = `신청 통과 가능성은 ${passScore}점이지만 법인회생 필요성은 ${needScore}점입니다. 현재 위기 수준만 보면 법원 절차보다 금융기관 협의, 워크아웃, 비용개선 등 사전 구조조정을 먼저 비교할 수 있습니다.`;
  } else {
    title = "법인회생 필요성과";
    emphasis = "통과 가능성이 모두 낮습니다";
    kicker = "다른 대안 우선 검토 구간";
    summary = `법인회생 필요성은 ${needScore}점, 신청 통과 가능성은 ${passScore}점입니다. 현재 입력만으로는 법인회생의 필요성과 신청 실익이 모두 제한적이므로 추가 자료를 확인하고 다른 구조조정 대안과 비교해야 합니다.`;
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

  return { equity, currentRatio, debtRatio, operatingMargin, interestCoverage, distress, viability, restructure, needScore, passScore, title, emphasis, kicker, summary, findings: findings.slice(0, 4) };
}

function buildResultExplanation(data, result) {
  const needLevel = result.needScore >= 70 ? "높은 구간" : result.needScore >= 50 ? "검토 구간" : "낮은 구간";
  const passLevel = result.passScore >= 70 ? "양호한 구간" : result.passScore >= 50 ? "보완 검토 구간" : "낮은 구간";
  const needExplanation = `법인회생 필요성은 ${result.needScore}점으로 ${needLevel}입니다. 지급불능 위험, 단기 유동성, 자본잠식, 손익, 연체와 강제집행 여부를 반영해 현재 회사가 법인회생을 얼마나 시급하게 검토해야 하는지 나타냅니다.`;
  const passExplanation = `신청 통과 가능성은 ${result.passScore}점으로 ${passLevel}입니다. 영업 지속성, 수익성, 현금흐름과 채무조정 여력을 반영한 입력자료 기준 예비점수입니다. 법원의 실제 개시·인가 확률이나 승인 보장을 뜻하지 않습니다.`;

  const liquidityExplanation = Number.isFinite(result.currentRatio)
    ? (result.currentRatio < 100
        ? `유동비율은 ${pct(result.currentRatio)}로 유동자산보다 단기 상환부담이 커, 가까운 시기의 자금압박 가능성을 확인해야 합니다.`
        : `유동비율은 ${pct(result.currentRatio)}로 단기채무에 대응할 장부상 유동자산은 비교적 확보되어 있습니다.`)
    : "유동부채가 입력되지 않아 단기 유동성은 판단하지 못했습니다.";
  const capitalExplanation = result.equity < 0
    ? `입력 단위 기준 부채가 자산보다 ${Math.abs(result.equity).toLocaleString("ko-KR")} 많아 자본잠식 여부와 실제 자산가치 확인이 중요합니다.`
    : `입력 단위 기준 자산이 부채보다 ${result.equity.toLocaleString("ko-KR")} 많아 장부상 순자산이 남아 있습니다.`;
  const profitExplanation = data.operatingProfit > 0
    ? `영업이익률은 ${pct(result.operatingMargin)}로 본업의 수익이 발생하고 있어 사업 계속 가능성을 뒷받침합니다.`
    : `영업이익률은 ${pct(result.operatingMargin)}로 손익개선 계획과 매출 전망을 추가로 확인해야 합니다.`;
  const interestExplanation = Number.isFinite(result.interestCoverage)
    ? `이자보상배율은 ${multiple(result.interestCoverage)}로 영업이익이 이자비용을 어느 정도 감당하는지 보여줍니다.`
    : "이자비용이 없거나 입력되지 않아 이자상환능력은 별도로 판단하지 않았습니다.";
  const financialExplanation = [liquidityExplanation, capitalExplanation, profitExplanation, interestExplanation].join(" ");

  const procedureExplanation = [
    "여기서 ‘통과’는 입력정보를 바탕으로 회생절차 개시와 회생계획 인가에 필요한 사업 지속성 및 계획 수행 여력을 미리 점검한다는 뜻입니다.",
    "실제 법원 판단에는 최근 매출·수주 전망, 13주 자금수지, 채권자 동의 가능성, 담보 구조, 청산가치와 계속기업가치, 공정하고 수행 가능한 변제계획을 추가로 확인해야 합니다.",
  ].join(" ");

  return { needExplanation, passExplanation, financialExplanation, procedureExplanation };
}

function renderResult(data, result) {
  $("#result-kicker").textContent = result.kicker;
  $("#result-title").innerHTML = `${result.title} <em>${result.emphasis}</em>`;
  $("#result-summary").textContent = result.summary;
  $("#need-score").textContent = result.needScore;
  $("#pass-score").textContent = result.passScore;
  $("#need-score-ring").style.setProperty("--score", result.needScore);
  $("#pass-score-ring").style.setProperty("--score", result.passScore);

  const flags = [];
  flags.push(`필요성 ${result.needScore}점`);
  flags.push(`통과 가능성 ${result.passScore}점`);
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

  const explanation = buildResultExplanation(data, result);
  $("#result-need-explanation").textContent = explanation.needExplanation;
  $("#result-pass-explanation").textContent = explanation.passExplanation;
  $("#result-financial-explanation").textContent = explanation.financialExplanation;
  $("#result-procedure-explanation").textContent = explanation.procedureExplanation;
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
  updateAllKoreanAmounts();
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
