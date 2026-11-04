# Phastos móvil: asistente personal con Claude

## 1. Publicarlo (necesita HTTPS para usar el micrófono)
**GitHub Pages (gratis, permanente):**
1. Crea un repositorio nuevo, por ejemplo `phastos`, y sube todo el contenido de esta carpeta (los archivos sueltos, no la carpeta).
2. Ve a Settings → Pages → Source: *Deploy from a branch* → rama `main`, carpeta `/ (root)` → Save.
3. Al minuto queda en `https://TU-USUARIO.github.io/phastos/`.

Para actualizarlo después, reemplaza los archivos y sube el número en `CACHE = 'phastos-v1'` dentro de `sw.js`.

## 2. Instalarlo en el celular
1. Abre la URL en **Chrome** en tu Android → menú ⋮ → **Instalar app** (o "Agregar a pantalla principal").
2. Abre Phastos → ⚙ → pega tu API key (la sacas en platform.claude.com → API Keys) → Guardar.
3. Toca el orbe, acepta el permiso de micrófono y háblale.
4. En Ajustes: "Activar notificaciones" (para recordatorios) e "Importar del teléfono" para tus contactos rápidos.

Truco: si mantienes presionado el ícono de Phastos aparece el atajo **Hablar**, que abre la app escuchando directamente. Puedes arrastrar ese atajo a la pantalla de inicio. También puedes compartir un texto desde cualquier app → Phastos para que lo resuma o responda.

## Qué puede hacer
- Conversar y responder cualquier cosa (Claude), con voz de entrada y salida.
- Buscar en internet: clima, noticias, resultados, precios (cita las fuentes).
- Llamar, WhatsApp/SMS con el mensaje listo, navegar en Maps, abrir YouTube/Spotify con una búsqueda.
- Recordatorios y temporizadores con voz y notificación; eventos en Google Calendar; alarma en el Reloj.
- Recordar datos que le pidas («recuerda que mi placa es…») y usarlos después.
- Usar tu ubicación GPS si se la pides («¿qué farmacias hay cerca?»).
- Heredado del Phastos del proyecto: la personalidad de ingeniero inventor, el diccionario de pronunciación (Claude → «Clod»; corrígelo diciendo «se pronuncia…») y la voz opcional de ElevenLabs (Ajustes → Voz propia: pega tu key y el Voice ID).

## Limitaciones de la versión web (las resuelve la futura app nativa)
- Las acciones del teléfono aparecen como un **botón que tú tocas**, porque Chrome no deja que una web marque o abra apps sola.
- «Oye Phastos» solo funciona con la app abierta en pantalla. En Android el micrófono suena/parpadea al reiniciarse la escucha.
- Los recordatorios suenan si la app sigue abierta o recién minimizada. Para un aviso garantizado usa el botón de Google Calendar que aparece.
- La API key queda guardada en el navegador del celular. Es tu app personal, pero no compartas el link con la key puesta en otro teléfono ajeno. Pon un límite de gasto mensual en la consola de Claude.

## Costos aproximados
Con Haiku 5.5 una conversación normal cuesta fracciones de centavo de dólar. Cada búsqueda web cuesta USD 0,01 adicional (máx. 3 por pregunta).

## Voz de Azure (voces neuronales de Microsoft, como en Edge)
1. Entra a portal.azure.com (puedes crear la cuenta gratis) → **Crear un recurso** → busca **Speech** (servicio de Voz de Azure AI).
2. Plan de tarifa **Free F0** (500.000 caracteres al mes), elige una región (por ejemplo *East US*) y crea el recurso.
3. En el recurso, abre **Claves y punto de conexión** y copia la **KEY 1** y la **Ubicación/Región** (por ejemplo `eastus`).
4. En Phastos: ⚙ → Motor de voz → **Microsoft Azure** → pega la clave y la región → **Cargar voces de Azure** → elige la voz (Gonzalo o Salomé son de Colombia) → **Probar voz** → Guardar.
