import { Window } from "happy-dom";

// React DOM detects input-event support at module load time. Install a browser
// before test imports, not after a preceding test has already loaded React DOM.
const browser = new Window({ url: "http://localhost" });
Object.defineProperty(browser, "SyntaxError", {
  configurable: true,
  value: SyntaxError,
});
for (const [key, value] of Object.entries({
  window: browser,
  document: browser.document,
  navigator: browser.navigator,
  HTMLElement: browser.HTMLElement,
  HTMLInputElement: browser.HTMLInputElement,
  HTMLTextAreaElement: browser.HTMLTextAreaElement,
  Node: browser.Node,
  Element: browser.Element,
  MutationObserver: browser.MutationObserver,
  IS_REACT_ACT_ENVIRONMENT: true,
}))
  Object.defineProperty(globalThis, key, {
    configurable: true,
    writable: true,
    value,
  });
