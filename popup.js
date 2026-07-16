const els = {
  csvFile: document.getElementById('csvFile'),
  loadCsv: document.getElementById('loadCsv'),
  startRun: document.getElementById('startRun'),
  processNext: document.getElementById('processNext'),
  pauseRun: document.getElementById('pauseRun'),
  resumeRun: document.getElementById('resumeRun'),
  stopRun: document.getElementById('stopRun'),
  resetState: document.getElementById('resetState'),
  status: document.getElementById('status'),
  summary: document.getElementById('summary'),
  rowsPreview: document.getElementById('rowsPreview'),
  log: document.getElementById('log')
};

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"') {
      if (inQuotes && next === '"') {
        value += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      row.push(value);
      value = '';
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(value);
      value = '';
      if (row.some(cell => cell !== '')) rows.push(row);
      row = [];
    } else {
      value += char;
    }
  }
  if (value.length || row.length) {
    row.push(value);
    rows.push(row);
  }
  const headers = rows.shift().map(h => h.trim());
  return rows.map((cells, index) => {
    const obj = { __rowNumber: index + 2 };
    headers.forEach((header, i) => { obj[header] = (cells[i] || '').trim(); });
    return normalizeRow(obj);
  }).filter(r => r.batchName);
}

function normalizeYesNo(value) {
  return /^(yes|true|1)$/i.test((value || '').trim());
}

function normalizeMandatory(value) {
  const cleaned = (value || '').trim().toLowerCase();
  if (!cleaned) return '';
  if (cleaned.startsWith('man')) return 'Mandatory';
  if (cleaned.startsWith('ele')) return 'Elective';
  return value.trim();
}

function normalizeRow(raw) {
  let action = (raw.Action || raw.action || '').trim().toUpperCase();
  if (!action) {
    if (raw['Module to add 1'] || raw['Module to add'] || raw.Module_name || raw.module_name || raw.Module || raw.module) {
      action = 'ADD';
    } else if (raw['Mod to delete 1'] || raw.Module_name || raw.module_name) {
      action = 'DELETE';
    }
  }

  const moduleName = (
    raw.Module_name || 
    raw.module_name || 
    raw.Module || 
    raw.module ||
    raw['Module to add 1'] || 
    raw['Mod to delete 1'] || 
    ''
  ).trim();

  let placement = (raw.Placement || raw.placement || '').trim().toUpperCase();
  if (placement.startsWith('MID')) {
    placement = 'MIDDLE';
  } else if (placement.startsWith('END') || !placement) {
    placement = 'END';
  }

  const previousModule = (
    raw.Previous_module || 
    raw.previous_module || 
    raw.Prev_module || 
    raw.prev_module ||
    raw.Prev_module_name || 
    raw['prev. module name'] ||
    raw['prev module name'] ||
    ''
  ).trim();

  const moduleType = (
    raw.Module_type || 
    raw.module_type || 
    raw['Module Type'] || 
    raw['module type'] || 
    raw.Type || 
    raw.type || 
    'Core'
  ).trim();

  let normalizedModuleType = 'Core';
  if (/^career/i.test(moduleType)) {
    normalizedModuleType = 'Career';
  } else if (/^supp/i.test(moduleType)) {
    normalizedModuleType = 'Supplementary';
  }

  const type = normalizeMandatory(
    raw['Elective/Mandatory'] || 
    raw['elective/mandatory'] ||
    raw['Elective/Mandatory 1'] || 
    ''
  );

  const mi = normalizeYesNo(
    raw['MI'] || 
    raw['mi'] ||
    raw['MI 1'] || 
    ''
  );

  const skillCertifications = normalizeYesNo(
    raw['Skill Certifications'] ||
    raw['skill certifications'] ||
    raw['skill_certifications'] ||
    raw['SC'] ||
    raw['sc'] ||
    raw['Add Skill Certifications'] ||
    ''
  );

  const skillCertificationName = (
    raw['Skill Certification Name'] ||
    raw['skill certification name'] ||
    raw['skill_certification_name'] ||
    raw['SC Name'] ||
    raw['sc name'] ||
    raw['SC_Name'] ||
    ''
  ).trim();

  return {
    rowNumber: raw.__rowNumber,
    batchName: (raw.Batch_name || raw.Batch || raw.batch_name || raw.batch || '').trim(),
    action,
    moduleName,
    placement,
    previousModule,
    moduleType: normalizedModuleType,
    type,
    mi,
    skillCertifications,
    skillCertificationName
  };
}

async function getState() {
  return chrome.storage.local.get(['rows', 'runState', 'logs']);
}

async function setState(patch) {
  return chrome.storage.local.set(patch);
}

function renderRows(rows = []) {
  if (!rows.length) {
    els.rowsPreview.textContent = 'No rows loaded.';
    return;
  }
  els.rowsPreview.innerHTML = rows.slice(0, 8).map((row, index) => {
    const actionColor = row.action === 'ADD' ? '#0f766e' : '#b91c1c';
    return `
      <div class="row-chip" style="border-left: 4px solid ${actionColor}; margin-bottom: 6px; padding: 6px 8px; background: rgba(255,255,255,0.04); border-radius: 4px;">
        <strong>${index + 1}. ${row.batchName}</strong><br>
        <span style="font-weight: bold; color: ${actionColor}; font-size: 11px;">${row.action}</span>: ${row.moduleName}
        ${row.action === 'ADD' ? `<br><span class="muted" style="font-size: 11px; opacity: 0.8;">Placement: ${row.placement}${row.placement === 'MIDDLE' ? ` (after "${row.previousModule}")` : ''} | Module Type: ${row.moduleType} | Type: ${row.type} | MI: ${row.mi ? 'Yes' : 'No'} | SC: ${row.skillCertifications ? 'Yes' : 'No'}</span>` : ''}
      </div>
    `;
  }).join('');
}

function renderState(data) {
  const rows = data.rows || [];
  const runState = data.runState || {};
  const logs = data.logs || [];
  els.status.textContent = runState.status || 'Idle';
  els.summary.textContent = `Loaded rows: ${rows.length}\nCurrent index: ${runState.currentIndex ?? 0}\nCompleted: ${runState.completed ?? 0}\nFailed: ${runState.failed ?? 0}`;
  els.log.textContent = logs.slice(-20).join('\n');
  renderRows(rows);
}

async function sendAction(action) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('Open the Scaler page first.');
  return chrome.runtime.sendMessage({ action, tabId: tab.id });
}

els.loadCsv.addEventListener('click', async () => {
  const file = els.csvFile.files?.[0];
  if (!file) return alert('Choose a CSV file first.');
  const text = await file.text();
  const rows = parseCsv(text);
  await setState({
    rows,
    runState: { status: 'CSV loaded', currentIndex: 0, completed: 0, failed: 0, paused: false, stopped: false },
    logs: [`Loaded ${rows.length} rows from CSV at ${new Date().toLocaleString()}`]
  });
  renderState(await getState());
});

els.startRun.addEventListener('click', async () => {
  await sendAction('START_RUN');
  renderState(await getState());
});

els.processNext.addEventListener('click', async () => {
  await sendAction('PROCESS_NEXT');
  renderState(await getState());
});

els.pauseRun.addEventListener('click', async () => {
  await chrome.storage.local.set({ runState: { ...(await getState()).runState, status: 'Paused', paused: true } });
  renderState(await getState());
});

els.resumeRun.addEventListener('click', async () => {
  await sendAction('RESUME_RUN');
  renderState(await getState());
});

els.stopRun.addEventListener('click', async () => {
  await chrome.storage.local.set({ runState: { ...(await getState()).runState, status: 'Stopped', stopped: true, paused: false } });
  renderState(await getState());
});

els.resetState.addEventListener('click', async () => {
  await chrome.storage.local.clear();
  renderState(await getState());
});

chrome.storage.onChanged.addListener(async () => {
  renderState(await getState());
});

getState().then(renderState);
