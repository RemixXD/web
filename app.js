// State
const DEFAULT_SETTINGS = Object.freeze({
    enable_staff_access: 'false',
    enable_manager_access: 'true',
    enable_banteam_access: 'true',
    enable_banteam_reserved_slots: 'true',
    enable_banteam_bypass_geoblocking: 'true',
    override_password: 'none',
    allow_central_server_commands_as_ServerConsoleCommands: 'false',
    enable_predefined_ban_templates: 'true',
    PredefinedBanTemplates: ' - [0, Warn]\n - [3600, earrape]\n - [43200, N-word o discriminación (primera vez)]\n - [259200, N-word o discriminación (segunda vez)]\n - [604800, N-word o discriminación (tercera vez)]\n - [1577000000, Abuso de exploits y/o hacks]'
});

const MEMBER_PROPERTY_NAMES = new Set([
    'badge', 'color', 'cover', 'hidden', 'kick_power', 'required_kick_power'
]);

const DEFAULT_PERMISSION_LIST = Object.freeze([
    'KickingAndShortTermBanning', 'BanningUpToDay', 'LongTermBanning',
    'ForceclassSelf', 'ForceclassToSpectator', 'ForceclassWithoutRestrictions',
    'GivingItems', 'WarheadEvents', 'RespawnEvents', 'RoundEvents', 'SetGroup',
    'GameplayData', 'Overwatch', 'FacilityManagement', 'PlayersManagement',
    'PermissionsManagement', 'ServerConsoleCommands', 'ViewHiddenBadges',
    'ServerConfigs', 'Broadcasting', 'PlayerSensitiveDataAccess', 'Noclip',
    'AFKImmunity', 'AdminChat', 'ViewHiddenGlobalBadges', 'Announcer',
    'Effects', 'FriendlyFireDetectorImmunity', 'FriendlyFireDetectorTempDisable',
    'ServerLogLiveFeed', 'ExecuteAs', 'Vanish'
]);

const DEFAULT_BADGE_COLORS = Object.freeze([
    'pink', 'red', 'brown', 'silver', 'light_green', 'crimson', 'cyan', 'aqua',
    'deep_pink', 'tomato', 'yellow', 'magenta', 'blue_green', 'orange', 'lime',
    'green', 'emerald', 'carmine', 'nickel', 'mint', 'army_green', 'pumpkin', 'default'
]);

const STEAM_ID_64_PATTERN = /^\d{17}$/;
const STEAM_ID_64_MIN = '76561197960265729';
const STEAM_ID_64_MAX = '76561202255233023';
const BADGE_BULK_ACTIONS = new Set(['import', 'omit', 'replace', 'update', 'cancel']);
const REMOTE_ADMIN_ROLE_HIERARCHY = Object.freeze([
    'A', 'AA', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N'
]);

const ROLE_LABELS = Object.freeze({
    'A': 'O5',
    'AA': 'Overseer',
    'B': 'Director',
    'C': 'SubDirector',
    'D': 'Supervisor',
    'E': 'Admin',
    'F': 'Mod',
    'G': 'Donadores (VIP I)',
    'H': 'VIP II',
    'I': 'VIP III',
    'J': 'VIP MAX',
    'K': 'DiscordBoost I',
    'L': 'DiscordBoost II',
    'M': 'M',
    'N': 'N'
});

function getRoleLabel(prefix) {
    return ROLE_LABELS[String(prefix || '')] || String(prefix || '');
}

function getSharedGroupBadge(prefix, state = parsedData) {
    const key = String(prefix || '');
    const group = state?.groups?.[key];
    if (!group || !Array.isArray(group.members)) return null;
    const vals = [];
    group.members.forEach(member => {
        const badge = String(member?.badge ?? '').trim();
        if (!badge || badge.toLowerCase() === 'default') return;
        if (!vals.some(v => v.toLowerCase() === badge.toLowerCase())) vals.push(badge);
    });
    if (vals.length !== 1) return null;
    if (group.isNumbered && group.members.length < 2) return null;
    return vals[0];
}

function getGroupBadgeLabel(prefix, state = parsedData) {
    const key = String(prefix || '');
    const shared = getSharedGroupBadge(key, state);
    if (shared) return shared;
    if (ROLE_LABELS[key] !== undefined) return ROLE_LABELS[key];
    return key;
}

function groupLabelSuffix(prefix) {
    try {
        const label = getGroupBadgeLabel(prefix);
        if (label && String(label).toLowerCase() !== String(prefix || '').toLowerCase()) {
            return ` <span class="group-label" style="color: var(--text-muted); font-size: 0.75rem; font-weight: 400;">· ${escapeHtml(label)}</span>`;
        }
    } catch (_) {}
    return '';
}

function getDetectedRankTokens() {
    const out = [];
    try {
        Object.keys(parsedData.groups || {}).forEach(prefix => {
            const label = getSharedGroupBadge(prefix, parsedData);
            if (label && !out.some(v => v.toLowerCase() === label.toLowerCase())) out.push(label);
        });
    } catch (_) {}
    return out;
}

function getRoleHierarchyIndex(prefix) {
    const idx = REMOTE_ADMIN_ROLE_HIERARCHY.indexOf(String(prefix || '').toUpperCase());
    return idx >= 0 ? idx : REMOTE_ADMIN_ROLE_HIERARCHY.length;
}

function escapeRegExpToken(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Mantiene la base del badge y sustituye la parte del rango por la etiqueta del grupo destino,
// esté en la posición que esté (primera, intermedia o última palabra) y sin apilar:
// "O5 | o.O" + "N" -> "N | o.O" -> +"A" -> "O5 | o.O".
// - IDs en mayúsculas con dígitos (A1, AA10, EVENT20, VIP_1) en cualquier posición.
// - Etiquetas conocidas ("O5", "VIP II", "Director"...) en cualquier posición, con o sin número.
// - Letras sueltas A-N solo al inicio (mayúscula exacta) o al final: una "a" española
//   en medio del texto nunca se toca. Palabras normales ("TEAM", "CAPITAN", "o.O") intactas.
// Mantiene la base del badge y deja solo el rango destino, esté en la posición que esté
// (primera, intermedia o última palabra) y sin apilar jamás:
// "O5 | o.O" + "N" -> "N | o.O" -> +"A" -> "O5 | o.O".
// - IDs en mayúsculas con dígitos (A1, AA10, EVENT20, VIP_1) en cualquier posición.
// - Etiquetas conocidas ("O5", "VIP II", "Director"...) en cualquier posición, con o sin número.
// - Letras sueltas A-N: solo al final (cualquier caso) o al inicio tras | / : en mayúscula
//   exacta. Así una "a" española en medio del texto o "A TOPE" nunca se tocan.
// - Palabras normales ("TEAM", "CAPITAN", "o.O", "amo a mi clan") quedan intactas.
function updateBadgeRank(currentBadge, newPrefix) {
    const label = getGroupBadgeLabel(newPrefix);
    const tidy = (str) => String(str || '').replace(/\s+/g, ' ')
        .replace(/\s*([|/:])(\s*[|/:])+\s*/g, ' $1 ')
        .replace(/^[|/:]\s+|\s+[|/:]$/g, '')
        .trim();
    const sameAsTarget = (tok) => String(tok || '').toLowerCase() === String(label || '').toLowerCase();
    const SEP = '[\\s|/:]';
    const idSrc = `(^|${SEP})([A-Za-z_][A-Za-z0-9_.-]*)(?=${SEP}|$)`;
    // Token tipo ID de rango: empieza por letra/_ y contiene un dígito. Los cortos
    // (<=2 letras: a1, D5, AA10) valen en cualquier caso como antes; los largos
    // (EVENT20, VIP_1) solo en mayúsculas para no comerse palabras ("gta5", "top10").
    const isRankIdToken = (tok) => {
        const t = String(tok || '');
        if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(t)) return false;
        if (!/\d/.test(t)) return false;
        const letters = t.replace(/[^A-Za-z]/g, '');
        if (letters.length <= 2) return true;
        return /^[A-Z_][A-Z0-9_.-]*$/.test(t);
    };
    const multiCands = [...new Set([...getDetectedRankTokens(), ...Object.values(ROLE_LABELS).filter(v => v && v.length >= 2), ...REMOTE_ADMIN_ROLE_HIERARCHY.filter(p => p.length >= 2)])].sort((a, b) => b.length - a.length);
    const labelSrc = (cand) => `(^|${SEP})${escapeRegExpToken(cand)}(?:\\s+\\d+)?(?=${SEP}|$)`;
    const singleTrailSrc = `${SEP}([A-N])\\s*$`;
    const singleLeadSrc = `^([A-N])(?=\\s*[|/:])`;
    const coreOf = (m, p1) => String(m || '').slice(String(p1 || '').length).replace(/(?:\s+\d+)?$/, '').trim();
    const collectToks = (s, src, flags, group) => {
        const toks = [];
        s.replace(new RegExp(src, flags), function () {
            toks.push(arguments[group]);
            return arguments[0];
        });
        return toks;
    };
    const hasTarget = (s) => {
        if (collectToks(s, idSrc, 'g', 2).filter(isRankIdToken).some(sameAsTarget)) return true;
        for (const cand of multiCands) {
            const rx = new RegExp(labelSrc(cand), 'gi');
            let m;
            rx.lastIndex = 0;
            let found = false;
            while (!found && (m = rx.exec(s)) !== null) {
                if (sameAsTarget(coreOf(m[0], m[1]))) found = true;
                if (m[0].length === 0) rx.lastIndex++;
            }
            if (found) return true;
        }
        if (collectToks(s, singleTrailSrc, 'gi', 1).concat(collectToks(s, singleLeadSrc, 'g', 1)).some(sameAsTarget)) return true;
        return false;
    };
    const dropOthers = (s) => {
        let out = s.replace(new RegExp(idSrc, 'g'), (m, p1, tok) => (!isRankIdToken(tok) || sameAsTarget(tok)) ? m : (p1 || ''));
        for (const cand of multiCands) {
            out = out.replace(new RegExp(labelSrc(cand), 'gi'), (m, p1) => {
                if (!sameAsTarget(coreOf(m, p1))) return (p1 || '');
                const normal = `${p1}${label}`;
                return m === normal ? m : normal;
            });
        }
        out = out.replace(new RegExp(singleTrailSrc, 'gi'), (m, tok) => sameAsTarget(tok) ? m : '');
        out = out.replace(new RegExp(singleLeadSrc, 'g'), (m, tok) => sameAsTarget(tok) ? m : '');
        return out;
    };
    const replaceFirstOther = (s) => {
        let done = false;
        let out = s.replace(new RegExp(idSrc, 'g'), (m, p1, tok) => {
            if (!done && isRankIdToken(tok) && !sameAsTarget(tok)) { done = true; return `${p1}${label}`; }
            return m;
        });
        if (!done) for (const cand of multiCands) {
            const rx = new RegExp(labelSrc(cand), 'gi');
            let hit = false;
            out = s.replace(rx, (m, p1) => {
                if (!hit && !sameAsTarget(coreOf(m, p1))) { hit = true; return `${p1}${label}`; }
                return m;
            });
            if (hit) { done = true; break; }
        }
        if (!done) {
            const tm = s.match(new RegExp(singleTrailSrc, 'i'));
            if (tm && !sameAsTarget(tm[1])) {
                out = s.replace(new RegExp(singleTrailSrc, 'i'), ` ${label}`);
                done = true;
            } else {
                const lm = s.match(new RegExp(singleLeadSrc));
                if (lm && !sameAsTarget(lm[1])) {
                    out = s.replace(new RegExp(singleLeadSrc), label);
                    done = true;
                }
            }
        }
        return done ? out : null;
    };
    let s = tidy(currentBadge);
    if (!s) return label;
    for (let guard = 0; guard < 20; guard++) {
        if (hasTarget(s)) return tidy(dropOthers(s)) || label;
        const next = replaceFirstOther(s);
        if (next === null) return `${s} ${label}`;
        s = tidy(next);
        if (!s) return label;
    }
    return s;
}

// ============================
// Idioma / Language (ES/EN)
// ============================
const SUPPORTED_LANGS = Object.freeze(['es', 'en']);
const STRINGS = { es: {}, en: {} };
let currentLang = 'es';
try {
    const storedLang = (typeof localStorage !== 'undefined' && typeof localStorage.getItem === 'function')
        ? localStorage.getItem('ra-lang') : null;
    if (storedLang === 'es' || storedLang === 'en') currentLang = storedLang;
} catch (_) { /* sin almacenamiento persistente (tests) */ }

function t(key, params) {
    const lookup = (dict) => String(key || '').split('.').reduce(
        (node, part) => (node && typeof node === 'object' ? node[part] : undefined), dict);
    let value = lookup(STRINGS[currentLang]);
    if (value === undefined) value = lookup(STRINGS.es);
    if (typeof value !== 'string') return String(key || '');
    if (!params) return value;
    return value.replace(/\{(\w+)\}/g, (m, name) => (
        params[name] === undefined || params[name] === null ? '' : String(params[name])));
}

function applyI18n() {
    if (typeof document === 'undefined' || !document.querySelectorAll) return;
    document.querySelectorAll('[data-i18n]').forEach((el) => {
        if (el && typeof el.getAttribute === 'function') {
            const v = t(el.getAttribute('data-i18n'));
            if (v) el.textContent = v;
        }
    });
    document.querySelectorAll('[data-i18n-ph]').forEach((el) => {
        if (el && typeof el.setAttribute === 'function' && typeof el.getAttribute === 'function') {
            el.setAttribute('placeholder', t(el.getAttribute('data-i18n-ph')));
        }
    });
    document.querySelectorAll('[data-i18n-aria]').forEach((el) => {
        if (el && typeof el.setAttribute === 'function' && typeof el.getAttribute === 'function') {
            el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria')));
        }
    });
    document.querySelectorAll('[data-i18n-title]').forEach((el) => {
        if (el && typeof el.setAttribute === 'function' && typeof el.getAttribute === 'function') {
            el.setAttribute('title', t(el.getAttribute('data-i18n-title')));
        }
    });
    const langSelect = (typeof document.getElementById === 'function') ? document.getElementById('lang-select') : null;
    if (langSelect && 'value' in langSelect) {
        try { langSelect.value = currentLang; } catch (_) {}
    }
    if (typeof document !== 'undefined' && document.documentElement) {
        try { document.documentElement.lang = currentLang; } catch (_) {}
    }
}

function setLanguage(lang, options = {}) {
    if (!SUPPORTED_LANGS.includes(lang)) return currentLang;
    currentLang = lang;
    try {
        if (typeof localStorage !== 'undefined' && typeof localStorage.setItem === 'function') {
            localStorage.setItem('ra-lang', lang);
        }
    } catch (_) {}
    applyI18n();
    if (options.render === false) return currentLang;
    try {
        if (typeof renderRAEditor === 'function' && hasLoadedRemoteAdmin && currentMode === 'ra') renderRAEditor();
    } catch (_) {}
    try {
        if (typeof updateRemoteAdminHealth === 'function') updateRemoteAdminHealth(activeRemoteAdminDiagnostics || null);
    } catch (_) {}
    try {
        if (typeof diagnosticsModal !== 'undefined' && diagnosticsModal && diagnosticsModal.classList && diagnosticsModal.classList.contains('active')) {
            refreshRemoteAdminDiagnostics({ render: true });
        }
    } catch (_) {}
    try {
        if (typeof exportModal !== 'undefined' && exportModal && exportModal.classList && exportModal.classList.contains('active')) {
            const orgVisible = remoteAdminOrganizationPanel && !remoteAdminOrganizationPanel.hidden;
            const renVisible = remoteAdminIdRenumberPanel && !remoteAdminIdRenumberPanel.hidden;
            const keptOrg = orgVisible ? activeRemoteAdminOrganization : null;
            const keptRen = renVisible ? activeRemoteAdminIdRenumber : null;
            if (activePermissionsExportFramework) renderPermissionsExportPreview(activePermissionsExportFramework, false);
            else if (activeRemoteAdminExportResult && currentMode === 'ra') renderRemoteAdminExportPreview(false, false);
            if (keptOrg) renderRemoteAdminOrganizationComparison(keptOrg);
            if (keptRen) renderRemoteAdminIdRenumberPreview(keptRen);
        }
    } catch (_) {}
    return currentLang;
}

Object.assign(STRINGS.es, {
    _langName: 'Español',
    diag: {
        title: 'Diagnóstico RemoteAdmin',
        closeAria: 'Cerrar diagnóstico',
        countsAria: 'Totales del diagnóstico',
        searchPh: 'Buscar código, ID, usuario o mensaje…',
        searchAria: 'Buscar diagnóstico',
        show: 'Mostrar',
        filterAll: 'Todos',
        filterError: 'Errores críticos',
        filterWarning: 'Advertencias',
        filterInfo: 'Información',
        filterSafe: 'Reparación segura',
        filterConfirm: 'Requieren decisión',
        selectionAria: 'Selección de problemas',
        selectVisible: 'Seleccionar visibles',
        clearSelection: 'Limpiar selección',
        undoRepair: 'Deshacer última reparación',
        undoAll: 'Deshacer todos los cambios',
        restoreOriginal: 'Restaurar original',
        resolveSelected: 'Resolver seleccionados',
        resolveSafe: 'Resolver problemas seguros',
        countErrors: 'Errores críticos',
        countWarnings: 'Advertencias',
        countInfo: 'Información',
        countRepairable: 'Reparables',
        countDecisions: 'Requieren decisión',
        summary: '{users} usuario(s), {roles} ID(s) interna(s), {perms} permiso(s). {tail}',
        summaryOk: 'Sin errores críticos.',
        summaryBlocked: 'La exportación permanece bloqueada por errores críticos.',
        emptyFiltered: 'Ningún diagnóstico coincide con el filtro.',
        emptyClean: 'RemoteAdmin analizado correctamente. No se encontraron problemas.',
        selManual: 'Puedes seleccionarlo para incluirlo en el resumen; requerirá edición manual.',
        selConfirm: 'Al resolver la selección se solicitará una decisión antes de modificarlo.',
        selSafe: 'Este problema admite una reparación automática segura.',
        selAria: 'Seleccionar {code}',
        sevError: 'Error crítico',
        sevWarning: 'Advertencia',
        sevInfo: 'Información',
        repairSafe: 'Reparación segura',
        repairConfirm: 'Requiere decisión',
        repairManual: 'Edición manual',
        actResolve: 'Resolver',
        actReviewDecision: 'Revisar decisión',
        actReview: 'Revisar',
        actGoto: 'Ir al problema',
        actIgnore: 'Ignorar',
        actUnignore: 'Dejar de ignorar',
        locLine: ' · línea {line}',
        locRole: ' · ID {role}',
        locAffects: ' · Afecta: {list}',
        resolveSelectedN: 'Resolver seleccionados ({n})',
        resolveSafeN: 'Resolver problemas seguros ({n})',
        secProps: 'Propiedades',
        secGlobal: 'Configuración global',
        secFormat: 'Formato'
    },
    nav: {
        import: 'Importar',
        editor: 'Editor',
        language: 'Idioma'
    },
    header: {
        exportRa: 'Exportar RemoteAdmin',
        exiled: 'Permissions EXILED',
        labapi: 'Permissions Lab API'
    },
    mode: {
        ra: '🛡️ Modo: Remote Admin',
        invalidFile: 'El archivo no es una configuración válida de Remote Admin.'
    },
    common: {
        cancel: 'Cancelar',
        close: 'Cerrar',
        save: 'Guardar',
        add: 'Añadir',
        delete: 'Eliminar',
        edit: 'Editar',
        warnings: 'Advertencias',
        noWarnings: 'Sin advertencias.',
        search: 'Buscar',
        copy: 'Copiar',
        download: 'Descargar',
        confirm: 'Confirmar'
    },
    importView: {
        title: 'Importar Configuración Actual',
        desc: 'Pega aquí el contenido completo de tu archivo de configuración del Remote Admin (config_remoteadmin.txt).',
        configLabel: 'Contenido de la configuración',
        configPh: '# Pega aquí tu configuración...',
        parse: 'Leer Configuración',
        upload: 'Subir Archivo .txt',
        empty: 'Por favor, pega la configuración.'
    },
    editor: {
        title: 'Grupos & Miembros',
        searchPh: 'Buscar miembro...',
        searchAria: 'Buscar miembro',
        validate: 'Validar RemoteAdmin',
        repair: 'Reparar RemoteAdmin',
        badgeBulk: 'Carga masiva de badges',
        addGroup: 'Añadir Grupo',
        addCategoryTitle: 'Añadir Categoría'
    },
    health: {
        pending: 'Sin validar',
        valid: 'RemoteAdmin válido',
        warnings: '{count} advertencia(s)',
        errors: '{count} error(es)'
    },
    action: {
        copied: '¡Copiado!',
        copyFail: 'No se pudo copiar automáticamente. Selecciona el texto y cópialo manualmente.',
        downloadBlocked: 'El archivo RemoteAdmin contiene errores bloqueantes. Revisa la previsualización antes de descargar.',
        downloadFail: 'No se pudo descargar el archivo: {error}',
        downloadFailBrowser: 'el navegador rechazó la descarga.',
        permsBlocked: 'La configuración contiene errores bloqueantes. Revisa la previsualización antes de descargar.'
    },
    healthExtra: {
        blockDownload: '{count} error(es) crítico(s) bloquean la descarga hasta resolverlos.'
    },
    member: {
        deleteConfirm: '¿Eliminar a este miembro?',
        invalidId: 'Introduce un ID válido: un ID numérico @steam/@discord o un usuario @northwood.',
        kickRange: 'Los valores de kick power deben estar entre 0 y 255.',
        addTitle: 'Añadir Miembro',
        closeAria: 'Cerrar formulario de miembro',
        name: 'Nombre',
        namePh: 'Ej. YAN',
        notes: 'Notas / Comentarios (Opcional)',
        notesPh: 'Ej. antes B3, vence 09 Junio...',
        steamId: 'SteamID (Obligatorio)',
        steamIdPh: 'Ej. 76561198841587908@steam',
        badge: 'Texto del Badge',
        badgePh: 'Ej. SERVER OWNER',
        color: 'Color del Badge',
        kickPower: 'Kick Power',
        reqKick: 'Req. Kick Power',
        cover: 'Cover',
        hidden: 'Hidden',
    },
    group: {
        newPrompt: 'Nombre del nuevo grupo (ej. A, B, VIP):',
        invalidName: 'El grupo solo puede contener letras, números y guiones bajos, y no puede comenzar con un número.',
        exists: 'El grupo "{prefix}" ya existe.',
        deleteConfirm: '¿Eliminar el Grupo {prefix} y a todos sus miembros?'
    },
    move: {
        selectTarget: 'Por favor selecciona un grupo de destino válido.',
        selectGroup: 'Selecciona un grupo...'
    },
    badgeIssue: {
        malformedLine: 'La línea no contiene una clave seguida de dos puntos.',
        unknownKey: 'La clave "{key}" no está reconocida y será ignorada.',
        duplicateField: 'La clave "{key}" está repetida; se utilizará su último valor.',
        missingOwner: 'Falta el valor obligatorio "badge de:".',
        emptyOwnerName: 'El valor de "badge de:" debe contener un nombre además de @.',
        ownerWithoutAt: 'El propietario no comienza con @; se conservará exactamente como fue escrito.',
        emptyBadge: 'El campo _badge no puede estar vacío.',
        missingColor: 'Falta el campo obligatorio _color.',
        invalidColor: 'El color "{color}" no existe en el selector actual.',
        colorSuggestion: ' ¿Quisiste escribir "{suggestion}"?',
        missingSteam: 'Falta el campo obligatorio _steamID.',
        invalidSteam: 'El valor debe ser un SteamID64 público individual de 17 dígitos, sin @steam.',
        dupInput: 'SteamID repetido dentro del texto; coincide con el registro {n}.',
        conflictInput: 'SteamID repetido con información diferente al registro {n}.',
        dupExisting: 'El SteamID ya aparece más de una vez en RemoteAdmin; corrige esa ambigüedad antes de importar.',
        existDup: 'El SteamID ya existe en el rol {role} con los mismos datos.',
        existConflict: 'El SteamID ya existe en el rol {role} con información diferente.',
        sharedConflict: 'El rol {role} es compartido por varios usuarios; RemoteAdmin no admite un badge o color individual.',
        targetRequired: 'Selecciona un grupo para los SteamID nuevos.',
        targetNotFound: 'El grupo destino "{group}" no existe.',
        sharedBatch: 'El grupo {group} está vacío y otro registro propone un badge o color distinto; elige una sola combinación.',
        sharedTarget: 'El grupo {group} usa un rol compartido; el badge y color deben coincidir con los del rol.',
        multiMutations: 'Hay más de una acción de reemplazo o actualización para el SteamID {steam}; selecciona solo una.',
        multiShared: 'Hay varias combinaciones de badge y color seleccionadas para el rol compartido {group}; elige solo una.',
        steamChanged: 'El SteamID {steam} apareció después de la vista previa y fue omitido.',
        targetUnavailable: 'El grupo destino ya no está disponible.',
        sharedStale: 'El grupo {group} usa un rol compartido; el badge y color ya no coinciden con los del rol.',
        notUnique: 'No se pudo resolver de forma única el SteamID {steam}.'
    },
    badgeBulk: {
        notAnalyzed: 'Sin analizar.',
        needRecords: 'Pega al menos un registro para analizarlo.',
        selectGroup: 'Selecciona un grupo',
        statusValid: 'Válido',
        statusWarning: 'Válido con avisos',
        statusDuplicate: 'Duplicado',
        statusConflict: 'Conflicto',
        statusInvalid: 'Inválido',
        noIssues: 'Sin errores.',
        lineIssue: 'Línea {line}: {message}',
        actionFor: 'Acción para SteamID {id}',
        actCancel: 'Cancelar registro',
        actOmit: 'Omitir',
        actReplace: 'Reemplazar existente',
        actUpdate: 'Actualizar campos modificados',
        actImport: 'Usar este registro',
        actImportCombo: 'Usar esta combinación',
        actAdd: 'Añadir',
        sumTotal: 'Total',
        sumValid: 'Válidos',
        sumInvalid: 'Inválidos',
        sumDupes: 'Duplicados/conflictos',
        sumOmitted: 'Omitidos/cancelados',
        applyHeading: 'Hay registros pendientes de corregir:',
        applyRecord: 'Registro {n}, ',
        applyLine: '{prefix}línea {line}: {message}',
        applyInvalid: ' {count} registro(s) inválido(s) permanecen en la vista previa.',
        changedAfter: 'La configuración RemoteAdmin cambió después de la vista previa. Analiza nuevamente los registros.',
        multiMutationsAlert: 'Hay varias acciones mutantes para el mismo SteamID. Conserva solo una antes de confirmar.',
        multiSharedAlert: 'Hay varias combinaciones de badge y color seleccionadas para el mismo rol compartido. Conserva solo una.',
        title: 'Carga masiva de badges',
        closeAria: 'Cerrar carga masiva de badges',
        intro: 'Pega uno o varios registros. Los datos se analizarán y previsualizarán antes de modificar la configuración actual.',
        inputLabel: 'Registros de badges',
        inputPh: 'badge de: @Endercruz\n_badge: Endercruz\n_color: orange\n_steamID: 76561199835925257',
        targetGroup: 'Grupo de destino',
        analyze: 'Analizar y previsualizar',
        clear: 'Limpiar',
        previewAria: 'Vista previa de la carga masiva de badges',
        caption: 'Registros analizados antes de confirmar la importación',
        thLine: 'Línea',
        thOwner: 'Nota o propietario',
        thBadge: 'Badge',
        thColor: 'Color',
        thSteam: 'SteamID64',
        thStatus: 'Estado',
        thIssue: 'Error o advertencia',
        thAction: 'Acción',
        confirm: 'Confirmar importación',
        finished: 'Carga finalizada: {imported} añadido(s), {replaced} reemplazado(s), {updated} actualizado(s), {omitted} omitido(s), {cancelled} cancelado(s) y {invalid} inválido(s).'
    },
    memberModal: {
        addToGroup: 'Añadir Miembro al Grupo {group}',
        edit: 'Editar Miembro'
    },
    permModal: {
        groupTitle: 'Permisos del Grupo {group}',
        memberTitle: 'Permisos de {name}'
    },
    bulkMembers: {
        added: 'Se añadieron {count} miembros al grupo {group}.',
        autoNote: 'Añadido masivamente'
    },
    bulk: {
        title: 'Carga Masiva de Miembros',
        descA: 'Pega tu lista de miembros. El sistema extraerá automáticamente el',
        ids: 'SteamID/DiscordID',
        and: 'y el',
        name: 'Nombre',
        listLabel: 'Lista de miembros',
        process: 'Procesar y Añadir',
        inputPh: 'Ej:\n76561198841587908@steam YAN\n123456789012345678@discord Usuario Dos',
        closeAria: 'Cerrar carga masiva'
    },
    promote: {
        title: 'Ascender a',
        closeAria: 'Cerrar ventana de ascenso',
        targetGroup: 'Grupo de destino',
        desc: 'El miembro mantendrá su badge (actualizando el rango), color, cover y hidden. Adoptará los permisos, Kick Power y Required Kick Power del grupo destino.',
        confirm: 'Confirmar Ascenso'
    },
    demote: {
        title: 'Descender a',
        closeAria: 'Cerrar ventana de descenso',
        targetGroup: 'Grupo de destino',
        desc: 'El miembro mantendrá su badge (actualizando el rango), color, cover y hidden. Adoptará los permisos, Kick Power y Required Kick Power del grupo destino.',
        confirm: 'Confirmar Descenso'
    },
    cards: {
        noResults: 'No se encontraron resultados.',
        groupName: 'Grupo {prefix}',
        noMembers: 'No hay miembros.',
        noName: 'Sin Nombre',
        promote: 'Ascender',
        demote: 'Descender',
        perms: 'Permisos',
        editBtn: 'Editar',
        hiddenYes: 'Sí',
        hiddenNo: 'No',
        permsCount: 'Permisos',
        categories: 'Categorías',
        categoryName: 'Categoría {name}',
        groupPerms: 'Permisos del Grupo',
        groupPermsTitle: 'Permisos del Grupo',
        addMember: 'Añadir Miembro',
        addMemberTitle: 'Añadir Miembro',
        noMembersInCat: 'No hay miembros en esta categoría.',
        promoteTitle: 'Ascender rango',
        promoteAria: 'Ascender rango del miembro',
        demoteTitle: 'Descender rango',
        demoteAria: 'Descender rango del miembro',
        permsTitle: 'Permisos',
        permsAria: 'Permisos del miembro',
        editAria: 'Editar miembro',
        deleteAria: 'Eliminar miembro',
        noPerms: 'Sin permiso: {list}',
        targetOpt: 'Grupo {prefix} ({label}) - {count} miembros',
        bulkTitle: 'Carga Masiva - Grupo {prefix}',
        sharedRole: ' (rol compartido)',
        deleteGroupTitle: 'Eliminar Grupo',
        deleteGroupAria: 'Eliminar grupo',
        deleteAria: 'Eliminar miembro',
        dragTitle: 'Arrastrar para reordenar'
    },
    repair: {
        rollbackParser: 'El parser no recuperó todas las secciones requeridas.',
        rollbackData: 'La comparación semántica detectó pérdida de datos.',
        rollbackNoChange: 'La reparación no resolvió el diagnóstico seleccionado.',
        rolledBack: 'La reparación fue revertida: {reason}',
        noSafeSelection: 'Las selecciones no contienen reparaciones automáticas seguras.',
        appliedSafe: 'Se aplicaron {count} reparación(es) seguras. El archivo fue analizado nuevamente.',
        applyFixConfirm: '¿Aplicar la corrección propuesta para {code}?',
        cannotApplyFix: 'No se pudo aplicar: {reason}',
        cannotApplyDefault: 'la corrección no produjo un resultado verificable.',
        parserLost: 'La resolución fue revertida porque el parser no pudo recuperar el archivo completo.',
        manualRequired: 'Este problema requiere editar el valor o elegir una relación válida; no se aplicó ningún cambio automático.',
        selectOne: 'Selecciona al menos un problema antes de continuar.',
        unresolvedManual: '{count} problema(s) seleccionado(s) requieren edición manual y no fueron modificados:\n{list}',
        unresolvedLine: ' (línea {line})',
        loadFirst: 'Primero carga una configuración RemoteAdmin.',
        undoBlocked: 'El contenido cambió después de la reparación; no se deshará automáticamente para evitar pérdida de trabajo.',
        undoAllConfirm: '¿Deshacer todas las reparaciones realizadas durante esta sesión?',
        restoreConfirm: '¿Restaurar el RemoteAdmin exactamente como se cargó al iniciar esta sesión?'
    },
    choice: {
        keepLine: 'Escribe la línea que deseas conservar:\n{list}',
        removeConflicts: 'Se eliminarán {count} asociación(es) conflictivas y se conservará la línea {line}. ¿Continuar?',
        keepValue: 'Escribe la línea cuyo valor deseas conservar:\n{list}',
        keepSingle: 'Se conservará una sola declaración de {name}. ¿Continuar?',
        combinePrompt: 'Escribe “combinar” para unir las IDs o la línea que deseas conservar:\n{list}',
        combineDefault: 'combinar',
        combineConfirm: 'Se combinarán las asignaciones duplicadas de {name}. ¿Continuar?',
        keepOneConfirm: 'Se conservará solamente la declaración de la línea {line}. ¿Continuar?',
        keepRole: 'Escribe la línea de {role} que deseas conservar:\n{list}',
        removeRoles: 'Se eliminarán {count} declaraciones duplicadas de {role}. ¿Continuar?'
    },
    export: {
        modalTitle: 'Nueva Configuración Generada',
        closeAria: 'Cerrar configuración generada',
        summaryTitle: 'Resumen de exportación',
        framework: 'Framework de destino:',
        statsAria: 'Totales de la exportación',
        statUsers: 'Usuarios',
        statGroups: 'Grupos exportados',
        statPerms: 'Permisos únicos',
        raOptionsAria: 'Opciones de exportación RemoteAdmin',
        filename: 'Nombre del archivo',
        filenameHelp: 'Se conservará el nombre del archivo importado siempre que sea posible.',
        formatLabel: 'Formato detectado',
        formatHelp: 'Texto compatible con la configuración cargada.',
        policy: 'Política para permisos sin equivalencia',
        policySafe: 'Conversión segura (recomendada)',
        policyWildcard: 'Comodín/referencia explícita (.*)',
        policyHelp: 'La opción segura conserva únicamente permisos con equivalencia conocida.',
        policyWildcardHelp: 'Advertencia: .* concede todos los permisos de todos los plugins a cada grupo.',
        policySafeHelp: 'Los permisos nativos de RemoteAdmin no se convierten en nodos de plugins sin un mapeo explícito.',
        tabRa: 'Remote Admin',
        tabExiled: 'Permissions EXILED',
        tabLabapi: 'Permissions Lab API',
        titleRa: 'Previsualización — RemoteAdmin',
        titlePerms: 'Previsualización — Permissions {framework}',
        formatDetail: 'Texto RemoteAdmin {ext} · {enc}{bom} · {le} · {final}',
        withBom: ' con BOM',
        withoutBom: ' sin BOM',
        finalLine: 'línea final presente',
        noFinalLine: 'sin línea final',
        issueError: 'Error',
        issueWarning: 'Aviso',
        needPreview: 'Primero carga una configuración válida de RemoteAdmin.',
        needPreviewValid: 'Primero genera una previsualización válida de RemoteAdmin.',
        undoRenumberTitle: 'El contenido cambió después de la renumeración y ya no puede deshacerse automáticamente.',
        diagnostics: 'Diagnóstico',
        organize: 'Organizar RemoteAdmin',
        renumber: 'Reorganizar IDs',
        undoRenumber: 'Deshacer reorganización',
        cancelOrg: 'Cancelar organización',
        applyOrg: 'Aplicar organización',
        applyRenumber: 'Aplicar reorganización',
        copyTab: 'Copiar Pestaña Actual',
        downloadTab: 'Descargar Pestaña Actual',
        analyzing: 'Analizando…',
        copyFail: 'No se pudo copiar automáticamente. Selecciona el texto y cópialo manualmente.'
    },
    issue: {
        blocking: 'Bloqueo',
        existing: 'Error existente',
        warning: 'Aviso',
        error: 'Error'
    },
    org: {
        statusOk: 'El archivo ya utiliza el orden jerárquico esperado.',
        statusSafe: 'La organización es segura y puede aplicarse. Los errores existentes seguirán bloqueando la descarga.',
        statusDone: 'Organización terminada. La relectura y la comparación semántica fueron correctas.',
        statusBlocked: 'El resultado se generó, pero contiene conflictos que deben resolverse antes de aplicarlo.',
        mUsers: 'usuarios',
        mGroups: 'grupos',
        mMembers: 'miembros movidos',
        mBlocks: 'bloques movidos',
        mLists: 'listas ordenadas',
        mBlanks: 'líneas vacías eliminadas',
        mWarnings: 'advertencias',
        mFileErrors: 'errores del archivo',
        mBlocking: 'bloqueos de organización',
        noIssues: 'Sin conflictos. Comentarios, propiedades desconocidas y datos semánticos conservados.',
        fail: 'No se pudo organizar RemoteAdmin: {error}',
        failStructural: 'el análisis estructural falló.',
        cannotApply: 'La organización no puede aplicarse porque no hay cambios o la transformación tiene un bloqueo propio.',
        appliedNotice: 'La organización fue aplicada al estado central y puede deshacerse desde Diagnóstico.',
        historyLabel: 'Organización estructural de RemoteAdmin',
        compareTitle: 'Comparación de organización',
        original: 'Original',
        organized: 'Organizado'
    },
    ren: {
        rowReserved: 'Reservada',
        rowReusedDeclared: 'Reutilizada (declarada sin uso)',
        rowReusedUndeclared: 'Asignada (hueco disponible)',
        rowChanged: 'Se renumerará',
        rowUnchanged: 'Sin cambios',
        rowsEmpty: 'No hay IDs modificadas con el filtro actual.',
        statusDone: 'Todas las IDs numeradas ya son consecutivas desde 1.',
        statusSafe: 'La renumeración es segura ({changed} cambios, {reused} reutilizadas). Los errores existentes seguirán bloqueando la descarga.',
        statusReady: 'Mapa calculado: {changed} cambios, {reused} IDs reutilizadas. Ninguna identidad ni configuración fue alterada.',
        statusBlocked: 'La renumeración fue calculada, pero existen conflictos que bloquean su aplicación.',
        mIds: 'IDs analizadas',
        mChanged: 'modificadas',
        mUnchanged: 'sin cambios',
        mReused: 'reutilizadas',
        mReserved: 'reservadas',
        mRanges: 'rangos',
        mFileErrors: 'errores del archivo',
        mBlocking: 'bloqueos',
        availTitle: 'IDs disponibles detectadas:',
        availDeclared: 'declarada',
        availReserved: 'reservada',
        availFree: 'disponible',
        availMore: '+{count} más',
        reusedTitle: 'IDs que serán reutilizadas:',
        reusedDeclared: 'declarada sin uso',
        reusedFree: 'disponible no declarada',
        rangeChanged: '{prefix}: {changed} cambio(s){reuse}',
        rangeReuse: ' ({reused} reutilizada(s))',
        rangeClean: '{prefix}: sin cambios',
        noIssues: 'SteamID, badges, colores, permisos, notas y propiedades desconocidas fueron conservados.',
        needPreview: 'Primero genera una previsualización de RemoteAdmin.',
        analyzing: 'Analizando…',
        fail: 'No se pudieron reorganizar las IDs: {error}',
        failStructural: 'el análisis estructural falló.',
        cannotApply: 'La reorganización no puede aplicarse porque no hay cambios o la transformación tiene un bloqueo propio.',
        appliedNotice: 'Reorganización aplicada: {changed} ID(s) modificadas en {ranges} rango(s).',
        appliedHistory: 'Reorganización de {changed} ID(s) internas',
        appliedRemaining: '\n\nAviso: permanecen {count} error(es) del archivo; la descarga continúa bloqueada.',
        appliedOk: 'Reorganización completada correctamente.\n\nRangos procesados: {ranges}\nIDs modificadas: {changed}\nIDs sin cambios: {unchanged}\n\n✓ SteamID conservadas\n✓ Badges y colores conservados\n✓ Permisos actualizados\n✓ Relectura correcta{remaining}',
        cannotUndo: 'No se puede deshacer porque el RemoteAdmin cambió después de la reorganización.',
        undoConfirm: 'Se restaurará la numeración anterior de esta sesión. ¿Continuar?',
        undone: 'La reorganización de IDs fue deshecha correctamente.',
        previewTitle: 'Previsualización de IDs',
        optReuseDeclared: 'Reutilizar IDs declaradas pero no utilizadas',
        optUseUndeclared: 'Utilizar IDs no declaradas disponibles',
        optRespectReserved: 'Respetar IDs reservadas',
        optUpdateRefs: 'Actualizar todas las referencias',
        optValidate: 'Validar después de reorganizar',
        onlyChanged: 'Mostrar solo IDs modificadas',
        thRange: 'Rango',
        thOld: 'ID actual',
        thNew: 'ID nueva',
        thUser: 'Usuario',
        thStatus: 'Estado',
        reviewCode: 'Revisar código completo antes y después',
        current: 'Actual',
        renumbered: 'Renumerado',
        availableAria: 'IDs disponibles detectadas',
        rangesAria: 'Estado por rango'
    },
    val: {
        secMissing: 'Falta la sección {section}.',
        genSecMissing: 'La configuración generada no contiene la sección {section}.',
        roleStyleChanged: 'La sección {from} fue cambiada a {to}.',
        dupManagedSection: 'La configuración contiene secciones Members, Roles/Groups o Permissions duplicadas.',
        groupNameMissing: 'La sección {section} contiene un grupo sin nombre.',
        badId: 'El identificador "{id}" del rol {role} no es un ID RemoteAdmin válido.',
        memberRoleUnknown: 'El usuario {id} referencia el rol inexistente {role}.',
        dupId: 'El ID {id} aparece {count} veces ({roles}).',
        dupRoleProp: 'La propiedad {name} aparece {count} veces; se conserva literalmente y el último valor es el efectivo.',
        dupPerm: 'El permiso {perm} aparece {count} veces; se conserva literalmente mientras no sea editado.',
        invalidRoleColor: 'El rol {role} utiliza el color no admitido "{color}".',
        emptyRoleBadge: 'El rol {role} no tiene badge visible.',
        rolePropsMissing: 'El rol {role} no contiene las propiedades requeridas: {list}.',
        invalidRoleBool: 'La propiedad {name} debe ser true, false o default; se encontró "{value}".',
        invalidRolePower: 'La propiedad {name} debe ser default o un entero entre 0 y 255; se encontró "{value}".',
        permUnknown: 'El permiso {perm} referencia el rol inexistente {role}.',
        overrideUnknown: 'override_password_role referencia el rol inexistente {role}.',
        memberRoleUndeclared: 'El usuario {id} quedó asociado a {role}, pero ese rol no aparece en {section}.',
        memberCount: 'Se esperaban {expected} miembros y se generaron {generated}.',
        noMember: 'El rol {role} no tiene miembros asignados.',
        noMembers: 'No se encontraron miembros para exportar.',
        roleNameMissing: 'Existe un rol sin nombre.',
        noneValue: 'ninguna',
        emptyId: '(vacío)',
        noRole: '(sin rol)',
        noId: '(sin ID)',
        emptyRole: '(vacío)',
        notLoadedFile: 'Primero carga un archivo RemoteAdmin.',
        exactDup: 'El registro {id} está repetido exactamente {count} veces; no se eliminó automáticamente.',
        sharedInternal: 'El ID interno {role} está compartido por {count} usuarios; se conservó sin cambios.',
        dupRoleDecl: 'El rol {role} está declarado {count} veces.',
        propUndeclared: 'Existen propiedades para {role}, pero el rol no está declarado.',
        dupRolePropShort: 'La propiedad {name} aparece {count} veces.',
        dupPermRole: '{perm} repite el rol {role}.',
        customPrefixes: 'Se conservaron rangos personalizados después de la jerarquía conocida: {list}.'
    },
    src: {
        groupNameMissing: 'La sección Groups de RemoteAdmin contiene un grupo sin nombre.',
        unknownUserGroup: 'RemoteAdmin asigna usuarios a grupos no declarados en Groups ({list}); la página los conservó y la exportación los declarará.'
    },
    orgIssue: {
        stageMembers: 'Members contiene una línea no reconocida entre usuarios: "{line}".',
        stageRoles: 'Roles contiene una línea no reconocida entre grupos: "{line}".',
        stageProps: 'El bloque {role} está intercalado con una línea no reconocida: "{line}".',
        unknownProps: 'Se conservaron propiedades de rol no reconocidas: {list}.',
        semanticChange: 'La comparación semántica detectó pérdida o modificación de información.',
        notIdempotent: 'Una segunda organización produciría un resultado diferente.',
        rereadFailed: 'El parser no pudo recuperar todas las secciones requeridas.'
    },
    renIssue: {
        unknownPropRef: 'Línea {line}: la propiedad desconocida {name} contiene la ID {role}; no se modificó su valor.',
        unmanagedRef: 'Línea {line}: se encontró una referencia no reconocida a {role}; debe revisarse manualmente.',
        semanticChange: 'La transformación no conservó exactamente la identidad o propiedades de los usuarios.',
        rereadFailed: 'El parser no pudo recuperar las secciones requeridas después de renumerar.',
        notIdempotent: 'Una segunda renumeración produciría IDs diferentes.',
        countMismatch: 'La cantidad de usuarios cambió durante la renumeración.',
        planDupDecl: 'La ID interna {role} está declarada {count} veces; resuelve la ambigüedad antes de renumerar.',
        skipped: 'Se conservaron IDs sin un sufijo numérico seguro: {list}.',
        dupNumeric: 'El rango {prefix} utiliza el número {number} mediante varias IDs ({list}).',
        collision: 'La ID nueva {role} sería utilizada por {list}.',
        customPrefixes: 'Los rangos personalizados se procesaron independientemente: {list}.',
        reservedKept: 'Se conservaron IDs marcadas explícitamente como reservadas: {list}.',
        reusedDeclared: 'Se reutilizaron {count} ID(s) declaradas no utilizadas: {list}.',
        reusedUndeclared: 'Se aprovecharon {count} ID(s) no declaradas disponibles: {list}.'
    },
    perm: {
        frameworkBad: 'Framework de permisos no compatible: {fw}',
        title: 'Permisos',
        closeAria: 'Cerrar permisos',
        checkAll: 'Marcar Todos',
        uncheckAll: 'Desmarcar Todos',
        save: 'Guardar Permisos',
        noGroups: 'No se encontraron grupos o roles para exportar.',
        noUsers: 'No se encontraron usuarios en RemoteAdmin.',
        invalidGroupName: 'El grupo "{name}" no es un identificador YAML compatible.',
        reservedGroup: 'El grupo "{name}" colisiona con la clave reservada "{key}".',
        dupGroup: 'El grupo "{name}" está duplicado.',
        caseCollision: 'Los grupos "{a}" y "{b}" solo difieren en mayúsculas.',
        unknownUserGroup: 'El usuario "{id}" está asociado al grupo inexistente "{group}".',
        dupSteam: 'El SteamID {steam} está repetido en el grupo {group}.',
        conflictSteam: 'El SteamID {steam} está asociado a los grupos {a} y {b}.',
        noSteam: 'No se encontró ningún SteamID64 válido en RemoteAdmin.',
        incompatibleIds: '{count} usuario(s) no usan un SteamID64 válido; permanecerán en RemoteAdmin pero no cuentan como SteamID.',
        noMapping: '{count} permiso(s) nativo(s) de RemoteAdmin no tienen equivalencia automática en {fw}.',
        wildcard: 'La política seleccionada concede .* (todos los permisos de plugins) a cada grupo, igual que los ejemplos proporcionados.',
        emptyPerms: '{count} grupo(s) se exportarán sin permisos de plugins hasta que exista un mapeo explícito.',
        linkedUsers: '{count} usuario(s) se enlazan mediante su grupo de RemoteAdmin; el esquema de {fw} no serializa SteamID en este archivo.',
        displayFields: 'Badges, colores y notas permanecen en RemoteAdmin porque el archivo de permisos de plugins no dispone de esos campos.',
        yamlBom: 'El contenido contiene un BOM no permitido.',
        yamlTabs: 'La configuración contiene tabulaciones.',
        yamlCrlf: 'La configuración debe utilizar saltos de línea LF.',
        yamlFinalNewline: 'La configuración LabAPI debe finalizar con un salto de línea LF.',
        yamlRoot: 'Línea {line}: contenido fuera de un grupo YAML.',
        yamlDupKey: 'Claves YAML duplicadas: {list}.',
        yamlMissingDefault: 'Falta el grupo predeterminado "{key}".',
        yamlInheritance: 'El grupo "{group}" debe contener exactamente un campo "{field}" con la indentación esperada.',
        yamlDefaultField: 'El grupo "user" de EXILED debe contener exactamente "  default: true".',
        yamlUnexpectedDefault: 'El grupo "{group}" no puede declararse como grupo predeterminado.',
        yamlPermsField: 'El grupo "{group}" debe contener exactamente un campo permissions.',
        yamlEmptyList: 'El grupo "{group}" abre una lista permissions pero no contiene permisos.',
        yamlOrphanItem: 'El grupo "{group}" contiene permisos fuera de una lista permissions.',
        yamlItemOrder: 'Los permisos del grupo "{group}" deben aparecer inmediatamente después del encabezado permissions.',
        yamlGroupField: 'Línea {line}: campo o indentación no compatible dentro del grupo "{group}".'
    }
});

Object.assign(STRINGS.en, {
    _langName: 'English',
    diag: {
        title: 'RemoteAdmin Diagnostics',
        closeAria: 'Close diagnostics',
        countsAria: 'Diagnostics totals',
        searchPh: 'Search code, ID, user or message…',
        searchAria: 'Search diagnostics',
        show: 'Show',
        filterAll: 'All',
        filterError: 'Critical errors',
        filterWarning: 'Warnings',
        filterInfo: 'Information',
        filterSafe: 'Safe repair',
        filterConfirm: 'Need decision',
        selectionAria: 'Issue selection',
        selectVisible: 'Select visible',
        clearSelection: 'Clear selection',
        undoRepair: 'Undo last repair',
        undoAll: 'Undo all changes',
        restoreOriginal: 'Restore original',
        resolveSelected: 'Resolve selected',
        resolveSafe: 'Resolve safe issues',
        countErrors: 'Critical errors',
        countWarnings: 'Warnings',
        countInfo: 'Information',
        countRepairable: 'Repairable',
        countDecisions: 'Need decision',
        summary: '{users} user(s), {roles} internal ID(s), {perms} permission(s). {tail}',
        summaryOk: 'No critical errors.',
        summaryBlocked: 'Export remains blocked by critical errors.',
        emptyFiltered: 'No diagnostics match the filter.',
        emptyClean: 'RemoteAdmin analyzed successfully. No issues found.',
        selManual: 'You can select it for the summary; it will require manual editing.',
        selConfirm: 'Resolving the selection will ask for a decision before modifying it.',
        selSafe: 'This issue admits a safe automatic repair.',
        selAria: 'Select {code}',
        sevError: 'Critical error',
        sevWarning: 'Warning',
        sevInfo: 'Information',
        repairSafe: 'Safe repair',
        repairConfirm: 'Needs decision',
        repairManual: 'Manual edit',
        actResolve: 'Resolve',
        actReviewDecision: 'Review decision',
        actReview: 'Review',
        actGoto: 'Go to issue',
        actIgnore: 'Ignore',
        actUnignore: 'Stop ignoring',
        locLine: ' · line {line}',
        locRole: ' · ID {role}',
        locAffects: ' · Affects: {list}',
        resolveSelectedN: 'Resolve selected ({n})',
        resolveSafeN: 'Resolve safe issues ({n})',
        secProps: 'Properties',
        secGlobal: 'Global configuration',
        secFormat: 'Format'
    },
    nav: {
        import: 'Import',
        editor: 'Editor',
        language: 'Language'
    },
    header: {
        exportRa: 'Export RemoteAdmin',
        exiled: 'Permissions EXILED',
        labapi: 'Permissions Lab API'
    },
    mode: {
        ra: '🛡️ Remote Admin Mode',
        invalidFile: 'The file is not a valid Remote Admin configuration.'
    },
    common: {
        cancel: 'Cancel',
        close: 'Close',
        save: 'Save',
        add: 'Add',
        delete: 'Delete',
        edit: 'Edit',
        warnings: 'Warnings',
        noWarnings: 'No warnings.',
        search: 'Search',
        copy: 'Copy',
        download: 'Download',
        confirm: 'Confirm'
    },
    importView: {
        title: 'Import Current Configuration',
        desc: 'Paste the full contents of your Remote Admin configuration file (config_remoteadmin.txt) here.',
        configLabel: 'Configuration contents',
        configPh: '# Paste your configuration here...',
        parse: 'Read Configuration',
        upload: 'Upload .txt File',
        empty: 'Please paste the configuration.'
    },
    editor: {
        title: 'Groups & Members',
        searchPh: 'Search member...',
        searchAria: 'Search member',
        validate: 'Validate RemoteAdmin',
        repair: 'Repair RemoteAdmin',
        badgeBulk: 'Bulk badge import',
        addGroup: 'Add Group',
        addCategoryTitle: 'Add Category'
    },
    health: {
        pending: 'Not validated',
        valid: 'Valid RemoteAdmin',
        warnings: '{count} warning(s)',
        errors: '{count} error(s)'
    },
    action: {
        copied: 'Copied!',
        copyFail: 'Could not copy automatically. Select the text and copy it manually.',
        downloadBlocked: 'The RemoteAdmin file contains blocking errors. Review the preview before downloading.',
        downloadFail: 'Could not download the file: {error}',
        downloadFailBrowser: 'the browser refused the download.',
        permsBlocked: 'The configuration contains blocking errors. Review the preview before downloading.'
    },
    healthExtra: {
        blockDownload: '{count} critical error(s) block downloading until resolved.'
    },
    member: {
        deleteConfirm: 'Delete this member?',
        invalidId: 'Enter a valid ID: a numeric @steam/@discord ID or a @northwood user.',
        kickRange: 'Kick power values must be between 0 and 255.',
        addTitle: 'Add Member',
        closeAria: 'Close member form',
        name: 'Name',
        namePh: 'E.g. YAN',
        notes: 'Notes / Comments (Optional)',
        notesPh: 'E.g. before B3, expires June 09...',
        steamId: 'SteamID (Required)',
        steamIdPh: 'E.g. 76561198841587908@steam',
        badge: 'Badge Text',
        badgePh: 'E.g. SERVER OWNER',
        color: 'Badge Color',
        kickPower: 'Kick Power',
        reqKick: 'Req. Kick Power',
        cover: 'Cover',
        hidden: 'Hidden',
    },
    group: {
        newPrompt: 'New group name (e.g. A, B, VIP):',
        invalidName: 'The group may only contain letters, numbers and underscores, and may not start with a number.',
        exists: 'Group "{prefix}" already exists.',
        deleteConfirm: 'Delete group {prefix} and all its members?'
    },
    move: {
        selectTarget: 'Please select a valid target group.',
        selectGroup: 'Select a group...'
    },
    badgeIssue: {
        malformedLine: 'The line does not contain a key followed by a colon.',
        unknownKey: 'The key "{key}" is not recognized and will be ignored.',
        duplicateField: 'The key "{key}" is repeated; its last value will be used.',
        missingOwner: 'The required "badge de:" value is missing.',
        emptyOwnerName: 'The "badge de:" value must contain a name besides @.',
        ownerWithoutAt: 'The owner does not start with @; it will be kept exactly as written.',
        emptyBadge: 'The _badge field cannot be empty.',
        missingColor: 'The required _color field is missing.',
        invalidColor: 'The color "{color}" does not exist in the current selector.',
        colorSuggestion: ' Did you mean "{suggestion}"?',
        missingSteam: 'The required _steamID field is missing.',
        invalidSteam: 'The value must be an individual public 17-digit SteamID64, without @steam.',
        dupInput: 'SteamID repeated within the text; it matches record {n}.',
        conflictInput: 'SteamID repeated with different information than record {n}.',
        dupExisting: 'The SteamID already appears more than once in RemoteAdmin; fix that ambiguity before importing.',
        existDup: 'The SteamID already exists in role {role} with the same data.',
        existConflict: 'The SteamID already exists in role {role} with different information.',
        sharedConflict: 'Role {role} is shared by several users; RemoteAdmin does not support an individual badge or color.',
        targetRequired: 'Select a group for new SteamIDs.',
        targetNotFound: 'Target group "{group}" does not exist.',
        sharedBatch: 'Group {group} is empty and another record proposes a different badge or color; choose a single combination.',
        sharedTarget: 'Group {group} uses a shared role; badge and color must match the role.',
        multiMutations: 'There is more than one replace or update action for SteamID {steam}; select only one.',
        multiShared: 'There are several badge and color combinations selected for shared role {group}; choose only one.',
        steamChanged: 'SteamID {steam} appeared after the preview and was omitted.',
        targetUnavailable: 'The target group is no longer available.',
        sharedStale: 'Group {group} uses a shared role; badge and color no longer match the role.',
        notUnique: 'Could not uniquely resolve SteamID {steam}.'
    },
    badgeBulk: {
        notAnalyzed: 'Not analyzed.',
        needRecords: 'Paste at least one record to analyze it.',
        selectGroup: 'Select a group',
        statusValid: 'Valid',
        statusWarning: 'Valid with warnings',
        statusDuplicate: 'Duplicate',
        statusConflict: 'Conflict',
        statusInvalid: 'Invalid',
        noIssues: 'No errors.',
        lineIssue: 'Line {line}: {message}',
        actionFor: 'Action for SteamID {id}',
        actCancel: 'Cancel record',
        actOmit: 'Omit',
        actReplace: 'Replace existing',
        actUpdate: 'Update changed fields',
        actImport: 'Use this record',
        actImportCombo: 'Use this combination',
        actAdd: 'Add',
        sumTotal: 'Total',
        sumValid: 'Valid',
        sumInvalid: 'Invalid',
        sumDupes: 'Duplicates/conflicts',
        sumOmitted: 'Omitted/cancelled',
        applyHeading: 'There are records pending correction:',
        applyRecord: 'Record {n}, ',
        applyLine: '{prefix}line {line}: {message}',
        applyInvalid: ' {count} invalid record(s) remain in the preview.',
        changedAfter: 'The RemoteAdmin configuration changed after the preview. Analyze the records again.',
        multiMutationsAlert: 'There are several mutating actions for the same SteamID. Keep only one before confirming.',
        multiSharedAlert: 'There are several badge and color combinations selected for the same shared role. Keep only one.',
        title: 'Bulk badge import',
        closeAria: 'Close bulk badge import',
        intro: 'Paste one or more records. Data will be analyzed and previewed before modifying the current configuration.',
        inputLabel: 'Badge records',
        inputPh: 'badge de: @Endercruz\n_badge: Endercruz\n_color: orange\n_steamID: 76561199835925257',
        targetGroup: 'Target group',
        analyze: 'Analyze and preview',
        clear: 'Clear',
        previewAria: 'Bulk badge import preview',
        caption: 'Records analyzed before confirming the import',
        thLine: 'Line',
        thOwner: 'Note or owner',
        thBadge: 'Badge',
        thColor: 'Color',
        thSteam: 'SteamID64',
        thStatus: 'Status',
        thIssue: 'Error or warning',
        thAction: 'Action',
        confirm: 'Confirm import',
        finished: 'Load finished: {imported} added, {replaced} replaced, {updated} updated, {omitted} omitted, {cancelled} cancelled and {invalid} invalid.'
    },
    memberModal: {
        addToGroup: 'Add Member to Group {group}',
        edit: 'Edit Member'
    },
    permModal: {
        groupTitle: 'Permissions of Group {group}',
        memberTitle: 'Permissions of {name}'
    },
    bulkMembers: {
        added: 'Added {count} members to group {group}.',
        autoNote: 'Bulk added'
    },
    bulk: {
        title: 'Bulk Member Load',
        descA: 'Paste your member list. The system will automatically extract the',
        ids: 'SteamID/DiscordID',
        and: 'and the',
        name: 'Name',
        listLabel: 'Member list',
        process: 'Process and Add',
        inputPh: 'E.g.:\n76561198841587908@steam YAN\n123456789012345678@discord User Two',
        closeAria: 'Close bulk load'
    },
    promote: {
        title: 'Promote',
        closeAria: 'Close promotion window',
        targetGroup: 'Target group',
        desc: 'The member will keep their badge (updating the rank), color, cover and hidden. They will adopt the permissions, Kick Power and Required Kick Power of the target group.',
        confirm: 'Confirm Promotion'
    },
    demote: {
        title: 'Demote',
        closeAria: 'Close demotion window',
        targetGroup: 'Target group',
        desc: 'The member will keep their badge (updating the rank), color, cover and hidden. They will adopt the permissions, Kick Power and Required Kick Power of the target group.',
        confirm: 'Confirm Demotion'
    },
    cards: {
        noResults: 'No results found.',
        groupName: 'Group {prefix}',
        noMembers: 'No members.',
        noName: 'No Name',
        promote: 'Promote',
        demote: 'Demote',
        perms: 'Permissions',
        editBtn: 'Edit',
        hiddenYes: 'Yes',
        hiddenNo: 'No',
        permsCount: 'Permissions',
        categories: 'Categories',
        categoryName: 'Category {name}',
        groupPerms: 'Group Permissions',
        groupPermsTitle: 'Group Permissions',
        addMember: 'Add Member',
        addMemberTitle: 'Add Member',
        noMembersInCat: 'No members in this category.',
        promoteTitle: 'Promote rank',
        promoteAria: 'Promote member rank',
        demoteTitle: 'Demote rank',
        demoteAria: 'Demote member rank',
        permsTitle: 'Permissions',
        permsAria: 'Member permissions',
        editAria: 'Edit member',
        deleteAria: 'Delete member',
        noPerms: 'Missing permission: {list}',
        targetOpt: 'Group {prefix} ({label}) - {count} members',
        bulkTitle: 'Bulk Load - Group {prefix}',
        sharedRole: ' (shared role)',
        deleteGroupTitle: 'Delete Group',
        deleteGroupAria: 'Delete group',
        deleteAria: 'Delete member',
        dragTitle: 'Drag to reorder'
    },
    repair: {
        rollbackParser: 'The parser could not recover all required sections.',
        rollbackData: 'Semantic comparison detected data loss.',
        rollbackNoChange: 'The repair did not resolve the selected diagnostic.',
        rolledBack: 'The repair was rolled back: {reason}',
        noSafeSelection: 'The selection contains no safe automatic repairs.',
        appliedSafe: 'Applied {count} safe repair(s). The file was analyzed again.',
        applyFixConfirm: 'Apply the proposed fix for {code}?',
        cannotApplyFix: 'Could not apply: {reason}',
        cannotApplyDefault: 'the fix produced no verifiable result.',
        parserLost: 'The resolution was reverted because the parser could not recover the full file.',
        manualRequired: 'This issue requires editing the value or choosing a valid relation; no automatic change was applied.',
        selectOne: 'Select at least one issue before continuing.',
        unresolvedManual: '{count} selected issue(s) require manual editing and were not modified:\n{list}',
        unresolvedLine: ' (line {line})',
        loadFirst: 'First load a RemoteAdmin configuration.',
        undoBlocked: 'The content changed after the repair; it will not be undone automatically to avoid losing work.',
        undoAllConfirm: 'Undo all repairs made during this session?',
        restoreConfirm: 'Restore RemoteAdmin exactly as loaded at the start of this session?'
    },
    choice: {
        keepLine: 'Type the line you want to keep:\n{list}',
        removeConflicts: '{count} conflicting association(s) will be removed and line {line} will be kept. Continue?',
        keepValue: 'Type the line whose value you want to keep:\n{list}',
        keepSingle: 'A single declaration of {name} will be kept. Continue?',
        combinePrompt: 'Type “combine” to merge the IDs or the line you want to keep:\n{list}',
        combineDefault: 'combine',
        combineConfirm: 'The duplicate assignments of {name} will be combined. Continue?',
        keepOneConfirm: 'Only the declaration on line {line} will be kept. Continue?',
        keepRole: 'Type the line of {role} you want to keep:\n{list}',
        removeRoles: '{count} duplicate declarations of {role} will be removed. Continue?'
    },
    export: {
        modalTitle: 'New Generated Configuration',
        closeAria: 'Close generated configuration',
        summaryTitle: 'Export summary',
        framework: 'Target framework:',
        statsAria: 'Export totals',
        statUsers: 'Users',
        statGroups: 'Exported groups',
        statPerms: 'Unique permissions',
        raOptionsAria: 'RemoteAdmin export options',
        filename: 'File name',
        filenameHelp: 'The imported file name is kept whenever possible.',
        formatLabel: 'Detected format',
        formatHelp: 'Text compatible with the loaded configuration.',
        policy: 'Policy for unmapped permissions',
        policySafe: 'Safe conversion (recommended)',
        policyWildcard: 'Wildcard/explicit reference (.*)',
        policyHelp: 'The safe option only keeps permissions with known equivalence.',
        policyWildcardHelp: 'Warning: .* grants every permission of every plugin to each group.',
        policySafeHelp: 'Native RemoteAdmin permissions do not convert into plugin nodes without an explicit mapping.',
        tabRa: 'Remote Admin',
        tabExiled: 'Permissions EXILED',
        tabLabapi: 'Permissions Lab API',
        titleRa: 'RemoteAdmin Preview',
        titlePerms: 'Permissions {framework} Preview',
        formatDetail: 'RemoteAdmin text {ext} · {enc}{bom} · {le} · {final}',
        withBom: ' with BOM',
        withoutBom: ' without BOM',
        finalLine: 'final line present',
        noFinalLine: 'no final line',
        issueError: 'Error',
        issueWarning: 'Warning',
        needPreview: 'First load a valid RemoteAdmin configuration.',
        needPreviewValid: 'First generate a valid RemoteAdmin preview.',
        undoRenumberTitle: 'The content changed after renumbering and can no longer be undone automatically.',
        diagnostics: 'Diagnostics',
        organize: 'Organize RemoteAdmin',
        renumber: 'Renumber IDs',
        undoRenumber: 'Undo renumbering',
        cancelOrg: 'Cancel organization',
        applyOrg: 'Apply organization',
        applyRenumber: 'Apply renumbering',
        copyTab: 'Copy Current Tab',
        downloadTab: 'Download Current Tab',
        analyzing: 'Analyzing…',
        copyFail: 'Could not copy automatically. Select the text and copy it manually.'
    },
    issue: {
        blocking: 'Blocked',
        existing: 'Existing error',
        warning: 'Warning',
        error: 'Error'
    },
    org: {
        statusOk: 'The file already uses the expected hierarchical order.',
        statusSafe: 'Organization is safe and can be applied. Existing errors will keep blocking the download.',
        statusDone: 'Organization finished. Re-read and semantic comparison were correct.',
        statusBlocked: 'The result was generated, but it contains conflicts that must be resolved first.',
        mUsers: 'users',
        mGroups: 'groups',
        mMembers: 'members moved',
        mBlocks: 'blocks moved',
        mLists: 'sorted lists',
        mBlanks: 'blank lines removed',
        mWarnings: 'warnings',
        mFileErrors: 'file errors',
        mBlocking: 'organization blockers',
        noIssues: 'No conflicts. Comments, unknown properties and semantic data preserved.',
        fail: 'Could not organize RemoteAdmin: {error}',
        failStructural: 'structural analysis failed.',
        cannotApply: 'The organization cannot be applied because there are no changes or the transformation has its own blocker.',
        appliedNotice: 'The organization was applied to the central state and can be undone from Diagnostics.',
        historyLabel: 'Structural RemoteAdmin organization',
        compareTitle: 'Organization comparison',
        original: 'Original',
        organized: 'Organized'
    },
    ren: {
        rowReserved: 'Reserved',
        rowReusedDeclared: 'Reused (declared unused)',
        rowReusedUndeclared: 'Assigned (available gap)',
        rowChanged: 'Will be renumbered',
        rowUnchanged: 'No changes',
        rowsEmpty: 'No modified IDs with the current filter.',
        statusDone: 'All numbered IDs are already consecutive from 1.',
        statusSafe: 'Renumbering is safe ({changed} changes, {reused} reused). Existing errors will keep blocking the download.',
        statusReady: 'Map computed: {changed} changes, {reused} reused IDs. No identity or configuration was altered.',
        statusBlocked: 'Renumbering was computed, but conflicts block its application.',
        mIds: 'IDs analyzed',
        mChanged: 'modified',
        mUnchanged: 'unchanged',
        mReused: 'reused',
        mReserved: 'reserved',
        mRanges: 'ranges',
        mFileErrors: 'file errors',
        mBlocking: 'blockers',
        availTitle: 'Detected available IDs:',
        availDeclared: 'declared',
        availReserved: 'reserved',
        availFree: 'available',
        availMore: '+{count} more',
        reusedTitle: 'IDs that will be reused:',
        reusedDeclared: 'declared unused',
        reusedFree: 'available undeclared',
        rangeChanged: '{prefix}: {changed} change(s){reuse}',
        rangeReuse: ' ({reused} reused)',
        rangeClean: '{prefix}: no changes',
        noIssues: 'SteamIDs, badges, colors, permissions, notes and unknown properties were preserved.',
        needPreview: 'First generate a RemoteAdmin preview.',
        analyzing: 'Analyzing…',
        fail: 'Could not renumber IDs: {error}',
        failStructural: 'structural analysis failed.',
        cannotApply: 'The renumbering cannot be applied because there are no changes or the transformation has its own blocker.',
        appliedNotice: 'Renumbering applied: {changed} ID(s) modified in {ranges} range(s).',
        appliedHistory: 'Renumbering of {changed} internal ID(s)',
        appliedRemaining: '\n\nWarning: {count} file error(s) remain; downloading stays blocked.',
        appliedOk: 'Renumbering completed successfully.\n\nRanges processed: {ranges}\nModified IDs: {changed}\nUnchanged IDs: {unchanged}\n\n✓ SteamIDs preserved\n✓ Badges and colors preserved\n✓ Permissions updated\n✓ Re-read correct{remaining}',
        cannotUndo: 'Cannot undo because RemoteAdmin changed after renumbering.',
        undoConfirm: 'The previous numbering of this session will be restored. Continue?',
        undone: 'ID renumbering was undone successfully.',
        previewTitle: 'ID Preview',
        optReuseDeclared: 'Reuse declared but unused IDs',
        optUseUndeclared: 'Use available undeclared IDs',
        optRespectReserved: 'Respect reserved IDs',
        optUpdateRefs: 'Update all references',
        optValidate: 'Validate after reorganizing',
        onlyChanged: 'Show only modified IDs',
        thRange: 'Range',
        thOld: 'Current ID',
        thNew: 'New ID',
        thUser: 'User',
        thStatus: 'Status',
        reviewCode: 'Review full code before and after',
        current: 'Current',
        renumbered: 'Renumbered',
        availableAria: 'Detected available IDs',
        rangesAria: 'Range status'
    },
    val: {
        secMissing: 'Missing section {section}.',
        genSecMissing: 'The generated configuration does not contain section {section}.',
        roleStyleChanged: 'Section {from} was changed to {to}.',
        dupManagedSection: 'The configuration contains duplicated Members, Roles/Groups or Permissions sections.',
        groupNameMissing: 'Section {section} contains an unnamed group.',
        badId: 'Identifier "{id}" of role {role} is not a valid RemoteAdmin ID.',
        memberRoleUnknown: 'User {id} references nonexistent role {role}.',
        dupId: 'ID {id} appears {count} times ({roles}).',
        dupRoleProp: 'Property {name} appears {count} times; it is kept literally and the last value is effective.',
        dupPerm: 'Permission {perm} appears {count} times; it is kept literally while unedited.',
        invalidRoleColor: 'Role {role} uses unsupported color "{color}".',
        emptyRoleBadge: 'Role {role} has no visible badge.',
        rolePropsMissing: 'Role {role} is missing required properties: {list}.',
        invalidRoleBool: 'Property {name} must be true, false or default; found "{value}".',
        invalidRolePower: 'Property {name} must be default or an integer between 0 and 255; found "{value}".',
        permUnknown: 'Permission {perm} references nonexistent role {role}.',
        overrideUnknown: 'override_password_role references nonexistent role {role}.',
        memberRoleUndeclared: 'User {id} was left associated to {role}, but that role is not listed in {section}.',
        memberCount: 'Expected {expected} members but generated {generated}.',
        noMember: 'Role {role} has no assigned members.',
        noMembers: 'No members found to export.',
        roleNameMissing: 'There is an unnamed role.',
        noneValue: 'none',
        emptyId: '(empty)',
        noRole: '(no role)',
        noId: '(no ID)',
        emptyRole: '(empty)',
        notLoadedFile: 'First load a RemoteAdmin file.',
        exactDup: 'Record {id} is exactly repeated {count} times; it was not automatically removed.',
        sharedInternal: 'Internal ID {role} is shared by {count} users; it was kept unchanged.',
        dupRoleDecl: 'Role {role} is declared {count} times.',
        propUndeclared: 'Properties exist for {role}, but the role is not declared.',
        dupRolePropShort: 'Property {name} appears {count} times.',
        dupPermRole: '{perm} repeats role {role}.',
        customPrefixes: 'Custom ranges were kept after the known hierarchy: {list}.'
    },
    src: {
        groupNameMissing: 'The RemoteAdmin Groups section contains an unnamed group.',
        unknownUserGroup: 'RemoteAdmin assigns users to groups undeclared in Groups ({list}); the page kept them and the export will declare them.'
    },
    orgIssue: {
        stageMembers: 'Members contains an unrecognized line among users: "{line}".',
        stageRoles: 'Roles contains an unrecognized line among groups: "{line}".',
        stageProps: 'Block {role} is interleaved with an unrecognized line: "{line}".',
        unknownProps: 'Unrecognized role properties were kept: {list}.',
        semanticChange: 'Semantic comparison detected lost or modified information.',
        notIdempotent: 'A second organization would produce a different result.',
        rereadFailed: 'The parser could not recover all required sections.'
    },
    renIssue: {
        unknownPropRef: 'Line {line}: unknown property {name} contains ID {role}; its value was not modified.',
        unmanagedRef: 'Line {line}: found an unrecognized reference to {role}; it must be reviewed manually.',
        semanticChange: 'The transformation did not exactly preserve user identity or properties.',
        rereadFailed: 'The parser could not recover the required sections after renumbering.',
        notIdempotent: 'A second renumbering would produce different IDs.',
        countMismatch: 'The user count changed during renumbering.',
        planDupDecl: 'Internal ID {role} is declared {count} times; resolve the ambiguity before renumbering.',
        skipped: 'IDs without a safe numeric suffix were kept: {list}.',
        dupNumeric: 'Range {prefix} uses number {number} through several IDs ({list}).',
        collision: 'New ID {role} would be used by {list}.',
        customPrefixes: 'Custom ranges were processed independently: {list}.',
        reservedKept: 'IDs explicitly marked as reserved were kept: {list}.',
        reusedDeclared: 'Reused {count} declared unused ID(s): {list}.',
        reusedUndeclared: 'Leveraged {count} available undeclared ID(s): {list}.'
    },
    perm: {
        frameworkBad: 'Unsupported permissions framework: {fw}',
        title: 'Permissions',
        closeAria: 'Close permissions',
        checkAll: 'Check All',
        uncheckAll: 'Uncheck All',
        save: 'Save Permissions',
        noGroups: 'No groups or roles found to export.',
        noUsers: 'No users found in RemoteAdmin.',
        invalidGroupName: 'Group "{name}" is not a YAML-compatible identifier.',
        reservedGroup: 'Group "{name}" collides with reserved key "{key}".',
        dupGroup: 'Group "{name}" is duplicated.',
        caseCollision: 'Groups "{a}" and "{b}" differ only in case.',
        unknownUserGroup: 'User "{id}" is associated to nonexistent group "{group}".',
        dupSteam: 'SteamID {steam} is repeated in group {group}.',
        conflictSteam: 'SteamID {steam} is associated to groups {a} and {b}.',
        noSteam: 'No valid SteamID64 found in RemoteAdmin.',
        incompatibleIds: '{count} user(s) do not use a valid SteamID64; they will remain in RemoteAdmin but do not count as SteamID.',
        noMapping: '{count} native RemoteAdmin permission(s) have no automatic equivalence in {fw}.',
        wildcard: 'The selected policy grants .* (every plugin permission) to each group, just like the provided examples.',
        emptyPerms: '{count} group(s) will be exported without plugin permissions until an explicit mapping exists.',
        linkedUsers: '{count} user(s) are linked through their RemoteAdmin group; the {fw} schema does not serialize SteamID in this file.',
        displayFields: 'Badges, colors and notes remain in RemoteAdmin because the plugin permissions file has no such fields.',
        yamlBom: 'Content contains a disallowed BOM.',
        yamlTabs: 'Configuration contains tabs.',
        yamlCrlf: 'Configuration must use LF line endings.',
        yamlFinalNewline: 'LabAPI configuration must end with an LF newline.',
        yamlRoot: 'Line {line}: content outside a YAML group.',
        yamlDupKey: 'Duplicate YAML keys: {list}.',
        yamlMissingDefault: 'Missing default group "{key}".',
        yamlInheritance: 'Group "{group}" must contain exactly one "{field}" field with the expected indentation.',
        yamlDefaultField: 'EXILED "user" group must contain exactly "  default: true".',
        yamlUnexpectedDefault: 'Group "{group}" cannot be declared as the default group.',
        yamlPermsField: 'Group "{group}" must contain exactly one permissions field.',
        yamlEmptyList: 'Group "{group}" opens a permissions list but contains no permissions.',
        yamlOrphanItem: 'Group "{group}" contains permissions outside a permissions list.',
        yamlItemOrder: 'Permissions of group "{group}" must appear immediately after the permissions header.',
        yamlGroupField: 'Line {line}: incompatible field or indentation inside group "{group}".'
    }
});

function createEmptyParsedData() {
    return {
        settings: { ...DEFAULT_SETTINGS },
        groups: {},
        permissionList: [...DEFAULT_PERMISSION_LIST],
        permissionComments: {},
        overridePasswordPrefixes: new Set(),
        overridePasswordRoles: new Set(),
        overridePasswordUnknownRoles: new Set(),
        declaredGroupRoles: new Set(),
        permissionUnknownRoleRefs: new Map(),
        sourceValidationIssues: [],
        roleDefinitions: new Set(),
        orphanRoleData: new Map(),
        originalMemberRoles: new Set(),
        headerComments: ''
    };
}

let originalConfigText = "";
let originalLineEnding = '\n';
let remoteAdminDocument = null;
let currentMode = 'ra';
let uploadedFileName = null;
let uploadedFileText = null;
let hasLoadedRemoteAdmin = false;
let remoteAdminRevision = 0;
let badgeBulkPreviewRecords = [];
let badgeBulkPreviewRevision = null;
let activePermissionsExportFramework = null;
let activePermissionsExportResult = null;
let activeRemoteAdminExportResult = null;
let activeRemoteAdminOrganization = null;
let activeRemoteAdminIdRenumber = null;
let remoteAdminIdRenumberUndoSnapshot = null;
let activeRemoteAdminDiagnostics = null;
let remoteAdminSessionOriginalText = null;
let remoteAdminRepairHistory = [];
let ignoredRemoteAdminDiagnosticIds = new Set();
let selectedRemoteAdminDiagnosticIds = new Set();
let remoteAdminDiagnosticsRefreshTimer = null;
let parsedData = createEmptyParsedData();

let currentSelectedGroup = null;

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
    })[char]);
}

function safeCssToken(value) {
    const token = String(value ?? 'default');
    return /^[A-Za-z0-9_-]+$/.test(token) ? token : 'default';
}

function getAcceptedBadgeColors() {
    const colorSelect = document.getElementById('member-color');
    const optionColors = colorSelect?.options
        ? Array.from(colorSelect.options).map(option => String(option.value).toLowerCase()).filter(Boolean)
        : [];
    return new Set(optionColors.length > 0 ? optionColors : DEFAULT_BADGE_COLORS);
}

function normalizeSteamId64(value) {
    const rawValue = String(value ?? '').trim();
    const match = rawValue.match(/^(\d+)\s*(?:@steam)?$/i);
    return match ? match[1] : rawValue;
}

function isValidSteamId64(value) {
    const steamId = normalizeSteamId64(value);
    return STEAM_ID_64_PATTERN.test(steamId)
        && steamId >= STEAM_ID_64_MIN
        && steamId <= STEAM_ID_64_MAX;
}

function toRemoteAdminSteamId(value) {
    const steamId = normalizeSteamId64(value);
    return isValidSteamId64(steamId) ? `${steamId}@steam` : '';
}

function validateRemoteAdminUserId(value) {
    const rawId = String(value ?? '').trim();
    const steamMatch = rawId.match(/^(\d+)@steam$/i);
    if (steamMatch) {
        return {
            valid: isValidSteamId64(steamMatch[1]),
            provider: 'steam',
            normalized: `${steamMatch[1]}@steam`
        };
    }

    const discordMatch = rawId.match(/^(\d{15,22})@discord$/i);
    if (discordMatch) {
        return {
            valid: true,
            provider: 'discord',
            normalized: `${discordMatch[1]}@discord`
        };
    }

    const northwoodMatch = rawId.match(/^([A-Za-z0-9._-]{2,64})@northwood$/i);
    if (northwoodMatch) {
        return {
            valid: true,
            provider: 'northwood',
            normalized: `${northwoodMatch[1].toLowerCase()}@northwood`
        };
    }

    return {
        valid: false,
        provider: /@steam$/i.test(rawId) ? 'steam' : null,
        normalized: rawId.toLowerCase()
    };
}

function badgeOwnerName(owner) {
    return String(owner ?? '').trim().replace(/^@/, '').trim();
}

function getRoleName(prefix, group, memberIndex) {
    const member = group?.members?.[memberIndex];
    const stableRoleName = configScalar(member?.roleName || member?.oldRole);
    if (stableRoleName) return stableRoleName;
    return group.isNumbered ? `${prefix}${memberIndex + 1}` : prefix;
}

function allocateRoleName(prefix, usedRoleNames, isNumbered = true, options = {}) {
    const normalizedPrefix = configScalar(prefix);
    if (!normalizedPrefix) return '';
    if (!isNumbered) return normalizedPrefix;
    const used = new Set([...(usedRoleNames || [])].map(name => String(name).trim()));
    if (options.reuseGaps) {
        let nextNumber = 1;
        while (used.has(`${normalizedPrefix}${nextNumber}`)) {
            nextNumber += 1;
        }
        return `${normalizedPrefix}${nextNumber}`;
    }
    let highestSuffix = 0;
    usedRoleNames?.forEach?.(roleName => {
        const match = String(roleName).match(new RegExp(`^${normalizedPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d+)$`));
        if (match) highestSuffix = Math.max(highestSuffix, Number(match[1]));
    });
    let candidate = `${normalizedPrefix}${highestSuffix + 1}`;
    while (used.has(candidate)) {
        highestSuffix += 1;
        candidate = `${normalizedPrefix}${highestSuffix + 1}`;
    }
    return candidate;
}

function ensureStableRoleNames(state = parsedData) {
    const usedRoleNames = new Set();
    Object.values(state.groups || {}).forEach(group => {
        (group.members || []).forEach(member => {
            const roleName = configScalar(member.roleName || member.oldRole);
            if (roleName) usedRoleNames.add(roleName);
        });
    });
    state.orphanRoleData?.forEach((_, roleName) => usedRoleNames.add(roleName));

    Object.entries(state.groups || {}).forEach(([prefix, group]) => {
        (group.members || []).forEach(member => {
            if (configScalar(member.roleName || member.oldRole)) {
                member.roleName = configScalar(member.roleName || member.oldRole);
                return;
            }
            const roleName = allocateRoleName(prefix, usedRoleNames, group.isNumbered);
            member.roleName = roleName;
            if (roleName) usedRoleNames.add(roleName);
        });
    });
    return usedRoleNames;
}

function ensureMemberPermissions(member, fallbackPermissions = new Set()) {
    if (!(member.permissions instanceof Set)) {
        member.permissions = new Set(fallbackPermissions);
    }
    return member.permissions;
}

function recomputeGroupPermissions(group) {
    if (!group || group.members.length === 0) return;

    group.members.forEach(member => ensureMemberPermissions(member));
    const commonPermissions = new Set(group.members[0].permissions);
    commonPermissions.forEach(permission => {
        if (!group.members.every(member => member.permissions.has(permission))) {
            commonPermissions.delete(permission);
        }
    });
    group.permissions = commonPermissions;
}

function getVisibleMemberEntries(group, prefix, searchQuery) {
    return group.members
        .map((member, index) => ({
            member,
            originalIndex: index,
            roleStr: getRoleName(prefix, group, index)
        }))
        .filter(({ member, roleStr }) => {
            if (!searchQuery) return true;
            const searchStr = `${member.name || ''} ${member.notes || ''} ${member.id || ''} ${member.badge || ''} ${roleStr}`.toLowerCase();
            return searchStr.includes(searchQuery);
        });
}

let lastFocusedElement = null;

function showModal(modal, preferredFocus = null) {
    if (!modal) return;
    lastFocusedElement = document.activeElement;
    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');
    document.querySelectorAll('.app-header, .app-main').forEach(element => { element.inert = true; });
    const focusTarget = preferredFocus || modal.querySelector('button, input, select, textarea');
    if (focusTarget && typeof focusTarget.focus === 'function') {
        requestAnimationFrame(() => focusTarget.focus());
    }
}

function hideModal(modal) {
    if (!modal) return;
    modal.classList.remove('active');
    modal.setAttribute('aria-hidden', 'true');
    if (!document.querySelector('.modal.active')) {
        document.querySelectorAll('.app-header, .app-main').forEach(element => { element.inert = false; });
    }
    if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
        lastFocusedElement.focus();
    }
}

document.addEventListener('keydown', event => {
    const activeModal = document.querySelector('.modal.active');
    if (!activeModal) return;
    if (event.key === 'Escape') {
        event.preventDefault();
        hideModal(activeModal);
        return;
    }
    if (event.key !== 'Tab') return;

    const focusable = [...activeModal.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )].filter(element => !element.hidden && !element.closest('[hidden], [aria-hidden="true"]'));
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
    }
});

// DOM Elements
const btnImportView = document.getElementById('btn-import-view');
const btnEditorView = document.getElementById('btn-editor-view');
const btnGenerate = document.getElementById('btn-generate');
const viewImport = document.getElementById('view-import');
const viewEditor = document.getElementById('view-editor');
const configInput = document.getElementById('config-input');
const btnParse = document.getElementById('btn-parse');
const btnBadgeBulk = document.getElementById('btn-badge-bulk');
const btnExportExiled = document.getElementById('btn-export-exiled');
const btnExportLabAPI = document.getElementById('btn-export-labapi');
const btnValidateRemoteAdmin = document.getElementById('btn-validate-remoteadmin');
const btnRepairRemoteAdmin = document.getElementById('btn-repair-remoteadmin');
const remoteAdminHealth = document.getElementById('remoteadmin-health');

const permissionsModal = document.getElementById('permissions-modal');
const btnClosePermissionsModal = document.getElementById('btn-close-permissions-modal');
const permissionsGrid = document.getElementById('permissions-grid');
const btnSavePermissions = document.getElementById('btn-save-permissions');
const btnPermCheckAll = document.getElementById('btn-perm-check-all');
const btnPermUncheckAll = document.getElementById('btn-perm-uncheck-all');

let sortableInstance = null;

// Modal Elements
const memberModal = document.getElementById('member-modal');
const btnCloseMemberModal = document.getElementById('btn-close-member-modal');
const memberForm = document.getElementById('member-form');
const exportModal = document.getElementById('export-modal');
const btnCloseModal = document.getElementById('btn-close-modal');
const btnCopy = document.getElementById('btn-copy');
const configOutput = document.getElementById('config-output');
const exportPreviewSummary = document.getElementById('export-preview-summary');
const exportPermissionPolicy = document.getElementById('export-permission-policy');
const btnCancelExport = document.getElementById('btn-cancel-export');
const remoteAdminExportOptions = document.getElementById('remoteadmin-export-options');
const permissionsExportOptions = document.getElementById('permissions-export-options');
const remoteAdminExportFilename = document.getElementById('remoteadmin-export-filename');
const remoteAdminExportFormat = document.getElementById('remoteadmin-export-format');
const remoteAdminOrganizationPanel = document.getElementById('remoteadmin-organization-panel');
const remoteAdminOrganizationOriginal = document.getElementById('remoteadmin-organization-original');
const remoteAdminOrganizationOrganized = document.getElementById('remoteadmin-organization-organized');
const remoteAdminOrganizationStatus = document.getElementById('remoteadmin-organization-status');
const remoteAdminOrganizationMetrics = document.getElementById('remoteadmin-organization-metrics');
const remoteAdminOrganizationIssues = document.getElementById('remoteadmin-organization-issues');
const exportStandardPreview = document.getElementById('export-standard-preview');
const btnOrganizeRemoteAdmin = document.getElementById('btn-organize-remoteadmin');
const btnApplyRemoteAdminOrganization = document.getElementById('btn-apply-remoteadmin-organization');
const btnCancelRemoteAdminOrganization = document.getElementById('btn-cancel-remoteadmin-organization');
const remoteAdminIdRenumberPanel = document.getElementById('remoteadmin-id-renumber-panel');
const remoteAdminIdRenumberStatus = document.getElementById('remoteadmin-id-renumber-status');
const remoteAdminIdRenumberMetrics = document.getElementById('remoteadmin-id-renumber-metrics');
const remoteAdminIdRenumberRanges = document.getElementById('remoteadmin-id-renumber-ranges');
const remoteAdminIdRenumberBody = document.getElementById('remoteadmin-id-renumber-body');
const remoteAdminIdRenumberIssues = document.getElementById('remoteadmin-id-renumber-issues');
const remoteAdminIdRenumberOnlyChanged = document.getElementById('remoteadmin-id-renumber-only-changed');
const remoteAdminIdRenumberOriginal = document.getElementById('remoteadmin-id-renumber-original');
const remoteAdminIdRenumberResult = document.getElementById('remoteadmin-id-renumber-result');
const remoteAdminRenumberOptReuseDeclared = document.getElementById('remoteadmin-renumber-opt-reuse-declared');
const remoteAdminRenumberOptUseUndeclared = document.getElementById('remoteadmin-renumber-opt-use-undeclared');
const remoteAdminRenumberOptRespectReserved = document.getElementById('remoteadmin-renumber-opt-respect-reserved');
const remoteAdminRenumberOptUpdateRefs = document.getElementById('remoteadmin-renumber-opt-update-refs');
const remoteAdminRenumberOptValidate = document.getElementById('remoteadmin-renumber-opt-validate');
const remoteAdminIdRenumberAvailableSummary = document.getElementById('remoteadmin-id-renumber-available-summary');
const btnRenumberRemoteAdmin = document.getElementById('btn-renumber-remoteadmin');
const btnApplyIdRenumber = document.getElementById('btn-apply-id-renumber');
const btnCancelIdRenumber = document.getElementById('btn-cancel-id-renumber');
const btnUndoIdRenumber = document.getElementById('btn-undo-id-renumber');

const diagnosticsModal = document.getElementById('remoteadmin-diagnostics-modal');
const btnCloseDiagnostics = document.getElementById('btn-close-diagnostics');
const diagnosticsCounts = document.getElementById('remoteadmin-diagnostics-counts');
const diagnosticsList = document.getElementById('remoteadmin-diagnostics-list');
const diagnosticsSearch = document.getElementById('remoteadmin-diagnostics-search');
const diagnosticsFilter = document.getElementById('remoteadmin-diagnostics-filter');
const diagnosticsSummary = document.getElementById('remoteadmin-diagnostics-summary');
const btnResolveSafe = document.getElementById('btn-resolve-safe');
const btnResolveSelected = document.getElementById('btn-resolve-selected');
const btnUndoRepair = document.getElementById('btn-undo-repair');
const btnUndoAllRepairs = document.getElementById('btn-undo-all-repairs');
const btnRestoreRemoteAdminOriginal = document.getElementById('btn-restore-remoteadmin-original');
const btnOpenDiagnosticsExport = document.getElementById('btn-open-diagnostics-export');
const btnSelectVisibleDiagnostics = document.getElementById('btn-select-visible-diagnostics');
const btnClearDiagnosticSelection = document.getElementById('btn-clear-diagnostic-selection');

if (typeof Sortable !== 'function') {
    document.body.classList.add('sortable-unavailable');
    console.warn('SortableJS no está disponible; la edición funciona, pero el arrastre queda desactivado.');
}

// Navigation
btnImportView.addEventListener('click', () => switchView('import'));
btnEditorView.addEventListener('click', () => switchView('editor'));

function switchView(view) {
    const views = [viewImport, viewEditor].filter(Boolean);
    const previousFocus = document.activeElement;
    const activeView = view === 'import' ? viewImport : viewEditor;

    views.forEach(section => {
        const isActive = section === activeView;
        section.classList.toggle('active', isActive);
        section.setAttribute('aria-hidden', String(!isActive));
        section.inert = !isActive;
    });
    
    btnImportView.classList.remove('active');
    btnEditorView.classList.remove('active');
    
    if (view === 'import') {
        viewImport.classList.add('active');
        btnImportView.classList.add('active');
    } else if (view === 'editor') {
        viewEditor.classList.add('active');
        btnEditorView.classList.add('active');
    }

    const focusCameFromAnotherView = previousFocus
        && views.some(section => section !== activeView && section.contains(previousFocus));
    if (focusCameFromAnotherView && activeView) {
        const heading = activeView.querySelector('h2');
        if (heading) {
            heading.setAttribute('tabindex', '-1');
            heading.focus({ preventScroll: true });
        }
    }
}

switchView('import');

// Parser Logic
const fileUploadInput = document.getElementById('file-upload');
if (fileUploadInput) {
    fileUploadInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        uploadedFileName = file.name;
        
        const reader = new FileReader();
        reader.onload = (event) => {
            uploadedFileText = String(event.target.result ?? '');
            configInput.value = uploadedFileText;
            parseEditorText(uploadedFileText);
        };
        reader.readAsText(file);
    });
}

if (configInput) {
    configInput.addEventListener('input', event => {
        if (event.isTrusted) {
            uploadedFileName = null;
            uploadedFileText = null;
        }
    });
}

function clearLoadedConfiguration() {
    originalConfigText = '';
    originalLineEnding = '\n';
    remoteAdminDocument = null;
    currentMode = 'ra';
    hasLoadedRemoteAdmin = false;
    remoteAdminRevision += 1;
    parsedData = createEmptyParsedData();
    currentSelectedGroup = null;
    activePermissionsExportFramework = null;
    activePermissionsExportResult = null;
    activeRemoteAdminExportResult = null;
    activeRemoteAdminOrganization = null;
    activeRemoteAdminIdRenumber = null;
    remoteAdminIdRenumberUndoSnapshot = null;
    activeRemoteAdminDiagnostics = null;
    remoteAdminSessionOriginalText = null;
    remoteAdminRepairHistory = [];
    ignoredRemoteAdminDiagnosticIds.clear();
    selectedRemoteAdminDiagnosticIds.clear();
    if (remoteAdminDiagnosticsRefreshTimer) clearTimeout(remoteAdminDiagnosticsRefreshTimer);
    remoteAdminDiagnosticsRefreshTimer = null;
    updateRemoteAdminHealth(null);
    setRemoteAdminOrganizationComparisonVisible(false);
    setRemoteAdminIdRenumberPreviewVisible(false);
    if (btnOrganizeRemoteAdmin) btnOrganizeRemoteAdmin.hidden = true;
    if (btnRenumberRemoteAdmin) btnRenumberRemoteAdmin.hidden = true;
    if (btnUndoIdRenumber) btnUndoIdRenumber.hidden = true;
    invalidateBadgeBulkPreview();

    const modeBadge = document.getElementById('mode-badge');
    if (modeBadge) {
        modeBadge.style.display = 'none';
        modeBadge.textContent = '';
    }
    if (configOutput) configOutput.value = '';
    const exiledOutput = document.getElementById('exiled-output');
    const labApiOutput = document.getElementById('labapi-output');
    if (exiledOutput) exiledOutput.value = '';
    if (labApiOutput) labApiOutput.value = '';

    btnEditorView.disabled = true;
    btnGenerate.disabled = true;
    btnGenerate.innerHTML = `<i class="ph ph-download-simple" aria-hidden="true"></i> <span>${t('header.exportRa')}</span>`;
    if (btnExportExiled) btnExportExiled.disabled = true;
    if (btnExportLabAPI) btnExportLabAPI.disabled = true;
    switchView('import');
}

function parseEditorText(sourceText) {
    const text = String(sourceText ?? '');
    if (!text.trim()) {
        clearLoadedConfiguration();
        alert(t('importView.empty'));
        return false;
    }
    activeRemoteAdminIdRenumber = null;
    remoteAdminIdRenumberUndoSnapshot = null;
    
    const modeBadge = document.getElementById('mode-badge');
    originalConfigText = text;
    originalLineEnding = text.includes('\r\n') ? '\r\n' : '\n';
    
    if (isRemoteAdminConfig(text)) {
        currentMode = 'ra';
        remoteAdminSessionOriginalText = text;
        remoteAdminRepairHistory = [];
        ignoredRemoteAdminDiagnosticIds.clear();
        selectedRemoteAdminDiagnosticIds.clear();
        if (modeBadge) { modeBadge.style.display = 'inline-block'; modeBadge.textContent = t('mode.ra'); }
        parseConfig(text);
        updateOldRoles();
        renderRAEditor();
        scheduleRemoteAdminDiagnosticsRefresh();
        switchView('editor');
    } else {
        clearLoadedConfiguration();
        alert(t('mode.invalidFile'));
        return false;
    }
    
    btnEditorView.disabled = false;
    btnGenerate.disabled = false;
    btnGenerate.innerHTML = `<i class="ph ph-download-simple" aria-hidden="true"></i> <span>${t('header.exportRa')}</span>`;
    if (btnExportExiled) btnExportExiled.disabled = false;
    if (btnExportLabAPI) btnExportLabAPI.disabled = false;
    return true;
}

btnParse.addEventListener('click', () => {
    const displayedText = configInput.value;
    const normalizedUploadedText = uploadedFileText?.replace(/\r\n?/g, '\n');
    const sourceText = uploadedFileText !== null && displayedText === normalizedUploadedText
        ? uploadedFileText
        : displayedText;
    parseEditorText(sourceText);
});

function getSectionLines(text, sectionName) {
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    const headerPattern = new RegExp(`^${sectionName}:\\s*(.*)$`);
    const startIndex = lines.findIndex(line => headerPattern.test(line));
    if (startIndex === -1) return [];

    const result = [];
    const inlineValue = lines[startIndex].match(headerPattern)?.[1];
    if (inlineValue) result.push(inlineValue);

    for (let index = startIndex + 1; index < lines.length; index++) {
        if (/^[A-Za-z0-9_]+:\s*/.test(lines[index])) break;
        result.push(lines[index]);
    }
    return result;
}

function parseMemberCommentValue(rawComment) {
    const value = String(rawComment ?? '').trim();
    const separatorIndex = value.indexOf(':');
    if (separatorIndex >= 0) {
        return {
            name: value.slice(0, separatorIndex).trim(),
            notes: value.slice(separatorIndex + 1).trim()
        };
    }
    const oldRoleMatch = value.match(/^(.*?)\s+antes\s+([A-Za-z0-9_]+)$/i);
    return oldRoleMatch
        ? { name: oldRoleMatch[1].trim(), notes: `antes ${oldRoleMatch[2]}` }
        : { name: value, notes: value };
}

function mostCommonValue(values, fallback) {
    const counts = new Map();
    values.filter(value => value !== undefined && value !== null).forEach(value => {
        counts.set(value, (counts.get(value) || 0) + 1);
    });
    let selected = fallback;
    let selectedCount = -1;
    counts.forEach((count, value) => {
        if (count > selectedCount) {
            selected = value;
            selectedCount = count;
        }
    });
    return selected;
}

function findRemoteAdminSectionEnd(lines, headerIndex) {
    for (let index = headerIndex + 1; index < lines.length; index++) {
        if (/^[A-Za-z0-9_.-]+:\s*(?:.*)?$/.test(lines[index])) return index;
    }
    return lines.length;
}

function sectionContentInsertionIndex(lines, section) {
    if (!section) return lines.length;
    let index = section.endIndex;
    while (index > section.headerIndex + 1 && lines[index - 1] === '') index -= 1;
    return index;
}

function managedEntriesInsertionIndex(section, entries) {
    if (!section) return 0;
    if (!entries || entries.length === 0) return section.headerIndex + 1;
    return Math.max(...entries.map(entry => entry.lineIndex)) + 1;
}

function parseRemoteAdminDocument(text, options = {}) {
    const sourceText = String(text ?? '');
    const hasBom = sourceText.startsWith('\uFEFF');
    const sourceBody = hasBom ? sourceText.slice(1) : sourceText;
    const lineEnding = sourceBody.includes('\r\n')
        ? '\r\n'
        : sourceBody.includes('\n') ? '\n' : sourceBody.includes('\r') ? '\r' : '\n';
    const normalizedBody = sourceBody.replace(/\r\n?/g, '\n');
    const lines = normalizedBody.split('\n');
    const document = {
        sourceText,
        hasBom,
        lineEnding,
        finalNewline: /(?:\r\n|\r|\n)$/.test(sourceBody),
        filename: options.filename || uploadedFileName || null,
        lines,
        sections: {},
        roleSectionName: null,
        memberEntries: [],
        roleEntries: [],
        permissionEntries: [],
        rolePropertyNodes: new Map(),
        duplicateSections: [],
        styles: {
            memberCommentPrefix: '#',
            permissionCommentPrefix: '#',
            memberIndent: ' ',
            roleIndent: ' ',
            permissionIndent: ' '
        }
    };

    const sectionHeaders = [];
    lines.forEach((line, index) => {
        const match = line.match(/^(Members|Roles|Groups|Permissions):\s*$/);
        if (!match) return;
        sectionHeaders.push({ name: match[1], headerIndex: index });
    });
    sectionHeaders.forEach(header => {
        const section = {
            ...header,
            endIndex: findRemoteAdminSectionEnd(lines, header.headerIndex)
        };
        if (header.name === 'Roles' || header.name === 'Groups') {
            if (!document.sections.roles || header.name === 'Roles') {
                if (document.sections.roles) document.duplicateSections.push(document.sections.roles);
                document.sections.roles = section;
                document.roleSectionName = header.name;
            } else {
                document.duplicateSections.push(section);
            }
            return;
        }
        if (document.sections[header.name.toLowerCase()]) {
            document.duplicateSections.push(section);
        } else {
            document.sections[header.name.toLowerCase()] = section;
        }
    });

    const membersSection = document.sections.members;
    if (membersSection) {
        let pendingCommentIndexes = [];
        const commentPrefixes = [];
        for (let index = membersSection.headerIndex + 1; index < membersSection.endIndex; index++) {
            const line = lines[index];
            if (/^\s*#/.test(line)) {
                pendingCommentIndexes.push(index);
                continue;
            }
            const memberMatch = line.match(/^(\s*)-\s*([^:]+):\s*([A-Za-z0-9_.-]+)\s*$/);
            if (memberMatch) {
                const commentLines = pendingCommentIndexes.map(commentIndex => lines[commentIndex]);
                const rawCommentLine = commentLines.at(-1) || '';
                const rawComment = rawCommentLine.replace(/^\s*#\s?/, '');
                const comment = parseMemberCommentValue(rawComment);
                const commentPrefix = rawCommentLine.match(/^(\s*#\s?)/)?.[1];
                if (commentPrefix) commentPrefixes.push(commentPrefix);
                document.memberEntries.push({
                    sourceId: `member:${index}`,
                    lineIndex: index,
                    commentIndexes: pendingCommentIndexes.length
                        ? [pendingCommentIndexes.at(-1)]
                        : [],
                    rawComment,
                    name: comment.name,
                    notes: comment.notes,
                    id: memberMatch[2].trim(),
                    roleName: memberMatch[3].trim(),
                    indent: memberMatch[1]
                });
                pendingCommentIndexes = [];
                continue;
            }
            if (line.trim() !== '') pendingCommentIndexes = [];
            if (line.trim() === '') pendingCommentIndexes = [];
        }
        document.styles.memberCommentPrefix = mostCommonValue(commentPrefixes, '#');
        document.styles.memberIndent = mostCommonValue(
            document.memberEntries.map(entry => entry.indent),
            ' '
        );
    }

    const rolesSection = document.sections.roles;
    if (rolesSection) {
        for (let index = rolesSection.headerIndex + 1; index < rolesSection.endIndex; index++) {
            const roleMatch = lines[index].match(/^(\s*)-\s*([A-Za-z0-9_.-]+):?\s*$/);
            if (!roleMatch || /^\s{2,}/.test(lines[index])) continue;
            document.roleEntries.push({
                sourceId: `role:${index}`,
                lineIndex: index,
                roleName: roleMatch[2],
                indent: roleMatch[1]
            });
        }
        document.styles.roleIndent = mostCommonValue(
            document.roleEntries.map(entry => entry.indent),
            ' '
        );
    }

    const permissionsSection = document.sections.permissions;
    if (permissionsSection) {
        let pendingCommentIndexes = [];
        const permissionCommentPrefixes = [];
        for (let index = permissionsSection.headerIndex + 1; index < permissionsSection.endIndex; index++) {
            const line = lines[index];
            if (/^\s*#/.test(line)) {
                pendingCommentIndexes.push(index);
                continue;
            }
            const permissionMatch = line.match(/^(\s*)-\s*([A-Za-z0-9_.-]+):(\s*)\[(.*)\]([ \t]*)$/);
            if (permissionMatch) {
                const rawCommentLine = pendingCommentIndexes.length
                    ? lines[pendingCommentIndexes.at(-1)]
                    : '';
                const rawComment = rawCommentLine.replace(/^\s*#\s?/, '');
                const commentPrefix = rawCommentLine.match(/^(\s*#\s?)/)?.[1];
                if (commentPrefix) permissionCommentPrefixes.push(commentPrefix);
                document.permissionEntries.push({
                    sourceId: `permission:${index}`,
                    lineIndex: index,
                    commentIndexes: pendingCommentIndexes.length
                        ? [pendingCommentIndexes.at(-1)]
                        : [],
                    permission: permissionMatch[2],
                    roles: permissionMatch[4].split(',').map(role => role.trim()).filter(Boolean),
                    comment: rawComment.trim(),
                    indent: permissionMatch[1],
                    separator: permissionMatch[3],
                    trailingWhitespace: permissionMatch[5]
                });
                pendingCommentIndexes = [];
                continue;
            }
            if (line.trim() !== '') pendingCommentIndexes = [];
            if (line.trim() === '') pendingCommentIndexes = [];
        }
        document.styles.permissionIndent = mostCommonValue(
            document.permissionEntries.map(entry => entry.indent),
            ' '
        );
        document.styles.permissionCommentPrefix = mostCommonValue(permissionCommentPrefixes, '#');
    }

    const rolePropertyPattern = /^([A-Za-z0-9_.-]+?)_(required_kick_power|kick_power|badge|color|cover|hidden):(\s*)(.*)$/;
    lines.forEach((line, index) => {
        const match = line.match(rolePropertyPattern);
        if (!match) return;
        const node = {
            sourceId: `property:${index}`,
            lineIndex: index,
            roleName: match[1],
            property: match[2],
            separator: match[3],
            rawValue: match[4]
        };
        if (!document.rolePropertyNodes.has(node.roleName)) {
            document.rolePropertyNodes.set(node.roleName, new Map());
        }
        const propertyNodes = document.rolePropertyNodes.get(node.roleName);
        if (!propertyNodes.has(node.property)) propertyNodes.set(node.property, []);
        propertyNodes.get(node.property).push(node);
    });

    return document;
}

function isRemoteAdminConfig(text) {
    return /^(Members|Permissions|override_password_role):/m.test(text)
        || /^[A-Za-z0-9_]+_(badge|color|cover|hidden|kick_power|required_kick_power):/m.test(text);
}

function createRoleData() {
    return {
        badge: 'default',
        color: 'default',
        kickPower: 0,
        reqKickPower: 0,
        cover: true,
        hidden: false,
        permissions: new Set()
    };
}

function applyRoleProperty(target, property, value) {
    if (property === 'badge') target.badge = value;
    if (property === 'color') target.color = value;
    if (property === 'cover') target.cover = value.toLowerCase() === 'true';
    if (property === 'hidden') target.hidden = value.toLowerCase() === 'true';
    if (property === 'kick_power') target.kickPower = Number.parseInt(value, 10) || 0;
    if (property === 'required_kick_power') target.reqKickPower = Number.parseInt(value, 10) || 0;
}

function parseConfig(text) {
    hasLoadedRemoteAdmin = true;
    remoteAdminRevision += 1;
    invalidateBadgeBulkPreview();
    remoteAdminDocument = parseRemoteAdminDocument(text, { filename: uploadedFileName });
    parsedData.groups = {};
    parsedData.settings = { ...DEFAULT_SETTINGS };
    parsedData.permissionList = [...DEFAULT_PERMISSION_LIST];
    parsedData.permissionComments = {};
    parsedData.overridePasswordPrefixes = new Set();
    parsedData.overridePasswordRoles = new Set();
    parsedData.overridePasswordUnknownRoles = new Set();
    parsedData.roleDefinitions = new Set();
    parsedData.orphanRoleData = new Map();
    parsedData.originalMemberRoles = new Set();
    parsedData.declaredGroupRoles = new Set();
    parsedData.permissionUnknownRoleRefs = new Map();
    parsedData.sourceValidationIssues = [];
    parsedData.headerComments = "";

    const headerMatch = text.match(/^([\s\S]*?)^Members:/m);
    if (headerMatch) {
        parsedData.headerComments = headerMatch[1]
            .split(/\r?\n/)
            .filter(line => line.trim().startsWith('#') || line.trim() === '')
            .join('\n')
            .trim();
    }

    Object.keys(parsedData.settings).forEach(key => {
        if (key === 'PredefinedBanTemplates') {
            const sectionValue = getSectionLines(text, key).join('\n').trim();
            if (sectionValue) parsedData.settings[key] = sectionValue;
            return;
        }
        const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const settingMatch = text.match(new RegExp(`^${escapedKey}:\\s*(.*)$`, 'm'));
        if (settingMatch) parsedData.settings[key] = settingMatch[1].trim();
    });

    const rawMembers = remoteAdminDocument.memberEntries.map(entry => ({
        id: entry.id,
        role: entry.roleName,
        name: entry.name,
        notes: entry.notes,
        sourceMemberId: entry.sourceId
    }));

    const numberedPrefixCounts = new Map();
    rawMembers.forEach(({ role }) => {
        const match = role.match(/^([A-Za-z_]+)(\d+)$/);
        if (!match) return;
        numberedPrefixCounts.set(match[1], (numberedPrefixCounts.get(match[1]) || 0) + 1);
    });
    const numberedPrefixes = new Set();
    rawMembers.forEach(({ role }) => {
        const match = role.match(/^([A-Za-z_]+)(\d+)$/);
        if (match && (numberedPrefixCounts.get(match[1]) > 1 || Number(match[2]) === 1)) {
            numberedPrefixes.add(match[1]);
        }
    });

    const resolveRoleGroup = role => {
        const match = role.match(/^([A-Za-z_]+)(\d+)$/);
        if (match && numberedPrefixes.has(match[1])) {
            return { prefix: match[1], isNumbered: true };
        }
        return { prefix: role, isNumbered: false };
    };

    const memberMapping = {};
    rawMembers.forEach(rawMember => {
        const { prefix, isNumbered } = resolveRoleGroup(rawMember.role);
        if (!parsedData.groups[prefix]) {
            parsedData.groups[prefix] = { prefix, members: [], permissions: new Set(), isNumbered };
        }
        const member = {
            ...createRoleData(),
            id: rawMember.id,
            name: rawMember.name,
            notes: rawMember.notes,
            roleName: rawMember.role,
            oldRole: rawMember.role,
            sourceMemberId: rawMember.sourceMemberId,
            prefix
        };
        parsedData.groups[prefix].members.push(member);
        (memberMapping[rawMember.role] ||= []).push(member);
        parsedData.roleDefinitions.add(rawMember.role);
        parsedData.originalMemberRoles.add(rawMember.role);
    });

    const ensureRoleDefinition = role => {
        parsedData.roleDefinitions.add(role);
        if (!memberMapping[role] && !parsedData.orphanRoleData.has(role)) {
            parsedData.orphanRoleData.set(role, createRoleData());
        }
        return memberMapping[role] || [parsedData.orphanRoleData.get(role)];
    };

    let nestedRole = null;
    const declaredRolesSectionName = remoteAdminDocument.roleSectionName || 'Groups';
    getSectionLines(text, declaredRolesSectionName).forEach(rawLine => {
        if (/^\s*-\s*:?\s*$/.test(rawLine)) {
            parsedData.sourceValidationIssues.push({
                code: 'GROUP_NAME_MISSING',
                severity: 'error',
                message: t('src.groupNameMissing')
            });
            nestedRole = null;
            return;
        }
        const roleMatch = rawLine.match(/^\s*-\s*([A-Za-z0-9_.-]+):?\s*$/);
        if (roleMatch && !/^\s{2,}/.test(rawLine)) {
            nestedRole = roleMatch[1];
            parsedData.declaredGroupRoles.add(nestedRole);
            ensureRoleDefinition(nestedRole);
            return;
        }
        if (!nestedRole) return;
        const propertyMatch = rawLine.match(/^\s+-\s*(badge|color|cover|hidden|kick_power|required_kick_power):\s*(.*)$/);
        if (propertyMatch) {
            ensureRoleDefinition(nestedRole).forEach(target => applyRoleProperty(target, propertyMatch[1], propertyMatch[2].trim()));
            return;
        }
        const permissionMatch = rawLine.match(/^\s+-\s*([A-Za-z0-9_.-]+)\s*$/);
        if (permissionMatch) {
            const permission = permissionMatch[1];
            ensureRoleDefinition(nestedRole).forEach(target => target.permissions.add(permission));
            if (!parsedData.permissionList.includes(permission)) parsedData.permissionList.push(permission);
        }
    });

    const undeclaredMemberRoles = [...parsedData.originalMemberRoles]
        .filter(role => !parsedData.declaredGroupRoles.has(role));
    if (undeclaredMemberRoles.length > 0) {
        parsedData.sourceValidationIssues.push({
            code: 'AUTO_REPAIRED_UNKNOWN_USER_GROUP',
            severity: 'warning',
            message: t('src.unknownUserGroup', { list: undeclaredMemberRoles.join(', ') })
        });
    }

    const badgeRegex = /^([A-Za-z0-9_.-]+?)_(required_kick_power|kick_power|badge|color|cover|hidden):\s*(.*)$/gm;
    let badgeMatch;
    while ((badgeMatch = badgeRegex.exec(text)) !== null) {
        const [, role, property, rawValue] = badgeMatch;
        ensureRoleDefinition(role).forEach(target => applyRoleProperty(target, property, rawValue.trim()));
    }

    let currentPermissionComment = '';
    getSectionLines(text, 'Permissions').forEach(rawLine => {
        const line = rawLine.trim();
        if (line.startsWith('#')) {
            currentPermissionComment = line.slice(1).trim();
            return;
        }
        const permissionMatch = line.match(/^-\s*([A-Za-z0-9_.-]+):\s*\[(.*)\]\s*$/);
        if (!permissionMatch) return;
        const permission = permissionMatch[1];
        if (!parsedData.permissionList.includes(permission)) parsedData.permissionList.push(permission);
        if (currentPermissionComment) parsedData.permissionComments[permission] = currentPermissionComment;
        currentPermissionComment = '';
        permissionMatch[2]
            .split(',')
            .map(role => role.trim())
            .filter(Boolean)
            .forEach(role => {
                const targets = memberMapping[role]
                    || (parsedData.orphanRoleData.has(role) ? [parsedData.orphanRoleData.get(role)] : null);
                if (targets) {
                    targets.forEach(target => target.permissions.add(permission));
                    return;
                }
                if (!parsedData.permissionUnknownRoleRefs.has(permission)) {
                    parsedData.permissionUnknownRoleRefs.set(permission, new Set());
                }
                parsedData.permissionUnknownRoleRefs.get(permission).add(role);
            });
    });

    Object.values(parsedData.groups).forEach(group => recomputeGroupPermissions(group));

    const overrideMatch = text.match(/^override_password_role:\s*(.*)$/m);
    if (overrideMatch) {
        overrideMatch[1].split(',').map(role => role.trim()).filter(Boolean).forEach(role => {
            parsedData.overridePasswordRoles.add(role);
            const groupEntry = Object.entries(parsedData.groups).find(([, group]) =>
                group.members.some((member, index) => getRoleName(group.prefix, group, index) === role || member.oldRole === role)
            );
            if (groupEntry) parsedData.overridePasswordPrefixes.add(groupEntry[0]);
            if (!parsedData.roleDefinitions.has(role)) parsedData.overridePasswordUnknownRoles.add(role);
        });
    }
}

// UI Rendering
function updateOldRoles() {
    ensureStableRoleNames(parsedData);
}

let currentDesktopGroup = null;
let lastDesktopLayout = null;

function renderRAEditor() {
    const container = document.getElementById('ra-accordion');
    if(!container) return;
    container.innerHTML = '';
    
    const groupKeys = Object.keys(parsedData.groups).sort((a,b) => a.localeCompare(b));
    const searchEl = document.getElementById('search-input');
    const searchQuery = searchEl ? searchEl.value.toLowerCase().trim() : '';
    
    if (groupKeys.length > 0 && (!currentDesktopGroup || !groupKeys.includes(currentDesktopGroup))) {
        currentDesktopGroup = groupKeys[0];
    }
    
    const useDesktopLayout = window.innerWidth >= 1024;
    lastDesktopLayout = useDesktopLayout;
    if (useDesktopLayout) {
        renderSplitView(container, groupKeys, searchQuery);
    } else {
        renderAccordionView(container, groupKeys, searchQuery);
    }
    
    if (container.innerHTML === '') {
        container.innerHTML = `<div class="empty-state"><i class="ph ph-users"></i><p>${t('cards.noResults')}</p></div>`;
    }
    scheduleRemoteAdminDiagnosticsRefresh();
}

window.addEventListener('resize', () => {
    const useDesktopLayout = window.innerWidth >= 1024;
    if (lastDesktopLayout !== null && useDesktopLayout !== lastDesktopLayout) {
        renderRAEditor();
    }
});

function renderAccordionView(container, groupKeys, searchQuery) {
    groupKeys.forEach(prefix => {
        const group = parsedData.groups[prefix];
        
        const visibleMembers = getVisibleMemberEntries(group, prefix, searchQuery);
        
        // If searching and no members match, skip rendering this group
        if (searchQuery && visibleMembers.length === 0) return;
        
        const item = document.createElement('div');
        item.className = 'accordion-item';
        if (searchQuery) item.classList.add('active'); // auto-expand if searching
        item.dataset.prefix = prefix;
        
        // Header
        const header = document.createElement('div');
        header.className = 'accordion-header-row';
        header.innerHTML = `
            <h3 class="accordion-title">${t('cards.groupName', { prefix: escapeHtml(prefix) })}${groupLabelSuffix(prefix)} <span class="group-count" style="background: var(--secondary-color); color: var(--text-main); font-size: 0.75rem; padding: 2px 8px; border-radius: 12px;">${group.members.length}</span></h3>
            <div class="accordion-actions">
                <button type="button" class="btn-icon btn-permissions" title="${t('cards.groupPermsTitle')}" aria-label="${t('cards.groupPerms')}"><i class="ph ph-key" aria-hidden="true"></i></button>
                <button type="button" class="btn-icon btn-add" title="${t('cards.addMemberTitle')}" aria-label="${t('cards.addMember')}"><i class="ph ph-user-plus" aria-hidden="true"></i></button>
                <button type="button" class="btn-icon btn-delete-group" title="${t('cards.deleteGroupTitle')}" aria-label="${t('cards.deleteGroupAria')}"><i class="ph ph-trash" aria-hidden="true"></i></button>
            </div>
        `;
        const headerToggle = header.querySelector('.accordion-title');
        headerToggle.setAttribute('role', 'button');
        headerToggle.setAttribute('tabindex', '0');
        headerToggle.setAttribute('aria-expanded', String(item.classList.contains('active')));
        
        // Body (Members)
        const body = document.createElement('div');
        body.className = 'accordion-body';
        
        if (visibleMembers.length === 0) {
            body.innerHTML = `<p style="color: var(--text-muted); text-align: center; margin: 0;">${t('cards.noMembers')}</p>`;
        } else {
            visibleMembers.forEach(({ member, originalIndex, roleStr }) => {
                
                const memberItem = document.createElement('div');
                memberItem.className = 'member-list-item';
                
                const mHeader = document.createElement('div');
                mHeader.className = 'member-list-header';
                mHeader.innerHTML = `
                    <div style="display:flex; align-items: center; gap: 8px;">
                        <i class="ph ph-dots-six-vertical drag-handle" style="cursor: grab; color: var(--text-muted); font-size: 1.2rem; padding: 4px;" title="${t('cards.dragTitle')}"></i>
                         <span style="font-weight: 600;">${escapeHtml(roleStr)}</span>
                         <span>${escapeHtml(member.name || t('cards.noName'))}</span>
                         <span style="color: var(--text-muted); font-size: 0.85em; overflow: hidden; text-overflow: ellipsis; max-width: 150px; white-space: nowrap;">${escapeHtml(member.id)}</span>
                    </div>
                    <i class="ph ph-caret-down"></i>
                `;
                mHeader.setAttribute('role', 'button');
                mHeader.setAttribute('tabindex', '0');
                mHeader.setAttribute('aria-expanded', 'false');
                
                const mBody = document.createElement('div');
                mBody.className = 'member-list-body';
                
                // Add mini preview and edit/delete buttons
                mBody.innerHTML = `
                    ${member.notes ? `<div class="member-notes">${escapeHtml(member.notes)}</div>` : ''}
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; flex-wrap: wrap; gap: 8px;">
                        <div class="member-badge-preview c-${safeCssToken(member.color)}" style="font-size: 0.8rem; padding: 4px 8px;">${escapeHtml(member.badge)}</div>
                        <div style="display: flex; gap: 8px;">
                            <button type="button" class="btn btn-secondary btn-promote-member" style="font-size: 0.8rem; padding: 6px 10px;"><i class="ph ph-arrow-fat-line-up" aria-hidden="true"></i> ${t('cards.promote')}</button>
                            <button type="button" class="btn btn-secondary btn-demote-member" style="font-size: 0.8rem; padding: 6px 10px;"><i class="ph ph-arrow-fat-line-down" aria-hidden="true"></i> ${t('cards.demote')}</button>
                            <button type="button" class="btn btn-secondary btn-member-perms" style="font-size: 0.8rem; padding: 6px 10px;"><i class="ph ph-key" aria-hidden="true"></i> ${t('cards.perms')}</button>
                            <button type="button" class="btn btn-secondary btn-edit-member"><i class="ph ph-pencil-simple" aria-hidden="true"></i> ${t('cards.editBtn')}</button>
                            <button type="button" class="btn btn-danger btn-delete-member" aria-label="${t('cards.deleteAria')}" style="background: rgba(191,97,106,0.2); color: var(--danger-color); border:none; padding:8px; border-radius:4px;"><i class="ph ph-trash" aria-hidden="true"></i></button>
                        </div>
                    </div>
                    <div style="display:flex; gap: 16px; font-size: 0.85rem; color: var(--text-muted); flex-wrap: wrap;">
                        <span><i class="ph ph-boot"></i> KP: ${member.kickPower}</span>
                        <span><i class="ph ph-shield"></i> RKP: ${member.reqKickPower}</span>
                        <span><i class="ph ph-eye-slash"></i> Hidden: ${member.hidden ? t('cards.hiddenYes') : t('cards.hiddenNo')}</span>
                        <span><i class="ph ph-key"></i> ${t('cards.permsCount')}: ${member.permissions ? member.permissions.size : 0}</span>
                    </div>
                `;
                
                mHeader.addEventListener('click', (e) => {
                    if (e.target.closest('.drag-handle')) return;
                    memberItem.classList.toggle('active');
                    mHeader.setAttribute('aria-expanded', String(memberItem.classList.contains('active')));
                });
                mHeader.addEventListener('keydown', event => {
                    if (event.target !== mHeader || !['Enter', ' '].includes(event.key)) return;
                    event.preventDefault();
                    mHeader.click();
                });
                
                mBody.querySelector('.btn-promote-member').addEventListener('click', () => {
                    openPromoteModal(prefix, originalIndex);
                });

                mBody.querySelector('.btn-demote-member').addEventListener('click', () => {
                    openDemoteModal(prefix, originalIndex);
                });

                mBody.querySelector('.btn-member-perms').addEventListener('click', () => {
                    openMemberPermissionsModal(prefix, originalIndex);
                });
                
                mBody.querySelector('.btn-edit-member').addEventListener('click', () => {
                    currentSelectedGroup = prefix;
                    editMember(originalIndex);
                });
                
                mBody.querySelector('.btn-delete-member').addEventListener('click', () => {
                    if (confirm(t('member.deleteConfirm'))) {
                        group.members.splice(originalIndex, 1);
                        recomputeGroupPermissions(group);
                        updateOldRoles();
                        renderRAEditor();
                    }
                });
                
                memberItem.appendChild(mHeader);
                memberItem.appendChild(mBody);
                body.appendChild(memberItem);
            });
            
            // Initialize drag and drop if not searching
            if (!searchQuery && typeof Sortable === 'function') {
                new Sortable(body, {
                    animation: 150,
                    handle: '.drag-handle',
                    ghostClass: 'sortable-ghost',
                    onEnd: function (evt) {
                        const oldIndex = evt.oldIndex;
                        const newIndex = evt.newIndex;
                        if (oldIndex !== newIndex) {
                            const movedItem = group.members.splice(oldIndex, 1)[0];
                            group.members.splice(newIndex, 0, movedItem);
                            updateOldRoles();
                            renderRAEditor();
                        }
                    }
                });
            }
        }
        
        // Event Listeners for Header Actions
        header.addEventListener('click', (e) => {
            if (e.target.closest('button')) return; // Ignore if clicked on button
            item.classList.toggle('active');
            headerToggle.setAttribute('aria-expanded', String(item.classList.contains('active')));
        });
        headerToggle.addEventListener('keydown', event => {
            if (!['Enter', ' '].includes(event.key)) return;
            event.preventDefault();
            item.classList.toggle('active');
            headerToggle.setAttribute('aria-expanded', String(item.classList.contains('active')));
        });
        
        header.querySelector('.btn-permissions').addEventListener('click', () => {
            currentSelectedGroup = prefix;
            openPermissionsModal(prefix);
        });
        
        header.querySelector('.btn-add').addEventListener('click', () => {
            currentSelectedGroup = prefix;
            editingIndex = -1;
            document.getElementById('member-modal-title').textContent = t('memberModal.addToGroup', { group: prefix });
            memberForm.reset();
            document.getElementById('member-badge').value = getGroupBadgeLabel(prefix);
            document.getElementById('member-color').value = 'default';
            document.getElementById('member-kick-power').value = 1;
            document.getElementById('member-req-kick').value = 1;
            document.getElementById('member-cover').checked = true;
            document.getElementById('member-hidden').checked = false;
            showModal(memberModal, document.getElementById('member-name'));
        });
        
        header.querySelector('.btn-delete-group').addEventListener('click', () => {
            if (confirm(t('group.deleteConfirm', { prefix }))) {
                delete parsedData.groups[prefix];
                if (currentDesktopGroup === prefix) currentDesktopGroup = null;
                updateOldRoles();
                renderRAEditor();
            }
        });
        
        item.appendChild(header);
        item.appendChild(body);
        container.appendChild(item);
    });
}

function renderSplitView(container, groupKeys, searchQuery) {
    const splitLayout = document.createElement('div');
    splitLayout.className = 'split-layout';
    
    // Sidebar
    const sidebar = document.createElement('div');
    sidebar.className = 'split-sidebar';
    
    const sidebarTitle = document.createElement('h3');
    sidebarTitle.className = 'sidebar-title';
    sidebarTitle.textContent = t('cards.categories');
    sidebar.appendChild(sidebarTitle);
    
    const sidebarList = document.createElement('div');
    sidebarList.className = 'sidebar-list';
    
    groupKeys.forEach(prefix => {
        const group = parsedData.groups[prefix];
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.className = `sidebar-tab ${prefix === currentDesktopGroup ? 'active' : ''}`;
        tab.setAttribute('aria-pressed', String(prefix === currentDesktopGroup));
        
        // Search highlighting for sidebar: if a group has matching members, show it somehow, 
        // but it's better to just render everything and let the main area filter.
        tab.innerHTML = `
            <span class="tab-name">${t('cards.groupName', { prefix: escapeHtml(prefix) })}${groupLabelSuffix(prefix)}</span>
            <span class="sidebar-badge">${group.members.length}</span>
        `;
        tab.addEventListener('click', () => {
            currentDesktopGroup = prefix;
            renderRAEditor();
        });
        sidebarList.appendChild(tab);
    });
    sidebar.appendChild(sidebarList);
    splitLayout.appendChild(sidebar);
    
    // Main Area
    const main = document.createElement('div');
    main.className = 'split-main';
    
    if (currentDesktopGroup && parsedData.groups[currentDesktopGroup]) {
        const group = parsedData.groups[currentDesktopGroup];
        
        const mainHeader = document.createElement('div');
        mainHeader.className = 'split-main-header';
        mainHeader.innerHTML = `
            <h2>${t('cards.categoryName', { name: escapeHtml(currentDesktopGroup) })}${groupLabelSuffix(currentDesktopGroup)}</h2>
            <div class="split-main-actions">
                <button type="button" class="btn btn-secondary btn-permissions" title="${t('cards.groupPermsTitle')}"><i class="ph ph-key" aria-hidden="true"></i> ${t('cards.groupPerms')}</button>
                <button type="button" class="btn btn-primary btn-add"><i class="ph ph-plus" aria-hidden="true"></i> ${t('cards.addMember')}</button>
            </div>
        `;
        
        mainHeader.querySelector('.btn-permissions').addEventListener('click', () => {
            currentSelectedGroup = currentDesktopGroup;
            openPermissionsModal(currentDesktopGroup);
        });
        
        mainHeader.querySelector('.btn-add').addEventListener('click', () => {
            currentSelectedGroup = currentDesktopGroup;
            editingIndex = -1;
            document.getElementById('member-modal-title').textContent = t('memberModal.addToGroup', { group: currentDesktopGroup });
            memberForm.reset();
            document.getElementById('member-badge').value = getGroupBadgeLabel(currentDesktopGroup);
            document.getElementById('member-color').value = 'default';
            document.getElementById('member-kick-power').value = 1;
            document.getElementById('member-req-kick').value = 1;
            document.getElementById('member-cover').checked = true;
            document.getElementById('member-hidden').checked = false;
            showModal(memberModal, document.getElementById('member-name'));
        });
        
        main.appendChild(mainHeader);
        
        // Members Grid
        const grid = document.createElement('div');
        grid.className = 'member-grid';
        
        const visibleMembers = getVisibleMemberEntries(group, currentDesktopGroup, searchQuery);
        
        if (visibleMembers.length === 0) {
            grid.innerHTML = `<p style="color: var(--text-muted); grid-column: 1 / -1; padding: 24px; text-align: center; border: 1px dashed var(--border-color); border-radius: var(--radius-md);">${t('cards.noMembersInCat')}</p>`;
        } else {
            visibleMembers.forEach(({ member, originalIndex, roleStr }) => {
                const card = document.createElement('div');
                card.className = 'member-grid-card';
                card.innerHTML = `
                    <div class="card-header">
                        <div style="display:flex; align-items:center; gap:8px;">
                            <i class="ph ph-dots-six-vertical drag-handle" style="cursor: grab; color: var(--text-muted); padding:4px;" title="${t('cards.dragTitle')}"></i>
                            <div class="grid-card-badge">${escapeHtml(roleStr)}</div>
                        </div>
                        <div class="card-actions">
                            <button type="button" class="btn-icon btn-promote-member" title="${t('cards.promoteTitle')}" aria-label="${t('cards.promoteAria')}"><i class="ph ph-arrow-fat-line-up" aria-hidden="true"></i></button>
                            <button type="button" class="btn-icon btn-demote-member" title="${t('cards.demoteTitle')}" aria-label="${t('cards.demoteAria')}"><i class="ph ph-arrow-fat-line-down" aria-hidden="true"></i></button>
                            <button type="button" class="btn-icon btn-member-perms" title="${t('cards.permsTitle')}" aria-label="${t('cards.permsAria')}"><i class="ph ph-key" aria-hidden="true"></i></button>
                            <button type="button" class="btn-icon btn-edit-member" aria-label="${t('cards.editAria')}"><i class="ph ph-pencil-simple" aria-hidden="true"></i></button>
                            <button type="button" class="btn-icon btn-delete-member" aria-label="${t('cards.deleteAria')}"><i class="ph ph-trash" aria-hidden="true"></i></button>
                        </div>
                    </div>
                    <div class="card-body">
                        <div class="member-name">${escapeHtml(member.name || t('cards.noName'))}</div>
                        ${member.notes ? `<div class="member-notes">${escapeHtml(member.notes)}</div>` : ''}
                        <div class="member-id">${escapeHtml(member.id)}</div>
                        <div class="member-badge-preview c-${safeCssToken(member.color)}">${escapeHtml(member.badge)}</div>
                    </div>
                `;
                
                card.querySelector('.btn-promote-member').addEventListener('click', () => {
                    openPromoteModal(currentDesktopGroup, originalIndex);
                });

                card.querySelector('.btn-demote-member').addEventListener('click', () => {
                    openDemoteModal(currentDesktopGroup, originalIndex);
                });

                card.querySelector('.btn-member-perms').addEventListener('click', () => {
                    openMemberPermissionsModal(currentDesktopGroup, originalIndex);
                });
                card.querySelector('.btn-edit-member').addEventListener('click', () => {
                    currentSelectedGroup = currentDesktopGroup;
                    editMember(originalIndex);
                });
                card.querySelector('.btn-delete-member').addEventListener('click', () => {
                    if (confirm(t('member.deleteConfirm'))) {
                        group.members.splice(originalIndex, 1);
                        recomputeGroupPermissions(group);
                        updateOldRoles();
                        renderRAEditor();
                    }
                });
                
                grid.appendChild(card);
            });
            
            if (!searchQuery && typeof Sortable === 'function') {
                new Sortable(grid, {
                    animation: 150,
                    handle: '.drag-handle',
                    ghostClass: 'sortable-ghost-grid',
                    onEnd: function (evt) {
                        const oldIndex = evt.oldIndex;
                        const newIndex = evt.newIndex;
                        if (oldIndex !== newIndex) {
                            const movedItem = group.members.splice(oldIndex, 1)[0];
                            group.members.splice(newIndex, 0, movedItem);
                            updateOldRoles();
                            renderRAEditor();
                        }
                    }
                });
            }
        }
        main.appendChild(grid);
    }
    splitLayout.appendChild(main);
    container.appendChild(splitLayout);
}


// Search Logic
const searchInput = document.getElementById('search-input');
if (searchInput) {
    searchInput.addEventListener('input', () => {
        renderRAEditor();
    });
}

// Add/Edit Logic
let editingIndex = -1;

function editMember(index) {
    editingIndex = index;
    const member = parsedData.groups[currentSelectedGroup].members[index];
    
    document.getElementById('member-modal-title').textContent = t('memberModal.edit');
    document.getElementById('member-name').value = member.name || '';
    document.getElementById('member-notes').value = member.notes || '';
    document.getElementById('member-steamid').value = member.id;
    document.getElementById('member-badge').value = member.badge;
    
    const colorSelect = document.getElementById('member-color');
    // Si el color no está en las opciones, seleccionar default
    if(Array.from(colorSelect.options).some(o => o.value === member.color)) {
        colorSelect.value = member.color;
    } else {
        colorSelect.value = 'default';
    }
    
    document.getElementById('member-kick-power').value = member.kickPower;
    document.getElementById('member-req-kick').value = member.reqKickPower;
    document.getElementById('member-cover').checked = member.cover;
    document.getElementById('member-hidden').checked = member.hidden;
    
    showModal(memberModal, document.getElementById('member-name'));
}


memberForm.addEventListener('submit', (e) => {
    e.preventDefault();
    
    const id = document.getElementById('member-steamid').value.trim();
    if (!validateRemoteAdminUserId(id).valid) {
        alert(t('member.invalidId'));
        return;
    }

    const kickPower = Number.parseInt(document.getElementById('member-kick-power').value, 10);
    const reqKickPower = Number.parseInt(document.getElementById('member-req-kick').value, 10);
    if (![kickPower, reqKickPower].every(value => Number.isInteger(value) && value >= 0 && value <= 255)) {
        alert(t('member.kickRange'));
        return;
    }
    
    const newMember = {
        name: document.getElementById('member-name').value.trim(),
        notes: document.getElementById('member-notes').value.trim(),
        id: id,
        badge: document.getElementById('member-badge').value.trim(),
        color: document.getElementById('member-color').value,
        kickPower,
        reqKickPower,
        cover: document.getElementById('member-cover').checked,
        hidden: document.getElementById('member-hidden').checked,
        prefix: currentSelectedGroup
    };
    
    const selectedGroup = parsedData.groups[currentSelectedGroup];
    if (editingIndex === -1) {
        newMember.oldRole = null;
        newMember.roleName = '';
        newMember.sourceMemberId = null;
        newMember.permissions = new Set(selectedGroup.permissions);
        selectedGroup.members.push(newMember);
    } else {
        // preserve oldRole and permissions if editing
        const oldMember = selectedGroup.members[editingIndex];
        newMember.oldRole = oldMember.oldRole;
        newMember.roleName = oldMember.roleName || oldMember.oldRole || '';
        newMember.sourceMemberId = oldMember.sourceMemberId || null;
        newMember.permissions = oldMember.permissions;
        selectedGroup.members[editingIndex] = newMember;
    }

    if (!selectedGroup.isNumbered) {
        selectedGroup.members.forEach(member => {
            member.badge = newMember.badge;
            member.color = newMember.color;
            member.kickPower = newMember.kickPower;
            member.reqKickPower = newMember.reqKickPower;
            member.cover = newMember.cover;
            member.hidden = newMember.hidden;
            member.permissions = new Set(newMember.permissions);
        });
    }
    
    recomputeGroupPermissions(selectedGroup);
    hideModal(memberModal);
    updateOldRoles();
    renderRAEditor();
});

btnCloseMemberModal.addEventListener('click', () => hideModal(memberModal));

// Category Management
const btnAddCategory = document.getElementById('btn-add-category');
if (btnAddCategory) {
    btnAddCategory.addEventListener('click', () => {
        const name = prompt(t('group.newPrompt'));
        if (!name || !name.trim()) return;
        const prefix = name.trim();
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(prefix)) {
            alert(t('group.invalidName'));
            return;
        }
        if (parsedData.groups[prefix]) {
            alert(t('group.exists', { prefix }));
            return;
        }
        parsedData.groups[prefix] = { prefix: prefix, members: [], permissions: new Set(), isNumbered: true };
        currentDesktopGroup = prefix;
        renderRAEditor();
    });
}

// Permissions Modal Logic
let permissionsContext = { prefix: null, memberIndex: null };

function openPermissionsModal(prefix) {
    permissionsContext = { prefix, memberIndex: null };
    
    document.getElementById('permissions-modal-title').textContent = t('permModal.groupTitle', { group: prefix });
    permissionsGrid.innerHTML = '';
    
    const group = parsedData.groups[prefix];
    const members = group.members;
    
    parsedData.permissionList.forEach(perm => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'perm-item';

        const label = document.createElement('label');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.dataset.perm = perm;
        
        // Count how many members have this permission
        let membersWithPerm = [];
        let membersWithoutPerm = [];
        members.forEach((m, i) => {
            const hasPerm = ensureMemberPermissions(m, group.permissions).has(perm);
            const roleStr = getRoleName(prefix, group, i);
            if (hasPerm) {
                membersWithPerm.push(roleStr);
            } else {
                membersWithoutPerm.push(roleStr);
            }
        });
        
        const allHave = membersWithoutPerm.length === 0 && members.length > 0;
        const someHave = membersWithPerm.length > 0 && membersWithoutPerm.length > 0;
        const noneHave = membersWithPerm.length === 0;
        
        // Set checkbox state
        if (allHave) {
            checkbox.checked = true;
            checkbox.indeterminate = false;
        } else if (someHave) {
            checkbox.checked = false;
            checkbox.indeterminate = true;
        } else {
            checkbox.checked = false;
            checkbox.indeterminate = false;
        }
        checkbox.dataset.initialState = allHave ? 'all' : someHave ? 'some' : 'none';
        checkbox.dataset.changed = 'false';
        checkbox.addEventListener('change', () => {
            checkbox.indeterminate = false;
            checkbox.dataset.changed = 'true';
        });
        
        // Status icon
        const statusSpan = document.createElement('span');
        statusSpan.style.cssText = 'margin-right: 8px; font-weight: bold; font-size: 1rem;';
        if (allHave) {
            statusSpan.textContent = '✅';
        } else if (someHave) {
            statusSpan.textContent = '⚠️';
            statusSpan.style.color = '#ebcb8b';
        } else {
            statusSpan.textContent = '❌';
        }
        
        const nameSpan = document.createElement('span');
        nameSpan.className = 'perm-name';
        nameSpan.textContent = perm;
        
        label.appendChild(checkbox);
        label.appendChild(statusSpan);
        label.appendChild(nameSpan);
        itemDiv.appendChild(label);
        
        // Subtitle: who doesn't have it (for partial)
        if (someHave) {
            const subtitle = document.createElement('div');
            subtitle.style.cssText = 'font-size: 0.75rem; color: #ebcb8b; margin-left: 52px; margin-top: 2px;';
            subtitle.textContent = t('cards.noPerms', { list: membersWithoutPerm.join(', ') });
            itemDiv.appendChild(subtitle);
        }
        
        const comment = parsedData.permissionComments[perm];
        if (comment && comment !== perm) {
            const desc = document.createElement('div');
            desc.className = 'perm-desc';
            desc.textContent = comment;
            itemDiv.appendChild(desc);
        }
        
        permissionsGrid.appendChild(itemDiv);
    });
    
    showModal(permissionsModal, permissionsGrid.querySelector('input[type="checkbox"]'));
}

function openMemberPermissionsModal(prefix, memberIndex) {
    permissionsContext = { prefix, memberIndex };
    const member = parsedData.groups[prefix].members[memberIndex];
    const roleStr = getRoleName(prefix, parsedData.groups[prefix], memberIndex);

    ensureMemberPermissions(member, parsedData.groups[prefix].permissions);
    
    document.getElementById('permissions-modal-title').textContent = t('permModal.memberTitle', { name: member.name || roleStr });
    permissionsGrid.innerHTML = '';
    
    parsedData.permissionList.forEach(perm => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'perm-item';

        const label = document.createElement('label');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.dataset.perm = perm;
        
        checkbox.checked = member.permissions.has(perm);
        
        const nameSpan = document.createElement('span');
        nameSpan.className = 'perm-name';
        nameSpan.textContent = perm;
        
        label.appendChild(checkbox);
        label.appendChild(nameSpan);
        itemDiv.appendChild(label);
        
        const comment = parsedData.permissionComments[perm];
        if (comment && comment !== perm) {
            const desc = document.createElement('div');
            desc.className = 'perm-desc';
            desc.textContent = comment;
            itemDiv.appendChild(desc);
        }
        
        permissionsGrid.appendChild(itemDiv);
    });
    
    showModal(permissionsModal, permissionsGrid.querySelector('input[type="checkbox"]'));
}

btnSavePermissions.addEventListener('click', () => {
    const checkboxes = permissionsGrid.querySelectorAll('input[type="checkbox"]');
    const { prefix, memberIndex } = permissionsContext;
    
    if (memberIndex !== null && memberIndex !== undefined) {
        const group = parsedData.groups[prefix];
        const targets = group.isNumbered ? [group.members[memberIndex]] : group.members;
        targets.forEach(member => {
            ensureMemberPermissions(member).clear();
            checkboxes.forEach(cb => {
                if (cb.checked) member.permissions.add(cb.dataset.perm);
            });
        });
        recomputeGroupPermissions(group);
    } else {
        const group = parsedData.groups[prefix];
        if (group.members.length === 0) {
            group.permissions.clear();
            checkboxes.forEach(cb => {
                if (cb.checked) group.permissions.add(cb.dataset.perm);
            });
        } else {
            checkboxes.forEach(cb => {
                if (cb.dataset.changed !== 'true') return;
                group.members.forEach(member => {
                    const permissions = ensureMemberPermissions(member);
                    if (cb.checked) permissions.add(cb.dataset.perm);
                    else permissions.delete(cb.dataset.perm);
                });
            });
            recomputeGroupPermissions(group);
        }
    }
    
    hideModal(permissionsModal);
    renderRAEditor();
});

btnClosePermissionsModal.addEventListener('click', () => hideModal(permissionsModal));

btnPermCheckAll.addEventListener('click', () => {
    permissionsGrid.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.indeterminate = false;
        cb.checked = true;
        cb.dataset.changed = 'true';
    });
});

btnPermUncheckAll.addEventListener('click', () => {
    permissionsGrid.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.indeterminate = false;
        cb.checked = false;
        cb.dataset.changed = 'true';
    });
});

// Ascender / Descender de rango: conserva badge/color/cover/hidden del miembro,
// solo actualiza la parte del rango del badge a la etiqueta del grupo destino
// y adopta permisos y kick powers del grupo destino.
let promoteContext = { prefix: null, memberIndex: null };
let demoteContext = { prefix: null, memberIndex: null };

function openPromoteModal(prefix, memberIndex) {
    promoteContext = { prefix, memberIndex };
    const member = parsedData.groups[prefix].members[memberIndex];
    const roleStr = getRoleName(prefix, parsedData.groups[prefix], memberIndex);
    const promoteModal = document.getElementById('promote-modal');
    document.getElementById('promote-member-name').textContent = member.name || roleStr;
    const targetSelect = document.getElementById('promote-target-group');
    targetSelect.innerHTML = `<option value="" disabled selected>${t('move.selectGroup')}...</option>`;
    const groupKeys = Object.keys(parsedData.groups).sort((a, b) => a.localeCompare(b));
    const sourceHierarchy = getRoleHierarchyIndex(prefix);
    groupKeys.forEach(targetPrefix => {
        if (targetPrefix !== prefix && getRoleHierarchyIndex(targetPrefix) < sourceHierarchy) {
            const opt = document.createElement('option');
            opt.value = targetPrefix;
            opt.textContent = t('cards.targetOpt', { prefix: targetPrefix, label: getGroupBadgeLabel(targetPrefix), count: parsedData.groups[targetPrefix].members.length });
            targetSelect.appendChild(opt);
        }
    });
    showModal(promoteModal, targetSelect);
}

function openDemoteModal(prefix, memberIndex) {
    demoteContext = { prefix, memberIndex };
    const member = parsedData.groups[prefix].members[memberIndex];
    const roleStr = getRoleName(prefix, parsedData.groups[prefix], memberIndex);
    const demoteModal = document.getElementById('demote-modal');
    document.getElementById('demote-member-name').textContent = member.name || roleStr;
    const targetSelect = document.getElementById('demote-target-group');
    targetSelect.innerHTML = `<option value="" disabled selected>${t('move.selectGroup')}...</option>`;
    const groupKeys = Object.keys(parsedData.groups).sort((a, b) => a.localeCompare(b));
    const sourceHierarchy = getRoleHierarchyIndex(prefix);
    groupKeys.forEach(targetPrefix => {
        if (targetPrefix !== prefix && getRoleHierarchyIndex(targetPrefix) > sourceHierarchy) {
            const opt = document.createElement('option');
            opt.value = targetPrefix;
            opt.textContent = t('cards.targetOpt', { prefix: targetPrefix, label: getGroupBadgeLabel(targetPrefix), count: parsedData.groups[targetPrefix].members.length });
            targetSelect.appendChild(opt);
        }
    });
    showModal(demoteModal, targetSelect);
}

function moveMemberToGroup(sourcePrefix, memberIndex, targetPrefix) {
    const sourceGroup = parsedData.groups[sourcePrefix];
    const targetGroup = parsedData.groups[targetPrefix];
    if (!sourceGroup || !targetGroup) return false;
    const member = sourceGroup.members[memberIndex];
    if (!member) return false;
    // No se tocan member.name ni member.notes: el ascenso/descenso solo cambia
    // rol, badge (parte del rango), permisos y poderes. Así el round-trip
    // exportar -> re-parsear conserva nombre y nota intactos.
    member.badge = updateBadgeRank(member.badge, targetPrefix);
    sourceGroup.members.splice(memberIndex, 1);
    if (targetGroup.members.length > 0) {
        const targetTemplate = targetGroup.members[0];
        member.permissions = new Set(targetTemplate.permissions);
        member.kickPower = targetTemplate.kickPower;
        member.reqKickPower = targetTemplate.reqKickPower;
    } else {
        member.permissions = new Set(targetGroup.permissions);
        member.kickPower = 1;
        member.reqKickPower = 1;
    }
    member.prefix = targetPrefix;
    member.roleName = '';
    member.oldRole = null;
    targetGroup.members.push(member);
    recomputeGroupPermissions(sourceGroup);
    recomputeGroupPermissions(targetGroup);
    updateOldRoles();
    renderRAEditor();
    return true;
}

document.getElementById('promote-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const { prefix, memberIndex } = promoteContext;
    if (prefix === null || memberIndex === null) return;
    const targetPrefix = document.getElementById('promote-target-group').value;
    if (!targetPrefix || !parsedData.groups[targetPrefix]) {
        alert(t('move.selectTarget'));
        return;
    }
    moveMemberToGroup(prefix, memberIndex, targetPrefix);
    hideModal(document.getElementById('promote-modal'));
});

document.getElementById('demote-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const { prefix, memberIndex } = demoteContext;
    if (prefix === null || memberIndex === null) return;
    const targetPrefix = document.getElementById('demote-target-group').value;
    if (!targetPrefix || !parsedData.groups[targetPrefix]) {
        alert(t('move.selectTarget'));
        return;
    }
    moveMemberToGroup(prefix, memberIndex, targetPrefix);
    hideModal(document.getElementById('demote-modal'));
});

document.getElementById('btn-close-promote-modal')?.addEventListener('click', () => {
    hideModal(document.getElementById('promote-modal'));
});
document.getElementById('btn-cancel-promote')?.addEventListener('click', () => {
    hideModal(document.getElementById('promote-modal'));
});
document.getElementById('btn-close-demote-modal')?.addEventListener('click', () => {
    hideModal(document.getElementById('demote-modal'));
});
document.getElementById('btn-cancel-demote')?.addEventListener('click', () => {
    hideModal(document.getElementById('demote-modal'));
});

function updateSidebarCounts() {
    const activeLi = document.querySelector('.groups-sidebar li.active');
    if (activeLi && currentSelectedGroup) {
        activeLi.querySelector('.group-count').textContent = parsedData.groups[currentSelectedGroup].members.length;
    }
}

function createBulkIssue(code, severity, line, message) {
    return { code, severity, line: Number(line) || 1, message };
}

function createBadgeBulkRecord(startLine, missingStart = false) {
    return {
        startLine,
        endLine: startLine,
        owner: '',
        badge: '',
        color: '',
        steamId: '',
        fieldLines: {},
        parserIssues: missingStart
            ? [createBulkIssue('MISSING_RECORD_START', 'error', startLine, 'El registro debe comenzar con "badge de:".')]
            : []
    };
}

function parseBadgeBulkText(text) {
    const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
    const records = [];
    let currentRecord = null;

    const ensureRecord = lineNumber => {
        if (!currentRecord) currentRecord = createBadgeBulkRecord(lineNumber, true);
        return currentRecord;
    };
    const finishRecord = () => {
        if (!currentRecord) return;
        currentRecord.recordNumber = records.length + 1;
        records.push(currentRecord);
        currentRecord = null;
    };

    lines.forEach((rawLine, index) => {
        const lineNumber = index + 1;
        const line = rawLine.trim();
        if (!line) return;

        const separatorIndex = line.indexOf(':');
        if (separatorIndex < 0) {
            const record = ensureRecord(lineNumber);
            record.endLine = lineNumber;
            record.parserIssues.push(createBulkIssue(
                'MALFORMED_LINE', 'warning', lineNumber,
                t('badgeIssue.malformedLine')
            ));
            return;
        }

        const rawKey = line.slice(0, separatorIndex).trim();
        const normalizedKey = rawKey.toLowerCase().replace(/\s+/g, ' ');
        const value = line.slice(separatorIndex + 1).trim();
        const fieldByKey = {
            '_badge': 'badge',
            '_color': 'color',
            '_steamid': 'steamId'
        };

        if (normalizedKey === 'badge de') {
            finishRecord();
            currentRecord = createBadgeBulkRecord(lineNumber, false);
            currentRecord.owner = value;
            currentRecord.fieldLines.owner = lineNumber;
            return;
        }

        const record = ensureRecord(lineNumber);
        record.endLine = lineNumber;
        const field = fieldByKey[normalizedKey];
        if (!field) {
            record.parserIssues.push(createBulkIssue(
                'UNKNOWN_KEY', 'warning', lineNumber,
                t('badgeIssue.unknownKey', { key: rawKey })
            ));
            return;
        }

        if (Object.prototype.hasOwnProperty.call(record.fieldLines, field)) {
            record.parserIssues.push(createBulkIssue(
                'DUPLICATE_FIELD', 'warning', lineNumber,
                t('badgeIssue.duplicateField', { key: rawKey })
            ));
        }
        record[field] = value;
        record.fieldLines[field] = lineNumber;
    });

    finishRecord();
    return records;
}

function getSteamMemberIndex(state = parsedData) {
    const index = new Map();
    Object.keys(state?.groups || {}).forEach(prefix => {
        const group = state.groups[prefix];
        (group.members || []).forEach((member, memberIndex) => {
            const steamId = normalizeSteamId64(member.id);
            if (!isValidSteamId64(steamId)) return;
            const entry = {
                prefix,
                memberIndex,
                member,
                group,
                roleName: getRoleName(prefix, group, memberIndex)
            };
            if (!index.has(steamId)) index.set(steamId, []);
            index.get(steamId).push(entry);
        });
    });
    return index;
}

function badgeBulkRecordSignature(record) {
    return [record.owner, record.badge, String(record.color).toLowerCase()]
        .map(value => String(value ?? '').trim())
        .join('\u0000');
}

function badgeRoleSignature(badge, color) {
    return `${String(badge ?? '').trim()}\u0000${String(color ?? '').trim().toLowerCase()}`;
}

function validateBadgeBulkRecords(records, options = {}) {
    const state = options.state || parsedData;
    const targetGroup = options.targetGroup || '';
    const acceptedColors = options.acceptedColors instanceof Set
        ? options.acceptedColors
        : getAcceptedBadgeColors();
    const normalizedColors = new Set([...acceptedColors].map(color => String(color).toLowerCase()));
    const currentMembers = getSteamMemberIndex(state);
    const firstInputBySteamId = new Map();
    const targetDestination = state?.groups?.[targetGroup];
    const sharedTargetInitiallyEmpty = Boolean(
        targetDestination && !targetDestination.isNumbered && targetDestination.members.length === 0
    );
    let sharedTargetSignature = targetDestination && !targetDestination.isNumbered && targetDestination.members.length > 0
        ? badgeRoleSignature(targetDestination.members[0].badge, targetDestination.members[0].color)
        : null;

    return (records || []).map((sourceRecord, recordIndex) => {
        const record = {
            ...sourceRecord,
            fieldLines: { ...(sourceRecord.fieldLines || {}) },
            parserIssues: [...(sourceRecord.parserIssues || [])],
            issues: [...(sourceRecord.parserIssues || [])],
            errors: [],
            warnings: [],
            existingMatch: null,
            duplicateOf: null,
            sharedRoleAlternative: false,
            ownerName: badgeOwnerName(sourceRecord.owner),
            normalizedSteamId: normalizeSteamId64(sourceRecord.steamId),
            normalizedColor: String(sourceRecord.color || '').trim().toLowerCase(),
            status: 'valid',
            action: 'import'
        };
        record.recordNumber ||= recordIndex + 1;

        const addIssue = (code, severity, line, message) => {
            record.issues.push(createBulkIssue(code, severity, line, message));
        };
        const requiredLine = field => record.fieldLines[field] || record.startLine;

        if (!String(record.owner || '').trim()) {
            addIssue('MISSING_OWNER', 'error', requiredLine('owner'), t('badgeIssue.missingOwner'));
        } else if (!record.ownerName) {
            addIssue('EMPTY_OWNER_NAME', 'error', requiredLine('owner'), t('badgeIssue.emptyOwnerName'));
        } else if (!String(record.owner).trim().startsWith('@')) {
            addIssue(
                'OWNER_WITHOUT_AT', 'warning', requiredLine('owner'),
                t('badgeIssue.ownerWithoutAt')
            );
        }
        if (!String(record.badge || '').trim()) {
            addIssue('EMPTY_BADGE', 'error', requiredLine('badge'), t('badgeIssue.emptyBadge'));
        }
        if (!String(record.color || '').trim()) {
            addIssue('MISSING_COLOR', 'error', requiredLine('color'), t('badgeIssue.missingColor'));
        } else if (!normalizedColors.has(record.normalizedColor)) {
            const colorSuggestion = findRemoteAdminColorSuggestion(record.color, normalizedColors);
            addIssue(
                'INVALID_COLOR', 'error', requiredLine('color'),
                t('badgeIssue.invalidColor', { color: record.color })
                + (colorSuggestion ? t('badgeIssue.colorSuggestion', { suggestion: colorSuggestion.value }) : '')
            );
        }
        if (!String(record.steamId || '').trim()) {
            addIssue('MISSING_STEAM_ID', 'error', requiredLine('steamId'), t('badgeIssue.missingSteam'));
        } else if (!isValidSteamId64(record.normalizedSteamId) || /@steam/i.test(String(record.steamId))) {
            addIssue(
                'INVALID_STEAM_ID', 'error', requiredLine('steamId'),
                t('badgeIssue.invalidSteam')
            );
        }

        if (isValidSteamId64(record.normalizedSteamId)) {
            const firstInput = firstInputBySteamId.get(record.normalizedSteamId);
            if (firstInput) {
                record.duplicateOf = firstInput.recordNumber;
                const sameData = badgeBulkRecordSignature(firstInput) === badgeBulkRecordSignature(record);
                addIssue(
                    sameData ? 'DUPLICATE_INPUT' : 'CONFLICTING_INPUT_DUPLICATE',
                    'warning', requiredLine('steamId'),
                    sameData
                        ? t('badgeIssue.dupInput', { n: firstInput.recordNumber })
                        : t('badgeIssue.conflictInput', { n: firstInput.recordNumber })
                );
                record.status = sameData ? 'duplicate' : 'conflict';
                record.action = sameData ? 'omit' : 'cancel';
            } else {
                firstInputBySteamId.set(record.normalizedSteamId, record);
            }

            const existingEntries = currentMembers.get(record.normalizedSteamId) || [];
            if (existingEntries.length > 1) {
                addIssue(
                    'DUPLICATE_EXISTING_STEAM_ID', 'error', requiredLine('steamId'),
                    t('badgeIssue.dupExisting')
                );
            } else if (existingEntries.length === 1) {
                const existing = existingEntries[0];
                record.existingMatch = {
                    prefix: existing.prefix,
                    memberIndex: existing.memberIndex,
                    roleName: existing.roleName
                };
                const sameBadge = String(existing.member.badge || '') === String(record.badge || '').trim();
                const sameColor = String(existing.member.color || '').toLowerCase() === record.normalizedColor;
                const sameName = String(existing.member.name || '').trim() === record.ownerName;
                const sameNote = String(existing.member.notes || '').trim() === record.ownerName;
                const sameData = sameBadge && sameColor && sameName && sameNote;
                addIssue(
                    sameData ? 'EXISTING_DUPLICATE' : 'EXISTING_CONFLICT',
                    'warning', requiredLine('steamId'),
                    sameData
                        ? t('badgeIssue.existDup', { role: existing.roleName })
                        : t('badgeIssue.existConflict', { role: existing.roleName })
                );
                if (record.status === 'valid') record.status = sameData ? 'duplicate' : 'conflict';
                if (record.action === 'import') record.action = sameData ? 'omit' : 'cancel';

                if (!existing.group.isNumbered && existing.group.members.length > 1 && (!sameBadge || !sameColor)) {
                    addIssue(
                        'SHARED_ROLE_CONFLICT', 'error', requiredLine('steamId'),
                        t('badgeIssue.sharedConflict', { role: existing.roleName })
                    );
                }
            } else {
                const destination = state?.groups?.[targetGroup];
                if (!targetGroup) {
                    addIssue('TARGET_GROUP_REQUIRED', 'error', record.startLine, t('badgeIssue.targetRequired'));
                } else if (!destination) {
                    addIssue('TARGET_GROUP_NOT_FOUND', 'error', record.startLine, t('badgeIssue.targetNotFound', { group: targetGroup }));
                } else if (!destination.isNumbered) {
                    const incomingSignature = badgeRoleSignature(record.badge, record.normalizedColor);
                    if (sharedTargetSignature !== null && incomingSignature !== sharedTargetSignature) {
                        if (sharedTargetInitiallyEmpty) {
                            addIssue(
                                'SHARED_ROLE_BATCH_CONFLICT', 'warning', record.startLine,
                                t('badgeIssue.sharedBatch', { group: targetGroup })
                            );
                            record.sharedRoleAlternative = true;
                            record.status = 'conflict';
                            record.action = 'cancel';
                        } else {
                            addIssue(
                                'SHARED_ROLE_CONFLICT', 'error', record.startLine,
                                t('badgeIssue.sharedTarget', { group: targetGroup })
                            );
                        }
                    } else if (sharedTargetSignature === null
                        && !record.issues.some(issue => issue.severity === 'error')) {
                        sharedTargetSignature = incomingSignature;
                    }
                }
            }
        }

        record.errors = record.issues.filter(issue => issue.severity === 'error');
        record.warnings = record.issues.filter(issue => issue.severity === 'warning');
        if (record.errors.length > 0) {
            record.status = 'invalid';
            record.action = 'cancel';
        } else if (record.status === 'valid' && record.warnings.length > 0) {
            record.status = 'warning';
        }
        return record;
    });
}

function getBadgeBulkSummary(records) {
    const summary = {
        total: records.length,
        valid: 0,
        invalid: 0,
        duplicates: 0,
        omitted: 0,
        ready: 0
    };
    records.forEach(record => {
        if (record.status === 'invalid') summary.invalid += 1;
        else if (['duplicate', 'conflict'].includes(record.status)) summary.duplicates += 1;
        else summary.valid += 1;
        if (record.status !== 'invalid' && ['omit', 'cancel'].includes(record.action)) summary.omitted += 1;
        if (['import', 'replace', 'update'].includes(record.action) && record.errors.length === 0) summary.ready += 1;
    });
    return summary;
}

function createImportedBadgeMember(record, group, prefix) {
    const previous = group.members[group.members.length - 1];
    const defaults = previous || createRoleData();
    return {
        id: toRemoteAdminSteamId(record.normalizedSteamId),
        name: record.ownerName || badgeOwnerName(record.owner),
        notes: record.ownerName || badgeOwnerName(record.owner),
        badge: String(record.badge || '').trim(),
        color: record.normalizedColor,
        cover: Boolean(defaults.cover),
        hidden: Boolean(defaults.hidden),
        kickPower: Number.isFinite(defaults.kickPower) ? defaults.kickPower : 0,
        reqKickPower: Number.isFinite(defaults.reqKickPower) ? defaults.reqKickPower : 0,
        oldRole: null,
        roleName: '',
        sourceMemberId: null,
        prefix,
        permissions: new Set(group.permissions || [])
    };
}

function getConflictingExistingMutationIds(records) {
    const mutationCounts = new Map();
    (records || []).forEach(record => {
        if ((record.errors || []).length > 0 || !record.existingMatch) return;
        if (!['replace', 'update'].includes(record.action)) return;
        const steamId = record.normalizedSteamId;
        mutationCounts.set(steamId, (mutationCounts.get(steamId) || 0) + 1);
    });
    return new Set([...mutationCounts].filter(([, count]) => count > 1).map(([steamId]) => steamId));
}

function getConflictingSharedRoleImports(records, state, targetGroup) {
    const destination = state?.groups?.[targetGroup];
    if (!destination || destination.isNumbered || destination.members.length > 0) return [];
    const selectedImports = (records || []).filter(record => (record.errors || []).length === 0
        && !record.existingMatch
        && record.action === 'import');
    const signatures = new Set(selectedImports.map(record => badgeRoleSignature(record.badge, record.normalizedColor)));
    return signatures.size > 1 ? selectedImports : [];
}

function applyBadgeBulkImport(records, options = {}) {
    const state = options.state || parsedData;
    const targetGroup = options.targetGroup || '';
    const result = {
        imported: 0,
        replaced: 0,
        updated: 0,
        omitted: 0,
        cancelled: 0,
        invalid: 0,
        issues: []
    };
    const changedGroups = new Set();
    const conflictingMutationIds = getConflictingExistingMutationIds(records);
    const conflictingSharedRoleImports = new Set(getConflictingSharedRoleImports(records, state, targetGroup));

    (records || []).forEach(record => {
        const action = BADGE_BULK_ACTIONS.has(record.action) ? record.action : 'cancel';
        const addApplyIssue = (code, severity, message) => {
            const issue = createBulkIssue(code, severity, record.startLine, message);
            issue.recordNumber = record.recordNumber;
            result.issues.push(issue);
        };
        if (conflictingMutationIds.has(record.normalizedSteamId)
            && ['replace', 'update'].includes(action)) {
            result.invalid += 1;
            addApplyIssue(
                'MULTIPLE_MUTATIONS_SAME_STEAM_ID', 'error',
                t('badgeIssue.multiMutations', { steam: record.normalizedSteamId })
            );
            return;
        }
        if (conflictingSharedRoleImports.has(record) && action === 'import') {
            result.invalid += 1;
            addApplyIssue(
                'MULTIPLE_SHARED_ROLE_SIGNATURES', 'error',
                t('badgeIssue.multiShared', { group: targetGroup })
            );
            return;
        }
        if ((record.errors || []).length > 0) {
            result.invalid += 1;
            return;
        }
        if (action === 'omit') {
            result.omitted += 1;
            return;
        }
        if (action === 'cancel') {
            result.cancelled += 1;
            return;
        }

        const matches = getSteamMemberIndex(state).get(record.normalizedSteamId) || [];
        if (action === 'import') {
            if (matches.length > 0) {
                result.omitted += 1;
                addApplyIssue(
                    'STEAM_ID_CHANGED_DURING_PREVIEW', 'warning',
                    t('badgeIssue.steamChanged', { steam: record.normalizedSteamId })
                );
                return;
            }
            const group = state?.groups?.[targetGroup];
            if (!group) {
                result.invalid += 1;
                addApplyIssue('TARGET_GROUP_UNAVAILABLE', 'error', t('badgeIssue.targetUnavailable'));
                return;
            }
            if (!group.isNumbered && group.members.length > 0
                && badgeRoleSignature(group.members[0].badge, group.members[0].color)
                    !== badgeRoleSignature(record.badge, record.normalizedColor)) {
                result.invalid += 1;
                addApplyIssue(
                    'SHARED_ROLE_CONFLICT', 'error',
                    t('badgeIssue.sharedStale', { group: targetGroup })
                );
                return;
            }
            group.members.push(createImportedBadgeMember(record, group, targetGroup));
            changedGroups.add(targetGroup);
            result.imported += 1;
            return;
        }

        if (matches.length !== 1) {
            result.invalid += 1;
            addApplyIssue(
                'EXISTING_MEMBER_NOT_UNIQUE', 'error',
                t('badgeIssue.notUnique', { steam: record.normalizedSteamId })
            );
            return;
        }

        const match = matches[0];
        const changesRoleProperties = String(match.member.badge || '') !== String(record.badge || '').trim()
            || String(match.member.color || '').toLowerCase() !== record.normalizedColor;
        if (!match.group.isNumbered && match.group.members.length > 1 && changesRoleProperties) {
            result.invalid += 1;
            addApplyIssue(
                'SHARED_ROLE_CONFLICT', 'error',
                t('badgeIssue.sharedConflict', { role: match.roleName })
            );
            return;
        }

        match.member.badge = String(record.badge || '').trim();
        match.member.color = record.normalizedColor;
        match.member.name = record.ownerName || badgeOwnerName(record.owner);
        match.member.notes = match.member.name;
        if (action === 'replace') {
            result.replaced += 1;
        } else {
            result.updated += 1;
        }
        changedGroups.add(match.prefix);
    });

    changedGroups.forEach(prefix => recomputeGroupPermissions(state.groups[prefix]));
    if (state === parsedData && changedGroups.size > 0) {
        updateOldRoles();
        renderRAEditor();
    }
    return result;
}

function invalidateBadgeBulkPreview() {
    badgeBulkPreviewRecords = [];
    badgeBulkPreviewRevision = null;
    const previewBody = document.getElementById('badge-bulk-preview-body');
    if (previewBody) previewBody.replaceChildren();
    const summary = document.getElementById('badge-bulk-summary');
    if (summary) summary.textContent = t('badgeBulk.notAnalyzed');
    const confirmButton = document.getElementById('btn-confirm-badges');
    if (confirmButton) confirmButton.disabled = true;
}

// Generate Config
btnGenerate.addEventListener('click', () => {
    renderRemoteAdminExportPreview(true, true);
});

function closeExportPreviewModal() {
    cancelRemoteAdminOrganizationPreview();
    cancelRemoteAdminIdRenumberPreview();
    hideModal(exportModal);
}

btnCloseModal.addEventListener('click', closeExportPreviewModal);
if (btnCancelExport) btnCancelExport.addEventListener('click', closeExportPreviewModal);

btnCopy.addEventListener('click', async () => {
    const activeTab = document.querySelector('.tab-content.active');
    if (activeTab) {
        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(activeTab.value);
            } else {
                activeTab.select();
                if (!document.execCommand('copy')) throw new Error('No se pudo copiar');
            }
            const oldText = btnCopy.innerHTML;
            btnCopy.innerHTML = `<i class="ph ph-check" aria-hidden="true"></i> ${t('action.copied')}`;
            setTimeout(() => { btnCopy.innerHTML = oldText; }, 2000);
        } catch (error) {
            alert(t('action.copyFail'));
        }
    }
});

const btnDownload = document.getElementById('btn-download');
if (btnDownload) {
    btnDownload.addEventListener('click', () => {
        const activeTab = document.querySelector('.tab-content.active');
        if (!activeTab) return;

        try {
            let filename = 'config_remoteadmin_new.txt';
            if (activeTab.id === 'config-output') {
                let latestRemoteAdminResult;
                if (activeRemoteAdminExportResult?.organizationApplied
                    && activeTab.value === activeRemoteAdminExportResult.content) {
                    const validation = validateGeneratedRemoteAdminContent(
                        activeRemoteAdminExportResult.content,
                        parsedData,
                        remoteAdminDocument
                    );
                    latestRemoteAdminResult = {
                        ...activeRemoteAdminExportResult,
                        filename: getRemoteAdminFilename(remoteAdminDocument, remoteAdminExportFilename?.value),
                        errors: validation.errors,
                        warnings: validation.warnings,
                        valid: validation.errors.length === 0
                    };
                } else {
                    latestRemoteAdminResult = buildRemoteAdminExport({
                        filename: remoteAdminExportFilename?.value
                    });
                }
                activeRemoteAdminExportResult = latestRemoteAdminResult;
                if (!latestRemoteAdminResult.valid) {
                    alert(t('action.downloadBlocked'));
                    return;
                }
                activeTab.value = latestRemoteAdminResult.content;
                filename = latestRemoteAdminResult.filename;
            }
            if (activeTab.id === 'exiled-output') filename = 'permissions-exiled.yml';
            if (activeTab.id === 'labapi-output') filename = 'permissions-labapi.yml';
            if (activePermissionsExportResult && activeTab.id === `${activePermissionsExportFramework}-output`) {
                if (!activePermissionsExportResult.valid) {
                    alert(t('action.permsBlocked'));
                    return;
                }
                filename = activePermissionsExportResult.filename;
            }

            const yamlFile = filename.endsWith('.yml') || filename.endsWith('.yaml');
            const blob = new Blob([activeTab.value], {
                type: yamlFile ? 'text/yaml;charset=utf-8' : 'text/plain;charset=utf-8'
            });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (error) {
            alert(t('action.downloadFail', { error: error?.message || t('action.downloadFailBrowser') }));
        }
    });
}




function configScalar(value) {
    return String(value ?? '').replace(/[\r\n]+/g, ' ').trim();
}

function compareRoleNames(first, second) {
    return String(first).localeCompare(String(second), 'en', { numeric: true, sensitivity: 'base' });
}

function splitRemoteAdminRoleIdentifier(roleName) {
    const value = String(roleName || '').trim();
    const numbered = value.match(/^([A-Za-z_]+?)(\d+)$/);
    return numbered
        ? { value, prefix: numbered[1], number: Number(numbered[2]), numbered: true }
        : { value, prefix: value, number: null, numbered: false };
}

function createRemoteAdminRoleOrderContext(document) {
    const unknownPrefixOrder = new Map();
    const hierarchy = new Map(REMOTE_ADMIN_ROLE_HIERARCHY.map((prefix, index) => [prefix, index]));
    const remember = roleName => {
        const prefix = splitRemoteAdminRoleIdentifier(roleName).prefix.toUpperCase();
        if (!prefix || hierarchy.has(prefix) || unknownPrefixOrder.has(prefix)) return;
        unknownPrefixOrder.set(prefix, unknownPrefixOrder.size);
    };
    (document?.memberEntries || []).forEach(entry => remember(entry.roleName));
    (document?.roleEntries || []).forEach(entry => remember(entry.roleName));
    (document?.permissionEntries || []).forEach(entry => entry.roles.forEach(remember));
    document?.rolePropertyNodes?.forEach((_, roleName) => remember(roleName));
    return { hierarchy, unknownPrefixOrder };
}

function compareRemoteAdminRoleIds(first, second, context) {
    const left = splitRemoteAdminRoleIdentifier(first);
    const right = splitRemoteAdminRoleIdentifier(second);
    const leftPrefix = left.prefix.toUpperCase();
    const rightPrefix = right.prefix.toUpperCase();
    const knownOffset = REMOTE_ADMIN_ROLE_HIERARCHY.length;
    const leftRank = context.hierarchy.has(leftPrefix)
        ? context.hierarchy.get(leftPrefix)
        : knownOffset + (context.unknownPrefixOrder.get(leftPrefix) ?? Number.MAX_SAFE_INTEGER);
    const rightRank = context.hierarchy.has(rightPrefix)
        ? context.hierarchy.get(rightPrefix)
        : knownOffset + (context.unknownPrefixOrder.get(rightPrefix) ?? Number.MAX_SAFE_INTEGER);
    if (leftRank !== rightRank) return leftRank - rightRank;
    if (leftPrefix !== rightPrefix) return compareRoleNames(leftPrefix, rightPrefix);
    if (left.numbered !== right.numbered) return left.numbered ? 1 : -1;
    if (left.numbered && right.numbered && left.number !== right.number) return left.number - right.number;
    return compareRoleNames(left.value, right.value);
}

function countMovedValues(beforeValues, afterValues) {
    const length = Math.max(beforeValues.length, afterValues.length);
    let moved = 0;
    for (let index = 0; index < length; index++) {
        if (beforeValues[index] !== afterValues[index]) moved += 1;
    }
    return moved;
}

function organizationIssue(code, severity, message) {
    return { code, severity, message };
}

function serializeRemoteAdminDocumentLines(document, lines) {
    const outputLines = [...lines];
    if (document.finalNewline) {
        while (outputLines.length > 0 && outputLines.at(-1) === '') outputLines.pop();
        outputLines.push('');
    } else {
        while (outputLines.length > 1 && outputLines.at(-1) === '') outputLines.pop();
    }
    return `${document.hasBom ? '\uFEFF' : ''}${outputLines.join(document.lineEnding)}`;
}

function organizeRemoteAdminMembers(content, context) {
    const document = parseRemoteAdminDocument(content);
    if (document.memberEntries.length < 2) return { content, moved: 0, errors: [] };
    const lines = document.lines;
    const blocks = document.memberEntries.map(entry => {
        let start = entry.lineIndex;
        while (start > document.sections.members.headerIndex + 1 && /^\s*#/.test(lines[start - 1])) start -= 1;
        return {
            roleName: entry.roleName,
            start,
            end: entry.lineIndex + 1,
            lines: lines.slice(start, entry.lineIndex + 1)
        };
    });
    const regionStart = Math.min(...blocks.map(block => block.start));
    const regionEnd = Math.max(...blocks.map(block => block.end));
    const covered = new Set(blocks.flatMap(block => {
        const indexes = [];
        for (let index = block.start; index < block.end; index++) indexes.push(index);
        return indexes;
    }));
    const unsafeLine = lines.slice(regionStart, regionEnd).find((line, offset) =>
        line.trim() !== '' && !covered.has(regionStart + offset)
    );
    if (unsafeLine !== undefined) {
        return {
            content,
            moved: 0,
            errors: [organizationIssue(
                'MEMBERS_ORGANIZATION_UNSAFE',
                'error',
                t('orgIssue.stageMembers', { line: unsafeLine.trim() })
            )]
        };
    }
    const sortedBlocks = [...blocks].sort((left, right) =>
        compareRemoteAdminRoleIds(left.roleName, right.roleName, context)
    );
    const replacement = sortedBlocks.flatMap(block => block.lines.map(line => line.replace(/[ \t]+$/g, '')));
    const patches = [{ start: regionStart, end: regionEnd, lines: replacement, reason: 'members-organized' }];
    return {
        content: applyRemoteAdminLinePatches(document, patches),
        moved: countMovedValues(blocks.map(block => block.roleName), sortedBlocks.map(block => block.roleName)),
        errors: []
    };
}

function organizeRemoteAdminRoles(content, context) {
    const document = parseRemoteAdminDocument(content);
    if (document.roleEntries.length < 2) return { content, moved: 0, errors: [] };
    const blocks = document.roleEntries.map(entry => {
        let start = entry.lineIndex;
        while (start > document.sections.roles.headerIndex + 1 && /^\s*#/.test(document.lines[start - 1])) start -= 1;
        return {
            roleName: entry.roleName,
            start,
            end: entry.lineIndex + 1,
            lines: document.lines.slice(start, entry.lineIndex + 1)
        };
    });
    const start = Math.min(...blocks.map(block => block.start));
    const end = Math.max(...blocks.map(block => block.end));
    const covered = new Set(blocks.flatMap(block => {
        const indexes = [];
        for (let index = block.start; index < block.end; index++) indexes.push(index);
        return indexes;
    }));
    const unsafeLine = document.lines.slice(start, end).find((line, offset) =>
        line.trim() !== '' && !covered.has(start + offset)
    );
    if (unsafeLine !== undefined) {
        return {
            content,
            moved: 0,
            errors: [organizationIssue(
                'ROLES_ORGANIZATION_UNSAFE',
                'error',
                t('orgIssue.stageRoles', { line: unsafeLine.trim() })
            )]
        };
    }
    const sortedBlocks = [...blocks].sort((left, right) =>
        compareRemoteAdminRoleIds(left.roleName, right.roleName, context)
    );
    const replacement = sortedBlocks.flatMap(block => block.lines.map(line => line.replace(/[ \t]+$/g, '')));
    return {
        content: applyRemoteAdminLinePatches(document, [{ start, end, lines: replacement, reason: 'roles-organized' }]),
        moved: countMovedValues(blocks.map(block => block.roleName), sortedBlocks.map(block => block.roleName)),
        errors: []
    };
}

function createRoleScopedPropertyMatcher(roleNames) {
    const escapedRoles = [...roleNames]
        .filter(Boolean)
        .sort((a, b) => b.length - a.length)
        .map(roleName => roleName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (escapedRoles.length === 0) return null;
    return new RegExp(`^(${escapedRoles.join('|')})_([A-Za-z0-9_.-]+):(\\s*)(.*)$`);
}

function organizeRemoteAdminPropertyBlocks(content, context) {
    const document = parseRemoteAdminDocument(content);
    const roleNames = new Set([
        ...document.memberEntries.map(entry => entry.roleName),
        ...document.roleEntries.map(entry => entry.roleName),
        ...document.rolePropertyNodes.keys()
    ]);
    const matcher = createRoleScopedPropertyMatcher(roleNames);
    if (!matcher) return { content, moved: 0, errors: [], unknownProperties: [] };
    const nodes = [];
    document.lines.forEach((line, lineIndex) => {
        const match = line.match(matcher);
        if (!match) return;
        nodes.push({ lineIndex, roleName: match[1], property: match[2], line });
    });
    const nodesByRole = new Map();
    nodes.forEach(node => {
        if (!nodesByRole.has(node.roleName)) nodesByRole.set(node.roleName, []);
        nodesByRole.get(node.roleName).push(node);
    });
    const errors = [];
    const blocks = [];
    nodesByRole.forEach((roleNodes, roleName) => {
        roleNodes.sort((a, b) => a.lineIndex - b.lineIndex);
        let start = roleNodes[0].lineIndex;
        while (start > 0 && /^\s*#/.test(document.lines[start - 1])) start -= 1;
        const end = roleNodes.at(-1).lineIndex + 1;
        const allowedIndexes = new Set(roleNodes.map(node => node.lineIndex));
        let unsafe = null;
        for (let index = start; index < end; index++) {
            const line = document.lines[index];
            if (line.trim() === '' || /^\s*#/.test(line) || allowedIndexes.has(index)) continue;
            unsafe = line;
            break;
        }
        if (unsafe !== null) {
            errors.push(organizationIssue(
                'ROLE_PROPERTY_BLOCK_INTERLEAVED',
                'error',
                t('orgIssue.stageProps', { role: roleName, line: unsafe.trim() })
            ));
            return;
        }
        blocks.push({
            roleName,
            start,
            end,
            lines: document.lines.slice(start, end).filter(line => line.trim() !== '')
        });
    });
    if (errors.length > 0 || blocks.length < 2) {
        return { content, moved: 0, errors, unknownProperties: [] };
    }
    blocks.sort((a, b) => a.start - b.start);
    const zones = [];
    blocks.forEach(block => {
        const currentZone = zones.at(-1);
        if (!currentZone) {
            zones.push([block]);
            return;
        }
        const previous = currentZone.at(-1);
        const separator = document.lines.slice(previous.end, block.start);
        if (separator.every(line => line.trim() === '')) currentZone.push(block);
        else zones.push([block]);
    });
    const patches = [];
    let moved = 0;
    zones.forEach(zone => {
        if (zone.length < 2) return;
        const sortedZone = [...zone].sort((left, right) =>
            compareRemoteAdminRoleIds(left.roleName, right.roleName, context)
        );
        moved += countMovedValues(zone.map(block => block.roleName), sortedZone.map(block => block.roleName));
        const replacement = [];
        sortedZone.forEach((block, index) => {
            if (index > 0) replacement.push('');
            replacement.push(...block.lines.map(line => line.replace(/[ \t]+$/g, '')));
        });
        patches.push({
            start: zone[0].start,
            end: zone.at(-1).end,
            lines: replacement,
            reason: 'role-property-blocks-organized'
        });
    });
    const knownProperties = new Set(MEMBER_PROPERTY_NAMES);
    const unknownProperties = nodes
        .filter(node => !knownProperties.has(node.property))
        .map(node => `${node.roleName}_${node.property}`);
    return {
        content: patches.length > 0 ? applyRemoteAdminLinePatches(document, patches) : content,
        moved,
        errors,
        unknownProperties: [...new Set(unknownProperties)]
    };
}

function organizeRemoteAdminPermissionLists(content, context) {
    const document = parseRemoteAdminDocument(content);
    const patches = [];
    let reordered = 0;
    document.permissionEntries.forEach(entry => {
        const sortedRoles = [...entry.roles].sort((left, right) =>
            compareRemoteAdminRoleIds(left, right, context)
        );
        if (sortedRoles.every((roleName, index) => roleName === entry.roles[index])) return;
        reordered += 1;
        patches.push({
            start: entry.lineIndex,
            end: entry.lineIndex + 1,
            lines: [`${entry.indent}- ${entry.permission}:${entry.separator || ' '}[${sortedRoles.join(', ')}]${entry.trailingWhitespace}`],
            reason: 'permission-role-list-organized'
        });
    });
    const overrideIndex = document.lines.findIndex(line => /^override_password_role:\s*/.test(line));
    if (overrideIndex >= 0) {
        const match = document.lines[overrideIndex].match(/^(override_password_role:)(\s*)(.*)$/);
        const sourceRoles = (match?.[3] || '').split(',').map(role => role.trim()).filter(Boolean);
        const sortedRoles = [...sourceRoles].sort((left, right) => compareRemoteAdminRoleIds(left, right, context));
        if (sortedRoles.some((roleName, index) => roleName !== sourceRoles[index])) {
            reordered += 1;
            patches.push({
                start: overrideIndex,
                end: overrideIndex + 1,
                lines: [`${match?.[1] || 'override_password_role:'}${match?.[2] || ' '}${sortedRoles.join(', ')}`],
                reason: 'override-role-list-organized'
            });
        }
    }
    return {
        content: patches.length > 0 ? applyRemoteAdminLinePatches(document, patches) : content,
        reordered
    };
}

function cleanRemoteAdminOrganizationWhitespace(content) {
    const document = parseRemoteAdminDocument(content);
    const output = [];
    let blankPending = false;
    let trailingSpacesRemoved = 0;
    let blankLinesRemoved = 0;
    const sourceLines = document.finalNewline ? document.lines.slice(0, -1) : document.lines;
    sourceLines.forEach(line => {
        const cleanLine = line.replace(/[ \t]+$/g, '');
        if (cleanLine !== line) trailingSpacesRemoved += 1;
        if (cleanLine === '') {
            if (blankPending) {
                blankLinesRemoved += 1;
                return;
            }
            blankPending = true;
            output.push('');
            return;
        }
        blankPending = false;
        output.push(cleanLine);
    });
    return {
        content: serializeRemoteAdminDocumentLines(document, output),
        trailingSpacesRemoved,
        blankLinesRemoved
    };
}

function canonicalRemoteAdminSemanticLines(content) {
    const document = parseRemoteAdminDocument(content);
    return document.lines
        .map(line => line.replace(/[ \t]+$/g, ''))
        .filter(line => line.trim() !== '')
        .map(line => {
            const permission = line.match(/^(\s*-\s*[A-Za-z0-9_.-]+:\s*)\[(.*)\]$/);
            if (permission) {
                const roles = permission[2].split(',').map(role => role.trim()).filter(Boolean).sort(compareRoleNames);
                return `${permission[1]}[${roles.join(', ')}]`;
            }
            const override = line.match(/^(override_password_role:\s*)(.*)$/);
            if (override) {
                const roles = override[2].split(',').map(role => role.trim()).filter(Boolean).sort(compareRoleNames);
                return `${override[1]}${roles.join(', ')}`;
            }
            return line;
        })
        .sort((left, right) => left.localeCompare(right));
}

function analyzeRemoteAdminOrganizationContent(content) {
    const document = parseRemoteAdminDocument(content);
    const errors = [];
    const warnings = [];
    const addIssue = (target, code, message) => {
        if (!target.some(issue => issue.code === code && issue.message === message)) {
            target.push(createExportIssue(code, message));
        }
    };
    if (!document.sections.members) addIssue(errors, 'MEMBERS_SECTION_MISSING', t('val.secMissing', { section: 'Members' }));
    if (!document.sections.roles) addIssue(errors, 'ROLES_SECTION_MISSING', t('val.secMissing', { section: 'Roles o Groups' }));
    if (!document.sections.permissions) addIssue(errors, 'PERMISSIONS_SECTION_MISSING', t('val.secMissing', { section: 'Permissions' }));

    const declaredRoles = new Set(document.roleEntries.map(entry => entry.roleName));
    const usersById = new Map();
    const usersByRole = new Map();
    document.memberEntries.forEach(entry => {
        const normalizedId = String(entry.id || '').trim().toLowerCase();
        if (!usersById.has(normalizedId)) usersById.set(normalizedId, []);
        usersById.get(normalizedId).push(entry);
        if (!usersByRole.has(entry.roleName)) usersByRole.set(entry.roleName, []);
        usersByRole.get(entry.roleName).push(entry);
        const validatedId = validateRemoteAdminUserId(entry.id);
        if (!validatedId.valid) {
            addIssue(
                errors,
                validatedId.provider === 'steam' ? 'INVALID_STEAM_ID' : 'INVALID_REMOTE_ADMIN_ID',
                t('val.badId', { id: entry.id, role: entry.roleName })
            );
        }
        if (!declaredRoles.has(entry.roleName)) {
            addIssue(errors, 'MEMBER_ROLE_UNKNOWN', t('val.memberRoleUnknown', { id: entry.id, role: entry.roleName }));
        }
    });
    usersById.forEach((entries, userId) => {
        if (entries.length < 2) return;
        const signatures = new Set(entries.map(entry => `${entry.id}|${entry.roleName}|${entry.rawComment}`));
        if (signatures.size === 1) {
            addIssue(warnings, 'EXACT_MEMBER_DUPLICATE', t('val.exactDup', { id: userId, count: entries.length }));
        } else {
            const validatedId = validateRemoteAdminUserId(entries[0].id);
            addIssue(
                errors,
                validatedId.provider === 'steam' ? 'DUPLICATE_STEAM_ID' : 'DUPLICATE_REMOTE_ADMIN_ID',
                t('val.dupId', { id: validatedId.normalized || userId, count: entries.length, roles: entries.map(entry => entry.roleName).join(', ') })
            );
        }
    });
    usersByRole.forEach((entries, roleName) => {
        if (entries.length > 1) {
            addIssue(warnings, 'SHARED_INTERNAL_ROLE', t('val.sharedInternal', { role: roleName, count: entries.length }));
        }
    });

    const roleCounts = new Map();
    document.roleEntries.forEach(entry => roleCounts.set(entry.roleName, (roleCounts.get(entry.roleName) || 0) + 1));
    roleCounts.forEach((count, roleName) => {
        if (count > 1) addIssue(warnings, 'DUPLICATE_ROLE_DECLARATION', t('val.dupRoleDecl', { role: roleName, count }));
        if (!usersByRole.has(roleName)) addIssue(warnings, 'ROLE_WITHOUT_MEMBER', t('val.noMember', { role: roleName }));
    });

    document.rolePropertyNodes.forEach((properties, roleName) => {
        if (!declaredRoles.has(roleName)) {
            addIssue(warnings, 'PROPERTY_ROLE_UNDECLARED', t('val.propUndeclared', { role: roleName }));
        }
        properties.forEach((nodes, property) => {
            if (nodes.length > 1) addIssue(warnings, 'DUPLICATE_ROLE_PROPERTY', t('val.dupRolePropShort', { name: `${roleName}_${property}`, count: nodes.length }));
        });
    });
    const requiredProperties = ['badge', 'color', 'cover', 'hidden', 'kick_power', 'required_kick_power'];
    declaredRoles.forEach(roleName => {
        const properties = document.rolePropertyNodes.get(roleName);
        const missing = requiredProperties.filter(property => !properties?.has(property));
        if (missing.length > 0) {
            addIssue(errors, 'ROLE_PROPERTIES_MISSING', t('val.rolePropsMissing', { role: roleName, list: missing.join(', ') }));
        }
    });

    document.permissionEntries.forEach(entry => {
        const seenRoles = new Set();
        entry.roles.forEach(roleName => {
            if (seenRoles.has(roleName)) addIssue(warnings, 'DUPLICATE_PERMISSION_ROLE', t('val.dupPermRole', { perm: entry.permission, role: roleName }));
            seenRoles.add(roleName);
            if (!declaredRoles.has(roleName)) {
                addIssue(errors, 'PERMISSION_ROLE_UNKNOWN', t('val.permUnknown', { perm: entry.permission, role: roleName }));
            }
        });
    });

    const context = createRemoteAdminRoleOrderContext(document);
    const customPrefixes = [...context.unknownPrefixOrder.keys()];
    if (customPrefixes.length > 0) {
        addIssue(warnings, 'CUSTOM_ROLE_PREFIXES', t('val.customPrefixes', { list: customPrefixes.join(', ') }));
    }
    const propertyCount = [...document.rolePropertyNodes.values()]
        .reduce((total, properties) => total + [...properties.values()].reduce((sum, nodes) => sum + nodes.length, 0), 0);
    return {
        document,
        errors,
        warnings,
        stats: {
            users: document.memberEntries.length,
            steamIds: new Set(document.memberEntries.map(entry => entry.id)).size,
            groups: declaredRoles.size,
            permissions: new Set(document.permissionEntries.map(entry => entry.permission)).size,
            properties: propertyCount
        }
    };
}

function organizeRemoteAdminText(content) {
    const sourceDocument = parseRemoteAdminDocument(content);
    const context = createRemoteAdminRoleOrderContext(sourceDocument);
    const stageIssues = [];
    const memberResult = organizeRemoteAdminMembers(content, context);
    stageIssues.push(...memberResult.errors);
    const propertyResult = organizeRemoteAdminPropertyBlocks(memberResult.content, context);
    stageIssues.push(...propertyResult.errors);
    const rolesResult = organizeRemoteAdminRoles(propertyResult.content, context);
    stageIssues.push(...rolesResult.errors);
    const permissionsResult = organizeRemoteAdminPermissionLists(rolesResult.content, context);
    const whitespaceResult = cleanRemoteAdminOrganizationWhitespace(permissionsResult.content);
    return {
        content: whitespaceResult.content,
        issues: stageIssues,
        unknownProperties: propertyResult.unknownProperties,
        changes: {
            membersMoved: memberResult.moved,
            propertyBlocksMoved: propertyResult.moved,
            rolesMoved: rolesResult.moved,
            permissionListsReordered: permissionsResult.reordered,
            blankLinesRemoved: whitespaceResult.blankLinesRemoved,
            trailingSpacesRemoved: whitespaceResult.trailingSpacesRemoved
        }
    };
}

function buildRemoteAdminOrganization(content, state = parsedData, sourceDocument = remoteAdminDocument) {
    const original = String(content ?? '');
    const before = analyzeRemoteAdminOrganizationContent(original);
    const originalValidation = validateGeneratedRemoteAdminContent(original, state, sourceDocument);
    const organizedResult = organizeRemoteAdminText(original);
    const organized = organizedResult.content;
    const after = analyzeRemoteAdminOrganizationContent(organized);
    const validation = validateGeneratedRemoteAdminContent(organized, state, sourceDocument);
    const semanticBefore = canonicalRemoteAdminSemanticLines(original);
    const semanticAfter = canonicalRemoteAdminSemanticLines(organized);
    const semanticEqual = semanticBefore.length === semanticAfter.length
        && semanticBefore.every((line, index) => line === semanticAfter[index]);
    const secondPass = organizeRemoteAdminText(organized).content;
    const idempotent = secondPass === organized;
    const errors = [];
    const warnings = [];
    const mergeIssue = (target, issue) => {
        const normalized = createExportIssue(issue.code, issue.message);
        if (!target.some(current => current.code === normalized.code && current.message === normalized.message)) {
            target.push(normalized);
        }
    };
    before.errors.forEach(issue => mergeIssue(errors, issue));
    after.errors.forEach(issue => mergeIssue(errors, issue));
    validation.errors.forEach(issue => mergeIssue(errors, issue));
    organizedResult.issues.filter(issue => issue.severity === 'error').forEach(issue => mergeIssue(errors, issue));
    before.warnings.forEach(issue => mergeIssue(warnings, issue));
    after.warnings.forEach(issue => mergeIssue(warnings, issue));
    validation.warnings.forEach(issue => mergeIssue(warnings, issue));
    organizedResult.issues.filter(issue => issue.severity !== 'error').forEach(issue => mergeIssue(warnings, issue));
    if (organizedResult.unknownProperties.length > 0) {
        mergeIssue(warnings, createExportIssue(
            'UNKNOWN_ROLE_PROPERTIES_PRESERVED',
            t('orgIssue.unknownProps', { list: organizedResult.unknownProperties.join(', ') })
        ));
    }
    if (!semanticEqual) {
        mergeIssue(errors, createExportIssue(
            'ORGANIZATION_SEMANTIC_CHANGE',
            t('orgIssue.semanticChange')
        ));
    }
    if (!idempotent) {
        mergeIssue(errors, createExportIssue(
            'ORGANIZATION_NOT_IDEMPOTENT',
            t('orgIssue.notIdempotent')
        ));
    }
    const rereadDocument = parseRemoteAdminDocument(organized);
    const rereadValid = Boolean(
        rereadDocument.sections.members
        && rereadDocument.sections.roles
        && rereadDocument.sections.permissions
    );
    if (!rereadValid) {
        mergeIssue(errors, createExportIssue('ORGANIZED_REREAD_FAILED', t('orgIssue.rereadFailed')));
    }
    const changed = original !== organized;
    const sourceErrorKeys = new Set([
        ...before.errors,
        ...originalValidation.errors
    ].map(issue => `${issue.code}\u0000${issue.message}`));
    const blockingErrors = errors.filter(issue =>
        !sourceErrorKeys.has(`${issue.code}\u0000${issue.message}`)
    );
    const blockingErrorKeys = new Set(blockingErrors.map(issue => `${issue.code}\u0000${issue.message}`));
    const inheritedErrors = errors.filter(issue =>
        !blockingErrorKeys.has(`${issue.code}\u0000${issue.message}`)
    );
    return {
        original,
        organized,
        changed,
        valid: errors.length === 0 && semanticEqual && idempotent && rereadValid,
        canApply: changed && blockingErrors.length === 0 && semanticEqual && idempotent && rereadValid,
        errors,
        blockingErrors,
        inheritedErrors,
        warnings,
        before: before.stats,
        after: after.stats,
        changes: organizedResult.changes,
        semanticEqual,
        idempotent,
        rereadValid
    };
}

function remoteAdminRoleTokenPattern(roleName) {
    const escaped = String(roleName || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^A-Za-z0-9_.-])${escaped}(?=$|[^A-Za-z0-9_.-])`);
}

function containsExactRemoteAdminRoleToken(value, roleName) {
    return remoteAdminRoleTokenPattern(roleName).test(String(value || ''));
}

function collectDefinedRemoteAdminRoleIds(document) {
    const roleNames = new Set();
    document.memberEntries.forEach(entry => roleNames.add(entry.roleName));
    document.roleEntries.forEach(entry => roleNames.add(entry.roleName));
    document.rolePropertyNodes.forEach((_, roleName) => roleNames.add(roleName));
    return roleNames;
}

function detectReservedRemoteAdminRoleIds(document, roleNames) {
    const reserved = new Set();
    const reservationPattern = /\b(?:reservad[oa]s?|reserved|no\s+renumerar|do\s+not\s+renumber|mantener\s+(?:la\s+)?id|keep\s+(?:the\s+)?id)\b/i;
    const rememberFromComment = (roleName, indexes) => {
        if ((indexes || []).some(index => reservationPattern.test(document.lines[index] || ''))) {
            reserved.add(roleName);
        }
    };

    document.memberEntries.forEach(entry => rememberFromComment(entry.roleName, entry.commentIndexes));
    document.roleEntries.forEach(entry => {
        const indexes = [];
        for (let index = entry.lineIndex - 1; index >= 0 && /^\s*#/.test(document.lines[index]); index--) {
            indexes.push(index);
        }
        rememberFromComment(entry.roleName, indexes);
    });
    document.rolePropertyNodes.forEach((properties, roleName) => {
        const firstNode = [...properties.values()].flat().sort((a, b) => a.lineIndex - b.lineIndex)[0];
        if (!firstNode) return;
        const indexes = [];
        for (let index = firstNode.lineIndex - 1; index >= 0 && /^\s*#/.test(document.lines[index]); index--) {
            indexes.push(index);
        }
        rememberFromComment(roleName, indexes);
    });
    document.lines.forEach(line => {
        if (!/^\s*#/.test(line) || !reservationPattern.test(line)) return;
        roleNames.forEach(roleName => {
            if (containsExactRemoteAdminRoleToken(line, roleName)) reserved.add(roleName);
        });
    });
    return reserved;
}

function classifyRemoteAdminRoleIds(document, options = {}) {
    const definedRoles = collectDefinedRemoteAdminRoleIds(document);
    const reservedRoles = detectReservedRemoteAdminRoleIds(document, definedRoles);
    const membersByRole = new Map();
    document.memberEntries.forEach(entry => {
        if (!membersByRole.has(entry.roleName)) membersByRole.set(entry.roleName, []);
        membersByRole.get(entry.roleName).push(entry);
    });

    const rolesByPrefix = new Map();
    const allRoles = new Map();
    const nonNumberedRoles = [];
    const numberedRoleNames = [];

    definedRoles.forEach(roleName => {
        const split = splitRemoteAdminRoleIdentifier(roleName);
        if (!split.numbered || !split.prefix) {
            const hasMembers = membersByRole.has(roleName) && membersByRole.get(roleName).length > 0;
            const isReserved = reservedRoles.has(roleName);
            const state = isReserved ? 'RESERVED' : (hasMembers ? 'USED' : 'DECLARED_UNUSED');
            const item = {
                roleName,
                prefix: '',
                number: 0,
                state,
                isNumbered: false,
                isDeclared: true,
                isUsed: hasMembers,
                isReserved,
                isReusable: false,
                members: membersByRole.get(roleName) || []
            };
            nonNumberedRoles.push(item);
            allRoles.set(roleName, item);
            return;
        }
        numberedRoleNames.push({ roleName, prefix: split.prefix, number: split.number });
    });

    const prefixes = new Set(numberedRoleNames.map(r => r.prefix));
    document.memberEntries.forEach(m => {
        const split = splitRemoteAdminRoleIdentifier(m.roleName);
        if (split.numbered && split.prefix) prefixes.add(split.prefix);
    });

    prefixes.forEach(prefix => {
        const declaredInPrefix = numberedRoleNames.filter(r => r.prefix === prefix);
        const memberEntriesInPrefix = document.memberEntries.filter(m => splitRemoteAdminRoleIdentifier(m.roleName).prefix === prefix);

        let maxNumber = 0;
        declaredInPrefix.forEach(r => { maxNumber = Math.max(maxNumber, r.number); });
        memberEntriesInPrefix.forEach(m => {
            const split = splitRemoteAdminRoleIdentifier(m.roleName);
            if (split.number) maxNumber = Math.max(maxNumber, split.number);
        });

        const prefixItems = [];
        const used = [];
        const declaredUnused = [];
        const undeclaredUnused = [];
        const reserved = [];

        for (let k = 1; k <= maxNumber; k++) {
            const roleName = `${prefix}${k}`;
            const isDeclared = definedRoles.has(roleName);
            const members = membersByRole.get(roleName) || [];
            const isUsed = members.length > 0;
            const isReserved = reservedRoles.has(roleName);
            let state;
            if (isReserved) state = 'RESERVED';
            else if (isUsed) state = 'USED';
            else if (isDeclared) state = 'DECLARED_UNUSED';
            else state = 'UNDECLARED_UNUSED';

            const item = {
                roleName,
                prefix,
                number: k,
                state,
                isNumbered: true,
                isDeclared,
                isUsed,
                isReserved,
                isReusable: !isReserved && !isUsed,
                members
            };

            prefixItems.push(item);
            allRoles.set(roleName, item);
            if (state === 'USED') used.push(item);
            else if (state === 'DECLARED_UNUSED') declaredUnused.push(item);
            else if (state === 'UNDECLARED_UNUSED') undeclaredUnused.push(item);
            else if (state === 'RESERVED') reserved.push(item);
        }

        rolesByPrefix.set(prefix, {
            prefix,
            maxNumber,
            allNumberedRoles: prefixItems,
            used,
            declaredUnused,
            undeclaredUnused,
            reserved
        });
    });

    return {
        definedRoles,
        reservedRoles,
        roles: allRoles,
        byPrefix: rolesByPrefix,
        nonNumberedRoles
    };
}

function buildRemoteAdminIdRenumberPlan(content, options = {}) {
    const document = parseRemoteAdminDocument(content);
    const classification = classifyRemoteAdminRoleIds(document, options);
    const reservedRoles = options.respectReserved !== false
        ? classification.reservedRoles
        : new Set();
    const skippedRoles = classification.nonNumberedRoles.map(r => r.roleName);
    const errors = [];
    const warnings = [];

    const duplicateDeclarations = new Map();
    document.roleEntries.forEach(entry => {
        duplicateDeclarations.set(entry.roleName, (duplicateDeclarations.get(entry.roleName) || 0) + 1);
    });
    duplicateDeclarations.forEach((count, roleName) => {
        if (count > 1) {
            errors.push(createExportIssue(
                'DUPLICATE_ROLE_DECLARATION',
                t('renIssue.planDupDecl', { role: roleName, count })
            ));
        }
    });

    if (skippedRoles.length > 0) {
        warnings.push(createExportIssue(
            'NON_NUMBERED_ROLES_SKIPPED',
            t('renIssue.skipped', { list: skippedRoles.sort(compareRoleNames).join(', ') })
        ));
    }

    const roleMap = new Map();
    const reusedDeclaredRoles = new Set();
    const reusedUndeclaredRoles = new Set();
    const prunedDeclaredRoles = new Set();
    const rangeSummaries = [];
    const slotDetails = new Map();
    const reusedIds = [];
    const reservedExcluded = [];

    classification.byPrefix.forEach((prefixData, prefix) => {
        const declaredRolesInPrefix = prefixData.allNumberedRoles.filter(r => r.isDeclared);
        declaredRolesInPrefix.sort((a, b) => a.number - b.number || compareRoleNames(a.roleName, b.roleName));

        const numericOwners = new Map();
        declaredRolesInPrefix.forEach(role => {
            if (!numericOwners.has(role.number)) numericOwners.set(role.number, []);
            numericOwners.get(role.number).push(role.roleName);
        });
        numericOwners.forEach((owners, number) => {
            if (owners.length > 1) {
                errors.push(createExportIssue(
                    'DUPLICATE_NUMERIC_ROLE_SUFFIX',
                    t('renIssue.dupNumeric', { prefix, number, list: owners.join(', ') })
                ));
            }
        });

        const memberEntriesInPrefix = document.memberEntries.filter(m => splitRemoteAdminRoleIdentifier(m.roleName).prefix === prefix);
        let usedRoleNames;
        if (document.memberEntries.length > 0) {
            const seen = new Set();
            usedRoleNames = [];
            memberEntriesInPrefix.forEach(m => {
                if (!seen.has(m.roleName)) {
                    seen.add(m.roleName);
                    usedRoleNames.push(m.roleName);
                }
            });
            usedRoleNames.sort((a, b) => {
                const na = splitRemoteAdminRoleIdentifier(a).number || 0;
                const nb = splitRemoteAdminRoleIdentifier(b).number || 0;
                return na - nb || compareRoleNames(a, b);
            });
        } else {
            usedRoleNames = declaredRolesInPrefix.filter(r => !reservedRoles.has(r.roleName)).map(r => r.roleName);
        }

        const reservedInPrefix = new Set(
            declaredRolesInPrefix.filter(r => reservedRoles.has(r.roleName)).map(r => r.roleName)
        );
        const declaredUnusedInPrefix = new Set(prefixData.declaredUnused.map(r => r.roleName));
        const allDefinedInPrefix = new Set(declaredRolesInPrefix.map(r => r.roleName));

        const unreservedUsedRoles = [];
        usedRoleNames.forEach(roleName => {
            if (reservedInPrefix.has(roleName)) {
                roleMap.set(roleName, roleName);
                reservedExcluded.push({ roleName, reason: 'ID reservada explícitamente' });
            } else {
                unreservedUsedRoles.push(roleName);
            }
        });

        const M = unreservedUsedRoles.length;
        const targetSlots = [];
        let candidate = 1;

        while (targetSlots.length < M) {
            const candidateRole = `${prefix}${candidate}`;
            const isReserved = reservedInPrefix.has(candidateRole);
            const isDeclaredUnused = declaredUnusedInPrefix.has(candidateRole);
            const isUndeclared = !allDefinedInPrefix.has(candidateRole);

            if (isReserved) {
                if (options.respectReserved !== false) {
                    roleMap.set(candidateRole, candidateRole);
                    candidate += 1;
                    continue;
                }
            }

            if (isDeclaredUnused && options.reuseDeclaredUnused === false) {
                roleMap.set(candidateRole, candidateRole);
                candidate += 1;
                continue;
            }

            if (isUndeclared && options.useUndeclaredUnused === false) {
                candidate += 1;
                continue;
            }

            targetSlots.push(candidate);
            if (isDeclaredUnused) {
                slotDetails.set(candidateRole, {
                    type: 'REUSED_DECLARED_UNUSED',
                    reason: `${candidateRole} estaba declarada pero sin utilizar.`
                });
                reusedDeclaredRoles.add(candidateRole);
            } else if (isUndeclared) {
                slotDetails.set(candidateRole, {
                    type: 'REUSED_UNDECLARED_UNUSED',
                    reason: `${candidateRole} no estaba declarada y estaba disponible.`
                });
                reusedUndeclaredRoles.add(candidateRole);
            } else {
                slotDetails.set(candidateRole, {
                    type: 'COMPACT_SEQUENCE',
                    reason: 'Secuencia compacta.'
                });
            }
            candidate += 1;
        }

        for (let i = 0; i < M; i++) {
            const oldRole = unreservedUsedRoles[i];
            const targetNum = targetSlots[i];
            const newRole = `${prefix}${targetNum}`;
            roleMap.set(oldRole, newRole);
            if (oldRole !== newRole) {
                const detail = slotDetails.get(newRole);
                if (detail?.type === 'REUSED_DECLARED_UNUSED' || detail?.type === 'REUSED_UNDECLARED_UNUSED') {
                    reusedIds.push({
                        roleName: newRole,
                        fromRole: oldRole,
                        type: detail.type,
                        reason: detail.reason
                    });
                }
            }
        }

        if (options.reuseDeclaredUnused !== false) {
            declaredUnusedInPrefix.forEach(roleName => {
                const parsed = splitRemoteAdminRoleIdentifier(roleName);
                if (!targetSlots.includes(parsed.number) && !reservedInPrefix.has(roleName)) {
                    prunedDeclaredRoles.add(roleName);
                }
            });
        }

        reservedInPrefix.forEach(roleName => {
            if (!roleMap.has(roleName)) roleMap.set(roleName, roleName);
        });

        const changed = usedRoleNames.filter(r => roleMap.get(r) !== r).length;
        rangeSummaries.push({
            prefix,
            total: usedRoleNames.length,
            changed,
            unchanged: usedRoleNames.length - changed,
            declaredUnused: declaredUnusedInPrefix.size,
            undeclaredUnused: prefixData.undeclaredUnused.length,
            reserved: reservedInPrefix.size,
            reused: [...reusedDeclaredRoles, ...reusedUndeclaredRoles].filter(r => splitRemoteAdminRoleIdentifier(r).prefix === prefix).length
        });
    });

    const targetOwners = new Map();
    roleMap.forEach((newRole, oldRole) => {
        if (!targetOwners.has(newRole)) targetOwners.set(newRole, []);
        targetOwners.get(newRole).push(oldRole);
    });
    targetOwners.forEach((oldRoles, targetRole) => {
        if (oldRoles.length > 1) {
            errors.push(createExportIssue(
                'ROLE_RENUMBER_COLLISION',
                t('renIssue.collision', { role: targetRole, list: oldRoles.join(', ') })
            ));
        }
    });

    const context = createRemoteAdminRoleOrderContext(document);
    rangeSummaries.sort((left, right) => compareRemoteAdminRoleIds(
        `${left.prefix}1`,
        `${right.prefix}1`,
        context
    ));

    const memberOwners = new Map();
    document.memberEntries.forEach(entry => {
        if (!memberOwners.has(entry.roleName)) memberOwners.set(entry.roleName, []);
        memberOwners.get(entry.roleName).push(entry.rawComment || entry.id);
    });

    const availableDetected = [];
    classification.roles.forEach(item => {
        if (item.state === 'DECLARED_UNUSED' || item.state === 'UNDECLARED_UNUSED' || item.state === 'RESERVED') {
            availableDetected.push({
                roleName: item.roleName,
                prefix: item.prefix,
                number: item.number,
                state: item.state,
                label: item.state === 'DECLARED_UNUSED'
                    ? 'Declarada pero no utilizada'
                    : item.state === 'RESERVED' ? 'Reservada' : 'No declarada (disponible)'
            });
        }
    });
    availableDetected.sort((a, b) => compareRemoteAdminRoleIds(a.roleName, b.roleName, context));

    const rows = [...roleMap.entries()]
        .map(([oldRole, newRole]) => {
            const oldClassified = classification.roles.get(oldRole);
            const newClassified = classification.roles.get(newRole);
            const detailObj = slotDetails.get(newRole);
            let detailText;
            if (reservedRoles.has(oldRole)) {
                detailText = 'Reservada (no utilizada)';
            } else if (oldRole === newRole) {
                detailText = 'Sin cambios';
            } else if (detailObj?.reason) {
                detailText = detailObj.reason;
            } else {
                detailText = `${oldRole} pasa a ${newRole}`;
            }
            return {
                prefix: splitRemoteAdminRoleIdentifier(oldRole).prefix || splitRemoteAdminRoleIdentifier(newRole).prefix,
                oldRole,
                newRole,
                changed: oldRole !== newRole,
                reserved: reservedRoles.has(oldRole),
                state: oldClassified?.state || 'USED',
                targetState: newClassified?.state || 'USED',
                user: (memberOwners.get(oldRole) || ['Rol sin usuario']).join(', '),
                detail: detailText,
                reuseType: detailObj?.type || (oldRole === newRole ? 'UNCHANGED' : 'RENUMBERED')
            };
        })
        .sort((left, right) => compareRemoteAdminRoleIds(left.oldRole, right.oldRole, context));

    const customPrefixes = [...classification.byPrefix.keys()].filter(prefix =>
        !REMOTE_ADMIN_ROLE_HIERARCHY.includes(prefix.toUpperCase())
    );
    if (customPrefixes.length > 0) {
        warnings.push(createExportIssue(
            'CUSTOM_PREFIXES_RENUMBERED',
            t('renIssue.customPrefixes', { list: customPrefixes.join(', ') })
        ));
    }
    if (reservedRoles.size > 0) {
        warnings.push(createExportIssue(
            'RESERVED_ROLE_IDS_PRESERVED',
            t('renIssue.reservedKept', { list: [...reservedRoles].join(', ') })
        ));
    }
    if (reusedDeclaredRoles.size > 0) {
        warnings.push(createExportIssue(
            'ROLE_IDS_REUSED',
            t('renIssue.reusedDeclared', { count: reusedDeclaredRoles.size, list: [...reusedDeclaredRoles].join(', ') })
        ));
    }
    if (reusedUndeclaredRoles.size > 0) {
        warnings.push(createExportIssue(
            'UNDECLARED_ROLE_IDS_USED',
            t('renIssue.reusedUndeclared', { count: reusedUndeclaredRoles.size, list: [...reusedUndeclaredRoles].join(', ') })
        ));
    }

    return {
        document,
        classification,
        roleMap,
        rows,
        rangeSummaries,
        reservedRoles,
        skippedRoles,
        reusedDeclaredRoles,
        reusedUndeclaredRoles,
        prunedDeclaredRoles,
        availableDetected,
        reusedIds,
        reservedExcluded,
        errors,
        warnings
    };
}

function mapCommaSeparatedRemoteAdminRoles(value, roleMap) {
    return String(value || '').split(',').map(part => {
        const match = part.match(/^(\s*)(.*?)(\s*)$/);
        const roleName = match?.[2] || '';
        return `${match?.[1] || ''}${roleMap.get(roleName) || roleName}${match?.[3] || ''}`;
    }).join(',');
}

function rewriteRemoteAdminRoleReferences(content, roleMap, options = {}) {
    const document = parseRemoteAdminDocument(content);
    const lines = [...document.lines];
    const recognizedLines = new Set();
    const linesToRemove = new Set();
    const issues = [];
    const reusedDeclaredRoles = options.reusedDeclaredRoles || new Set();
    const prunedDeclaredRoles = options.prunedDeclaredRoles || new Set();
    const changedOldRoles = [...roleMap.entries()]
        .filter(([oldRole, newRole]) => oldRole !== newRole)
        .map(([oldRole]) => oldRole);

    document.memberEntries.forEach(entry => {
        const match = lines[entry.lineIndex].match(/^(\s*-\s*[^:]+:\s*)([A-Za-z0-9_.-]+)(\s*)$/);
        if (!match) return;
        lines[entry.lineIndex] = `${match[1]}${roleMap.get(match[2]) || match[2]}${match[3]}`;
        recognizedLines.add(entry.lineIndex);
    });

    document.roleEntries.forEach(entry => {
        const oldRole = entry.roleName;
        if (reusedDeclaredRoles.has(oldRole) || prunedDeclaredRoles.has(oldRole)) {
            linesToRemove.add(entry.lineIndex);
            (entry.commentIndexes || []).forEach(idx => linesToRemove.add(idx));
            recognizedLines.add(entry.lineIndex);
            return;
        }
        const match = lines[entry.lineIndex].match(/^(\s*-\s*)([A-Za-z0-9_.-]+)(:?\s*)$/);
        if (!match) return;
        lines[entry.lineIndex] = `${match[1]}${roleMap.get(match[2]) || match[2]}${match[3]}`;
        recognizedLines.add(entry.lineIndex);
    });

    const targetRolesSet = new Set(roleMap.values());
    document.permissionEntries.forEach(entry => {
        const filteredRoles = [];
        const seen = new Set();
        entry.roles.forEach(roleName => {
            if (prunedDeclaredRoles.has(roleName)) return;
            if (reusedDeclaredRoles.has(roleName) && !targetRolesSet.has(roleName)) return;
            const mapped = roleMap.get(roleName) || roleName;
            if (!seen.has(mapped)) {
                seen.add(mapped);
                filteredRoles.push(mapped);
            }
        });
        lines[entry.lineIndex] = `${entry.indent}- ${entry.permission}:${entry.separator || ' '}[${filteredRoles.join(', ')}]${entry.trailingWhitespace}`;
        recognizedLines.add(entry.lineIndex);
    });

    document.lines.forEach((line, lineIndex) => {
        const match = line.match(/^(override_password_role:)(\s*)(.*)$/);
        if (!match) return;
        const sourceRoles = match[3].split(',').map(r => r.trim()).filter(Boolean);
        const filtered = [];
        const seen = new Set();
        sourceRoles.forEach(roleName => {
            if (prunedDeclaredRoles.has(roleName)) return;
            if (reusedDeclaredRoles.has(roleName) && !targetRolesSet.has(roleName)) return;
            const mapped = roleMap.get(roleName) || roleName;
            if (!seen.has(mapped)) {
                seen.add(mapped);
                filtered.push(mapped);
            }
        });
        lines[lineIndex] = `${match[1]}${match[2]}${filtered.join(', ')}`;
        recognizedLines.add(lineIndex);
    });

    const allKnownRoles = new Set([
        ...roleMap.keys(),
        ...reusedDeclaredRoles,
        ...prunedDeclaredRoles,
        ...document.rolePropertyNodes.keys()
    ]);
    const propertyMatcher = createRoleScopedPropertyMatcher(allKnownRoles);
    if (propertyMatcher) {
        document.lines.forEach((line, lineIndex) => {
            const match = line.match(propertyMatcher);
            if (!match) return;
            const oldRole = match[1];
            const property = match[2];
            const value = match[4];
            if (reusedDeclaredRoles.has(oldRole) || prunedDeclaredRoles.has(oldRole)) {
                linesToRemove.add(lineIndex);
                recognizedLines.add(lineIndex);
                return;
            }
            lines[lineIndex] = `${roleMap.get(oldRole) || oldRole}_${property}:${match[3]}${value}`;
            recognizedLines.add(lineIndex);
            if (options.scanUnknown !== false && !MEMBER_PROPERTY_NAMES.has(property)) {
                changedOldRoles.forEach(roleName => {
                    if (containsExactRemoteAdminRoleToken(value, roleName)) {
                        issues.push(createExportIssue(
                            'UNKNOWN_PROPERTY_ROLE_REFERENCE',
                            t('renIssue.unknownPropRef', { line: lineIndex + 1, name: `${oldRole}_${property}`, role: roleName })
                        ));
                    }
                });
            }
        });
    }

    if (options.scanUnknown !== false) {
        document.lines.forEach((line, lineIndex) => {
            if (recognizedLines.has(lineIndex) || linesToRemove.has(lineIndex) || /^\s*#/.test(line) || !line.trim()) return;
            changedOldRoles.forEach(roleName => {
                if (containsExactRemoteAdminRoleToken(line, roleName)) {
                    issues.push(createExportIssue(
                        'UNMANAGED_ROLE_REFERENCE',
                        t('renIssue.unmanagedRef', { line: lineIndex + 1, role: roleName })
                    ));
                }
            });
        });
    }

    if (linesToRemove.size === 0) {
        return {
            content: `${document.hasBom ? '\uFEFF' : ''}${lines.join(document.lineEnding)}`,
            issues
        };
    }

    const outputLines = [];
    let prevBlank = false;
    lines.forEach((line, idx) => {
        if (linesToRemove.has(idx)) return;
        const isBlank = line.trim() === '';
        if (isBlank) {
            if (!prevBlank) outputLines.push('');
            prevBlank = true;
        } else {
            outputLines.push(line);
            prevBlank = false;
        }
    });

    return {
        content: serializeRemoteAdminDocumentLines(document, outputLines),
        issues
    };
}

function cloneRoleDataForRenumber(data) {
    return {
        ...data,
        permissions: new Set(data?.permissions || [])
    };
}

function cloneParsedDataWithRoleMap(state, roleMap, options = {}) {
    const mapRole = roleName => roleMap.get(roleName) || roleName;
    const reusedDeclaredRoles = options.reusedDeclaredRoles || new Set();
    const prunedDeclaredRoles = options.prunedDeclaredRoles || new Set();
    const shouldDrop = roleName => reusedDeclaredRoles.has(roleName) || prunedDeclaredRoles.has(roleName);

    const clone = createEmptyParsedData();
    clone.settings = { ...(state.settings || {}) };
    clone.permissionList = [...(state.permissionList || [])];
    clone.permissionComments = { ...(state.permissionComments || {}) };
    clone.headerComments = state.headerComments || '';
    clone.sourceValidationIssues = [...(state.sourceValidationIssues || [])];
    clone.overridePasswordPrefixes = new Set(state.overridePasswordPrefixes || []);
    clone.overridePasswordRoles = new Set(
        [...(state.overridePasswordRoles || [])]
            .filter(role => !shouldDrop(role))
            .map(mapRole)
    );
    clone.overridePasswordUnknownRoles = new Set(
        [...(state.overridePasswordUnknownRoles || [])]
            .filter(role => !shouldDrop(role))
            .map(mapRole)
    );
    clone.declaredGroupRoles = new Set(
        [...(state.declaredGroupRoles || [])]
            .filter(role => !shouldDrop(role))
            .map(mapRole)
    );
    clone.roleDefinitions = new Set(
        [...(state.roleDefinitions || [])]
            .filter(role => !shouldDrop(role))
            .map(mapRole)
    );
    clone.originalMemberRoles = new Set([...(state.originalMemberRoles || [])].map(mapRole));
    clone.permissionUnknownRoleRefs = new Map(
        [...(state.permissionUnknownRoleRefs || new Map())].map(([permission, roles]) => [
            permission,
            new Set([...roles].filter(role => !shouldDrop(role)).map(mapRole))
        ])
    );
    clone.orphanRoleData = new Map(
        [...(state.orphanRoleData || new Map())]
            .filter(([roleName]) => !shouldDrop(roleName))
            .map(([roleName, data]) => [
                mapRole(roleName),
                cloneRoleDataForRenumber(data)
            ])
    );
    clone.groups = {};
    Object.entries(state.groups || {}).forEach(([prefix, group]) => {
        clone.groups[prefix] = {
            ...group,
            prefix,
            permissions: new Set(group.permissions || []),
            members: (group.members || []).map(member => ({
                ...cloneRoleDataForRenumber(member),
                roleName: mapRole(member.roleName || member.oldRole),
                oldRole: mapRole(member.oldRole || member.roleName),
                prefix
            }))
        };
    });
    return clone;
}

function buildRemoteAdminIdRenumbering(content, state = parsedData, sourceDocument = remoteAdminDocument, options = {}) {
    const original = String(content ?? '');
    const plan = buildRemoteAdminIdRenumberPlan(original, options);
    const originalValidation = validateGeneratedRemoteAdminContent(
        original,
        state,
        sourceDocument || plan.document
    );
    const rewritten = rewriteRemoteAdminRoleReferences(original, plan.roleMap, {
        reusedDeclaredRoles: plan.reusedDeclaredRoles,
        prunedDeclaredRoles: plan.prunedDeclaredRoles
    });
    const renumbered = rewritten.content;
    const renamedState = cloneParsedDataWithRoleMap(state, plan.roleMap, {
        reusedDeclaredRoles: plan.reusedDeclaredRoles,
        prunedDeclaredRoles: plan.prunedDeclaredRoles
    });
    const validation = validateGeneratedRemoteAdminContent(
        renumbered,
        renamedState,
        sourceDocument || plan.document
    );
    const beforeAnalysis = analyzeRemoteAdminOrganizationContent(original);
    const afterAnalysis = analyzeRemoteAdminOrganizationContent(renumbered);
    const rereadDocument = parseRemoteAdminDocument(renumbered);
    const rereadValid = Boolean(
        rereadDocument.sections.members
        && rereadDocument.sections.roles
        && rereadDocument.sections.permissions
    );
    const secondPlan = buildRemoteAdminIdRenumberPlan(renumbered, options);
    const idempotent = secondPlan.rows.every(row => !row.changed);

    // Validate user data preservation
    const originalDoc = plan.document;
    let dataIntegrityPassed = true;
    if (originalDoc.memberEntries.length > 0) {
        const beforeMembers = originalDoc.memberEntries;
        const afterMembers = rereadDocument.memberEntries;
        if (beforeMembers.length !== afterMembers.length) {
            dataIntegrityPassed = false;
        } else {
            const beforeUserProps = new Map();
            beforeMembers.forEach(entry => {
                const props = originalDoc.rolePropertyNodes.get(entry.roleName);
                beforeUserProps.set(entry.id, {
                    roleName: entry.roleName,
                    badge: props?.get('badge')?.[0]?.rawValue?.trim(),
                    color: props?.get('color')?.[0]?.rawValue?.trim()
                });
            });
            afterMembers.forEach(entry => {
                const before = beforeUserProps.get(entry.id);
                if (!before) {
                    dataIntegrityPassed = false;
                    return;
                }
                const expectedRole = plan.roleMap.get(before.roleName);
                if (entry.roleName !== expectedRole) {
                    dataIntegrityPassed = false;
                }
                const afterProps = rereadDocument.rolePropertyNodes.get(entry.roleName);
                if (before.badge !== undefined && afterProps?.get('badge')?.[0]?.rawValue?.trim() !== before.badge) {
                    dataIntegrityPassed = false;
                }
                if (before.color !== undefined && afterProps?.get('color')?.[0]?.rawValue?.trim() !== before.color) {
                    dataIntegrityPassed = false;
                }
            });
        }
    }

    const semanticEqual = dataIntegrityPassed;
    const errors = [];
    const warnings = [];
    const mergeIssue = (target, issue) => {
        const normalized = createExportIssue(issue.code, issue.message);
        if (!target.some(current => current.code === normalized.code && current.message === normalized.message)) {
            target.push(normalized);
        }
    };
    plan.errors.forEach(issue => mergeIssue(errors, issue));
    rewritten.issues.forEach(issue => mergeIssue(errors, issue));
    validation.errors.forEach(issue => mergeIssue(errors, issue));
    plan.warnings.forEach(issue => mergeIssue(warnings, issue));
    beforeAnalysis.warnings
        .filter(issue => !['ROLE_WITHOUT_MEMBER', 'DUPLICATE_ROLE_PROPERTY', 'CUSTOM_ROLE_PREFIXES'].includes(issue.code))
        .forEach(issue => mergeIssue(warnings, issue));
    validation.warnings.forEach(issue => mergeIssue(warnings, issue));
    if (!semanticEqual) {
        mergeIssue(errors, createExportIssue(
            'ROLE_RENUMBER_SEMANTIC_CHANGE',
            t('renIssue.semanticChange')
        ));
    }
    if (!rereadValid) {
        mergeIssue(errors, createExportIssue(
            'ROLE_RENUMBER_REREAD_FAILED',
            t('renIssue.rereadFailed')
        ));
    }
    if (!idempotent) {
        mergeIssue(errors, createExportIssue(
            'ROLE_RENUMBER_NOT_IDEMPOTENT',
            t('renIssue.notIdempotent')
        ));
    }
    if (JSON.stringify(beforeAnalysis.stats) !== JSON.stringify(afterAnalysis.stats)) {
        // If declared unused roles were pruned/reused, role count can legitimately compact; only warn if member count changed
        if (beforeAnalysis.stats.members !== afterAnalysis.stats.members) {
            mergeIssue(errors, createExportIssue(
                'ROLE_RENUMBER_COUNT_MISMATCH',
                t('renIssue.countMismatch')
            ));
        }
    }
    const changedRows = plan.rows.filter(row => row.changed);
    const inheritedErrorCodes = new Set(originalValidation.errors.map(issue => issue.code));
    const transformationErrorCodes = new Set([
        ...plan.errors.map(issue => issue.code),
        ...rewritten.issues.map(issue => issue.code),
        'ROLE_RENUMBER_SEMANTIC_CHANGE',
        'ROLE_RENUMBER_REREAD_FAILED',
        'ROLE_RENUMBER_NOT_IDEMPOTENT',
        'ROLE_RENUMBER_COUNT_MISMATCH'
    ]);
    const blockingErrors = errors.filter(issue =>
        transformationErrorCodes.has(issue.code) || !inheritedErrorCodes.has(issue.code)
    );
    const blockingErrorKeys = new Set(blockingErrors.map(issue => `${issue.code}\u0000${issue.message}`));
    const inheritedErrors = errors.filter(issue =>
        !blockingErrorKeys.has(`${issue.code}\u0000${issue.message}`)
    );
    return {
        original,
        renumbered,
        roleMap: plan.roleMap,
        rows: plan.rows,
        ranges: plan.rangeSummaries,
        availableDetected: plan.availableDetected,
        reusedIds: plan.reusedIds,
        reservedExcluded: plan.reservedExcluded,
        changed: changedRows.length > 0,
        valid: errors.length === 0 && semanticEqual && rereadValid && idempotent,
        canApply: blockingErrors.length === 0 && semanticEqual && rereadValid && idempotent && changedRows.length > 0,
        errors,
        blockingErrors,
        inheritedErrors,
        warnings,
        before: beforeAnalysis.stats,
        after: afterAnalysis.stats,
        stats: {
            ids: plan.rows.length,
            changed: changedRows.length,
            unchanged: plan.rows.length - changedRows.length,
            ranges: plan.rangeSummaries.length,
            reserved: plan.reservedRoles.size,
            skipped: plan.skippedRoles.length,
            reusedDeclared: plan.reusedDeclaredRoles.size,
            reusedUndeclared: plan.reusedUndeclaredRoles.size,
            availableDetected: plan.availableDetected.length
        },
        semanticEqual,
        rereadValid,
        idempotent,
        renamedState
    };
}

function getCurrentRoleEntries(state = parsedData) {
    ensureStableRoleNames(state);
    const roles = new Map();
    Object.keys(state.groups || {}).sort(compareRoleNames).forEach(prefix => {
        const group = state.groups[prefix];
        if (group.members.length === 0) {
            const roleName = group.isNumbered ? `${prefix}1` : prefix;
            const roleData = createRoleData();
            roleData.badge = prefix;
            roleData.permissions = new Set(group.permissions);
            roles.set(roleName, { roleName, data: roleData, prefix, member: null });
            return;
        }
        group.members.forEach((member, index) => {
            const roleName = getRoleName(prefix, group, index);
            ensureMemberPermissions(member, group.permissions);
            if (!roles.has(roleName)) roles.set(roleName, { roleName, data: member, prefix, member });
        });
    });
    state.orphanRoleData?.forEach((data, roleName) => {
        if (!roles.has(roleName)) roles.set(roleName, { roleName, data, prefix: roleName, member: null });
    });
    return [...roles.values()].sort((a, b) => compareRoleNames(a.roleName, b.roleName));
}

function buildManagedRemoteAdminLines() {
    const roleEntries = getCurrentRoleEntries();
    const entryByRole = new Map(roleEntries.map(entry => [entry.roleName, entry]));
    const out = ['Members:'];

    Object.keys(parsedData.groups).sort(compareRoleNames).forEach(prefix => {
        const group = parsedData.groups[prefix];
        group.members.forEach((member, index) => {
            const roleName = getRoleName(prefix, group, index);
            const memberNotes = configScalar(member.notes);
            const comment = memberNotes;
            if (comment) out.push(` # ${comment}`);
            out.push(` - ${configScalar(member.id)}: ${roleName}`);
        });
    });

    out.push('', `${remoteAdminDocument?.roleSectionName || 'Groups'}:`);
    roleEntries.forEach(({ roleName }) => out.push(` - ${roleName}`));

    out.push('', 'Permissions:');
    const permissions = new Set(parsedData.permissionList);
    roleEntries.forEach(({ data }) => ensureMemberPermissions(data).forEach(permission => permissions.add(permission)));
    [...permissions].sort((a, b) => a.localeCompare(b)).forEach(permission => {
        const rolesWithPermission = roleEntries
            .filter(({ data }) => ensureMemberPermissions(data).has(permission))
            .map(({ roleName }) => roleName);
        (parsedData.permissionUnknownRoleRefs?.get(permission) || []).forEach(roleName => {
            if (!rolesWithPermission.includes(roleName)) rolesWithPermission.push(roleName);
        });
        if (rolesWithPermission.length === 0) return;
        const comment = parsedData.permissionComments[permission];
        if (comment) out.push(` # ${configScalar(comment)}`);
        out.push(` - ${permission}: [${rolesWithPermission.join(', ')}]`);
    });

    out.push('');
    roleEntries.forEach(({ roleName, data }, index) => {
        if (index > 0) out.push('');
        out.push(`${roleName}_badge: ${configScalar(data.badge || roleName)}`);
        out.push(`${roleName}_color: ${safeCssToken(data.color)}`);
        out.push(`${roleName}_cover: ${Boolean(data.cover)}`);
        out.push(`${roleName}_hidden: ${Boolean(data.hidden)}`);
        out.push(`${roleName}_kick_power: ${Number.isFinite(data.kickPower) ? data.kickPower : 0}`);
        out.push(`${roleName}_required_kick_power: ${Number.isFinite(data.reqKickPower) ? data.reqKickPower : 0}`);
    });

    const overrideRoles = new Set(parsedData.overridePasswordUnknownRoles || []);
    (parsedData.overridePasswordRoles || []).forEach(role => {
        if (entryByRole.has(role)) overrideRoles.add(role);
    });
    if (overrideRoles.size > 0) out.push('', `override_password_role: ${[...overrideRoles].join(', ')}`);
    return out;
}

function splitTopLevelBlocks(text) {
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    const blocks = [];
    let current = { key: null, lines: [] };
    lines.forEach(line => {
        const match = line.match(/^([A-Za-z0-9_]+):(?:\s.*)?$/);
        if (match) {
            if (current.lines.length) blocks.push(current);
            current = { key: match[1], lines: [line] };
        } else {
            current.lines.push(line);
        }
    });
    if (current.lines.length) blocks.push(current);
    return blocks;
}

function isManagedRemoteAdminBlock(key) {
    return ['Members', 'Groups', 'Permissions', 'override_password_role'].includes(key)
        || /^[A-Za-z0-9_]+_(badge|color|cover|hidden|kick_power|required_kick_power)$/.test(key || '');
}

function getCurrentMemberEntries(state = parsedData) {
    ensureStableRoleNames(state);
    const members = [];
    Object.entries(state.groups || {}).forEach(([prefix, group]) => {
        (group.members || []).forEach((member, index) => {
            members.push({
                prefix,
                group,
                member,
                roleName: getRoleName(prefix, group, index)
            });
        });
    });
    return members;
}

function rolePropertyValue(data, property, roleName) {
    if (property === 'badge') return configScalar(data.badge || roleName);
    if (property === 'color') return configScalar(data.color || 'default');
    if (property === 'cover') return String(Boolean(data.cover));
    if (property === 'hidden') return String(Boolean(data.hidden));
    if (property === 'kick_power') return String(Number.isFinite(data.kickPower) ? data.kickPower : 0);
    if (property === 'required_kick_power') {
        return String(Number.isFinite(data.reqKickPower) ? data.reqKickPower : 0);
    }
    return '';
}

function rolePropertyMatchesSource(data, node, roleName) {
    const rawValue = node.rawValue.trim();
    if (node.property === 'badge') return String(data.badge) === rawValue;
    if (node.property === 'color') return String(data.color) === rawValue;
    if (node.property === 'cover') return Boolean(data.cover) === (rawValue.toLowerCase() === 'true');
    if (node.property === 'hidden') return Boolean(data.hidden) === (rawValue.toLowerCase() === 'true');
    if (node.property === 'kick_power') {
        return Number(data.kickPower) === (Number.parseInt(rawValue, 10) || 0);
    }
    if (node.property === 'required_kick_power') {
        return Number(data.reqKickPower) === (Number.parseInt(rawValue, 10) || 0);
    }
    return rolePropertyValue(data, node.property, roleName) === rawValue;
}

function addLinePatch(patches, start, end, lines, reason) {
    patches.push({ start, end, lines, reason });
}

function addAssociatedLinePatch(patches, indexes, lineIndex, replacementLines, reason) {
    const start = indexes.length > 0 ? Math.min(...indexes) : lineIndex;
    addLinePatch(patches, start, lineIndex + 1, replacementLines, reason);
}

function rolePropertyInsertionIndex(document) {
    const rolesHeaderIndex = document.sections.roles?.headerIndex;
    const propertyNodes = [...document.rolePropertyNodes.values()]
        .flatMap(properties => [...properties.values()].flat());
    const propertyNodesBeforeRoles = propertyNodes.filter(node =>
        rolesHeaderIndex !== undefined && node.lineIndex < rolesHeaderIndex
    );
    if (propertyNodesBeforeRoles.length > 0 && rolesHeaderIndex !== undefined) {
        let index = rolesHeaderIndex;
        while (index > 0 && (document.lines[index - 1] === '' || /^\s*#/.test(document.lines[index - 1]))) {
            index -= 1;
        }
        return index;
    }
    if (propertyNodes.length > 0) {
        return Math.max(...propertyNodes.map(node => node.lineIndex)) + 1;
    }
    return rolesHeaderIndex ?? document.lines.length;
}

function applyRemoteAdminLinePatches(document, patches) {
    if (patches.length === 0) return document.sourceText;
    const lines = [...document.lines];
    patches
        .sort((first, second) => second.start - first.start || second.end - first.end)
        .forEach(patch => {
            lines.splice(patch.start, patch.end - patch.start, ...patch.lines);
        });
    const body = lines.join(document.lineEnding);
    return `${document.hasBom ? '\uFEFF' : ''}${body}`;
}

function buildRemoteAdminLinePatches(document, state = parsedData) {
    const patches = [];
    const currentMembers = getCurrentMemberEntries(state);
    const memberBySourceId = new Map(
        currentMembers
            .filter(({ member }) => member.sourceMemberId)
            .map(entry => [entry.member.sourceMemberId, entry])
    );

    document.memberEntries.forEach(sourceEntry => {
        const currentEntry = memberBySourceId.get(sourceEntry.sourceId);
        if (!currentEntry) {
            addAssociatedLinePatch(
                patches,
                sourceEntry.commentIndexes,
                sourceEntry.lineIndex,
                [],
                'member-removed'
            );
            return;
        }
        const { member, roleName } = currentEntry;
        const notesChanged = String(member.notes || '') !== sourceEntry.notes;
        const memberLineChanged = configScalar(member.id) !== sourceEntry.id || roleName !== sourceEntry.roleName;
        if (!notesChanged && memberLineChanged) {
            addLinePatch(
                patches,
                sourceEntry.lineIndex,
                sourceEntry.lineIndex + 1,
                [`${sourceEntry.indent}- ${configScalar(member.id)}: ${roleName}`],
                'member-updated'
            );
            return;
        }
        if (notesChanged) {
            const replacement = [];
            const notes = configScalar(member.notes);
            if (notes) replacement.push(`${document.styles.memberCommentPrefix}${notes}`);
            replacement.push(`${sourceEntry.indent}- ${configScalar(member.id)}: ${roleName}`);
            addAssociatedLinePatch(
                patches,
                sourceEntry.commentIndexes,
                sourceEntry.lineIndex,
                replacement,
                'member-note-updated'
            );
        }
    });

    const newMembers = currentMembers.filter(({ member }) => !member.sourceMemberId);
    if (newMembers.length > 0 && document.sections.members) {
        const newLines = [];
        newMembers.forEach(({ member, roleName }) => {
            const notes = configScalar(member.notes);
            if (notes) newLines.push(`${document.styles.memberCommentPrefix}${notes}`);
            newLines.push(`${document.styles.memberIndent}- ${configScalar(member.id)}: ${roleName}`);
        });
        addLinePatch(
            patches,
            managedEntriesInsertionIndex(document.sections.members, document.memberEntries),
            managedEntriesInsertionIndex(document.sections.members, document.memberEntries),
            newLines,
            'members-added'
        );
    }

    const roleEntries = getCurrentRoleEntries(state);
    const entryByRole = new Map(roleEntries.map(entry => [entry.roleName, entry]));
    const currentRoleNames = new Set(entryByRole.keys());
    const sourceRoleNames = new Set(document.roleEntries.map(entry => entry.roleName));

    document.roleEntries.forEach(sourceRole => {
        if (!currentRoleNames.has(sourceRole.roleName)) {
            addLinePatch(
                patches,
                sourceRole.lineIndex,
                sourceRole.lineIndex + 1,
                [],
                'role-removed'
            );
        }
    });
    const newRoleNames = roleEntries
        .map(entry => entry.roleName)
        .filter(roleName => !sourceRoleNames.has(roleName));
    if (newRoleNames.length > 0 && document.sections.roles) {
        const insertionIndex = managedEntriesInsertionIndex(document.sections.roles, document.roleEntries);
        addLinePatch(
            patches,
            insertionIndex,
            insertionIndex,
            newRoleNames.map(roleName => `${document.styles.roleIndent}- ${roleName}`),
            'roles-added'
        );
    }

    document.rolePropertyNodes.forEach((properties, roleName) => {
        const roleEntry = entryByRole.get(roleName);
        properties.forEach(nodes => {
            const effectiveNode = nodes.at(-1);
            nodes.forEach(node => {
                if (!roleEntry) {
                    addLinePatch(
                        patches,
                        node.lineIndex,
                        node.lineIndex + 1,
                        [],
                        'role-property-removed'
                    );
                    return;
                }
                // RemoteAdmin aplica el último valor cuando una propiedad está
                // repetida. Los nodos anteriores se conservan literalmente.
                if (node !== effectiveNode) return;
                if (rolePropertyMatchesSource(roleEntry.data, node, roleName)) return;
                addLinePatch(
                    patches,
                    node.lineIndex,
                    node.lineIndex + 1,
                    [`${roleName}_${node.property}:${node.separator || ' '}${rolePropertyValue(roleEntry.data, node.property, roleName)}`],
                    'role-property-updated'
                );
            });
        });
    });

    const sourcePropertyRoleNames = new Set(document.rolePropertyNodes.keys());
    const newPropertyRoles = roleEntries.filter(({ roleName }) => !sourcePropertyRoleNames.has(roleName));
    if (newPropertyRoles.length > 0) {
        const propertyOrder = ['badge', 'color', 'cover', 'hidden', 'kick_power', 'required_kick_power'];
        const newPropertyLines = [''];
        newPropertyRoles.forEach(({ roleName, data }, roleIndex) => {
            if (roleIndex > 0) newPropertyLines.push('');
            propertyOrder.forEach(property => {
                newPropertyLines.push(`${roleName}_${property}: ${rolePropertyValue(data, property, roleName)}`);
            });
        });
        addLinePatch(
            patches,
            rolePropertyInsertionIndex(document),
            rolePropertyInsertionIndex(document),
            newPropertyLines,
            'role-properties-added'
        );
    }

    const permissionEntriesByName = new Map();
    document.permissionEntries.forEach(entry => {
        if (!permissionEntriesByName.has(entry.permission)) permissionEntriesByName.set(entry.permission, []);
        permissionEntriesByName.get(entry.permission).push(entry);
    });
    const currentPermissionRoles = new Map();
    const allPermissions = new Set(document.permissionEntries.map(entry => entry.permission));
    roleEntries.forEach(({ roleName, data }) => {
        ensureMemberPermissions(data).forEach(permission => {
            allPermissions.add(permission);
            if (!currentPermissionRoles.has(permission)) currentPermissionRoles.set(permission, new Set());
            currentPermissionRoles.get(permission).add(roleName);
        });
    });
    (state.permissionUnknownRoleRefs || new Map()).forEach((roles, permission) => {
        allPermissions.add(permission);
        if (!currentPermissionRoles.has(permission)) currentPermissionRoles.set(permission, new Set());
        roles.forEach(roleName => currentPermissionRoles.get(permission).add(roleName));
    });

    permissionEntriesByName.forEach((sourceEntries, permission) => {
        const desiredSet = currentPermissionRoles.get(permission) || new Set();
        const sourceRoles = [];
        sourceEntries.forEach(sourceEntry => {
            sourceEntry.roles.forEach(roleName => {
                if (!sourceRoles.includes(roleName)) sourceRoles.push(roleName);
            });
        });
        const desiredRoles = sourceRoles.filter(roleName => desiredSet.has(roleName));
        desiredSet.forEach(roleName => {
            if (!desiredRoles.includes(roleName)) desiredRoles.push(roleName);
        });
        const rolesChanged = desiredRoles.length !== sourceRoles.length
            || desiredRoles.some((roleName, index) => roleName !== sourceRoles[index]);
        const desiredComment = String(state.permissionComments[permission] || '');
        const sourceComment = [...sourceEntries]
            .reverse()
            .find(sourceEntry => sourceEntry.comment)?.comment || '';
        const commentChanged = desiredComment !== sourceComment;
        if (!rolesChanged && !commentChanged) return;

        const sourceEntry = sourceEntries.at(-1);
        sourceEntries.slice(0, -1).forEach(duplicateEntry => {
            addAssociatedLinePatch(
                patches,
                duplicateEntry.commentIndexes,
                duplicateEntry.lineIndex,
                [],
                'duplicate-permission-consolidated'
            );
        });
        const replacement = [];
        if (desiredComment) replacement.push(`${document.styles.permissionCommentPrefix}${configScalar(desiredComment)}`);
        replacement.push(
            `${sourceEntry.indent}- ${sourceEntry.permission}:${sourceEntry.separator || ' '}[${desiredRoles.join(', ')}]${sourceEntry.trailingWhitespace}`
        );
        addAssociatedLinePatch(
            patches,
            sourceEntry.commentIndexes,
            sourceEntry.lineIndex,
            replacement,
            'permission-updated'
        );
    });

    const newPermissions = [...allPermissions].filter(permission =>
        !permissionEntriesByName.has(permission)
        && (currentPermissionRoles.get(permission)?.size || 0) > 0
    );
    if (newPermissions.length > 0 && document.sections.permissions) {
        const newLines = [];
        newPermissions.forEach(permission => {
            const comment = configScalar(state.permissionComments[permission]);
            if (comment) newLines.push(`${document.styles.permissionCommentPrefix}${comment}`);
            newLines.push(
                `${document.styles.permissionIndent}- ${permission}: [${[...(currentPermissionRoles.get(permission) || [])].join(', ')}]`
            );
        });
        const insertionIndex = managedEntriesInsertionIndex(document.sections.permissions, document.permissionEntries);
        addLinePatch(patches, insertionIndex, insertionIndex, newLines, 'permissions-added');
    }

    const overridePasswordRoleIndex = document.lines.findIndex(line =>
        /^override_password_role:\s*/.test(line)
    );
    if (overridePasswordRoleIndex >= 0) {
        const overrideMatch = document.lines[overridePasswordRoleIndex]
            .match(/^(override_password_role:)(\s*)(.*)$/);
        const sourceRoles = (overrideMatch?.[3] || '')
            .split(',')
            .map(roleName => roleName.trim())
            .filter(Boolean);
        const desiredSet = new Set(state.overridePasswordUnknownRoles || []);
        (state.overridePasswordRoles || []).forEach(roleName => {
            if (currentRoleNames.has(roleName)) desiredSet.add(roleName);
        });
        const desiredRoles = sourceRoles.filter(roleName => desiredSet.has(roleName));
        desiredSet.forEach(roleName => {
            if (!desiredRoles.includes(roleName)) desiredRoles.push(roleName);
        });
        const changed = desiredRoles.length !== sourceRoles.length
            || desiredRoles.some((roleName, index) => roleName !== sourceRoles[index]);
        if (changed) {
            addLinePatch(
                patches,
                overridePasswordRoleIndex,
                overridePasswordRoleIndex + 1,
                [`${overrideMatch?.[1] || 'override_password_role:'}${overrideMatch?.[2] || ' '}${desiredRoles.join(', ')}`],
                'override-password-roles-updated'
            );
        }
    }

    return patches;
}

function generateLegacyConfig() {
    const managedLines = buildManagedRemoteAdminLines();
    const outputLines = [];
    let insertedManagedSections = false;

    splitTopLevelBlocks(originalConfigText).forEach(block => {
        if (isManagedRemoteAdminBlock(block.key)) {
            if (!insertedManagedSections) {
                outputLines.push(...managedLines);
                insertedManagedSections = true;
            }
            return;
        }
        outputLines.push(...block.lines);
    });
    if (!insertedManagedSections) outputLines.push(...managedLines);

    let output = outputLines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd();
    if (/\r?\n$/.test(originalConfigText)) output += '\n';
    return originalLineEnding === '\r\n' ? output.replace(/\n/g, '\r\n') : output;
}

function generateConfig() {
    if (!remoteAdminDocument || remoteAdminDocument.sourceText !== originalConfigText) {
        remoteAdminDocument = parseRemoteAdminDocument(originalConfigText, { filename: uploadedFileName });
    }
    if (!remoteAdminDocument.sections.members || !remoteAdminDocument.sections.roles) {
        return generateLegacyConfig();
    }
    return applyRemoteAdminLinePatches(
        remoteAdminDocument,
        buildRemoteAdminLinePatches(remoteAdminDocument, parsedData)
    );
}

function createExportIssue(code, message) {
    return { code, message };
}

function getRemoteAdminFilename(document = remoteAdminDocument, requestedFilename) {
    const rawFilename = String(
        requestedFilename || document?.filename || uploadedFileName || 'config_remoteadmin.txt'
    ).split(/[\\/]/).at(-1).trim();
    if (!rawFilename) return 'config_remoteadmin.txt';
    return /\.txt$/i.test(rawFilename) ? rawFilename : `${rawFilename}.txt`;
}

function validateGeneratedRemoteAdminContent(content, state = parsedData, sourceDocument = remoteAdminDocument) {
    const errors = [];
    const warnings = [];
    const addError = (code, message) => {
        if (!errors.some(issue => issue.code === code && issue.message === message)) {
            errors.push(createExportIssue(code, message));
        }
    };
    const addWarning = (code, message) => {
        if (!warnings.some(issue => issue.code === code && issue.message === message)) {
            warnings.push(createExportIssue(code, message));
        }
    };
    const generatedDocument = parseRemoteAdminDocument(content);
    const currentMembers = getCurrentMemberEntries(state);
    const roleEntries = getCurrentRoleEntries(state);
    const currentRoleNames = new Set(roleEntries.map(entry => entry.roleName));
    const acceptedColors = getAcceptedBadgeColors();

    if (!generatedDocument.sections.members) {
        addError('MEMBERS_SECTION_MISSING', t('val.genSecMissing', { section: 'Members' }));
    }
    if (!generatedDocument.sections.roles) {
        addError('ROLES_SECTION_MISSING', t('val.genSecMissing', { section: 'Roles o Groups' }));
    }
    if (!generatedDocument.sections.permissions) {
        addError('PERMISSIONS_SECTION_MISSING', t('val.genSecMissing', { section: 'Permissions' }));
    }
    if (sourceDocument?.roleSectionName
        && generatedDocument.roleSectionName !== sourceDocument.roleSectionName) {
        addError(
            'ROLE_SECTION_STYLE_CHANGED',
            t('val.roleStyleChanged', { from: sourceDocument.roleSectionName, to: generatedDocument.roleSectionName || t('val.noneValue') })
        );
    }
    if (generatedDocument.duplicateSections.length > 0) {
        addError(
            'DUPLICATE_MANAGED_SECTION',
            t('val.dupManagedSection')
        );
    }
    const generatedRolesSection = generatedDocument.sections.roles;
    if (generatedRolesSection) {
        generatedDocument.lines
            .slice(generatedRolesSection.headerIndex + 1, generatedRolesSection.endIndex)
            .filter(line => /^\s*-\s*:?\s*$/.test(line))
            .forEach(() => {
                addError(
                    'GROUP_NAME_MISSING',
                    t('val.groupNameMissing', { section: generatedDocument.roleSectionName || 'Roles' })
                );
            });
    }
    (state.sourceValidationIssues || []).forEach(issue => {
        if (issue.severity === 'error') addError(issue.code, issue.message);
        else addWarning(issue.code, issue.message);
    });

    const userIdOwners = new Map();
    currentMembers.forEach(({ member, roleName }) => {
        const rawId = String(member.id || '').trim();
        const validatedId = validateRemoteAdminUserId(rawId);
        if (!validatedId.valid) {
            const issueCode = validatedId.provider === 'steam'
                ? 'INVALID_STEAM_ID'
                : 'INVALID_REMOTE_ADMIN_ID';
            addError(
                issueCode,
                t('val.badId', { id: rawId || t('val.emptyId'), role: roleName || t('val.noRole') })
            );
        } else {
            if (!userIdOwners.has(validatedId.normalized)) {
                userIdOwners.set(validatedId.normalized, {
                    provider: validatedId.provider,
                    roles: []
                });
            }
            userIdOwners.get(validatedId.normalized).roles.push(roleName);
        }
        if (!roleName || !currentRoleNames.has(roleName)) {
            addError(
                'MEMBER_ROLE_UNKNOWN',
                t('val.memberRoleUnknown', { id: rawId || t('val.noId'), role: roleName || t('val.emptyRole') })
            );
        }
    });
    userIdOwners.forEach(({ provider, roles }, userId) => {
        if (roles.length > 1) {
            addError(
                provider === 'steam' ? 'DUPLICATE_STEAM_ID' : 'DUPLICATE_REMOTE_ADMIN_ID',
                t('val.dupId', { id: userId, count: roles.length, roles: roles.join(', ') })
            );
        }
    });

    generatedDocument.rolePropertyNodes.forEach((properties, roleName) => {
        properties.forEach((nodes, property) => {
            if (nodes.length > 1) {
                addWarning(
                    'DUPLICATE_ROLE_PROPERTY',
                    t('val.dupRoleProp', { name: `${roleName}_${property}`, count: nodes.length })
                );
            }
        });
    });
    const permissionCounts = new Map();
    generatedDocument.permissionEntries.forEach(entry => {
        permissionCounts.set(entry.permission, (permissionCounts.get(entry.permission) || 0) + 1);
    });
    permissionCounts.forEach((count, permission) => {
        if (count > 1) {
            addWarning(
                'DUPLICATE_PERMISSION',
                t('val.dupPerm', { perm: permission, count })
            );
        }
    });

    const propertyNames = ['badge', 'color', 'cover', 'hidden', 'kick_power', 'required_kick_power'];
    roleEntries.forEach(({ roleName, data }) => {
        if (!roleName) {
            addError('ROLE_NAME_MISSING', t('val.roleNameMissing'));
            return;
        }
        const color = String(data.color || '').trim().toLowerCase();
        if (!acceptedColors.has(color)) {
            addError('INVALID_ROLE_COLOR', t('val.invalidRoleColor', { role: roleName, color: data.color }));
        }
        if (!configScalar(data.badge)) {
            addWarning('EMPTY_ROLE_BADGE', t('val.emptyRoleBadge', { role: roleName }));
        }
        const generatedProperties = generatedDocument.rolePropertyNodes.get(roleName);
        const missingProperties = propertyNames.filter(property => !generatedProperties?.has(property));
        if (missingProperties.length > 0) {
            addError(
                'ROLE_PROPERTIES_MISSING',
                t('val.rolePropsMissing', { role: roleName, list: missingProperties.join(', ') })
            );
        }
        ['cover', 'hidden'].forEach(property => {
            const rawValue = generatedProperties?.get(property)?.at(-1)?.rawValue.trim() || '';
            if (rawValue && !/^(?:true|false|default)$/i.test(rawValue)) {
                addError(
                    'INVALID_ROLE_BOOLEAN',
                    t('val.invalidRoleBool', { name: `${roleName}_${property}`, value: rawValue })
                );
            }
        });
        ['kick_power', 'required_kick_power'].forEach(property => {
            const rawValue = generatedProperties?.get(property)?.at(-1)?.rawValue.trim() || '';
            const numericValue = Number(rawValue);
            const validPower = /^default$/i.test(rawValue)
                || (/^\d+$/.test(rawValue)
                    && Number.isInteger(numericValue)
                    && numericValue >= 0
                    && numericValue <= 255);
            if (rawValue && !validPower) {
                addError(
                    'INVALID_ROLE_POWER',
                    t('val.invalidRolePower', { name: `${roleName}_${property}`, value: rawValue })
                );
            }
        });
    });

    (state.permissionUnknownRoleRefs || new Map()).forEach((roles, permission) => {
        roles.forEach(roleName => {
            if (!currentRoleNames.has(roleName)) {
                addError(
                    'PERMISSION_ROLE_UNKNOWN',
                    t('val.permUnknown', { perm: permission, role: roleName })
                );
            }
        });
    });
    (state.overridePasswordUnknownRoles || new Set()).forEach(roleName => {
        if (!currentRoleNames.has(roleName)) {
            addError(
                'OVERRIDE_PASSWORD_ROLE_UNKNOWN',
                t('val.overrideUnknown', { role: roleName })
            );
        }
    });

    const generatedRoleNames = new Set(generatedDocument.roleEntries.map(entry => entry.roleName));
    currentMembers.forEach(({ member, roleName }) => {
        if (!generatedRoleNames.has(roleName)) {
            addError(
                'GENERATED_MEMBER_ROLE_UNDECLARED',
                t('val.memberRoleUndeclared', { id: member.id, role: roleName, section: generatedDocument.roleSectionName || 'Roles' })
            );
        }
    });
    if (generatedDocument.memberEntries.length !== currentMembers.length) {
        addError(
            'MEMBER_COUNT_MISMATCH',
            t('val.memberCount', { expected: currentMembers.length, generated: generatedDocument.memberEntries.length })
        );
    }

    const memberRoleNames = new Set(currentMembers.map(entry => entry.roleName));
    roleEntries.forEach(({ roleName }) => {
        if (!memberRoleNames.has(roleName)) {
            addWarning('ROLE_WITHOUT_MEMBER', t('val.noMember', { role: roleName }));
        }
    });
    if (currentMembers.length === 0) {
        addError('NO_REMOTE_ADMIN_MEMBERS', t('val.noMembers'));
    }

    return { errors, warnings, document: generatedDocument };
}

// ==========================================
// Centralized RemoteAdmin diagnostics
// ==========================================
function remoteAdminDiagnosticId(code, line, roleName, occurrence = 0) {
    return `${code}:${Number(line) || 0}:${String(roleName || '')}:${occurrence}`;
}

function createRemoteAdminDiagnostic(input, occurrence = 0) {
    const severity = ['error', 'warning', 'info'].includes(input.severity)
        ? input.severity
        : 'warning';
    const line = Number(input.line) || 0;
    const roleName = String(input.roleName || '');
    return {
        id: input.id || remoteAdminDiagnosticId(input.code, line, roleName, occurrence),
        code: input.code,
        severity,
        title: input.title || input.code,
        explanation: input.explanation || input.message || '',
        message: input.message || input.explanation || '',
        section: input.section || 'RemoteAdmin',
        line,
        column: Number(input.column) || 1,
        roleName,
        userId: String(input.userId || ''),
        currentValue: input.currentValue ?? '',
        suggestedValue: input.suggestedValue ?? '',
        repairKind: input.repairKind || 'manual',
        repairAction: input.repairAction || null,
        options: input.options || [],
        affects: input.affects || ['remoteadmin'],
        excerpt: input.excerpt || '',
        ignored: false
    };
}

function remoteAdminLevenshtein(leftValue, rightValue) {
    const left = String(leftValue || '').toLowerCase();
    const right = String(rightValue || '').toLowerCase();
    const row = Array.from({ length: right.length + 1 }, (_, index) => index);
    for (let leftIndex = 1; leftIndex <= left.length; leftIndex++) {
        let diagonal = row[0];
        row[0] = leftIndex;
        for (let rightIndex = 1; rightIndex <= right.length; rightIndex++) {
            const previous = row[rightIndex];
            row[rightIndex] = Math.min(
                row[rightIndex] + 1,
                row[rightIndex - 1] + 1,
                diagonal + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1)
            );
            diagonal = previous;
        }
    }
    return row[right.length];
}

function findRemoteAdminColorSuggestion(value, acceptedColors = getAcceptedBadgeColors()) {
    const source = String(value || '').trim();
    if (!source) return null;
    const lower = source.toLowerCase();
    if (acceptedColors.has(lower)) return { value: lower, exactCaseOnly: source !== lower };
    const ranked = [...acceptedColors]
        .map(color => ({ color, distance: remoteAdminLevenshtein(lower, color) }))
        .sort((left, right) => left.distance - right.distance || left.color.localeCompare(right.color));
    if (!ranked.length || ranked[0].distance > 2) return null;
    if (ranked[1] && ranked[1].distance === ranked[0].distance) return null;
    return { value: ranked[0].color, exactCaseOnly: false };
}

function matchDeclaredRemoteAdminRoleProperty(line, declaredRoles) {
    const source = String(line || '');
    const roles = [...(declaredRoles || [])].sort((left, right) => right.length - left.length);
    for (const roleName of roles) {
        if (!source.startsWith(`${roleName}_`)) continue;
        const remainder = source.slice(roleName.length + 1);
        const match = remainder.match(/^([A-Za-z][A-Za-z0-9_]*):(\s*)(.*)$/);
        if (match) return { roleName, property: match[1], separator: match[2], value: match[3] };
    }
    return null;
}

function getRemoteAdminUnknownPropertyCount(document) {
    const declaredRoles = new Set(document.roleEntries.map(entry => entry.roleName));
    document.memberEntries.forEach(entry => declaredRoles.add(entry.roleName));
    let count = 0;
    document.lines.forEach(line => {
        const match = matchDeclaredRemoteAdminRoleProperty(line, declaredRoles);
        if (match && !MEMBER_PROPERTY_NAMES.has(match.property)) count += 1;
    });
    return count;
}

function getRemoteAdminDiagnosticStats(document) {
    return {
        users: document.memberEntries.length,
        userIds: new Set(document.memberEntries.map(entry => entry.id.toLowerCase())).size,
        roles: new Set(document.roleEntries.map(entry => entry.roleName)).size,
        roleDeclarations: document.roleEntries.length,
        permissions: document.permissionEntries.length,
        properties: [...document.rolePropertyNodes.values()].reduce(
            (total, properties) => total + [...properties.values()].reduce((sum, nodes) => sum + nodes.length, 0),
            0
        ),
        unknownProperties: getRemoteAdminUnknownPropertyCount(document)
    };
}

STRINGS.es.diag.msg = {
    emptyValue: '(vacío)',
    RA_MEMBERS_SECTION_MISSING: { title: 'Falta {label}', text: 'No se encontró la sección obligatoria {label}; las relaciones no pueden validarse de forma segura.' },
    RA_ROLES_SECTION_MISSING: { title: 'Falta {label}', text: 'No se encontró la sección obligatoria {label}; las relaciones no pueden validarse de forma segura.' },
    RA_PERMISSIONS_SECTION_MISSING: { title: 'Falta {label}', text: 'No se encontró la sección obligatoria {label}; las relaciones no pueden validarse de forma segura.' },
    RA_DUPLICATE_SECTION: { title: 'Sección administrada duplicada', text: 'La sección {section} aparece más de una vez. Debe elegirse qué contenido conservar.' },
    RA_GROUP_NAME_MISSING: { title: 'Grupo sin nombre', text: '{section} contiene una entrada “-” sin ID interna.' },
    RA_MEMBER_SYNTAX_INVALID: { title: 'Sintaxis inválida en {section}', text: 'La línea parece una entrada administrada, pero el parser no puede interpretarla con seguridad.' },
    RA_ROLE_SYNTAX_INVALID: { title: 'Sintaxis inválida en {section}', text: 'La línea parece una entrada administrada, pero el parser no puede interpretarla con seguridad.' },
    RA_PERMISSION_SYNTAX_INVALID: { title: 'Sintaxis inválida en {section}', text: 'La línea parece una entrada administrada, pero el parser no puede interpretarla con seguridad.' },
    RA_INVALID_STEAMID: { title: 'Identificador de usuario inválido', text: '“{id}” no cumple el formato admitido por RemoteAdmin.' },
    RA_INVALID_USER_ID: { title: 'Identificador de usuario inválido', text: '“{id}” no cumple el formato admitido por RemoteAdmin.' },
    RA_MEMBER_ROLE_MISSING: { title: 'Miembro apunta a una ID inexistente', text: '{id} referencia {role}, pero esa ID no está declarada en {section}.' },
    RA_DUPLICATE_STEAM_PROVIDER: { title: 'Proveedor @steam repetido', text: 'El sufijo @steam está duplicado y puede normalizarse sin cambiar la identidad.' },
    RA_STEAM_PROVIDER_MISSING: { title: 'Falta el proveedor @steam', text: 'La línea contiene un SteamID64 válido, pero falta el sufijo requerido @steam.' },
    RA_EXACT_MEMBER_DUPLICATE: { title: 'Miembro duplicado exactamente', text: 'El registro {id} es idéntico a uno anterior y puede eliminarse con seguridad.' },
    RA_DUPLICATE_STEAMID: { title: 'Identificador asociado a usuarios distintos', text: '{id} está asociado a {roles}. Elige explícitamente cuál debe conservarse.', keep: 'Conservar {role} (línea {line})' },
    RA_DUPLICATE_USER_ID: { title: 'Identificador asociado a usuarios distintos', text: '{id} está asociado a {roles}. Elige explícitamente cuál debe conservarse.', keep: 'Conservar {role} (línea {line})' },
    RA_DUPLICATE_INTERNAL_ID: { title: 'ID interna compartida por varios usuarios', text: '{role} pertenece a {count} usuarios. No se puede elegir automáticamente una asociación.' },
    RA_SHARED_ROLE: { title: 'Grupo compartido', text: '{role} es un grupo sin numeración compartido por {count} usuarios; se conservará así.' },
    RA_DUPLICATE_ROLE_DECLARATION: { title: 'ID interna declarada varias veces', text: '{role} aparece {count} veces en {section}.' },
    RA_INVALID_INTERNAL_ID_NUMBER: { title: 'Número de ID interna inválido', text: '{role} debe utilizar un sufijo numérico mayor o igual que 1.' },
    RA_ID_DECLARED_UNUSED: { title: 'ID declarada pero no utilizada', text: '{role} está declarada pero actualmente no está siendo utilizada. Esta ID puede reutilizarse durante Reorganizar IDs.' },
    RA_ORPHAN_ROLE: { title: 'Rol sin usuario', text: '{role} está declarado y puede ser válido, pero no tiene un usuario en Members.' },
    RA_REQUIRED_PROPERTIES_MISSING: { title: 'Propiedades obligatorias faltantes', text: '{role} no contiene: {list}.' },
    RA_ORPHAN_PROPERTY_BLOCK: { title: 'Bloque de propiedades sin rol declarado', text: 'Hay propiedades para {role}, pero esa ID no está declarada. Se conservarán hasta que decidas qué hacer.' },
    RA_EXACT_PROPERTY_DUPLICATE: { title: 'Propiedad duplicada exactamente', text: '{name} repite el mismo valor y la copia anterior puede eliminarse.' },
    RA_CONFLICTING_PROPERTY_DUPLICATE: { title: 'Propiedad duplicada con valores diferentes', text: '{name} contiene {values}. El último valor es efectivo, pero debes elegir cuál conservar.', keep: 'Conservar “{value}” (línea {line})' },
    RA_INVALID_COLOR: { title: 'Color de badge no admitido', text: '“{value}” no existe. La coincidencia más probable es “{suggestion}”.', textNoSuggestion: '“{value}” no existe en la lista de colores aceptados.' },
    RA_COLOR_CASE_NORMALIZATION: { title: 'Color con mayúsculas', text: 'El color “{value}” es válido, pero RemoteAdmin usa “{lower}” de forma consistente.' },
    RA_EMPTY_BADGE: { title: 'Badge vacío', text: '{role} no mostrará texto de badge.' },
    RA_INVALID_BOOLEAN: { title: 'Valor booleano inválido', text: '{name} debe ser true, false o default; se encontró “{value}”.' },
    RA_INVALID_KICK_POWER: { title: 'Poder de expulsión inválido', text: '{name} debe ser default o un entero entre 0 y 255; se encontró “{value}”.' },
    RA_UNKNOWN_PROPERTY: { title: 'Propiedad desconocida conservada', text: '{name} no es administrada por la página y no será eliminada ni modificada.' },
    RA_PROPERTY_COLON_MISSING: { title: 'Falta “:” en una propiedad', text: 'La línea tiene una clave conocida y un valor inequívoco, pero falta el separador.' },
    RA_PERMISSION_ROLE_MISSING: { title: 'Permiso apunta a una ID inexistente', text: '{perm} referencia {role}, que no está declarada.' },
    RA_DUPLICATE_PERMISSION_ROLE: { title: 'ID repetida en un permiso', text: '{perm} repite una o más IDs; se pueden quitar las copias sin cambiar el permiso.' },
    RA_EMPTY_PERMISSION: { title: 'Permiso sin IDs asignadas', text: '{perm} tiene una lista vacía. Esto puede ser intencional.' },
    RA_UNKNOWN_PERMISSION: { title: 'Permiso desconocido conservado', text: '{perm} no está en el catálogo actual de la página y se conservará literalmente.' },
    RA_EXACT_PERMISSION_DUPLICATE: { title: 'Permiso duplicado exactamente', text: '{perm} repite la misma lista y la copia anterior puede eliminarse.' },
    RA_CONFLICTING_PERMISSION_DUPLICATE: { title: 'Permiso duplicado con listas diferentes', text: '{perm} aparece varias veces con asignaciones diferentes. Debes elegir o combinar las listas.' },
    RA_OVERRIDE_ROLE_MISSING: { title: 'Contraseña apunta a una ID inexistente', text: 'override_password_role referencia {role}, que no está declarada.' },
    RA_DUPLICATE_OVERRIDE_ROLE: { title: 'ID repetida en override_password_role', text: 'La lista de roles de contraseña contiene duplicados exactos que pueden eliminarse.' },
    RA_DUPLICATE_GLOBAL_SETTING: { title: 'Configuración global duplicada', text: '{key} aparece {count} veces. El último valor es efectivo; revisa cuál debe conservarse.' },
    RA_INVALID_GLOBAL_BOOLEAN: { title: 'Valor global booleano inválido', textCase: '{key} utiliza mayúsculas; puede normalizarse a {value}.', textInvalid: '{key} debe ser true o false; se encontró “{value}”.' },
    RA_ID_UNDECLARED_UNUSED: { title: 'ID disponible no declarada', text: '{role} no está declarada ni utilizada. Puede utilizarse durante Reorganizar IDs.' },
    RA_ID_RESERVED: { title: 'ID reservada', text: '{role} está reservada explícitamente y no será utilizada durante la reorganización.' },
    RA_INTERNAL_ID_GAPS: { title: 'Saltos en la numeración interna', text: '{prefix} omite {list}{more}. Puedes usar “Reorganizar IDs” con previsualización.' },
    RA_TRAILING_WHITESPACE: { title: 'Espacios al final de línea', text: 'Los espacios finales no aportan información y pueden eliminarse.' },
    RA_EXCESS_BLANK_LINE: { title: 'Línea vacía redundante', text: 'Se conservará una sola línea vacía entre bloques.' },
    secProps: 'Propiedades',
    secGlobal: 'Configuración global',
    secFormat: 'Formato'
};

STRINGS.en.diag.msg = {
    emptyValue: '(empty)',
    RA_MEMBERS_SECTION_MISSING: { title: 'Missing {label}', text: 'Required section {label} was not found; relations cannot be validated safely.' },
    RA_ROLES_SECTION_MISSING: { title: 'Missing {label}', text: 'Required section {label} was not found; relations cannot be validated safely.' },
    RA_PERMISSIONS_SECTION_MISSING: { title: 'Missing {label}', text: 'Required section {label} was not found; relations cannot be validated safely.' },
    RA_DUPLICATE_SECTION: { title: 'Duplicated managed section', text: 'Section {section} appears more than once. You must choose which content to keep.' },
    RA_GROUP_NAME_MISSING: { title: 'Unnamed group', text: '{section} contains a “-” entry with no internal ID.' },
    RA_MEMBER_SYNTAX_INVALID: { title: 'Invalid syntax in {section}', text: 'The line looks like a managed entry, but the parser cannot interpret it safely.' },
    RA_ROLE_SYNTAX_INVALID: { title: 'Invalid syntax in {section}', text: 'The line looks like a managed entry, but the parser cannot interpret it safely.' },
    RA_PERMISSION_SYNTAX_INVALID: { title: 'Invalid syntax in {section}', text: 'The line looks like a managed entry, but the parser cannot interpret it safely.' },
    RA_INVALID_STEAMID: { title: 'Invalid user identifier', text: '“{id}” does not meet the format supported by RemoteAdmin.' },
    RA_INVALID_USER_ID: { title: 'Invalid user identifier', text: '“{id}” does not meet the format supported by RemoteAdmin.' },
    RA_MEMBER_ROLE_MISSING: { title: 'Member points to a nonexistent ID', text: '{id} references {role}, but that ID is not declared in {section}.' },
    RA_DUPLICATE_STEAM_PROVIDER: { title: 'Duplicated @steam provider', text: 'The @steam suffix is duplicated and can be normalized without changing the identity.' },
    RA_STEAM_PROVIDER_MISSING: { title: 'Missing @steam provider', text: 'The line contains a valid SteamID64, but the required @steam suffix is missing.' },
    RA_EXACT_MEMBER_DUPLICATE: { title: 'Exactly duplicated member', text: 'Record {id} is identical to a previous one and can be safely removed.' },
    RA_DUPLICATE_STEAMID: { title: 'Identifier linked to different users', text: '{id} is linked to {roles}. Explicitly choose which one to keep.', keep: 'Keep {role} (line {line})' },
    RA_DUPLICATE_USER_ID: { title: 'Identifier linked to different users', text: '{id} is linked to {roles}. Explicitly choose which one to keep.', keep: 'Keep {role} (line {line})' },
    RA_DUPLICATE_INTERNAL_ID: { title: 'Internal ID shared by several users', text: '{role} belongs to {count} users. No association can be chosen automatically.' },
    RA_SHARED_ROLE: { title: 'Shared group', text: '{role} is an unnumbered group shared by {count} users; it will be kept as is.' },
    RA_DUPLICATE_ROLE_DECLARATION: { title: 'Internal ID declared several times', text: '{role} appears {count} times in {section}.' },
    RA_INVALID_INTERNAL_ID_NUMBER: { title: 'Invalid internal ID number', text: '{role} must use a numeric suffix greater than or equal to 1.' },
    RA_ID_DECLARED_UNUSED: { title: 'Declared but unused ID', text: '{role} is declared but currently unused. This ID can be reused during Renumber IDs.' },
    RA_ORPHAN_ROLE: { title: 'Role without user', text: '{role} is declared and may be valid, but has no user in Members.' },
    RA_REQUIRED_PROPERTIES_MISSING: { title: 'Missing required properties', text: '{role} does not contain: {list}.' },
    RA_ORPHAN_PROPERTY_BLOCK: { title: 'Property block without declared role', text: 'There are properties for {role}, but that ID is not declared. They will be kept until you decide what to do.' },
    RA_EXACT_PROPERTY_DUPLICATE: { title: 'Exactly duplicated property', text: '{name} repeats the same value and the earlier copy can be removed.' },
    RA_CONFLICTING_PROPERTY_DUPLICATE: { title: 'Property duplicated with different values', text: '{name} contains {values}. The last value is effective, but you must choose which to keep.', keep: 'Keep “{value}” (line {line})' },
    RA_INVALID_COLOR: { title: 'Unsupported badge color', text: '“{value}” does not exist. The closest match is “{suggestion}”.', textNoSuggestion: '“{value}” does not exist in the accepted color list.' },
    RA_COLOR_CASE_NORMALIZATION: { title: 'Uppercase color', text: 'The color “{value}” is valid, but RemoteAdmin consistently uses “{lower}”.' },
    RA_EMPTY_BADGE: { title: 'Empty badge', text: '{role} will not display badge text.' },
    RA_INVALID_BOOLEAN: { title: 'Invalid boolean value', text: '{name} must be true, false or default; found “{value}”.' },
    RA_INVALID_KICK_POWER: { title: 'Invalid kick power', text: '{name} must be default or an integer between 0 and 255; found “{value}”.' },
    RA_UNKNOWN_PROPERTY: { title: 'Unknown property kept', text: '{name} is not managed by the page and will not be removed or modified.' },
    RA_PROPERTY_COLON_MISSING: { title: 'Missing “:” in a property', text: 'The line has a known key and an unambiguous value, but the separator is missing.' },
    RA_PERMISSION_ROLE_MISSING: { title: 'Permission points to a nonexistent ID', text: '{perm} references {role}, which is not declared.' },
    RA_DUPLICATE_PERMISSION_ROLE: { title: 'Repeated ID in a permission', text: '{perm} repeats one or more IDs; the copies can be removed without changing the permission.' },
    RA_EMPTY_PERMISSION: { title: 'Permission without assigned IDs', text: '{perm} has an empty list. This may be intentional.' },
    RA_UNKNOWN_PERMISSION: { title: 'Unknown permission kept', text: '{perm} is not in the current page catalog and will be kept literally.' },
    RA_EXACT_PERMISSION_DUPLICATE: { title: 'Exactly duplicated permission', text: '{perm} repeats the same list and the earlier copy can be removed.' },
    RA_CONFLICTING_PERMISSION_DUPLICATE: { title: 'Permission duplicated with different lists', text: '{perm} appears several times with different assignments. You must choose or combine the lists.' },
    RA_OVERRIDE_ROLE_MISSING: { title: 'Password points to a nonexistent ID', text: 'override_password_role references {role}, which is not declared.' },
    RA_DUPLICATE_OVERRIDE_ROLE: { title: 'Repeated ID in override_password_role', text: 'The password role list contains exact duplicates that can be removed.' },
    RA_DUPLICATE_GLOBAL_SETTING: { title: 'Duplicated global setting', text: '{key} appears {count} times. The last value is effective; review which one to keep.' },
    RA_INVALID_GLOBAL_BOOLEAN: { title: 'Invalid global boolean value', textCase: '{key} uses uppercase; it can be normalized to {value}.', textInvalid: '{key} must be true or false; found “{value}”.' },
    RA_ID_UNDECLARED_UNUSED: { title: 'Available undeclared ID', text: '{role} is neither declared nor used. It can be used during Renumber IDs.' },
    RA_ID_RESERVED: { title: 'Reserved ID', text: '{role} is explicitly reserved and will not be used during reorganization.' },
    RA_INTERNAL_ID_GAPS: { title: 'Gaps in internal numbering', text: '{prefix} skips {list}{more}. You can use “Renumber IDs” with preview.' },
    RA_TRAILING_WHITESPACE: { title: 'Trailing whitespace', text: 'Trailing spaces add no information and can be removed.' },
    RA_EXCESS_BLANK_LINE: { title: 'Redundant blank line', text: 'A single blank line will be kept between blocks.' },
    secProps: 'Properties',
    secGlobal: 'Global configuration',
    secFormat: 'Format'
};

function runRemoteAdminDiagnostics(content, state = parsedData, options = {}) {
    const source = String(content ?? '');
    const document = parseRemoteAdminDocument(source, { filename: options.filename });
    const diagnostics = [];
    const issueKeys = new Map();
    const add = input => {
        const key = `${input.code}\u0000${input.line || 0}\u0000${input.roleName || ''}`;
        const occurrence = issueKeys.get(key) || 0;
        issueKeys.set(key, occurrence + 1);
        diagnostics.push(createRemoteAdminDiagnostic(input, occurrence));
    };
    const lineText = line => line > 0 ? document.lines[line - 1] || '' : '';
    const requiredSections = [
        ['members', 'Members', 'RA_MEMBERS_SECTION_MISSING'],
        ['roles', 'Roles o Groups', 'RA_ROLES_SECTION_MISSING'],
        ['permissions', 'Permissions', 'RA_PERMISSIONS_SECTION_MISSING']
    ];
    requiredSections.forEach(([key, label, code]) => {
        if (!document.sections[key]) add({
            code, severity: 'error', title: t(`diag.msg.${code}.title`, { label }),
            explanation: t(`diag.msg.${code}.text`, { label }),
            section: label, affects: ['remoteadmin', 'exiled', 'labapi']
        });
    });
    document.duplicateSections.forEach(section => add({
        code: 'RA_DUPLICATE_SECTION', severity: 'error', title: t('diag.msg.RA_DUPLICATE_SECTION.title'),
        explanation: t('diag.msg.RA_DUPLICATE_SECTION.text', { section: section.name }),
        section: section.name, line: section.headerIndex + 1, excerpt: lineText(section.headerIndex + 1),
        repairKind: 'confirm', affects: ['remoteadmin', 'exiled', 'labapi']
    }));

    const membersById = new Map();
    const membersByRole = new Map();
    const declaredRoles = new Set(document.roleEntries.map(entry => entry.roleName));
    const roleDeclarationCounts = new Map();
    const rolesSection = document.sections.roles;
    if (rolesSection) {
        for (let index = rolesSection.headerIndex + 1; index < rolesSection.endIndex; index++) {
            if (/^\s*-\s*:?[ \t]*$/.test(document.lines[index])) add({
                code: 'RA_GROUP_NAME_MISSING', severity: 'error', title: t('diag.msg.RA_GROUP_NAME_MISSING.title'),
                explanation: t('diag.msg.RA_GROUP_NAME_MISSING.text', { section: document.roleSectionName || 'Roles' }),
                section: document.roleSectionName || 'Roles', line: index + 1,
                excerpt: lineText(index + 1), affects: ['remoteadmin', 'exiled', 'labapi']
            });
        }
    }
    const parsedMemberLines = new Set(document.memberEntries.map(entry => entry.lineIndex));
    const parsedRoleLines = new Set(document.roleEntries.map(entry => entry.lineIndex));
    const parsedPermissionLines = new Set(document.permissionEntries.map(entry => entry.lineIndex));
    [
        [document.sections.members, parsedMemberLines, 'Members', 'RA_MEMBER_SYNTAX_INVALID'],
        [document.sections.roles, parsedRoleLines, document.roleSectionName || 'Roles', 'RA_ROLE_SYNTAX_INVALID'],
        [document.sections.permissions, parsedPermissionLines, 'Permissions', 'RA_PERMISSION_SYNTAX_INVALID']
    ].forEach(([section, parsedLines, sectionName, code]) => {
        if (!section) return;
        for (let index = section.headerIndex + 1; index < section.endIndex; index++) {
            const line = document.lines[index];
            if (!/^\s*-/.test(line) || parsedLines.has(index) || /^\s*-\s*:?[ \t]*$/.test(line)) continue;
            add({
                code, severity: 'error', title: t(`diag.msg.${code}.title`, { section: sectionName }),
                explanation: t(`diag.msg.${code}.text`, { section: sectionName }),
                section: sectionName, line: index + 1, excerpt: line, affects: ['remoteadmin', 'exiled', 'labapi']
            });
        }
    });
    document.roleEntries.forEach(entry => {
        roleDeclarationCounts.set(entry.roleName, (roleDeclarationCounts.get(entry.roleName) || 0) + 1);
    });

    document.memberEntries.forEach(entry => {
        const validated = validateRemoteAdminUserId(entry.id);
        const normalizedId = validated.normalized || entry.id.toLowerCase();
        if (!membersById.has(normalizedId)) membersById.set(normalizedId, []);
        membersById.get(normalizedId).push(entry);
        if (!membersByRole.has(entry.roleName)) membersByRole.set(entry.roleName, []);
        membersByRole.get(entry.roleName).push(entry);
        if (!validated.valid) add({
            code: validated.provider === 'steam' ? 'RA_INVALID_STEAMID' : 'RA_INVALID_USER_ID',
            severity: 'error', title: t(`diag.msg.${validated.provider === 'steam' ? 'RA_INVALID_STEAMID' : 'RA_INVALID_USER_ID'}.title`),
            explanation: t(`diag.msg.${validated.provider === 'steam' ? 'RA_INVALID_STEAMID' : 'RA_INVALID_USER_ID'}.text`, { id: entry.id || t('diag.msg.emptyValue') }),
            section: 'Members', line: entry.lineIndex + 1, roleName: entry.roleName, userId: entry.id,
            excerpt: lineText(entry.lineIndex + 1), affects: ['remoteadmin', 'exiled', 'labapi']
        });
        if (!declaredRoles.has(entry.roleName)) add({
            code: 'RA_MEMBER_ROLE_MISSING', severity: 'error', title: t('diag.msg.RA_MEMBER_ROLE_MISSING.title'),
            explanation: t('diag.msg.RA_MEMBER_ROLE_MISSING.text', { id: entry.id, role: entry.roleName, section: document.roleSectionName || 'Roles' }),
            section: 'Members', line: entry.lineIndex + 1, roleName: entry.roleName, userId: entry.id,
            excerpt: lineText(entry.lineIndex + 1), repairKind: 'confirm', affects: ['remoteadmin', 'exiled', 'labapi']
        });
    });

    const membersSection = document.sections.members;
    if (membersSection) {
        for (let index = membersSection.headerIndex + 1; index < membersSection.endIndex; index++) {
            const line = document.lines[index];
            const repeatedProvider = line.match(/^(\s*-\s*)(\d{17})@steam(?:@steam)+(:\s*[A-Za-z0-9_.-]+\s*)$/i);
            if (repeatedProvider) add({
                code: 'RA_DUPLICATE_STEAM_PROVIDER', severity: 'warning', title: t('diag.msg.RA_DUPLICATE_STEAM_PROVIDER.title'),
                explanation: t('diag.msg.RA_DUPLICATE_STEAM_PROVIDER.text'),
                section: 'Members', line: index + 1, currentValue: line,
                suggestedValue: `${repeatedProvider[1]}${repeatedProvider[2]}@steam${repeatedProvider[3]}`,
                excerpt: line, repairKind: 'safe',
                repairAction: { type: 'replaceLine', lineIndex: index, value: `${repeatedProvider[1]}${repeatedProvider[2]}@steam${repeatedProvider[3]}` },
                affects: ['remoteadmin', 'exiled', 'labapi']
            });
            const missingProvider = line.match(/^(\s*-\s*)(\d{17})(:\s*[A-Za-z0-9_.-]+\s*)$/);
            if (missingProvider && isValidSteamId64(missingProvider[2])) add({
                code: 'RA_STEAM_PROVIDER_MISSING', severity: 'warning', title: t('diag.msg.RA_STEAM_PROVIDER_MISSING.title'),
                explanation: t('diag.msg.RA_STEAM_PROVIDER_MISSING.text'),
                section: 'Members', line: index + 1, currentValue: line,
                suggestedValue: `${missingProvider[1]}${missingProvider[2]}@steam${missingProvider[3]}`,
                excerpt: line, repairKind: 'safe',
                repairAction: { type: 'replaceLine', lineIndex: index, value: `${missingProvider[1]}${missingProvider[2]}@steam${missingProvider[3]}` },
                affects: ['remoteadmin', 'exiled', 'labapi']
            });
        }
    }

    membersById.forEach((entries, normalizedId) => {
        if (entries.length < 2) return;
        const signatures = new Set(entries.map(entry => `${entry.id.toLowerCase()}|${entry.roleName}|${entry.rawComment}`));
        if (signatures.size === 1) {
            entries.slice(1).forEach(entry => add({
                code: 'RA_EXACT_MEMBER_DUPLICATE', severity: 'warning', title: t('diag.msg.RA_EXACT_MEMBER_DUPLICATE.title'),
                explanation: t('diag.msg.RA_EXACT_MEMBER_DUPLICATE.text', { id: normalizedId }),
                section: 'Members', line: entry.lineIndex + 1, roleName: entry.roleName, userId: entry.id,
                excerpt: lineText(entry.lineIndex + 1), repairKind: 'safe',
                repairAction: { type: 'removeLines', lineIndexes: [...entry.commentIndexes, entry.lineIndex] },
                affects: ['remoteadmin', 'exiled', 'labapi']
            }));
        } else add({
            code: validateRemoteAdminUserId(entries[0].id).provider === 'steam'
                ? 'RA_DUPLICATE_STEAMID' : 'RA_DUPLICATE_USER_ID',
            severity: 'error',
            title: t(`diag.msg.${validateRemoteAdminUserId(entries[0].id).provider === 'steam' ? 'RA_DUPLICATE_STEAMID' : 'RA_DUPLICATE_USER_ID'}.title`),
            explanation: t(`diag.msg.${validateRemoteAdminUserId(entries[0].id).provider === 'steam' ? 'RA_DUPLICATE_STEAMID' : 'RA_DUPLICATE_USER_ID'}.text`, { id: normalizedId, roles: entries.map(entry => entry.roleName).join(', ') }),
            section: 'Members', line: entries[0].lineIndex + 1, userId: entries[0].id,
            excerpt: entries.map(entry => lineText(entry.lineIndex + 1)).join('\n'), repairKind: 'confirm',
            options: entries.map(entry => ({ value: String(entry.lineIndex), label: t(`diag.msg.${validateRemoteAdminUserId(entries[0].id).provider === 'steam' ? 'RA_DUPLICATE_STEAMID' : 'RA_DUPLICATE_USER_ID'}.keep`, { role: entry.roleName, line: entry.lineIndex + 1 }) })),
            affects: ['remoteadmin', 'exiled', 'labapi']
        });
    });
    membersByRole.forEach((entries, roleName) => {
        if (entries.length < 2) return;
        const numberedRole = splitRemoteAdminRoleIdentifier(roleName).numbered;
        add({
            code: numberedRole ? 'RA_DUPLICATE_INTERNAL_ID' : 'RA_SHARED_ROLE',
            severity: numberedRole ? 'error' : 'info',
            title: numberedRole ? t('diag.msg.RA_DUPLICATE_INTERNAL_ID.title') : t('diag.msg.RA_SHARED_ROLE.title'),
            explanation: numberedRole
                ? t('diag.msg.RA_DUPLICATE_INTERNAL_ID.text', { role: roleName, count: entries.length })
                : t('diag.msg.RA_SHARED_ROLE.text', { role: roleName, count: entries.length }),
            section: 'Members', line: entries[0].lineIndex + 1, roleName,
            excerpt: entries.map(entry => lineText(entry.lineIndex + 1)).join('\n'),
            repairKind: numberedRole ? 'confirm' : 'manual',
            affects: ['remoteadmin', 'exiled', 'labapi']
        });
    });

    roleDeclarationCounts.forEach((count, roleName) => {
        const entries = document.roleEntries.filter(entry => entry.roleName === roleName);
        if (count > 1) add({
            code: 'RA_DUPLICATE_ROLE_DECLARATION', severity: 'error', title: t('diag.msg.RA_DUPLICATE_ROLE_DECLARATION.title'),
            explanation: t('diag.msg.RA_DUPLICATE_ROLE_DECLARATION.text', { role: roleName, count, section: document.roleSectionName || 'Roles' }),
            section: document.roleSectionName || 'Roles', line: entries[0].lineIndex + 1, roleName,
            excerpt: entries.map(entry => lineText(entry.lineIndex + 1)).join('\n'), repairKind: 'confirm',
            affects: ['remoteadmin', 'exiled', 'labapi']
        });
        const split = splitRemoteAdminRoleIdentifier(roleName);
        if (split.numbered && split.number < 1) add({
            code: 'RA_INVALID_INTERNAL_ID_NUMBER', severity: 'error', title: t('diag.msg.RA_INVALID_INTERNAL_ID_NUMBER.title'),
            explanation: t('diag.msg.RA_INVALID_INTERNAL_ID_NUMBER.text', { role: roleName }),
            section: document.roleSectionName || 'Roles', line: entries[0].lineIndex + 1, roleName,
            excerpt: lineText(entries[0].lineIndex + 1), affects: ['remoteadmin', 'exiled', 'labapi']
        });
        if (!membersByRole.has(roleName)) {
            add({
                code: 'RA_ID_DECLARED_UNUSED', severity: 'info', title: t('diag.msg.RA_ID_DECLARED_UNUSED.title'),
                explanation: t('diag.msg.RA_ID_DECLARED_UNUSED.text', { role: roleName }),
                section: document.roleSectionName || 'Roles', line: entries[0].lineIndex + 1, roleName,
                excerpt: lineText(entries[0].lineIndex + 1), repairKind: 'confirm', repairAction: { type: 'openRenumber' }, affects: ['remoteadmin', 'exiled', 'labapi']
            });
            add({
                code: 'RA_ORPHAN_ROLE', severity: 'warning', title: t('diag.msg.RA_ORPHAN_ROLE.title'),
                explanation: t('diag.msg.RA_ORPHAN_ROLE.text', { role: roleName }),
                section: document.roleSectionName || 'Roles', line: entries[0].lineIndex + 1, roleName,
                excerpt: lineText(entries[0].lineIndex + 1), repairKind: 'confirm', affects: ['remoteadmin', 'exiled', 'labapi']
            });
        }
    });

    const acceptedColors = getAcceptedBadgeColors();
    const requiredProperties = ['badge', 'color', 'cover', 'hidden', 'kick_power', 'required_kick_power'];
    declaredRoles.forEach(roleName => {
        const properties = document.rolePropertyNodes.get(roleName);
        const missing = requiredProperties.filter(property => !properties?.has(property));
        if (missing.length) add({
            code: 'RA_REQUIRED_PROPERTIES_MISSING', severity: 'error', title: t('diag.msg.RA_REQUIRED_PROPERTIES_MISSING.title'),
            explanation: t('diag.msg.RA_REQUIRED_PROPERTIES_MISSING.text', { role: roleName, list: missing.join(', ') }),
            section: 'Propiedades', roleName, affects: ['remoteadmin']
        });
    });
    document.rolePropertyNodes.forEach((properties, roleName) => {
        if (!declaredRoles.has(roleName)) add({
            code: 'RA_ORPHAN_PROPERTY_BLOCK', severity: 'warning', title: t('diag.msg.RA_ORPHAN_PROPERTY_BLOCK.title'),
            explanation: t('diag.msg.RA_ORPHAN_PROPERTY_BLOCK.text', { role: roleName }),
            section: 'Propiedades', line: [...properties.values()][0]?.[0]?.lineIndex + 1 || 0,
            roleName, repairKind: 'confirm', affects: ['remoteadmin']
        });
        properties.forEach((nodes, property) => {
            if (nodes.length > 1) {
                const values = new Set(nodes.map(node => node.rawValue.trim()));
                if (values.size === 1) nodes.slice(0, -1).forEach(node => add({
                    code: 'RA_EXACT_PROPERTY_DUPLICATE', severity: 'warning', title: t('diag.msg.RA_EXACT_PROPERTY_DUPLICATE.title'),
                    explanation: t('diag.msg.RA_EXACT_PROPERTY_DUPLICATE.text', { name: `${roleName}_${property}` }),
                    section: 'Propiedades', line: node.lineIndex + 1, roleName, currentValue: node.rawValue.trim(),
                    excerpt: lineText(node.lineIndex + 1), repairKind: 'safe',
                    repairAction: { type: 'removeLines', lineIndexes: [node.lineIndex] }, affects: ['remoteadmin']
                }));
                else add({
                    code: 'RA_CONFLICTING_PROPERTY_DUPLICATE', severity: 'warning', title: t('diag.msg.RA_CONFLICTING_PROPERTY_DUPLICATE.title'),
                    explanation: t('diag.msg.RA_CONFLICTING_PROPERTY_DUPLICATE.text', { name: `${roleName}_${property}`, values: [...values].join(' / ') }),
                    section: 'Propiedades', line: nodes[0].lineIndex + 1, roleName,
                    excerpt: nodes.map(node => lineText(node.lineIndex + 1)).join('\n'), repairKind: 'confirm',
                    options: nodes.map(node => ({ value: String(node.lineIndex), label: t('diag.msg.RA_CONFLICTING_PROPERTY_DUPLICATE.keep', { value: node.rawValue.trim(), line: node.lineIndex + 1 }) })),
                    affects: ['remoteadmin']
                });
            }
            const effectiveNode = nodes.at(-1);
            const rawValue = effectiveNode?.rawValue.trim() || '';
            if (property === 'color' && !acceptedColors.has(rawValue.toLowerCase())) {
                const suggestion = findRemoteAdminColorSuggestion(rawValue, acceptedColors);
                add({
                    code: 'RA_INVALID_COLOR', severity: 'error', title: t('diag.msg.RA_INVALID_COLOR.title'),
                    explanation: suggestion
                        ? t('diag.msg.RA_INVALID_COLOR.text', { value: rawValue, suggestion: suggestion.value })
                        : t('diag.msg.RA_INVALID_COLOR.textNoSuggestion', { value: rawValue }),
                    section: 'Propiedades', line: effectiveNode.lineIndex + 1, roleName,
                    currentValue: rawValue, suggestedValue: suggestion?.value || '',
                    excerpt: lineText(effectiveNode.lineIndex + 1),
                    repairKind: suggestion ? (suggestion.exactCaseOnly ? 'safe' : 'confirm') : 'manual',
                    repairAction: suggestion ? {
                        type: 'replaceLine', lineIndex: effectiveNode.lineIndex,
                        value: `${roleName}_color:${effectiveNode.separator}${suggestion.value}`
                    } : null,
                    affects: ['remoteadmin']
                });
            } else if (property === 'color' && rawValue !== rawValue.toLowerCase()) {
                add({
                    code: 'RA_COLOR_CASE_NORMALIZATION', severity: 'warning', title: t('diag.msg.RA_COLOR_CASE_NORMALIZATION.title'),
                    explanation: t('diag.msg.RA_COLOR_CASE_NORMALIZATION.text', { value: rawValue, lower: rawValue.toLowerCase() }),
                    section: 'Propiedades', line: effectiveNode.lineIndex + 1, roleName,
                    currentValue: rawValue, suggestedValue: rawValue.toLowerCase(),
                    excerpt: lineText(effectiveNode.lineIndex + 1), repairKind: 'safe',
                    repairAction: {
                        type: 'replaceLine', lineIndex: effectiveNode.lineIndex,
                        value: `${roleName}_color:${effectiveNode.separator}${rawValue.toLowerCase()}`
                    },
                    affects: ['remoteadmin']
                });
            }
            if (property === 'badge' && !rawValue) add({
                code: 'RA_EMPTY_BADGE', severity: 'warning', title: t('diag.msg.RA_EMPTY_BADGE.title'),
                explanation: t('diag.msg.RA_EMPTY_BADGE.text', { role: roleName }), section: 'Propiedades',
                line: effectiveNode.lineIndex + 1, roleName, excerpt: lineText(effectiveNode.lineIndex + 1),
                affects: ['remoteadmin']
            });
            if (['cover', 'hidden'].includes(property) && !/^(?:true|false|default)$/i.test(rawValue)) add({
                code: 'RA_INVALID_BOOLEAN', severity: 'error', title: t('diag.msg.RA_INVALID_BOOLEAN.title'),
                explanation: t('diag.msg.RA_INVALID_BOOLEAN.text', { name: `${roleName}_${property}`, value: rawValue }),
                section: 'Propiedades', line: effectiveNode.lineIndex + 1, roleName,
                excerpt: lineText(effectiveNode.lineIndex + 1), affects: ['remoteadmin']
            });
            if (['kick_power', 'required_kick_power'].includes(property)
                && !(/^(?:default)$/i.test(rawValue) || /^\d+$/.test(rawValue) && Number(rawValue) <= 255)) add({
                code: 'RA_INVALID_KICK_POWER', severity: 'error', title: t('diag.msg.RA_INVALID_KICK_POWER.title'),
                explanation: t('diag.msg.RA_INVALID_KICK_POWER.text', { name: `${roleName}_${property}`, value: rawValue }),
                section: 'Propiedades', line: effectiveNode.lineIndex + 1, roleName,
                excerpt: lineText(effectiveNode.lineIndex + 1), affects: ['remoteadmin']
            });
        });
    });

    document.lines.forEach((line, index) => {
        const unknownProperty = matchDeclaredRemoteAdminRoleProperty(line, declaredRoles);
        if (unknownProperty && !MEMBER_PROPERTY_NAMES.has(unknownProperty.property)) add({
            code: 'RA_UNKNOWN_PROPERTY', severity: 'warning', title: t('diag.msg.RA_UNKNOWN_PROPERTY.title'),
            explanation: t('diag.msg.RA_UNKNOWN_PROPERTY.text', { name: `${unknownProperty.roleName}_${unknownProperty.property}` }),
            section: t('diag.secProps'), line: index + 1, roleName: unknownProperty.roleName, excerpt: line, affects: ['remoteadmin']
        });
        const missingColon = line.match(/^([A-Za-z0-9_.-]+)_(badge|color|cover|hidden|kick_power|required_kick_power)(\s+)(.+)$/);
        if (missingColon && declaredRoles.has(missingColon[1])) {
            const replacement = `${missingColon[1]}_${missingColon[2]}: ${missingColon[4].trim()}`;
            add({
                code: 'RA_PROPERTY_COLON_MISSING', severity: 'error', title: t('diag.msg.RA_PROPERTY_COLON_MISSING.title'),
                explanation: t('diag.msg.RA_PROPERTY_COLON_MISSING.text'),
                section: t('diag.secProps'), line: index + 1, roleName: missingColon[1], currentValue: line,
                suggestedValue: replacement, excerpt: line, repairKind: 'safe',
                repairAction: { type: 'replaceLine', lineIndex: index, value: replacement }, affects: ['remoteadmin']
            });
        }
    });

    const permissionCounts = new Map();
    document.permissionEntries.forEach(entry => {
        if (!permissionCounts.has(entry.permission)) permissionCounts.set(entry.permission, []);
        permissionCounts.get(entry.permission).push(entry);
        const seen = new Set();
        const deduped = [];
        entry.roles.forEach(roleName => {
            if (!seen.has(roleName)) deduped.push(roleName);
            seen.add(roleName);
            if (!declaredRoles.has(roleName)) add({
                code: 'RA_PERMISSION_ROLE_MISSING', severity: 'error', title: t('diag.msg.RA_PERMISSION_ROLE_MISSING.title'),
                explanation: t('diag.msg.RA_PERMISSION_ROLE_MISSING.text', { perm: entry.permission, role: roleName }),
                section: 'Permissions', line: entry.lineIndex + 1, roleName,
                excerpt: lineText(entry.lineIndex + 1), repairKind: 'confirm', affects: ['remoteadmin', 'exiled', 'labapi']
            });
        });
        if (deduped.length !== entry.roles.length) add({
            code: 'RA_DUPLICATE_PERMISSION_ROLE', severity: 'warning', title: t('diag.msg.RA_DUPLICATE_PERMISSION_ROLE.title'),
            explanation: t('diag.msg.RA_DUPLICATE_PERMISSION_ROLE.text', { perm: entry.permission }),
            section: 'Permissions', line: entry.lineIndex + 1, excerpt: lineText(entry.lineIndex + 1), repairKind: 'safe',
            repairAction: {
                type: 'replaceLine', lineIndex: entry.lineIndex,
                value: `${entry.indent}- ${entry.permission}:${entry.separator || ' '}[${deduped.join(', ')}]${entry.trailingWhitespace}`
            }, affects: ['remoteadmin', 'exiled', 'labapi']
        });
        if (entry.roles.length === 0) add({
            code: 'RA_EMPTY_PERMISSION', severity: 'warning', title: t('diag.msg.RA_EMPTY_PERMISSION.title'),
            explanation: t('diag.msg.RA_EMPTY_PERMISSION.text', { perm: entry.permission }),
            section: 'Permissions', line: entry.lineIndex + 1, excerpt: lineText(entry.lineIndex + 1), affects: ['remoteadmin', 'exiled', 'labapi']
        });
        if (!DEFAULT_PERMISSION_LIST.includes(entry.permission)) add({
            code: 'RA_UNKNOWN_PERMISSION', severity: 'warning', title: t('diag.msg.RA_UNKNOWN_PERMISSION.title'),
            explanation: t('diag.msg.RA_UNKNOWN_PERMISSION.text', { perm: entry.permission }),
            section: 'Permissions', line: entry.lineIndex + 1, excerpt: lineText(entry.lineIndex + 1), affects: ['remoteadmin']
        });
    });
    permissionCounts.forEach((entries, permission) => {
        if (entries.length < 2) return;
        const signatures = new Set(entries.map(entry => entry.roles.join(',')));
        if (signatures.size === 1) entries.slice(0, -1).forEach(entry => add({
            code: 'RA_EXACT_PERMISSION_DUPLICATE', severity: 'warning', title: t('diag.msg.RA_EXACT_PERMISSION_DUPLICATE.title'),
            explanation: t('diag.msg.RA_EXACT_PERMISSION_DUPLICATE.text', { perm: permission }),
            section: 'Permissions', line: entry.lineIndex + 1, excerpt: lineText(entry.lineIndex + 1),
            repairKind: 'safe', repairAction: { type: 'removeLines', lineIndexes: [...entry.commentIndexes, entry.lineIndex] },
            affects: ['remoteadmin', 'exiled', 'labapi']
        }));
        else add({
            code: 'RA_CONFLICTING_PERMISSION_DUPLICATE', severity: 'warning', title: t('diag.msg.RA_CONFLICTING_PERMISSION_DUPLICATE.title'),
            explanation: t('diag.msg.RA_CONFLICTING_PERMISSION_DUPLICATE.text', { perm: permission }),
            section: 'Permissions', line: entries[0].lineIndex + 1,
            excerpt: entries.map(entry => lineText(entry.lineIndex + 1)).join('\n'), repairKind: 'confirm',
            affects: ['remoteadmin', 'exiled', 'labapi']
        });
    });

    document.lines.forEach((line, index) => {
        const override = line.match(/^(override_password_role:)(\s*)(.*)$/);
        if (!override) return;
        const roles = override[3].split(',').map(role => role.trim()).filter(Boolean);
        const uniqueRoles = [...new Set(roles)];
        roles.forEach(roleName => {
            if (!declaredRoles.has(roleName)) add({
                code: 'RA_OVERRIDE_ROLE_MISSING', severity: 'error', title: t('diag.msg.RA_OVERRIDE_ROLE_MISSING.title'),
                explanation: t('diag.msg.RA_OVERRIDE_ROLE_MISSING.text', { role: roleName }),
                section: t('diag.secGlobal'), line: index + 1, roleName,
                excerpt: line, repairKind: 'confirm', affects: ['remoteadmin']
            });
        });
        if (uniqueRoles.length !== roles.length) add({
            code: 'RA_DUPLICATE_OVERRIDE_ROLE', severity: 'warning', title: t('diag.msg.RA_DUPLICATE_OVERRIDE_ROLE.title'),
            explanation: t('diag.msg.RA_DUPLICATE_OVERRIDE_ROLE.text'),
            section: t('diag.secGlobal'), line: index + 1, excerpt: line, repairKind: 'safe',
            repairAction: { type: 'replaceLine', lineIndex: index, value: `${override[1]}${override[2]}${uniqueRoles.join(', ')}` },
            affects: ['remoteadmin']
        });
    });

    const booleanSettingKeys = [
        'enable_staff_access', 'enable_manager_access', 'enable_banteam_access',
        'enable_banteam_reserved_slots', 'enable_banteam_bypass_geoblocking',
        'allow_central_server_commands_as_ServerConsoleCommands', 'enable_predefined_ban_templates'
    ];
    booleanSettingKeys.forEach(key => {
        const entries = [];
        document.lines.forEach((line, index) => {
            const match = line.match(new RegExp(`^${key}:(\\s*)(.*)$`));
            if (match) entries.push({ lineIndex: index, separator: match[1], value: match[2].trim() });
        });
        if (entries.length > 1) add({
            code: 'RA_DUPLICATE_GLOBAL_SETTING', severity: 'warning', title: t('diag.msg.RA_DUPLICATE_GLOBAL_SETTING.title'),
            explanation: t('diag.msg.RA_DUPLICATE_GLOBAL_SETTING.text', { key, count: entries.length }),
            section: t('diag.secGlobal'), line: entries[0].lineIndex + 1,
            excerpt: entries.map(entry => lineText(entry.lineIndex + 1)).join('\n'), repairKind: 'confirm', affects: ['remoteadmin']
        });
        entries.forEach(entry => {
            if (/^(?:true|false)$/.test(entry.value)) return;
            const lower = entry.value.toLowerCase();
            const caseOnly = /^(?:true|false)$/.test(lower);
            add({
                code: 'RA_INVALID_GLOBAL_BOOLEAN', severity: caseOnly ? 'warning' : 'error',
                title: t('diag.msg.RA_INVALID_GLOBAL_BOOLEAN.title'),
                explanation: caseOnly
                    ? t('diag.msg.RA_INVALID_GLOBAL_BOOLEAN.textCase', { key, value: lower })
                    : t('diag.msg.RA_INVALID_GLOBAL_BOOLEAN.textInvalid', { key, value: entry.value }),
                section: t('diag.secGlobal'), line: entry.lineIndex + 1,
                currentValue: entry.value, suggestedValue: caseOnly ? lower : '',
                excerpt: lineText(entry.lineIndex + 1), repairKind: caseOnly ? 'safe' : 'manual',
                repairAction: caseOnly ? {
                    type: 'replaceLine', lineIndex: entry.lineIndex,
                    value: `${key}:${entry.separator}${lower}`
                } : null,
                affects: ['remoteadmin']
            });
        });
    });

    const idClassification = classifyRemoteAdminRoleIds(document);
    idClassification.roles.forEach(item => {
        if (item.state === 'UNDECLARED_UNUSED') {
            add({
                code: 'RA_ID_UNDECLARED_UNUSED', severity: 'info', title: t('diag.msg.RA_ID_UNDECLARED_UNUSED.title'),
                explanation: t('diag.msg.RA_ID_UNDECLARED_UNUSED.text', { role: item.roleName }),
                section: document.roleSectionName || 'Roles', roleName: item.roleName,
                repairKind: 'confirm', repairAction: { type: 'openRenumber' }, affects: ['remoteadmin', 'exiled', 'labapi']
            });
        } else if (item.state === 'RESERVED') {
            add({
                code: 'RA_ID_RESERVED', severity: 'info', title: t('diag.msg.RA_ID_RESERVED.title'),
                explanation: t('diag.msg.RA_ID_RESERVED.text', { role: item.roleName }),
                section: document.roleSectionName || 'Roles', roleName: item.roleName,
                repairKind: 'manual', affects: ['remoteadmin', 'exiled', 'labapi']
            });
        }
    });

    const roleNumbersByPrefix = new Map();
    declaredRoles.forEach(roleName => {
        const split = splitRemoteAdminRoleIdentifier(roleName);
        if (!split.numbered || !split.prefix) return;
        if (!roleNumbersByPrefix.has(split.prefix)) roleNumbersByPrefix.set(split.prefix, []);
        roleNumbersByPrefix.get(split.prefix).push(split.number);
    });
    roleNumbersByPrefix.forEach((numbers, prefix) => {
        const sorted = [...new Set(numbers)].sort((left, right) => left - right);
        const missing = [];
        for (let number = 1; number < (sorted.at(-1) || 0); number++) {
            if (!sorted.includes(number)) missing.push(number);
        }
        if (missing.length) add({
            code: 'RA_INTERNAL_ID_GAPS', severity: 'info', title: t('diag.msg.RA_INTERNAL_ID_GAPS.title'),
            explanation: t('diag.msg.RA_INTERNAL_ID_GAPS.text', { prefix, list: missing.slice(0, 12).join(', '), more: missing.length > 12 ? '…' : '' }),
            section: document.roleSectionName || 'Roles', roleName: prefix,
            repairKind: 'confirm', repairAction: { type: 'openRenumber' }, affects: ['remoteadmin', 'exiled', 'labapi']
        });
    });

    document.lines.forEach((line, index) => {
        if (/[ \t]+$/.test(line)) add({
            code: 'RA_TRAILING_WHITESPACE', severity: 'info', title: t('diag.msg.RA_TRAILING_WHITESPACE.title'),
            explanation: t('diag.msg.RA_TRAILING_WHITESPACE.text'),
            section: t('diag.secFormat'), line: index + 1, excerpt: line, repairKind: 'safe',
            repairAction: { type: 'replaceLine', lineIndex: index, value: line.replace(/[ \t]+$/g, '') }, affects: ['remoteadmin']
        });
        if (index > 0 && line === '' && document.lines[index - 1] === '') add({
            code: 'RA_EXCESS_BLANK_LINE', severity: 'info', title: t('diag.msg.RA_EXCESS_BLANK_LINE.title'),
            explanation: t('diag.msg.RA_EXCESS_BLANK_LINE.text'),
            section: t('diag.secFormat'), line: index + 1, repairKind: 'safe',
            repairAction: { type: 'removeLines', lineIndexes: [index] }, affects: ['remoteadmin']
        });
    });

    const counts = { error: 0, warning: 0, info: 0, safe: 0, confirm: 0, manual: 0 };
    diagnostics.forEach(issue => {
        issue.ignored = ignoredRemoteAdminDiagnosticIds.has(issue.id);
        counts[issue.severity] += 1;
        counts[issue.repairKind] = (counts[issue.repairKind] || 0) + 1;
    });
    return {
        content: source,
        document,
        diagnostics,
        counts,
        stats: getRemoteAdminDiagnosticStats(document),
        valid: counts.error === 0,
        blocking: diagnostics.filter(issue => issue.severity === 'error'),
        repairable: diagnostics.filter(issue => issue.repairKind === 'safe' && issue.repairAction)
    };
}

function applyRemoteAdminRepairs(content, diagnosticResult, selectedIds = null, options = {}) {
    const source = String(content ?? '');
    const analysis = diagnosticResult?.content === source
        ? diagnosticResult
        : runRemoteAdminDiagnostics(source, options.state || parsedData);
    const selectedSet = selectedIds ? new Set(selectedIds) : null;
    const selected = analysis.diagnostics.filter(issue =>
        issue.repairKind === 'safe'
        && issue.repairAction
        && (!selectedSet || selectedSet.has(issue.id))
    );
    if (!selected.length) return {
        original: source, content: source, changed: false, applied: [], skipped: [],
        diagnostics: analysis, rolledBack: false
    };
    const document = parseRemoteAdminDocument(source);
    const lineChanges = new Map();
    const removedLines = new Set();
    const applied = [];
    const skipped = [];
    selected.forEach(issue => {
        const action = issue.repairAction;
        if (action.type === 'replaceLine') {
            if (removedLines.has(action.lineIndex)) {
                skipped.push(issue);
                return;
            }
            if (lineChanges.has(action.lineIndex) && lineChanges.get(action.lineIndex) !== action.value) {
                if (issue.code === 'RA_TRAILING_WHITESPACE') {
                    lineChanges.set(action.lineIndex, lineChanges.get(action.lineIndex).replace(/[ \t]+$/g, ''));
                    applied.push(issue);
                    return;
                }
                skipped.push(issue);
                return;
            }
            lineChanges.set(action.lineIndex, action.value);
            applied.push(issue);
            return;
        }
        if (action.type === 'removeLines') {
            action.lineIndexes.forEach(index => removedLines.add(index));
            applied.push(issue);
            return;
        }
        skipped.push(issue);
    });
    const outputLines = document.lines.filter((_, index) => !removedLines.has(index));
    let removedBefore = 0;
    document.lines.forEach((_, index) => {
        if (removedLines.has(index)) {
            removedBefore += 1;
            return;
        }
        if (lineChanges.has(index)) outputLines[index - removedBefore] = lineChanges.get(index);
    });
    const repaired = `${document.hasBom ? '\uFEFF' : ''}${outputLines.join(document.lineEnding)}`;
    const after = runRemoteAdminDiagnostics(repaired, options.state || parsedData);
    const beforeStats = analysis.stats;
    const afterStats = after.stats;
    const allowedMemberRemovals = applied.filter(issue => issue.code === 'RA_EXACT_MEMBER_DUPLICATE').length;
    const allowedPropertyRemovals = applied.filter(issue => issue.code === 'RA_EXACT_PROPERTY_DUPLICATE').length;
    const allowedPropertyAdditions = applied.filter(issue => issue.code === 'RA_PROPERTY_COLON_MISSING').length;
    const allowedPermissionRemovals = applied.filter(issue => issue.code === 'RA_EXACT_PERMISSION_DUPLICATE').length;
    const sectionsReadable = Boolean(after.document.sections.members && after.document.sections.roles && after.document.sections.permissions);
    const preserved = sectionsReadable
        && afterStats.users === beforeStats.users - allowedMemberRemovals
        && afterStats.roleDeclarations === beforeStats.roleDeclarations
        && afterStats.properties === beforeStats.properties - allowedPropertyRemovals + allowedPropertyAdditions
        && afterStats.permissions === beforeStats.permissions - allowedPermissionRemovals
        && afterStats.unknownProperties === beforeStats.unknownProperties;
    const selectedCodes = new Set(applied.map(issue => issue.code));
    const reduced = [...selectedCodes].some(code =>
        after.diagnostics.filter(issue => issue.code === code).length
        < analysis.diagnostics.filter(issue => issue.code === code).length
    );
    if (!preserved || !reduced) return {
        original: source, content: source, changed: false, applied: [], skipped: selected,
        diagnostics: analysis, rolledBack: true,
        rollbackReason: !sectionsReadable
            ? t('repair.rollbackParser')
            : !preserved ? t('repair.rollbackData') : t('repair.rollbackNoChange')
    };
    return {
        original: source, content: repaired, changed: repaired !== source,
        applied, skipped, diagnostics: after, rolledBack: false
    };
}

function getCurrentRemoteAdminDiagnosticContent() {
    if (currentMode !== 'ra' || !hasLoadedRemoteAdmin) return '';
    try {
        return generateConfig();
    } catch (_) {
        return originalConfigText || '';
    }
}

function updateRemoteAdminHealth(result = activeRemoteAdminDiagnostics) {
    if (!remoteAdminHealth) return;
    remoteAdminHealth.classList.remove('is-pending', 'is-valid', 'has-warnings', 'has-errors');
    if (!result || currentMode !== 'ra' || !hasLoadedRemoteAdmin) {
        remoteAdminHealth.classList.add('is-pending');
        remoteAdminHealth.textContent = t('health.pending');
        return;
    }
    if (result.counts.error > 0) {
        remoteAdminHealth.classList.add('has-errors');
        remoteAdminHealth.textContent = t('health.errors', { count: result.counts.error });
    } else if (result.counts.warning > 0) {
        remoteAdminHealth.classList.add('has-warnings');
        remoteAdminHealth.textContent = t('health.warnings', { count: result.counts.warning });
    } else {
        remoteAdminHealth.classList.add('is-valid');
        remoteAdminHealth.textContent = t('health.valid');
    }
    const critical = result.counts.error;
    btnGenerate.title = critical > 0
        ? t('healthExtra.blockDownload', { count: critical })
        : '';
}

function refreshRemoteAdminDiagnostics(options = {}) {
    const content = options.content ?? getCurrentRemoteAdminDiagnosticContent();
    if (!content) {
        activeRemoteAdminDiagnostics = null;
        updateRemoteAdminHealth(null);
        return null;
    }
    activeRemoteAdminDiagnostics = runRemoteAdminDiagnostics(content, parsedData, {
        filename: uploadedFileName
    });
    const currentDiagnosticIds = new Set(activeRemoteAdminDiagnostics.diagnostics.map(issue => issue.id));
    selectedRemoteAdminDiagnosticIds = new Set(
        [...selectedRemoteAdminDiagnosticIds].filter(id => currentDiagnosticIds.has(id))
    );
    updateRemoteAdminHealth(activeRemoteAdminDiagnostics);
    if (options.render !== false) renderRemoteAdminDiagnostics();
    return activeRemoteAdminDiagnostics;
}

function scheduleRemoteAdminDiagnosticsRefresh() {
    if (remoteAdminDiagnosticsRefreshTimer) clearTimeout(remoteAdminDiagnosticsRefreshTimer);
    remoteAdminDiagnosticsRefreshTimer = setTimeout(() => {
        remoteAdminDiagnosticsRefreshTimer = null;
        refreshRemoteAdminDiagnostics({ render: Boolean(diagnosticsModal?.classList.contains('active')) });
    }, 0);
}

function appendRemoteAdminDiagnosticCount(label, value, className) {
    if (!diagnosticsCounts) return;
    const item = document.createElement('div');
    item.className = `diagnostics-count ${className || ''}`;
    const total = document.createElement('strong');
    const caption = document.createElement('small');
    total.textContent = String(value);
    caption.textContent = label;
    item.append(total, caption);
    diagnosticsCounts.appendChild(item);
}

function goToRemoteAdminDiagnostic(issue) {
    if (!issue?.line) return;
    const content = activeRemoteAdminDiagnostics?.content || getCurrentRemoteAdminDiagnosticContent();
    if (configInput) configInput.value = content;
    hideModal(diagnosticsModal);
    switchView('import');
    if (!configInput) return;
    const normalized = content.replace(/\r\n?/g, '\n');
    const lines = normalized.split('\n');
    const start = lines.slice(0, issue.line - 1).reduce((total, line) => total + line.length + 1, 0);
    const end = start + (lines[issue.line - 1]?.length || 0);
    configInput.focus();
    if (typeof configInput.setSelectionRange === 'function') configInput.setSelectionRange(start, end);
}

function commitRemoteAdminRepair(before, after, description) {
    if (before === after) return false;
    remoteAdminRepairHistory.push({
        before,
        after,
        description,
        at: new Date().toISOString()
    });
    if (remoteAdminRepairHistory.length > 20) remoteAdminRepairHistory.shift();
    activeRemoteAdminExportResult = null;
    activeRemoteAdminOrganization = null;
    activeRemoteAdminIdRenumber = null;
    commitRemoteAdminContentToCentralState(after);
    refreshRemoteAdminDiagnostics({ render: true });
    return true;
}

function repairRemoteAdminSafeIssues(selectedIds = null) {
    let content = activeRemoteAdminDiagnostics?.content || getCurrentRemoteAdminDiagnosticContent();
    if (!content) return null;
    const original = content;
    const applied = [];
    let result = null;
    for (let pass = 0; pass < 3; pass++) {
        const analysis = runRemoteAdminDiagnostics(content, parsedData);
        const ids = pass === 0 ? selectedIds : selectedIds ? [] : null;
        if (selectedIds && pass > 0) break;
        result = applyRemoteAdminRepairs(content, analysis, ids, { state: parsedData });
        if (result.rolledBack) {
            alert(t('repair.rolledBack', { reason: result.rollbackReason }));
            return result;
        }
        if (!result.changed) break;
        content = result.content;
        applied.push(...result.applied);
    }
    if (content === original) {
        if (selectedIds?.length) alert(t('repair.noSafeSelection'));
        return result;
    }
    commitRemoteAdminRepair(
        original,
        content,
        `Reparación segura de ${applied.length} diagnóstico(s)`
    );
    if (exportModal?.classList.contains('active')) renderRemoteAdminExportPreview(false, false);
    alert(t('repair.appliedSafe', { count: applied.length }));
    return { ...result, applied, content };
}

function applyRemoteAdminExplicitLineRepair(issue) {
    if (!issue?.repairAction || !confirm(t('repair.applyFixConfirm', { code: issue.code }))) return false;
    const content = activeRemoteAdminDiagnostics?.content || getCurrentRemoteAdminDiagnosticContent();
    const explicitIssue = { ...issue, repairKind: 'safe' };
    const analysis = {
        ...runRemoteAdminDiagnostics(content, parsedData),
        content,
        diagnostics: [explicitIssue]
    };
    const result = applyRemoteAdminRepairs(content, analysis, [explicitIssue.id], { state: parsedData });
    if (!result.changed || result.rolledBack) {
        alert(t('repair.cannotApplyFix', { reason: result.rollbackReason || t('repair.cannotApplyDefault') }));
        return false;
    }
    commitRemoteAdminRepair(content, result.content, `Resolución confirmada de ${issue.code}`);
    return true;
}

function applyRemoteAdminChoiceRepair(issue) {
    const content = activeRemoteAdminDiagnostics?.content || getCurrentRemoteAdminDiagnosticContent();
    const document = parseRemoteAdminDocument(content);
    if (issue.code === 'RA_DUPLICATE_STEAMID' || issue.code === 'RA_DUPLICATE_USER_ID') {
        const candidates = document.memberEntries.filter(entry =>
            validateRemoteAdminUserId(entry.id).normalized === validateRemoteAdminUserId(issue.userId).normalized
        );
        const answer = prompt(
            t('choice.keepLine', { list: candidates.map(entry => `${entry.lineIndex + 1}: ${entry.id} → ${entry.roleName}`).join('\n') }),
            String(candidates[0]?.lineIndex + 1 || '')
        );
        const keepLineIndex = Number(answer) - 1;
        if (!candidates.some(entry => entry.lineIndex === keepLineIndex)) return false;
        const remove = new Set(candidates
            .filter(entry => entry.lineIndex !== keepLineIndex)
            .flatMap(entry => [...entry.commentIndexes, entry.lineIndex]));
        if (!confirm(t('choice.removeConflicts', { count: candidates.length - 1, line: keepLineIndex + 1 }))) return false;
        const lines = document.lines.filter((_, index) => !remove.has(index));
        const output = `${document.hasBom ? '\uFEFF' : ''}${lines.join(document.lineEnding)}`;
        const reread = runRemoteAdminDiagnostics(output, parsedData);
        if (!reread.document.sections.members || !reread.document.sections.roles || !reread.document.sections.permissions) {
            alert(t('repair.parserLost'));
            return false;
        }
        return commitRemoteAdminRepair(content, output, `Resolución de ${issue.code}`);
    }
    if (issue.code === 'RA_CONFLICTING_PROPERTY_DUPLICATE') {
        const properties = document.rolePropertyNodes.get(issue.roleName);
        const propertyFromExcerpt = [...(properties?.keys() || [])].find(propertyName =>
            String(issue.excerpt || '').split('\n').some(line => line.startsWith(`${issue.roleName}_${propertyName}:`))
        );
        const property = [...(properties?.entries() || [])].find(([propertyName, nodes]) =>
            propertyName === propertyFromExcerpt
            || nodes.some(node => node.lineIndex + 1 === issue.line)
            || nodes.length > 1 && new Set(nodes.map(node => node.rawValue.trim())).size > 1
        );
        if (!property) return false;
        const [propertyName, nodes] = property;
        const answer = prompt(
            t('choice.keepValue', { list: nodes.map(node => `${node.lineIndex + 1}: ${node.rawValue.trim()}`).join('\n') }),
            String(nodes.at(-1).lineIndex + 1)
        );
        const keepLineIndex = Number(answer) - 1;
        if (!nodes.some(node => node.lineIndex === keepLineIndex)) return false;
        if (!confirm(t('choice.keepSingle', { name: `${issue.roleName}_${propertyName}` }))) return false;
        const remove = new Set(nodes.filter(node => node.lineIndex !== keepLineIndex).map(node => node.lineIndex));
        const output = `${document.hasBom ? '\uFEFF' : ''}${document.lines.filter((_, index) => !remove.has(index)).join(document.lineEnding)}`;
        return commitRemoteAdminRepair(content, output, `Resolución de propiedad duplicada ${issue.roleName}_${propertyName}`);
    }
    if (issue.code === 'RA_CONFLICTING_PERMISSION_DUPLICATE') {
        const permissionFromExcerpt = String(issue.excerpt || '').match(/^\s*-\s*([A-Za-z0-9_.-]+):/m)?.[1];
        const permissionName = permissionFromExcerpt
            || document.permissionEntries.find(entry => entry.lineIndex + 1 === issue.line)?.permission;
        const candidates = document.permissionEntries.filter(entry => entry.permission === permissionName);
        if (!permissionName || candidates.length < 2) return false;
        const answer = prompt(
            t('choice.combinePrompt', { list: candidates.map(entry => `${entry.lineIndex + 1}: [${entry.roles.join(', ')}]`).join('\n') }),
            t('choice.combineDefault')
        );
        const combine = ['combinar', 'combine'].includes(String(answer || '').trim().toLowerCase());
        const keepLineIndex = combine ? candidates.at(-1).lineIndex : Number(answer) - 1;
        if (!candidates.some(entry => entry.lineIndex === keepLineIndex)) return false;
        if (!confirm(combine
            ? t('choice.combineConfirm', { name: permissionName })
            : t('choice.keepOneConfirm', { line: keepLineIndex + 1 }))) return false;
        const lines = [...document.lines];
        if (combine) {
            const roles = [...new Set(candidates.flatMap(entry => entry.roles))];
            const keep = candidates.find(entry => entry.lineIndex === keepLineIndex);
            lines[keepLineIndex] = `${keep.indent}- ${keep.permission}:${keep.separator || ' '}[${roles.join(', ')}]${keep.trailingWhitespace}`;
        }
        const remove = new Set(candidates
            .filter(entry => entry.lineIndex !== keepLineIndex)
            .flatMap(entry => [...entry.commentIndexes, entry.lineIndex]));
        const output = `${document.hasBom ? '\uFEFF' : ''}${lines.filter((_, index) => !remove.has(index)).join(document.lineEnding)}`;
        return commitRemoteAdminRepair(content, output, `Resolución del permiso duplicado ${permissionName}`);
    }
    if (issue.code === 'RA_DUPLICATE_ROLE_DECLARATION') {
        const candidates = document.roleEntries.filter(entry => entry.roleName === issue.roleName);
        const answer = prompt(
            t('choice.keepRole', { role: issue.roleName, list: candidates.map(entry => String(entry.lineIndex + 1)).join(', ') }),
            String(candidates[0]?.lineIndex + 1 || '')
        );
        const keepLineIndex = Number(answer) - 1;
        if (!candidates.some(entry => entry.lineIndex === keepLineIndex)) return false;
        if (!confirm(t('choice.removeRoles', { count: candidates.length - 1, role: issue.roleName }))) return false;
        const remove = new Set(candidates.filter(entry => entry.lineIndex !== keepLineIndex).map(entry => entry.lineIndex));
        const output = `${document.hasBom ? '\uFEFF' : ''}${document.lines.filter((_, index) => !remove.has(index)).join(document.lineEnding)}`;
        return commitRemoteAdminRepair(content, output, `Resolución de ID duplicada ${issue.roleName}`);
    }
    if (issue.repairAction?.type === 'openRenumber') {
        hideModal(diagnosticsModal);
        renderRemoteAdminExportPreview(true, false);
        startRemoteAdminIdRenumber();
        return true;
    }
    if (issue.repairAction) return applyRemoteAdminExplicitLineRepair(issue);
    alert(t('repair.manualRequired'));
    goToRemoteAdminDiagnostic(issue);
    return false;
}

function canResolveRemoteAdminDiagnosticDecision(issue) {
    return Boolean(issue?.repairAction) || [
        'RA_DUPLICATE_STEAMID',
        'RA_DUPLICATE_USER_ID',
        'RA_CONFLICTING_PROPERTY_DUPLICATE',
        'RA_CONFLICTING_PERMISSION_DUPLICATE',
        'RA_DUPLICATE_ROLE_DECLARATION'
    ].includes(issue?.code);
}

function resolveSelectedRemoteAdminDiagnostics(selectedIds = selectedRemoteAdminDiagnosticIds) {
    const result = activeRemoteAdminDiagnostics || refreshRemoteAdminDiagnostics({ render: false });
    const ids = new Set(selectedIds || []);
    const selected = (result?.diagnostics || []).filter(issue => ids.has(issue.id));
    if (!selected.length) {
        alert(t('repair.selectOne'));
        return { repaired: 0, decisions: 0, manual: 0 };
    }

    const safeIssues = selected.filter(issue => issue.repairKind === 'safe' && issue.repairAction);
    let repaired = 0;
    if (safeIssues.length > 0) {
        const repairResult = repairRemoteAdminSafeIssues(safeIssues.map(issue => issue.id));
        repaired = repairResult?.applied?.length || 0;
    }

    let decisions = 0;
    const decisionIssues = selected.filter(issue =>
        issue.repairKind === 'confirm' && canResolveRemoteAdminDiagnosticDecision(issue)
    );
    for (const issue of decisionIssues) {
        if (applyRemoteAdminChoiceRepair(issue)) decisions += 1;
        if (issue.repairAction?.type === 'openRenumber') break;
    }

    const unresolved = selected.filter(issue =>
        issue.repairKind === 'manual'
        || issue.repairKind === 'confirm' && !canResolveRemoteAdminDiagnosticDecision(issue)
    );
    selectedRemoteAdminDiagnosticIds.clear();
    if (diagnosticsModal?.classList.contains('active')) {
        refreshRemoteAdminDiagnostics({ render: true });
    }
    if (unresolved.length > 0) {
        alert(
            t('repair.unresolvedManual', {
                count: unresolved.length,
                list: unresolved.slice(0, 8).map(issue => `• ${issue.code}${issue.line ? t('repair.unresolvedLine', { line: issue.line }) : ''}`).join('\n')
            })
        );
    }
    return { repaired, decisions, manual: unresolved.length };
}

function getVisibleRemoteAdminDiagnostics(result = activeRemoteAdminDiagnostics) {
    if (!result) return [];
    const filter = diagnosticsFilter?.value || 'all';
    const search = String(diagnosticsSearch?.value || '').trim().toLowerCase();
    return result.diagnostics.filter(issue => {
        if (filter !== 'all' && issue.severity !== filter && issue.repairKind !== filter) return false;
        if (!search) return true;
        return `${issue.code} ${issue.title} ${issue.explanation} ${issue.section} ${issue.roleName} ${issue.userId}`
            .toLowerCase().includes(search);
    });
}

function renderRemoteAdminDiagnostics() {
    const result = activeRemoteAdminDiagnostics;
    if (!result || !diagnosticsList) return;
    diagnosticsCounts?.replaceChildren();
    appendRemoteAdminDiagnosticCount(t('diag.countErrors'), result.counts.error, 'error');
    appendRemoteAdminDiagnosticCount(t('diag.countWarnings'), result.counts.warning, 'warning');
    appendRemoteAdminDiagnosticCount(t('diag.countInfo'), result.counts.info, 'info');
    appendRemoteAdminDiagnosticCount(t('diag.countRepairable'), result.counts.safe, 'safe');
    appendRemoteAdminDiagnosticCount(t('diag.countDecisions'), result.counts.confirm, 'confirm');
    if (diagnosticsSummary) {
        diagnosticsSummary.textContent = t('diag.summary', {
            users: result.stats.users, roles: result.stats.roles, perms: result.stats.permissions,
            tail: result.valid ? t('diag.summaryOk') : t('diag.summaryBlocked')
        });
    }
    const visible = getVisibleRemoteAdminDiagnostics(result);
    diagnosticsList.replaceChildren();
    if (!visible.length) {
        const empty = document.createElement('div');
        empty.className = 'diagnostics-empty';
        empty.textContent = result.diagnostics.length
            ? t('diag.emptyFiltered')
            : t('diag.emptyClean');
        diagnosticsList.appendChild(empty);
    }
    visible.forEach(issue => {
        const card = document.createElement('article');
        card.className = `diagnostic-card ${issue.severity}${issue.ignored ? ' is-ignored' : ''}`;
        card.setAttribute('role', 'listitem');
        const selector = document.createElement('input');
        selector.type = 'checkbox';
        selector.className = 'diagnostic-select';
        selector.dataset.diagnosticId = issue.id;
        selector.checked = selectedRemoteAdminDiagnosticIds.has(issue.id);
        selector.disabled = false;
        selector.title = issue.repairKind === 'manual'
            ? t('diag.selManual')
            : issue.repairKind === 'confirm'
                ? t('diag.selConfirm')
                : t('diag.selSafe');
        selector.setAttribute('aria-label', t('diag.selAria', { code: issue.code }));
        selector.addEventListener('change', () => {
            if (selector.checked) selectedRemoteAdminDiagnosticIds.add(issue.id);
            else selectedRemoteAdminDiagnosticIds.delete(issue.id);
            if (btnResolveSelected) {
                btnResolveSelected.disabled = selectedRemoteAdminDiagnosticIds.size === 0;
                btnResolveSelected.textContent = t('diag.resolveSelectedN', { n: selectedRemoteAdminDiagnosticIds.size });
            }
            if (btnClearDiagnosticSelection) btnClearDiagnosticSelection.disabled = selectedRemoteAdminDiagnosticIds.size === 0;
        });
        const body = document.createElement('div');
        const code = document.createElement('div');
        code.className = 'diagnostic-code';
        const repairLabel = issue.repairKind === 'safe'
            ? t('diag.repairSafe')
            : issue.repairKind === 'confirm' ? t('diag.repairConfirm') : t('diag.repairManual');
        code.textContent = `${issue.code} · ${issue.severity === 'error' ? t('diag.sevError') : issue.severity === 'warning' ? t('diag.sevWarning') : t('diag.sevInfo')} · ${repairLabel}`;
        const title = document.createElement('h3');
        title.className = 'diagnostic-title';
        title.textContent = issue.title;
        const explanation = document.createElement('p');
        explanation.className = 'diagnostic-explanation';
        explanation.textContent = issue.explanation;
        const location = document.createElement('div');
        location.className = 'diagnostic-location';
        location.textContent = `${issue.section}${issue.line ? t('diag.locLine', { line: issue.line }) : ''}${issue.roleName ? t('diag.locRole', { role: issue.roleName }) : ''}${t('diag.locAffects', { list: issue.affects.join(', ') })}`;
        body.append(code, title, explanation, location);
        if (issue.excerpt) {
            const excerpt = document.createElement('pre');
            excerpt.className = 'diagnostic-excerpt';
            excerpt.textContent = issue.excerpt;
            body.appendChild(excerpt);
        }
        const actions = document.createElement('div');
        actions.className = 'diagnostic-actions';
        const resolve = document.createElement('button');
        resolve.type = 'button';
        resolve.className = `btn ${issue.repairKind === 'safe' ? 'btn-primary' : 'btn-secondary'}`;
        resolve.textContent = issue.repairKind === 'safe' ? t('diag.actResolve') : issue.repairKind === 'confirm' ? t('diag.actReviewDecision') : t('diag.actReview');
        resolve.addEventListener('click', () => {
            if (issue.repairKind === 'safe') repairRemoteAdminSafeIssues([issue.id]);
            else applyRemoteAdminChoiceRepair(issue);
        });
        const locate = document.createElement('button');
        locate.type = 'button';
        locate.className = 'btn btn-secondary';
        locate.textContent = t('diag.actGoto');
        locate.disabled = !issue.line;
        locate.addEventListener('click', () => goToRemoteAdminDiagnostic(issue));
        actions.append(resolve, locate);
        if (issue.severity !== 'error' && issue.repairKind !== 'confirm') {
            const ignore = document.createElement('button');
            ignore.type = 'button';
            ignore.className = 'btn btn-secondary';
            ignore.textContent = issue.ignored ? t('diag.actUnignore') : t('diag.actIgnore');
            ignore.addEventListener('click', () => {
                if (ignoredRemoteAdminDiagnosticIds.has(issue.id)) ignoredRemoteAdminDiagnosticIds.delete(issue.id);
                else ignoredRemoteAdminDiagnosticIds.add(issue.id);
                issue.ignored = !issue.ignored;
                renderRemoteAdminDiagnostics();
            });
            actions.appendChild(ignore);
        }
        card.append(selector, body, actions);
        diagnosticsList.appendChild(card);
    });
    if (btnResolveSafe) {
        btnResolveSafe.disabled = result.repairable.length === 0;
        btnResolveSafe.textContent = t('diag.resolveSafeN', { n: result.repairable.length });
    }
    if (btnResolveSelected) {
        btnResolveSelected.disabled = selectedRemoteAdminDiagnosticIds.size === 0;
        btnResolveSelected.textContent = t('diag.resolveSelectedN', { n: selectedRemoteAdminDiagnosticIds.size });
    }
    if (btnSelectVisibleDiagnostics) btnSelectVisibleDiagnostics.disabled = visible.length === 0;
    if (btnClearDiagnosticSelection) btnClearDiagnosticSelection.disabled = selectedRemoteAdminDiagnosticIds.size === 0;
    if (btnUndoRepair) btnUndoRepair.disabled = remoteAdminRepairHistory.length === 0;
    if (btnUndoAllRepairs) btnUndoAllRepairs.disabled = remoteAdminRepairHistory.length === 0;
    if (btnRestoreRemoteAdminOriginal) btnRestoreRemoteAdminOriginal.disabled = !remoteAdminSessionOriginalText;
}

function openRemoteAdminDiagnostics(options = {}) {
    if (!hasLoadedRemoteAdmin || currentMode !== 'ra') {
        alert(t('repair.loadFirst'));
        return null;
    }
    const result = refreshRemoteAdminDiagnostics({ content: options.content, render: true });
    showModal(diagnosticsModal, diagnosticsSearch || btnResolveSafe);
    return result;
}

function undoLastRemoteAdminRepair() {
    const entry = remoteAdminRepairHistory.at(-1);
    if (!entry) return false;
    const current = getCurrentRemoteAdminDiagnosticContent();
    if (current !== entry.after) {
        alert(t('repair.undoBlocked'));
        return false;
    }
    remoteAdminRepairHistory.pop();
    commitRemoteAdminContentToCentralState(entry.before);
    refreshRemoteAdminDiagnostics({ render: true });
    return true;
}

function undoAllRemoteAdminRepairs() {
    if (!remoteAdminRepairHistory.length) return false;
    const first = remoteAdminRepairHistory[0];
    if (!confirm(t('repair.undoAllConfirm'))) return false;
    remoteAdminRepairHistory = [];
    commitRemoteAdminContentToCentralState(first.before);
    refreshRemoteAdminDiagnostics({ render: true });
    return true;
}

function restoreRemoteAdminSessionOriginal() {
    if (!remoteAdminSessionOriginalText
        || !confirm(t('repair.restoreConfirm'))) return false;
    remoteAdminRepairHistory = [];
    ignoredRemoteAdminDiagnosticIds.clear();
    commitRemoteAdminContentToCentralState(remoteAdminSessionOriginalText);
    refreshRemoteAdminDiagnostics({ render: true });
    return true;
}

if (btnValidateRemoteAdmin) btnValidateRemoteAdmin.addEventListener('click', () => {
    if (diagnosticsFilter) diagnosticsFilter.value = 'all';
    openRemoteAdminDiagnostics();
});
if (btnRepairRemoteAdmin) btnRepairRemoteAdmin.addEventListener('click', () => {
    if (diagnosticsFilter) diagnosticsFilter.value = 'safe';
    openRemoteAdminDiagnostics();
});
if (btnOpenDiagnosticsExport) btnOpenDiagnosticsExport.addEventListener('click', () => {
    openRemoteAdminDiagnostics({ content: activeRemoteAdminExportResult?.content });
});
if (btnCloseDiagnostics) btnCloseDiagnostics.addEventListener('click', () => hideModal(diagnosticsModal));
if (diagnosticsSearch) diagnosticsSearch.addEventListener('input', renderRemoteAdminDiagnostics);
if (diagnosticsFilter) diagnosticsFilter.addEventListener('change', renderRemoteAdminDiagnostics);
if (btnResolveSafe) btnResolveSafe.addEventListener('click', () => {
    const safeIds = (activeRemoteAdminDiagnostics?.repairable || []).map(issue => issue.id);
    repairRemoteAdminSafeIssues(safeIds);
});
if (btnResolveSelected) btnResolveSelected.addEventListener('click', () => {
    resolveSelectedRemoteAdminDiagnostics();
});
if (btnSelectVisibleDiagnostics) btnSelectVisibleDiagnostics.addEventListener('click', () => {
    getVisibleRemoteAdminDiagnostics().forEach(issue => selectedRemoteAdminDiagnosticIds.add(issue.id));
    renderRemoteAdminDiagnostics();
});
if (btnClearDiagnosticSelection) btnClearDiagnosticSelection.addEventListener('click', () => {
    selectedRemoteAdminDiagnosticIds.clear();
    renderRemoteAdminDiagnostics();
});
if (btnUndoRepair) btnUndoRepair.addEventListener('click', undoLastRemoteAdminRepair);
if (btnUndoAllRepairs) btnUndoAllRepairs.addEventListener('click', undoAllRemoteAdminRepairs);
if (btnRestoreRemoteAdminOriginal) btnRestoreRemoteAdminOriginal.addEventListener('click', restoreRemoteAdminSessionOriginal);

function buildRemoteAdminExport(options = {}) {
    const state = options.state || parsedData;
    const loaded = options.loaded ?? (state === parsedData ? hasLoadedRemoteAdmin : true);
    const sourceDocument = options.document
        || (state === parsedData ? remoteAdminDocument : parseRemoteAdminDocument(options.sourceText || ''));
    const content = options.content ?? (
        state === parsedData
            ? generateConfig()
            : applyRemoteAdminLinePatches(
                sourceDocument,
                buildRemoteAdminLinePatches(sourceDocument, state)
            )
    );
    const validation = validateGeneratedRemoteAdminContent(content, state, sourceDocument);
    const diagnostics = runRemoteAdminDiagnostics(content, state, {
        filename: options.filename || sourceDocument?.filename
    });
    diagnostics.diagnostics.forEach(issue => {
        if (issue.severity === 'error'
            && !validation.errors.some(current => current.code === issue.code && current.message === issue.message)) {
            validation.errors.push(createExportIssue(issue.code, issue.message));
        } else if (issue.severity === 'warning'
            && !validation.warnings.some(current => current.code === issue.code && current.message === issue.message)) {
            validation.warnings.push(createExportIssue(issue.code, issue.message));
        }
    });
    if (!loaded) {
        validation.errors.unshift(
            createExportIssue('REMOTE_ADMIN_NOT_LOADED', t('val.notLoadedFile'))
        );
    }
    const roleEntries = getCurrentRoleEntries(state);
    const members = getCurrentMemberEntries(state);
    const permissionNames = new Set(
        validation.document.permissionEntries.map(entry => entry.permission)
    );
    const permissionAssignments = validation.document.permissionEntries
        .reduce((total, entry) => total + entry.roles.length, 0);
    const lineEndingLabel = sourceDocument?.lineEnding === '\r\n'
        ? 'CRLF'
        : sourceDocument?.lineEnding === '\r' ? 'CR' : 'LF';
    const filename = getRemoteAdminFilename(sourceDocument, options.filename);
    const format = {
        type: 'RemoteAdmin text',
        extension: '.txt',
        encoding: 'UTF-8',
        bom: Boolean(sourceDocument?.hasBom),
        lineEnding: lineEndingLabel,
        finalNewline: Boolean(sourceDocument?.finalNewline)
    };
    return {
        targetId: 'config-output',
        framework: 'remoteadmin',
        frameworkLabel: 'RemoteAdmin',
        filename,
        format,
        formatLabel: `${format.type} · ${format.encoding}${format.bom ? ' con BOM' : ' sin BOM'} · ${lineEndingLabel}`,
        content,
        diagnostics,
        valid: validation.errors.length === 0,
        errors: validation.errors,
        warnings: validation.warnings,
        stats: {
            users: members.length,
            steamUsers: new Set(
                members
                    .map(({ member }) => normalizeSteamId64(member.id))
                    .filter(isValidSteamId64)
            ).size,
            groups: roleEntries.length,
            roles: roleEntries.length,
            permissions: permissionNames.size,
            permissionAssignments
        }
    };
}

function buildPermissionsDataset(state = parsedData, loaded = hasLoadedRemoteAdmin) {
    const roleEntries = getCurrentRoleEntries(state);
    const roles = roleEntries.map(({ roleName, data, prefix }) => ({
        name: roleName,
        prefix,
        nativePermissions: [...ensureMemberPermissions(data)].sort((a, b) => a.localeCompare(b)),
        badge: String(data.badge || ''),
        color: String(data.color || '')
    }));
    const users = [];
    Object.keys(state.groups || {}).sort(compareRoleNames).forEach(prefix => {
        const group = state.groups[prefix];
        (group.members || []).forEach((member, index) => {
            users.push({
                id: String(member.id || ''),
                steamId: normalizeSteamId64(member.id),
                roleName: getRoleName(prefix, group, index),
                name: String(member.name || ''),
                notes: String(member.notes || '')
            });
        });
    });
    const nativePermissions = new Set();
    roles.forEach(role => role.nativePermissions.forEach(permission => nativePermissions.add(permission)));
    return {
        loaded,
        roles,
        users,
        nativePermissions: [...nativePermissions].sort((a, b) => a.localeCompare(b)),
        sourceValidationIssues: [...(state.sourceValidationIssues || [])]
    };
}

function validatePermissionsDataset(dataset, framework, permissionPolicy = 'safe') {
    const errors = [];
    const warnings = [];
    const addError = (code, message) => errors.push(createExportIssue(code, message));
    const addWarning = (code, message) => warnings.push(createExportIssue(code, message));
    const reservedGroup = framework === 'exiled' ? 'user' : 'default';

    if (!dataset.loaded) addError('REMOTE_ADMIN_NOT_LOADED', t('val.notLoadedFile'));
    if (dataset.roles.length === 0) addError('NO_GROUPS', t('perm.noGroups'));
    if (dataset.users.length === 0) addError('NO_USERS', t('perm.noUsers'));
    (dataset.sourceValidationIssues || []).forEach(issue => {
        if (issue.severity === 'error') addError(issue.code, issue.message);
        else addWarning(issue.code, issue.message);
    });

    const roleNames = new Set();
    const lowerRoleNames = new Map();
    dataset.roles.forEach(role => {
        if (!role.name) {
            addError('GROUP_NAME_MISSING', t('val.roleNameMissing'));
            return;
        }
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(role.name)) {
            addError('INVALID_GROUP_NAME', t('perm.invalidGroupName', { name: role.name }));
        }
        if (role.name.toLowerCase() === reservedGroup.toLowerCase()) {
            addError('RESERVED_GROUP_NAME', t('perm.reservedGroup', { name: role.name, key: reservedGroup }));
        }
        if (roleNames.has(role.name)) addError('DUPLICATE_GROUP', t('perm.dupGroup', { name: role.name }));
        roleNames.add(role.name);
        const lowerName = role.name.toLowerCase();
        if (lowerRoleNames.has(lowerName) && lowerRoleNames.get(lowerName) !== role.name) {
            addWarning(
                'CASE_SENSITIVE_GROUP_COLLISION',
                t('perm.caseCollision', { a: lowerRoleNames.get(lowerName), b: role.name })
            );
        } else {
            lowerRoleNames.set(lowerName, role.name);
        }
    });

    const steamAssignments = new Map();
    let invalidIdCount = 0;
    dataset.users.forEach(user => {
        if (!roleNames.has(user.roleName)) {
            addError('UNKNOWN_USER_GROUP', t('perm.unknownUserGroup', { id: user.id, group: user.roleName }));
        }
        if (!isValidSteamId64(user.steamId)) {
            invalidIdCount += 1;
            return;
        }
        const previousRole = steamAssignments.get(user.steamId);
        if (previousRole) {
            if (previousRole === user.roleName) {
                addWarning('DUPLICATE_STEAM_ID', t('perm.dupSteam', { steam: user.steamId, group: user.roleName }));
            } else {
                addError(
                    'CONFLICTING_STEAM_ID',
                    t('perm.conflictSteam', { steam: user.steamId, a: previousRole, b: user.roleName })
                );
            }
        } else {
            steamAssignments.set(user.steamId, user.roleName);
        }
    });
    const validSteamUsers = steamAssignments.size;
    if (dataset.users.length > 0 && validSteamUsers === 0) {
        addError('NO_STEAM_IDS', t('perm.noSteam'));
    }
    if (invalidIdCount > 0) {
        addWarning(
            'INCOMPATIBLE_USER_IDS',
            t('perm.incompatibleIds', { count: invalidIdCount })
        );
    }

    if (dataset.nativePermissions.length > 0) {
        addWarning(
            'NO_PLUGIN_PERMISSION_MAPPING',
            t('perm.noMapping', { count: dataset.nativePermissions.length, fw: framework === 'exiled' ? 'EXILED' : 'LabAPI' })
        );
    }
    if (permissionPolicy === 'wildcard') {
        addWarning(
            'WILDCARD_PERMISSIONS',
            t('perm.wildcard')
        );
    } else if (dataset.roles.length > 0) {
        addWarning(
            'EMPTY_PLUGIN_PERMISSIONS',
            t('perm.emptyPerms', { count: dataset.roles.length })
        );
    }
    if (dataset.users.length > 0) {
        addWarning(
            'USERS_LINKED_VIA_REMOTE_ADMIN',
            t('perm.linkedUsers', { count: dataset.users.length, fw: framework === 'exiled' ? 'EXILED' : 'LabAPI' })
        );
    }
    if (dataset.roles.some(role => role.badge || role.color)) {
        addWarning(
            'DISPLAY_FIELDS_NOT_SUPPORTED',
            t('perm.displayFields')
        );
    }
    return { errors, warnings, validSteamUsers };
}

function serializeExiledPermissions(dataset, permissionPolicy) {
    const out = [
        'user:',
        '  default: true',
        '  inheritance: [ ]',
        '  permissions: [ ]'
    ];
    dataset.roles.forEach(role => {
        out.push(`${role.name}:`, '  inheritance: [ ]');
        if (permissionPolicy === 'wildcard') out.push('  permissions:', '    - .*');
        else out.push('  permissions: [ ]');
    });
    return out.join('\n');
}

function serializeLabAPIPermissions(dataset, permissionPolicy) {
    const out = [
        'default:',
        '  inherited_groups: []',
        '  permissions: []'
    ];
    dataset.roles.forEach(role => {
        out.push(`${role.name}:`, '  inherited_groups: []');
        if (permissionPolicy === 'wildcard') out.push('  permissions:', '  - .*');
        else out.push('  permissions: []');
    });
    return `${out.join('\n')}\n`;
}

function validateGeneratedPermissionsContent(content, framework) {
    const errors = [];
    const addError = (code, message) => errors.push(createExportIssue(code, message));
    if (content.startsWith('\uFEFF')) errors.push(createExportIssue('UTF8_BOM', t('perm.yamlBom')));
    if (content.includes('\t')) errors.push(createExportIssue('TAB_INDENTATION', t('perm.yamlTabs')));
    if (content.includes('\r')) errors.push(createExportIssue('INVALID_LINE_ENDINGS', t('perm.yamlCrlf')));
    if (framework === 'labapi' && !content.endsWith('\n')) {
        addError('MISSING_FINAL_NEWLINE', t('perm.yamlFinalNewline'));
    }

    const lines = content.split('\n');
    const blocks = [];
    let currentBlock = null;
    lines.forEach((line, index) => {
        if (line === '' && index === lines.length - 1) return;
        const topLevelMatch = line.match(/^([A-Za-z_][A-Za-z0-9_]*):$/);
        if (topLevelMatch) {
            currentBlock = { key: topLevelMatch[1], line: index + 1, children: [] };
            blocks.push(currentBlock);
            return;
        }
        if (!currentBlock) {
            if (line.trim()) addError('INVALID_YAML_ROOT', t('perm.yamlRoot', { line: index + 1 }));
            return;
        }
        currentBlock.children.push({ text: line, line: index + 1 });
    });

    const topLevelKeys = blocks.map(block => block.key);
    const duplicateKeys = topLevelKeys.filter((key, index) => topLevelKeys.indexOf(key) !== index);
    if (duplicateKeys.length > 0) {
        addError('DUPLICATE_YAML_KEY', t('perm.yamlDupKey', { list: [...new Set(duplicateKeys)].join(', ') }));
    }
    const requiredKey = framework === 'exiled' ? 'user' : 'default';
    if (!topLevelKeys.includes(requiredKey)) {
        addError('MISSING_DEFAULT_GROUP', t('perm.yamlMissingDefault', { key: requiredKey }));
    }

    blocks.forEach(block => {
        let inheritanceCount = 0;
        let defaultCount = 0;
        let emptyPermissionsCount = 0;
        let permissionHeaderCount = 0;
        let permissionItemCount = 0;
        let permissionHeaderIndex = -1;
        const permissionItemIndexes = [];
        const unknownLines = [];

        block.children.forEach((child, childIndex) => {
            if (framework === 'exiled' && child.text === '  default: true') defaultCount += 1;
            else if (framework === 'exiled' && child.text === '  inheritance: [ ]') inheritanceCount += 1;
            else if (framework === 'labapi' && child.text === '  inherited_groups: []') inheritanceCount += 1;
            else if (framework === 'exiled' && child.text === '  permissions: [ ]') emptyPermissionsCount += 1;
            else if (framework === 'labapi' && child.text === '  permissions: []') emptyPermissionsCount += 1;
            else if (child.text === '  permissions:') {
                permissionHeaderCount += 1;
                permissionHeaderIndex = childIndex;
            } else if (framework === 'exiled' && /^ {4}-\s+\S.*$/.test(child.text)) {
                permissionItemCount += 1;
                permissionItemIndexes.push(childIndex);
            } else if (framework === 'labapi' && /^ {2}-\s+\S.*$/.test(child.text)) {
                permissionItemCount += 1;
                permissionItemIndexes.push(childIndex);
            }
            else unknownLines.push(child);
        });

        if (inheritanceCount !== 1) {
            const field = framework === 'exiled' ? 'inheritance: [ ]' : 'inherited_groups: []';
            addError('INVALID_INHERITANCE_FIELD', t('perm.yamlInheritance', { group: block.key, field }));
        }
        if (framework === 'exiled' && block.key === 'user' && defaultCount !== 1) {
            addError('INVALID_DEFAULT_FIELD', t('perm.yamlDefaultField'));
        }
        if (framework === 'exiled' && block.key !== 'user' && defaultCount > 0) {
            addError('UNEXPECTED_DEFAULT_FIELD', t('perm.yamlUnexpectedDefault', { group: block.key }));
        }
        if (emptyPermissionsCount + permissionHeaderCount !== 1) {
            addError('INVALID_PERMISSIONS_FIELD', t('perm.yamlPermsField', { group: block.key }));
        }
        if (permissionHeaderCount === 1 && permissionItemCount === 0) {
            addError('EMPTY_PERMISSION_LIST', t('perm.yamlEmptyList', { group: block.key }));
        }
        if (permissionHeaderCount === 0 && permissionItemCount > 0) {
            addError('ORPHAN_PERMISSION_ITEM', t('perm.yamlOrphanItem', { group: block.key }));
        }
        if (permissionHeaderCount === 1 && permissionItemCount > 0) {
            const itemsFollowHeader = permissionItemIndexes.every(
                (itemIndex, index) => itemIndex === permissionHeaderIndex + index + 1
            );
            if (!itemsFollowHeader) {
                addError(
                    'INVALID_PERMISSION_ITEM_ORDER',
                    t('perm.yamlItemOrder', { group: block.key })
                );
            }
        }
        unknownLines.forEach(child => {
            addError('INVALID_GROUP_FIELD', t('perm.yamlGroupField', { line: child.line, group: block.key }));
        });
    });
    return errors;
}

function buildPermissionsExport(framework, options = {}) {
    if (!['exiled', 'labapi'].includes(framework)) {
        throw new Error(t('perm.frameworkBad', { fw: framework }));
    }
    const state = options.state || parsedData;
    const loaded = options.loaded ?? (state === parsedData ? hasLoadedRemoteAdmin : true);
    const permissionPolicy = options.permissionPolicy === 'wildcard' ? 'wildcard' : 'safe';
    const dataset = buildPermissionsDataset(state, loaded);
    const validation = validatePermissionsDataset(dataset, framework, permissionPolicy);
    const content = framework === 'exiled'
        ? serializeExiledPermissions(dataset, permissionPolicy)
        : serializeLabAPIPermissions(dataset, permissionPolicy);
    const contentErrors = validateGeneratedPermissionsContent(content, framework);
    const errors = [...validation.errors, ...contentErrors];
    const remoteAdminContent = options.remoteAdminContent
        ?? (state === parsedData && hasLoadedRemoteAdmin ? generateConfig() : options.sourceText || '');
    const diagnostics = remoteAdminContent
        ? runRemoteAdminDiagnostics(remoteAdminContent, state)
        : null;
    (diagnostics?.diagnostics || []).forEach(issue => {
        if (!issue.affects.includes(framework)) return;
        const target = issue.severity === 'error' ? errors : validation.warnings;
        if (issue.severity === 'info') return;
        if (!target.some(current => current.code === issue.code && current.message === issue.message)) {
            target.push(createExportIssue(issue.code, issue.message));
        }
    });
    return {
        framework,
        frameworkLabel: framework === 'exiled' ? 'EXILED' : 'LabAPI',
        filename: framework === 'exiled' ? 'permissions-exiled.yml' : 'permissions-labapi.yml',
        permissionPolicy,
        content,
        diagnostics,
        valid: errors.length === 0,
        errors,
        warnings: validation.warnings,
        stats: {
            users: dataset.users.length,
            steamUsers: validation.validSteamUsers,
            groups: dataset.roles.length + 1,
            permissions: permissionPolicy === 'wildcard' && dataset.roles.length > 0 ? 1 : 0,
            permissionAssignments: permissionPolicy === 'wildcard' ? dataset.roles.length : 0,
            nativePermissions: dataset.nativePermissions.length
        }
    };
}

function generateExiledConfig(options = {}) {
    return buildPermissionsExport('exiled', options).content;
}

function generateLabAPIConfig(options = {}) {
    return buildPermissionsExport('labapi', options).content;
}

// ==========================================
// Export Modal Tabs Logic
// ==========================================
const tabBtns = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');

function activateExportTab(button) {
    if (!button) return;
    tabBtns.forEach(tab => {
        const selected = tab === button;
        tab.classList.toggle('active', selected);
        tab.setAttribute('aria-selected', String(selected));
        tab.tabIndex = selected ? 0 : -1;
    });
    tabContents.forEach(content => {
        const selected = content.id === button.dataset.target;
        content.classList.toggle('active', selected);
        content.hidden = !selected;
        content.style.display = selected ? 'block' : 'none';
    });
}

tabBtns.forEach(btn => {
    btn.addEventListener('click', () => activateExportTab(btn));
    btn.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
        const visibleTabs = [...tabBtns].filter(tab => !tab.hidden);
        const currentIndex = visibleTabs.indexOf(btn);
        const direction = event.key === 'ArrowRight' ? 1 : -1;
        const nextTab = visibleTabs[(currentIndex + direction + visibleTabs.length) % visibleTabs.length];
        event.preventDefault();
        activateExportTab(nextTab);
        nextTab.focus();
    });
});
activateExportTab(tabBtns[0]);

function renderExportIssues(result) {
    const warningRegion = document.getElementById('export-preview-warnings');
    if (!warningRegion) return;
    warningRegion.replaceChildren();
    const issues = [
        ...(result.errors || []).map(issue => ({ ...issue, severity: 'error' })),
        ...(result.warnings || []).map(issue => ({ ...issue, severity: 'warning' }))
    ];
    if (issues.length === 0) {
        warningRegion.textContent = t('common.noWarnings');
        warningRegion.classList.remove('has-warnings', 'has-errors');
        return;
    }

    const list = document.createElement('ul');
    issues.forEach(issue => {
        const item = document.createElement('li');
        item.className = `export-issue ${issue.severity}`;
        item.textContent = `${issue.severity === 'error' ? t('export.issueError') : t('export.issueWarning')}: ${issue.message}`;
        list.appendChild(item);
    });
    warningRegion.appendChild(list);
    warningRegion.classList.toggle('has-warnings', (result.warnings || []).length > 0);
    warningRegion.classList.toggle('has-errors', (result.errors || []).length > 0);
}

function canUndoRemoteAdminIdRenumber() {
    if (!remoteAdminIdRenumberUndoSnapshot || currentMode !== 'ra') return false;
    if (remoteAdminRevision !== remoteAdminIdRenumberUndoSnapshot.appliedRevision) return false;
    try {
        return generateConfig() === remoteAdminIdRenumberUndoSnapshot.afterContent;
    } catch (_) {
        return false;
    }
}

function syncRemoteAdminPreviewControls() {
    const organizationVisible = Boolean(remoteAdminOrganizationPanel && !remoteAdminOrganizationPanel.hidden);
    const renumberVisible = Boolean(remoteAdminIdRenumberPanel && !remoteAdminIdRenumberPanel.hidden);
    const analysisVisible = organizationVisible || renumberVisible;
    const hasRemoteAdminPreview = Boolean(activeRemoteAdminExportResult && currentMode === 'ra');
    if (exportStandardPreview) exportStandardPreview.hidden = analysisVisible;
    if (btnOrganizeRemoteAdmin) btnOrganizeRemoteAdmin.hidden = analysisVisible || !hasRemoteAdminPreview;
    if (btnRenumberRemoteAdmin) btnRenumberRemoteAdmin.hidden = analysisVisible || !hasRemoteAdminPreview;
    if (btnApplyRemoteAdminOrganization) btnApplyRemoteAdminOrganization.hidden = !organizationVisible;
    if (btnCancelRemoteAdminOrganization) btnCancelRemoteAdminOrganization.hidden = !organizationVisible;
    if (btnApplyIdRenumber) btnApplyIdRenumber.hidden = !renumberVisible;
    if (btnCancelIdRenumber) btnCancelIdRenumber.hidden = !renumberVisible;
    if (btnUndoIdRenumber) {
        btnUndoIdRenumber.hidden = analysisVisible || !hasRemoteAdminPreview || !remoteAdminIdRenumberUndoSnapshot;
        btnUndoIdRenumber.disabled = !btnUndoIdRenumber.hidden && !canUndoRemoteAdminIdRenumber();
        btnUndoIdRenumber.title = btnUndoIdRenumber.disabled
            ? t('export.undoRenumberTitle')
            : '';
    }
    if (btnCopy) btnCopy.hidden = analysisVisible;
    if (btnDownload) btnDownload.hidden = analysisVisible;
    if (btnCancelExport) btnCancelExport.hidden = analysisVisible;
    if (btnOpenDiagnosticsExport) btnOpenDiagnosticsExport.hidden = analysisVisible || currentMode !== 'ra' || !hasLoadedRemoteAdmin;
}

function setRemoteAdminOrganizationComparisonVisible(visible) {
    if (remoteAdminOrganizationPanel) remoteAdminOrganizationPanel.hidden = !visible;
    if (visible && remoteAdminIdRenumberPanel) remoteAdminIdRenumberPanel.hidden = true;
    syncRemoteAdminPreviewControls();
}

function setRemoteAdminIdRenumberPreviewVisible(visible) {
    if (remoteAdminIdRenumberPanel) remoteAdminIdRenumberPanel.hidden = !visible;
    if (visible && remoteAdminOrganizationPanel) remoteAdminOrganizationPanel.hidden = true;
    syncRemoteAdminPreviewControls();
}

function cancelRemoteAdminOrganizationPreview() {
    activeRemoteAdminOrganization = null;
    setRemoteAdminOrganizationComparisonVisible(false);
    if (activeRemoteAdminExportResult && configOutput) {
        configOutput.value = activeRemoteAdminExportResult.content;
        renderExportIssues(activeRemoteAdminExportResult);
        if (btnDownload) btnDownload.disabled = !activeRemoteAdminExportResult.valid;
    }
}

function appendRemoteAdminOrganizationMetric(label, value, container = remoteAdminOrganizationMetrics) {
    if (!container) return;
    const metric = document.createElement('span');
    metric.className = 'remoteadmin-organization-metric';
    const strong = document.createElement('strong');
    strong.textContent = String(value);
    metric.append(strong, ` ${label}`);
    container.appendChild(metric);
}

function renderRemoteAdminOrganizationComparison(result) {
    activeRemoteAdminOrganization = result;
    setRemoteAdminOrganizationComparisonVisible(true);
    if (remoteAdminOrganizationOriginal) remoteAdminOrganizationOriginal.value = result.original;
    if (remoteAdminOrganizationOrganized) remoteAdminOrganizationOrganized.value = result.organized;
    if (remoteAdminOrganizationStatus) {
        if (!result.changed) {
            remoteAdminOrganizationStatus.textContent = t('org.statusOk');
        } else if (result.canApply && result.inheritedErrors?.length > 0) {
            remoteAdminOrganizationStatus.textContent = t('org.statusSafe');
        } else if (result.canApply) {
            remoteAdminOrganizationStatus.textContent = t('org.statusDone');
        } else {
            remoteAdminOrganizationStatus.textContent = t('org.statusBlocked');
        }
    }
    if (remoteAdminOrganizationMetrics) remoteAdminOrganizationMetrics.replaceChildren();
    appendRemoteAdminOrganizationMetric(t('org.mUsers'), result.after.users);
    appendRemoteAdminOrganizationMetric(t('org.mGroups'), result.after.groups);
    appendRemoteAdminOrganizationMetric(t('org.mMembers'), result.changes.membersMoved);
    appendRemoteAdminOrganizationMetric(t('org.mBlocks'), result.changes.propertyBlocksMoved);
    appendRemoteAdminOrganizationMetric(t('org.mLists'), result.changes.permissionListsReordered);
    appendRemoteAdminOrganizationMetric(t('org.mBlanks'), result.changes.blankLinesRemoved);
    appendRemoteAdminOrganizationMetric(t('org.mWarnings'), result.warnings.length);
    appendRemoteAdminOrganizationMetric(t('org.mFileErrors'), result.inheritedErrors?.length || 0);
    appendRemoteAdminOrganizationMetric(t('org.mBlocking'), result.blockingErrors?.length || 0);

    if (remoteAdminOrganizationIssues) {
        remoteAdminOrganizationIssues.replaceChildren();
        const blockingIssueKeys = new Set((result.blockingErrors || []).map(issue => `${issue.code}\u0000${issue.message}`));
        const issues = [
            ...(result.errors || []).map(issue => ({ ...issue, severity: 'error' })),
            ...(result.warnings || []).map(issue => ({ ...issue, severity: 'warning' }))
        ];
        if (issues.length === 0) {
            remoteAdminOrganizationIssues.textContent = t('org.noIssues');
        } else {
            const list = document.createElement('ul');
            issues.forEach(issue => {
                const item = document.createElement('li');
                item.className = issue.severity;
                const issueLabel = issue.severity === 'error'
                    ? blockingIssueKeys.has(`${issue.code}\u0000${issue.message}`) ? t('issue.blocking') : t('issue.existing')
                    : t('issue.warning');
                item.textContent = `${issueLabel}: ${issue.message}`;
                list.appendChild(item);
            });
            remoteAdminOrganizationIssues.appendChild(list);
        }
    }
    if (btnApplyRemoteAdminOrganization) {
        btnApplyRemoteAdminOrganization.disabled = !result.canApply || !result.changed;
    }
    if (btnDownload) btnDownload.disabled = true;
    remoteAdminOrganizationOrganized?.focus({ preventScroll: true });
}

function startRemoteAdminOrganization() {
    if (!activeRemoteAdminExportResult || currentMode !== 'ra') {
        alert(t('export.needPreviewValid'));
        return;
    }
    if (btnOrganizeRemoteAdmin) {
        btnOrganizeRemoteAdmin.disabled = true;
        btnOrganizeRemoteAdmin.textContent = t('export.analyzing');
    }
    setTimeout(() => {
        try {
            const result = buildRemoteAdminOrganization(
                activeRemoteAdminExportResult.content,
                parsedData,
                remoteAdminDocument
            );
            renderRemoteAdminOrganizationComparison(result);
        } catch (error) {
            alert(t('org.fail', { error: error?.message || t('org.failStructural') }));
        } finally {
            if (btnOrganizeRemoteAdmin) {
                btnOrganizeRemoteAdmin.disabled = false;
                btnOrganizeRemoteAdmin.textContent = t('export.organize');
            }
        }
    }, 0);
}

function applyRemoteAdminOrganization() {
    const organization = activeRemoteAdminOrganization;
    if (!organization?.canApply || !organization.changed) {
        alert(t('org.cannotApply'));
        return;
    }
    const organizationWarnings = [...(organization.warnings || [])];
    commitRemoteAdminRepair(
        organization.original,
        organization.organized,
        t('org.historyLabel')
    );
    activeRemoteAdminOrganization = null;
    setRemoteAdminOrganizationComparisonVisible(false);
    const preview = buildRemoteAdminExport({
        filename: remoteAdminExportFilename?.value
    });
    preview.warnings = [
        createExportIssue('REMOTE_ADMIN_ORGANIZED', t('org.appliedNotice')),
        ...organizationWarnings,
        ...preview.warnings
    ].filter((issue, index, values) => values.findIndex(current =>
        current.code === issue.code && current.message === issue.message
    ) === index);
    preview.organizationApplied = true;
    preview.organization = organization;
    activeRemoteAdminExportResult = preview;
    configOutput.value = preview.content;
    renderExportIssues(preview);
    if (btnDownload) btnDownload.disabled = !preview.valid;
}

if (btnOrganizeRemoteAdmin) btnOrganizeRemoteAdmin.addEventListener('click', startRemoteAdminOrganization);
if (btnApplyRemoteAdminOrganization) btnApplyRemoteAdminOrganization.addEventListener('click', applyRemoteAdminOrganization);
if (btnCancelRemoteAdminOrganization) btnCancelRemoteAdminOrganization.addEventListener('click', cancelRemoteAdminOrganizationPreview);

function cancelRemoteAdminIdRenumberPreview() {
    activeRemoteAdminIdRenumber = null;
    setRemoteAdminIdRenumberPreviewVisible(false);
    if (activeRemoteAdminExportResult && configOutput) {
        configOutput.value = activeRemoteAdminExportResult.content;
        renderExportIssues(activeRemoteAdminExportResult);
        if (btnDownload) btnDownload.disabled = !activeRemoteAdminExportResult.valid;
    }
}

function getRemoteAdminRenumberOptions() {
    return {
        reuseDeclaredUnused: remoteAdminRenumberOptReuseDeclared ? remoteAdminRenumberOptReuseDeclared.checked : true,
        useUndeclaredUnused: remoteAdminRenumberOptUseUndeclared ? remoteAdminRenumberOptUseUndeclared.checked : true,
        respectReserved: remoteAdminRenumberOptRespectReserved ? remoteAdminRenumberOptRespectReserved.checked : true,
        updateAllReferences: remoteAdminRenumberOptUpdateRefs ? remoteAdminRenumberOptUpdateRefs.checked : true,
        validateAfter: remoteAdminRenumberOptValidate ? remoteAdminRenumberOptValidate.checked : true
    };
}

function renderRemoteAdminIdRenumberRows() {
    if (!remoteAdminIdRenumberBody || !activeRemoteAdminIdRenumber) return;
    remoteAdminIdRenumberBody.replaceChildren();
    const onlyChanged = Boolean(remoteAdminIdRenumberOnlyChanged?.checked);
    const rows = activeRemoteAdminIdRenumber.rows.filter(row => !onlyChanged || row.changed);
    rows.forEach(row => {
        const tableRow = document.createElement('tr');
        const prefixCell = document.createElement('td');
        prefixCell.textContent = row.prefix;
        const oldCell = document.createElement('td');
        const oldCode = document.createElement('code');
        oldCode.textContent = row.oldRole;
        oldCell.appendChild(oldCode);
        const newCell = document.createElement('td');
        const newCode = document.createElement('code');
        newCode.textContent = row.newRole;
        newCell.appendChild(newCode);
        const userCell = document.createElement('td');
        userCell.textContent = row.user;
        const statusCell = document.createElement('td');
        if (row.reserved) {
            statusCell.className = 'reserved';
            statusCell.textContent = t('ren.rowReserved');
        } else if (row.reuseType === 'REUSED_DECLARED_UNUSED') {
            statusCell.className = 'reused';
            statusCell.textContent = t('ren.rowReusedDeclared');
        } else if (row.reuseType === 'REUSED_UNDECLARED_UNUSED') {
            statusCell.className = 'reused';
            statusCell.textContent = t('ren.rowReusedUndeclared');
        } else if (row.changed) {
            statusCell.className = 'changed';
            statusCell.textContent = t('ren.rowChanged');
        } else {
            statusCell.className = 'unchanged';
            statusCell.textContent = t('ren.rowUnchanged');
        }
        tableRow.append(prefixCell, oldCell, newCell, userCell, statusCell);
        remoteAdminIdRenumberBody.appendChild(tableRow);
    });
    if (rows.length === 0) {
        const tableRow = document.createElement('tr');
        const cell = document.createElement('td');
        cell.colSpan = 5;
        cell.className = 'unchanged';
        cell.textContent = t('ren.rowsEmpty');
        tableRow.appendChild(cell);
        remoteAdminIdRenumberBody.appendChild(tableRow);
    }
}

function renderRemoteAdminIdRenumberPreview(result) {
    activeRemoteAdminIdRenumber = result;
    setRemoteAdminIdRenumberPreviewVisible(true);
    if (remoteAdminIdRenumberStatus) {
        const reusedCount = (result.stats.reusedDeclared || 0) + (result.stats.reusedUndeclared || 0);
        remoteAdminIdRenumberStatus.textContent = !result.changed
            ? t('ren.statusDone')
            : result.canApply && result.inheritedErrors?.length > 0
                ? t('ren.statusSafe', { changed: result.stats.changed, reused: reusedCount })
            : result.canApply
                ? t('ren.statusReady', { changed: result.stats.changed, reused: reusedCount })
                : t('ren.statusBlocked');
    }
    if (remoteAdminIdRenumberMetrics) {
        remoteAdminIdRenumberMetrics.replaceChildren();
        appendRemoteAdminOrganizationMetric(t('ren.mIds'), result.stats.ids, remoteAdminIdRenumberMetrics);
        appendRemoteAdminOrganizationMetric(t('ren.mChanged'), result.stats.changed, remoteAdminIdRenumberMetrics);
        appendRemoteAdminOrganizationMetric(t('ren.mUnchanged'), result.stats.unchanged, remoteAdminIdRenumberMetrics);
        appendRemoteAdminOrganizationMetric(t('ren.mReused'), (result.stats.reusedDeclared || 0) + (result.stats.reusedUndeclared || 0), remoteAdminIdRenumberMetrics);
        appendRemoteAdminOrganizationMetric(t('ren.mReserved'), result.stats.reserved, remoteAdminIdRenumberMetrics);
        appendRemoteAdminOrganizationMetric(t('ren.mRanges'), result.stats.ranges, remoteAdminIdRenumberMetrics);
        appendRemoteAdminOrganizationMetric(t('ren.mFileErrors'), result.inheritedErrors?.length || 0, remoteAdminIdRenumberMetrics);
        appendRemoteAdminOrganizationMetric(t('ren.mBlocking'), result.blockingErrors?.length || 0, remoteAdminIdRenumberMetrics);
    }

    if (remoteAdminIdRenumberAvailableSummary) {
        remoteAdminIdRenumberAvailableSummary.replaceChildren();
        if (result.availableDetected?.length > 0) {
            const group = document.createElement('div');
            group.className = 'remoteadmin-id-renumber-available-group';
            const title = document.createElement('span');
            title.className = 'remoteadmin-id-renumber-available-title';
            title.textContent = t('ren.availTitle');
            group.appendChild(title);
            result.availableDetected.slice(0, 16).forEach(item => {
                const pill = document.createElement('span');
                const pillClass = item.state === 'DECLARED_UNUSED'
                    ? 'declared-unused'
                    : item.state === 'RESERVED' ? 'reserved' : 'undeclared-unused';
                pill.className = `remoteadmin-id-renumber-pill ${pillClass}`;
                pill.textContent = `${item.roleName} (${item.state === 'DECLARED_UNUSED' ? t('ren.availDeclared') : item.state === 'RESERVED' ? t('ren.availReserved') : t('ren.availFree')})`;
                group.appendChild(pill);
            });
            if (result.availableDetected.length > 16) {
                const more = document.createElement('span');
                more.className = 'remoteadmin-id-renumber-pill';
                more.textContent = t('ren.availMore', { count: result.availableDetected.length - 16 });
                group.appendChild(more);
            }
            remoteAdminIdRenumberAvailableSummary.appendChild(group);
        }
        if (result.reusedIds?.length > 0) {
            const reusedGroup = document.createElement('div');
            reusedGroup.className = 'remoteadmin-id-renumber-available-group';
            const reusedTitle = document.createElement('span');
            reusedTitle.className = 'remoteadmin-id-renumber-available-title';
            reusedTitle.textContent = t('ren.reusedTitle');
            reusedGroup.appendChild(reusedTitle);
            result.reusedIds.forEach(item => {
                const pill = document.createElement('span');
                pill.className = 'remoteadmin-id-renumber-pill reused';
                pill.textContent = `${item.fromRole} → ${item.roleName} (${item.type === 'REUSED_DECLARED_UNUSED' ? t('ren.reusedDeclared') : t('ren.reusedFree')})`;
                reusedGroup.appendChild(pill);
            });
            remoteAdminIdRenumberAvailableSummary.appendChild(reusedGroup);
        }
    }

    if (remoteAdminIdRenumberRanges) {
        remoteAdminIdRenumberRanges.replaceChildren();
        result.ranges.forEach(range => {
            const badge = document.createElement('span');
            badge.className = `remoteadmin-id-renumber-range${range.changed ? ' changed' : ''}`;
            const reuseNote = range.reused ? t('ren.rangeReuse', { reused: range.reused }) : '';
            badge.textContent = range.changed
                ? t('ren.rangeChanged', { prefix: range.prefix, changed: range.changed, reuse: reuseNote })
                : t('ren.rangeClean', { prefix: range.prefix });
            remoteAdminIdRenumberRanges.appendChild(badge);
        });
    }
    if (remoteAdminIdRenumberOnlyChanged) remoteAdminIdRenumberOnlyChanged.checked = true;
    renderRemoteAdminIdRenumberRows();

    if (remoteAdminIdRenumberIssues) {
        remoteAdminIdRenumberIssues.replaceChildren();
        const blockingIssueKeys = new Set((result.blockingErrors || []).map(issue => `${issue.code}\u0000${issue.message}`));
        const issues = [
            ...(result.errors || []).map(issue => ({ ...issue, severity: 'error' })),
            ...(result.warnings || []).map(issue => ({ ...issue, severity: 'warning' }))
        ];
        if (issues.length === 0) {
            remoteAdminIdRenumberIssues.textContent = t('ren.noIssues');
        } else {
            const list = document.createElement('ul');
            issues.forEach(issue => {
                const item = document.createElement('li');
                item.className = issue.severity;
                const issueLabel = issue.severity === 'error'
                    ? blockingIssueKeys.has(`${issue.code}\u0000${issue.message}`) ? t('issue.blocking') : t('issue.existing')
                    : t('issue.warning');
                item.textContent = `${issueLabel}: ${issue.message}`;
                list.appendChild(item);
            });
            remoteAdminIdRenumberIssues.appendChild(list);
        }
    }
    if (remoteAdminIdRenumberOriginal) remoteAdminIdRenumberOriginal.value = result.original;
    if (remoteAdminIdRenumberResult) remoteAdminIdRenumberResult.value = result.renumbered;
    if (btnApplyIdRenumber) btnApplyIdRenumber.disabled = !result.canApply;
    if (btnDownload) btnDownload.disabled = true;
    remoteAdminIdRenumberBody?.focus?.({ preventScroll: true });
}

function startRemoteAdminIdRenumber() {
    if (!activeRemoteAdminExportResult || currentMode !== 'ra') {
        alert(t('ren.needPreview'));
        return;
    }
    if (btnRenumberRemoteAdmin) {
        btnRenumberRemoteAdmin.disabled = true;
        btnRenumberRemoteAdmin.textContent = t('ren.analyzing');
    }
    setTimeout(() => {
        try {
            const options = getRemoteAdminRenumberOptions();
            const result = buildRemoteAdminIdRenumbering(
                activeRemoteAdminExportResult.content,
                parsedData,
                remoteAdminDocument,
                options
            );
            renderRemoteAdminIdRenumberPreview(result);
        } catch (error) {
            alert(t('ren.fail', { error: error?.message || t('ren.failStructural') }));
        } finally {
            if (btnRenumberRemoteAdmin) {
                btnRenumberRemoteAdmin.disabled = false;
                btnRenumberRemoteAdmin.textContent = t('export.renumber');
            }
        }
    }, 0);
}

function commitRemoteAdminContentToCentralState(content) {
    const value = String(content ?? '');
    originalConfigText = value;
    originalLineEnding = value.includes('\r\n') ? '\r\n' : value.includes('\r') ? '\r' : '\n';
    uploadedFileText = value;
    if (configInput) configInput.value = value;
    parseConfig(value);
    updateOldRoles();
    renderRAEditor();
    currentMode = 'ra';
}

function applyRemoteAdminIdRenumber() {
    const result = activeRemoteAdminIdRenumber;
    if (!result?.canApply) {
        alert(t('ren.cannotApply'));
        return;
    }
    const beforeContent = result.original;
    const afterContent = result.renumbered;
    const changedCount = result.stats.changed;
    const rangeCount = result.stats.ranges;
    commitRemoteAdminRepair(
        beforeContent,
        afterContent,
        t('ren.appliedHistory', { changed: changedCount })
    );
    remoteAdminIdRenumberUndoSnapshot = {
        beforeContent,
        afterContent,
        appliedRevision: remoteAdminRevision,
        filename: remoteAdminExportFilename?.value || uploadedFileName || 'config_remoteadmin.txt'
    };
    activeRemoteAdminIdRenumber = null;
    const preview = renderRemoteAdminExportPreview(false, false);
    if (preview) {
        preview.warnings = [
            createExportIssue(
                'ROLE_IDS_RENUMBERED',
                t('ren.appliedNotice', { changed: changedCount, ranges: rangeCount })
            ),
            ...preview.warnings
        ];
        activeRemoteAdminExportResult = preview;
        renderExportIssues(preview);
    }
    syncRemoteAdminPreviewControls();
    const remainingErrorNotice = preview?.errors?.length
        ? t('ren.appliedRemaining', { count: preview.errors.length })
        : '';
    alert(
        t('ren.appliedOk', { ranges: rangeCount, changed: changedCount, unchanged: result.stats.unchanged, remaining: remainingErrorNotice })
    );
}

function undoRemoteAdminIdRenumber() {
    const snapshot = remoteAdminIdRenumberUndoSnapshot;
    if (!snapshot || !canUndoRemoteAdminIdRenumber()) {
        alert(t('ren.cannotUndo'));
        syncRemoteAdminPreviewControls();
        return;
    }
    if (!confirm(t('ren.undoConfirm'))) return;
    const restoredContent = snapshot.beforeContent;
    remoteAdminIdRenumberUndoSnapshot = null;
    if (remoteAdminRepairHistory.at(-1)?.after === snapshot.afterContent) {
        remoteAdminRepairHistory.pop();
    }
    commitRemoteAdminContentToCentralState(restoredContent);
    renderRemoteAdminExportPreview(false, false);
    syncRemoteAdminPreviewControls();
    alert(t('ren.undone'));
}

if (btnRenumberRemoteAdmin) btnRenumberRemoteAdmin.addEventListener('click', startRemoteAdminIdRenumber);
if (btnApplyIdRenumber) btnApplyIdRenumber.addEventListener('click', applyRemoteAdminIdRenumber);
if (btnCancelIdRenumber) btnCancelIdRenumber.addEventListener('click', cancelRemoteAdminIdRenumberPreview);
if (btnUndoIdRenumber) btnUndoIdRenumber.addEventListener('click', undoRemoteAdminIdRenumber);
if (remoteAdminIdRenumberOnlyChanged) {
    remoteAdminIdRenumberOnlyChanged.addEventListener('change', renderRemoteAdminIdRenumberRows);
}
[
    remoteAdminRenumberOptReuseDeclared,
    remoteAdminRenumberOptUseUndeclared,
    remoteAdminRenumberOptRespectReserved,
    remoteAdminRenumberOptUpdateRefs,
    remoteAdminRenumberOptValidate
].forEach(checkbox => {
    if (checkbox) {
        checkbox.addEventListener('change', () => {
            if (activeRemoteAdminExportResult && currentMode === 'ra' && !remoteAdminIdRenumberPanel?.hidden) {
                try {
                    const options = getRemoteAdminRenumberOptions();
                    const result = buildRemoteAdminIdRenumbering(
                        activeRemoteAdminExportResult.content,
                        parsedData,
                        remoteAdminDocument,
                        options
                    );
                    renderRemoteAdminIdRenumberPreview(result);
                } catch (err) {
                    console.error('Error actualizando previsualización de IDs:', err);
                }
            }
        });
    }
});

function renderRemoteAdminExportPreview(shouldOpenModal = true, initializeFilename = false) {
    if (!hasLoadedRemoteAdmin || currentMode !== 'ra') {
        alert(t('export.needPreview'));
        return null;
    }

    if (initializeFilename && remoteAdminExportFilename) {
        remoteAdminExportFilename.value = getRemoteAdminFilename(
            remoteAdminDocument,
            remoteAdminDocument?.filename || uploadedFileName || 'config_remoteadmin.txt'
        );
    }
    const result = buildRemoteAdminExport({
        filename: remoteAdminExportFilename?.value
    });
    activeRemoteAdminExportResult = result;
    activeRemoteAdminOrganization = null;
    activeRemoteAdminIdRenumber = null;
    activePermissionsExportFramework = null;
    activePermissionsExportResult = null;

    const primaryTab = tabBtns[0];
    primaryTab.textContent = t('export.tabRa');
    tabBtns.forEach((tab, index) => { tab.hidden = index > 0; });
    configOutput.value = result.content;
    document.getElementById('exiled-output').value = '';
    document.getElementById('labapi-output').value = '';
    activateExportTab(primaryTab);

    document.getElementById('export-modal-title').textContent = t('export.titleRa');
    document.getElementById('export-preview-framework').textContent = result.frameworkLabel;
    document.getElementById('export-stat-users').textContent = String(result.stats.users);
    document.getElementById('export-stat-groups').textContent = String(result.stats.groups);
    document.getElementById('export-stat-permissions').textContent = String(result.stats.permissions);
    if (exportPreviewSummary) exportPreviewSummary.hidden = false;
    if (remoteAdminExportOptions) remoteAdminExportOptions.hidden = false;
    if (permissionsExportOptions) permissionsExportOptions.hidden = true;
    if (remoteAdminExportFilename && initializeFilename) {
        remoteAdminExportFilename.value = result.filename;
    }
    if (remoteAdminExportFormat) {
        const finalLineLabel = result.format.finalNewline ? t('export.finalLine') : t('export.noFinalLine');
        remoteAdminExportFormat.textContent = t('export.formatDetail', { ext: result.format.extension, enc: result.format.encoding, bom: result.format.bom ? t('export.withBom') : t('export.withoutBom'), le: result.format.lineEnding, final: finalLineLabel });
    }
    renderExportIssues(result);
    setRemoteAdminOrganizationComparisonVisible(false);
    setRemoteAdminIdRenumberPreviewVisible(false);
    if (btnOrganizeRemoteAdmin) btnOrganizeRemoteAdmin.hidden = false;

    const downloadButton = document.getElementById('btn-download');
    if (downloadButton) downloadButton.disabled = !result.valid;
    if (shouldOpenModal) showModal(exportModal, remoteAdminExportFilename || btnCopy);
    return result;
}

function renderPermissionsExportPreview(framework, shouldOpenModal = true) {
    const policy = exportPermissionPolicy?.value === 'wildcard' ? 'wildcard' : 'safe';
    const result = buildPermissionsExport(framework, { permissionPolicy: policy });
    activePermissionsExportFramework = framework;
    activePermissionsExportResult = result;
    activeRemoteAdminExportResult = null;
    activeRemoteAdminOrganization = null;
    activeRemoteAdminIdRenumber = null;
    setRemoteAdminOrganizationComparisonVisible(false);
    setRemoteAdminIdRenumberPreviewVisible(false);
    if (btnOrganizeRemoteAdmin) btnOrganizeRemoteAdmin.hidden = true;

    const targetId = framework === 'exiled' ? 'exiled-output' : 'labapi-output';
    const targetTab = [...tabBtns].find(tab => tab.dataset.target === targetId);
    const targetOutput = document.getElementById(targetId);
    targetOutput.value = result.content;
    tabBtns.forEach(tab => { tab.hidden = tab !== targetTab; });
    if (targetTab) activateExportTab(targetTab);

    document.getElementById('export-modal-title').textContent = t('export.titlePerms', { framework: result.frameworkLabel === 'LabAPI' ? 'Lab API' : 'EXILED' });
    document.getElementById('export-preview-framework').textContent = result.frameworkLabel;
    document.getElementById('export-stat-users').textContent = String(result.stats.users);
    document.getElementById('export-stat-groups').textContent = String(result.stats.groups);
    document.getElementById('export-stat-permissions').textContent = String(result.stats.permissions);
    if (exportPreviewSummary) exportPreviewSummary.hidden = false;
    if (remoteAdminExportOptions) remoteAdminExportOptions.hidden = true;
    if (permissionsExportOptions) permissionsExportOptions.hidden = false;
    renderExportIssues(result);

    const policyHelp = document.getElementById('export-permission-policy-help');
    if (policyHelp) {
        policyHelp.textContent = policy === 'wildcard'
            ? t('export.policyWildcardHelp')
            : t('export.policySafeHelp');
    }
    const downloadButton = document.getElementById('btn-download');
    if (downloadButton) downloadButton.disabled = !result.valid;
    if (shouldOpenModal) showModal(exportModal, exportPermissionPolicy || btnCopy);
    return result;
}

function openPermissionsExportPreview(framework) {
    if (!hasLoadedRemoteAdmin || currentMode !== 'ra') {
        alert(t('export.needPreview'));
        return;
    }
    if (exportPermissionPolicy) exportPermissionPolicy.value = 'safe';
    renderPermissionsExportPreview(framework, true);
}

if (btnExportExiled) {
    btnExportExiled.addEventListener('click', () => openPermissionsExportPreview('exiled'));
}
if (btnExportLabAPI) {
    btnExportLabAPI.addEventListener('click', () => openPermissionsExportPreview('labapi'));
}
if (exportPermissionPolicy) {
    exportPermissionPolicy.addEventListener('change', () => {
        if (activePermissionsExportFramework) {
            renderPermissionsExportPreview(activePermissionsExportFramework, false);
        }
    });
}
if (remoteAdminExportFilename) {
    remoteAdminExportFilename.addEventListener('change', () => {
        if (!activeRemoteAdminExportResult) return;
        if (activeRemoteAdminExportResult.organizationApplied) {
            activeRemoteAdminExportResult.filename = getRemoteAdminFilename(
                remoteAdminDocument,
                remoteAdminExportFilename.value
            );
            remoteAdminExportFilename.value = activeRemoteAdminExportResult.filename;
            return;
        }
        const result = renderRemoteAdminExportPreview(false, false);
        if (result) remoteAdminExportFilename.value = result.filename;
    });
}

// ==========================================
// Bulk Add Logic
// ==========================================
const bulkModal = document.getElementById('bulk-modal');
const btnCloseBulkModal = document.getElementById('btn-close-bulk-modal');
const btnProcessBulk = document.getElementById('btn-process-bulk');
const bulkInput = document.getElementById('bulk-input');
let bulkTargetGroup = null;

function openBulkModal(prefix) {
    bulkTargetGroup = prefix;
    document.getElementById('bulk-modal-title').textContent = t('cards.bulkTitle', { prefix });
    bulkInput.value = '';
    showModal(bulkModal, bulkInput);
}

if (btnCloseBulkModal) {
    btnCloseBulkModal.addEventListener('click', () => hideModal(bulkModal));
}

if (btnProcessBulk) {
    btnProcessBulk.addEventListener('click', () => {
        const text = bulkInput.value.trim();
        if (!text) return;
        
        const lines = text.split('\n');
        const group = parsedData.groups[bulkTargetGroup];
        let addedCount = 0;
        
        let defaultColor = "default";
        let defaultKick = 0;
        let defaultReqKick = 0;
        let defaultCover = false;
        let defaultHidden = false;
        let defaultBadge = bulkTargetGroup;
        
        if (group.members.length > 0) {
            const last = group.members[group.members.length - 1];
            defaultColor = last.color;
            defaultKick = last.kickPower;
            defaultReqKick = last.reqKickPower;
            defaultCover = last.cover;
            defaultHidden = last.hidden;
            defaultBadge = last.badge;
        }
        
        lines.forEach(line => {
            const l = line.trim();
            if (!l) return;
            
            const idMatch = l.match(/(?:\d{15,22}@(steam|discord)|[A-Za-z0-9._-]{2,64}@northwood)/i);
            let id = "";
            let name = l;
            
            if (idMatch) {
                id = idMatch[0];
                name = l.replace(id, '').trim();
            }
            if (!id) return;
            
            group.members.push({
                id: id,
                name: name || t('cards.noName'),
                notes: t('bulkMembers.autoNote'),
                badge: defaultBadge,
                color: defaultColor,
                cover: defaultCover,
                hidden: defaultHidden,
                kickPower: defaultKick,
                reqKickPower: defaultReqKick,
                oldRole: null,
                roleName: '',
                sourceMemberId: null,
                prefix: bulkTargetGroup,
                permissions: new Set(group.permissions)
            });
            addedCount++;
        });
        
        recomputeGroupPermissions(group);
        hideModal(bulkModal);
        alert(t('bulkMembers.added', { count: addedCount, group: bulkTargetGroup }));
        updateOldRoles();
        renderRAEditor();
    });
}

// ==========================================
// Bulk Badge Import Logic
// ==========================================
const badgeBulkModal = document.getElementById('badge-bulk-modal');
const badgeBulkInput = document.getElementById('badge-bulk-input');
const badgeBulkTargetGroup = document.getElementById('badge-bulk-target-group');
const badgeBulkPreviewBody = document.getElementById('badge-bulk-preview-body');
const badgeBulkSummary = document.getElementById('badge-bulk-summary');
const btnAnalyzeBadges = document.getElementById('btn-analyze-badges');
const btnClearBadges = document.getElementById('btn-clear-badges');
const btnConfirmBadges = document.getElementById('btn-confirm-badges');
const btnCancelBadges = document.getElementById('btn-cancel-badges');
const btnCloseBadgeBulk = document.getElementById('btn-close-badge-bulk');

function populateBadgeBulkTargetGroups() {
    if (!badgeBulkTargetGroup) return;
    const previousValue = badgeBulkTargetGroup.value;
    badgeBulkTargetGroup.replaceChildren();
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = t('badgeBulk.selectGroup');
    badgeBulkTargetGroup.appendChild(placeholder);
    Object.keys(parsedData.groups || {}).sort((a, b) => a.localeCompare(b)).forEach(prefix => {
        const option = document.createElement('option');
        option.value = prefix;
        const group = parsedData.groups[prefix];
        option.textContent = t('cards.groupName', { prefix }) + (!group.isNumbered && group.members.length > 0 ? t('cards.sharedRole') : '');
        badgeBulkTargetGroup.appendChild(option);
    });
    const preferredValue = [previousValue, currentDesktopGroup, currentSelectedGroup]
        .find(value => value && parsedData.groups[value]);
    badgeBulkTargetGroup.value = preferredValue || '';
}

function getBadgeBulkActionOptions(record) {
    if (record.status === 'invalid') return [['cancel', t('badgeBulk.actCancel')]];
    if (record.existingMatch) {
        return [
            ['omit', t('badgeBulk.actOmit')],
            ['replace', t('badgeBulk.actReplace')],
            ['update', t('badgeBulk.actUpdate')],
            ['cancel', t('badgeBulk.actCancel')]
        ];
    }
    if (record.duplicateOf) {
        return [
            ['import', t('badgeBulk.actImport')],
            ['omit', t('badgeBulk.actOmit')],
            ['cancel', t('badgeBulk.actCancel')]
        ];
    }
    if (record.sharedRoleAlternative) {
        return [
            ['import', t('badgeBulk.actImportCombo')],
            ['cancel', t('badgeBulk.actCancel')]
        ];
    }
    return [
        ['import', t('badgeBulk.actAdd')],
        ['cancel', t('badgeBulk.actCancel')]
    ];
}

function updateBadgeBulkSummary() {
    if (!badgeBulkSummary) return;
    const summary = getBadgeBulkSummary(badgeBulkPreviewRecords);
    badgeBulkSummary.innerHTML = `
        <span class="summary-item"><span class="summary-count">${summary.total}</span> ${t('badgeBulk.sumTotal')}</span>
        <span class="summary-item"><span class="summary-count">${summary.valid}</span> ${t('badgeBulk.sumValid')}</span>
        <span class="summary-item"><span class="summary-count">${summary.invalid}</span> ${t('badgeBulk.sumInvalid')}</span>
        <span class="summary-item"><span class="summary-count">${summary.duplicates}</span> ${t('badgeBulk.sumDupes')}</span>
        <span class="summary-item"><span class="summary-count">${summary.omitted}</span> ${t('badgeBulk.sumOmitted')}</span>
    `;
    if (btnConfirmBadges) {
        btnConfirmBadges.disabled = summary.ready === 0 || badgeBulkPreviewRevision !== remoteAdminRevision;
    }
}

function appendBadgeBulkApplyIssues(result) {
    if (!badgeBulkSummary || (result.invalid === 0 && result.issues.length === 0)) return;
    const notice = document.createElement('div');
    notice.className = 'badge-bulk-apply-issues';
    const heading = document.createElement('strong');
    heading.textContent = t('badgeBulk.applyHeading');
    notice.appendChild(heading);
    if (result.issues.length > 0) {
        const list = document.createElement('ul');
        result.issues.forEach(issue => {
            const item = document.createElement('li');
            const recordLabel = issue.recordNumber ? t('badgeBulk.applyRecord', { n: issue.recordNumber }) : '';
            item.textContent = t('badgeBulk.applyLine', { prefix: recordLabel, line: issue.line, message: issue.message });
            list.appendChild(item);
        });
        notice.appendChild(list);
    } else {
        const detail = document.createElement('span');
        detail.textContent = t('badgeBulk.applyInvalid', { count: result.invalid });
        notice.appendChild(detail);
    }
    badgeBulkSummary.appendChild(notice);
}

function appendBadgeBulkCell(row, text, className = '') {
    const cell = document.createElement('td');
    cell.textContent = String(text ?? '');
    if (className) cell.className = className;
    row.appendChild(cell);
    return cell;
}

function renderBadgeBulkPreview() {
    if (!badgeBulkPreviewBody) return;
    badgeBulkPreviewBody.replaceChildren();
    const statusLabels = {
        valid: t('badgeBulk.statusValid'),
        warning: t('badgeBulk.statusWarning'),
        duplicate: t('badgeBulk.statusDuplicate'),
        conflict: t('badgeBulk.statusConflict'),
        invalid: t('badgeBulk.statusInvalid')
    };
    const statusClasses = {
        valid: 'valid',
        warning: 'warning',
        duplicate: 'duplicate',
        conflict: 'duplicate',
        invalid: 'error'
    };

    badgeBulkPreviewRecords.forEach(record => {
        const row = document.createElement('tr');
        row.dataset.status = statusClasses[record.status] || 'warning';
        appendBadgeBulkCell(row, record.endLine > record.startLine ? `${record.startLine}–${record.endLine}` : record.startLine);
        appendBadgeBulkCell(row, record.owner);
        appendBadgeBulkCell(row, record.badge);
        appendBadgeBulkCell(row, record.color);
        appendBadgeBulkCell(row, record.normalizedSteamId || record.steamId);

        const statusCell = appendBadgeBulkCell(row, '');
        const status = document.createElement('span');
        status.className = `badge-bulk-status ${statusClasses[record.status] || 'warning'}`;
        status.textContent = statusLabels[record.status] || record.status;
        statusCell.appendChild(status);

        const issueCell = appendBadgeBulkCell(row, '');
        if (record.issues.length === 0) {
            issueCell.textContent = t('badgeBulk.noIssues');
        } else {
            const list = document.createElement('ul');
            record.issues.forEach(issue => {
                const item = document.createElement('li');
                item.textContent = t('badgeBulk.lineIssue', { line: issue.line, message: issue.message });
                list.appendChild(item);
            });
            issueCell.appendChild(list);
        }

        const actionCell = appendBadgeBulkCell(row, '');
        const actionSelect = document.createElement('select');
        actionSelect.setAttribute('aria-label', t('badgeBulk.actionFor', { id: record.normalizedSteamId || record.recordNumber }));
        getBadgeBulkActionOptions(record).forEach(([value, label]) => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = label;
            actionSelect.appendChild(option);
        });
        actionSelect.value = record.action;
        actionSelect.disabled = record.status === 'invalid';
        actionSelect.addEventListener('change', () => {
            record.action = actionSelect.value;
            updateBadgeBulkSummary();
        });
        actionCell.appendChild(actionSelect);
        badgeBulkPreviewBody.appendChild(row);
    });
    updateBadgeBulkSummary();
}

function analyzeBadgeBulkInput() {
    if (!hasLoadedRemoteAdmin || currentMode !== 'ra') {
        alert(t('export.needPreview'));
        return;
    }
    const text = badgeBulkInput?.value || '';
    if (!text.trim()) {
        invalidateBadgeBulkPreview();
        if (badgeBulkSummary) badgeBulkSummary.textContent = t('badgeBulk.needRecords');
        return;
    }
    const records = parseBadgeBulkText(text);
    badgeBulkPreviewRecords = validateBadgeBulkRecords(records, {
        targetGroup: badgeBulkTargetGroup?.value || ''
    });
    badgeBulkPreviewRevision = remoteAdminRevision;
    renderBadgeBulkPreview();
}

function openBadgeBulkModal() {
    if (!hasLoadedRemoteAdmin || currentMode !== 'ra') {
        alert(t('export.needPreview'));
        return;
    }
    populateBadgeBulkTargetGroups();
    invalidateBadgeBulkPreview();
    showModal(badgeBulkModal, badgeBulkInput);
}

if (btnBadgeBulk) btnBadgeBulk.addEventListener('click', openBadgeBulkModal);
if (btnAnalyzeBadges) btnAnalyzeBadges.addEventListener('click', analyzeBadgeBulkInput);
if (btnClearBadges) {
    btnClearBadges.addEventListener('click', () => {
        badgeBulkInput.value = '';
        invalidateBadgeBulkPreview();
        badgeBulkInput.focus();
    });
}
if (btnCloseBadgeBulk) btnCloseBadgeBulk.addEventListener('click', () => hideModal(badgeBulkModal));
if (btnCancelBadges) btnCancelBadges.addEventListener('click', () => hideModal(badgeBulkModal));
if (badgeBulkInput) {
    badgeBulkInput.addEventListener('input', () => {
        if (badgeBulkPreviewRecords.length > 0) invalidateBadgeBulkPreview();
    });
}
if (badgeBulkTargetGroup) {
    badgeBulkTargetGroup.addEventListener('change', () => {
        if (badgeBulkInput.value.trim()) analyzeBadgeBulkInput();
    });
}
if (btnConfirmBadges) {
    btnConfirmBadges.addEventListener('click', () => {
        if (badgeBulkPreviewRevision !== remoteAdminRevision) {
            alert(t('badgeBulk.changedAfter'));
            invalidateBadgeBulkPreview();
            return;
        }
        const actionByRecord = new Map(badgeBulkPreviewRecords.map(record => [record.recordNumber, record.action]));
        const refreshedRecords = validateBadgeBulkRecords(parseBadgeBulkText(badgeBulkInput.value), {
            targetGroup: badgeBulkTargetGroup.value
        });
        refreshedRecords.forEach(record => {
            const selectedAction = actionByRecord.get(record.recordNumber);
            const allowedActions = new Set(getBadgeBulkActionOptions(record).map(([value]) => value));
            if (selectedAction && allowedActions.has(selectedAction) && record.errors.length === 0) {
                record.action = selectedAction;
            }
        });
        const conflictingMutationIds = getConflictingExistingMutationIds(refreshedRecords);
        if (conflictingMutationIds.size > 0) {
            badgeBulkPreviewRecords = refreshedRecords;
            badgeBulkPreviewRevision = remoteAdminRevision;
            renderBadgeBulkPreview();
            const decisionIssues = refreshedRecords
                .filter(record => conflictingMutationIds.has(record.normalizedSteamId)
                    && ['replace', 'update'].includes(record.action))
                .map(record => {
                    const issue = createBulkIssue(
                        'MULTIPLE_MUTATIONS_SAME_STEAM_ID', 'error', record.startLine,
                        t('badgeIssue.multiMutations', { steam: record.normalizedSteamId })
                    );
                    issue.recordNumber = record.recordNumber;
                    return issue;
                });
            appendBadgeBulkApplyIssues({ invalid: decisionIssues.length, issues: decisionIssues });
            alert(t('badgeBulk.multiMutationsAlert'));
            return;
        }
        const conflictingSharedImports = getConflictingSharedRoleImports(
            refreshedRecords, parsedData, badgeBulkTargetGroup.value
        );
        if (conflictingSharedImports.length > 0) {
            badgeBulkPreviewRecords = refreshedRecords;
            badgeBulkPreviewRevision = remoteAdminRevision;
            renderBadgeBulkPreview();
            const decisionIssues = conflictingSharedImports.map(record => {
                const issue = createBulkIssue(
                    'MULTIPLE_SHARED_ROLE_SIGNATURES', 'error', record.startLine,
                    t('badgeIssue.multiShared', { group: badgeBulkTargetGroup.value })
                );
                issue.recordNumber = record.recordNumber;
                return issue;
            });
            appendBadgeBulkApplyIssues({ invalid: decisionIssues.length, issues: decisionIssues });
            alert(t('badgeBulk.multiSharedAlert'));
            return;
        }
        const result = applyBadgeBulkImport(refreshedRecords, { targetGroup: badgeBulkTargetGroup.value });
        const changed = result.imported + result.replaced + result.updated;
        alert(
            t('badgeBulk.finished', {
                imported: result.imported, replaced: result.replaced, updated: result.updated,
                omitted: result.omitted, cancelled: result.cancelled, invalid: result.invalid
            })
        );
        if (changed > 0 && result.invalid === 0 && result.issues.length === 0) {
            badgeBulkInput.value = '';
            invalidateBadgeBulkPreview();
            hideModal(badgeBulkModal);
        } else {
            badgeBulkPreviewRecords = validateBadgeBulkRecords(parseBadgeBulkText(badgeBulkInput.value), {
                targetGroup: badgeBulkTargetGroup.value
            });
            badgeBulkPreviewRevision = remoteAdminRevision;
            renderBadgeBulkPreview();
            appendBadgeBulkApplyIssues(result);
        }
    });
}

// ============================
// Init idioma / Language init
// ============================
(function initLanguage() {
    try {
        const langSelect = (typeof document !== 'undefined' && typeof document.getElementById === 'function')
            ? document.getElementById('lang-select') : null;
        if (langSelect && typeof langSelect.addEventListener === 'function') {
            langSelect.addEventListener('change', () => {
                const next = langSelect.value;
                if (next && next !== currentLang) setLanguage(next);
            });
        }
    } catch (_) {}
    try {
        applyI18n();
    } catch (_) {}
})();
