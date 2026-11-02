# RIKDP-274 · Resultados del rediseño

## Entrega

Rediseño Industrial Tech de las seis pantallas existentes: landing, ingreso,
recuperación, restablecimiento, panel e inspección. Rama
`feature/RIKDP-274-rediseno-ui-ux`, creada desde `origin/main` e9d67cc.
Un único PR hacia main con título exacto:
**Rediseñar la interfaz visual de la página web de RikuyDeep (UI/UX responsive)**.
El PR se entrega abierto para revisión, sin aprobar, fusionar ni desplegar manualmente.

## Cambios

- Tokens oscuros constantes, cyan para acciones, acento naranja de marca conservado,
  superficies elevadas y tipografía Geist/Geist Mono. No se reemplaza el logo.
- Hero con jerarquía y retícula industrial; secciones, beneficios, tabla comparativa,
  planes, demo y footer unificados. Menú móvil con aria-expanded, cierre con Escape
  y devolución del foco. Tabla desplazable con foco de teclado e indicación móvil.
- AuthShell a dos columnas en escritorio y una en móvil. Campos/botones compartidos,
  validación y mensajes existentes conservados.
- PanelShell con navegación lateral en escritorio, navegación compacta en móvil,
  ruta activa y salto al contenido. Ficha de cuenta y acceso a inspección.
- Inspección: estados distinguibles, controles con aria-pressed, foco visible en la
  carga de archivos, iconos/texto para OK y defectuosa, superficies y canvas responsive.
  Cámara, captura y selección siguen usando los handlers originales.
- Clases reutilizables ui-button, ui-button-secondary, ui-input, ui-card y ui-eyebrow;
  Icon y PanelNav nuevos. No se añadió una biblioteca de componentes.
- Se reutilizan Logo, InspectionPreview, todos los formularios, AuthShell, Field,
  FormAlert, PanelShell e Inspector. @axe-core/playwright es sólo dependencia de desarrollo.

No se modificaron backend, endpoints, Prisma, migraciones, autenticación, roles,
permisos, modelos, umbrales, preprocesamiento ni persistencia. No hay métricas,
gráficos, tablas operativas o filtros implementados en el panel; no se inventaron.

## Validaciones ejecutadas

Entorno: Windows, Node 22.23.4, Next 16.4.3, Chromium Playwright 1.63.0 y
PostgreSQL temporal 18.6 con UTF-8/UTC. Las pruebas funcionales finales se ejecutaron
contra la compilación de producción en localhost:3100; la copia de main en 3101.
No se iniciaron sesiones ni se enviaron formularios en producción.

| Verificación | Resultado real |
| --- | --- |
| npm run lint | Aprobado |
| npm run typecheck | Aprobado |
| npm run build | Aprobado; todas las rutas existentes compiladas |
| npm audit --omit=dev --audit-level=high | **0 vulnerabilidades productivas** |
| npm test, con PostgreSQL temporal | **127 pruebas aprobadas**, 8 archivos |
| Playwright completo | **33 pruebas aprobadas**, ninguna omitida |
| Playwright de main para capturas privadas | **6 aprobadas**, sin modificar main |
| Responsive / axe | Seis pantallas a **360, 768 y 1280 px**, sin overflow horizontal ni infracciones de los criterios axe seleccionados |
| Contraste semántico | >=4.5:1 en texto, >=3:1 en foco y bordes de controles; superficies elevadas incluidas |
| Teclado y movimiento reducido | Foco visible, menú/Escape, selector de archivo y prefers-reduced-motion aprobados |
| Flujos | Login/logout, bloqueo, redirección segura, rutas protegidas, recuperación, validación y persistencia de demo aprobados |
| Inspección | Clasificación real OK, archivos incorrectos/corruptos, carga/error y captura de cámara simulada aprobados |

Los 18 casos responsive/axe y los dos de menú/teclado llevan @smoke, de modo que
el workflow CI existente también los ejecuta en el PR. Los casos de archivo/cámara
con modelo requieren los fixtures explícitos, como la prueba de inferencia original.

La revisión estructural de las sentencias previas al render de Inspector,
UploadInput y CameraInput confirmó que sus estados, efectos y handlers de
procesamiento coinciden con main; los cambios son de presentación y semántica accesible.

Commits de implementación:

- e16cb59 — auditoría y capturas anteriores.
- 9abb70f — sistema visual y seis pantallas.
- 090f42f — pruebas responsive, accesibilidad e inspección.
- Este informe y las capturas nuevas se entregan en el commit de documentación final del PR.

El modelo TF.js provisional **0.9.0** se descargó del bucket público ya documentado,
sin modificarlo. Se sirvió desde una copia local durante las pruebas de inferencia.
La referencia OK fue hu22-012 del conjunto autorizado, convertida a PNG sólo como
fixture local; ni los pesos ni esa copia se añadieron al repositorio. La cámara usa
el dispositivo ficticio de Chromium y nunca la cámara física del usuario.

Comandos, desde apps/web, con PostgreSQL de pruebas migrado y variables locales:

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e -- --workers=2
```

Para repetir también la prueba real existente y las dos de controles de inspección,
configurar E2E_MODEL_DIR con dev/manifest.json, los archivos de v0.9.0 y
referencia-ok.png, y NEXT_PUBLIC_MODEL_MANIFEST_URL como explica inspection.spec.ts.
Sin esos fixtures las pruebas dependientes se omiten expresamente; **en esta
validación final se proporcionaron y se ejecutaron**.
Para generar capturas, establecer UI_EVIDENCE_DIR; UI_EVIDENCE_PHASE distingue antes/después.

## Evidencias visuales

Directorio: [evidencias/RIKDP-274](evidencias/RIKDP-274/).
Las capturas públicas anteriores provienen de la web publicada; las privadas,
de una copia aislada de main usando cuentas ficticias. Las nuevas provienen del
build local de producción. El correo de las cuentas de prueba está oculto mediante
la máscara de screenshot de Playwright. No se capturaron contraseñas ni tokens.
El HUD de desarrollo se oculta sólo al capturar; las evidencias finales son de producción.

| Pantalla | Problema inicial / mejora | Antes (1280 px) | Después (1280 px) |
| --- | --- | --- | --- |
| Landing | Superficies claras y navegación móvil incompleta → Industrial Tech y menú accesible | [Antes](evidencias/RIKDP-274/antes-publicado-landing-1280.png) | [Después](evidencias/RIKDP-274/despues-landing-1280.png) |
| Ingreso | Tarjeta genérica → acceso contextual y campos consistentes | [Antes](evidencias/RIKDP-274/antes-publicado-ingresar-1280.png) | [Después](evidencias/RIKDP-274/despues-ingresar-1280.png) |
| Recuperación | Marco independiente → mismo sistema de acceso | [Antes](evidencias/RIKDP-274/antes-publicado-recuperar-1280.png) | [Después](evidencias/RIKDP-274/despues-recuperar-1280.png) |
| Restablecimiento | Error poco contextualizado → jerarquía y alerta preservada | [Antes](evidencias/RIKDP-274/antes-publicado-restablecer-1280.png) | [Después](evidencias/RIKDP-274/despues-restablecer-1280.png) |
| Panel | Cabecera simple → navegación activa y ficha legible | [Antes](evidencias/RIKDP-274/antes-local-panel-1280.png) | [Después](evidencias/RIKDP-274/despues-panel-1280.png) |
| Inspección | Controles y resultado poco diferenciados → jerarquía de entrada, estados y resultado | [Antes](evidencias/RIKDP-274/antes-local-inspeccion-1280.png) | [Después](evidencias/RIKDP-274/despues-inspeccion-1280.png) |

Las seis pantallas tienen capturas nuevas a 360/768/1280 px, nombradas
despues-{pantalla}-{ancho}.png. Se incluyen además estados de resultado real,
cámara simulada, archivo corrupto, carga y error del modelo, en 1280 px.

## Limitaciones y observaciones

- Axe, contraste y revisión de teclado son una base automatizada, no una
  certificación completa WCAG 2.2 AA ni una prueba con todos los lectores de pantalla.
- La cámara física y condiciones reales de planta no se probaron; se usó un
  dispositivo simulado. Los permisos del sistema operativo y hardware varían.
- El correo de recuperación se simuló en las pruebas de integración; no se enviaron
  mensajes externos. La respuesta genérica y el manejo de enlaces inválidos sí se probaron.
- La instalación reportó 16 avisos moderados preexistentes; no se cambiaron versiones
  productivas ni se aplicaron actualizaciones ajenas al rediseño.
- Node 16 del equipo no sirve para este proyecto. Se usó Node 22 portátil.
  La primera prueba sin DATABASE_URL no pudo cargar la suite de autenticación.
  Al preparar la base temporal hubo dos fallos por zona horaria; con UTC, como CI,
  pasaron las 127 pruebas. La base de datos de producción no se tocó.
- En next dev la compilación fría excedió el timeout de navegación tanto en main
  como en el rediseño. Las pruebas definitivas y capturas privadas se hicieron
  sobre builds de producción, con todos los flujos aprobados.

## Revisión sugerida

Abrir cada ruta a los tres anchos, recorrer controles con Tab, probar Escape en el
menú móvil, comparar capturas y revisar el resultado de CI del PR. Verificar que
los cambios funcionales de Inspector y los formularios se limitan a presentación,
semántica accesible y componentes visuales. No integrar automáticamente.
