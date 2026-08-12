// Pestaña "Gráficos" — programado vs real, por fase (Terminaciones por ahora;
// Obra Gruesa se agrega cuando se construya esa sección). Eje Y = piso
// aproximado (incluye el 0 — "piso aprox" es progreso continuo, no el número
// de piso literal: 0,5 significa "mitad del primer piso terminado"). Eje X =
// semana (viernes), TODAS, sin scroll horizontal — el ancho real se mide del
// contenedor y las etiquetas se inclinan/comprimen según haga falta. Sin
// librerías externas: un solo <svg> armado a mano, igual que el resto de la
// app.

let _graf_ultimoPanel = null, _graf_ultimoConfig = null, _graf_ultimoHistorial = null;

function graficos_inicializar(idProyecto) {
  const panel = document.getElementById('panel-tab-graficos');
  if (!panel) return;
  panel.innerHTML = '<div class="proy-nav-placeholder">Cargando…</div>';

  const config = datos_cargarProyecto(idProyecto);
  if (!config) { panel.innerHTML = '<div class="proy-nav-placeholder">No se encontró el proyecto.</div>'; return; }

  datos_sincronizarHistorial(idProyecto, function(historial) {
    _graf_ultimoPanel = panel;
    _graf_ultimoConfig = config;
    _graf_ultimoHistorial = historial;
    _graf_render(panel, config, historial);
  });

  // Re-dibujar al cambiar el ancho de ventana (el gráfico se ajusta al
  // contenedor real, no a un ancho fijo) — mismo patrón de debounce que ya
  // usa terminaciones.js para su propio resize.
  if (!window._graf_resizeRegistrado) {
    let t = null;
    window.addEventListener('resize', function() {
      clearTimeout(t);
      t = setTimeout(function() {
        if (_graf_ultimoPanel && document.body.contains(_graf_ultimoPanel) && getComputedStyle(_graf_ultimoPanel).display !== 'none') {
          _graf_render(_graf_ultimoPanel, _graf_ultimoConfig, _graf_ultimoHistorial);
        }
      }, 200);
    });
    window._graf_resizeRegistrado = true;
  }
}

function _graf_render(panel, config, historial) {
  const programacion = config.programacion || [];
  const filas = (typeof consolidado_cruzarSemanas === 'function') ? consolidado_cruzarSemanas(config, historial, programacion) : [];
  const fases = (typeof logica_fasesEfectivas === 'function') ? logica_fasesEfectivas(config) : [1, 2, 3, 4, 5, 6];

  if (!filas.length) {
    panel.innerHTML = `
      <div class="proy-nav-placeholder">
        Todavía no hay datos para graficar.<br>
        <span class="cf-hint">Carga la programación en "⚙ Configurar" (Paso 4) y confirma al menos una semana de avances.</span>
      </div>`;
    return;
  }

  // Dominio del eje Y (piso aproximado) — puede ser negativo antes del inicio de obra gruesa.
  let minY = 0, maxY = 1;
  filas.forEach(function(fila) {
    fases.forEach(function(f) {
      const p = fila.prog && fila.prog[f];
      const r = fila.real && fila.real[f];
      if (p && p.piso !== null && p.piso !== undefined) { minY = Math.min(minY, p.piso); maxY = Math.max(maxY, p.piso); }
      if (r && r.piso !== null && r.piso !== undefined) { minY = Math.min(minY, r.piso); maxY = Math.max(maxY, r.piso); }
    });
  });
  const padY = (maxY - minY) * 0.08 || 1;
  minY -= padY; maxY += padY;

  const n = filas.length;
  const padL = 30, padR = 8, padT = 14;

  // Ancho: el real del contenedor (no crece con n) — con muchas semanas se
  // comprime el espacio entre ellas y se inclinan las etiquetas, en vez de
  // scrollear. Medido en vivo porque depende del tamaño real de pantalla.
  const W = Math.max(320, (panel.clientWidth || 900) - 8);
  const espacioPorSemana = n > 1 ? (W - padL - padR) / (n - 1) : (W - padL - padR);

  // Ángulo de las etiquetas del eje X según cuánto espacio quede por semana.
  let anguloX = 0;
  if (espacioPorSemana < 55) anguloX = 55;
  if (espacioPorSemana < 32) anguloX = 70;
  if (espacioPorSemana < 18) anguloX = 85;
  const padB = anguloX ? 58 : 30; // más alto abajo si las etiquetas quedan inclinadas

  // Alto: una línea de grilla por piso (eje Y = piso), con separación mínima
  // legible aunque el edificio tenga muchos pisos. Incluye el 0 si cae en el
  // rango — es un valor válido de "piso aprox", no el piso 0 del edificio.
  const primerPiso = Math.ceil(minY), ultimoPiso = Math.floor(maxY);
  const ticksY = [];
  for (let p = primerPiso; p <= ultimoPiso; p++) ticksY.push(p);
  const PX_POR_PISO = 20;
  const H = Math.max(380, padT + padB + Math.max(1, ticksY.length - 1) * PX_POR_PISO);

  const xAt = function(i) { return n <= 1 ? padL : padL + (i / (n - 1)) * (W - padL - padR); };
  const yAt = function(v) { return padT + (1 - (v - minY) / (maxY - minY)) * (H - padT - padB); };

  function polyline(getter) {
    const pts = [];
    filas.forEach(function(fila, i) {
      const v = getter(fila);
      if (v === null || v === undefined) return;
      pts.push(xAt(i).toFixed(1) + ',' + yAt(v).toFixed(1));
    });
    return pts.join(' ');
  }

  let svgLineas = '';
  fases.forEach(function(f) {
    const c = FASE_COLORES[f];
    const progPts = polyline(function(fila) { const p = fila.prog && fila.prog[f]; return (p && p.piso !== null && p.piso !== undefined) ? p.piso : null; });
    const realPts = polyline(function(fila) { const r = fila.real && fila.real[f]; return (r && r.piso !== null && r.piso !== undefined) ? r.piso : null; });
    if (progPts) svgLineas += `<polyline points="${progPts}" fill="none" stroke="${c.enc}" stroke-width="2" stroke-dasharray="5,4"/>`;
    if (realPts) svgLineas += `<polyline points="${realPts}" fill="none" stroke="${c.enc}" stroke-width="2.5"/>`;
  });

  // Grilla vertical (una línea por semana) + etiquetas del eje X — TODAS las
  // semanas, inclinadas y/o comprimidas según el ancho real disponible.
  let grillaXLineas = '', etiquetasX = '';
  filas.forEach(function(fila, i) {
    const x = xAt(i);
    grillaXLineas += `<line x1="${x.toFixed(1)}" y1="${padT}" x2="${x.toFixed(1)}" y2="${(H - padB).toFixed(1)}" stroke="#F2EEE7" stroke-width="1"/>`;
    const yEtq = H - padB + (anguloX ? 10 : 14);
    const transform = anguloX ? ` transform="rotate(-${anguloX} ${x.toFixed(1)} ${yEtq})"` : '';
    const anchor = anguloX ? 'end' : 'middle';
    etiquetasX += `<text x="${x.toFixed(1)}" y="${yEtq}" font-size="8.5" fill="#A09A93" text-anchor="${anchor}"${transform}>${logica_formatearFecha(fila.semana).slice(0, 5)}</text>`;
  });

  // Grilla horizontal (una línea por piso) + etiquetas del eje Y — solo el
  // número, sin sufijo.
  let grillaYLineas = '', etiquetasY = '';
  ticksY.forEach(function(p) {
    const y = yAt(p);
    grillaYLineas += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${(W - padR).toFixed(1)}" y2="${y.toFixed(1)}" stroke="#EFEBE4" stroke-width="1"/>`;
    etiquetasY += `<text x="4" y="${(y + 3).toFixed(1)}" font-size="9" fill="#A09A93">${p}</text>`;
  });

  const leyendaFases = fases.map(function(f) {
    const c = FASE_COLORES[f];
    const nombre = NOMBRES_FASES[f].split('–')[0].trim();
    return `<span class="graf-leyenda-item"><i class="graf-dot" style="background:${c.enc}"></i>${nombre}</span>`;
  }).join('');

  panel.innerHTML = `
    <div class="graf-contenedor">
      <div class="graf-svg-wrap">
        <svg width="${W}" height="${H}" class="graf-svg" style="width:${W}px;">
          ${grillaXLineas}
          ${grillaYLineas}
          <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${(H - padB).toFixed(1)}" stroke="#E2DDD4"/>
          <line x1="${padL}" y1="${(H - padB).toFixed(1)}" x2="${(W - padR).toFixed(1)}" y2="${(H - padB).toFixed(1)}" stroke="#E2DDD4"/>
          ${svgLineas}
          ${etiquetasX}
          ${etiquetasY}
        </svg>
      </div>
      <div class="graf-leyenda graf-leyenda-abajo">
        ${leyendaFases}
        <span class="graf-leyenda-item"><i class="graf-linea-muestra"></i>Real</span>
        <span class="graf-leyenda-item"><i class="graf-linea-muestra graf-punteada"></i>Programado</span>
      </div>
    </div>`;
}
