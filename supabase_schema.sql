-- ==============================================================================
-- SCHEMA PARA CONTROL DE ACCESOS ZONA FRANCA SANTAFESINA (ZFA)
-- Ejecuta este script completo en el SQL Editor de tu proyecto en Supabase
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


-- 3. HABILITAR SEGURIDAD A NIVEL DE FILAS (Row Level Security - RLS)
ALTER TABLE public.nomina ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registros ENABLE ROW LEVEL SECURITY;

-- Políticas para permitir lectura, inserción, actualización y borrado a clientes con anon key
DROP POLICY IF EXISTS "Acceso total anonimo a nomina" ON public.nomina;
CREATE POLICY "Acceso total anonimo a nomina" 
ON public.nomina 
FOR ALL 
TO anon 
USING (true) 
WITH CHECK (true);

DROP POLICY IF EXISTS "Acceso total anonimo a registros" ON public.registros;
CREATE POLICY "Acceso total anonimo a registros" 
ON public.registros 
FOR ALL 
TO anon 
USING (true) 
WITH CHECK (true);


-- 4. HABILITAR REALTIME (Para actualización instantánea entre diferentes pantallas)
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
