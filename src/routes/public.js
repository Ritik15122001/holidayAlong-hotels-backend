import { Router } from 'express';
import { Hotel, HotelPrice, RoomType, MealPlan, Lead, City, Location, Vendor, Brochure, Format, Amenity } from '../models/index.js';
import { requireUser } from '../lib/auth.js';
import { sendBookingToHotel } from '../lib/mail.js';
import { bestQuote } from '../lib/pricing.js';
import { fetchGoogleRating, googleEnabled } from '../lib/google.js';

const r = Router();
const ok = (fn) => (req, res) => fn(req, res).catch((e) => res.status(400).json({ error: e.message }));

// The party and stay length a quote is built for. Shared by the list and the
// detail route so a hotel never shows one price in search and another when
// you open it.
const partyFrom = (req) => {
  const int = (v, d = 0) => { const x = Math.trunc(Number(v)); return Number.isFinite(x) && x >= 0 ? x : d; };
  const span = (a, z) => (a && z ? Math.round((new Date(z) - new Date(a)) / 864e5) : 0);
  return {
    party: {
      rooms: Math.max(1, int(req.query.rooms, 1)),
      adults: Math.max(1, int(req.query.adults, 2)),
      extraBeds: int(req.query.extraBeds),
      cwb: int(req.query.cwb),
      cnb: int(req.query.cnb),
    },
    nights: Math.max(1, int(req.query.nights) || span(req.query.checkIn, req.query.checkOut) || 1),
  };
};

// GET /api/hotels
r.get('/hotels', requireUser, ok(async (req, res) => {
  const { q, city, stars, minPrice, maxPrice, rating, roomType, mealPlan, page = 1, limit = 12, sort } = req.query;

  const { party, nights } = partyFrom(req);
  const filter = { status: 'Active' };
  if (q) filter.$or = [{ name: new RegExp(q, 'i') }, { city: new RegExp(q, 'i') }, { location: new RegExp(q, 'i') }];
  if (city) filter.city = new RegExp(`^${city}$`, 'i');
  if (stars) filter.starCategory = { $in: String(stars).split(',').map((v) => v.trim()).filter(Boolean) };
  if (rating) filter.rating = { $gte: Number(rating) };

  let hotels = await Hotel.find(filter).sort({ createdAt: -1 }).lean();
  const ids = hotels.map((h) => h._id);

  const priceFilter = { hotelId: { $in: ids }, status: 'Active' };
  const prices = await HotelPrice.find(priceFilter).populate('roomTypeId', 'name').populate('mealPlanId', 'code').lean();

  const byHotel = {};
  for (const p of prices) {
    const key = String(p.hotelId);
    (byHotel[key] ||= []).push(p);
  }

  hotels = hotels.map((h) => {
    const list = byHotel[String(h._id)] || [];
    const valid = list.filter((p) => p.doublePrice > 0);
    const cheapest = valid.sort((a, b) => a.doublePrice - b.doublePrice)[0];
    const quoted = bestQuote(list, party, nights, req.query.checkIn || null);
    return {
      ...h,
      startingPrice: cheapest ? cheapest.doublePrice : null,
      currency: cheapest ? cheapest.currency : 'INR',
      topRoomType: cheapest?.roomTypeId?.name || '',
      topMealPlan: cheapest?.mealPlanId?.code || '',
      quote: quoted,
      // dates were given but nothing is loaded for them — the card says so
      // rather than quietly falling back to an unrelated starting price
      noRateForDates: Boolean(req.query.checkIn) && !quoted,
      roomTypes: [...new Set(list.map((p) => p.roomTypeId?.name).filter(Boolean))],
      mealPlans: [...new Set(list.map((p) => p.mealPlanId?.code).filter(Boolean))],
      priceCount: list.length,
    };
  });

  if (roomType) {
    const want = String(roomType).split(',');
    hotels = hotels.filter((h) => h.roomTypes.some((t) => want.includes(t)));
  }
  if (mealPlan) {
    const want = String(mealPlan).split(',');
    hotels = hotels.filter((h) => h.mealPlans.some((t) => want.includes(t)));
  }
  // price filters and sorting follow the quoted stay total when one exists,
  // so they line up with the figure actually shown on the card
  const forSort = (h) => h.quote?.perNight ?? h.startingPrice;
  if (minPrice) hotels = hotels.filter((h) => forSort(h) != null && forSort(h) >= Number(minPrice));
  if (maxPrice) hotels = hotels.filter((h) => forSort(h) != null && forSort(h) <= Number(maxPrice));

  if (sort === 'price_asc') hotels.sort((a, b) => (forSort(a) ?? 1e9) - (forSort(b) ?? 1e9));
  if (sort === 'price_desc') hotels.sort((a, b) => (forSort(b) ?? 0) - (forSort(a) ?? 0));
  if (sort === 'rating') hotels.sort((a, b) => b.rating - a.rating);

  const total = hotels.length;
  const p = Math.max(1, Number(page)), l = Math.max(1, Number(limit));
  res.json({ data: hotels.slice((p - 1) * l, p * l), total, page: p, pages: Math.ceil(total / l) || 1 });
}));

// GET /api/hotels/:id
r.get('/hotels/:id', requireUser, ok(async (req, res) => {
  const { id } = req.params;
  const hotel = await Hotel.findOne(id.match(/^[0-9a-f]{24}$/i) ? { _id: id } : { slug: id }).lean();
  if (!hotel) return res.status(404).json({ error: 'Hotel not found' });

  // quote on the same basis as the search card that linked here
  const { party, nights } = partyFrom(req);
  const prices = await HotelPrice.find({ hotelId: hotel._id, status: 'Active' })
    .populate('roomTypeId', 'name').populate('mealPlanId', 'code').lean();
  const checkIn = req.query.checkIn || null;
  const quote = bestQuote(prices, party, nights, checkIn);

  // the same quote per room type, so each row on the page prices the party
  // being searched for rather than a lead-in nightly rate
  const byRoom = new Map();
  for (const pr of prices) {
    const name = pr.roomTypeId?.name;
    if (!name) continue;
    if (!byRoom.has(name)) byRoom.set(name, []);
    byRoom.get(name).push(pr);
  }
  const roomQuotes = [...byRoom].map(([roomType, rows]) => ({
    roomType,
    quote: bestQuote(rows, party, nights, checkIn),
  }));

  res.json({
    ...hotel,
    quote,
    roomQuotes,
    quotedNights: nights,
    noRateForDates: Boolean(checkIn) && !quote,
  });
}));

// GET /api/hotels/:id/prices
r.get('/hotels/:id/google-rating', requireUser, ok(async (req, res) => {
  const hotel = await Hotel.findById(req.params.id).select('googlePlaceId googleRating googleReviewCount googleSyncedAt').lean();
  if (!hotel) return res.status(404).json({ error: 'Hotel not found' });
  if (!hotel.googlePlaceId) return res.json({ available: false, reason: 'no_place_id' });
  if (!googleEnabled()) return res.json({ available: false, reason: 'no_api_key' });
  try {
    const data = await fetchGoogleRating(hotel);
    res.json({ available: data?.rating != null, ...data });
  } catch (e) {
    res.json({ available: false, reason: 'lookup_failed', error: e.message });
  }
}));

r.get('/hotels/:id/prices', requireUser, ok(async (req, res) => {
  const { date, all } = req.query;
  const filter = { hotelId: req.params.id };
  if (all !== '1') filter.status = 'Active';
  if (date) { filter.startDate = { $lte: new Date(date) }; filter.endDate = { $gte: new Date(date) }; }
  const prices = await HotelPrice.find(filter).populate('roomTypeId', 'name').populate('mealPlanId', 'code name').sort({ startDate: 1 }).lean();
  res.json(prices);
}));

r.get('/room-types', requireUser, ok(async (_req, res) => res.json(await RoomType.find({ status: 'Active' }).sort('name').lean())));
r.get('/meal-plans', requireUser, ok(async (_req, res) => res.json(await MealPlan.find({ status: 'Active' }).sort('code').lean())));

r.get('/cities', requireUser, ok(async (_req, res) =>
  res.json(await City.find({ status: 'Active' }).sort('name').lean())));

r.get('/locations', requireUser, ok(async (req, res) => {
  const filter = { status: 'Active' };
  if (req.query.city) filter.cityId = req.query.city;
  res.json(await Location.find(filter).populate('cityId', 'name state').sort('name').lean());
}));

// Vendor directory. This is an internal trade portal sitting entirely behind
// a login, so the full vendor record is returned, settlement details included.
r.get('/vendors', requireUser, ok(async (req, res) => {
  const filter = { status: 'Active' };
  if (req.query.type) filter.vendorType = req.query.type;
  const rows = await Vendor.find(filter)
    .select('companyName contactPerson phones emails website vendorType sectors '
      + 'gstPan bankName accountNumber ifsc upi status')
    .sort('companyName').lean();
  const counts = await Hotel.aggregate([
    { $match: { status: 'Active', vendorId: { $ne: null } } },
    { $group: { _id: '$vendorId', count: { $sum: 1 } } },
  ]);
  const byVendor = Object.fromEntries(counts.map((c) => [String(c._id), c.count]));
  res.json(rows.map((v) => ({ ...v, hotelCount: byVendor[String(v._id)] || 0 })));
}));

// Cities, their vendors and the hotels under each — drives the cascading
// pickers on the booking form. One call, since these lists are small.
r.get('/booking-options', requireUser, ok(async (_req, res) => {
  const hotels = await Hotel.find({ status: 'Active' }).select('name city vendorId').sort('name').lean();

  const ids = [...new Set(hotels.map((h) => String(h.vendorId || '')).filter(Boolean))];
  const vendors = ids.length
    ? await Vendor.find({ _id: { $in: ids } }).select('companyName').lean()
    : [];
  const nameById = Object.fromEntries(vendors.map((v) => [String(v._id), v.companyName]));

  res.json(hotels.map((h) => ({
    _id: String(h._id),
    name: h.name,
    city: h.city || '',
    vendorId: h.vendorId ? String(h.vendorId) : '',
    vendorName: h.vendorId ? nameById[String(h.vendorId)] || '' : '',
  })));
}));

r.get('/vendors/:id/hotels', requireUser, ok(async (req, res) =>
  res.json(await Hotel.find({ vendorId: req.params.id, status: 'Active' })
    .select('name slug city location starCategory images rating').sort('name').lean())));

r.get('/amenities', requireUser, ok(async (_req, res) =>
  res.json(await Amenity.find({ status: 'Active' }).sort({ sortOrder: 1, name: 1 }).lean())));

r.get('/formats', requireUser, ok(async (_req, res) =>
  res.json(await Format.find({ status: 'Active' }).sort({ sortOrder: 1, createdAt: 1 }).lean())));

r.get('/brochures', requireUser, ok(async (_req, res) =>
  res.json(await Brochure.find({ status: 'Active' }).sort({ sortOrder: 1, createdAt: -1 }).lean())));

r.get('/destinations', requireUser, ok(async (_req, res) => {
  const rows = await Hotel.aggregate([
    { $match: { status: 'Active' } },
    { $group: { _id: '$city', count: { $sum: 1 }, image: { $first: { $arrayElemAt: ['$images', 0] } } } },
    { $sort: { count: -1 } },
  ]);
  res.json(rows.map((d) => ({ city: d._id, count: d.count, image: d.image })));
}));

// POST /api/leads
r.post('/leads', requireUser, ok(async (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'Guest name is required' });
  if (!b.checkIn || !b.checkOut) return res.status(400).json({ error: 'Check-in and check-out dates are required' });
  if (new Date(b.checkOut) <= new Date(b.checkIn)) return res.status(400).json({ error: 'Check-out must be after check-in' });
  if (b.reCheckIn && b.reCheckOut && new Date(b.reCheckOut) <= new Date(b.reCheckIn)) {
    return res.status(400).json({ error: 'Re-check-out must be after re-check-in' });
  }

  // nights across both stays, worked out server-side
  const span = (a, z) => (a && z ? Math.max(0, Math.round((new Date(z) - new Date(a)) / 864e5)) : 0);
  b.nights = span(b.checkIn, b.checkOut) + span(b.reCheckIn, b.reCheckOut);
  if (b.hotelId && !String(b.hotelId).match(/^[0-9a-f]{24}$/i)) delete b.hotelId;
  let hotelEmail = '';
  if (b.hotelId) {
    const h = await Hotel.findById(b.hotelId).select('name email').lean();
    if (h) { b.hotelName = h.name; hotelEmail = h.email || ''; }
  }
  // booked by name rather than from a hotel page — look the hotel up
  if (!hotelEmail && b.hotelName) {
    const h = await Hotel.findOne({ name: String(b.hotelName).trim(), status: 'Active' }).select('email').lean();
    if (h) hotelEmail = h.email || '';
  }
  // the submitting account comes from the token, never from the form
  // the form follows the trade-partner format and does not ask for contact
  // details, so they come from the signed-in account
  b.email = b.email || req.user?.email || '';
  b.userId = req.user?.sub;
  b.userName = req.user?.name || '';
  b.userEmail = req.user?.email || '';

  const lead = await Lead.create(b);
  res.status(201).json({ id: lead._id, message: 'Thank you. Our team will confirm your booking shortly.' });

  // the guest already has their answer — mail the hotel afterwards so a slow
  // or broken SMTP server can never hold up or fail a booking
  sendBookingToHotel(lead.toObject(), hotelEmail)
    .then((r) => Lead.findByIdAndUpdate(lead._id, r.sent
      ? { mailedTo: hotelEmail, mailedAt: new Date(), mailError: '' }
      : { mailError: r.reason || 'unknown' }).exec())
    .catch((err) => console.error('booking mail failed:', err.message));
}));

export default r;
