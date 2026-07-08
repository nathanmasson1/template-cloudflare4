type PostVisibilityData = {
  draft?: boolean;
  pubDate?: Date | string;
  scheduledAt?: Date | string;
};

export function isPostPublic(data: PostVisibilityData, now = new Date()) {
  if (data.draft) return false;

  const scheduledAt = data.scheduledAt ? new Date(data.scheduledAt) : null;
  if (scheduledAt && !isNaN(scheduledAt.getTime()) && scheduledAt > now) return false;

  const pubDate = data.pubDate ? new Date(data.pubDate) : null;
  if (pubDate && !isNaN(pubDate.getTime()) && pubDate > now) return false;

  return true;
}
