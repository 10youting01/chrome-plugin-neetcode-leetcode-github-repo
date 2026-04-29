const DEFAULT_SETTINGS = {
  token: "",
  owner: "10youting01",
  repo: "leetcode-solutions",
  branch: "main",
  baseFolder: "",
  pathTemplate: "{id}.{slug}.{ext}"
};

const LEGACY_PATH_TEMPLATE = "{baseFolder}/{problemIdSlug}/solution.{ext}";

const EXTENSIONS = {
  c: "c",
  cpp: "cpp",
  "c++": "cpp",
  csharp: "cs",
  "c#": "cs",
  golang: "go",
  go: "go",
  java: "java",
  javascript: "js",
  js: "js",
  kotlin: "kt",
  mysql: "sql",
  python: "py",
  python3: "py",
  ruby: "rb",
  rust: "rs",
  scala: "scala",
  swift: "swift",
  typescript: "ts",
  ts: "ts"
};

let currentProblem = null;
let currentSettings = { ...DEFAULT_SETTINGS };

const els = {
  pageStatus: document.getElementById("pageStatus"),
  problemTitle: document.getElementById("problemTitle"),
  problemDifficulty: document.getElementById("problemDifficulty"),
  languageInput: document.getElementById("languageInput"),
  pathPreview: document.getElementById("pathPreview"),
  codeInput: document.getElementById("codeInput"),
  tokenInput: document.getElementById("tokenInput"),
  ownerInput: document.getElementById("ownerInput"),
  repoInput: document.getElementById("repoInput"),
  branchInput: document.getElementById("branchInput"),
  baseFolderInput: document.getElementById("baseFolderInput"),
  templateInput: document.getElementById("templateInput"),
  saveSettingsButton: document.getElementById("saveSettingsButton"),
  pushButton: document.getElementById("pushButton"),
  message: document.getElementById("message")
};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  bindEvents();
  await loadSettings();
  await loadCurrentProblem();
  refreshPathPreview();
}

function bindEvents() {
  els.saveSettingsButton.addEventListener("click", saveSettings);
  els.pushButton.addEventListener("click", pushToGithub);

  [
    els.languageInput,
    els.baseFolderInput,
    els.templateInput
  ].forEach((input) => input.addEventListener("input", refreshPathPreview));
}

async function loadSettings() {
  const stored = await chrome.storage.local.get(DEFAULT_SETTINGS);
  currentSettings = { ...DEFAULT_SETTINGS, ...stored };
  currentSettings.owner = currentSettings.owner || DEFAULT_SETTINGS.owner;
  currentSettings.repo = currentSettings.repo || DEFAULT_SETTINGS.repo;

  if (currentSettings.pathTemplate === LEGACY_PATH_TEMPLATE) {
    currentSettings.pathTemplate = DEFAULT_SETTINGS.pathTemplate;
  }

  if (currentSettings.baseFolder === "leetcode" && currentSettings.pathTemplate === DEFAULT_SETTINGS.pathTemplate) {
    currentSettings.baseFolder = "";
  }

  els.tokenInput.value = currentSettings.token || "";
  els.ownerInput.value = currentSettings.owner || "";
  els.repoInput.value = currentSettings.repo || "";
  els.branchInput.value = currentSettings.branch || "main";
  els.baseFolderInput.value = currentSettings.baseFolder || "";
  els.templateInput.value = currentSettings.pathTemplate || DEFAULT_SETTINGS.pathTemplate;
}

async function saveSettings() {
  currentSettings = readSettingsFromForm();
  await chrome.storage.local.set(currentSettings);
  setMessage("設定已儲存。", "ok");
  refreshPathPreview();
}

async function loadCurrentProblem() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url?.includes("leetcode.com/problems/")) {
      setPageStatus("非題目頁", "error");
      setMessage("請在 LeetCode 題目頁打開插件。", "error");
      els.pushButton.disabled = true;
      return;
    }

    const response = await chrome.tabs.sendMessage(tab.id, { type: "GET_LEETCODE_PROBLEM" });
    if (!response?.ok) {
      throw new Error(response?.error || "讀取 LeetCode 頁面失敗");
    }

    currentProblem = response.problem;
    renderProblem(currentProblem);
    setPageStatus("已偵測", "ok");
  } catch (error) {
    setPageStatus("需重整", "error");
    setMessage(`${error.message}。如果剛安裝插件，請重整 LeetCode 頁面後再試。`, "error");
    els.pushButton.disabled = true;
  }
}

function renderProblem(problem) {
  els.problemTitle.textContent = problem.displayTitle || problem.slug || "尚未偵測";
  els.problemDifficulty.textContent = problem.difficulty || "-";
  els.languageInput.value = problem.language || "python3";
  els.codeInput.value = problem.code || "";
}

async function pushToGithub() {
  setMessage("", "muted");
  els.pushButton.disabled = true;
  els.pushButton.textContent = "Pushing...";

  try {
    currentSettings = readSettingsFromForm();
    await chrome.storage.local.set(currentSettings);

    const problem = buildProblemPayload();
    validatePush(currentSettings, problem);

    const response = await chrome.runtime.sendMessage({
      type: "PUSH_SOLUTION_TO_GITHUB",
      settings: currentSettings,
      problem
    });

    if (!response?.ok) {
      throw new Error(response?.error || "GitHub 推送失敗");
    }

    const links = response.files
      .map((file) => `<a href="${file.htmlUrl}" target="_blank">${file.label}</a>`)
      .join("、");

    setMessage(`完成：${links}`, "ok", true);
  } catch (error) {
    setMessage(error.message, "error");
  } finally {
    els.pushButton.disabled = false;
    els.pushButton.textContent = "Push to GitHub";
  }
}

function readSettingsFromForm() {
  return {
    token: els.tokenInput.value.trim(),
    owner: els.ownerInput.value.trim(),
    repo: els.repoInput.value.trim(),
    branch: els.branchInput.value.trim() || "main",
    baseFolder: normalizePathPart(els.baseFolderInput.value.trim()),
    pathTemplate: els.templateInput.value.trim() || DEFAULT_SETTINGS.pathTemplate
  };
}

function buildProblemPayload() {
  const language = normalizeLanguageInput(els.languageInput.value.trim() || currentProblem?.language || "python3");
  const ext = extensionForLanguage(language);
  const base = {
    ...(currentProblem || {}),
    language,
    ext,
    code: els.codeInput.value,
    platform: "leetcode"
  };

  return {
    ...base,
    solutionPath: buildPath(currentSettings.pathTemplate, currentSettings, base)
  };
}

function validatePush(settings, problem) {
  const missing = [];
  if (!settings.token) missing.push("GitHub token");
  if (!settings.owner) missing.push("Owner");
  if (!settings.repo) missing.push("Repo");
  if (!problem.slug) missing.push("題目 slug");
  if (!problem.code?.trim()) missing.push("程式碼");
  if (!problem.solutionPath) missing.push("檔案路徑");

  if (missing.length) {
    throw new Error(`缺少：${missing.join("、")}`);
  }
}

function refreshPathPreview() {
  currentSettings = readSettingsFromForm();
  if (!currentProblem) {
    els.pathPreview.value = "";
    return;
  }

  const language = normalizeLanguageInput(els.languageInput.value.trim() || currentProblem.language || "python3");
  els.pathPreview.value = buildPath(currentSettings.pathTemplate, currentSettings, {
    ...currentProblem,
    language,
    ext: extensionForLanguage(language),
    platform: "leetcode"
  });
}

function buildPath(template, settings, problem) {
  const id = normalizePathPart(problem.questionId || problem.id || "");
  const slug = normalizePathPart(problem.slug || slugify(problem.displayTitle || "solution"));
  const idSlug = id ? `${id}.${slug}` : slug;
  const problemIdSlug = id ? `${id}-${slug}` : slug;
  const values = {
    baseFolder: normalizePathPart(settings.baseFolder || ""),
    difficulty: normalizePathPart(problem.difficulty || "unknown").toLowerCase(),
    ext: normalizePathPart(problem.ext || extensionForLanguage(problem.language)),
    id,
    language: normalizePathPart(problem.language || "text").toLowerCase(),
    platform: normalizePathPart(problem.platform || "leetcode"),
    idSlug,
    problemIdSlug,
    slug
  };

  return template.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? "").replace(/\/+/g, "/");
}

function extensionForLanguage(language = "") {
  return EXTENSIONS[normalizeLanguageInput(language).toLowerCase()] || "py";
}

function normalizeLanguageInput(language = "") {
  const normalized = String(language || "").trim().toLowerCase();
  if (!normalized || normalized === "text" || normalized === "plaintext" || normalized === "plain text") {
    return "python3";
  }
  return normalized;
}

function normalizePathPart(value) {
  return String(value || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9._/-]/g, "-")
    .replace(/-+/g, "-");
}

function slugify(value) {
  return normalizePathPart(value).toLowerCase();
}

function setPageStatus(text, type) {
  els.pageStatus.textContent = text;
  els.pageStatus.className = `status ${type || "muted"}`;
}

function setMessage(text, type = "muted", allowHtml = false) {
  els.message.className = `message ${type}`;
  if (allowHtml) {
    els.message.innerHTML = text;
  } else {
    els.message.textContent = text;
  }
}
