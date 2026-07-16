# Scaler Module Batch Automator

> **Internal Chrome extension** for automating sequential batch module operations (add / delete) on the Scaler SCM portal, driven entirely by a CSV file.

---

## Table of Contents

1. [Overview](#overview)
2. [How It Works](#how-it-works)
3. [Installation](#installation)
4. [CSV Format](#csv-format)
5. [Using the Extension](#using-the-extension)
6. [Controls Reference](#controls-reference)
7. [Safe Rollout Checklist](#safe-rollout-checklist)
8. [Architecture](#architecture)
9. [Troubleshooting](#troubleshooting)

---

## Overview

The **Scaler Module Batch Automator** removes the manual effort of editing modules across many batches in the Scaler SCM portal. You prepare a CSV once, load it into the extension, then let it drive the browser — searching each batch, deleting specified modules, adding new ones with exact placement/type/toggle settings, and logging every action.

| Feature | Detail |
|---|---|
| MV3 Manifest | Chrome Manifest V3 service-worker |
| Host restriction | `https://www.scaler.com/scm/module-management/batch*` |
| Version | 1.2.0 |

---

## How It Works

```
CSV upload → popup parses rows → background.js processes sequentially
                                         │
                                         ▼
                              content.js (injected into SCM page)
                                         │
                    ┌────────────────────┴──────────────────────┐
                    │                                           │
              DELETE flow                                 ADD flow
         Search batch → find module                  Search batch → open "Add module"
         → click delete → confirm                    → type module name → set type
                                                     → set placement → toggle MI / SC
                                                     → save
```

Each row in the CSV maps to one **ADD** or **DELETE** action on a specific batch. The background worker processes rows one at a time with a 3-second pause between rows for visual verification. Failed rows are logged and skipped — processing continues automatically.

---

## Installation

1. Clone or download this repository to your local machine.
2. Open Chrome and navigate to `chrome://extensions`.
3. Toggle **Developer mode** on (top-right corner).
4. Click **Load unpacked**.
5. Select the folder containing `manifest.json` (this repo root).
6. The **Scaler Module Automator** icon will appear in your toolbar.

> **Tip:** Pin the extension icon for quick access — right-click it in the extensions overflow menu and choose "Pin".

---

## CSV Format

The extension accepts a **UTF-8 CSV** (comma-separated, with a header row).

### Required Columns

| Column | Description |
|---|---|
| `Batch_name` | Exact name of the batch as it appears in SCM search |
| `Action` | `ADD` or `DELETE` (optional — inferred from other columns if blank) |
| `Module to add 1` | Module name to add (use for ADD rows) |
| `Mod to delete 1` | Module name to delete (use for DELETE rows) |

### Optional ADD Columns

| Column | Accepted values | Default |
|---|---|---|
| `Placement` | `END`, `MIDDLE` | `END` |
| `Prev_module` / `prev. module name` | Name of the module to insert **after** | — |
| `Module_type` / `Type` | `Core`, `Career`, `Supplementary` (prefix matched) | `Core` |
| `Elective/Mandatory` | `Elective`, `Mandatory` (prefix matched: `ele`/`man`) | — |
| `MI` | `yes` / `true` / `1` → toggles Mock Interview on | `false` |
| `Skill Certifications` / `SC` | `yes` / `true` / `1` → enables Skill Certification | `false` |
| `Skill Certification Name` / `SC Name` | Name of the skill cert to select | — |

### Sample CSV Structure

```csv
Batch_name,Action,Module to add 1,Mod to delete 1,Placement,Prev_module,Module_type,Elective/Mandatory,MI,SC
"Academy Batch 50",DELETE,,Intro to Python,,,,,
"Academy Batch 50",ADD,Advanced Python,,MIDDLE,"Intro to Python",Core,Mandatory,yes,no
"Academy Batch 51",ADD,System Design Fundamentals,,END,,Core,Elective,no,no
```

> **Note:** Column names are flexible — the extension tries several aliases (e.g. `Batch`, `batch_name`, `module_name`). Stick to the examples above for reliability.

---

## Using the Extension

### Step-by-step

1. **Open the SCM batch page**  
   Navigate to `https://www.scaler.com/scm/module-management/batch` and make sure the page is fully loaded.

2. **Open the popup**  
   Click the **Scaler Module Automator** icon in the Chrome toolbar.

3. **Load your CSV**  
   - Click **Choose File** and select your `.csv` file.  
   - Click **Load CSV**.  
   - The extension will parse the file and show a preview of the first 8 rows with colour-coded action chips (green = ADD, red = DELETE).  
   - The status panel will show total rows loaded.

4. **Dry-run a single row**  
   - Click **Run next** to process only the first queued row.  
   - Watch the SCM page — the extension will search the batch, perform the action, and report back.  
   - Check the **Log** panel in the popup for success or error details.

5. **Proceed to full run**  
   - Once satisfied the dry-run worked correctly, click **Run all**.  
   - The background worker takes over — you can **close the popup** without interrupting the run.  
   - Re-open the popup at any time to monitor progress.

6. **Verify results**  
   - After completion the status will read `All rows completed`.  
   - Inspect the Log panel for any `Failed` entries and re-run those batches manually if needed.

---

## Controls Reference

| Button | What it does |
|---|---|
| **Load CSV** | Parses the selected file and stores rows in extension storage |
| **Run all** | Starts sequential processing from the current index |
| **Run next** | Processes exactly one row, then stops |
| **Pause** | Signals the background loop to pause after the current row finishes |
| **Resume** | Continues from the paused row |
| **Stop** | Hard-stops the run after the current row |
| **Reset state** | Clears all stored rows, state, and logs — use to start fresh |

---


## Architecture

```
scaler-module-extension/
├── manifest.json          ← MV3 extension manifest
├── popup.html             ← Extension popup UI shell
├── popup.css              ← Popup styles
├── popup.js               ← CSV parsing, UI rendering, button handlers
├── background.js          ← Service worker: sequential row orchestration
├── content.js             ← Injected into SCM page: DOM automation logic
├── images/                ← UI reference screenshots
└── VERSION.txt            ← Legacy manifest snapshot
```

### Message flow

| Sender | Receiver | Message type | Purpose |
|---|---|---|---|
| popup.js | background.js | `START_RUN` / `RESUME_RUN` | Begin or resume the sequential loop |
| popup.js | background.js | `PROCESS_NEXT` | Process a single row |
| background.js | content.js | `PROCESS_ROW` | Perform DOM actions for one CSV row |
| content.js | background.js | `PING` | Health-check used by ensureContentScript |

---


*Internal tool — Scaler Academy engineering workflows.*
