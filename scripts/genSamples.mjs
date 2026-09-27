// Builds the bundled sample datasets in public/samples/.
// Real datasets are downloaded from GitHub (cached in scripts/raw/); the large
// synthetic dataset is generated from a seeded RNG so it is reproducible.
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const rawDir = path.join(root, 'scripts', 'raw');
const outDir = path.join(root, 'public', 'samples');

const SOURCES = {
  'iris.csv': 'https://raw.githubusercontent.com/mwaskom/seaborn-data/master/iris.csv',
  'penguins.csv': 'https://raw.githubusercontent.com/allisonhorst/palmerpenguins/main/inst/extdata/penguins.csv',
  'cars.json': 'https://raw.githubusercontent.com/vega/vega-datasets/main/data/cars.json',
  'movies.json': 'https://raw.githubusercontent.com/vega/vega-datasets/main/data/movies.json',
};

async function fetchRaw(name) {
  const file = path.join(rawDir, name);
  try {
    await access(file);
  } catch {
    const res = await fetch(SOURCES[name]);
    if (!res.ok) throw new Error(`Failed to download ${name}: ${res.status}`);
    await mkdir(rawDir, { recursive: true });
    await writeFile(file, await res.text());
  }
  return readFile(file, 'utf8');
}

function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows, columns = Object.keys(rows[0])) {
  return [columns.map(csvCell).join(','), ...rows.map((r) => columns.map((c) => csvCell(r[c])).join(','))].join('\n') + '\n';
}

// mulberry32
function rng(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function synthetic(n) {
  const rand = rng(42);
  const normal = () => Math.sqrt(-2 * Math.log(rand() || 1e-9)) * Math.cos(2 * Math.PI * rand());
  const pick = (items, weights) => {
    let r = rand() * weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < items.length; i++) if ((r -= weights[i]) <= 0) return items[i];
    return items[items.length - 1];
  };
  const regions = ['North America', 'Europe', 'Asia Pacific', 'Latin America', 'Middle East & Africa'];
  const plans = ['Free', 'Starter', 'Pro', 'Enterprise'];
  const channels = ['Organic', 'Paid search', 'Referral', 'Partner', 'Social'];
  const industries = ['Retail', 'Finance', 'Healthcare', 'Education', 'Media', 'Manufacturing', 'Software'];
  const start = Date.UTC(2021, 0, 1);
  const span = Date.UTC(2025, 11, 31) - start;
  const rows = [];
  for (let i = 0; i < n; i++) {
    const plan = pick(plans, [40, 30, 20, 10]);
    const tier = plans.indexOf(plan);
    const seats = Math.max(1, Math.round(Math.exp(1 + tier * 0.9 + normal() * 0.6)));
    const monthly = tier === 0 ? 0 : Math.round(seats * [0, 12, 29, 55][tier] * (0.85 + rand() * 0.3));
    const tenure = Math.max(1, Math.round(6 + tier * 6 + normal() * 8));
    const nps = Math.max(-100, Math.min(100, Math.round(10 + tier * 12 + normal() * 30)));
    const usage = Math.max(0, +(2 + tier * 1.5 + normal() * 1.4).toFixed(2));
    const tickets = Math.max(0, Math.round(seats * 0.08 * (1.5 - usage / 10) + rand() * 3));
    const churned = rand() < 0.35 - tier * 0.07 - usage * 0.02 ? 'Yes' : 'No';
    const signup = new Date(start + rand() * span).toISOString().slice(0, 10);
    rows.push({
      customer_id: `C-${String(10000 + i)}`,
      signup_date: signup,
      region: pick(regions, [34, 28, 20, 11, 7]),
      industry: pick(industries, [16, 14, 12, 10, 9, 13, 26]),
      acquisition_channel: pick(channels, [30, 25, 18, 12, 15]),
      plan,
      seats,
      monthly_revenue: monthly,
      tenure_months: tenure,
      weekly_active_hours: usage,
      support_tickets: tickets,
      nps,
      churned,
    });
  }
  return rows;
}

await mkdir(outDir, { recursive: true });

await writeFile(path.join(outDir, 'iris.csv'), await fetchRaw('iris.csv'));
await writeFile(path.join(outDir, 'penguins.csv'), (await fetchRaw('penguins.csv')).replace(/,NA(?=,|\n)/g, ','));

const cars = JSON.parse(await fetchRaw('cars.json')).map((c) => ({ ...c, Year: c.Year?.slice(0, 4) }));
await writeFile(path.join(outDir, 'cars.csv'), toCsv(cars));

const movies = JSON.parse(await fetchRaw('movies.json'));
await writeFile(path.join(outDir, 'movies.csv'), toCsv(movies));

await writeFile(path.join(outDir, 'saas-customers.csv'), toCsv(synthetic(5000)));
console.log('Samples written to', path.relative(root, outDir));
