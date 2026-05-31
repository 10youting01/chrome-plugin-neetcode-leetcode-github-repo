chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "GET_CURRENT_PROBLEM") {
    return false;
  }

  collectProblem()
    .then((problem) => sendResponse({ ok: true, problem }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));

  return true;
});

async function collectProblem() {
  const pageSlug = getSlugFromUrl();
  if (!pageSlug) {
    throw new Error("這不是 NeetCode 題目頁");
  }

  const leetcodeSlug = getLeetCodeSlugFromPage();
  const slug = leetcodeSlug || pageSlug;
  const codeResult = await getEditorCode(slug);
  const code = codeResult.code || getVisibleEditorCode();
  const titleInfo = getTitleInfo(slug, pageSlug);

  return {
    platform: "neetcode",
    slug,
    questionId: titleInfo.questionId,
    displayTitle: titleInfo.displayTitle,
    difficulty: getDifficulty(),
    language: chooseLanguage(codeResult.language, getLanguage(), code),
    code,
    url: location.href
  };
}

function getSlugFromUrl() {
  const parts = location.pathname.split("/").filter(Boolean);
  const ignored = new Set(["practice", "problems", "solutions", "courses", "roadmap", "question"]);
  const candidate = [...parts].reverse().find((part) => !ignored.has(part.toLowerCase()));
  return normalizeSlug(candidate || "");
}

function getLeetCodeSlugFromPage() {
  const link = Array.from(document.querySelectorAll("a[href*='leetcode.com/problems/']"))
    .map((anchor) => anchor.href)
    .find(Boolean);

  const match = link?.match(/leetcode\.com\/problems\/([^/?#]+)/);
  return normalizeSlug(match?.[1] || "");
}

function getTitleInfo(slug, pageSlug) {
  const title = getDisplayTitle(slug, pageSlug);
  return {
    questionId: findQuestionId(title),
    displayTitle: title
  };
}

function getDisplayTitle(slug, pageSlug) {
  const candidates = [
    textOf(document.querySelector("h1")),
    getTitleFromDocument(),
    unslugify(pageSlug),
    unslugify(slug)
  ].filter(Boolean);

  const raw = candidates.find((value) => value && !/neetcode/i.test(value)) || candidates[0] || slug;
  return raw.replace(/^(\d+)\.\s*/, "").trim();
}

function getTitleFromDocument() {
  return document.title
    .replace(/\s*[-|]\s*NeetCode.*$/i, "")
    .replace(/\s*NeetCode.*$/i, "")
    .trim();
}

function findQuestionId(title) {
  const body = document.body?.innerText || "";
  const escapedTitle = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    /\bLeetCode\s*#?\s*(\d+)\b/i,
    new RegExp(`\\b(\\d+)\\.\\s*${escapedTitle}\\b`, "i"),
    /\bProblem\s*#?\s*(\d+)\b/i
  ];

  for (const pattern of patterns) {
    const match = body.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  return "";
}

function getDifficulty() {
  const exact = Array.from(document.querySelectorAll("span, div, p"))
    .map((node) => textOf(node))
    .find((value) => ["Easy", "Medium", "Hard"].includes(value));

  return exact || "";
}

function getLanguage() {
  const localValue = readLocalStorageLanguage();
  if (localValue) {
    return localValue;
  }

  const buttonText = Array.from(document.querySelectorAll("button, [role='button']"))
    .map((button) => textOf(button))
    .find((value) => /^(C\+\+|Java|Python3?|JavaScript|TypeScript|Go|Ruby|Rust|Swift|Kotlin|C#|C)$/i.test(value));

  return normalizeLanguage(buttonText || "");
}

function readLocalStorageLanguage() {
  const languageKeys = ["language", "lang", "selectedLanguage", "codeLanguage", "editorLanguage"];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key || !languageKeys.some((name) => key.toLowerCase().includes(name.toLowerCase()))) continue;
    const value = localStorage.getItem(key);
    const normalized = normalizeLanguage(value || "");
    if (normalized) {
      return normalized;
    }
  }
  return "";
}

async function getEditorCode(slug) {
  const fromPage = await getCodeFromPageContext(slug);
  if (fromPage.code) {
    return fromPage;
  }

  const fromStorage = getCodeFromLocalStorage(slug);
  if (fromStorage.code) {
    return fromStorage;
  }

  return {
    code: "",
    language: getLanguage()
  };
}

function getCodeFromPageContext(slug) {
  return new Promise((resolve) => {
    const requestId = `nc-gh-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const timeout = window.setTimeout(() => {
      window.removeEventListener("message", handleMessage);
      resolve({ code: "", language: "" });
    }, 900);

    function handleMessage(event) {
      if (event.source !== window || event.data?.type !== "NC_GITHUB_PUSHER_CODE_RESULT" || event.data?.requestId !== requestId) {
        return;
      }

      window.clearTimeout(timeout);
      window.removeEventListener("message", handleMessage);
      resolve({
        code: event.data.code || "",
        language: normalizeLanguage(event.data.language || "")
      });
    }

    window.addEventListener("message", handleMessage);

    const script = document.createElement("script");
    script.textContent = `
      (() => {
        const requestId = ${JSON.stringify(requestId)};
        const slug = ${JSON.stringify(slug)};
        try {
          const cmState = document.querySelector(".cm-content")?.cmView?.view?.state;
          if (cmState?.doc) {
            window.postMessage({
              type: "NC_GITHUB_PUSHER_CODE_RESULT",
              requestId,
              code: cmState.doc.toString(),
              language: ""
            }, "*");
            return;
          }

          const monacoModels = window.monaco?.editor?.getModels?.() || [];
          const monacoModel = monacoModels.find((model) => String(model.uri || "").includes(slug));
          if (monacoModel?.getValue?.()) {
            window.postMessage({
              type: "NC_GITHUB_PUSHER_CODE_RESULT",
              requestId,
              code: monacoModel.getValue(),
              language: monacoModel.getLanguageId?.() || ""
            }, "*");
            return;
          }

          window.postMessage({ type: "NC_GITHUB_PUSHER_CODE_RESULT", requestId, code: "", language: "" }, "*");
        } catch (error) {
          window.postMessage({ type: "NC_GITHUB_PUSHER_CODE_RESULT", requestId, code: "", language: "" }, "*");
        }
      })();
    `;
    (document.documentElement || document.head || document.body).appendChild(script);
    script.remove();
  });
}

function getCodeFromLocalStorage(slug) {
  const values = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key) continue;
    const value = localStorage.getItem(key);
    if (!value) continue;
    if (key.includes(slug) || value.includes(slug)) {
      values.push(value);
    }
  }

  for (const value of values) {
    const parsed = parsePossibleJson(value);
    const found = findCodeInObject(parsed);
    if (found) {
      return found;
    }
  }

  return { code: "", language: getLanguage() };
}

function getVisibleEditorCode() {
  const monacoLines = Array.from(document.querySelectorAll(".monaco-editor .view-line"))
    .map((line) => line.textContent || "")
    .filter((line) => line.trim() || line === "");
  if (monacoLines.length) {
    return monacoLines.join("\n");
  }

  const codeMirrorLines = Array.from(document.querySelectorAll(".cm-content .cm-line"))
    .map((line) => line.textContent || "")
    .filter((line) => line.trim() || line === "");
  if (codeMirrorLines.length) {
    return codeMirrorLines.join("\n");
  }

  const textarea = Array.from(document.querySelectorAll("textarea"))
    .map((node) => node.value)
    .find(looksLikeCode);
  return textarea || "";
}

function parsePossibleJson(value) {
  try {
    return JSON.parse(value);
  } catch (_error) {
    return value;
  }
}

function findCodeInObject(value) {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    if (looksLikeCode(value)) {
      return { code: value, language: getLanguage() };
    }
    return null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findCodeInObject(item);
      if (found) return found;
    }
    return null;
  }

  if (typeof value === "object") {
    const code = value.code || value.typed_code || value.sourceCode || value.source_code || value.text || value.value;
    if (typeof code === "string" && looksLikeCode(code)) {
      return {
        code,
        language: normalizeLanguage(value.lang || value.language || value.languageId || getLanguage())
      };
    }

    for (const item of Object.values(value)) {
      const found = findCodeInObject(item);
      if (found) return found;
    }
  }

  return null;
}

function chooseLanguage(...candidates) {
  const code = candidates[candidates.length - 1] || "";
  for (const candidate of candidates.slice(0, -1)) {
    const language = normalizeLanguage(candidate);
    if (language && language !== "text" && language !== "plaintext") {
      return language;
    }
  }

  return inferLanguageFromCode(code) || "python3";
}

function inferLanguageFromCode(code) {
  const value = String(code || "");
  if (/^\s*class\s+Solution\s*:/m.test(value) || /^\s*def\s+\w+\s*\(/m.test(value)) {
    return "python3";
  }
  if (/class\s+Solution\s*\{[\s\S]*public\s*:/m.test(value) || /#include\s*</.test(value)) {
    return "cpp";
  }
  if (/public\s+class\s+Solution/.test(value)) {
    return "java";
  }
  if (/function\s+\w+\s*\(|const\s+\w+\s*=\s*\(/.test(value)) {
    return "javascript";
  }
  return "";
}

function looksLikeCode(value) {
  return typeof value === "string" && value.length > 20 && /[\n;{}():=]/.test(value);
}

function normalizeLanguage(value) {
  const normalized = String(value || "").trim().toLowerCase();
  const aliases = {
    "c++": "cpp",
    "c#": "csharp",
    python3: "python3",
    python: "python",
    py: "python3",
    javascript: "javascript",
    js: "javascript",
    typescript: "typescript",
    ts: "typescript",
    golang: "golang",
    go: "golang"
  };
  return aliases[normalized] || normalized;
}

function normalizeSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function unslugify(value) {
  return String(value || "")
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function textOf(node) {
  return node?.textContent?.replace(/\s+/g, " ").trim() || "";
}
