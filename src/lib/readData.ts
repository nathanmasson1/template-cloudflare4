import { readStaticData } from './staticData';
import { getPostsDb, readSiteDataJsonFromD1 } from './cloudflareContent';

export function readData<T = any>(filename: string, fallback: T = {} as T): T {
  return readStaticData(filename, fallback);
}

export async function readDataAsync<T = any>(filename: string, fallback: T = {} as T): Promise<T> {
  const db = getPostsDb();
  if (db) {
    try {
      const dynamic = await readSiteDataJsonFromD1<T>(db, filename);
      if (dynamic !== null) return dynamic;
    } catch (error) {
      console.error(`Nao consegui ler ${filename} do D1. Usando fallback estatico.`, error);
    }
  }
  return readStaticData(filename, fallback);
}
