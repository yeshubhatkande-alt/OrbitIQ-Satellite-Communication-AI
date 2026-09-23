'use strict';

// ─── Core dependencies ────────────────────────────────────────────────────────
const path    = require('path');
const fs      = require('fs');
const { v4: uuidv4 } = require('uuid');

// Load .env from backend directory
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express     = require('express');
const cors        = require('cors');
const morgan      = require('morgan');
const helmet      = require('helmet');
const multer      = require('multer');
const rateLimit   = require('express-rate-limit');
const mysql       = require('mysql2/promise');

const app  = express();
const PORT = process.env.PORT || 5000;

// ─── Ensure upload directory exists ──────────────────────────────────────────
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: '*', methods: ['GET','POST','PUT','DELETE','OPTIONS'], allowedHeaders: ['Content-Type','Authorization'] }));
app.use(morgan('dev'));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve frontend static files
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// Rate limiting
const limiter = rateLimit({ windowMs: 60 * 1000, max: 200, standardHeaders: true, legacyHeaders: false });
app.use('/api', limiter);

// ─── MySQL connection pool (optional) ────────────────────────────────────────
let pool = null;
let dbAvailable = false;

async function initDB() {
  try {
    pool = mysql.createPool({
      host:               process.env.DB_HOST     || 'localhost',
      port:               parseInt(process.env.DB_PORT || '3306'),
      user:               process.env.DB_USER     || 'root',
      password:           process.env.DB_PASSWORD || '',
      database:           process.env.DB_NAME     || 'orbitiq_db',
      waitForConnections: true,
      connectionLimit:    10,
      connectTimeout:     5000
    });
    const conn = await pool.getConnection();
    conn.release();
    dbAvailable = true;
    console.log('✅ MySQL connected');
  } catch (e) {
    console.warn('⚠️  MySQL not available – running in demo/in-memory mode:', e.message);
    pool = null;
    dbAvailable = false;
  }
}

// ─── In-memory stores (when DB is unavailable) ───────────────────────────────
const inMemory = {
  sessions:    {},
  messages:    {},
  documents:   [],
  linkBudgets: [],
  stats: { chats: 0, linkBudgets: 0, docsUploaded: 0, sessions: 0 }
};

// ─── Built-in satellite knowledge base ───────────────────────────────────────
const KNOWLEDGE = [
  // Frequency Bands
  { cat:'frequency', title:'L-Band (1–2 GHz)', text:'L-Band covers 1–2 GHz. Used in GPS (L1: 1575.42 MHz, L2: 1227.60 MHz, L5: 1176.45 MHz), Iridium, Inmarsat. Minimal rain fade. Best for mobile/maritime. Requires larger antennas due to longer wavelength.', kw:['L-band','GPS','Iridium','Inmarsat','1GHz','2GHz','mobile','maritime'] },
  { cat:'frequency', title:'S-Band (2–4 GHz)', text:'S-Band covers 2–4 GHz. NASA deep space network (2.025–2.120 GHz uplink, 2.2–2.3 GHz downlink), weather radar, TDRSS. Moderate rain fade resistance. Common in LEO satellite tracking.', kw:['S-band','NASA','deep space','weather','LEO','2GHz','4GHz','TDRSS'] },
  { cat:'frequency', title:'C-Band (4–8 GHz)', text:'C-Band covers 4–8 GHz. FSS uplink 5.925–6.425 GHz, downlink 3.7–4.2 GHz. Excellent rain fade resistance. Legacy satellite TV backbone. 500 MHz duplex spacing. Global coverage satellites use C-band.', kw:['C-band','FSS','satellite TV','4GHz','8GHz','rain resistance','GEO'] },
  { cat:'frequency', title:'X-Band (8–12 GHz)', text:'X-Band covers 8–12 GHz. Military communications, Earth observation SAR radars (Sentinel-1), government satellites. ITU allocations: 7.9–8.025 GHz uplink, 7.25–7.75 GHz downlink.', kw:['X-band','military','SAR','Sentinel-1','Earth observation','8GHz','12GHz'] },
  { cat:'frequency', title:'Ku-Band (12–18 GHz)', text:'Ku-Band covers 12–18 GHz. FSS: 14–14.5 GHz uplink, 10.95–12.75 GHz downlink. BSS (DTH): 17.3–18.1 GHz uplink, 11.7–12.5 GHz downlink. VSAT internet. Rain margin needed: 3–10 dB.', kw:['Ku-band','VSAT','DTH','12GHz','18GHz','rain fade','BSS','FSS','DVB-S'] },
  { cat:'frequency', title:'Ka-Band (26.5–40 GHz)', text:'Ka-Band covers 26.5–40 GHz. HTS broadband: 27.5–31 GHz uplink, 17.7–21.2 GHz downlink. Spot beam frequency reuse. Rain fade critical: 10–20+ dB. ViaSat-3, Hughes EchoStar. Eb/N0 margin of 15+ dB recommended.', kw:['Ka-band','HTS','broadband','26GHz','40GHz','spot beam','ViaSat','rain margin'] },
  { cat:'frequency', title:'V-Band (40–75 GHz)', text:'V-Band (40–75 GHz) and W-Band (75–110 GHz). Emerging for satellite backhaul and feeder links. Severe rain fade (20–40+ dB). Millimeter wave propagation. Used in experimental/research satellites and future 5G NTN.', kw:['V-band','W-band','millimeter wave','5G','NTN','feeder link','40GHz','75GHz'] },
  // Modulation
  { cat:'modulation', title:'BPSK', text:'Binary Phase Shift Keying. 1 bit/symbol. Spectral efficiency 1 bps/Hz. Eb/N0 for BER 1×10⁻⁶: 10.5 dB. Most robust modulation. Used in deep space (Voyager, Cassini), GPS C/A code, emergency beacons (COSPAS-SARSAT).', kw:['BPSK','binary','1 bit','deep space','GPS','BER','10.5 dB','robust'] },
  { cat:'modulation', title:'QPSK', text:'Quadrature Phase Shift Keying. 2 bits/symbol. Spectral efficiency 2 bps/Hz. Eb/N0 for BER 1×10⁻⁶: 10.5 dB (same as BPSK with Gray coding). Industry standard for satellite uplinks. DVB-S, CCSDS, SCPC.', kw:['QPSK','quadrature','2 bits','DVB-S','CCSDS','SCPC','satellite uplink'] },
  { cat:'modulation', title:'8PSK', text:'8-Phase Shift Keying. 3 bits/symbol. Spectral efficiency 3 bps/Hz. Required Eb/N0 ~14 dB for BER 1×10⁻⁶. Used in DVB-S2 forward link for HTS. More phase noise sensitive than QPSK.', kw:['8PSK','3 bits','DVB-S2','HTS','14 dB','phase noise'] },
  { cat:'modulation', title:'16APSK', text:'16 Amplitude Phase Shift Keying. 4 bits/symbol. Used in DVB-S2. Two ring amplitude levels for better nonlinear amplifier performance vs 16QAM. Required C/N ~12 dB. Good for transponder saturation scenarios.', kw:['16APSK','DVB-S2','4 bits','nonlinear','amplifier','transponder'] },
  { cat:'modulation', title:'32APSK', text:'32 APSK. 5 bits/symbol. DVB-S2 highest modulation. Required C/N ~17 dB. Used only on very clean, high-power GEO links. Three-ring amplitude structure. Spectral efficiency 5 bps/Hz.', kw:['32APSK','5 bits','DVB-S2','high power','GEO','17 dB'] },
  { cat:'modulation', title:'OFDM', text:'Orthogonal Frequency Division Multiplexing. Multi-carrier modulation. Immune to multipath. Used in DVB-S2X, HTS return channels. High PAPR requires backoff. Pilot carriers needed for channel estimation.', kw:['OFDM','multicarrier','DVB-S2X','multipath','PAPR','pilot'] },
  { cat:'modulation', title:'Turbo / LDPC Coding', text:'LDPC (Low Density Parity Check) used in DVB-S2: operates within 0.7 dB of Shannon limit. DVB-S2 uses LDPC + BCH outer code. Code rates: 1/4 to 9/10. Turbo codes used in 3GPP satellite extensions and military satcom.', kw:['LDPC','turbo','FEC','DVB-S2','Shannon','BCH','coding gain'] },
  // Link Budget
  { cat:'link_budget', title:'Free Space Path Loss (FSPL)', text:'FSPL(dB) = 20·log₁₀(d) + 20·log₁₀(f) + 92.45 (d in km, f in GHz). GEO at 35786 km, 12 GHz: FSPL ≈ 205.7 dB. Increases 6 dB per octave in frequency or distance.', kw:['FSPL','path loss','free space','35786','GEO','propagation','92.45'] },
  { cat:'link_budget', title:'EIRP Calculation', text:'EIRP (dBW) = Tx Power (dBW) + Tx Antenna Gain (dBi) – Feed/Cable Losses (dB). Example: 100W (20 dBW) + 48 dBi = 68 dBW. High EIRP reduces required G/T.', kw:['EIRP','transmit power','antenna gain','cable loss','dBW'] },
  { cat:'link_budget', title:'G/T Figure of Merit', text:'G/T (dB/K) = Receive Gain (dBi) – 10·log₁₀(Tsys). Tsys = Ta + Tf + Tr. Typical GEO ground: 10–20 dB/K. LEO: 5–15 dB/K. Higher G/T improves CNR without changing transmit side.', kw:['G/T','noise temperature','receive','figure of merit','system noise','Tsys'] },
  { cat:'link_budget', title:'CNR Calculation', text:'C/N (dB) = EIRP – FSPL – Other Losses + G/T – k – B. k = Boltzmann = -228.6 dBW/K/Hz. B = bandwidth in dBHz. Minimum CNR depends on modulation/FEC: QPSK+DVB-S2 needs ~2 dB.', kw:['CNR','carrier to noise','Boltzmann','bandwidth','link margin','dB'] },
  { cat:'link_budget', title:'Link Margin', text:'Link Margin = Available CNR – Required CNR. Typical margin: 3–6 dB clear sky, plus rain margin (Ku: 3 dB, Ka: 10 dB). Margins protect against pointing errors, equipment aging, atmospheric events.', kw:['link margin','rain margin','clear sky','margin budget','CNR required'] },
  { cat:'link_budget', title:'Atmospheric Losses', text:'Clear sky: 0.1–0.5 dB (troposphere, ionosphere). Rain: 0.5 dB (C-band) to 20+ dB (Ka-band). Gaseous absorption peaks: 22.3 GHz (water vapor), 60 GHz (oxygen). ITU-R P.618 for rain attenuation models.', kw:['atmospheric loss','rain attenuation','gaseous','ITU-R','P.618','troposphere'] },
  // Orbits
  { cat:'orbit', title:'GEO – Geostationary Orbit', text:'Geostationary orbit at 35,786 km altitude. Orbital period = 24h (sidereal: 23h 56m). Fixed position relative to Earth. One-way propagation delay: ~119 ms (270 ms round-trip). Coverage: ±75° latitude. 3 GEO satellites can cover globe except poles.', kw:['GEO','geostationary','35786 km','270ms latency','coverage','Clarke Belt'] },
  { cat:'orbit', title:'LEO – Low Earth Orbit', text:'LEO: 200–2000 km altitude. Period: 90–127 min. Low latency: 1–20 ms. High Doppler shift (±47 kHz at L-band for 780 km). Constellations: Starlink (550 km), OneWeb (1200 km), Iridium (780 km). Need large numbers for global coverage.', kw:['LEO','low earth orbit','Starlink','OneWeb','Iridium','Doppler','latency','constellation'] },
  { cat:'orbit', title:'MEO – Medium Earth Orbit', text:'MEO: 2000–35786 km. GPS at 20200 km (period 12h). Galileo at 23222 km. O3b/SES MEO constellation at 8062 km (70ms RTT). Compromise between LEO coverage and GEO latency.', kw:['MEO','medium earth orbit','GPS','Galileo','O3b','SES','8062 km','navigation'] },
  { cat:'orbit', title:'HEO – Highly Elliptical Orbit', text:'Highly Elliptical Orbit: Molniya (apogee 40000 km, perigee 500 km, period 12h). Tundra orbit (period 24h, apogee ~54000 km). Excellent polar/high latitude coverage. Russian communications historically used Molniya.', kw:['HEO','Molniya','Tundra','elliptical','polar','apogee','perigee'] },
  // Standards
  { cat:'standards', title:'DVB-S2 Standard', text:'DVB-S2 (EN 302 307-1): 2nd gen digital video broadcasting. MODCODs: QPSK to 32APSK, code rates 1/4–9/10. ACM per frame. Roll-off: 0.35/0.25/0.20. Used in DTH, broadband, DSNG, professional video.', kw:['DVB-S2','MODCOD','ACM','roll-off','DTH','DSNG','EN 302 307'] },
  { cat:'standards', title:'DVB-S2X Standard', text:'DVB-S2X (EN 302 307-2): Extension of DVB-S2. Additional MODCODs (64APSK, 128APSK, 256APSK). Narrower roll-off (0.05, 0.10, 0.15). Channel bonding. Allows >100 Gbps HTS transponders.', kw:['DVB-S2X','64APSK','256APSK','channel bonding','HTS','EN 302 307-2'] },
  { cat:'standards', title:'CCSDS Protocols', text:'Consultative Committee for Space Data Systems. Telecommand: CCSDS 200.0-G. Telemetry: CCSDS 102.0-B. AOS (Advanced Orbiting Systems): CCSDS 732.0-B. Used by NASA, ESA, JAXA for space missions.', kw:['CCSDS','telecommand','telemetry','AOS','NASA','ESA','JAXA','space mission'] },
  { cat:'standards', title:'VSAT Standards', text:'VSAT (Very Small Aperture Terminal): 0.6–2.4m dish. DVB-S2/RCS2 for broadband. SCPC for voice/thin-route. Hub-and-spoke topology. Star or mesh architectures. Inroute: MF-TDMA, outroute: TDM.', kw:['VSAT','DVB-RCS2','SCPC','MF-TDMA','hub','spoke','star','mesh'] },
  // Troubleshooting
  { cat:'troubleshoot', title:'Low CNR / Signal Loss', text:'Troubleshoot low CNR: 1) Check antenna pointing (use spectrum analyzer or satellite beacon). 2) Verify EIRP vs link budget. 3) Check for rain/weather events (compare to ITU-R P.618 model). 4) Inspect cable/connector losses. 5) Verify LNB/BUC health (noise figure, gain). 6) Check for adjacent satellite interference.', kw:['CNR','signal loss','antenna pointing','LNB','BUC','rain','interference'] },
  { cat:'troubleshoot', title:'Rain Fade Mitigation', text:'Rain fade mitigation techniques: 1) ACM (Adaptive Coding and Modulation) – automatically lowers data rate to maintain link. 2) ULPC (Uplink Power Control) – increase transmit power during rain. 3) Site diversity – switch to geographically separated site. 4) Fade margin design. 5) Move to lower frequency band. ITU-R P.618 rain model for margin calculation.', kw:['rain fade','ACM','ULPC','site diversity','fade margin','ITU-R P.618'] },
  { cat:'troubleshoot', title:'Interference Problems', text:'Interference types and diagnosis: 1) CCI (Co-Channel): reduce guard band, repoint antenna, increase C/I. 2) Cross-pol: check feed alignment, measure XPD (>25 dB needed). 3) Intermod: back off HPA 3–6 dB. 4) Terrestrial: coordinate spectrum with regulator. Tools: spectrum analyzer, signal level meter, IM products calculator.', kw:['interference','CCI','cross-pol','intermod','HPA backoff','XPD','spectrum'] },
  { cat:'troubleshoot', title:'Antenna Pointing Errors', text:'Antenna pointing loss: ΔG (dB) = -12·(θ/θ₃dB)². Steps to correct: 1) Get current orbital elements (TLE) from Celestrak/Space-Track. 2) Calculate Az/El/Pol from observer position. 3) Peak on satellite beacon. 4) Check auto-tracking errors. 5) Validate actuator/motor calibration. Typical 3dB beamwidth: 0.5° for 3m Ku-band antenna.', kw:['antenna pointing','beamwidth','TLE','azimuth','elevation','beacon','auto-tracking'] },
  { cat:'troubleshoot', title:'Modem & Equipment Faults', text:'Common modem issues: 1) Symbol rate mismatch – verify carrier parameters. 2) LO (Local Oscillator) drift – check frequency reference (10 MHz Rb/GPS disciplined). 3) Spectral inversion – toggle IF inversion setting. 4) Power supply issues – check voltages. 5) BUC overcurrent – reduce TX power. Check modem logs for LDPC/Viterbi errors.', kw:['modem','symbol rate','LO drift','10MHz reference','spectral inversion','BUC','LDPC errors'] }
];

// ─── Watsonx.ai integration ───────────────────────────────────────────────────
let watsonxToken   = null;
let watsonxTokenExpiry = 0;

async function getWatsonxToken() {
  const apiKey = process.env.WATSONX_API_KEY;
  if (!apiKey || apiKey === 'your_ibm_watsonx_api_key_here') return null;
  if (watsonxToken && Date.now() < watsonxTokenExpiry) return watsonxToken;
  try {
    const fetch = require('node-fetch');
    const res = await fetch('https://iam.cloud.ibm.com/identity/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn:ibm:params:oauth:grant-type:apikey&apikey=${encodeURIComponent(apiKey)}`,
      timeout: 10000
    });
    if (!res.ok) return null;
    const data = await res.json();
    watsonxToken       = data.access_token;
    watsonxTokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
    return watsonxToken;
  } catch { return null; }
}

async function callWatsonx(prompt, context) {
  const token = await getWatsonxToken();
  if (!token) return null;
  try {
    const fetch = require('node-fetch');
    const body = {
      model_id: process.env.WATSONX_MODEL_ID || 'ibm/granite-13b-chat-v2',
      input: `${context ? context + '\n\n' : ''}User: ${prompt}\nAssistant:`,
      parameters: { decoding_method: 'greedy', max_new_tokens: 800, min_new_tokens: 10, repetition_penalty: 1.1 },
      project_id: process.env.WATSONX_PROJECT_ID
    };
    const res = await fetch(`${process.env.WATSONX_URL || 'https://us-south.ml.cloud.ibm.com'}/ml/v1/text/generation?version=2023-05-29`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify(body),
      timeout: 30000
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.results?.[0]?.generated_text?.trim() || null;
  } catch { return null; }
}

// ─── RAG: search knowledge base ───────────────────────────────────────────────
function searchKnowledge(query, topK = 5) {
  const q = query.toLowerCase();
  const scored = KNOWLEDGE.map(item => {
    let score = 0;
    const text = (item.title + ' ' + item.text + ' ' + item.kw.join(' ')).toLowerCase();
    // keyword match
    q.split(/\s+/).forEach(word => { if (word.length > 2 && text.includes(word)) score += 3; });
    // category bonus
    item.kw.forEach(kw => { if (q.includes(kw.toLowerCase())) score += 2; });
    if (text.includes(q)) score += 10;
    return { ...item, score };
  }).filter(i => i.score > 0).sort((a, b) => b.score - a.score).slice(0, topK);
  return scored;
}

// ─── Built-in AI responder ────────────────────────────────────────────────────
function builtInResponse(query, docs = []) {
  const q   = query.toLowerCase();
  const kbs = searchKnowledge(query, 5);

  // Synthesise answer from top KB hits
  let answer = '';
  if (kbs.length > 0) {
    const top = kbs[0];
    answer = `**${top.title}**\n\n${top.text}`;
    if (kbs.length > 1) {
      answer += '\n\n**Related topics:**\n';
      kbs.slice(1, 4).forEach(k => { answer += `\n• **${k.title}**: ${k.text.substring(0, 120)}…`; });
    }
  }

  // Document context injection
  if (docs.length > 0) {
    const docSnippets = docs.map(d => d.extracted_text ? d.extracted_text.substring(0, 500) : '').filter(Boolean);
    if (docSnippets.length > 0) {
      answer += '\n\n**From your uploaded documents:**\n' + docSnippets.slice(0,2).map(s => `> ${s.substring(0, 300)}…`).join('\n\n');
    }
  }

  // Specific intent responses
  if (!answer) {
    if (q.match(/hello|hi|hey|greet/)) {
      answer = "Hello! I'm **OrbitIQ**, your satellite communication assistant. I can help with:\n\n• **Frequency bands** (L, S, C, X, Ku, Ka, V)\n• **Modulation schemes** (BPSK, QPSK, 8PSK, APSK, OFDM)\n• **Link budget calculations** (FSPL, EIRP, G/T, CNR)\n• **Orbital mechanics** (GEO, LEO, MEO, HEO)\n• **Troubleshooting** (rain fade, interference, pointing errors)\n• **Standards** (DVB-S2, DVB-S2X, CCSDS, VSAT)\n\nWhat would you like to know?";
    } else if (q.match(/frequenc|band|ghz|mhz/)) {
      answer = "Satellite frequency bands are allocated by the ITU:\n\n| Band | Range | Primary Use |\n|------|-------|-------------|\n| **L** | 1–2 GHz | GPS, mobile satellite |\n| **S** | 2–4 GHz | NASA, weather, LEO |\n| **C** | 4–8 GHz | Legacy TV, FSS |\n| **X** | 8–12 GHz | Military, SAR |\n| **Ku** | 12–18 GHz | VSAT, DTH |\n| **Ka** | 26.5–40 GHz | HTS broadband |\n\nHigher frequencies offer more bandwidth but increase rain fade sensitivity.";
    } else if (q.match(/orbit|leo|geo|meo|altitude/)) {
      answer = "**Satellite Orbit Types:**\n\n🛰️ **GEO** (35,786 km) – Fixed coverage, 270ms latency, 3 satellites = global\n🛰️ **LEO** (200–2000 km) – Low latency (1–20ms), large constellations needed (Starlink, OneWeb)\n🛰️ **MEO** (2000–35786 km) – GPS, Galileo, O3b MEO\n🛰️ **HEO** – Molniya/Tundra for polar coverage\n\nOrbit choice depends on latency, coverage, and application requirements.";
    } else {
      answer = "I'm a specialist in satellite communications. I can help with frequency band selection, modulation schemes, link budgets, orbital mechanics, and troubleshooting.\n\nPlease ask about a specific topic like:\n• \"What is the FSPL at 12 GHz for a GEO satellite?\"\n• \"Explain Ku-band rain fade mitigation\"\n• \"How do I calculate EIRP?\"\n• \"What modulation does DVB-S2 use?\"";
    }
  }

  return answer;
}

// ─── Multer file upload ───────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename:    (req, file, cb) => cb(null, `${uuidv4()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g,'_')}`)
});
const upload = multer({
  storage,
  limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE_MB || '10') * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain','text/markdown','text/csv','application/csv','application/octet-stream'];
    const allowedExt = ['.pdf','.docx','.txt','.md','.csv'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(file.mimetype) || allowedExt.includes(ext)) cb(null, true);
    else cb(new Error(`File type not allowed. Supported: PDF, DOCX, TXT, MD, CSV`));
  }
});

// ─── Text extraction helpers ──────────────────────────────────────────────────
async function extractText(filePath, mimeType, originalName) {
  const ext = path.extname(originalName).toLowerCase();
  try {
    if (ext === '.pdf') {
      const pdfParse = require('pdf-parse');
      const buf = fs.readFileSync(filePath);
      const data = await pdfParse(buf);
      return data.text || '';
    }
    if (ext === '.docx') {
      const mammoth = require('mammoth');
      const result  = await mammoth.extractRawText({ path: filePath });
      return result.value || '';
    }
    if (['.txt', '.md', '.csv'].includes(ext)) {
      return fs.readFileSync(filePath, 'utf8');
    }
  } catch (e) { console.error('Text extraction error:', e.message); }
  return '';
}

// ─── Helper: db query with fallback ──────────────────────────────────────────
async function dbQuery(sql, params) {
  if (!pool) throw new Error('DB not available');
  const [rows] = await pool.query(sql, params);
  return rows;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  API ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Health ───────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0', db: dbAvailable, app: 'OrbitIQ', timestamp: new Date().toISOString() });
});

// ─── Dashboard Stats ──────────────────────────────────────────────────────────
app.get('/api/stats', async (req, res) => {
  try {
    if (dbAvailable) {
      const [sessions]    = await pool.query('SELECT COUNT(*) AS c FROM chat_sessions');
      const [messages]    = await pool.query('SELECT COUNT(*) AS c FROM chat_messages WHERE role="user"');
      const [docs]        = await pool.query('SELECT COUNT(*) AS c FROM documents WHERE status="ready"');
      const [lbs]         = await pool.query('SELECT COUNT(*) AS c FROM link_budgets');
      const [kbCount]     = await pool.query('SELECT COUNT(*) AS c FROM knowledge_articles');
      res.json({
        totalSessions:      sessions[0].c,
        totalQueries:       messages[0].c,
        docsUploaded:       docs[0].c,
        linkBudgetsComputed: lbs[0].c,
        knowledgeArticles:  kbCount[0].c + KNOWLEDGE.length,
        uptime:             Math.floor(process.uptime())
      });
    } else {
      res.json({
        totalSessions:      Object.keys(inMemory.sessions).length,
        totalQueries:       inMemory.stats.chats,
        docsUploaded:       inMemory.documents.filter(d => d.status === 'ready').length,
        linkBudgetsComputed: inMemory.linkBudgets.length,
        knowledgeArticles:  KNOWLEDGE.length,
        uptime:             Math.floor(process.uptime())
      });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Knowledge Base ───────────────────────────────────────────────────────────
app.get('/api/knowledge', (req, res) => {
  const { category, search } = req.query;
  let items = [...KNOWLEDGE];
  if (category) items = items.filter(k => k.cat === category);
  if (search)   items = searchKnowledge(search, 20);
  res.json({ items: items.map(k => ({ category: k.cat, title: k.title, text: k.text, keywords: k.kw })), total: items.length });
});

app.get('/api/knowledge/categories', (req, res) => {
  const cats = [...new Set(KNOWLEDGE.map(k => k.cat))];
  res.json({ categories: cats });
});

// ─── Chat Sessions ────────────────────────────────────────────────────────────
app.get('/api/chat/sessions', async (req, res) => {
  try {
    if (dbAvailable) {
      const rows = await dbQuery('SELECT * FROM chat_sessions ORDER BY updated_at DESC LIMIT 50');
      res.json({ sessions: rows });
    } else {
      const sessions = Object.values(inMemory.sessions).sort((a,b) => new Date(b.updated_at) - new Date(a.updated_at));
      res.json({ sessions });
    }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/chat/sessions', async (req, res) => {
  const id    = uuidv4();
  const title = req.body.title || 'New Session';
  const now   = new Date().toISOString();
  try {
    if (dbAvailable) {
      await dbQuery('INSERT INTO chat_sessions (id, title) VALUES (?, ?)', [id, title]);
    } else {
      inMemory.sessions[id] = { id, title, created_at: now, updated_at: now };
      inMemory.messages[id] = [];
      inMemory.stats.sessions++;
    }
    res.json({ id, title, created_at: now });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/chat/sessions/:id/messages', async (req, res) => {
  const { id } = req.params;
  try {
    if (dbAvailable) {
      const rows = await dbQuery('SELECT * FROM chat_messages WHERE session_id=? ORDER BY created_at ASC', [id]);
      res.json({ messages: rows });
    } else {
      res.json({ messages: inMemory.messages[id] || [] });
    }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Main Chat API ────────────────────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  const { message, session_id, use_documents } = req.body;
  if (!message) return res.status(400).json({ error: 'message is required' });

  inMemory.stats.chats++;
  let sid = session_id;

  try {
    // Create session if not provided
    if (!sid) {
      sid = uuidv4();
      if (dbAvailable) {
        await dbQuery('INSERT INTO chat_sessions (id, title) VALUES (?, ?)', [sid, message.substring(0, 50)]);
      } else {
        const now = new Date().toISOString();
        inMemory.sessions[sid] = { id: sid, title: message.substring(0,50), created_at: now, updated_at: now };
        inMemory.messages[sid] = [];
      }
    }

    // Save user message
    if (dbAvailable) {
      await dbQuery('INSERT INTO chat_messages (session_id, role, content) VALUES (?,?,?)', [sid, 'user', message]);
    } else {
      const msgs = inMemory.messages[sid] || [];
      msgs.push({ id: Date.now(), session_id: sid, role: 'user', content: message, created_at: new Date().toISOString() });
      inMemory.messages[sid] = msgs;
    }

    // Gather document context if requested
    let docs = [];
    if (use_documents) {
      docs = dbAvailable
        ? await dbQuery("SELECT extracted_text FROM documents WHERE status='ready' ORDER BY created_at DESC LIMIT 3")
        : inMemory.documents.filter(d => d.status === 'ready').slice(0, 3);
    }

    // Try Watsonx first, fall back to built-in
    let reply   = null;
    let modelUsed = 'built-in';

    const kbHits   = searchKnowledge(message, 4);
    const kbContext = kbHits.map(k => `${k.title}: ${k.text}`).join('\n');
    const systemCtx = `You are OrbitIQ, an expert satellite communication assistant. Answer precisely using the knowledge below. Be concise and use markdown formatting.\n\nKnowledge:\n${kbContext}`;

    reply = await callWatsonx(message, systemCtx);
    if (reply) {
      modelUsed = process.env.WATSONX_MODEL_ID || 'ibm/granite-13b-chat-v2';
    } else {
      reply = builtInResponse(message, docs);
    }

    // Save assistant message
    if (dbAvailable) {
      await dbQuery('INSERT INTO chat_messages (session_id, role, content, model_used) VALUES (?,?,?,?)',
        [sid, 'assistant', reply, modelUsed]);
      await dbQuery('UPDATE chat_sessions SET updated_at=NOW() WHERE id=?', [sid]);
    } else {
      const msgs = inMemory.messages[sid] || [];
      msgs.push({ id: Date.now()+1, session_id: sid, role: 'assistant', content: reply, model_used: modelUsed, created_at: new Date().toISOString() });
      inMemory.messages[sid] = msgs;
    }

    res.json({ reply, session_id: sid, model_used: modelUsed, knowledge_used: kbHits.map(k => k.title) });

  } catch (e) {
    console.error('Chat error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ─── Troubleshooting API ──────────────────────────────────────────────────────
app.post('/api/troubleshoot', async (req, res) => {
  const { symptoms } = req.body;
  if (!symptoms) return res.status(400).json({ error: 'symptoms are required' });

  const kbHits = searchKnowledge(symptoms, 5).filter(k => k.cat === 'troubleshoot' || k.score > 5);
  let diagnosis = '';
  let recommendations = [];

  if (kbHits.length > 0) {
    const top = kbHits[0];
    diagnosis = top.text;
    recommendations = kbHits.slice(1, 4).map(k => `**${k.title}**: ${k.text.substring(0, 200)}`);
  } else {
    diagnosis = 'Based on the described symptoms, please check the following general satellite link troubleshooting steps.';
    recommendations = [
      'Check physical layer: cable connections, connectors, LNB/BUC operation',
      'Verify antenna pointing using a satellite finder or spectrum analyzer',
      'Confirm link budget parameters against measured signal levels',
      'Check for local interference sources with spectrum analyzer',
      'Review equipment logs for fault codes or alarms'
    ];
  }

  // Try Watsonx for enhanced diagnosis
  const watsonxDiag = await callWatsonx(
    `Satellite communication problem: ${symptoms}. Provide a technical diagnosis and 3 actionable recommendations.`,
    'You are an expert satellite communications engineer. Be specific and technical.'
  );

  if (watsonxDiag) diagnosis = watsonxDiag;

  if (dbAvailable) {
    try {
      await dbQuery('INSERT INTO troubleshoot_logs (symptoms, diagnosis, recommendations) VALUES (?,?,?)',
        [symptoms, diagnosis, recommendations.join('\n')]);
    } catch(e) { /* non-critical */ }
  }

  res.json({ diagnosis, recommendations, related_kb: kbHits.map(k => ({ title: k.title, category: k.cat })) });
});

// ─── Link Budget Calculator ───────────────────────────────────────────────────
app.post('/api/link-budget', async (req, res) => {
  const {
    name            = 'Link Budget',
    frequency_ghz,
    tx_power_dbw,
    tx_gain_dbi,
    rx_gain_dbi,
    distance_km,
    system_noise_temp_k,
    bandwidth_hz,
    atmospheric_loss_db  = 0.5,
    pointing_loss_db     = 0.5
  } = req.body;

  // Validate
  const required = { frequency_ghz, tx_power_dbw, tx_gain_dbi, rx_gain_dbi, distance_km, system_noise_temp_k, bandwidth_hz };
  for (const [k, v] of Object.entries(required)) {
    if (v === undefined || v === null || v === '') return res.status(400).json({ error: `${k} is required` });
    if (isNaN(parseFloat(v))) return res.status(400).json({ error: `${k} must be a number` });
  }

  const f   = parseFloat(frequency_ghz);
  const d   = parseFloat(distance_km);
  const Pt  = parseFloat(tx_power_dbw);
  const Gt  = parseFloat(tx_gain_dbi);
  const Gr  = parseFloat(rx_gain_dbi);
  const Ts  = parseFloat(system_noise_temp_k);
  const BW  = parseFloat(bandwidth_hz);
  const La  = parseFloat(atmospheric_loss_db);
  const Lp  = parseFloat(pointing_loss_db);

  if (f <= 0 || d <= 0 || Ts <= 0 || BW <= 0) return res.status(400).json({ error: 'Frequency, distance, noise temperature, and bandwidth must be positive.' });

  // Calculations
  const EIRP   = parseFloat((Pt + Gt).toFixed(4));                               // dBW
  const FSPL   = parseFloat((20 * Math.log10(d) + 20 * Math.log10(f) + 92.45).toFixed(4)); // dB
  const Pr     = parseFloat((EIRP - FSPL - La - Lp + Gr).toFixed(4));            // dBW
  const k      = -228.6;                                                           // dBW/K/Hz (Boltzmann)
  const Pn     = parseFloat((k + 10 * Math.log10(Ts) + 10 * Math.log10(BW)).toFixed(4)); // dBW
  const CNR    = parseFloat((Pr - Pn).toFixed(4));                               // dB
  const GT     = parseFloat((Gr - 10 * Math.log10(Ts)).toFixed(4));              // dB/K

  // Required CNR for QPSK/DVB-S2 at BER 1e-7 ≈ 3.5 dB
  const reqCNR = 3.5;
  const margin = parseFloat((CNR - reqCNR).toFixed(4));

  const result = {
    name,
    inputs: { frequency_ghz: f, tx_power_dbw: Pt, tx_gain_dbi: Gt, rx_gain_dbi: Gr, distance_km: d, system_noise_temp_k: Ts, bandwidth_hz: BW, atmospheric_loss_db: La, pointing_loss_db: Lp },
    results: {
      eirp_dbw:             EIRP,
      fspl_db:              FSPL,
      received_power_dbw:   Pr,
      noise_power_dbw:      Pn,
      cnr_db:               CNR,
      gt_db_per_k:          GT,
      link_margin_db:       margin,
      link_status:          margin >= 3 ? 'EXCELLENT' : margin >= 0 ? 'MARGINAL' : 'INSUFFICIENT'
    },
    interpretation: {
      link_margin_db: margin,
      status:         margin >= 6 ? 'Excellent – strong link margin' : margin >= 3 ? 'Good – adequate margin' : margin >= 0 ? 'Marginal – risk of outage in rain' : 'Insufficient – link will fail',
      recommendation: margin < 3 ? 'Increase EIRP, reduce bandwidth, upgrade antenna, or add rain margin.' : 'Link is healthy. Monitor during rain events for Ka/Ku links.'
    }
  };

  inMemory.linkBudgets.push(result);
  inMemory.stats.linkBudgets++;

  if (dbAvailable) {
    try {
      await dbQuery(
        'INSERT INTO link_budgets (name,frequency_ghz,tx_power_dbw,tx_gain_dbi,rx_gain_dbi,distance_km,system_noise_temp_k,bandwidth_hz,atmospheric_loss_db,pointing_loss_db,eirp_dbw,fspl_db,received_power_dbw,noise_power_dbw,cnr_db,link_margin_db) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [name, f, Pt, Gt, Gr, d, Ts, BW, La, Lp, EIRP, FSPL, Pr, Pn, CNR, margin]
      );
    } catch(e) { /* non-critical */ }
  }

  res.json(result);
});

app.get('/api/link-budget/history', async (req, res) => {
  try {
    if (dbAvailable) {
      const rows = await dbQuery('SELECT * FROM link_budgets ORDER BY created_at DESC LIMIT 20');
      res.json({ history: rows });
    } else {
      res.json({ history: inMemory.linkBudgets.slice(-20).reverse() });
    }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Frequency Band Info API ──────────────────────────────────────────────────
app.get('/api/frequency-bands', (req, res) => {
  res.json({ bands: [
    { band:'L',  range:'1–2 GHz',      use:'GPS, mobile satellite, Iridium, Inmarsat',       rain_fade:'Very Low',  typical_link_margin_db: 1,  color:'#4ade80' },
    { band:'S',  range:'2–4 GHz',      use:'NASA deep space, weather radar, LEO tracking',   rain_fade:'Low',       typical_link_margin_db: 1.5, color:'#34d399' },
    { band:'C',  range:'4–8 GHz',      use:'Legacy satellite TV, FSS, global broadband',     rain_fade:'Low',       typical_link_margin_db: 2,  color:'#22d3ee' },
    { band:'X',  range:'8–12 GHz',     use:'Military, Earth observation SAR radar',          rain_fade:'Moderate',  typical_link_margin_db: 3,  color:'#60a5fa' },
    { band:'Ku', range:'12–18 GHz',    use:'DTH TV, VSAT internet, news gathering',          rain_fade:'Moderate-High', typical_link_margin_db:5, color:'#a78bfa' },
    { band:'Ka', range:'26.5–40 GHz',  use:'HTS broadband, ViaSat, Hughes, Starlink',        rain_fade:'High',      typical_link_margin_db: 12, color:'#f472b6' },
    { band:'V',  range:'40–75 GHz',    use:'Feeder links, 5G NTN, research',                 rain_fade:'Very High',  typical_link_margin_db: 20, color:'#fb923c' }
  ]});
});

// ─── Modulation Schemes API ───────────────────────────────────────────────────
app.get('/api/modulations', (req, res) => {
  res.json({ modulations: [
    { name:'BPSK',   bits_per_symbol:1, spectral_eff:'1 bps/Hz',   req_eb_n0_db:10.5, req_cnr_db:7.0,  use:'Deep space, GPS, emergency beacons',   robustness:10, standard:'CCSDS, NASA' },
    { name:'QPSK',   bits_per_symbol:2, spectral_eff:'2 bps/Hz',   req_eb_n0_db:10.5, req_cnr_db:10.0, use:'Standard satellite uplinks, DVB-S',     robustness:9,  standard:'DVB-S, CCSDS' },
    { name:'8PSK',   bits_per_symbol:3, spectral_eff:'3 bps/Hz',   req_eb_n0_db:14.0, req_cnr_db:14.0, use:'DVB-S2 medium links',                   robustness:7,  standard:'DVB-S2' },
    { name:'16APSK', bits_per_symbol:4, spectral_eff:'4 bps/Hz',   req_eb_n0_db:17.5, req_cnr_db:16.0, use:'DVB-S2 HTS forward links',              robustness:6,  standard:'DVB-S2' },
    { name:'32APSK', bits_per_symbol:5, spectral_eff:'5 bps/Hz',   req_eb_n0_db:20.5, req_cnr_db:19.0, use:'DVB-S2 highest throughput',             robustness:4,  standard:'DVB-S2' },
    { name:'16QAM',  bits_per_symbol:4, spectral_eff:'4 bps/Hz',   req_eb_n0_db:17.5, req_cnr_db:16.5, use:'HTS return channel, DVB-RCS2',          robustness:5,  standard:'DVB-RCS2' },
    { name:'64QAM',  bits_per_symbol:6, spectral_eff:'6 bps/Hz',   req_eb_n0_db:23.5, req_cnr_db:22.5, use:'DVB-S2X very high CNR links only',      robustness:2,  standard:'DVB-S2X' },
    { name:'OFDM',   bits_per_symbol:null, spectral_eff:'Variable', req_eb_n0_db:null, req_cnr_db:null, use:'DVB-S2X multipath environments',        robustness:8,  standard:'DVB-S2X, 5G NTN' }
  ]});
});

// ─── Document Upload ──────────────────────────────────────────────────────────
app.post('/api/documents/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const doc = {
    id:            uuidv4(),
    filename:      req.file.filename,
    original_name: req.file.originalname,
    mime_type:     req.file.mimetype,
    file_size:     req.file.size,
    file_path:     req.file.path,
    status:        'processing',
    created_at:    new Date().toISOString()
  };

  if (dbAvailable) {
    try {
      await dbQuery('INSERT INTO documents (id,filename,original_name,mime_type,file_size,file_path,status) VALUES (?,?,?,?,?,?,?)',
        [doc.id, doc.filename, doc.original_name, doc.mime_type, doc.file_size, doc.file_path, 'processing']);
    } catch(e) { /* continue */ }
  } else {
    inMemory.documents.push(doc);
    inMemory.stats.docsUploaded++;
  }

  // Extract text asynchronously
  extractText(req.file.path, req.file.mimetype, req.file.originalname).then(async text => {
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    if (dbAvailable) {
      try {
        await dbQuery('UPDATE documents SET extracted_text=?, word_count=?, status="ready" WHERE id=?',
          [text.substring(0, 1000000), wordCount, doc.id]);
      } catch(e) { /* non-critical */ }
    } else {
      const d = inMemory.documents.find(x => x.id === doc.id);
      if (d) { d.extracted_text = text; d.word_count = wordCount; d.status = 'ready'; }
    }
  }).catch(e => {
    console.error('Extract error:', e.message);
    if (!dbAvailable) {
      const d = inMemory.documents.find(x => x.id === doc.id);
      if (d) { d.status = 'error'; d.error_message = e.message; }
    }
  });

  res.json({ id: doc.id, original_name: doc.original_name, file_size: doc.file_size, status: 'processing', message: 'File uploaded successfully. Text extraction in progress.' });
});

app.get('/api/documents', async (req, res) => {
  try {
    if (dbAvailable) {
      const rows = await dbQuery('SELECT id,filename,original_name,mime_type,file_size,word_count,status,created_at FROM documents ORDER BY created_at DESC');
      res.json({ documents: rows });
    } else {
      const docs = inMemory.documents.map(({ extracted_text: _et, ...d }) => d);
      res.json({ documents: docs });
    }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/documents/:id', async (req, res) => {
  const { id } = req.params;
  try {
    let fp = null;
    if (dbAvailable) {
      const rows = await dbQuery('SELECT file_path FROM documents WHERE id=?', [id]);
      if (rows.length) { fp = rows[0].file_path; await dbQuery('DELETE FROM documents WHERE id=?', [id]); }
    } else {
      const idx = inMemory.documents.findIndex(d => d.id === id);
      if (idx >= 0) { fp = inMemory.documents[idx].file_path; inMemory.documents.splice(idx, 1); }
    }
    if (fp && fs.existsSync(fp)) fs.unlinkSync(fp);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Catch-all → serve frontend ───────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

// ─── Error handler ────────────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error('Unhandled error:', err.message);
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File too large. Max size: ' + (process.env.MAX_FILE_SIZE_MB || 10) + ' MB' });
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// ─── Boot ─────────────────────────────────────────────────────────────────────
async function start() {
  await initDB();
  app.listen(PORT, () => {
    console.log('\n╔══════════════════════════════════════════════════╗');
    console.log('║   🛰️  OrbitIQ – Satellite Knowledge Assistant     ║');
    console.log('╠══════════════════════════════════════════════════╣');
    console.log(`║   Server  : http://localhost:${PORT}                ║`);
    console.log(`║   Database: ${dbAvailable ? 'MySQL Connected ✅            ' : 'In-Memory Mode ⚡          '}  ║`);
    console.log(`║   Watsonx : ${process.env.WATSONX_API_KEY && process.env.WATSONX_API_KEY !== 'your_ibm_watsonx_api_key_here' ? 'Configured ✅              ' : 'Built-in AI Mode ⚡        '}  ║`);
    console.log('╚══════════════════════════════════════════════════╝\n');
  });
}

start();
