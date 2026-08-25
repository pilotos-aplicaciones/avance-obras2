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
    // Piso aproximado también por actividad (no solo por fase) — pedido de
    // María Paz para el Excel de historial. Misma fórmula "llenar de abajo
    // hacia arriba" que ya se usa para la fase completa.
    const piso     = (typeof logica_pisoActividad === 'function')
      ? logica_pisoActividad(matricesActuales, faseKey, numero, deptosTodos, departamentos)
      : 0;
    const prevDeptos = actsPrev[numero] ? actsPrev[numero].deptos : 0;
    const prevPct2   = actsPrev[numero] ? actsPrev[numero].avancePct : 0;
    const prevPiso2  = actsPrev[numero] ? actsPrev[numero].piso : 0;
    actividades[numero] = {
      deptos:         deptosOk,
      avancePct:      pct,
      piso:           piso,
      deptosSemanal:  deptosOk - prevDeptos,
      avancePctSemanal: parseFloat((pct - prevPct2).toFixed(1)),
      pisoSemanal:      parseFloat((piso - prevPiso2).toFixed(2)),
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

  let lista = Object.values(filas).sort(function(a, b) { return (a.semana || '').localeCompare(b.semana || ''); });
  lista = _consolidado_recortarInicioReal(lista, config);
  return lista;
}

// El "piso aproximado" cuenta como ya terminados los pisos sin departamentos
// (por eso nunca es realmente 0 aunque no se haya avanzado nada) — sin este
// recorte, el Consolidado/Gráficos mostraban ese piso base como si la fase ya
// estuviera avanzando desde la primera semana guardada. Pedido de María Paz:
// (1) no mostrar nada de una fase antes de que tenga avance real (%>0), y
// (2) en la semana JUSTO ANTERIOR a la primera con avance real, dejar el piso
// base (constante hasta que arranca el avance real), para que la curva
// "parta" visualmente desde ahí. Si esa semana anterior no existe como fila
// (caso raro: la primera semana de toda la obra ya trae avance real), se
// inventa una fila extra una semana antes, solo para poder mostrar esa base.
function _consolidado_recortarInicioReal(lista, config) {
  const fasesTodas = (typeof logica_fasesEfectivas === 'function') ? logica_fasesEfectivas(config) : [1, 2, 3, 4, 5, 6];
  const departamentos = config.departamentos || [];

  fasesTodas.forEach(function(fase) {
    let idxInicio = -1;
    for (let i = 0; i < lista.length; i++) {
      const r = lista[i].real && lista[i].real[fase];
      if (r && r.pct > 0) { idxInicio = i; break; }
    }

    if (idxInicio === -1) {
      // Nunca ha empezado el avance real de esta fase: no mostrar nada de ella.
      lista.forEach(function(fila) { if (fila.real) delete fila.real[fase]; });
      return;
    }

    // Quitar cualquier dato real de semanas ANTERIORES a la semana base
    // (podían existir por guardados donde otra fase sí tuvo avance esa semana).
    for (let i = 0; i < idxInicio - 1; i++) {
      if (lista[i].real) delete lista[i].real[fase];
    }

    const pisoBase = (typeof logica_pisoAproximado === 'function') ? logica_pisoAproximado(0, departamentos) : 0;

    if (idxInicio > 0) {
      const filaAnterior = lista[idxInicio - 1];
      filaAnterior.real = filaAnterior.real || {};
      filaAnterior.real[fase] = { pct: 0, piso: pisoBase };
    } else {
      // No hay ninguna fila anterior — se inventa una, una semana antes,
      // solo para mostrar el piso base (María Paz: "solo en caso de que sea
      // necesario").
      const semanaBase = _consolidado_semanaAnterior(lista[idxInicio].semana);
      const filaNueva = { semana: semanaBase, fechaInicio: null, fechaTermino: null, prog: {}, real: {}, inventada: true };
      filaNueva.real[fase] = { pct: 0, piso: pisoBase };
      lista.unshift(filaNueva);
      lista.sort(function(a, b) { return (a.semana || '').localeCompare(b.semana || ''); });
    }
  });

  return lista;
}

// Una semana (7 días) antes de una fecha YYYY-MM-DD — para inventar la fila
// "base" cuando no existe ninguna semana anterior real en la tabla.
function _consolidado_semanaAnterior(fechaISO) {
  const d = new Date(fechaISO + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - 7);
  return d.toISOString().slice(0, 10);
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

// Viernes elegido en el selector de control ("Viernes" en la barra lateral) —
// destaca la fila de la semana que se está reportando en ese momento, no la
// semana calendario real de hoy (corregido: María Paz aclaró que se refería
// a la fecha seleccionada en la app, no a "hoy").
function _consTerm_viernesSeleccionado(idProyecto) {
  const ctrl = (typeof datos_cargarSemanaControl === 'function') ? datos_cargarSemanaControl(idProyecto) : null;
  return ctrl && ctrl.semana ? ctrl.semana : null;
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

  // Colores de encabezado iguales a los de Registro avance: mismo FASE_COLORES,
  // pero antes se usaba el tono "fondo" (más pálido) y en Registro avance se ve
  // el tono "enc" (más fuerte, el de la barra de título "F1 – …") — pedido de
  // María Paz para que se vean iguales en las dos pantallas.
  const theadFases = fases.map(function(f) {
    const c = FASE_COLORES[f];
    return `<th colspan="2" style="background:${c.enc};color:${c.txt};">${NOMBRES_FASES[f].split('–')[0].trim()}</th>`;
  }).join('');
  const theadSub = fases.map(function(f) {
    const c = FASE_COLORES[f];
    return `<th style="background:${c.enc};color:${c.txt};">Prog.</th><th style="background:${c.enc};color:${c.txt};">Real</th>`;
  }).join('');

  const viernesSeleccionado = _consTerm_viernesSeleccionado(config.id);

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
    // Destacar la fila de la semana que se está reportando (viernes elegido
    // en el selector de control) — pedido de María Paz.
    const esActual = viernesSeleccionado && fila.semana === viernesSeleccionado;
    return `<tr${esActual ? ' class="cons-fila-actual"' : ''}>
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

  // Columnas agrupadas por tipo (%, luego Piso, luego Deptos) — no
  // intercaladas — pedido de María Paz.
  const filasFase = [['Semana', 'Fase', '% Avance acumulado', '% Avance de la semana', 'Piso acumulado', 'Piso de la semana']];
  semanas.forEach(function(sem) {
    const snap = historial[sem];
    fasesActivas.forEach(function(f) {
      const d = snap.fases && snap.fases[f];
      if (!d) return;
      const nombreFase = NOMBRES_FASES[f].split('–')[0].trim();
      filasFase.push([sem, nombreFase, d.avancePct, d.avancePctSemanal, d.piso, d.pisoSemanal]);
    });
  });

  const filasAct = [['Semana', 'Actividad', '% Avance acumulado', '% Avance de la semana', 'Piso acumulado', 'Piso de la semana', 'Deptos terminados (acumulado)', 'Deptos de la semana']];
  semanas.forEach(function(sem) {
    const snap = historial[sem];
    const numeros = Object.keys(snap.actividades || {}).map(Number).sort(function(a, b) { return a - b; });
    numeros.forEach(function(numero) {
      const d = snap.actividades[numero];
      const nombre = (typeof actividades_getNombreProyecto === 'function') ? actividades_getNombreProyecto(config, numero) : ('Actividad ' + numero);
      filasAct.push([sem, numero + ' - ' + nombre, d.avancePct, d.avancePctSemanal, d.piso, d.pisoSemanal, d.deptos, d.deptosSemanal]);
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
