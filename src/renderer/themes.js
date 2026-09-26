// Theme palettes. Every theme has a dark and a light variant; styles.css derives lines, fills and tints from these.
const THEME_TOKENS = ['bg-0', 'bg-1', 'card', 'card-hover', 'text', 'text-2', 'text-3', 'accent', 'accent-2', 'ring', 'glow', 'play-a', 'play-b', 'shadow'];

const DARK_SHADOW = 'rgba(0, 0, 0, 0.6)';
const LIGHT_SHADOW = 'rgba(20, 32, 48, 0.16)';

const OFFICIAL_THEMES = [
  {
    id: 'steam',
    name: 'Steam',
    dark: {
      'bg-0': '#0b0f14', 'bg-1': '#0f151d', card: '#161d27', 'card-hover': '#1d2733',
      text: '#e3e8ec', 'text-2': '#9aa6b2', 'text-3': '#5f6c79',
      accent: '#1a9fff', 'accent-2': '#2d73ff', ring: '#57cbde', glow: '#1a9fff',
      'play-a': '#6fce1e', 'play-b': '#01a75b', shadow: DARK_SHADOW,
    },
    light: {
      'bg-0': '#e4eaf0', 'bg-1': '#f2f5f8', card: '#ffffff', 'card-hover': '#eaf1f8',
      text: '#16202d', 'text-2': '#4a5a6a', 'text-3': '#8593a1',
      accent: '#1a8fff', 'accent-2': '#2d6bf0', ring: '#1a9fff', glow: '#66c0f4',
      'play-a': '#5cbf12', 'play-b': '#019a52', shadow: LIGHT_SHADOW,
    },
  },
  {
    id: 'deck',
    name: 'Deck',
    dark: {
      'bg-0': '#0e0f12', 'bg-1': '#16171b', card: '#1f2126', 'card-hover': '#292c33',
      text: '#f1f2f4', 'text-2': '#a3a7b0', 'text-3': '#676b75',
      accent: '#1a9fff', 'accent-2': '#0e6fd8', ring: '#1a9fff', glow: '#3d4450',
      'play-a': '#6fce1e', 'play-b': '#01a75b', shadow: DARK_SHADOW,
    },
    light: {
      'bg-0': '#e6e7ea', 'bg-1': '#f4f4f6', card: '#ffffff', 'card-hover': '#eceef1',
      text: '#17181c', 'text-2': '#50545d', 'text-3': '#8b8f98',
      accent: '#1a8fff', 'accent-2': '#0e6fd8', ring: '#1a9fff', glow: '#b8bcc4',
      'play-a': '#5cbf12', 'play-b': '#019a52', shadow: LIGHT_SHADOW,
    },
  },
  {
    id: 'classic',
    name: 'Classic',
    dark: {
      'bg-0': '#2b3025', 'bg-1': '#3a4233', card: '#4a5542', 'card-hover': '#56644c',
      text: '#e4e8de', 'text-2': '#a9b39e', 'text-3': '#818b75',
      accent: '#c4b550', 'accent-2': '#958831', ring: '#c4b550', glow: '#8c9a58',
      'play-a': '#8ea54a', 'play-b': '#5e7a1f', shadow: DARK_SHADOW,
    },
    light: {
      'bg-0': '#dde1d3', 'bg-1': '#eceee5', card: '#fafbf6', 'card-hover': '#eef1e5',
      text: '#2a2f24', 'text-2': '#5b6450', 'text-3': '#8c957f',
      accent: '#8a7c1f', 'accent-2': '#6d6218', ring: '#a39330', glow: '#c4b550',
      'play-a': '#7d9640', 'play-b': '#51691b', shadow: LIGHT_SHADOW,
    },
  },
  {
    id: 'midnight',
    name: 'Midnight',
    dark: {
      'bg-0': '#000000', 'bg-1': '#050608', card: '#0e1014', 'card-hover': '#171a20',
      text: '#eef1f4', 'text-2': '#8f98a3', 'text-3': '#555d68',
      accent: '#66c0f4', 'accent-2': '#3b8fd9', ring: '#66c0f4', glow: '#1b2b4a',
      'play-a': '#6fce1e', 'play-b': '#01a75b', shadow: 'rgba(0, 0, 0, 0.9)',
    },
    light: {
      'bg-0': '#f0f1f3', 'bg-1': '#ffffff', card: '#ffffff', 'card-hover': '#f2f4f7',
      text: '#0a0c0f', 'text-2': '#454b54', 'text-3': '#858b94',
      accent: '#1576c2', 'accent-2': '#0f5a96', ring: '#1576c2', glow: '#dde3ea',
      'play-a': '#3aa84c', 'play-b': '#1d8440', shadow: LIGHT_SHADOW,
    },
  },
  {
    id: 'neon',
    name: 'Neon',
    dark: {
      'bg-0': '#0d0918', 'bg-1': '#140e24', card: '#1e1633', 'card-hover': '#2a1f45',
      text: '#f1ecfa', 'text-2': '#a99cc4', 'text-3': '#6c608a',
      accent: '#c86bff', 'accent-2': '#ff4fd8', ring: '#ff6be6', glow: '#8a3dff',
      'play-a': '#ff4fd8', 'play-b': '#8a3dff', shadow: DARK_SHADOW,
    },
    light: {
      'bg-0': '#ebe4f7', 'bg-1': '#f6f2fc', card: '#ffffff', 'card-hover': '#f1eafb',
      text: '#1f1433', 'text-2': '#5a4b78', 'text-3': '#9687b3',
      accent: '#9b3fe0', 'accent-2': '#d62eb5', ring: '#c13ad2', glow: '#d9b8ff',
      'play-a': '#e03dbf', 'play-b': '#7b2fe6', shadow: LIGHT_SHADOW,
    },
  },
];

// ---------- colour maths ----------

function hexToHsl(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s * 100, l * 100];
}

function hslToHex(h, s, l) {
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(100, s)) / 100;
  l = Math.max(0, Math.min(100, l)) / 100;
  const k = n => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return '#' + [f(0), f(8), f(4)].map(x => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
}

function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

// White text unless the colour is light enough that dark text reads better.
const onColor = hex => (luminance(hex) > 0.45 ? '#10141a' : '#ffffff');

// ---------- custom themes: three colours in, a full dark + light palette out ----------

function buildCustomTheme({ id, name, accent, base, play }) {
  const [bh, bsRaw] = hexToHsl(base);
  const [ah, as, al] = hexToHsl(accent);
  const [ph, ps, pl] = hexToHsl(play);
  const bs = Math.min(bsRaw, 45);

  return {
    id,
    name,
    custom: true,
    source: { accent, base, play },
    dark: {
      'bg-0': hslToHex(bh, bs * 0.9, 5), 'bg-1': hslToHex(bh, bs, 8), card: hslToHex(bh, bs * 0.9, 12), 'card-hover': hslToHex(bh, bs, 16.5),
      text: hslToHex(bh, 18, 92), 'text-2': hslToHex(bh, 12, 66), 'text-3': hslToHex(bh, 10, 44),
      accent, 'accent-2': hslToHex(ah + 18, as, Math.max(al - 12, 25)), ring: hslToHex(ah, as, Math.max(al, 62)), glow: accent,
      'play-a': play, 'play-b': hslToHex(ph + 25, ps, Math.max(pl - 14, 22)), shadow: DARK_SHADOW,
    },
    light: {
      'bg-0': hslToHex(bh, bs * 0.7, 89), 'bg-1': hslToHex(bh, bs * 0.8, 95.5), card: hslToHex(bh, bs * 0.5, 99.5), 'card-hover': hslToHex(bh, bs * 0.8, 93.5),
      text: hslToHex(bh, 30, 13), 'text-2': hslToHex(bh, 14, 36), 'text-3': hslToHex(bh, 10, 56),
      accent: al > 60 ? hslToHex(ah, as, 45) : accent, 'accent-2': hslToHex(ah + 18, as, Math.min(Math.max(al - 12, 25), 40)),
      ring: hslToHex(ah, as, Math.min(al, 50)), glow: accent,
      'play-a': play, 'play-b': hslToHex(ph + 25, ps, Math.max(pl - 14, 22)), shadow: LIGHT_SHADOW,
    },
  };
}

function allThemes(customThemes = []) {
  return [...OFFICIAL_THEMES, ...customThemes.map(buildCustomTheme)];
}

// The palette actually applied: the chosen theme in the resolved mode, plus readable text colours for accent fills.
function resolvePalette(theme, dark) {
  const p = { ...(dark ? theme.dark : theme.light) };
  p['on-accent'] = onColor(p.accent);
  p['on-play'] = onColor(p['play-a']);
  return p;
}
