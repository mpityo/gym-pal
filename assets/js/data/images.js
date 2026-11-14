/**
 * Reference photos for the exercise library, copied from
 * yuhonas/free-exercise-db (Unlicense) by tools/fetch-images.mjs.
 * See assets/img/ex/ATTRIBUTION.md. They show a person doing the movement,
 * not the exact machine in your gym.
 */

/** exercise id -> number of reference images available (files are assets/img/ex/<id>-<n>.jpg) */
export const IMAGE_COUNT = {
  'ab-machine': 2,
  'assisted-dip': 2,
  'assisted-pullup': 2,
  'bike': 2,
  'cable-crunch': 2,
  'cable-curl': 2,
  'cable-fly': 2,
  'cable-lateral-raise': 2,
  'cable-row': 2,
  'calf-legpress': 2,
  'calf-seated': 2,
  'calf-standing': 2,
  'chest-press': 2,
  'db-bench': 2,
  'db-curl': 2,
  'db-incline': 2,
  'db-kickback': 2,
  'db-overhead-ext': 2,
  'db-rdl': 2,
  'db-rear-fly': 2,
  'db-row': 2,
  'db-shoulder-press': 2,
  'dead-bug': 2,
  'elliptical': 2,
  'face-pull': 2,
  'goblet-squat': 2,
  'hack-squat': 2,
  'hammer-curl': 2,
  'hanging-knee-raise': 2,
  'hip-abductor': 2,
  'hip-adductor': 2,
  'incline-press': 2,
  'lat-pulldown': 2,
  'lateral-raise': 2,
  'leg-curl-lying': 2,
  'leg-curl-seated': 2,
  'leg-extension': 2,
  'leg-press': 2,
  'mile-run': 2,
  'overhead-cable-ext': 2,
  'pec-deck': 2,
  'plank': 1,
  'preacher-curl': 2,
  'pulldown-machine': 2,
  'pushup': 2,
  'rear-delt-fly': 2,
  'row-machine': 2,
  'seated-dip': 2,
  'shoulder-press': 2,
  'smith-bench': 2,
  'smith-shoulder-press': 2,
  'smith-squat': 2,
  'split-squat': 2,
  'straight-arm-pulldown': 2,
  'treadmill-warmup': 2,
  'tricep-ext-machine': 2,
  'tricep-pushdown': 2,
  'walking-lunge': 2,
};

/** ['assets/img/ex/<id>-0.jpg', …], or [] when there is no reference photo. */
export function exerciseImages(id) {
  const n = IMAGE_COUNT[id] ?? 0;
  return Array.from({ length: n }, (_, i) => `assets/img/ex/${id}-${i}.jpg`);
}
