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
- `EnableFreeTrial.txt`
- `FreeTrialDays.txt`
- `ProductName.txt`

`ProductName.txt` debe usar el formato `Software_Infamous-N`. Por ejemplo,
`Software_Infamous-12` se convierte en nombre `Software_Infamous` y Product ID
`#12#` para TrialMaker.

## Actualización de datos

Las escrituras se realizan directamente mediante la API de GitHub. La
aplicación evita reutilizar respuestas mediante la opción `no-store` y un
parámetro único de lectura, obtiene el SHA más reciente antes de cada escritura
y reintenta automáticamente los conflictos `409`.

Después de guardar una configuración, la sección vuelve a leer los archivos
desde GitHub para confirmar los valores persistidos. Los cambios en los
archivos de licencia no requieren volver a desplegar GitHub Pages.
