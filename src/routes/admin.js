import { Router } from 'express';
import { Hotel, HotelPrice, RoomType, MealPlan, Lead, User } from '../models/index.js';

const r = Router();
const ok = (fn) => (req, res) => fn(req, res).catch((e) => res.status(400).json({ error: e.message }));

// Simple token auth
export function auth(req, res, next) {
  if (req.path === '/login') return next();
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (token !== process.env.ADMIN_TOKEN) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

r.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (username === process.env.ADMIN_USER && password === process.env.ADMIN_PASS) {
    return res.json({ token: process.env.ADMIN_TOKEN, user: { username } });
  }
  res.status(401).json({ error: 'Invalid credentials' });
});

// Dashboard
r.get('/stats', ok(async (_req, res) => {
  const now = new Date();
  const [totalHotels, activeHotels, activePrices, newLeads, recentLeads, totalLeads, totalUsers, activeUsers, recentUsers] = await Promise.all([
    Hotel.countDocuments(),
    Hotel.countDocuments({ status: 'Active' }),
    HotelPrice.countDocuments({ status: 'Active', startDate: { $lte: now }, endDate: { $gte: now } }),
    Lead.countDocuments({ status: 'New' }),
    Lead.find().sort({ createdAt: -1 }).limit(6).lean(),
    Lead.countDocuments(),
    User.countDocuments(),
    User.countDocuments({ status: 'Active' }),
    User.find().select('-passwordHash').sort({ createdAt: -1 }).limit(5).lean(),
  ]);
  res.json({ totalHotels, activeHotels, activePrices, newLeads, totalLeads, recentLeads, totalUsers, activeUsers, recentUsers });
}));

// Hotels
r.get('/hotels', ok(async (req, res) => {
  const { q, status, page = 1, limit = 10 } = req.query;
  const filter = {};
  if (q) filter.$or = [{ name: new RegExp(q, 'i') }, { city: new RegExp(q, 'i') }, { location: new RegExp(q, 'i') }];
  if (status) filter.status = status;
  const p = Math.max(1, Number(page)), l = Math.max(1, Number(limit));
  const [rows, total] = await Promise.all([
    Hotel.find(filter).sort({ createdAt: -1 }).skip((p - 1) * l).limit(l).lean(),
    Hotel.countDocuments(filter),
  ]);
  const counts = await HotelPrice.aggregate([
    { $match: { hotelId: { $in: rows.map((h) => h._id) } } },
    { $group: { _id: '$hotelId', c: { $sum: 1 } } },
  ]);
  const map = Object.fromEntries(counts.map((c) => [String(c._id), c.c]));
  res.json({ data: rows.map((h) => ({ ...h, priceCount: map[String(h._id)] || 0 })), total, page: p, pages: Math.ceil(total / l) || 1 });
}));

r.post('/hotels', ok(async (req, res) => res.status(201).json(await Hotel.create(req.body))));
r.put('/hotels/:id', ok(async (req, res) => {
  const h = await Hotel.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
  if (!h) return res.status(404).json({ error: 'Not found' });
  res.json(h);
}));
r.delete('/hotels/:id', ok(async (req, res) => {
  await HotelPrice.deleteMany({ hotelId: req.params.id });
  await Hotel.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
}));

// Prices
r.get('/hotels/:id/prices', ok(async (req, res) => {
  res.json(await HotelPrice.find({ hotelId: req.params.id }).populate('roomTypeId', 'name').populate('mealPlanId', 'code name').sort({ startDate: -1 }).lean());
}));
r.get('/prices', ok(async (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  res.json(await HotelPrice.find(filter).populate('hotelId', 'name city').populate('roomTypeId', 'name').populate('mealPlanId', 'code').sort({ createdAt: -1 }).limit(200).lean());
}));
r.post('/hotels/:id/prices', ok(async (req, res) => {
  const doc = await HotelPrice.create({ ...req.body, hotelId: req.params.id });
  res.status(201).json(await doc.populate([{ path: 'roomTypeId', select: 'name' }, { path: 'mealPlanId', select: 'code name' }]));
}));
r.put('/prices/:id', ok(async (req, res) => {
  const body = { ...req.body };
  const existing = await HotelPrice.findById(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const start = new Date(body.startDate ?? existing.startDate), end = new Date(body.endDate ?? existing.endDate);
  if (end < start) return res.status(400).json({ error: 'End date must be after start date' });
  Object.assign(existing, body);
  await existing.save();
  res.json(await existing.populate([{ path: 'roomTypeId', select: 'name' }, { path: 'mealPlanId', select: 'code name' }]));
}));
r.delete('/prices/:id', ok(async (req, res) => { await HotelPrice.findByIdAndDelete(req.params.id); res.json({ ok: true }); }));

// Masters CRUD factory
const crud = (Model, path) => {
  r.get(`/${path}`, ok(async (_q, res) => res.json(await Model.find().sort({ createdAt: 1 }).lean())));
  r.post(`/${path}`, ok(async (req, res) => res.status(201).json(await Model.create(req.body))));
  r.put(`/${path}/:id`, ok(async (req, res) => res.json(await Model.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true }))));
  r.delete(`/${path}/:id`, ok(async (req, res) => { await Model.findByIdAndDelete(req.params.id); res.json({ ok: true }); }));
};
crud(RoomType, 'room-types');
crud(MealPlan, 'meal-plans');

// Leads
r.get('/leads', ok(async (req, res) => {
  const { q, status, page = 1, limit = 15 } = req.query;
  const filter = {};
  if (status) filter.status = status;
  if (q) filter.$or = [{ name: new RegExp(q, 'i') }, { email: new RegExp(q, 'i') }, { phone: new RegExp(q, 'i') }, { hotelName: new RegExp(q, 'i') }];
  const p = Math.max(1, Number(page)), l = Math.max(1, Number(limit));
  const [rows, total] = await Promise.all([
    Lead.find(filter).sort({ createdAt: -1 }).skip((p - 1) * l).limit(l).populate('hotelId', 'name city').lean(),
    Lead.countDocuments(filter),
  ]);
  res.json({ data: rows, total, page: p, pages: Math.ceil(total / l) || 1 });
}));
r.put('/leads/:id/status', ok(async (req, res) => res.json(await Lead.findByIdAndUpdate(req.params.id, { status: req.body.status }, { new: true }))));
r.delete('/leads/:id', ok(async (req, res) => { await Lead.findByIdAndDelete(req.params.id); res.json({ ok: true }); }));

// Registered users
r.get('/users', ok(async (req, res) => {
  const { q, status, page = 1, limit = 10 } = req.query;
  const filter = {};
  if (q) filter.$or = [{ name: new RegExp(q, 'i') }, { email: new RegExp(q, 'i') }, { phone: new RegExp(q, 'i') }];
  if (status) filter.status = status;
  const p = Math.max(1, Number(page)), l = Math.max(1, Number(limit));
  const [rows, total] = await Promise.all([
    User.find(filter).select('-passwordHash').sort({ createdAt: -1 }).skip((p - 1) * l).limit(l).lean(),
    User.countDocuments(filter),
  ]);
  res.json({ data: rows, total, page: p, pages: Math.ceil(total / l) || 1 });
}));

r.patch('/users/:id/status', ok(async (req, res) => {
  const { status } = req.body || {};
  if (!['Active', 'Blocked'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  const user = await User.findByIdAndUpdate(req.params.id, { status }, { new: true }).select('-passwordHash');
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
}));

r.delete('/users/:id', ok(async (req, res) => {
  const user = await User.findByIdAndDelete(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ ok: true });
}));

export default r;
