import type { Theme, Density } from './types';

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'forest') {
    root.style.setProperty('--green-900', '#1B4332');
    root.style.setProperty('--green-700', '#2D6A4F');
    root.style.setProperty('--green-500', '#40916C');
    root.style.setProperty('--green-300', '#95D5B2');
    root.style.setProperty('--green-200', '#B7E4C7');
    root.style.setProperty('--green-100', '#D8F3DC');
    root.style.setProperty('--green-50',  '#F0F9F2');
  } else if (theme === 'ocean') {
    root.style.setProperty('--green-900', '#0B3954');
    root.style.setProperty('--green-700', '#1D5A80');
    root.style.setProperty('--green-500', '#3E89AE');
    root.style.setProperty('--green-300', '#98C8DF');
    root.style.setProperty('--green-200', '#BFDCEC');
    root.style.setProperty('--green-100', '#DCEBF3');
    root.style.setProperty('--green-50',  '#EFF6FA');
  } else if (theme === 'earth') {
    root.style.setProperty('--green-900', '#3E2A14');
    root.style.setProperty('--green-700', '#6B4423');
    root.style.setProperty('--green-500', '#A67849');
    root.style.setProperty('--green-300', '#D4B896');
    root.style.setProperty('--green-200', '#E5CFAE');
    root.style.setProperty('--green-100', '#F0E3CE');
    root.style.setProperty('--green-50',  '#F8F1E3');
  }
}

export function applyDensity(density: Density): void {
  const root = document.documentElement;
  if (density === 'compact') {
    root.style.setProperty('--radius-lg', '16px');
    root.style.setProperty('--radius-md', '12px');
  } else {
    root.style.setProperty('--radius-lg', '22px');
    root.style.setProperty('--radius-md', '16px');
  }
}
