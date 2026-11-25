// Простой in-memory rate-limit со скользящим окном. Для одного процесса этого достаточно;
// при горизонтальном масштабировании заменяется на Redis без изменения вызовов.
const buckets = new Map();

export function rateLimit({ key, limit, windowMs }) {
  const nowTs = Date.now();
  const bucketKey = `${key}`;
  let bucket = buckets.get(bucketKey);
  if (!bucket) {
    bucket = [];
    buckets.set(bucketKey, bucket);
  }
  // Чистим старые отметки.
  const threshold = nowTs - windowMs;
  let i = 0;
  while (i < bucket.length && bucket[i] < threshold) i += 1;
  if (i > 0) bucket.splice(0, i);

  if (bucket.length >= limit) {
    const retryAfterMs = Math.max(0, bucket[0] + windowMs - nowTs);
    return { allowed: false, retryAfterMs, remaining: 0 };
  }
  bucket.push(nowTs);
  return { allowed: true, remaining: Math.max(0, limit - bucket.length) };
}

export function resetRateLimits() {
  buckets.clear();
}

// Периодическая чистка, чтобы карта не росла.
const cleanupTimer = setInterval(() => {
  const threshold = Date.now() - 3600_000;
  for (const [key, bucket] of buckets) {
    if (!bucket.length || bucket[bucket.length - 1] < threshold) buckets.delete(key);
  }
}, 600_000);
cleanupTimer.unref?.();
