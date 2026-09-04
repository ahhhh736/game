// ===================== 音效（程序化 Web Audio）=====================
const Sound = (() => {
  let ctx = null, muted = false;
  const AC = window.AudioContext || window.webkitAudioContext;
  function ac() { if (!ctx) ctx = new AC(); return ctx; }
  function tone(freq, dur, type = 'square', vol = 0.15, slideTo = null) {
    if (muted) return;
    const c = ac(), o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, c.currentTime);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, c.currentTime + dur);
    g.gain.setValueAtTime(vol, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
    o.connect(g); g.connect(c.destination);
    o.start(); o.stop(c.currentTime + dur);
  }
  return {
    jump: () => tone(300, 0.12, 'square', 0.15, 600),
    hit: () => tone(140, 0.14, 'sine', 0.22),
    pickup: () => tone(720, 0.08, 'triangle', 0.15),
    put: () => tone(360, 0.08, 'triangle', 0.15),
    merge: () => { tone(500, 0.15, 'square', 0.15, 800); setTimeout(() => tone(820, 0.16, 'square', 0.12), 120); },
    fail: () => tone(220, 0.45, 'sawtooth', 0.18, 80),
    win: () => [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.18, 'square', 0.15), i * 130)),
    firework: () => {                          // 烟花爆炸（柔和版）：低"砰" + 少量轻噼啪
      tone(110, 0.2, 'sine', 0.09, 45);
      for (let i = 0; i < 3; i++) setTimeout(() => tone(700 + Math.random() * 500, 0.05, 'triangle', 0.025), 90 + i * 70);
    },
    toggle: () => { muted = !muted; return muted; },
    isMuted: () => muted,
    resume: () => { if (ctx && ctx.state === 'suspended') ctx.resume(); }
  };
})();

// ===================== 基础设置 =====================
const cv = document.getElementById('cv');
const ctx = cv.getContext('2d');
// 背景图（你已抠掉小人）：assets/bg.jpg
const bgImg = new Image();
let bgReady = false;
bgImg.onload = () => { bgReady = true; };
bgImg.src = 'assets/bg.jpg';
const TILE = 40;                 // 一格高度（逻辑像素）
const GROUND_Y = 520;            // 主地面 y（下移，露出背景图草地）
const GROUND2_Y = GROUND_Y + 200;// 空缺下方路径 y
const WIN_X = 3600;              // 地图最远边界（在出口之后）

function resize() {
  cv.width = window.innerWidth;
  cv.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

// 地图关键坐标
const XQ = 640;                  // 问号方块 x
const OB1 = 1500, OB2 = 1820;    // 两个两格障碍 x
const XG0 = 2240, XG1 = XG0 + 50; // 空缺区间（宽50，正常跳跃可越过）
const EXIT_X = XG0 + 200 + 2 * 360 + 320; // 出口位置：最后一张照片之后再延伸一段路
const SALUTE_X = EXIT_X - 220;            // 敬礼触发位置（出口前）
const NPC_X1 = SALUTE_X + 90;             // 两个敬礼小兵
const NPC_X2 = SALUTE_X + 150;
// 拔河（机关一前）
const TUG_GREEN_X = 340;                  // 绿队单人（迷彩，挣扎）
const TUG_PLAYER_X = 323;                 // 玩家站位（与绿队间隔17）
const TUG_BLUE_X1 = 400, TUG_BLUE_X2 = 436; // 蓝队两人（蓝色服装）
// 射击（机关三对岸路）
const GUN_X = 2400;                       // 地上的枪
const TARGET_X = 2520;                    // 立靶（离枪120，更近）
const TUG_TOP = null;                     // 站位 y 由地面计算

// ===================== 状态 =====================
let state = 'start';  // start | play | photo | win | egg
let char, camera, input;
let organ1Block, debris, particles, pieces, organ1Collected;
let organ2Obs, carrying, remindShown2;
let organ3BannerShown, layer, skipWarned;
let salutePhase, saluteTimer;   // 敬礼阶段: 0未触发 1NPC敬礼 2玩家回礼 3完成
let fireworks, fireworkTimer;   // 烟花粒子与发射计时
// 拔河：0远处 1显示参加 3点击拉锯中 4获胜展示 5完成放行
let tugPhase, ropePos, tugTimer;
// 射击：0枪在地上 2开镜中 3神枪手展示 4完成
let shootPhase, ammo, aimX, aimY, hitHole, shootHintShown;
let scopeKickY = 0;                       // 开镜后坐力（0~1，每次开枪置1并逐帧回位）
let organ1Done, organ2Done;
// 三块纪念拼图：0拔河 1打靶 2敬礼；pieceDrop[i] 为掉在地上的拼图或 null
let pieceGot, pieceDrop;
let last = 0;

function resetGame() {
  char = { x: 80, y: GROUND_Y - 54, vx: 0, vy: 0, w: 33, h: 54, onGround: true, facing: 1 };
  camera = { x: 0, y: 0 };
  input = { left: false, right: false, jump: false, pick: false };
  // 机关一：方块悬在玩家头顶（底部正好在玩家头顶高度）
  organ1Block = { x: XQ, y: GROUND_Y - char.h - TILE, broken: false };
  debris = []; particles = []; pieces = 0; organ1Done = false; organ1Collected = false;
  // 机关二
  organ2Obs = [{ x: OB1, origX: OB1, h: 2 * TILE, gone: false }, { x: OB2, origX: OB2, h: 2 * TILE, gone: false }];
  carrying = null; remindShown2 = false; organ2Done = false;
  // 机关三：layer=top 上方主路；落入坑后切 bottom 下方路（不重生）
  organ3BannerShown = false; layer = 'top'; skipWarned = false;
  salutePhase = 0; saluteTimer = 0;
  fireworks = []; fireworkTimer = 0;
  tugPhase = 0; ropePos = 35; tugTimer = 0;   // 绳子初始偏蓝队
  shootPhase = 0; ammo = 3; aimX = cv.width / 2; aimY = cv.height / 2;
  hitHole = null; shootHintShown = false; scopeKickY = 0;
  pieceGot = [false, false, false]; pieceDrop = [null, null, null];
  buildPieceHUD(); updatePieceHUD();
  buildPuzzle();
  updatePickBtn();
  hideBanner(); hidePhoto(); hideEgg();
  refreshTip();   // 开局即显示当前机关（机关一）的提示
}

// ===================== 拼图 HUD =====================
const puzzleEl = document.getElementById('puzzle');
function buildPuzzle() {
  puzzleEl.className = '';
  puzzleEl.innerHTML = '';
  for (let i = 0; i < GAME_CONTENT.organ1.photoPieces; i++) {
    const d = document.createElement('div');
    d.className = 'pc'; d.textContent = '?';
    puzzleEl.appendChild(d);
  }
}
function updatePuzzle() {
  [...puzzleEl.children].forEach((c, i) => {
    if (i < pieces) { c.className = 'pc on'; c.textContent = '✓'; }
  });
  if (pieces >= GAME_CONTENT.organ1.photoPieces && !puzzleEl.classList.contains('done')) {
    puzzleEl.classList.add('done');
    organ1Collected = true;   // 拾完即解除前进软墙
  }
}
puzzleEl.addEventListener('click', () => {
  if (state === 'play' && pieces >= GAME_CONTENT.organ1.photoPieces && !organ1Done) {
    organ1Done = true; refreshTip();
    showPhoto(GAME_CONTENT.organ1, () => { state = 'play'; });
  }
});

// ===================== 三块纪念拼图（拔河/打靶/敬礼） =====================
const pieceCells = document.getElementById('pieceCells');
const pieceProg = document.getElementById('pieceProg');
function buildPieceHUD() {
  pieceCells.innerHTML = '';
  for (let i = 0; i < 3; i++) {
    const c = document.createElement('div');
    c.className = 'piece-cell'; c.textContent = '?';
    pieceCells.appendChild(c);
  }
}
function updatePieceHUD() {
  const got = pieceGot ? pieceGot.filter(Boolean).length : 0;
  [...pieceCells.children].forEach((c, i) => {
    const g = pieceGot[i];
    c.className = 'piece-cell' + (g ? ' on' : '');
    c.textContent = g ? String(i + 1) : '?';
    c.style.background = g ? GAME_CONTENT.pieces[i].color : 'rgba(255,255,255,.25)';
    c.style.borderColor = g ? '#ffd966' : '#fff';
  });
  pieceProg.textContent = got + '/3';
}
// 机关完成 → 在指定地面位置弹出一块拼图，玩家碰到自动收
function spawnPieceDrop(i, x, groundY, ly) {
  if (pieceGot[i] || pieceDrop[i]) return;
  pieceDrop[i] = { x, groundY, ly };
}
// 画地上的拼图（发光圈 + 带序号小方块）
function drawPieceDrops() {
  for (let i = 0; i < 3; i++) {
    const d = pieceDrop[i];
    if (!d || d.ly !== layer) continue;
    const bob = Math.sin(Date.now() / 260 + i * 1.3) * 3;
    const sx = d.x - camera.x, sy = d.groundY - 16 + bob - camera.y;
    ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 2;
    const R = 17 + Math.sin(Date.now() / 190 + i * 2) * 2;
    ctx.beginPath(); ctx.arc(sx, sy, R, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = GAME_CONTENT.pieces[i].color;
    ctx.beginPath(); ctx.arc(sx, sy, 12, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(String(i + 1), sx, sy + 5);
    ctx.textAlign = 'left';
  }
}

// ===================== 横幅 / 提醒 =====================
const bannerEl = document.getElementById('banner');
let bannerTimer = null;
function showBanner(text, ms = 5000) {
  bannerEl.textContent = text; bannerEl.style.display = 'block';
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => bannerEl.style.display = 'none', ms);
}
function hideBanner() { bannerEl.style.display = 'none'; }

const remindEl = document.getElementById('remind');
const remindTextEl = document.getElementById('remindText');
function showRemind(text) { remindTextEl.textContent = text; remindEl.classList.add('show'); }
function hideRemind() { remindEl.classList.remove('show'); remindTextEl.style.display = 'none'; }
// 当前机关的提示（一个机关结束就切换）
function currentTip() {
  if (!organ1Done) return GAME_CONTENT.organ1.tip;
  if (!organ2Done) return GAME_CONTENT.organ2.tip;
  if (state !== 'win') return GAME_CONTENT.organ3.tip;
  return null;
}
function refreshTip() {
  const t = currentTip();
  if (t) showRemind(t); else hideRemind();
}
remindEl.addEventListener('click', () => {
  remindTextEl.style.display = remindTextEl.style.display === 'block' ? 'none' : 'block';
});

// ===================== 照片弹窗 =====================
const photoModal = document.getElementById('photoModal');
const photoBox = document.getElementById('photoBox');
const photoText = document.getElementById('photoText');
function showPhoto(cfg, onClose) {
  photoBox.textContent = cfg.img ? '' : (cfg.photoPlaceholder || '照片占位');
  photoBox.style.background = cfg.img ? `url(${cfg.img}) center/cover` : '#3b5323';
  photoText.textContent = cfg.caption || '';
  photoModal.classList.add('show'); state = 'photo';
  photoModal.onclick = () => { hidePhoto(); onClose && onClose(); };
}
function hidePhoto() { photoModal.classList.remove('show'); }

// ===================== 彩蛋（三块拼图集齐后） =====================
const eggModal = document.getElementById('egg');
const eggDanmu = document.getElementById('eggDanmu');
const eggStage = document.getElementById('eggStage');
function showEgg() {
  // 收起可能残留的射击 / 拔河界面
  document.getElementById('joinBtn').style.display = 'none';
  hideShootMsg();
  document.getElementById('fireBtn').style.display = 'none';
  document.getElementById('btns').style.display = 'flex';
  document.getElementById('joy').style.display = 'block';

  document.getElementById('eggTitle').textContent = GAME_CONTENT.egg.title;
  eggModal.classList.add('show'); state = 'egg';

  // 三块拼图块（用收集顺序摆到舞台），飞入后拼成 1×3 三联照片
  eggStage.innerHTML = '';
  const pieces = GAME_CONTENT.pieces;
  pieces.forEach((pc, i) => {
    const t = document.createElement('div');
    t.className = 'egg-tile';
    t.style.background = pc.img ? `url(${pc.img}) center/cover` : pc.color;
    const txt = pc.img ? '' : `<div class="ph">${pc.placeholder}</div>`;
    t.innerHTML = txt + `<div class="cap">${i + 1}. ${pc.name}</div>`;
    t.style.animationDelay = (i * 0.55) + 's';
    eggStage.appendChild(t);
  });
  // 测量舞台，把每块定到横向三等分位置，起点设到左上角
  const sw = eggStage.clientWidth;
  const gap = 6, tw = (sw - gap * 2) / 3;
  const sr = eggStage.getBoundingClientRect();
  [...eggStage.children].forEach((t, i) => {
    const leftPx = i * (tw + gap);
    t.style.left = leftPx + 'px';
    t.style.width = tw + 'px';
    t.style.setProperty('--fx', -(sr.left + leftPx + 6) + 'px');
    t.style.setProperty('--fy', -(sr.top + 6) + 'px');
  });
  requestAnimationFrame(() => {
    [...eggStage.children].forEach(t => t.classList.add('fly'));
  });

  // 弹幕文字（叠在拼好的照片上飘）
  eggDanmu.innerHTML = '';
  const items = GAME_CONTENT.egg.danmu;
  items.forEach((txt, i) => {
    const d = document.createElement('div');
    d.className = 'danmu-item'; d.textContent = txt;
    d.style.top = (6 + i * 42) + 'px';
    d.style.animationDuration = (5 + i * 0.5) + 's';
    d.style.animationDelay = (i * 0.8 + 0.8) + 's';
    eggDanmu.appendChild(d);
  });
  // 三块飞完（约2.4s）后再停留 6 秒 → 回主页
  const total = pieces.length * 550 + 700 + 6000;
  setTimeout(() => { hideEgg(); backToStart(); }, total);
}
function hideEgg() { eggModal.classList.remove('show'); }

// ===================== 输入 =====================
window.addEventListener('keydown', e => {
  if (e.code === 'ArrowLeft' || e.code === 'KeyA') input.left = true;
  if (e.code === 'ArrowRight' || e.code === 'KeyD') input.right = true;
  if (e.code === 'ArrowUp' || e.code === 'Space') { doJump(); e.preventDefault(); }
  if (e.code === 'KeyE' || e.code === 'ArrowDown') doPick();
  if (e.code === 'Enter') e.preventDefault();       // 防止误触发有焦点的按钮
});
window.addEventListener('keyup', e => {
  if (e.code === 'ArrowLeft' || e.code === 'KeyA') input.left = false;
  if (e.code === 'ArrowRight' || e.code === 'KeyD') input.right = false;
});

// 触屏摇杆
const joy = document.getElementById('joy'), knob = document.getElementById('joyKnob');
let joyId = null;
function joyMove(t, rect) {
  const dx = t.clientX - (rect.left + 60), dy = t.clientY - (rect.top + 60);
  const ang = Math.atan2(dy, dx), dist = Math.min(40, Math.hypot(dx, dy));
  knob.style.left = (40 + Math.cos(ang) * dist) + 'px';
  knob.style.top = (40 + Math.sin(ang) * dist) + 'px';
  input.left = dx < -12; input.right = dx > 12;
}
joy.addEventListener('touchstart', e => { e.preventDefault(); joyId = e.changedTouches[0].identifier;
  joyMove(e.changedTouches[0], joy.getBoundingClientRect()); });
joy.addEventListener('touchmove', e => { e.preventDefault();
  for (const t of e.changedTouches) if (t.identifier === joyId) joyMove(t, joy.getBoundingClientRect()); });
joy.addEventListener('touchend', e => { e.preventDefault(); joyId = null;
  input.left = input.right = false; knob.style.left = '40px'; knob.style.top = '40px'; });

document.getElementById('jumpBtn').addEventListener('touchstart', e => { e.preventDefault(); doJump(); });
document.getElementById('pickBtn').addEventListener('touchstart', e => { e.preventDefault(); doPick(); });

function updatePickBtn() {
  const b = document.getElementById('pickBtn');
  if (b) b.textContent = carrying ? '放下' : '拾取';
}

function doJump() {
  if (state !== 'play') return;
  if (char.onGround) { char.vy = -8.4; char.onGround = false; Sound.jump(); }
}
function doPick() {
  if (state !== 'play') return;
  // 拾取枪 → 立即开镜
  if (shootPhase === 0 && layer === 'top'
      && Math.abs(char.x - GUN_X) < TILE * 1.5 && Math.abs(char.y + char.h - GROUND_Y) < TILE) {
    shootPhase = 2; ammo = 3;
    aimX = cv.width / 2; aimY = cv.height / 2;
    document.getElementById('btns').style.display = 'none';
    document.getElementById('joy').style.display = 'none';
    fireBtn.style.display = 'block';
    Sound.pickup();
    return;
  }
  // 拾取已落地的碎片
  for (const d of debris) {
    if (!d.taken && d.landed && Math.abs(d.x - char.x) < TILE && Math.abs(d.y - (char.y + char.h)) < TILE * 2) {
      d.taken = true; pieces++; updatePuzzle(); Sound.pickup();
      if (pieces >= GAME_CONTENT.organ1.photoPieces) {
        puzzleEl.classList.add('done');
        if (!organ1Done) {
          organ1Done = true; refreshTip();
          showPhoto(GAME_CONTENT.organ1, () => { state = 'play'; });  // 拼完自动弹出照片
        }
      }
      return;
    }
  }
  // 拾取 / 放下障碍
  if (!carrying) {
    for (const o of organ2Obs) {
      if (!o.gone && Math.abs(o.x - char.x) < TILE * 1.5) {
        o.gone = true; carrying = o; Sound.pickup(); updatePickBtn(); return;
      }
    }
  } else {
    const other = organ2Obs.find(o => !o.gone && Math.abs(o.x - char.x) < TILE * 2);
    if (other) {
    other.gone = true; carrying = null; organ2Done = true; Sound.merge();
    updatePickBtn(); refreshTip();
    showPhoto(GAME_CONTENT.organ2, () => { state = 'play'; });
    } else {
      Sound.put();
    }
  }
}

// 顶碎方块：碎片四散迸射 + 破碎粒子
function breakBlock() {
  organ1Block.broken = true;
  Sound.hit();
  const cx = organ1Block.x - TILE / 2, cy = organ1Block.y;
  for (let i = 0; i < GAME_CONTENT.organ1.photoPieces; i++) {
    debris.push({
      x: cx + Math.random() * TILE, y: cy + Math.random() * TILE,
      vx: (Math.random() * 2 - 1) * 3.5, vy: -Math.random() * 5 - 2,
      taken: false, landed: false
    });
  }
  for (let i = 0; i < 14; i++) {
    particles.push({
      x: cx + TILE / 2, y: cy + TILE / 2,
      vx: (Math.random() * 2 - 1) * 5, vy: -Math.random() * 6 - 1,
      life: 24 + Math.random() * 14
    });
  }
}

// ===================== 烟花 =====================
function spawnFirework() {
  const cx = camera.x + 60 + Math.random() * (cv.width - 120);
  const cy = camera.y + 30 + Math.random() * (cv.height * 0.4);
  const color = FW_COLORS[(Math.random() * FW_COLORS.length) | 0];
  const n = 48 + (Math.random() * 16 | 0);          // 更多粒子
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2;
    const sp = 2.4 + Math.random() * 2.4;            // 更大扩散
    fireworks.push({
      x: cx, y: cy,
      vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
      life: 70 + Math.random() * 40, color, size: 3 + (Math.random() * 3 | 0)  // 更大颗粒
    });
  }
  Sound.firework();                                  // 爆炸音效
}
function updateFireworks() {
  if (layer === 'bottom') {                 // 仅在下方路持续放烟花
    if (++fireworkTimer > 16) { fireworkTimer = 0; spawnFirework(); }  // 更密集
  }
  for (let i = fireworks.length - 1; i >= 0; i--) {
    const f = fireworks[i];
    f.vy += 0.03; f.x += f.vx; f.y += f.vy; f.vx *= 0.985; f.vy *= 0.985; f.life--;
    if (f.life <= 0) fireworks.splice(i, 1);
  }
}

// ===================== 台阶地形 =====================
// 多层台阶平台（像你那张图：高低错落、能跳上跳下）。机关保留在原 x 位置。
const PLATFORMS = [
  { x: 0, y: GROUND_Y, w: 900 },          // 起点平台（含机关一 XQ=640）
  { x: 900, y: GROUND_Y - 40, w: 300 },   // 台阶1（高一级）
  { x: 1200, y: GROUND_Y - 80, w: 900 },  // 台阶2 高台（含机关二 OB1/OB2）
  { x: 2100, y: GROUND_Y, w: 140 },       // 落回主层（机关三坑前）
  { x: XG1, y: GROUND_Y, w: EXIT_X - XG1 + 80 }, // 坑对岸主路（延伸到出口处）
];
function groundAt(x) {
  // 已落入坑底 → 下方路面
  if (layer === 'bottom') return GROUND2_Y;
  // 站在坑口正上方 → 无地面（掉下去）
  if (x >= XG0 && x < XG1) return Infinity;
  let best = Infinity;                    // 取该 x 处最高（y 最小）的平台面
  for (const p of PLATFORMS) {
    if (x >= p.x && x < p.x + p.w) best = Math.min(best, p.y);
  }
  return best;
}

function update() {
  if (state !== 'play') return;

  // 横向输入（落入坑底后只能向前；开镜时禁止移动）
  let dir = 0;
  if (input.left && layer !== 'bottom') dir -= 1;
  if (input.right) dir += 1;
  if (shootPhase === 2 || shootPhase === 3) dir = 0;
  const spd = layer === 'bottom' ? 2.2 : 3.6;   // 机关三下方路走得慢一些
  char.vx = dir * spd;
  if (dir !== 0) char.facing = dir;
  char.x += char.vx;
  if (char.x < 0) char.x = 0;

  // 重力
  char.vy += 0.8;
  char.y += char.vy;

  // 落地
  const gy = groundAt(char.x);
  if (char.y + char.h >= gy && char.vy >= 0 && gy !== Infinity) {
    char.y = gy - char.h; char.vy = 0; char.onGround = true;
  } else {
    char.onGround = false;
  }

  // ===================== 拔河机关（机关一前，必经之路）=====================
  if (tugPhase < 5) {
    // 走近 → 弹出"参加"大按钮
    if (tugPhase === 0 && char.x > 180) {
      tugPhase = 1;
      joinBtn.style.display = 'block';
    }
    // 软墙：未获胜前不能越过绿队
    if (tugPhase <= 1) {
      const wall = TUG_GREEN_X - 34 - char.w / 2;
      if (char.x > wall) char.x = wall;
    }
    // 未参加：绳子缓慢来回小幅摆动，整体偏蓝队
    if (tugPhase <= 1) {
      ropePos = 35 + Math.sin(Date.now() / 600) * 8;
    }
    // 点击拉锯中：锁定玩家站位，蓝队持续回拉（点慢被拉回）
    if (tugPhase === 3) {
      char.x = TUG_PLAYER_X;
      ropePos += 0.35;
      if (ropePos > 60) ropePos = 60;
      if (ropePos <= -70) {                     // 红布条到绿队侧 → 获胜
        tugPhase = 4; tugTimer = 0;
        showBanner('一团六连获胜！', 4000);
        Sound.win();
      }
    }
    // 获胜展示 4 秒 → 小人消失、放行，并掉出第一块拼图（拔河）
    if (tugPhase === 4) {
      char.x = TUG_PLAYER_X;
      if (++tugTimer > 240) {
        tugPhase = 5;
        spawnPieceDrop(0, TUG_GREEN_X + 16, GROUND_Y, 'top');
      }
    }
  }

  // 机关一：方块悬空，玩家在方块下被挡；跳起顶碎
  if (!organ1Block.broken) {
    const bh = TILE, blockBottom = organ1Block.y + bh;
    const halfW = TILE / 2 + char.w / 2;
    if (char.vy < 0 && char.y <= blockBottom && char.y > blockBottom - bh
        && Math.abs(char.x - organ1Block.x) < halfW) {
      breakBlock();                                  // 上升顶碎
    } else if (Math.abs(char.x - organ1Block.x) < halfW && char.y + char.h > blockBottom - 2) {
      char.x = char.x < organ1Block.x ? organ1Block.x - halfW : organ1Block.x + halfW; // 挡路
    }
  }

  // 碎块未拾完 → 前方软墙，阻止继续前进（拾完自动解除）
  if (organ1Block.broken && !organ1Collected) {
    const wall = XQ + 95 - char.w / 2;   // 在碎片(≤XQ+70)之外，保证全可拾
    if (char.x > wall && char.vx > 0) char.x = wall;
  }

  // 碎片物理（落地后可拾取）
  for (const d of debris) {
    if (d.landed) continue;
    d.vy += 0.6; d.x += d.vx; d.y += d.vy;
    if (d.y + 20 >= GROUND_Y) {
      d.y = GROUND_Y - 20; d.vx = 0; d.vy = 0; d.landed = true;
      d.x = Math.max(XQ - 50, Math.min(XQ + 70, d.x)); // 钳制在软墙内侧，保证可拾取
    }
  }
  // 破碎粒子
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.vy += 0.5; p.x += p.vx; p.y += p.vy; p.life--;
    if (p.life <= 0) particles.splice(i, 1);
  }

  // 机关二触发（仅横幅；提示由 refreshTip 统一管理）
  if (!remindShown2 && char.x > OB1 - 260) {
    showBanner(GAME_CONTENT.organ2.banner, 5000);
    remindShown2 = true;
  }

  // 机关三触发 + 落入坑切层（不重生，落到下方路）
  if (!organ3BannerShown && char.x > XG0 - 260) {
    showBanner(GAME_CONTENT.organ3.banner, 5000);
    organ3BannerShown = true;
  }
  // 真正落到坑底（接近下方路面）才切换层，避免站在坑口就被拉下去
  if (layer === 'top' && char.x > XG0 && char.x < XG1 && char.vy >= 0
      && char.y + char.h >= GROUND2_Y - 2) {
    layer = 'bottom';
  }

  // 敬礼互动：玩家走过触发点 → 两小兵敬礼 → 玩家回礼 → 放行
  if (layer === 'bottom') {
    if (salutePhase === 0 && char.x >= SALUTE_X) salutePhase = 1;
    if (salutePhase === 1) {                       // NPC 敬礼中
      char.x = Math.min(char.x, SALUTE_X);         // 拦住玩家
      if (++saluteTimer > 45) { salutePhase = 2; saluteTimer = 0; }
    } else if (salutePhase === 2) {                // 玩家回礼中
      char.x = Math.min(char.x, SALUTE_X);
      if (++saluteTimer > 45) {
        salutePhase = 3; saluteTimer = 0;
        spawnPieceDrop(2, SALUTE_X + 36, GROUND2_Y, 'bottom');  // 敬礼完成 → 第三块拼图
      }
    }
  }

  // 通关：走下方路（layer==='bottom'）走到出口才算完成
  if (layer === 'bottom' && char.x >= EXIT_X) {
    state = 'win'; Sound.win(); refreshTip();
    showBanner(GAME_CONTENT.organ3.winText, 999999);
  }
  // 跳过去绕过：在上方主路走到出口位置则拦截提示
  if (layer === 'top' && char.x >= EXIT_X) {
    char.x = EXIT_X;
    if (!skipWarned) {
      skipWarned = true;
      showBanner('你没有走完下方路，无法通关', 4000);
      Sound.fail();
    }
  }

  // 射击机关：提示 + 未射中前的软墙（必须射中才能继续前进）
  if (shootPhase === 0 && layer === 'top' && char.x > GUN_X - 160 && !shootHintShown) {
    shootHintShown = true;
    showBanner('捡起地上的枪，射中靶心！', 4000);
  }
  if (shootPhase < 4 && layer === 'top') {
    const swall = TARGET_X + 30 - char.w / 2;
    if (char.x > swall) char.x = swall;
  }

  // ===== 开镜后坐力衰减（每次开枪后镜头逐渐回正）=====
  if (scopeKickY) { scopeKickY *= 0.82; if (scopeKickY < 0.02) scopeKickY = 0; }

  // ===== 自动拾取三块纪念拼图（碰到就收）=====
  for (let i = 0; i < 3; i++) {
    const d = pieceDrop[i];
    if (!d || pieceGot[i]) continue;
    const near = Math.abs(char.x - d.x) < 32 && Math.abs((char.y + char.h) - d.groundY) < 32;
    if (!near) continue;
    pieceGot[i] = true; pieceDrop[i] = null;
    updatePieceHUD(); Sound.merge();
    const pc = GAME_CONTENT.pieces[i];
    showBanner('获得拼图' + (i + 1) + '：' + pc.name + '！(' + pieceGot.filter(Boolean).length + '/3)', 3000);
  }

  updateFireworks();                        // 烟花更新（下方路持续放）

  // 相机（垂直跟随）
  camera.x = Math.max(0, char.x - cv.width / 2);
  camera.y = char.y - cv.height * 0.5;

  // 障碍碰撞：未消失的障碍挡住前进（按所在地面计算）
  for (const o of organ2Obs) {
    if (!o.gone) {
      const gy = groundAt(o.x);
      const left = o.x - TILE / 2 - char.w / 2;
      if (char.x > left && char.x < o.x && char.y + char.h > gy - o.h - 2) {
        char.x = left;
      }
    }
  }
}

// ===================== 渲染（像素风）=====================
const PIX = 5;   // 1 个逻辑像素 = 5 物理像素
const FW_COLORS = ['#ff5252', '#ffd54a', '#69f0ae', '#40c4ff', '#e040fb', '#ffffff'];
const PAL = {
  '1': '#5a3000', // 深边/砖缝
  '2': '#3b5323', // 军绿（头盔）
  '3': '#ffffff', // 白
  '4': '#4a6b2a', // 迷彩服
  '5': '#1e2a12', // 深色（裤/鞋）
  '6': '#b5651d', // 砖
  '7': '#95c93f', // 草（图片亮绿草地）
  '8': '#96632d', // 土（图片棕土）
  '9': '#6e4420', // 土深点
  'A': '#f4b400', // 金
  'B': '#5e8f26', // 草暗（草尖）
  'C': '#f2c89b', // 肤
  'F': '#c0392b', // 红旗
  'H': '#1a1a1a', // 黑发
  'L': '#3a3a3a', // 头发高光
  'E': '#2a2a2a', // 眼镜框
  'G': '#cfe4f5', // 镜片
  'U': '#95a578', // 军绿夏常服衬衫
  'V': '#7a8a5e', // 衬衫阴影/领口
  'N': '#e6c64a', // 金色纽扣
  'K': '#262626', // 深色军裤
  'J': '#111111', // 皮鞋
  'M': '#8a4a3a', // 嘴/鼻
  'R': '#4a4a4a', // 枪管（深灰）
  'r': '#6b4a2a', // 枪托（木棕）
  'S': '#6f6a5a', // 石灰
  's': '#8a8574', // 石灰亮
  'T': '#74a832', // 苔藓草（图片草地色）
  'O': '#c08b52', // 土块高光
  'W': '#7a4a1a', // 棕发（鬓角）
  'D': '#1e1e1e', // 眼睛
  'Q': '#c0392b', // 红五角星/领章
  'm': '#4a6b2a', // 军绿（帽/迷彩底）
  'n': '#5d8238', // 军绿高光
  'v': '#3a5220', // 迷彩斑块（深绿）
  'g': '#7a6a3a', // 迷彩斑块（土黄）
  'z': '#5a4a2a', // 迷彩斑块（棕）
  'b': '#8a5a2a', // 棕色腰带/袖口
  't': '#6b4423', // 棕色靴
  'y': '#f2d24a', // 小黄花
  'a': '#3a5a8a', // 蓝队服装（蓝）
  'A': '#2a4a78', // 蓝队服装深
  'i': '#7ec8ff', // 汗滴
  'o': '#c0392b', // 嘴红
  'u': '#ffffff', // 牙白
};

// 角色：Q版萌系红军——大头大眼，戴军帽（帽徽红五角星Q），军绿制服，黑皮鞋
const SPR_CHAR1 = [  // 站立帧
  '....mmmmmm....',
  '..mmmmmmmmmm..',
  '.mmmmmmmmmmmm.',
  '.mmmmmQQmmmmm.',
  '.mmmQQQQQQmmm.',
  '.mmmmQQQQmmmm.',
  '.mmmQQmmQQmmm.',
  '.mmmmmmmmmmmm.',
  '..CCCCCCCCCC..',
  '..CCDCCCCDCC..',
  '..CCCCCCCCCC..',
  '..CCCCMMCCCC..',
  '...CCCCCCCC...',
  '....mmmmmm....',
  '.mbmvmvgmmbm..',
  '.CmgmvvmzmmC..',
  '.CmmzmgvmmmC..',
  '..mvmvzgmmm...',
  '...KK..KK.....',
  '..KK....KK....',
];
const SPR_CHAR2 = [  // 走路帧（腿分开）
  '....mmmmmm....',
  '..mmmmmmmmmm..',
  '.mmmmmmmmmmmm.',
  '.mmmmmQQmmmmm.',
  '.mmmQQQQQQmmm.',
  '.mmmmQQQQmmmm.',
  '.mmmQQmmQQmmm.',
  '.mmmmmmmmmmmm.',
  '..CCCCCCCCCC..',
  '..CCDCCCCDCC..',
  '..CCCCCCCCCC..',
  '..CCCCMMCCCC..',
  '...CCCCCCCC...',
  '....mmmmmm....',
  '..bmvmvgmmbm..',
  '.Cmgmvvmzmm...',
  '...mzmgvmmmC..',
  '..mvmvzgmmm...',
  '...K....K.....',
  '..K......K....',
];
// 敬礼姿势（明显版）：右手臂完全抬直、手掌平贴军帽右侧帽檐，轮廓加粗
const SPR_SALUTE = [
  '....mmmmmm....',
  '..mmmmmmmmmm..',
  '.mmmmmmmmmmCC.',
  '.mmmmmQQmmmCCC',
  '.mmmQQQQQQmmmC',
  '.mmmmQQQQmmm..',
  '.mmmQQmmQQmmm.',
  '.mmmmmmmmmmm..',
  '..CCCCCCCCCC..',
  '..CCDCCCCDCC..',
  '..CCCCCCCCCC..',
  '..CCCCMMCCCC..',
  '...CCCCCCCC...',
  '....mmmmmm....',
  '.mbmvmvgmmb...',
  '.Cmgmvvmzm....',
  '..mmzmgvmmm...',
  '..mvmvzgmmm...',
  '...KK..KK.....',
  '..KK....KK....',
];
// 小兵敬礼姿势（蓝色军装，右手抬起贴帽檐）
const SPR_NPC_SALUTE = [
  '....nnnnnn....',
  '..nnnnnnnnnn..',
  '.nnnnnnnnnnCC.',
  '.nnnnnQQnnnCCC',
  '.nnnQQQQQQnnnC',
  '.nnnnQQQQnnn..',
  '.nnnQQnnQQnnn.',
  '.nnnnnnnnnnn..',
  '..CCCCCCCCCC..',
  '..CCDCCCCDCC..',
  '..CCCCCCCCCC..',
  '..CCCCMMCCCC..',
  '...CCCCCCCC...',
  '....nnnnnn....',
  '.nbnvnvgnnb...',
  '.Cngnvvamn....',
  '..nnmngvnnn...',
  '..nvnvmgnnn...',
  '...KK..KK.....',
  '..KK....KK....',
];
// 小兵站立姿势（蓝色军装，手垂下）
const SPR_NPC_STAND = [
  '....nnnnnn....',
  '..nnnnnnnnnn..',
  '.nnnnnnnnnnnn.',
  '.nnnnnQQnnnnn.',
  '.nnnQQQQQQnnn.',
  '.nnnnQQQQnnnn.',
  '.nnnQQnnQQnnn.',
  '.nnnnnnnnnnnn.',
  '..CCCCCCCCCC..',
  '..CCDCCCCDCC..',
  '..CCCCCCCCCC..',
  '..CCCCMMCCCC..',
  '...CCCCCCCC...',
  '....nnnnnn....',
  '.nbnvnvgnnb...',
  '.CngnvvamnnC..',
  '.CnnmngvnnnC..',
  '..nvnvmgnnn...',
  '...KK..KK.....',
  '..KK....KK....',
];
// 拔河-绿队（迷彩，挣扎：皱眉眯眼+咬牙+汗滴，双手右伸抓绳，弓步后仰）
const SPR_TUG_GREEN = [
  '....mmmmmm....',
  '..mmmmmmmmmm..',
  '.mmmmmmmmmmmm.',
  '.mmmmmQQmmmmm.',
  '.mmmQQQQQQmmm.',
  '.mmmmQQQQmmmm.',
  '.mmmQQmmQQmmm.',
  '.mmmmmmmmmmmii',
  '..CCCCCCCCCC.i',
  '..CDCCDCCDCC..',
  '..CCCCCCCCCC..',
  '..CMMMMMMMC...',
  '...CCCCCCCC...',
  '...mmmmmm.....',
  '..mvmvgmmCC...',
  '..mgvvmzmCC...',
  '..mzmgvmmm....',
  '..mvmvzgmm....',
  '...KK..KK.....',
  '..KK....KK....',
];
// 拔河-蓝队（轻松：正常眼+微笑嘴，双手抓绳）
const SPR_TUG_BLUE = [
  '....aaaaaa....',
  '..aaaaaaaaaa..',
  '.aaaaaaaaaaaa.',
  '.aaaaaQQaaaaa.',
  '.aaaQQQQQQaaa.',
  '.aaaaQQQQaaaa.',
  '.aaaQQaaQQaaa.',
  '.aaaaaaaaaaaa.',
  '..CCCCCCCCCC..',
  '..CCDCCCCDCC..',
  '..CCCCCCCCCC..',
  '..CouuuuuoCC..',
  '...CoooooC....',
  '...aaaaaa.....',
  '..avavgaaCC...',
  '..agavAaACC...',
  '..aaAagvaa....',
  '..avavAgaa....',
  '...KK..KK.....',
  '..KK....KK....',
];
// 获胜-绿队欢呼（双手高举+笑眼+笑嘴）
const SPR_CHEER = [
  '....mmmmmm....',
  '..mmmmmmmmmm..',
  '.mmmmmmmmmmmm.',
  '.mmmmmQQmmmmm.',
  '.mmmQQQQQQmmm.',
  '.mmmmQQQQmmmm.',
  '.mmmQQmmQQmmm.',
  '.mmmmmmmmmmmm.',
  '..CCCCCCCCCC..',
  '..CCDCCCCDCC..',
  '..CCCCCCCCCC..',
  '..CouuuuuoCC..',
  '...CoooooC....',
  '.C.mmmmmm.C...',
  '.Cmvmvgmm.C...',
  '.Cmgvvmzm.C...',
  '..mmmmmmmm....',
  '...KK..KK.....',
  '..KK....KK....',
];
// 失败-蓝队哈腰（低头弯腰）
const SPR_BOW = [
  '..............',
  '..............',
  '....aaaaaa....',
  '..aaaaaaaaaa..',
  '.aaaaaaaaaaaa.',
  '.aaaaaQQaaaaa.',
  '.aaaQQQQQQaaa.',
  '..CCCCCCCCCC..',
  '..CCDCCCCDCC..',
  '..CCCCCCCCCC..',
  '...CCCCCC.....',
  '...aaaaaa.....',
  '..avavgaa.....',
  '..agavAaA.....',
  '..aaAagvaa....',
  '..avavAgaa....',
  '...KK..KK.....',
  '..KK....KK....',
];
const SPR_QBLOCK = [ // 问号方块
  '11111111',
  '1AAAAAA1',
  '1A33AAA1',
  '13AA3AA1',
  '1AA3AAA1',
  '1A3AAAA1',
  '1AAA3AA1',
  '11111111',
];
const SPR_BRICK = [  // 砖块
  '61111116',
  '16666661',
  '16166161',
  '16666661',
  '16616661',
  '16666661',
  '16166161',
  '61111116',
];
const SPR_DEBRIS = [ // 碎片
  '6666',
  '6116',
  '6116',
  '6666',
];
const SPR_GRASS = [  // 草皮顶：亮绿草面+垂下草尖+小花点缀
  '77777777',
  '7B77B77B',
  '.B7B7B7.',
  '..B.B...',
];
const SPR_GRASS_F1 = [  // 草皮顶（带红花）
  '77777777',
  '7BF7B77B',
  '.B7B7B7.',
  '..B.B...',
];
const SPR_GRASS_F2 = [  // 草皮顶（带黄花）
  '77777777',
  '7B77By7B',
  '.B7B7B7.',
  '..B.B...',
];
const SPR_CLIFF = [  // 棕土块悬崖（图片同款土石）
  '88888888',
  '8O888O88',
  '88888888',
  '88O888O8',
  '88888888',
  '8O88O888',
  '88888888',
  '88O888O8',
];
const SPR_TREE = [   // 像素树
  '...777...',
  '..77777..',
  '.7777777.',
  '777777777',
  '.7777777.',
  '...888...',
  '...888...',
  '..88888..',
];
const SPR_HILL = [   // 远山剪影
  '....7777....',
  '..77777777..',
  '.7777777777..',
  '777777777777',
];
const SPR_CLOUD = [  // 像素云
  '....3333......',
  '..33333333....',
  '.3333333333...',
  '33333333333333',
  '.3333333333...',
];
const SPR_FLAG = [   // 出口旗帜
  '1.....',
  '1FFF..',
  '1FFFFF',
  '1FFF..',
  '1.....',
  '1.....',
  '1.....',
  '1.....',
];

function drawRect(x, y, w, h, color) {
  ctx.fillStyle = color; ctx.fillRect(x - camera.x, y - camera.y, w, h);
}
// 逐像素绘制 sprite，整数对齐保证锐利；flip=true 时水平翻转（角色朝左）
function drawSprite(map, x, y, s = PIX, flip = false) {
  const px = Math.floor(x - camera.x), py = Math.floor(y - camera.y);
  for (let r = 0; r < map.length; r++) {
    const row = map[r];
    for (let c = 0; c < row.length; c++) {
      const ch = flip ? row[row.length - 1 - c] : row[c];
      if (ch === '.') continue;
      ctx.fillStyle = PAL[ch];
      ctx.fillRect(px + c * s, py + r * s, s, s);
    }
  }
}
// 绘制一个台阶平台：草皮顶 + 石砖悬崖侧面（像你那张图）
function drawPlatform(p) {
  let i = 0;
  for (let gx = p.x; gx < p.x + p.w; gx += TILE, i++) {
    const g = (i % 7 === 3) ? SPR_GRASS_F1 : (i % 11 === 6) ? SPR_GRASS_F2 : SPR_GRASS;
    drawSprite(g, gx, p.y);                                   // 草皮顶（4行=20px，点缀小花）
    for (let ty = p.y + 20; ty < p.y + 230; ty += TILE) {
      drawSprite(SPR_CLIFF, gx, ty);                          // 棕土块悬崖填充
    }
  }
}
function render() {
  ctx.imageSmoothingEnabled = false;                          // 关闭抗锯齿
  ctx.clearRect(0, 0, cv.width, cv.height);
  // 背景：用你修好的图（已抠掉小人）做视差滚动；未加载时用夜空兜底
  if (bgReady) {
    const bh = cv.height;
    const bw = bh * (bgImg.width / bgImg.height);
    const ox = -((camera.x * 0.5) % bw);
    for (let x = ox; x < cv.width; x += bw) {
      ctx.drawImage(bgImg, Math.floor(x), 0, Math.ceil(bw), bh);
    }
  } else {
    ctx.fillStyle = '#161a35';
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 60; i++) {
      const sx = ((i * 173 - camera.x * 0.2) % (cv.width + 20) + cv.width + 20) % (cv.width + 20) - 10;
      const sy = (i * 97) % (cv.height * 0.55);
      ctx.fillRect(Math.floor(sx), Math.floor(sy), i % 5 === 0 ? 3 : 2, i % 5 === 0 ? 3 : 2);
    }
  }

  // 烟花粒子（在天空层、平台之上绘制）
  for (const f of fireworks) {
    ctx.globalAlpha = Math.max(0, f.life / 70);
    ctx.fillStyle = f.color;
    ctx.fillRect(Math.floor(f.x - camera.x), Math.floor(f.y - camera.y), f.size, f.size);
  }
  ctx.globalAlpha = 1;

  // 多层台阶平台
  for (const p of PLATFORMS) drawPlatform(p);
  // 坑口
  ctx.fillStyle = '#0a0a14';
  ctx.fillRect(XG0 - camera.x, GROUND_Y - camera.y, XG1 - XG0, cv.height);

  // 下方路 + 背景板 + 出口（仅落入坑后显示）
  if (layer === 'bottom') {
    drawPlatform({ x: XG0, y: GROUND2_Y, w: WIN_X - XG0 });
    GAME_CONTENT.organ3.bgPlaceholders.forEach((p, i) => {
      const bx = XG0 + 200 + i * 360;
      ctx.fillStyle = '#cdb98a';
      ctx.fillRect(bx - camera.x, GROUND2_Y - 150 - camera.y, 160, 110);
      ctx.fillStyle = '#5a4a2a'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(p, bx - camera.x + 80, GROUND2_Y - 90 - camera.y);
    });
    // 两个敬礼小兵（NPC，蓝色军装区别于玩家）：未触发时站立，玩家走过时敬礼
    const npcSpr = (salutePhase >= 1) ? SPR_NPC_SALUTE : SPR_NPC_STAND;
    drawSprite(npcSpr, NPC_X1, GROUND2_Y - 54, 3, true);
    drawSprite(npcSpr, NPC_X2, GROUND2_Y - 54, 3, true);
    // 出口：像素旗帜
    drawSprite(SPR_FLAG, EXIT_X - 15, GROUND2_Y - 48, 6);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('出口', EXIT_X - camera.x, GROUND2_Y - 56 - camera.y);
  }

  // 拔河场景（未完成时绘制：绳子 + 绿队单人 + 蓝队双人）
  if (tugPhase < 5) {
    const top = GROUND_Y - 54;   // NPC 脚与玩家脚同齐（底部都在地面线上）
    const ropeY = GROUND_Y - 16;
    const rx1 = TUG_GREEN_X + 30 + ropePos;
    const rx2 = TUG_BLUE_X2 + 8 + ropePos;   // 绳子牵到蓝队后排
    ctx.fillStyle = '#8a5a2a';                                // 绳子
    ctx.fillRect(rx1 - camera.x, ropeY - camera.y, rx2 - rx1, 3);
    const mid = (rx1 + rx2) / 2;                              // 中点红布条
    ctx.fillStyle = '#c0392b';
    ctx.fillRect(mid - camera.x - 4, ropeY - camera.y - 6, 8, 12);
    // 绿队单人（获胜后欢呼+跳跃）
    const cheerJ = tugPhase === 4 ? Math.abs(Math.sin(Date.now() / 180)) * 12 : 0;
    drawSprite(tugPhase >= 4 ? SPR_CHEER : SPR_TUG_GREEN, TUG_GREEN_X, top - cheerJ, 3, false);
    // 蓝队双人（获胜后哈腰）
    const bSpr = tugPhase >= 4 ? SPR_BOW : SPR_TUG_BLUE;
    drawSprite(bSpr, TUG_BLUE_X1, top, 3, true);
    drawSprite(bSpr, TUG_BLUE_X2, top, 3, true);
  }

  // 地上的枪（未拾取时，超大 + 发光提示圈）
  if (shootPhase === 0 && layer === 'top') {
    // 发光提示圈（闪烁，醒目）
    const glowR = 34 + Math.sin(Date.now() / 300) * 6;
    ctx.strokeStyle = 'rgba(255,213,74,.9)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(GUN_X - camera.x, GROUND_Y - 16 - camera.y, glowR, 0, Math.PI * 2); ctx.stroke();
    // 枪本体（大）
    drawRect(GUN_X - 34, GROUND_Y - 26, 52, 16, '#333');  // 枪身
    drawRect(GUN_X + 18, GROUND_Y - 22, 34, 8, '#222');   // 枪管
    drawRect(GUN_X - 34, GROUND_Y - 12, 16, 16, '#5a3a1a');// 枪托
    drawRect(GUN_X + 4, GROUND_Y - 36, 12, 10, '#333');   // 瞄准镜
    drawRect(GUN_X - 10, GROUND_Y - 10, 8, 14, '#5a3a1a');// 握把
    drawRect(GUN_X + 18, GROUND_Y - 24, 10, 3, '#666');   // 枪口反光
  }
  // 立起来的靶子（杆 + 红白圆靶 + 弹孔）
  if (layer === 'top') {
    drawRect(TARGET_X - 2, GROUND_Y - 58, 4, 58, '#6b4a2a');  // 杆
    const tcx = TARGET_X - camera.x, tcy = GROUND_Y - 74 - camera.y;
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(tcx, tcy, 26, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#d32f2f'; ctx.beginPath(); ctx.arc(tcx, tcy, 19, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(tcx, tcy, 12, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#d32f2f'; ctx.beginPath(); ctx.arc(tcx, tcy, 6, 0, Math.PI * 2); ctx.fill();
    if (hitHole) {                                             // 世界靶弹孔
      ctx.fillStyle = '#1a1a1a';
      ctx.beginPath(); ctx.arc(tcx, tcy, 3, 0, Math.PI * 2); ctx.fill();
    }
  }

  // 问号方块（悬空在头顶）
  if (!organ1Block.broken) drawSprite(SPR_QBLOCK, organ1Block.x - TILE / 2, organ1Block.y);
  // 碎片
  for (const d of debris) {
    if (!d.taken) drawSprite(SPR_DEBRIS, d.x, d.y);
  }
  // 破碎粒子
  for (const p of particles) {
    ctx.fillStyle = `rgba(255,255,255,${Math.max(0, p.life / 30)})`;
    ctx.fillRect(p.x - camera.x - 2, p.y - camera.y - 2, 4, 4);
  }
  // 障碍（两块砖叠成两格高，贴着所在地面）
  for (const o of organ2Obs) {
    if (!o.gone) {
      const gy = groundAt(o.x);
      drawSprite(SPR_BRICK, o.x - TILE / 2, gy - TILE);
      drawSprite(SPR_BRICK, o.x - TILE / 2, gy - 2 * TILE);
    }
  }
  if (carrying) {
    drawSprite(SPR_BRICK, char.x - TILE / 2, char.y - carrying.h + TILE);
    drawSprite(SPR_BRICK, char.x - TILE / 2, char.y - carrying.h);
  }

  // 地上的纪念拼图（拔河/打靶/敬礼，发光提示）
  drawPieceDrops();

  // 角色：回礼阶段强制敬礼；拔河阶段强制拔河/欢呼姿势；否则走路帧，朝左翻转
  let frame;
  if (salutePhase === 2) frame = SPR_SALUTE;
  else if (tugPhase === 3) frame = SPR_TUG_GREEN;
  else if (tugPhase === 4) frame = SPR_CHEER;
  else frame = (Math.abs(char.vx) > 0.1 && Math.floor(Date.now() / 150) % 2) ? SPR_CHAR2 : SPR_CHAR1;
  const pJump = tugPhase === 4 ? Math.abs(Math.sin(Date.now() / 180)) * 12 : 0;  // 玩家获胜欢呼跳跃
  drawSprite(frame, char.x - char.w / 2, char.y - pJump, 3, char.facing < 0);

  // 开镜画面（覆盖全屏）
  if (shootPhase === 2 || shootPhase === 3) {
    const mx = cv.width / 2, my = cv.height / 2, R = cv.height * 0.42;
    ctx.fillStyle = 'rgba(0,0,0,.92)'; ctx.fillRect(0, 0, cv.width, cv.height);   // 镜外黑
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(mx, my, R, 0, Math.PI * 2); ctx.fill(); // 镜内白
    // 轻微晃动的靶
    const wobX = Math.sin(Date.now() / 400) * 14, wobY = Math.cos(Date.now() / 530) * 10;
    const kickY = scopeKickY * 16;                       // 后坐力：靶心随开枪瞬间下移再回正
    const bx = mx + wobX, by = my + wobY + kickY;
    const rings = [[R * 0.62, '#d32f2f'], [R * 0.42, '#ffffff'], [R * 0.24, '#d32f2f'], [R * 0.1, '#ffffff'], [18, '#d32f2f']];
    for (const [r, c] of rings) { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(bx, by, r, 0, Math.PI * 2); ctx.fill(); }
    if (hitHole) {                                                                    // 镜中靶弹孔
      ctx.fillStyle = '#1a1a1a'; ctx.beginPath(); ctx.arc(bx, by, 4, 0, Math.PI * 2); ctx.fill();
    }
    // 镜框
    ctx.strokeStyle = '#111'; ctx.lineWidth = 10;
    ctx.beginPath(); ctx.arc(mx, my, R, 0, Math.PI * 2); ctx.stroke();
    // 准星
    ctx.strokeStyle = '#111'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(aimX - 22, aimY); ctx.lineTo(aimX + 22, aimY); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(aimX, aimY - 22); ctx.lineTo(aimX, aimY + 22); ctx.stroke();
    ctx.strokeStyle = '#c0392b'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(aimX, aimY, 8, 0, Math.PI * 2); ctx.stroke();
    // 提示
    ctx.fillStyle = '#ffd54a'; ctx.font = '16px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('拖动屏幕瞄准红心，点击右下角「射击」  剩余子弹：' + ammo, mx, my + R + 34);
  }

  ctx.textAlign = 'left';
}

// ===================== 主循环 =====================
function loop(t) {
  last = t;
  update();
  if (state === 'play' || state === 'photo' || state === 'win') render();
  requestAnimationFrame(loop);
}

// ===================== 启动控制 =====================
document.getElementById('startTitle').textContent = GAME_CONTENT.start.title;
document.getElementById('enterBtn').textContent = GAME_CONTENT.start.enter;
document.getElementById('enterBtn').addEventListener('click', e => {
  e.currentTarget.blur();
  Sound.resume();
  document.getElementById('start').style.display = 'none';
  resetGame(); state = 'play';
});
document.getElementById('exitBtn').addEventListener('click', e => {
  e.currentTarget.blur();                            // 防空格/回车再次触发
  if (state !== 'play' && state !== 'photo' && state !== 'win') return;
  if (state === 'photo') { hidePhoto(); state = 'play'; }   // 收起照片弹层再判断
  const miss = 3 - (pieceGot ? pieceGot.filter(Boolean).length : 0);
  if (miss > 0) missingPiecesHint(miss);      // 没集齐：提示并回到起点继续找
  else showEgg();                             // 集齐：三块拼照片彩蛋
});
// 没集齐就退出：提示还差几块，并回到最初位置（已集拼图/已过机关保留）
function missingPiecesHint(miss) {
  document.getElementById('joinBtn').style.display = 'none';
  hideShootMsg();
  document.getElementById('fireBtn').style.display = 'none';
  document.getElementById('btns').style.display = 'flex';
  document.getElementById('joy').style.display = 'block';
  if (carrying && !organ2Done) {              // 抱着砖 → 放回原位
    carrying.gone = false; carrying.x = carrying.origX; carrying = null;
  }
  updatePickBtn();
  if (tugPhase < 5) { tugPhase = 0; ropePos = 35; tugTimer = 0; }
  if (shootPhase > 0 && shootPhase < 4) { shootPhase = 0; ammo = 3; shootHintShown = false; }
  if (salutePhase > 0 && salutePhase < 3) { salutePhase = 0; saluteTimer = 0; }
  layer = 'top';
  char.x = 80; char.y = GROUND_Y - 54; char.vx = 0; char.vy = 0;
  char.onGround = true; char.facing = 1;
  hideBanner();
  showBanner('还差 ' + miss + ' 块拼图，再找找！', 3200);
  state = 'play';
}
// 拔河：参加按钮
const joinBtn = document.getElementById('joinBtn');
joinBtn.addEventListener('click', (e) => {
  e.stopPropagation(); e.currentTarget.blur();
  if (tugPhase !== 1) return;
  tugPhase = 3;
  char.x = TUG_PLAYER_X; char.facing = 1;          // 玩家站进绿队
  joinBtn.style.display = 'none';
  showBanner('请疯狂点击屏幕！', 999999);
});
// 拔河：疯狂点击（点屏幕任何地方）
window.addEventListener('pointerdown', (e) => {
  if (state === 'play' && tugPhase === 3) {
    ropePos -= 7;                                  // 点一下往绿队拉一格
    Sound.pickup();
  }
});
// 射击：开镜拖动瞄准（点在画布上才移动准星，不干扰按钮）
window.addEventListener('pointermove', (e) => {
  if (state === 'play' && shootPhase === 2 && e.target === cv) {
    aimX = e.clientX; aimY = e.clientY;
  }
});
// 射击：开火判定
const fireBtn = document.getElementById('fireBtn');
const shootMsg = document.getElementById('shootMsg');
function showShootMsg(t) { document.getElementById('shootMsgText').textContent = t; shootMsg.style.display = 'block'; }
function hideShootMsg() { shootMsg.style.display = 'none'; }
function exitScope() {
  fireBtn.style.display = 'none';
  document.getElementById('btns').style.display = 'flex';
  document.getElementById('joy').style.display = 'block';
}
fireBtn.addEventListener('click', e => {
  e.currentTarget.blur();
  if (shootPhase !== 2) return;
  ammo--;
  const mx = cv.width / 2, my = cv.height / 2;
  const wobX = Math.sin(Date.now() / 400) * 14, wobY = Math.cos(Date.now() / 530) * 10;
  const kickY = scopeKickY * 16;                                          // 判定跟随当前后坐力
  const hit = Math.hypot(aimX - (mx + wobX), aimY - (my + wobY + kickY)) <= 18;
  scopeKickY = 1;                                                         // 每次开枪都产生后坐力
  if (hit) {
    hitHole = { x: 0, y: 0 };                    // 靶心弹孔
    shootPhase = 3;
    showShootMsg('神枪手！');
    Sound.merge();
  } else {
    if (ammo <= 0) {                               // 子弹打光：直接退出开镜，枪回地上
      shootPhase = 0; exitScope();
      showBanner('子弹打完了，重新捡枪！', 3000);
      Sound.put();
    } else {
      showShootMsg('再来一次');
      Sound.put();
    }
  }
});
// 结果提示点击：神枪手→完成退出；再来一次→继续瞄准
shootMsg.addEventListener('click', () => {
  if (shootPhase === 3) {
    shootPhase = 4; hideShootMsg(); exitScope();   // 枪放下消失，软墙解除
    spawnPieceDrop(1, TARGET_X - 18, GROUND_Y, 'top');  // 打靶完成 → 第二块拼图
  } else {
    hideShootMsg();                                // 继续瞄准
  }
});
document.getElementById('muteBtn').addEventListener('click', e => {
  e.currentTarget.blur();
  const m = Sound.toggle();
  document.getElementById('muteBtn').textContent = m ? '🔇' : '🔊';
});

function backToStart() {
  document.getElementById('start').style.display = 'flex';
  state = 'start';
}

resetGame();
requestAnimationFrame(loop);
