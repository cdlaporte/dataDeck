// Builds examples/statistical-bias.datadeck.json: a presentation on sampling and
// response bias for an intro stats class. One synthetic town (Riverton, 1,000
// residents) where every resident's true values are known, so each bias can be
// shown pulling an estimate away from the truth.
//
//   node scripts/genBiasDeck.mjs
//
// Deterministic (seeded). Prints true vs biased means and checks that every
// truth → biased slide pair shares the same axis.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scaleLinear } from 'd3-scale';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'examples', 'statistical-bias.datadeck.json');
const N = 1000;
const FRAME = { width: 1280, height: 720 };

// ---------------------------------------------------------------------------
// Random numbers

function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261004);
const normal = (mu = 0, sd = 1) => {
  const u = 1 - rand();
  const v = rand();
  return mu + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
const poisson = (lambda) => {
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rand();
  } while (p > L);
  return k - 1;
};
const sigmoid = (x) => 1 / (1 + Math.exp(-x));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const roundTo = (v, step) => Number((Math.round(v / step) * step).toFixed(4));

/** Weighted sample of k distinct indices (Efraimidis–Spirakis). */
function weightedSample(weights, k) {
  return weights
    .map((w, i) => ({ i, key: Math.log(rand()) / Math.max(w, 1e-9) }))
    .sort((a, b) => b.key - a.key)
    .slice(0, k)
    .map((d) => d.i);
}
const shuffle = (xs) => {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// ---------------------------------------------------------------------------
// The town: true values

const people = Array.from({ length: N }, (_, i) => {
  const age = Math.round(clamp(normal(47, 17), 18, 92));
  const frailty = normal(0, 1) + 0.035 * (age - 47);
  const bp = Math.round(clamp(108 + 0.48 * (age - 18) + 4 * frailty + normal(0, 10), 92, 195));
  return { i, id: `R-${String(i + 1).padStart(4, '0')}`, age, frailty, bp };
});
const ageGroup = (a) => (a < 35 ? '18–34' : a < 55 ? '35–54' : a < 75 ? '55–74' : '75+');

for (const p of people) {
  p.ageGroup = ageGroup(p.age);
  // Opinion of the clinic's new opening hours: most are fine with them; a minority is angry.
  p.satisfaction = Math.round(clamp(rand() < 0.13 ? normal(2.2, 1.4) : normal(7.4, 1.5), 0, 10));
  // Internet access drops off sharply with age.
  p.internet = rand() < 0.05 + 0.85 * sigmoid((p.age - 66) / 6) ? 'No' : 'Yes';
  // Weekly exercise (minutes, from a wearable): less with age and frailty, less again offline.
  const ex = 175 - 1.6 * (p.age - 47) - 22 * p.frailty + normal(0, 70) - (p.internet === 'No' ? 45 : 0);
  p.exercise = roundTo(clamp(ex, 0, 480), 5);
  // Alcohol: a third don't drink, the rest are skewed with a heavy tail.
  p.drinks = rand() < 0.32 ? 0 : Math.round(clamp(Math.exp(normal(1.75, 0.65)), 1, 40));
  p.heart = rand() < sigmoid(-2.9 + 0.06 * (p.age - 47) + 0.03 * (p.bp - 135)) ? 'Yes' : 'No';
  // Fast-food meals per week ten years ago (from an old food diary): a small true link to heart disease.
  p.fastFood = roundTo(clamp(normal(2.1 + (p.heart === 'Yes' ? 0.45 : 0), 1.1), 0, 7), 0.1);
  p.steps = roundTo(clamp(normal(7200, 2400) - 45 * (p.age - 47) - 500 * p.frailty, 900, 16000), 50);
}

// ---------------------------------------------------------------------------
// Who gets sampled / how they respond

const argBy = (rows, key, sign) =>
  rows.reduce((best, p) => (sign * p[key] > sign * best[key] ? p : best), rows[0]);
/** The people at a field's extremes, so a filtered sample keeps the same axis. */
const extremes = (rows, key) => [argBy(rows, key, -1), argBy(rows, key, 1)];

// Convenience: whoever is in the clinic waiting room that morning (older, sicker).
const waiting = new Set(
  weightedSample(
    people.map((p) => Math.exp(1.1 * p.frailty + 0.03 * (p.bp - 135))),
    88,
  ),
);
for (const p of extremes(people, 'bp')) waiting.add(p.i);
for (const p of people) p.waiting = waiting.has(p.i) ? 'Yes' : 'No';

// Voluntary response: an online "rate our new hours" poll. Strong feelings reply.
for (const p of people) {
  const s = p.satisfaction;
  const prob = s <= 2 ? 0.45 : s <= 4 ? 0.2 : s >= 10 ? 0.16 : s >= 9 ? 0.08 : 0.02;
  p.volunteered = rand() < prob ? 'Yes' : 'No';
}
for (const p of extremes(people, 'satisfaction')) p.volunteered = 'Yes';

// Under-coverage: the extremes of exercise both have internet access.
for (const p of extremes(people, 'exercise')) p.internet = 'Yes';

// Non-response: a random 300 are mailed a survey; heavy drinkers rarely send it back.
const mailed = new Set(shuffle(people.map((p) => p.i)).slice(0, 300));
for (const p of people) {
  if (!mailed.has(p.i)) p.mail = 'Not mailed';
  else p.mail = rand() < clamp(0.78 - 0.05 * p.drinks, 0.08, 0.9) ? 'Returned' : 'Not returned';
}
for (const p of extremes(
  people.filter((p) => p.mail !== 'Not mailed'),
  'drinks',
))
  p.mail = 'Returned';

// Response values: biased versions of the truth, clamped to the true range, with the
// people at the true extremes answering honestly (so each pair shares an axis).
function biased(rows, trueKey, outKey, fn, step = 1) {
  const lo = Math.min(...rows.map((p) => p[trueKey]));
  const hi = Math.max(...rows.map((p) => p[trueKey]));
  const honest = new Set(extremes(rows, trueKey).map((p) => p.i));
  for (const p of rows) p[outKey] = honest.has(p.i) ? p[trueKey] : clamp(roundTo(fn(p), step), lo, hi);
}

// Measurement: half the town is measured with a cuff that reads ~10 mmHg high.
for (const p of people) p.cuff = rand() < 0.5 ? 'Faulty cuff' : 'Calibrated cuff';
biased(people, 'bp', 'bpMeasured', (p) => p.bp + (p.cuff === 'Faulty cuff' ? 10 : 0) + normal(0, 1.5));

// Social desirability: people over-report exercise, low exercisers most of all.
biased(
  people,
  'exercise',
  'exerciseReported',
  (p) => p.exercise + 70 * (1 - p.exercise / 480) + normal(0, 15),
  5,
);

// Recall: heart patients search their memory hard; others forget and under-report.
biased(
  people,
  'fastFood',
  'fastFoodRecalled',
  (p) => p.fastFood + (p.heart === 'Yes' ? normal(1.5, 0.6) : -normal(0.7, 0.35)),
  0.1,
);

// Observer: 240 join a trial of a drug that does nothing; an unblinded doctor rates improvement.
const trial = shuffle(people.map((p) => p.i)).slice(0, 240);
trial.forEach((i, k) => (people[i].arm = k % 2 === 0 ? 'New drug' : 'Placebo'));
for (const p of people) {
  p.arm ??= 'Not in trial';
  p.improvement = p.arm === 'Not in trial' ? '' : roundTo(clamp(normal(4.6, 1.6), 0, 10), 0.1);
}
const inTrial = people.filter((p) => p.arm !== 'Not in trial');
biased(
  inTrial,
  'improvement',
  'improvementRated',
  // The drug's imagined benefit shrinks near the top of the scale (little room left to improve).
  (p) =>
    p.improvement +
    (p.arm === 'New drug' ? 2.6 * (1 - p.improvement / 10) + normal(0, 0.4) : normal(-0.3, 0.4)),
  0.1,
);
for (const p of people) if (p.arm === 'Not in trial') p.improvementRated = '';

// Hawthorne: during a study week everyone knows their steps are watched, and walks more.
biased(people, 'steps', 'stepsStudy', (p) => p.steps + 2600 * (1 - p.steps / 16000) + normal(0, 250), 50);

// Interviewer: two interviewers, randomly assigned. A's disapproving tone draws more under-reporting.
// Stratified: residents are paired by true drinking, and each pair split at random.
[...people]
  .sort((a, b) => a.drinks - b.drinks || a.i - b.i)
  .forEach((p, k, sorted) => {
    if (k % 2) return;
    const [first, second] =
      rand() < 0.5 ? ['Interviewer A', 'Interviewer B'] : ['Interviewer B', 'Interviewer A'];
    p.interviewer = first;
    if (sorted[k + 1]) sorted[k + 1].interviewer = second;
  });
biased(people, 'drinks', 'drinksReported', (p) =>
  p.interviewer === 'Interviewer A' ? p.drinks * 0.5 : p.drinks * 0.92,
);

// Activity levels (true values), used to colour the self-report and Hawthorne slides.
for (const p of people) {
  p.exerciseLevel = p.exercise < 90 ? 'Low' : p.exercise <= 240 ? 'Moderate' : 'High';
  p.activity = p.steps < 5000 ? 'Low' : p.steps < 10000 ? 'Moderate' : 'High';
}

// ---------------------------------------------------------------------------
// Dataset

// Field names double as axis and legend titles, so they are written for the audience.
const F = {
  resident: 'Resident',
  age: 'Age',
  ageGroup: 'Age group',
  bp: 'Systolic BP (mmHg)',
  waiting: 'In the waiting room',
  rating: 'Rating of new clinic hours (0–10)',
  poll: 'Answered the online poll',
  internet: 'Internet access',
  exercise: 'Exercise (min / week)',
  exerciseLevel: 'Exercise level',
  mail: 'Mailed survey',
  drinks: 'Drinks per week',
  cuff: 'BP cuff',
  bpMeasured: 'Measured BP (mmHg)',
  exerciseReported: 'Reported exercise (min / week)',
  heart: 'Heart disease',
  fastFood: 'Fast-food meals / week (diary)',
  fastFoodRecalled: 'Fast-food meals / week (recalled)',
  arm: 'Trial group',
  improvement: 'True improvement (0–10)',
  improvementRated: 'Doctor’s rating of improvement (0–10)',
  steps: 'Steps / day (usual)',
  activity: 'Usual activity',
  stepsStudy: 'Steps / day (study week)',
  interviewer: 'Interviewer',
  drinksReported: 'Reported drinks per week',
};
const COLUMNS = [
  [F.resident, 'text', (p) => p.id],
  [F.age, 'quantitative', (p) => p.age],
  [F.ageGroup, 'categorical', (p) => p.ageGroup],
  [F.bp, 'quantitative', (p) => p.bp],
  [F.waiting, 'categorical', (p) => p.waiting],
  [F.rating, 'quantitative', (p) => p.satisfaction],
  [F.poll, 'categorical', (p) => p.volunteered],
  [F.internet, 'categorical', (p) => p.internet],
  [F.exercise, 'quantitative', (p) => p.exercise],
  [F.exerciseLevel, 'categorical', (p) => p.exerciseLevel],
  [F.mail, 'categorical', (p) => p.mail],
  [F.drinks, 'quantitative', (p) => p.drinks],
  [F.cuff, 'categorical', (p) => p.cuff],
  [F.bpMeasured, 'quantitative', (p) => p.bpMeasured],
  [F.exerciseReported, 'quantitative', (p) => p.exerciseReported],
  [F.heart, 'categorical', (p) => p.heart],
  [F.fastFood, 'quantitative', (p) => p.fastFood],
  [F.fastFoodRecalled, 'quantitative', (p) => p.fastFoodRecalled],
  [F.arm, 'categorical', (p) => p.arm],
  [F.improvement, 'quantitative', (p) => p.improvement],
  [F.improvementRated, 'quantitative', (p) => p.improvementRated],
  [F.steps, 'quantitative', (p) => p.steps],
  [F.activity, 'categorical', (p) => p.activity],
  [F.stepsStudy, 'quantitative', (p) => p.stepsStudy],
  [F.interviewer, 'categorical', (p) => p.interviewer],
  [F.drinksReported, 'quantitative', (p) => p.drinksReported],
];
const dataset = {
  id: 'riverton-bias',
  name: 'Riverton health (synthetic)',
  source: 'upload',
  columns: COLUMNS.map((c) => c[0]),
  rows: people.map((p) => Object.fromEntries(COLUMNS.map(([name, , get]) => [name, String(get(p))]))),
};
const fieldOverrides = Object.fromEntries(COLUMNS.map(([name, type]) => [name, type]));

// ---------------------------------------------------------------------------
// Stats + checks

const mean = (rows, key) => rows.reduce((s, p) => s + Number(p[key]), 0) / rows.length;
const f1 = (v) => (Math.round(v * 10) / 10).toLocaleString('en-US');
const f0 = (v) => Math.round(v).toLocaleString('en-US');
const where = (key, value) => people.filter((p) => p[key] === value);
const niceDomain = (rows, key) => {
  const vs = rows.map((p) => Number(p[key]));
  return scaleLinear()
    .domain([Math.min(...vs), Math.max(...vs)])
    .nice()
    .domain()
    .join('–');
};
const failures = [];
function check(label, ok) {
  if (!ok) failures.push(label);
}
function sameAxis(label, rowsA, keyA, rowsB, keyB) {
  const a = niceDomain(rowsA, keyA);
  const b = niceDomain(rowsB, keyB);
  check(`${label}: axis ${a} vs ${b}`, a === b);
}

const S = {};
S.bpTown = mean(people, 'bp');
S.bpWaiting = mean(where('waiting', 'Yes'), 'bp');
S.nWaiting = where('waiting', 'Yes').length;
S.satTown = mean(people, 'satisfaction');
S.satPoll = mean(where('volunteered', 'Yes'), 'satisfaction');
S.nPoll = where('volunteered', 'Yes').length;
S.exTown = mean(people, 'exercise');
S.exOnline = mean(where('internet', 'Yes'), 'exercise');
S.nOffline = where('internet', 'No').length;
S.offline65 = where('internet', 'No').filter((p) => p.age >= 65).length;
const mailedRows = people.filter((p) => p.mail !== 'Not mailed');
S.drinksMailed = mean(mailedRows, 'drinks');
S.drinksReturned = mean(where('mail', 'Returned'), 'drinks');
S.nReturned = where('mail', 'Returned').length;
S.drinksTown = mean(people, 'drinks');
S.bpCalTrue = mean(where('cuff', 'Calibrated cuff'), 'bp');
S.bpFaultyTrue = mean(where('cuff', 'Faulty cuff'), 'bp');
S.bpCalMeas = mean(where('cuff', 'Calibrated cuff'), 'bpMeasured');
S.bpFaultyMeas = mean(where('cuff', 'Faulty cuff'), 'bpMeasured');
S.bpMeasTown = mean(people, 'bpMeasured');
S.exReported = mean(people, 'exerciseReported');
S.ffHeartTrue = mean(where('heart', 'Yes'), 'fastFood');
S.ffOtherTrue = mean(where('heart', 'No'), 'fastFood');
S.ffHeartRecall = mean(where('heart', 'Yes'), 'fastFoodRecalled');
S.ffOtherRecall = mean(where('heart', 'No'), 'fastFoodRecalled');
S.nHeart = where('heart', 'Yes').length;
S.impDrugTrue = mean(where('arm', 'New drug'), 'improvement');
S.impPlaceboTrue = mean(where('arm', 'Placebo'), 'improvement');
S.impDrugRated = mean(where('arm', 'New drug'), 'improvementRated');
S.impPlaceboRated = mean(where('arm', 'Placebo'), 'improvementRated');
S.stepsUsual = mean(people, 'steps');
S.stepsStudy = mean(people, 'stepsStudy');
S.drinksATrue = mean(where('interviewer', 'Interviewer A'), 'drinks');
S.drinksBTrue = mean(where('interviewer', 'Interviewer B'), 'drinks');
S.drinksARep = mean(where('interviewer', 'Interviewer A'), 'drinksReported');
S.drinksBRep = mean(where('interviewer', 'Interviewer B'), 'drinksReported');

check('convenience shift', S.bpWaiting - S.bpTown >= 6);
check('voluntary shift', S.satTown - S.satPoll >= 1.5);
check('under-coverage shift', S.exOnline - S.exTown >= 8);
check('non-response shift', S.drinksMailed - S.drinksReturned >= 1);
check('measurement shift', S.bpFaultyMeas - S.bpFaultyTrue >= 8);
check('social desirability shift', S.exReported - S.exTown >= 25);
check('recall: true gap small', S.ffHeartTrue - S.ffOtherTrue < 1);
check('recall: recalled gap large', S.ffHeartRecall - S.ffOtherRecall >= 2);
check('observer: no true effect', Math.abs(S.impDrugTrue - S.impPlaceboTrue) < 0.6);
check('observer: rated effect', S.impDrugRated - S.impPlaceboRated >= 1.5);
check('hawthorne shift', S.stepsStudy - S.stepsUsual >= 1000);
check('interviewer: true equal', Math.abs(S.drinksATrue - S.drinksBTrue) < 1);
check('interviewer: reported gap', S.drinksBRep - S.drinksARep >= 1.5);

sameAxis('convenience', people, 'bp', where('waiting', 'Yes'), 'bp');
sameAxis('voluntary', people, 'satisfaction', where('volunteered', 'Yes'), 'satisfaction');
sameAxis('under-coverage', people, 'exercise', where('internet', 'Yes'), 'exercise');
sameAxis('non-response', mailedRows, 'drinks', where('mail', 'Returned'), 'drinks');
sameAxis('measurement', people, 'bp', people, 'bpMeasured');
sameAxis('social desirability', people, 'exercise', people, 'exerciseReported');
sameAxis('recall', people, 'fastFood', people, 'fastFoodRecalled');
sameAxis('observer', inTrial, 'improvement', inTrial, 'improvementRated');
sameAxis('hawthorne', people, 'steps', people, 'stepsStudy');
sameAxis('interviewer', people, 'drinks', people, 'drinksReported');

// ---------------------------------------------------------------------------
// Slides

let nextId = 0;
const id = (prefix) => `${prefix}-${++nextId}`;

// Content slides zoom the chart out and to the left, leaving a text panel on the right.
const CAMERA = { cx: 0.62, cy: 0.5, k: 0.8 };
const PANEL = { x: 884, y: 168 };

/**
 * Plot-area coordinates (what a free note stores) for a point on screen, given the
 * slide's camera and whether a legend is shown (it narrows the plot area).
 */
function plotPoint(screenX, screenY, camera, legend) {
  const left = 48;
  const right = legend ? 200 : 48;
  const top = 108;
  const bottom = 84;
  const wx = camera.cx * FRAME.width + (screenX - FRAME.width / 2) / camera.k;
  const wy = camera.cy * FRAME.height + (screenY - FRAME.height / 2) / camera.k;
  return {
    x: Math.round(((wx - left) / (FRAME.width - left - right)) * 10000) / 10000,
    y: Math.round(((wy - top) / (FRAME.height - top - bottom)) * 10000) / 10000,
  };
}

/** A plain text box whose top-left corner sits at a screen position. */
function textBox(at, title, text, fontSize = 18) {
  return {
    id: id('note'),
    anchor: { kind: 'free', ...at, space: 'plot' },
    dx: 0,
    dy: 0,
    title,
    text,
    style: 'text',
    fontSize,
    frame: { ...FRAME },
  };
}
const panel = (title, text) => textBox(plotPoint(PANEL.x, PANEL.y, CAMERA, true), title, text);
const exclude = (field, ...values) => ({ id: id('filter'), kind: 'categorical', field, exclude: values });

function slide({
  title,
  caption,
  layout,
  color,
  filters = [],
  notes = [],
  reference = 'mean',
  camera = CAMERA,
}) {
  return {
    id: id('slide'),
    frame: { ...FRAME },
    thumbnail: null,
    view: {
      layout,
      encoding: { color: color ?? null, size: null },
      filters,
      annotations: notes,
      camera: { ...camera },
      title,
      caption,
      overlap: false,
      ...(reference ? { reference } : {}),
    },
  };
}
const oneD = (field) => ({ mode: '1d', field });
const strip = (x, y) => ({ mode: '2d', x, y });
const pct = (n, d) => `${Math.round((100 * n) / d)}%`;

const slides = [
  slide({
    title: 'Who’s in the data — and what they tell you',
    caption: 'Sampling bias and response bias, one resident at a time',
    layout: { mode: 'cluster' },
    color: F.ageGroup,
    reference: null,
    notes: [
      panel(
        'Meet Riverton: 1,000 residents',
        'Each bubble is one person. Unlike in real life, we know the truth about every one of them.\n\nSo we can watch each kind of bias pull an estimate away from that truth.\n\nSampling bias: who ends up in the data.\nResponse bias: what they tell us.',
      ),
    ],
  }),

  // --- Sampling bias -------------------------------------------------------
  slide({
    title: 'Convenience sampling · 1 of 2',
    caption: 'Sampling whoever is easiest to reach',
    layout: oneD(F.bp),
    color: F.waiting,
    notes: [
      panel(
        `Town average: ${f1(S.bpTown)} mmHg`,
        `To estimate Riverton’s blood pressure, a nurse measures the ${S.nWaiting} people sitting in the clinic waiting room one morning (orange).`,
      ),
    ],
  }),
  slide({
    title: 'Convenience sampling · 2 of 2',
    caption: 'The easiest people to reach are not typical',
    layout: oneD(F.bp),
    color: F.waiting,
    filters: [exclude(F.waiting, 'No')],
    notes: [
      panel(
        `Waiting room: ${f1(S.bpWaiting)} mmHg`,
        `${f1(S.bpWaiting - S.bpTown)} mmHg too high. People at a clinic are older and sicker than the town as a whole.\n\nFix: a random sample of the whole town.`,
      ),
    ],
  }),
  slide({
    title: 'Voluntary response · 1 of 2',
    caption: 'People choose themselves to be in the sample',
    layout: oneD(F.rating),
    color: F.poll,
    notes: [
      panel(
        `Town average: ${f1(S.satTown)} / 10`,
        `The clinic posts an online poll: “Rate our new opening hours.” ${S.nPoll} people choose to answer (orange).`,
      ),
    ],
  }),
  slide({
    title: 'Voluntary response · 2 of 2',
    caption: 'Strong feelings — especially negative ones — get people to respond',
    layout: oneD(F.rating),
    color: F.poll,
    filters: [exclude(F.poll, 'No')],
    notes: [
      panel(
        `Poll average: ${f1(S.satPoll)} / 10`,
        `The poll says the hours are unpopular. The angry (and a few delighted) speak up; the content majority stays quiet.\n\nFix: pick respondents at random — don’t let them pick themselves.`,
      ),
    ],
  }),
  slide({
    title: 'Under-coverage · 1 of 2',
    caption: 'Part of the population has no chance of being sampled',
    layout: oneD(F.exercise),
    color: F.internet,
    notes: [
      panel(
        `Town average: ${f0(S.exTown)} min a week`,
        `A health survey is run online. The ${S.nOffline} residents without internet (grey) — ${pct(S.offline65, S.nOffline)} of them over 65 — can never be sampled.`,
      ),
    ],
  }),
  slide({
    title: 'Under-coverage · 2 of 2',
    caption: 'The sampling frame (internet users) is not the population',
    layout: oneD(F.exercise),
    color: F.internet,
    filters: [exclude(F.internet, 'No')],
    notes: [
      panel(
        `Online average: ${f0(S.exOnline)} min a week`,
        `Even a perfectly random online sample overstates exercise: the people it can’t reach are older and less active.\n\nFix: a sampling frame that covers everyone (mail, phone, in person).`,
      ),
    ],
  }),
  slide({
    title: 'Non-response bias · 1 of 2',
    caption: 'A random sample is chosen — but not everyone in it answers',
    layout: oneD(F.drinks),
    color: F.mail,
    filters: [exclude(F.mail, 'Not mailed')],
    notes: [
      panel(
        `Random 300: ${f1(S.drinksMailed)} drinks a week`,
        `300 residents chosen at random are mailed an alcohol survey. That sample is fair (the town average is ${f1(S.drinksTown)}).\n\nBut only the orange ones send it back.`,
      ),
    ],
  }),
  slide({
    title: 'Non-response bias · 2 of 2',
    caption: 'The people who don’t answer differ from those who do',
    layout: oneD(F.drinks),
    color: F.mail,
    filters: [exclude(F.mail, 'Not mailed', 'Not returned')],
    notes: [
      panel(
        `Returned: ${f1(S.drinksReturned)} drinks a week`,
        `Only ${S.nReturned} of 300 reply, and heavy drinkers are the least likely to. A random start doesn’t help if the replies aren’t random.\n\nFix: follow up non-responders; keep surveys short.`,
      ),
    ],
  }),

  // --- Response bias -------------------------------------------------------
  slide({
    title: 'Measurement bias · 1 of 2',
    caption: 'The measuring instrument itself is wrong',
    layout: strip(F.bp, F.cuff),
    color: F.cuff,
    notes: [
      panel(
        `True BP: ${f1(S.bpFaultyTrue)} vs ${f1(S.bpCalTrue)}`,
        'Half the town is measured with a blood-pressure cuff that is out of calibration (orange). Their true pressures are the same as everyone else’s.',
      ),
    ],
  }),
  slide({
    title: 'Measurement bias · 2 of 2',
    caption: 'Every reading is pushed the same way',
    layout: strip(F.bpMeasured, F.cuff),
    color: F.cuff,
    notes: [
      panel(
        `Measured: ${f1(S.bpFaultyMeas)} vs ${f1(S.bpCalMeas)}`,
        'The faulty cuff adds about 10 mmHg to every reading. A bigger sample won’t help — it just measures the wrong value more precisely.\n\nFix: calibrate and check instruments against a standard.',
      ),
    ],
  }),
  slide({
    title: 'Social desirability bias · 1 of 2',
    caption: 'People give the answer that makes them look good',
    layout: oneD(F.exercise),
    color: F.exerciseLevel,
    notes: [
      panel(
        `Actual: ${f0(S.exTown)} min a week`,
        'Exercise measured by a wrist tracker. Now we simply ask: “How many minutes did you exercise last week?”',
      ),
    ],
  }),
  slide({
    title: 'Social desirability bias · 2 of 2',
    caption: 'Good behaviour is over-reported; bad behaviour is under-reported',
    layout: oneD(F.exerciseReported),
    color: F.exerciseLevel,
    notes: [
      panel(
        `Reported: ${f0(S.exReported)} min a week`,
        'Everyone drifts right, and the least active (orange) exaggerate the most.\n\nFix: anonymous questions, neutral wording, objective measures.',
      ),
    ],
  }),
  slide({
    title: 'Recall bias · 1 of 2',
    caption: 'Some groups remember the past better than others',
    layout: strip(F.fastFood, F.heart),
    color: F.heart,
    notes: [
      panel(
        `Diary: ${f1(S.ffHeartTrue)} vs ${f1(S.ffOtherTrue)} meals`,
        `Fast-food meals a week ten years ago, from old food diaries. The ${S.nHeart} heart patients (orange) really did eat a little more.`,
      ),
    ],
  }),
  slide({
    title: 'Recall bias · 2 of 2',
    caption: 'Patients search their memory for a cause; healthy people forget',
    layout: strip(F.fastFoodRecalled, F.heart),
    color: F.heart,
    notes: [
      panel(
        `Recalled: ${f1(S.ffHeartRecall)} vs ${f1(S.ffOtherRecall)} meals`,
        'Asked to remember instead, patients over-recall and everyone else under-recalls. A small real difference now looks huge.\n\nFix: use records made at the time.',
      ),
    ],
  }),
  slide({
    title: 'Observer bias · 1 of 2',
    caption: 'What researchers expect to see shapes what they record',
    layout: strip(F.improvement, F.arm),
    color: F.arm,
    filters: [exclude(F.arm, 'Not in trial')],
    notes: [
      panel(
        `True: ${f1(S.impDrugTrue)} vs ${f1(S.impPlaceboTrue)}`,
        '240 patients get either a new drug (orange) or a placebo. The drug does nothing: both groups improve the same.',
      ),
    ],
  }),
  slide({
    title: 'Observer bias · 2 of 2',
    caption: 'The doctor knows who got the drug — and expects it to work',
    layout: strip(F.improvementRated, F.arm),
    color: F.arm,
    filters: [exclude(F.arm, 'Not in trial')],
    notes: [
      panel(
        `Doctor’s rating: ${f1(S.impDrugRated)} vs ${f1(S.impPlaceboRated)}`,
        'Rating patients they know got the drug, the doctor sees an effect that isn’t there.\n\nFix: blinding — neither patient nor assessor knows who got what.',
      ),
    ],
  }),
  slide({
    title: 'The Hawthorne effect · 1 of 2',
    caption: 'People change their behaviour when they know they’re being studied',
    layout: oneD(F.steps),
    color: F.activity,
    notes: [
      panel(
        `Usual: ${f0(S.stepsUsual)} steps a day`,
        'Everyone’s normal daily steps, from their phones. Then the clinic announces a “step study” and hands out trackers for a week…',
      ),
    ],
  }),
  slide({
    title: 'The Hawthorne effect · 2 of 2',
    caption: 'Being watched is itself a treatment',
    layout: oneD(F.stepsStudy),
    color: F.activity,
    notes: [
      panel(
        `Study week: ${f0(S.stepsStudy)} steps a day`,
        `Nobody lied: they really walked ${f0(S.stepsStudy - S.stepsUsual)} more steps a day — because they were being watched.\n\nFix: a control group observed the same way; longer, unobtrusive measurement.`,
      ),
    ],
  }),
  slide({
    title: 'Interviewer bias · 1 of 2',
    caption: 'Who asks the question — and how — changes the answer',
    layout: strip(F.drinks, F.interviewer),
    color: F.interviewer,
    notes: [
      panel(
        `True: ${f1(S.drinksATrue)} vs ${f1(S.drinksBTrue)} drinks`,
        'Each resident is interviewed by A or B at random, so the two groups drink about the same.',
      ),
    ],
  }),
  slide({
    title: 'Interviewer bias · 2 of 2',
    caption: 'Interviewer A frowns at the answers; interviewer B stays neutral',
    layout: strip(F.drinksReported, F.interviewer),
    color: F.interviewer,
    notes: [
      panel(
        `Reported: ${f1(S.drinksARep)} vs ${f1(S.drinksBRep)} drinks`,
        'Same kind of people, different interviewer, different data.\n\nFix: trained interviewers with a script; self-completed answers for sensitive questions.',
      ),
    ],
  }),

  // --- Wrap-up -------------------------------------------------------------
  slide({
    title: 'Guarding against bias',
    caption: 'A bigger sample doesn’t fix bias — a better design does',
    layout: { mode: 'cluster' },
    reference: null,
    camera: { cx: 0.5, cy: 0.5, k: 1 },
    filters: [{ id: id('filter'), kind: 'rows', mode: 'include', rows: [] }],
    notes: [
      textBox(
        plotPoint(48, 140, { cx: 0.5, cy: 0.5, k: 1 }, false),
        'Sampling bias — who’s in the data',
        '• Convenience → random sampling\n• Voluntary response → choose people at random\n• Under-coverage → a frame that includes everyone\n• Non-response → follow up; keep it short',
        20,
      ),
      textBox(
        plotPoint(660, 140, { cx: 0.5, cy: 0.5, k: 1 }, false),
        'Response bias — what they tell you',
        '• Measurement → calibrate instruments\n• Social desirability → anonymous, neutral questions\n• Recall → records made at the time\n• Observer → blinding\n• Hawthorne → an observed control group\n• Interviewer → training, scripts, self-completion',
        20,
      ),
    ],
  }),
];

// ---------------------------------------------------------------------------
// Colours: the sampled / affected group in orange, the rest grey or blue.

const ORANGE = '#eb6834';
const GREY = '#a3a29c';
const BLUE = '#2a78d6';
const GREEN = '#1baf7a';
const categoryColors = {
  [F.waiting]: { Yes: ORANGE, No: GREY },
  [F.poll]: { Yes: ORANGE, No: GREY },
  [F.internet]: { Yes: ORANGE, No: GREY },
  [F.mail]: { Returned: ORANGE, 'Not returned': GREY, 'Not mailed': GREY },
  [F.cuff]: { 'Faulty cuff': ORANGE, 'Calibrated cuff': BLUE },
  [F.exerciseLevel]: { Low: ORANGE, Moderate: BLUE, High: GREEN },
  [F.heart]: { Yes: ORANGE, No: BLUE },
  [F.arm]: { 'New drug': ORANGE, Placebo: BLUE, 'Not in trial': GREY },
  [F.activity]: { Low: ORANGE, Moderate: BLUE, High: GREEN },
  [F.interviewer]: { 'Interviewer A': ORANGE, 'Interviewer B': BLUE },
};

const deck = {
  format: 'datadeck',
  version: 1,
  name: 'Sampling & response bias',
  dataset,
  fieldOverrides,
  categoryColors,
  slides,
};

console.table(
  Object.fromEntries(
    Object.entries(S).map(([k, v]) => [k, Number.isInteger(v) ? v : Math.round(v * 100) / 100]),
  ),
);
if (failures.length) {
  console.error('Checks failed:\n  ' + failures.join('\n  '));
  process.exit(1);
}
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(deck));
console.log(`Wrote ${OUT} (${slides.length} slides, ${N} residents)`);
