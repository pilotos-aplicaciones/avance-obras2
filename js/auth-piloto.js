// ─────────────────────────────────────────────────────────────────────────────
// auth-piloto.js — Login con Google, roles y permisos (SOLO versión PILOTO)
//
// Qué hace:
//   1. Bloquea la app hasta que haya una sesión de Google válida.
//   2. Reusa la MISMA sesión del portal (mismo Firebase, mismo dominio): si el
//      usuario ya entró en el portal, aquí ya está identificado.
//   3. Lista blanca propia del piloto en Firestore: colección 'piloto_usuarios'
//      (id del documento = correo en minúsculas). Si el correo no está o está
//      inactivo, no entra.
//   4. Configuración inicial: si todavía no hay ningún administrador cargado,
//      muestra una pantalla para que el primer responsable escriba los correos
//      de administrador. Los correos NO viven en el código.
//   5. Roles: 'admin' ve y edita todo; 'usuario' edita solo la obra asignada
//      (campo config.editorEmail) y ve las demás en solo lectura.
//   6. Panel de administración: alta/baja de usuarios y asignación de obras.
//
// Aislamiento: usa colecciones propias ('piloto_usuarios') que no tocan las del
// portal ('plataforma_usuarios') ni las de la app real.
// ─────────────────────────────────────────────────────────────────────────────

// Colección de usuarios del piloto (lista blanca + roles).
const _AUTHP_COL_USUARIOS = 'piloto_usuarios';

// Estado en memoria
let _authp_user    = null;   // objeto user de Firebase Auth
let _authp_perfil  = null;   // documento de piloto_usuarios del usuario actual
let _authp_onReady = null;   // callback para arrancar la app (se llama una sola vez)
let _authp_arrancado = false;

// ── API pública de permisos ──────────────────────────────────────────────────

function authp_email() {
  return _authp_user && _authp_user.email ? _authp_user.email.toLowerCase() : '';
}

function authp_esAdmin() {
  return !!(_authp_perfil && _authp_perfil.rol === 'admin' && _authp_perfil.activo !== false);
}

// ¿El usuario actual puede editar esta obra?
// Admin: todas. Usuario: solo si está entre los responsables de la obra
// (config.editores, lista de correos). Obra sin responsables: solo admin.
function authp_puedeEditar(idProyecto) {
  if (authp_esAdmin()) return true;
  if (!idProyecto || typeof datos_cargarProyecto !== 'function') return false;
  const config = datos_cargarProyecto(idProyecto);
  if (!config) return false;
  const lista = authp_editoresDeObra(config);
  return lista.indexOf(authp_email()) >= 0;
}

// Devuelve la lista de correos responsables de una obra (en minúsculas).
// Compatible con el modelo anterior de un solo editor (editorEmail).
function authp_editoresDeObra(config) {
  if (!config) return [];
  let lista = Array.isArray(config.editores) ? config.editores
            : (config.editorEmail ? [config.editorEmail] : []);
  return lista.map(function (e) { return String(e || '').toLowerCase(); }).filter(Boolean);
}

// ── Arranque / gate ────────────────────────────────────────────────────────────

// Punto de entrada. onAutorizado() se ejecuta UNA vez cuando hay sesión válida.
function authp_iniciar(onAutorizado) {
  _authp_onReady = onAutorizado;
  _authp_inyectarEstilos();

  // Sin Firebase Auth disponible (sin SDK o sin internet en primer uso):
  // no podemos verificar identidad. Por seguridad, bloqueamos con aviso.
  if (typeof firebase === 'undefined' || !firebase.auth) {
    _authp_mostrarPantalla('login', { error: 'No se pudo cargar el inicio de sesión. Revisa tu conexión y recarga.' });
    return;
  }

  _authp_mostrarPantalla('cargando');

  firebase.auth().onAuthStateChanged(function (user) {
    _authp_user = user || null;
    if (!user) {
      _authp_perfil = null;
      _authp_mostrarPantalla('login');
      return;
    }
    _authp_verificarAcceso();
  });
}

// Verifica lista blanca / configuración inicial para el usuario ya autenticado.
function _authp_verificarAcceso() {
  if (!_authp_user) return;
  const email = authp_email();
  _authp_mostrarPantalla('cargando');

  const col = firebase.firestore().collection(_AUTHP_COL_USUARIOS);

  // ¿Hay al menos un administrador configurado?
  col.where('rol', '==', 'admin').limit(1).get()
    .then(function (snapAdmins) {
      const hayAdmin = !snapAdmins.empty;

      if (!hayAdmin) {
        // Nadie configurado todavía → configuración inicial.
        _authp_mostrarPantalla('setup');
        return null;
      }

      // Ya hay admins: el usuario debe estar en la lista blanca y activo.
      return col.doc(email).get().then(function (doc) {
        if (!doc.exists) {
          _authp_mostrarPantalla('denegado', {
            msg: 'Tu cuenta ' + email + ' no está registrada en esta aplicación. Contacta al administrador.'
          });
          return;
        }
        const data = doc.data() || {};
        if (data.activo === false) {
          _authp_mostrarPantalla('denegado', {
            msg: 'Tu cuenta ' + email + ' está desactivada. Contacta al administrador.'
          });
          return;
        }
        // Acceso concedido.
        _authp_perfil = Object.assign({ email: email }, data);
        _authp_registrarIdentidadLocal();
        _authp_autorizar();
      });
    })
    .catch(function (err) {
      console.warn('[COA piloto] Error verificando acceso:', err && err.message);
      _authp_mostrarPantalla('denegado', {
        msg: 'No se pudo verificar tu acceso. Revisa la conexión e intenta de nuevo.',
        reintentar: true
      });
    });
}

// Guarda el nombre/correo real como autor local (reemplaza el "nombre libre").
function _authp_registrarIdentidadLocal() {
  try {
    const nombre = (_authp_perfil && _authp_perfil.nombre) || authp_email();
    localStorage.setItem(_PRE + 'autor', nombre);
  } catch (e) {}
}

// Oculta las pantallas de auth y arranca la app (una sola vez).
function _authp_autorizar() {
  _authp_ocultarOverlay();
  _authp_pintarBarraUsuario();
  if (!_authp_arrancado) {
    _authp_arrancado = true;
    if (typeof _authp_onReady === 'function') _authp_onReady();
  }
}

// ── Acciones de sesión ─────────────────────────────────────────────────────────

function authp_login() {
  _authp_mostrarPantalla('cargando');
  const provider = new firebase.auth.GoogleAuthProvider();
  firebase.auth().signInWithPopup(provider)
    .catch(function (err) {
      console.warn('[COA piloto] Error de login:', err && err.code);
      // Si el popup falla (bloqueado o móvil), reintentar por redirección.
      if (err && (err.code === 'auth/popup-blocked' || err.code === 'auth/cancelled-popup-request' || err.code === 'auth/operation-not-supported-in-this-environment')) {
        firebase.auth().signInWithRedirect(provider);
        return;
      }
      _authp_mostrarPantalla('login', { error: 'No se pudo iniciar sesión. Intenta de nuevo.' });
    });
}

function authp_logout() {
  firebase.auth().signOut().then(function () {
    _authp_perfil = null;
    _authp_arrancado = false;
    // Recargar para dejar la app en estado limpio tras cerrar sesión.
    location.reload();
  });
}

// ── Configuración inicial de administradores ───────────────────────────────────

function _authp_guardarSetup() {
  const txt = document.getElementById('authp-setup-emails');
  const err = document.getElementById('authp-setup-err');
  if (!txt) return;
  const correos = _authp_parseEmails(txt.value);
  if (correos.length === 0) {
    if (err) err.textContent = 'Escribe al menos un correo válido.';
    return;
  }
  if (err) err.textContent = '';
  _authp_setBoton('authp-setup-btn', true, 'Guardando…');

  const col = firebase.firestore().collection(_AUTHP_COL_USUARIOS);
  const ahora = new Date().toISOString();
  // Re-verificar que sigue sin haber admin (evita pisar una config hecha en paralelo).
  col.where('rol', '==', 'admin').limit(1).get()
    .then(function (snap) {
      if (!snap.empty) throw new Error('La configuración ya fue realizada por otro administrador.');
      const batch = firebase.firestore().batch();
      correos.forEach(function (email) {
        batch.set(col.doc(email), {
          email: email, rol: 'admin', activo: true,
          nombre: email.split('@')[0], creadoEn: ahora
        });
      });
      return batch.commit();
    })
    .then(function () { _authp_verificarAcceso(); })
    .catch(function (e) {
      _authp_setBoton('authp-setup-btn', false, 'Guardar y entrar');
      if (err) err.textContent = (e && e.message) || 'No se pudo guardar la configuración.';
    });
}

// ── Panel de administración ─────────────────────────────────────────────────────

let _authp_adminTab = 'usuarios';        // pestaña activa: 'usuarios' | 'obras'
let _authp_usuariosCache = [];           // usuarios cargados (para pintar ambas pestañas)

function authp_abrirAdmin() {
  if (!authp_esAdmin()) return;
  const ov = document.getElementById('authp-admin-overlay');
  if (ov) ov.style.display = 'flex';
  _authp_renderAdmin();
}

function authp_cerrarAdmin() {
  const ov = document.getElementById('authp-admin-overlay');
  if (ov) ov.style.display = 'none';
}

function _authp_verTab(tab) { _authp_adminTab = tab; _authp_renderAdmin(); }

// Carga los usuarios una vez y pinta la pestaña activa (Usuarios o Editores por obra).
function _authp_renderAdmin() {
  const cont = document.getElementById('authp-admin-body');
  if (!cont) return;
  cont.innerHTML = '<div style="padding:20px;color:#666">Cargando…</div>';

  firebase.firestore().collection(_AUTHP_COL_USUARIOS).get().then(function (snap) {
    _authp_usuariosCache = snap.docs.map(function (d) { return Object.assign({ email: d.id }, d.data()); });
    _authp_usuariosCache.sort(function (a, b) { return String(a.nombre || a.email).localeCompare(String(b.nombre || b.email), 'es'); });

    const tabs = '<div class="authp-tabbar">' +
      '<button class="authp-tab ' + (_authp_adminTab === 'usuarios' ? 'activa' : '') + '" onclick="_authp_verTab(\'usuarios\')">Usuarios</button>' +
      '<button class="authp-tab ' + (_authp_adminTab === 'obras' ? 'activa' : '') + '" onclick="_authp_verTab(\'obras\')">Editores por obra</button>' +
      '</div>';
    cont.innerHTML = tabs + '<div id="authp-admin-tab"></div>';
    document.getElementById('authp-admin-tab').innerHTML =
      (_authp_adminTab === 'obras') ? _authp_htmlObras() : _authp_htmlUsuarios();
  }).catch(function (err) {
    cont.innerHTML = '<div style="padding:20px;color:#b00">Error al cargar: ' + _authp_esc((err && err.message) || '') + '</div>';
  });
}

// Pestaña "Usuarios": alta con nombre + correo + rol, y lista con acciones.
function _authp_htmlUsuarios() {
  let html = '<div class="authp-add-row">' +
    '<input id="authp-nuevo-nombre" type="text" placeholder="Nombre" class="authp-input">' +
    '<input id="authp-nuevo-email" type="email" placeholder="correo@ejemplo.com" class="authp-input">' +
    '<select id="authp-nuevo-rol" class="authp-input" style="max-width:130px"><option value="usuario">Usuario</option><option value="admin">Administrador</option></select>' +
    '<button class="authp-btn authp-btn-primary" onclick="_authp_agregarUsuario()">Agregar</button>' +
    '</div>';
  html += '<div class="authp-tabla">';
  if (_authp_usuariosCache.length === 0) html += '<div class="authp-vacio">Sin usuarios.</div>';
  _authp_usuariosCache.forEach(function (u) {
    const activo = u.activo !== false;
    const nombre = u.nombre || u.email.split('@')[0];
    html += '<div class="authp-fila">' +
      '<span class="authp-fila-email"><strong>' + _authp_esc(nombre) + '</strong>' +
        (u.rol === 'admin' ? ' <span class="authp-badge">admin</span>' : '') +
        (activo ? '' : ' <span class="authp-badge" style="background:#999">inactivo</span>') +
        '<br><span style="color:#888;font-size:12px">' + _authp_esc(u.email) + '</span></span>' +
      '<span class="authp-fila-acc">' +
        '<button class="authp-mini" onclick="_authp_toggleActivo(\'' + _authp_esc(u.email) + '\',' + (!activo) + ')">' + (activo ? 'Desactivar' : 'Activar') + '</button>' +
        '<button class="authp-mini" onclick="_authp_toggleRol(\'' + _authp_esc(u.email) + '\',\'' + (u.rol === 'admin' ? 'usuario' : 'admin') + '\')">' + (u.rol === 'admin' ? 'Quitar admin' : 'Hacer admin') + '</button>' +
        '<button class="authp-mini authp-mini-peligro" onclick="_authp_quitarUsuario(\'' + _authp_esc(u.email) + '\')">Eliminar</button>' +
      '</span>' +
    '</div>';
  });
  html += '</div>';
  return html;
}

// Pestaña "Editores por obra": por cada obra, checkboxes de los usuarios (varios permitidos).
function _authp_htmlObras() {
  const proyectos = (typeof datos_listarProyectos === 'function') ? datos_listarProyectos() : [];
  let html = '<p class="authp-nota">Marca quién puede editar cada obra (puedes elegir varios). Los demás la ven en solo lectura; el admin edita todas.</p>';
  if (proyectos.length === 0) return html + '<div class="authp-vacio">No hay obras todavía.</div>';
  if (_authp_usuariosCache.length === 0) return html + '<div class="authp-vacio">Primero agrega usuarios en la pestaña "Usuarios".</div>';
  html += '<div class="authp-tabla">';
  proyectos.forEach(function (p) {
    const config = (typeof datos_cargarProyecto === 'function') ? datos_cargarProyecto(p.id) : null;
    const actuales = authp_editoresDeObra(config);
    let chks = '';
    _authp_usuariosCache.forEach(function (u) {
      const marcado = actuales.indexOf(String(u.email).toLowerCase()) >= 0 ? ' checked' : '';
      chks += '<label class="authp-chk"><input type="checkbox" value="' + _authp_esc(u.email) + '"' + marcado +
        ' data-obra="' + _authp_esc(p.id) + '" onchange="_authp_guardarEditores(\'' + _authp_esc(p.id) + '\')"> ' +
        _authp_esc(u.nombre || u.email) + '</label>';
    });
    html += '<div class="authp-fila-obra">' +
      '<div class="authp-obra-nombre">' + _authp_esc((config && config.nombre) || p.nombre || p.id) + '</div>' +
      '<div class="authp-chk-lista">' + chks + '</div>' +
    '</div>';
  });
  html += '</div>';
  return html;
}

function _authp_agregarUsuario() {
  const nomEl = document.getElementById('authp-nuevo-nombre');
  const emailEl = document.getElementById('authp-nuevo-email');
  const rolEl = document.getElementById('authp-nuevo-rol');
  if (!emailEl) return;
  const correos = _authp_parseEmails(emailEl.value);
  if (correos.length === 0) return;
  const email = correos[0];
  const nombre = (nomEl && nomEl.value.trim()) || email.split('@')[0];
  const rol = (rolEl && rolEl.value === 'admin') ? 'admin' : 'usuario';
  firebase.firestore().collection(_AUTHP_COL_USUARIOS).doc(email).set({
    email: email, rol: rol, activo: true, nombre: nombre, creadoEn: new Date().toISOString()
  }).then(_authp_renderAdmin);
}

function _authp_quitarUsuario(email) {
  if (email === authp_email()) return; // no quitarse a uno mismo
  firebase.firestore().collection(_AUTHP_COL_USUARIOS).doc(email).delete().then(_authp_renderAdmin);
}

function _authp_toggleActivo(email, nuevoEstado) {
  firebase.firestore().collection(_AUTHP_COL_USUARIOS).doc(email)
    .update({ activo: !!nuevoEstado }).then(_authp_renderAdmin);
}

function _authp_toggleRol(email, nuevoRol) {
  firebase.firestore().collection(_AUTHP_COL_USUARIOS).doc(email)
    .update({ rol: nuevoRol }).then(_authp_renderAdmin);
}

// Recolecta los checkbox marcados de una obra y guarda su lista de responsables.
function _authp_guardarEditores(idObra) {
  const marcados = Array.prototype.slice.call(
    document.querySelectorAll('input[type=checkbox][data-obra="' + idObra + '"]:checked'));
  const emails = marcados.map(function (c) { return c.value; });
  if (typeof datos_setEditoresObra === 'function') datos_setEditoresObra(idObra, emails);
}

// ── Utilidades ─────────────────────────────────────────────────────────────────

function _authp_parseEmails(texto) {
  return String(texto || '')
    .split(/[\s,;]+/)
    .map(function (s) { return s.trim().toLowerCase(); })
    .filter(function (s) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s); });
}

function _authp_esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function _authp_setBoton(id, disabled, texto) {
  const b = document.getElementById(id);
  if (!b) return;
  b.disabled = !!disabled;
  if (texto) b.textContent = texto;
}

// Dos iniciales a partir del nombre (ej. "María Paz" → "MP"). Si no hay nombre,
// usa las dos primeras letras del correo.
function _authp_iniciales(nombre, email) {
  const n = String(nombre || '').trim();
  if (n) {
    const partes = n.split(/\s+/);
    if (partes.length >= 2) return (partes[0][0] + partes[1][0]).toUpperCase();
    return n.slice(0, 2).toUpperCase();
  }
  const e = String(email || '').trim();
  return e ? e.slice(0, 2).toUpperCase() : '—';
}

// Refleja el usuario actual en las tres barras de navegación y agrega
// las acciones "Administrar usuarios" y "Cerrar sesión".
function _authp_pintarBarraUsuario() {
  const email = authp_email();
  const nombre = (_authp_perfil && _authp_perfil.nombre) || '';
  const iniciales = _authp_iniciales(nombre, email);
  ['navbar-usuario-inicio', 'navbar-usuario-config', 'navbar-usuario-proyecto'].forEach(function (id) {
    const b = document.getElementById(id);
    if (!b) return;
    b.textContent = iniciales;   // PILOTO: solo iniciales, no el correo completo
    b.title = (nombre ? nombre + ' · ' : '') + email + (authp_esAdmin() ? ' · administrador' : '');
    // Reemplazar el comportamiento (antes: cambiar nombre libre) por un menú simple.
    b.onclick = function (e) {
      e.stopPropagation();
      _authp_menuUsuario(b);
    };
  });
}

function _authp_menuUsuario(anchor) {
  let m = document.getElementById('authp-menu-usuario');
  if (m) { m.remove(); return; }
  m = document.createElement('div');
  m.id = 'authp-menu-usuario';
  m.className = 'authp-menu';
  let html = '';
  if (authp_esAdmin()) html += '<button onclick="authp_abrirAdmin();document.getElementById(\'authp-menu-usuario\').remove()">Administrar usuarios</button>';
  html += '<button onclick="authp_logout()">Cerrar sesión</button>';
  m.innerHTML = html;
  document.body.appendChild(m);
  const r = anchor.getBoundingClientRect();
  m.style.top = (r.bottom + 6) + 'px';
  m.style.right = Math.max(8, (window.innerWidth - r.right)) + 'px';
  setTimeout(function () {
    document.addEventListener('click', function cerrar(ev) {
      if (m && !m.contains(ev.target) && ev.target !== anchor) { m.remove(); document.removeEventListener('click', cerrar); }
    });
  }, 0);
}

// ── Pantallas (overlay a pantalla completa) ─────────────────────────────────────

function _authp_overlay() {
  let ov = document.getElementById('authp-overlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'authp-overlay';
    ov.className = 'authp-overlay';
    document.body.appendChild(ov);
  }
  return ov;
}

function _authp_ocultarOverlay() {
  const ov = document.getElementById('authp-overlay');
  if (ov) ov.style.display = 'none';
}

function _authp_mostrarPantalla(tipo, opts) {
  opts = opts || {};
  const ov = _authp_overlay();
  ov.style.display = 'flex';

  let cuerpo = '';
  if (tipo === 'cargando') {
    cuerpo = '<div class="authp-card"><div class="authp-spin"></div><p>Verificando acceso…</p></div>';
  } else if (tipo === 'login') {
    cuerpo = '<div class="authp-card">' +
      '<img src="icons/logo_navbar.png" alt="RVC" class="authp-logo" onerror="this.style.display=\'none\'">' +
      '<h2>Control de Avances</h2>' +
      '<p class="authp-sub">Piloto · acceso restringido</p>' +
      (opts.error ? '<div class="authp-error">' + _authp_esc(opts.error) + '</div>' : '') +
      '<button class="authp-btn authp-btn-google" onclick="authp_login()">Entrar con Google</button>' +
      '</div>';
  } else if (tipo === 'setup') {
    cuerpo = '<div class="authp-card authp-card-wide">' +
      '<h2>Configuración inicial</h2>' +
      '<p class="authp-sub">Aún no hay administradores. Escribe los correos que serán <strong>administradores</strong> (uno por línea o separados por coma). Podrás agregar más usuarios después desde el panel.</p>' +
      '<textarea id="authp-setup-emails" class="authp-textarea" placeholder="correo1@gmail.com&#10;correo2@gmail.com"></textarea>' +
      '<div id="authp-setup-err" class="authp-error-txt"></div>' +
      '<button id="authp-setup-btn" class="authp-btn authp-btn-primary" onclick="_authp_guardarSetup()">Guardar y entrar</button>' +
      '<button class="authp-btn authp-btn-plano" onclick="authp_logout()">Cancelar / cambiar de cuenta</button>' +
      '</div>';
  } else if (tipo === 'denegado') {
    cuerpo = '<div class="authp-card">' +
      '<div class="authp-icon-deny">⛔</div>' +
      '<h2>Acceso denegado</h2>' +
      '<p class="authp-sub">' + _authp_esc(opts.msg || 'Tu cuenta no tiene acceso.') + '</p>' +
      (opts.reintentar ? '<button class="authp-btn authp-btn-primary" onclick="_authp_verificarAcceso()">Reintentar</button>' : '') +
      '<button class="authp-btn authp-btn-plano" onclick="authp_logout()">Cambiar de cuenta</button>' +
      '</div>';
  }
  ov.innerHTML = cuerpo;
}

// ── Estilos (inyectados para no tocar estilos.css) ──────────────────────────────

function _authp_inyectarEstilos() {
  if (document.getElementById('authp-css')) return;
  const st = document.createElement('style');
  st.id = 'authp-css';
  st.textContent = [
    '.authp-overlay{position:fixed;inset:0;z-index:99999;background:linear-gradient(135deg,#f7f7f8,#eceef1);display:flex;align-items:center;justify-content:center;font-family:inherit;padding:20px}',
    '.authp-card{background:#fff;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.15);padding:34px 30px;max-width:380px;width:100%;text-align:center}',
    '.authp-card-wide{max-width:460px;text-align:left}',
    '.authp-card h2{margin:6px 0 2px;font-size:22px;color:#1a1a1a}',
    '.authp-logo{height:44px;margin-bottom:8px}',
    '.authp-sub{color:#666;font-size:14px;margin:6px 0 18px;line-height:1.5}',
    '.authp-btn{display:block;width:100%;padding:12px 16px;border:0;border-radius:10px;font-size:15px;font-weight:600;cursor:pointer;margin-top:10px}',
    '.authp-btn-google{background:#CC2929;color:#fff}',
    '.authp-btn-google:hover{background:#b02222}',
    '.authp-btn-primary{background:#CC2929;color:#fff}',
    '.authp-btn-plano{background:transparent;color:#666;font-weight:500}',
    '.authp-textarea{width:100%;min-height:110px;border:1px solid #d5d7db;border-radius:10px;padding:10px 12px;font-size:14px;font-family:inherit;resize:vertical;box-sizing:border-box}',
    '.authp-error,.authp-error-txt{color:#b00020;font-size:13px;margin:8px 0}',
    '.authp-error{background:#fdecef;border-radius:8px;padding:9px 12px}',
    '.authp-icon-deny{font-size:38px}',
    '.authp-spin{width:34px;height:34px;border:3px solid #e3e3e3;border-top-color:#CC2929;border-radius:50%;margin:0 auto 14px;animation:authpspin .8s linear infinite}',
    '@keyframes authpspin{to{transform:rotate(360deg)}}',
    // Panel admin
    '.authp-admin-overlay{position:fixed;inset:0;z-index:99998;background:rgba(20,20,25,.45);display:none;align-items:center;justify-content:center;padding:20px}',
    '.authp-admin-box{background:#fff;border-radius:16px;max-width:640px;width:100%;max-height:86vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 16px 50px rgba(0,0,0,.28)}',
    '.authp-admin-head{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid #eee}',
    '.authp-admin-head h2{margin:0;font-size:18px}',
    '.authp-admin-body{padding:18px 20px;overflow:auto}',
    '.authp-h3{font-size:14px;text-transform:uppercase;letter-spacing:.04em;color:#888;margin:0 0 10px}',
    '.authp-nota{font-size:13px;color:#777;margin:-4px 0 12px}',
    '.authp-tabbar{display:flex;gap:6px;margin-bottom:16px;border-bottom:1px solid #eee}',
    '.authp-tab{border:0;background:transparent;padding:9px 14px;font-size:14px;font-weight:600;color:#888;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px}',
    '.authp-tab.activa{color:#CC2929;border-bottom-color:#CC2929}',
    '.authp-fila-obra{padding:12px;border-bottom:1px solid #f0f0f0}',
    '.authp-fila-obra:last-child{border-bottom:0}',
    '.authp-obra-nombre{font-weight:600;font-size:14px;margin-bottom:8px}',
    '.authp-chk-lista{display:flex;flex-wrap:wrap;gap:8px 16px}',
    '.authp-chk{display:flex;align-items:center;gap:6px;font-size:13px;color:#333;cursor:pointer}',
    '.authp-chk input{width:16px;height:16px}',
    '.authp-add-row{display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap}',
    '.authp-input{flex:1;min-width:140px;padding:9px 11px;border:1px solid #d5d7db;border-radius:8px;font-size:14px;font-family:inherit;box-sizing:border-box}',
    '.authp-tabla{border:1px solid #eee;border-radius:10px;overflow:hidden}',
    '.authp-fila{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;border-bottom:1px solid #f0f0f0;flex-wrap:wrap}',
    '.authp-fila:last-child{border-bottom:0}',
    '.authp-fila-email{font-size:14px;color:#222;word-break:break-all}',
    '.authp-fila-acc{display:flex;gap:6px;align-items:center;flex-wrap:wrap}',
    '.authp-badge{background:#CC2929;color:#fff;font-size:10px;padding:1px 7px;border-radius:9px;vertical-align:middle}',
    '.authp-mini{border:1px solid #d5d7db;background:#fafafa;border-radius:7px;padding:5px 9px;font-size:12px;cursor:pointer}',
    '.authp-mini:hover{background:#f0f0f0}',
    '.authp-mini-peligro{color:#b00020;border-color:#f0c9cf}',
    '.authp-vacio{padding:14px;color:#999;font-size:13px;text-align:center}',
    '.authp-btn-cerrar{border:0;background:transparent;font-size:22px;cursor:pointer;color:#888;line-height:1}',
    '.authp-menu{position:fixed;z-index:100000;background:#fff;border:1px solid #e3e3e3;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.16);overflow:hidden;min-width:190px}',
    '.authp-menu button{display:block;width:100%;text-align:left;border:0;background:#fff;padding:11px 15px;font-size:14px;cursor:pointer;font-family:inherit}',
    '.authp-menu button:hover{background:#f5f5f5}',
    // Banner de solo lectura
    '.authp-readonly-banner{background:#fff4e5;color:#8a5a00;border:1px solid #ffd699;border-radius:8px;padding:8px 14px;font-size:13px;margin:10px 14px;text-align:center}'
  ].join('\n');
  document.head.appendChild(st);

  // Crear el overlay del panel admin (vacío; se llena al abrir).
  if (!document.getElementById('authp-admin-overlay')) {
    const ov = document.createElement('div');
    ov.id = 'authp-admin-overlay';
    ov.className = 'authp-admin-overlay';
    ov.innerHTML =
      '<div class="authp-admin-box">' +
        '<div class="authp-admin-head"><h2>Administración</h2>' +
        '<button class="authp-btn-cerrar" onclick="authp_cerrarAdmin()">✕</button></div>' +
        '<div class="authp-admin-body" id="authp-admin-body"></div>' +
      '</div>';
    document.body.appendChild(ov);
  }
}
