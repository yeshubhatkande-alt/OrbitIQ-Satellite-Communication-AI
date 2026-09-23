/* ══════════════════════════════════════════════════════════════
   OrbitIQ – Frontend Application
   ══════════════════════════════════════════════════════════════ */

'use strict';

const API = ''; // same origin – backend serves frontend
let currentSession = null;
let modulations = [];

/* ─── Toast ─────────────────────────────────────────────────────────────── */
function toast(msg, type = 'info', duration = 3500) {
  const el = document.getElementById('toast');
  el.textContent  = msg;
  el.className    = `toast show ${type}`;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.classList.remove('show'); }, duration);
}

/* ─── Section navigation ─────────────────────────────────────────────────── */
function showSection(name) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const sec = document.getElementById('section-' + name);
  if (sec) sec.classList.add('active');
  const nav = document.querySelector(`.nav-item[data-section="${name}"]`);
  if (nav) nav.classList.add('active');

  // Lazy-load section data
  if (name === 'dashboard')   loadStats();
  if (name === 'frequency')   loadFrequencyBands();
  if (name === 'modulation')  loadModulations();
  if (name === 'documents')   loadDocuments();
  if (name === 'knowledge')   loadKnowledge();
}

document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', e => {
    e.preventDefault();
    showSection(item.dataset.section);
  });
});

/* ─── Sidebar toggle ─────────────────────────────────────────────────────── */
document.getElementById('sidebarToggle').addEventListener('click', () => {
  document.getElementById('sidebar').classList.toggle('open');
});

/* ─── Star canvas ────────────────────────────────────────────────────────── */
(function initStars() {
  const canvas = document.getElementById('starCanvas');
  if (!canvas) return;
  const ctx    = canvas.getContext('2d');
  let stars    = [];
  let raf;

  function resize() {
    canvas.width  = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
    stars = Array.from({ length: 160 }, () => ({
      x:  Math.random() * canvas.width,
      y:  Math.random() * canvas.height,
      r:  Math.random() * 1.4 + 0.3,
      a:  Math.random(),
      da: (Math.random() - 0.5) * 0.012,
      dx: (Math.random() - 0.5) * 0.08
    }));
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    stars.forEach(s => {
      s.a  += s.da;
      if (s.a < 0.1 || s.a > 1) s.da *= -1;
      s.x  += s.dx;
      if (s.x < 0) s.x = canvas.width;
      if (s.x > canvas.width) s.x = 0;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(147,197,253,${s.a.toFixed(2)})`;
      ctx.fill();
    });
    raf = requestAnimationFrame(draw);
  }

  resize();
  draw();
  window.addEventListener('resize', () => { cancelAnimationFrame(raf); resize(); draw(); });
})();

/* ─── API helper ─────────────────────────────────────────────────────────── */
async function apiFetch(path, options = {}) {
  const defaults = { headers: { 'Content-Type': 'application/json' } };
  if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
    options.body = JSON.stringify(options.body);
  }
  if (options.body instanceof FormData) {
    delete defaults.headers['Content-Type'];
  }
  const res = await fetch(API + path, { ...defaults, ...options, headers: { ...defaults.headers, ...(options.headers || {}) } });
  if (!res.ok) {
    let err;
    try { err = await res.json(); } catch { err = { error: res.statusText }; }
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

/* ─── Health check ───────────────────────────────────────────────────────── */
async function checkHealth() {
  try {
    const data = await apiFetch('/api/health');
    const dot  = document.querySelector('.status-dot');
    const span = document.querySelector('.status-indicator span');
    if (data.status === 'ok') {
      dot.classList.add('online');
      span.textContent = data.db ? 'MySQL Online' : 'In-Memory Mode';
    }
  } catch {
    document.querySelector('.status-dot').classList.add('offline');
    document.querySelector('.status-indicator span').textContent = 'Backend Offline';
  }
}

/* ─── Dashboard stats ────────────────────────────────────────────────────── */
async function loadStats() {
  try {
    const d = await apiFetch('/api/stats');
    document.getElementById('stat-queries').textContent    = d.totalQueries;
    document.getElementById('stat-linkbudgets').textContent = d.linkBudgetsComputed;
    document.getElementById('stat-docs').textContent        = d.docsUploaded;
    document.getElementById('stat-kb').textContent          = d.knowledgeArticles;
    document.getElementById('stat-uptime').textContent      = d.uptime;
    document.getElementById('stat-sessions').textContent    = d.totalSessions;
  } catch (e) {
    toast('Could not load stats: ' + e.message, 'error');
  }
}

/* ─── Markdown renderer (minimal) ───────────────────────────────────────── */
function renderMarkdown(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^## (.+)$/gm, '<h3>$1</h3>')
    .replace(/^# (.+)$/gm, '<h2>$1</h2>')
    .replace(/^\| (.+)$/gm, s => {
      const cells = s.split('|').slice(1,-1).map(c => c.trim());
      return '<tr>' + cells.map(c => `<td>${c}</td>`).join('') + '</tr>';
    })
    .replace(/(<tr>.*<\/tr>\n?)+/gs, t => `<table>${t}</table>`)
    .replace(/^• (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/gs, l => `<ul>${l}</ul>`)
    .replace(/\n\n/g, '</p><p>')
    .replace(/^/, '<p>').replace(/$/, '</p>');
}

/* ─── Chat ───────────────────────────────────────────────────────────────── */
function appendMessage(role, content, isHTML = false) {
  const messages = document.getElementById('chatMessages');
  const div = document.createElement('div');
  div.className = `chat-message ${role}`;
  const avatar = document.createElement('div');
  avatar.className = 'msg-avatar';
  avatar.textContent = role === 'assistant' ? '🛰️' : '👤';
  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';
  if (isHTML) {
    bubble.innerHTML = content;
  } else {
    bubble.innerHTML = renderMarkdown(content);
  }
  div.appendChild(avatar);
  div.appendChild(bubble);
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
  return div;
}

function appendTyping() {
  const messages = document.getElementById('chatMessages');
  const div = document.createElement('div');
  div.className = 'chat-message assistant';
  div.id = 'typingIndicator';
  div.innerHTML = `<div class="msg-avatar">🛰️</div><div class="msg-bubble"><div class="typing-indicator"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span></div></div>`;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
  return div;
}

function removeTyping() {
  const el = document.getElementById('typingIndicator');
  if (el) el.remove();
}

async function sendChat() {
  const input   = document.getElementById('chatInput');
  const sendBtn = document.getElementById('sendBtn');
  const message = input.value.trim();
  if (!message) return;

  input.value = '';
  input.style.height = 'auto';
  appendMessage('user', message);
  sendBtn.disabled = true;

  const typing = appendTyping();

  try {
    const useDocs = document.getElementById('useDocuments').checked;
    const data = await apiFetch('/api/chat', {
      method: 'POST',
      body: { message, session_id: currentSession, use_documents: useDocs }
    });
    currentSession = data.session_id;
    removeTyping();
    appendMessage('assistant', data.reply);
  } catch (e) {
    removeTyping();
    appendMessage('assistant', `❌ Error: ${e.message}. Please ensure the backend is running.`);
  } finally {
    sendBtn.disabled = false;
    input.focus();
  }
}

function clearChat() {
  document.getElementById('chatMessages').innerHTML = `
    <div class="chat-message assistant">
      <div class="msg-avatar">🛰️</div>
      <div class="msg-bubble">Chat cleared. How can I assist with satellite communications?</div>
    </div>`;
  currentSession = null;
}

function setQuickPrompt(text) {
  const input = document.getElementById('chatInput');
  input.value = text;
  input.focus();
  input.dispatchEvent(new Event('input'));
}

// Auto-resize textarea
document.getElementById('chatInput').addEventListener('input', function() {
  this.style.height = 'auto';
  this.style.height = Math.min(this.scrollHeight, 120) + 'px';
});

document.getElementById('chatInput').addEventListener('keydown', function(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
});

/* ─── Frequency Bands ────────────────────────────────────────────────────── */
function getRainClass(level) {
  const l = (level || '').toLowerCase();
  if (l.includes('very high')) return 'rain-very-high';
  if (l.includes('very low'))  return 'rain-very-low';
  if (l.includes('moderate-high') || l.includes('moderate high')) return 'rain-moderate-high';
  if (l.includes('high'))      return 'rain-high';
  if (l.includes('moderate'))  return 'rain-moderate';
  return 'rain-low';
}

async function loadFrequencyBands() {
  const grid = document.getElementById('freqGrid');
  grid.innerHTML = '<div class="loading-spinner">Loading frequency bands…</div>';
  try {
    const data = await apiFetch('/api/frequency-bands');
    grid.innerHTML = '';
    data.bands.forEach(b => {
      const maxMargin = 25;
      const pct = Math.min((b.typical_link_margin_db / maxMargin) * 100, 100);
      const card = document.createElement('div');
      card.className = 'freq-card';
      card.style.borderTop = `3px solid ${b.color}`;
      card.innerHTML = `
        <div class="freq-header">
          <div>
            <div class="freq-band-label" style="color:${b.color}">${b.band}-Band</div>
            <div class="freq-range">${b.range}</div>
          </div>
          <span class="freq-rain-badge ${getRainClass(b.rain_fade)}">${b.rain_fade} Rain</span>
        </div>
        <div class="freq-use">${b.use}</div>
        <div class="freq-margin">
          <span>Rain margin: <strong style="color:${b.color}">${b.typical_link_margin_db} dB</strong></span>
          <div class="freq-margin-bar">
            <div class="freq-margin-fill" style="width:${pct}%;background:${b.color}"></div>
          </div>
        </div>`;
      grid.appendChild(card);
    });
  } catch (e) {
    grid.innerHTML = `<div class="empty-state">Failed to load: ${e.message}</div>`;
  }
}

/* ─── Modulation Explorer ────────────────────────────────────────────────── */
async function loadModulations() {
  const tbody = document.getElementById('modTableBody');
  try {
    const data = await apiFetch('/api/modulations');
    modulations = data.modulations;
    tbody.innerHTML = '';
    modulations.forEach(m => {
      const robPct = ((m.robustness || 5) / 10) * 100;
      const robColor = m.robustness >= 8 ? '#4ade80' : m.robustness >= 6 ? '#22d3ee' : m.robustness >= 4 ? '#facc15' : '#f87171';
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong style="color:#60a5fa">${m.name}</strong></td>
        <td>${m.bits_per_symbol !== null ? m.bits_per_symbol : '—'}</td>
        <td>${m.spectral_eff}</td>
        <td>${m.req_cnr_db !== null ? m.req_cnr_db + ' dB' : '—'}</td>
        <td>
          <div class="robustness-bar">
            <div class="rob-track"><div class="rob-fill" style="width:${robPct}%;background:${robColor}"></div></div>
            <span style="font-size:0.75rem;color:${robColor}">${m.robustness}/10</span>
          </div>
        </td>
        <td style="font-size:0.8rem;color:#8ba3c0">${m.use}</td>
        <td><span style="font-size:0.75rem;color:#5d7a96">${m.standard}</span></td>`;
      tbody.appendChild(tr);
    });
    renderModChart(modulations);
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="7" class="loading-cell">Failed to load: ${e.message}</td></tr>`;
  }
}

function renderModChart(mods) {
  const canvas = document.getElementById('modChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width = canvas.parentElement.clientWidth - 48;
  const H = canvas.height = 260;
  ctx.clearRect(0, 0, W, H);

  const filtered = mods.filter(m => m.req_cnr_db !== null && m.bits_per_symbol !== null);
  if (!filtered.length) return;

  const pad = { top: 20, right: 40, bottom: 50, left: 50 };
  const maxX = Math.max(...filtered.map(m => m.req_cnr_db)) + 3;
  const maxY = Math.max(...filtered.map(m => m.bits_per_symbol)) + 1;

  // Grid
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 5; i++) {
    const y = pad.top + (i / 5) * (H - pad.top - pad.bottom);
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
    const x = pad.left + (i / 5) * (W - pad.left - pad.right);
    ctx.beginPath(); ctx.moveTo(x, pad.top); ctx.lineTo(x, H - pad.bottom); ctx.stroke();
  }

  // Axes labels
  ctx.fillStyle = '#5d7a96'; ctx.font = '11px Inter,sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Required CNR (dB) →', pad.left + (W - pad.left - pad.right) / 2, H - 8);
  ctx.save(); ctx.translate(14, pad.top + (H - pad.top - pad.bottom) / 2);
  ctx.rotate(-Math.PI / 2); ctx.fillText('Bits/Symbol', 0, 0); ctx.restore();

  // Axis tick values
  ctx.fillStyle = '#3d5a78'; ctx.font = '10px Inter';
  for (let i = 0; i <= 5; i++) {
    const x = pad.left + (i / 5) * (W - pad.left - pad.right);
    ctx.textAlign = 'center';
    ctx.fillText(((maxX * i) / 5).toFixed(0), x, H - pad.bottom + 14);
  }

  // Points
  const colors = ['#4ade80','#22d3ee','#60a5fa','#a78bfa','#f472b6','#fb923c','#facc15'];
  filtered.forEach((m, i) => {
    const x = pad.left + (m.req_cnr_db / maxX) * (W - pad.left - pad.right);
    const y = H - pad.bottom - (m.bits_per_symbol / maxY) * (H - pad.top - pad.bottom);
    const color = colors[i % colors.length];
    // Draw circle
    ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.fillStyle = color + '44'; ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
    // Label
    ctx.fillStyle = color; ctx.font = 'bold 11px Inter'; ctx.textAlign = 'center';
    ctx.fillText(m.name, x, y - 12);
  });

  // Connect with line
  ctx.beginPath();
  ctx.strokeStyle = 'rgba(59,130,246,0.3)'; ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 4]);
  filtered.forEach((m, i) => {
    const x = pad.left + (m.req_cnr_db / maxX) * (W - pad.left - pad.right);
    const y = H - pad.bottom - (m.bits_per_symbol / maxY) * (H - pad.top - pad.bottom);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke(); ctx.setLineDash([]);
}

/* ─── Link Budget Calculator ─────────────────────────────────────────────── */
const PRESETS = {
  'geo-ku':    { name:'GEO Ku-band Forward', frequency_ghz:12,   tx_power_dbw:10,  tx_gain_dbi:45, rx_gain_dbi:35, distance_km:35786, system_noise_temp_k:300,  bandwidth_hz:36000000, atmospheric_loss_db:2,   pointing_loss_db:0.5 },
  'geo-ka':    { name:'GEO Ka-band HTS',     frequency_ghz:20,   tx_power_dbw:12,  tx_gain_dbi:52, rx_gain_dbi:40, distance_km:35786, system_noise_temp_k:350,  bandwidth_hz:500000000, atmospheric_loss_db:10,  pointing_loss_db:0.5 },
  'leo':       { name:'LEO S-band Downlink', frequency_ghz:2.25, tx_power_dbw:3,   tx_gain_dbi:6,  rx_gain_dbi:25, distance_km:780,   system_noise_temp_k:150,  bandwidth_hz:2000000,   atmospheric_loss_db:0.3, pointing_loss_db:0.5 },
  'deep-space':{ name:'Deep Space X-band',   frequency_ghz:8.4,  tx_power_dbw:10,  tx_gain_dbi:46, rx_gain_dbi:68, distance_km:4e8,   system_noise_temp_k:20,   bandwidth_hz:8000,      atmospheric_loss_db:0.2, pointing_loss_db:0.1 }
};

function loadPreset(key) {
  const p = PRESETS[key];
  if (!p) return;
  document.getElementById('lb-name').value      = p.name;
  document.getElementById('lb-freq').value      = p.frequency_ghz;
  document.getElementById('lb-txpower').value   = p.tx_power_dbw;
  document.getElementById('lb-txgain').value    = p.tx_gain_dbi;
  document.getElementById('lb-rxgain').value    = p.rx_gain_dbi;
  document.getElementById('lb-distance').value  = p.distance_km;
  document.getElementById('lb-noisetemp').value = p.system_noise_temp_k;
  document.getElementById('lb-bandwidth').value = p.bandwidth_hz;
  document.getElementById('lb-atmos').value     = p.atmospheric_loss_db;
  document.getElementById('lb-pointing').value  = p.pointing_loss_db;
  toast(`Loaded preset: ${p.name}`, 'info');
}

async function calculateLinkBudget(e) {
  e.preventDefault();
  const btn = document.getElementById('calcBtn');
  btn.disabled = true;
  btn.textContent = 'Calculating…';

  const body = {
    name:               document.getElementById('lb-name').value || 'Link Budget',
    frequency_ghz:      parseFloat(document.getElementById('lb-freq').value),
    tx_power_dbw:       parseFloat(document.getElementById('lb-txpower').value),
    tx_gain_dbi:        parseFloat(document.getElementById('lb-txgain').value),
    rx_gain_dbi:        parseFloat(document.getElementById('lb-rxgain').value),
    distance_km:        parseFloat(document.getElementById('lb-distance').value),
    system_noise_temp_k: parseFloat(document.getElementById('lb-noisetemp').value),
    bandwidth_hz:       parseFloat(document.getElementById('lb-bandwidth').value),
    atmospheric_loss_db: parseFloat(document.getElementById('lb-atmos').value || 0.5),
    pointing_loss_db:   parseFloat(document.getElementById('lb-pointing').value || 0.5)
  };

  try {
    const data = await apiFetch('/api/link-budget', { method: 'POST', body });
    displayLinkBudgetResults(data);
    toast('Link budget calculated!', 'success');
  } catch (err) {
    toast('Calculation error: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/></svg> Calculate Link Budget`;
  }
}

function displayLinkBudgetResults(data) {
  const r = data.results;
  const card = document.getElementById('lbResults');
  card.style.display = 'block';

  // Status badge
  const badge = document.getElementById('lbStatusBadge');
  const statusMap = { EXCELLENT: 'status-excellent', MARGINAL: 'status-marginal', INSUFFICIENT: 'status-insufficient' };
  const statusClass = r.link_status === 'EXCELLENT' ? 'status-excellent' : r.link_margin_db >= 3 ? 'status-good' : r.link_status === 'MARGINAL' ? 'status-marginal' : 'status-insufficient';
  badge.className = `lb-status-badge ${statusClass}`;
  badge.textContent = r.link_status + (r.link_margin_db >= 0 ? ` (${r.link_margin_db > 0 ? '+':''}${r.link_margin_db} dB margin)` : '');

  // Results grid
  const grid = document.getElementById('lbResultsGrid');
  const items = [
    { label: 'EIRP',            value: r.eirp_dbw,           unit: 'dBW' },
    { label: 'Free Space Path Loss', value: r.fspl_db,        unit: 'dB' },
    { label: 'Received Power',  value: r.received_power_dbw,  unit: 'dBW' },
    { label: 'Noise Power',     value: r.noise_power_dbw,     unit: 'dBW' },
    { label: 'Carrier/Noise Ratio', value: r.cnr_db,          unit: 'dB' },
    { label: 'G/T',             value: r.gt_db_per_k,         unit: 'dB/K' },
    { label: 'Link Margin',     value: r.link_margin_db,      unit: 'dB' }
  ];
  grid.innerHTML = items.map(i => `
    <div class="lb-result-item">
      <div class="lb-result-label">${i.label}</div>
      <div class="lb-result-value">${i.value}</div>
      <div class="lb-result-unit">${i.unit}</div>
    </div>`).join('');

  // Interpretation
  document.getElementById('lbInterpretation').innerHTML =
    `<strong>Assessment:</strong> ${data.interpretation.status}<br/>${data.interpretation.recommendation}`;

  card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* ─── Troubleshooter ─────────────────────────────────────────────────────── */
function addSymptom(text) {
  const input = document.getElementById('tsSymptoms');
  input.value = (input.value ? input.value + '\n' : '') + text;
}

async function runTroubleshoot() {
  const symptoms = document.getElementById('tsSymptoms').value.trim();
  if (!symptoms) { toast('Please describe the symptoms first.', 'error'); return; }

  const resultsCard = document.getElementById('tsResults');
  resultsCard.style.display = 'none';
  document.getElementById('tsDiagnosis').textContent = 'Analysing…';

  try {
    const data = await apiFetch('/api/troubleshoot', { method: 'POST', body: { symptoms } });
    resultsCard.style.display = 'block';

    document.getElementById('tsDiagnosis').innerHTML = renderMarkdown(data.diagnosis);

    const recEl = document.getElementById('tsRecommendations');
    if (data.recommendations && data.recommendations.length) {
      recEl.innerHTML = '<h4>Recommendations</h4>' +
        data.recommendations.map(r => `<div class="ts-rec-item">${renderMarkdown(r)}</div>`).join('');
    } else {
      recEl.innerHTML = '';
    }

    const relEl = document.getElementById('tsRelated');
    if (data.related_kb && data.related_kb.length) {
      relEl.innerHTML = '<h4>Related Knowledge Base Articles</h4>' +
        data.related_kb.map(k => `<span class="ts-kb-tag">${k.title}</span>`).join('');
    } else {
      relEl.innerHTML = '';
    }

    resultsCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    toast('Diagnosis complete', 'success');
  } catch (e) {
    document.getElementById('tsDiagnosis').textContent = 'Error: ' + e.message;
    resultsCard.style.display = 'block';
    toast('Troubleshoot error: ' + e.message, 'error');
  }
}

/* ─── Documents ──────────────────────────────────────────────────────────── */
function getDocIcon(name) {
  const ext = (name || '').split('.').pop().toLowerCase();
  const icons = { pdf: '📄', docx: '📝', txt: '📃', md: '📋', csv: '📊' };
  return icons[ext] || '📎';
}

function formatSize(bytes) {
  if (bytes < 1024)       return bytes + ' B';
  if (bytes < 1024*1024)  return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

async function loadDocuments() {
  const list = document.getElementById('documentsList');
  list.innerHTML = '<div class="loading-spinner">Loading…</div>';
  try {
    const data = await apiFetch('/api/documents');
    if (!data.documents.length) {
      list.innerHTML = '<div class="empty-state">No documents uploaded yet</div>';
      return;
    }
    list.innerHTML = '';
    data.documents.forEach(doc => {
      const item = document.createElement('div');
      item.className = 'doc-item';
      const statusClass = { ready: 'ds-ready', processing: 'ds-processing', error: 'ds-error' }[doc.status] || 'ds-processing';
      item.innerHTML = `
        <div class="doc-icon">${getDocIcon(doc.original_name)}</div>
        <div class="doc-info">
          <div class="doc-name" title="${doc.original_name}">${doc.original_name}</div>
          <div class="doc-meta">${formatSize(doc.file_size)}${doc.word_count ? ' · ' + doc.word_count + ' words' : ''} · ${new Date(doc.created_at).toLocaleDateString()}</div>
        </div>
        <span class="doc-status-badge ${statusClass}">${doc.status}</span>
        <button class="btn btn-danger" onclick="deleteDocument('${doc.id}',this)" style="padding:5px 10px;font-size:0.75rem">✕</button>`;
      list.appendChild(item);
    });
  } catch (e) {
    list.innerHTML = `<div class="empty-state">Error: ${e.message}</div>`;
  }
}

async function deleteDocument(id, btn) {
  if (!confirm('Delete this document?')) return;
  btn.disabled = true;
  try {
    await apiFetch('/api/documents/' + id, { method: 'DELETE' });
    toast('Document deleted', 'success');
    loadDocuments();
  } catch (e) {
    toast('Delete failed: ' + e.message, 'error');
    btn.disabled = false;
  }
}

// Drop zone
(function setupDropZone() {
  const zone  = document.getElementById('dropZone');
  const input = document.getElementById('fileInput');
  if (!zone || !input) return;

  zone.addEventListener('click', () => input.click());
  zone.addEventListener('dragover',  e => { e.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('dragover');
    uploadFiles(e.dataTransfer.files);
  });
  input.addEventListener('change', () => uploadFiles(input.files));
})();

async function uploadFiles(files) {
  if (!files || !files.length) return;
  const progress = document.getElementById('uploadProgress');
  const fill     = document.getElementById('progressFill');
  const status   = document.getElementById('uploadStatus');

  progress.style.display = 'block';
  let uploaded = 0;

  for (const file of files) {
    status.textContent = `Uploading ${file.name}…`;
    fill.style.width = '30%';
    try {
      const fd = new FormData();
      fd.append('file', file);
      const data = await apiFetch('/api/documents/upload', { method: 'POST', body: fd, headers: {} });
      fill.style.width = `${Math.round(((uploaded + 1) / files.length) * 100)}%`;
      uploaded++;
      toast(`Uploaded: ${data.original_name}`, 'success');
    } catch (e) {
      toast(`Upload failed (${file.name}): ${e.message}`, 'error');
    }
  }

  status.textContent = `Uploaded ${uploaded}/${files.length} files`;
  setTimeout(() => { progress.style.display = 'none'; fill.style.width = '0%'; }, 2500);
  loadDocuments();
}

/* ─── Knowledge Base ─────────────────────────────────────────────────────── */
let kbData = [];

async function loadKnowledge(search, category) {
  const grid = document.getElementById('kbGrid');
  grid.innerHTML = '<div class="loading-spinner">Loading…</div>';
  try {
    let url = '/api/knowledge?';
    if (search)   url += `search=${encodeURIComponent(search)}&`;
    if (category) url += `category=${encodeURIComponent(category)}`;
    const data = await apiFetch(url);
    kbData = data.items;
    renderKBGrid(kbData);
  } catch (e) {
    grid.innerHTML = `<div class="empty-state">Error: ${e.message}</div>`;
  }
}

function renderKBGrid(items) {
  const grid = document.getElementById('kbGrid');
  if (!items.length) { grid.innerHTML = '<div class="empty-state">No articles found</div>'; return; }
  grid.innerHTML = items.map(item => {
    const kws = (item.keywords || []).slice(0, 5).map(k => `<span class="kb-kw-tag">${k}</span>`).join('');
    return `<div class="kb-card">
      <div class="kb-card-header">
        <span class="kb-cat-badge">${item.category}</span>
        <span class="kb-title">${item.title}</span>
      </div>
      <div class="kb-text">${item.text.substring(0, 240)}${item.text.length > 240 ? '…' : ''}</div>
      ${kws ? `<div class="kb-keywords">${kws}</div>` : ''}
    </div>`;
  }).join('');
}

function searchKB() {
  const search   = document.getElementById('kbSearch').value.trim();
  const category = document.getElementById('kbCategory').value;
  loadKnowledge(search || undefined, category || undefined);
}

/* ─── Init ───────────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  checkHealth();
  showSection('dashboard');

  // Auto-refresh stats every 30 seconds
  setInterval(() => {
    const active = document.querySelector('.section.active');
    if (active && active.id === 'section-dashboard') loadStats();
  }, 30000);
});
