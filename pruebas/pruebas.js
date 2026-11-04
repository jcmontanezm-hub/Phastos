/* Ciclo de pruebas de integridad de Phastos móvil.
   Corre la app en un celular emulado (Pixel 7), simula la API de Claude, Azure y ElevenLabs,
   e inyecta fallas ordenadas por nivel: 1 leve → 5 crítico.
   Uso:  node pruebas/pruebas.js [url]   (por defecto http://localhost:8765/)          */
'use strict';
const { chromium, devices } = require('playwright');
const fs = require('fs'), path = require('path');
const URL_APP = process.argv[2] || 'http://localhost:8765/';

// ---------------------------------------------------------------- utilidades
const txt = t => ({ type: 'text', text: t });
const tool = (name, input, id = 't' + Math.random().toString(36).slice(2, 7)) => ({ type: 'tool_use', id, name, input });
const ok = (content, stop = 'end_turn') => ({ status: 200, body: { content, stop_reason: stop } });
const fallo = (status, msg) => ({ status, body: { type: 'error', error: { type: 'x', message: msg } } });
const espera = ms => new Promise(r => setTimeout(r, ms));

/** Arranca Phastos con un guion de respuestas de la API y opciones de entorno. */
async function arrancar(browser, { guion = [], cfg = { key: 'sk-test', nombre: 'Cesar' }, ls = {}, init = null, rutas = null, offline = false } = {}) {
  const ctx = await browser.newContext({ ...devices['Pixel 7'], serviceWorkers: offline ? 'allow' : 'block' });
  const page = await ctx.newPage();
  const t = { page, ctx, llamadas: [], errores: [], hablado: [], peticiones: [] };
  page.on('pageerror', e => t.errores.push(e.message));
  page.on('request', r => t.peticiones.push({ url: r.url(), headers: r.headers() }));
  await page.route('https://fonts.googleapis.com/**', r => r.abort());
  await page.route('https://fonts.gstatic.com/**', r => r.abort());
  let i = 0;
  await page.route('https://api.anthropic.com/**', async r => {
    const body = JSON.parse(r.request().postData() || '{}'); t.llamadas.push(body);
    const paso = typeof guion === 'function' ? guion(i, body) : guion[Math.min(i, guion.length - 1)]; i++;
    if (!paso) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [txt('ok')], stop_reason: 'end_turn' }) });
    if (paso.demora) await espera(paso.demora);
    if (paso.abortar) return r.abort('internetdisconnected');
    if (paso.crudo !== undefined) return r.fulfill({ status: paso.status || 200, contentType: 'application/json', body: paso.crudo });
    return r.fulfill({ status: paso.status, contentType: 'application/json', body: JSON.stringify(paso.body) });
  });
  if (rutas) await rutas(page, t);
  await page.exposeFunction('__hablo', s => t.hablado.push(s));
  await page.addInitScript(({ cfg, ls }) => {
    try {
      if (cfg) localStorage.setItem('phastos.cfg', JSON.stringify(cfg));
      for (const [k, v] of Object.entries(ls)) localStorage.setItem(k, v);
    } catch {}
    window.__phastosTimeout = 3000; // timeout corto de la API para las pruebas
    // Voz simulada: registra lo que diría y termina enseguida
    if (window.speechSynthesis) {
      const fake = { speaking: false, getVoices: () => [], cancel() {}, speak(u) { window.__hablo(u.text); setTimeout(() => u.onend && u.onend(), 5); }, onvoiceschanged: null };
      Object.defineProperty(window, 'speechSynthesis', { value: fake, configurable: true });
    }
    HTMLMediaElement.prototype.play = function () { setTimeout(() => this.onended && this.onended(), 5); return Promise.resolve(); };
  }, { cfg, ls });
  if (init) await page.addInitScript(init);
  if (offline) { await page.goto(URL_APP); await espera(800); await ctx.setOffline(true); await page.reload(); }
  else await page.goto(URL_APP);
  return t;
}
async function decir(t, texto, msEspera = 900) {
  await t.page.fill('#texto', texto); await t.page.click('.entrada button'); await espera(msEspera);
}
const ultimo = async (t, sel = '.msg') => t.page.$$eval(sel, e => (e.length ? e[e.length - 1].textContent : ''));
const todos = async (t, sel) => t.page.$$eval(sel, e => e.map(x => x.textContent));
const estadoNucleo = t => t.page.$eval('#scene', s => s.dataset.estado);

// ---------------------------------------------------------------- casos
const casos = [
  // ===== NIVEL 1 · LEVE: uso y entrada de texto
  { n: 1, id: 'L1-01', nombre: 'Mensaje vacío o solo espacios no se envía', async run(b) {
      const t = await arrancar(b, { guion: [ok([txt('hola')])] });
      await decir(t, '     ', 400);
      return { pasa: t.llamadas.length === 0, detalle: `llamadas a la API: ${t.llamadas.length}`, t };
  } },
  { n: 1, id: 'L1-02', nombre: 'Texto con HTML/script no se ejecuta (XSS)', async run(b) {
      const t = await arrancar(b, { guion: [ok([txt('<img src=x onerror="window.__xss=1"><b>negrita</b>')])] });
      await decir(t, '<script>window.__xss=1</script><img src=x onerror="window.__xss=1">');
      const xss = await t.page.evaluate(() => window.__xss === 1);
      const imgs = await t.page.$$eval('#chat img', e => e.length);
      return { pasa: !xss && imgs === 0, detalle: `código ejecutado: ${xss}, imágenes inyectadas: ${imgs}`, t };
  } },
  { n: 1, id: 'L1-03', nombre: 'Doble envío rápido no duplica la consulta', async run(b) {
      const t = await arrancar(b, { guion: [{ ...ok([txt('una vez')]), demora: 600 }] });
      await t.page.fill('#texto', 'hola'); await t.page.click('.entrada button');
      await t.page.fill('#texto', 'hola'); await t.page.click('.entrada button');
      await espera(1200);
      return { pasa: t.llamadas.length === 1, detalle: `llamadas: ${t.llamadas.length}`, t };
  } },
  { n: 1, id: 'L1-04', nombre: 'Mensaje muy largo (8.000 caracteres)', async run(b) {
      const t = await arrancar(b, { guion: [ok([txt('Recibido.')])] });
      await decir(t, 'a'.repeat(8000));
      return { pasa: (await ultimo(t, '.msg.bot')) === 'Recibido.' && t.errores.length === 0, detalle: `respuesta: ${await ultimo(t, '.msg.bot')}`, t };
  } },
  { n: 1, id: 'L1-05', nombre: 'La voz no lee URLs, markdown ni emojis de formato', async run(b) {
      const t = await arrancar(b, { guion: [ok([txt('**Listo**: mira https://ejemplo.com/a?b=1 y `codigo` # fin')])] });
      await decir(t, 'prueba');
      const h = t.hablado.join(' ');
      return { pasa: h && !/https?:|\*\*|`|#/.test(h), detalle: `dijo: «${h}»`, t };
  } },
  { n: 1, id: 'L1-06', nombre: 'Diccionario de pronunciación (Claude → Clod)', async run(b) {
      const t = await arrancar(b, { guion: [ok([txt('Uso Claude por WiFi, soy Phastos')])] });
      await decir(t, 'quién eres');
      const h = t.hablado.join(' ');
      return { pasa: /Clod/.test(h) && /guaifai/.test(h) && /Fastos/.test(h), detalle: `dijo: «${h}»`, t };
  } },

  // ===== NIVEL 2 · MODERADO: datos guardados, configuración y herramientas
  { n: 2, id: 'L2-01', nombre: 'Datos guardados corruptos (JSON inválido) no impiden arrancar', async run(b) {
      const t = await arrancar(b, { cfg: null, ls: { 'phastos.cfg': '{roto', 'phastos.historial': '[{"role":', 'phastos.contactos': 'nope', 'phastos.memoria': '42' } });
      await espera(400);
      const orb = await t.page.$('#orb');
      return { pasa: !!orb && t.errores.length === 0, detalle: `errores JS: ${t.errores.join(' | ') || 'ninguno'}`, t };
  } },
  { n: 2, id: 'L2-02', nombre: 'Sin API key: avisa y no llama a la API', async run(b) {
      const t = await arrancar(b, { cfg: { key: '' } });
      await decir(t, 'hola', 400);
      const abierto = await t.page.$eval('#ajustes', d => d.open);
      return { pasa: t.llamadas.length === 0 && abierto, detalle: `llamadas: ${t.llamadas.length}, ajustes abiertos: ${abierto}`, t };
  } },
  { n: 2, id: 'L2-03', nombre: 'Almacenamiento bloqueado (modo privado estricto)', async run(b) {
      const t = await arrancar(b, { cfg: null, init: () => { Object.defineProperty(window, 'localStorage', { get() { throw new Error('bloqueado'); } }); } });
      await espera(400);
      return { pasa: !!(await t.page.$('#orb')) && t.errores.length === 0, detalle: `errores JS: ${t.errores.join(' | ') || 'ninguno'}`, t };
  } },
  { n: 2, id: 'L2-04', nombre: 'Contacto que no existe: Claude recibe el error y responde', async run(b) {
      const t = await arrancar(b, { guion: [ok([tool('llamar', { destino: 'Batman' })], 'tool_use'), ok([txt('No tengo a Batman.')])] });
      await decir(t, 'llama a Batman');
      const tr = t.llamadas[1]?.messages.at(-1).content[0];
      return { pasa: tr?.is_error === true && (await ultimo(t, '.msg.bot')) === 'No tengo a Batman.', detalle: `tool_result: ${tr?.content}`, t };
  } },
  { n: 2, id: 'L2-05', nombre: 'Recordatorio con fecha inválida o en el pasado', async run(b) {
      const t = await arrancar(b, { guion: [ok([tool('crear_recordatorio', { texto: 'x', fecha_hora: '2001-01-01T10:00' }), tool('crear_recordatorio', { texto: 'y', fecha_hora: 'mañana' })], 'tool_use'), ok([txt('Esas fechas no sirven.')])] });
      await decir(t, 'recuérdame');
      const res = t.llamadas[1]?.messages.at(-1).content || [];
      const guardados = await t.page.evaluate(() => JSON.parse(localStorage.getItem('phastos.recordatorios') || '[]').length);
      return { pasa: res.length === 2 && res.every(r => r.is_error) && guardados === 0, detalle: `errores devueltos: ${res.filter(r => r.is_error).length}/2, guardados: ${guardados}`, t };
  } },
  { n: 2, id: 'L2-06', nombre: 'Herramienta desconocida o sin parámetros', async run(b) {
      const t = await arrancar(b, { guion: [ok([tool('borrar_todo', {}), tool('llamar', {}), tool('enviar_whatsapp', { destino: null })], 'tool_use'), ok([txt('Hubo un problema.')])] });
      await decir(t, 'haz algo raro');
      const res = t.llamadas[1]?.messages.at(-1).content || [];
      return { pasa: res.length === 3 && res.every(r => r.is_error) && t.errores.length === 0, detalle: `resultados con error: ${res.filter(r => r.is_error).length}/3`, t };
  } },
  { n: 2, id: 'L2-07', nombre: 'Pronunciación con caracteres especiales (C++, .NET)', async run(b) {
      const t = await arrancar(b, { guion: [ok([tool('ensenar_pronunciacion', { palabra: 'C++', suena: 'ce más más' }), tool('ensenar_pronunciacion', { palabra: '.NET', suena: 'dot net' })], 'tool_use'), ok([txt('Aprendí C++ y .NET')])] });
      await decir(t, 'pronuncia así');
      return { pasa: t.errores.length === 0 && t.hablado.join(' ').includes('ce más más'), detalle: `dijo: «${t.hablado.join(' ')}»`, t };
  } },

  // ===== NIVEL 3 · SERIO: errores de la API y de la red
  ...[[401, 'API key no válida', /API key no es válida/], [429, 'límite / sin saldo', /demasiadas solicitudes|saldo/], [500, 'error interno', /Error de la API/], [529, 'servidores saturados', /Error de la API|saturad/]].map(([st, nom, re], k) => ({
    n: 3, id: 'L3-0' + (k + 1), nombre: `API responde ${st} (${nom})`, async run(b) {
      const t = await arrancar(b, { guion: [fallo(st, 'falla simulada'), ok([txt('recuperado')])] });
      await decir(t, 'hola'); const m = await ultimo(t, '.msg.sys');
      await decir(t, 'otra vez'); const r = await ultimo(t, '.msg.bot');
      return { pasa: re.test(m) && r === 'recuperado', detalle: `aviso: «${m}» · siguiente mensaje: «${r}»`, t };
  } })),
  { n: 3, id: 'L3-05', nombre: 'Sin internet: avisa y se recupera al volver la red', async run(b) {
      const t = await arrancar(b, { guion: [{ abortar: true }, ok([txt('volví')])] });
      await decir(t, 'hola'); const m = await ultimo(t, '.msg.sys');
      await decir(t, 'hola'); const r = await ultimo(t, '.msg.bot');
      return { pasa: /conexi/i.test(m) && r === 'volví', detalle: `aviso: «${m}» · luego: «${r}»`, t };
  } },
  { n: 3, id: 'L3-06', nombre: 'Respuesta corrupta (JSON inválido)', async run(b) {
      const t = await arrancar(b, { guion: [{ crudo: '{"content": [ roto' }, ok([txt('bien')])] });
      await decir(t, 'hola'); const m = await ultimo(t, '.msg.sys');
      await decir(t, 'hola'); const r = await ultimo(t, '.msg.bot');
      return { pasa: /dañada/i.test(m) && r === 'bien', detalle: `aviso: «${m}» · luego: «${r}»`, t };
  } },
  { n: 3, id: 'L3-07', nombre: 'Respuesta vacía (sin contenido)', async run(b) {
      const t = await arrancar(b, { guion: [ok([])] });
      await decir(t, 'hola');
      return { pasa: (await ultimo(t, '.msg.bot')) === 'Listo.', detalle: `respuesta: «${await ultimo(t, '.msg.bot')}»`, t };
  } },
  { n: 3, id: 'L3-08', nombre: 'La API se queda colgada (no responde nunca)', async run(b) {
      const t = await arrancar(b, { guion: [{ ...ok([txt('tarde')]), demora: 20000 }, ok([txt('ya')])] });
      await decir(t, 'hola', 4500);
      const est = await estadoNucleo(t); const m = await ultimo(t, '.msg.sys');
      return { pasa: est !== 'pensando' && /tard|tiempo|conexi/i.test(m), detalle: `estado del núcleo tras 4,5 s: ${est} · aviso: «${m}»`, t };
  } },
  { n: 3, id: 'L3-09', nombre: 'País no soportado en búsqueda web → reintenta sin ubicación', async run(b) {
      const t = await arrancar(b, { cfg: { key: 'sk', ciudad: 'Ibagué' }, guion: [fallo(400, 'tools.15.web_search_20250305: Country code CO is not supported.'), ok([txt('clima ok')])] });
      await decir(t, 'clima');
      return { pasa: (await ultimo(t, '.msg.bot')) === 'clima ok' && !t.llamadas[1].tools.find(x => x.name === 'web_search').user_location, detalle: `llamadas: ${t.llamadas.length}`, t };
  } },
  { n: 3, id: 'L3-10', nombre: 'Bloque «thinking» rechazado → reintenta sin él', async run(b) {
      const t = await arrancar(b, { guion: [ok([{ type: 'thinking', thinking: 'x', signature: 's' }, tool('recordar_dato', { dato: 'Se llama César' })], 'tool_use'), fallo(400, 'messages.1.content.0: Invalid `signature` in `thinking` block.'), ok([txt('Listo César')])] });
      await decir(t, 'mi nombre es César');
      const mismo = t.llamadas.every(l => l.system === t.llamadas[0].system);
      return { pasa: (await ultimo(t, '.msg.bot')) === 'Listo César' && mismo && !JSON.stringify(t.llamadas[2].messages).includes('"thinking"'), detalle: `system constante en las ${t.llamadas.length} llamadas: ${mismo}`, t };
  } },

  // ===== NIVEL 4 · GRAVE: lógica del agente
  { n: 4, id: 'L4-01', nombre: 'Bucle infinito de herramientas se corta solo', async run(b) {
      const t = await arrancar(b, { guion: () => ok([tool('listar_recordatorios', {})], 'tool_use') });
      await decir(t, 'loop', 2500);
      const est = await estadoNucleo(t);
      return { pasa: t.llamadas.length <= 8 && est !== 'pensando', detalle: `vueltas: ${t.llamadas.length}, estado final: ${est}`, t };
  } },
  { n: 4, id: 'L4-02', nombre: '«pause_turn» repetido de la búsqueda web', async run(b) {
      const t = await arrancar(b, { guion: [ok([{ type: 'server_tool_use', id: 's1', name: 'web_search', input: {} }], 'pause_turn'), ok([], 'pause_turn'), ok([txt('encontré')])] });
      await decir(t, 'busca', 1500);
      return { pasa: (await ultimo(t, '.msg.bot')) === 'encontré', detalle: `llamadas: ${t.llamadas.length}`, t };
  } },
  { n: 4, id: 'L4-03', nombre: 'Historial largo se recorta y siempre empieza por el usuario', async run(b) {
      const h = []; for (let k = 0; k < 40; k++) h.push({ role: k % 2 ? 'assistant' : 'user', content: 'm' + k });
      const t = await arrancar(b, { ls: { 'phastos.historial': JSON.stringify(h) }, guion: [ok([txt('ok')])] });
      await decir(t, 'nuevo');
      const msgs = t.llamadas[0].messages;
      const alterna = msgs.every((m, k) => m.role === (k % 2 ? 'assistant' : 'user'));
      return { pasa: msgs.length <= 17 && msgs[0].role === 'user' && alterna, detalle: `mensajes enviados: ${msgs.length}, primero: ${msgs[0].role}, alternan: ${alterna}`, t };
  } },
  { n: 4, id: 'L4-04', nombre: 'Historial dañado (roles repetidos o vacíos)', async run(b) {
      const h = [{ role: 'assistant', content: 'a' }, { role: 'user', content: '' }, { role: 'user', content: 'b' }, { role: 'sistema', content: 'x' }, { content: 'sin rol' }];
      const t = await arrancar(b, { ls: { 'phastos.historial': JSON.stringify(h) }, guion: [ok([txt('ok')])] });
      await decir(t, 'hola');
      const msgs = t.llamadas[0]?.messages || [];
      const valido = msgs.length && msgs[0].role === 'user' && msgs.every((m, k) => m.role === (k % 2 ? 'assistant' : 'user') && m.content);
      return { pasa: !!valido, detalle: `enviado: ${JSON.stringify(msgs.map(m => m.role))}`, t };
  } },
  { n: 4, id: 'L4-05', nombre: 'Enlaces peligrosos en acciones (javascript:, intent falsos)', async run(b) {
      const t = await arrancar(b, { ls: { 'phastos.contactos': JSON.stringify([{ nombre: 'Mamá', tel: '3001234567' }]) },
        guion: [ok([tool('abrir', { que: 'javascript:alert(1)' }), tool('llamar', { destino: 'javascript:alert(1)' }), tool('navegar_a', { destino: '"><script>alert(1)</script>' })], 'tool_use'), ok([txt('listo')])] });
      await decir(t, 'abre esto');
      const hrefs = await t.page.$$eval('.accion a', e => e.map(a => a.getAttribute('href')));
      return { pasa: hrefs.every(h => !/^javascript:/i.test(h)) && t.errores.length === 0, detalle: `enlaces: ${hrefs.join(' | ')}`, t };
  } },
  { n: 4, id: 'L4-06', nombre: 'Recordatorio vencido avisa una sola vez', async run(b) {
      const t = await arrancar(b, { ls: { 'phastos.recordatorios': JSON.stringify([{ id: '1', texto: 'Tomar agua', cuando: Date.now() - 1000 }]) } });
      await espera(6500);
      const avisos = (await todos(t, '.msg.bot')).filter(x => x.includes('Tomar agua')).length;
      return { pasa: avisos === 1, detalle: `avisos mostrados: ${avisos}`, t };
  } },

  // ===== NIVEL 5 · CRÍTICO: servicios externos, dispositivo y seguridad de claves
  { n: 5, id: 'L5-01', nombre: 'Azure falla (clave mala) → usa la voz del teléfono', async run(b) {
      const t = await arrancar(b, { cfg: { key: 'sk', motor: 'azure', azKey: 'mala', azRegion: 'eastus', azVoz: 'es-CO-GonzaloNeural' }, guion: [ok([txt('Te respondo igual.')])],
        rutas: p => p.route('https://eastus.tts.speech.microsoft.com/**', r => r.fulfill({ status: 401, body: '' })) });
      await decir(t, 'hola', 1200);
      return { pasa: t.hablado.includes('Te respondo igual.') && (await todos(t, '.msg.sys')).some(x => /Azure/.test(x)), detalle: `voz del teléfono dijo: «${t.hablado.join(' ')}»`, t };
  } },
  { n: 5, id: 'L5-02', nombre: 'ElevenLabs sin red → usa la voz del teléfono', async run(b) {
      const t = await arrancar(b, { cfg: { key: 'sk', motor: 'eleven', elKey: 'k', elVoz: 'v' }, guion: [ok([txt('Sigo hablando.')])],
        rutas: p => p.route('https://api.elevenlabs.io/**', r => r.abort()) });
      await decir(t, 'hola', 1200);
      return { pasa: t.hablado.includes('Sigo hablando.'), detalle: `dijo: «${t.hablado.join(' ')}»`, t };
  } },
  { n: 5, id: 'L5-03', nombre: 'Teléfono sin síntesis ni reconocimiento de voz', async run(b) {
      const t = await arrancar(b, { guion: [ok([txt('Por texto funciono.')])], init: () => { delete window.speechSynthesis; delete window.SpeechSynthesisUtterance; delete window.webkitSpeechRecognition; delete window.SpeechRecognition; } });
      await t.page.click('#orb'); await espera(300);
      const aviso = await ultimo(t, '.msg.sys');
      await decir(t, 'hola');
      return { pasa: /no soporta/i.test(aviso) && (await ultimo(t, '.msg.bot')) === 'Por texto funciono.' && t.errores.length === 0, detalle: `aviso: «${aviso}» · errores JS: ${t.errores.length}`, t };
  } },
  { n: 5, id: 'L5-04', nombre: 'Memoria del teléfono llena (cuota de almacenamiento)', async run(b) {
      const t = await arrancar(b, { guion: [ok([tool('recordar_dato', { dato: 'x' })], 'tool_use'), ok([txt('Hecho.')])],
        init: () => { const o = Storage.prototype.setItem; Storage.prototype.setItem = function (k, v) { if (String(k).startsWith('phastos.') && document.readyState === 'complete') throw new DOMException('lleno', 'QuotaExceededError'); return o.call(this, k, v); }; } });
      await espera(300); await decir(t, 'recuerda x');
      return { pasa: (await ultimo(t, '.msg.bot')) === 'Hecho.' && t.errores.length === 0, detalle: `respuesta: «${await ultimo(t, '.msg.bot')}», errores JS: ${t.errores.length}`, t };
  } },
  { n: 5, id: 'L5-05', nombre: 'Abre sin señal (modo avión) gracias a la caché', async run(b) {
      const t = await arrancar(b, { offline: true });
      await espera(500);
      return { pasa: !!(await t.page.$('#orb')), detalle: `interfaz cargada sin red: ${!!(await t.page.$('#orb'))}`, t };
  } },
  { n: 5, id: 'L5-06', nombre: 'Las claves solo viajan a su propio servicio', async run(b) {
      const t = await arrancar(b, { cfg: { key: 'sk-SECRETA', motor: 'azure', azKey: 'AZ-SECRETA', azRegion: 'eastus', azVoz: 'es-CO-GonzaloNeural', elKey: 'EL-SECRETA', elVoz: 'v' },
        guion: [ok([tool('abrir', { que: 'youtube', busqueda: 'música' })], 'tool_use'), ok([txt('listo')])],
        rutas: p => p.route('https://eastus.tts.speech.microsoft.com/**', r => r.fulfill({ status: 200, contentType: 'audio/mpeg', body: Buffer.alloc(8) })) });
      await decir(t, 'pon música', 1200);
      const fugas = t.peticiones.filter(r => {
        const todo = r.url + JSON.stringify(r.headers);
        return (todo.includes('sk-SECRETA') && !r.url.startsWith('https://api.anthropic.com/')) ||
               (todo.includes('AZ-SECRETA') && !r.url.includes('.tts.speech.microsoft.com/')) || todo.includes('EL-SECRETA');
      }).map(r => r.url);
      const enUrl = t.peticiones.some(r => /SECRETA/.test(r.url));
      return { pasa: fugas.length === 0 && !enUrl, detalle: fugas.length ? `fuga hacia: ${fugas.join(', ')}` : 'ninguna clave salió hacia otro dominio ni en la URL', t };
  } },
  { n: 5, id: 'L5-07', nombre: 'Instrucciones maliciosas dentro de un resultado no ejecutan acciones solas', async run(b) {
      const t = await arrancar(b, { ls: { 'phastos.contactos': JSON.stringify([{ nombre: 'Mamá', tel: '3001234567' }]) },
        guion: [ok([tool('llamar', { destino: 'Mamá' })], 'tool_use'), ok([txt('Listo.')])] });
      const navegaciones = []; t.page.on('framenavigated', f => navegaciones.push(f.url()));
      await decir(t, 'llama a mamá');
      const sale = navegaciones.some(u => u.startsWith('tel:'));
      const boton = await t.page.$('.accion a[href^="tel:"]');
      return { pasa: !sale && !!boton, detalle: `navegó sola: ${sale} · requiere que el usuario toque el botón: ${!!boton}`, t };
  } }
];

// ---------------------------------------------------------------- ejecución
(async () => {
  const b = await chromium.launch();
  const res = [];
  for (const c of casos) {
    const t0 = Date.now(); let r;
    try { r = await Promise.race([c.run(b), espera(25000).then(() => ({ pasa: false, detalle: 'la prueba no terminó en 25 s (cuelgue)' }))]); }
    catch (e) { r = { pasa: false, detalle: 'excepción: ' + e.message.split('\n')[0] }; }
    if (r.t) { if (r.t.errores.length && r.pasa) r.detalle += ` · errores JS: ${r.t.errores.join(' | ')}`; await r.t.ctx.close().catch(() => {}); }
    res.push({ nivel: c.n, id: c.id, nombre: c.nombre, pasa: !!r.pasa, detalle: r.detalle, ms: Date.now() - t0 });
    console.log(`${r.pasa ? '✔' : '✖'} [${c.id}] ${c.nombre} — ${r.detalle}`);
  }
  await b.close();
  const out = path.join(__dirname, 'resultados.json');
  fs.writeFileSync(out, JSON.stringify({ fecha: new Date().toISOString(), url: URL_APP, resultados: res }, null, 2));
  const fallas = res.filter(r => !r.pasa).length;
  console.log(`\n${res.length - fallas}/${res.length} pruebas superadas`);
  process.exit(fallas ? 1 : 0);
})();
