/**
 * app.js — Main application controller.
 * Uses window.NLP (nlp.js) entirely in-browser. No API key required.
 */

/* ─── State ─── */
let slots    = [];
let fileData = {};   // { slotId: { name, content, demo?, type?, status?, textFile? } }
const PDF_WORKER_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

const DEFAULT_SLOTS = [
  { id: 'doc0', label: 'Document 1', title: 'Marksheet / TC',         sub: 'School board certificate or TC', icon: '📋' },
  { id: 'doc1', label: 'Document 2', title: 'Community Certificate',  sub: 'Caste / nativity certificate',   icon: '📜' },
];

/* ─── Init ─── */
(function init() {
  slots = DEFAULT_SLOTS.map(s => ({ ...s }));
  renderSlots();
  document.getElementById('demo-btn').addEventListener('click', loadDemo);
  document.getElementById('add-btn').addEventListener('click', addSlot);
  document.getElementById('analyze-btn').addEventListener('click', runAnalysis);

  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER_SRC;
  }
})();

/* ─── Slot Rendering ─── */
function renderSlots() {
  document.querySelectorAll('.hidden-file-input').forEach(el => el.remove());
  const grid = document.getElementById('slot-grid');
  grid.innerHTML = '';

  slots.forEach(slot => {
    const filled = fileData[slot.id];
    const div = document.createElement('div');
    div.className = 'doc-slot' + (filled ? ' filled' : '');

    if (filled) {
      const statusText = filled.status === 'loading'
        ? 'Loading…'
        : filled.status === 'error'
          ? 'Upload failed'
          : '';
      const downloadBtn = filled.status === 'ready' ? `<button class="download-btn" data-id="${slot.id}" aria-label="Download extracted text">📄 Download .txt</button>` : '';
      const fieldsPreview = filled.fields ? `<div class="fields-preview">
        ${filled.fields.name ? `<div>Name: ${esc(filled.fields.name)}</div>` : ''}
        ${filled.fields.dob ? `<div>DOB: ${esc(filled.fields.dob)}</div>` : ''}
        ${filled.fields.father ? `<div>Father: ${esc(filled.fields.father)}</div>` : ''}
        ${filled.fields.income ? `<div>Income: ${esc(filled.fields.income)}</div>` : ''}
      </div>` : '';
      div.innerHTML = `
        <div class="slot-label">${slot.label}</div>
        <div class="slot-icon">✅</div>
        <div class="slot-title">${slot.title}</div>
        <div class="slot-filename">${esc(filled.name)}</div>
        ${fieldsPreview}
        ${statusText ? `<div class="slot-status">${statusText}</div>` : ''}
        ${downloadBtn}
        <button class="slot-remove" data-id="${slot.id}" aria-label="Remove">✕</button>
      `;
    } else {
      div.innerHTML = `
        <div class="slot-label">${slot.label}</div>
        <div class="slot-icon">${slot.icon}</div>
        <div class="slot-title">${slot.title}</div>
        <div class="slot-sub">${slot.sub}</div>
        <div class="slot-hint">Click to upload — PDF, image, or .txt</div>
      `;
      div.addEventListener('click', () => triggerUpload(slot.id));
    }
    grid.appendChild(div);
    if (filled) {
      const removeButton = div.querySelector('.slot-remove');
      if (removeButton) {
        removeButton.addEventListener('click', e => {
          e.stopPropagation();
          removeFile(slot.id);
        });
      }
      const downloadButton = div.querySelector('.download-btn');
      if (downloadButton) {
        downloadButton.addEventListener('click', e => {
          e.stopPropagation();
          downloadTextFile(slot.id);
        });
      }
    }

    // hidden file input
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.id = 'file-' + slot.id;
    inp.className = 'hidden-file-input';
    inp.style.display = 'none';
    inp.accept = '.pdf,.txt,image/*';
    inp.addEventListener('change', e => handleFile(slot.id, e.target.files[0]));
    document.body.appendChild(inp);
  });

  checkBtn();
}

function addSlot() {
  const idx = slots.length;
  slots.push({ id: 'doc' + idx, label: 'Document ' + (idx + 1), title: 'Additional Document', sub: 'Upload any supporting certificate', icon: '📄' });
  renderSlots();
}

function triggerUpload(id) {
  const el = document.getElementById('file-' + id);
  if (el) el.click();
}

async function readPdfFile(file) {
  if (!window.pdfjsLib) throw new Error('PDF.js is not loaded');
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let text = '';

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map(item => item.str).join(' ').trim();
    if (pageText) {
      text += pageText + '\n\n';
      continue;
    }

    if (window.Tesseract && typeof document !== 'undefined') {
      try {
        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: context, viewport }).promise;
        const result = await Tesseract.recognize(canvas, 'eng');
        const ocrText = result.data?.text?.trim();
        if (ocrText) {
          text += ocrText + '\n\n';
          continue;
        }
      } catch (ocrErr) {
        console.warn('PDF OCR fallback failed:', ocrErr);
      }
    }

    text += `Document: ${file.name} (page ${i})\n[No text found on this PDF page.]\n\n`;
  }

  text = text.trim();
  return text || `Document: ${file.name}\n[PDF loaded but no text could be extracted.]`;
}

async function readImageFile(file) {
  if (!window.Tesseract) {
    return `Document: ${file.name}\n[Image upload detected. OCR support is unavailable in this browser session.]`;
  }
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  const result = await Tesseract.recognize(dataUrl, 'eng');
  const text = result.data?.text?.trim();
  return text || `Document: ${file.name}\n[Image uploaded, but OCR returned no text.]`;
}

async function handleFile(id, file) {
  if (!file) return;
  const slot = slots.find(s => s.id === id) || {};
  fileData[id] = { name: file.name, content: '', status: 'loading' };
  renderSlots();

  try {
    let content = '';
    if (file.type === 'text/plain' || file.name.toLowerCase().endsWith('.txt')) {
      content = await file.text();
    } else if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
      content = await readPdfFile(file);
    } else if (file.type.startsWith('image/') || /\.(jpe?g|png|bmp|gif|webp)$/i.test(file.name)) {
      content = await readImageFile(file);
    } else {
      content = `Document: ${file.name}\n[Unsupported file type. Please upload a .txt, .pdf, or image file.]`;
    }

    fileData[id] = { name: file.name, content, type: file.type || 'unknown', status: 'ready', textFile: new File([content], file.name.replace(/\.[^.]+$/, '.txt'), { type: 'text/plain' }), fields: window.NLP.extractAllFields(content) };
  } catch (err) {
    fileData[id] = {
      name: file.name,
      content: `Document: ${file.name}\n[Error loading file: ${err.message}]`,
      type: file.type || 'unknown',
      status: 'error'
    };
  }

  renderSlots();
}

function downloadTextFile(id) {
  const data = fileData[id];
  if (!data || !data.textFile) return;
  const url = URL.createObjectURL(data.textFile);
  const a = document.createElement('a');
  a.href = url;
  a.download = data.textFile.name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function removeFile(id) {
  delete fileData[id];
  renderSlots();
  checkAutoAnalyze();
}

function checkBtn() {
  const readyFiles = Object.values(fileData).filter(item => item.status === 'ready').length;
  document.getElementById('analyze-btn').disabled = readyFiles < 2;
}

function checkAutoAnalyze() {
  const readyFiles = Object.values(fileData).filter(item => item.status === 'ready');
  if (readyFiles.length >= 2) {
    runAnalysis();
  }
}

/* ─── Demo ─── */
function loadDemo() {
  fileData = {};
  slots = window.DEMO_SLOT_TYPES.map(s => ({ ...s }));
  Object.entries(window.DEMO_DOCS).forEach(([key, val]) => {
    const textFile = new File([val.content], val.name.replace(/\.[^.]+$/, '.txt'), { type: 'text/plain' });
    const fields = window.NLP.extractAllFields(val.content);
    fileData[key] = { name: val.name, content: val.content, demo: true, status: 'ready', textFile, fields };
  });
  renderSlots();
}

/* ─── Analysis ─── */
function runAnalysis() {
  const keys = Object.keys(fileData).filter(k => fileData[k].status === 'ready');
  if (keys.length < 2) return;

  document.getElementById('upload-section').style.display = 'none';
  const res = document.getElementById('results-section');
  res.style.display = 'block';

  // Animated loading
  const loadingSteps = [
    'Extracting named entities…',
    'Running Levenshtein distance matching…',
    'Comparing date of birth fields…',
    'Checking income plausibility…',
    'Running age-grade consistency check…',
    'Scanning for date anomalies…',
    'Computing semantic similarity scores…',
    'Assembling consistency report…',
  ];
  let stepIdx = 0;
  let progress = 0;

  res.innerHTML = `
    <div class="loading-wrap">
      <div class="loading-spinner"></div>
      <h2>Analysing documents…</h2>
      <p>Running NLP consistency checks in your browser — no data leaves your device.</p>
      <div class="loading-step" id="loading-step">${loadingSteps[0]}</div>
      <div class="progress-bar-wrap"><div class="progress-bar" id="prog-bar" style="width:5%"></div></div>
    </div>`;

  const stepTimer = setInterval(() => {
    stepIdx = (stepIdx + 1) % loadingSteps.length;
    progress = Math.min(90, progress + 12);
    const el = document.getElementById('loading-step');
    const pb = document.getElementById('prog-bar');
    if (el) el.textContent = loadingSteps[stepIdx];
    if (pb) pb.style.width = progress + '%';
  }, 300);

  // Run analysis in next tick so loading renders first
  setTimeout(async () => {
    clearInterval(stepTimer);
    const pb = document.getElementById('prog-bar');
    if (pb) pb.style.width = '100%';

    try {
      const documents = [];
      for (const k of keys) {
        const d = fileData[k];
        const slot = slots.find(s => s.id === k) || { title: 'Document' };
        // Read content from the text file
        const content = await d.textFile.text();
        const fields = window.NLP.extractAllFields(content);
        documents.push({ title: slot.title, content, fields });
      }

      const result = window.NLP.analyzeDocuments(documents);
      setTimeout(() => renderResults(result), 200);
    } catch (err) {
      res.innerHTML = `
        <div class="error-card">
          <strong>Analysis failed</strong>
          <p>An unexpected error occurred during NLP processing.</p>
          <p style="margin-top:6px;font-family:monospace;font-size:11px;opacity:0.7">${esc(err.message)}</p>
        </div>
        <button class="analyze-btn mt-1" onclick="resetApp()">← Try again</button>`;
    }
  }, loadingSteps.length * 310 + 200);
}

/* ─── Results ─── */
function renderResults(data) {
  const res = document.getElementById('results-section');
  const s   = data.summary || {};

  const verdictClass = s.verdict === 'PASS' ? 'verdict-pass'
                     : s.verdict === 'NEEDS_REVIEW' ? 'verdict-review'
                     : 'verdict-fail';
  const verdictIcon  = s.verdict === 'PASS' ? '✅' : s.verdict === 'NEEDS_REVIEW' ? '⚠️' : '🚫';
  const verdictTitle = s.verdict === 'PASS' ? 'Documents are consistent'
                     : s.verdict === 'NEEDS_REVIEW' ? 'Manual review required'
                     : 'Documents rejected — critical issues found';

  let html = `
    <div class="results-top">
      <div><span class="badge">Analysis Complete · Local NLP</span><h2>Consistency Report</h2></div>
      <button class="back-btn" onclick="resetApp()">← New Analysis</button>
    </div>

    <div class="verdict-banner ${verdictClass}">
      <span class="verdict-icon">${verdictIcon}</span>
      <div>
        <div class="verdict-label">${(s.verdict || '').replace('_', ' ')}</div>
        <div class="verdict-title">${verdictTitle}</div>
        <div class="verdict-reason">${esc(s.verdict_reason || '')}</div>
      </div>
    </div>

    <div class="summary-grid">
      <div class="summary-card"><div class="summary-num num-critical">${s.critical_count || 0}</div><div class="summary-label">Critical flags</div></div>
      <div class="summary-card"><div class="summary-num num-warning">${s.warning_count || 0}</div><div class="summary-label">Warnings</div></div>
      <div class="summary-card"><div class="summary-num num-ok">${s.ok_count || 0}</div><div class="summary-label">Checks passed</div></div>
      <div class="summary-card"><div class="summary-num num-info">${s.info_count || 0}</div><div class="summary-label">Info notes</div></div>
    </div>

    <div class="tabs">
      <button class="tab active" onclick="switchTab('flags',this)">Flags &amp; Findings</button>
      <button class="tab"        onclick="switchTab('compare',this)">Field Comparison</button>
      <button class="tab"        onclick="switchTab('extract',this)">Extracted Data</button>
    </div>`;

  /* Flags */
  html += `<div id="tab-flags">`;
  const flags = data.flags || [];
  html += `<div class="findings-header">Findings (${flags.length})</div>`;
  if (flags.length) {
    flags.forEach((f, i) => {
      html += `
        <div class="finding-card">
          <div class="finding-header" onclick="toggleFinding(${i})">
            <span class="sev-dot sev-${f.severity}"></span>
            <span class="finding-title">${esc(f.title)}</span>
            <span class="sev-badge badge-${f.severity}">${esc(f.severity)}</span>
            <span class="finding-chevron" id="chev-${i}">▾</span>
          </div>
          <div class="finding-body" id="fb-${i}">
            <p><span class="cat-label">${esc(f.category)}</span><br/><br/>${esc(f.description)}</p>
          </div>
        </div>`;
    });
  } else {
    html += `<p style="color:var(--text2);font-size:0.9rem;padding:0.75rem 0">No flags detected.</p>`;
  }
  html += `</div>`;

  /* Compare */
  html += `<div id="tab-compare" style="display:none">`;
  const comps = data.field_comparisons || [];
  if (comps.length) {
    html += `<div class="findings-header">Field-by-field comparison</div>
      <div class="compare-wrap"><table class="compare-table">
        <thead><tr><th>Field</th><th>Doc A</th><th>Doc B</th><th>Match</th><th>Score</th></tr></thead><tbody>`;
    comps.forEach(fc => {
      const vals  = Object.values(fc.values || {});
      const v1 = esc(vals[0] || '—'), v2 = esc(vals[1] || '—');
      const pct = typeof fc.similarity_score === 'number' ? Math.round(fc.similarity_score * 100) : null;
      const pillClass = pct === null ? '' : pct >= 90 ? 'score-high' : pct >= 70 ? 'score-medium' : 'score-low';
      const scoreTxt  = pct !== null ? `<span class="score-pill ${pillClass}">${pct}%</span>` : '—';
      html += `<tr>
        <td class="field-name-col">${esc(fc.field)}</td>
        <td>${v1}</td><td>${v2}</td>
        <td class="${fc.match ? 'match-cell' : 'mismatch-cell'}">${fc.match ? '✓ Match' : '✗ Diff'}</td>
        <td>${scoreTxt}</td>
      </tr>`;
    });
    html += `</tbody></table></div>`;
  } else {
    html += `<p style="color:var(--text2);font-size:0.9rem;padding:0.75rem 0">Insufficient fields found for comparison. Try using .txt files with clearly labelled fields.</p>`;
  }
  html += `</div>`;

  /* Extract */
  html += `<div id="tab-extract" style="display:none">`;
  const REQUIRED_FIELDS = ['name', 'dob', 'father', 'mother', 'income', 'address', 'caste', 'school', 'standard', 'yearPassing', 'certDate'];
  if (data.extracted_fields) {
    Object.entries(data.extracted_fields).forEach(([docName, fields]) => {
      const display = {};
      Object.entries(fields).forEach(([k, v]) => {
        if (!k.startsWith('_') && REQUIRED_FIELDS.includes(k)) display[k] = v;
      });
      html += `<div class="extract-card">
        <div class="extract-card-title">${esc(docName)}</div>
        <div class="raw-data">${esc(JSON.stringify(display, null, 2))}</div>
      </div>`;
    });
  }
  html += `</div>`;

  res.innerHTML = html;
}

/* ─── UI Helpers ─── */
function toggleFinding(i) {
  const body = document.getElementById('fb-' + i);
  const chev = document.getElementById('chev-' + i);
  if (!body) return;
  const open = body.classList.toggle('open');
  if (chev) chev.classList.toggle('open', open);
}

function switchTab(name, el) {
  ['flags','compare','extract'].forEach(t => {
    const tab = document.getElementById('tab-' + t);
    if (tab) tab.style.display = t === name ? 'block' : 'none';
  });
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  if (el) el.classList.add('active');
}

function resetApp() {
  fileData = {};
  slots    = DEFAULT_SLOTS.map(s => ({ ...s }));
  document.getElementById('results-section').style.display = 'none';
  document.getElementById('upload-section').style.display  = 'block';
  renderSlots();
}

function esc(str) {
  return String(str || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}
