import type { FieldType } from '../state/types';

export const TYPE_LABEL: Record<FieldType, string> = {
  quantitative: 'Quantitative',
  categorical: 'Categorical',
  date: 'Date',
  text: 'Text / ID',
};

export const TYPE_GLYPH: Record<FieldType, string> = {
  quantitative: '#',
  categorical: 'Aa',
  date: 'D',
  text: 'T',
};

/** Drag-and-drop payload type for fields dragged from the Data panel. */
export const FIELD_MIME = 'text/x-datadeck-field';
