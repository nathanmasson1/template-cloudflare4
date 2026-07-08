import aiEditorialNotice from '../data/aiEditorialNotice.json';
import aiPolicy from '../data/aiPolicy.json';
import aiScheduledPosts from '../data/aiScheduledPosts.json';
import authors from '../data/authors.json';
import categories from '../data/categories.json';
import contato from '../data/contato.json';
import cookies from '../data/cookies.json';
import corrections from '../data/corrections.json';
import editorialPolicy from '../data/editorialPolicy.json';
import footer from '../data/footer.json';
import home from '../data/home.json';
import menu from '../data/menu.json';
import monetization from '../data/monetization.json';
import pluginRegistry from '../data/pluginRegistry.json';
import pluginVersions from '../data/pluginVersions.json';
import pluginsConfig from '../data/pluginsConfig.json';
import privacy from '../data/privacy.json';
import redirects from '../data/redirects.json';
import siteConfig from '../data/siteConfig.json';
import sobre from '../data/sobre.json';
import terms from '../data/terms.json';
import version from '../data/version.json';

const DATA: Record<string, unknown> = {
  'aiEditorialNotice.json': aiEditorialNotice,
  'aiPolicy.json': aiPolicy,
  'aiScheduledPosts.json': aiScheduledPosts,
  'authors.json': authors,
  'categories.json': categories,
  'contato.json': contato,
  'cookies.json': cookies,
  'corrections.json': corrections,
  'editorialPolicy.json': editorialPolicy,
  'footer.json': footer,
  'home.json': home,
  'menu.json': menu,
  'monetization.json': monetization,
  'pluginRegistry.json': pluginRegistry,
  'pluginVersions.json': pluginVersions,
  'pluginsConfig.json': pluginsConfig,
  'privacy.json': privacy,
  'redirects.json': redirects,
  'siteConfig.json': siteConfig,
  'sobre.json': sobre,
  'terms.json': terms,
  'version.json': version,
};

function normalizeFilename(filename: string) {
  return filename.replace(/^src\/data\//, '').replace(/^\/+/, '');
}

function clone<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

export function readStaticData<T = any>(filename: string, fallback: T = {} as T): T {
  const value = DATA[normalizeFilename(filename)];
  return value === undefined ? fallback : clone(value as T);
}

export function readStaticDataText(filename: string): string | null {
  const value = DATA[normalizeFilename(filename)];
  return value === undefined ? null : JSON.stringify(value, null, 2);
}

export function listStaticDataFilenames() {
  return Object.keys(DATA).sort();
}
