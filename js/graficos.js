// Pestaña "Gráficos" — programado vs real, por fase (Terminaciones por ahora;
// Obra Gruesa se agrega cuando se construya esa sección). Eje Y = piso
// aproximado, eje X = semana (viernes). Mismos colores de fase que el resto
// de la app (FASE_COLORES en actividades.js). Sin librerías externas: un solo
// <svg> armado a mano, igual que el resto de la app.

function graficos_inicializar(idProyecto) {
  const panel = document.getElementById('panel-tab-graficos');
  if (!panel) return;
  panel.innerHTML = '<div class="proy-nav-placeholder">Cargando…</div>';

  const config = datos_cargarProyecto(idProyecto);
  if (!config) { panel.innerHTML = '<div class="proy-nav-placeholder">No se encontró el proyecto.</div>'; return; }

  datos_sincronizarHistorial(idProyecto, function(historial) {
    _graf_render(panel, config, historial);
  });
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

  const W = 900, H = 380, padL = 40, padR = 16, padT = 16, padB = 30;
  const n = filas.length;
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

  // Etiquetas del eje X: no todas, para no amontonarlas.
  const paso = Math.max(1, Math.ceil(n / 8));
  let etiquetasX = '';
  filas.forEach(function(fila, i) {
    if (i % paso !== 0 && i !== n - 1) return;
    etiquetasX += `<text x="${xAt(i).toFixed(1)}" y="${H - 8}" font-size="9" fill="#A09A93" text-anchor="middle">${logica_formatearFecha(fila.semana).slice(0, 5)}</text>`;
  });

  const leyendaFases = fases.map(function(f) {
    const c = FASE_COLORES[f];
    const nombre = NOMBRES_FASES[f].split('–')[0].trim();
    return `<span class="graf-leyenda-item"><i class="graf-dot" style="background:${c.enc}"></i>${nombre}</span>`;
  }).join('');

  panel.innerHTML = `
    <div class="cons-header">
      <h3>Gráficos</h3>
      <p class="cf-hint">Terminaciones — piso aproximado, programado (línea punteada) vs real (línea sólida), por fase. Obra Gruesa se agrega en una próxima etapa.</p>
    </div>
    <div class="graf-leyenda">
      ${leyendaFases}
      <span class="graf-leyenda-item"><i class="graf-linea-muestra"></i>Real</span>
      <span class="graf-leyenda-item"><i class="graf-linea-muestra graf-punteada"></i>Programado</span>
    </div>
    <svg viewBox="0 0 ${W} ${H}" class="graf-svg" preserveAspectRatio="xMidYMid meet">
      <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${H - padB}" stroke="#E2DDD4"/>
      <line x1="${padL}" y1="${H - padB}" x2="${W - padR}" y2="${H - padB}" stroke="#E2DDD4"/>
      <text x="4" y="${padT + 8}" font-size="9" fill="#A09A93">${maxY.toFixed(0)}p</text>
      <text x="4" y="${H - padB}" font-size="9" fill="#A09A93">${minY.toFixed(0)}p</text>
      ${svgLineas}
      ${etiquetasX}
    </svg>`;
}
