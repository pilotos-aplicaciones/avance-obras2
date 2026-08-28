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

// ══════════════════════════════════════════════════════════════════════════
// OBRA GRUESA — Consolidado (programado vs real, m³) y su gráfico
// ══════════════════════════════════════════════════════════════════════════
// Mismo espíritu que el Consolidado de Terminaciones (lee programación +
// historial y los cruza), pero acá el real NO se llena por un "Registro
// avance" aparte: se edita directo en esta misma tabla (m³ de Fundaciones /
// Subterráneo / Placa / Núcleo por semana), con copiar/pegar tipo Excel —
// pedido de María Paz. Avance Semanal/Acumulado (real) siempre calculados
// por la app (nunca a mano) — ver datos_aplicarCambiosOG.

// Cruce programado (config.programacionOG) vs real (historialOG), una fila
// por semana. Devuelve también, por fila, la Desviación Acumulada:
// Real acumulado − Programado acumulado esa semana. Regla de María Paz: una
// vez que el real acumulado alcanza el total programado FINAL (la obra ya
// completó esa cantidad de m³, aunque la programación siga mostrando
// semanas futuras), la desviación queda en 0 de ahí en adelante — no tiene
// sentido seguir mostrando una desviación cuando ya no queda nada por hacer.
function og_cruzarSemanas(programacionOG, historialOG) {
  programacionOG = programacionOG || [];
  historialOG    = historialOG || {};

  const filas = {};
  programacionOG.forEach(function(p) {
    const key = p.fechaTermino;
    if (!key) return;
    filas[key] = filas[key] || { semana: key, fechaInicio: p.fechaInicio, fechaTermino: p.fechaTermino, prog: null, real: null };
    filas[key].prog = {
      fundaciones: p.fundaciones, subterraneo: p.subterraneo, placa: p.placa, nucleo: p.nucleo,
      avanceSemanal: p.avanceSemanal, avanceAcumulado: p.avanceAcumulado,
    };
  });
  Object.keys(historialOG).forEach(function(fecha) {
    filas[fecha] = filas[fecha] || { semana: fecha, fechaInicio: null, fechaTermino: fecha, prog: null, real: null };
    filas[fecha].real = historialOG[fecha];
  });

  const lista = Object.values(filas).sort(function(a, b) { return (a.semana || '').localeCompare(b.semana || ''); });

  // Total programado final = el mayor "Avance Acumulado" de toda la
  // programación (no necesariamente la ÚLTIMA fila del Excel: se confirmó
  // con el archivo real de María Paz que las últimas semanas suelen venir en
  // blanco — el acumulado más alto sí está siempre bien calculado más atrás).
  let totalProgFinal = null;
  programacionOG.forEach(function(p) {
    if (p.avanceAcumulado !== null && p.avanceAcumulado !== undefined) {
      totalProgFinal = (totalProgFinal === null) ? p.avanceAcumulado : Math.max(totalProgFinal, p.avanceAcumulado);
    }
  });

  lista.forEach(function(fila) {
    const realAcum = fila.real ? fila.real.avanceAcumulado : null;
    const progAcum = fila.prog ? fila.prog.avanceAcumulado : null;
    if (realAcum === null || realAcum === undefined) {
      fila.desviacionAcumulada = null; // sin real todavía esa semana — "—"
    } else if (totalProgFinal !== null && realAcum >= totalProgFinal) {
      fila.desviacionAcumulada = 0; // obra (esta partida) ya completa — sin desviación posible
    } else if (progAcum === null || progAcum === undefined) {
      fila.desviacionAcumulada = null; // no hay programación esa semana para comparar
    } else {
      fila.desviacionAcumulada = parseFloat((realAcum - progAcum).toFixed(2));
    }
  });

  return lista;
}

// ── Vista "Consolidado Obra Gruesa" — tabla editable ─────────────────────────
let _ogCons_anclaInput = null;

function ogCons_inicializar(idProyecto) {
  const panel = document.getElementById('panel-tab-consolidado-og');
  if (!panel) return;
  panel.innerHTML = '<div class="proy-nav-placeholder">Cargando…</div>';

  const config = datos_cargarProyecto(idProyecto);
  if (!config) { panel.innerHTML = '<div class="proy-nav-placeholder">No se encontró el proyecto.</div>'; return; }

  datos_sincronizarHistorialOG(idProyecto, function(historialOG) {
    _ogCons_render(panel, config, historialOG);
  });
}

function _ogCons_render(panel, config, historialOG) {
  const programacionOG = config.programacionOG || [];
  const filas = og_cruzarSemanas(programacionOG, historialOG);
  const puedeEditar = (typeof authp_puedeEditar === 'function') ? authp_puedeEditar(config.id) : true;

  if (!programacionOG.length && !filas.length) {
    panel.innerHTML = `
      <div class="proy-nav-placeholder">
        Todavía no hay datos para mostrar.<br>
        <span class="cf-hint">Carga la programación en "⚙ Configurar" (Paso 4) — la hoja "Obra Gruesa" del mismo Excel de planificación.</span>
      </div>`;
    return;
  }

  const viernesSeleccionado = (typeof _consTerm_viernesSeleccionado === 'function') ? _consTerm_viernesSeleccionado(config.id) : null;

  const filasHtml = filas.map(function(fila, i) {
    const p = fila.prog;
    const r = fila.real;
    const val = function(campo) { return r && r[campo] !== undefined && r[campo] !== null ? r[campo] : ''; };
    const inputCelda = function(campo) {
      if (!puedeEditar) {
        return `<td class="og-celda-real">${val(campo) !== '' ? interfaz_fmtNum(val(campo), 2) : '—'}</td>`;
      }
      return `<td class="og-celda-real"><input type="text" inputmode="decimal" class="og-input" data-fecha="${fila.semana}" data-campo="${campo}" data-fila="${i}" value="${val(campo)}"></td>`;
    };
    const pTxt = function(v) { return (v !== null && v !== undefined) ? interfaz_fmtNum(v, 1) : '—'; };
    const desv = fila.desviacionAcumulada;
    const desvTxt = (desv === null || desv === undefined) ? '—' : interfaz_fmtNum(desv, 1);
    const desvClase = (desv === null || desv === undefined) ? '' : (desv >= 0 ? 'desv-pos' : 'desv-neg');
    const esActual = viernesSeleccionado && fila.semana === viernesSeleccionado;

    return `<tr${esActual ? ' class="cons-fila-actual"' : ''}>
      <td class="cons-fecha">${fila.fechaInicio ? logica_formatearFecha(fila.fechaInicio) : '—'}</td>
      <td class="cons-fecha">${fila.fechaTermino ? logica_formatearFecha(fila.fechaTermino) : '—'}</td>
      <td>${pTxt(p && p.fundaciones)}</td><td>${pTxt(p && p.subterraneo)}</td><td>${pTxt(p && p.placa)}</td><td>${pTxt(p && p.nucleo)}</td>
      <td class="prog-destacada">${pTxt(p && p.avanceSemanal)}</td><td class="prog-destacada">${pTxt(p && p.avanceAcumulado)}</td>
      ${inputCelda('fundaciones')}${inputCelda('subterraneo')}${inputCelda('placa')}${inputCelda('nucleo')}
      <td class="real-destacada">${pTxt(r && r.avanceSemanal)}</td><td class="real-destacada">${pTxt(r && r.avanceAcumulado)}</td>
      <td class="${desvClase}">${desvTxt}</td>
    </tr>`;
  }).join('');

  const btnGuardar = puedeEditar ? `<div class="og-toolbar"><button class="btn-primario" id="og-btn-guardar">💾 Guardar Obra Gruesa</button></div>` : '';

  panel.innerHTML = `
    ${btnGuardar}
    <div class="cons-tabla-wrap">
      <table class="tabla-consolidado tabla-og">
        <thead>
          <tr>
            <th rowspan="2">Inicio</th><th rowspan="2">Término</th>
            <th colspan="6" class="grp-prog">Programado (m³)</th>
            <th colspan="6" class="grp-real">Real (m³)</th>
            <th rowspan="2">Desv. Acum.</th>
          </tr>
          <tr>
            <th class="grp-prog">Fund.</th><th class="grp-prog">Subterr.</th><th class="grp-prog">Placa</th><th class="grp-prog">Núcleo</th>
            <th class="prog-destacada">Sem.</th><th class="prog-destacada">Acum.</th>
            <th class="grp-real">Fund.</th><th class="grp-real">Subterr.</th><th class="grp-real">Placa</th><th class="grp-real">Núcleo</th>
            <th class="real-destacada">Sem.</th><th class="real-destacada">Acum.</th>
          </tr>
        </thead>
        <tbody>${filasHtml}</tbody>
      </table>
    </div>`;

  _consTerm_aplicarSticky(panel);
  if (puedeEditar) _ogCons_registrarEventos(panel, config.id, filas);
}

function _ogCons_registrarEventos(panel, idProyecto, filas) {
  const inputs = Array.from(panel.querySelectorAll('.og-input'));

  inputs.forEach(function(inp) {
    inp.addEventListener('focus', function() { _ogCons_anclaInput = inp; });
    inp.addEventListener('change', function() {
      const cambios = {};
      cambios[inp.dataset.fecha] = {};
      cambios[inp.dataset.fecha][inp.dataset.campo] = _ogCons_parseNum(inp.value);
      datos_aplicarCambiosOG(idProyecto, cambios);
      ogCons_inicializar(idProyecto);
    });
    inp.addEventListener('paste', function(e) {
      _ogCons_pasteHandler(e, inp, idProyecto, filas);
    });
  });

  const btnGuardar = document.getElementById('og-btn-guardar');
  if (btnGuardar) {
    btnGuardar.addEventListener('click', function() {
      interfaz_mostrarModal(
        'Guardar Obra Gruesa',
        '¿Confirmas subir los avances reales de Obra Gruesa? Se sincronizarán con todos los dispositivos.',
        function() { datos_guardarHistorialOG(idProyecto); }
      );
    });
  }
}

function _ogCons_parseNum(v) {
  if (v === null || v === undefined || v === '') return 0;
  const n = parseFloat(String(v).replace(',', '.').replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? 0 : Math.max(0, n);
}

// Pegado tipo Excel: la celda donde se hizo foco es el ancla, se pega en
// bloque (filas = semanas siguientes en la tabla, columnas = Fundaciones,
// Subterráneo, Placa, Núcleo, en ese orden) — mismo mecanismo que ya usa
// Terminaciones (_mat_pasteHandler en terminaciones.js).
const _OG_COLUMNAS = ['fundaciones', 'subterraneo', 'placa', 'nucleo'];

function _ogCons_pasteHandler(e, inputAncla, idProyecto, filas) {
  e.preventDefault();
  const texto = (e.clipboardData || window.clipboardData).getData('text');
  if (!texto) return;
  const filasPaste = texto.trim().split(/\r?\n/).map(function(r) { return r.split('\t'); });

  const filaAnclaIdx = parseInt(inputAncla.dataset.fila, 10);
  const colAnclaIdx  = _OG_COLUMNAS.indexOf(inputAncla.dataset.campo);
  if (isNaN(filaAnclaIdx) || colAnclaIdx === -1) return;

  const cambios = {};
  filasPaste.forEach(function(cols, dr) {
    const fila = filas[filaAnclaIdx + dr];
    if (!fila) return;
    cambios[fila.semana] = cambios[fila.semana] || {};
    cols.forEach(function(val, dc) {
      const campo = _OG_COLUMNAS[colAnclaIdx + dc];
      if (!campo) return;
      cambios[fila.semana][campo] = _ogCons_parseNum(val);
    });
  });

  datos_aplicarCambiosOG(idProyecto, cambios);
  ogCons_inicializar(idProyecto);
}
