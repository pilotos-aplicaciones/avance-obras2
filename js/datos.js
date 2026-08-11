// Capa de persistencia — toda escritura/lectura de datos pasa por aquí.
// Para migrar a backend: reemplazar este archivo manteniendo las mismas firmas.

// PILOTO: prefijo propio para el almacenamiento local del navegador. Mantiene
// los datos del piloto separados de la app real aunque se abran en el mismo
// navegador/origen. La app real usa 'coa_'; el piloto usa 'coa_piloto_'.
const _PRE = 'coa_piloto_';

// ── Índice de proyectos ──────────────────────────────────────────────────────

function datos_listarProyectos() {
  return JSON.parse(localStorage.getItem(_PRE + 'index') || '[]');
}

function datos_generarId() {
  return 'proj_' + Date.now();
}

function _datos_guardarIndice(lista) {
  localStorage.setItem(_PRE + 'index', JSON.stringify(lista));
}

// ── Proyectos ────────────────────────────────────────────────────────────────

// Escritura real de la configuración — sin verificar permisos. Uso interno:
// cada función pública (datos_guardarProyecto, datos_importarRespaldo,
// _mat_importarJSON) verifica el permiso que corresponda ANTES de llamar aquí.
function _datos_escribirProyecto(config) {
  config.modificadoEn = new Date().toISOString();
  if (!config.creadoEn) config.creadoEn = config.modificadoEn;
  localStorage.setItem(_PRE + 'proyecto_' + config.id, JSON.stringify(config));
  // Actualizar índice
  const idx = datos_listarProyectos();
  const pos = idx.findIndex(p => p.id === config.id);
  const entrada = { id: config.id, nombre: config.nombre, zona: config.zona || '', creadoEn: config.creadoEn };
  if (pos >= 0) idx[pos] = entrada; else idx.push(entrada);
  _datos_guardarIndice(idx);
  _fs_sync(config.id);
}

// PILOTO — ¿puede esta persona restaurar/crear la config de una obra a partir
// de UN RESPALDO (JSON)? Admin siempre; o el responsable de esa obra (si ya
// existe). Es más permisivo que crear/editar por el asistente a propósito:
// restaurar tu propio respaldo es recuperar tu propio trabajo, no una edición
// nueva de configuración.
function _datos_puedeRestaurarRespaldo(id) {
  const esAdmin  = (typeof authp_esAdmin === 'function')   ? authp_esAdmin()      : true;
  const esEditor = (typeof authp_puedeEditar === 'function') ? authp_puedeEditar(id) : true;
  return esAdmin || esEditor;
}

// Usada por el asistente (crear/editar obra paso a paso): SOLO administrador.
// Devuelve true si guardó, false si lo bloqueó por falta de permiso — los
// llamadores DEBEN revisar este valor antes de mostrar éxito o navegar.
function datos_guardarProyecto(config) {
  // PILOTO — permiso para crear/editar configuración de obra vía el asistente:
  // SOLO administrador. (Restaurar un respaldo propio es otra función —
  // datos_importarRespaldo / _mat_importarJSON — que sí permite al responsable
  // de esa obra.)
  if (typeof authp_esAdmin === 'function' && !authp_esAdmin()) {
    if (typeof interfaz_mostrarToast === 'function') {
      interfaz_mostrarToast('Solo un administrador puede crear o modificar la configuración de una obra.', 'aviso', 4500);
    }
    return false;
  }
  _datos_escribirProyecto(config);
  return true;
}

function datos_cargarProyecto(id) {
  const raw = localStorage.getItem(_PRE + 'proyecto_' + id);
  return raw ? JSON.parse(raw) : null;
}

// Borra solo del almacenamiento local (sin tocar Firestore).
// Usado cuando la eliminación ya ocurrió en Firestore (p.ej. desde otro dispositivo).
function _datos_eliminarLocal(id) {
  localStorage.removeItem(_PRE + 'proyecto_' + id);
  localStorage.removeItem(_PRE + 'matrices_' + id);
  localStorage.removeItem(_PRE + 'matrices_ok_' + id);
  localStorage.removeItem(_PRE + 'pendiente_' + id);      // marca de borrador (faltaba: quedaba huérfana)
  localStorage.removeItem(_PRE + 'pendiente_ts_' + id);
  localStorage.removeItem(_PRE + 'porSubir_' + id);       // marca de subida diferida
  localStorage.removeItem(_PRE + 'semana_ctrl_' + id);
  const idx = datos_listarProyectos().filter(function(p) { return p.id !== id; });
  _datos_guardarIndice(idx);
}

// ── Marcas auxiliares de sincronización ──────────────────────────────────────
// borrado_<id>: este dispositivo sabe que la obra fue eliminada → nunca re-subir.
// porSubir_<id>: hay una confirmación hecha sin conexión, pendiente de subir.
function _datos_marcarBorrado(id)   { localStorage.setItem(_PRE + 'borrado_' + id, '1'); }
function _datos_estaBorrado(id)     { return !!localStorage.getItem(_PRE + 'borrado_' + id); }
function _datos_marcarPorSubir(id)  { localStorage.setItem(_PRE + 'porSubir_' + id, '1'); }
function _datos_hayPorSubir(id)     { return !!localStorage.getItem(_PRE + 'porSubir_' + id); }
function _datos_limpiarPorSubir(id) { localStorage.removeItem(_PRE + 'porSubir_' + id); }

// PILOTO — Soft-delete: en vez de borrar el documento en Firestore, se marca como
// eliminado (tombstone). Así, un dispositivo que estaba apagado no puede "revivir"
// la obra al re-subir su copia local: verá la marca y la eliminará también.
function datos_eliminarProyecto(id) {
  _datos_marcarBorrado(id);   // recordar el borrado ANTES de tocar nada
  _datos_eliminarLocal(id);
  if (_db) {
    _db.collection(_FS_COL).doc(id).set({
      _deleted:       true,
      _deletedEn:     new Date().toISOString(),
      _dispositivoId: _DEVICE_ID,
      config:         { id: id },   // se conserva el id para que el listener lo reconozca
    }).catch(function(err){ console.warn('[COA] Error marcando borrado en Firestore:', err.message); });
  }
}

// PILOTO — Asignación de responsables de una obra (solo la usa el panel de admin).
// Guarda la lista de correos (puede ser varios) en la configuración y la sube.
function datos_setEditoresObra(id, emails) {
  const config = datos_cargarProyecto(id);
  if (!config) return;
  config.editores = (emails || [])
    .map(function (e) { return String(e || '').toLowerCase().trim(); })
    .filter(Boolean);
  delete config.editorEmail;          // migrar del modelo anterior (un solo editor)
  datos_guardarProyecto(config);       // registra cambio real y sincroniza
}

// ── Estado pendiente ─────────────────────────────────────────────────────────
// Marca que hay cambios locales que aún no se han subido a Firebase.
// El usuario debe confirmar explícitamente para subir.

function datos_marcarPendiente(idProyecto) {
  localStorage.setItem(_PRE + 'pendiente_' + idProyecto, '1');
}

function datos_hayPendiente(idProyecto) {
  return !!localStorage.getItem(_PRE + 'pendiente_' + idProyecto);
}

function datos_limpiarPendiente(idProyecto) {
  localStorage.removeItem(_PRE + 'pendiente_' + idProyecto);
}

// Devuelve lista de ids de proyectos con cambios pendientes
function datos_proyectosConPendiente() {
  const ids = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(_PRE + 'pendiente_')) {
      ids.push(key.replace(_PRE + 'pendiente_', ''));
    }
  }
  return ids;
}

// Sube el proyecto a Firebase de forma explícita (llamado solo al confirmar guardado)
function datos_subirAhora(idProyecto) {
  // PILOTO — permiso: solo el responsable de la obra (o un admin) puede confirmar.
  if (typeof authp_puedeEditar === 'function' && !authp_puedeEditar(idProyecto)) {
    if (typeof interfaz_mostrarToast === 'function') {
      interfaz_mostrarToast('Solo lectura: no eres el responsable de esta obra.', 'aviso', 4000);
    }
    return;
  }

  // Guardar snapshot del estado oficial antes de subir
  datos_guardarMatricesOk(idProyecto);
  datos_limpiarPendiente(idProyecto);
  localStorage.removeItem(_PRE + 'pendiente_ts_' + idProyecto);

  // PILOTO — fecha de contenido: confirmar avances SÍ es una edición real, así que
  // acá se actualiza modificadoEn. Es uno de los pocos puntos que la tocan (junto a
  // editar configuración o semana); las reconexiones/arranques ya no la alteran.
  const config = datos_cargarProyecto(idProyecto);
  if (config) {
    config.modificadoEn = new Date().toISOString();
    localStorage.setItem(_PRE + 'proyecto_' + idProyecto, JSON.stringify(config));
  }

  // Si no hay internet: marcar para subir al reconectar (no re-subimos todo a ciegas).
  if (!datos_estaOnline()) {
    _datos_marcarPorSubir(idProyecto);
    _fs_setEstado('offline');
    return;
  }
  _fs_setEstado('sincronizando');
  _fs_subirProyecto(idProyecto);
}

// ── Matrices de terminaciones (estado actual) ────────────────────────────────

function datos_guardarMatrices(idProyecto, matrices) {
  // Solo guarda en local — NO sube a Firebase automáticamente.
  // El usuario debe presionar "Guardar avances" para sincronizar.
  localStorage.setItem(_PRE + 'matrices_' + idProyecto, JSON.stringify(matrices));
  // Guardar timestamp de la última vez que hubo cambios sin guardar
  if (!localStorage.getItem(_PRE + 'pendiente_ts_' + idProyecto)) {
    localStorage.setItem(_PRE + 'pendiente_ts_' + idProyecto, new Date().toISOString());
  }
  datos_marcarPendiente(idProyecto);
}

function datos_cargarMatrices(idProyecto) {
  const raw = localStorage.getItem(_PRE + 'matrices_' + idProyecto);
  return raw ? JSON.parse(raw) : {};
}

// ── Matrices oficiales (último guardado confirmado) ───────────────────────────
// Se actualiza cada vez que el usuario presiona "Guardar avances".
// Se usa para restaurar el estado cuando el usuario descarta cambios sin guardar.

function datos_guardarMatricesOk(idProyecto) {
  const matrices = datos_cargarMatrices(idProyecto);
  localStorage.setItem(_PRE + 'matrices_ok_' + idProyecto, JSON.stringify(matrices));
}

function datos_cargarMatricesOk(idProyecto) {
  const raw = localStorage.getItem(_PRE + 'matrices_ok_' + idProyecto);
  return raw ? JSON.parse(raw) : {};
}

// Devuelve la fecha/hora en que se hicieron cambios sin guardar (ISO 8601), o null si no hay.
function datos_getFechaPendiente(idProyecto) {
  return localStorage.getItem(_PRE + 'pendiente_ts_' + idProyecto) || null;
}

// Descarta los cambios sin guardar: restaura las matrices al último estado oficial
// y limpia la marca de pendiente. Se llama al confirmar "salir sin guardar".
function datos_descartarPendiente(idProyecto) {
  const ok = datos_cargarMatricesOk(idProyecto);
  localStorage.setItem(_PRE + 'matrices_' + idProyecto, JSON.stringify(ok));
  datos_limpiarPendiente(idProyecto);
  localStorage.removeItem(_PRE + 'pendiente_ts_' + idProyecto);
}

// ── Control semanal ──────────────────────────────────────────────────────────

function datos_cargarSemanaControl(idProyecto) {
  const raw = localStorage.getItem(_PRE + 'semana_ctrl_' + idProyecto);
  return raw ? JSON.parse(raw) : null;
}

function datos_guardarSemanaControl(idProyecto, obj) {
  // PILOTO — permiso: solo el responsable de la obra (o admin) edita el control semanal.
  if (typeof authp_puedeEditar === 'function' && !authp_puedeEditar(idProyecto)) {
    if (typeof interfaz_mostrarToast === 'function') {
      interfaz_mostrarToast('Solo lectura: no eres el responsable de esta obra.', 'aviso', 4000);
    }
    return;
  }
  localStorage.setItem(_PRE + 'semana_ctrl_' + idProyecto, JSON.stringify(obj));
  // Edición real → actualizar fecha de contenido para que otros dispositivos lo detecten.
  const config = datos_cargarProyecto(idProyecto);
  if (config) {
    config.modificadoEn = new Date().toISOString();
    localStorage.setItem(_PRE + 'proyecto_' + idProyecto, JSON.stringify(config));
  }
  _fs_sync(idProyecto);
}

function datos_limpiarSemanaControl(idProyecto) {
  localStorage.removeItem(_PRE + 'semana_ctrl_' + idProyecto);
}

// ── Exportar / Importar respaldo ─────────────────────────────────────────────

function datos_exportarRespaldo(idProyecto) {
  return JSON.stringify({
    version: '2.2',
    exportadoEn: new Date().toISOString(),
    proyecto: datos_cargarProyecto(idProyecto),
    matrices: datos_cargarMatrices(idProyecto),
  }, null, 2);
}

function datos_importarRespaldo(jsonTexto) {
  const obj = JSON.parse(jsonTexto);
  if (!obj.proyecto || !obj.proyecto.id) throw new Error('Respaldo inválido');
  const id = obj.proyecto.id;
  // PILOTO — restaurar un respaldo permite además al responsable de ESA obra
  // (no solo al administrador): es recuperar su propio trabajo.
  if (!_datos_puedeRestaurarRespaldo(id)) {
    throw new Error('Solo el administrador o el responsable de esta obra puede importar este respaldo.');
  }
  _datos_escribirProyecto(obj.proyecto);
  datos_guardarMatrices(id, obj.matrices || {});
  datos_limpiarPendiente(id); // el respaldo cargado no tiene avances pendientes
  return id;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function datos_usageKB() {
  let total = 0;
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith(_PRE)) total += (localStorage.getItem(key) || '').length;
  }
  return Math.round(total / 1024);
}

// ── Sincronización con Firestore ─────────────────────────────────────────────
// Estrategia: localStorage como almacén principal (síncrono, offline siempre).
// Firestore como espejo en la nube (asíncrono, en segundo plano).
//
// Flujo:
//   escritura → localStorage (inmediato) + Firestore (debounced 2 s)
//   al iniciar → Firestore → localStorage (si Firestore es más reciente)
//
// Si no hay internet, _db = null y todo funciona solo con localStorage.

// PILOTO: colección separada en el MISMO Firebase. La app real escribe en
// 'avances_obras_proyectos'; el piloto escribe en '..._piloto'. Nunca se pisan.
const _FS_COL    = 'avances_obras_proyectos_piloto'; // colección Firestore (piloto)
const _fs_timers = {};          // timers de debounce por proyecto

// ID único del dispositivo. Se persiste en localStorage para que sea siempre
// el mismo aunque el usuario cierre y reabra la app. Esto permite al sistema
// de presencia reconocer que es el mismo dispositivo entre sesiones.
const _DEVICE_ID = (function() {
  const key = _PRE + 'device_id';
  let id = localStorage.getItem(key);
  if (!id) { id = 'dev_' + Math.random().toString(36).slice(2, 9); localStorage.setItem(key, id); }
  return id;
})();

// ── Nombre de usuario ────────────────────────────────────────────────────────
// Nombre que el usuario ingresó en su primer uso. Se guarda en el dispositivo.

function datos_getNombreUsuario() {
  return localStorage.getItem(_PRE + 'autor') || '';
}

function datos_setNombreUsuario(nombre) {
  localStorage.setItem(_PRE + 'autor', (nombre || '').trim());
}

// ── Indicador de estado de sincronización ────────────────────────────────────
// Actualiza todos los íconos .sync-indicator del navbar según el estado actual.
// estados posibles: 'ok' | 'sincronizando' | 'error' | 'offline'
function _fs_setEstado(estado) {
  const labels = {
    ok:            'Sincronizado',
    sincronizando: 'Sincronizando…',
    error:         'Error',
    offline:       'Sin conexión',
  };
  const texto = labels[estado] || '';
  document.querySelectorAll('.sync-indicator').forEach(function(el) {
    el.dataset.estado = estado;
    const lbl = el.querySelector('.sync-label');
    if (lbl) lbl.textContent = texto;
  });
}

// Recopila el estado completo de un proyecto desde localStorage y lo sube
// a Firestore. Se llama después de cada escritura (con debounce).
// IMPORTANTE: también actualiza config.modificadoEn para que otros dispositivos
// detecten el cambio aunque solo se hayan editado celdas (matrices).
function _fs_subirProyecto(id) {
  if (!_db) return;
  if (_datos_estaBorrado(id)) return;   // PILOTO: una obra borrada nunca se re-sube (no revive)
  const config = datos_cargarProyecto(id);
  if (!config) return;

  // PILOTO — la fecha de contenido (modificadoEn) NO se toca aquí: se fija solo en
  // ediciones reales (config / avances confirmados / semana). Así una reconexión o
  // un arranque no alteran la fecha. _sincEn y _fecha son metadatos de subida.
  const ahora = new Date().toISOString();

  // Solo se sincroniza el estado CONFIRMADO. Si el proyecto tiene cambios sin
  // guardar (pendiente), se sube la última versión oficial (matrices_ok), nunca
  // el borrador. Así una reconexión o una edición de config/fecha no suben
  // avances que el usuario aún no confirmó con "Guardar avances".
  // Si no hay pendiente, el borrador YA es el estado oficial (cubre importaciones).
  const matricesASubir = datos_hayPendiente(id)
    ? datos_cargarMatricesOk(id)
    : datos_cargarMatrices(id);

  const doc = {
    config,
    matrices:      matricesASubir                || {},
    semanaControl: datos_cargarSemanaControl(id) || null,
    _sincEn:        ahora,
    _dispositivoId: _DEVICE_ID,  // identifica el origen; el listener lo usa para ignorar echos
    _app:           'Avances_Obras', // identifica la app en Firebase
    _autor:         localStorage.getItem(_PRE + 'autor') || _DEVICE_ID, // nombre ingresado en primer uso
    _fecha:         ahora,        // fecha de última escritura (ISO 8601)
  };

  _db.collection(_FS_COL).doc(id).set(doc)
    .then(function() {
      // Firebase resuelve su caché local aunque no haya internet,
      // así que verificamos datos_estaOnline() antes de mostrar "Sincronizado".
      _fs_setEstado(datos_estaOnline() ? 'ok' : 'offline');
    })
    .catch(function(err) {
      console.warn('[COA] Error al subir proyecto a Firestore:', err.message);
      _fs_setEstado(datos_estaOnline() ? 'error' : 'offline');
    });
}

// Versión con debounce: agrupa escrituras rápidas (ej: celdas) en una sola
// subida a Firestore después de 2 segundos de inactividad.
function _fs_sync(id) {
  _fs_setEstado('sincronizando');
  clearTimeout(_fs_timers[id]);
  _fs_timers[id] = setTimeout(function() { _fs_subirProyecto(id); }, 2000);
}

// ── Listener en tiempo real ──────────────────────────────────────────────────
// Reemplaza la descarga única por un listener persistente que recibe cambios
// automáticamente sin recargar la página. Se activa al iniciar la app.
//
// Primera llamada: comportamiento idéntico a la descarga inicial (sync completo).
// Llamadas siguientes: solo se procesan los documentos que cambiaron (docChanges).
// Cambios propios (subidos por este dispositivo) se ignoran via _dispositivoId.

let _fs_primeraVez = true; // controla la subida de proyectos locales al arrancar

function datos_iniciarListenerFirestore() {
  if (!_db) {
    _fs_setEstado('offline');
    console.warn('[COA] Firestore no disponible — usando datos locales.');
    return;
  }

  _fs_setEstado('sincronizando');

  _db.collection(_FS_COL).onSnapshot(function(snap) {
    const idsActualizados = new Set(); // proyectos que cambiaron desde otro dispositivo
    const idsConflicto    = new Set(); // remoto más nuevo pero con borrador local sin guardar

    snap.docChanges().forEach(function(change) {
      if (change.type === 'removed') {
        // El proyecto fue eliminado desde otro dispositivo: borrarlo localmente también.
        const id = change.doc.id;
        _datos_eliminarLocal(id);
        // Si el usuario está viendo ese proyecto ahora, volver al inicio.
        if (typeof router_getProyectoActivo === 'function' && router_getProyectoActivo() === id) {
          if (typeof interfaz_mostrarToast === 'function') {
            interfaz_mostrarToast('Este proyecto fue eliminado desde otro dispositivo.', 'info', 4000);
          }
          if (typeof router_ir === 'function') router_ir('v-inicio');
        } else if (typeof proyectos_renderizarGrilla === 'function') {
          proyectos_renderizarGrilla();
        }
        return;
      }

      const d = change.doc.data();
      if (!d.config || !d.config.id) return;
      const id = d.config.id;

      // Ignorar cambios que subimos nosotros mismos (eco del propio upload)
      if (d._dispositivoId && d._dispositivoId === _DEVICE_ID) return;

      // PILOTO — Soft-delete: documento marcado como borrado → eliminar localmente
      // y recordar el borrado para no revivirlo nunca.
      if (d._deleted) {
        _datos_marcarBorrado(id);
        _datos_eliminarLocal(id);
        if (typeof router_getProyectoActivo === 'function' && router_getProyectoActivo() === id) {
          if (typeof interfaz_mostrarToast === 'function') interfaz_mostrarToast('Esta obra fue eliminada.', 'aviso', 4000);
          if (typeof router_ir === 'function') router_ir('v-inicio');
        } else if (typeof proyectos_renderizarGrilla === 'function') {
          proyectos_renderizarGrilla();
        }
        return;
      }

      const localConfig = datos_cargarProyecto(id);
      const fsDate      = d.config.modificadoEn || d._sincEn || '';
      const localDate   = localConfig ? (localConfig.modificadoEn || '') : '';
      const masNuevo    = (!localConfig || fsDate > localDate);

      // PILOTO — no pisar el borrador: si hay avances sin guardar en esta obra y
      // llega una versión remota más nueva, se conserva el trabajo local y se avisa.
      if (masNuevo && localConfig && typeof datos_hayPendiente === 'function' && datos_hayPendiente(id)) {
        idsConflicto.add(id);
        return;
      }

      // Solo sobrescribir si Firestore es más reciente
      if (masNuevo) {
        idsActualizados.add(id); // registrar qué proyecto cambió
        if (!d.config.creadoEn) d.config.creadoEn = d.config.modificadoEn;

        // Escritura directa — sin llamar datos_guardarProyecto para no disparar _fs_sync
        localStorage.setItem(_PRE + 'proyecto_' + id, JSON.stringify(d.config));
        const idx = datos_listarProyectos();
        const pos = idx.findIndex(function(p) { return p.id === id; });
        const ent = { id: id, nombre: d.config.nombre, zona: d.config.zona || '', creadoEn: d.config.creadoEn };
        if (pos >= 0) idx[pos] = ent; else idx.push(ent);
        _datos_guardarIndice(idx);

        if (d.matrices)                                    localStorage.setItem(_PRE + 'matrices_'    + id, JSON.stringify(d.matrices));
        if (d.semanaControl)                               localStorage.setItem(_PRE + 'semana_ctrl_' + id, JSON.stringify(d.semanaControl));
      }
    });

    // Primera llamada: subir proyectos locales que aún no están en Firestore
    if (_fs_primeraVez) {
      _fs_primeraVez = false;
      const idsFirestore = new Set(snap.docs.map(function(d) { return d.id; }));
      datos_listarProyectos().forEach(function(p) {
        if (_datos_estaBorrado(p.id)) return;            // PILOTO: no revivir obras borradas
        if (!idsFirestore.has(p.id)) _fs_subirProyecto(p.id);
      });
    }

    _fs_setEstado(datos_estaOnline() ? 'ok' : 'offline');

    // Solo notificar si hubo cambios externos y alguno afecta la vista actual
    if (idsActualizados.size > 0) {
      _fs_notificarCambioExterno(idsActualizados);
    }

    // PILOTO — avisar conflicto de borrador solo si afecta la obra que se está viendo.
    if (idsConflicto.size > 0) {
      const activo = (typeof router_getProyectoActivo === 'function') ? router_getProyectoActivo() : null;
      if (activo && idsConflicto.has(activo) && typeof interfaz_mostrarToast === 'function') {
        interfaz_mostrarToast('Hay cambios nuevos de esta obra en la nube, pero tienes avances sin guardar. Guarda o descarta para verlos.', 'aviso', 6000);
      }
    }

  }, function(err) {
    _fs_setEstado(datos_estaOnline() ? 'error' : 'offline');
    console.warn('[COA] Error en listener Firestore:', err.message);
  });
}

// Refresca la UI cuando llegan datos externos, SOLO si afectan la vista actual.
// Si está en proyecto A y cambió proyecto B → silencioso, sin interrumpir.
function _fs_notificarCambioExterno(idsActualizados) {
  const vista          = typeof router_getVistaActual    === 'function' ? router_getVistaActual()    : null;
  const proyectoActivo = typeof router_getProyectoActivo === 'function' ? router_getProyectoActivo() : null;

  const afectaVista = vista === 'v-inicio' ||
    (vista === 'v-proyecto' && proyectoActivo && idsActualizados.has(proyectoActivo));

  if (!afectaVista) return;

  if (vista === 'v-inicio') {
    if (typeof proyectos_renderizarGrilla === 'function') proyectos_renderizarGrilla();
  } else if (vista === 'v-proyecto' && proyectoActivo) {
    if (typeof terminaciones_inicializar === 'function') terminaciones_inicializar(proyectoActivo);
  }
}

// ── Detección de red en tiempo real ─────────────────────────────────────────
// Usamos nuestra propia variable en vez de navigator.onLine directamente,
// porque navigator.onLine no es confiable en todos los dispositivos (ej. iOS).

let _coa_estaOnline = navigator.onLine;

function datos_estaOnline() {
  return _coa_estaOnline;
}

window.addEventListener('offline', function() {
  _coa_estaOnline = false;
  _fs_setEstado('offline');
});

window.addEventListener('online', function() {
  _coa_estaOnline = true;
  if (!_db) return;
  _fs_setEstado('sincronizando');
  // PILOTO — solo re-subir lo que quedó pendiente por falta de conexión (avances
  // confirmados sin internet). Ya NO se re-sube todo a ciegas: eso alteraba las
  // fechas de modificación y podía revivir obras borradas.
  datos_listarProyectos().forEach(function(p) {
    if (_datos_estaBorrado(p.id)) return;
    if (_datos_hayPorSubir(p.id)) {
      _datos_limpiarPorSubir(p.id);
      _fs_subirProyecto(p.id);
    }
  });
  _fs_setEstado(datos_estaOnline() ? 'ok' : 'offline');
});
