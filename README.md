# Control de Accesos - Zona Franca Santafesina (ZFA)

Sistema web de control de ingresos y egresos de personas y vehículos a la Zona Primaria Aduanera, con persistencia en **Supabase** y listo para desplegar en **Vercel**.

---

## 🚀 Paso 1: Configurar la Base de Datos en Supabase

1. Entra a [supabase.com](https://supabase.com) e inicia sesión (o crea una cuenta gratuita).
2. Haz clic en **"New Project"**, elige un nombre (ej. `zfa-control-accesos`) y una contraseña para la base de datos.
3. Una vez creado el proyecto:
   - Ve a **SQL Editor** en el menú izquierdo de Supabase.
   - Abre o copia todo el contenido del archivo [`supabase_schema.sql`](./supabase_schema.sql).
   - Pégalo en el editor y haz clic en **"Run"**.
   - Esto creará automáticamente las tablas `nomina` y `registros`, otorgará los permisos `GRANT` a los roles `anon` y `authenticated`, configurará las políticas de seguridad (RLS) y activará **Realtime** para actualizaciones en vivo.

4. Obtén tus credenciales:
   - Ve a **Project Settings** (el engranaje abajo a la izquierda) > **API**.
   - Copia la **Project URL** (ej: `https://xxxxxxxxxxxx.supabase.co`).
   - Copia la **Project API keys: `anon` / `public`** (clave pública).

> [!IMPORTANT]
> Si en algún momento la base de datos no guarda nuevos ingresos o personas, vuelve a ejecutar [`supabase_schema.sql`](./supabase_schema.sql) en el **SQL Editor** de Supabase para renovar los permisos `GRANT` y políticas `RLS`.

---

## 🔑 Paso 2: Vincular las Credenciales

Tienes dos formas de conectar la app a tu base de datos:

### Opción A (Recomendada y más rápida):
Abre la aplicación en el navegador, haz clic en el botón **⚙️ Configurar** en la esquina inferior izquierda de la barra lateral, pega la URL y la Anon Key, y haz clic en **Guardar Credenciales**. El indicador cambiará a `🟢 Supabase Conectado`.

### Opción B (En el código):
Edita el archivo [`config.js`](./config.js) y pega tus credenciales:
```javascript
window.SUPABASE_CONFIG = {
    url: 'https://tu-proyecto.supabase.co',
    anonKey: 'tu-clave-anon-aqui'
};
```

---

## 📥 Paso 3: Registrar Nuevos Ingresos y Personal

El sistema maneja dos formas de dar de alta personal:
1. **Directamente en la Guardia (Control de Ingreso):**
   - Escribe el nombre o DNI en el buscador. Si la persona no está en la nómina, el sistema te ofrecerá registrarla como **Nuevo Ingreso**.
   - Completa su DNI y Empresa en los campos habilitados.
   - Haz clic en **Marcar Ingreso y Guardar en Nómina**: se registrará su acceso en la guardia y se agregará inmediatamente a la Nómina permanente en Supabase.
2. **Desde la Pestaña Nómina:**
   - Ve a la pestaña **Nómina** y utiliza el formulario **Agregar/Editar Persona**.
   - O importa masivamente tu archivo CSV con el botón **Importar CSV**.

---

## 📤 Paso 4: Sincronizar Nómina Inicial con Supabase

Si ya cuentas con datos locales o CSV:
1. En la aplicación, ve a la pestaña **Nómina**.
2. Haz clic en **Importar CSV** y selecciona el archivo [`nomina.csv`](./nomina.csv).
3. El sistema te preguntará si deseas subirlos automáticamente a Supabase en la nube. Confirma y en segundos tendrás a todo el personal disponible en la base de datos cloud.
*(También puedes usar el botón "Subir Nómina Local a Supabase Cloud" en el modal de configuración).*

---

## 🌐 Paso 5: Desplegar en Vercel

El proyecto ya incluye [`vercel.json`](./vercel.json) configurado para desplegarse como sitio estático de alto rendimiento.

### Método 1: Vía GitHub + Vercel Dashboard (Recomendado)
1. Sube esta carpeta a un repositorio en tu cuenta de [GitHub](https://github.com).
2. Entra a [vercel.com](https://vercel.com) e inicia sesión.
3. Haz clic en **"Add New..."** > **"Project"**.
4. Selecciona tu repositorio de GitHub y haz clic en **"Deploy"**.
5. ¡Listo! Vercel te dará una URL pública tipo `https://tu-proyecto.vercel.app` accesible desde cualquier dispositivo (PCs, tablets de guardia, celulares).

### Método 2: Vía Vercel CLI (Desde la consola)
Si tienes Node.js instalado:
```bash
npx vercel
```
Sigue las indicaciones en pantalla y el despliegue estará listo en menos de 1 minuto.

---

## 🛠️ Estructura del Proyecto

- `index.html`: Interfaz de usuario responsive (registros, nómina, modal de configuración, permisos).
- `styles.css`: Estilos visuales con paleta corporativa, toasts y badges informativos.
- `app.js`: Lógica principal de negocio, exportación a Excel, flujo de nuevos ingresos e integración con Supabase.
- `supabaseClient.js`: Adaptador para Supabase con verificación de permisos de lectura y escritura.
- `config.js`: Variables de configuración de Supabase.
- `supabase_schema.sql`: Script SQL con las tablas, permisos GRANT, políticas RLS y Realtime.
- `vercel.json`: Reglas de despliegue y seguridad para Vercel.
- `nomina.csv`: Base de datos de personal y contratistas autorizados.
