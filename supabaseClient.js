// ==============================================================================
// CLIENTE Y ADAPTADOR DE SUPABASE
// Maneja comunicación en la nube, sincronización en tiempo real y fallback offline
// ==============================================================================

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

    // Probar conexión contra la base de datos
    async testConnection() {
        if (!this.client && !this.init()) {
            return { success: false, message: 'Faltan credenciales (URL y Anon Key).' };
        }
        try {
            const { error } = await this.client.from('nomina').select('id', { count: 'exact', head: true });
            if (error) throw error;
            return { success: true, message: 'Conexión establecida exitosamente con Supabase.' };
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
        if (!this.client) return null;
        try {
            const { data, error } = await this.client
                .from('nomina')
                .upsert([persona], { onConflict: 'id' })
                .select();

            if (error) throw error;
            return data[0];
        } catch (err) {
            console.error("Error al guardar persona en Supabase:", err);
            throw err;
        }
    },

    async deletePersona(id) {
        if (!this.client) return null;
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
            const chunk = personas.slice(i, i + batchSize);
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
        if (!this.client) return null;
        try {
            const { data, error } = await this.client
                .from('registros')
                .insert([rec])
                .select();

            if (error) throw error;
            return data[0];
        } catch (err) {
            console.error("Error al agregar registro en Supabase:", err);
            throw err;
        }
    },

    async updateRegistroEgreso(id, egreso, observaciones) {
        if (!this.client) return null;
        try {
            const payload = { egreso };
            if (observaciones !== undefined) payload.observaciones = observaciones;

            const { data, error } = await this.client
                .from('registros')
                .update(payload)
                .eq('id', id)
                .select();

            if (error) throw error;
            return data[0];
        } catch (err) {
            console.error("Error al actualizar egreso en Supabase:", err);
            throw err;
        }
    },

    async deleteRegistro(id) {
        if (!this.client) return null;
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
            this.client.removeChannel(this.realtimeSubscription);
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

// Auto-inicializar al cargar
DB.init();
