/**
 * Lottie animations drawn for the built-in scenes (no third-party art): plain
 * Lottie JSON, played by the bundled dotLottie runtime and sought frame by
 * frame. 30 fps, 2 s, 300 × 300.
 */

const ease = { o: { x: [0.33], y: [0] }, i: { x: [0.67], y: [1] } };
const key = (t: number, s: number[]) => ({ t, s, ...ease });
const last = (t: number, s: number[]) => ({ t, s });

/** A five-point star that pops, spins and warms from gold to pink, on a loop. */
export const STAR_STICKER = {
  v: '5.7.0',
  fr: 30,
  ip: 0,
  op: 60,
  w: 300,
  h: 300,
  nm: 'star',
  ddd: 0,
  assets: [],
  layers: [
    {
      ddd: 0,
      ind: 1,
      ty: 4,
      nm: 'star',
      sr: 1,
      ao: 0,
      ip: 0,
      op: 60,
      st: 0,
      bm: 0,
      ks: {
        o: { a: 0, k: 100 },
        r: { a: 1, k: [key(0, [0]), last(60, [144])] },
        p: { a: 0, k: [150, 150, 0] },
        a: { a: 0, k: [0, 0, 0] },
        s: {
          a: 1,
          k: [key(0, [45, 45, 100]), key(30, [100, 100, 100]), last(60, [45, 45, 100])],
        },
      },
      shapes: [
        {
          ty: 'gr',
          nm: 'shape',
          it: [
            {
              ty: 'sr',
              nm: 'points',
              sy: 1,
              d: 1,
              pt: { a: 0, k: 5 },
              p: { a: 0, k: [0, 0] },
              r: { a: 0, k: 0 },
              ir: { a: 0, k: 52 },
              is: { a: 0, k: 0 },
              or: { a: 0, k: 125 },
              os: { a: 0, k: 0 },
            },
            {
              ty: 'fl',
              nm: 'fill',
              c: { a: 1, k: [key(0, [1, 0.8, 0.1, 1]), key(30, [1, 0.35, 0.45, 1]), last(60, [1, 0.8, 0.1, 1])] },
              o: { a: 0, k: 100 },
              r: 1,
            },
            {
              ty: 'tr',
              p: { a: 0, k: [0, 0] },
              a: { a: 0, k: [0, 0] },
              s: { a: 0, k: [100, 100] },
              r: { a: 0, k: 0 },
              o: { a: 0, k: 100 },
            },
          ],
        },
      ],
    },
  ],
};
