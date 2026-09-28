// Pantalla sin conexión: muestra el último estado que la app guardó en este dispositivo
// (`SnapshotSaver`, en Inicio). Lee la clave de lib/portfolio/snapshot-cache.ts (SNAPSHOT_KEY) y
// escribe solo con textContent: nada de lo guardado se interpreta como HTML.
(function () {
  var KEY = "pt:snapshot:v1";
  var MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

  function text(value) {
    return typeof value === "string" ? value : "";
  }

  function read() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (!data || data.version !== 1) return null;
      var savedAt = new Date(text(data.savedAt));
      var age = Date.now() - savedAt.getTime();
      if (!isFinite(age) || age > MAX_AGE_MS || age < -3600000) return null;
      if (!text(data.totalValue)) return null;
      return { data: data, savedAt: savedAt };
    } catch {
      return null;
    }
  }

  function when(date) {
    try {
      return new Intl.DateTimeFormat("es-UY", {
        timeZone: "America/Montevideo",
        dateStyle: "short",
        timeStyle: "short",
      }).format(date);
    } catch {
      return date.toISOString();
    }
  }

  var found = read();
  if (found) {
    var data = found.data;
    document.getElementById("total").textContent = text(data.totalValue);
    // Con varios portafolios, de cuál es el estado guardado (el último que se miró en Inicio).
    if (text(data.portfolioName)) {
      document.getElementById("total-label").textContent =
        "Valor total · " + text(data.portfolioName);
    }

    var day = document.getElementById("day");
    var change = text(data.dayChange);
    if (change) {
      var pct = text(data.dayChangePct);
      // Signo y flecha además del color (daltonismo), igual que en la app.
      var arrow =
        data.tone === "gain" ? "▲ " : data.tone === "loss" ? "▼ " : "";
      day.textContent = "Hoy " + arrow + change + (pct ? " (" + pct + ")" : "");
      if (data.tone === "gain" || data.tone === "loss")
        day.className += " " + data.tone;
    }
    if (text(data.cash)) {
      document.getElementById("cash").textContent =
        "Efectivo " + text(data.cash);
    }

    var list = document.getElementById("positions");
    var positions = Array.isArray(data.positions)
      ? data.positions.slice(0, 10)
      : [];
    positions.forEach(function (position) {
      if (!position || !text(position.symbol)) return;
      var item = document.createElement("li");
      var symbol = document.createElement("span");
      var value = document.createElement("span");
      symbol.textContent = text(position.symbol);
      value.textContent = text(position.value);
      item.appendChild(symbol);
      item.appendChild(value);
      list.appendChild(item);
    });

    document.getElementById("when").textContent =
      // Sin punto tras la fecha: el formato es-UY ya termina en "p. m." y quedaría "p. m..".
      "Datos guardados el " +
      when(found.savedAt) +
      " · pueden estar desactualizados.";
    document.getElementById("snapshot").hidden = false;
  }

  document.getElementById("retry").addEventListener("click", function () {
    location.reload();
  });
  window.addEventListener("online", function () {
    location.reload();
  });
})();
