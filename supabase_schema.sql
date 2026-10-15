-- ==============================================================================
-- SCHEMA Y PERMISOS PARA CONTROL DE ACCESOS ZONA FRANCA SANTAFESINA (ZFA)
-- ==============================================================================
-- Instrucciones de aplicación:
-- 1. Inicia sesión en tu cuenta de Supabase (https://supabase.com).
-- 2. Entra a tu proyecto -> SQL Editor (en el menú lateral izquierdo).
-- 3. Haz clic en "New query", pega TODO este contenido y presiona "Run".
-- 4. Este script crea las tablas, índices, habilita Realtime y garantiza
--    los permisos de lectura, inserción, actualización y borrado (GRANT + RLS)
--    tanto para el rol anónimo (anon) como autenticado (authenticated).
-- ==============================================================================

-- 1. TABLA NÓMINA (Personal Autorizado)
CREATE TABLE IF NOT EXISTS public.nomina (
    id TEXT PRIMARY KEY,
    nombre TEXT NOT NULL,
    dni TEXT,
    empresa TEXT,
    dominio TEXT,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Índices para búsqueda rápida
CREATE INDEX IF NOT EXISTS idx_nomina_dni ON public.nomina (dni);
CREATE INDEX IF NOT EXISTS idx_nomina_nombre ON public.nomina (nombre);
CREATE INDEX IF NOT EXISTS idx_nomina_empresa ON public.nomina (empresa);


-- 2. TABLA REGISTROS (Movimientos Diarios de Ingreso y Egreso)
CREATE TABLE IF NOT EXISTS public.registros (
    id TEXT PRIMARY KEY,
    persona_id TEXT,
    nombre TEXT NOT NULL,
    dni TEXT,
    empresa TEXT,
    dominio TEXT,
    fecha TEXT NOT NULL,          -- Formato DD/MM/AAAA
    fecha_iso TEXT NOT NULL,      -- Formato AAAA-MM-DD para filtrado exacto
    ingreso TEXT,                 -- Hora HH:mm
    egreso TEXT,                  -- Hora HH:mm
    observaciones TEXT,
    portero TEXT,
    turno TEXT,                   -- '06 - 18' o '18 - 06'
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Índices para filtrado de registros por fecha y turno
CREATE INDEX IF NOT EXISTS idx_registros_fecha_turno ON public.registros (fecha_iso, turno);
CREATE INDEX IF NOT EXISTS idx_registros_persona ON public.registros (persona_id);
CREATE INDEX IF NOT EXISTS idx_registros_egreso ON public.registros (egreso);


-- ==============================================================================
-- 3. PERMISOS DE TABLA EN POSTGRESQL (CRÍTICO PARA RESOLVER ERROR 42501)
-- ==============================================================================
-- Sin estos GRANTs explícitos, PostgreSQL rechaza las inserciones con "permission denied"
-- antes incluso de evaluar las políticas RLS.

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.nomina TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.registros TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;

-- Garantizar permisos automáticos para futuras tablas/secuencias creadas en public
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;


-- ==============================================================================
-- 4. SEGURIDAD A NIVEL DE FILAS (Row Level Security - RLS)
-- ==============================================================================
ALTER TABLE public.nomina ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registros ENABLE ROW LEVEL SECURITY;

-- Políticas de Nómina: permitir SELECT, INSERT, UPDATE, DELETE a clientes con anon o authenticated key
DROP POLICY IF EXISTS "Acceso total anonimo a nomina" ON public.nomina;
DROP POLICY IF EXISTS "Acceso total a nomina" ON public.nomina;
CREATE POLICY "Acceso total a nomina" 
ON public.nomina 
FOR ALL 
TO public 
USING (true) 
WITH CHECK (true);

-- Políticas de Registros: permitir SELECT, INSERT, UPDATE, DELETE a clientes con anon o authenticated key
DROP POLICY IF EXISTS "Acceso total anonimo a registros" ON public.registros;
DROP POLICY IF EXISTS "Acceso total a registros" ON public.registros;
CREATE POLICY "Acceso total a registros" 
ON public.registros 
FOR ALL 
TO public 
USING (true) 
WITH CHECK (true);


-- ==============================================================================
-- 5. CONFIGURACIÓN DE REPLICA IDENTITY (Para sincronización en tiempo real completa)
-- ==============================================================================
ALTER TABLE public.nomina REPLICA IDENTITY FULL;
ALTER TABLE public.registros REPLICA IDENTITY FULL;


-- ==============================================================================
-- 6. HABILITAR REALTIME (Para actualización instantánea entre diferentes puestos/pantallas)
-- ==============================================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'registros'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.registros;
    END IF;
    
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'nomina'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.nomina;
    END IF;
END $$;
