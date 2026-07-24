export default defineBackground(() => {
  chrome.action.onClicked.addListener((tab) => {
    chrome.sidePanel
      .open({ windowId: tab.windowId })
      .catch((error) => console.error('openSidePanel', error));
  });
});
