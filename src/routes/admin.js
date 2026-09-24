import { Router } from 'express';
import { Hotel, HotelPrice, RoomType, MealPlan, Lead, User, City, Location, Vendor, Brochure } from '../models/index.js';
import { hashPassword } from '../lib/auth.js';

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

// Bulk price import. Rows come from a spreadsheet, so every row is validated
// individually and failures are reported back with their row number.
r.post('/hotels/:id/prices/bulk', ok(async (req, res) => {
  const hotel = await Hotel.findById(req.params.id).select('name').lean();
  if (!hotel) return res.status(404).json({ error: 'Hotel not found' });

  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  if (!rows.length) return res.status(400).json({ error: 'The sheet has no rows' });

  const [roomTypes, mealPlans] = await Promise.all([RoomType.find().lean(), MealPlan.find().lean()]);
  const rtByName = new Map(roomTypes.map((r) => [String(r.name).trim().toLowerCase(), r._id]));
  const mpByCode = new Map(mealPlans.map((m) => [String(m.code).trim().toLowerCase(), m._id]));
  const mpByName = new Map(mealPlans.map((m) => [String(m.name).trim().toLowerCase(), m._id]));

  const num = (v) => { const n = Number(String(v ?? '').toString().replace(/[^0-9.-]/g, '')); return Number.isFinite(n) ? n : 0; };
  const date = (v) => { const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d; };

  let created = 0, updated = 0;
  const errors = [];

  for (const [i, row] of rows.entries()) {
    const line = i + 2; // sheet row, allowing for the header
    const rtKey = String(row.roomType ?? '').trim().toLowerCase();
    const mpKey = String(row.mealPlan ?? '').trim().toLowerCase();
    const roomTypeId = rtByName.get(rtKey);
    const mealPlanId = mpByCode.get(mpKey) || mpByName.get(mpKey);

    if (!roomTypeId) { errors.push(`Row ${line}: unknown room type “${row.roomType ?? ''}”`); continue; }
    if (!mealPlanId) { errors.push(`Row ${line}: unknown meal plan “${row.mealPlan ?? ''}”`); continue; }

    const startDate = date(row.startDate), endDate = date(row.endDate);
    if (!startDate || !endDate) { errors.push(`Row ${line}: start and end dates are required (YYYY-MM-DD)`); continue; }
    if (endDate < startDate) { errors.push(`Row ${line}: end date is before the start date`); continue; }

    const doc = {
      hotelId: hotel._id, roomTypeId, mealPlanId,
      singlePrice: num(row.singlePrice), doublePrice: num(row.doublePrice),
      triplePrice: num(row.triplePrice), quadPrice: num(row.quadPrice),
      cnbPrice: num(row.cnbPrice), cwbPrice: num(row.cwbPrice),
      adultExtraBedPrice: num(row.adultExtraBedPrice),
      currency: String(row.currency || 'INR').trim().toUpperCase(),
      startDate, endDate,
      status: String(row.status || 'Active').trim().toLowerCase() === 'inactive' ? 'Inactive' : 'Active',
    };

    // same room type + meal plan + validity window = an update, not a duplicate
    const existing = await HotelPrice.findOne({ hotelId: hotel._id, roomTypeId, mealPlanId, startDate, endDate });
    if (existing) { Object.assign(existing, doc); await existing.save(); updated += 1; }
    else { await HotelPrice.create(doc); created += 1; }
  }

  res.json({ created, updated, failed: errors.length, errors: errors.slice(0, 20) });
}));

// Masters CRUD factory
const crud = (Model, path, opts = {}) => {
  r.get(`/${path}`, ok(async (_q, res) => {
    let q = Model.find().sort(opts.sort || { createdAt: 1 });
    if (opts.populate) q = q.populate(opts.populate);
    res.json(await q.lean());
  }));
  r.post(`/${path}`, ok(async (req, res) => res.status(201).json(await Model.create(req.body))));
  r.put(`/${path}/:id`, ok(async (req, res) => res.json(await Model.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true }))));
  r.delete(`/${path}/:id`, ok(async (req, res) => { await Model.findByIdAndDelete(req.params.id); res.json({ ok: true }); }));
};
crud(RoomType, 'room-types');
crud(MealPlan, 'meal-plans');
crud(City, 'cities', { sort: { name: 1 } });
crud(Brochure, 'brochures', { sort: { sortOrder: 1, createdAt: -1 } });
crud(Location, 'locations', { sort: { name: 1 }, populate: { path: 'cityId', select: 'name state' } });

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

// Vendors
r.get('/vendors', ok(async (req, res) => {
  const { q, type, status, page = 1, limit = 12 } = req.query;
  const filter = {};
  if (status) filter.status = status;
  if (type) filter.vendorType = type;
  if (q) filter.$or = [{ companyName: new RegExp(q, 'i') }, { contactPerson: new RegExp(q, 'i') }, { sectors: new RegExp(q, 'i') }];
  const p = Math.max(1, Number(page)), l = Math.max(1, Number(limit));
  const [rows, total] = await Promise.all([
    Vendor.find(filter).sort({ createdAt: -1 }).skip((p - 1) * l).limit(l).lean(),
    Vendor.countDocuments(filter),
  ]);
  const counts = await Hotel.aggregate([
    { $match: { vendorId: { $in: rows.map((v) => v._id) } } },
    { $group: { _id: '$vendorId', count: { $sum: 1 } } },
  ]);
  const byVendor = Object.fromEntries(counts.map((c) => [String(c._id), c.count]));
  res.json({ data: rows.map((v) => ({ ...v, hotelCount: byVendor[String(v._id)] || 0 })), total, page: p, pages: Math.ceil(total / l) || 1 });
}));

r.get('/vendors/:id/hotels', ok(async (req, res) =>
  res.json(await Hotel.find({ vendorId: req.params.id }).select('name city location starCategory status').sort('name').lean())));

r.post('/vendors', ok(async (req, res) => res.status(201).json(await Vendor.create(req.body))));
r.put('/vendors/:id', ok(async (req, res) => res.json(await Vendor.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true }))));
r.delete('/vendors/:id', ok(async (req, res) => {
  const hotels = await Hotel.countDocuments({ vendorId: req.params.id });
  if (hotels) return res.status(400).json({ error: `This vendor still has ${hotels} hotel${hotels > 1 ? 's' : ''} linked. Reassign them first.` });
  await Vendor.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
}));

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

r.post('/users', ok(async (req, res) => {
  const { name, email, phone, password, status } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required' });
  if (String(password).length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

  const exists = await User.findOne({ email: String(email).toLowerCase() });
  if (exists) return res.status(409).json({ error: 'An account with this email already exists' });

  const user = await User.create({
    name, email, phone: phone || '',
    passwordHash: hashPassword(String(password)),
    status: status === 'Blocked' ? 'Blocked' : 'Active',
  });
  const { passwordHash, ...safe } = user.toObject();
  res.status(201).json(safe);
}));

r.put('/users/:id', ok(async (req, res) => {
  const { name, email, phone, password, status } = req.body || {};
  const patch = {};
  if (name) patch.name = name;
  if (phone !== undefined) patch.phone = phone;
  if (status && ['Active', 'Blocked'].includes(status)) patch.status = status;
  if (email) {
    const clash = await User.findOne({ email: String(email).toLowerCase(), _id: { $ne: req.params.id } });
    if (clash) return res.status(409).json({ error: 'Another account already uses this email' });
    patch.email = email;
  }
  if (password) {
    if (String(password).length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    patch.passwordHash = hashPassword(String(password));
  }
  const user = await User.findByIdAndUpdate(req.params.id, patch, { new: true }).select('-passwordHash');
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
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
