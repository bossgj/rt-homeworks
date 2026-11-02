// Dashboard-ul: mesajele "lights" de la plăci, verificările de siguranță,
// butonul pentru pietoni și afișarea. Echivalentul paginii web al
// dashboard-ului Swing (DeviceState + SemaforDashboard).
//
// Mesajele vin de la WebDashboard.java (Server-Sent Events, /api/events);
// butonul se trimite la /api/button, care publică BUTTON pe topic-ul "commands".

'use strict';

const STALE_MS = 2000;           // după cât timp fără mesaje este considerată placa inactivă
const BUTTON_TIMEOUT_MS = 5000;  // cât se așteaptă, după BUTTON, aprinderea lămpii AȘTEPTAȚI

const PHASES = new Set(['CAR_GREEN', 'CAR_YELLOW', 'ALL_RED', 'PED_GREEN', 'PED_FLASH', 'PED_CLEAR', 'NIGHT']);
const CAR_COLORS = new Set(['RED', 'YELLOW', 'GREEN', 'OFF']);
const PED_COLORS = new Set(['RED', 'GREEN', 'OFF']);

/** Ultima stare cunoscută a unui semafor, plus verificările de siguranță. */
class DeviceState {
  constructor(id) {
    this.id = id;
    this.phase = '?';
    this.car = 'OFF';
    this.ped = 'OFF';
    this.wait = false;
    this.seconds = 0;
    this.lastReceived = 0;   // Date.now() la ultimul mesaj; 0 = niciun mesaj
    this.messages = 0;
    this.safetyErrors = 0;
    this.lastError = null;
    this.buttonSentAt = 0;   // cât timp se așteaptă lampa AȘTEPTAȚI; 0 = nu se așteaptă
    this.buttonResult = null;
  }

  /** Aplică un mesaj nou și întoarce erorile de siguranță găsite. */
  update(m, receivedAt) {
    const errors = [];
    // pietonii pot avea verde doar când mașinile au roșu
    if (m.ped === 'GREEN' && m.car !== 'RED') {
      errors.push(`CONFLICT: pietoni GREEN, mașini ${m.car}`);
    }
    // la mașini, verdele trece în roșu doar prin galben
    if (this.messages > 0 && this.car === 'GREEN' && m.car === 'RED') {
      errors.push('mașini: GREEN → RED fără YELLOW');
    }
    if (this.buttonSentAt > 0 && m.wait) {
      this.buttonResult = `AȘTEPTAȚI aprinsă după ${receivedAt - this.buttonSentAt} ms`;
      this.buttonSentAt = 0;
    }
    Object.assign(this, { phase: m.phase, car: m.car, ped: m.ped, wait: m.wait, seconds: m.seconds });
    this.lastReceived = receivedAt;
    this.messages++;
    if (errors.length) {
      this.safetyErrors += errors.length;
      this.lastError = errors[errors.length - 1];
    }
    return errors;
  }

  buttonSent(now) {
    this.buttonSentAt = now;
    this.buttonResult = 'se așteaptă lampa AȘTEPTAȚI...';
  }

  checkButtonTimeout(now) {
    if (this.buttonSentAt > 0 && now - this.buttonSentAt > BUTTON_TIMEOUT_MS) {
      this.buttonResult = `AȘTEPTAȚI nu s-a aprins în ${BUTTON_TIMEOUT_MS / 1000} s`;
      this.buttonSentAt = 0;
    }
  }

  isStale(now) {
    return this.lastReceived === 0 || now - this.lastReceived > STALE_MS;
  }
}

/** Mesajul "deviceId;timestamp;faza;masini;pietoni;asteptati;secunde"; aruncă o eroare dacă e invalid. */
function parseLights(text) {
  const f = text.trim().split(';');
  if (f.length !== 7) throw new Error(`are ${f.length} câmpuri în loc de 7`);
  if (!/^-?\d+$/.test(f[1]) || !/^-?\d+$/.test(f[6])) throw new Error('timestamp sau secunde nu sunt numere');
  if (!PHASES.has(f[2])) throw new Error(`faza necunoscută: ${f[2]}`);
  if (!CAR_COLORS.has(f[3])) throw new Error(`culoarea pentru mașini necunoscută: ${f[3]}`);
  if (!PED_COLORS.has(f[4])) throw new Error(`culoarea pentru pietoni necunoscută: ${f[4]}`);
  if (f[5] !== '0' && f[5] !== '1') throw new Error(`asteptati trebuie să fie 0 sau 1, nu ${f[5]}`);
  const seconds = parseInt(f[6], 10);
  if (seconds < 0) throw new Error(`secunde negativ: ${seconds}`);
  return { deviceId: f[0], timestamp: Number(f[1]), phase: f[2], car: f[3], ped: f[4], wait: f[5] === '1', seconds };
}

// ---------------------------------------------------------------- starea paginii

const devices = new Map();
const $ = (id) => document.getElementById(id);
const deviceBox = $('device');

function selected() {
  return devices.get(deviceBox.value) || null;
}

/** Lămpile pe care le vede intersecția: ale plăcii selectate, sau stinse. */
function signals() {
  const s = selected();
  if (!s || s.isStale(Date.now())) {
    return { live: false, noDevice: !s, car: 'OFF', ped: 'OFF', wait: false, seconds: 0 };
  }
  return { live: true, noDevice: false, car: s.car, ped: s.ped, wait: s.wait, seconds: s.seconds };
}

const scene = Intersection.create($('scene'), {
  getSignals: signals,
  onPress: () => sendButton('un pieton a apăsat butonul'),
  onEvent: (text) => log(text, true),
});

// ---------------------------------------------------------------- mesajele

// Pe serverul cursului, pagina e a unui student: ?student=popescu-ion.
// Local, serverul folosește STUDENT din Config.java și ignoră parametrul.
// Adresele sunt relative, ca pagina să meargă și sub o cale (/semafor/).
const studentParam = new URLSearchParams(location.search).get('student') || '';
const query = studentParam ? 'student=' + encodeURIComponent(studentParam) : '';

function connect() {
  const events = new EventSource('api/events' + (query ? '?' + query : ''));
  events.addEventListener('config', (e) => {
    const c = JSON.parse(e.data);
    if (!c.student) {
      // pe server, fără student (sau cu un nume invalid): îl cerem
      events.close();
      showPicker(studentParam);
      return;
    }
    $('student').textContent = '– ' + c.student;
    $('changeStudent').hidden = !c.multi;
    document.title = 'Semafor pentru pietoni – ' + c.student;
    setConnection('conectat la ' + c.broker, 'ok');
    log('conectat; așteptăm mesaje pe ' + c.topic);
  });
  events.addEventListener('lights', (e) => onLights(e.data, Date.now()));
  events.onerror = () => {
    // EventSource se reconectează singur
    setConnection('fără legătură cu WebDashboard (este pornit?)', 'error');
  };
}

function onLights(text, receivedAt) {
  let m;
  try {
    m = parseLights(text);
  } catch (e) {
    log(`mesaj lights invalid (${e.message}): ${text}`, true);
    return;
  }
  let s = devices.get(m.deviceId);
  if (!s) {
    s = new DeviceState(m.deviceId);
    devices.set(m.deviceId, s);
    if (devices.size === 1) deviceBox.innerHTML = '';
    deviceBox.add(new Option(m.deviceId, m.deviceId));   // primul device adăugat este selectat automat
    log('device nou: ' + m.deviceId);
  }
  const before = s.phase;
  const errors = s.update(m, receivedAt);
  if (before !== s.phase) {
    log(`[${s.id}] faza ${s.phase}  (mașini ${s.car}, pietoni ${s.ped})`);
  }
  for (const error of errors) {
    log(`[${s.id}] EROARE DE SIGURANȚĂ: ${error}`, true);
  }
  refresh();
}

// ---------------------------------------------------------------- butonul

async function sendButton(who) {
  const s = selected();
  if (!s) {
    log('niciun device selectat: comanda BUTTON nu a fost trimisă');
    return;
  }
  try {
    const r = await fetch('api/button?device=' + encodeURIComponent(s.id) + (query ? '&' + query : ''), { method: 'POST' });
    if (!r.ok) throw new Error(await r.text());
  } catch (e) {
    log('BUTTON nu a fost trimis: ' + e.message, true);
    return;
  }
  log(`[${s.id}] → BUTTON` + (who ? `  (${who})` : ''));
  s.buttonSent(Date.now());
  refresh();
}

$('button').addEventListener('click', () => {
  scene.flashButtons();
  sendButton();
});

// ---------------------------------------------------------------- afișarea

function refresh() {
  const now = Date.now();
  const s = selected();
  if (s) s.checkButtonTimeout(now);
  const sig = signals();

  setLamps($('carHead'), { red: sig.car === 'RED', yellow: sig.car === 'YELLOW', green: sig.car === 'GREEN' });
  setLamps($('pedHead'), { red: sig.ped === 'RED', green: sig.ped === 'GREEN' });
  $('countdown').textContent = sig.seconds > 0 ? sig.seconds : '';
  $('waitLamp').classList.toggle('on', sig.wait);

  if (!s) {
    $('phase').textContent = '–';
    setText('lastMessage', 'niciun device');
    setText('buttonResult', '–');
    setText('safety', '–');
  } else {
    $('phase').textContent = s.phase;
    setText('lastMessage', `acum ${((now - s.lastReceived) / 1000).toFixed(1)} s  (${s.messages} mesaje)`,
            s.isStale(now) ? 'stale' : '');
    setText('buttonResult', s.buttonResult || '–');
    if (s.safetyErrors === 0) {
      setText('safety', 'fără erori', 'ok');
    } else {
      const count = s.safetyErrors === 1 ? 'o eroare' : `${s.safetyErrors} erori`;
      setText('safety', `${count}, ultima: ${s.lastError}`, 'error');
    }
  }

  const st = scene.stats();
  setText('carsStopped', st.carsStopped);
  setText('pedsWaiting', st.pedsWaiting);
  setText('pedsWait', st.pedsWait);
  setText('redRunners', st.redRunners, st.redRunners ? 'error' : '');
  setText('conflicts', st.conflicts, st.conflicts ? 'error' : '');
}

function setLamps(head, on) {
  for (const [color, lit] of Object.entries(on)) {
    head.querySelector('.' + color).classList.toggle('on', lit);
  }
}

function setText(id, text, cls = '') {
  const el = $(id);
  el.textContent = text;
  el.className = cls;
}

function showPicker(invalid) {
  document.body.classList.add('picking');
  $('picker').hidden = false;
  setConnection(invalid ? `nume invalid: ${invalid}` : 'alegeți studentul', invalid ? 'error' : '');
  const input = $('pickerName');
  input.value = invalid;
  input.focus();
}

$('pickerForm').addEventListener('submit', (e) => {
  e.preventDefault();
  location.search = '?student=' + encodeURIComponent($('pickerName').value.trim());
});

function setConnection(text, cls) {
  const el = $('connection');
  el.textContent = text;
  el.className = 'pill ' + cls;
}

function log(text, error = false) {
  const pre = $('log');
  const line = document.createElement('div');
  if (error) line.className = 'error';
  line.textContent = new Date().toTimeString().slice(0, 8) + '.' + String(Date.now() % 1000).padStart(3, '0') + '  ' + text;
  const atBottom = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 4;
  pre.appendChild(line);
  while (pre.childElementCount > 400) pre.firstChild.remove();
  if (atBottom) pre.scrollTop = pre.scrollHeight;
}

// ---------------------------------------------------------------- comenzile simulării

deviceBox.addEventListener('change', refresh);
$('carRate').addEventListener('change', (e) => scene.setCarRate(Number(e.target.value)));
$('pedRate').addEventListener('change', (e) => scene.setPedRate(Number(e.target.value)));
$('autoPress').addEventListener('change', (e) => scene.setAutoPress(e.target.checked));
$('reset').addEventListener('click', () => scene.reset());
// la reîncărcarea paginii, browserul poate păstra valorile alese anterior
scene.setCarRate(Number($('carRate').value));
scene.setPedRate(Number($('pedRate').value));
scene.setAutoPress($('autoPress').checked);

setInterval(refresh, 200);
connect();
refresh();
