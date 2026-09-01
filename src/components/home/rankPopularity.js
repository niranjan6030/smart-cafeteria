// rankPopularity — cross-stall "most loved" ranking shared by HomeRecommendations and the
// search overlay. Ranks from genuinely-social items only (review counts or a best-seller
// flag); if nothing qualifies the band simply doesn't render — popularity is never fabricated.
export function rankPopularity(items) {
  return items
    .filter((item) => Number(item.reviewCount || 0) > 0 || item.isMostSold)
    .sort((a, b) => {
      const aReviews = Number(a.reviewCount || 0);
      const bReviews = Number(b.reviewCount || 0);
      if (aReviews !== bReviews) return bReviews - aReviews;
      return (Number(b.rating || 0) - Number(a.rating || 0));
    })
    .slice(0, 6);
}
