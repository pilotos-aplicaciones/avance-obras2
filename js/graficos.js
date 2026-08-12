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

  // Ancho: una "columna" fija por semana (viernes), para que se vean TODAS las
  // etiquetas del eje X sin amontonarlas — con muchas semanas el gráfico se
  // hace más ancho que la pantalla y se scrollea horizontal (misma idea que
  // la tabla de Consolidado, ver .graf-svg-wrap / .cons-tabla-wrap en el CSS).
  const padL = 40, padR = 16, padT = 16, padB = 30;
  const n = filas.length;
  const PX_POR_SEMANA = 46;
  const W = Math.max(900, padL + padR + Math.max(0, n - 1) * PX_POR_SEMANA + PX_POR_SEMANA);

  // Alto: una línea de grilla por piso (eje Y = piso), con separación mínima
  // legible aunque el edificio tenga muchos pisos.
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

  // Etiquetas del eje X: TODAS las semanas (siempre viernes) — el ancho del
  // svg ya se calculó arriba para que quepan sin amontonarse.
  let etiquetasX = '';
  filas.forEach(function(fila, i) {
    etiquetasX += `<text x="${xAt(i).toFixed(1)}" y="${H - 8}" font-size="9" fill="#A09A93" text-anchor="middle">${logica_formatearFecha(fila.semana).slice(0, 5)}</text>`;
  });

  // Grilla del eje Y: una línea + etiqueta por piso.
  let grillaY = '';
  ticksY.forEach(function(p) {
    const y = yAt(p);
    grillaY += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" stroke="#EFEBE4" stroke-width="1"/>`;
    grillaY += `<text x="4" y="${(y + 3).toFixed(1)}" font-size="9" fill="#A09A93">${p}p</text>`;
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
    <div class="graf-svg-wrap">
      <svg width="${W}" height="${H}" class="graf-svg" style="width:${W}px;max-width:none;">
        ${grillaY}
        <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${H - padB}" stroke="#E2DDD4"/>
        <line x1="${padL}" y1="${H - padB}" x2="${W - padR}" y2="${H - padB}" stroke="#E2DDD4"/>
        ${svgLineas}
        ${etiquetasX}
      </svg>
    </div>`;
}
