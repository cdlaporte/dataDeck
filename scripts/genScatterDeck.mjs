// Builds examples/scatter-plots.datadeck.json: "Describing scatter plots", a deck
// for an intro stats class. One fake class of students with many columns, each
// pair built to show one property: direction, strength, form, outliers, clusters.
// Quiz slides show only the plot; the reveal that follows keeps the same layout
// (the bubbles stay put) and adds the trend line and the answer.
//
//   node scripts/genScatterDeck.mjs
//
// Deterministic (seeded). Correlations are constructed to hit their targets, and
// the script checks every number it prints on a slide.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'examples', 'scatter-plots.datadeck.json');
const N = 180;
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
const rand = mulberry32(20261120);
const normal = (mu = 0, sd = 1) => {
  const u = 1 - rand();
  const v = rand();
  return mu + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
const uniform = (lo, hi) => lo + (hi - lo) * rand();
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const roundTo = (v, step) => Number((Math.round(v / step) * step).toFixed(4));

// ---------------------------------------------------------------------------
// Statistics

const mean = (xs) => xs.reduce((s, v) => s + v, 0) / xs.length;
function pearson(xs, ys) {
  const mx = mean(xs);
  const my = mean(ys);
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let i = 0; i < xs.length; i++) {
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
    sxy += (xs[i] - mx) * (ys[i] - my);
  }
  return sxy / Math.sqrt(sxx * syy);
}
function slopeOf(xs, ys) {
  const mx = mean(xs);
  const my = mean(ys);
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < xs.length; i++) {
    sxx += (xs[i] - mx) ** 2;
    sxy += (xs[i] - mx) * (ys[i] - my);
  }
  return sxy / sxx;
}

/**
 * y = my + b·(x − mx) + e, with the noise e made exactly uncorrelated with x and
 * scaled so the correlation is exactly `r` before rounding.
 */
function correlated(xs, r, yMean, ySd) {
  const n = xs.length;
  const mx = mean(xs);
  const sx = Math.sqrt(mean(xs.map((x) => (x - mx) ** 2)));
  let e = xs.map(() => normal());
  const me = mean(e);
  e = e.map((v) => v - me);
  // Remove the part of e explained by x.
  const beta = e.reduce((s, v, i) => s + v * (xs[i] - mx), 0) / xs.reduce((s, x) => s + (x - mx) ** 2, 0);
  e = e.map((v, i) => v - beta * (xs[i] - mx));
  const se = Math.sqrt(mean(e.map((v) => v * v)));
  const noiseSd = ySd * Math.sqrt(1 - r * r);
  const b = (r * ySd) / sx;
  return Array.from({ length: n }, (_, i) => yMean + b * (xs[i] - mx) + (e[i] / se) * noiseSd);
}

const failures = [];
function check(label, ok) {
  if (!ok) failures.push(label);
}
const fmt2 = (v) => {
  const s = (Math.abs(v) < 0.005 ? 0 : v).toFixed(2);
  return s.startsWith('-') ? `−${s.slice(1)}` : s;
};

// ---------------------------------------------------------------------------
// The class

const idx = Array.from({ length: N }, (_, i) => i);
const col = {};

// Explanatory → response pairs, each built for one lesson.
col.studyHours = idx.map(() => roundTo(clamp(normal(8, 3.2), 0.5, 18), 0.5));
col.examScore = correlated(col.studyHours, 0.8, 72, 10).map((v) => Math.round(clamp(v, 0, 100)));

col.practiceTest = idx.map(() => Math.round(clamp(normal(68, 12), 30, 98)));
col.finalExam = correlated(col.practiceTest, 0.95, 70, 12).map((v) => Math.round(clamp(v, 0, 100)));

col.homework = idx.map(() => Math.round(clamp(normal(75, 14), 30, 100)));
col.unitTest = correlated(col.homework, 0.6, 74, 10).map((v) => Math.round(clamp(v, 0, 100)));

col.absences = idx.map(() => Math.round(clamp(Math.abs(normal(0, 5)) + rand() * 2, 0, 22)));
col.courseGrade = correlated(col.absences, -0.7, 78, 9).map((v) => Math.round(clamp(v, 0, 100)));

col.screenTime = idx.map(() => roundTo(clamp(normal(4.5, 1.8), 0.5, 10), 0.5));
col.gpa = correlated(col.screenTime, -0.25, 3.0, 0.45).map((v) => roundTo(clamp(v, 1.2, 4), 0.01));

// No relationship: birthdays, reshuffled (deterministically) until r ≈ 0.
col.birthday = idx.map(() => 1 + Math.floor(rand() * 28));
for (let k = 0; k < 500 && Math.abs(pearson(col.birthday, col.examScore)) > 0.02; k++) {
  const a = Math.floor(rand() * N);
  const b = Math.floor(rand() * N);
  [col.birthday[a], col.birthday[b]] = [col.birthday[b], col.birthday[a]];
}

// Curved: diminishing returns.
col.problems = idx.map(() => Math.round(uniform(0, 120)));
col.quizScore = col.problems.map((p) =>
  Math.round(clamp(42 + 52 * (1 - Math.exp(-p / 28)) + normal(0, 2.6), 0, 100)),
);

// Inverted U: too little or too much sleep.
// Symmetric around 8 hours by construction (each value has a mirror image), so r ≈ 0.
col.sleep = idx.map((i) => (i % 2 === 0 ? roundTo(uniform(4.5, 11.5), 0.25) : 0));
for (let i = 1; i < N; i += 2) col.sleep[i] = 16 - col.sleep[i - 1];
col.testScore = col.sleep.map((s) => Math.round(clamp(90 - 5.2 * (s - 8) ** 2 + normal(0, 3), 0, 100)));

// In-line outlier: one avid reader, far out but right on the line.
col.reading = idx.map(() => Math.round(clamp(normal(28, 10), 5, 55)));
col.vocab = correlated(col.reading, 0.5, 55, 7).map((v) => Math.round(v));
const INLINE = 7;
{
  const others = idx.filter((i) => i !== INLINE);
  const b = slopeOf(
    others.map((i) => col.reading[i]),
    others.map((i) => col.vocab[i]),
  );
  const mx = mean(others.map((i) => col.reading[i]));
  const my = mean(others.map((i) => col.vocab[i]));
  col.reading[INLINE] = 200;
  col.vocab[INLINE] = Math.round(my + b * (200 - mx));
}

// Out-of-line outlier: one student far below where the pattern predicts.
col.tutoring = idx.map(() => roundTo(clamp(normal(4.5, 2), 0, 9), 0.5));
col.mathScore = correlated(col.tutoring, 0.75, 70, 9).map((v) => Math.round(clamp(v, 0, 100)));
const OFFLINE = 23;
col.tutoring[OFFLINE] = 14;
col.mathScore[OFFLINE] = 24;

// Clusters: what students spend their afternoons on.
col.activity = idx.map((i) => (i % 3 === 0 ? 'Band' : i % 3 === 1 ? 'Sports team' : 'Neither'));
col.music = col.activity.map((a) =>
  roundTo(a === 'Band' ? clamp(normal(10, 1.6), 6, 15) : clamp(Math.abs(normal(0, 1.2)), 0, 4), 0.5),
);
col.sport = col.activity.map((a) =>
  roundTo(a === 'Sports team' ? clamp(normal(11, 1.8), 6, 16) : clamp(Math.abs(normal(0, 1.3)), 0, 4), 0.5),
);

// Quiz 1: strong negative linear.
col.work = idx.map(() => Math.round(clamp(Math.abs(normal(0, 9)) + rand() * 3, 0, 28)));
col.sleepNights = correlated(col.work, -0.85, 7.6, 0.9).map((v) => roundTo(clamp(v, 4, 10), 0.1));

// Quiz 2: moderate positive with one out-of-line outlier.
col.funReading = idx.map(() => roundTo(clamp(normal(4, 1.8), 0, 9), 0.5));
col.englishGrade = correlated(col.funReading, 0.6, 78, 7).map((v) => Math.round(clamp(v, 0, 100)));
const QUIZ_OUTLIER = 41;
col.funReading[QUIZ_OUTLIER] = 6.5;
col.englishGrade[QUIZ_OUTLIER] = 32;

// Quiz 3: positive, in clusters by how students get to school.
col.commuteMode = idx.map(() => {
  const u = rand();
  return u < 0.36 ? 'Walk' : u < 0.7 ? 'Bus' : 'Car';
});
col.distance = col.commuteMode.map((m) =>
  roundTo(m === 'Walk' ? uniform(0.3, 2) : m === 'Bus' ? uniform(3.5, 8) : uniform(7, 14), 0.1),
);
col.commute = col.commuteMode.map((m, i) => {
  const d = col.distance[i];
  const t = m === 'Walk' ? 12 * d + 2 : m === 'Bus' ? 14 + 3.2 * d : 6 + 1.6 * d;
  return Math.round(clamp(t + normal(0, 2.2), 2, 60));
});

col.grade = idx.map((i) => ['9', '10', '11', '12'][i % 4]);

// ---------------------------------------------------------------------------
// Dataset

const F = {
  student: 'Student',
  grade: 'Grade',
  studyHours: 'Hours studied per week',
  examScore: 'Exam score (%)',
  practiceTest: 'Practice test score (%)',
  finalExam: 'Final exam score (%)',
  homework: 'Homework completed (%)',
  unitTest: 'Unit test score (%)',
  absences: 'Days absent',
  courseGrade: 'Course grade (%)',
  screenTime: 'Screen time (hours per day)',
  gpa: 'GPA',
  birthday: 'Birthday (day of the month)',
  problems: 'Practice problems completed',
  quizScore: 'Quiz score (%)',
  sleep: 'Hours of sleep the night before',
  testScore: 'Test score (%)',
  reading: 'Minutes reading per day',
  vocab: 'Vocabulary score (points)',
  tutoring: 'Hours of tutoring per month',
  mathScore: 'Math score (%)',
  activity: 'After-school activity',
  music: 'Music practice (hours per week)',
  sport: 'Sports practice (hours per week)',
  work: 'Part-time work (hours per week)',
  sleepNights: 'Sleep (hours per night)',
  funReading: 'Reading for fun (hours per week)',
  englishGrade: 'English grade (%)',
  commuteMode: 'How they get to school',
  distance: 'Distance from school (km)',
  commute: 'Commute time (minutes)',
};
const COLUMNS = [
  [F.student, 'text', (i) => `Student ${String(i + 1).padStart(3, '0')}`],
  [F.grade, 'categorical', (i) => col.grade[i]],
  ...Object.keys(F)
    .filter((k) => k !== 'student' && k !== 'grade')
    .map((k) => [F[k], typeof col[k][0] === 'string' ? 'categorical' : 'quantitative', (i) => col[k][i]]),
];
const dataset = {
  id: 'lakeview-scatter',
  name: 'Lakeview High students (fake)',
  source: 'upload',
  columns: COLUMNS.map((c) => c[0]),
  rows: idx.map((i) => Object.fromEntries(COLUMNS.map(([name, , get]) => [name, String(get(i))]))),
};
const fieldOverrides = Object.fromEntries(COLUMNS.map(([name, type]) => [name, type]));

// ---------------------------------------------------------------------------
// Checks: the r each slide states (computed the way the app does, on the rows it shows)

const rOf = (xk, yk, rows = idx) =>
  pearson(
    rows.map((i) => col[xk][i]),
    rows.map((i) => col[yk][i]),
  );
const without = (k) => idx.filter((i) => i !== k);
const R = {
  study: rOf('studyHours', 'examScore'),
  practice: rOf('practiceTest', 'finalExam'),
  homework: rOf('homework', 'unitTest'),
  absences: rOf('absences', 'courseGrade'),
  screen: rOf('screenTime', 'gpa'),
  birthday: rOf('birthday', 'examScore'),
  problems: rOf('problems', 'quizScore'),
  sleep: rOf('sleep', 'testScore'),
  inlineWith: rOf('reading', 'vocab'),
  inlineWithout: rOf('reading', 'vocab', without(INLINE)),
  offlineWith: rOf('tutoring', 'mathScore'),
  offlineWithout: rOf('tutoring', 'mathScore', without(OFFLINE)),
  work: rOf('work', 'sleepNights'),
  funReading: rOf('funReading', 'englishGrade'),
  funReadingWithout: rOf('funReading', 'englishGrade', without(QUIZ_OUTLIER)),
  commute: rOf('distance', 'commute'),
};
const near = (v, target, tol = 0.02) => Math.abs(v - target) <= tol;
check(`study r ${R.study}`, near(R.study, 0.8));
check(`practice r ${R.practice}`, near(R.practice, 0.95));
check(`homework r ${R.homework}`, near(R.homework, 0.6));
check(`absences r ${R.absences}`, near(R.absences, -0.7));
check(`screen r ${R.screen}`, near(R.screen, -0.25));
check(`birthday r ${R.birthday}`, Math.abs(R.birthday) <= 0.03);
check(`sleep r ${R.sleep} (should be near 0)`, Math.abs(R.sleep) <= 0.12);
check(
  `in-line outlier should raise r: ${R.inlineWithout} → ${R.inlineWith}`,
  R.inlineWith - R.inlineWithout >= 0.15,
);
check(
  `out-of-line outlier should lower r: ${R.offlineWithout} → ${R.offlineWith}`,
  R.offlineWithout - R.offlineWith >= 0.2,
);
check(`work r ${R.work}`, near(R.work, -0.85));
check(
  `fun reading outlier lowers r ${R.funReadingWithout} → ${R.funReading}`,
  R.funReadingWithout - R.funReading >= 0.1,
);
const slopeInline = slopeOf(
  idx.map((i) => col.reading[i]),
  idx.map((i) => col.vocab[i]),
);
const slopeInlineWithout = slopeOf(
  without(INLINE).map((i) => col.reading[i]),
  without(INLINE).map((i) => col.vocab[i]),
);
check(
  `in-line outlier barely moves the slope ${slopeInlineWithout} → ${slopeInline}`,
  Math.abs(slopeInline / slopeInlineWithout - 1) < 0.1,
);

// ---------------------------------------------------------------------------
// Slides

let nextId = 0;
const id = (prefix) => `${prefix}-${++nextId}`;

// The chart sits left; a short text panel sits right (same camera on every content slide).
// Chosen so even a full-width plot (no legend) ends left of the panel.
const CAMERA = { cx: 0.648, cy: 0.56, k: 0.72 };
const PANEL = { x: 965, y: 150 };

/** Plot-area coordinates (what a free note stores) for a point on screen. */
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
/** A callout circling one student. */
function callout(row, title, dx, dy) {
  return {
    id: id('note'),
    anchor: { kind: 'point', row },
    dx,
    dy,
    title,
    text: '',
    fontSize: 16,
    frame: { ...FRAME },
  };
}
const dropRows = (...rows) => ({ id: id('filter'), kind: 'rows', mode: 'exclude', rows });

function slide({
  title,
  caption = '',
  layout,
  color = null,
  filters = [],
  notes = [],
  trend = false,
  camera = CAMERA,
}) {
  return {
    id: id('slide'),
    frame: { ...FRAME },
    thumbnail: null,
    view: {
      layout,
      encoding: { color, size: null },
      filters,
      annotations: notes,
      camera: { ...camera },
      title,
      caption,
      // Scatter plots: every bubble exactly on its values.
      overlap: layout.mode === '2d',
      ...(trend ? { trend: true } : {}),
    },
  };
}
/** Right-hand text panel; `legend` must match whether the slide shows a legend. */
const panel = (title, text, legend = false, fontSize = 18) =>
  textBox(plotPoint(PANEL.x, PANEL.y, CAMERA, legend), title, text, fontSize);
const scatter = (x, y) => ({ mode: '2d', x, y });

const QUIZ = {
  title: 'Describe this scatter plot',
  caption: 'Direction? Form? Strength? Any outliers or clusters?',
};

const slides = [
  slide({
    title: 'Describing scatter plots',
    caption: 'Lakeview High: 180 students (fake data)',
    layout: { mode: 'cluster' },
    color: F.grade,
    notes: [
      panel(
        'Every bubble is a student.',
        'We’ll plot two things about each student at a time and describe what we see.',
        true,
      ),
    ],
  }),
  slide({
    title: 'Explanatory and response variables',
    layout: scatter(F.studyHours, F.examScore),
    notes: [
      panel(
        'x: explanatory variable',
        'What we think explains or predicts the other one (hours studied).\n\ny: response variable\nThe outcome we measure (exam score).',
      ),
    ],
  }),
  slide({
    title: 'How to describe a scatter plot',
    layout: scatter(F.studyHours, F.examScore),
    notes: [panel('Direction · Form · Strength', 'And anything unusual: outliers and clusters.')],
  }),

  // --- Direction -----------------------------------------------------------
  slide({
    title: 'Direction: positive',
    caption: 'As x increases, y tends to increase',
    layout: scatter(F.studyHours, F.examScore),
    trend: true,
    notes: [panel('Uphill', `More study, higher scores. r = ${fmt2(R.study)}`)],
  }),
  slide({
    title: 'Direction: negative',
    caption: 'As x increases, y tends to decrease',
    layout: scatter(F.absences, F.courseGrade),
    trend: true,
    notes: [panel('Downhill', `More absences, lower grades. r = ${fmt2(R.absences)}`)],
  }),
  slide({
    title: 'Direction: none',
    caption: 'No tendency either way',
    layout: scatter(F.birthday, F.examScore),
    trend: true,
    notes: [panel('No association', `Birthdays don’t predict exam scores. r = ${fmt2(R.birthday)}`)],
  }),

  // --- Strength ------------------------------------------------------------
  slide({
    title: 'Strength: strong',
    caption: 'Points hug the line',
    layout: scatter(F.practiceTest, F.finalExam),
    trend: true,
    notes: [panel(`r = ${fmt2(R.practice)}`, 'Close to 1: a strong linear relationship.')],
  }),
  slide({
    title: 'Strength: moderate',
    caption: 'A clear trend, with plenty of scatter',
    layout: scatter(F.homework, F.unitTest),
    trend: true,
    notes: [panel(`r = ${fmt2(R.homework)}`, 'A moderate positive relationship.')],
  }),
  slide({
    title: 'Strength: weak',
    caption: 'A faint trend in a lot of noise',
    layout: scatter(F.screenTime, F.gpa),
    trend: true,
    notes: [
      panel(
        `r = ${fmt2(R.screen)}`,
        'A weak negative relationship. The sign gives the direction; the size gives the strength.',
      ),
    ],
  }),

  // --- Form ----------------------------------------------------------------
  slide({
    title: 'Form: linear',
    caption: 'The points follow a straight line',
    layout: scatter(F.practiceTest, F.finalExam),
    trend: true,
    notes: [panel('Linear', 'A straight line describes the pattern well.')],
  }),
  slide({
    title: 'Form: curved',
    caption: 'Big gains at first, then levelling off',
    layout: scatter(F.problems, F.quizScore),
    trend: true,
    notes: [panel('Non-linear', `The line misses both ends, even though r = ${fmt2(R.problems)}.`)],
  }),
  slide({
    title: 'Form: curved (both ways)',
    caption: 'Too little or too much sleep: lower scores',
    layout: scatter(F.sleep, F.testScore),
    trend: true,
    notes: [
      panel(
        `r = ${fmt2(R.sleep)}`,
        'r is near 0, yet the relationship is strong. r only measures straight-line relationships.',
      ),
    ],
  }),

  // --- Outliers ------------------------------------------------------------
  slide({
    title: 'Outliers: in line',
    caption: 'Far from the others, but right on the trend',
    layout: scatter(F.reading, F.vocab),
    trend: true,
    notes: [
      callout(INLINE, 'Outlier', -40, 80),
      panel(`With it: r = ${fmt2(R.inlineWith)}`, 'Far out in x, but where the line predicts.'),
    ],
  }),
  slide({
    title: 'Outliers: in line',
    caption: 'Remove it and see what changes',
    layout: scatter(F.reading, F.vocab),
    trend: true,
    filters: [dropRows(INLINE)],
    notes: [
      panel(
        `Without it: r = ${fmt2(R.inlineWithout)}`,
        'The line barely changes, but r drops: an in-line outlier makes the relationship look stronger.',
      ),
    ],
  }),
  slide({
    title: 'Outliers: out of line',
    caption: 'Far from where the pattern predicts',
    layout: scatter(F.tutoring, F.mathScore),
    trend: true,
    notes: [
      callout(OFFLINE, 'Outlier', -120, -60),
      panel(`With it: r = ${fmt2(R.offlineWith)}`, 'One student pulls the line down toward them.'),
    ],
  }),
  slide({
    title: 'Outliers: out of line',
    caption: 'Remove it and see what changes',
    layout: scatter(F.tutoring, F.mathScore),
    trend: true,
    filters: [dropRows(OFFLINE)],
    notes: [
      panel(
        `Without it: r = ${fmt2(R.offlineWithout)}`,
        'The line steepens and r rises: an out-of-line outlier weakens the relationship.',
      ),
    ],
  }),

  // --- Clusters ------------------------------------------------------------
  slide({
    title: 'Clusters',
    caption: 'Distinct groups of points',
    layout: scatter(F.music, F.sport),
    notes: [panel('Three groups', 'What might explain them?')],
  }),
  slide({
    title: 'Clusters',
    caption: 'Groups often point to a hidden variable',
    layout: scatter(F.music, F.sport),
    color: F.activity,
    notes: [
      panel('Band, sports, neither', 'Colour by after-school activity and the clusters make sense.', true),
    ],
  }),

  // --- Quizzes -------------------------------------------------------------
  slide({ ...QUIZ, layout: scatter(F.work, F.sleepNights) }),
  slide({
    title: 'Describe this scatter plot: answer',
    caption: QUIZ.caption,
    layout: scatter(F.work, F.sleepNights),
    trend: true,
    notes: [
      panel(
        'Negative · linear · strong',
        `More hours at work, less sleep. r = ${fmt2(R.work)}, no outliers.`,
      ),
    ],
  }),
  slide({ ...QUIZ, layout: scatter(F.funReading, F.englishGrade) }),
  slide({
    title: 'Describe this scatter plot: answer',
    caption: QUIZ.caption,
    layout: scatter(F.funReading, F.englishGrade),
    trend: true,
    notes: [
      callout(QUIZ_OUTLIER, 'Outlier', 90, -50),
      panel(
        'Positive · linear · moderate',
        `r = ${fmt2(R.funReading)}, with one out-of-line outlier (r = ${fmt2(R.funReadingWithout)} without it).`,
      ),
    ],
  }),
  slide({ ...QUIZ, layout: scatter(F.distance, F.commute) }),
  slide({
    title: 'Describe this scatter plot: answer',
    caption: QUIZ.caption,
    layout: scatter(F.distance, F.commute),
    color: F.commuteMode,
    notes: [
      panel(
        'Three clusters',
        'Walkers, bus riders and drivers. Within each group, farther means longer: positive. Overall, one line would hide the story.',
        true,
      ),
    ],
  }),

  // --- Wrap-up -------------------------------------------------------------
  slide({
    title: 'Describing a scatter plot',
    layout: { mode: 'cluster' },
    color: F.grade,
    notes: [
      panel(
        'Direction · Form · Strength',
        'Direction: positive, negative or none\nForm: linear or curved\nStrength: strong, moderate or weak (r near ±1 is strong)\nAnd: outliers? clusters?',
        true,
        17,
      ),
    ],
  }),
];

// Each quiz and its reveal share a layout and filters, so the bubbles stay put.
for (let i = 0; i < slides.length - 1; i++) {
  const a = slides[i].view;
  const b = slides[i + 1].view;
  if (a.title !== QUIZ.title) continue;
  check(
    `quiz ${i + 1} and its reveal share a layout`,
    JSON.stringify([a.layout, a.filters]) === JSON.stringify([b.layout, b.filters]),
  );
}

// ---------------------------------------------------------------------------
// Colours

const categoryColors = {
  [F.activity]: { Band: '#4a3aa7', 'Sports team': '#eb6834', Neither: '#a3a29c' },
  [F.commuteMode]: { Walk: '#1baf7a', Bus: '#eda100', Car: '#2a78d6' },
};

const deck = {
  format: 'datadeck',
  version: 1,
  name: 'Describing scatter plots',
  dataset,
  fieldOverrides,
  categoryColors,
  slides,
};

console.table(Object.fromEntries(Object.entries(R).map(([k, v]) => [k, Math.round(v * 1000) / 1000])));
if (failures.length) {
  console.error('Checks failed:\n  ' + failures.join('\n  '));
  process.exit(1);
}
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(deck));
console.log(`Wrote ${OUT} (${slides.length} slides, ${N} students, ${COLUMNS.length} columns)`);
