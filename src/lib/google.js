import { Hotel } from '../models/index.js';

/**
 * Live rating from Google Places. Results are cached on the hotel for
 * CACHE_HOURS because Place Details is billed per call, and Google's terms
 * do not allow storing review content long-term.
 */
const CACHE_HOURS = 24;
const ENDPOINT = 'https://maps.googleapis.com/maps/api/place/details/json';

export const googleEnabled = () => Boolean(process.env.GOOGLE_MAPS_API_KEY);

export async function fetchGoogleRating(hotel, { force = false } = {}) {
  if (!hotel?.googlePlaceId) return null;
  if (!googleEnabled()) return null;

  const fresh = hotel.googleSyncedAt &&
    Date.now() - new Date(hotel.googleSyncedAt).getTime() < CACHE_HOURS * 3600e3;
  if (fresh && !force && hotel.googleRating != null) {
    return { rating: hotel.googleRating, reviewCount: hotel.googleReviewCount, cached: true };
  }

  const url = `${ENDPOINT}?place_id=${encodeURIComponent(hotel.googlePlaceId)}`
    + `&fields=rating,user_ratings_total&key=${process.env.GOOGLE_MAPS_API_KEY}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Google Places returned ${res.status}`);
  const json = await res.json();
  if (json.status !== 'OK') throw new Error(json.error_message || json.status);

  const rating = json.result?.rating ?? null;
  const reviewCount = json.result?.user_ratings_total ?? null;

  await Hotel.updateOne({ _id: hotel._id },
    { googleRating: rating, googleReviewCount: reviewCount, googleSyncedAt: new Date() });

  return { rating, reviewCount, cached: false };
}
