# Confirmación de asistencia

Invitación estática en HTML/CSS/JavaScript, con Supabase Auth para organizadores, RLS para aislar eventos y una Edge Function para recibir respuestas públicas. El cliente usa únicamente la clave pública de Supabase. No se incluye `service_role`.

## Estructura

- `index.html`: ejemplo de invitación.
- `confirmar.html`: respuesta vinculada a un enlace/token de invitación.
- `login.html` y `admin.html`: acceso y panel administrativo.
- `css/` y `js/`: interfaz y lógica del cliente.
- `supabase/schema.sql`: tablas, RPC estrecha y políticas RLS.
- `supabase/functions/submit-rsvp/`: endpoint público de respuestas.

## Modelo de datos y permisos

- `events` contiene los eventos y su estado de recepción (`is_open`).
- `event_admins` relaciona cuentas de `auth.users` con eventos; un usuario puede administrar varios y un evento puede tener varios administradores.
- `invitations` guarda los invitados esperados, el máximo de acompañantes y el hash SHA-256 del token de invitación.
- `rsvps` guarda como máximo una respuesta por invitación. La relación `rsvps → invitations → events` determina a qué evento pertenece, sin aceptar un ID de evento del formulario.

RLS está habilitado en las cuatro tablas. Los administradores pueden leer solo sus eventos y los invitados/respuestas de esos eventos; las modificaciones administrativas también validan la asignación de evento. Las cuentas no pueden asignarse a eventos desde el navegador. El rol anónimo no tiene permisos de tabla: solo puede invocar `submit_public_rsvp`, que busca el token, comprueba que la invitación y el evento sigan activos y escribe la respuesta asociada. Esa función no devuelve datos personales.

## Configuración antes de probar

1. Crea un proyecto de Supabase. No actives el registro público de usuarios: las cuentas de organizador deben crearse/invitarse desde el panel de Supabase por una persona administradora.
2. En **Project Settings → API**, copia la URL del proyecto y la clave publicable (`anon`/publishable). Reemplaza los valores de ejemplo al inicio de `js/supabase.js`. Esa clave es pública y nunca debe sustituirse por `service_role`.
3. Ejecuta `supabase/schema.sql` una vez desde el SQL Editor con una cuenta administrativa de Supabase. El SQL activa RLS y no crea eventos, invitaciones ni usuarios.
4. Instala Supabase CLI, autentícate y vincula el proyecto (`supabase login` y `supabase link --project-ref TU_PROJECT_REF`). Despliega la función con `supabase functions deploy submit-rsvp`. `supabase/config.toml` configura `verify_jwt = false` porque el formulario es público; la función solo usa URL y clave pública para llamar a la RPC. La RPC valida un token aleatorio y no concede lectura pública. Para ejecutarla localmente, usa `supabase start` y `supabase functions serve submit-rsvp`.
5. Crea un organizador desde el panel de Auth. Luego, en el SQL Editor, crea un evento y vincula el usuario a su UUID en `event_admins`. Las instrucciones SQL concretas están en la sección de aprovisionamiento.
6. Registra una invitación por persona; entrega su token como fragmento de URL (`confirmar.html#token=...`). El fragmento no se envía al servidor web ni como encabezado Referer y el formulario lo elimina del historial del navegador al cargar.
7. Sirve los archivos desde un servidor local para probar. Los módulos JavaScript y la API del navegador requieren un origen HTTP(S); abrir el HTML como `file://` no es una prueba válida.

## Alojamiento estático

La publicación no se ha realizado. Después de ejecutar las pruebas de aislamiento, configura GitHub Pages desde **Settings → Pages** en cada repositorio y publica los archivos de la invitación desde la rama/carpeta elegida. Cada repositorio usa el mismo proyecto de Supabase, la misma clave pública y el mismo código reutilizable; el token de fragmento identifica la invitación, no otorga acceso al panel.

## Aprovisionamiento administrativo

Realiza estos pasos solo desde Supabase Dashboard/SQL Editor o un entorno privado confiable; nunca desde GitHub Pages. No pongas tokens en repositorios ni compartas el resultado del generador de tokens. Crea primero la cuenta en Auth y copia su UUID desde el panel.

Crear un evento y asociar una cuenta existente:

```sql
with new_event as (
  insert into public.events (name)
  values ('Cumpleaños de prueba')
  returning id
)
insert into public.event_admins (event_id, user_id)
select id, 'UUID_DEL_USUARIO_DE_AUTH'::uuid
from new_event
returning event_id;
```

Para cada invitación, genera un token distinto desde un entorno administrativo de confianza y guarda **solo su hash** en la tabla. La consulta genera un token aleatorio, almacena solamente su hash y muestra el token en el resultado del SQL Editor para que puedas copiarlo al enlace personal. No guardes ni compartas el resultado del token:

```sql
with generated as (
  select encode(extensions.gen_random_bytes(32), 'hex') as token
),
inserted as (
  insert into public.invitations (event_id, first_name, last_name, max_companions, token_hash)
  select
    'UUID_DEL_EVENTO'::uuid,
    'Nombre',
    'Apellido',
    1,
    encode(extensions.digest(convert_to(generated.token, 'UTF8'), 'sha256'), 'hex')
  from generated
  returning id
)
select inserted.id, generated.token
from inserted
cross join generated;
```

Copia el token directamente en el enlace `confirmar.html#token=...`. No uses una clave ni una fila de invitación compartida para todo el evento. El token es una credencial: cualquiera que lo tenga puede responder o cambiar la respuesta de esa invitación mientras siga activo. Para revocarlo, marca la invitación como inactiva desde un entorno administrativo.

## Verificación del aislamiento

Haz estas comprobaciones en un proyecto de pruebas con dos usuarios y dos eventos. Inicia sesión con cada cuenta por separado y usa la API como `authenticated`, no el SQL Editor como `postgres`:

1. Como A, consulta `events` e `invitations`: solo debe aparecer el evento A; como B, solo el evento B.
2. Como A, intenta leer, actualizar y borrar los UUID de invitación/respuesta de B. La lectura no debe devolver filas y las escrituras no deben afectar filas o deben ser rechazadas. Repite B contra A.
3. Como anónimo, intenta hacer `select` de `events`, `invitations` y `rsvps`: no debe leer datos. La única operación pública autorizada es invocar la Edge Function/RPC de respuesta.
4. Envía una respuesta con token válido; verifica como administrador que aparece solo bajo la invitación correspondiente. Repite con token alterado, inactivo, evento cerrado, acompañantes por encima del máximo y una respuesta negativa con acompañantes: todos deben rechazarse.
5. Modifica el cuerpo para añadir un `event_id` de otro evento: el endpoint lo ignora y la RPC resuelve el evento exclusivamente a partir del hash del token.
6. Inspecciona **Database → Policies** y confirma que RLS está habilitado en las cuatro tablas y que no hay políticas adicionales permisivas. Una prueba visual del panel por sí sola no verifica RLS.

El diseño limita el acceso con políticas verificadas por la base de datos; no reemplaza la ejecución de estas pruebas en el proyecto configurado. La función no implementa limitación de frecuencia/CAPTCHA; si se requiere protección contra abuso automatizado, añádela en el endpoint antes de exponer los enlaces.
