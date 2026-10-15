// ==============================================================================
// CLIENTE Y ADAPTADOR DE SUPABASE
// Maneja comunicación en la nube, sincronización en tiempo real y fallback offline
// ==============================================================================

// Generador de UUID v4 estándar (compatible con columnas UUID de PostgreSQL)
function generateUUID() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

function isValidUUID(str) {
    if (!str || typeof str !== 'string') return false;
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str.trim());
}

const DB = {
    client: null,
    realtimeSubscription: null,

    // Obtener credenciales activas (prioriza localStorage para permitir cambios en vivo)
    getCredentials() {
        const localUrl = localStorage.getItem('zfa_supabase_url');
        const localKey = localStorage.getItem('zfa_supabase_key');

        if (localUrl && localKey) {
            return { url: localUrl.trim(), anonKey: localKey.trim() };
        }

        const config = window.SUPABASE_CONFIG || {};
        return {
            url: (config.url || '').trim(),
            anonKey: (config.anonKey || '').trim()
        };
    },

    // Saber si está configurado
    isConfigured() {
        const creds = this.getCredentials();
        return Boolean(creds.url && creds.anonKey && creds.url.startsWith('http'));
    },

    // Inicializar cliente
    init() {
        const creds = this.getCredentials();
        if (creds.url && creds.anonKey && window.supabase) {
            try {
                this.client = window.supabase.createClient(creds.url, creds.anonKey);
                return true;
            } catch (err) {
                console.error("Error al inicializar cliente Supabase:", err);
                this.client = null;
                return false;
            }
        }
        this.client = null;
        return false;
    },

    // Guardar credenciales desde la interfaz de usuario
    saveCredentials(url, key) {
        localStorage.setItem('zfa_supabase_url', url.trim());
        localStorage.setItem('zfa_supabase_key', key.trim());
        return this.init();
    },

    // Probar conexión y permisos contra la base de datos (Lectura + Escritura)
    async testConnection() {
        if (!this.client && !this.init()) {
            return { success: false, message: 'Faltan credenciales (URL y Anon Key).' };
        }
        try {
            // 1. Probar lectura en tabla 'nomina'
            const { error: readErr } = await this.client.from('nomina').select('id', { count: 'exact', head: true });
            if (readErr) {
                return {
                    success: false,
                    isPermissionError: true,
                    message: `Error al leer la tabla nomina: ${readErr.message} (Código ${readErr.code || 'RLS'}). Verifica la tabla en Supabase.`
                };
            }

            // 2. Probar permisos de escritura con UUID válido
            const testId = generateUUID();
            const { error: writeErr } = await this.client.from('nomina').upsert([{
                id: testId,
                nombre: '__PING_TEST__',
                dni: '000',
                empresa: 'TEST',
                dominio: ''
            }]);

            if (writeErr) {
                return {
                    success: false,
                    isPermissionError: true,
                    message: `⚠️ Conexión establecida pero FALLARON LOS PERMISOS DE ESCRITURA: ${writeErr.message} (Código: ${writeErr.code || '42501'}). Ejecuta el script SQL en Supabase para conceder permisos.`
                };
            }

            // 3. Limpiar registro de prueba
            await this.client.from('nomina').delete().eq('id', testId);

            return { 
                success: true, 
                message: 'Conexión y permisos verificados exitosamente: Lectura y escritura activas.' 
            };
        } catch (err) {
            return { success: false, message: err.message || 'Error al conectar con Supabase.' };
        }
    },

    // --- OPERACIONES DE NÓMINA ---
    async getNomina() {
        if (!this.client) return null;
        try {
            const { data, error } = await this.client
                .from('nomina')
                .select('*')
                .order('nombre', { ascending: true });
            
            if (error) throw error;
            return data;
        } catch (err) {
            console.error("Error al obtener nómina de Supabase:", err);
            return null;
        }
    },

    async savePersona(persona) {
        if (!this.client) throw new Error("Base de datos no conectada");
        try {
            const payload = { ...persona };
            if (!payload.id || !isValidUUID(payload.id)) {
                payload.id = generateUUID();
            }

            const { data, error } = await this.client
                .from('nomina')
                .upsert([payload], { onConflict: 'id' })
                .select();

            if (error) throw error;
            return data && data.length > 0 ? data[0] : payload;
        } catch (err) {
            console.error("Error al guardar persona en Supabase:", err);
            throw err;
        }
    },

    async deletePersona(id) {
        if (!this.client) throw new Error("Base de datos no conectada");
        try {
            const { error } = await this.client
                .from('nomina')
                .delete()
                .eq('id', id);

            if (error) throw error;
            return true;
        } catch (err) {
            console.error("Error al eliminar persona en Supabase:", err);
            throw err;
        }
    },

    async importNominaBatch(personas, onProgress) {
        if (!this.client) throw new Error("Supabase no está conectado");
        const batchSize = 100;
        let total = personas.length;
        let processed = 0;

        for (let i = 0; i < total; i += batchSize) {
            const chunk = personas.slice(i, i + batchSize).map(p => {
                const item = { ...p };
                if (!item.id || !isValidUUID(item.id)) {
                    item.id = generateUUID();
                }
                return item;
            });

            const { error } = await this.client
                .from('nomina')
                .upsert(chunk, { onConflict: 'id' });

            if (error) throw error;
            processed += chunk.length;
            if (onProgress) onProgress(processed, total);
        }
        return true;
    },

    // --- OPERACIONES DE REGISTROS ---
    async getRegistros(fechaIso, turno) {
        if (!this.client) return null;
        try {
            const { data, error } = await this.client
                .from('registros')
                .select('*')
                .eq('fecha_iso', fechaIso)
                .eq('turno', turno)
                .order('created_at', { ascending: true });

            if (error) throw error;
            return data;
        } catch (err) {
            console.error("Error al obtener registros de Supabase:", err);
            return null;
        }
    },

    async addRegistro(rec) {
        if (!this.client) throw new Error("Base de datos no conectada");
        try {
            const payload = { ...rec };
            if (!payload.id || !isValidUUID(payload.id)) {
                payload.id = generateUUID();
            }
            // En PostgreSQL, columnas UUID fallan si reciben "" (string vacío). Deben recibir NULL.
            if (!payload.persona_id || !isValidUUID(payload.persona_id)) {
                payload.persona_id = null;
            }

            const { data, error } = await this.client
                .from('registros')
                .insert([payload])
                .select();

            if (error) throw error;
            return data && data.length > 0 ? data[0] : payload;
        } catch (err) {
            console.error("Error al agregar registro en Supabase:", err);
            throw err;
        }
    },

    async updateRegistroEgreso(id, egreso, observaciones) {
        if (!this.client) throw new Error("Base de datos no conectada");
        try {
            const payload = { egreso };
            if (observaciones !== undefined) payload.observaciones = observaciones;

            const { data, error } = await this.client
                .from('registros')
                .update(payload)
                .eq('id', id)
                .select();

            if (error) throw error;
            return data && data.length > 0 ? data[0] : null;
        } catch (err) {
            console.error("Error al actualizar egreso en Supabase:", err);
            throw err;
        }
    },

    async deleteRegistro(id) {
        if (!this.client) throw new Error("Base de datos no conectada");
        try {
            const { error } = await this.client
                .from('registros')
                .delete()
                .eq('id', id);

            if (error) throw error;
            return true;
        } catch (err) {
            console.error("Error al borrar registro en Supabase:", err);
            throw err;
        }
    },

    // Suscripción a cambios en tiempo real
    subscribeToRealtime(onRegistrosChange, onNominaChange) {
        if (!this.client) return;

        if (this.realtimeSubscription) {
            try {
                this.client.removeChannel(this.realtimeSubscription);
            } catch (e) {
                console.warn("Canal previo no removido:", e);
            }
        }

        this.realtimeSubscription = this.client
            .channel('db-changes-zfa')
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'registros' },
                (payload) => {
                    if (onRegistrosChange) onRegistrosChange(payload);
                }
            )
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'nomina' },
                (payload) => {
                    if (onNominaChange) onNominaChange(payload);
                }
            )
            .subscribe();
    }
};

// Exportar globalmente generador de UUID
window.generateUUID = generateUUID;
window.isValidUUID = isValidUUID;

// Auto-inicializar al cargar
DB.init();
