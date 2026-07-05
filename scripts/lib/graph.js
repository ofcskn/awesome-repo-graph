function sharedTagCount(a, b) {
  const setB = new Set(b.tags || []);
  return (a.tags || []).filter((t) => setB.has(t)).length;
}

function sharedPathPrefixLength(a, b) {
  const pa = a.path || [];
  const pb = b.path || [];
  let n = 0;
  while (n < pa.length && n < pb.length && pa[n] === pb[n]) n++;
  return n;
}

function relatedTo(id, sources) {
  const target = sources.find((s) => s.id === id);
  if (!target) return [];

  return sources
    .filter((s) => s.id !== id)
    .map((s) => ({
      id: s.id,
      title: s.title,
      url: s.url,
      sharedTags: sharedTagCount(target, s),
      sharedPathDepth: sharedPathPrefixLength(target, s),
    }))
    .filter((s) => s.sharedTags > 0 || s.sharedPathDepth > 0)
    .sort(
      (a, b) =>
        b.sharedTags - a.sharedTags || b.sharedPathDepth - a.sharedPathDepth
    );
}

module.exports = { relatedTo, sharedTagCount, sharedPathPrefixLength };
