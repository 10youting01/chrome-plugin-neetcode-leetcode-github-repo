(() => {
  if (window.__ncGithubPusherBridgeLoaded) {
    return;
  }
  window.__ncGithubPusherBridgeLoaded = true;

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.type !== "NC_GITHUB_PUSHER_CODE_REQUEST") {
      return;
    }

    const requestId = event.data.requestId;
    const slug = event.data.slug;
    try {
      const cmDoc = findCodeMirrorDoc(document);
      if (cmDoc) {
        postResult(requestId, cmDoc, "");
        return;
      }

      const monacoModels = window.monaco?.editor?.getModels?.() || [];
      const monacoModel = findBestMonacoModel(slug, monacoModels);
      if (monacoModel?.getValue?.()) {
        postResult(requestId, monacoModel.getValue(), monacoModel.getLanguageId?.() || "");
        return;
      }

      postResult(requestId, "", "");
    } catch (_error) {
      postResult(requestId, "", "");
    }
  });

  function postResult(requestId, code, language) {
    window.postMessage({
      type: "NC_GITHUB_PUSHER_CODE_RESULT",
      requestId,
      code,
      language
    }, "*");
  }

  function findCodeMirrorDoc(root = document) {
    const nodes = Array.from(root.querySelectorAll?.(".cm-editor, .cm-content, .cm-line") || []);
    for (const node of nodes) {
      const cmView = node?.cmView;
      const doc = cmView?.view?.state?.doc || cmView?.rootView?.view?.state?.doc || cmView?.rootView?.state?.doc || cmView?.state?.doc;
      const value = doc?.toString?.();
      if (looksLikeEditorCode(value)) {
        return value;
      }
    }
    return "";
  }

  function findBestMonacoModel(slug, models) {
    return Array.from(models || [])
      .map((model) => ({ model, score: scoreMonacoModel(slug, model) }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score)[0]?.model || null;
  }

  function scoreMonacoModel(slug, model) {
    const code = model?.getValue?.() || "";
    if (!looksLikeEditorCode(code)) {
      return 0;
    }

    const language = String(model?.getLanguageId?.() || "").toLowerCase();
    const uri = String(model?.uri || "").toLowerCase();
    const normalizedSlug = String(slug || "").toLowerCase();
    let score = 1;

    if (normalizedSlug && uri.includes(normalizedSlug)) score += 100;
    if (isSolutionLanguage(language)) score += 20;
    if (/\bclass\s+Solution\b/.test(code)) score += 30;
    if (/^\s*def\s+\w+\s*\(/m.test(code)) score += 12;
    if (/\bpublic\s+class\s+Solution\b/.test(code)) score += 12;
    if (/\bfunction\s+\w+\s*\(|=>/.test(code)) score += 8;
    if (/^\s*#include\s*</m.test(code)) score += 8;
    if (language === "json" || language === "markdown" || language === "plaintext") score -= 50;

    return score;
  }

  function looksLikeEditorCode(value) {
    const code = String(value || "").trim();
    return code.length > 10 && !isUrlLike(code) && /[\n;{}()=<>[\]]/.test(code);
  }

  function isSolutionLanguage(language) {
    return /^(c|cpp|csharp|go|java|javascript|kotlin|python|python3|ruby|rust|swift|typescript)$/.test(String(language || "").toLowerCase());
  }

  function isUrlLike(value) {
    return /^https?:\/\//i.test(String(value || "").trim()) || /[?&][a-z0-9_-]+=/i.test(String(value || "")) || /^www\./i.test(String(value || "").trim());
  }
})();
