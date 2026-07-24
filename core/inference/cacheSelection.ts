function modelRevisionMarker(modelId: string, revision: string): string {
  return `/${modelId}/resolve/${revision}/`;
}

export function selectNewModelCacheUrls(
  urls: readonly string[],
  existingUrls: ReadonlySet<string>,
  modelId: string,
  revision: string,
): string[] {
  const marker = modelRevisionMarker(modelId, revision);
  return urls.filter((url) => url.includes(marker) && !existingUrls.has(url));
}
