// Trecerea de pietoni, văzută de sus: drumul, mașinile, pietonii și semafoarele.
//
// Simularea doar REACȚIONEAZĂ la lămpile primite de la placă (getSignals()):
// mașinile opresc la roșu și la galben (dacă mai pot opri), pornesc la verde,
// pietonii se adună la bordură și traversează doar pe verde. Nu ia nicio
// decizie în locul plăcii. Dacă placa greșește (verde → roșu fără galben, verde
// simultan), se vede: mașini trecute pe roșu, mașini pe trecere cu pietoni.
//
// Toate distanțele sunt în metri, timpii în secunde, vitezele în m/s.

'use strict';

const Intersection = (() => {

  // ------------------------------------------------------------ geometria
  const W = 70, H = 23;                 // lumea vizibilă
  const SIDEWALK_TOP = [4, 8];
  const ROAD = [8, 15];                 // două benzi de 3,5 m
  const SIDEWALK_BOTTOM = [15, 19];
  const CROSS = [33, 37];               // zebra, pe x
  const STOP = 31.5;                    // linia de oprire, în coordonata benzii
  const CENTER = 11.5;                  // axul drumului

  // s = poziția botului mașinii de-a lungul benzii, în sensul de mers.
  // Banda de jos merge spre dreapta (x = s), cea de sus spre stânga (x = W - s);
  // zebra și linia de oprire au același s pe ambele benzi.
  const LANES = [
    { name: '→', dir: +1, y: 13.25 },
    { name: '←', dir: -1, y: 9.75 },
  ];

  // ------------------------------------------------------------ modelul mașinilor (IDM)
  const ACC = 2.0;          // accelerația maximă
  const DEC = 2.5;          // frânarea confortabilă
  const MIN_GAP = 2.0;      // distanța la oprire față de mașina din față
  const HEADWAY = 1.0;      // timpul de urmărire
  const MAX_BRAKE = 9;      // frânarea maximă posibilă
  const YELLOW_BRAKE = 3.5; // la galben, șoferul oprește dacă îi ajunge frânarea aceasta

  const CAR_COLORS = ['#d64545', '#3b7dd8', '#e4e4e4', '#2a2a2a', '#8a8f96', '#e3a72f',
                      '#3f9b5a', '#6b4fb3', '#c8ccd0', '#1f4e8c', '#9c2f2f', '#f2f2f2'];
  const CLOTHES = ['#e76f51', '#2a9d8f', '#e9c46a', '#457b9d', '#9b5de5', '#f15bb5',
                   '#00bbf9', '#8d99ae', '#ef476f', '#06d6a0', '#3d405b', '#f4a261'];
  const HAIR = ['#2b1d14', '#4a3121', '#c9a66b', '#111111', '#7a5230', '#d8d8d8'];

  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  const expRandom = (rate) => -Math.log(1 - Math.random()) / rate;

  function create(canvas, { getSignals, onPress, onEvent }) {
    const ctx = canvas.getContext('2d');
    const decor = makeDecor();

    let carRate = 0.2;      // mașini pe secundă, pe fiecare bandă
    let pedRate = 0.1;      // pietoni pe secundă, în total
    let autoPress = false;

    let t = 0;
    let lanes, peds, nextPed, stats, prev, yellowId, pedGreenSince, buttonFlash;

    function reset() {
      lanes = LANES.map(l => ({ ...l, cars: [], pending: 0, nextSpawn: expRandom(carRate) }));
      peds = [];
      nextPed = expRandom(pedRate);
      stats = { redRunners: 0, conflicts: 0, waits: [] };
      prev = { car: 'OFF', ped: 'OFF' };
      yellowId = 0;
      pedGreenSince = -1e9;
      buttonFlash = { top: -1e9, bottom: -1e9 };
    }
    reset();

    // ---------------------------------------------------------- pasul simulării

    function step(dt) {
      t += dt;
      const sig = getSignals();

      if (sig.car === 'YELLOW' && prev.car !== 'YELLOW') yellowId++;
      if (sig.ped === 'GREEN' && prev.ped !== 'GREEN') pedGreenSince = t;
      prev = { car: sig.car, ped: sig.ped };

      spawnCars();
      spawnPeds();

      const pedOnRoad = peds.some(p => p.state === 'cross' && p.y > ROAD[0] - 0.3 && p.y < ROAD[1] + 0.3);
      for (const lane of lanes) moveCars(lane, sig, pedOnRoad, dt);
      for (const p of peds) movePed(p, sig, dt);
      peds = peds.filter(p => p.x > -3 && p.x < W + 3);

      checkConflicts();
    }

    function spawnCars() {
      for (const lane of lanes) {
        while (t >= lane.nextSpawn) {
          lane.pending++;
          lane.nextSpawn += expRandom(carRate);
        }
        if (lane.pending === 0) continue;
        const last = lane.cars[lane.cars.length - 1];
        const space = last ? last.s - last.len : Infinity;
        if (space < 7) continue;          // intrarea e blocată: mașina așteaptă în afara imaginii
        const v0 = rand(11.5, 14.5);      // ~ 40-52 km/h
        lane.cars.push({
          s: 0, len: rand(4.0, 4.8), wid: rand(1.75, 1.9), v0,
          v: last ? Math.min(v0, last.v + space / 5) : v0,
          acc: 0, color: pick(CAR_COLORS),
          yellowId: -1, committed: false, ranRed: false, conflict: -1e9,
        });
        lane.pending--;
      }
    }

    function idm(v, v0, gap, dv) {
      const desired = MIN_GAP + Math.max(0, v * HEADWAY + v * dv / (2 * Math.sqrt(ACC * DEC)));
      return ACC * (1 - Math.pow(v / v0, 4) - Math.pow(desired / Math.max(gap, 0.1), 2));
    }

    /** Trebuie să oprească mașina la linia de oprire? (decizia șoferului) */
    function mustStop(car, lane, sig, pedOnRoad) {
      if (car.s > STOP) return false;               // a trecut deja de linie
      const dist = STOP - car.s;
      const v = car.v;
      let stop = false;
      if (sig.car === 'YELLOW') {
        if (car.yellowId !== yellowId) {            // decizia se ia o dată, când se aprinde galbenul
          car.yellowId = yellowId;
          car.committed = dist < v * v / (2 * YELLOW_BRAKE) + 0.3 * v;
        }
        stop = !car.committed;
      } else if (sig.car === 'RED' && !car.committed) {
        if (catchingUp) {
          // tabul a fost ascuns și simularea a stat: nu știm ce a văzut șoferul, oprește la linie
          if (dist < v * v / (2 * MAX_BRAKE)) { car.s = Math.min(car.s, STOP - 0.05); car.v = 0; }
          stop = true;
        } else if (v > 3 && dist < v * v / (2 * MAX_BRAKE * 0.8)) {
          // roșu fără galben: șoferul nu mai poate opri
          car.committed = true;
          car.ranRed = true;
          stats.redRunners++;
          onEvent(`mașina de pe banda ${lane.name} a trecut pe roșu: nu a mai putut opri (roșu fără galben?)`);
        } else {
          stop = true;
        }
      }
      // pe GREEN și pe OFF (placa nu mai trimite) mașinile trec, dar cedează trecerea pietonilor de pe zebră
      if (pedOnRoad && dist > v * v / (2 * 6)) stop = true;
      return stop;
    }

    function moveCars(lane, sig, pedOnRoad, dt) {
      const cars = lane.cars;
      for (let i = 0; i < cars.length; i++) {
        const car = cars[i];
        const leader = cars[i - 1];
        let a = ACC * (1 - Math.pow(car.v / car.v0, 4));
        if (leader) {
          a = Math.min(a, idm(car.v, car.v0, leader.s - leader.len - car.s, car.v - leader.v));
        }
        const stop = mustStop(car, lane, sig, pedOnRoad);
        if (stop) {
          // linia de oprire = o mașină oprită; botul se oprește la 0,3 m de linie
          a = Math.min(a, idm(car.v, car.v0, STOP - 0.3 - car.s + MIN_GAP, car.v));
        }
        a = Math.max(-MAX_BRAKE, Math.min(ACC, a));
        const before = car.s;
        car.v = Math.max(0, car.v + a * dt);
        car.s += car.v * dt;
        car.acc = a;
        if (stop && before <= STOP && car.s > STOP - 0.05) { car.s = STOP - 0.05; car.v = 0; }
        if (leader && car.s > leader.s - leader.len - 0.4) {
          car.s = leader.s - leader.len - 0.4;
          car.v = Math.min(car.v, leader.v);
        }
      }
      lane.cars = cars.filter(c => c.s - c.len < W + 1);
    }

    function spawnPeds() {
      while (t >= nextPed) {
        nextPed += expRandom(pedRate);
        const side = Math.random() < 0.5 ? 'top' : 'bottom';
        const fromLeft = Math.random() < 0.5;
        const crowd = peds.filter(p => p.side === side && (p.state === 'approach' || p.state === 'wait')).length;
        const p = {
          side, x: fromLeft ? -2 : W + 2, y: walkY(side),
          speed: rand(1.15, 1.6), color: pick(CLOTHES), hair: pick(HAIR),
          anim: rand(0, 6), heading: fromLeft ? 0 : Math.PI, moving: true,
          threshold: rand(4, 6.5),   // câte secunde de verde îi trebuie ca să pornească
          react: rand(0.3, 1.6),     // timpul de reacție la verde
          waitSince: 0, nextPress: Infinity, conflict: -1e9,
        };
        if (Math.random() < 0.7 && crowd < 14) {
          // vrea să traverseze: își alege un loc la bordură, lângă zebră
          p.state = 'approach';
          p.tx = rand(CROSS[0] + 0.45, CROSS[1] - 0.45);
          const back = 0.5 + Math.floor(crowd / 5) * 0.75 + rand(0, 0.25);
          p.ty = side === 'top' ? SIDEWALK_TOP[1] - back : SIDEWALK_BOTTOM[0] + back;
        } else {
          p.state = 'walk';            // doar trece pe trotuar
          p.tx = fromLeft ? W + 3 : -3;
          p.ty = p.y;
        }
        peds.push(p);
      }
    }

    function walkY(side) {
      return side === 'top' ? rand(SIDEWALK_TOP[0] + 0.7, SIDEWALK_TOP[1] - 0.9)
                            : rand(SIDEWALK_BOTTOM[0] + 0.9, SIDEWALK_BOTTOM[1] - 0.7);
    }

    function movePed(p, sig, dt) {
      if (p.state === 'wait') {
        p.moving = false;
        p.heading = p.side === 'top' ? Math.PI / 2 : -Math.PI / 2;
        if (canStartCrossing(p, sig)) {
          startCrossing(p);
        } else if (autoPress && sig.live && sig.ped !== 'GREEN' && t >= p.nextPress) {
          // primul apasă sigur; ceilalți, cu lampa AȘTEPTAȚI deja aprinsă, apasă și ei uneori
          if (!sig.wait || Math.random() < 0.25) press(p.side);
          p.nextPress = t + rand(6, 12);
        }
        return;
      }

      let speed = p.speed;
      if (p.state === 'cross' && sig.ped !== 'GREEN') speed *= 1.4;   // s-a făcut roșu: grăbește pasul
      const dx = p.tx - p.x, dy = p.ty - p.y;
      const d = Math.hypot(dx, dy);
      if (d > 1e-6) {
        const k = Math.min(1, speed * dt / d);
        p.x += dx * k;
        p.y += dy * k;
        p.heading = Math.atan2(dy, dx);
        p.anim += speed * dt * 7;
        p.moving = true;
      }
      if (d > speed * dt) return;

      // a ajuns la ținta curentă
      if (p.state === 'approach') {
        p.state = 'wait';
        p.waitSince = t;
        p.nextPress = t + rand(0.4, 1.6);
        if (canStartCrossing(p, sig)) startCrossing(p);
      } else if (p.state === 'cross') {
        p.state = 'leave';
        p.side = p.side === 'top' ? 'bottom' : 'top';
        p.tx = Math.random() < 0.5 ? -3 : W + 3;
        p.ty = walkY(p.side);
      }
    }

    function canStartCrossing(p, sig) {
      if (sig.ped !== 'GREEN') return false;
      if (t - pedGreenSince < p.react) return false;
      return sig.seconds === 0 || sig.seconds >= p.threshold;
    }

    function startCrossing(p) {
      stats.waits.push(t - p.waitSince);
      if (stats.waits.length > 30) stats.waits.shift();
      p.state = 'cross';
      p.tx = p.x + rand(-0.3, 0.3);
      p.ty = p.side === 'top' ? SIDEWALK_BOTTOM[0] + rand(0.6, 1.6) : SIDEWALK_TOP[1] - rand(0.6, 1.6);
    }

    function press(side) {
      buttonFlash[side] = t;
      onPress();
    }

    /** O mașină pe zebră în același timp cu un pieton de pe banda ei. */
    function checkConflicts() {
      for (const lane of lanes) {
        for (const car of lane.cars) {
          const [x0, x1] = lane.dir > 0 ? [car.s - car.len, car.s] : [W - car.s, W - car.s + car.len];
          if (x1 < CROSS[0] || x0 > CROSS[1]) continue;
          for (const p of peds) {
            if (p.state !== 'cross') continue;
            if (Math.abs(p.y - lane.y) > 1.75 + 0.3 || p.x < x0 - 0.4 || p.x > x1 + 0.4) continue;
            if (t - car.conflict > 3) {
              stats.conflicts++;
              onEvent(`CONFLICT: mașină pe trecere (banda ${lane.name}) în timp ce traversează un pieton`);
            }
            car.conflict = t;
            p.conflict = t;
          }
        }
      }
    }

    // ---------------------------------------------------------- desenul

    let scale = 1, dpr = 1;

    function resize() {
      dpr = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      canvas.style.height = (width * H / W) + 'px';
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(width * H / W * dpr);
      scale = canvas.width / W;
    }
    new ResizeObserver(resize).observe(canvas);
    resize();

    function draw() {
      const sig = getSignals();
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      drawGround();
      for (const lane of lanes) for (const car of lane.cars) drawCar(lane, car);
      for (const p of peds) drawPed(p);
      drawSignals(sig);
      if (!sig.live) {
        caption(sig.noDevice ? 'așteptăm mesaje pe topic-ul lights...' : 'placa nu mai trimite mesaje: lămpile sunt stinse');
      }
    }

    function drawGround() {
      // parcul de sus și clădirile de jos
      ctx.fillStyle = '#26382a';
      ctx.fillRect(0, 0, W, SIDEWALK_TOP[0]);
      ctx.fillRect(0, SIDEWALK_BOTTOM[1], W, H - SIDEWALK_BOTTOM[1]);
      for (const b of decor.buildings) {
        ctx.fillStyle = 'rgba(0,0,0,.35)';
        ctx.fillRect(b.x + 0.3, b.y + 0.3, b.w, b.h);
        ctx.fillStyle = b.color;
        ctx.fillRect(b.x, b.y, b.w, b.h);
        ctx.fillStyle = 'rgba(255,255,255,.06)';
        ctx.fillRect(b.x, b.y, b.w, 0.35);
      }
      for (const tr of decor.trees) {
        ctx.fillStyle = 'rgba(0,0,0,.3)';
        circle(tr.x + 0.35, tr.y + 0.35, tr.r);
        ctx.fillStyle = tr.color;
        circle(tr.x, tr.y, tr.r);
        ctx.fillStyle = 'rgba(255,255,255,.08)';
        circle(tr.x - tr.r * 0.3, tr.y - tr.r * 0.3, tr.r * 0.5);
      }

      // trotuarele, cu dalele
      ctx.fillStyle = '#6c7278';
      ctx.fillRect(0, SIDEWALK_TOP[0], W, SIDEWALK_TOP[1] - SIDEWALK_TOP[0]);
      ctx.fillRect(0, SIDEWALK_BOTTOM[0], W, SIDEWALK_BOTTOM[1] - SIDEWALK_BOTTOM[0]);
      ctx.strokeStyle = 'rgba(0,0,0,.12)';
      ctx.lineWidth = 0.05;
      ctx.beginPath();
      for (let x = 0; x <= W; x += 1.5) {
        ctx.moveTo(x, SIDEWALK_TOP[0]); ctx.lineTo(x, SIDEWALK_TOP[1]);
        ctx.moveTo(x, SIDEWALK_BOTTOM[0]); ctx.lineTo(x, SIDEWALK_BOTTOM[1]);
      }
      ctx.stroke();

      // carosabilul și bordurile
      ctx.fillStyle = '#3a3d41';
      ctx.fillRect(0, ROAD[0], W, ROAD[1] - ROAD[0]);
      ctx.fillStyle = '#a9afb4';
      ctx.fillRect(0, ROAD[0] - 0.18, W, 0.18);
      ctx.fillRect(0, ROAD[1], W, 0.18);

      // axul: întrerupt departe de trecere, continuu lângă ea
      ctx.fillStyle = '#d8d8d8';
      for (let x = 0; x < W; x += 6) {
        if (x + 3 > STOP - 12 && x < W - STOP + 12) continue;
        ctx.fillRect(x, CENTER - 0.07, 3, 0.14);
      }
      ctx.fillRect(STOP - 12, CENTER - 0.07, CROSS[0] - (STOP - 12) - 0.5, 0.14);
      ctx.fillRect(CROSS[1] + 0.5, CENTER - 0.07, (W - STOP + 12) - CROSS[1] - 0.5, 0.14);

      // zebra și liniile de oprire
      ctx.fillStyle = '#e8e8e8';
      for (let y = ROAD[0] + 0.25; y < ROAD[1] - 0.2; y += 1.0) {
        ctx.fillRect(CROSS[0], y, CROSS[1] - CROSS[0], 0.5);
      }
      ctx.fillRect(STOP - 0.3, CENTER, 0.3, ROAD[1] - CENTER);
      ctx.fillRect(W - STOP, ROAD[0], 0.3, CENTER - ROAD[0]);
    }

    function drawCar(lane, car) {
      const cx = lane.dir > 0 ? car.s - car.len / 2 : W - car.s + car.len / 2;
      const L = car.len, Wd = car.wid;
      ctx.save();
      ctx.translate(cx, lane.y);
      if (lane.dir < 0) ctx.rotate(Math.PI);

      if (t - car.conflict < 1.5) halo(0, 0, L * 0.75);

      ctx.fillStyle = 'rgba(0,0,0,.4)';
      roundRect(-L / 2 + 0.15, -Wd / 2 + 0.2, L, Wd, 0.5);
      ctx.fillStyle = car.color;
      roundRect(-L / 2, -Wd / 2, L, Wd, 0.5);

      // parbrizul, plafonul, luneta
      ctx.fillStyle = 'rgba(20,30,40,.85)';
      trapezoid(L / 2 - 1.55, L / 2 - 1.05, Wd / 2 - 0.22, Wd / 2 - 0.12);
      ctx.fillStyle = 'rgba(0,0,0,.18)';
      ctx.fillRect(-L / 2 + 0.95, -Wd / 2 + 0.22, L - 2.5, Wd - 0.44);
      ctx.fillStyle = 'rgba(20,30,40,.85)';
      trapezoid(-L / 2 + 0.95, -L / 2 + 0.55, Wd / 2 - 0.22, Wd / 2 - 0.3);
      // oglinzile
      ctx.fillStyle = car.color;
      ctx.fillRect(L / 2 - 1.5, -Wd / 2 - 0.18, 0.25, 0.2);
      ctx.fillRect(L / 2 - 1.5, Wd / 2 - 0.02, 0.25, 0.2);

      // farurile și stopurile (aprinse la frânare sau oprit)
      ctx.fillStyle = '#fff6c8';
      ctx.fillRect(L / 2 - 0.12, -Wd / 2 + 0.15, 0.12, 0.35);
      ctx.fillRect(L / 2 - 0.12, Wd / 2 - 0.5, 0.12, 0.35);
      const braking = car.acc < -0.6 || car.v < 0.2;
      ctx.fillStyle = braking ? '#ff2a1f' : '#7a1612';
      if (braking) { ctx.shadowColor = '#ff2a1f'; ctx.shadowBlur = 8 * dpr; }
      ctx.fillRect(-L / 2, -Wd / 2 + 0.15, 0.14, 0.38);
      ctx.fillRect(-L / 2, Wd / 2 - 0.53, 0.14, 0.38);
      ctx.shadowBlur = 0;

      if (car.ranRed) {
        ctx.rotate(lane.dir < 0 ? Math.PI : 0);
        badge(0, 0, '!', '#ff3b30');
      }
      ctx.restore();
    }

    function drawPed(p) {
      ctx.save();
      ctx.translate(p.x, p.y);
      if (t - p.conflict < 1.5) halo(0, 0, 0.9);
      ctx.rotate(p.heading);
      ctx.scale(1.6, 1.6);   // pietonii sunt desenați mai mari decât la scară, ca să se vadă
      // picioarele, care se mișcă doar la mers
      const swing = p.moving ? Math.sin(p.anim) * 0.22 : 0;
      ctx.fillStyle = '#1b1b1b';
      ellipse(swing, -0.15, 0.13, 0.08);
      ellipse(-swing, 0.15, 0.13, 0.08);
      // umerii (haina) și capul
      ctx.fillStyle = 'rgba(0,0,0,.3)';
      ellipse(0.06, 0.06, 0.24, 0.42);
      ctx.fillStyle = p.color;
      ellipse(0, 0, 0.24, 0.42);
      ctx.fillStyle = p.hair;
      circle(0.02, 0, 0.19);
      ctx.restore();
    }

    function drawSignals(sig) {
      const car = sig.car, ped = sig.ped;
      // semafoarele pentru mașini, înainte de linia de oprire, în dreapta șoferului
      carHead(STOP - 1.9, SIDEWALK_BOTTOM[0] + 0.5, car);
      carHead(W - STOP + 0.6, SIDEWALK_TOP[0] + 0.2, car);
      // semafoarele pentru pietoni, cu numărătoarea și butonul cu lampa AȘTEPTAȚI
      pedHead(CROSS[1] + 0.6, SIDEWALK_BOTTOM[0] + 0.4, ped, sig.seconds, +1);
      pedHead(CROSS[0] - 1.9, SIDEWALK_TOP[0] + 0.9, ped, sig.seconds, -1);
      pushButton(CROSS[0] - 1.6, SIDEWALK_BOTTOM[0] + 0.45, sig.wait, buttonFlash.bottom);
      pushButton(CROSS[1] + 0.4, SIDEWALK_TOP[1] - 1.45, sig.wait, buttonFlash.top);
    }

    function carHead(x, y, color) {
      ctx.fillStyle = 'rgba(0,0,0,.35)';
      roundRect(x + 0.15, y + 0.15, 1.3, 3.3, 0.3);
      ctx.fillStyle = '#111';
      roundRect(x, y, 1.3, 3.3, 0.3);
      lamp(x + 0.65, y + 0.6, 0.42, color === 'RED', '#ff3b30', '#3a1414');
      lamp(x + 0.65, y + 1.65, 0.42, color === 'YELLOW', '#ffcc00', '#3a3210');
      lamp(x + 0.65, y + 2.7, 0.42, color === 'GREEN', '#34c759', '#123a1c');
    }

    function pedHead(x, y, color, seconds, side) {
      ctx.fillStyle = 'rgba(0,0,0,.35)';
      roundRect(x + 0.15, y + 0.15, 1.3, 2.3, 0.3);
      ctx.fillStyle = '#111';
      roundRect(x, y, 1.3, 2.3, 0.3);
      lamp(x + 0.65, y + 0.6, 0.42, color === 'RED', '#ff3b30', '#3a1414');
      lamp(x + 0.65, y + 1.7, 0.42, color === 'GREEN', '#34c759', '#123a1c');
      // numărătoarea, lângă lampa verde
      const bx = side > 0 ? x + 1.45 : x - 1.6;
      ctx.fillStyle = '#111';
      roundRect(bx, y + 1.05, 1.45, 1.25, 0.2);
      if (seconds > 0 && color === 'GREEN') {
        ctx.fillStyle = '#34c759';
        ctx.font = 'bold 1.0px ui-monospace, Menlo, Consolas, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(seconds), bx + 0.72, y + 1.72);
      }
    }

    function pushButton(x, y, wait, flashedAt) {
      ctx.fillStyle = '#111';
      roundRect(x, y, 1.2, 1.0, 0.2);
      lamp(x + 0.6, y + 0.5, 0.3, wait, '#ffcc00', '#3a3210');
      if (t - flashedAt < 0.35) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 0.12;
        ctx.beginPath();
        ctx.arc(x + 0.6, y + 0.5, 0.75, 0, 2 * Math.PI);
        ctx.stroke();
      }
    }

    function lamp(x, y, r, on, onColor, offColor) {
      if (on) { ctx.shadowColor = onColor; ctx.shadowBlur = 14 * dpr; }
      ctx.fillStyle = on ? onColor : offColor;
      circle(x, y, r);
      ctx.shadowBlur = 0;
    }

    function caption(text) {
      ctx.font = 'bold 1.15px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const w = ctx.measureText(text).width + 2;
      ctx.fillStyle = 'rgba(20,22,25,.82)';
      roundRect(W / 2 - w / 2, 0.6, w, 2, 0.4);
      ctx.fillStyle = '#ff9f0a';
      ctx.fillText(text, W / 2, 1.62);
    }

    function halo(x, y, r) {
      const pulse = 0.5 + 0.5 * Math.sin(t * 12);
      ctx.fillStyle = `rgba(255,59,48,${0.25 + 0.25 * pulse})`;
      circle(x, y, r);
    }

    function badge(x, y, text, color) {
      ctx.fillStyle = color;
      circle(x, y, 0.55);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 0.85px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, x, y + 0.05);
    }

    function circle(x, y, r) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 2 * Math.PI);
      ctx.fill();
    }

    function ellipse(x, y, rx, ry) {
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, 0, 0, 2 * Math.PI);
      ctx.fill();
    }

    function roundRect(x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
      ctx.fill();
    }

    /** Geam de mașină: trapez între x0 și x1, cu semilățimile h0 și h1. */
    function trapezoid(x0, x1, h0, h1) {
      ctx.beginPath();
      ctx.moveTo(x0, -h0);
      ctx.lineTo(x1, -h1);
      ctx.lineTo(x1, h1);
      ctx.lineTo(x0, h0);
      ctx.closePath();
      ctx.fill();
    }

    // ---------------------------------------------------------- bucla de animație

    let last = performance.now();
    let catchingUp = false;
    function frame(now) {
      // Browserul nu animă taburile ascunse: simularea stă și continuă de unde a
      // rămas, dar lămpile au mers mai departe (poate a trecut un galben nevăzut).
      catchingUp = now - last > 500;
      let dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      while (dt > 0) {
        const h = Math.min(dt, 1 / 60);
        step(h);
        dt -= h;
      }
      draw();
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);

    return {
      reset,
      setCarRate(r) { carRate = r; for (const l of lanes) l.nextSpawn = t + expRandom(r); },
      setPedRate(r) { pedRate = r; nextPed = t + expRandom(r); },
      setAutoPress(on) { autoPress = on; },
      flashButtons() { buttonFlash.top = buttonFlash.bottom = t; },

      /** Cifrele afișate în pagină. */
      stats() {
        const stopped = lanes.map(l => l.cars.filter(c => c.v < 1 && c.s <= STOP + 0.1).length + l.pending);
        const hidden = lanes.reduce((n, l) => n + l.pending, 0);
        const waiting = peds.filter(p => p.state === 'wait');
        const longest = waiting.reduce((m, p) => Math.max(m, t - p.waitSince), 0);
        const avg = stats.waits.length ? stats.waits.reduce((a, b) => a + b, 0) / stats.waits.length : null;
        return {
          carsStopped: lanes.map((l, i) => `${l.name} ${stopped[i]}`).join('   ') + (hidden ? `   (${hidden} în afara imaginii)` : ''),
          pedsWaiting: waiting.length ? `${waiting.length}, cel mai vechi de ${longest.toFixed(0)} s` : '0',
          pedsWait: avg === null ? '–' : `în medie ${avg.toFixed(1)} s (ultimii ${stats.waits.length} pietoni)`,
          redRunners: stats.redRunners,
          conflicts: stats.conflicts,
        };
      },
    };
  }

  /** Clădirile și copacii, aceiași la fiecare pornire. */
  function makeDecor() {
    let seed = 7;
    const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const trees = [], buildings = [];
    for (let x = 1.5; x < W; x += 3 + r() * 3) {
      trees.push({ x, y: 1.6 + r() * 1.2, r: 1.1 + r() * 0.7, color: ['#2f5a34', '#3a6b3c', '#2c4f30'][Math.floor(r() * 3)] });
    }
    for (let x = 0.5; x < W - 3; ) {
      const w = 5 + r() * 7;
      if (r() < 0.75) {
        buildings.push({ x, y: SIDEWALK_BOTTOM[1] + 0.8, w, h: H - SIDEWALK_BOTTOM[1] - 0.8,
                         color: ['#5b5550', '#6a5f55', '#4f5660', '#6b6b6b', '#5e4b45'][Math.floor(r() * 5)] });
      } else {
        trees.push({ x: x + w / 2, y: SIDEWALK_BOTTOM[1] + 2, r: 1.3, color: '#2f5a34' });
      }
      x += w + 0.6;
    }
    return { trees, buildings };
  }

  return { create };
})();
