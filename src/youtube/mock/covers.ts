// Ảnh bìa cho `npm run dev:mock`: tranh SVG tự vẽ theo tên bài (mưa, biển, phố đêm, tàu đêm…).
// Không dùng ảnh bìa thật (có bản quyền). Chỉ có trong chế độ dữ liệu mẫu, không vào bản build.

type Rng = () => number;

/** Số ngẫu nhiên lặp lại được theo `seed` (mulberry32): cùng bài luôn ra cùng ảnh. */
function rngFrom(seed: string): Rng {
  let h = 1779033703 ^ seed.length;
  for (const ch of seed) {
    h = Math.imul(h ^ ch.charCodeAt(0), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const n = (v: number) => Math.round(v * 10) / 10;
const between = (rng: Rng, lo: number, hi: number) => n(lo + rng() * (hi - lo));
const pick = <T>(rng: Rng, items: readonly T[]) => items[Math.floor(rng() * items.length)];
const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const FONT = "font-family=\"'Be Vietnam Pro',-apple-system,'Helvetica Neue',Arial,sans-serif\"";

function gradient(id: string, stops: string[], vertical = true): string {
  const dir = vertical ? 'x1="0" y1="0" x2="0" y2="1"' : 'x1="0" y1="0" x2="1" y2="1"';
  const s = stops.map((c, i) => `<stop offset="${n(i / (stops.length - 1))}" stop-color="${c}"/>`).join('');
  return `<defs><linearGradient id="${id}" ${dir}>${s}</linearGradient></defs><rect width="300" height="300" fill="url(#${id})"/>`;
}

/** Đồi nhấp nhô ở độ cao `y`. */
function hills(rng: Rng, y: number, amp: number, fill: string, opacity = 1): string {
  let d = `M0 300V${n(y + between(rng, -amp, amp))}`;
  for (let x = 75; x <= 300; x += 75) d += `Q${n(x - 37.5)} ${n(y + between(rng, -amp * 2, amp))} ${x} ${n(y + between(rng, -amp, amp))}`;
  return `<path d="${d}V300Z" fill="${fill}" opacity="${opacity}"/>`;
}

function stars(rng: Rng, count: number, maxY: number): string {
  let s = '';
  for (let i = 0; i < count; i++) {
    s += `<circle cx="${between(rng, 0, 300)}" cy="${between(rng, 0, maxY)}" r="${between(rng, 0.6, 1.8)}" fill="#fff" opacity="${between(rng, 0.4, 1)}"/>`;
  }
  return s;
}

function moon(cx: number, cy: number, r: number, crescent: boolean): string {
  if (!crescent) return `<circle cx="${cx}" cy="${cy}" r="${r + 10}" fill="#fff8d6" opacity=".12"/><circle cx="${cx}" cy="${cy}" r="${r}" fill="#fdf6d8"/>`;
  return `<defs><mask id="mk"><rect width="300" height="300" fill="#fff"/><circle cx="${cx + r * 0.42}" cy="${cy - r * 0.25}" r="${r * 0.9}" fill="#000"/></mask></defs><circle cx="${cx}" cy="${cy}" r="${r}" fill="#fdf6d8" mask="url(#mk)"/>`;
}

const cloud = (x: number, y: number, s: number, opacity = 0.85) =>
  `<g fill="#fff" opacity="${opacity}"><ellipse cx="${x}" cy="${y}" rx="${n(28 * s)}" ry="${n(11 * s)}"/><circle cx="${n(x - 10 * s)}" cy="${n(y - 7 * s)}" r="${n(12 * s)}"/><circle cx="${n(x + 8 * s)}" cy="${n(y - 10 * s)}" r="${n(15 * s)}"/></g>`;

// ---------- Các cảnh ----------

type Scene = (rng: Rng, title: string) => string;

const rain: Scene = (rng) => {
  let lines = '';
  for (let i = 0; i < 70; i++) {
    const x = between(rng, -10, 310);
    const y = between(rng, -20, 290);
    const len = between(rng, 12, 26);
    lines += `<path d="M${x} ${y}l-5 ${len}"/>`;
  }
  return `${gradient('s', ['#0f2027', '#203a43', '#2c5364'])}${hills(rng, 238, 10, '#0b1820')}
<g stroke="#cfe8ff" stroke-width="1.4" stroke-linecap="round" opacity=".45">${lines}</g>
<g transform="translate(150 212)"><path d="M-46 0A46 46 0 0 1 46 0Q34.5-8 23 0Q11.5-8 0 0Q-11.5-8-23 0Q-34.5-8-46 0Z" fill="#e8115b"/>
<path d="M0 0V34q0 8 8 8" stroke="#e8115b" stroke-width="4" fill="none" stroke-linecap="round"/></g>
<ellipse cx="150" cy="268" rx="70" ry="6" fill="#e8115b" opacity=".18"/>`;
};

const rainbow: Scene = (rng) => {
  const colors = ['#ff5f6d', '#ffa36c', '#ffe66d', '#7bd389', '#5fa8ff', '#a17cff'];
  const arcs = colors.map((c, i) => `<path d="M${40 + i * 9} 250A${110 - i * 9} ${110 - i * 9} 0 0 1 ${260 - i * 9} 250" stroke="${c}"/>`).join('');
  return `${gradient('s', ['#89f7fe', '#66a6ff'])}<g fill="none" stroke-width="9" opacity=".9">${arcs}</g>
${cloud(48, 246, 1.3)}${cloud(258, 244, 1.2)}${cloud(between(rng, 120, 190), 70, 0.9, 0.7)}${hills(rng, 262, 6, '#3f8f6b')}`;
};

const city: Scene = (rng, title) => {
  const night = / (ngủ|đêm|thành phố) /.test(` ${title.toLowerCase()} `);
  const sky = night ? gradient('s', ['#0b1026', '#1f2b56', '#3a3f7a']) : gradient('s', ['#ff9966', '#ff5e62', '#5f2c82']);
  const light = night ? moon(232, 66, 20, true) + stars(rng, 35, 140) : `<circle cx="150" cy="168" r="62" fill="#ffd27f" opacity=".95"/>`;
  let blocks = '';
  let x = -4;
  while (x < 300) {
    const w = between(rng, 22, 40);
    const h = between(rng, 70, 170);
    const top = 300 - h;
    blocks += `<rect x="${x}" y="${n(top)}" width="${w}" height="${h}" fill="${night ? '#0a0f22' : '#2b1340'}"/>`;
    for (let wy = top + 10; wy < 290; wy += 14) {
      for (let wx = x + 5; wx < x + w - 6; wx += 9) {
        if (rng() < 0.22) blocks += `<rect x="${n(wx)}" y="${n(wy)}" width="4" height="6" fill="#ffd27f" opacity=".9"/>`;
      }
    }
    x += w + between(rng, 1, 4);
  }
  return sky + light + blocks;
};

const sea: Scene = (rng) => {
  const blues = ['#1c92d2', '#1573b7', '#0f5a99', '#0b4278'];
  const waves = blues
    .map((c, i) => {
      const y = 182 + i * 26;
      const a = between(rng, 6, 12);
      return `<path d="M0 ${y}Q37.5 ${y - a} 75 ${y}T150 ${y}T225 ${y}T300 ${y}V300H0Z" fill="${c}"/>`;
    })
    .join('');
  const bx = between(rng, 60, 110);
  return `${gradient('s', ['#56ccf2', '#bde8f6'])}<circle cx="${between(rng, 190, 230)}" cy="86" r="30" fill="#fff4c2"/>${cloud(80, 70, 0.9, 0.8)}
<path d="M${bx} 176l22-48v48z" fill="#fff"/><path d="M${n(bx - 8)} 178h40l-8 8h-26z" fill="#e8115b"/>${waves}`;
};

const sunset: Scene = (rng) => {
  let stripes = '';
  for (let i = 0; i < 9; i++) {
    const y = 212 + i * 9;
    const w = n(90 - i * 8 + between(rng, -6, 6));
    stripes += `<rect x="${n(150 - w / 2)}" y="${y}" width="${w}" height="3" rx="1.5" fill="#ffe29a" opacity="${n(0.75 - i * 0.07)}"/>`;
  }
  return `${gradient('s', ['#3a1c71', '#d76d77', '#ffaf7b'])}<circle cx="150" cy="200" r="58" fill="#ffe29a"/>
<rect y="200" width="300" height="100" fill="#3a1c71"/>${stripes}`;
};

const sun: Scene = (rng) => {
  let rays = '';
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + rng() * 0.05;
    rays += `<path d="M${n(150 + Math.cos(a) * 74)} ${n(140 + Math.sin(a) * 74)}L${n(150 + Math.cos(a) * 128)} ${n(140 + Math.sin(a) * 128)}"/>`;
  }
  return `${gradient('s', ['#f7971e', '#ffd200'])}<g stroke="#fff" stroke-width="7" stroke-linecap="round" opacity=".35">${rays}</g>
<circle cx="150" cy="140" r="58" fill="#fff3b0"/>${hills(rng, 236, 12, '#e65c00')}${hills(rng, 262, 10, '#b34700')}`;
};

const night: Scene = (rng) =>
  `${gradient('s', ['#000428', '#0a2a5e', '#004e92'])}${stars(rng, 70, 230)}${moon(between(rng, 190, 225), 82, 30, true)}
${hills(rng, 244, 12, '#061633')}${hills(rng, 270, 8, '#030c1f')}`;

const train: Scene = (rng) => {
  let cars = '';
  for (let c = 0; c < 4; c++) {
    const x = 22 + c * 62;
    cars += `<rect x="${x}" y="200" width="58" height="28" rx="4" fill="#0d1520"/>`;
    for (let w = 0; w < 4; w++) cars += `<rect x="${x + 6 + w * 13}" y="207" width="8" height="9" rx="1" fill="#ffd27f" opacity="${between(rng, 0.65, 1)}"/>`;
  }
  const dusk = rng() < 0.5;
  const sky = dusk ? gradient('s', ['#2b1055', '#7a4b9c', '#ff8c6b']) : gradient('s', ['#141e30', '#243b55', '#3d5a80']);
  return `${sky}${stars(rng, dusk ? 18 : 45, dusk ? 90 : 150)}${dusk ? '<circle cx="232" cy="176" r="34" fill="#ffd8a8" opacity=".9"/>' : moon(68, 64, 18, false)}
${hills(rng, 214, 14, '#1a2a3d')}<rect y="228" width="300" height="72" fill="#0b121b"/>${cars}
<path d="M270 200h8a10 10 0 0 1 10 10v18h-18z" fill="#0d1520"/><circle cx="284" cy="214" r="3" fill="#fff6c8"/>
<rect y="230" width="300" height="3" fill="#2c3e50"/>`;
};

const RIVER_MOODS = [
  { sky: ['#fbc2eb', '#c3b1e1', '#a6c1ee'], hill: '#8e7cc3', water: '#5b4b8a', shine: '#7d8fd1', ink: '#3b2a4d', orb: '#fff1f5' },
  { sky: ['#ffecd2', '#fcb69f', '#f08a5d'], hill: '#c96b4a', water: '#8a4b3a', shine: '#d98b62', ink: '#4a2418', orb: '#fff4d6' },
  { sky: ['#2c3e50', '#3f6f80', '#4ca1af'], hill: '#26495c', water: '#1d3a4a', shine: '#3d6b7d', ink: '#0f1f29', orb: '#fdf6d8' }
];

const river: Scene = (rng) => {
  const m = pick(rng, RIVER_MOODS);
  const px = rng() < 0.5 ? 72 : 228;
  let pagoda = '';
  for (let i = 0; i < 7; i++) {
    const w = 36 - i * 3.5;
    const y = 196 - (i + 1) * 12;
    pagoda += `<rect x="${n(px - w / 2)}" y="${y + 2}" width="${n(w)}" height="10" fill="${m.ink}"/><rect x="${n(px - w / 2 - 5)}" y="${y}" width="${n(w + 10)}" height="3" rx="1.5" fill="${m.ink}"/>`;
  }
  const bx = px < 150 ? 176 : 60;
  return `${gradient('s', m.sky)}<circle cx="${px < 150 ? between(rng, 200, 240) : between(rng, 60, 100)}" cy="92" r="26" fill="${m.orb}" opacity=".9"/>
${hills(rng, 190, 10, m.hill, 0.55)}${pagoda}<path d="M${px} 102v-14" stroke="${m.ink}" stroke-width="2.5"/>
<rect y="196" width="300" height="104" fill="${m.water}"/><path d="M0 214C80 200 200 236 300 214V300H0Z" fill="${m.shine}" opacity=".55"/>
<path d="M${bx} 242q22 9 44 0l-7 7h-30z" fill="${m.ink}"/><path d="M${bx + 14} 242v-14l12 14z" fill="${m.ink}"/>`;
};

const coffee: Scene = (rng) => {
  const steam = [128, 150, 172]
    .map((x) => `<path d="M${x} 126c-10-14 10-22 0-38s10-24 0-36" stroke="#fff" stroke-width="5" fill="none" stroke-linecap="round" opacity="${between(rng, 0.35, 0.6)}"/>`)
    .join('');
  return `${gradient('s', ['#e6c7a3', '#b07d4f', '#6f4e37'])}${steam}<ellipse cx="150" cy="226" rx="78" ry="15" fill="#fff7ec"/>
<path d="M98 140h104v46a52 46 0 0 1-104 0z" fill="#fff7ec"/><circle cx="210" cy="168" r="17" stroke="#fff7ec" stroke-width="9" fill="none"/>
<ellipse cx="150" cy="141" rx="52" ry="9" fill="#5a3a24"/>`;
};

const road: Scene = (rng, title) => {
  let dashes = '';
  for (let i = 0; i < 6; i++) {
    const t = i / 6;
    const y = n(184 + t * t * 116);
    dashes += `<rect x="${n(150 - (1 + t * 4))}" y="${y}" width="${n(2 + t * 8)}" height="${n(5 + t * 16)}" fill="#fff" opacity=".85"/>`;
  }
  const home = / nhà /.test(` ${title.toLowerCase()} `)
    ? `<path d="M222 182v-16l14-11 14 11v16z" fill="#2b2d42"/><rect x="232" y="170" width="7" height="7" fill="#ffd27f"/>`
    : '';
  return `${gradient('s', ['#ff7e5f', '#feb47b'])}<circle cx="150" cy="160" r="40" fill="#fff1c1"/>${hills(rng, 174, 10, '#c45a3b')}
<rect y="182" width="300" height="118" fill="#2d5a27"/><path d="M146 182h8l96 118H50z" fill="#3a3a3a"/>${dashes}${home}`;
};

const wind: Scene = (rng) => {
  let swoosh = '';
  for (let i = 0; i < 6; i++) {
    const y = 60 + i * 38 + between(rng, -8, 8);
    swoosh += `<path d="M-10 ${y}C80 ${y - 46} 170 ${y + 46} 310 ${y - 12}" stroke="#fff" stroke-width="${between(rng, 3, 7)}" fill="none" stroke-linecap="round" opacity="${between(rng, 0.45, 0.85)}"/>`;
  }
  let leaves = '';
  for (let i = 0; i < 9; i++) {
    leaves += `<path d="M0-9Q7 0 0 9Q-7 0 0-9Z" fill="${pick(rng, ['#2bb673', '#58c27d', '#1e8a5a'])}" transform="translate(${between(rng, 20, 280)} ${between(rng, 30, 270)}) rotate(${between(rng, 0, 360)})"/>`;
  }
  return `${gradient('s', ['#a8edea', '#fed6e3'])}${swoosh}${leaves}`;
};

const autumn: Scene = (rng) => {
  let leaves = '';
  for (let i = 0; i < 20; i++) {
    const s = between(rng, 0.9, 1.9);
    leaves += `<g transform="translate(${between(rng, 10, 290)} ${between(rng, 20, 290)}) rotate(${between(rng, 0, 360)}) scale(${s})"><path d="M0-12Q10-2 0 12Q-10-2 0-12Z" fill="${pick(rng, ['#d35400', '#e67e22', '#c0392b', '#f39c12'])}"/><path d="M0-10V12" stroke="#7a3b0c" stroke-width=".8"/></g>`;
  }
  return `${gradient('s', ['#f6d365', '#fda085'])}<path d="M-10 40C60 60 90 30 150 58" stroke="#5b3a1e" stroke-width="7" fill="none" stroke-linecap="round"/>${leaves}`;
};

const plane: Scene = (rng) => {
  const x = between(rng, 190, 220);
  const y = between(rng, 80, 100);
  return `${gradient('s', ['#355c7d', '#6c5b7b', '#f67280'])}${cloud(70, 210, 1.4, 0.35)}${cloud(230, 240, 1.2, 0.3)}
<path d="M-10 250C80 230 140 150 ${x} ${y}" stroke="#fff" stroke-width="3" fill="none" opacity=".7"/>
<g transform="translate(${x} ${y}) rotate(-38) scale(1.6)" fill="#fff"><path d="M-14 0l30-3 6 3-6 3z"/><path d="M0-2l-8-14h5l13 14z"/><path d="M0 2l-8 14h5l13-14z"/><path d="M-12-1l-5-7h4l7 7z"/></g>`;
};

const lights: Scene = (rng) => {
  let bokeh = '';
  for (let i = 0; i < 26; i++) {
    bokeh += `<circle cx="${between(rng, 0, 300)}" cy="${between(rng, 0, 300)}" r="${between(rng, 8, 32)}" fill="${pick(rng, ['#ffd27f', '#ff9a8b', '#a1c4fd', '#f6f9c7'])}" opacity="${between(rng, 0.2, 0.55)}"/>`;
  }
  return `${gradient('s', ['#0f0c29', '#302b63', '#24243e'])}<defs><filter id="b"><feGaussianBlur stdDeviation="2.5"/></filter></defs><g filter="url(#b)">${bokeh}</g>`;
};

const flowers: Scene = (rng) => {
  let branches = '';
  let blossoms = '';
  for (let i = 0; i < 4; i++) {
    const y = 40 + i * 60;
    branches += `<path d="M-10 ${y + 40}C60 ${y} 120 ${y + 30} ${between(rng, 180, 260)} ${y}" stroke="#3e2a1e" stroke-width="4" fill="none"/>`;
    for (let c = 0; c < 3; c++) {
      const cx = between(rng, 30, 270);
      const cy = between(rng, y - 10, y + 40);
      for (let k = 0; k < 10; k++) {
        blossoms += `<circle cx="${n(cx + between(rng, -12, 12))}" cy="${n(cy + between(rng, -9, 9))}" r="${between(rng, 2, 3.8)}" fill="#fffdf2" opacity=".92"/>`;
      }
    }
  }
  return `${gradient('s', ['#0f3d2e', '#1d5c46', '#123528'])}<circle cx="240" cy="54" r="30" fill="#fdf6d8" opacity=".25"/>${branches}${blossoms}`;
};

const mist: Scene = (rng) => {
  const layers = ['#c9d6dc', '#a3b8c1', '#7f9aa6', '#4e6b5c'];
  const mountains = layers.map((c, i) => hills(rng, 120 + i * 40, 22 - i * 3, c)).join('');
  let pines = '';
  for (let i = 0; i < 14; i++) {
    const x = between(rng, 0, 300);
    const h = between(rng, 26, 46);
    pines += `<path d="M${x} ${n(300 - h - 20)}l${n(h / 3)} ${h}h-${n((h / 3) * 2)}z" fill="#2f4a3a"/>`;
  }
  return `${gradient('s', ['#e3ecf2', '#ffffff'])}${mountains}<defs><linearGradient id="f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity=".85"/></linearGradient></defs>
<rect y="150" width="300" height="70" fill="url(#f)"/>${pines}<rect y="282" width="300" height="18" fill="#2f4a3a"/>`;
};

const vinyl: Scene = (rng) => {
  const [a, b] = pick(rng, PALETTES);
  let grooves = '';
  for (let r = 42; r <= 104; r += 6) grooves += `<circle cx="150" cy="150" r="${r}" stroke="#2a2a2a" stroke-width="1" fill="none"/>`;
  return `${gradient('s', [a, b], false)}<circle cx="150" cy="150" r="112" fill="#111"/>${grooves}
<path d="M80 96A86 86 0 0 1 150 64" stroke="#fff" stroke-width="10" fill="none" opacity=".08" stroke-linecap="round"/>
<circle cx="150" cy="150" r="36" fill="${a}"/><circle cx="150" cy="150" r="4" fill="#111"/>`;
};

const fire: Scene = () => {
  const rings = [210, 170, 130, 90].map((r, i) => `<circle cx="150" cy="320" r="${r}" fill="#fff" opacity="${0.06 + i * 0.05}"/>`).join('');
  return `${gradient('s', ['#f12711', '#f5af19'])}${rings}`;
};

const HEART = 'M0 70C-90 10-80-70-30-70C-10-70 0-55 0-45C0-55 10-70 30-70C80-70 90 10 0 70Z';

const love: Scene = (rng) => {
  let small = '';
  for (let i = 0; i < 7; i++) {
    small += `<path d="${HEART}" fill="#fff" opacity="${between(rng, 0.25, 0.55)}" transform="translate(${between(rng, 20, 280)} ${between(rng, 20, 280)}) scale(${between(rng, 0.08, 0.16)}) rotate(${between(rng, -20, 20)})"/>`;
  }
  return `${gradient('s', ['#ff9a9e', '#fecfef'])}${small}<path d="${HEART}" fill="#e8115b" transform="translate(150 158) scale(1.15)"/>
<path d="M150 104l-12 24 16 16-14 24 12 26" stroke="#fecfef" stroke-width="6" fill="none" stroke-linejoin="round"/>`;
};

const boat: Scene = (rng) => {
  let ripples = '';
  for (let i = 0; i < 5; i++) {
    ripples += `<ellipse cx="${between(rng, 40, 260)}" cy="${between(rng, 236, 285)}" rx="${between(rng, 18, 40)}" ry="3" fill="none" stroke="#fff" stroke-width="2" opacity=".45"/>`;
  }
  return `${gradient('s', ['#c2e9fb', '#a1c4fd'])}<circle cx="${between(rng, 60, 90)}" cy="74" r="24" fill="#fff8d6"/>${cloud(220, 80, 1, 0.8)}
<rect y="214" width="300" height="86" fill="#6a8dff"/>${ripples}
<path d="M88 206h124l-22 28h-80z" fill="#fff"/><path d="M150 120v86h-44z" fill="#f4f6fb"/><path d="M150 120l46 86h-46z" fill="#dfe4ef"/>`;
};

const letter: Scene = () =>
  `${gradient('s', ['#e0c3fc', '#8ec5fc'])}<rect x="66" y="98" width="168" height="112" rx="8" fill="#fffaf3"/>
<path d="M66 106l84 62 84-62" stroke="#e5d9c8" stroke-width="4" fill="none" stroke-linejoin="round"/>
<path d="M70 206l56-44M230 206l-56-44" stroke="#efe5d6" stroke-width="3"/>
<circle cx="150" cy="168" r="16" fill="#e8115b"/><path d="${HEART}" fill="#fecfef" transform="translate(150 168) scale(.1)"/>`;

const PALETTES: [string, string][] = [
  ['#e8115b', '#5f0a2b'],
  ['#4f8bff', '#1e3264'],
  ['#8d67ab', '#2b1a3d'],
  ['#ff9a3c', '#e1118c'],
  ['#27ae60', '#0c3d07'],
  ['#509bf5', '#0b2a54'],
  ['#7358ff', '#1b1240'],
  ['#ff6b6b', '#556270']
];

/** Không khớp cảnh nào: hình khối trừu tượng kiểu Bauhaus. */
const abstract: Scene = (rng) => {
  const [a, b] = pick(rng, PALETTES);
  const accents = ['#ffd27f', '#ffffff', '#ff9a8b', '#a1c4fd'];
  return `${gradient('s', [a, b], false)}
<circle cx="${between(rng, 80, 220)}" cy="${between(rng, 80, 220)}" r="${between(rng, 60, 95)}" fill="${pick(rng, accents)}" opacity=".85"/>
<path d="M0 300V${between(rng, 170, 230)}A110 110 0 0 1 220 300Z" fill="#000" opacity=".25"/>
<rect x="${between(rng, 150, 230)}" y="${between(rng, 20, 120)}" width="${between(rng, 20, 50)}" height="${between(rng, 80, 160)}" fill="${pick(rng, accents)}" opacity=".7"/>
<circle cx="${between(rng, 40, 260)}" cy="${between(rng, 40, 260)}" r="${between(rng, 12, 28)}" fill="none" stroke="#fff" stroke-width="5" opacity=".8"/>`;
};

/** Từ khoá (cả từ) trong tên bài → cảnh. Thứ tự quan trọng: "Trời Sau Mưa" là cầu vồng, không phải mưa. */
const SCENES: [string[], Scene][] = [
  [['sau mưa'], rainbow],
  [['mưa'], rain],
  [['tàu', 'ga'], train],
  [['huế', 'sông'], river],
  [['biển', 'chill'], sea],
  [['cuối ngày', 'hạ'], sunset],
  [['nắng'], sun],
  [['cà phê'], coffee],
  [['đường', 'nhà', 'hành trình'], road],
  [['gió'], wind],
  [['thu'], autumn],
  [['bay'], plane],
  [['đèn'], lights],
  [['hoa'], flowers],
  [['đà lạt', 'sương'], mist],
  [['phố'], city],
  [['đêm', 'lofi'], night],
  [['em'], love],
  [['chuyện'], boat],
  [['lời'], letter],
  [['tình ca', 'kỷ niệm'], vinyl],
  [['hot'], fire]
];

function sceneFor(title: string): Scene {
  const padded = ` ${title.toLowerCase()} `;
  return SCENES.find(([keys]) => keys.some((k) => padded.includes(` ${k} `)))?.[1] ?? abstract;
}

function toDataUrl(body: string, round = false): string {
  const clip = round ? '<defs><clipPath id="c"><circle cx="150" cy="150" r="150"/></clipPath></defs><g clip-path="url(#c)">' : '<g>';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300">${clip}${body}</g></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.replace(/\n/g, ''))}`;
}

// ---------- Ảnh bìa theo loại ----------

export function trackCover(seed: string, title: string): string {
  return toDataUrl(sceneFor(title)(rngFrom(seed), title));
}

/** Album: cảnh + tên album, tên nghệ sĩ ở góc dưới. */
export function albumCover(seed: string, title: string, artist: string): string {
  const name = title.replace(/^Album\s+/i, '');
  const text = `<defs><linearGradient id="t" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".6"/></linearGradient></defs>
<rect y="190" width="300" height="110" fill="url(#t)"/>
<text x="18" y="252" ${FONT} font-size="13" font-weight="600" letter-spacing="2" fill="#fff" opacity=".85">${escape(artist.toUpperCase())}</text>
<text x="18" y="282" ${FONT} font-size="30" font-weight="800" fill="#fff">${escape(name)}</text>`;
  return toDataUrl(sceneFor(name)(rngFrom(seed), name) + text);
}

/** Playlist: cảnh + chữ lớn kiểu playlist biên tập của Spotify. */
export function playlistCover(seed: string, title: string): string {
  const words = title.split(/\s+/);
  const lines: string[] = [];
  for (const w of words) {
    const last = lines[lines.length - 1];
    if (last && `${last} ${w}`.length <= 10) lines[lines.length - 1] = `${last} ${w}`;
    else lines.push(w);
  }
  const text = lines
    .map((line, i) => `<text x="18" y="${54 + i * 42}" ${FONT} font-size="40" font-weight="800" fill="#fff" stroke="#000" stroke-opacity=".18" stroke-width="1">${escape(line)}</text>`)
    .join('');
  const shade = `<defs><linearGradient id="sh" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity=".45"/><stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient></defs><rect width="300" height="${40 + lines.length * 46}" fill="url(#sh)"/>`;
  return toDataUrl(sceneFor(title)(rngFrom(seed), title) + shade + text);
}

const ARTIST_PALETTES: [string, string][] = [
  ['#fa709a', '#fee140'],
  ['#4facfe', '#00f2fe'],
  ['#a18cd1', '#fbc2eb'],
  ['#f83600', '#f9d423'],
  ['#30cfd0', '#330867'],
  ['#43e97b', '#38f9d7'],
  ['#ff6b6b', '#556270'],
  ['#5ee7df', '#b490ca']
];

/**
 * Nghệ sĩ: bóng người trên nền màu, vòng sáng phía sau; ban nhạc là ba bóng người.
 * `index` (thứ tự trong danh sách mẫu) để các nghệ sĩ không trùng màu.
 */
export function artistCover(seed: string, name: string, index: number, round = false): string {
  const rng = rngFrom(seed);
  const [a, b] = ARTIST_PALETTES[index % ARTIST_PALETTES.length];
  const person = (x: number, s: number, opacity: number) =>
    `<g transform="translate(${x} ${n(300 * (1 - s))}) scale(${s})" opacity="${opacity}"><circle cx="0" cy="128" r="44" fill="#0b0b0f"/><path d="M-92 300Q-92 196 0 196Q92 196 92 300Z" fill="#0b0b0f"/></g>`;
  const band = /ban nhạc|band/i.test(name);
  const people = band ? person(70, 0.72, 0.75) + person(230, 0.72, 0.75) + person(150, 0.85, 0.9) : person(150, 1, 0.85);
  const cy = band ? 150 : 128;
  const rings = [64, 96, 128, 160].map((r) => `<circle cx="150" cy="${cy}" r="${r}" fill="none" stroke="#fff" stroke-width="${between(rng, 1.5, 4)}" opacity=".16"/>`).join('');
  const glow = `<circle cx="150" cy="${cy}" r="${band ? 110 : 76}" fill="#fff" opacity=".2"/>`;
  return toDataUrl(`${gradient('s', [a, b], false)}${rings}${glow}${people}`, round);
}
