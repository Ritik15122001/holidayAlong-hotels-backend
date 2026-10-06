import { Router } from 'express';
import { FinanceEntry } from '../models/index.js';

const r = Router();
const ok = (fn) => (req, res) => fn(req, res).catch((e) => res.status(400).json({ error: e.message }));

/** Heads that sit outside profit, kept here so the UI and the maths agree. */
export const PL_HEADS = ['Revenue', 'Other income', 'Direct cost', 'Operating expense', 'Not in P&L'];
const INCOME_HEADS = ['Revenue', 'Other income'];
const COST_HEADS = ['Direct cost', 'Operating expense'];

/** The Indian financial year (April–March) that a date falls in. */
export function financialYear(d = new Date()) {
  const date = new Date(d);
  const y = date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1;
  return { from: new Date(y, 3, 1), to: new Date(y + 1, 2, 31, 23, 59, 59, 999), label: `FY ${y}-${String(y + 1).slice(2)}` };
}

/** Turn a period name, or an explicit from/to, into a date filter. */
function periodRange({ period, from, to }) {
  const now = new Date();
  if (period === 'this-month') {
    return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999) };
  }
  if (period === 'last-month') {
    return { from: new Date(now.getFullYear(), now.getMonth() - 1, 1), to: new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999) };
  }
  if (period === 'fy') return financialYear(now);
  if (period === 'fy-prev') return financialYear(new Date(now.getFullYear() - 1, now.getMonth(), 1));
  if (period === 'all') return {};
  if (from || to) {
    return {
      from: from ? new Date(from) : undefined,
      to: to ? new Date(new Date(to).setHours(23, 59, 59, 999)) : undefined,
    };
  }
  return financialYear(now);
}

function buildFilter(q) {
  const { from, to } = periodRange(q);
  const filter = {};
  if (from || to) {
    filter.date = {};
    if (from) filter.date.$gte = from;
    if (to) filter.date.$lte = to;
  }
  if (q.type) filter.type = q.type;
  if (q.plHead) filter.plHead = q.plHead;
  if (q.category) filter.category = q.category;
  if (q.q) {
    const rx = new RegExp(String(q.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ notes: rx }, { party: rx }, { invoiceNo: rx }, { category: rx }];
  }
  return filter;
}

/** Ledger, newest first. */
r.get('/entries', ok(async (req, res) => {
  const { page = 1, limit = 50 } = req.query;
  const filter = buildFilter(req.query);
  const p = Math.max(1, Number(page)), l = Math.min(500, Math.max(1, Number(limit)));
  const [data, total] = await Promise.all([
    FinanceEntry.find(filter).sort({ date: -1, createdAt: -1 }).skip((p - 1) * l).limit(l).lean(),
    FinanceEntry.countDocuments(filter),
  ]);
  const sums = await FinanceEntry.aggregate([
    { $match: filter },
    { $group: { _id: '$type', total: { $sum: '$amount' } } },
  ]);
  const by = Object.fromEntries(sums.map((s) => [s._id, s.total]));
  res.json({
    data, total, page: p, pages: Math.ceil(total / l) || 1,
    in: by.Income || 0, out: by.Expense || 0,
  });
}));

/** Headline figures plus the statement, for one period. */
r.get('/summary', ok(async (req, res) => {
  const filter = buildFilter(req.query);
  const rows = await FinanceEntry.aggregate([
    { $match: filter },
    { $group: { _id: { head: '$plHead', category: '$category' }, total: { $sum: '$amount' }, count: { $sum: 1 } } },
    { $sort: { total: -1 } },
  ]);

  const heads = {};
  for (const h of PL_HEADS) heads[h] = { total: 0, categories: [] };
  for (const row of rows) {
    const h = heads[row._id.head] || (heads[row._id.head] = { total: 0, categories: [] });
    h.total += row.total;
    h.categories.push({ category: row._id.category || 'Uncategorised', total: row.total, count: row.count });
  }

  const income = INCOME_HEADS.reduce((s, h) => s + (heads[h]?.total || 0), 0);
  const expenses = COST_HEADS.reduce((s, h) => s + (heads[h]?.total || 0), 0);
  const { from, to } = periodRange(req.query);

  res.json({
    income,
    expenses,
    revenue: heads.Revenue?.total || 0,
    otherIncome: heads['Other income']?.total || 0,
    directCost: heads['Direct cost']?.total || 0,
    operatingExpense: heads['Operating expense']?.total || 0,
    grossProfit: (heads.Revenue?.total || 0) - (heads['Direct cost']?.total || 0),
    netProfit: income - expenses,
    notInPL: heads['Not in P&L']?.total || 0,
    heads,
    range: { from: from || null, to: to || null },
  });
}));

/** Distinct categories already in use, for the filter and the form. */
r.get('/categories', ok(async (_req, res) => {
  const list = await FinanceEntry.distinct('category');
  res.json(list.filter(Boolean).sort());
}));

r.post('/entries', ok(async (req, res) => res.status(201).json(await FinanceEntry.create(req.body))));

r.put('/entries/:id', ok(async (req, res) =>
  res.json(await FinanceEntry.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true }))));

r.delete('/entries/:id', ok(async (req, res) => {
  await FinanceEntry.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
}));

export default r;
