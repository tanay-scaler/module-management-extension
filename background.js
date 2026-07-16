async function getState() {
  return chrome.storage.local.get(['rows', 'runState', 'logs']);
}

async function setState(patch) {
  return chrome.storage.local.set(patch);
}

async function appendLog(message) {
  const { logs = [] } = await getState();
  logs.push(`[${new Date().toLocaleTimeString()}] ${message}`);
  await setState({ logs: logs.slice(-500) });
}

async function ensureContentScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'PING' });
    return;
  } catch (error) {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js']
    });
  }
}

async function sendToTab(tabId, payload) {
  await ensureContentScript(tabId);
  return chrome.tabs.sendMessage(tabId, payload);
}

async function processSequentially(tabId) {
  const state = await getState();
  const rows = state.rows || [];
  const runState = state.runState || {};
  let index = runState.currentIndex || 0;

  if (!rows.length) throw new Error('No CSV rows loaded.');

  await appendLog(`Run started from row index ${index}.`);
  await setState({ runState: { ...runState, status: 'Running', paused: false, stopped: false } });

  while (index < rows.length) {
    const latest = await getState();
    const live = latest.runState || {};
    if (live.stopped) {
      await appendLog('Run stopped by user.');
      await setState({ runState: { ...live, status: 'Stopped', currentIndex: index } });
      return;
    }
    if (live.paused) {
      await appendLog('Run paused by user.');
      await setState({ runState: { ...live, status: 'Paused', currentIndex: index } });
      return;
    }

    const row = rows[index];
    await appendLog(`Processing row ${row.rowNumber}: ${row.batchName}`);
    await setState({ runState: { ...live, status: `Processing ${row.batchName}`, currentIndex: index } });

    try {
      const result = await sendToTab(tabId, { type: 'PROCESS_ROW', row });
      if (!result?.ok) throw new Error(result?.error || 'Unknown processing failure');
      
      const currentRows = (await getState()).rows || [];
      if (currentRows[index]) currentRows[index].status = 'Completed';
      
      const completed = (live.completed || 0) + 1;
      index += 1;
      await setState({
        rows: currentRows,
        runState: { ...live, status: `Completed ${row.batchName}`, currentIndex: index, completed, failed: live.failed || 0, paused: false, stopped: false }
      });
      await appendLog(`Completed: ${row.batchName}`);
    } catch (error) {
      const currentRows = (await getState()).rows || [];
      if (currentRows[index]) currentRows[index].status = `Failed: ${error.message}`;
      
      const failed = (live.failed || 0) + 1;
      index += 1; // Proceed to the next row instead of returning
      await setState({
        rows: currentRows,
        runState: { ...live, status: `Failed on ${row.batchName}`, currentIndex: index, completed: live.completed || 0, failed, paused: false, stopped: false, lastError: error.message }
      });
      await appendLog(`Failed: ${row.batchName} -> ${error.message}`);
    }
    // Post-row delay to allow QC verification between batches
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  const latest = await getState();
  await setState({ runState: { ...latest.runState, status: 'All rows completed', currentIndex: rows.length, paused: false, stopped: false } });
  await appendLog('All rows completed.');
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'START_RUN' || message.action === 'RESUME_RUN') {
    const tabId = message.tabId || sender.tab?.id;
    if (!tabId) {
      sendResponse({ ok: false, error: 'No active tab ID resolved.' });
      return false;
    }
    // Run the long sequential loop asynchronously so we don't keep the popup port open
    processSequentially(tabId).catch(async (error) => {
      await appendLog(`Background error: ${error.message}`);
    });
    sendResponse({ ok: true });
    return false; // Connection closed immediately, popup can be closed safely
  }

  (async () => {
    if (message.action === 'PROCESS_NEXT') {
      const { rows = [], runState = {} } = await getState();
      const idx = runState.currentIndex || 0;
      if (!rows[idx]) throw new Error('No next row to process.');
      const result = await sendToTab(message.tabId, { type: 'PROCESS_ROW', row: rows[idx] });
      if (!result?.ok) throw new Error(result?.error || 'PROCESS_NEXT failed');
      await setState({ runState: { ...runState, currentIndex: idx + 1, completed: (runState.completed || 0) + 1, status: `Completed ${rows[idx].batchName}` } });
      await appendLog(`Completed single row: ${rows[idx].batchName}`);
      sendResponse({ ok: true });
      return;
    }
    sendResponse({ ok: true });
  })().catch(async (error) => {
    await appendLog(`Background error: ${error.message}`);
    sendResponse({ ok: false, error: error.message });
  });
  return true;
});
