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
      runtime: { onMessage: { addListener() {} } }
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
          if (typeof node.textContent === "string" && node.textContent.includes("window.postMessage")) {
            options.onInjectedScript?.(node.textContent);
          }
        }
      },
      head: { appendChild() {} },
      createElement() {
        return {
          textContent: "",
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

async function run() {
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
  const monacoSelection = loadModule("content/neetcode.js", {
    location: {
      href: "https://neetcode.io/problems/two-sum",
      pathname: "/problems/two-sum"
    }
  });
  const monacoModel = monacoSelection.findBestMonacoModel("two-sum", [
    {
      uri: "inmemory://model/1",
      getValue: () => "{\"layout\":\"sidebar\"}",
      getLanguageId: () => "json"
    },
    {
      uri: "inmemory://model/2",
      getValue: () => fallbackMonacoCode,
      getLanguageId: () => "python"
    }
  ]);

  assertEqual(monacoModel.getValue(), fallbackMonacoCode, "NeetCode should use a solution-like Monaco model even when its URI does not include the slug");

  const codeMirrorCode = "function twoSum(nums, target) {\n  return [0, 1];\n}";
  const codeMirrorSelection = loadModule("content/neetcode.js", {
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
    },
    location: {
      href: "https://neetcode.io/problems/two-sum",
      pathname: "/problems/two-sum"
    }
  });

  assertEqual(codeMirrorSelection.findCodeMirrorDoc(), codeMirrorCode, "NeetCode should read full CodeMirror docs through nested view paths");

  console.log("content extraction smoke tests passed");
}

run().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
