// Motor de datos "Consolidado" — programado vs real, por fase, semana a semana.
// No captura nada por sí mismo: lee la programación (config.programacion,
// cargada en el asistente) y el historial semanal (datos.js) y los cruza.
// Pensado como funciones puras donde se pueda, para poder testear y para que
// tanto la tabla numérica como el gráfico (graficos.js) usen los mismos datos.

// ── Snapshot semanal (real) ───────────────────────────────────────────────────
// Se llama desde datos_subirAhora() cada vez que se confirma "Guardar avances".
// No incluye fecha/autor — eso lo agrega el llamador (datos.js), que es quien
// sabe la semana de control y el nombre de usuario.
//
// historialAnterior: el snapshot más reciente ANTERIOR a esta semana (o null
// si es el primero). Se usa solo para calcular el avance "puro" de la semana
// (delta), el acumulado siempre se recalcula desde matricesActuales.
function consolidado_construirSnapshotSemana(config, matricesActuales, historialAnterior) {
  const departamentos = config.departamentos || [];
  const deptosTodos    = logica_listaDeptosPlana(departamentos);
  const fasesActivas   = (typeof logica_fasesEfectivas === 'function')
    ? logica_fasesEfectivas(config)
    : [1, 2, 3, 4, 5, 6];

  const fasesPrev = (historialAnterior && historialAnterior.fases) || {};
  const actsPrev  = (historialAnterior && historialAnterior.actividades) || {};

  const fases = {};
  fasesActivas.forEach(function(fase) {
    const prom = logica_promediosFase(config, matricesActuales, fase, deptosTodos, departamentos);
    const prevPiso = fasesPrev[fase] ? fasesPrev[fase].piso : 0;
    const prevPct  = fasesPrev[fase] ? fasesPrev[fase].avancePct : 0;
    fases[fase] = {
      avancePct:         prom.avance || 0,
      piso:              prom.piso || 0,
      avancePctSemanal:  parseFloat(((prom.avance || 0) - prevPct).toFixed(1)),
      pisoSemanal:       parseFloat(((prom.piso || 0) - prevPiso).toFixed(2)),
    };
  });

  const actividades = {};
  const orden = logica_ordenEfectivo(config);
  orden.forEach(function(o) {
    const numero = o.numero;
    const faseEfectiva = o.faseEfectiva;
    if (!faseEfectiva) return;
    const faseKey = 'fase_' + faseEfectiva;
    const deptosOk = logica_deptosTerminadosActividad(matricesActuales, faseKey, numero, deptosTodos);
    const pct      = logica_avanceActividad(matricesActuales, faseKey, numero, deptosTodos);
    const prevDeptos = actsPrev[numero] ? actsPrev[numero].deptos : 0;
    const prevPct2   = actsPrev[numero] ? actsPrev[numero].avancePct : 0;
    actividades[numero] = {
      deptos:         deptosOk,
      avancePct:      pct,
      deptosSemanal:  deptosOk - prevDeptos,
      avancePctSemanal: parseFloat((pct - prevPct2).toFixed(1)),
    };
  });

  return { fases: fases, actividades: actividades };
}

// ── Cruce programado vs real, por semana ─────────────────────────────────────
// Devuelve un array ordenado por fecha con, para cada fase activa, el valor
// programado (si hay programación cargada) y el real (si hay historial esa
// semana). fase = número (1-6) o null/omitido para incluir todas.
function consolidado_cruzarSemanas(config, historial, programacion) {
  historial     = historial || {};
  programacion  = programacion || [];

  const filas = {}; // clave = semana (fecha término / semana de control), valor = fila

  programacion.forEach(function(p) {
    const key = p.fechaTermino;
    if (!key) return;
    filas[key] = filas[key] || { semana: key, fechaInicio: p.fechaInicio, fechaTermino: p.fechaTermino, prog: {}, real: {} };
    filas[key].prog = p.fases || {};
    if (p.pisoOG !== null && p.pisoOG !== undefined) filas[key].pisoOGProg = p.pisoOG;
  });

  Object.keys(historial).forEach(function(fecha) {
    const snap = historial[fecha];
    filas[fecha] = filas[fecha] || { semana: fecha, fechaInicio: null, fechaTermino: fecha, prog: {}, real: {} };
    const real = {};
    Object.keys(snap.fases || {}).forEach(function(fase) {
      real[fase] = { pct: snap.fases[fase].avancePct, piso: snap.fases[fase].piso };
    });
    filas[fecha].real = real;
  });

  return Object.values(filas).sort(function(a, b) { return (a.semana || '').localeCompare(b.semana || ''); });
}

// ── Series para el gráfico (una por fase, programado + real) ─────────────────
// Devuelve { fase: { programado: [{x, y}], real: [{x, y}] } } usando "piso"
// como magnitud (eje Y), tal como se pidió: eje Y = piso, eje X = semana.
function consolidado_seriesGrafico(config, historial, programacion) {
  const filas = consolidado_cruzarSemanas(config, historial, programacion);
  const fasesActivas = (typeof logica_fasesEfectivas === 'function') ? logica_fasesEfectivas(config) : [1, 2, 3, 4, 5, 6];

  const series = {};
  fasesActivas.forEach(function(fase) {
    const programado = [];
    const real = [];
    filas.forEach(function(fila) {
      const p = fila.prog && fila.prog[fase];
      const r = fila.real && fila.real[fase];
      if (p && p.piso !== null && p.piso !== undefined) programado.push({ x: fila.semana, y: p.piso });
      if (r && r.piso !== null && r.piso !== undefined) real.push({ x: fila.semana, y: r.piso });
    });
    series[fase] = { programado: programado, real: real };
  });
  return series;
}

// ── Vista "Consolidado" de Terminaciones — tabla numérica ────────────────────
// Llamada por router.js al entrar a la pestaña. Trae historial (con una
// pasada a Firestore, por si otro dispositivo confirmó semanas que este
// todavía no tiene) y lo cruza con config.programacion.
function consolidadoTerm_inicializar(idProyecto) {
  const panel = document.getElementById('panel-tab-consolidado-term');
  if (!panel) return;
  panel.innerHTML = '<div class="proy-nav-placeholder">Cargando…</div>';

  const config = datos_cargarProyecto(idProyecto);
  if (!config) { panel.innerHTML = '<div class="proy-nav-placeholder">No se encontró el proyecto.</div>'; return; }

  datos_sincronizarHistorial(idProyecto, function(historial) {
    _consTerm_render(panel, config, historial);
  });
}

function _consTerm_render(panel, config, historial) {
  const programacion = config.programacion || [];
  const filas = consolidado_cruzarSemanas(config, historial, programacion);
  const fases = (typeof logica_fasesEfectivas === 'function') ? logica_fasesEfectivas(config) : [1, 2, 3, 4, 5, 6];

  if (!filas.length) {
    panel.innerHTML = `
      <div class="proy-nav-placeholder">
        Todavía no hay datos para mostrar.<br>
        <span class="cf-hint">Carga la programación en "⚙ Configurar" (Paso 4) y confirma al menos una semana de avances en "Registro avance".</span>
      </div>`;
    return;
  }

  const theadFases = fases.map(function(f) {
    const c = FASE_COLORES[f];
    return `<th colspan="2" style="background:${c.fondo};color:${c.txt};">${NOMBRES_FASES[f].split('–')[0].trim()}</th>`;
  }).join('');
  const theadSub = fases.map(function(f) {
    const c = FASE_COLORES[f];
    return `<th style="background:${c.fondo};color:${c.txt};">Prog.</th><th style="background:${c.fondo};color:${c.txt};">Real</th>`;
  }).join('');

  // Piso programado/real (no % de avance) — pedido de María Paz para leer
  // la curva en la misma magnitud que el gráfico (eje Y = piso aprox.).
  const filasHtml = filas.map(function(fila) {
    const celdas = fases.map(function(f) {
      const p = fila.prog && fila.prog[f];
      const r = fila.real && fila.real[f];
      const pTxt = (p && p.piso !== null && p.piso !== undefined) ? interfaz_fmtNum(p.piso) : '—';
      const rTxt = (r && r.piso !== null && r.piso !== undefined) ? interfaz_fmtNum(r.piso) : '—';
      return `<td class="cons-prog">${pTxt}</td><td class="cons-real">${rTxt}</td>`;
    }).join('');
    return `<tr>
      <td class="cons-fecha">${fila.fechaInicio ? logica_formatearFecha(fila.fechaInicio) : '—'}</td>
      <td class="cons-fecha">${fila.fechaTermino ? logica_formatearFecha(fila.fechaTermino) : '—'}</td>
      ${celdas}
    </tr>`;
  }).join('');

  // Sin título/descripción arriba — se ve la tabla directo (pedido de María Paz).
  panel.innerHTML = `
    <div class="cons-tabla-wrap">
      <table class="tabla-consolidado">
        <thead>
          <tr><th rowspan="2">Inicio</th><th rowspan="2">Término</th>${theadFases}</tr>
          <tr>${theadSub}</tr>
        </thead>
        <tbody>${filasHtml}</tbody>
      </table>
    </div>`;

  _consTerm_aplicarSticky(panel);
}

// Encabezado fijo al bajar (dos filas: fases arriba, Prog./Real abajo). Se
// mide en vivo la altura real de la primera fila para ubicar la segunda
// justo debajo — evita hardcodear un alto que se desajusta con cualquier
// cambio de tipografía/padding.
function _consTerm_aplicarSticky(panel) {
  const filas = panel.querySelectorAll('.tabla-consolidado thead tr');
  if (filas.length < 2) return;
  const fila1 = filas[0], fila2 = filas[1];
  Array.from(fila1.children).forEach(function(th) {
    th.style.position = 'sticky';
    th.style.top = '0';
    th.style.zIndex = '6';
  });
  const altoFila1 = fila1.getBoundingClientRect().height;
  Array.from(fila2.children).forEach(function(th) {
    th.style.position = 'sticky';
    th.style.top = altoFila1 + 'px';
    th.style.zIndex = '5';
  });
}

// ── Exportar historial semanal (Excel) ───────────────────────────────────────
// Respuesta a "dónde está la base de datos, la podría descargar" — hoy el
// historial vive en Firestore + una copia local, sin ningún archivo
// descargable. Esta función genera ese archivo: una hoja con el avance por
// fase (acumulado + el "puro" de cada semana) y otra por actividad, tal como
// se pidió al construir el historial en v4.61.
function consolidado_exportarHistorialExcel(idProyecto) {
  if (typeof XLSX === 'undefined') {
    interfaz_mostrarToast('La librería Excel no está lista. Reintenta en un momento.', 'error');
    return;
  }
  const config = datos_cargarProyecto(idProyecto);
  if (!config) { interfaz_mostrarToast('No se encontró el proyecto.', 'error'); return; }

  const historial = (typeof datos_obtenerHistorial === 'function') ? datos_obtenerHistorial(idProyecto) : {};
  const semanas = Object.keys(historial).sort();

  if (!semanas.length) {
    interfaz_mostrarToast('Todavía no hay historial guardado — confirma al menos una semana de avances primero.', 'aviso', 4500);
    return;
  }

  const fasesActivas = (typeof logica_fasesEfectivas === 'function') ? logica_fasesEfectivas(config) : [1, 2, 3, 4, 5, 6];

  const filasFase = [['Semana', 'Fase', '% Avance acumulado', 'Piso acumulado', '% Avance de la semana', 'Piso de la semana']];
  semanas.forEach(function(sem) {
    const snap = historial[sem];
    fasesActivas.forEach(function(f) {
      const d = snap.fases && snap.fases[f];
      if (!d) return;
      const nombreFase = NOMBRES_FASES[f].split('–')[0].trim();
      filasFase.push([sem, nombreFase, d.avancePct, d.piso, d.avancePctSemanal, d.pisoSemanal]);
    });
  });

  const filasAct = [['Semana', 'Actividad', 'Deptos terminados (acumulado)', '% Avance acumulado', 'Deptos de la semana', '% Avance de la semana']];
  semanas.forEach(function(sem) {
    const snap = historial[sem];
    const numeros = Object.keys(snap.actividades || {}).map(Number).sort(function(a, b) { return a - b; });
    numeros.forEach(function(numero) {
      const d = snap.actividades[numero];
      const nombre = (typeof actividades_getNombreProyecto === 'function') ? actividades_getNombreProyecto(config, numero) : ('Actividad ' + numero);
      filasAct.push([sem, numero + ' - ' + nombre, d.deptos, d.avancePct, d.deptosSemanal, d.avancePctSemanal]);
    });
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(filasFase), 'Por fase');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(filasAct), 'Por actividad');

  const nombreProy = (config.nombre || 'proyecto').replace(/\s+/g, '_');
  const fecha = new Date().toISOString().slice(0, 10);
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'historial_' + nombreProy + '_' + fecha + '.xlsx';
  a.click();
  URL.revokeObjectURL(url);

  interfaz_mostrarToast('Historial exportado.', 'exito');
}
