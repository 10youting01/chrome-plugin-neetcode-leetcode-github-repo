chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "GET_LEETCODE_PROBLEM") {
    return false;
  }

  collectProblem()
    .then((problem) => sendResponse({ ok: true, problem }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));

  return true;
});

async function collectProblem() {
  const slug = getSlugFromUrl();
  if (!slug) {
    throw new Error("這不是 LeetCode 題目頁");
  }

  const questionData = await getQuestionData(slug);
  const codeResult = await getEditorCode(slug);
  const titleInfo = getTitleInfo(slug);
  const code = codeResult.code || getVisibleEditorCode();

  return {
    platform: "leetcode",
    slug: questionData.titleSlug || slug,
    questionId: questionData.questionId || titleInfo.questionId,
    displayTitle: questionData.title || titleInfo.displayTitle,
    difficulty: questionData.difficulty || getDifficulty(),
    language: chooseLanguage(codeResult.language, getLanguage(), code),
    code,
    url: location.href
  };
}

async function getQuestionData(slug) {
  try {
    const response = await fetch("https://leetcode.com/graphql", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        query: `
          query questionData($titleSlug: String!) {
            question(titleSlug: $titleSlug) {
              questionFrontendId
              title
              titleSlug
              difficulty
            }
          }
        `,
        variables: { titleSlug: slug }
      })
    });

    if (!response.ok) {
      return {};
    }

    const data = await response.json();
    const question = data?.data?.question;
    return {
      questionId: question?.questionFrontendId || "",
      title: question?.title || "",
      titleSlug: question?.titleSlug || "",
      difficulty: question?.difficulty || ""
    };
  } catch (_error) {
    return {};
  }
}

function getSlugFromUrl() {
  const match = location.pathname.match(/\/problems\/([^/]+)/);
  return match?.[1] || "";
}

function getTitleInfo(slug) {
  const candidates = [
    textOf(document.querySelector('[data-cy="question-title"]')),
    textOf(document.querySelector('a[href^="/problems/' + slug + '"]')),
    textOf(document.querySelector("h1")),
    document.title.replace(/\s*-\s*LeetCode\s*$/, "")
  ].filter(Boolean);

  const raw = candidates.find((value) => value && !value.includes("LeetCode")) || candidates[0] || slug;
  const match = raw.match(/^(\d+)\.\s*(.+)$/);

  return {
    questionId: match?.[1] || findQuestionIdInBody(raw),
    displayTitle: match?.[2] || raw
  };
}

function getDifficulty() {
  const exact = Array.from(document.querySelectorAll("span, div"))
    .map((node) => textOf(node))
    .find((value) => ["Easy", "Medium", "Hard"].includes(value));

  return exact || "";
}

function getLanguage() {
  const localValue = readLocalStorageLanguage();
  if (localValue) {
    return localValue;
  }

  const buttonText = Array.from(document.querySelectorAll("button"))
    .map((button) => textOf(button))
    .find((value) => /^(C\+\+|Java|Python3?|JavaScript|TypeScript|Go|Ruby|Rust|Swift|Kotlin|C#|C)$/i.test(value));

  return normalizeLanguage(buttonText || "");
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

function readLocalStorageLanguage() {
  const keys = ["global_lang", "lang", "language"];
  for (const key of keys) {
    const value = localStorage.getItem(key);
    if (value) {
      return normalizeLanguage(value);
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
    const requestId = `lc-gh-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const timeout = window.setTimeout(() => {
      window.removeEventListener("message", handleMessage);
      resolve({ code: "", language: "" });
    }, 900);

    function handleMessage(event) {
      if (event.source !== window || event.data?.type !== "LC_GITHUB_PUSHER_CODE_RESULT" || event.data?.requestId !== requestId) {
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
          const models = window.monaco?.editor?.getModels?.() || [];
          const preferred = models.find((model) => String(model.uri || "").includes(slug)) || models.find((model) => model.getValue?.().trim()) || models[0];
          const code = preferred?.getValue?.() || "";
          const language = preferred?.getLanguageId?.() || "";
          window.postMessage({ type: "LC_GITHUB_PUSHER_CODE_RESULT", requestId, code, language }, "*");
        } catch (error) {
          window.postMessage({ type: "LC_GITHUB_PUSHER_CODE_RESULT", requestId, code: "", language: "" }, "*");
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
    if (!value || (!key.includes(slug) && !value.includes(slug))) continue;
    values.push(value);
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
  const lines = Array.from(document.querySelectorAll(".monaco-editor .view-line"))
    .map((line) => line.textContent || "")
    .filter((line) => line.trim() || line === "");

  return lines.length ? lines.join("\n") : "";
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
    const code = value.code || value.typed_code || value.sourceCode || value.text;
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

function looksLikeCode(value) {
  return value.length > 20 && /[\n;{}():=]/.test(value);
}

function findQuestionIdInBody(title) {
  const escapedTitle = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = document.body.innerText.match(new RegExp(`(\\d+)\\.\\s*${escapedTitle}`));
  return match?.[1] || "";
}

function normalizeLanguage(value) {
  const normalized = String(value || "").trim().toLowerCase();
  const aliases = {
    "c++": "cpp",
    "c#": "csharp",
    python3: "python3",
    python: "python",
    javascript: "javascript",
    js: "javascript",
    typescript: "typescript",
    ts: "typescript",
    golang: "golang",
    go: "golang"
  };
  return aliases[normalized] || normalized;
}

function textOf(node) {
  return node?.textContent?.replace(/\s+/g, " ").trim() || "";
}
