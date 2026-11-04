# Informe de pruebas de integridad — Phastos móvil

Fecha: 4 de noviembre de 2026 · Entorno: Chrome en Pixel 7 emulado, API de Claude, Azure y ElevenLabs simuladas

**Resultado final: 36/36 pruebas superadas.**

La primera corrida dio 33/36. Se corrigieron 3 fallas reales y 1 mejora menor (marcadas con 🔧), y la segunda corrida pasó completa.

Para volver a correrlas: sirve la carpeta en `http://localhost:8765` y ejecuta `node pruebas/pruebas.js` (requiere Node.js y Playwright).

## Nivel 1 · Leve — uso y entrada de texto

| ID | Prueba | Resultado | Detalle |
|---|---|---|---|
| L1-01 | Mensaje vacío o solo espacios no se envía | ✔ Pasa | llamadas a la API: 0 |
| L1-02 | Texto con HTML/script no se ejecuta (XSS) | ✔ Pasa | código ejecutado: false, imágenes inyectadas: 0 |
| L1-03 | Doble envío rápido no duplica la consulta | ✔ Pasa | llamadas: 1 |
| L1-04 | Mensaje muy largo (8.000 caracteres) | ✔ Pasa | respuesta: Recibido. |
| L1-05 | La voz no lee URLs, markdown ni emojis de formato | ✔ Pasa | dijo: «Listo: mira y codigo fin» |
| L1-06 | Diccionario de pronunciación (Claude → Clod) | ✔ Pasa | dijo: «Uso Clod por guaifai, soy Fastos» |

## Nivel 2 · Moderado — datos guardados, configuración y herramientas

| ID | Prueba | Resultado | Detalle |
|---|---|---|---|
| L2-01 | Datos guardados corruptos (JSON inválido) no impiden arrancar | ✔ Pasa | errores JS: ninguno |
| L2-02 | Sin API key: avisa y no llama a la API | ✔ Pasa | llamadas: 0, ajustes abiertos: true |
| L2-03 | Almacenamiento bloqueado (modo privado estricto) | ✔ Pasa | errores JS: ninguno |
| L2-04 | Contacto que no existe: Claude recibe el error y responde | ✔ Pasa | tool_result: {"error":"No tengo a \"Batman\" en contactos rápidos. Pide el número o que lo agregue en Ajustes."} |
| L2-05 | Recordatorio con fecha inválida o en el pasado | ✔ Pasa | errores devueltos: 2/2, guardados: 0 |
| L2-06 | Herramienta desconocida o sin parámetros | ✔ Pasa | resultados con error: 3/3 |
| L2-07 | Pronunciación con caracteres especiales (C++, .NET) | ✔ Pasa | dijo: «Aprendí ce más más y dot net» |

## Nivel 3 · Serio — errores de la API y de la red

| ID | Prueba | Resultado | Detalle |
|---|---|---|---|
| L3-01 | API responde 401 (API key no válida) | ✔ Pasa | aviso: «La API key no es válida. Revísala en Ajustes.» · siguiente mensaje: «recuperado» |
| L3-02 | API responde 429 (límite / sin saldo) | ✔ Pasa | aviso: «Estoy recibiendo demasiadas solicitudes o se acabó el saldo de la API. Intenta en un momento.» · siguiente mensaje: «recuperado» |
| L3-03 | API responde 500 (error interno) | ✔ Pasa | aviso: «Error de la API: falla simulada» · siguiente mensaje: «recuperado» |
| L3-04 | API responde 529 (servidores saturados) | ✔ Pasa | aviso: «Error de la API: falla simulada» · siguiente mensaje: «recuperado» |
| L3-05 | Sin internet: avisa y se recupera al volver la red | ✔ Pasa | aviso: «Sin conexión a internet o no pude contactar a Claude.» · luego: «volví» |
| L3-06 | Respuesta corrupta (JSON inválido) | ✔ Pasa | 🔧 Ahora avisa «respuesta dañada» en vez de «sin conexión». — aviso: «Me llegó una respuesta dañada de Claude. Intenta de nuevo.» · luego: «bien» |
| L3-07 | Respuesta vacía (sin contenido) | ✔ Pasa | respuesta: «Listo.» |
| L3-08 | La API se queda colgada (no responde nunca) | ✔ Pasa | 🔧 Fallaba: Phastos se quedaba «pensando» para siempre. Se agregó un límite de 45 s. — estado del núcleo tras 4,5 s: reposo · aviso: «Claude se está tardando demasiado en responder. Intenta de nuevo en un momento.» |
| L3-09 | País no soportado en búsqueda web → reintenta sin ubicación | ✔ Pasa | llamadas: 2 |
| L3-10 | Bloque «thinking» rechazado → reintenta sin él | ✔ Pasa | system constante en las 3 llamadas: true |

## Nivel 4 · Grave — lógica del agente

| ID | Prueba | Resultado | Detalle |
|---|---|---|---|
| L4-01 | Bucle infinito de herramientas se corta solo | ✔ Pasa | vueltas: 8, estado final: reposo |
| L4-02 | «pause_turn» repetido de la búsqueda web | ✔ Pasa | llamadas: 3 |
| L4-03 | Historial largo se recorta y siempre empieza por el usuario | ✔ Pasa | 🔧 Fallaba: enviaba los 40 mensajes guardados. Ahora recorta a 16 al abrir. — mensajes enviados: 17, primero: user, alternan: true |
| L4-04 | Historial dañado (roles repetidos o vacíos) | ✔ Pasa | 🔧 Fallaba: mandaba el historial dañado y la API daba error en cada mensaje. Ahora lo limpia. — enviado: ["user"] |
| L4-05 | Enlaces peligrosos en acciones (javascript:, intent falsos) | ✔ Pasa | enlaces: https://www.google.com/search?q=javascript%3Aalert(1)%20 / https://www.google.com/maps/dir/?api=1&destination=%22%3E%3Cscript%3Ealert(1)%3C%2Fscript%3E&travelmode=driving&dir_action=navigate |
| L4-06 | Recordatorio vencido avisa una sola vez | ✔ Pasa | avisos mostrados: 1 |

## Nivel 5 · Crítico — servicios externos, dispositivo y seguridad de claves

| ID | Prueba | Resultado | Detalle |
|---|---|---|---|
| L5-01 | Azure falla (clave mala) → usa la voz del teléfono | ✔ Pasa | voz del teléfono dijo: «Te respondo igual.» |
| L5-02 | ElevenLabs sin red → usa la voz del teléfono | ✔ Pasa | dijo: «Sigo hablando.» |
| L5-03 | Teléfono sin síntesis ni reconocimiento de voz | ✔ Pasa | aviso: «Este navegador no soporta reconocimiento de voz. Usa Chrome en Android.» · errores JS: 0 |
| L5-04 | Memoria del teléfono llena (cuota de almacenamiento) | ✔ Pasa | respuesta: «Hecho.», errores JS: 0 |
| L5-05 | Abre sin señal (modo avión) gracias a la caché | ✔ Pasa | interfaz cargada sin red: true |
| L5-06 | Las claves solo viajan a su propio servicio | ✔ Pasa | ninguna clave salió hacia otro dominio ni en la URL |
| L5-07 | Instrucciones maliciosas dentro de un resultado no ejecutan acciones solas | ✔ Pasa | navegó sola: false · requiere que el usuario toque el botón: true |

## Lo que estas pruebas no cubren

- La API real de Claude, Azure y ElevenLabs: aquí se simularon sus respuestas.
- El micrófono y el reconocimiento de voz reales del celular, incluido «Oye Phastos».
- Que Android abra de verdad las apps (Teléfono, WhatsApp, Reloj, Maps) al tocar los botones de acción.
- Notificaciones con la app cerrada por completo.
