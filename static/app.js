/**
 * SerialNet Debug Studio — 连接/曲线/发送/WebSocket 等前端逻辑（i18n.js 须先于本文件加载）。
 *
 * Author: Allen Liao
 * Date: 2026-04-09
 */
(() => {
  const MAX_POINTS = 1000;
  /** 日志行数上限，超出则从顶部删除最旧行 */
  const MAX_LOG_LINES = 10000;
  const LS_CMD = "webdbg_cmd_history_v1";
  const LS_TCP = "webdbg_tcp_recent_v1";
  const LS_TCP_FORM = "webdbg_tcp_form_v1";
  /** 页面上次选择的通信方式（刷新且后端无活动连接时恢复） */
  const LS_MODE = "webdbg_ui_mode_v1";
  const LS_TX_ECHO = "webdbg_tx_echo_v1";
  const MAX_CMD_HIST = 100;
  const MAX_TCP_RECENT = 3;
  /** 前端展示版本（页脚 #appVersion）；发版时只改此处。 */
  const APP_VERSION = "1.0.0";
  /** 国际化见 static/i18n.js（window.WebDbgI18n），须先于本文件加载。 */
  const I18n = globalThis.WebDbgI18n;
  if (!I18n) {
    console.error('Missing WebDbgI18n: load i18n.js before app.js');
  }
  const {
    t,
    tf,
    getLocale,
    setLocale,
    normalizeLocale,
    SUPPORTED_LOCALES,
    applyDocumentMeta,
    applyDomI18n,
    rebuildLangSelect,
    initFromStorage,
    persistLocale,
  } = I18n;

  let cmdHistory = [];
  /** null = 未在遍历历史；number = cmdHistory 下标 */
  let cmdHistPos = null;
  let cmdHistDraft = "";
  let cmdHistProgrammatic = false;
  let tcpRecent = [];

  const els = {
    mode: document.getElementById("mode"),
    uiLang: document.getElementById("uiLang"),
    statusText: document.getElementById("statusText"),
    connWatchLabel: document.getElementById("connWatchLabel"),
    btnConnect: document.getElementById("btnConnect"),
    btnDisconnect: document.getElementById("btnDisconnect"),
    cfgSerial: document.getElementById("cfgSerial"),
    cfgTcp: document.getElementById("cfgTcp"),
    cfgUdp: document.getElementById("cfgUdp"),
    serialPort: document.getElementById("serialPort"),
    serialBaud: document.getElementById("serialBaud"),
    serialDataBits: document.getElementById("serialDataBits"),
    serialParity: document.getElementById("serialParity"),
    serialStopBits: document.getElementById("serialStopBits"),
    serialTimeout: document.getElementById("serialTimeout"),
    btnRefreshPorts: document.getElementById("btnRefreshPorts"),
    tcpHost: document.getElementById("tcpHost"),
    tcpPort: document.getElementById("tcpPort"),
    tcpRecentChips: document.getElementById("tcpRecentChips"),
    udpRemoteHost: document.getElementById("udpRemoteHost"),
    udpRemotePort: document.getElementById("udpRemotePort"),
    udpLocalPort: document.getElementById("udpLocalPort"),
    udpListen: document.getElementById("udpListen"),
    logView: document.getElementById("logView"),
    logLimitBadge: document.getElementById("logLimitBadge"),
    chartLimitBadge: document.getElementById("chartLimitBadge"),
    btnClearLog: document.getElementById("btnClearLog"),
    btnClearPlot: document.getElementById("btnClearPlot"),
    btnCopyChartCsv: document.getElementById("btnCopyChartCsv"),
    btnExportChartCsv: document.getElementById("btnExportChartCsv"),
    btnChartStartRead: document.getElementById("btnChartStartRead"),
    btnChartPause: document.getElementById("btnChartPause"),
    btnChartResetZoom: document.getElementById("btnChartResetZoom"),
    chart: document.getElementById("chart"),
    cmdInput: document.getElementById("cmdInput"),
    btnSend: document.getElementById("btnSend"),
    btnCmdHist: document.getElementById("btnCmdHist"),
    btnClearCmdHist: document.getElementById("btnClearCmdHist"),
    cmdHistPop: document.getElementById("cmdHistPop"),
    cmdHistList: document.getElementById("cmdHistList"),
    cmdHistEmpty: document.getElementById("cmdHistEmpty"),
    sendFormat: document.getElementById("sendFormat"),
    sendLineEnding: document.getElementById("sendLineEnding"),
    sendChecksum: document.getElementById("sendChecksum"),
    txEchoLog: document.getElementById("txEchoLog"),
    appVersion: document.getElementById("appVersion"),
  };

  const textEncoder = new TextEncoder();

  function concatUint8Arrays(parts) {
    let n = 0;
    for (let i = 0; i < parts.length; i += 1) n += parts[i].length;
    const out = new Uint8Array(n);
    let o = 0;
    for (let i = 0; i < parts.length; i += 1) {
      out.set(parts[i], o);
      o += parts[i].length;
    }
    return out;
  }

  function bytesToBase64(u8) {
    const chunk = 0x8000;
    let bin = "";
    for (let i = 0; i < u8.length; i += chunk) {
      bin += String.fromCharCode.apply(null, u8.subarray(i, i + chunk));
    }
    return btoa(bin);
  }

  /** @throws {Error} 非法 HEX 时抛出（文案已本地化） */
  function parseHexInputToBytes(raw) {
    const compact = String(raw).replace(/\s+/g, "");
    if (compact === "") return new Uint8Array(0);
    if (compact.length % 2 !== 0) {
      throw new Error(tf("logHexOdd", compact.length));
    }
    if (!/^[0-9a-fA-F]+$/.test(compact)) {
      throw new Error(t("logHexBadChar"));
    }
    const out = new Uint8Array(compact.length / 2);
    for (let i = 0; i < out.length; i += 1) {
      out[i] = parseInt(compact.slice(i * 2, i * 2 + 2), 16);
    }
    return out;
  }

  /** CRC-8：多项式 0x07，初值 0（常用 SMBus 风格）。 */
  function crc8Smbus(data) {
    let crc = 0;
    for (let i = 0; i < data.length; i += 1) {
      crc ^= data[i];
      for (let j = 0; j < 8; j += 1) {
        if (crc & 0x80) crc = ((crc << 1) ^ 0x07) & 0xff;
        else crc = (crc << 1) & 0xff;
      }
    }
    return crc & 0xff;
  }

  /** CRC-16/BUYPASS：reflected poly 0x8005，初值 0；结果按大端附加。 */
  function crc16Buypass(data) {
    let crc = 0;
    for (let i = 0; i < data.length; i += 1) {
      crc ^= data[i];
      for (let j = 0; j < 8; j += 1) {
        crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
      }
    }
    return crc & 0xffff;
  }

  /** CRC-16-CCITT：poly 0x1021，初值 0xFFFF；大端附加。 */
  function crc16Ccitt(data) {
    let crc = 0xffff;
    for (let i = 0; i < data.length; i += 1) {
      crc ^= (data[i] << 8) & 0xffff;
      for (let j = 0; j < 8; j += 1) {
        if (crc & 0x8000) crc = ((crc << 1) ^ 0x1021) & 0xffff;
        else crc = (crc << 1) & 0xffff;
      }
    }
    return crc & 0xffff;
  }

  /** MODBUS CRC-16；按协议惯例小端附加（低字节在前）。 */
  function crc16Modbus(data) {
    let crc = 0xffff;
    for (let i = 0; i < data.length; i += 1) {
      crc ^= data[i];
      for (let j = 0; j < 8; j += 1) {
        crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
      }
    }
    return crc & 0xffff;
  }

  /** CRC-32（IEEE）；结果小端附加。 */
  function crc32Ieee(data) {
    let crc = 0xffffffff;
    for (let i = 0; i < data.length; i += 1) {
      crc ^= data[i];
      for (let j = 0; j < 8; j += 1) {
        crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
      }
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function adler32(data) {
    let a = 1;
    let b = 0;
    const MOD = 65521;
    for (let i = 0; i < data.length; i += 1) {
      a = (a + data[i]) % MOD;
      b = (b + a) % MOD;
    }
    return ((b << 16) | a) >>> 0;
  }

  /** Fletcher-16（模 255）；附加顺序 sum2、sum1（高 8 位 = sum2）。 */
  function fletcher16(data) {
    let sum1 = 0;
    let sum2 = 0;
    for (let i = 0; i < data.length; i += 1) {
      sum1 = (sum1 + data[i]) % 255;
      sum2 = (sum2 + sum1) % 255;
    }
    return ((sum2 << 8) | sum1) & 0xffff;
  }

  /**
   * 在校验计算中只包含「负载」字节（不含校验本身与行尾）。
   * 发送顺序：负载 → 校验字节 → 行结束符（UTF-8 编码的 LF/CR/CRLF）。
   */
  function checksumSuffixBytes(id, payload) {
    switch (id) {
      case "none":
        return new Uint8Array(0);
      case "xor8": {
        let x = 0;
        for (let i = 0; i < payload.length; i += 1) x ^= payload[i];
        return new Uint8Array([x & 0xff]);
      }
      case "crc8":
        return new Uint8Array([crc8Smbus(payload)]);
      case "crc16": {
        const v = crc16Buypass(payload);
        return new Uint8Array([(v >> 8) & 0xff, v & 0xff]);
      }
      case "crc16_ccitt": {
        const v = crc16Ccitt(payload);
        return new Uint8Array([(v >> 8) & 0xff, v & 0xff]);
      }
      case "crc16_modbus": {
        const v = crc16Modbus(payload);
        return new Uint8Array([v & 0xff, (v >> 8) & 0xff]);
      }
      case "crc32": {
        const v = crc32Ieee(payload);
        return new Uint8Array([v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff]);
      }
      case "mod256": {
        let s = 0;
        for (let i = 0; i < payload.length; i += 1) s += payload[i];
        return new Uint8Array([s & 0xff]);
      }
      case "adler32": {
        const v = adler32(payload);
        return new Uint8Array([(v >> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff]);
      }
      case "fletcher16": {
        const v = fletcher16(payload);
        return new Uint8Array([(v >> 8) & 0xff, v & 0xff]);
      }
      default:
        return new Uint8Array(0);
    }
  }

  function lineEndingToBytes() {
    const v = els.sendLineEnding && els.sendLineEnding.value;
    let s = "";
    if (v === "lf") s = "\n";
    else if (v === "cr") s = "\r";
    else if (v === "crlf") s = "\r\n";
    return textEncoder.encode(s);
  }

  function buildOutgoingWireBytes({ rawInput, forceText }) {
    const format = forceText ? "text" : (els.sendFormat && els.sendFormat.value) || "text";
    const chk = (els.sendChecksum && els.sendChecksum.value) || "none";
    let body;
    if (format === "hex") {
      body = parseHexInputToBytes(rawInput);
    } else {
      body = textEncoder.encode(String(rawInput));
    }
    const csum = checksumSuffixBytes(chk, body);
    const le = lineEndingToBytes();
    const wire = concatUint8Arrays([body, csum, le]);
    return {
      wire,
      bodyLen: body.length,
      sendFormat: format,
      csumLen: csum.length,
      leLen: le.length,
    };
  }

  function truncateTxEchoText(s, maxChars) {
    const str = String(s);
    if (str.length <= maxChars) return str;
    return `${str.slice(0, maxChars)}…`;
  }

  function formatHexBytes(u8, maxShow = 96) {
    const show = Math.min(u8.length, maxShow);
    const parts = [];
    for (let i = 0; i < show; i += 1) {
      parts.push(u8[i].toString(16).toUpperCase().padStart(2, "0"));
    }
    let hex = parts.join(" ");
    if (u8.length > show) hex += ` … (+${u8.length - show} B)`;
    return hex;
  }

  /** 行尾在「文本格式」回显里用真实字符（与串口终端一致），不再写成 \\n。 */
  function lineEndingToDisplayString(le) {
    if (le.length === 1 && le[0] === 0x0a) return "\n";
    if (le.length === 1 && le[0] === 0x0d) return "\r";
    if (le.length === 2 && le[0] === 0x0d && le[1] === 0x0a) return "\r\n";
    let s = "";
    for (let i = 0; i < le.length; i += 1) s += String.fromCharCode(le[i]);
    return s;
  }

  function formatChecksumBracketHex(u8) {
    if (!u8.length) return "";
    const parts = [];
    for (let i = 0; i < u8.length; i += 1) {
      parts.push(u8[i].toString(16).toUpperCase().padStart(2, "0"));
    }
    return ` [${parts.join(" ")}]`;
  }

  /**
   * 文本格式：回显为「所见即所得」——正文与输入一致，行尾为真实 CR/LF；无 `N B |`、无 \\n 字面量。
   * 十六进制格式：仍为 `字节数 B | AA BB …`。
   */
  function formatTxLogDescription(u8, meta) {
    const n = u8.length;
    if (!meta || meta.sendFormat !== "text") {
      return `${n} B | ${formatHexBytes(u8)}`;
    }
    const bodyLen = Number(meta.bodyLen) || 0;
    const csumLen = Number(meta.csumLen) || 0;
    const leLen = Number(meta.leLen) || 0;
    const rawInput = meta.rawInput != null ? meta.rawInput : "";
    if (bodyLen + csumLen + leLen !== u8.length) {
      let out = truncateTxEchoText(rawInput, 4000);
      const tail = bodyLen > 0 && bodyLen < u8.length ? u8.subarray(bodyLen) : new Uint8Array(0);
      if (tail.length) out += ` + ${formatHexBytes(tail)}`;
      return `${n} B | ${out}`;
    }
    let out = truncateTxEchoText(rawInput, 4000);
    if (csumLen > 0) {
      const csumPart = u8.subarray(bodyLen, bodyLen + csumLen);
      out += formatChecksumBracketHex(csumPart);
    }
    if (leLen > 0) {
      const lePart = u8.subarray(bodyLen + csumLen, bodyLen + csumLen + leLen);
      out += lineEndingToDisplayString(lePart);
    }
    return out;
  }

  /**
   * 统一发送入口：原始字节经 bytes_b64 提交，兼容 Serial / TCP / UDP（由后端当前连接决定）。
   * 成功/失败均在日志区反映；不在此函数内写 [TX]（由调用方在成功后记录）。
   */
  async function postSendBytes(u8) {
    const r = await fetch("/api/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bytes_b64: bytesToBase64(u8) }),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err.detail || r.statusText || String(r.status));
    }
  }

  async function sendWireBytes(u8, { historyLabel, clearInput, txMeta }) {
    if (!u8 || u8.length === 0) return;
    if (lastStatusShown.state !== "connected") return;
    cmdHistPos = null;
    const ts = new Date().toISOString();
    try {
      await postSendBytes(u8);
      pushCmdHistory(historyLabel);
      if (els.txEchoLog && els.txEchoLog.checked) {
        appendLog("TX", formatTxLogDescription(u8, txMeta || null), ts);
      }
      if (clearInput && els.cmdInput) {
        els.cmdInput.value = "";
      }
    } catch (e) {
      appendLog("ERR", tf("logSendErr", e), ts);
    }
  }

  /**
   * 从界面或快捷按钮组包并发送。
   * @param {{ clearInput?: boolean, forceText?: boolean, rawText?: string, historyLabel?: string }} opts
   */
  async function sendFromUi(opts = {}) {
    const clearInput = !!opts.clearInput;
    const forceText = !!opts.forceText;
    let rawInput;
    if (opts.rawText != null) {
      rawInput = String(opts.rawText);
    } else if (els.cmdInput) {
      rawInput = els.cmdInput.value;
    } else {
      rawInput = "";
    }
    let ts = new Date().toISOString();
    try {
      if (lastStatusShown.state !== "connected") return;
      let built;
      try {
        built = buildOutgoingWireBytes({ rawInput, forceText });
      } catch (err) {
        appendLog("ERR", String(err && err.message ? err.message : err), ts);
        return;
      }
      const u8 = built.wire;
      if (!u8.length) return;
      const historyLabel =
        opts.historyLabel != null ? String(opts.historyLabel).replace(/\r/g, "") : rawInput.replace(/\r/g, "");
      await sendWireBytes(u8, {
        historyLabel,
        clearInput,
        txMeta: {
          sendFormat: built.sendFormat,
          bodyLen: built.bodyLen,
          csumLen: built.csumLen,
          leLen: built.leLen,
          rawInput,
        },
      });
    } catch (e) {
      ts = new Date().toISOString();
      appendLog("ERR", tf("logSendErr", e), ts);
    }
  }

  let ws = null;
  let chart = null;
  let wsConnectTimer = null;
  let lastStatusShown = { state: "disconnected", detail: "" };
  /** 连接中/已连接时定期拉取 /api/status，补偿仅丢 WebSocket 时 UI 仍显示已连的情况（各模式断链由后端检测并写入 status）。 */
  let statusPollTimer = null;
  let lastServerStatusSig = "";
  const STATUS_POLL_MS = 3000;
  /** true = 不向曲线追加新点（日志仍更新），类似 Arduino 串口绘图仪暂停 */
  let chartReadingPaused = false;

  const seriesData = new Map();
  const xData = [];

  function setLimitBadge(el, count, max) {
    if (!el) return;
    el.textContent = `${count} / ${max}`;
    el.classList.remove("limit-near-full", "limit-full");
    if (max > 0 && count >= max) el.classList.add("limit-full");
    else if (max > 0 && count / max >= 0.8) el.classList.add("limit-near-full");
  }

  function updateLogLimitBadge() {
    const n = els.logView ? els.logView.children.length : 0;
    setLimitBadge(els.logLimitBadge, n, MAX_LOG_LINES);
  }

  function updateChartLimitBadge() {
    setLimitBadge(els.chartLimitBadge, xData.length, MAX_POINTS);
  }

  function updateChartReadButtons() {
    if (els.btnChartPause) {
      els.btnChartPause.disabled = chartReadingPaused;
    }
    if (els.btnChartStartRead) {
      els.btnChartStartRead.disabled = !chartReadingPaused;
    }
  }

  function loadCmdHistory() {
    try {
      const raw = localStorage.getItem(LS_CMD);
      if (!raw) return;
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return;
      cmdHistory = arr
        .filter((x) => typeof x === "string")
        .slice(-MAX_CMD_HIST);
    } catch (e) {
      cmdHistory = [];
    }
  }

  function loadTxEchoFromStorage() {
    const el = els.txEchoLog;
    if (!el) return;
    try {
      const raw = localStorage.getItem(LS_TX_ECHO);
      if (raw === null) {
        el.checked = true;
        return;
      }
      el.checked = raw === "1" || raw === "true";
    } catch (e) {
      el.checked = true;
    }
  }

  function persistTxEchoToStorage() {
    try {
      if (els.txEchoLog) {
        localStorage.setItem(LS_TX_ECHO, els.txEchoLog.checked ? "1" : "0");
      }
    } catch (e) {
      /* ignore */
    }
  }

  function pushCmdHistory(text) {
    const t = String(text || "").replace(/\r/g, "");
    if (!t.trim()) return;
    if (cmdHistory.length && cmdHistory[cmdHistory.length - 1] === t) return;
    cmdHistory.push(t);
    while (cmdHistory.length > MAX_CMD_HIST) {
      cmdHistory.shift();
    }
    try {
      localStorage.setItem(LS_CMD, JSON.stringify(cmdHistory));
    } catch (e) {
      /* ignore quota */
    }
  }

  /** 去重：同一条命令只保留最近一次出现；顺序为最新在上（最近发送的排第一）。 */
  function dedupedCmdHistoryNewestFirst() {
    const seen = new Set();
    const out = [];
    for (let i = cmdHistory.length - 1; i >= 0; i -= 1) {
      const t = cmdHistory[i];
      if (seen.has(t)) continue;
      seen.add(t);
      out.push(t);
    }
    return out;
  }

  function setCmdHistOpen(open) {
    const pop = els.cmdHistPop;
    const btn = els.btnCmdHist;
    if (!pop) return;
    pop.hidden = !open;
    if (btn) {
      btn.setAttribute("aria-expanded", open ? "true" : "false");
    }
    if (open) {
      renderCmdHistList();
    }
  }

  function renderCmdHistList() {
    const listEl = els.cmdHistList;
    const emptyEl = els.cmdHistEmpty;
    if (!listEl) return;
    const items = dedupedCmdHistoryNewestFirst();
    listEl.innerHTML = "";
    listEl.hidden = items.length === 0;
    if (emptyEl) {
      emptyEl.hidden = items.length > 0;
    }
    if (!items.length) return;
    for (const text of items) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "cmd-hist-item";
      b.textContent = text;
      b.title = text;
      b.addEventListener("click", () => {
        cmdHistPos = null;
        setCmdInputValueFromHistory(text);
        setCmdHistOpen(false);
        if (els.cmdInput) {
          els.cmdInput.focus();
        }
      });
      listEl.appendChild(b);
    }
  }

  function toggleCmdHistPop() {
    if (!els.cmdHistPop) return;
    setCmdHistOpen(els.cmdHistPop.hidden);
  }

  function clearCmdHistory() {
    cmdHistory = [];
    cmdHistPos = null;
    cmdHistDraft = "";
    try {
      localStorage.removeItem(LS_CMD);
    } catch (e) {
      /* ignore */
    }
    renderCmdHistList();
    appendLog("SYS", t("logCmdHistCleared"), new Date().toISOString());
  }

  function loadTcpRecent() {
    try {
      const raw = localStorage.getItem(LS_TCP);
      if (!raw) {
        tcpRecent = [];
        return;
      }
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) {
        tcpRecent = [];
        return;
      }
      tcpRecent = arr
        .filter((x) => x && typeof x.host === "string" && x.port != null && String(x.port) !== "")
        .map((x) => ({ host: x.host.trim(), port: String(x.port) }))
        .slice(0, MAX_TCP_RECENT);
    } catch (e) {
      tcpRecent = [];
    }
  }

  function saveTcpRecent() {
    try {
      localStorage.setItem(LS_TCP, JSON.stringify(tcpRecent));
    } catch (e) {
      /* ignore */
    }
  }

  function saveTcpForm() {
    try {
      const host = els.tcpHost.value.trim();
      const port = els.tcpPort.value;
      localStorage.setItem(
        LS_TCP_FORM,
        JSON.stringify({
          host: host || "",
          port: port != null ? String(port) : "",
        })
      );
    } catch (e) {
      /* ignore */
    }
  }

  let tcpFormSaveTimer = null;
  function scheduleSaveTcpForm() {
    if (tcpFormSaveTimer) clearTimeout(tcpFormSaveTimer);
    tcpFormSaveTimer = setTimeout(saveTcpForm, 250);
  }

  /** 刷新页面后恢复 Host/Port（优先上次编辑保存，否则最近成功连接之一） */
  function loadTcpForm() {
    let applied = false;
    try {
      const raw = localStorage.getItem(LS_TCP_FORM);
      if (raw) {
        const o = JSON.parse(raw);
        if (o && typeof o === "object") {
          const h = typeof o.host === "string" ? o.host.trim() : "";
          const p = o.port != null ? String(o.port) : "";
          if (h) {
            els.tcpHost.value = h;
            if (p !== "") els.tcpPort.value = p;
            applied = true;
          }
        }
      }
    } catch (e) {
      /* ignore */
    }
    if (!applied && tcpRecent.length > 0) {
      els.tcpHost.value = tcpRecent[0].host;
      els.tcpPort.value = tcpRecent[0].port;
    }
  }

  function rememberTcpRecent(host, port) {
    const h = (host || "").trim();
    const p = String(port != null ? port : "").trim();
    if (!h || !p) return;
    tcpRecent = tcpRecent.filter((x) => !(x.host === h && String(x.port) === p));
    tcpRecent.unshift({ host: h, port: p });
    tcpRecent = tcpRecent.slice(0, MAX_TCP_RECENT);
    saveTcpRecent();
    renderTcpRecentChips();
    saveTcpForm();
  }

  function renderTcpRecentChips() {
    const box = els.tcpRecentChips;
    if (!box) return;
    box.innerHTML = "";
    tcpRecent.forEach((item) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "tcp-chip";
      btn.title = `${item.host}:${item.port}`;
      const h = document.createElement("span");
      h.className = "chip-host-part";
      h.textContent = item.host;
      const sep = document.createElement("span");
      sep.className = "chip-sep";
      sep.textContent = ":";
      const p = document.createElement("span");
      p.className = "chip-port-part";
      p.textContent = item.port;
      btn.appendChild(h);
      btn.appendChild(sep);
      btn.appendChild(p);
      btn.addEventListener("click", () => {
        els.tcpHost.value = item.host;
        els.tcpPort.value = item.port;
        saveTcpForm();
      });
      box.appendChild(btn);
    });
  }

  function setCmdInputValueFromHistory(val) {
    cmdHistProgrammatic = true;
    els.cmdInput.value = val;
    queueMicrotask(() => {
      cmdHistProgrammatic = false;
    });
  }

  /** 清空全部曲线（与 Arduino 串口绘图仪一致：无预定义通道）。 */
  function resetSeriesMap() {
    seriesData.clear();
  }

  /** 系列顺序 = 首次出现顺序（Map 插入序），便于图例稳定。 */
  function orderedSeriesNames() {
    return [...seriesData.keys()];
  }

  /** X 轴类别值为 time_ms 时间戳时，显示为 时:分:秒.毫秒（本地时间） */
  function formatChartAxisTime(val) {
    const n = typeof val === "number" ? val : Number(val);
    if (!Number.isFinite(n)) return String(val);
    const d = new Date(n);
    const z2 = (x) => String(x).padStart(2, "0");
    const z3 = (x) => String(x).padStart(3, "0");
    return `${z2(d.getHours())}:${z2(d.getMinutes())}:${z2(d.getSeconds())}.${z3(d.getMilliseconds())}`;
  }

  function axisXOption() {
    return {
      type: "category",
      data: xData,
      boundaryGap: false,
      axisLabel: {
        color: "#9aa3ad",
        fontSize: 10,
        formatter: (v) => formatChartAxisTime(v),
        hideOverlap: true,
      },
    };
  }

  function seriesOptionFromMap() {
    return orderedSeriesNames().map((name) => ({
      name,
      type: "line",
      showSymbol: false,
      smooth: true,
      data: seriesData.get(name),
      emphasis: { focus: "series" },
    }));
  }

  /** 与 Grafana 类似：滚轮缩放、按住拖拽平移；工具栏「框选」仅沿 X 轴放大所选区间。 */
  function chartDataZoomOption() {
    return [
      {
        type: "inside",
        xAxisIndex: 0,
        filterMode: "none",
        start: 0,
        end: 100,
        zoomOnMouseWheel: true,
        moveOnMouseMove: true,
        moveOnMouseWheel: false,
        throttle: 80,
      },
    ];
  }

  function chartToolboxOption() {
    return {
      right: 8,
      top: 28,
      itemSize: 15,
      itemGap: 10,
      iconStyle: { borderColor: "#9aa3ad" },
      emphasis: { iconStyle: { borderColor: "#cfd6df" } },
      feature: {
        dataZoom: {
          xAxisIndex: [0],
          yAxisIndex: false,
          filterMode: "none",
          title: { zoom: t("chartZoomSelect"), back: t("chartZoomBack") },
        },
      },
    };
  }

  function getFullChartOption() {
    return {
      animationDuration: 150,
      tooltip: {
        trigger: "axis",
        formatter(params) {
          if (!params || !params.length) return "";
          const timeStr = formatChartAxisTime(params[0].axisValue);
          let s = `<div style="font-weight:600;margin:0 0 4px">${timeStr}</div>`;
          for (const p of params) {
            const v = p.value;
            const show = v === null || v === undefined || v === "" ? t("chartTooltipDash") : v;
            s += `${p.marker} ${p.seriesName}: ${show}<br/>`;
          }
          return s;
        },
      },
      legend: {
        type: "scroll",
        top: 0,
        textStyle: { color: "#9aa3ad" },
      },
      toolbox: chartToolboxOption(),
      dataZoom: chartDataZoomOption(),
      grid: { left: 48, right: 52, top: 36, bottom: 28 },
      xAxis: axisXOption(),
      yAxis: {
        type: "value",
        scale: true,
        splitLine: { lineStyle: { color: "#3d4450" } },
        axisLabel: { color: "#9aa3ad", fontSize: 10 },
      },
      series: seriesOptionFromMap(),
    };
  }

  function resetChartZoom() {
    if (!chart) return;
    try {
      chart.dispatchAction({ type: "dataZoom", start: 0, end: 100, xAxisIndex: [0] });
    } catch (e) {
      /* ignore */
    }
  }

  function onChartResize() {
    if (chart) chart.resize();
  }

  /** 释放并重建实例，避免 clear/setOption 在部分环境下不刷新画布。 */
  function recreateChartInstance() {
    const dom = els.chart;
    if (!dom) return;
    if (chart) {
      try {
        chart.dispose();
      } catch (e) {
        /* ignore */
      }
      chart = null;
    }
    if (typeof echarts.getInstanceByDom === "function") {
      const ghost = echarts.getInstanceByDom(dom);
      if (ghost) {
        try {
          ghost.dispose();
        } catch (e) {
          /* ignore */
        }
      }
    }
    chart = echarts.init(dom, null, { renderer: "canvas" });
  }

  function initChart() {
    resetSeriesMap();
    recreateChartInstance();
    chart.setOption(getFullChartOption(), { notMerge: true });
    window.addEventListener("resize", onChartResize);
    updateChartLimitBadge();
  }

  function ensureSeries(name) {
    if (!seriesData.has(name)) {
      const arr = [];
      while (arr.length < xData.length) arr.push(null);
      seriesData.set(name, arr);
    }
  }

  function appendChartPoint(values) {
    const keys = Object.keys(values || {});
    if (!keys.length) return;

    if (!chart) {
      recreateChartInstance();
      if (!chart) return;
      chart.setOption(getFullChartOption(), { notMerge: true });
    }
    const t = Date.now();
    xData.push(t);

    if (xData.length > MAX_POINTS) {
      const drop = xData.length - MAX_POINTS;
      xData.splice(0, drop);
      for (const [, arr] of seriesData) {
        arr.splice(0, drop);
      }
    }

    for (const k of keys) {
      ensureSeries(k);
    }
    for (const [name, arr] of seriesData) {
      const v = Object.prototype.hasOwnProperty.call(values, name)
        ? values[name]
        : null;
      arr.push(v);
    }

    // 必须与 init 一致：xAxis 始终为「单个对象」，不要用 [{ data }] 数组，否则会变成另一套坐标轴导致曲线不显示。
    chart.setOption({
      xAxis: axisXOption(),
      series: seriesOptionFromMap(),
    });
    updateChartLimitBadge();
  }

  function clearPlot() {
    try {
      xData.length = 0;
      resetSeriesMap();
      recreateChartInstance();
      chart.setOption(getFullChartOption(), { notMerge: true });
      chart.resize();
    } catch (e) {
      if (els.logView) {
        appendLog("ERR", tf("logClearPlotErr", String(e)), new Date().toISOString());
      }
    } finally {
      updateChartLimitBadge();
    }
  }

  /** RX/后端日志 ts 为 Python isoformat（+00:00、微秒）；SYS 为浏览器 toISOString（Z、毫秒）。此处统一成与 SYS 相同的 UTC ISO 字符串。 */
  function formatLogTimestamp(ts) {
    if (ts == null || String(ts).trim() === "") {
      return new Date().toISOString();
    }
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) {
      return String(ts);
    }
    return d.toISOString();
  }

  function appendLog(channel, message, ts) {
    const line = document.createElement("div");
    line.className = `log-line ${channel.toLowerCase()}`;
    const time = formatLogTimestamp(ts);
    line.innerHTML = `<span class="ts">${time}</span><span class="tag">[${channel}]</span> ${escapeHtml(
      message
    )}`;
    els.logView.appendChild(line);
    while (els.logView.children.length > MAX_LOG_LINES) {
      els.logView.removeChild(els.logView.firstChild);
    }
    updateLogLimitBadge();
    els.logView.scrollTop = els.logView.scrollHeight;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;");
  }

  function escapeCsvCell(val) {
    if (val === null || val === undefined || val === "") return "";
    const s = String(val);
    if (/[",\n\r]/.test(s)) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  }

  function buildChartCsv() {
    const names = orderedSeriesNames();
    const n = xData.length;
    if (n === 0) return "";
    const lines = [];
    lines.push(["time_ms", ...names].map(escapeCsvCell).join(","));
    for (let i = 0; i < n; i += 1) {
      const row = [xData[i]];
      for (const name of names) {
        const arr = seriesData.get(name);
        let v = "";
        if (arr && i < arr.length) {
          const cell = arr[i];
          v = cell === null || cell === undefined ? "" : cell;
        }
        row.push(v);
      }
      lines.push(row.map(escapeCsvCell).join(","));
    }
    return lines.join("\r\n");
  }

  async function copyChartCsv() {
    const csv = buildChartCsv();
    if (!csv) {
      appendLog("SYS", t("logNoCsvCopy"), new Date().toISOString());
      return;
    }
    const rows = xData.length;
    const cols = orderedSeriesNames().length;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(csv);
      } else {
        throw new Error("clipboard");
      }
    } catch (e) {
      try {
        const ta = document.createElement("textarea");
        ta.value = csv;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      } catch (e2) {
        appendLog("ERR", tf("logCopyCsvErr", String(e2)), new Date().toISOString());
        return;
      }
    }
    appendLog("SYS", tf("logCopyCsvOk", rows, cols), new Date().toISOString());
  }

  function exportChartCsv() {
    const csv = buildChartCsv();
    if (!csv) {
      appendLog("SYS", t("logNoCsvExport"), new Date().toISOString());
      return;
    }
    const rows = xData.length;
    const cols = orderedSeriesNames().length;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const filename = `chart_${stamp}.csv`;
    const bom = "\uFEFF";
    const blob = new Blob([bom + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    appendLog("SYS", tf("logExportCsvOk", filename, rows, cols), new Date().toISOString());
  }

  function setStatus(state, detail) {
    const d = detail == null ? "" : String(detail);
    lastStatusShown = { state, detail: d };
    const map = {
      disconnected: t("stDisconnected"),
      connecting: t("stConnecting"),
      connected: t("stConnected"),
      error: t("stError"),
    };
    const label = map[state] || state;
    els.statusText.textContent = d ? `${label}: ${d}` : label;
    els.statusText.className = `status-badge ${state}`;
    updateSendControls();
  }

  /** 仅已连接时可发送：格式行、输入框、Send 等；断开时发送工具栏选项一并禁用。 */
  function updateSendControls() {
    const ok = lastStatusShown.state === "connected";
    if (els.sendFormat) els.sendFormat.disabled = !ok;
    if (els.sendLineEnding) els.sendLineEnding.disabled = !ok;
    if (els.sendChecksum) els.sendChecksum.disabled = !ok;
    if (els.txEchoLog) els.txEchoLog.disabled = !ok;
    if (els.btnSend) els.btnSend.disabled = !ok;
    if (els.cmdInput) els.cmdInput.disabled = !ok;
    document.querySelectorAll(".cmd-panel button.quick").forEach((b) => {
      b.disabled = !ok;
    });
  }

  function statusSignature(s) {
    if (!s || typeof s !== "object") return "";
    const st = s.state == null ? "" : String(s.state);
    const m = s.mode == null ? "" : String(s.mode);
    const d = s.detail == null ? "" : String(s.detail);
    return `${st}|${m}|${d}`;
  }

  function updateConnWatchUI(state) {
    const el = els.connWatchLabel;
    if (!el) return;
    const on = state === "connected" || state === "connecting";
    el.textContent = on ? t("connWatchOn") : t("connWatchOff");
    el.title = t("connWatchTitle");
    el.classList.toggle("conn-watch-on", on);
  }

  function startStatusPollingIfNeeded() {
    if (statusPollTimer !== null) return;
    statusPollTimer = setInterval(() => {
      fetchStatusOnce();
    }, STATUS_POLL_MS);
  }

  function stopStatusPolling() {
    if (statusPollTimer !== null) {
      clearInterval(statusPollTimer);
      statusPollTimer = null;
    }
  }

  /** 将后端 status 对齐到界面（与 WebSocket status 消息字段一致）。 */
  function applyServerStatus(s) {
    if (!s || typeof s !== "object") return;
    const sig = statusSignature(s);
    if (sig === lastServerStatusSig) {
      return;
    }
    lastServerStatusSig = sig;
    setStatus(s.state, s.detail || "");
    syncModeSelectFromStatus(s);
    updateConnWatchUI(s.state);
    if (s.state === "connected" || s.state === "connecting") {
      startStatusPollingIfNeeded();
    } else {
      stopStatusPolling();
    }
  }

  async function fetchStatusOnce() {
    try {
      const r = await fetch("/api/status");
      if (!r.ok) return;
      const s = await r.json();
      applyServerStatus(s);
    } catch {
      /* ignore */
    }
  }

  function switchModeUI() {
    const m = els.mode.value;
    els.cfgSerial.hidden = m !== "serial";
    els.cfgTcp.hidden = m !== "tcp";
    els.cfgUdp.hidden = m !== "udp";
  }

  /**
   * 与后端 / WebSocket 状态对齐通信方式；后端有 mode 时优先（刷新后仍为连接则显示 Serial/UDP 等）。
   * 未连接且无 mode 时，用 localStorage 恢复用户上次选择，避免总回到 HTML 默认 TCP。
   */
  function syncModeSelectFromStatus(statusPayload) {
    const rawMode = statusPayload && statusPayload.mode;
    if (rawMode != null && String(rawMode).trim() !== "") {
      const v = String(rawMode).toLowerCase().trim();
      if (v === "serial" || v === "tcp" || v === "udp") {
        els.mode.value = v;
        try {
          localStorage.setItem(LS_MODE, v);
        } catch (e) {
          /* ignore */
        }
        switchModeUI();
        return;
      }
    }
    const st = statusPayload && statusPayload.state;
    if (st === "connected" || st === "connecting") {
      switchModeUI();
      return;
    }
    try {
      const saved = localStorage.getItem(LS_MODE);
      if (saved === "serial" || saved === "tcp" || saved === "udp") {
        els.mode.value = saved;
      }
    } catch (e) {
      /* ignore */
    }
    switchModeUI();
  }

  async function refreshPorts() {
    try {
      const r = await fetch("/api/ports");
      const j = await r.json();
      const ports = j.ports || [];
      els.serialPort.innerHTML = "";
      for (const p of ports) {
        const o = document.createElement("option");
        o.value = p;
        o.textContent = p;
        els.serialPort.appendChild(o);
      }
      if (!ports.length) {
        const o = document.createElement("option");
        o.value = "";
        o.textContent = t("serialNoPorts");
        els.serialPort.appendChild(o);
      }
    } catch (e) {
      appendLog("ERR", tf("logRefreshPortsErr", e), new Date().toISOString());
    }
  }

  function buildConnectBody() {
    const m = els.mode.value;
    if (m === "serial") {
      return {
        mode: "serial",
        serial: {
          port: els.serialPort.value,
          baudrate: Number(els.serialBaud.value),
          data_bits: Number(els.serialDataBits.value),
          parity: els.serialParity.value.trim().toLowerCase() || "none",
          stop_bits: Number(els.serialStopBits.value),
          read_timeout: Number(els.serialTimeout.value),
        },
      };
    }
    if (m === "tcp") {
      return {
        mode: "tcp",
        tcp: {
          host: els.tcpHost.value.trim(),
          port: Number(els.tcpPort.value),
        },
      };
    }
    return {
      mode: "udp",
      udp: {
        remote_host: els.udpRemoteHost.value.trim(),
        remote_port: Number(els.udpRemotePort.value),
        local_listen_port: Number(els.udpLocalPort.value),
        listen: els.udpListen.checked,
      },
    };
  }

  async function apiConnect() {
    setStatus("connecting", "");
    const mode = els.mode.value;
    let tcpSnap = null;
    if (mode === "tcp") {
      tcpSnap = {
        host: els.tcpHost.value.trim(),
        port: els.tcpPort.value,
      };
    }
    try {
      const r = await fetch("/api/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildConnectBody()),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.detail || r.statusText);
      }
      if (tcpSnap && tcpSnap.host && tcpSnap.port !== "" && tcpSnap.port != null) {
        rememberTcpRecent(tcpSnap.host, tcpSnap.port);
      }
      await fetchStatusOnce();
    } catch (e) {
      appendLog("ERR", String(e), new Date().toISOString());
      lastServerStatusSig = "";
      setStatus("error", String(e));
      updateConnWatchUI("error");
      stopStatusPolling();
    }
  }

  async function apiDisconnect() {
    try {
      await fetch("/api/disconnect", { method: "POST" });
    } catch (e) {
      appendLog("ERR", tf("logDisconnectErr", e), new Date().toISOString());
    }
    await fetchStatusOnce();
  }

  function connectWs() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${proto}//${location.host}/ws`;
    ws = new WebSocket(url);

    ws.onopen = () => {
      appendLog("SYS", t("logWsConnected"), new Date().toISOString());
      if (wsConnectTimer) clearInterval(wsConnectTimer);
      wsConnectTimer = null;
      fetchStatusOnce();
    };

    ws.onclose = () => {
      appendLog("SYS", t("logWsReconnecting"), new Date().toISOString());
      ws = null;
      if (!wsConnectTimer) {
        wsConnectTimer = setInterval(connectWs, 2000);
      }
    };

    ws.onerror = () => { };

    ws.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.type === "status") {
        applyServerStatus(msg);
      } else if (msg.type === "log") {
        appendLog(msg.channel, msg.message, msg.ts);
      } else if (msg.type === "parsed_data" && msg.values) {
        if (chartReadingPaused) return;
        const v = msg.values;
        if (v && typeof v === "object" && Object.keys(v).length > 0) {
          appendChartPoint(v);
        }
      }
    };
  }

  /** 应用当前 WebDbgI18n 语言：DOM 文案 + 状态区 + 曲线 toolbox + 串口列表等（业务相关部分在本文件）。 */
  function applyAllUiLanguage() {
    setLocale(normalizeLocale(getLocale()));
    applyDocumentMeta();
    rebuildLangSelect(els.uiLang);
    applyDomI18n();
    if (els.appVersion) els.appVersion.textContent = APP_VERSION;

    setStatus(lastStatusShown.state, lastStatusShown.detail);
    updateConnWatchUI(lastStatusShown.state);

    if (chart) {
      try {
        chart.setOption({ toolbox: chartToolboxOption() });
      } catch (e) {
        /* ignore */
      }
    }

    updateLogLimitBadge();
    updateChartLimitBadge();
    void refreshPorts();
  }

  function initLocaleFromStorage() {
    initFromStorage();
    applyAllUiLanguage();
  }

  function bind() {
    els.mode.addEventListener("change", () => {
      try {
        localStorage.setItem(LS_MODE, els.mode.value);
      } catch (e) {
        /* ignore */
      }
      switchModeUI();
    });
    if (els.uiLang) {
      els.uiLang.addEventListener("change", () => {
        const v = els.uiLang.value;
        if (!SUPPORTED_LOCALES.includes(v)) return;
        persistLocale(v);
        applyAllUiLanguage();
      });
    }
    els.btnConnect.addEventListener("click", apiConnect);
    els.btnDisconnect.addEventListener("click", apiDisconnect);
    els.btnRefreshPorts.addEventListener("click", refreshPorts);
    if (els.txEchoLog) {
      els.txEchoLog.addEventListener("change", persistTxEchoToStorage);
    }
    els.btnClearLog.addEventListener("click", () => {
      els.logView.innerHTML = "";
      updateLogLimitBadge();
    });
    const clearBtn = els.btnClearPlot || document.getElementById("btnClearPlot");
    if (clearBtn) {
      clearBtn.addEventListener(
        "click",
        (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          clearPlot();
        },
        true
      );
    }
    if (els.btnCopyChartCsv) {
      els.btnCopyChartCsv.addEventListener("click", () => {
        copyChartCsv();
      });
    }
    if (els.btnExportChartCsv) {
      els.btnExportChartCsv.addEventListener("click", () => {
        exportChartCsv();
      });
    }
    if (els.btnChartResetZoom) {
      els.btnChartResetZoom.addEventListener("click", () => {
        resetChartZoom();
      });
    }
    if (els.btnChartPause) {
      els.btnChartPause.addEventListener("click", () => {
        chartReadingPaused = true;
        updateChartReadButtons();
        appendLog("SYS", t("logChartPaused"), new Date().toISOString());
      });
    }
    if (els.btnChartStartRead) {
      els.btnChartStartRead.addEventListener("click", () => {
        chartReadingPaused = false;
        updateChartReadButtons();
        appendLog("SYS", t("logChartResume"), new Date().toISOString());
      });
    }
    els.btnSend.addEventListener("click", () => {
      sendFromUi({ clearInput: true });
    });
    if (els.btnCmdHist) {
      els.btnCmdHist.addEventListener("click", (e) => {
        e.preventDefault();
        toggleCmdHistPop();
      });
    }
    if (els.btnClearCmdHist) {
      els.btnClearCmdHist.addEventListener("click", (e) => {
        e.preventDefault();
        try {
          clearCmdHistory();
        } catch (err) {
          appendLog("ERR", tf("logSendErr", err), new Date().toISOString());
        }
      });
    }
    document.addEventListener(
      "mousedown",
      (e) => {
        if (!els.cmdHistPop || els.cmdHistPop.hidden) return;
        const t = e.target;
        if (els.cmdHistPop.contains(t)) return;
        if (els.btnCmdHist && els.btnCmdHist.contains(t)) return;
        setCmdHistOpen(false);
      },
      true
    );
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (els.cmdHistPop && !els.cmdHistPop.hidden) {
        setCmdHistOpen(false);
      }
    });
    els.cmdInput.addEventListener("input", () => {
      if (cmdHistProgrammatic) return;
      cmdHistPos = null;
    });
    els.cmdInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        sendFromUi({ clearInput: true });
        return;
      }
      if (e.key === "ArrowUp") {
        if (cmdHistory.length === 0) return;
        e.preventDefault();
        if (cmdHistPos === null) {
          cmdHistDraft = els.cmdInput.value;
          cmdHistPos = cmdHistory.length - 1;
        } else if (cmdHistPos > 0) {
          cmdHistPos -= 1;
        }
        setCmdInputValueFromHistory(cmdHistory[cmdHistPos]);
        return;
      }
      if (e.key === "ArrowDown") {
        if (cmdHistPos === null) return;
        e.preventDefault();
        if (cmdHistPos >= cmdHistory.length - 1) {
          cmdHistPos = null;
          setCmdInputValueFromHistory(cmdHistDraft);
          return;
        }
        cmdHistPos += 1;
        setCmdInputValueFromHistory(cmdHistory[cmdHistPos]);
      }
    });
    if (els.tcpHost) {
      els.tcpHost.addEventListener("input", scheduleSaveTcpForm);
      els.tcpHost.addEventListener("change", saveTcpForm);
    }
    if (els.tcpPort) {
      els.tcpPort.addEventListener("input", scheduleSaveTcpForm);
      els.tcpPort.addEventListener("change", saveTcpForm);
    }
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        fetchStatusOnce();
      }
    });
  }

  loadCmdHistory();
  loadTcpRecent();
  loadTxEchoFromStorage();

  bind();
  initLocaleFromStorage();
  initChart();
  loadTcpForm();
  renderTcpRecentChips();
  updateLogLimitBadge();
  updateChartReadButtons();
  window.__hostClearPlot = clearPlot;

  syncModeSelectFromStatus({ state: "disconnected", mode: null });
  refreshPorts();
  connectWs();
  fetch("/api/status")
    .then((r) => r.json())
    .then((s) => {
      applyServerStatus(s);
    })
    .catch(() => { });
})();
