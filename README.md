# LicenseAdmin Web

Aplicación estática para administrar las licencias de Software Infamous desde
GitHub Pages.

## Seguridad

- No incluye tokens en el código.
- El token introducido permanece únicamente en memoria.
- No utiliza cookies, localStorage ni sessionStorage.
- Usa un fine-grained token limitado a `Launcher-Licenses` con
  `Contents: Read and write`.

GitHub Pages no puede proteger secretos del lado servidor. Por eso el
administrador debe introducir su propio token en cada sesión. No publiques un
token dentro de `app.js`.

El codigo fuente publico no concede permisos de administracion: GitHub vuelve a
autorizar cada lectura y escritura con el token. Un tercero puede copiar la web,
pero no puede modificar licencias sin un token con acceso de escritura al repo.
La seguridad depende de limitar el token a los repositorios y permisos minimos.

Este panel es una aplicacion estatica y no contiene webhooks ni claves para
descifrarlos. El token introducido por el operador se mantiene solo en memoria
durante la pestana actual y se elimina del formulario al salir. No se guarda en
`localStorage`, cookies ni archivos del repositorio.

El token fine-grained debe limitarse a estos repositorios y permisos:

- `Launcher-Licenses`: `Contents: Read and write`.
- `LicenseAdmin-Web`: `Actions: Read and write` y `Contents: Read and write`
  para el generador de licencias existente.

Quien obtenga ese token, un webhook o acceso de escritura al repositorio puede
administrar el recurso correspondiente. El repositorio publico por si solo no
concede esos permisos. Las URLs de webhook compartidas fuera del panel deben
revocarse y regenerarse en Discord.

## Generacion de claves Premium FULL

La pestana **Generar clave** emite licencias firmadas y ligadas al Hardware ID.
La llave privada no se incluye en la web: GitHub Actions la recibe mediante el
secret `SIGNED_LICENSE_PRIVATE_KEY`.

La autoridad está fijada en `Launcher-Licenses`; `LicenseAdmin-Web` sólo
ejecuta el workflow de firma. Antes de entregar una clave, la web añade el HWID
a `Launcher-Licenses/Licenses.txt`, vuelve a leerlo para comprobar la
autorización y repite la comprobación después de firmar.

Configuracion inicial:

1. Publica este repositorio con el workflow de `.github/workflows`.
2. Abre `Settings > Secrets and variables > Actions`.
3. Crea `SIGNED_LICENSE_PRIVATE_KEY`.
4. Usa como valor el contenido de
   `.secrets/SIGNED_LICENSE_PRIVATE_KEY.pem` de la maquina de administracion.
5. El token usado en la web debe tener `Actions: Read and write` y
   `Contents: Read and write` para `LicenseAdmin-Web`.

La llave privada no debe publicarse, adjuntarse a releases ni copiarse dentro
de Software Infamous.

Al generar una clave, el HWID también se agrega a `Licenses.txt`. Eliminarlo
desde Premium FULL revoca la licencia firmada en la siguiente validación online.

## Publicación

1. Crea un repositorio, por ejemplo `LicenseAdmin-Web`.
2. Sube estos archivos a la rama `main`.
3. En `Settings > Pages`, selecciona `Deploy from a branch`.
4. Selecciona `main` y `/ (root)`.
5. Abre la URL generada por GitHub Pages.

## Archivos administrados

- `Licenses.txt`
- `PremiumHwidEnabled.txt`
- `PremiumHwidDefaultDays.txt`
- `PremiumHwidLicenses.txt`
- `PremiumFreeEnabled.txt`
- `PremiumFreeDays.txt`
- `PremiumFreeAcquisitionUntilUtc.txt`
- `PremiumFreeProductName.txt`
- `EnableFreeTrial.txt`
- `FreeTrialDays.txt`
- `FreeTrialAcquisitionUntilUtc.txt`
- `ProductName.txt`

Las fechas de adquisicion usan `yyyy-MM-dd` y son inclusivas en UTC. Un archivo
vacio no impone fecha limite. El vencimiento bloquea solamente nuevas
adquisiciones; las licencias activas siguen funcionando mientras su modalidad
permanezca habilitada.

Free y Premium-Free tienen ProductName, Product ID y clave TrialMaker propios.
El nombre canónico de Software Infamous se combina con el modo y la campaña:
`Software_Infamous_FREE_<CAMPANA>` o
`Software_Infamous_PREMIUM_FREE_<CAMPANA>`. El panel muestra esa clave final
antes de guardar y ambas configuraciones pueden cambiarse independientemente.

## Discord

El emisor Discord admite Markdown e imagen/GIF por URL. La URL completa de cada
webhook se almacena una sola vez como secreto cifrado de GitHub Actions y nunca
se entrega al navegador ni se escribe en este repositorio.

Configuracion unica en `AurelioGalvez/LicenseAdmin-Web > Settings > Secrets and
variables > Actions`:

- `DISCORD_WEBHOOK_ANNOUNCEMENTS`: webhook de The Unknown - Anuncios.
- `DISCORD_WEBHOOK_TESTS`: webhook de Unknown - Tests.

Los webhooks que se hayan compartido anteriormente deben regenerarse en Discord
antes de guardarlos. El workflow `send-discord-notification.yml` selecciona el
secreto segun el destino y confirma el resultado al panel.

Uso:

1. Conecta GitHub con el token y el propietario del repositorio.
2. Abre **Comunicaciones** y selecciona el destino.
3. Redacta el mensaje y agrega una imagen o GIF por URL si corresponde.
4. Usa **Enviar a Discord** y espera la confirmacion del workflow.

Para un aviso del cliente, completa tipo, titulo, mensaje y expiracion UTC,
marca **Aviso habilitado** y pulsa **Publicar aviso**. **Deshabilitar** conserva
el contenido pero impide que nuevas consultas lo muestren. **Limpiar campos**
restaura el formulario live o Discord a sus valores iniciales sin publicar ni
enviar cambios.

`ProductName.txt` debe usar el formato `NOMBRE_PRODUCTO-ID`. El nombre base
acepta letras, numeros y guion bajo; el ID admite versiones numericas.
`PROYECTO_NUEVO-1.0.0` produce el nombre logico `PROYECTO_NUEVO` y el Product
ID `#1.0.0#`. TrialMaker conserva internamente el valor completo como clave de
campana para que cada ID tenga un Proof-of-Use independiente.

El generador Premium FULL lee este archivo directamente desde el repositorio
de licencias. El nombre base se envia al workflow como producto firmado y los
guiones bajos se convierten en espacios. De esta forma,
`Software_Infamous-15` firma para `Software Infamous`, mientras que
`PROYECTO_NUEVO-1.0.0` firma para `PROYECTO NUEVO`. El workflow no contiene un producto
predeterminado.

## Actualización de datos

Las escrituras se realizan directamente mediante la API de GitHub. La
aplicación evita reutilizar respuestas mediante `no-store` y un parámetro único
de lectura. Las operaciones se encolan y ejecutan una por una porque GitHub crea
un commit por archivo y dos `PUT` simultáneos pueden competir por el estado de
la rama aunque modifiquen archivos diferentes. Antes de cada escritura se
obtiene el SHA más reciente y cualquier conflicto `409` residual se reintenta.

Después de guardar una configuración, la sección vuelve a leer los archivos
desde GitHub para confirmar los valores persistidos. Los cambios en los
archivos de licencia no requieren volver a desplegar GitHub Pages.

## Identidades separadas de licencias gratuitas

FreeTrial administra `ProductName.txt` y Premium-Free administra
`PremiumFreeProductName.txt`. Las dos secciones validan `NOMBRE_PRODUCTO-ID` y
muestran por separado el Nombre, Product ID de TrialMaker (`#ID#`) y clave
interna de campaña. Así una campaña Premium-Free no depende de FreeTrial.

Las escrituras se encolan, incluso cuando una pantalla guarda varios archivos,
para evitar el conflicto de rama que antes mostraba un error después de cambiar
ProductName aunque GitHub sí hubiera creado el commit.
