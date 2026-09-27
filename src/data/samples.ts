import type { Dataset } from '../state/types';
import { parseDelimited } from './parse';

export interface SampleInfo {
  file: string;
  name: string;
  description: string;
  rows: number;
  columns: number;
}

export const SAMPLES: SampleInfo[] = [
  {
    file: 'iris.csv',
    name: 'Iris flowers',
    description: 'Classic measurements of three iris species.',
    rows: 150,
    columns: 5,
  },
  {
    file: 'penguins.csv',
    name: 'Palmer penguins',
    description: 'Bill, flipper and body mass of Antarctic penguins.',
    rows: 344,
    columns: 8,
  },
  {
    file: 'cars.csv',
    name: 'Cars 1970–82',
    description: 'Fuel economy, power and origin of classic cars.',
    rows: 406,
    columns: 9,
  },
  {
    file: 'movies.csv',
    name: 'Movies',
    description: 'Box office, budgets, ratings and genres of 3,201 films.',
    rows: 3201,
    columns: 16,
  },
  {
    file: 'saas-customers.csv',
    name: 'SaaS customers',
    description: 'Synthetic subscription customers with plans, revenue and churn.',
    rows: 5000,
    columns: 13,
  },
];

export async function loadSample(sample: SampleInfo): Promise<Dataset> {
  const res = await fetch(`${import.meta.env.BASE_URL}samples/${sample.file}`);
  if (!res.ok) throw new Error(`Could not load sample “${sample.name}” (${res.status}).`);
  return parseDelimited(await res.text(), sample.name, 'sample');
}
