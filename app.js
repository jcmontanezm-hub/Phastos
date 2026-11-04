/* Phastos móvil — asistente personal por voz con Claude
   Todo corre en el celular: la API key y los datos se guardan solo en este dispositivo. */
'use strict';

// ---------------------------------------------------------------- almacenamiento
const LS = {
  get(k, d) { try { const v = localStorage.getItem('phastos.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('phastos.' + k, JSON.stringify(v)); } catch {} }
};
const cfg = Object.assign({
  key: '', modelo: 'claude-haiku-5-5', nombre: '', ciudad: '', voz: '', vel: 1.05, wake: false, buscar: true, elKey: '', elVoz: ''
}, LS.get('cfg', {}));
let contactos = LS.get('contactos', []);      // [{nombre, tel}]
let memoria   = LS.get('memoria', []);        // ["dato", ...]
let historial = LS.get('historial', []);      // [{role, content:string}]
let recordatorios = LS.get('recordatorios', []); // [{id, texto, cuando:ms}]
// Diccionario de pronunciación heredado del Phastos del proyecto (solo afecta lo que se lee en voz alta)
let pronunciacion = LS.get('pronunciacion', [
  { palabra: 'Claude', suena: 'Clod' }, { palabra: 'Anthropic', suena: 'Antrópik' },
  { palabra: 'WiFi', suena: 'guaifai' }, { palabra: 'Phastos', suena: 'Fastos' }
]);
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function pronunciar(t) {
  [...pronunciacion].sort((a, b) => b.palabra.length - a.palabra.length).forEach(r => {
    t = t.replace(new RegExp('(?<![\\p{L}\\p{N}_])' + escRe(r.palabra) + '(?![\\p{L}\\p{N}_])', 'giu'), r.suena);
  });
  return t;
}

// ---------------------------------------------------------------- UI
const $ = s => document.querySelector(s);
const chat = $('#chat'), orb = $('#orb'), estadoTxt = $('#estadoTxt'), dot = $('#estadoDot');

function estado(modo, texto) {
  orb.className = 'orb ' + (modo || '');
  dot.className = 'dot ' + (modo === 'escuchando' ? 'listen' : (cfg.key ? 'on' : ''));
  estadoTxt.textContent = texto ?? (cfg.wake ? 'Di «Oye Phastos» o toca el orbe' : 'Toca el orbe para hablar');
}
function burbuja(rol, texto, fuentes) {
  const d = document.createElement('div');
  d.className = 'msg ' + rol;
  d.innerHTML = enlazar(escapar(texto));
  if (fuentes && fuentes.length) {
    const f = document.createElement('div');
    f.className = 'fuentes';
    f.innerHTML = 'Fuentes: ' + fuentes.slice(0, 4).map(u =>
      `<a href="${escapar(u.url)}" target="_blank" rel="noopener">${escapar(u.titulo || new URL(u.url).hostname)}</a>`).join(' · ');
    d.appendChild(f);
  }
  chat.appendChild(d); chat.scrollTop = chat.scrollHeight;
  return d;
}
function botonAccion(etiqueta, href, onClick) {
  const w = document.createElement('div'); w.className = 'accion';
  const el = document.createElement(href ? 'a' : 'button');
  el.textContent = etiqueta;
  if (href) { el.href = href; if (/^https?:/.test(href)) { el.target = '_blank'; el.rel = 'noopener'; } }
  if (onClick) el.addEventListener('click', onClick);
  w.appendChild(el); chat.appendChild(w); chat.scrollTop = chat.scrollHeight;
}
const escapar = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const enlazar = s => s.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>')
                      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');

// ---------------------------------------------------------------- voz: hablar
let voces = [];
function cargarVoces() {
  voces = speechSynthesis.getVoices().filter(v => v.lang.toLowerCase().startsWith('es'));
  const puntos = v => (/natural|online|neural/i.test(v.name) ? 4 : 0) + (/es-(CO|MX|US|419)/i.test(v.lang) ? 2 : 0) + (/google/i.test(v.name) ? 1 : 0);
  voces.sort((a, b) => puntos(b) - puntos(a));
  const sel = $('#cfgVoz'); sel.innerHTML = '';
  if (!voces.length) sel.innerHTML = '<option value="">Voz por defecto del sistema</option>';
  voces.forEach(v => { const o = document.createElement('option'); o.value = v.name; o.textContent = `${v.name} (${v.lang})`; sel.appendChild(o); });
  if (cfg.voz) sel.value = cfg.voz;
}
if ('speechSynthesis' in window) { cargarVoces(); speechSynthesis.onvoiceschanged = cargarVoces; }

function paraVoz(t) {
  return pronunciar(t).replace(/https?:\/\/\S+/g, '').replace(/[*_#`>|]/g, '').replace(/\[(.+?)\]\(.+?\)/g, '$1')
          .replace(/\n{2,}/g, '. ').replace(/\s+/g, ' ').trim();
}
let audioEL = null;
async function hablarEL(texto) {
  const r = await fetch('https://api.elevenlabs.io/v1/text-to-speech/' + encodeURIComponent(cfg.elVoz) + '?output_format=mp3_44100_128', {
    method: 'POST', headers: { 'xi-api-key': cfg.elKey, 'content-type': 'application/json', accept: 'audio/mpeg' },
    body: JSON.stringify({ text: paraVoz(texto).slice(0, 600), model_id: 'eleven_multilingual_v2',
      voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.25, use_speaker_boost: true } })
  });
  if (!r.ok) throw new Error('ElevenLabs ' + r.status);
  const url = URL.createObjectURL(await r.blob());
  pausarWake(); estado('hablando', 'Hablando… (toca para callarme)');
  await new Promise(res => {
    audioEL = new Audio(url);
    audioEL.onended = audioEL.onerror = audioEL.onpause = () => { URL.revokeObjectURL(url); audioEL = null; res(); };
    audioEL.play().catch(res);
  });
  estado(); reanudarWake();
}
function callar() { if (audioEL) audioEL.pause(); if ('speechSynthesis' in window) speechSynthesis.cancel(); }
const hablandoAhora = () => !!audioEL || ('speechSynthesis' in window && speechSynthesis.speaking);
async function hablar(texto) {
  if (cfg.elKey && cfg.elVoz && texto) {
    try { return await hablarEL(texto); } catch (e) { console.warn('ElevenLabs falló, uso la voz del navegador', e); }
  }
  return hablarNavegador(texto);
}
function hablarNavegador(texto) {
  return new Promise(res => {
    if (!('speechSynthesis' in window) || !texto) return res();
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(paraVoz(texto));
    u.lang = 'es-CO'; u.rate = Number(cfg.vel) || 1;
    const v = voces.find(v => v.name === cfg.voz) || voces.find(v => /es[-_](CO|MX|US|419)/i.test(v.lang)) || voces[0];
    if (v) { u.voice = v; u.lang = v.lang; }
    pausarWake();
    estado('hablando', 'Hablando… (toca para callarme)');
    u.onend = u.onerror = () => { estado(); reanudarWake(); res(); };
    speechSynthesis.speak(u);
  });
}

// ---------------------------------------------------------------- voz: escuchar
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null, escuchando = false, wakeActivo = false, wakeRec = null, wakePausado = false;
const WAKE = /\b(oye|hey|oi|hola)?\s*(phastos|fastos|faustos|pastos|fasto|phasto|fastoz|vastos)\b/i;

function escucharComando() {
  if (!SR) { burbuja('sys', 'Este navegador no soporta reconocimiento de voz. Usa Chrome en Android.'); return; }
  if (escuchando) { rec && rec.stop(); return; }
  pausarWake();
  callar();
  rec = new SR(); rec.lang = 'es-CO'; rec.interimResults = true; rec.maxAlternatives = 1; rec.continuous = false;
  let final = '';
  rec.onstart = () => { escuchando = true; estado('escuchando', 'Te escucho…'); };
  rec.onresult = e => {
    let interino = '';
    for (const r of e.results) { if (r.isFinal) final = r[0].transcript; else interino += r[0].transcript; }
    estadoTxt.textContent = final || interino || 'Te escucho…';
  };
  rec.onerror = e => { if (e.error === 'not-allowed') burbuja('sys', 'Necesito permiso de micrófono. Revísalo en los ajustes del navegador.'); };
  rec.onend = () => {
    escuchando = false; estado();
    const t = final.replace(WAKE, '').trim();
    if (t) procesar(t); else reanudarWake();
  };
  rec.start();
}

// Escucha continua de la palabra de activación (solo con la app abierta y en primer plano)
function iniciarWake() {
  if (!SR || !cfg.wake || wakeActivo) return;
  wakeActivo = true; wakePausado = false;
  const arrancar = () => {
    if (!wakeActivo || wakePausado || escuchando || document.hidden) return;
    wakeRec = new SR(); wakeRec.lang = 'es-CO'; wakeRec.continuous = true; wakeRec.interimResults = true;
    wakeRec.onresult = e => {
      const r = e.results[e.results.length - 1]; const t = r[0].transcript;
      if (WAKE.test(t)) {
        const resto = t.split(WAKE).pop().replace(WAKE, '').trim();
        if (r.isFinal || resto.split(' ').length >= 3) {
          wakeRec.onend = null; wakeRec.abort(); wakeRec = null;
          if (resto && resto.split(' ').length >= 2 && r.isFinal) procesar(resto);
          else { hablar('¿Sí?').then(escucharComando); }
        }
      }
    };
    wakeRec.onerror = e => { if (e.error === 'not-allowed') { wakeActivo = false; } };
    wakeRec.onend = () => { wakeRec = null; setTimeout(arrancar, 400); };
    try { wakeRec.start(); } catch {}
  };
  arrancar();
  iniciarWake.arrancar = arrancar;
}
function detenerWake() { wakeActivo = false; if (wakeRec) { wakeRec.onend = null; wakeRec.abort(); wakeRec = null; } }
function pausarWake() { wakePausado = true; if (wakeRec) { wakeRec.onend = null; wakeRec.abort(); wakeRec = null; } }
function reanudarWake() { wakePausado = false; if (cfg.wake && wakeActivo && iniciarWake.arrancar) setTimeout(iniciarWake.arrancar, 300); }
document.addEventListener('visibilitychange', () => { if (!document.hidden) reanudarWake(); });

// ---------------------------------------------------------------- herramientas locales
const herramientas = [
  { name: 'llamar', description: 'Prepara una llamada telefónica. destino puede ser un nombre de los contactos rápidos o un número.',
    input_schema: { type: 'object', properties: { destino: { type: 'string' } }, required: ['destino'] } },
  { name: 'enviar_whatsapp', description: 'Prepara un mensaje de WhatsApp a un contacto o número, con el texto ya escrito.',
    input_schema: { type: 'object', properties: { destino: { type: 'string' }, mensaje: { type: 'string' } }, required: ['destino', 'mensaje'] } },
  { name: 'enviar_sms', description: 'Prepara un SMS a un contacto o número.',
    input_schema: { type: 'object', properties: { destino: { type: 'string' }, mensaje: { type: 'string' } }, required: ['destino', 'mensaje'] } },
  { name: 'navegar_a', description: 'Abre navegación en Google Maps hacia un destino (dirección o lugar).',
    input_schema: { type: 'object', properties: { destino: { type: 'string' }, modo: { type: 'string', enum: ['conducir', 'caminar', 'transporte', 'bici'] } }, required: ['destino'] } },
  { name: 'abrir', description: 'Abre una app o servicio web con una búsqueda opcional: youtube, spotify, maps, google, gmail, calendario, o una URL completa.',
    input_schema: { type: 'object', properties: { que: { type: 'string' }, busqueda: { type: 'string' } }, required: ['que'] } },
  { name: 'crear_recordatorio', description: 'Crea un recordatorio que Phastos avisará con notificación y voz. Usa minutos para "en X minutos" o fecha_hora ISO local (YYYY-MM-DDTHH:MM) para una hora concreta.',
    input_schema: { type: 'object', properties: { texto: { type: 'string' }, minutos: { type: 'number' }, fecha_hora: { type: 'string' } }, required: ['texto'] } },
  { name: 'listar_recordatorios', description: 'Lista los recordatorios pendientes.', input_schema: { type: 'object', properties: {} } },
  { name: 'cancelar_recordatorio', description: 'Cancela un recordatorio por su id.', input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'crear_evento', description: 'Prepara un evento en Google Calendar. Fechas ISO local YYYY-MM-DDTHH:MM.',
    input_schema: { type: 'object', properties: { titulo: { type: 'string' }, inicio: { type: 'string' }, fin: { type: 'string' }, lugar: { type: 'string' }, detalles: { type: 'string' } }, required: ['titulo', 'inicio'] } },
  { name: 'poner_alarma', description: 'Prepara una alarma en la app Reloj de Android.',
    input_schema: { type: 'object', properties: { hora: { type: 'integer' }, minuto: { type: 'integer' }, etiqueta: { type: 'string' } }, required: ['hora', 'minuto'] } },
  { name: 'temporizador', description: 'Inicia un temporizador dentro de Phastos (avisa con voz y notificación).',
    input_schema: { type: 'object', properties: { segundos: { type: 'integer' }, etiqueta: { type: 'string' } }, required: ['segundos'] } },
  { name: 'recordar_dato', description: 'Guarda un dato duradero sobre el usuario que te pidió recordar (gustos, datos útiles, nombres).',
    input_schema: { type: 'object', properties: { dato: { type: 'string' } }, required: ['dato'] } },
  { name: 'olvidar_dato', description: 'Elimina un dato guardado que coincida con el texto.',
    input_schema: { type: 'object', properties: { dato: { type: 'string' } }, required: ['dato'] } },
  { name: 'ensenar_pronunciacion', description: 'Guarda cómo debe sonar una palabra en tu voz (por ejemplo Claude → Clod). Solo cuando el usuario corrige o pide cambiar una pronunciación. suena va escrito fonéticamente en español.',
    input_schema: { type: 'object', properties: { palabra: { type: 'string' }, suena: { type: 'string' } }, required: ['palabra', 'suena'] } },
  { name: 'mi_ubicacion', description: 'Obtiene la ubicación GPS actual del usuario (lat, lon) cuando la necesites para responder.',
    input_schema: { type: 'object', properties: {} } }
];

const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
function resolverNumero(destino) {
  const limpio = String(destino).replace(/[^\d+]/g, '');
  if (limpio.replace('+', '').length >= 7) return { tel: limpio, nombre: destino };
  const d = norm(destino);
  const c = contactos.find(c => norm(c.nombre) === d) || contactos.find(c => norm(c.nombre).includes(d) || d.includes(norm(c.nombre)));
  return c ? { tel: c.tel, nombre: c.nombre } : null;
}
const telWa = t => { let n = t.replace(/[^\d]/g, ''); if (n.length === 10 && n.startsWith('3')) n = '57' + n; return n; };
function isoLocal(s) { const d = new Date(s); return isNaN(d) ? null : d; }
const gcalFecha = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

async function ejecutar(nombre, a) {
  switch (nombre) {
    case 'llamar': {
      const r = resolverNumero(a.destino);
      if (!r) return { error: `No tengo a "${a.destino}" en contactos rápidos. Pide el número o que lo agregue en Ajustes.` };
      botonAccion(`📞 Llamar a ${r.nombre}`, `tel:${r.tel}`);
      return { ok: true, nota: 'Botón de llamada mostrado; el usuario debe tocarlo.' };
    }
    case 'enviar_whatsapp': {
      const r = resolverNumero(a.destino);
      if (!r) return { error: `No tengo a "${a.destino}" en contactos rápidos.` };
      botonAccion(`💬 WhatsApp a ${r.nombre}`, `https://wa.me/${telWa(r.tel)}?text=${encodeURIComponent(a.mensaje)}`);
      return { ok: true, nota: 'Botón de WhatsApp mostrado con el mensaje listo.' };
    }
    case 'enviar_sms': {
      const r = resolverNumero(a.destino);
      if (!r) return { error: `No tengo a "${a.destino}" en contactos rápidos.` };
      botonAccion(`✉️ SMS a ${r.nombre}`, `sms:${r.tel}?body=${encodeURIComponent(a.mensaje)}`);
      return { ok: true };
    }
    case 'navegar_a': {
      const modos = { conducir: 'driving', caminar: 'walking', transporte: 'transit', bici: 'bicycling' };
      botonAccion(`🧭 Ir a ${a.destino}`, `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(a.destino)}&travelmode=${modos[a.modo] || 'driving'}&dir_action=navigate`);
      return { ok: true };
    }
    case 'abrir': {
      const q = encodeURIComponent(a.busqueda || ''); const que = norm(a.que);
      const mapa = {
        youtube: q ? `https://www.youtube.com/results?search_query=${q}` : 'https://www.youtube.com',
        spotify: q ? `https://open.spotify.com/search/${q}` : 'https://open.spotify.com',
        maps: q ? `https://www.google.com/maps/search/${q}` : 'https://www.google.com/maps',
        google: `https://www.google.com/search?q=${q}`,
        gmail: 'https://mail.google.com', calendario: 'https://calendar.google.com',
        whatsapp: 'https://wa.me/', netflix: 'https://www.netflix.com'
      };
      const url = mapa[que] || (/^https?:\/\//.test(a.que) ? a.que : `https://www.google.com/search?q=${encodeURIComponent(a.que + ' ' + (a.busqueda || ''))}`);
      botonAccion(`↗ Abrir ${a.que}${a.busqueda ? ': ' + a.busqueda : ''}`, url);
      return { ok: true };
    }
    case 'crear_recordatorio': {
      let cuando = null;
      if (a.minutos != null) cuando = Date.now() + Number(a.minutos) * 60000;
      else if (a.fecha_hora) { const d = isoLocal(a.fecha_hora); if (d) cuando = d.getTime(); }
      if (!cuando || cuando < Date.now() - 60000) return { error: 'Hora no válida o en el pasado.' };
      const r = { id: String(Date.now()).slice(-6), texto: a.texto, cuando };
      recordatorios.push(r); LS.set('recordatorios', recordatorios);
      const ini = new Date(cuando), fin = new Date(cuando + 15 * 60000);
      botonAccion('📅 Guardar también en Google Calendar (aviso seguro)',
        `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(a.texto)}&dates=${gcalFecha(ini)}/${gcalFecha(fin)}`);
      return { ok: true, id: r.id, para: ini.toLocaleString('es-CO'),
        nota: 'Phastos avisa si la app sigue abierta o en segundo plano reciente. Para aviso garantizado, sugiere el botón de Calendar.' };
    }
    case 'listar_recordatorios':
      return { pendientes: recordatorios.map(r => ({ id: r.id, texto: r.texto, cuando: new Date(r.cuando).toLocaleString('es-CO') })) };
    case 'cancelar_recordatorio': {
      const n = recordatorios.length; recordatorios = recordatorios.filter(r => r.id !== a.id); LS.set('recordatorios', recordatorios);
      return { ok: recordatorios.length < n };
    }
    case 'crear_evento': {
      const ini = isoLocal(a.inicio); if (!ini) return { error: 'Fecha de inicio no válida' };
      const fin = isoLocal(a.fin) || new Date(ini.getTime() + 3600000);
      const url = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(a.titulo)}&dates=${gcalFecha(ini)}/${gcalFecha(fin)}` +
        (a.lugar ? `&location=${encodeURIComponent(a.lugar)}` : '') + (a.detalles ? `&details=${encodeURIComponent(a.detalles)}` : '');
      botonAccion(`📅 Crear "${a.titulo}" en Calendar`, url);
      return { ok: true };
    }
    case 'poner_alarma': {
      const h = Math.max(0, Math.min(23, a.hora | 0)), m = Math.max(0, Math.min(59, a.minuto | 0));
      const intent = `intent:#Intent;action=android.intent.action.SET_ALARM;i.android.intent.extra.alarm.HOUR=${h};i.android.intent.extra.alarm.MINUTES=${m};` +
        (a.etiqueta ? `S.android.intent.extra.alarm.MESSAGE=${encodeURIComponent(a.etiqueta)};` : '') + 'end';
      botonAccion(`⏰ Poner alarma ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`, intent);
      return { ok: true, nota: 'Botón mostrado. Si Android no abre el Reloj, se puede usar un recordatorio de Phastos.' };
    }
    case 'temporizador': {
      const s = Math.max(1, a.segundos | 0);
      const r = { id: String(Date.now()).slice(-6), texto: a.etiqueta ? `Temporizador: ${a.etiqueta}` : 'Se acabó el temporizador', cuando: Date.now() + s * 1000 };
      recordatorios.push(r); LS.set('recordatorios', recordatorios);
      return { ok: true, id: r.id };
    }
    case 'recordar_dato':
      memoria.push(a.dato); memoria = memoria.slice(-60); LS.set('memoria', memoria); return { ok: true };
    case 'olvidar_dato': {
      const d = norm(a.dato), n = memoria.length;
      memoria = memoria.filter(m => !norm(m).includes(d) && !d.includes(norm(m))); LS.set('memoria', memoria);
      return { ok: memoria.length < n };
    }
    case 'ensenar_pronunciacion': {
      const palabra = String(a.palabra || '').trim(), suena = String(a.suena || '').trim();
      if (!palabra || !suena || palabra.length > 40 || suena.length > 60) return { error: 'Palabra o pronunciación no válida' };
      pronunciacion = pronunciacion.filter(t => t.palabra.toLowerCase() !== palabra.toLowerCase()).concat({ palabra, suena });
      LS.set('pronunciacion', pronunciacion); return { ok: true };
    }
    case 'mi_ubicacion':
      return await new Promise(res => {
        if (!navigator.geolocation) return res({ error: 'GPS no disponible' });
        navigator.geolocation.getCurrentPosition(
          p => res({ lat: +p.coords.latitude.toFixed(5), lon: +p.coords.longitude.toFixed(5), precision_m: Math.round(p.coords.accuracy) }),
          e => res({ error: 'Sin permiso de ubicación: ' + e.message }), { timeout: 10000, maximumAge: 120000 });
      });
  }
  return { error: 'Herramienta desconocida' };
}

// ---------------------------------------------------------------- Claude
function sistema() {
  const ahora = new Date();
  return `Eres Phastos, el asistente personal de voz de ${cfg.nombre || 'tu usuario'} en su celular Android, como Siri o Google Assistant pero con personalidad propia. Naciste como el compañero del grupo en un proyecto universitario de robots y ahora acompañas a ${cfg.nombre || 'tu usuario'} en el día a día. Tu espíritu es el de un ingeniero inventor: curioso, paciente, práctico, con humor suave.
Fecha y hora actual: ${ahora.toLocaleString('es-CO', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })} (ISO local ${new Date(ahora - ahora.getTimezoneOffset() * 60000).toISOString().slice(0, 16)}, zona ${Intl.DateTimeFormat().resolvedOptions().timeZone}).
${cfg.ciudad ? 'Ciudad habitual: ' + cfg.ciudad + '.' : ''}
Contactos rápidos: ${contactos.length ? contactos.map(c => c.nombre).join(', ') : '(ninguno todavía)'}.
Datos que el usuario te pidió recordar:
${memoria.length ? memoria.map(m => '- ' + m).join('\n') : '- (nada aún)'}

CÓMO HABLAS
- Español colombiano casual, tuteando ("listo", "ojo con esto", "dale"), sin exagerar la jerga ni los chistes. Amable y directo.
- Tus respuestas se leen EN VOZ ALTA: máximo unas 3 frases cortas (unas 50 palabras) salvo que pidan detalle, sin listas, sin markdown, sin tablas, sin emojis y sin leer URLs. Di las cifras como se dicen.
- Si el tema es largo, da lo esencial y ofrece ampliar.

CÓMO TRABAJAS
- Si una herramienta puede hacer lo que pide, úsala en vez de explicar cómo hacerlo. Las acciones del teléfono (llamar, WhatsApp, mapas, alarma, calendario) aparecen como un botón: di en una frase qué preparaste y que lo toque.
- Para clima, noticias, resultados, precios o cualquier dato actual, busca en internet${cfg.buscar ? ' y di de dónde salió' : ' (búsqueda desactivada: dilo si hace falta)'}.
- Si no lo sabes ni lo encuentras, dilo: "eso no lo tengo". No inventes cifras, fechas ni datos.
- Si falta un dato imprescindible (a quién, a qué hora), pregúntalo en una frase corta.
- Usa recordar_dato solo cuando el usuario pida explícitamente que recuerdes algo.
- Si te corrige cómo pronuncias una palabra, usa ensenar_pronunciacion; aplica desde tu siguiente frase.`;
}

async function llamarClaude(mensajes) {
  const tools = [...herramientas];
  if (cfg.buscar) tools.push({ type: 'web_search_20250305', name: 'web_search', max_uses: 3,
    user_location: { type: 'approximate', country: 'CO', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Bogota', ...(cfg.ciudad ? { city: cfg.ciudad } : {}) } });
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': cfg.key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({ model: cfg.modelo, max_tokens: 1024, system: sistema(), tools, messages: mensajes })
  });
  if (!r.ok) {
    let det = ''; try { det = (await r.json()).error?.message || ''; } catch {}
    const e = new Error(det || ('HTTP ' + r.status)); e.status = r.status; throw e;
  }
  return r.json();
}

let ocupado = false;
async function procesar(texto) {
  texto = texto.trim(); if (!texto || ocupado) return;
  if (!cfg.key) { burbuja('sys', 'Primero pon tu API key de Claude en Ajustes ⚙'); abrirAjustes(); return; }
  ocupado = true; pausarWake();
  burbuja('user', texto);
  estado('pensando', 'Pensando…');
  const mensajes = [...historial, { role: 'user', content: texto }];
  let respuestaFinal = '', fuentes = [];
  try {
    for (let vuelta = 0; vuelta < 8; vuelta++) {
      const res = await llamarClaude(mensajes);
      mensajes.push({ role: 'assistant', content: res.content });
      for (const b of res.content) {
        if (b.type === 'text') {
          respuestaFinal += b.text;
          (b.citations || []).forEach(c => { if (c.url && !fuentes.some(f => f.url === c.url)) fuentes.push({ url: c.url, titulo: c.title }); });
        }
        if (b.type === 'server_tool_use') estadoTxt.textContent = 'Buscando en internet…';
      }
      if (res.stop_reason === 'pause_turn') continue;
      if (res.stop_reason !== 'tool_use') break;
      const resultados = [];
      for (const b of res.content.filter(b => b.type === 'tool_use')) {
        let out; try { out = await ejecutar(b.name, b.input || {}); } catch (e) { out = { error: String(e.message || e) }; }
        resultados.push({ type: 'tool_result', tool_use_id: b.id, content: JSON.stringify(out), ...(out && out.error ? { is_error: true } : {}) });
      }
      mensajes.push({ role: 'user', content: resultados });
      respuestaFinal = '';  // nos quedamos con el texto de la última vuelta
    }
    respuestaFinal = respuestaFinal.trim() || 'Listo.';
    historial.push({ role: 'user', content: texto }, { role: 'assistant', content: respuestaFinal });
    historial = historial.slice(-16); LS.set('historial', historial);
    burbuja('bot', respuestaFinal, fuentes);
    ocupado = false;
    await hablar(respuestaFinal);
  } catch (e) {
    ocupado = false;
    const msg = e.status === 401 ? 'La API key no es válida. Revísala en Ajustes.'
      : e.status === 429 ? 'Estoy recibiendo demasiadas solicitudes o se acabó el saldo de la API. Intenta en un momento.'
      : e.status === 404 ? 'Ese modelo no está disponible para tu cuenta. Cambia el modelo en Ajustes.'
      : (e.status ? 'Error de la API: ' + e.message : 'Sin conexión a internet o no pude contactar a Claude.');
    burbuja('sys', msg); estado(); hablar(msg);
  }
}

// ---------------------------------------------------------------- recordatorios
async function notificar(texto) {
  try {
    if (Notification.permission === 'granted') {
      const reg = await navigator.serviceWorker?.ready;
      if (reg) reg.showNotification('Phastos', { body: texto, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', vibrate: [200, 100, 200], tag: 'phastos-' + Date.now() });
      else new Notification('Phastos', { body: texto });
    }
  } catch {}
  if (navigator.vibrate) navigator.vibrate([300, 150, 300]);
}
setInterval(() => {
  const ahora = Date.now();
  const vencidos = recordatorios.filter(r => r.cuando <= ahora);
  if (!vencidos.length) return;
  recordatorios = recordatorios.filter(r => r.cuando > ahora); LS.set('recordatorios', recordatorios);
  vencidos.forEach(r => { burbuja('bot', '⏰ ' + r.texto); notificar(r.texto); hablar('Oye, te recuerdo: ' + r.texto); });
}, 5000);

// ---------------------------------------------------------------- ajustes
const dlg = $('#ajustes');
function pintarListas() {
  const lc = $('#listaContactos'); lc.innerHTML = contactos.length ? '' : '<div class="vacio">Sin contactos. Con ellos puedes decir «llama a mamá».</div>';
  contactos.forEach((c, i) => {
    const d = document.createElement('div'); d.className = 'item';
    d.innerHTML = `<span>${escapar(c.nombre)} · ${escapar(c.tel)}</span><button type="button" aria-label="Quitar">✕</button>`;
    d.querySelector('button').onclick = () => { contactos.splice(i, 1); LS.set('contactos', contactos); pintarListas(); };
    lc.appendChild(d);
  });
  const ln = $('#listaNotas'); ln.innerHTML = memoria.length ? '' : '<div class="vacio">Nada todavía. Dile «recuerda que…».</div>';
  memoria.forEach((m, i) => {
    const d = document.createElement('div'); d.className = 'item';
    d.innerHTML = `<span>${escapar(m)}</span><button type="button" aria-label="Olvidar">✕</button>`;
    d.querySelector('button').onclick = () => { memoria.splice(i, 1); LS.set('memoria', memoria); pintarListas(); };
    ln.appendChild(d);
  });
}
function abrirAjustes() {
  $('#cfgKey').value = cfg.key; $('#cfgModelo').value = cfg.modelo; $('#cfgNombre').value = cfg.nombre;
  $('#cfgCiudad').value = cfg.ciudad; $('#cfgElKey').value = cfg.elKey; $('#cfgElVoz').value = cfg.elVoz; $('#cfgVel').value = cfg.vel; $('#cfgWake').checked = cfg.wake; $('#cfgBuscar').checked = cfg.buscar;
  cargarVoces(); pintarListas(); dlg.showModal();
}
$('#btnGuardar').addEventListener('click', () => {
  Object.assign(cfg, { key: $('#cfgKey').value.trim(), modelo: $('#cfgModelo').value, nombre: $('#cfgNombre').value.trim(),
    ciudad: $('#cfgCiudad').value.trim(), elKey: $('#cfgElKey').value.trim(), elVoz: $('#cfgElVoz').value.trim(), voz: $('#cfgVoz').value, vel: Number($('#cfgVel').value), wake: $('#cfgWake').checked, buscar: $('#cfgBuscar').checked });
  LS.set('cfg', cfg);
  if (cfg.wake) iniciarWake(); else detenerWake();
  estado();
});
$('#btnImportar').addEventListener('click', async () => {
  if (!('contacts' in navigator)) { alertaSuave('Tu navegador no permite importar contactos. Usa «Agregar manual».'); return; }
  try {
    const sel = await navigator.contacts.select(['name', 'tel'], { multiple: true });
    sel.forEach(c => { const tel = (c.tel || [])[0]; const nombre = (c.name || [])[0]; if (tel && nombre && !contactos.some(x => x.tel === tel)) contactos.push({ nombre, tel }); });
    LS.set('contactos', contactos); pintarListas();
  } catch {}
});
$('#btnAgregar').addEventListener('click', () => {
  const nombre = prompt('¿Cómo le dices? (ej: mamá)'); if (!nombre) return;
  const tel = prompt('Número de ' + nombre); if (!tel) return;
  contactos.push({ nombre: nombre.trim(), tel: tel.trim() }); LS.set('contactos', contactos); pintarListas();
});
$('#btnNotif').addEventListener('click', async () => {
  if (!('Notification' in window)) return alertaSuave('Notificaciones no disponibles aquí.');
  const p = await Notification.requestPermission();
  alertaSuave(p === 'granted' ? 'Notificaciones activadas ✔' : 'No se activaron las notificaciones.');
});
function alertaSuave(t) { burbuja('sys', t); }

// ---------------------------------------------------------------- eventos
orb.addEventListener('click', () => {
  if (hablandoAhora()) { callar(); estado(); reanudarWake(); return; }
  escucharComando();
});
$('#formTexto').addEventListener('submit', e => { e.preventDefault(); const t = $('#texto').value; $('#texto').value = ''; procesar(t); });
$('#btnAjustes').addEventListener('click', abrirAjustes);
$('#btnLimpiar').addEventListener('click', () => { historial = []; LS.set('historial', []); chat.innerHTML = ''; burbuja('sys', 'Conversación nueva. Lo que te pedí recordar sigue guardado.'); });

// atajos de la app instalada (?accion=hablar)
const params = new URLSearchParams(location.search);

// ---------------------------------------------------------------- arranque
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
historial.slice(-6).forEach(m => burbuja(m.role === 'user' ? 'user' : 'bot', m.content));
estado();
if (!cfg.key) burbuja('sys', '¡Hola! Soy Phastos. Para empezar, toca ⚙ y pega tu API key de Claude.');
else if (!historial.length) burbuja('bot', `¡Quiubo${cfg.nombre ? ', ' + cfg.nombre : ''}! ¿En qué te ayudo?`);
if (cfg.wake) iniciarWake();
if (params.get('accion') === 'hablar') setTimeout(escucharComando, 400);
if (params.get('q')) setTimeout(() => procesar(params.get('q')), 300);
