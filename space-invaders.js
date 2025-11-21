/* Space Invaders — vanilla JS canvas
 * Features: player, bullets, enemy grid marching/descending, bombs,
 * shields, levels, score, lives, high score (localStorage), pause/mute/reset,
 * keyboard + touch controls, simple WebAudio bleeps.
 */

(() => {
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;

  // UI elements
  const elScore = document.getElementById("score");
  const elHigh = document.getElementById("highscore");
  const elLives = document.getElementById("lives");
  const elLevel = document.getElementById("level");
  const btnPause = document.getElementById("btn-pause");
  const btnMute  = document.getElementById("btn-mute");
  const btnReset = document.getElementById("btn-reset");
  const tLeft  = document.getElementById("t-left");
  const tRight = document.getElementById("t-right");
  const tFire  = document.getElementById("t-fire");

  // Persistent high score
  const HS_KEY = "si_highscore_v1";
  const clamp  = (n, a, b) => Math.max(a, Math.min(b, n));
  const rand   = (a, b) => a + Math.random() * (b - a);

  // Simple sounds via WebAudio (no external files)
  let audioCtx = null;
  let muted = false;
  function beep({freq=440, type="square", dur=0.08, vol=0.03} = {}) {
    if (muted) return;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, audioCtx.currentTime);
      g.gain.setValueAtTime(vol, audioCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
      o.connect(g).connect(audioCtx.destination);
      o.start(); o.stop(audioCtx.currentTime + dur);
    } catch {}
  }

  // Input
  const keys = { left:false, right:false, fire:false, pause:false };
  document.addEventListener("keydown", (e) => {
    if (e.repeat) return;
    if (e.code === "ArrowLeft"  || e.code === "KeyA") keys.left  = true;
    if (e.code === "ArrowRight" || e.code === "KeyD") keys.right = true;
    if (e.code === "Space") keys.fire = true;
    if (e.code === "KeyP") togglePause();
    if (e.code === "KeyM") toggleMute();
    if (e.code === "KeyR") resetGame();
  });
  document.addEventListener("keyup", (e) => {
    if (e.code === "ArrowLeft"  || e.code === "KeyA") keys.left  = false;
    if (e.code === "ArrowRight" || e.code === "KeyD") keys.right = false;
    if (e.code === "Space") keys.fire = false;
  });

  // Touch controls
  let touchLeft=false, touchRight=false;
  tLeft?.addEventListener("touchstart", e=>{e.preventDefault(); touchLeft=true;});
  tLeft?.addEventListener("touchend",   e=>{e.preventDefault(); touchLeft=false;});
  tRight?.addEventListener("touchstart",e=>{e.preventDefault(); touchRight=true;});
  tRight?.addEventListener("touchend",  e=>{e.preventDefault(); touchRight=false;});
  tFire?.addEventListener("touchstart", e=>{e.preventDefault(); playerTryFire(); beep({freq:700, dur:.05, vol:.025});});

  btnPause?.addEventListener("click", () => togglePause());
  btnMute?.addEventListener("click",  () => toggleMute());
  btnReset?.addEventListener("click", () => resetGame());

  // Entities
  class Entity {
    constructor(x,y,w,h){ this.x=x; this.y=y; this.w=w; this.h=h; this.dead=false; }
    get rect(){ return {x:this.x, y:this.y, w:this.w, h:this.h}; }
    intersects(o){
      return !(this.x+this.w<o.x || this.x>o.x+o.w || this.y+this.h<o.y || this.y>o.y+o.h);
    }
  }

  class Player extends Entity {
    constructor(){
      super(W/2-20, H-70, 40, 22);
      this.speed = 280;
      this.cooldown = 0;
      this.lives = 3;
    }
    update(dt) {
      const movingLeft  = keys.left  || touchLeft;
      const movingRight = keys.right || touchRight;
      if (movingLeft) this.x -= this.speed*dt;
      if (movingRight) this.x += this.speed*dt;
      this.x = clamp(this.x, 10, W-10-this.w);

      if (this.cooldown>0) this.cooldown -= dt;
      if (keys.fire) playerTryFire();
    }
    draw() {
      // Stylized player ship (pixel look)
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.fillStyle = "#85f5ff";
      ctx.fillRect(0, this.h-4, this.w, 4);
      ctx.fillStyle = "#4bd6ff";
      ctx.fillRect(8, this.h-10, this.w-16, 6);
      ctx.fillStyle = "#35a7ff";
      ctx.fillRect(this.w/2-6, 0, 12, this.h-10);
      ctx.restore();
    }
  }

  class Bullet extends Entity {
    constructor(x,y,vy=-520){
      super(x-2, y, 4, 12);
      this.vy = vy;
    }
    update(dt){
      this.y += this.vy*dt;
      if (this.y < -20 || this.y > H+20) this.dead = true;
    }
    draw(){
      ctx.fillStyle = "#fff";
      ctx.fillRect(this.x, this.y, this.w, this.h);
    }
  }

  class Bomb extends Entity {
    constructor(x,y){
      super(x-3,y,6,10);
      this.vy = rand(140, 220);
    }
    update(dt){
      this.y += this.vy*dt;
      if (this.y > H+20) this.dead = true;
    }
    draw(){
      ctx.fillStyle = "#ff5050";
      ctx.fillRect(this.x, this.y, this.w, this.h);
    }
  }

  class Enemy extends Entity {
    constructor(x,y,type=0){ // type affects score/sprite
      super(x,y, 30, 22);
      this.type = type; // 0 bottom, 1 middle, 2 top (like classic)
      this.frame = 0;
    }
    draw(){
      ctx.save();
      ctx.translate(this.x, this.y);
      // Simple two-frame animation by swapping blocks:
      const c = ["#7cff7c","#a0ffa0","#c8ffc8"][this.type] || "#7cff7c";
      ctx.fillStyle = c;
      const f = this.frame;
      // Little pixel-y alien
      const px = 2; // pixel size
      const pattern = (f===0)
        ? ["01110",
           "11011",
           "11111",
           "10101",
           "10001"]
        : ["01110",
           "11011",
           "11111",
           "01010",
           "11011"];
      for (let r=0; r<pattern.length; r++){
        for (let col=0; col<pattern[r].length; col++){
          if (pattern[r][col]==="1"){
            ctx.fillRect(col*px+4, r*px+3, px, px);
          }
        }
      }
      ctx.restore();
    }
  }

  class ShieldBlock extends Entity {
    constructor(x,y){ super(x,y, 8, 8); this.hp = 3; }
    hit(){ this.hp--; if (this.hp<=0) this.dead=true; }
    draw(){
      ctx.fillStyle = ["#59c", "#47a", "#258"][clamp(this.hp-1,0,2)];
      ctx.fillRect(this.x, this.y, this.w, this.h);
    }
  }

  // Particles for little explosions
  class Particle {
    constructor(x,y){
      this.x=x; this.y=y;
      this.vx = rand(-60,60);
      this.vy = rand(-140,-40);
      this.life = rand(.25,.6);
      this.age = 0;
    }
    update(dt){ this.age+=dt; this.x+=this.vx*dt; this.y+=this.vy*dt; this.vy+=280*dt; }
    draw(){
      const t = 1 - this.age/this.life;
      if (t<=0) return;
      ctx.globalAlpha = Math.max(0, t);
      ctx.fillStyle="#fff";
      ctx.fillRect(this.x, this.y, 2, 2);
      ctx.globalAlpha = 1;
    }
    get dead(){ return this.age>=this.life; }
  }

  // Game state
  const bullets = [];
  const bombs   = [];
  const enemies = [];
  const shields = [];
  const particles = [];

  const player = new Player();
  let fleet = {
    vx: 45, // horizontal speed
    dir: 1, // 1 right, -1 left
    stepDown: 20,
    left: Infinity, right: -Infinity, bottom: -Infinity,
    fireTimer: 0,
  };

  let score = 0;
  let high  = parseInt(localStorage.getItem(HS_KEY) || "0", 10) || 0;
  elHigh.textContent = high;
  let level = 1;
  let paused = false;
  let gameOver = false;
  let justWon = false;

  function setHUD(){
    elScore.textContent = score;
    elLives.textContent = player.lives;
    elLevel.textContent = level;
    elHigh.textContent  = Math.max(high, score);
  }

  function makeShields() {
    shields.length = 0;
    // 4 shield groups with 6x4 blocks each
    const groups = 4, blocksX = 6, blocksY = 4, gap = W/(groups+1);
    for (let g=1; g<=groups; g++){
      const gx = g*gap - 30;
      const gy = H-160;
      for (let r=0; r<blocksY; r++){
        for (let c=0; c<blocksX; c++){
          shields.push(new ShieldBlock(gx + c*9, gy + r*9));
        }
      }
    }
  }

  function makeEnemies() {
    enemies.length = 0;
    // Rows like classic: 5 rows x 11 columns
    const rows = 5, cols = 11;
    const startX = 80, startY = 70, cellW = 52, cellH = 38;
    for (let r=0; r<rows; r++){
      for (let c=0; c<cols; c++){
        const type = (r<1?2 : r<3?1 : 0);
        enemies.push(new Enemy(startX + c*cellW, startY + r*cellH, type));
      }
    }
    fleet.vx = 35 + level*6; // scale per level
    fleet.dir = 1;
    fleet.stepDown = 18 + Math.min(12, level*2);
  }

  function resetGame(hard=true){
    score = 0;
    level = 1;
    player.lives = 3;
    gameOver = false; justWon = false;
    bullets.length = bombs.length = enemies.length = shields.length = particles.length = 0;
    makeShields(); makeEnemies(); setHUD();
    if (!hard) return; // button always hard, but callable for next level soft reset
  }

  // Fire logic
  function playerTryFire(){
    if (gameOver || paused) return;
    if (player.cooldown<=0){
      bullets.push(new Bullet(player.x + player.w/2, player.y-8, -520));
      player.cooldown = .25;
      beep({freq: 900, dur:.05, vol:.02});
    }
  }

  function enemyRandomFire(dt){
    // Fire more bombs when more enemies alive and as level increases
    const alive = enemies.length;
    if (!alive) return;
    fleet.fireTimer -= dt;
    const base = clamp(1.2 - level*0.07, 0.45, 1.2);
    if (fleet.fireTimer<=0){
      // pick a random column bottom-most enemy
      const byCol = new Map();
      for (const e of enemies) {
        const col = Math.round((e.x - 80) / 52);
        const cur = byCol.get(col);
        if (!cur || e.y > cur.y) byCol.set(col, e);
      }
      const arr = [...byCol.values()];
      const shooter = arr[Math.floor(Math.random()*arr.length)];
      bombs.push(new Bomb(shooter.x + shooter.w/2, shooter.y + shooter.h));
      beep({freq: 200, type:"sawtooth", dur:.04, vol:.02});
      fleet.fireTimer = base + Math.random()*base;
    }
  }

  // Collisions
  function hitShield(rect){
    for (const s of shields){
      if (s.dead) continue;
      if (!(rect.x+rect.w<s.x || rect.x>s.x+s.w || rect.y+rect.h<s.y || rect.y>s.y+s.h)){
        s.hit();
        return true;
      }
    }
    return false;
  }

  function killEnemy(e){
    e.dead = true;
    score += (e.type===2? 30 : e.type===1? 20 : 10);
    for (let i=0;i<8;i++) particles.push(new Particle(e.x+e.w/2, e.y+e.h/2));
    beep({freq: 500 + e.type*120, type:"triangle", dur:.07, vol:.03});
  }

  function loseLife(){
    player.lives--;
    beep({freq: 120, type:"sawtooth", dur:.25, vol:.05});
    for (let i=0;i<16;i++) particles.push(new Particle(player.x+player.w/2, player.y+player.h/2));
    if (player.lives<=0){
      gameOver = true;
      if (score>high){ high = score; localStorage.setItem(HS_KEY, String(high)); }
    } else {
      // grace period: clear bullets/bombs
      bullets.length = 0; bombs.length = 0;
      player.x = W/2 - player.w/2;
    }
  }

  // Update fleet bounds + marching logic
  let animTimer = 0; // for alien leg flip
  function updateFleet(dt){
    fleet.left = Infinity; fleet.right = -Infinity; fleet.bottom = -Infinity;
    for (const e of enemies){ fleet.left = Math.min(fleet.left, e.x); fleet.right = Math.max(fleet.right, e.x + e.w); fleet.bottom = Math.max(fleet.bottom, e.y + e.h); }
    const hitWallRight = fleet.right >= W - 20;
    const hitWallLeft  = fleet.left  <= 20;

    // Speed up slightly as enemies dwindle (classic feel)
    const speedFactor = 1 + (1 - enemies.length / 55) * 0.9 + (level-1)*0.1;
    const vx = fleet.vx * fleet.dir * speedFactor;

    if (hitWallRight && fleet.dir>0){
      for (const e of enemies) e.y += fleet.stepDown;
      fleet.dir = -1;
    } else if (hitWallLeft && fleet.dir<0){
      for (const e of enemies) e.y += fleet.stepDown;
      fleet.dir = 1;
    } else {
      for (const e of enemies) e.x += vx*dt;
    }

    // March animation toggle
    animTimer += dt;
    if (animTimer >= 0.28 / speedFactor){
      for (const e of enemies) e.frame = e.frame?0:1;
      animTimer = 0;
      beep({freq: 90 + Math.random()*30, type:"square", dur:.03, vol:.008}); // subtle marching blip
    }

    // Reach bottom -> life lost
    if (fleet.bottom >= H - 110) {
      // treat as hit
      loseLife();
      // Push back the fleet slightly to give a chance
      for (const e of enemies) e.y -= 40;
    }
  }

  function togglePause(){
    paused = !paused;
    btnPause.textContent = paused ? "Resume" : "Pause";
  }
  function toggleMute(){
    muted = !muted;
    btnMute.textContent = muted ? "Unmute" : "Mute";
  }

  // Main loop
  let last = performance.now();
  function loop(now){
    requestAnimationFrame(loop);
    const dt = Math.min((now - last)/1000, 0.033); // cap delta
    last = now;
    if (paused) { draw(); return; }
    update(dt);
    draw();
  }

  function update(dt){
    if (gameOver) return;

    player.update(dt);

    // Update bullets
    for (const b of bullets) b.update(dt);
    // Update bombs
    for (const k of bombs) k.update(dt);
    // Update enemies & fleet
    if (enemies.length) {
      updateFleet(dt);
      enemyRandomFire(dt);
    }

    // Bullets vs enemies / shields
    for (const b of bullets){
      if (b.dead) continue;
      // Shields first
      if (hitShield(b.rect)) { b.dead = true; continue; }
      for (const e of enemies){
        if (e.dead) continue;
        if (b.intersects(e)){
          b.dead = true;
          killEnemy(e);
          break;
        }
      }
    }

    // Bombs vs shields / player
    for (const k of bombs){
      if (k.dead) continue;
      if (hitShield(k.rect)) { k.dead = true; continue; }
      if (k.intersects(player)) { k.dead = true; loseLife(); }
    }

    // Bullets vs bombs (shoot bombs to save yourself)
    for (const b of bullets){
      if (b.dead) continue;
      for (const k of bombs){
        if (k.dead) continue;
        if (b.intersects(k)){ b.dead=true; k.dead=true; beep({freq:300, dur:.04, vol:.02}); break; }
      }
    }

    // Clean up
    for (let i=bullets.length-1;i>=0;i--) if (bullets[i].dead) bullets.splice(i,1);
    for (let i=bombs.length-1;i>=0;i--)   if (bombs[i].dead) bombs.splice(i,1);
    for (let i=enemies.length-1;i>=0;i--) if (enemies[i].dead) enemies.splice(i,1);
    for (let i=shields.length-1;i>=0;i--) if (shields[i].dead) shields.splice(i,1);

    // Particles
    for (const p of particles) p.update(dt);
    for (let i=particles.length-1;i>=0;i--) if (particles[i].dead) particles.splice(i,1);

    // Next level?
    if (!enemies.length && !gameOver){
      justWon = true;
      level++;
      beep({freq: 880, type:"triangle", dur:.25, vol:.05});
      // Soft reset for next wave
      bullets.length = bombs.length = 0;
      makeEnemies();
      setHUD();
    }

    // Update HUD & high score
    if (score>high){ high = score; localStorage.setItem(HS_KEY, String(high)); }
    setHUD();
  }

  function draw(){
    // background
    ctx.fillStyle = "#000";
    ctx.fillRect(0,0,W,H);

    // stars
    ctx.fillStyle = "#0c0c18";
    for (let i=0;i<60;i++){
      const x=(i*131)%W, y=(i*97)%H;
      ctx.fillRect(x, y, 1, 1);
    }

    // entities
    for (const s of shields) s.draw();
    for (const e of enemies) e.draw();
    for (const b of bullets) b.draw();
    for (const k of bombs)   k.draw();
    player.draw();
    for (const p of particles) p.draw();

    // overlays
    if (paused){
      drawBanner("PAUSED — P to Resume");
    } else if (gameOver){
      drawBanner("GAME OVER — R to Restart");
    } else if (justWon){
      // brief banner on level up
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = "#0a0a0a";
      ctx.fillRect(W/2-180, H/2-50, 360, 100);
      ctx.globalAlpha = 1;
      ctx.strokeStyle="#444"; ctx.strokeRect(W/2-180, H/2-50, 360, 100);
      ctx.fillStyle="#eaff86"; ctx.font="24px system-ui, sans-serif";
      ctx.textAlign="center";
      ctx.fillText(`Level ${level-1} Cleared!`, W/2, H/2-8);
      ctx.fillStyle="#fff";
      ctx.font="16px system-ui, sans-serif";
      ctx.fillText(`Get ready for Level ${level}`, W/2, H/2+20);
      ctx.restore();
      // fade message naturally as action resumes
      justWon = false;
    }
  }

  function drawBanner(text){
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = "#0a0a0a";
    ctx.fillRect(W/2-220, H/2-60, 440, 120);
    ctx.globalAlpha = 1;
    ctx.strokeStyle="#444"; ctx.strokeRect(W/2-220, H/2-60, 440, 120);
    ctx.fillStyle="#fff"; ctx.font="24px system-ui, sans-serif";
    ctx.textAlign="center";
    ctx.fillText(text, W/2, H/2+8);
    ctx.restore();
  }

  // Init
  function init(){
    makeShields();
    makeEnemies();
    setHUD();
    requestAnimationFrame(loop);
  }

  resetGame(false);
  init();
})();
