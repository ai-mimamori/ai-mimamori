import fs from "fs";
import os from "os";
import path from "path";
import {
  SKIP_DIRS,
  TEXT_EXTS,
  LANG_BY_EXT,
  contentRules,
  fileNameRules,
} from "./rules.js";

const MAX_FILES = 2500;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_DEPTH = 8;

const BLOCKED_PREFIXES = [
  path.parse(os.homedir()).root + "Windows",
  path.parse(os.homedir()).root + "Program Files",
  path.parse(os.homedir()).root + "Program Files (x86)",
];

export function specialPlaces() {
  const home = os.homedir();
  const candidates = [
    { id: "desktop", label: "デスクトップ", paths: [path.join(home, "Desktop"), path.join(home, "デスクトップ")] },
    { id: "documents", label: "ドキュメント", paths: [path.join(home, "Documents"), path.join(home, "ドキュメント")] },
    { id: "downloads", label: "ダウンロード", paths: [path.join(home, "Downloads"), path.join(home, "ダウンロード")] },
  ];
  return candidates
    .map((c) => {
      const found = c.paths.find((p) => fs.existsSync(p));
      return found ? { id: c.id, label: c.label, path: found } : null;
    })
    .filter(Boolean);
}

export function maskSecret(value) {
  const text = String(value).replace(/\s+/g, " ").trim();
  if (text.length <= 10) return "••••";
  return `${text.slice(0, 4)}•••${text.slice(-4)}`;
}

function lineNumber(content, index) {
  return content.slice(0, index).split(/\r?\n/).length;
}

function isBlockedPath(target) {
  const resolved = path.resolve(target);
  return BLOCKED_PREFIXES.some((prefix) => resolved.toLowerCase().startsWith(prefix.toLowerCase()));
}

function extOf(filePath) {
  const base = path.basename(filePath);
  if (base.startsWith(".env")) return ".env";
  return path.extname(base).toLowerCase();
}

function isTextFile(filePath) {
  const ext = extOf(filePath);
  const base = path.basename(filePath);
  return TEXT_EXTS.has(ext) || base === ".gitignore" || base === "Dockerfile";
}

function readText(filePath) {
  const buf = fs.readFileSync(filePath);
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return buf.toString("utf8");
  }
  const utf8 = buf.toString("utf8");
  if (!utf8.includes("\uFFFD")) return utf8;
  return buf.toString("utf16le");
}

function pushFinding(findings, item) {
  const key = `${item.id}|${item.file}|${item.line || 0}|${item.excerpt || ""}`;
  if (findings._seen.has(key)) return;
  findings._seen.add(key);
  findings.push(item);
}

function walk(root, dir, depth, files, stats) {
  if (depth > MAX_DEPTH || files.length >= MAX_FILES) return;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (files.length >= MAX_FILES) return;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      if (entry.name === ".git") {
        stats.hasGit = true;
        continue;
      }
      walk(root, full, depth + 1, files, stats);
      continue;
    }
    if (!entry.isFile()) continue;
    stats.fileCount += 1;
    const rel = path.relative(root, full);
    const ext = extOf(full);
    const lang = LANG_BY_EXT[ext];
    if (lang) stats.languages.add(lang);
    if (entry.name === ".gitignore") stats.gitignoreFiles.push(full);
    if (entry.name === ".env" || entry.name.startsWith(".env.")) stats.envFiles.push(rel);
    if (entry.name === "package.json") stats.packageJsonFiles.push(full);
    files.push({ full, rel, name: entry.name });
  }
}

function scanPackageJson(full, rel, findings) {
  try {
    const json = JSON.parse(fs.readFileSync(full, "utf8"));
    const scripts = json.scripts || {};
    for (const hook of ["preinstall", "install", "postinstall"]) {
      if (!scripts[hook]) continue;
      pushFinding(findings, {
        id: "npm-install-hook",
        severity: "warn",
        title: "入れただけで、見えない作業が自動で走ります",
        why: `package.json の ${hook} は、道具を入れた瞬間に別のプログラムを動かします。AIは「便利だから」と書きがちですが、確認する暇がありません。`,
        missedBy: "正規の開発手順なので、セキュリティソフトはインストール成功として扱います。",
        action: "IT部門が確認するまで npm install しないでください。この自動実行の行は削除して問題ありません。",
        file: rel,
        line: 1,
        excerpt: `${hook}: ${String(scripts[hook]).slice(0, 80)}`,
      });
    }
  } catch {
    // ignore invalid json
  }
}

function scanGitignore(stats, findings) {
  if (!stats.envFiles.length) return;
  const patterns = stats.gitignoreFiles.flatMap((file) => {
    try {
      return fs.readFileSync(file, "utf8").split(/\r?\n/);
    } catch {
      return [];
    }
  });
  const ignoresEnv = patterns.some((line) => {
    const t = line.trim();
    return t === ".env" || t === ".env*" || t === "**/.env";
  });
  if (!ignoresEnv) {
    for (const envFile of stats.envFiles) {
      pushFinding(findings, {
        id: "env-not-gitignored",
        severity: "critical",
        title: "合鍵メモが、共有セットに混ざる状態です",
        why: "Git などの共有を使うと、.env まで一緒に送られます。AIは動かす手順は出しますが、共有から外す指示を忘れがちです。",
        missedBy: "共有そのものは正当な作業なので、端末対策もSaaSも「情報漏洩」とは判定しません。",
        action: "今すぐ .env を共有対象から外してください。すでに共有してしまった可能性があるなら IT 部門へ連絡してください。",
        file: envFile,
        line: 1,
        excerpt: ".env が .gitignore に入っていません",
      });
    }
  }
}

function scanShadowStack(stats, findings) {
  const langs = [...stats.languages];
  if (langs.length < 2) return;
  pushFinding(findings, {
    id: "shadow-ai-stack",
    severity: "info",
    title: "AIが、別々の道具を同じフォルダに混ぜて作っています",
    why: `${langs.join("、")} が同居しています。非エンジニアがチャットで「作って」と頼むと、必要な言語やバージョン管理が無意識に増えていきます。`,
    missedBy: "それぞれ単体では普通の開発ファイルです。セキュリティソフトは「会社が把握していない道具」とは判断できません。",
    action: "このフォルダを使う目的をIT部門に共有してください。業務で使うなら、許可された環境に移す必要があります。",
    file: ".",
    line: 1,
    excerpt: langs.join(" / "),
  });
}

export function scanDirectory(inputPath) {
  const started = Date.now();
  const trimmed = String(inputPath || "").trim().replace(/^['"]|['"]$/g, "");
  if (!trimmed) {
    return { ok: false, error: "フォルダの場所が空です。" };
  }
  if (!path.isAbsolute(trimmed)) {
    return { ok: false, error: "フォルダの場所は、先頭からすべてのパスで指定してください。" };
  }
  if (isBlockedPath(trimmed)) {
    return { ok: false, error: "Windows のシステムフォルダは検査できません。" };
  }
  if (!fs.existsSync(trimmed)) {
    return { ok: false, error: "その場所は見つかりませんでした。コピーしたパスを確認してください。" };
  }

  const rootStat = fs.statSync(trimmed);
  const root = rootStat.isDirectory() ? trimmed : path.dirname(trimmed);
  const files = [];
  const stats = {
    fileCount: 0,
    hasGit: fs.existsSync(path.join(root, ".git")),
    languages: new Set(),
    gitignoreFiles: [],
    envFiles: [],
    packageJsonFiles: [],
  };

  walk(root, root, 0, files, stats);

  const findings = [];
  findings._seen = new Set();

  for (const file of files) {
    for (const rule of fileNameRules) {
      if (rule.test(file.name)) {
        pushFinding(findings, {
          id: rule.id,
          severity: rule.severity,
          title: rule.title,
          why: rule.why,
          missedBy: rule.missedBy,
          action: rule.action,
          file: file.rel,
          line: 1,
          excerpt: file.name,
        });
      }
    }

    if (file.name === "package.json") {
      scanPackageJson(file.full, file.rel, findings);
    }

    if (!isTextFile(file.full)) continue;
    let size;
    try {
      size = fs.statSync(file.full).size;
    } catch {
      continue;
    }
    if (size > MAX_FILE_BYTES) continue;

    let content;
    try {
      content = readText(file.full);
    } catch {
      continue;
    }

    for (const rule of contentRules) {
      const matches = content.matchAll(rule.regex);
      let count = 0;
      for (const match of matches) {
        count += 1;
        if (count > 3) break;
        pushFinding(findings, {
          id: rule.id,
          severity: rule.severity,
          title: rule.title,
          why: rule.why,
          missedBy: rule.missedBy,
          action: rule.action,
          file: file.rel,
          line: lineNumber(content, match.index || 0),
          excerpt: maskSecret(match[0]),
        });
      }
    }
  }

  scanGitignore(stats, findings);
  scanShadowStack(stats, findings);

  const rank = { critical: 0, warn: 1, info: 2 };
  const list = findings
    .filter((x) => x.id)
    .sort((a, b) => rank[a.severity] - rank[b.severity] || a.file.localeCompare(b.file, "ja"));

  const counts = {
    critical: list.filter((f) => f.severity === "critical").length,
    warn: list.filter((f) => f.severity === "warn").length,
    info: list.filter((f) => f.severity === "info").length,
  };

  let headline = "今回の検査項目では、目立った危険は見つかりませんでした。";
  if (counts.critical > 0) {
    headline = `今すぐ見てほしい危険が ${counts.critical} 件あります。実行せず、IT部門へ共有してください。`;
  } else if (counts.warn > 0) {
    headline = `確認してほしい点が ${counts.warn} 件あります。使い始める前に目を通してください。`;
  } else if (counts.info > 0) {
    headline = "すぐ危険、というより「会社が把握していない道具」になっている可能性があります。";
  }

  return {
    ok: true,
    root,
    scannedFiles: files.length,
    totalFilesSeen: stats.fileCount,
    languages: [...stats.languages],
    hasGit: stats.hasGit,
    counts,
    headline,
    findings: list,
    elapsedMs: Date.now() - started,
    stayedLocal: true,
  };
}
