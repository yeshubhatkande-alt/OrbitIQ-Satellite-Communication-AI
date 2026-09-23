-- OrbitIQ Database Schema
-- MySQL 8.0+
-- Run: mysql -u root -p < schema.sql

CREATE DATABASE IF NOT EXISTS orbitiq_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE orbitiq_db;

-- ─── Chat Sessions ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chat_sessions (
    id VARCHAR(36) PRIMARY KEY,
    title VARCHAR(255) DEFAULT 'New Session',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- ─── Chat Messages ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chat_messages (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    session_id VARCHAR(36) NOT NULL,
    role ENUM('user', 'assistant') NOT NULL,
    content TEXT NOT NULL,
    tokens_used INT DEFAULT 0,
    model_used VARCHAR(100) DEFAULT 'built-in',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_session (session_id),
    FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
);

-- ─── Uploaded Documents ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS documents (
    id VARCHAR(36) PRIMARY KEY,
    filename VARCHAR(255) NOT NULL,
    original_name VARCHAR(255) NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    file_size BIGINT NOT NULL,
    file_path VARCHAR(500) NOT NULL,
    extracted_text LONGTEXT,
    word_count INT DEFAULT 0,
    status ENUM('processing', 'ready', 'error') DEFAULT 'processing',
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_status (status)
);

-- ─── Link Budget Calculations ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS link_budgets (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) DEFAULT 'Link Budget',
    frequency_ghz DECIMAL(10,4) NOT NULL,
    tx_power_dbw DECIMAL(10,4) NOT NULL,
    tx_gain_dbi DECIMAL(10,4) NOT NULL,
    rx_gain_dbi DECIMAL(10,4) NOT NULL,
    distance_km DECIMAL(12,4) NOT NULL,
    system_noise_temp_k DECIMAL(10,4) NOT NULL,
    bandwidth_hz DECIMAL(15,4) NOT NULL,
    atmospheric_loss_db DECIMAL(10,4) DEFAULT 0.5,
    pointing_loss_db DECIMAL(10,4) DEFAULT 0.5,
    eirp_dbw DECIMAL(10,4),
    fspl_db DECIMAL(10,4),
    received_power_dbw DECIMAL(10,4),
    noise_power_dbw DECIMAL(10,4),
    cnr_db DECIMAL(10,4),
    link_margin_db DECIMAL(10,4),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ─── Knowledge Base Articles ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS knowledge_articles (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    category VARCHAR(100) NOT NULL,
    title VARCHAR(255) NOT NULL,
    content LONGTEXT NOT NULL,
    keywords TEXT,
    source VARCHAR(100) DEFAULT 'built-in',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_category (category),
    FULLTEXT idx_search (title, content, keywords)
);

-- ─── Dashboard Stats (aggregated) ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS usage_stats (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    stat_date DATE NOT NULL,
    chat_queries INT DEFAULT 0,
    link_budgets_computed INT DEFAULT 0,
    documents_uploaded INT DEFAULT 0,
    unique_sessions INT DEFAULT 0,
    UNIQUE KEY uq_date (stat_date)
);

-- ─── Troubleshoot Logs ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS troubleshoot_logs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    symptoms TEXT NOT NULL,
    diagnosis TEXT,
    recommendations TEXT,
    resolved BOOLEAN DEFAULT FALSE,
    session_id VARCHAR(36),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ─── Seed: knowledge articles ─────────────────────────────────────────────────
INSERT IGNORE INTO knowledge_articles (category, title, content, keywords) VALUES
('frequency', 'L-Band Frequencies', 'L-Band covers 1–2 GHz. Used in GPS (1.176–1.575 GHz), Iridium mobile satellite, Inmarsat. Advantages: minimal rain fade, good propagation. Disadvantages: lower bandwidth, larger antennas needed.', 'L-band, GPS, Iridium, Inmarsat, 1GHz, 2GHz'),
('frequency', 'S-Band Frequencies', 'S-Band covers 2–4 GHz. Used in NASA deep space (2.025–2.120 GHz), weather radar, mobile satellite. Moderate rain fade, medium bandwidth. Common in LEO tracking stations.', 'S-band, NASA, weather, LEO, 2GHz, 4GHz'),
('frequency', 'C-Band Frequencies', 'C-Band covers 4–8 GHz. Traditional satellite TV (3.7–4.2 GHz downlink, 5.925–6.425 GHz uplink). Good resistance to rain fade, widely deployed globally.', 'C-band, satellite TV, 4GHz, 8GHz, FSS'),
('frequency', 'Ku-Band Frequencies', 'Ku-Band covers 12–18 GHz. DTH broadcasting, VSAT internet. Higher bandwidth than C-Band but more susceptible to rain fade. Link budgets must include rain margin of 3–10 dB.', 'Ku-band, DTH, VSAT, 12GHz, 18GHz, rain fade'),
('frequency', 'Ka-Band Frequencies', 'Ka-Band covers 26.5–40 GHz. HTS (High Throughput Satellites), broadband internet. Very high bandwidth but significant rain fade (10–20+ dB). Requires spot beam technology and frequency reuse.', 'Ka-band, HTS, broadband, 26GHz, 40GHz, spot beam'),
('modulation', 'BPSK Modulation', 'Binary Phase Shift Keying – 1 bit per symbol. Most robust modulation, requires Eb/N0 of ~10.5 dB for BER 1e-6. Used in deep-space links (NASA), GPS. Spectral efficiency: 1 bps/Hz.', 'BPSK, binary, phase, GPS, deep space, BER'),
('modulation', 'QPSK Modulation', 'Quadrature Phase Shift Keying – 2 bits per symbol. Industry standard for satellite links. Requires ~13.5 dB Eb/N0. DVB-S uses QPSK. Spectral efficiency: 2 bps/Hz.', 'QPSK, quadrature, DVB-S, satellite, BER'),
('modulation', '8PSK Modulation', '8-Phase Shift Keying – 3 bits per symbol. Used in DVB-S2 for higher throughput. Requires ~18 dB Eb/N0. More sensitive to noise and phase errors.', '8PSK, DVB-S2, 3 bits, phase'),
('modulation', '16QAM Modulation', '16 Quadrature Amplitude Modulation – 4 bits per symbol. Used when link quality is strong. Requires high CNR (>20 dB). Common in HTS forward links.', '16QAM, amplitude, HTS, forward link, CNR'),
('modulation', 'OFDM Modulation', 'Orthogonal Frequency Division Multiplexing – multi-carrier scheme. Excellent for multipath environments. Used in DVB-S2X. High spectral efficiency but requires linear amplifiers.', 'OFDM, multi-carrier, DVB-S2X, multipath'),
('link_budget', 'Free Space Path Loss', 'FSPL (dB) = 20*log10(d) + 20*log10(f) + 20*log10(4π/c). For GEO at 36000 km at 12 GHz: ≈205 dB. FSPL increases 6 dB per doubling of frequency or distance.', 'FSPL, path loss, GEO, propagation'),
('link_budget', 'EIRP Calculation', 'EIRP = Tx Power (dBW) + Tx Antenna Gain (dBi) – Cable Losses (dB). Example: 10W transmitter (10 dBW) + 45 dBi dish = 55 dBW EIRP. Higher EIRP improves link margin.', 'EIRP, transmit, antenna gain, dBW'),
('link_budget', 'G/T Figure of Merit', 'G/T = Receive Antenna Gain (dBi) – 10*log10(System Noise Temperature K). GEO receivers typically have G/T of 3–15 dB/K. Higher G/T = better receive performance.', 'G/T, noise temperature, receive, figure of merit'),
('troubleshoot', 'Rain Fade Mitigation', 'Rain fade causes signal attenuation above 10 GHz. Solutions: 1) Link margin design (add 3–15 dB margin), 2) Site diversity, 3) ACM (Adaptive Coding and Modulation), 4) ULPC (Uplink Power Control), 5) Move to lower frequency band.', 'rain fade, attenuation, ACM, ULPC, site diversity'),
('troubleshoot', 'Interference Identification', 'Common interference types: 1) Adjacent satellite interference (frequency overlap), 2) Terrestrial interference (cellular towers), 3) Intermodulation products, 4) Cross-polarization interference. Diagnosis: spectrum analyzer, carrier-to-interference ratio measurement.', 'interference, CCI, intermodulation, cross-pol, spectrum'),
('troubleshoot', 'Antenna Pointing Errors', 'Pointing errors cause gain loss. 1 dB pointing loss at 0.1° error for 1m Ku-band dish. Steps: 1) Verify satellite ephemeris data, 2) Check auto-tracking system, 3) Measure 3dB beamwidth, 4) Use beacon signal for alignment. Motor controllers must be calibrated.', 'antenna, pointing, beamwidth, tracking, alignment');
