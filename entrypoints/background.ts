export default defineBackground(() => {
  chrome.sidePanel
    ?.setPanelBehavior({ openPanelOnActionClick: true })
    .catch((e) => console.error('setPanelBehavior', e));
});
