import { Router } from 'express';
import { Hotel, HotelPrice, RoomType, MealPlan, Lead } from '../models/index.js';
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
  if (b.hotelId && !String(b.hotelId).match(/^[0-9a-f]{24}$/i)) delete b.hotelId;
  if (b.hotelId) {
    const h = await Hotel.findById(b.hotelId).select('name').lean();
    if (h) b.hotelName = h.name;
  }
  const lead = await Lead.create(b);
  res.status(201).json({ id: lead._id, message: 'Thank you. Our team will contact you shortly.' });
}));

export default r;
