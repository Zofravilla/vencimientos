// ==============================================================================
// CONTROL DE ACCESOS - ZONA FRANCA SANTAFESINA (ZFA)
// Lógica de interfaz, gestión de nómina, control de registros y enlace con Supabase
// ==============================================================================

// Estado en memoria y caché local
let nomina = JSON.parse(localStorage.getItem('zfa_nomina')) || [];
let registros = JSON.parse(localStorage.getItem('zfa_registros')) || [];

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

let selectedPersona = null;
let isCloudOnline = false;

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
        console.warn("No se pudo conectar con Supabase:", test.message);
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
            nomina = cloudNomina;
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
    btnTestDb.textContent = 'Probando...';
    
    // Probar temporalmente
    DB.saveCredentials(url, key);
    const test = await DB.testConnection();

    btnTestDb.disabled = false;
    btnTestDb.textContent = 'Probar Conexión';

    if (test.success) {
        showDbAlert('✓ ' + test.message, 'success');
    } else {
        showDbAlert('✕ ' + test.message, 'error');
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
        isCloudOnline = true;
        updateDbStatusUI('online', 'Supabase Conectado');
        await reloadNominaFromCloud();
    } catch (err) {
        showDbAlert(`Error al sincronizar: ${err.message}`, 'error');
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
        id: isEditing ? nomId.value : (Date.now().toString() + Math.random().toString(36).substr(2, 4)),
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
        } catch (err) {
            console.error("Error al persistir persona en Supabase:", err);
            alert("Se guardó en memoria local pero hubo un error con la nube: " + err.message);
        }
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
            } catch (err) {
                console.error("Error al borrar en Supabase:", err);
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
        autocompleteResults.classList.remove('hidden');
    } else {
        const div = document.createElement('div');
        div.className = 'autocomplete-item';
        div.innerHTML = `<small><em>No se encontró en nómina.</em></small>`;
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
    selectedPersona = p;
    searchPersona.value = p.nombre;
    regDni.value = p.dni || '';
    regEmpresa.value = p.empresa || '';
    regDominio.value = p.dominio || '';
    autocompleteResults.classList.add('hidden');
    
    const fechaFormat = getFormattedDateFromInput(fechaInput.value);
    const existingIndex = registros.findIndex(r => r.persona_id === p.id && r.fecha === fechaFormat && !r.egreso);
    
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

function clearRecordForm() {
    selectedPersona = null;
    searchPersona.value = '';
    regDni.value = '';
    regEmpresa.value = '';
    regDominio.value = '';
    regObservaciones.value = '';
    btnIngreso.disabled = true;
    btnEgreso.disabled = true;
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
    if (!selectedPersona) return;

    if (!porteroInput.value.trim()) {
        alert("Por favor, ingrese el nombre del Portero antes de registrar.");
        porteroInput.focus();
        return;
    }

    const fechaIso = fechaInput.value;
    const fechaFormat = getFormattedDateFromInput(fechaIso);
    
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
            } catch (err) {
                console.error("Error al actualizar egreso en Supabase:", err);
            }
        }
    } else if (tipo === 'ingreso') {
        const rec = {
            id: Date.now().toString() + Math.random().toString(36).substr(2, 4),
            persona_id: selectedPersona.id,
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
            } catch (err) {
                console.error("Error al insertar ingreso en Supabase:", err);
            }
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
            } catch (err) {
                console.error("Error al actualizar egreso en Supabase:", err);
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
            } catch (err) {
                console.error("Error al eliminar registro en Supabase:", err);
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
                importedBatch.push(existing);
                updatedCount++;
            } else {
                const newPerson = {
                    id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
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
            } catch (err) {
                alert("Error al subir a Supabase: " + err.message);
            }
        }
    } else {
        alert(msg);
    }
}
