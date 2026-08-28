// Obra Gruesa — pestaña "Piso OG": listado de niveles del edificio (desde
// Fundaciones hasta el último piso, según config.pisos/config.subterraneos)
// con su fecha de término real, ingresada a mano. A diferencia del selector
// "Viernes" de la barra lateral, acá cualquier día es válido — el hormigonado
// de un nivel no cae siempre en viernes (confirmado con el Excel de obra
// gruesa de María Paz: fechas de término en distintos días de la semana).

let _pog_id           = null;
let _pog_calAbiertoEn = null; // índice de la fila con el calendario desplegado

function pisoOG_inicializar(idProyecto) {
  const panel = document.getElementById('panel-tab-piso-og');
  if (!panel) return;
  _pog_id = idProyecto;

  const config = datos_cargarProyecto(idProyecto);
  if (!config) { panel.innerHTML = '<div class="proy-nav-placeholder">No se encontró el proyecto.</div>'; return; }

  _pog_render(panel, config);
}

// Genera la lista de niveles (Fundaciones → Subterráneos → Pisos) a partir de
// la configuración del edificio, y la combina con las fechas ya guardadas
// (config.pisoOG) — así si cambia la cantidad de pisos/subterráneos, la
// lista se ajusta sola sin perder las fechas ya ingresadas (se cruzan por
// el nombre del nivel).
function _pog_nivelesEsperados(config) {
  const niveles = ['Fundaciones'];
  const subs = config.subterraneos || 0;
  for (let s = subs; s >= 1; s--) niveles.push('Subterráneo ' + s);
  const pisos = config.pisos || 0;
  for (let p = 1; p <= pisos; p++) niveles.push('Piso ' + p);
  return niveles;
}

function _pog_filasCombinadas(config) {
  const guardado = config.pisoOG || [];
  const porNivel = {};
  guardado.forEach(function(f) { porNivel[f.nivel] = f.fechaTermino || null; });
  return _pog_nivelesEsperados(config).map(function(nivel) {
    return { nivel: nivel, fechaTermino: porNivel[nivel] || null };
  });
}

function _pog_render(panel, config) {
  const filas = _pog_filasCombinadas(config);
  const puedeEditar = (typeof authp_puedeEditar === 'function') ? authp_puedeEditar(config.id) : true;

  if (!filas.length) {
    panel.innerHTML = `
      <div class="proy-nav-placeholder">
        Todavía no hay pisos/subterráneos configurados.<br>
        <span class="cf-hint">Configura la cantidad de pisos en "⚙ Configurar" (Paso 1).</span>
      </div>`;
    return;
  }

  const filasHtml = filas.map(function(fila, i) {
    const txt = fila.fechaTermino ? logica_formatearFecha(fila.fechaTermino) : '—';
    const claseFecha = fila.fechaTermino ? 'piso-og-hecho' : 'piso-og-pendiente';
    // Editable: se puede escribir la fecha a mano (dd-mm-aaaa) o abrirla con
    // el botón de calendario al lado — pedido de María Paz, ambas formas
    // llevan al mismo lugar (_pog_guardarFecha).
    const valorInput = fila.fechaTermino ? logica_formatearFecha(fila.fechaTermino).replace(/\//g, '-') : '';
    const celda = puedeEditar
      ? `<div class="piso-og-fecha-wrap">
           <input type="text" inputmode="numeric" class="piso-og-fecha-input" data-idx="${i}" value="${valorInput}" placeholder="dd-mm-aaaa">
           <button class="piso-og-cal-btn" data-idx="${i}" title="Elegir en calendario">📅</button>
         </div>`
      : `<span class="${claseFecha}">${txt}</span>`;
    return `<tr>
      <td class="piso-og-nivel">${fila.nivel}</td>
      <td class="piso-og-fecha-celda" data-idx="${i}">${celda}</td>
    </tr>`;
  }).join('');

  panel.innerHTML = `
    <div class="cons-tabla-wrap">
      <table class="tabla-piso-og">
        <thead><tr><th>Nivel</th><th>Fecha Término</th></tr></thead>
        <tbody>${filasHtml}</tbody>
      </table>
    </div>`;

  if (puedeEditar) _pog_registrarEventos(panel, config);
}

function _pog_registrarEventos(panel, config) {
  panel.querySelectorAll('.piso-og-cal-btn').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.idx, 10);
      _pog_abrirCalendario(idx, btn, config);
    });
  });

  panel.querySelectorAll('.piso-og-fecha-input').forEach(function(inp) {
    inp.addEventListener('change', function() {
      const idx = parseInt(inp.dataset.idx, 10);
      const texto = inp.value.trim();
      if (texto === '') { _pog_guardarFecha(idx, config, null); return; }
      const iso = _pog_parseFechaTexto(texto);
      if (!iso) {
        if (typeof interfaz_mostrarToast === 'function') interfaz_mostrarToast('Fecha no válida — usa el formato dd-mm-aaaa', 'error');
        const filas = _pog_filasCombinadas(config);
        inp.value = filas[idx].fechaTermino ? logica_formatearFecha(filas[idx].fechaTermino).replace(/\//g, '-') : '';
        return;
      }
      _pog_guardarFecha(idx, config, iso);
    });
  });
}

// Acepta dd-mm-aaaa o dd/mm/aaaa escrito a mano; valida que sea una fecha
// real (rechaza p.ej. 31-02-2026) antes de guardarla.
function _pog_parseFechaTexto(v) {
  const m = String(v).trim().match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (!m) return null;
  const d = parseInt(m[1], 10), mo = parseInt(m[2], 10), y = parseInt(m[3], 10);
  const fecha = new Date(y, mo - 1, d);
  if (fecha.getFullYear() !== y || fecha.getMonth() !== mo - 1 || fecha.getDate() !== d) return null;
  return y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}

// Calendario desplegable — mismo look que el de "Viernes" (semana-control.js)
// pero SIN restringir a un día de la semana: cualquier día es clickeable.
let _pog_calYear = null, _pog_calMonth = null, _pog_closeHandler = null;

function _pog_abrirCalendario(idx, btnEl, config) {
  // Si ya hay uno abierto para otra fila, ciérralo primero.
  document.querySelectorAll('.piso-og-cal-dropdown').forEach(function(el) { el.remove(); });
  if (_pog_calAbiertoEn === idx) { _pog_calAbiertoEn = null; return; }
  _pog_calAbiertoEn = idx;

  const filas = _pog_filasCombinadas(config);
  const actual = filas[idx].fechaTermino;
  const base = actual ? new Date(actual + 'T12:00:00Z') : new Date();
  _pog_calYear  = actual ? base.getUTCFullYear() : base.getFullYear();
  _pog_calMonth = actual ? base.getUTCMonth()    : base.getMonth();

  const dd = document.createElement('div');
  dd.className = 'sc-cal-dropdown piso-og-cal-dropdown';
  dd.style.position = 'fixed';
  document.body.appendChild(dd);
  _pog_renderCal(dd, idx, config);

  const rect = btnEl.getBoundingClientRect();
  dd.style.top  = (rect.bottom + 4) + 'px';
  dd.style.left = rect.left + 'px';
  const anchoDropdown = 280;
  if (rect.left + anchoDropdown > window.innerWidth) {
    dd.style.left = Math.max(4, window.innerWidth - anchoDropdown - 4) + 'px';
  }

  if (_pog_closeHandler) document.removeEventListener('click', _pog_closeHandler);
  _pog_closeHandler = function(e) {
    if (e.target.closest('.piso-og-cal-dropdown') || e.target.closest('.piso-og-cal-btn')) return;
    document.querySelectorAll('.piso-og-cal-dropdown').forEach(function(el) { el.remove(); });
    _pog_calAbiertoEn = null;
  };
  setTimeout(function() { document.addEventListener('click', _pog_closeHandler); }, 0);
}

function _pog_renderCal(dd, idx, config) {
  const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                 'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const DIAS  = ['Lu','Ma','Mi','Ju','Vi','Sa','Do'];

  const diaSemana = new Date(_pog_calYear, _pog_calMonth, 1).getDay();
  const inicio    = diaSemana === 0 ? 6 : diaSemana - 1;
  const diasEnMes = new Date(_pog_calYear, _pog_calMonth + 1, 0).getDate();

  const celdas = [];
  for (let i = 0; i < inicio; i++) celdas.push(null);
  for (let d = 1; d <= diasEnMes; d++) celdas.push(d);
  while (celdas.length % 7 !== 0) celdas.push(null);

  const filas = _pog_filasCombinadas(config);
  const seleccionada = filas[idx].fechaTermino;

  const ths = DIAS.map(function(d) { return '<th>' + d + '</th>'; }).join('');
  let filasHtml = '';
  for (let i = 0; i < celdas.length; i++) {
    if (i % 7 === 0) filasHtml += '<tr>';
    const d = celdas[i];
    if (d === null) {
      filasHtml += '<td class="sc-cal-vacio"></td>';
    } else {
      const fecha = _pog_calYear + '-' + String(_pog_calMonth + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      const esSel = fecha === seleccionada;
      // Todos los días son clickeables (no solo viernes) — a diferencia del
      // selector "Viernes" de la barra lateral. Usa un color neutro para los
      // días normales (antes reusaba "sc-cal-viernes", que los pintaba todos
      // en rojo/acento); el día seleccionado sí se destaca (sc-cal-sel).
      filasHtml += '<td class="sc-cal-dia pog-cal-dia' + (esSel ? ' sc-cal-sel' : '') + '" data-fecha="' + fecha + '">' + d + '</td>';
    }
    if (i % 7 === 6) filasHtml += '</tr>';
  }

  dd.innerHTML = `
    <div id="pog-cal-contenido">
      <div class="sc-cal-header">
        <button class="sc-cal-nav" id="pog-cal-ant">‹</button>
        <span class="sc-cal-mes">${MESES[_pog_calMonth]} ${_pog_calYear}</span>
        <button class="sc-cal-nav" id="pog-cal-sig">›</button>
      </div>
      <table class="sc-cal-tabla">
        <thead><tr>${ths}</tr></thead>
        <tbody>${filasHtml}</tbody>
      </table>
    </div>
    ${seleccionada ? '<div style="margin-top:.6rem;padding-top:.6rem;border-top:1px solid var(--borde-suave)"><button class="btn-secundario btn-sm" id="pog-cal-limpiar" style="width:100%;font-size:.82rem;justify-content:center">Quitar fecha</button></div>' : ''}
  `;

  dd.querySelector('#pog-cal-ant').addEventListener('click', function(e) {
    e.stopPropagation();
    if (--_pog_calMonth < 0) { _pog_calMonth = 11; _pog_calYear--; }
    _pog_renderCal(dd, idx, config);
  });
  dd.querySelector('#pog-cal-sig').addEventListener('click', function(e) {
    e.stopPropagation();
    if (++_pog_calMonth > 11) { _pog_calMonth = 0; _pog_calYear++; }
    _pog_renderCal(dd, idx, config);
  });
  dd.querySelectorAll('[data-fecha]').forEach(function(td) {
    td.addEventListener('click', function(e) {
      e.stopPropagation();
      _pog_guardarFecha(idx, config, td.dataset.fecha);
    });
  });
  const btnLimpiar = dd.querySelector('#pog-cal-limpiar');
  if (btnLimpiar) {
    btnLimpiar.addEventListener('click', function(e) {
      e.stopPropagation();
      _pog_guardarFecha(idx, config, null);
    });
  }
}

function _pog_guardarFecha(idx, config, fecha) {
  const filas = _pog_filasCombinadas(config);
  filas[idx].fechaTermino = fecha;
  const ok = datos_guardarPisoOG(config.id, filas);
  document.querySelectorAll('.piso-og-cal-dropdown').forEach(function(el) { el.remove(); });
  _pog_calAbiertoEn = null;
  if (ok) {
    const configActualizado = datos_cargarProyecto(config.id);
    const panel = document.getElementById('panel-tab-piso-og');
    if (panel) _pog_render(panel, configActualizado);
  }
}
