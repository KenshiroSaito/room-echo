// The positive side of the diverging palette (spec 00-common 4.2): reds with #e66767 in the
// middle, each step at the OKLab lightness of the matching blue (--seq-1 … --seq-5). Prints
// the values used in src/styles/tokens.css and src/gpu/shaders/view.wgsl, with their contrast
// against the canvas.
//
//   pnpm tsx scripts/palette.ts

type Rgb = [number, number, number];

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLinear = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const parse = (hex: string): Rgb =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as Rgb;
const format = (rgb: Rgb) =>
  '#' +
  rgb
    .map((c) =>
      Math.round(Math.min(1, Math.max(0, fromLinear(c))) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('');

function toOklab([r, g, b]: Rgb): Rgb {
  const [lr, lg, lb] = [r, g, b].map(toLinear);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** OKLab → linear sRGB. */
function fromOklab([L, a, b]: Rgb): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const luminance = (hex: string) => {
  const [r, g, b] = parse(hex).map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const CANVAS = '#0d0d0d';
const BLUES = ['#0d366b', '#256abf', '#3987e5', '#86b6ef', '#cde2fb'];
const MIDDLE = '#e66767';

const [, am, bm] = toOklab(parse(MIDDLE));
const hue = Math.atan2(bm, am);
const chromaMiddle = Math.hypot(am, bm);
const blue = BLUES.map((hex) => toOklab(parse(hex)));
const chromaBlueMiddle = Math.hypot(blue[2][1], blue[2][2]);

const reds = blue.map(([L, a, b], i) => {
  if (i === 2) return MIDDLE;
  // Same share of the middle chroma as the blue step has, reduced until it fits sRGB.
  let chroma = (chromaMiddle * Math.hypot(a, b)) / chromaBlueMiddle;
  for (;;) {
    const rgb = fromOklab([L, chroma * Math.cos(hue), chroma * Math.sin(hue)]);
    if (rgb.every((c) => c >= -1e-6 && c <= 1 + 1e-6)) return format(rgb);
    chroma -= 0.002;
  }
});

console.log('step  blue     red      lightness (blue, red)  contrast vs canvas (blue, red)');
reds.forEach((red, i) => {
  const lb = blue[i][0];
  const lr = toOklab(parse(red))[0];
  console.log(
    `${i + 1}     ${BLUES[i]}  ${red}  ${lb.toFixed(3)}  ${lr.toFixed(3)}            ${contrast(BLUES[i], CANVAS).toFixed(2)}  ${contrast(red, CANVAS).toFixed(2)}`,
  );
});
