/* =====================================================================
   AUDITOR ENERGÉTICO PRO — Lógica principal (multi-equipo)
   ===================================================================== */

/* ───────────── 1. CONFIGURACIÓN (modifica aquí) ───────────── */
const CONFIG = {
  // ► Número de WhatsApp comercial (+57 3108644360), SIN "+" ni espacios.
  WHATSAPP_NUMBER: "573108644360",

  // ► Moneda y formato (DECIMALS: 2 para mostrar $X.XX)
  CURRENCY: "COP",
  LOCALE: "es-CO",
  DECIMALS: 0,

  // ► Costo base del kWh por sector (valores de EJEMPLO: ajústalos a tu tarifa)
  TARIFAS: {
    residencial: { label: "Residencial", kwh: 850 },
    comercial:   { label: "Comercial",   kwh: 950 },
    industrial:  { label: "Industrial",  kwh: 780 },
  },
  DEFAULT_SECTOR: "comercial",

  DAYS_PER_MONTH: 30,

  // ► Máximo de tarjetas de equipo (se puede repetir el mismo tipo con distinta capacidad u horas)
  MAX_LINES: 10,

  // ► Tipos de equipo. Cada uno tiene su propio ahorro esperado (saveMin–saveMax);
  //   el cálculo usa el punto medio.
  //   duty    = factor de ciclo (fracción del tiempo que el compresor trabaja)
  //   toWatts = convierte la capacidad ingresada a vatios eléctricos
  //   Aire On/Off: ~9 BTU/h por vatio.
  EQUIPOS: {
    ac: {
      label: "Aire acondicionado On/Off", short: "Aires acondicionados",
      unit: "BTU/h", def: 12000, duty: 0.70, toWatts: v => v / 9,
      saveMin: 0.40, saveMax: 0.60,
    },
    nevera: {
      label: "Neveras y congeladores comerciales", short: "Neveras y congeladores",
      unit: "W", def: 350, duty: 0.50, toWatts: v => v,
      saveMin: 0.30, saveMax: 0.45,
    },
    enfriador: {
      label: "Cuarto frío / enfriador de agua", short: "Cuartos fríos y enfriadores",
      unit: "W", def: 1500, duty: 0.60, toWatts: v => v,
      saveMin: 0.35, saveMax: 0.55,
    },
  },
};

/* ───────────── 2. UTILIDADES ───────────── */
const $ = id => document.getElementById(id);
const money = n => new Intl.NumberFormat(CONFIG.LOCALE, {
  style: "currency", currency: CONFIG.CURRENCY,
  minimumFractionDigits: CONFIG.DECIMALS, maximumFractionDigits: CONFIG.DECIMALS,
}).format(n);
const num = (n, d = 0) => new Intl.NumberFormat(CONFIG.LOCALE, { maximumFractionDigits: d }).format(n);

const state = {
  step: 1,
  sector: CONFIG.DEFAULT_SECTOR,
  lines: [{ type: "ac", qty: 2, cap: CONFIG.EQUIPOS.ac.def, horas: 10 }],
  result: null,
};

/* ───────────── 3. MOTOR DE CÁLCULO ───────────── */
function calculate(area, tarifa, lines) {
  const detail = lines.map(l => {
    const eq = CONFIG.EQUIPOS[l.type];
    const qty = parseInt(l.qty, 10), cap = parseFloat(l.cap), horas = parseFloat(l.horas);
    // 1) Consumo mensual del grupo (kWh)
    const kwh = (qty * eq.toWatts(cap) * horas * CONFIG.DAYS_PER_MONTH * eq.duty) / 1000;
    // 2) Costo mensual actual del grupo
    const costo = kwh * tarifa;
    // 3) Ahorro propio del tipo de equipo (punto medio del rango)
    const save = (eq.saveMin + eq.saveMax) / 2;
    const fuga = costo * save;               // 4) Fuga del grupo
    return { type: l.type, qty, cap, horas, kwh, costo, fuga, costoIdeal: costo - fuga };
  });

  const sum = k => detail.reduce((a, d) => a + d[k], 0);
  const costoActual = sum("costo"), fuga = sum("fuga");
  return {
    detail, area, tarifa, costoActual, fuga,
    kwhMes: sum("kwh"),
    costoIdeal: costoActual - fuga,
    fugaPct: fuga / costoActual,
    fugaAnual: fuga * 12,
    fuga5: fuga * 60,
  };
}

/* ───────────── 4. NAVEGACIÓN POR PASOS ───────────── */
function showStep(n) {
  state.step = n;
  document.querySelectorAll(".step").forEach((s, i) => s.classList.toggle("active", i + 1 === n));
  [1, 2, 3].forEach(i => $("dot-" + i).classList.toggle("on", i <= n));
  $("back").hidden = n === 1;
  $("next").textContent = n === 2 ? "Calcular fuga" : "Continuar";
  $("stepLabel").textContent = ["Paso 1 de 3 · Datos del local", "Paso 2 de 3 · Climatización actual", "Paso 3 de 3 · Resultado"][n - 1];
  $("nav").classList.toggle("hide", n === 3);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function setErr(field, msg) {
  $("err-" + field).textContent = msg || "";
  $(field).classList.toggle("bad", !!msg);
  return !msg;
}
const positive = id => parseFloat($(id).value) > 0;

function validateStep(n) {
  if (n === 1) {
    const a = setErr("area", positive("area") ? "" : "Ingresa los m² del local.");
    const b = setErr("tarifa", positive("tarifa") ? "" : "Ingresa un costo por kWh mayor a 0.");
    return a && b;
  }
  let ok = true;
  document.querySelectorAll(".line").forEach((el, i) => {
    const l = state.lines[i];
    const qOk = parseInt(l.qty, 10) > 0, cOk = parseFloat(l.cap) > 0;
    el.querySelector('[data-f="qty"]').classList.toggle("bad", !qOk);
    el.querySelector('[data-f="cap"]').classList.toggle("bad", !cOk);
    el.querySelector("[data-err]").textContent = qOk && cOk ? "" : "Ingresa una cantidad y una capacidad mayores a 0.";
    if (!(qOk && cOk)) ok = false;
  });
  return ok;
}

function next() {
  if (!validateStep(state.step)) return;
  if (state.step === 2) { renderResults(); showStep(3); } else showStep(state.step + 1);
}

/* ───────────── 5. UI: SECTOR ───────────── */
function buildSectors() {
  const box = $("sector");
  Object.entries(CONFIG.TARIFAS).forEach(([key, t]) => {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = t.label; b.dataset.key = key;
    b.setAttribute("role", "radio");
    b.onclick = () => selectSector(key);
    box.appendChild(b);
  });
  selectSector(state.sector);
}
function selectSector(key) {
  state.sector = key;
  document.querySelectorAll("#sector button").forEach(b =>
    b.setAttribute("aria-checked", b.dataset.key === key));
  $("tarifa").value = CONFIG.TARIFAS[key].kwh;      // valor sugerido (editable)
}

/* ───────────── 5b. UI: LÍNEAS DE EQUIPO ───────────── */
function lineHTML(l, i) {
  const eq = CONFIG.EQUIPOS[l.type];
  const opts = Object.entries(CONFIG.EQUIPOS)
    .map(([k, e]) => `<option value="${k}"${k === l.type ? " selected" : ""}>${e.label}</option>`).join("");
  return `
  <div class="line" data-i="${i}">
    <div class="line-head">
      <span>Equipo ${i + 1}</span>
      ${state.lines.length > 1 ? `<button type="button" class="link" data-act="remove" aria-label="Quitar equipo ${i + 1}">Quitar</button>` : ""}
    </div>
    <label class="field"><span class="lbl">Tipo de equipo</span>
      <div class="input-wrap select-wrap"><select data-f="type">${opts}</select></div></label>
    <div class="field"><span class="lbl">Cantidad en funcionamiento</span>
      <div class="stepper">
        <button type="button" data-act="minus" aria-label="Quitar uno">−</button>
        <input data-f="qty" type="number" inputmode="numeric" min="1" value="${l.qty}" aria-label="Cantidad">
        <button type="button" data-act="plus" aria-label="Agregar uno">+</button>
      </div></div>
    <label class="field"><span class="lbl">Capacidad promedio</span>
      <div class="input-wrap"><input data-f="cap" type="number" inputmode="decimal" min="1" value="${l.cap}">
      <span class="suffix">${eq.unit}</span></div></label>
    <label class="field"><span class="lbl row-between">Horas de uso al día
      <b class="hours"><span data-out>${l.horas}</span> h</b></span>
      <input data-f="horas" type="range" min="1" max="24" value="${l.horas}"></label>
    <small class="err" data-err></small>
  </div>`;
}

function renderLines() {
  $("lines").innerHTML = state.lines.map(lineHTML).join("");
  $("addLine").hidden = state.lines.length >= CONFIG.MAX_LINES;
}

function bindLines() {
  const box = $("lines");
  box.addEventListener("input", e => {
    const f = e.target.dataset.f;
    if (!f || f === "type") return;
    const el = e.target.closest(".line");
    state.lines[+el.dataset.i][f] = e.target.value;
    if (f === "horas") el.querySelector("[data-out]").textContent = e.target.value;
    e.target.classList.remove("bad");
    el.querySelector("[data-err]").textContent = "";
  });
  box.addEventListener("change", e => {
    if (e.target.dataset.f !== "type") return;
    const l = state.lines[+e.target.closest(".line").dataset.i];
    l.type = e.target.value;
    l.cap = CONFIG.EQUIPOS[l.type].def;            // capacidad sugerida del nuevo tipo
    renderLines();
  });
  box.addEventListener("click", e => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const el = b.closest(".line"), i = +el.dataset.i, l = state.lines[i];
    if (b.dataset.act === "remove") { state.lines.splice(i, 1); renderLines(); return; }
    const cur = parseInt(l.qty, 10) || 0;
    l.qty = b.dataset.act === "plus" ? cur + 1 : Math.max(1, cur - 1);
    el.querySelector('[data-f="qty"]').value = l.qty;
    el.querySelector('[data-f="qty"]').classList.remove("bad");
  });
  $("addLine").onclick = () => {
    if (state.lines.length >= CONFIG.MAX_LINES) return;
    // Sugiere un tipo aún no usado; si ya están todos, repite el último
    const used = state.lines.map(l => l.type);
    const type = Object.keys(CONFIG.EQUIPOS).find(k => !used.includes(k)) || state.lines[state.lines.length - 1].type;
    state.lines.push({ type, qty: 1, cap: CONFIG.EQUIPOS[type].def, horas: 10 });
    renderLines();
    box.lastElementChild.scrollIntoView({ behavior: "smooth", block: "center" });
  };
}

/* ───────────── 5c. UI: RESULTADOS ───────────── */
function renderResults() {
  const r = calculate(parseFloat($("area").value), parseFloat($("tarifa").value), state.lines);
  state.result = r;

  $("leakNum").textContent = money(r.fuga);
  $("valNow").textContent = money(r.costoActual);
  $("valIdeal").textContent = money(r.costoIdeal);
  $("fKwh").textContent = `${num(r.kwhMes)} kWh/mes`;
  $("fPct").textContent = `${Math.round(r.fugaPct * 100)} %`;
  $("fYear").textContent = money(r.fugaAnual);
  $("f5y").textContent = money(r.fuga5);

  // Desglose por tipo de equipo (solo si hay más de uno), de mayor a menor pérdida
  const byType = {};
  r.detail.forEach(d => byType[d.type] = (byType[d.type] || 0) + d.fuga);
  const sorted = Object.entries(byType).map(([type, fuga]) => ({ type, fuga })).sort((a, b) => b.fuga - a.fuga);
  $("breakdown").hidden = sorted.length < 2;
  $("brows").innerHTML = sorted.map(d => {
    const share = d.fuga / r.fuga;
    return `<div class="brow">
      <div class="hrow-top"><span>${CONFIG.EQUIPOS[d.type].short} · ${Math.round(share * 100)} %</span><b>${money(d.fuga)}</b></div>
      <div class="track"><div class="fill loss" data-w="${share * 100}"></div></div></div>`;
  }).join("");

  // Animación de barras
  $("barNow").style.width = "0"; $("barIdeal").style.width = "0";
  requestAnimationFrame(() => requestAnimationFrame(() => {
    $("barNow").style.width = "100%";
    $("barIdeal").style.width = (r.costoIdeal / r.costoActual * 100) + "%";
    document.querySelectorAll("#brows .fill").forEach(f => f.style.width = f.dataset.w + "%");
  }));
}

/* ───────────── 6. WHATSAPP ───────────── */
function sendWhatsApp() {
  const r = state.result; if (!r) return;
  const equipos = r.detail.map(d => {
    const eq = CONFIG.EQUIPOS[d.type];
    return `• ${d.qty} × ${eq.label} (${num(d.cap)} ${eq.unit}, ${d.horas} h/día) → fuga ${money(d.fuga)}/mes`;
  });
  const msg = [
    "*Auditor Energético PRO – Solicitud de auditoría*",
    "",
    `Sector: ${CONFIG.TARIFAS[state.sector].label}`,
    `Área: ${num(r.area)} m²`,
    `Tarifa: ${money(r.tarifa)}/kWh`,
    "",
    "*Equipos:*",
    ...equipos,
    "",
    `Consumo actual: ${num(r.kwhMes)} kWh/mes`,
    `Gasto actual: ${money(r.costoActual)}/mes`,
    `Gasto eficiente: ${money(r.costoIdeal)}/mes`,
    `*Fuga energética: ${money(r.fuga)}/mes* (${Math.round(r.fugaPct * 100)} % del recibo)`,
    `Pérdida en 12 meses: ${money(r.fugaAnual)}`,
    "",
    "Quiero una auditoría detallada.",
  ].join("\n");
  window.open(`https://wa.me/${CONFIG.WHATSAPP_NUMBER}?text=${encodeURIComponent(msg)}`, "_blank", "noopener");
}

/* ───────────── 6b. TEMA CLARO / OSCURO ───────────── */
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  $("metaTheme").content = t === "dark" ? "#0C0F14" : "#F7F8FA";
  try { localStorage.setItem("theme", t); } catch (e) {}
}
function toggleTheme() {
  applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
}

/* ───────────── 7. INICIO ───────────── */
function init() {
  document.querySelectorAll(".cur").forEach(el => el.textContent = CONFIG.CURRENCY);
  buildSectors(); renderLines(); bindLines();

  $("next").onclick = next;
  $("back").onclick = () => showStep(state.step - 1);
  $("restart").onclick = () => {
    state.lines = [{ type: "ac", qty: 2, cap: CONFIG.EQUIPOS.ac.def, horas: 10 }];
    renderLines(); showStep(1);
  };
  $("cta").onclick = sendWhatsApp;
  $("themeBtn").onclick = toggleTheme;
  applyTheme(document.documentElement.dataset.theme);

  // Registro del Service Worker (requiere HTTPS o localhost)
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("service-worker.js").catch(err => console.warn("SW:", err));
  }
}
document.addEventListener("DOMContentLoaded", init);
