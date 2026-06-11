const fs = require("fs");
const path = require("path");
const vm = require("vm");

const repoRoot = path.resolve(__dirname, "..");

function createLocalStorage(entries = {}) {
  const keys = Object.keys(entries);
  return {
    get length() {
      return keys.length;
    },
    key(index) {
      return keys[index] || null;
    },
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(entries, key) ? entries[key] : null;
    }
  };
}

function loadModule(relativePath, options = {}) {
  const source = fs.readFileSync(`${repoRoot}/${relativePath}`, "utf8");
  const queryMap = options.queryMap || {};
  const querySingleMap = options.querySingleMap || {};

  const context = vm.createContext({
    console,
    Math,
    JSON,
    String,
    Array,
    Object,
    RegExp,
    setTimeout,
    clearTimeout,
    localStorage: options.localStorage || createLocalStorage(),
    location: options.location || {
      href: "https://example.com/problems/two-sum/",
      pathname: "/problems/two-sum/"
    },
    chrome: {
      runtime: {
        getURL(path) {
          return `chrome-extension://test/${path}`;
        },
        onMessage: { addListener() {} }
      }
    },
    window: {
      setTimeout,
      clearTimeout,
      addEventListener() {},
      removeEventListener() {},
      postMessage() {},
      monaco: options.monaco
    },
    document: {
      title: options.title || "",
      body: { innerText: options.bodyText || "" },
      documentElement: {
        appendChild(node) {
          if (node.src) {
            options.onInjectedScriptSrc?.(node.src);
            node.onload?.();
            return;
          }
          if (typeof node.textContent === "string" && node.textContent.includes("window.postMessage")) {
            options.onInjectedScript?.(node.textContent);
          }
        }
      },
      head: { appendChild() {} },
      createElement() {
        return {
          dataset: {},
          src: "",
          textContent: "",
          onerror: null,
          onload: null,
          remove() {}
        };
      },
      querySelector(selector) {
        return querySingleMap[selector] || null;
      },
      querySelectorAll(selector) {
        return queryMap[selector] || [];
      }
    }
  });

  vm.runInContext(source, context, { filename: relativePath });
  return context;
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}\nExpected: ${JSON.stringify(expected)}\nActual: ${JSON.stringify(actual)}`);
  }
}

function runPageBridge(options = {}) {
  const source = fs.readFileSync(`${repoRoot}/content/neetcode-page-bridge.js`, "utf8");
  const listeners = {};
  const postedMessages = [];
  const context = vm.createContext({
    String,
    Array,
    window: {
      monaco: options.monaco,
      addEventListener(type, listener) {
        listeners[type] = listener;
      },
      postMessage(message) {
        postedMessages.push(message);
      }
    },
    document: {
      querySelectorAll(selector) {
        return options.queryMap?.[selector] || [];
      }
    }
  });

  context.window.window = context.window;
  vm.runInContext(source, context, { filename: "content/neetcode-page-bridge.js" });
  return {
    postRequest(data) {
      listeners.message?.({ source: context.window, data });
      return postedMessages[postedMessages.length - 1] || null;
    }
  };
}

async function run() {
  const manifest = JSON.parse(fs.readFileSync(`${repoRoot}/manifest.json`, "utf8"));
  const neetcodeSource = fs.readFileSync(`${repoRoot}/content/neetcode.js`, "utf8");
  const webResources = manifest.web_accessible_resources?.flatMap((entry) => entry.resources || []) || [];
  assertEqual(webResources.includes("content/neetcode-page-bridge.js"), true, "Manifest should expose the NeetCode page bridge as a packaged script");
  assertEqual(neetcodeSource.includes('chrome.runtime.getURL("content/neetcode-page-bridge.js")'), true, "NeetCode should inject a packaged bridge script instead of inline page code");

  const staleStorage = createLocalStorage({
    "cached-code": JSON.stringify({
      slug: "two-sum",
      code: "class Solution:\n    def twoSum(self, nums, target):\n        return []"
    })
  });

  const leetcode = loadModule("content/leetcode.js", {
    localStorage: staleStorage,
    title: "1. Two Sum - LeetCode",
    bodyText: "1. Two Sum"
  });

  const leetcodeResult = await leetcode.getEditorCode("two-sum");
  assertEqual(leetcodeResult.code, "", "LeetCode should not fall back to localStorage code");

  const neetcode = loadModule("content/neetcode.js", {
    localStorage: staleStorage,
    location: {
      href: "https://neetcode.io/problems/two-sum",
      pathname: "/problems/two-sum"
    },
    title: "Two Sum - NeetCode",
    bodyText: "LeetCode 1 Two Sum"
  });

  const neetcodeResult = await neetcode.getEditorCode("two-sum");
  assertEqual(neetcodeResult.code, "", "NeetCode should not fall back to localStorage code");

  const visibleCode = loadModule("content/neetcode.js", {
    queryMap: {
      ".monaco-editor .view-line": [],
      ".cm-content .cm-line": [],
      "pre code, pre": [{ textContent: "class Solution:\n    pass" }]
    },
    location: {
      href: "https://neetcode.io/problems/two-sum",
      pathname: "/problems/two-sum"
    }
  });

  assertEqual(visibleCode.getVisibleEditorCode(), "class Solution:\n    pass", "NeetCode should read explicit pre/code blocks");

  const fallbackMonacoCode = "class Solution:\n    def twoSum(self, nums, target):\n        return [0, 1]";
  const codeMirrorCode = "function twoSum(nums, target) {\n  return [0, 1];\n}";

  const codeMirrorBridge = runPageBridge({
    queryMap: {
      ".cm-editor, .cm-content, .cm-line": [
        {
          cmView: {
            rootView: {
              view: {
                state: {
                  doc: {
                    toString: () => codeMirrorCode
                  }
                }
              }
            }
          }
        }
      ]
    }
  });
  const codeMirrorResult = codeMirrorBridge.postRequest({
    type: "NC_GITHUB_PUSHER_CODE_REQUEST",
    requestId: "cm-test",
    slug: "two-sum"
  });

  assertEqual(codeMirrorResult.code, codeMirrorCode, "NeetCode page bridge should read full CodeMirror docs through nested view paths");

  const bridge = runPageBridge({
    monaco: {
      editor: {
        getModels: () => [
          {
            uri: "inmemory://settings",
            getValue: () => "{\"theme\":\"dark\"}",
            getLanguageId: () => "json"
          },
          {
            uri: "inmemory://untitled",
            getValue: () => fallbackMonacoCode,
            getLanguageId: () => "python"
          }
        ]
      }
    }
  });
  const bridgeResult = bridge.postRequest({
    type: "NC_GITHUB_PUSHER_CODE_REQUEST",
    requestId: "bridge-test",
    slug: "two-sum"
  });

  assertEqual(bridgeResult.code, fallbackMonacoCode, "NeetCode page bridge should return full Monaco code from page context");
  assertEqual(bridgeResult.requestId, "bridge-test", "NeetCode page bridge should preserve request IDs");

  console.log("content extraction smoke tests passed");
}

run().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
