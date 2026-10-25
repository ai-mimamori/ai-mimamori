const form = document.getElementById("scan-form");
const input = document.getElementById("path");
const button = document.getElementById("scan-btn");
const placesEl = document.getElementById("places");
const resultEl = document.getElementById("result");
let sessionToken = "";

const SEVERITY = {
  critical: "今すぐ対応",
  warn: "確認してほしい",
  info: "参考",
};

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function loadPlaces() {
  const res = await fetch("/api/places");
  const data = await res.json();
  sessionToken = data.token || "";
  const chips = [
    { label: "デモを検査する", path: data.demoPath, demo: true },
    ...data.places.map((p) => ({ label: p.label, path: p.path })),
  ];
  placesEl.innerHTML = chips
    .map(
      (c) =>
        `<button type="button" class="secondary" data-path="${escapeHtml(c.path)}" ${c.demo ? "data-demo=true" : ""}>${escapeHtml(c.label)}</button>`
    )
    .join("");
}

placesEl.addEventListener("click", (event) => {
  const target = event.target.closest("button");
  if (!target) return;
  if (target.dataset.demo) {
    runScan({ demo: true });
    return;
  }
  input.value = target.dataset.path;
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  runScan({ path: input.value });
});

async function runScan(payload) {
  button.disabled = true;
  button.textContent = "検査しています…";
  resultEl.hidden = false;
  resultEl.innerHTML = `<div class="summary">フォルダの中を読んでいます。プログラムは実行しません。</div>`;
  try {
    const res = await fetch("/api/scan", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Mimamori-Token": sessionToken,
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!data.ok) {
      resultEl.innerHTML = `<div class="error">${escapeHtml(data.error || "検査できませんでした。")}</div>`;
      return;
    }
    renderResult(data);
  } catch {
    resultEl.innerHTML = `<div class="error">アプリに接続できませんでした。起動し直してください。</div>`;
  } finally {
    button.disabled = false;
    button.textContent = "検査する";
  }
}

function renderResult(data) {
  const tone = data.counts.critical ? "critical" : data.counts.warn ? "warn" : data.counts.info ? "info" : "ok";
  const cards = data.findings
    .map(
      (f) => `
      <article class="card">
        <span class="badge ${f.severity}">${SEVERITY[f.severity]}</span>
        <h3>${escapeHtml(f.title)}</h3>
        <dl>
          <dt>場所</dt>
          <dd class="code">${escapeHtml(f.file)}${f.line ? ` : ${f.line}行目` : ""}</dd>
          <dt>見つかった内容</dt>
          <dd class="code">${escapeHtml(f.excerpt || "")}</dd>
          <dt>なぜ危ないか</dt>
          <dd>${escapeHtml(f.why)}</dd>
          <dt>なぜセキュリティソフトでは足りないか</dt>
          <dd>${escapeHtml(f.missedBy)}</dd>
          <dt>いまやること</dt>
          <dd>${escapeHtml(f.action)}</dd>
        </dl>
      </article>`
    )
    .join("");

  resultEl.innerHTML = `
    <div class="summary ${tone}">
      <strong>${escapeHtml(data.headline)}</strong>
      <div class="counts">
        <span>今すぐ対応 ${data.counts.critical}</span>
        <span>確認してほしい ${data.counts.warn}</span>
        <span>参考 ${data.counts.info}</span>
      </div>
      <p class="meta">
        ${escapeHtml(data.root)} ／ 見たファイル ${data.scannedFiles} 件
        ${data.languages.length ? ` ／ 使われている道具 ${escapeHtml(data.languages.join("、"))}` : ""}
        ${data.hasGit ? " ／ バージョン管理の跡あり" : ""}
        ／ ${data.elapsedMs}ms ／ 外部送信なし
      </p>
    </div>
    ${cards || ""}
  `;
}

loadPlaces().catch(() => {
  placesEl.innerHTML = `<button type="button" class="secondary" data-demo="true">デモを検査する</button>`;
});
