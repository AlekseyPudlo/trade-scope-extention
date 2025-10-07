console.info('Trade Scope background service worker is running.')

const chromeApi = (globalThis as { chrome?: any }).chrome

if (chromeApi?.sidePanel?.setPanelBehavior) {
  const ensureSidePanel = async () => {
    try {
      await chromeApi.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
    } catch (error) {
      console.error('Failed to configure side panel behavior', error)
    }
  }

  chromeApi.runtime?.onInstalled?.addListener(() => {
    void ensureSidePanel()
  })

  chromeApi.runtime?.onStartup?.addListener(() => {
    void ensureSidePanel()
  })
}

chromeApi?.action?.onClicked?.addListener(async (tab: any) => {
  if (!chromeApi?.sidePanel?.open) return
  try {
    const options = tab?.windowId
      ? { windowId: tab.windowId }
      : tab?.id
        ? { tabId: tab.id }
        : {}
    await chromeApi.sidePanel.open(options)
  } catch (error) {
    console.error('Failed to open side panel', error)
  }
})
