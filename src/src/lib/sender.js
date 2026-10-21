// SDT.sender: which runtime messages the service worker acts on (BG-2, BG-3). A message counts only
// when it comes from this extension, from the top frame of a tab, and from a document that is
// active: not prerendering, not in the back/forward cache and not being deleted. Chrome has sent
// sender.documentLifecycle since version 106, so a message without it is refused. The service worker
// loads this file with importScripts.
globalThis.SDT ??= {};

SDT.sender = {
  /** Why the service worker should ignore a message from sender, or null to act on it. */
  problem(sender, extensionId) {
    if (!sender || typeof sender.id !== "string" || sender.id !== extensionId) {
      return "another extension";
    }
    if (!Number.isInteger(sender.tab?.id) || sender.tab.id < 0) {
      return "no tab";
    }
    if (sender.frameId !== 0) {
      return "not the top frame";
    }
    if (sender.documentLifecycle !== "active") {
      return "document not active";
    }
    return null;
  },

  /** Whether the service worker should act on a message from sender. */
  accepts(sender, extensionId) {
    return SDT.sender.problem(sender, extensionId) === null;
  }
};
