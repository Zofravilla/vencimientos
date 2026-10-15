-- ==============================================================================
-- SCHEMA Y PERMISOS PARA CONTROL DE ACCESOS ZONA FRANCA SANTAFESINA (ZFA)
-- ==============================================================================
-- Instrucciones de aplicación:
-- 1. Inicia sesión en tu cuenta de Supabase (https://supabase.com).
-- 2. Entra a tu proyecto -> SQL Editor (en el menú lateral izquierdo).
-- 3. Haz clic en "New query", pega TODO este contenido y presiona "Run".
-- 4. Este script habilita UUID v4, crea las tablas si no existen, asegura
--    los permisos GRANT para los roles anon/authenticated y configura RLS y Realtime.
-- ==============================================================================

-- Habilitar extensiones para generación de UUIDs
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. TABLA NÓMINA (Personal Autorizado)
CREATE TABLE IF NOT EXISTS public.nomina (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre TEXT NOT NULL,
    dni TEXT,
    empresa TEXT,
    dominio TEXT,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Asegurar default para id en caso de tablas preexistentes
DO $$
BEGIN
    ALTER TABLE public.nomina ALTER COLUMN id SET DEFAULT gen_random_uuid();
EXCEPTION WHEN OTHERS THEN
    NULL;
END $$;

-- Índices para búsqueda rápida
CREATE INDEX IF NOT EXISTS idx_nomina_dni ON public.nomina (dni);
CREATE INDEX IF NOT EXISTS idx_nomina_nombre ON public.nomina (nombre);
CREATE INDEX IF NOT EXISTS idx_nomina_empresa ON public.nomina (empresa);


-- 2. TABLA REGISTROS (Movimientos Diarios de Ingreso y Egreso)
CREATE TABLE IF NOT EXISTS public.registros (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    persona_id UUID,
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

DO $$
BEGIN
    ALTER TABLE public.registros ALTER COLUMN id SET DEFAULT gen_random_uuid();
EXCEPTION WHEN OTHERS THEN
    NULL;
END $$;

-- Índices para filtrado de registros por fecha y turno
CREATE INDEX IF NOT EXISTS idx_registros_fecha_turno ON public.registros (fecha_iso, turno);
CREATE INDEX IF NOT EXISTS idx_registros_persona ON public.registros (persona_id);
CREATE INDEX IF NOT EXISTS idx_registros_egreso ON public.registros (egreso);


-- ==============================================================================
-- 3. PERMISOS DE TABLA EN POSTGRESQL (CRÍTICO PARA RESOLVER ERROR 42501)
-- ==============================================================================
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.nomina TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.registros TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;


-- ==============================================================================
-- 4. SEGURIDAD A NIVEL DE FILAS (Row Level Security - RLS)
-- ==============================================================================
ALTER TABLE public.nomina ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registros ENABLE ROW LEVEL SECURITY;

-- Políticas de Nómina: permitir SELECT, INSERT, UPDATE, DELETE a clientes
DROP POLICY IF EXISTS "Acceso total anonimo a nomina" ON public.nomina;
DROP POLICY IF EXISTS "Acceso total a nomina" ON public.nomina;
DROP POLICY IF EXISTS "Permitir select anónimo en nomina" ON public.nomina;
DROP POLICY IF EXISTS "Permitir insert anónimo en nomina" ON public.nomina;
DROP POLICY IF EXISTS "Permitir update anónimo en nomina" ON public.nomina;
DROP POLICY IF EXISTS "Permitir delete anónimo en nomina" ON public.nomina;

CREATE POLICY "Acceso total a nomina" 
ON public.nomina 
FOR ALL 
TO public 
USING (true) 
WITH CHECK (true);

-- Políticas de Registros: permitir SELECT, INSERT, UPDATE, DELETE a clientes
DROP POLICY IF EXISTS "Acceso total anonimo a registros" ON public.registros;
DROP POLICY IF EXISTS "Acceso total a registros" ON public.registros;
DROP POLICY IF EXISTS "Permitir select anónimo en registros" ON public.registros;
DROP POLICY IF EXISTS "Permitir insert anónimo en registros" ON public.registros;
DROP POLICY IF EXISTS "Permitir update anónimo en registros" ON public.registros;
DROP POLICY IF EXISTS "Permitir delete anónimo en registros" ON public.registros;

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
-- 6. HABILITAR REALTIME
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
