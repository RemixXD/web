# SCP:SL Remote Admin Config Manager

Editor web local para importar, visualizar, editar, validar y exportar el archivo
`config_remoteadmin.txt` de **SCP: Secret Laboratory (Remote Admin)**, con exportación
adicional a **Permissions EXILED** y **Permissions LabAPI**.
Hecho por JuanSAYAMAN y Remix.

No hay backend ni base de datos: todo se procesa en el navegador. No requiere
instalación ni compilación.

La página es universal: lee automáticamente las IDs de cualquier archivo
(`A1`, `VIP3`, `admin`, …), las agrupa por prefijo sin importar la plantilla del
servidor y detecta la etiqueta de cada grupo desde sus badges del archivo
(compartido → ese badge; distintos → tabla integrada → prefijo). Incluye
desplegable de idioma **ES/EN** en la cabecera (`#lang-select` con opciones
Español/English, se guarda en `localStorage`); todo el texto visible —interfaz,
diagnósticos, reparaciones, organización, renumeración y exportación— está
traducido en `STRINGS` (`app.js`).

## Stack y requisitos

- Frontend puro: `index.html` + `styles.css` + `app.js` (sin bundler, sin framework).
- Dependencias solo por CDN (versionadas):
  - Phosphor Icons `@phosphor-icons/web@2.1.2`
  - SortableJS `sortablejs@1.15.6` (arrastrar para reordenar; si falla, la edición sigue funcionando).
- Node.js `>=18` solo para correr los tests (`package.json:10`).
- Scripts (`package.json:5-8`):
  - `npm test` → `node --test tests/app.logic.test.cjs`
  - `npm run check` → `node --check app.js && node --test tests/app.logic.test.cjs`

## Estructura del proyecto

| Archivo | Qué contiene |
|---|---|
| `index.html` | Vistas (Importar / Editor), modales (exportar, diagnóstico, permisos, miembro, ascender, descender, carga masiva de miembros, carga masiva de badges) y plantillas. |
| `app.js` (~7400 líneas) | Estado central, parser RemoteAdmin, render del editor, validación/diagnóstico, organización, renumeración de IDs, ascensos/descensos, cargas masivas y exportación. |
| `styles.css` | Tema oscuro, responsive (acordeón en móvil / split en desktop ≥1024px), modales, tablas y diagnósticos. |
| `tests/app.logic.test.cjs` | Suite con `node:test` que carga `app.js` en una VM con DOM simulado y verifica parser, exportación, organización, renumeración y badges. |
| `tests/fixtures/remoteadmin-lossless.txt` | Fixture para pruebas de round-trip byte a byte. |

## Flujo de uso

1. **Importar**: en la vista Importar pega el contenido de `config_remoteadmin.txt` o sube el `.txt`
   (`index.html`, `#config-input`, `#file-upload`). Pulsa **Leer Configuración** (`#btn-parse`).
   - Solo se acepta configuración RemoteAdmin (`Members` / `Permissions` / `override_password_role`
     o propiedades `*_badge`, `*_color`, etc.). Cualquier otro texto muestra
     “El archivo no es una configuración válida de Remote Admin.”
2. **Editar**: se habilita la vista Editor (`#btn-editor-view`) y la insignia
   “🛡️ Modo: Remote Admin” (`#mode-badge`).
   - Móvil (<1024px): acordeón por grupo con miembros colapsables.
   - Desktop (≥1024px): sidebar de categorías + rejilla de tarjetas.
   - Buscador `#search-input` filtra por nombre, notas, ID, badge o rol.
   - Arrastrar con el asa (seis puntos) reordena miembros (SortableJS).
3. **Validar/reparar**: indicador `#remoteadmin-health` (Sin validar / válido /
   advertencias / errores). Botones **Validar RemoteAdmin** y **Reparar RemoteAdmin**
   abren el modal de diagnóstico.
4. **Exportar**: cabecera → **Exportar RemoteAdmin**, **Permissions EXILED**,
   **Permissions LabAPI**. Se abre previsualización con estadísticas, advertencias y
   bloqueo de descarga si hay errores críticos.

## Formato `config_remoteadmin.txt` que entiende la página

- `Members:` → líneas `- <id>: <RolID>` con comentario `#` previo para nombre/notas.
  IDs admitidos: `<17 dígitos>@steam`, `<15-22 dígitos>@discord`, `<nombre>@northwood`.
- `Groups:` o `Roles:` → lista `- <RolID>` (se respeta el nombre original de sección).
- `Permissions:` → líneas `- <Permiso>: [RolID, ...]` con comentario `#` opcional.
- Propiedades por rol: `<RolID>_badge`, `_color`, `_cover`, `_hidden`, `_kick_power`,
  `_required_kick_power`. Las propiedades desconocidas (`<Rol>_future_setting`) se
  **conservan** sin modificarse.
- `override_password_role: RolID, ...` y ajustes globales (`enable_staff_access`, etc.).
- Se preservan: comentarios, líneas en blanco simples, indentación predominante,
  BOM, finales de línea LF/CRLF y claves futuras desconocidas (exportación por parches,
  no reescritura total: `buildRemoteAdminLinePatches` / `applyRemoteAdminLinePatches`).

## Miembros y grupos

- **Añadir miembro** (botón `+` / `Añadir Miembro` por categoría): abre `#member-modal`
  con valores por defecto (NO copia la badge de otros miembros):
  badge = etiqueta del grupo (`getRoleLabel`), color `default`, KP/RKP `1`,
  cover `true`, hidden `false`.
- **Editar**: conserva `roleName`/`oldRole` y permisos propios.
- **Eliminar**: quita al miembro (y renumera la vista con `updateOldRoles`).
- **Permisos por miembro** (`openMemberPermissionsModal`) y **por grupo**
  (`openPermissionsModal`): el grupo muestra ✅ todos / ⚠️ parcial (indeterminado,
  con lista “Sin permiso: …”) / ❌ ninguno; al guardar solo se aplican los cambios
  marcados.
- **Grupos**: `#btn-add-category` crea prefijos (`A`, `B`, `VIP`,solo letras/números/`_`,
  sin empezar por número); eliminar grupo pide confirmación.
- **Notas**: ascender/descender y renumerar **no modifican** `name` ni `notes`;
  el miembro conserva su comentario original byte a byte.

## Rangos, jerarquía y badges

Jerarquía canónica (`app.js:40`): `A, AA, B, C, D, E, F, G, H, I, J, K, L, M, N`
(`A` = rango más alto). Prefijos personalizados van al final en organización/renumeración.

Etiquetas de badge por prefijo (`ROLE_LABELS`, `app.js:44`):

| Prefijo | Etiqueta | Prefijo | Etiqueta |
|---|---|---|---|
| A | O5 | H | VIP II |
| AA | Overseer | I | VIP III |
| B | Director | J | VIP MAX |
| C | SubDirector | K | DiscordBoost I |
| D | Supervisor | L | DiscordBoost II |
| E | Admin | M | M |
| F | Mod | N | N |
| G | Donadores (VIP I) | | |

`getRoleLabel(prefix)` devuelve la etiqueta o el propio prefijo si no hay
mapeo. La etiqueta efectiva por grupo la da `getGroupBadgeLabel(prefix)` (híbrida):
si todos los miembros del grupo comparten un badge (ignorando vacíos/`default`),
usa ese badge detectado del archivo; si difieren, usa la tabla; si no hay mapeo,
el propio prefijo. Así cualquier plantilla funciona sin configuración.
`updateBadgeRank(badge, nuevoPrefijo)` deja la base del badge y
solo el rango destino, **esté en la posición que esté y sin apilar jamás**:
- `"O5 | o.O"` + `N` → `"N | o.O"`, y de vuelta + `A` → `"O5 | o.O"`.
- Rango en 1ª/2ª/3ª palabra con espacios o `|`/`/`/`:`: `"ELITE O5 FORCE"` + `B` →
  `"ELITE Director FORCE"`; `"D | o.O"` + `C` → `"SubDirector | o.O"`.
- IDs en mayúsculas con dígitos (`A1`, `AA10`, `EVENT20`, `VIP_1`); cortos como `a1`
  valen en cualquier caso como antes; palabras como `gta5`, `my-role2` o `TEAM` no
  se tocan.
- Etiquetas con o sin número (`VIP II 3` → `VIP III`); pilas previas colapsan
  (`"X O5 Director"` + `E` → `"X Admin"`); sin rango detectable se añade al final;
  `""` → etiqueta.
- Letras sueltas `A`–`N` solo al final o al inicio tras `|`/`/`/`:`: una `a` española
  en medio del texto o `A TOPE` nunca se tocan; `o.O`, `CAPITAN` intactos.

## Ascender / Descender de rango

Botones por miembro: **Ascender** (`ph-arrow-fat-line-up`) y **Descender**
(`ph-arrow-fat-line-down`), en acordeón y en tarjetas desktop. Abren `#promote-modal`
y `#demote-modal` (`index.html:459-503`).

- El selector solo lista grupos válidos según jerarquía (`getRoleHierarchyIndex`,
  `app.js:66`): ascender = índice menor (rango mayor), descender = índice mayor.
- Al confirmar (`moveMemberToGroup`, `app.js:~1868`):
  - conserva `name`, `notes`, `color`, `cover`, `hidden` intactos;
  - actualiza `badge` con `updateBadgeRank` (solo la parte del rango, a la etiqueta destino);
  - adopta `permissions`, `kickPower`, `reqKickPower` del primer miembro del grupo
    destino (o valores base si está vacío);
  - mueve el miembro al final del grupo destino.
- Nunca se copia la badge/color de otro miembro existente.
- **Reorganizar IDs** (`buildRemoteAdminIdRenumbering`) solo renombra IDs internas y
  sus referencias (Members, Roles, Permissions, `override_password_role`,
  propiedades `*_badge` etc. como claves); verifica integridad releyendo el texto y
  **preserva nombre, notas, badge, color y poderes por SteamID**.

## Carga masiva de badges (botón externo)

Botón externo **“Carga masiva de badges”** (`#btn-badge-bulk`, barra `Grupos & Miembros`)
→ modal `#badge-bulk-modal`. Es el único botón de carga masiva visible.

Formato por registro:
```text
badge de: @Nombre
_badge: Texto del badge
_color: orange
_steamID: 76561199835925257
```
- El orden de campos es flexible; las claves son insensibles a mayúsculas/espacios.
- Valida: propietario (`@` + nombre), `_badge` no vacío, `_color` existente en el
  selector (con sugerencia por distancia de edición), `_steamID` SteamID64 válido
  de 17 dígitos sin `@steam`.
- Detecta duplicados idénticos (omitir) vs. conflictivos (cancelar), SteamIDs ya
  existentes (reemplazar/actualizar/omitir) y conflictos de rol compartido.
- Acciones por fila: añadir / usar registro / omitir / reemplazar / actualizar /
  cancelar. Solo se habilita **Confirmar importación** si hay registros listos y la
  configuración no cambió desde la vista previa.

> Nota: existe además un modal antiguo de “Carga Masiva de Miembros” (`#bulk-modal`,
> `openBulkModal`) pero actualmente **no tiene botón visible dentro de las categorías**
> (se retiró a petición); solo queda la carga masiva de badges.

## Diagnóstico y reparación

Modal `#remoteadmin-diagnostics-modal` con contadores (errores / advertencias /
información / reparables / requieren decisión), buscador y filtro, selección múltiple.

- **Errores críticos** (bloquean descarga): secciones faltantes/duplicadas, sintaxis
  inválida, IDs inválidos o duplicados, roles inexistentes referenciados, propiedades
  obligatorias faltantes, booleanos/kick powers inválidos, colores no admitidos.
- **Reparación segura** (un clic, con rollback si pierde datos): `@steam` duplicado o
  faltante, duplicados exactos de miembro/propiedad/permiso, normalización de
  mayúsculas en colores/booleanos, `:` faltante inequívoco, espacios finales y líneas
  en blanco redundantes.
- **Requieren decisión**: duplicados conflictivos (elegir línea a conservar o combinar
  permisos), roles duplicados, IDs internas compartidas.
- Historial de reparaciones (hasta 20) con **deshacer última / deshacer todas** y
  **restaurar original** de la sesión.

## Organizar RemoteAdmin

Botón **Organizar RemoteAdmin** en la previsualización (`#btn-organize-remoteadmin`):
ordena Members, Roles/Groups, bloques de propiedades y listas de roles en permisos
según jerarquía + orden numérico (`F1, F2, F10`), limpia espacios finales y líneas
en blanco dobles. Incluye comparación Original/Organizado, métricas y verificación
(semántica equivalente, idempotente, relectura válida). Solo se puede aplicar si no
introduce bloqueos propios.

## Reorganizar IDs

Botón **Reorganizar IDs** (`#btn-renumber-remoteadmin`): compacta sufijos por prefijo
(`D1, D2, D5, D10 → D1…D4`), reutiliza IDs declaradas sin uso y huecos no declarados,
respeta IDs marcadas como reservadas en comentarios (`reservada/reserved/no renumerar`),
actualiza todas las referencias (Members, Roles, Permissions, `override_password_role`,
propiedades) con coincidencia por token exacto (nunca convierte `D1` dentro de `D10`),
verifica integridad (mismos usuarios, mismos badges/colores) e idempotencia, con tabla
antes/después y opción de deshacer.

## Exportación

Modal `#export-modal` con resumen (usuarios / grupos / permisos únicos), nombre de
archivo `.txt` y formato detectado (UTF-8, BOM, LF/CRLF, línea final).

- **RemoteAdmin** (`#config-output`): regenerado por parches + validación
  (`validateGeneratedRemoteAdminContent`); descarga bloqueada si `valid == false`.
- **EXILED** (`permissions-exiled.yml`) y **LabAPI** (`permissions-labapi.yml`):
  YAML con grupo reservado (`user` / `default`), sin herencia, política
  `export-permission-policy`: `safe` (listas vacías + avisos) o `wildcard` (`.*` con
  aviso explícito). Los SteamID/badges/colores **no** se serializan aquí: permanecen
  en RemoteAdmin (se avisa).
- Botones: copiar pestaña actual, descargar pestaña actual, diagnóstico, organizar,
  reorganizar, aplicar/cancelar y deshacer reorganización.

## Tests

`tests/app.logic.test.cjs` (Node ≥18): carga `app.js` en `vm` con DOM simulado y expone
hooks (`parseConfig`, `generateConfig`, `buildRemoteAdminExport`, `buildRemoteAdminOrganization`,
`buildRemoteAdminIdRenumbering`, `parseBadgeBulkText`, `validateBadgeBulkRecords`,
`applyBadgeBulkImport`, `buildPermissionsExport`, …). Cubre: round-trip lossless byte a
byte (`tests/fixtures/remoteadmin-lossless.txt`), CRLF/BOM, organización por jerarquía,
renumeración por rangos, validaciones bloqueantes, badges masivos y comprobaciones de
HTML/CSS (CDNs versionados, CSP, IDs únicos y referenciados).

## Idioma ES/EN

- Desplegable `#lang-select` en la cabecera (Español/English); la elección persiste en
  `localStorage` (`ra-lang`) y el español es el idioma por defecto.
- Todo el texto visible vive en `STRINGS = { es: {...}, en: {...} }` (`app.js`) y se
  obtiene con `t('seccion.clave', {var})`; el HTML estático usa atributos
  `data-i18n` / `data-i18n-ph` / `data-i18n-aria` / `data-i18n-title` aplicados por
  `applyI18n()`. Los nombres propios no se traducen: IDs, roles, badges, colores,
  permisos nativos, `RemoteAdmin`/`EXILED`/`LabAPI` ni el contenido del archivo.
- `setLanguage(lang)` reaplica la interfaz, re-renderiza el editor y regenera los
  paneles abiertos (diagnóstico, exportación, organización, renumeración) sin perder
  su estado.
- Los tests verifican paridad total de claves ES/EN, idioma por defecto y diagnósticos
  en ambos idiomas.

## Seguridad y accesibilidad

- `Content-Security-Policy` en `index.html:6`, `referrer=no-referrer`, sin `object-src`.
- `escapeHtml` en todo contenido importado antes de inyectarlo al DOM.
- Modales con `role=dialog`, `aria-modal`, foco inicial, trampa de `Tab` y cierre con `Escape`.
- Confirmaciones (`confirm`/`prompt`) antes de eliminaciones y decisiones ambiguas.
