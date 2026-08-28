// Router centralizado — ningún módulo cambia vistas directamente.

let _vistaActual = null;
let _proyectoActivo = null;
let _tabActiva = null;

const VISTAS = ['v-inicio', 'v-config', 'v-proyecto'];
const TABS   = ['tab-graficos', 'tab-consolidado-og', 'tab-piso-og', 'tab-term', 'tab-consolidado-term', 'tab-fotografico'];

function router_ir(vista, opciones = {}) {
  // Si salimos de v-proyecto, verificar si hay avances pendientes de guardar
  if (_vistaActual === 'v-proyecto' && vista !== 'v-proyecto') {
    if (_proyectoActivo && typeof datos_hayPendiente === 'function' && datos_hayPendiente(_proyectoActivo)) {
      interfaz_mostrarModal(
        'Avances sin guardar',
        '¿Salir sin guardar los avances?',
        () => {
          // Descartar cambios locales: restaurar último estado guardado oficialmente
          if (typeof datos_descartarPendiente === 'function') datos_descartarPendiente(_proyectoActivo);
          window._coa_guardadoPendiente = false;
          _router_navegar(vista, opciones);
        },
        () => {
          // Usuario canceló: re-empujar entrada para que el botón atrás siga funcionando
          history.pushState({ coa: 'v-proyecto' }, '');
        }
      );
      return;
    }
  }

  _router_navegar(vista, opciones);
}

function _router_navegar(vista, opciones = {}) {
  VISTAS.forEach(v => {
    const el = document.getElementById(v);
    if (el) el.style.display = 'none';
  });

  const destino = document.getElementById(vista);
  if (!destino) return;
  destino.style.display = 'flex';
  _vistaActual = vista;

  // Gestión de historial para botón atrás de Android:
  // Solo se agrega entrada al entrar a una sub-vista (proyecto, config).
  // Al volver al inicio, la entrada ya fue consumida por el back del usuario
  // (si usó el back físico) o queda en el stack (si usó "← Inicio").
  if (vista === 'v-proyecto' || vista === 'v-config') {
    history.pushState({ coa: vista }, '');
  }

  if (vista === 'v-proyecto') {
    const id = opciones.idProyecto || _proyectoActivo;
    if (!id) { router_ir('v-inicio'); return; }
    const cambiandoProyecto = id !== _proyectoActivo;
    _proyectoActivo = id;
    proyectos_actualizarHeader(id);
    semanaCtrl_renderBarra(id);
    router_mostrarTab(opciones.tab || (cambiandoProyecto ? 'tab-term' : _tabActiva) || 'tab-term');
  }

  if (vista === 'v-config') {
    if (opciones.esEdicion && opciones.idProyecto) {
      configProyecto_iniciarEdicion(opciones.idProyecto);
    } else {
      configProyecto_iniciarNuevo();
    }
  }

  if (vista === 'v-inicio') {
    proyectos_renderizarGrilla();
  }
}

function router_mostrarTab(tab) {
  TABS.forEach(t => {
    const panel = document.getElementById('panel-' + t);
    const btn   = document.querySelector(`[data-tab="${t}"]`);
    if (panel) panel.style.display = 'none';
    if (btn)   btn.classList.remove('activo');
  });

  // Submenú de "Registro avance" absorbido en la barra lateral: se oculta y
  // vacía por defecto en cada cambio de pestaña. Si la pestaña destino es
  // tab-term, terminaciones_inicializar() (más abajo) lo vuelve a mostrar y
  // llenar — pero solo en escritorio (en móvil no aplica).
  const regSubmenu = document.getElementById('proy-nav-reg-submenu');
  if (regSubmenu) { regSubmenu.style.display = 'none'; regSubmenu.innerHTML = ''; }

  const panel = document.getElementById('panel-' + tab);
  const btn   = document.querySelector(`[data-tab="${tab}"]`);
  // Vacío (no 'block'): deja que el CSS decida el display de cada panel — clave
  // para #panel-tab-term, que en escritorio necesita flex (fila) vía una regla
  // '!important' que de otro modo pisaría un 'block' puesto aquí y quedaría
  // visible incluso al "ocultarlo" (bug reportado: menú+tabla de Terminaciones
  // se veían detrás de Gráficos). El 'none' al ocultar sí gana siempre porque
  // no tiene ninguna regla '!important' en contra.
  if (panel) panel.style.display = '';
  if (btn)   btn.classList.add('activo');
  _tabActiva = tab;

  const id = _proyectoActivo;
  if (!id) return;

  switch (tab) {
    case 'tab-term':             terminaciones_inicializar(id); break;
    case 'tab-consolidado-term': if (typeof consolidadoTerm_inicializar === 'function') consolidadoTerm_inicializar(id); break;
    case 'tab-graficos':         if (typeof graficos_inicializar === 'function') graficos_inicializar(id); break;
    case 'tab-consolidado-og':   if (typeof ogCons_inicializar === 'function') ogCons_inicializar(id); break;
    case 'tab-piso-og':          if (typeof pisoOG_inicializar === 'function') pisoOG_inicializar(id); break;
    // tab-fotografico: sin inicializador — su panel es un aviso estático
    // "próximamente" (ver index.html), queda para una próxima etapa.
  }
}

function router_getProyectoActivo() { return _proyectoActivo; }
function router_getVistaActual()    { return _vistaActual; }
function router_getTabActiva()      { return _tabActiva; }
