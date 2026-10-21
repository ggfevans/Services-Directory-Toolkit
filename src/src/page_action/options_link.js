{
  // The Options link opens the options page in its own tab, or focuses it if it is already open. The
  // href keeps it a real link for keyboard and screen-reader users. Phase 9 replaces it with All
  // settings beside the quick switches (#24).
  document.getElementById("optionslink").addEventListener("click", (event) => {
    event.preventDefault();
    chrome.runtime.openOptionsPage();
  });
}
