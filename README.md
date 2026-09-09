# SCP:SL Config Manager

Página para manejar el staff y los rangos de tu servidor de **SCP: Secret Laboratory**
de forma fácil, sin tener que editar el archivo de configuración a mano.
Hecho por JuanSAYAMAN y Remix.

Todo funciona en tu navegador, nada se sube a internet.

## Qué necesitas

Solo tu archivo **`config_remoteadmin.txt`** del servidor (es donde están guardados
los rangos, los miembros y sus permisos).

## Cómo se usa (paso a paso)

### 1. Cargar tu configuración
- Pega el contenido de tu archivo en el cuadro de texto **o** súbelo con el botón
  **Subir Archivo .txt**.
- Pulsa **Leer Configuración**.
- Si algo no es válido, la página te avisará.

### 2. Ver y editar tus grupos y miembros
- Entra a la pestaña **Editor**. Ahí verás tus grupos (O5, Admin, Mod, VIP, etc.)
  y las personas de cada uno.
- Puedes **buscar** a alguien por nombre con la barra de búsqueda.
- Por cada persona puedes:
  - **Editar**: cambiar nombre, notas, ID, badge (el texto que se ve en el juego),
    color, y poderes.
  - **Permisos**: marcar o quitar lo que puede hacer.
  - **Ascender / Descender**: moverla a un rango mayor o menor con un clic. Conserva
    su nombre y sus notas; solo se actualiza la parte del rango en su badge.
  - **Eliminar**: sacarla del grupo.
- Con **Añadir Miembro** agregas a alguien nuevo a un grupo, y con **Añadir Grupo**
  creas un rango nuevo.

### 3. Revisar que todo esté bien
- El indicador de arriba te dice si hay **errores** o **advertencias**.
- **Validar RemoteAdmin** te muestra la lista de problemas explicados uno por uno.
- **Reparar RemoteAdmin** arregla solo los problemas seguros automáticamente.
- Si la descarga está bloqueada, es porque hay errores que debes corregir primero.

### 4. Ordenar y exportar
- **Organizar RemoteAdmin**: ordena tu archivo de forma limpia sin borrar nada.
- **Reorganizar IDs**: acomoda la numeración interna (A1, A2, A3…) sin cambiar
  nombres, notas ni badges de nadie.
- **Exportar RemoteAdmin**: genera tu archivo nuevo. Revísalo y pulsa
  **Descargar**, luego súbelo a tu servidor.
- También puedes exportar los permisos para **EXILED** o **Lab API** si tu servidor
  usa esos sistemas.

### 5. Extras útiles
- **Carga masiva de badges**: agrega muchas badges de una sola vez pegando una lista.
- **Idioma**: cambia entre español e inglés con la lista de la parte superior.
  La página recuerda tu elección.
- En celular se ve por secciones desplegables y en computadora se ve dividido en
  categorías y tarjetas.

## Consejos

- Guarda siempre una **copia de tu archivo original** antes de subir el nuevo.
- Si un botón de descarga no te deja descargar, abre el **Diagnóstico** y resuelve
  los errores marcados en rojo.
- Los nombres y notas de tus usuarios **nunca se cambian solos**: solo cambian si
  tú los editas.
