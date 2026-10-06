// El script para Scriptable (docs/widget-iphone.md) que copia la persona desde Más → Widget para
// iPhone. Es el mismo para todos: no lleva el código personal. La primera vez que se ejecuta en
// Scriptable lo pide y lo guarda en el Keychain del teléfono. Lee la forma de `WidgetView`
// (`view.ts`, versión 1): mantenerlos en sincronía. Guarda el último resumen en el teléfono para
// mostrarlo sin conexión, y lo borra si el código ya no sirve.
//
// Va como texto: dentro del script no se usan plantillas con comillas invertidas, para que la única
// interpolación sea el origen, escapado con `JSON.stringify`. Tampoco barras invertidas: dentro de
// esta plantilla se pierden (`\.` llega como `.`).

export const SCRIPT_NAME = "Portfolio";

export function buildScriptableScript(origin: string): string {
  return `// ${SCRIPT_NAME}: widget de Portfolio Tracker para Scriptable.
// No lleva tu código: la primera vez que lo ejecutes en Scriptable te lo va a pedir y lo guarda
// en el Keychain de este teléfono. Para cambiarlo o borrarlo, volvé a ejecutarlo.

const ORIGIN = ${JSON.stringify(origin)};
const KEYCHAIN_KEY = "portfolio-tracker-widget-token";
const TOKEN_PATTERN = /^ptw_[A-Za-z0-9_-]{43}$/;
const VIEW_VERSION = 1;
// Cada cuánto se le pide al iPhone que redibuje el widget (iOS puede tardar más, nunca menos).
// Redibujar solo consulta nuestro servidor: a Yahoo se le piden precios recién cuando los
// guardados tienen 2 horas o más (lo decide el servidor).
const REFRESH_MINUTES = 30;

const COLORS = {
  background: Color.dynamic(new Color("#ffffff"), new Color("#18181b")),
  text: Color.dynamic(new Color("#18181b"), new Color("#fafafa")),
  muted: Color.dynamic(new Color("#71717a"), new Color("#a1a1aa")),
  gain: Color.dynamic(new Color("#15803d"), new Color("#4ade80")),
  loss: Color.dynamic(new Color("#b91c1c"), new Color("#f87171")),
};

// El campo «Parameter» del widget (mantenerlo apretado → Editar widget): el nombre de un
// portafolio, para tener un widget por portafolio con el mismo código. Vacío = lo que eligió el código.
const PORTFOLIO =
  typeof args !== "undefined" && args.widgetParameter ? String(args.widgetParameter).trim() : "";

// El último resumen, uno por widget (por portafolio): dos widgets no se pisan sin conexión.
const fm = FileManager.local();
const CACHE_PREFIX = "portfolio-tracker-widget";
const cachePath = fm.joinPath(
  fm.cacheDirectory(),
  CACHE_PREFIX + (PORTFOLIO ? "-" + encodeURIComponent(PORTFOLIO.toLowerCase()) : "") + ".json",
);

function readToken() {
  return Keychain.contains(KEYCHAIN_KEY) ? Keychain.get(KEYCHAIN_KEY) : null;
}

async function askToken() {
  const alert = new Alert();
  alert.title = "Tu código del widget";
  alert.message = "Pegá el código que creaste en la app, en Más → Widget para iPhone. Empieza con ptw_.";
  alert.addSecureTextField("ptw_…", "");
  alert.addAction("Guardar");
  alert.addCancelAction("Cancelar");
  if ((await alert.presentAlert()) === -1) return false;
  const token = alert.textFieldValue(0).trim();
  if (!TOKEN_PATTERN.test(token)) {
    const wrong = new Alert();
    wrong.title = "Ese código no parece correcto";
    wrong.message = "Copialo de nuevo desde la app: empieza con ptw_ y no lleva espacios.";
    wrong.addAction("Entendido");
    await wrong.presentAlert();
    return false;
  }
  Keychain.set(KEYCHAIN_KEY, token);
  forgetAllSummaries();
  return true;
}

function saveSummary(view) {
  fm.writeString(cachePath, JSON.stringify(view));
}

function lastSummary() {
  if (!fm.fileExists(cachePath)) return null;
  try {
    const view = JSON.parse(fm.readString(cachePath));
    return view && view.version === VIEW_VERSION ? view : null;
  } catch (error) {
    return null;
  }
}

function forgetSummary() {
  if (fm.fileExists(cachePath)) fm.remove(cachePath);
}

/** Los de todos los widgets: al cambiar o borrar el código. */
function forgetAllSummaries() {
  const dir = fm.cacheDirectory();
  for (const name of fm.listContents(dir)) {
    if (name.indexOf(CACHE_PREFIX) === 0 && name.slice(-5) === ".json") fm.remove(fm.joinPath(dir, name));
  }
}

async function fetchSummary(token) {
  const request = new Request(
    ORIGIN + "/api/widget" + (PORTFOLIO ? "?portfolio=" + encodeURIComponent(PORTFOLIO) : ""),
  );
  request.headers = { Authorization: "Bearer " + token, Accept: "application/json" };
  request.timeoutInterval = 20;
  let text;
  try {
    text = await request.loadString();
  } catch (error) {
    return { error: "offline" };
  }
  const status = request.response ? request.response.statusCode : 0;
  if (status === 401) return { error: "unauthorized" };
  if (status === 404) return { error: "unknown_portfolio" };
  if (status === 429) return { error: "rate_limited" };
  if (status !== 200) return { error: "error" };
  try {
    const view = JSON.parse(text);
    if (view && view.version === VIEW_VERSION) return { view: view };
  } catch (error) {}
  return { error: "error" };
}

function toneColor(tone) {
  if (tone === "gain") return COLORS.gain;
  if (tone === "loss") return COLORS.loss;
  return COLORS.muted;
}

function arrow(tone) {
  if (tone === "gain") return "▲ ";
  if (tone === "loss") return "▼ ";
  return "";
}

function time(iso) {
  const formatter = new DateFormatter();
  formatter.dateFormat = "HH:mm";
  return formatter.string(new Date(iso));
}

function addText(stack, text, size, color, weight) {
  const line = stack.addText(text);
  line.font =
    weight === "bold"
      ? Font.boldSystemFont(size)
      : weight === "semibold"
        ? Font.semiboldSystemFont(size)
        : Font.systemFont(size);
  line.textColor = color;
  line.lineLimit = 1;
  line.minimumScaleFactor = 0.5;
  return line;
}

function footerText(view, note) {
  const parts = [];
  if (note) parts.push(note);
  if (view.partial) parts.push("Total parcial");
  parts.push("Actualizado " + time(view.generatedAt));
  // La fecha de los precios solo si no son de hoy (un fin de semana, antes de la apertura).
  if (!view.pricesToday && view.pricesAsOf) parts.push("precios al " + view.pricesAsOf);
  return parts.join(" · ");
}

function changeText(tone, amount, pct) {
  return arrow(tone) + amount + (pct ? " (" + pct + ")" : "");
}

function addChange(stack, label, tone, amount, pct) {
  addText(stack, label, 11, COLORS.muted, "semibold");
  addText(stack, changeText(tone, amount, pct), 12, toneColor(tone));
}

function addSummary(stack, view, totalSize) {
  addText(stack, view.title || "Portafolio", 12, COLORS.muted, "semibold");
  stack.addSpacer(4);
  addText(stack, view.totalValue, totalSize, COLORS.text, "bold");
  if (view.dayChange) {
    stack.addSpacer(6);
    addChange(stack, "Hoy", view.dayTone, view.dayChange, view.dayChangePct);
  }
}

function addGain(stack, view) {
  if (!view.totalGain) return;
  addChange(stack, "Ganancia total", view.gainTone, view.totalGain, view.totalGainPct);
}

function addPositions(stack, view, count, withValue) {
  for (const position of view.positions.slice(0, count)) {
    const row = stack.addStack();
    row.layoutHorizontally();
    row.centerAlignContent();
    addText(row, position.symbol, 12, COLORS.text, "semibold");
    row.addSpacer();
    if (withValue) {
      addText(row, position.value, 12, COLORS.muted);
      row.addSpacer(8);
    }
    // Ancho fijo para que los porcentajes queden alineados a la derecha.
    const cell = row.addStack();
    cell.size = new Size(withValue ? 72 : 64, 0);
    cell.addSpacer();
    addText(
      cell,
      position.dayChangePct ? arrow(position.dayTone) + position.dayChangePct : "—",
      12,
      toneColor(position.dayTone),
    );
    stack.addSpacer(3);
  }
}

function accessoryWidget(view, family) {
  const widget = new ListWidget();
  if (family === "accessoryInline") {
    widget.addText(arrow(view.dayTone) + (view.dayChangePct || "") + " · " + view.totalValue);
    return widget;
  }
  if (family === "accessoryCircular") {
    const pct = widget.addText(view.dayChangePct || "—");
    pct.font = Font.semiboldSystemFont(12);
    pct.minimumScaleFactor = 0.5;
    pct.centerAlignText();
    return widget;
  }
  const title = widget.addText(view.title || "Portafolio");
  title.font = Font.semiboldSystemFont(11);
  const total = widget.addText(view.totalValue);
  total.font = Font.boldSystemFont(15);
  total.minimumScaleFactor = 0.5;
  if (view.dayChangePct) {
    const day = widget.addText("Hoy " + arrow(view.dayTone) + view.dayChangePct);
    day.font = Font.systemFont(12);
  }
  return widget;
}

function summaryWidget(view, family, note) {
  if (family && family.indexOf("accessory") === 0) return accessoryWidget(view, family);

  const widget = new ListWidget();
  widget.backgroundColor = COLORS.background;
  widget.setPadding(14, 14, 14, 14);

  if (!view.hasTransactions) {
    addText(widget, view.title || "Portafolio", 12, COLORS.muted, "semibold");
    widget.addSpacer();
    const empty = widget.addText("Todavía no cargaste operaciones.");
    empty.font = Font.systemFont(13);
    empty.textColor = COLORS.text;
    return widget;
  }

  if (family === "medium") {
    const columns = widget.addStack();
    columns.layoutHorizontally();
    const left = columns.addStack();
    left.layoutVertically();
    addSummary(left, view, 22);
    columns.addSpacer(16);
    const right = columns.addStack();
    right.layoutVertically();
    addGain(right, view);
    right.addSpacer(6);
    addPositions(right, view, 4, false);
  } else {
    addSummary(widget, view, family === "large" ? 30 : 22);
    if (family === "large") {
      widget.addSpacer(12);
      addGain(widget, view);
      widget.addSpacer(12);
      addPositions(widget, view, 6, true);
    }
  }

  widget.addSpacer();
  addText(widget, footerText(view, note), 10, COLORS.muted);
  return widget;
}

function messageWidget(title, message) {
  const widget = new ListWidget();
  widget.backgroundColor = COLORS.background;
  widget.setPadding(14, 14, 14, 14);
  const head = widget.addText(title);
  head.font = Font.semiboldSystemFont(13);
  head.textColor = COLORS.text;
  widget.addSpacer(4);
  const body = widget.addText(message);
  body.font = Font.systemFont(12);
  body.textColor = COLORS.muted;
  body.minimumScaleFactor = 0.6;
  return widget;
}

async function buildWidget(family) {
  const token = readToken();
  if (!token) {
    return messageWidget("Falta tu código", "Abrí Scriptable y ejecutá este script para cargarlo.");
  }
  const result = await fetchSummary(token);
  if (result.view) {
    saveSummary(result.view);
    return summaryWidget(result.view, family, null);
  }
  if (result.error === "unauthorized") {
    forgetSummary();
    return messageWidget(
      "Código revocado o incorrecto",
      "Creá uno nuevo en la app, en Más → Widget para iPhone, y volvé a ejecutar este script.",
    );
  }
  if (result.error === "unknown_portfolio") {
    forgetSummary();
    return messageWidget(
      "No encontré «" + PORTFOLIO + "»",
      "Revisá el nombre en Editar widget → Parameter: tiene que ser el de la app (las mayúsculas no importan). Si tu código es de un solo portafolio, solo muestra ese.",
    );
  }
  const last = lastSummary();
  const note = result.error === "offline" ? "Sin conexión" : "Sin actualizar";
  if (last) return summaryWidget(last, family, note);
  if (result.error === "rate_limited") {
    return messageWidget("Demasiadas consultas", "Esperá un rato y se va a actualizar solo.");
  }
  return messageWidget("No se pudo actualizar", "Revisá la conexión; el widget vuelve a probar solo.");
}

async function main() {
  if (config.runsInApp) {
    if (!readToken()) {
      if (!(await askToken())) return;
    } else {
      const menu = new Alert();
      menu.title = "Widget del portafolio";
      menu.addAction("Ver el widget");
      menu.addAction("Cambiar el código");
      menu.addDestructiveAction("Borrar el código");
      menu.addCancelAction("Cerrar");
      const choice = await menu.presentSheet();
      if (choice === -1) return;
      if (choice === 1 && !(await askToken())) return;
      if (choice === 2) {
        Keychain.remove(KEYCHAIN_KEY);
        forgetAllSummaries();
        return;
      }
    }
  }

  const family = config.widgetFamily || "medium";
  const widget = await buildWidget(family);
  widget.url = ORIGIN;
  widget.refreshAfterDate = new Date(Date.now() + REFRESH_MINUTES * 60 * 1000);

  if (config.runsInWidget) {
    Script.setWidget(widget);
  } else {
    await widget.presentMedium();
  }
}

await main();
Script.complete();
`;
}
