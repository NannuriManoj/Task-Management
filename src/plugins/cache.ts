import redis from '../config/redis.js';

export async function withCache<T>(
  key: string,
  ttl: number,
  fetchFunction: () => Promise<T>
): Promise<T> {
  let freshData: T | undefined;

  try {
    const cachedData = await redis.get(key);
    if (cachedData) {
      return JSON.parse(cachedData) as T;
    }

    freshData = await fetchFunction();
    await redis.set(key, JSON.stringify(freshData), 'EX', ttl);
    return freshData;
  } catch (error) {
    console.error(`Cache error for key ${key}:`, error);

    if (freshData === undefined) {
      return await fetchFunction();
    }

    return freshData;
  }
}