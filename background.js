const GITHUB_API = "https://api.github.com";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "PUSH_SOLUTION_TO_GITHUB") {
    return false;
  }

  pushSolution(message.settings, message.problem)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));

  return true;
});

async function pushSolution(settings, problem) {
  const solutionPath = normalizeRepoPath(problem.solutionPath);
  const message = `${problem.questionId ? `${problem.questionId}. ` : ""}${problem.displayTitle || problem.slug} solution`;

  const solution = await upsertFile(settings, {
    path: solutionPath,
    content: problem.code,
    message
  });

  return {
    files: [
      { label: solutionPath, htmlUrl: solution.htmlUrl }
    ]
  };
}

async function upsertFile(settings, file) {
  const existing = await getExistingFile(settings, file.path);
  const url = `${GITHUB_API}/repos/${settings.owner}/${settings.repo}/contents/${encodeURIComponentPath(file.path)}`;

  const response = await fetch(url, {
    method: "PUT",
    headers: githubHeaders(settings.token),
    body: JSON.stringify({
      message: file.message,
      content: toBase64(file.content),
      branch: settings.branch,
      sha: existing?.sha
    })
  });

  const data = await safeJson(response);
  if (!response.ok) {
    throw new Error(githubErrorMessage(data, `無法寫入 ${file.path}`));
  }

  return {
    path: file.path,
    htmlUrl: data.content?.html_url
  };
}

async function getExistingFile(settings, path) {
  const url = `${GITHUB_API}/repos/${settings.owner}/${settings.repo}/contents/${encodeURIComponentPath(path)}?ref=${encodeURIComponent(settings.branch)}`;
  const response = await fetch(url, {
    method: "GET",
    headers: githubHeaders(settings.token)
  });

  if (response.status === 404) {
    return null;
  }

  const data = await safeJson(response);
  if (!response.ok) {
    throw new Error(githubErrorMessage(data, `無法檢查 ${path}`));
  }

  return data;
}

function githubHeaders(token) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "X-GitHub-Api-Version": "2022-11-28"
  };
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch (_error) {
    return {};
  }
}

function githubErrorMessage(data, fallback) {
  if (data?.message) {
    return `${fallback}: ${data.message}`;
  }
  return fallback;
}

function toBase64(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function encodeURIComponentPath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

function normalizeRepoPath(path) {
  return String(path || "")
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .replace(/\/+/g, "/");
}
