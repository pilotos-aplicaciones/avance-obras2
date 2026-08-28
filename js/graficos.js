// Pestaña "Gráficos" — programado vs real, por fase (Terminaciones por ahora;
// Obra Gruesa se agrega cuando se construya esa sección). Eje Y = piso
// aproximado (incluye el 0 — "piso aprox" es progreso continuo, no el número
// de piso literal: 0,5 significa "mitad del primer piso terminado"). Eje X =
// semana (viernes), TODAS, sin scroll horizontal — el ancho real se mide del
// contenedor y las etiquetas se inclinan/comprimen según haga falta. Sin
// librerías externas: un solo <svg> armado a mano, igual que el resto de la
// app.

let _graf_ultimoPanel = null, _graf_ultimoConfig = null, _graf_ultimoHistorial = null, _graf_ultimoHistorialOG = null;

// Alto fijo compartido por los dos gráficos (Obra Gruesa y Terminaciones) —
// pedido de María Paz: que los dos "rectángulos" se vean del mismo porte,
// sin scroll interno. En vez de que el alto crezca con la cantidad de pisos
// o de marcas del eje Y, es al revés: la separación entre líneas del eje Y
// se acomoda para caber siempre en este mismo alto.
const GRAF_ALTO = 380;

// Elige un "paso" redondo (1/2/2.5/5 × 10^n) para el eje Y de Obra Gruesa,
// apuntando a un número razonable de marcas (ni muy pocas — se ve pelado —
// ni muchas — se amontonan). Mismo criterio que usan librerías de gráficos
// para ejes con números "lindos" (250, 500, 1000, 2000...).
function _graf_pasoNiceY(maxY, objetivoTicks) {
  const bruto = Math.max(maxY, 1) / objetivoTicks;
  const potencia = Math.pow(10, Math.floor(Math.log10(bruto)));
  const norm = bruto / potencia;
  let mult;
  if (norm <= 1) mult = 1;
  else if (norm <= 2) mult = 2;
  else if (norm <= 2.5) mult = 2.5;
  else if (norm <= 5) mult = 5;
  else mult = 10;
  return mult * potencia;
}

function graficos_inicializar(idProyecto) {
  const panel = document.getElementById('panel-tab-graficos');
  if (!panel) return;
  panel.innerHTML = '<div class="proy-nav-placeholder">Cargando…</div>';

  const config = datos_cargarProyecto(idProyecto);
  if (!config) { panel.innerHTML = '<div class="proy-nav-placeholder">No se encontró el proyecto.</div>'; return; }

  datos_sincronizarHistorial(idProyecto, function(historial) {
    datos_sincronizarHistorialOG(idProyecto, function(historialOG) {
      _graf_ultimoPanel = panel;
      _graf_ultimoConfig = config;
      _graf_ultimoHistorial = historial;
      _graf_ultimoHistorialOG = historialOG;
      _graf_render(panel, config, historial, historialOG);
    });
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
          _graf_render(_graf_ultimoPanel, _graf_ultimoConfig, _graf_ultimoHistorial, _graf_ultimoHistorialOG);
        }
      }, 200);
    });
    window._graf_resizeRegistrado = true;
  }
}

// Orden pedido por María Paz: primero Obra Gruesa, después Terminaciones.
// Ambos bloques van dentro de un único contenedor que scrollea (.graf-paneles)
// — cada gráfico se ve completo, uno debajo del otro, en vez de competir por
// la mitad de la altura del panel.
function _graf_render(panel, config, historial, historialOG) {
  const htmlOG   = _graf_renderOG(panel, config, historialOG || {});
  const htmlTerm = _graf_renderTerminaciones(panel, config, historial);
  panel.innerHTML = `<div class="graf-paneles">${htmlOG}${htmlTerm}</div>`;
}

// ── Obra Gruesa: un solo color (negro, OG_COLOR.enc) — programado punteado,
// real sólido, tal como pidió María Paz ("que se diferencien solo por línea
// segmentada o continua, no por color"). Eje Y = m³ acumulados (no piso).
function _graf_renderOG(panel, config, historialOG) {
  const programacionOG = config.programacionOG || [];
  const filas = (typeof og_cruzarSemanas === 'function') ? og_cruzarSemanas(programacionOG, historialOG) : [];

  if (!filas.length) {
    return `<div class="graf-bloque">
      <div class="graf-bloque-titulo">🏗 Obra Gruesa</div>
      <div class="proy-nav-placeholder">
        Todavía no hay datos para graficar.<br>
        <span class="cf-hint">Carga la programación en "⚙ Configurar" (Paso 4) — hoja "Obra Gruesa".</span>
      </div>
    </div>`;
  }

  let minY = 0, maxY = 1;
  filas.forEach(function(fila) {
    const p = fila.prog, r = fila.real;
    if (p && p.avanceAcumulado !== null && p.avanceAcumulado !== undefined) maxY = Math.max(maxY, p.avanceAcumulado);
    if (r && r.avanceAcumulado !== null && r.avanceAcumulado !== undefined) maxY = Math.max(maxY, r.avanceAcumulado);
  });

  // Eje Y en marcas "redondas" (250/500/1000... según convenga) — el paso
  // se calcula solo para que siempre queden entre 5 y 7 marcas más o menos,
  // ni pocas (se ve pelado) ni muchas (se amontonan). El alto del gráfico es
  // fijo (GRAF_ALTO, igual que Terminaciones) — lo que se ajusta es la
  // separación entre líneas, no el tamaño del cuadro.
  const STEP_Y = _graf_pasoNiceY(maxY, 6);
  let maxTickY = Math.ceil(maxY / STEP_Y) * STEP_Y;
  if (maxTickY <= maxY) maxTickY += STEP_Y; // deja un margen arriba de la curva más alta
  maxY = maxTickY;
  const numTicksY = maxY / STEP_Y;

  const n = filas.length;
  const padL = 46, padR = 8, padT = 14;
  const W = Math.max(320, (panel.clientWidth || 900) - 8);
  const espacioPorSemana = n > 1 ? (W - padL - padR) / (n - 1) : (W - padL - padR);
  let anguloX = 0;
  if (espacioPorSemana < 55) anguloX = 55;
  if (espacioPorSemana < 32) anguloX = 70;
  if (espacioPorSemana < 18) anguloX = 85;
  const padB = anguloX ? 58 : 30;
  const H = GRAF_ALTO;

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

  const progPts = polyline(function(fila) { const p = fila.prog; return (p && p.avanceAcumulado !== null && p.avanceAcumulado !== undefined) ? p.avanceAcumulado : null; });
  const realPts = polyline(function(fila) { const r = fila.real; return (r && r.avanceAcumulado !== null && r.avanceAcumulado !== undefined) ? r.avanceAcumulado : null; });
  let svgLineas = '';
  if (progPts) svgLineas += `<polyline points="${progPts}" fill="none" stroke="${OG_COLOR.enc}" stroke-width="2" stroke-dasharray="5,4"/>`;
  if (realPts) svgLineas += `<polyline points="${realPts}" fill="none" stroke="${OG_COLOR.enc}" stroke-width="2.5"/>`;

  let grillaXLineas = '', etiquetasX = '';
  filas.forEach(function(fila, i) {
    const x = xAt(i);
    grillaXLineas += `<line x1="${x.toFixed(1)}" y1="${padT}" x2="${x.toFixed(1)}" y2="${(H - padB).toFixed(1)}" stroke="#F2EEE7" stroke-width="1"/>`;
    const yEtq = H - padB + (anguloX ? 10 : 14);
    const transform = anguloX ? ` transform="rotate(-${anguloX} ${x.toFixed(1)} ${yEtq})"` : '';
    const anchor = anguloX ? 'end' : 'middle';
    etiquetasX += `<text x="${x.toFixed(1)}" y="${yEtq}" font-size="8.5" fill="#A09A93" text-anchor="${anchor}"${transform}>${logica_formatearFecha(fila.semana).slice(0, 5)}</text>`;
  });

  // Eje Y en m³ acumulados: una marca cada 250 m³ (no piso a piso).
  let grillaYLineas = '', etiquetasY = '';
  for (let i = 0; i <= numTicksY; i++) {
    const v = i * STEP_Y;
    const y = yAt(v);
    grillaYLineas += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${(W - padR).toFixed(1)}" y2="${y.toFixed(1)}" stroke="#EFEBE4" stroke-width="1"/>`;
    etiquetasY += `<text x="4" y="${(y + 3).toFixed(1)}" font-size="9" fill="#A09A93">${Math.round(v)}</text>`;
  }

  return `<div class="graf-bloque">
    <div class="graf-bloque-titulo">🏗 Obra Gruesa</div>
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
        <span class="graf-leyenda-item"><i class="graf-linea-muestra" style="border-top-color:${OG_COLOR.enc}"></i>Real</span>
        <span class="graf-leyenda-item"><i class="graf-linea-muestra graf-punteada" style="border-top-color:${OG_COLOR.enc}"></i>Programado</span>
      </div>
    </div>
  </div>`;
}

function _graf_renderTerminaciones(panel, config, historial) {
  const programacion = config.programacion || [];
  const filas = (typeof consolidado_cruzarSemanas === 'function') ? consolidado_cruzarSemanas(config, historial, programacion) : [];
  const fases = (typeof logica_fasesEfectivas === 'function') ? logica_fasesEfectivas(config) : [1, 2, 3, 4, 5, 6];

  if (!filas.length) {
    return `<div class="graf-bloque">
      <div class="graf-bloque-titulo">🎨 Terminaciones</div>
      <div class="proy-nav-placeholder">
        Todavía no hay datos para graficar.<br>
        <span class="cf-hint">Carga la programación en "⚙ Configurar" (Paso 4) y confirma al menos una semana de avances.</span>
      </div>
    </div>`;
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

  // Una línea de grilla por piso (eje Y = piso). Incluye el 0 si cae en el
  // rango — es un valor válido de "piso aprox", no el piso 0 del edificio.
  // Alto FIJO (GRAF_ALTO, igual que Obra Gruesa) — si el edificio tiene
  // muchos pisos, la separación entre líneas se achica para caber, en vez
  // de agrandar el cuadro (así los dos gráficos se ven del mismo porte).
  const primerPiso = Math.ceil(minY), ultimoPiso = Math.floor(maxY);
  const ticksY = [];
  for (let p = primerPiso; p <= ultimoPiso; p++) ticksY.push(p);
  const H = GRAF_ALTO;

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

  return `<div class="graf-bloque">
    <div class="graf-bloque-titulo">🎨 Terminaciones</div>
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
    </div>
  </div>`;
}
