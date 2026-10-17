/* =====================================================================
   AUDITOR ENERGÉTICO PRO — Lógica principal
   ===================================================================== */

/* ───────────── 1. CONFIGURACIÓN (modifica aquí) ───────────── */
const CONFIG = {
  // ► Número de WhatsApp comercial (Colombia +57 + 3108644360), SIN "+" ni espacios.
  WHATSAPP_NUMBER: "573108644360",

  // ► Moneda y formato
  CURRENCY: "COP",
  LOCALE: "es-CO",
  DECIMALS: 0,               // Usa 2 para mostrar $X.XX

  // ► Costo base del kWh por sector (valores de EJEMPLO: ajústalos a tu tarifa local)
  TARIFAS: {
    residencial: { label: "Residencial", kwh: 850 },
    comercial:   { label: "Comercial",   kwh: 950 },
    industrial:  { label: "Industrial",  kwh: 780 },
  },
  DEFAULT_SECTOR: "comercial",

  // ► Mejora esperada con tecnología Inverter / respaldo solar (40 %–60 %)
  SAVINGS_MIN: 0.40,
  SAVINGS_MAX: 0.60,         // El resultado principal usa el punto medio (50 %)

  DAYS_PER_MONTH: 30,

  // ► Tipos de equipo.
  //   duty  = factor de ciclo (fracción del tiempo que el compresor trabaja realmente)
  //   toWatts = convierte la capacidad ingresada a vatios eléctricos
  //   Aire On/Off: ~9 BTU/h por vatio (EER típico de equipos antiguos)
  EQUIPOS: {
    ac:        { label: "Aire acondicionado On/Off", unit: "BTU/h", def: 12000, duty: 0.70, toWatts: v => v / 9 },
    nevera:    { label: "Neveras comerciales",       unit: "W",     def: 350,   duty: 0.50, toWatts: v => v },
    enfriador: { label: "Enfriadores",               unit: "W",     def: 1500,  duty: 0.60, toWatts: v => v },
  },
};

/* ───────────── 2. UTILIDADES ───────────── */
const $ = id => document.getElementById(id);
const money = n => new Intl.NumberFormat(CONFIG.LOCALE, {
  style: "currency", currency: CONFIG.CURRENCY,
  minimumFractionDigits: CONFIG.DECIMALS, maximumFractionDigits: CONFIG.DECIMALS,
}).format(n);
const num = (n, d = 0) => new Intl.NumberFormat(CONFIG.LOCALE, { maximumFractionDigits: d }).format(n);

const state = { step: 1, sector: CONFIG.DEFAULT_SECTOR, result: null };

/* ───────────── 3. MOTOR DE CÁLCULO ───────────── */
function calculate({ area, tarifa, equipo, qty, cap, horas }) {
  const eq = CONFIG.EQUIPOS[equipo];
  const watts = eq.toWatts(cap);

  // 1) Consumo mensual actual (kWh)
  const kwhMes = (qty * watts * horas * CONFIG.DAYS_PER_MONTH * eq.duty) / 1000;
  // 2) Costo mensual actual
  const costoActual = kwhMes * tarifa;
  // 3) Consumo/costo eficiente ideal (punto medio y rango)
  const mid = (CONFIG.SAVINGS_MIN + CONFIG.SAVINGS_MAX) / 2;
  const costoIdeal = costoActual * (1 - mid);
  // 4) Fuga energética mensual
  const fuga = costoActual - costoIdeal;

  return {
    kwhMes, costoActual, costoIdeal, fuga, mid,
    fugaMin: costoActual * CONFIG.SAVINGS_MIN,
    fugaMax: costoActual * CONFIG.SAVINGS_MAX,
    fugaAnual: fuga * 12,
    kwhM2: kwhMes / area,
    inputs: { area, tarifa, equipo, qty, cap, horas },
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
  const q = setErr("qty", positive("qty") ? "" : "Debe haber al menos 1 equipo.");
  const c = setErr("cap", positive("cap") ? "" : "Ingresa la capacidad del equipo.");
  return q && c;
}

function next() {
  if (!validateStep(state.step)) return;
  if (state.step === 2) { renderResults(); showStep(3); } else showStep(state.step + 1);
}

/* ───────────── 5. UI: SECTOR, EQUIPO, RESULTADOS ───────────── */
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

function buildEquipos() {
  const sel = $("equipo");
  Object.entries(CONFIG.EQUIPOS).forEach(([k, e]) => sel.add(new Option(e.label, k)));
  sel.onchange = syncEquipo;
  syncEquipo();
}
function syncEquipo() {
  const e = CONFIG.EQUIPOS[$("equipo").value];
  $("unit").textContent = e.unit;
  $("cap").value = e.def;
}

function renderResults() {
  const r = calculate({
    area: parseFloat($("area").value), tarifa: parseFloat($("tarifa").value),
    equipo: $("equipo").value, qty: parseInt($("qty").value, 10),
    cap: parseFloat($("cap").value), horas: parseInt($("horas").value, 10),
  });
  state.result = r;

  $("leakNum").textContent = money(r.fuga);
  $("leakRange").textContent =
    `Rango estimado: ${money(r.fugaMin)} – ${money(r.fugaMax)} al mes ` +
    `(${CONFIG.SAVINGS_MIN * 100}%–${CONFIG.SAVINGS_MAX * 100}% de mejora)`;
  $("valNow").textContent = money(r.costoActual);
  $("valIdeal").textContent = money(r.costoIdeal);
  $("fKwh").textContent = `${num(r.kwhMes)} kWh/mes`;
  $("fPct").textContent = `${Math.round(r.mid * 100)} %`;
  $("fYear").textContent = money(r.fugaAnual);
  $("fM2").textContent = `${num(r.kwhM2, 1)} kWh/m²`;

  // Barras: la actual = 100 %, la eficiente proporcional (animadas por CSS)
  $("barNow").style.width = "0"; $("barIdeal").style.width = "0";
  requestAnimationFrame(() => requestAnimationFrame(() => {
    $("barNow").style.width = "100%";
    $("barIdeal").style.width = (r.costoIdeal / r.costoActual * 100) + "%";
  }));
}

/* ───────────── 6. WHATSAPP ───────────── */
function sendWhatsApp() {
  const r = state.result; if (!r) return;
  const i = r.inputs, eq = CONFIG.EQUIPOS[i.equipo];
  const msg = [
    "*Auditor Energético PRO – Solicitud de auditoría*",
    "",
    `Sector: ${CONFIG.TARIFAS[state.sector].label}`,
    `Área: ${num(i.area)} m²`,
    `Tarifa: ${money(i.tarifa)}/kWh`,
    `Equipos: ${i.qty} × ${eq.label} (${num(i.cap)} ${eq.unit}), ${i.horas} h/día`,
    "",
    `Consumo actual: ${num(r.kwhMes)} kWh/mes`,
    `Gasto actual: ${money(r.costoActual)}/mes`,
    `Gasto eficiente: ${money(r.costoIdeal)}/mes`,
    `*Fuga energética: ${money(r.fuga)}/mes* (${money(r.fugaAnual)}/año)`,
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
  buildSectors(); buildEquipos();

  $("next").onclick = next;
  $("back").onclick = () => showStep(state.step - 1);
  $("restart").onclick = () => showStep(1);
  $("cta").onclick = sendWhatsApp;
  $("themeBtn").onclick = toggleTheme;
  applyTheme(document.documentElement.dataset.theme);
  $("qty-minus").onclick = () => $("qty").value = Math.max(1, (parseInt($("qty").value, 10) || 1) - 1);
  $("qty-plus").onclick  = () => $("qty").value = (parseInt($("qty").value, 10) || 0) + 1;
  $("horas").oninput = e => $("horasOut").textContent = e.target.value;

  // Registro del Service Worker (requiere HTTPS o localhost)
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("service-worker.js").catch(err => console.warn("SW:", err));
  }
}
document.addEventListener("DOMContentLoaded", init);
