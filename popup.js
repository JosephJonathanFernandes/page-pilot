'use strict';

const $ = (id) => document.getElementById(id);

const state = {
  settings: {
    apiKey: '',
    model: 'gemini-2.5-flash',
    style: 'concise',
    voiceEnabled: true,
    voiceName: '',
    rate: 1.0,
    pitch: 1.0,
    maxElements: 80,
    highlightDuration: 2500
  },
  elements: [],
  page: null,
  summary: '',
  activeType: 'All',
  search: '',
  history: []
};

const STYLE_INSTRUCTIONS = {
  concise: 'Keep it under 60 words and easy to speak aloud.',
  detailed: 'Provide a thorough but readable overview under 130 words.',
  bullets: 'Use short bullet lines, each starting with "- ". Keep total under 90 words.'
};

// ---------- Storage ----------
function storageGet(keys) {
  return new Promise((resolve) => {
    try { chrome.storage.local.get(keys, (r) => resolve(r || {})); }
    catch (e) { resolve({}); }
  });
}
function storageSet(obj) {
  return new Promise((resolve) => {
    try { chrome.storage.local.set(obj, () => resolve()); }
    catch (e) { resolve(); }
  });
}

async function loadSettings() {
  const data = await storageGet(['pp_settings', 'pp_history']);
  if (data.pp_settings) Object.assign(state.settings, data.pp_settings);
  const validModels = ['gemini-2.5-flash','gemini-2.5-flash-lite','gemini-2.5-pro','gemini-3.8-flash','gemini-3.5-flash','gemini-flash-latest'];
  if (!validModels.includes(state.settings.model)) state.settings.model = 'gemini-2.5-flash';
  if (Array.isArray(data.pp_history)) state.history = data.pp_history;

  // .env fallback / migration
  if (!state.settings.apiKey) {
    try {
      const res = await fetch('.env');
      const text = await res.text();
      const m = text.match(/GEMINI_API_KEY=(.*)/);
      if (m && m[1].trim()) {
        state.settings.apiKey = m[1].trim();
        await storageSet({ pp_settings: state.settings });
      }
    } catch (e) { /* ignore */ }
  }
}

async function saveSettings() {
  await storageSet({ pp_settings: state.settings });
}

// ---------- Init ----------
document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  bindUI();
  populateVoices();
  syncSettingsUI();
  updateApiKeyBanner();
  renderHistory();
});

function bindUI() {
  $('scanPage').addEventListener('click', scan);
  $('voiceToggle').addEventListener('change', (e) => {
    state.settings.voiceEnabled = e.target.checked;
    saveSettings();
  });
  $('voiceToggle').checked = state.settings.voiceEnabled;

  $('settingsBtn').addEventListener('click', () => togglePanel('settings'));
  $('closeSettings').addEventListener('click', () => togglePanel('settings', false));
  $('historyBtn').addEventListener('click', () => togglePanel('history'));
  $('closeHistory').addEventListener('click', () => togglePanel('history', false));

  $('openSettingsLink').addEventListener('click', () => togglePanel('settings', true));

  $('apiKeyInput').addEventListener('input', (e) => { state.settings.apiKey = e.target.value.trim(); updateApiKeyBanner(); });
  $('saveKeyBtn').addEventListener('click', async () => {
    state.settings.apiKey = $('apiKeyInput').value.trim();
    await saveSettings();
    updateApiKeyBanner();
    setStatus('API key saved.');
  });
  $('testKeyBtn').addEventListener('click', testApiKey);
  $('clearKeyBtn').addEventListener('click', async () => {
    state.settings.apiKey = '';
    $('apiKeyInput').value = '';
    await saveSettings();
    updateApiKeyBanner();
    setStatus('API key cleared.');
  });
  $('toggleKeyVisibility').addEventListener('click', () => {
    const inp = $('apiKeyInput');
    if (inp.type === 'password') { inp.type = 'text'; $('toggleKeyVisibility').textContent = 'Hide'; }
    else { inp.type = 'password'; $('toggleKeyVisibility').textContent = 'Show'; }
  });

  $('modelSelect').addEventListener('change', (e) => { state.settings.model = e.target.value; saveSettings(); });
  $('styleSelect').addEventListener('change', (e) => { state.settings.style = e.target.value; saveSettings(); });
  $('voiceSelect').addEventListener('change', (e) => { state.settings.voiceName = e.target.value; saveSettings(); });
  $('rateRange').addEventListener('input', (e) => {
    state.settings.rate = parseFloat(e.target.value);
    $('rateValue').textContent = state.settings.rate.toFixed(1);
    saveSettings();
  });
  $('maxElementsInput').addEventListener('change', (e) => {
    const v = Math.max(10, Math.min(200, parseInt(e.target.value, 10) || 80));
    state.settings.maxElements = v;
    e.target.value = v;
    saveSettings();
  });
  $('highlightDurationInput').addEventListener('change', (e) => {
    const v = Math.max(500, Math.min(10000, parseInt(e.target.value, 10) || 2500));
    state.settings.highlightDuration = v;
    e.target.value = v;
    saveSettings();
  });

  $('copySummaryBtn').addEventListener('click', () => copyText(state.summary));
  $('speakSummaryBtn').addEventListener('click', () => { if (state.summary) readAloud(state.summary); });

  $('filterInput').addEventListener('input', (e) => { state.search = e.target.value.trim().toLowerCase(); renderElements(); });
  $('exportBtn').addEventListener('click', exportJson);
  $('clearBtn').addEventListener('click', clearResults);

  $('clearHistoryBtn').addEventListener('click', async () => {
    state.history = [];
    await storageSet({ pp_history: [] });
    renderHistory();
  });

  if (window.speechSynthesis) {
    window.speechSynthesis.onvoiceschanged = populateVoices;
  }
}

function syncSettingsUI() {
  $('apiKeyInput').value = state.settings.apiKey || '';
  $('modelSelect').value = state.settings.model;
  $('styleSelect').value = state.settings.style;
  $('rateRange').value = state.settings.rate;
  $('rateValue').textContent = Number(state.settings.rate).toFixed(1);
  $('maxElementsInput').value = state.settings.maxElements;
  $('highlightDurationInput').value = state.settings.highlightDuration;
  populateVoices();
}

function populateVoices() {
  if (!window.speechSynthesis) return;
  const voices = window.speechSynthesis.getVoices();
  const sel = $('voiceSelect');
  const prev = state.settings.voiceName;
  sel.innerHTML = '';
  const defaultOpt = document.createElement('option');
  defaultOpt.value = '';
  defaultOpt.textContent = 'System default';
  sel.appendChild(defaultOpt);
  voices.forEach(v => {
    const o = document.createElement('option');
    o.value = v.name;
    o.textContent = `${v.name} (${v.lang})`;
    sel.appendChild(o);
  });
  if (prev && voices.some(v => v.name === prev)) sel.value = prev;
  else sel.value = '';
}

function togglePanel(name, force) {
  const settings = $('settingsPanel');
  const history = $('historyPanel');
  const showSettings = name === 'settings' ? (force !== undefined ? force : settings.style.display === 'none') : false;
  const showHistory = name === 'history' ? (force !== undefined ? force : history.style.display === 'none') : false;

  if (name === 'settings') {
    settings.style.display = showSettings ? 'flex' : 'none';
    if (showSettings) history.style.display = 'none';
  } else if (name === 'history') {
    history.style.display = showHistory ? 'flex' : 'none';
    if (showHistory) settings.style.display = 'none';
  }
}

function updateApiKeyBanner() {
  const banner = $('apiKeyBanner');
  banner.style.display = state.settings.apiKey ? 'none' : 'flex';
}

function setStatus(msg) {
  $('status').textContent = msg;
}

// ---------- Scan ----------
async function getCurrentTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve(tabs && tabs[0]));
  });
}

async function scan() {
  const btn = $('scanPage');
  btn.disabled = true;
  btn.style.opacity = '0.8';
  setStatus('Scanning active tab…');

  const tab = await getCurrentTab();
  if (!tab || !tab.id) { finishScanError('No active tab.'); return; }

  chrome.tabs.sendMessage(tab.id, { action: 'scan' }, async (response) => {
    btn.disabled = false;
    btn.style.opacity = '1';

    if (chrome.runtime.lastError) {
      setStatus('Cannot scan this page. Try refreshing.');
      return;
    }
    if (!response || response.error) {
      setStatus('Scan failed: ' + (response && response.error ? response.error : 'unknown error'));
      return;
    }

    let elements = response.elements || [];
    const max = state.settings.maxElements || 80;
    if (elements.length > max) elements = elements.slice(0, max);

    state.elements = elements;
    state.page = response.page || null;
    state.activeType = 'All';
    state.search = '';
    $('filterInput').value = '';
    $('badge').textContent = elements.length;

    if (elements.length === 0) {
      setStatus('No interactive elements found.');
      $('actionsList').innerHTML = '<li class="empty-state">No elements found.</li>';
      if (state.settings.voiceEnabled) readAloud('No interactive elements found on this page.');
      return;
    }

    renderChips();
    renderElements();
    $('summaryContainer').style.display = 'none';

    // Summary
    setStatus('Generating summary…');
    try {
      const summary = await generateSummary(elements, state.page);
      state.summary = summary;
      $('summaryText').textContent = summary;
      $('summaryContainer').style.display = 'block';
      setStatus('Scan complete.');
      if (state.settings.voiceEnabled) readAloud(summary);
      saveHistoryEntry(tab, summary, elements.length);
    } catch (err) {
      const fallback = localSummary(state.page, elements);
      state.summary = fallback;
      $('summaryText').textContent = fallback;
      $('summaryContainer').style.display = 'block';
      setStatus('AI error: ' + (err && err.message ? err.message : err) + ' (showing local summary)');
      if (state.settings.voiceEnabled) readAloud(fallback);
      saveHistoryEntry(tab, fallback, elements.length);
    }
  });
}

function finishScanError(msg) {
  const btn = $('scanPage');
  btn.disabled = false;
  btn.style.opacity = '1';
  setStatus(msg);
}

// ---------- Rendering ----------
function getTypes() {
  const types = new Set(state.elements.map(e => e.type));
  return ['All', ...Array.from(types).sort()];
}

function renderChips() {
  const row = $('chipRow');
  row.innerHTML = '';
  getTypes().forEach(t => {
    const chip = document.createElement('span');
    chip.className = 'chip' + (t === state.activeType ? ' active' : '');
    const count = t === 'All' ? state.elements.length : state.elements.filter(e => e.type === t).length;
    chip.textContent = `${t} (${count})`;
    chip.addEventListener('click', () => { state.activeType = t; renderChips(); renderElements(); });
    row.appendChild(chip);
  });
}

function renderElements() {
  const list = $('actionsList');
  list.innerHTML = '';
  const filtered = state.elements.filter(e => {
    if (state.activeType !== 'All' && e.type !== state.activeType) return false;
    if (state.search) {
      const hay = (e.text + ' ' + e.type).toLowerCase();
      if (!hay.includes(state.search)) return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    list.innerHTML = '<li class="empty-state">No matching elements.</li>';
    return;
  }

  filtered.forEach((item) => {
    const li = document.createElement('li');
    li.className = 'action-item' + (item.disabled ? ' disabled' : '');
    li.title = 'Click to highlight on page';

    const row = document.createElement('div');
    row.className = 'item-row';

    const typeSpan = document.createElement('span');
    typeSpan.className = `item-type type-${item.type}`;
    typeSpan.textContent = item.type;

    const textSpan = document.createElement('span');
    textSpan.className = 'item-text';
    textSpan.textContent = item.text;

    row.appendChild(typeSpan);
    row.appendChild(textSpan);
    li.appendChild(row);

    if (item.href) {
      const hint = document.createElement('div');
      hint.className = 'item-hint';
      try { hint.textContent = new URL(item.href).hostname; } catch (e) { hint.textContent = item.href; }
      li.appendChild(hint);
    }

    li.addEventListener('click', () => highlightOnPage(item));
    list.appendChild(li);
  });
}

async function highlightOnPage(item) {
  const tab = await getCurrentTab();
  if (!tab || !tab.id) return;
  chrome.tabs.sendMessage(tab.id, {
    action: 'highlight',
    selector: item.selector,
    text: item.text,
    duration: state.settings.highlightDuration
  }, (res) => {
    if (chrome.runtime.lastError) return;
    if (res && res.ok === false) setStatus('Could not locate element on page.');
  });
}

// ---------- Summary generation ----------
async function generateSummary(elements, page) {
  const key = state.settings.apiKey;
  if (!key) throw new Error('No API key configured');

  const elementStrings = elements.map(el => `[${el.type}] ${el.text}`).join('\n');
  const headings = (page && page.headings && page.headings.length) ? page.headings.join(' | ') : 'none';
  const prompt = `You are an accessibility assistant helping a user who cannot see the screen.
Page title: "${(page && page.title) || 'Untitled'}"
URL: ${(page && page.url) || ''}
Page headings: ${headings}
Forms on page: ${(page && page.formsCount) || 0}
Interactive elements (${elements.length}):
${elementStrings}

Write a helpful spoken summary:
- First sentence: what this page is for.
- Then up to 5 important actions the user can take.
- Mention forms/inputs if relevant.
- ${STYLE_INSTRUCTIONS[state.settings.style] || STYLE_INSTRUCTIONS.concise}
- Plain text only. No markdown, no code fences.`;

  const res = await makeApiCall(key, state.settings.model, prompt);
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const d = await res.json();
      if (d && d.error && d.error.message) msg = d.error.message;
    } catch (e) {}
    throw new Error(`[${res.status}] ${msg}`);
  }
  const data = await res.json();
  const text = (data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts)
    ? data.candidates[0].content.parts.map(p => p.text || '').join('').trim()
    : '';
  if (!text) throw new Error('Empty response from model');
  return text;
}

async function makeApiCall(key, model, prompt) {
  return fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.4, maxOutputTokens: 256 }
    })
  });
}

function localSummary(page, elements) {
  const counts = {};
  elements.forEach(e => { counts[e.type] = (counts[e.type] || 0) + 1; });
  const parts = Object.entries(counts).map(([t, n]) => `${n} ${t.toLowerCase()}${n > 1 ? 's' : ''}`);
  const top = elements.slice(0, 5).map(e => e.text).join('; ');
  return `This page (${(page && page.title) || 'Untitled'}) offers ${elements.length} interactive elements: ${parts.join(', ')}. Key items: ${top}.`;
}

async function testApiKey() {
  const key = $('apiKeyInput').value.trim() || state.settings.apiKey;
  if (!key) { setStatus('Enter an API key first.'); return; }
  setStatus('Testing API key…');
  try {
    const res = await makeApiCall(key, state.settings.model, 'Reply with the single word: OK');
    if (!res.ok) {
      let msg = res.statusText;
      try { const d = await res.json(); if (d && d.error && d.error.message) msg = d.error.message; } catch (e) {}
      throw new Error(`[${res.status}] ${msg}`);
    }
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text).join('').trim() || '';
    setStatus('API key works. Model replied: ' + (text || '(empty)'));
  } catch (err) {
    setStatus('API test failed: ' + (err && err.message ? err.message : err));
  }
}

// ---------- Voice ----------
function readAloud(text) {
  if (!state.settings.voiceEnabled) return;
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  if (state.settings.voiceName) {
    const v = window.speechSynthesis.getVoices().find(x => x.name === state.settings.voiceName);
    if (v) utterance.voice = v;
  }
  utterance.rate = state.settings.rate || 1;
  utterance.pitch = state.settings.pitch || 1;
  const statusDiv = $('status');
  const original = statusDiv.textContent;
  utterance.onstart = () => { statusDiv.textContent = 'Speaking…'; };
  utterance.onend = () => { statusDiv.textContent = original; };
  utterance.onerror = () => { statusDiv.textContent = 'Speech interrupted.'; };
  window.speechSynthesis.speak(utterance);
}

// ---------- Utilities ----------
async function copyText(text) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    setStatus('Copied to clipboard.');
  } catch (e) {
    setStatus('Copy failed.');
  }
}

function exportJson() {
  if (!state.elements.length) { setStatus('Nothing to export.'); return; }
  const payload = { page: state.page, elements: state.elements, summary: state.summary, exportedAt: new Date().toISOString() };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'page-pilot-scan.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  setStatus('Exported JSON.');
}

function clearResults() {
  state.elements = [];
  state.page = null;
  state.summary = '';
  state.activeType = 'All';
  state.search = '';
  $('filterInput').value = '';
  $('badge').textContent = '0';
  $('actionsList').innerHTML = '<li class="empty-state">Click \'Scan\' to analyze the current page.</li>';
  $('chipRow').innerHTML = '';
  $('summaryContainer').style.display = 'none';
  setStatus('Cleared.');
}

// ---------- History ----------
async function saveHistoryEntry(tab, summary, count) {
  const entry = {
    id: Date.now() + '-' + Math.random().toString(36).slice(2, 7),
    title: (state.page && state.page.title) || (tab && tab.title) || 'Untitled',
    url: (state.page && state.page.url) || (tab && tab.url) || '',
    summary: summary || '',
    count: count || 0,
    ts: Date.now()
  };
  state.history.unshift(entry);
  state.history = state.history.slice(0, 12);
  await storageSet({ pp_history: state.history });
  renderHistory();
}

function renderHistory() {
  const list = $('historyList');
  if (!list) return;
  list.innerHTML = '';
  if (!state.history.length) {
    list.innerHTML = '<li class="empty-state">No recent scans.</li>';
    return;
  }
  state.history.forEach(h => {
    const li = document.createElement('li');
    li.className = 'history-item';
    const title = document.createElement('div');
    title.className = 'history-title';
    title.textContent = h.title || 'Untitled';
    const meta = document.createElement('div');
    meta.className = 'history-meta';
    meta.textContent = `${h.count} elements · ${new Date(h.ts).toLocaleString()}`;
    const summ = document.createElement('div');
    summ.className = 'history-summary';
    summ.textContent = (h.summary || '').slice(0, 140);
    li.appendChild(title);
    li.appendChild(meta);
    li.appendChild(summ);
    li.addEventListener('click', () => {
      state.summary = h.summary || '';
      $('summaryText').textContent = state.summary;
      $('summaryContainer').style.display = state.summary ? 'block' : 'none';
      togglePanel('history', false);
      setStatus('Loaded from history.');
    });
    list.appendChild(li);
  });
}