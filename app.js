// ==============================================================================
// CONTROL DE ACCESOS - ZONA FRANCA SANTAFESINA (ZFA)
// Lógica de interfaz, gestión de nómina, control de registros y enlace con Supabase
// ==============================================================================

// Función auxiliar para obtener UUID válido
function getUUID() {
    if (window.generateUUID) return window.generateUUID();
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

function checkUUID(str) {
    if (window.isValidUUID) return window.isValidUUID(str);
    if (!str || typeof str !== 'string') return false;
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str.trim());
}

// Estado en memoria y caché local
let nomina = JSON.parse(localStorage.getItem('zfa_nomina')) || [];
let registros = JSON.parse(localStorage.getItem('zfa_registros')) || [];

// Migración y normalización de IDs en localStorage a UUID estándar
let idsMigrated = false;
nomina.forEach(p => {
    if (!p.id || !checkUUID(p.id)) {
        const oldId = p.id;
        p.id = getUUID();
        registros.forEach(r => {
            if (r.persona_id === oldId) r.persona_id = p.id;
        });
        idsMigrated = true;
    }
});
registros.forEach(r => {
    if (!r.id || !checkUUID(r.id)) {
        r.id = getUUID();
        idsMigrated = true;
    }
    if (r.persona_id && !checkUUID(r.persona_id)) {
        r.persona_id = null;
        idsMigrated = true;
    }
});
if (idsMigrated) {
    localStorage.setItem('zfa_nomina', JSON.stringify(nomina));
    localStorage.setItem('zfa_registros', JSON.stringify(registros));
}

// Elementos DOM de Navegación
const navBtns = document.querySelectorAll('.nav-btn');
const tabPanes = document.querySelectorAll('.tab-pane');

// Elementos DOM de Cabecera y Turno
const fechaInput = document.getElementById('fecha-input');
const porteroInput = document.getElementById('portero-input');
const turnoInput = document.getElementById('turno-input');

// Elementos DOM del Formulario de Movimientos (Ingreso/Egreso)
const searchPersona = document.getElementById('search-persona');
const autocompleteResults = document.getElementById('autocomplete-results');
const regDni = document.getElementById('reg-dni');
const regEmpresa = document.getElementById('reg-empresa');
const regDominio = document.getElementById('reg-dominio');
const regObservaciones = document.getElementById('reg-observaciones');
const btnIngreso = document.getElementById('btn-ingreso');
const btnEgreso = document.getElementById('btn-egreso');
const btnCancelReg = document.getElementById('btn-cancel-reg');
const newPersonBadge = document.getElementById('new-person-badge');
const quickAddHelp = document.getElementById('quick-add-help');

// Elementos DOM del Estado de Base de Datos y Modal
const dbStatusDot = document.getElementById('db-status-dot');
const dbStatusText = document.getElementById('db-status-text');
const btnOpenDbConfig = document.getElementById('btn-open-db-config');
const dbModal = document.getElementById('db-modal');
const btnCloseDbModal = document.getElementById('btn-close-db-modal');
const cfgSupabaseUrl = document.getElementById('cfg-supabase-url');
const cfgSupabaseKey = document.getElementById('cfg-supabase-key');
const btnTestDb = document.getElementById('btn-test-db');
const btnSaveDbConfig = document.getElementById('btn-save-db-config');
const btnSyncToCloud = document.getElementById('btn-sync-to-cloud');
const btnQuickSync = document.getElementById('btn-quick-sync');
const dbAlert = document.getElementById('db-alert');
const btnToggleSql = document.getElementById('btn-toggle-sql');
const sqlScriptContainer = document.getElementById('sql-script-container');
const sqlTextSnippet = document.getElementById('sql-text-snippet');
const btnCopySql = document.getElementById('btn-copy-sql');

let selectedPersona = null;
let isNewPersonaMode = false;
let isCloudOnline = false;

// Snippet SQL para mostrar en el modal y copiar fácilmente
const SQL_PERMISSIONS_SNIPPET = `-- Ejecuta este script en Supabase SQL Editor para habilitar permisos totales:
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.nomina TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.registros TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;

ALTER TABLE public.nomina ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registros ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Acceso total a nomina" ON public.nomina;
CREATE POLICY "Acceso total a nomina" ON public.nomina FOR ALL TO public USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Acceso total a registros" ON public.registros;
CREATE POLICY "Acceso total a registros" ON public.registros FOR ALL TO public USING (true) WITH CHECK (true);`;

// ==============================================================================
// SISTEMA DE NOTIFICACIONES FLOTANTES (TOAST)
// ==============================================================================
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
        setTimeout(() => toast.remove(), 300);
    }, 4500);
}

// ==============================================================================
// INICIALIZACIÓN
// ==============================================================================
document.addEventListener('DOMContentLoaded', async () => {
    // Fecha por defecto: hoy
    const today = new Date().toISOString().split('T')[0];
    fechaInput.value = today;

    // Cargar valores por defecto
    if (localStorage.getItem('zfa_portero')) {
        porteroInput.value = localStorage.getItem('zfa_portero');
    }
    if (localStorage.getItem('zfa_turno')) {
        turnoInput.value = localStorage.getItem('zfa_turno');
    }

    // Configurar snippet SQL
    if (sqlTextSnippet) {
        sqlTextSnippet.value = SQL_PERMISSIONS_SNIPPET;
    }

    // Renderizar datos iniciales desde caché
    renderNomina();
    renderRegistros();

    // Inicializar conexión con Supabase
    await setupDatabaseConnection();
});

// Guardar configuración local al cambiar
porteroInput.addEventListener('change', (e) => localStorage.setItem('zfa_portero', e.target.value));
turnoInput.addEventListener('change', async (e) => {
    localStorage.setItem('zfa_turno', e.target.value);
    await reloadRegistros();
    clearRecordForm();
});
fechaInput.addEventListener('change', async () => {
    await reloadRegistros();
    clearRecordForm();
});

// Navegación entre pestañas
navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        const targetId = btn.getAttribute('data-target');
        navBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        tabPanes.forEach(pane => {
            if (pane.id === targetId) {
                pane.classList.add('active');
            } else {
                pane.classList.remove('active');
            }
        });
    });
});

// ==============================================================================
// GESTIÓN DE CONEXIÓN CON SUPABASE
// ==============================================================================
async function setupDatabaseConnection() {
    if (!DB.isConfigured()) {
        updateDbStatusUI('offline', 'Modo Local');
        return;
    }

    updateDbStatusUI('connecting', 'Conectando...');
    const test = await DB.testConnection();

    if (test.success) {
        isCloudOnline = true;
        updateDbStatusUI('online', 'Supabase Conectado');
        
        // Cargar datos frescos de la nube
        await reloadNominaFromCloud();
        await reloadRegistros();

        // Iniciar suscripción en tiempo real
        DB.subscribeToRealtime(
            // Al cambiar registros en Supabase
            (payload) => handleRealtimeRegistrosChange(payload),
            // Al cambiar nómina en Supabase
            (payload) => handleRealtimeNominaChange(payload)
        );
    } else {
        isCloudOnline = false;
        updateDbStatusUI('error', 'Error Conexión');
        console.warn("No se pudo conectar o faltan permisos en Supabase:", test.message);
        if (test.isPermissionError) {
            showToast("⚠️ Faltan permisos en Supabase. Haz clic en Configurar -> Ver Script SQL", "warning");
        }
    }
}

function updateDbStatusUI(state, text) {
    if (!dbStatusDot || !dbStatusText) return;
    
    dbStatusDot.className = 'db-dot';
    if (state === 'online') {
        dbStatusDot.classList.add('online');
    } else if (state === 'error') {
        dbStatusDot.classList.add('error');
    }
    dbStatusText.textContent = text;
}

async function reloadNominaFromCloud() {
    if (!isCloudOnline) return;
    try {
        const cloudNomina = await DB.getNomina();
        if (cloudNomina && Array.isArray(cloudNomina)) {
            // Combinar nómina de la nube con local para no perder nuevos ingresos locales no sincronizados
            const cloudMap = new Map(cloudNomina.map(p => [p.id, p]));
            const merged = [...cloudNomina];
            nomina.forEach(localP => {
                if (!cloudMap.has(localP.id)) {
                    merged.push(localP);
                }
            });
            nomina = merged;
            saveNominaLocal();
            renderNomina();
        }
    } catch (err) {
        console.error("Error al refrescar nómina de la nube:", err);
    }
}

async function reloadRegistros() {
    const fechaIso = fechaInput.value;
    const turno = turnoInput.value;

    if (isCloudOnline) {
        try {
            const cloudRegs = await DB.getRegistros(fechaIso, turno);
            if (cloudRegs && Array.isArray(cloudRegs)) {
                // Reemplazar registros correspondientes a esa fecha y turno
                registros = registros.filter(r => !(r.fecha_iso === fechaIso && r.turno === turno));
                registros.push(...cloudRegs);
                saveRegistrosLocal();
            }
        } catch (err) {
            console.error("Error al obtener registros de la nube:", err);
        }
    }
    renderRegistros();
}

function handleRealtimeRegistrosChange(payload) {
    const { eventType, new: newRec, old: oldRec } = payload;
    const currentFecha = fechaInput.value;
    const currentTurno = turnoInput.value;

    if (eventType === 'INSERT') {
        const exists = registros.some(r => r.id === newRec.id);
        if (!exists) {
            registros.push(newRec);
            saveRegistrosLocal();
            if (newRec.fecha_iso === currentFecha && newRec.turno === currentTurno) {
                renderRegistros();
            }
        }
    } else if (eventType === 'UPDATE') {
        const idx = registros.findIndex(r => r.id === newRec.id);
        if (idx > -1) {
            registros[idx] = newRec;
        } else {
            registros.push(newRec);
        }
        saveRegistrosLocal();
        if (newRec.fecha_iso === currentFecha && newRec.turno === currentTurno) {
            renderRegistros();
        }
    } else if (eventType === 'DELETE') {
        registros = registros.filter(r => r.id !== oldRec.id);
        saveRegistrosLocal();
        renderRegistros();
    }
}

function handleRealtimeNominaChange(payload) {
    const { eventType, new: newPersona, old: oldPersona } = payload;

    if (eventType === 'INSERT') {
        if (!nomina.some(p => p.id === newPersona.id)) {
            nomina.push(newPersona);
            saveNominaLocal();
            renderNomina();
        }
    } else if (eventType === 'UPDATE') {
        const idx = nomina.findIndex(p => p.id === newPersona.id);
        if (idx > -1) {
            nomina[idx] = newPersona;
        } else {
            nomina.push(newPersona);
        }
        saveNominaLocal();
        renderNomina();
    } else if (eventType === 'DELETE') {
        nomina = nomina.filter(p => p.id !== oldPersona.id);
        saveNominaLocal();
        renderNomina();
    }
}

// ==============================================================================
// MODAL DE CONFIGURACIÓN DE BASE DE DATOS
// ==============================================================================
btnOpenDbConfig.addEventListener('click', () => {
    const creds = DB.getCredentials();
    cfgSupabaseUrl.value = creds.url;
    cfgSupabaseKey.value = creds.anonKey;
    dbAlert.className = 'db-alert hidden';
    dbAlert.textContent = '';
    dbModal.classList.remove('hidden');
});

btnCloseDbModal.addEventListener('click', () => {
    dbModal.classList.add('hidden');
});

dbModal.addEventListener('click', (e) => {
    if (e.target === dbModal) dbModal.classList.add('hidden');
});

btnTestDb.addEventListener('click', async () => {
    const url = cfgSupabaseUrl.value.trim();
    const key = cfgSupabaseKey.value.trim();

    if (!url || !key) {
        showDbAlert('Por favor ingrese tanto la URL como la Anon Key.', 'error');
        return;
    }

    btnTestDb.disabled = true;
    btnTestDb.textContent = 'Probando permisos...';
    
    // Probar temporalmente
    DB.saveCredentials(url, key);
    const test = await DB.testConnection();

    btnTestDb.disabled = false;
    btnTestDb.textContent = 'Probar Conexión y Permisos';

    if (test.success) {
        showDbAlert('✓ ' + test.message, 'success');
    } else {
        showDbAlert((test.isPermissionError ? '⚠️ ' : '✕ ') + test.message, 'error');
        if (test.isPermissionError && sqlScriptContainer) {
            sqlScriptContainer.classList.remove('hidden');
            if (btnToggleSql) btnToggleSql.textContent = 'Ocultar Script SQL';
        }
    }
});

btnSaveDbConfig.addEventListener('click', async () => {
    const url = cfgSupabaseUrl.value.trim();
    const key = cfgSupabaseKey.value.trim();

    DB.saveCredentials(url, key);
    dbModal.classList.add('hidden');
    await setupDatabaseConnection();
});

function showDbAlert(message, type) {
    dbAlert.className = `db-alert ${type}`;
    dbAlert.textContent = message;
    dbAlert.classList.remove('hidden');
}

// Alternar visualización del script SQL de permisos
if (btnToggleSql && sqlScriptContainer) {
    btnToggleSql.addEventListener('click', () => {
        sqlScriptContainer.classList.toggle('hidden');
        btnToggleSql.textContent = sqlScriptContainer.classList.contains('hidden') ? 'Ver Script SQL' : 'Ocultar Script SQL';
    });
}

// Botón para copiar SQL al portapapeles
if (btnCopySql && sqlTextSnippet) {
    btnCopySql.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(sqlTextSnippet.value);
            btnCopySql.textContent = '✓ ¡Copiado al Portapapeles!';
            setTimeout(() => {
                btnCopySql.textContent = '📋 Copiar SQL al Portapapeles';
            }, 2500);
        } catch (err) {
            sqlTextSnippet.select();
            document.execCommand('copy');
            btnCopySql.textContent = '✓ ¡Copiado!';
            setTimeout(() => {
                btnCopySql.textContent = '📋 Copiar SQL al Portapapeles';
            }, 2500);
        }
    });
}

// Sincronizar nómina local hacia Supabase
async function syncLocalNominaToCloud() {
    if (!DB.isConfigured()) {
        alert("Primero configura y guarda la URL y Anon Key de Supabase.");
        return;
    }

    if (nomina.length === 0) {
        alert("No hay personas en la nómina local para sincronizar.");
        return;
    }

    const confirmSync = confirm(`¿Deseas subir ${nomina.length} personas a la base de datos Supabase?`);
    if (!confirmSync) return;

    try {
        const btn = btnSyncToCloud || btnQuickSync;
        if (btn) btn.disabled = true;

        showDbAlert(`Subiendo ${nomina.length} personas a Supabase...`, 'info');
        
        await DB.importNominaBatch(nomina, (processed, total) => {
            showDbAlert(`Sincronizando: ${processed} de ${total} registros...`, 'info');
        });

        showDbAlert(`✓ ¡Éxito! Se sincronizaron ${nomina.length} personas en Supabase.`, 'success');
        showToast(`✓ Se sincronizaron ${nomina.length} personas en Supabase`, 'success');
        isCloudOnline = true;
        updateDbStatusUI('online', 'Supabase Conectado');
        await reloadNominaFromCloud();
    } catch (err) {
        showDbAlert(`Error al sincronizar: ${err.message}. Verifica los permisos SQL en Supabase.`, 'error');
        showToast(`Error al sincronizar: ${err.message}`, 'error');
    } finally {
        if (btnSyncToCloud) btnSyncToCloud.disabled = false;
        if (btnQuickSync) btnQuickSync.disabled = false;
    }
}

btnSyncToCloud.addEventListener('click', syncLocalNominaToCloud);
if (btnQuickSync) btnQuickSync.addEventListener('click', syncLocalNominaToCloud);

// ==============================================================================
// GESTIÓN DE NÓMINA
// ==============================================================================
const nominaForm = document.getElementById('nomina-form');
const nomId = document.getElementById('nom-id');
const nomNombre = document.getElementById('nom-nombre');
const nomDni = document.getElementById('nom-dni');
const nomEmpresa = document.getElementById('nom-empresa');
const nomDominio = document.getElementById('nom-dominio');
const filterNomina = document.getElementById('filter-nomina');
const btnCancelNom = document.getElementById('btn-cancel-nom');
const btnSaveNom = document.getElementById('btn-save-nom');

nominaForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const isEditing = nomId.value !== '';
    
    const person = {
        id: (isEditing && checkUUID(nomId.value)) ? nomId.value : getUUID(),
        nombre: nomNombre.value.toUpperCase().trim(),
        dni: nomDni.value.toUpperCase().trim(),
        empresa: nomEmpresa.value.toUpperCase().trim(),
        dominio: nomDominio.value.toUpperCase().trim()
    };

    if (isEditing) {
        const index = nomina.findIndex(p => p.id === person.id);
        if (index > -1) nomina[index] = person;
    } else {
        nomina.push(person);
    }

    saveNominaLocal();
    renderNomina();
    resetNominaForm();

    // Guardar en Supabase si está disponible
    if (isCloudOnline) {
        try {
            await DB.savePersona(person);
            showToast(`✓ "${person.nombre}" guardado y sincronizado en Supabase`, 'success');
        } catch (err) {
            console.error("Error al persistir persona en Supabase:", err);
            showToast(`⚠️ Guardado local, pero falló en Supabase: ${err.message}`, 'error');
            alert(`⚠️ Se guardó en la nómina local, pero la base de datos Supabase rechazó la operación:\n\n${err.message}\n\nSi es un error de permisos (RLS / 42501), ve a Configurar -> Ver Script SQL y ejecútalo en Supabase.`);
        }
    } else {
        showToast(`✓ "${person.nombre}" guardado en nómina local`, 'info');
    }
});

btnCancelNom.addEventListener('click', resetNominaForm);

function resetNominaForm() {
    nominaForm.reset();
    nomId.value = '';
    btnCancelNom.classList.add('hidden');
    btnSaveNom.textContent = 'Guardar en Nómina';
}

filterNomina.addEventListener('input', renderNomina);

function saveNominaLocal() {
    localStorage.setItem('zfa_nomina', JSON.stringify(nomina));
}

function renderNomina() {
    const tbody = document.querySelector('#nomina-table tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    const filter = filterNomina.value.toLowerCase();

    const filtered = nomina.filter(p => 
        (p.nombre || '').toLowerCase().includes(filter) || 
        (p.dni || '').toLowerCase().includes(filter) || 
        (p.empresa || '').toLowerCase().includes(filter)
    );

    // Orden alfabético por nombre
    filtered.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));

    filtered.forEach(p => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${p.nombre || '-'}</strong></td>
            <td>${p.dni || '-'}</td>
            <td>${p.empresa || '-'}</td>
            <td>${p.dominio || '-'}</td>
            <td>
                <button class="btn btn-outline action-btn" onclick="editPersona('${p.id}')">Editar</button>
                <button class="btn btn-danger action-btn" onclick="deletePersona('${p.id}')">Borrar</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

window.editPersona = (id) => {
    const p = nomina.find(x => x.id === id);
    if (!p) return;
    nomId.value = p.id;
    nomNombre.value = p.nombre || '';
    nomDni.value = p.dni || '';
    nomEmpresa.value = p.empresa || '';
    nomDominio.value = p.dominio || '';
    
    btnCancelNom.classList.remove('hidden');
    btnSaveNom.textContent = 'Actualizar Persona';
    
    document.querySelector('.form-card').scrollIntoView({ behavior: 'smooth' });
    nomNombre.focus();
};

window.deletePersona = async (id) => {
    if (confirm('¿Está seguro de eliminar esta persona de la nómina? Esto no borrará sus registros pasados.')) {
        nomina = nomina.filter(x => x.id !== id);
        saveNominaLocal();
        renderNomina();

        if (isCloudOnline) {
            try {
                await DB.deletePersona(id);
                showToast("✓ Persona eliminada de Supabase", "info");
            } catch (err) {
                console.error("Error al borrar en Supabase:", err);
                showToast("⚠️ Eliminado localmente pero falló en Supabase: " + err.message, "error");
            }
        }
    }
};

// ==============================================================================
// GESTIÓN DE REGISTROS (CONTROL DE ACCESOS)
// ==============================================================================

// Autocompletado de búsqueda
searchPersona.addEventListener('input', (e) => {
    const val = e.target.value.toLowerCase().trim();
    autocompleteResults.innerHTML = '';
    
    if (val.length < 2) {
        autocompleteResults.classList.add('hidden');
        if (val.length === 0) clearRecordForm();
        return;
    }

    const matches = nomina.filter(p => 
        (p.nombre || '').toLowerCase().includes(val) || 
        (p.dni || '').toLowerCase().includes(val)
    );
    
    if (matches.length > 0) {
        matches.slice(0, 15).forEach(p => {
            const div = document.createElement('div');
            div.className = 'autocomplete-item';
            div.innerHTML = `<strong>${p.nombre}</strong> <br><small>${p.empresa} - DNI: ${p.dni}</small>`;
            div.addEventListener('click', () => {
                selectPersona(p);
            });
            autocompleteResults.appendChild(div);
        });

        // Opción al final para ingresar como nueva persona no listada
        const newDiv = document.createElement('div');
        newDiv.className = 'autocomplete-item';
        newDiv.style.backgroundColor = '#f0f9ff';
        newDiv.style.color = '#0284c7';
        newDiv.innerHTML = `<strong>+ ¿Persona no listada?</strong> <small>Clic aquí para registrar a <strong>"${e.target.value.toUpperCase()}"</strong> como Nuevo Ingreso</small>`;
        newDiv.addEventListener('click', () => {
            enableNewPersonaMode(e.target.value.toUpperCase());
        });
        autocompleteResults.appendChild(newDiv);

        autocompleteResults.classList.remove('hidden');
    } else {
        const div = document.createElement('div');
        div.className = 'autocomplete-item';
        div.style.backgroundColor = '#f0f9ff';
        div.style.color = '#0284c7';
        div.innerHTML = `<strong>+ Persona no encontrada en Nómina</strong><br><small>Clic aquí para registrar a <strong>"${e.target.value.toUpperCase()}"</strong> como Nuevo Ingreso y agregarla a Nómina</small>`;
        div.addEventListener('click', () => {
            enableNewPersonaMode(e.target.value.toUpperCase());
        });
        autocompleteResults.appendChild(div);
        autocompleteResults.classList.remove('hidden');
    }
});

// Ocultar autocompletado al hacer clic afuera
document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-group')) {
        autocompleteResults.classList.add('hidden');
    }
});

function selectPersona(p) {
    isNewPersonaMode = false;
    selectedPersona = p;
    searchPersona.value = p.nombre;
    
    regDni.value = p.dni || '';
    regDni.setAttribute('readonly', 'true');
    regDni.setAttribute('tabindex', '-1');

    regEmpresa.value = p.empresa || '';
    regEmpresa.setAttribute('readonly', 'true');
    regEmpresa.setAttribute('tabindex', '-1');

    regDominio.value = p.dominio || '';
    regDominio.setAttribute('readonly', 'true');
    regDominio.setAttribute('tabindex', '-1');

    if (newPersonBadge) newPersonBadge.classList.add('hidden');
    if (quickAddHelp) quickAddHelp.classList.add('hidden');
    if (btnCancelReg) btnCancelReg.classList.remove('hidden');
    
    autocompleteResults.classList.add('hidden');
    
    const fechaFormat = getFormattedDateFromInput(fechaInput.value);
    const existingIndex = registros.findIndex(r => r.persona_id === p.id && r.fecha === fechaFormat && !r.egreso);
    
    btnIngreso.textContent = 'Marcar Ingreso';

    if (existingIndex > -1) {
        // Está dentro: Deshabilitar ingreso, habilitar egreso
        btnIngreso.disabled = true;
        btnEgreso.disabled = false;
        regObservaciones.value = registros[existingIndex].observaciones || '';
    } else {
        // Está afuera: Habilitar ingreso, deshabilitar egreso
        btnIngreso.disabled = false;
        btnEgreso.disabled = true;
        regObservaciones.value = '';
    }
}

function enableNewPersonaMode(nombre) {
    isNewPersonaMode = true;
    selectedPersona = null;
    autocompleteResults.classList.add('hidden');

    searchPersona.value = (nombre || searchPersona.value).toUpperCase().trim();

    // Habilitar campos para edición
    regDni.removeAttribute('readonly');
    regDni.removeAttribute('tabindex');
    regDni.placeholder = 'Ingresa DNI / Legajo...';

    regEmpresa.removeAttribute('readonly');
    regEmpresa.removeAttribute('tabindex');
    regEmpresa.placeholder = 'Ingresa Empresa...';

    regDominio.removeAttribute('readonly');
    regDominio.removeAttribute('tabindex');
    regDominio.placeholder = 'Patente (opcional)...';

    btnIngreso.disabled = false;
    btnIngreso.textContent = 'Marcar Ingreso y Guardar en Nómina';
    btnEgreso.disabled = true;

    if (newPersonBadge) newPersonBadge.classList.remove('hidden');
    if (quickAddHelp) quickAddHelp.classList.remove('hidden');
    if (btnCancelReg) btnCancelReg.classList.remove('hidden');

    regDni.focus();
}

function clearRecordForm() {
    selectedPersona = null;
    isNewPersonaMode = false;
    searchPersona.value = '';

    regDni.value = '';
    regDni.setAttribute('readonly', 'true');
    regDni.setAttribute('tabindex', '-1');
    regDni.placeholder = 'DNI...';

    regEmpresa.value = '';
    regEmpresa.setAttribute('readonly', 'true');
    regEmpresa.setAttribute('tabindex', '-1');
    regEmpresa.placeholder = 'Empresa...';

    regDominio.value = '';
    regDominio.setAttribute('readonly', 'true');
    regDominio.setAttribute('tabindex', '-1');
    regDominio.placeholder = 'Patente...';

    regObservaciones.value = '';
    btnIngreso.disabled = true;
    btnIngreso.textContent = 'Marcar Ingreso';
    btnEgreso.disabled = true;

    if (newPersonBadge) newPersonBadge.classList.add('hidden');
    if (quickAddHelp) quickAddHelp.classList.add('hidden');
    if (btnCancelReg) btnCancelReg.classList.add('hidden');
}

if (btnCancelReg) {
    btnCancelReg.addEventListener('click', clearRecordForm);
}

function getFormattedTime() {
    const now = new Date();
    return now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
}

function getFormattedDateFromInput(isoString) {
    if (!isoString) return '';
    const [year, month, day] = isoString.split('-');
    return `${day}/${month}/${year}`;
}

btnIngreso.addEventListener('click', () => addRecord('ingreso'));
btnEgreso.addEventListener('click', () => addRecord('egreso'));

async function addRecord(tipo) {
    if (!selectedPersona && !isNewPersonaMode) return;

    if (!porteroInput.value.trim()) {
        alert("Por favor, ingrese el nombre del Portero antes de registrar.");
        porteroInput.focus();
        return;
    }

    const fechaIso = fechaInput.value;
    const fechaFormat = getFormattedDateFromInput(fechaIso);

    // -------------------------------------------------------------
    // CASO 1: NUEVO INGRESO (Persona no registrada en nómina)
    // -------------------------------------------------------------
    if (isNewPersonaMode && tipo === 'ingreso') {
        const nombreVal = searchPersona.value.toUpperCase().trim();
        const dniVal = regDni.value.toUpperCase().trim() || 'S/D';
        const empresaVal = regEmpresa.value.toUpperCase().trim() || 'S/E';
        const dominioVal = regDominio.value.toUpperCase().trim();

        if (!nombreVal) {
            alert("Por favor ingrese el nombre y apellido.");
            searchPersona.focus();
            return;
        }

        // 1. Guardar nueva persona en la Nómina con UUID válido
        const newPersona = {
            id: getUUID(),
            nombre: nombreVal,
            dni: dniVal,
            empresa: empresaVal,
            dominio: dominioVal
        };

        nomina.push(newPersona);
        saveNominaLocal();
        renderNomina();

        if (isCloudOnline) {
            try {
                await DB.savePersona(newPersona);
                showToast(`✓ "${newPersona.nombre}" incorporado a Nómina en Supabase`, 'success');
            } catch (err) {
                console.error("Error al persistir persona nueva en Supabase:", err);
                showToast(`⚠️ Guardado en nómina local, pero falló en la nube: ${err.message}`, 'error');
            }
        }

        // 2. Registrar movimiento de ingreso
        const rec = {
            id: getUUID(),
            persona_id: newPersona.id,
            nombre: newPersona.nombre,
            dni: newPersona.dni,
            empresa: newPersona.empresa,
            dominio: newPersona.dominio,
            fecha: fechaFormat,
            ingreso: getFormattedTime(),
            egreso: '',
            observaciones: regObservaciones.value || '',
            portero: porteroInput.value.trim(),
            turno: turnoInput.value,
            fecha_iso: fechaIso 
        };

        registros.push(rec);
        saveRegistrosLocal();
        renderRegistros();

        if (isCloudOnline) {
            try {
                await DB.addRegistro(rec);
                showToast(`✓ Ingreso de "${rec.nombre}" registrado en Supabase`, 'success');
            } catch (err) {
                console.error("Error al insertar ingreso en Supabase:", err);
                showToast(`⚠️ Ingreso guardado localmente, pero falló en la nube: ${err.message}`, 'error');
            }
        } else {
            showToast(`✓ Ingreso registrado y persona agregada a la nómina local`, 'info');
        }

        clearRecordForm();
        searchPersona.focus();
        return;
    }

    // -------------------------------------------------------------
    // CASO 2: PERSONA EXISTENTE EN NÓMINA
    // -------------------------------------------------------------
    let existingRecordIndex = registros.findIndex(r => r.persona_id === selectedPersona.id && r.fecha === fechaFormat && !r.egreso);
    
    if (tipo === 'egreso' && existingRecordIndex > -1) {
        const targetRecord = registros[existingRecordIndex];
        const horaEgreso = getFormattedTime();
        targetRecord.egreso = horaEgreso;
        
        if (regObservaciones.value) {
            const currentObs = targetRecord.observaciones;
            if (currentObs && regObservaciones.value !== currentObs) {
                targetRecord.observaciones = currentObs + ' | ' + regObservaciones.value;
            } else if (!currentObs) {
                targetRecord.observaciones = regObservaciones.value;
            }
        }

        saveRegistrosLocal();
        renderRegistros();

        if (isCloudOnline) {
            try {
                await DB.updateRegistroEgreso(targetRecord.id, targetRecord.egreso, targetRecord.observaciones);
                showToast(`✓ Egreso de "${targetRecord.nombre}" actualizado en Supabase`, 'success');
            } catch (err) {
                console.error("Error al actualizar egreso en Supabase:", err);
                showToast(`⚠️ Egreso guardado localmente, pero falló en la nube: ${err.message}`, 'error');
            }
        } else {
            showToast(`✓ Egreso de "${targetRecord.nombre}" registrado localmente`, 'info');
        }
    } else if (tipo === 'ingreso') {
        const rec = {
            id: getUUID(),
            persona_id: (selectedPersona.id && checkUUID(selectedPersona.id)) ? selectedPersona.id : null,
            nombre: selectedPersona.nombre,
            dni: selectedPersona.dni || '',
            empresa: selectedPersona.empresa || '',
            dominio: selectedPersona.dominio || '',
            fecha: fechaFormat,
            ingreso: getFormattedTime(),
            egreso: '',
            observaciones: regObservaciones.value || '',
            portero: porteroInput.value.trim(),
            turno: turnoInput.value,
            fecha_iso: fechaIso 
        };
        
        registros.push(rec);
        saveRegistrosLocal();
        renderRegistros();

        if (isCloudOnline) {
            try {
                await DB.addRegistro(rec);
                showToast(`✓ Ingreso de "${rec.nombre}" registrado en Supabase`, 'success');
            } catch (err) {
                console.error("Error al insertar ingreso en Supabase:", err);
                showToast(`⚠️ Ingreso guardado localmente, pero falló en la nube: ${err.message}`, 'error');
            }
        } else {
            showToast(`✓ Ingreso de "${rec.nombre}" registrado localmente`, 'info');
        }
    }

    clearRecordForm();
    searchPersona.focus();
}

function saveRegistrosLocal() {
    localStorage.setItem('zfa_registros', JSON.stringify(registros));
}

function renderRegistros() {
    const tbody = document.querySelector('#registros-table tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    const fechaSeleccionada = fechaInput.value;
    const turnoSeleccionado = turnoInput.value;
    
    const filtrados = registros.filter(r => r.fecha_iso === fechaSeleccionada && r.turno === turnoSeleccionado);

    filtrados.forEach(r => {
        const tr = document.createElement('tr');
        
        // Resaltar fila si todavía no tiene Egreso registrado
        if (!r.egreso) tr.style.backgroundColor = 'rgba(255, 243, 205, 0.35)';

        tr.innerHTML = `
            <td><strong>${r.nombre}</strong></td>
            <td>${r.dni || '-'}</td>
            <td>${r.empresa || '-'}</td>
            <td>${r.dominio || '-'}</td>
            <td>${r.fecha}</td>
            <td style="font-weight:600; color:var(--success)">${r.ingreso}</td>
            <td style="font-weight:600; color:var(--danger)">${r.egreso || '-'}</td>
            <td>${r.observaciones || ''}</td>
            <td>
                ${!r.egreso ? `<button class="btn btn-outline action-btn" onclick="marcarEgresoAtrasado('${r.id}')" title="Marcar egreso ahora">Marcar Egreso</button>` : ''}
                <button class="btn btn-danger action-btn" onclick="deleteRegistro('${r.id}')" title="Borrar registro">X</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

window.marcarEgresoAtrasado = async (id) => {
    const index = registros.findIndex(r => r.id === id);
    if (index > -1) {
        const horaEgreso = getFormattedTime();
        registros[index].egreso = horaEgreso;
        saveRegistrosLocal();
        renderRegistros();

        if (isCloudOnline) {
            try {
                await DB.updateRegistroEgreso(id, horaEgreso, registros[index].observaciones);
                showToast("✓ Egreso actualizado en Supabase", "success");
            } catch (err) {
                console.error("Error al actualizar egreso en Supabase:", err);
                showToast("⚠️ Actualizado localmente pero falló en Supabase: " + err.message, "error");
            }
        }
    }
};

window.deleteRegistro = async (id) => {
    if (confirm('¿Borrar definitivamente este registro de ingreso/egreso?')) {
        registros = registros.filter(r => r.id !== id);
        saveRegistrosLocal();
        renderRegistros();

        if (isCloudOnline) {
            try {
                await DB.deleteRegistro(id);
                showToast("✓ Registro eliminado de Supabase", "info");
            } catch (err) {
                console.error("Error al eliminar registro en Supabase:", err);
                showToast("⚠️ Eliminado localmente pero falló en Supabase: " + err.message, "error");
            }
        }
    }
};

// ==============================================================================
// EXPORTACIÓN A EXCEL (XLSX)
// ==============================================================================
document.getElementById('btn-export').addEventListener('click', () => {
    const fechaSeleccionada = fechaInput.value;
    const turnoSeleccionado = turnoInput.value;
    const filtrados = registros.filter(r => r.fecha_iso === fechaSeleccionada && r.turno === turnoSeleccionado);
    
    if (filtrados.length === 0) {
        alert('No hay registros para exportar en este turno y fecha.');
        return;
    }

    const fechaFormat = getFormattedDateFromInput(fechaSeleccionada);
    
    const data = [];
    data.push(["PLANILLA CONTROL INGRESO Y EGRESO DE PERSONAS Y VEHICULOS A LA ZONA PRIMARIA ADUANERA"]);
    data.push([]);
    data.push(["Portero:", porteroInput.value || '', "Fecha:", fechaFormat, "Turno:", turnoSeleccionado]);
    data.push([]);
    data.push(["APELLIDO Y NOMBRE", "D.N.I./LEGAJO", "EMPRESA", "DOMINIO", "FECHA", "INGRESO", "EGRESO", "OBSERVACIONES"]);
    
    filtrados.forEach(r => {
        data.push([
            r.nombre,
            r.dni,
            r.empresa,
            r.dominio,
            r.fecha,
            r.ingreso,
            r.egreso,
            r.observaciones
        ]);
    });

    const ws = XLSX.utils.aoa_to_sheet(data);
    ws['!cols'] = [
        { wch: 30 },
        { wch: 15 },
        { wch: 25 },
        { wch: 15 },
        { wch: 12 },
        { wch: 10 },
        { wch: 10 },
        { wch: 40 }
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Registros");
    XLSX.writeFile(wb, `Registros_ZFA_${fechaSeleccionada}_Turno_${turnoSeleccionado.replace(/\s+/g, '')}.xlsx`);
});

// ==============================================================================
// IMPORTACIÓN DE NÓMINA DESDE CSV
// ==============================================================================
const btnImportCsv = document.getElementById('btn-import-csv');
const csvFileInput = document.getElementById('csv-file-input');

btnImportCsv.addEventListener('click', () => {
    csvFileInput.click();
});

csvFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async function(evt) {
        const text = evt.target.result;
        await processCSV(text);
        csvFileInput.value = '';
    };
    reader.readAsText(file);
});

async function processCSV(csvText) {
    const lines = csvText.split(/\r?\n/);
    if (lines.length < 2) {
        alert("El archivo parece estar vacío o no tiene el formato correcto.");
        return;
    }

    let addedCount = 0;
    let updatedCount = 0;

    const headerLine = lines[0];
    const separator = headerLine.includes(';') ? ';' : (headerLine.includes('\t') ? '\t' : ',');

    const importedBatch = [];

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        
        const cols = line.split(separator);
        
        if (cols.length >= 1) {
            let nombre = (cols[0] || '').replace(/"/g, '').trim().toUpperCase();
            let dni = (cols[1] || '').replace(/"/g, '').trim().toUpperCase();
            let empresa = (cols[2] || '').replace(/"/g, '').trim().toUpperCase();
            let dominio = (cols[3] || '').replace(/"/g, '').trim().toUpperCase();

            if (!nombre) continue;
            
            let existing = null;
            if (dni && dni !== '-' && dni !== '') {
                existing = nomina.find(p => p.dni === dni);
            } else {
                existing = nomina.find(p => p.nombre === nombre);
                if (!dni) dni = "S/D";
            }

            if (existing) {
                existing.nombre = nombre;
                existing.empresa = empresa || existing.empresa;
                existing.dominio = dominio || existing.dominio;
                if (!checkUUID(existing.id)) existing.id = getUUID();
                importedBatch.push(existing);
                updatedCount++;
            } else {
                const newPerson = {
                    id: getUUID(),
                    nombre: nombre,
                    dni: dni,
                    empresa: empresa || '',
                    dominio: dominio || ''
                };
                nomina.push(newPerson);
                importedBatch.push(newPerson);
                addedCount++;
            }
        }
    }

    saveNominaLocal();
    renderNomina();

    let msg = `Importación local completada:\n- Agregados: ${addedCount}\n- Actualizados: ${updatedCount}`;

    if (isCloudOnline && importedBatch.length > 0) {
        const uploadCloud = confirm(`${msg}\n\n¿Deseas sincronizar estos registros automáticamente con la base de datos Supabase?`);
        if (uploadCloud) {
            try {
                await DB.importNominaBatch(importedBatch);
                alert("✓ ¡Sincronizado con Supabase con éxito!");
                showToast("✓ Nómina sincronizada con Supabase", "success");
            } catch (err) {
                alert("Error al subir a Supabase: " + err.message + "\n\nVerifica los permisos en Supabase SQL Editor.");
                showToast("Error al sincronizar con Supabase", "error");
            }
        }
    } else {
        alert(msg);
    }
}
