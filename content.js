const SELECTOR_HINTS = {
  batchSearchInput: ['input[placeholder*="Search Batch"]', 'input[aria-label*="Search Batch"]', 'input'],
  searchButton: ['button', '[role="button"]'],
  moduleArea: ['body'],
  addModuleButtons: ['button', '[role="button"]']
};

const SPEED_MULTIPLIER = 3.0; // Set to 1.0 for production, >1.0 to slow down for QC/testing

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms * SPEED_MULTIPLIER));
}

// Dispatch a full mouse event sequence — better React compatibility than plain .click()
function triggerClick(el) {
  if (!el) return;
  el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
  el.dispatchEvent(new MouseEvent('mouseup',   { bubbles: true, cancelable: true, view: window }));
  el.dispatchEvent(new MouseEvent('click',     { bubbles: true, cancelable: true, view: window }));
}

// Force a React-controlled checkbox to a specific state via the native property setter,
// then fire click + change so React's synthetic event handlers pick it up.
function setReactCheckbox(el, checked) {
  if (!el) return;
  const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'checked')?.set;
  if (nativeSetter) {
    nativeSetter.call(el, checked);
  } else {
    el.checked = checked;
  }
  el.dispatchEvent(new Event('click',  { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function normalizeText(value) {
  return (value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function exactTextMatch(text, target) {
  const normText = normalizeText(text);
  const normTarget = normalizeText(target);
  if (normText === normTarget) return true;
  
  // Strip trailing status/pill keywords (primary, secondary, active, inactive)
  const strippedText = normText.replace(/\s*(primary|secondary|active|inactive)$/g, '').trim();
  const strippedTarget = normTarget.replace(/\s*(primary|secondary|active|inactive)$/g, '').trim();
  return strippedText === normTarget || strippedText === strippedTarget;
}

function isVisible(el) {
  if (!el) return false;
  const style = window.getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
}

function getAll(root, selectorList) {
  return selectorList.flatMap(selector => Array.from(root.querySelectorAll(selector)));
}

function findClickableByText(targetText, scope = document) {
  const candidates = getAll(scope, ['button', '[role="button"]', 'div', 'span', 'li', 'a']);
  return candidates.find(el => isVisible(el) && exactTextMatch(el.textContent, targetText));
}

function findContainsText(targetText, scope = document) {
  const candidates = getAll(scope, ['*']);
  return candidates.find(el => isVisible(el) && normalizeText(el.textContent).includes(normalizeText(targetText)));
}

function fireInputEvents(el) {
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

async function waitFor(fn, timeout = 15000, interval = 250, label = 'condition') {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const result = await fn();
    if (result) return result;
    await sleep(interval);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function setNativeValue(input, value, delay = 100) {
  input.focus();
  input.click();
  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value');
  descriptor?.set?.call(input, value);
  if (!descriptor?.set) input.value = value;
  fireInputEvents(input);
  await sleep(delay);
}

function getOptionCandidates() {
  // Query dropdown portals first to avoid scanning the entire document DOM tree
  const portals = Array.from(document.querySelectorAll('.ant-select-dropdown, [role="listbox"], [class*="-menu" i], [class*="menu" i], [class*="dropdown" i]')).filter(isVisible);
  const roots = portals.length > 0 ? portals : [document];

  return roots.flatMap(root => getAll(root, [
    '[role="option"]',
    '.ant-select-item-option',
    '.ant-select-item-option-content',
    'li',
    '.select__option',
    '[class*="option"]',
    '[class*="-option"]'
  ])).filter(isVisible);
}

async function pickSearchOption(targetValue) {
  const exactOption = await waitFor(() => {
    const options = getOptionCandidates();
    return options.find(el => exactTextMatch(el.textContent, targetValue));
  }, 15000, 200, `batch option ${targetValue}`);
  (exactOption.closest('[role="option"], .ant-select-item-option, li, div') || exactOption).click();
  await sleep(300);
}

function getCurrentlyOpenBatch() {
  const batchNameEl = document.querySelector('.BatchDetails_root__70WOD span span, [class*="BatchDetails_"] span span');
  if (batchNameEl) {
    return normalizeText(batchNameEl.textContent);
  }
  const container = Array.from(document.querySelectorAll('*')).find(el => {
    const text = normalizeText(el.textContent);
    return text.startsWith('batch name:') && el.querySelector('span');
  });
  if (container) {
    const spans = container.querySelectorAll('span');
    if (spans.length > 0) {
      return normalizeText(spans[spans.length - 1].textContent);
    }
  }
  return null;
}

function getLastModuleRow() {
  const rows = Array.from(document.querySelectorAll('tbody tr, tr[data-rbd-draggable-id], tr[class*="TableBody_"] tr, tbody[class*="TableBody_"] tr')).filter(isVisible);
  return rows[rows.length - 1] || null;
}

function getLastModuleName() {
  const lastRow = getLastModuleRow();
  if (lastRow) {
    const cells = Array.from(lastRow.querySelectorAll('td, div, span, p')).filter(isVisible);
    const nameCell = cells.find(cell => {
      const txt = normalizeText(cell.textContent);
      return txt !== '' && !/^\d+$/.test(txt) && !txt.includes('add module below') && !txt.includes('mock-interview');
    });
    if (nameCell) return nameCell.textContent.trim();
  }
  return null;
}

async function openBatch(batchName) {
  const currentOpen = getCurrentlyOpenBatch();
  if (currentOpen === normalizeText(batchName)) {
    console.log(`[Scaler Automator] Batch "${batchName}" is already open. Skipping search.`);
    return;
  }

  const input = await waitFor(() => {
    // 1. Target React-Select search inputs within search field container
    const reactSelectInputs = getAll(document, [
      '.SuperBatchSelect_container__kEMcI input',
      '[class*="SuperBatchSelect_container"] input',
      '.SelectBatchModulePage_fieldContainer__Rp87Z input',
      '[class*="SelectBatchModulePage_fieldContainer"] input',
      '#react-select-2-input'
    ]).filter(isVisible);
    if (reactSelectInputs.length > 0) return reactSelectInputs[0];

    // 2. Find by Search Batch label
    const labels = Array.from(document.querySelectorAll('label')).filter(isVisible);
    const searchBatchLabel = labels.find(el => normalizeText(el.textContent).includes('search batch'));
    if (searchBatchLabel) {
      const container = searchBatchLabel.closest('div, form')?.parentElement || searchBatchLabel.parentElement;
      if (container) {
        const inp = container.querySelector('input');
        if (inp && isVisible(inp)) return inp;
      }
    }

    // 3. Fallback to hinted logic
    const hinted = getAll(document, [
      'input[placeholder*="Search Batch"]',
      'input[aria-label*="Search Batch"]',
      '.ant-select-selection-search-input',
      'input[type="search"]',
      'input'
    ]);
    return hinted.find(el => isVisible(el) && ((el.placeholder || '').includes('Search Batch') || (el.getAttribute('aria-label') || '').includes('Search Batch')))
      || hinted.find(el => isVisible(el) && el.className && typeof el.className === 'string' && el.className.includes('ant-select-selection-search-input'))
      || hinted.find(el => isVisible(el));
  }, 12000, 250, 'Search Batch input');

  input.click();
  await sleep(50);
  await setNativeValue(input, '', 50);
  await setNativeValue(input, batchName, 100);
  await sleep(50);

  await pickSearchOption(batchName);

  const searchBtn = await waitFor(() => {
    const buttons = getAll(document, [
      'button',
      'a',
      'input[type="button"]',
      'input[type="submit"]',
      '[role="button"]',
      '.ant-btn',
      '[class*="btn"]'
    ]).filter(isVisible);
    return buttons.find(el => exactTextMatch(el.textContent || el.value || el.getAttribute('aria-label'), 'Search'))
      || buttons.find(el => normalizeText(el.textContent || el.value || el.getAttribute('aria-label')).includes('search'));
  }, 15000, 250, 'Search button');
  (searchBtn.closest('a, button, [role="button"]') || searchBtn).click();
  
  // Wait reactively for page loaded
  await waitFor(() => {
    const table = document.querySelector('.Table_root__LaA3f, [class*="Table_root"]');
    const openBatchName = getCurrentlyOpenBatch();
    return table && openBatchName === normalizeText(batchName);
  }, 15000, 250, `batch details load for ${batchName}`);
}

function findModuleRow(moduleName) {
  const rows = Array.from(document.querySelectorAll('tr, tbody tr, [class*="row"], [class*="table-row"], [class*="module"]')).filter(isVisible);
  const exactRow = rows.find(row => {
    const texts = Array.from(row.querySelectorAll('td, div, span, p')).map(el => normalizeText(el.textContent)).filter(Boolean);
    return texts.some(t => t === normalizeText(moduleName));
  });
  if (exactRow) return exactRow;
  const detailCandidates = Array.from(document.querySelectorAll('td, div, span, p')).filter(el => isVisible(el) && exactTextMatch(el.textContent, moduleName));
  for (const el of detailCandidates) {
    const row = el.closest('tr, [class*="row"], [class*="table-row"], [class*="module"]');
    if (row) return row;
  }
  return null;
}

async function confirmYes() {
  const yesButton = await waitFor(() => {
    const modalScopes = [
      document,
      ...getAll(document, ['.modal', '.ant-modal', '.ant-modal-content', '.MuiDialog-root', '[role="dialog"]', '[class*="modal"]'])
    ];
    const candidates = modalScopes.flatMap(scope => getAll(scope, [
      'button',
      'a',
      'input[type="button"]',
      'input[type="submit"]',
      '[role="button"]',
      '.ant-btn',
      '[class*="btn"]',
      'span'
    ])).filter(isVisible);
    return candidates.find(el => /^(yes|confirm|ok|delete)$/i.test((el.textContent || el.value || el.getAttribute('aria-label') || '').trim()))
      || candidates.find(el => {
        const txt = normalizeText(el.textContent || el.value || el.getAttribute('aria-label'));
        return txt === 'yes' || txt.includes('confirm') || txt === 'ok' || txt === 'delete';
      });
  }, 12000, 250, 'Yes confirmation');
  (yesButton.closest('a, button, [role="button"]') || yesButton).click();
  await sleep(200);
}

async function deleteModule(moduleName) {
  const row = findModuleRow(moduleName);
  if (!row) {
    return { skipped: true, reason: `Module not found for deletion: ${moduleName}` };
  }
  const deleteCandidates = getAll(row, [
    'button',
    'a',
    '[role="button"]',
    'svg',
    'i',
    'img',
    '[aria-label*="delete"]',
    '[title*="delete"]',
    '[class*="delete"]',
    '[class*="trash"]',
    '[class*="danger"]'
  ]).filter(isVisible);
  let deleteBtn = deleteCandidates.find(el => {
    const aria = normalizeText(el.getAttribute?.('aria-label'));
    const title = normalizeText(el.getAttribute?.('title'));
    const cls = normalizeText(el.getAttribute?.('class'));
    return aria.includes('delete') || title.includes('delete') || aria.includes('trash') || title.includes('trash') || cls.includes('delete') || cls.includes('trash') || cls.includes('danger');
  });
  if (!deleteBtn) {
    const buttons = getAll(row, ['button', 'a', '[role="button"]']).filter(isVisible);
    deleteBtn = buttons[buttons.length - 1];
  }
  if (!deleteBtn) {
    const icons = getAll(row, ['svg', 'i', 'img']).filter(isVisible);
    deleteBtn = icons[icons.length - 1];
  }
  if (!deleteBtn) {
    return { skipped: true, reason: `Delete control not found for module: ${moduleName}` };
  }
  (deleteBtn.closest('a, button, [role="button"]') || deleteBtn).click();
  await confirmYes();
  
  // Wait reactively for row to disappear
  await waitFor(() => {
    // Check if an error toast appeared on screen (e.g. "Failed to delete" or similar)
    const toast = document.querySelector('.ct-toast, [class*="toast" i]');
    if (toast && isVisible(toast)) {
      const text = toast.textContent.trim();
      if (text && !/success|deleted|removed|completed/i.test(text)) {
        throw new Error(`Page Error: ${text}`);
      }
    }
    return !findModuleRow(moduleName);
  }, 10000, 200, `module ${moduleName} deletion`);
  return { skipped: false };
}

async function openAddBelowAnchor(anchorName) {
  // Find the EXACT row containing anchorName text
  const findExactRow = () => {
    const allRows = Array.from(document.querySelectorAll('tr, [class*="row"], [class*="table-row"]')).filter(isVisible);
    // Prefer row where one of the direct cell texts exactly matches
    return allRows.find(row => {
      const cells = Array.from(row.querySelectorAll('td, div, span, p')).filter(isVisible);
      return cells.some(cell => {
        const t = normalizeText(cell.textContent);
        return t === normalizeText(anchorName) && !t.includes('add module below') && !t.includes('mock-interview');
      });
    });
  };

  let anchorRow = await waitFor(() => findExactRow(), 15000, 300, `anchor row for "${anchorName}"`);
  anchorRow.scrollIntoView({ block: 'center', behavior: 'instant' });
  await sleep(150);

  // Click the Add Module Below button strictly inside this row
  const addBtn = Array.from(anchorRow.querySelectorAll('a, button, [role="button"], .ant-btn, [class*="btn"]'))
    .filter(isVisible)
    .find(el => normalizeText(el.textContent || el.value || el.getAttribute('aria-label')).includes('add module below'));
  if (!addBtn) throw new Error(`Add Module Below button not found in row: ${anchorName}`);
  (addBtn.closest('a, button, [role="button"]') || addBtn).click();
  
  // Wait reactively for the add academy module modal to open
  await waitFor(() => {
    const modal = getActiveModalRoot();
    return modal && modal !== document && modal.querySelector('[role="combobox"], [class*="Select_" i], input');
  }, 10000, 200, 'Add Module modal open');
}

function getActiveModalRoot() {
  // Priority 1: Find the open modal by its specific open-state class.
  // The modal container has "Modal-module_open__JvEJ7" when visible.
  // This is the most precise selector and avoids picking up child field divs
  // (e.g. AddSuperBatchModuleModalField_superbatch) that also contain "Modal" in their class.
  const openModal = Array.from(document.querySelectorAll('[class*="Modal-module_open"]')).find(isVisible);
  if (openModal) return openModal;

  // Priority 2: role="dialog"
  const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).find(isVisible);
  if (dialog) return dialog;

  // Priority 3: fallback — use the FIRST (outermost) visible match, NOT the last.
  // Using last was the original bug: it returned deeply nested child elements.
  const candidates = Array.from(document.querySelectorAll('*')).filter(el => {
    if (!isVisible(el)) return false;
    const cls = String(el.className || '');
    const id  = String(el.id || '');
    return /modal|dialog/i.test(cls) || /modal|dialog/i.test(id);
  });
  return candidates[0] || document;
}

function normalizeLabelKey(t) {
  return normalizeText(String(t || '').replace(/\*/g, '')).trim();
}

function findFieldBlock(labelText) {
  const root = getActiveModalRoot();
  const key = normalizeLabelKey(labelText);

  // Fast path 1: Elective / Mandatory dropdown (uses class name with Scaler's typo)
  if (key.includes('elective') || key.includes('mandatory') || key === 'module to add type') {
    const el = root.querySelector('[class*="BacthModuleTypeSelect_comp"]');
    if (el) return el;
  }

  // Fast path 2: Select Academy Module Type (left dropdown)
  if (key === 'select academy module type' || key === 'module to add') {
    const wrapper = root.querySelector('[class*="AddSuperBatchModuleModalField_wrapper"]');
    if (wrapper) {
      const select = wrapper.querySelector('.Select_root__Gqx23, [class*="Select_root"]');
      if (select) return select;
    }
  }

  // Fast path 3: Select Academy Module (right dropdown)
  if (key === 'select academy module') {
    const wrapper = root.querySelector('[class*="AddSuperBatchModuleModalField_wrapper"]');
    if (wrapper) {
      const selects = Array.from(wrapper.querySelectorAll('.Select_root__Gqx23, [class*="Select_root"]'));
      if (selects.length > 1) return selects[1];
    }
  }

  const nodes = Array.from(root.querySelectorAll('*')).filter(isVisible);

  // 1. Try placeholder/text node match (best for dynamic/unlabeled React-Select components)
  const placeholderNode = nodes.find(el => {
    const text = normalizeText(el.placeholder || el.getAttribute('placeholder') || '');
    if (text.includes(key)) return true;
    if (el.className && String(el.className).includes('placeholder')) {
      return normalizeText(el.textContent).includes(key);
    }
    return false;
  }) || nodes.find(el => {
    const text = normalizeText(el.textContent || '');
    return text.includes(key) && el.children.length === 0;
  });

  if (placeholderNode) {
    const block = placeholderNode.closest('[class*="Select_" i], [class*="-container" i], .ant-select-selector, [class*="field" i], [class*="wrapper" i], .ant-form-item') || placeholderNode.parentElement;
    if (block) return block;
  }

  // 2. Try label node text match
  let labelNode = nodes.find(el => {
    const direct = Array.from(el.childNodes).filter(n => n.nodeType === 3).map(n => normalizeText(n.textContent)).join('').trim();
    return normalizeLabelKey(direct).includes(key) || normalizeLabelKey(el.textContent).includes(key);
  });

  if (labelNode) {
    const candidates = [
      labelNode.closest('[class*="form-item" i]'),
      labelNode.closest('[class*="form" i]'),
      labelNode.closest('[class*="field" i]'),
      labelNode.closest('[class*="wrapper" i]'),
      labelNode.parentElement?.parentElement?.parentElement,
      labelNode.parentElement?.parentElement,
      labelNode.parentElement
    ].filter(Boolean);
    const block = candidates.find(el => el.querySelector && el.querySelector('[role="combobox"], [class*="Select_" i], [class*="-container" i], .ant-select-selector, input, textarea, button, [class*="select" i]')) || candidates[0] || null;
    if (block) return block;
  }

  return null;
}

async function pickDropdownOption(targetValue) {
  const option = await waitFor(() => {
    const allOpts = getOptionCandidates();
    return allOpts.find(el => exactTextMatch(el.textContent, targetValue)) || allOpts.find(el => normalizeText(el.textContent).includes(normalizeText(targetValue)));
  }, 12000, 300, `dropdown option "${targetValue}"`);
  (option.closest('a, button, [role="option"], .ant-select-item, .ant-select-item-option, li, div') || option).click();
  await sleep(600);
}

async function setSelectLikeField(labelText, targetValue) {
  const block = await waitFor(() => findFieldBlock(labelText), 10000, 200, `Field block for: ${labelText}`);

  // If Module To Add is already showing Core/Career, skip
  if (normalizeLabelKey(labelText).includes('module to add') && normalizeText(targetValue) === 'core') {
    const sel = block.querySelector('.ant-select-selection-item, .ant-select-selector, [class*="-singleValue" i], [class*="singleValue" i]');
    if (sel && normalizeText(sel.textContent).includes('core')) return;
  }
  if (normalizeLabelKey(labelText).includes('module to add') && normalizeText(targetValue) === 'career') {
    const sel = block.querySelector('.ant-select-selection-item, .ant-select-selector, [class*="-singleValue" i], [class*="singleValue" i]');
    if (sel && normalizeText(sel.textContent).includes('career')) return;
  }

  const trigger = block.querySelector('.ant-select-selector, [role="combobox"], [class*="-control" i], [class*="control" i]')
    || block.querySelector('input, textarea, button')
    || block.nextElementSibling?.querySelector?.('.ant-select-selector, [role="combobox"], [class*="-control" i], input')
    || block.parentElement?.querySelector?.('.ant-select-selector, [role="combobox"], [class*="-control" i], input')
    || block;
  if (!trigger) throw new Error(`Trigger not found for field: ${labelText}`);

  (trigger.closest('.ant-select, .ant-select-selector, [class*="-control" i], button, [role="combobox"]') || trigger).click();
  await sleep(150);

  // For academy module: type to search. Scope searchInput inside the block container 
  // to avoid typing in the wrong dropdown (e.g., the leftmost Module Type dropdown).
  const searchInput = block.querySelector('input.ant-select-selection-search-input, input[role="combobox"], input')
    || block.querySelector('.ant-select-search input')
    || getActiveModalRoot().querySelector('.ant-select-dropdown input');
  if (searchInput) {
    try { 
      await setNativeValue(searchInput, targetValue, 150); 
    } catch (e) {}
  }

  await pickDropdownOption(targetValue);
}

async function setMockInterview(enabled) {
  // DOM structure (verified from HTML):
  // div.AddSuperBatchModuleModalField_toggle__BxzLf   <-- unique to MI row
  //   span "Mock Interview: "
  //   div.Switch_switch__n+oYF                        <-- gets Switch_checked__dYhFf when ON
  //     input[type="checkbox"]                        <-- CSS-hidden
  //     div.Switch_track__hIdqN                       <-- visible, clickable
  //       div.Switch_thumb__Rdvls

  // Search document directly — DO NOT use getActiveModalRoot() which returns the last element
  // whose class contains "modal" (ends up being a sibling field row, not our container).
  const toggleContainer = await waitFor(() => {
    const byClass = Array.from(document.querySelectorAll('[class*="AddSuperBatchModuleModalField_toggle"]')).find(isVisible);
    if (byClass) return byClass;
    return Array.from(document.querySelectorAll('div')).find(el => {
      const t = normalizeText(el.textContent);
      return (t.includes('mock interview') || t.includes('mock-interview'))
        && el.querySelector('input[type="checkbox"]')
        && isVisible(el);
    });
  }, 10000, 200, 'Mock Interview toggle container');

  const switchDiv  = toggleContainer.querySelector('[class*="Switch_switch"]');
  const checkbox   = toggleContainer.querySelector('input[type="checkbox"]');
  const track      = switchDiv?.querySelector('[class*="Switch_track"]');
  const thumb      = switchDiv?.querySelector('[class*="Switch_thumb"]');

  if (!switchDiv && !checkbox) throw new Error('Mock Interview Switch not found in toggle container');

  function getCheckedState() {
    if (switchDiv) {
      const cls = switchDiv.classList.toString();
      if (cls.includes('checked') || cls.includes('Switch_checked')) return true;
    }
    return checkbox ? checkbox.checked : false;
  }

  if (getCheckedState() === enabled) return; // Already in the right state

  // Try multiple click targets in order, stop as soon as the state flips.
  // Mirrors the proven pattern from scaler-autofill's discussion toggle.
  const clickTargets = [track, switchDiv, checkbox, thumb].filter(Boolean);
  for (const target of clickTargets) {
    triggerClick(target);
    target.click();
    await sleep(250);
    if (getCheckedState() === enabled) return;
  }

  // Final fallback: React native property setter (bypasses controlled input)
  if (checkbox && getCheckedState() !== enabled) {
    setReactCheckbox(checkbox, enabled);
    await sleep(300);
  }
}

async function addModule(addition) {
  // Only toggle MI on if needed — default is off
  if (addition.mi) {
    await setMockInterview(true);
  }

  const modType = addition.moduleType || 'Core';

  // ── Step 1: Select Academy Module Type (Core / Career / Supplementary) ──────
  // The left dropdown under "Module To Add:" has placeholder "Select Academy Module Type"
  try {
    await setSelectLikeField('Select Academy Module Type', modType);
  } catch (e) {
    await setSelectLikeField('Module To Add', modType);
  }

  // ── Step 2: Try to pick the module from the right "Select Academy Module" dropdown ──
  // After selecting the type, the right dropdown appears. We type the name and check
  // if an exact match shows up. If not, we use the "Or create a new academy module" path.
  let moduleFound = false;
  try {
    // Open the right dropdown and type the module name
    const modBlock = await waitFor(() => findFieldBlock('Select Academy Module'), 8000, 200, 'Select Academy Module block');
    const trigger = modBlock.querySelector('.ant-select-selector, [role="combobox"], [class*="-control" i], [class*="control" i]')
      || modBlock.querySelector('input, button')
      || modBlock;
    (trigger.closest('.ant-select, [class*="-control" i], [role="combobox"]') || trigger).click();
    await sleep(200);

    // Type into the search input (scope to modBlock to avoid picking the left dropdown input)
    const searchInput = modBlock.querySelector('input.ant-select-selection-search-input, input[role="combobox"], input');
    if (searchInput) {
      await setNativeValue(searchInput, addition.moduleName);
      await sleep(400);
    }

    // Check if an exact or close match exists in the dropdown options
    const match = await waitFor(() => {
      const opts = getOptionCandidates();
      return opts.find(el => exactTextMatch(el.textContent, addition.moduleName))
        || opts.find(el => normalizeText(el.textContent).includes(normalizeText(addition.moduleName)));
    }, 3000, 200, `module option "${addition.moduleName}"`).catch(() => null);

    if (match) {
      (match.closest('a, button, [role="option"], .ant-select-item, li, div') || match).click();
      await sleep(600);
      moduleFound = true;
    }
  } catch (e) {
    moduleFound = false;
  }

  // ── Step 3: Fallback — "Or create a new academy module (name)" ──────────────
  if (!moduleFound) {
    // The create input: input.AddSuperBatchModuleModalField_createModuleInput__knlap
    // Placeholder: "Or create a new academy module (name)"
    const createInput = await waitFor(() => {
      return document.querySelector('[class*="AddSuperBatchModuleModalField_createModuleInput"]')
        || document.querySelector('input[placeholder*="create a new academy module" i]')
        || document.querySelector('input[placeholder*="Or create" i]');
    }, 8000, 200, '"Or create a new academy module" input');

    await setNativeValue(createInput, addition.moduleName);
    await sleep(300);

    // The Create button is an <a> tag: a.AddSuperBatchModuleModalField_createModuleBtn__tx5K8
    const createBtn = await waitFor(() => {
      return document.querySelector('[class*="AddSuperBatchModuleModalField_createModuleBtn"]')
        || Array.from(document.querySelectorAll('a, button, [role="button"]'))
            .filter(isVisible)
            .find(el => /^create$/i.test((el.textContent || '').trim()));
    }, 5000, 200, '"Create" button');
    triggerClick(createBtn);
    await sleep(800);

    // ── Step 3a: "Add skill certifications" checkbox ──────────────────────────
    // DOM: div.AddSuperBatchModuleModalField_skillCertificationsRow
    //        label.CheckboxInput_root
    //          input.CheckboxInput_input  <-- the actual checkbox (at end of label)
    if (addition.skillCertifications) {
      const scRow = await waitFor(() =>
        document.querySelector('[class*="AddSuperBatchModuleModalField_skillCertificationsRow"]'),
        5000, 200, 'skill certifications row'
      ).catch(() => null);

      if (scRow) {
        const scCheckbox = scRow.querySelector('[class*="CheckboxInput_input"], input[type="checkbox"]');
        if (scCheckbox && !scCheckbox.checked) {
          // Click the label (visually correct), then the checkbox itself, then React fallback
          const scLabel = scRow.querySelector('label');
          if (scLabel) triggerClick(scLabel);
          triggerClick(scCheckbox);
          scCheckbox.click();
          await sleep(350);
          if (!scCheckbox.checked) {
            setReactCheckbox(scCheckbox, true);
            await sleep(250);
          }
        }

        // ── Step 3b: Select skill certification from dropdown (if name provided) ──
        // After checking the checkbox, a dropdown "Search and select skill certifications" appears.
        // DOM: div.AddSuperBatchModuleModalField_skillCertificationsSelect > react-select
        if (addition.skillCertificationName) {
          const scSelect = await waitFor(() =>
            scRow.querySelector('[class*="skillCertificationsSelect"] [role="combobox"], [class*="skillCertificationsSelect"] input'),
            5000, 200, 'skill certifications dropdown'
          ).catch(() => null);

          if (scSelect) {
            scSelect.click();
            await setNativeValue(scSelect, addition.skillCertificationName);
            await sleep(400);
            // Pick the matching option from the dropdown
            const scOption = await waitFor(() => {
              const opts = getOptionCandidates();
              return opts.find(el => exactTextMatch(el.textContent, addition.skillCertificationName))
                || opts.find(el => normalizeText(el.textContent).includes(normalizeText(addition.skillCertificationName)));
            }, 5000, 200, `skill certification option "${addition.skillCertificationName}"`).catch(() => null);
            if (scOption) {
              (scOption.closest('a, button, [role="option"], .ant-select-item, li, div') || scOption).click();
              await sleep(400);
            }
          }
        }
      }
    }
    // "Map to Woolf Module" is intentionally skipped (not required)
  }

  // ── Step 4: Select Module To Add Type (Elective / Mandatory) ────────────────
  try {
    await setSelectLikeField('Module To Add Type', addition.type || 'Mandatory');
  } catch (e) {
    try {
      await setSelectLikeField('Elective/ Mandatory', addition.type || 'Mandatory');
    } catch (err) {
      await setSelectLikeField('Elective/Mandatory', addition.type || 'Mandatory');
    }
  }

  // ── Step 5: Click "Add Module" ───────────────────────────────────────────────
  const addBtn = await waitFor(() => {
    return Array.from(document.querySelectorAll('button, a, [role="button"], .ant-btn, [class*="btn" i]'))
      .filter(isVisible)
      .find(el => exactTextMatch(el.textContent || el.value, 'Add Module')
        || normalizeText(el.textContent || el.value).includes('add module'));
  }, 8000, 200, '"Add Module" button');
  (addBtn.closest('button, a, [role="button"]') || addBtn).click();

  // Wait for the modal to close
  await waitFor(() => {
    // Check if an error toast appeared on screen (e.g., "Module already exists", "Failed to save", etc.)
    const toast = document.querySelector('.ct-toast, [class*="toast" i]');
    if (toast && isVisible(toast)) {
      const text = toast.textContent.trim();
      if (text && !/success|added|completed|done/i.test(text)) {
        throw new Error(`Page Error: ${text}`);
      }
    }

    const modal = getActiveModalRoot();
    return modal === document || !modal.querySelector('[role="combobox"], [class*="Select_" i]');
  }, 10000, 200, 'Add Module modal close');

  // Wait for the new row to appear in the table
  await waitFor(() => findModuleRow(addition.moduleName), 10000, 200, `new module row for ${addition.moduleName}`);
  return addition.moduleName;
}

async function processRow(row) {
  await openBatch(row.batchName);

  if (row.action === 'DELETE') {
    const result = await deleteModule(row.moduleName);
    if (result?.skipped) {
      console.warn(result.reason);
    }
  } else if (row.action === 'ADD') {
    let anchorName = null;
    if (row.placement === 'MIDDLE' && row.previousModule) {
      anchorName = row.previousModule;
    } else {
      anchorName = getLastModuleName();
    }

    if (!anchorName) {
      throw new Error(`Could not determine anchor module for addition: ${row.moduleName}`);
    }

    await openAddBelowAnchor(anchorName);
    await addModule({
      moduleName: row.moduleName,
      moduleType: row.moduleType || 'Core',
      type: row.type,
      mi: row.mi,
      skillCertifications: row.skillCertifications,
      skillCertificationName: row.skillCertificationName
    });
  }

  return { ok: true };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message.type === 'PING') {
      sendResponse({ ok: true, pong: true });
      return;
    }
    if (message.type === 'PROCESS_ROW') {
      const result = await processRow(message.row);
      sendResponse(result);
      return;
    }
    sendResponse({ ok: true });
  })().catch(error => sendResponse({ ok: false, error: error.message }));
  return true;
});

// ── CSV Parsing Helpers (duplicated from popup.js for content context) ───────

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

// ── Draggable Floating Automator Widget ──────────────────────────────────────

let isDraggingWidget = false;
let widgetDragOffset = { x: 0, y: 0 };
let currentSelectedFile = null;

function getStorageData() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['rows', 'runState', 'logs'], resolve);
  });
}

function initFloatingWidget() {
  let widget = document.getElementById('scaler-automator-widget');
  if (!widget) {
    widget = document.createElement('div');
    widget.id = 'scaler-automator-widget';
    widget.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      width: 280px;
      background: rgba(15, 23, 42, 0.92);
      backdrop-filter: blur(14px) saturate(180%);
      -webkit-backdrop-filter: blur(14px) saturate(180%);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 12px;
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
      color: #f8fafc;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      z-index: 999999;
      overflow: hidden;
      transition: opacity 0.3s ease;
      opacity: 1; /* Always visible on match URL */
    `;

    widget.innerHTML = `
      <div id="scaler-widget-header" style="
        padding: 12px 14px;
        background: rgba(255, 255, 255, 0.04);
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        cursor: grab;
        display: flex;
        align-items: center;
        justify-content: space-between;
        user-select: none;
      ">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span id="scaler-widget-status-dot" style="
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background-color: #64748b;
            box-shadow: 0 0 8px #64748b;
            transition: background-color 0.3s ease, box-shadow 0.3s ease;
          "></span>
          <span style="font-size: 11px; font-weight: 700; letter-spacing: 0.05em; color: #94a3b8; text-transform: uppercase;">Scaler Automator</span>
        </div>
        <span style="font-size: 10px; color: #38bdf8; font-weight: 600;">⚡ Dashboard</span>
      </div>

      <div id="scaler-widget-body" style="padding: 14px;">
        <!-- Filled dynamically inside renderFloatingWidget() -->
      </div>
    `;

    document.body.appendChild(widget);

    const header = widget.querySelector('#scaler-widget-header');
    header.addEventListener('mousedown', (e) => {
      isDraggingWidget = true;
      header.style.cursor = 'grabbing';
      
      const rect = widget.getBoundingClientRect();
      widgetDragOffset.x = e.clientX - rect.left;
      widgetDragOffset.y = e.clientY - rect.top;
      
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDraggingWidget) return;
      
      let left = e.clientX - widgetDragOffset.x;
      let top = e.clientY - widgetDragOffset.y;
      
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const widgetWidth = widget.offsetWidth;
      const widgetHeight = widget.offsetHeight;
      
      left = Math.max(10, Math.min(left, viewportWidth - widgetWidth - 10));
      top = Math.max(10, Math.min(top, viewportHeight - widgetHeight - 10));
      
      widget.style.left = `${left}px`;
      widget.style.top = `${top}px`;
      widget.style.right = 'auto';
    });

    document.addEventListener('mouseup', () => {
      if (isDraggingWidget) {
        isDraggingWidget = false;
        header.style.cursor = 'grab';
      }
    });
  }

  return widget;
}

async function renderFloatingWidget() {
  const widget = initFloatingWidget();
  const body = widget.querySelector('#scaler-widget-body');
  const statusDot = widget.querySelector('#scaler-widget-status-dot');

  const data = await getStorageData();
  const rows = data.rows || [];
  const runState = data.runState || {};

  // Case 1: No CSV data is loaded into storage. Render file input load interface
  if (!rows.length) {
    statusDot.style.backgroundColor = '#64748b'; 
    statusDot.style.boxShadow = '0 0 8px #64748b';

    body.innerHTML = `
      <div style="font-size: 12.5px; font-weight: 500; color: #cbd5e1; margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
        <span style="font-size: 15px;">📂</span> Load CSV to start execution
      </div>
      
      <div style="display: flex; flex-direction: column; gap: 10px;">
        <label id="scaler-widget-file-label" style="
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          padding: 10px;
          border: 1px dashed rgba(255, 255, 255, 0.2);
          border-radius: 8px;
          background: rgba(255, 255, 255, 0.02);
          cursor: pointer;
          font-size: 11.5px;
          color: #94a3b8;
          transition: background 0.2s, border-color 0.2s;
        ">
          <span id="scaler-widget-label-text">➕ Choose CSV File</span>
          <input type="file" id="scaler-widget-file-input" accept=".csv" style="display: none;" />
        </label>
        
        <div id="scaler-widget-file-name" style="
          font-size: 11px;
          color: #64748b;
          text-align: center;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          margin-top: -2px;
        ">No file chosen</div>
        
        <button id="scaler-widget-load-btn" disabled style="
          width: 100%;
          padding: 8px 0;
          font-size: 11.5px;
          font-weight: 600;
          border-radius: 6px;
          border: none;
          background: rgba(255, 255, 255, 0.08);
          color: rgba(255, 255, 255, 0.35);
          cursor: not-allowed;
          transition: all 0.2s;
        ">Load CSV</button>
      </div>
    `;

    const fileInput = body.querySelector('#scaler-widget-file-input');
    const label = body.querySelector('#scaler-widget-file-label');
    const loadBtn = body.querySelector('#scaler-widget-load-btn');
    const fileNameDiv = body.querySelector('#scaler-widget-file-name');
    const labelText = body.querySelector('#scaler-widget-label-text');

    // Visual hover styling for custom upload element
    label.addEventListener('mouseenter', () => {
      label.style.background = 'rgba(255, 255, 255, 0.06)';
      label.style.borderColor = 'rgba(255, 255, 255, 0.4)';
    });
    label.addEventListener('mouseleave', () => {
      label.style.background = 'rgba(255, 255, 255, 0.02)';
      label.style.borderColor = 'rgba(255, 255, 255, 0.2)';
    });

    if (currentSelectedFile) {
      fileNameDiv.textContent = currentSelectedFile.name;
      fileNameDiv.style.color = '#38bdf8';
      labelText.textContent = '🔄 Change CSV File';
      loadBtn.disabled = false;
      loadBtn.style.background = 'linear-gradient(135deg, #0ea5e9, #0284c7)';
      loadBtn.style.color = '#ffffff';
      loadBtn.style.cursor = 'pointer';
    }

    fileInput.addEventListener('change', (e) => {
      currentSelectedFile = e.target.files[0];
      if (currentSelectedFile) {
        fileNameDiv.textContent = currentSelectedFile.name;
        fileNameDiv.style.color = '#38bdf8';
        labelText.textContent = '🔄 Change CSV File';
        loadBtn.disabled = false;
        loadBtn.style.background = 'linear-gradient(135deg, #0ea5e9, #0284c7)';
        loadBtn.style.color = '#ffffff';
        loadBtn.style.cursor = 'pointer';
      }
    });

    loadBtn.addEventListener('click', async () => {
      if (!currentSelectedFile) return;
      try {
        loadBtn.textContent = 'Loading...';
        loadBtn.disabled = true;
        const text = await currentSelectedFile.text();
        const parsedRows = parseCsv(text);
        currentSelectedFile = null; // reset reference
        await chrome.storage.local.set({
          rows: parsedRows,
          runState: { status: 'CSV loaded', currentIndex: 0, completed: 0, failed: 0, paused: false, stopped: false },
          logs: [`Loaded ${parsedRows.length} rows from page overlay at ${new Date().toLocaleString()}`]
        });
      } catch (err) {
        alert('Failed to parse CSV: ' + err.message);
        renderFloatingWidget();
      }
    });
    return;
  }

  // Case 2: CSV is loaded. Render active run status dashboard
  const currentIdx = runState.currentIndex || 0;
  const total = rows.length;
  const percent = total > 0 ? Math.round((currentIdx / total) * 100) : 0;

  // Dot color state mapping
  if (runState.paused) {
    statusDot.style.backgroundColor = '#fbbf24'; 
    statusDot.style.boxShadow = '0 0 10px #fbbf24';
  } else if (runState.status && runState.status.startsWith('Processing')) {
    statusDot.style.backgroundColor = '#10b981'; 
    statusDot.style.boxShadow = '0 0 10px #10b981';
  } else {
    statusDot.style.backgroundColor = '#38bdf8'; 
    statusDot.style.boxShadow = '0 0 10px #38bdf8';
  }

  const isStoppedOrDone = runState.stopped || runState.status === 'All rows completed' || runState.status === 'Idle';
  const isPaused = !!runState.paused;

  body.innerHTML = `
    <div id="scaler-widget-status" style="font-size: 13px; font-weight: 600; color: #f1f5f9; margin-bottom: 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${runState.status || 'Active'}">
      ${runState.status || 'Active'}
    </div>

    <div style="font-size: 11px; color: #94a3b8; display: flex; justify-content: space-between; margin-bottom: 6px;">
      <span>Progress: ${currentIdx}/${total}</span>
      <span>${percent}%</span>
    </div>

    <div style="width: 100%; height: 5px; background: rgba(255, 255, 255, 0.1); border-radius: 999px; overflow: hidden; margin-bottom: 14px;">
      <div style="width: ${percent}%; height: 100%; background: linear-gradient(90deg, #38bdf8, #0ea5e9); border-radius: 999px; transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1);"></div>
    </div>

    <div style="display: flex; flex-direction: column; gap: 8px;">
      <div style="display: flex; gap: 8px; justify-content: stretch;">
        ${(!isPaused && !isStoppedOrDone && runState.status !== 'CSV loaded') ? `
          <button id="scaler-widget-action-pause" style="
            flex: 1;
            padding: 8px 0;
            font-size: 11.5px;
            font-weight: 600;
            border-radius: 6px;
            border: none;
            background: rgba(255, 255, 255, 0.08);
            color: #f1f5f9;
            cursor: pointer;
            transition: background 0.2s, transform 0.1s;
          ">Pause</button>
        ` : ''}
        
        ${(isPaused) ? `
          <button id="scaler-widget-action-resume" style="
            flex: 1;
            padding: 8px 0;
            font-size: 11.5px;
            font-weight: 600;
            border-radius: 6px;
            border: none;
            background: linear-gradient(135deg, #0ea5e9, #0284c7);
            color: #ffffff;
            cursor: pointer;
            transition: background 0.2s, transform 0.1s;
          ">Resume</button>
        ` : ''}

        ${(runState.status === 'CSV loaded' || isStoppedOrDone) ? `
          <button id="scaler-widget-action-start" style="
            flex: 1;
            padding: 8px 0;
            font-size: 11.5px;
            font-weight: 600;
            border-radius: 6px;
            border: none;
            background: linear-gradient(135deg, #10b981, #059669);
            color: #ffffff;
            cursor: pointer;
            transition: background 0.2s, transform 0.1s;
          ">Start Run</button>
        ` : ''}
        
        ${(!isStoppedOrDone) ? `
          <button id="scaler-widget-action-stop" style="
            flex: 1;
            padding: 8px 0;
            font-size: 11.5px;
            font-weight: 600;
            border-radius: 6px;
            border: none;
            background: linear-gradient(135deg, #ef4444, #dc2626);
            color: #ffffff;
            cursor: pointer;
            transition: background 0.2s, transform 0.1s;
          ">Stop</button>
        ` : ''}
      </div>

      ${(isStoppedOrDone && currentIdx > 0) ? `
        <button id="scaler-widget-action-report" style="
          width: 100%;
          padding: 8px 0;
          font-size: 11.5px;
          font-weight: 600;
          border-radius: 6px;
          border: none;
          background: linear-gradient(135deg, #a855f7, #9333ea);
          color: #ffffff;
          cursor: pointer;
          transition: background 0.2s, transform 0.1s;
        ">📥 Download Report (.csv)</button>
      ` : ''}
      
      <button id="scaler-widget-action-clear" style="
        width: 100%;
        padding: 7px 0;
        font-size: 11px;
        font-weight: 500;
        border-radius: 6px;
        border: 1px solid rgba(255, 255, 255, 0.1);
        background: transparent;
        color: #94a3b8;
        cursor: pointer;
        transition: all 0.2s;
        margin-top: 2px;
      ">Unload CSV / Reset</button>
    </div>
  `;

  // Attach button action handlers dynamically
  const pauseBtn = body.querySelector('#scaler-widget-action-pause');
  if (pauseBtn) {
    pauseBtn.addEventListener('click', async () => {
      const liveData = await getStorageData();
      const current = liveData.runState || {};
      await chrome.storage.local.set({
        runState: { ...current, status: 'Paused', paused: true }
      });
    });
  }

  const resumeBtn = body.querySelector('#scaler-widget-action-resume');
  if (resumeBtn) {
    resumeBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'RESUME_RUN' });
    });
  }

  const startBtn = body.querySelector('#scaler-widget-action-start');
  if (startBtn) {
    startBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'START_RUN' });
    });
  }

  const stopBtn = body.querySelector('#scaler-widget-action-stop');
  if (stopBtn) {
    stopBtn.addEventListener('click', async () => {
      const liveData = await getStorageData();
      const current = liveData.runState || {};
      await chrome.storage.local.set({
        runState: { ...current, status: 'Stopped', stopped: true, paused: false }
      });
    });
  }

  const reportBtn = body.querySelector('#scaler-widget-action-report');
  if (reportBtn) {
    reportBtn.addEventListener('click', () => {
      triggerDownloadReport(rows);
    });
  }

  const clearBtn = body.querySelector('#scaler-widget-action-clear');
  clearBtn.addEventListener('click', async () => {
    if (confirm('Are you sure you want to unload the CSV and reset execution state?')) {
      await chrome.storage.local.clear();
      renderFloatingWidget();
    }
  });

  // Attach micro-animations to body control buttons
  const controlBtns = body.querySelectorAll('button');
  controlBtns.forEach(btn => {
    btn.addEventListener('mouseenter', () => {
      btn.style.filter = 'brightness(1.1)';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.filter = 'none';
    });
    btn.addEventListener('mousedown', () => {
      btn.style.transform = 'scale(0.95)';
    });
    btn.addEventListener('mouseup', () => {
      btn.style.transform = 'none';
    });
  });
}

// React to local storage changes to keep floating widget visual state synchronized
chrome.storage.onChanged.addListener(renderFloatingWidget);

// Load widget on startup/navigation if run is already active
renderFloatingWidget();

// ── Toast Notification Observer & Logging ────────────────────────────────────

async function logToStorage(message) {
  const data = await getStorageData();
  const logs = data.logs || [];
  logs.push(`[${new Date().toLocaleTimeString()}] ${message}`);
  await chrome.storage.local.set({ logs: logs.slice(-500) });
}

function startToastObserver() {
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const toast = node.classList.contains('ct-toast') ? node : node.querySelector('.ct-toast');
          if (toast) {
            // Read and log the text of any visible toast
            const text = toast.textContent.trim();
            if (text) {
              logToStorage(`[Toast Notification] ${text}`);
            }
          }
        }
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

// Start toast tracking
startToastObserver();

// ── Report CSV Download Helpers ──────────────────────────────────────────────

function escapeCsvValue(val) {
  const str = String(val || '');
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function triggerDownloadReport(rows) {
  const headers = [
    'Row Number',
    'Batch Name',
    'Action',
    'Module Name',
    'Placement',
    'Previous Module',
    'Module Type',
    'Elective/Mandatory',
    'MI',
    'SC',
    'SC Name',
    'Execution Status'
  ];

  const csvLines = [headers.join(',')];
  for (const row of rows) {
    const line = [
      row.rowNumber,
      escapeCsvValue(row.batchName),
      row.action,
      escapeCsvValue(row.moduleName),
      row.placement,
      escapeCsvValue(row.previousModule),
      row.moduleType,
      row.type,
      row.mi ? 'Yes' : 'No',
      row.skillCertifications ? 'Yes' : 'No',
      escapeCsvValue(row.skillCertificationName),
      escapeCsvValue(row.status || 'Pending')
    ];
    csvLines.push(line.join(','));
  }

  const csvText = csvLines.join('\n');
  const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `scaler_module_execution_report_${new Date().toISOString().slice(0,10)}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

