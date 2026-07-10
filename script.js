/* ===== Marmellina — Oktoberfest Golf ===== */
(function () {
  "use strict";

  // -------- CONFIG (valori regolabili) --------
  var CFG = {
    STAGE_W: 960, STAGE_H: 540,
    GROUND_Y: 398,        // y (mondo) su cui rotola la pallina
    START_X: 150,         // x di partenza pallina
    BALL_R: 15,
    FIELD_LEN: 3400,
    G: 0.46,              // gravita'
    VMAX: 27,             // velocita' iniziale massima (forza 100%)
    RESTITUTION: 0.5,     // rimbalzo verticale
    HIT_FRICTION: 0.74,   // attrito orizzontale ad ogni rimbalzo
    ROLL_FRICTION: 0.982, // attrito di rotolamento per frame
    STOP_SPEED: 0.55,
    ANG_MIN: 24, ANG_MAX: 74,   // angolo di lancio (gradi)
    ANG_SPEED: 1.15,            // velocita' oscillazione direzione
    FORCE_SPEED: 0.028,        // velocita' oscillazione forza
    BAND_W: 265,               // larghezza zone punteggio
    BAND_START: 470,
    TRAP_PROB: 0.4,
    MAX_SHOTS: 5,
    SWING_REST: -6, SWING_BACK: -72, SWING_THRU: 60, SWING_DUR: 340, SWING_CONTACT: 0.86
  };

  var METER_PER_PX = 1 / 11.5;

  // -------- DOM --------
  var $ = function (id) { return document.getElementById(id); };
  var screens = {
    intro: $("screen-intro"), menu: $("screen-menu"),
    game: $("screen-game"), end: $("screen-end")
  };
  var slides = document.querySelectorAll(".intro-slide");
  var introCaption = $("intro-caption");
  var world = $("world"), skyL = document.querySelector(".sky"),
      tentsL = document.querySelector(".tents");
  var player = $("player"), arm = $("arm"), ball = $("ball"),
      zonesEl = $("zones"), groundEl = $("ground");
  var hudShot = $("hud-shot"), hudMax = $("hud-max"), hudDist = $("hud-dist");
  var meterDir = $("meter-dir"), meterForce = $("meter-force"),
      needle = $("needle"), forceFill = $("force-fill"), promptEl = $("prompt");
  var shotOverlay = $("shot-overlay"), shotPoints = $("shot-points"),
      shotLabel = $("shot-label"), shotTotal = $("shot-total"),
      shotNum = $("shot-num"), shotNumMax = $("shot-num-max"), btnNext = $("btn-next");
  shotNumMax.textContent = 5;
  var endBg = $("end-bg"), endTitle = $("end-title"),
      endPcVal = $("end-pc-value"), endSub = $("end-sub");

  // -------- STATO --------
  var state = "idle";      // idle | aim | power | fly | resolve
  var score = 0, shot = 0;
  var angle = 45, power = 0, angDir = 1, powDir = 1;
  var bx = 0, by = 0, vx = 0, vy = 0, ballRot = 0, rolling = false;
  var camX = 0, bands = [], rafId = 0, lastT = 0;

  hudMax.textContent = CFG.MAX_SHOTS;

  // ---------- util ----------
  function show(name) {
    for (var k in screens) screens[k].classList.toggle("is-active", k === name);
  }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function ri(a, b) { return Math.floor(rnd(a, b + 1)); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  // ---------- scaling stage (fullscreen: altezza fissa 540, larghezza dinamica) ----------
  var stageEl = $("stage");
  var BASE_W = 960;
  function fit() {
    var vw = window.innerWidth, vh = window.innerHeight;
    var scaleH = vh / CFG.STAGE_H;         // scala che riempie l'altezza
    var designW = vw / scaleH;             // larghezza risultante in unità di design
    var s, dw;
    if (designW >= BASE_W) {               // landscape: pieno schermo, campo più largo
      s = scaleH; dw = designW;
    } else {                               // stretto/portrait: adatta alla larghezza (bande sopra/sotto)
      s = vw / BASE_W; dw = BASE_W;
    }
    CFG.STAGE_W = Math.round(dw);
    stageEl.style.width = CFG.STAGE_W + "px";
    stageEl.style.height = CFG.STAGE_H + "px";
    stageEl.style.transform = "translate(-50%,-50%) scale(" + s + ")";
    setCamera();
  }
  window.addEventListener("resize", fit); fit();

  // ================= INTRO =================
  var introSteps = [
    { i: 0, cap: "Un tranquillo Oktoberfest… quando all'improvviso, un tonfo sotto la gonna!", t: 300 },
    { i: 1, cap: "«Ma cos'è?!» Marmellino sbircia sotto la gonna…", t: 3200 },
    { i: 2, cap: "Una palla di legno! La partita può cominciare. 🍺", t: 6400 }
  ];
  var introTimers = [];
  function runIntro() {
    show("intro");
    introTimers.forEach(clearTimeout); introTimers = [];
    slides.forEach(function (s) { s.classList.remove("show"); });
    introCaption.classList.remove("show");
    introSteps.forEach(function (st) {
      introTimers.push(setTimeout(function () {
        slides.forEach(function (s, idx) { s.classList.toggle("show", idx === st.i); });
        introCaption.textContent = st.cap; introCaption.classList.add("show");
      }, st.t));
    });
    introTimers.push(setTimeout(toMenu, 9400));
  }
  $("btn-skip").addEventListener("click", toMenu);
  function toMenu() { introTimers.forEach(clearTimeout); show("menu"); }

  // ================= MENU =================
  $("btn-play").addEventListener("click", startGame);
  $("btn-again").addEventListener("click", startGame);

  // ================= GIOCO =================
  function startGame() {
    score = 0; shot = 0;
    groundEl.style.width = CFG.FIELD_LEN + "px";   // terreno lungo tutto il campo (niente buchi azzurri)
    show("game");
    nextShot();
  }

  function buildBands() {
    bands = []; zonesEl.innerHTML = "";
    var n = Math.floor((CFG.FIELD_LEN - CFG.BAND_START - 180) / CFG.BAND_W);
    for (var i = 0; i < n; i++) {
      var x0 = CFG.BAND_START + i * CFG.BAND_W;
      var cx = x0 + CFG.BAND_W / 2;
      var tier = Math.round(1 + 4 * i / (n - 1));       // 1..5 in base alla distanza
      var trap = Math.random() < CFG.TRAP_PROB && i > 0; // prima zona sempre buona
      var val = trap ? -ri(1, 5) : tier;
      bands.push({ x0: x0, x1: x0 + CFG.BAND_W, val: val });

      var z = document.createElement("div");
      z.className = "zone " + (trap ? "neg" : "pos");
      z.style.left = cx + "px";
      z.innerHTML =
        '<img src="assets/' + (trap ? 'zone-neg' : 'zone-pos') + '.png" alt="">' +
        '<div class="val">' + (val > 0 ? "+" + val : val) + "</div>";
      z.dataset.band = i;
      zonesEl.appendChild(z);
    }
  }

  function placePlayer() {
    player.style.left = (CFG.START_X - 96) + "px";
    arm.style.transform = "rotate(" + CFG.SWING_REST + "deg)";
  }

  function resetBall() {
    bx = CFG.START_X; by = CFG.GROUND_Y - CFG.BALL_R; vx = 0; vy = 0;
    ballRot = 0; rolling = false; drawBall();
  }

  function drawBall() {
    ball.style.left = (bx - CFG.BALL_R) + "px";
    ball.style.top = (by - CFG.BALL_R) + "px";
    ball.style.transform = "rotate(" + ballRot + "deg)";
  }

  function setCamera() {
    camX = clamp(bx - 300, 0, CFG.FIELD_LEN - CFG.STAGE_W);
    world.style.transform = "translateX(" + (-camX) + "px)";
    skyL.style.backgroundPositionX = (-camX * 0.2) + "px";
    tentsL.style.backgroundPositionX = (-camX * 0.5) + "px";
  }

  function nextShot() {
    if (shot >= CFG.MAX_SHOTS) { return endGame(); }
    shot++;
    hudShot.textContent = shot;
    buildBands();
    resetBall(); camX = 0; setCamera();
    placePlayer();
    hudDist.textContent = "";
    // fase DIREZIONE
    state = "aim";
    angle = CFG.ANG_MIN; angDir = 1;
    meterDir.className = "meter active";
    meterForce.className = "meter off";
    showPrompt("Tocca / SPAZIO per fissare la DIREZIONE");
    startLoop();
  }

  function showPrompt(txt) { promptEl.textContent = txt; promptEl.className = "prompt blink"; }
  function hidePrompt() { promptEl.className = "prompt"; promptEl.textContent = ""; }

  // ---------- input ----------
  function press() {
    if (state === "aim") {
      state = "power"; power = 0; powDir = 1;
      meterDir.className = "meter off";
      meterForce.className = "meter active";
      showPrompt("Tocca / SPAZIO per fissare la FORZA");
    } else if (state === "power") {
      hidePrompt();
      meterForce.className = "meter off";
      state = "swing";          // fisica sospesa finché la mazza non colpisce
      swingAndLaunch();
    }
  }
  screens.game.addEventListener("pointerdown", function (e) {
    if (e.target.closest("button")) return;
    press();
  });
  window.addEventListener("keydown", function (e) {
    if ((e.code === "Space" || e.code === "Enter") && screens.game.classList.contains("is-active")) {
      e.preventDefault(); press();
    }
  });

  // ---------- swing ----------
  function swingAndLaunch() {
    var t0 = performance.now(), launched = false;
    var BACK_P = 0.34;   // frazione dedicata al caricamento all'indietro
    function anim(now) {
      var p = clamp((now - t0) / CFG.SWING_DUR, 0, 1), deg;
      if (p < BACK_P) {                       // caricamento: rest -> back
        var q = p / BACK_P;
        deg = CFG.SWING_REST + (CFG.SWING_BACK - CFG.SWING_REST) * (q * q);
      } else {                                // colpo: back -> through
        var r = (p - BACK_P) / (1 - BACK_P);
        var e = 1 - Math.pow(1 - r, 3);
        deg = CFG.SWING_BACK + (CFG.SWING_THRU - CFG.SWING_BACK) * e;
      }
      arm.style.transform = "rotate(" + deg + "deg)";
      if (!launched && p >= CFG.SWING_CONTACT) { launched = true; launchBall(); }
      if (p < 1) requestAnimationFrame(anim);
    }
    requestAnimationFrame(anim);
  }

  function launchBall() {
    var rad = angle * Math.PI / 180;
    var v0 = CFG.VMAX * (0.35 + 0.65 * power);   // forza minima garantita
    vx = v0 * Math.cos(rad);
    vy = -v0 * Math.sin(rad);
    rolling = false;
    state = "fly";               // ora la fisica può partire
    spawnPuff(bx, by);
  }

  // ---------- loop fisico ----------
  function startLoop() {
    cancelAnimationFrame(rafId);
    lastT = performance.now();
    rafId = requestAnimationFrame(loop);
  }
  function loop(now) {
    var dt = Math.min(2.2, (now - lastT) / 16.67); lastT = now;
    if (state === "aim") {
      angle += angDir * CFG.ANG_SPEED * dt;
      if (angle >= CFG.ANG_MAX) { angle = CFG.ANG_MAX; angDir = -1; }
      if (angle <= CFG.ANG_MIN) { angle = CFG.ANG_MIN; angDir = 1; }
      needle.style.transform = "translateX(-50%) rotate(" + (90 - angle) + "deg)";
    } else if (state === "power") {
      power += powDir * CFG.FORCE_SPEED * dt;
      if (power >= 1) { power = 1; powDir = -1; }
      if (power <= 0) { power = 0; powDir = 1; }
      forceFill.style.height = (power * 100) + "%";
    } else if (state === "fly") {
      physics(dt);
    }
    rafId = requestAnimationFrame(loop);
  }

  function physics(dt) {
    if (!rolling) {
      vy += CFG.G * dt;
      bx += vx * dt; by += vy * dt;
      ballRot += vx * 2.2 * dt;
      var floor = CFG.GROUND_Y - CFG.BALL_R;
      if (by >= floor) {
        by = floor;
        if (Math.abs(vy) > 1.5) {
          vy = -vy * CFG.RESTITUTION;
          vx *= CFG.HIT_FRICTION;
          spawnPuff(bx, CFG.GROUND_Y);
        } else {
          vy = 0; rolling = true;
        }
      }
    } else {
      bx += vx * dt;
      vx *= Math.pow(CFG.ROLL_FRICTION, dt);
      ballRot += vx * 2.2 * dt;
      if (Math.abs(vx) < CFG.STOP_SPEED) { vx = 0; ballEnd(); return; }
    }
    if (bx > CFG.FIELD_LEN - 40) { bx = CFG.FIELD_LEN - 40; vx = 0; ballEnd(); return; }
    var dist = Math.max(0, Math.round((bx - CFG.START_X) * METER_PER_PX));
    hudDist.textContent = "Distanza: " + dist + " m";
    drawBall(); setCamera();
  }

  // ---------- risoluzione tiro ----------
  function ballEnd() {
    if (state !== "fly") return;
    state = "resolve";
    var val = 0, hitBand = -1;
    for (var i = 0; i < bands.length; i++) {
      if (bx >= bands[i].x0 && bx < bands[i].x1) { val = bands[i].val; hitBand = i; break; }
    }
    score += val;
    if (hitBand >= 0) {
      var z = zonesEl.querySelector('[data-band="' + hitBand + '"]');
      if (z) { z.classList.add("hit"); z.querySelector("img").classList.add("hit"); }
      if (val > 0) spawnSparkle(bx, CFG.GROUND_Y - 40);
      else if (val < 0) spawnSplash(bx, CFG.GROUND_Y - 20);
    }
    popupScore(val);
    setTimeout(function () { showShotResult(val); }, 950);
  }

  function showShotResult(val) {
    state = "wait";
    shotNum.textContent = shot;
    shotPoints.textContent = (val > 0 ? "+" + val : val);
    shotPoints.className = "shot-points " + (val > 0 ? "good" : val < 0 ? "bad" : "zero");
    shotLabel.textContent = Math.abs(val) === 1 ? "PUNTO" : "PUNTI";
    shotTotal.textContent = "Totale: " + score + " PC";
    btnNext.textContent = (shot >= CFG.MAX_SHOTS) ? "VEDI RISULTATO" : "RIGIOCA";
    shotOverlay.classList.add("show");
  }
  btnNext.addEventListener("click", function () {
    shotOverlay.classList.remove("show");
    if (shot >= CFG.MAX_SHOTS) endGame();
    else nextShot();
  });

  // ---------- effetti ----------
  function fxImg(src, x, y, w, life) {
    var im = document.createElement("img");
    im.src = "assets/" + src; im.style.position = "absolute";
    im.style.width = w + "px"; im.style.left = (x - w / 2) + "px";
    im.style.top = (y - w / 2) + "px"; im.style.zIndex = 9;
    im.style.pointerEvents = "none";
    im.style.transition = "opacity .4s, transform .5s";
    world.appendChild(im);
    requestAnimationFrame(function () {
      im.style.transform = "scale(1.4)"; setTimeout(function () { im.style.opacity = "0"; }, life - 400);
    });
    setTimeout(function () { im.remove(); }, life);
  }
  function spawnPuff(x, y) { fxImg("puff.png", x, y, 90, 650); }
  function spawnSparkle(x, y) { fxImg("sparkle.png", x, y, 150, 1200); }
  function spawnSplash(x, y) { fxImg("splash.png", x, y, 150, 1200); }

  function popupScore(val) {
    var el = document.createElement("div");
    el.className = "fx-pop " + (val >= 0 ? "good" : "bad");
    el.textContent = (val > 0 ? "+" + val : val) + (Math.abs(val) === 1 ? " punto" : " punti");
    el.style.left = clamp(bx - camX, 80, CFG.STAGE_W - 80) + "px";
    el.style.top = (CFG.GROUND_Y - 120) + "px";
    screens.game.appendChild(el);
    setTimeout(function () { el.remove(); }, 1200);
  }

  // ================= FINE =================
  function endGame() {
    state = "idle"; cancelAnimationFrame(rafId);
    var win = score >= 0;
    endBg.style.backgroundImage = "url('assets/" + (win ? "result-win" : "result-lose") + ".png')";
    endTitle.textContent = win ? "PROSIT! 🍺" : "Che sbronza…";
    endPcVal.textContent = (score >= 0 ? "+" : "") + score;
    endPcVal.style.color = win ? "#f2b705" : "#ff6b5a";
    var n = Math.abs(score), pc = n === 1 ? "Punto Cattura" : "Punti Cattura";
    endSub.textContent = win
      ? "Hai guadagnato " + score + " " + pc + "! Marmellino brinda alla tua mira."
      : "Hai perso " + n + " " + pc + "… la prossima volta occhio alle pozze di birra!";
    show("end");
  }

  // ================= AVVIO =================
  runIntro();
})();
