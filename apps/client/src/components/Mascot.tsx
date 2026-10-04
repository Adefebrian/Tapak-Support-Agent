import { useEffect, useRef } from "react";

// Two characters act out every turn. Tapi, the support robot, narrates each pipeline stage as the real
// trace event arrives and reacts to the outcome. Sari, the human support agent at her desk, is the
// person every escalation is handed to.
export type MascotState =
  | "idle"
  | "greet"
  | "thinking"
  | "answer"
  | "order"
  | "clarify"
  | "locked"
  | "refuse"
  | "shield"
  | "escalate"
  | "urgent";

const INK = "#0b0b0c";
const ORANGE = "#ff5a1f";
const ORANGE_DEEP = "#e2470f";
const ORANGE_SOFT = "#ffe3d6";
const WHITE = "#ffffff";
const SHADE = "#efede8"; // tonal side of a rounded form: depth without shadows or gradients
const LINE = "#d6d2c9";
const SKIN = "#f6d7bf";
const SKIN_SHADE = "#ecc4a6";
const W = 360;
const H = 200;
const GROUND = 184;

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);
const ease = (t: number) => 1 - (1 - clamp01(t)) ** 3;
const back = (t: number) => {
  const c = 1.7;
  const x = clamp01(t) - 1;
  return 1 + (c + 1) * x ** 3 + c * x ** 2;
};
const handoff = (s: MascotState) => s === "escalate" || s === "urgent";

type Pt = [number, number];

// Every pose value is driven by a damped spring toward its target, so changing state never snaps a
// limb into place: it swings there, slightly overshoots, and settles, at any frame rate.
type Spring = { x: number; v: number };
const sp = (x: number): Spring => ({ x, v: 0 });
function spring(s: Spring, target: number, dt: number, k = 150, c = 19): number {
  const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    const a = k * (target - s.x) - c * s.v;
    s.v += a * h;
    s.x += s.v * h;
  }
  return s.x;
}

export type Rig = {
  lx: Spring;
  ly: Spring;
  rx: Spring;
  ry: Spring;
  lean: Spring;
  look: Spring;
  ant: Spring;
  prevDy: number;
  sLook: Spring;
  sHand: Spring;
  sNod: Spring;
  sSmile: Spring;
};

export function newRig(): Rig {
  return {
    lx: sp(72),
    ly: sp(164),
    rx: sp(152),
    ry: sp(164),
    lean: sp(0),
    look: sp(0),
    ant: sp(0),
    prevDy: 0,
    sLook: sp(0),
    sHand: sp(0),
    sNod: sp(0),
    sSmile: sp(0),
  };
}

// Eyelids close and reopen over 180 ms instead of switching off for one frame.
function eyeOpen(t: number, period: number, offset = 0): number {
  const phase = (t + offset) % period;
  return phase < 0.18 ? 0.1 + 0.9 * (1 - Math.sin((phase / 0.18) * Math.PI)) : 1;
}

const easeInOut = (t: number) => {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
};

// Hop with anticipation (a small crouch), a smooth arc, and a squash on landing.
function hop(since: number): { dy: number; stretch: number } {
  const k = clamp01(since / 820);
  if (k < 0.16) {
    const c = Math.sin((k / 0.16) * Math.PI);
    return { dy: 3 * c, stretch: 1 - 0.06 * c };
  }
  if (k < 0.8) {
    const a = (k - 0.16) / 0.64;
    return { dy: -15 * Math.sin(a * Math.PI), stretch: 1 + 0.05 * Math.sin(a * Math.PI) };
  }
  const l = (k - 0.8) / 0.2;
  const c = Math.sin(l * Math.PI) * (1 - l * 0.3);
  return { dy: 1.5 * c, stretch: 1 - 0.07 * c };
}

function box(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

// A rounded form with a tonal right side, so it reads as a volume rather than a flat sticker.
function volume(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  fill = WHITE,
  shade = SHADE,
) {
  ctx.save();
  box(ctx, x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.clip();
  ctx.fillStyle = shade;
  ctx.beginPath();
  ctx.ellipse(x + w * 1.02, y + h * 0.62, w * 0.34, h * 0.7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  box(ctx, x, y, w, h, r);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;
  ctx.stroke();
}

/* ------------------------------------------------------------------ Tapi, the robot */

function armPose(state: MascotState, t: number, since: number): { l: Pt; r: Pt } {
  const sway = Math.sin(t * 2.2) * 2;
  switch (state) {
    case "thinking":
      return { l: [72, 164 + sway], r: [150, 122 + Math.sin(t * 4) * 2] };
    case "greet":
    case "answer": {
      const wave = Math.sin(since / 110) * 9 * (1 - clamp01((since - 1300) / 400));
      return { l: [72, 164], r: [164 + wave, 110] };
    }
    case "order": {
      const k = back(since / 380);
      return { l: [92 - 4 * k, 160 - 10 * k], r: [128 + 4 * k, 160 - 10 * k] };
    }
    case "clarify": {
      const k = back(since / 380);
      return { l: [72 - 6 * k, 164 - 30 * k], r: [152 + 6 * k, 164 - 30 * k] };
    }
    case "locked":
    case "shield":
    case "refuse":
      return { l: [72, 164], r: [166, 132] };
    case "urgent":
    case "escalate": {
      const k = ease(since / 350);
      return { l: [72, 164], r: [154 + 16 * k, 150 - 10 * k] };
    }
    default:
      return { l: [72, 164 + sway], r: [152, 164 - sway] };
  }
}

function drawRobot(
  ctx: CanvasRenderingContext2D,
  state: MascotState,
  t: number,
  since: number,
  rig: Rig,
  dt: number,
) {
  // A slow float, with a hop on good news.
  let dy = Math.sin(t * 2) * 2.2;
  let stretch = 1 + Math.sin(t * 2 + 0.6) * 0.008;
  if (state === "answer" || state === "order") {
    const h = hop(since);
    dy += h.dy;
    stretch *= h.stretch;
  }
  if (state === "urgent") dy += Math.sin(t * 16) * 0.6;
  let leanTarget = 0;
  if (state === "thinking") leanTarget = Math.sin(t * 1.4) * 0.03;
  if (state === "clarify") leanTarget = -0.09;
  if (state === "shield") leanTarget = -0.05;
  if (handoff(state)) leanTarget = 0.07;
  // Head shake for a refusal rides on top of the spring.
  const shake =
    state === "refuse" || state === "locked" ? Math.sin(since / 55) * 0.05 * Math.max(0, 1 - since / 900) : 0;
  const lean = spring(rig.lean, leanTarget, dt) + shake;
  // Antenna lags the body: secondary motion from the body's vertical speed.
  const vy = dt > 0 ? (dy - rig.prevDy) / dt : 0;
  rig.prevDy = dy;

  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // Ground contact grows and shrinks with the hop: a flat tonal ellipse, not a blurred shadow.
  const lift = Math.max(0, -dy) / 14;
  ctx.fillStyle = SHADE;
  ctx.beginPath();
  ctx.ellipse(110, GROUND, 34 - lift * 10, 4, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.translate(110, GROUND - 8);
  ctx.rotate(lean);
  ctx.scale(1 / Math.sqrt(stretch), stretch);
  ctx.translate(-110, -(GROUND - 8) + dy);

  ctx.fillStyle = INK;
  box(ctx, 88, 170, 17, 10, 5);
  ctx.fill();
  box(ctx, 115, 170, 17, 10, 5);
  ctx.fill();

  const target = armPose(state, t, since);
  const pose = {
    l: [spring(rig.lx, target.l[0], dt), spring(rig.ly, target.l[1], dt)] as Pt,
    r: [spring(rig.rx, target.r[0], dt), spring(rig.ry, target.r[1], dt)] as Pt,
  };
  ctx.strokeStyle = INK;
  ctx.lineWidth = 6;
  for (const [sx, [hx, hy]] of [
    [84, pose.l],
    [136, pose.r],
  ] as const) {
    ctx.beginPath();
    ctx.moveTo(sx, 144);
    ctx.quadraticCurveTo((sx + hx) / 2, Math.max(144, hy) + 4, hx, hy);
    ctx.stroke();
  }

  volume(ctx, 82, 128, 56, 46, 17);
  const blinkFast = state === "urgent" ? (Math.sin(t * 14) > 0 ? 1 : 0.35) : 1;
  const glow = state === "thinking" ? 0.5 + 0.5 * Math.abs(Math.sin(t * 5)) : blinkFast;
  ctx.fillStyle = ORANGE_DEEP;
  box(ctx, 101, 143, 18, 12, 5);
  ctx.fill();
  ctx.globalAlpha = glow;
  ctx.fillStyle = ORANGE;
  box(ctx, 101, 143, 18, 9, 5);
  ctx.fill();
  ctx.globalAlpha = 1;

  // A parcel held in front for a found order.
  if (state === "order") {
    const k = back(since / 380);
    ctx.save();
    ctx.translate(110, 152 - 10 * k);
    volume(ctx, -20, -14, 40, 28, 5, "#f3e3cf", "#e8d2b8");
    ctx.fillStyle = ORANGE;
    ctx.fillRect(-4, -14, 8, 28);
    ctx.restore();
  }

  ctx.lineWidth = 2.5;
  for (const [i, [hx, hy]] of [pose.l, pose.r].entries()) {
    const big = (state === "refuse" || state === "locked") && i === 1;
    ctx.fillStyle = WHITE;
    ctx.strokeStyle = INK;
    ctx.beginPath();
    ctx.arc(hx, hy, big ? 9 : 6.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  // Antenna with a springy tip. Urgent makes it flash.
  let antTarget = Math.max(-0.4, Math.min(0.4, vy * 0.004));
  if (state === "thinking") antTarget += Math.sin(t * 5) * 0.18;
  if (state === "urgent") antTarget += Math.sin(t * 18) * 0.1;
  const ant = spring(rig.ant, antTarget, dt, 90, 7);
  ctx.save();
  ctx.translate(110, 68);
  ctx.rotate(ant);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, -14);
  ctx.stroke();
  ctx.fillStyle = state === "urgent" && Math.sin(t * 14) < 0 ? ORANGE_DEEP : ORANGE;
  ctx.beginPath();
  ctx.arc(0, -19, state === "urgent" ? 7.5 : 6.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = WHITE;
  ctx.beginPath();
  ctx.arc(-2, -21, 1.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = INK;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(66, 88);
  ctx.quadraticCurveTo(110, 36, 154, 88);
  ctx.stroke();

  volume(ctx, 70, 68, 80, 60, 25);
  ctx.fillStyle = INK;
  box(ctx, 61, 84, 13, 28, 6);
  ctx.fill();
  box(ctx, 146, 84, 13, 28, 6);
  ctx.fill();
  ctx.fillStyle = ORANGE;
  box(ctx, 64, 92, 4, 12, 2);
  ctx.fill();

  ctx.strokeStyle = INK;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(67, 110);
  ctx.quadraticCurveTo(69, 131, 88, 131);
  ctx.stroke();
  ctx.fillStyle = state === "thinking" ? ORANGE : INK;
  ctx.beginPath();
  ctx.arc(90, 131, 3.8, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = INK;
  box(ctx, 80, 78, 60, 40, 15);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(88, 84);
  ctx.quadraticCurveTo(84, 88, 85, 94);
  ctx.stroke();
  drawRobotFace(ctx, state, t, spring(rig.look, lookTarget(state, t), dt));
  ctx.restore();
}

function lookTarget(state: MascotState, t: number): number {
  if (state === "thinking") return Math.sin(t * 1.8) * 4;
  if (handoff(state)) return 4;
  if (state === "clarify") return -1.5;
  return 0;
}

function drawRobotFace(ctx: CanvasRenderingContext2D, state: MascotState, t: number, look: number) {
  const happy = state === "answer" || state === "greet" || state === "order";
  const stern = state === "refuse" || state === "locked" || state === "shield";
  const open = stern || happy ? 1 : eyeOpen(t, 3.6);
  const blink = open < 0.35;
  const ex = [99 + look, 121 + look];
  const ey = 95;
  ctx.lineCap = "round";
  ctx.strokeStyle = WHITE;
  ctx.fillStyle = WHITE;
  ctx.lineWidth = 3;

  if (happy) {
    for (const x of ex) {
      ctx.beginPath();
      ctx.arc(x, ey + 3, 5, Math.PI * 1.1, Math.PI * 1.9);
      ctx.stroke();
    }
  } else if (blink) {
    for (const x of ex) {
      ctx.beginPath();
      ctx.moveTo(x - 4, ey);
      ctx.lineTo(x + 4, ey);
      ctx.stroke();
    }
  } else {
    const wide = state === "urgent" ? 1.15 : 1;
    const squint = state === "clarify" ? [1, 0.5] : [wide, wide];
    ex.forEach((x, i) => {
      ctx.fillStyle = WHITE;
      ctx.beginPath();
      ctx.ellipse(x, ey, 4.8 * wide, 6.6 * squint[i]! * open, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = INK;
      ctx.beginPath();
      ctx.arc(x + 1.4, ey - 2.2, 1.4, 0, Math.PI * 2);
      ctx.fill();
    });
    if (stern) {
      ctx.strokeStyle = WHITE;
      ctx.beginPath();
      ctx.moveTo(93, 85);
      ctx.lineTo(104, 88);
      ctx.moveTo(127, 85);
      ctx.lineTo(116, 88);
      ctx.stroke();
    }
  }

  ctx.fillStyle = ORANGE;
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  ctx.ellipse(89, 106, 3.6, 2.3, 0, 0, Math.PI * 2);
  ctx.ellipse(131, 106, 3.6, 2.3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.strokeStyle = WHITE;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  if (state === "thinking" || state === "urgent") {
    ctx.ellipse(110 + look / 2, 108, 2.6, state === "urgent" ? 3 : 2.2, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else if (stern) {
    ctx.moveTo(104, 109);
    ctx.lineTo(116, 109);
    ctx.stroke();
  } else if (state === "clarify") {
    ctx.moveTo(104, 109);
    ctx.quadraticCurveTo(110, 106, 116, 110);
    ctx.stroke();
  } else {
    const wide = happy ? 7 : 5;
    ctx.moveTo(110 - wide, 106);
    ctx.quadraticCurveTo(110, 106 + wide * 0.9, 110 + wide, 106);
    ctx.stroke();
  }
}

function drawPadlock(ctx: CanvasRenderingContext2D, x: number, y: number, k: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(k, k);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(0, -8, 7, Math.PI, 0);
  ctx.lineTo(7, -2);
  ctx.moveTo(-7, -8);
  ctx.lineTo(-7, -2);
  ctx.stroke();
  volume(ctx, -11, -3, 22, 18, 5, ORANGE, ORANGE_DEEP);
  ctx.fillStyle = WHITE;
  ctx.beginPath();
  ctx.arc(0, 5, 2.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawShield(ctx: CanvasRenderingContext2D, x: number, y: number, k: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(k, k);
  ctx.beginPath();
  ctx.moveTo(0, -20);
  ctx.quadraticCurveTo(10, -14, 18, -14);
  ctx.quadraticCurveTo(18, 10, 0, 22);
  ctx.quadraticCurveTo(-18, 10, -18, -14);
  ctx.quadraticCurveTo(-10, -14, 0, -20);
  ctx.closePath();
  ctx.fillStyle = ORANGE;
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.strokeStyle = WHITE;
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.moveTo(-7, 0);
  ctx.lineTo(-2, 6);
  ctx.lineTo(8, -6);
  ctx.stroke();
  ctx.restore();
}

function drawRobotExtras(ctx: CanvasRenderingContext2D, state: MascotState, t: number, since: number) {
  ctx.lineCap = "round";
  if (state === "thinking") {
    for (let i = 0; i < 3; i++) {
      const p = (t * 0.9 + i / 3) % 1;
      ctx.strokeStyle = `rgba(255, 90, 31, ${1 - p})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(110, 49, 9 + p * 14, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
    }
  }
  if (state === "answer" || state === "order" || state === "greet") {
    const k = ease(since / 400);
    ctx.strokeStyle = ORANGE;
    ctx.lineWidth = 3;
    for (const a of [-2.5, -1.57, -0.64]) {
      const r0 = 32;
      const r1 = r0 + 10 * k;
      ctx.beginPath();
      ctx.moveTo(110 + Math.cos(a) * r0, 50 + Math.sin(a) * r0 * 0.45);
      ctx.lineTo(110 + Math.cos(a) * r1, 50 + Math.sin(a) * r1 * 0.45);
      ctx.stroke();
    }
  }
  if (state === "refuse") {
    const k = back(since / 320);
    ctx.save();
    ctx.translate(190, 114);
    ctx.scale(k, k);
    ctx.strokeStyle = ORANGE;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(0, 0, 13, 0, Math.PI * 2);
    ctx.moveTo(-9, 9);
    ctx.lineTo(9, -9);
    ctx.stroke();
    ctx.restore();
  }
  if (state === "locked") drawPadlock(ctx, 186, 118, back(since / 320));
  if (state === "shield") drawShield(ctx, 180, 128, back(since / 320));
  if (state === "clarify") {
    const k = ease(since / 350);
    ctx.globalAlpha = k;
    ctx.fillStyle = ORANGE;
    ctx.font = "700 30px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillText("?", 172, 74 - 6 * k + Math.sin(t * 3) * 2);
    ctx.globalAlpha = 1;
  }
  if (state === "urgent") {
    ctx.globalAlpha = Math.sin(t * 14) > 0 ? 1 : 0.4;
    ctx.fillStyle = ORANGE;
    ctx.font = "800 28px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillText("!", 84, 52);
    ctx.fillText("!", 136, 52);
    ctx.globalAlpha = 1;
  }
}

/* ------------------------------------------------------------------ Sari, the support agent */

function drawSari(
  ctx: CanvasRenderingContext2D,
  state: MascotState,
  t: number,
  since: number,
  rig: Rig,
  dt: number,
) {
  const urgent = state === "urgent";
  const land = flightMs(state);
  const engaged = handoff(state) && since > land;
  // She notices the ticket while it is still in the air, then looks up, raises a hand, and nods.
  const look = spring(rig.sLook, handoff(state) && since > land * 0.45 ? 1 : 0, dt, 110, 18);
  const hand = spring(rig.sHand, engaged && since < land + 2200 ? 1 : 0, dt, 120, 14);
  const nodTarget = engaged && since < land + 900 ? Math.sin(((since - land) / 450) * Math.PI) * 3 : 0;
  const nod = spring(rig.sNod, nodTarget, dt, 160, 16);
  const smile = spring(rig.sSmile, engaged ? 1 : 0, dt, 90, 16);
  const typing = 1 - look;
  const breathe = Math.sin(t * 1.7) * 0.8;
  const bob = Math.sin(t * 3.1) * 0.6 * typing;
  const cx = 292;

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // Chair back, behind her.
  volume(ctx, cx - 26, 112, 52, 54, 14, SHADE, LINE);

  // Torso rises and falls a little: breathing.
  ctx.save();
  ctx.translate(0, breathe * 0.6);
  ctx.beginPath();
  ctx.moveTo(cx - 30, 168);
  ctx.quadraticCurveTo(cx - 30, 124 - breathe * 0.4, cx, 124 - breathe * 0.4);
  ctx.quadraticCurveTo(cx + 30, 124 - breathe * 0.4, cx + 30, 168);
  ctx.closePath();
  ctx.fillStyle = ORANGE;
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = WHITE;
  ctx.beginPath();
  ctx.moveTo(cx - 10, 125);
  ctx.lineTo(cx, 136);
  ctx.lineTo(cx + 10, 125);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();

  // Arms: both hands tap at the keyboard while typing; the left one lifts in a wave on a handoff.
  const tapL = Math.max(0, Math.sin(t * 9)) * 1.6 * typing;
  const tapR = Math.max(0, Math.sin(t * 9 + Math.PI)) * 1.6 * typing;
  const leftHand: Pt = [cx - 27 + (cx - 44 - (cx - 27)) * hand, 157 - tapL + (104 - 157) * hand];
  const wave = hand > 0.8 ? Math.sin(t * 9) * 3 * hand : 0;
  leftHand[0] += wave;
  const rightHand: Pt = [cx + 27, 157 - tapR];
  ctx.strokeStyle = INK;
  ctx.lineWidth = 6;
  for (const [sx, [hx, hy]] of [
    [cx - 24, leftHand],
    [cx + 24, rightHand],
  ] as const) {
    ctx.beginPath();
    ctx.moveTo(sx, 140);
    ctx.quadraticCurveTo(sx + (hx - sx) * 0.2, Math.max(140, hy) + 6, hx, hy);
    ctx.stroke();
  }

  // Head: follows breathing, bobs gently while typing, turns up toward Tapi when a ticket comes.
  const hx = cx - look * 2;
  const hy = 96 + breathe * 0.5 + bob + nod - look * 2;
  ctx.save();
  ctx.translate(hx, hy + 18);
  ctx.rotate(-0.08 * look + Math.sin(t * 0.9) * 0.02 * typing);
  ctx.translate(-hx, -(hy + 18));

  ctx.fillStyle = SKIN;
  ctx.beginPath();
  ctx.arc(hx, hy, 20, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.beginPath();
  ctx.arc(hx, hy, 20, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = SKIN_SHADE;
  ctx.beginPath();
  ctx.ellipse(hx + 18, hy + 6, 9, 20, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(hx, hy, 20, 0, Math.PI * 2);
  ctx.stroke();

  // Hair: a bob with a side fringe and a bun that sways a beat behind the head.
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.arc(hx, hy - 1, 22, Math.PI * 0.98, Math.PI * 2.02);
  ctx.quadraticCurveTo(hx + 10, hy - 14, hx - 2, hy - 10);
  ctx.quadraticCurveTo(hx - 12, hy - 6, hx - 22, hy + 2);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.arc(hx + 10 + Math.sin(t * 3.1 - 0.6) * 0.6 * typing, hy - 22 - nod * 0.3, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(hx - 22, hy - 2);
  ctx.quadraticCurveTo(hx - 25, hy + 12, hx - 18, hy + 16);
  ctx.lineTo(hx - 16, hy + 2);
  ctx.closePath();
  ctx.fill();

  // Eyes look down at the screen while typing and up at Tapi when engaged; lids close smoothly.
  const open = eyeOpen(t, 4.3, 1.1);
  const eyeY = hy + 5.5 - look * 4;
  const eyeX = -look * 3;
  const wide = urgent && look > 0.5 ? 1.15 : 1;
  ctx.fillStyle = INK;
  for (const ex of [-7, 7]) {
    ctx.beginPath();
    ctx.ellipse(
      hx + ex + eyeX,
      eyeY,
      2.4 * wide,
      Math.max(0.6, 3 * wide * open * (0.75 + 0.25 * look)),
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  ctx.fillStyle = ORANGE;
  ctx.globalAlpha = 0.5;
  ctx.beginPath();
  ctx.ellipse(hx - 11 + eyeX, hy + 11, 3.4, 2, 0, 0, Math.PI * 2);
  ctx.ellipse(hx + 11 + eyeX, hy + 11, 3.4, 2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.beginPath();
  const sm = 3.5 + smile * 2.5;
  ctx.moveTo(hx - sm + eyeX, hy + 12);
  ctx.quadraticCurveTo(hx + eyeX, hy + 12 + sm * 0.8, hx + sm + eyeX, hy + 12);
  ctx.stroke();

  // Headset with a mic, same team as Tapi.
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.arc(hx, hy, 25, Math.PI * 1.08, Math.PI * 1.92);
  ctx.stroke();
  ctx.fillStyle = INK;
  box(ctx, hx + 20, hy - 6, 8, 16, 4);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(hx + 24, hy + 9);
  ctx.quadraticCurveTo(hx + 20, hy + 20, hx + 9, hy + 19);
  ctx.stroke();
  ctx.restore();

  // Left hand, drawn over the head when raised so the wave is visible.
  ctx.fillStyle = SKIN;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2.5;
  for (const [x, y] of [leftHand, rightHand]) {
    ctx.beginPath();
    ctx.arc(x, y, 6.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  // Desk and laptop in front of her.
  volume(ctx, cx - 58, 160, 116, 12, 5, WHITE, SHADE);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx - 48, 172);
  ctx.lineTo(cx - 48, GROUND);
  ctx.moveTo(cx + 48, 172);
  ctx.lineTo(cx + 48, GROUND);
  ctx.stroke();
  volume(ctx, cx - 22, 128, 44, 32, 6, "#2a2a2e", INK);
  ctx.fillStyle = ORANGE;
  ctx.beginPath();
  ctx.ellipse(cx, 146, 3.2, 5, 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx - 2, 138, 1.4, 0, Math.PI * 2);
  ctx.arc(cx + 2, 138, 1.3, 0, Math.PI * 2);
  ctx.fill();

  // The ticket lands on the desk with a small damped bounce and stays there.
  if (handoff(state) && since > land) {
    const b = (since - land) / 1000;
    const bounce = Math.abs(Math.sin(b * 14)) * Math.exp(-b * 7) * 7;
    ctx.save();
    ctx.translate(cx + 38, 154 - bounce);
    ctx.rotate(0.12 + Math.sin(b * 14) * Math.exp(-b * 7) * 0.1);
    drawTicketShape(ctx, urgent);
    ctx.restore();
  }
  ctx.restore();
}

function flightMs(state: MascotState): number {
  return state === "urgent" ? 700 : 950;
}

function drawTicketShape(ctx: CanvasRenderingContext2D, urgent: boolean) {
  ctx.fillStyle = urgent ? ORANGE_SOFT : WHITE;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.roundRect(-16, -11, 32, 22, 4);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = ORANGE;
  ctx.fillRect(-12, -6, 8, 12);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, -3);
  ctx.lineTo(10, -3);
  ctx.moveTo(0, 3);
  ctx.lineTo(7, 3);
  ctx.stroke();
}

function drawFlyingTicket(ctx: CanvasRenderingContext2D, state: MascotState, since: number) {
  const dur = flightMs(state);
  if (since > dur) return;
  // A quadratic Bezier from Tapi's hand, over the gap, onto Sari's desk, eased in and out.
  const k = easeInOut(since / dur);
  const p0: Pt = [172, 136];
  const p1: Pt = [250, 30];
  const p2: Pt = [330, 154];
  const x = (1 - k) ** 2 * p0[0] + 2 * (1 - k) * k * p1[0] + k ** 2 * p2[0];
  const y = (1 - k) ** 2 * p0[1] + 2 * (1 - k) * k * p1[1] + k ** 2 * p2[1];
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-0.5 + k * (Math.PI * 2 + 0.62));
  ctx.scale(1 + Math.sin(k * Math.PI) * 0.12, 1 + Math.sin(k * Math.PI) * 0.12);
  drawTicketShape(ctx, state === "urgent");
  ctx.restore();
}

/* ------------------------------------------------------------------ speech bubbles */

function bubbleAt(
  ctx: CanvasRenderingContext2D,
  text: string,
  age: number,
  font: string,
  x: number,
  y: number,
  maxW: number,
  tail: "left" | "right",
) {
  const k = back(age / 260);
  ctx.save();
  ctx.font = `500 12.5px ${font}`;
  let shown = text;
  while (ctx.measureText(shown).width > maxW - 24 && shown.length > 4) shown = `${shown.slice(0, -2)}…`;
  const w = Math.min(maxW, ctx.measureText(shown).width + 24);
  const left = tail === "right" ? x - w : x;
  ctx.translate(x, y + 16);
  ctx.scale(0.85 + 0.15 * k, 0.85 + 0.15 * k);
  ctx.translate(-x, -(y + 16));
  ctx.globalAlpha = clamp01(age / 160);
  ctx.fillStyle = WHITE;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(left, y, w, 32, 12);
  ctx.fill();
  ctx.stroke();
  const tx = tail === "left" ? left + 14 : left + w - 14;
  const dir = tail === "left" ? -1 : 1;
  ctx.beginPath();
  ctx.moveTo(tx - 6, y + 30);
  ctx.lineTo(tx + dir * 14, y + 42);
  ctx.lineTo(tx + 6, y + 31);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(tx - 6, y + 32);
  ctx.lineTo(tx + dir * 14, y + 42);
  ctx.lineTo(tx + 6, y + 32);
  ctx.stroke();
  ctx.fillStyle = INK;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(shown, left + 12, y + 16.5);
  ctx.restore();
}

/* ------------------------------------------------------------------ scene */

type Frame = {
  state: MascotState;
  bubble: string | null;
  t: number;
  dt: number;
  since: number;
  bubbleAge: number;
  reduce: boolean;
};

function render(ctx: CanvasRenderingContext2D, dpr: number, f: Frame, font: string, rig: Rig) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(12, GROUND + 0.5);
  ctx.lineTo(W - 12, GROUND + 0.5);
  ctx.stroke();
  drawSari(ctx, f.state, f.t, f.since, rig, f.dt);
  drawRobot(ctx, f.state, f.t, f.since, rig, f.dt);
  drawRobotExtras(ctx, f.state, f.t, f.since);
  if (handoff(f.state) && !f.reduce) drawFlyingTicket(ctx, f.state, f.since);
  if (f.bubble) bubbleAt(ctx, f.bubble, f.bubbleAge, font, 150, 6, 196, "left");
  if (handoff(f.state) && f.since > flightMs(f.state) + 150 && !f.bubble)
    bubbleAt(
      ctx,
      f.state === "urgent" ? "On it, right away" : "Got it, I'll reply soon",
      f.since - flightMs(f.state) - 150,
      font,
      348,
      22,
      160,
      "right",
    );
}

export function Mascot({
  state,
  bubble,
  label,
  loop = false,
}: { state: MascotState; bubble: string | null; label: string; loop?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const rigRef = useRef<Rig>(newRig());
  const live = useRef({ state, changedAt: performance.now(), bubble, bubbleAt: performance.now() });
  if (live.current.state !== state) {
    live.current.state = state;
    live.current.changedAt = performance.now();
  }
  if (live.current.bubble !== bubble) {
    live.current.bubble = bubble;
    live.current.bubbleAt = performance.now();
  }

  // Re-runs on state or bubble change: reduced motion redraws a still frame; otherwise the loop restarts.
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    const font = getComputedStyle(document.body).fontFamily;
    // Reduced motion: no animation loop. One still frame of the settled pose per change.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      // Let every spring settle so the still frame shows the final pose.
      const rig = newRig();
      for (let i = 0; i < 240; i++)
        render(
          ctx,
          dpr,
          { state, bubble, t: 0, dt: 1 / 60, since: 5000, bubbleAge: 5000, reduce: true },
          font,
          rig,
        );
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    let last = t0;
    const frame = (now: number) => {
      const c = live.current;
      // Clamp dt so a backgrounded tab does not make the springs jump when it comes back.
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      render(
        ctx,
        dpr,
        {
          state: c.state,
          bubble: c.bubble,
          t: (now - t0) / 1000,
          dt,
          // In the scene library each reaction replays every few seconds.
          since: loop ? (now - c.changedAt) % 3600 : now - c.changedAt,
          bubbleAge: now - c.bubbleAt,
          reduce: false,
        },
        font,
        rigRef.current,
      );
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [state, bubble, loop]);

  return (
    <canvas
      ref={ref}
      className="mascot"
      style={{ aspectRatio: `${W} / ${H}` }}
      role="img"
      aria-label={`Tapi the agent: ${bubble ?? label}`}
    />
  );
}

export const MASCOT_LABEL: Record<MascotState, string> = {
  idle: "Ready when you are",
  greet: "Hello, how can I help?",
  thinking: "Working on it",
  answer: "Answered, with a source",
  order: "Found your order",
  clarify: "Needs one detail from you",
  locked: "Could not verify that order",
  refuse: "Cannot help with that safely",
  shield: "Blocked an attempt to change my rules",
  escalate: "Handed to Sari on the support team",
  urgent: "Urgent: Sari is on it",
};

// Picks the scene for a finished turn from the structured response, never from the reply text.
export function stateFor(res: {
  action: string;
  order: unknown;
  meta: { guardrails_triggered: string[]; intent: string };
}): MascotState {
  const g = res.meta.guardrails_triggered;
  if (g.includes("injection_boundary") || (g.includes("injection_detected") && res.action !== "escalate"))
    return "shield";
  if (res.action === "escalate")
    return g.includes("high_priority_keywords") || res.meta.intent === "complaint" ? "urgent" : "escalate";
  if (
    g.includes("verification_failed") ||
    g.includes("tool_args_provenance") ||
    g.includes("verify_attempts_exceeded")
  )
    return "locked";
  if (res.order) return "order";
  if (res.action === "refuse") return "refuse";
  if (res.action === "clarify") return "clarify";
  if (res.meta.intent === "policy_question" && g.length === 0 && !res.order && res.action === "answer")
    return "answer";
  return res.action === "answer" ? "greet" : "idle";
}

// What Tapi says while each stage of the real trace is happening.
export function narrate(e: { stage: string; payload: Record<string, unknown> }): string | null {
  const p = e.payload;
  switch (e.stage) {
    case "input":
      return (p.injection_flags as string[] | undefined)?.length
        ? "That looks like an injection attempt"
        : "Reading your message";
    case "decision.jev":
      return p.status === "disabled" ? "Checking the rules" : "Asking JEV for a second opinion";
    case "retrieval": {
      const n = (p.top_k as unknown[] | undefined)?.length ?? 0;
      return n ? `Found ${n} policy page${n > 1 ? "s" : ""}` : "No policy page matches";
    }
    case "llm":
      return "Drafting a reply";
    case "tool_call":
      return p.tool === "get_order"
        ? "Verifying the order"
        : p.tool === "create_escalation"
          ? "Opening a ticket for Sari"
          : `Using ${String(p.tool)}`;
    case "guardrail":
      return `Guard: ${String(p.rule).replace(/_/g, " ")}`;
    default:
      return null;
  }
}

// Every reaction, with the scenario that triggers it. Shown as a library on the How it works page.
export const SCENES: { state: MascotState; title: string; trigger: string }[] = [
  { state: "greet", title: "Greeting", trigger: "Hi, or any opener" },
  { state: "thinking", title: "Working", trigger: "While the turn runs; the bubble narrates each stage" },
  { state: "answer", title: "Answer with a source", trigger: "Policy question found in the knowledge base" },
  { state: "order", title: "Order found", trigger: "Order ID and email both match" },
  {
    state: "clarify",
    title: "Needs a detail",
    trigger: "Missing email, vague message, nothing relevant found",
  },
  { state: "locked", title: "Cannot verify", trigger: "Someone else's order, wrong email, too many tries" },
  { state: "refuse", title: "Declines safely", trigger: "Medical, legal, or safety advice" },
  { state: "shield", title: "Blocks an injection", trigger: "Attempts to change the agent's rules" },
  { state: "escalate", title: "Hands over to Sari", trigger: "Refund, cancellation, exception, lost parcel" },
  { state: "urgent", title: "Urgent handover", trigger: "Chargeback, legal threat, strong anger" },
  { state: "idle", title: "Idle", trigger: "Waiting for a message" },
];
