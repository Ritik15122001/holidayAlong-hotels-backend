import { Router } from 'express';
import { Hotel, HotelPrice, RoomType, MealPlan, Lead, City, Location, Vendor, Brochure, Format, Amenity } from '../models/index.js';
import { requireUser } from '../lib/auth.js';

const r = Router();
const ok = (fn) => (req, res) => fn(req, res).catch((e) => res.status(400).json({ error: e.message }));

// GET /api/hotels
r.get('/hotels', requireUser, ok(async (req, res) => {
  const { q, city, stars, minPrice, maxPrice, rating, roomType, mealPlan, page = 1, limit = 12, sort } = req.query;
  const filter = { status: 'Active' };
  if (q) filter.$or = [{ name: new RegExp(q, 'i') }, { city: new RegExp(q, 'i') }, { location: new RegExp(q, 'i') }];
  if (city) filter.city = new RegExp(`^${city}$`, 'i');
  if (stars) filter.starCategory = { $in: String(stars).split(',').map(Number) };
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
    return {
      ...h,
      startingPrice: cheapest ? cheapest.doublePrice : null,
      currency: cheapest ? cheapest.currency : 'INR',
      topRoomType: cheapest?.roomTypeId?.name || '',
      topMealPlan: cheapest?.mealPlanId?.code || '',
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
  if (minPrice) hotels = hotels.filter((h) => h.startingPrice != null && h.startingPrice >= Number(minPrice));
  if (maxPrice) hotels = hotels.filter((h) => h.startingPrice != null && h.startingPrice <= Number(maxPrice));

  if (sort === 'price_asc') hotels.sort((a, b) => (a.startingPrice ?? 1e9) - (b.startingPrice ?? 1e9));
  if (sort === 'price_desc') hotels.sort((a, b) => (b.startingPrice ?? 0) - (a.startingPrice ?? 0));
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
  res.json(hotel);
}));

// GET /api/hotels/:id/prices
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

// Public vendor directory. Bank, GST/PAN and UPI details are deliberately
// excluded — those are admin-only.
r.get('/vendors', requireUser, ok(async (req, res) => {
  const filter = { status: 'Active' };
  if (req.query.type) filter.vendorType = req.query.type;
  const rows = await Vendor.find(filter)
    .select('companyName contactPerson phones emails website vendorType sectors')
    .sort('companyName').lean();
  const counts = await Hotel.aggregate([
    { $match: { status: 'Active', vendorId: { $ne: null } } },
    { $group: { _id: '$vendorId', count: { $sum: 1 } } },
  ]);
  const byVendor = Object.fromEntries(counts.map((c) => [String(c._id), c.count]));
  res.json(rows.map((v) => ({ ...v, hotelCount: byVendor[String(v._id)] || 0 })));
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
  if (!b.name || !b.email || !b.phone) return res.status(400).json({ error: 'Name, email and phone are required' });
  if (!b.checkIn || !b.checkOut) return res.status(400).json({ error: 'Check-in and check-out dates are required' });
  if (new Date(b.checkOut) <= new Date(b.checkIn)) return res.status(400).json({ error: 'Check-out must be after check-in' });
  if (b.hotelId && !String(b.hotelId).match(/^[0-9a-f]{24}$/i)) delete b.hotelId;
  if (b.hotelId) {
    const h = await Hotel.findById(b.hotelId).select('name').lean();
    if (h) b.hotelName = h.name;
  }
  const lead = await Lead.create(b);
  res.status(201).json({ id: lead._id, message: 'Thank you. Our team will confirm your booking shortly.' });
}));

export default r;
