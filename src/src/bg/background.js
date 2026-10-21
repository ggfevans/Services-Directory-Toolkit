// The sender check (src/src/lib/sender.js). A path here resolves against this file's location.
importScripts("../lib/sender.js");

{
  // The toolbar button is disabled by default (action.default_state in manifest.json, and these
  // calls as a fallback) and enabled per tab by status.js, a content script that sends enableAction
  // only on Services Directory pages. Chrome clears per-tab action state on navigation, so leaving
  // the page disables the button again.
  const disableByDefault = () => chrome.action.disable();

  chrome.runtime.onInstalled.addListener(disableByDefault);
  chrome.runtime.onStartup.addListener(disableByDefault);

  chrome.runtime.onMessage.addListener((message, sender) => {
    // Only this extension's content script, in the top frame of a tab, in an active document: not a
    // prerendered page or one in the back/forward cache (BG-2).
    if (message?.type !== "enableAction" || !SDT.sender.accepts(sender, chrome.runtime.id)) {
      return;
    }
    // The tab can close before this runs. That is not an error worth reporting (BG-3).
    chrome.action.enable(sender.tab.id).catch((error) => {
      console.debug("Services Directory Toolkit: could not enable the toolbar button", error);
    });
  });
}
