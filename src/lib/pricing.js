/**
 * Works a tariff row up into a stay total.
 *
 * Adults are spread across the rooms as evenly as possible and each room is
 * charged at its own occupancy rate. Extra beds and children are then added
 * per night, matching how the rates are quoted in the admin panel.
 */

const n = (v) => {
  const x = Number(v);
  return Number.isFinite(x) && x > 0 ? x : 0;
};

/** Adults split across rooms, biggest rooms first: 5 across 2 -> [3, 2]. */
export function occupancySplit(adults, rooms) {
  const r = Math.max(1, Math.trunc(rooms) || 1);
  const a = Math.max(0, Math.trunc(adults) || 0);
  const base = Math.floor(a / r);
  const extra = a % r;
  return Array.from({ length: r }, (_, i) => base + (i < extra ? 1 : 0));
}

/**
 * Nightly rate for one room at a given adult count. Falls back to the nearest
 * tier below plus extra beds when a hotel has not priced that occupancy.
 */
export function roomRate(price, adultsInRoom) {
  const tiers = [n(price.singlePrice), n(price.doublePrice), n(price.triplePrice), n(price.quadPrice)];
  const want = Math.max(1, adultsInRoom);

  if (want <= 4 && tiers[want - 1]) return tiers[want - 1];

  // nothing priced at that occupancy — take the highest tier that is priced
  // and charge the remaining heads as extra beds
  let i = Math.min(want, 4) - 1;
  while (i >= 0 && !tiers[i]) i -= 1;
  if (i < 0) return 0;
  return tiers[i] + (want - (i + 1)) * n(price.adultExtraBedPrice);
}

/**
 * Total for the whole stay.
 *
 * @param price  a HotelPrice row
 * @param party  { rooms, adults, extraBeds, cwb, cnb }
 * @param nights number of nights
 */
export function quoteFor(price, party = {}, nights = 1) {
  const stay = Math.max(1, Math.trunc(nights) || 1);
  const rooms = Math.max(1, Math.trunc(party.rooms) || 1);
  const adults = Math.max(0, Math.trunc(party.adults) || 0);
  const extraBeds = Math.max(0, Math.trunc(party.extraBeds) || 0);
  const cwb = Math.max(0, Math.trunc(party.cwb) || 0);
  const cnb = Math.max(0, Math.trunc(party.cnb) || 0);

  const split = occupancySplit(adults || rooms, rooms);
  const roomsTotal = split.reduce((sum, inRoom) => sum + roomRate(price, inRoom), 0);
  if (!roomsTotal) return null;               // this rate cannot cover the party

  const extraBedTotal = extraBeds * n(price.adultExtraBedPrice);
  const cwbTotal = cwb * (n(price.cwbPrice) || n(price.childExtraBedPrice));
  const cnbTotal = cnb * n(price.cnbPrice);

  const perNight = roomsTotal + extraBedTotal + cwbTotal + cnbTotal;

  return {
    perNight,
    nights: stay,
    total: perNight * stay,
    currency: price.currency || 'INR',
    breakdown: {
      rooms: roomsTotal * stay,
      extraBeds: extraBedTotal * stay,
      childWithBed: cwbTotal * stay,
      childNoBed: cnbTotal * stay,
      occupancy: split,
    },
  };
}

const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); };

/** How many days a rate row covers — open-ended rows count as the widest. */
const spanOf = (price) => {
  if (!price.startDate || !price.endDate) return Infinity;
  return Math.max(0, startOfDay(price.endDate) - startOfDay(price.startDate));
};

/** Is this rate row in force on the given night? */
export function activeOn(price, date) {
  if (price.status && price.status !== 'Active') return false;
  const night = startOfDay(date);
  const from = price.startDate ? startOfDay(price.startDate) : -Infinity;
  const to = price.endDate ? startOfDay(price.endDate) : Infinity;
  return night >= from && night <= to;
}

/** The nights of a stay — check-out day is not charged. */
const nightsOf = (checkIn, nights) =>
  Array.from({ length: nights }, (_, i) => new Date(startOfDay(checkIn) + i * 864e5));

/**
 * Cheapest quote for the party across the stay.
 *
 * Each night is charged at the rate in force that night, so a stay crossing a
 * season boundary picks up both rates. A room type and meal plan must cover
 * every night to be quotable, otherwise that combination is skipped.
 */
export function bestQuote(prices = [], party = {}, nights = 1, checkIn = null) {
  const stay = Math.max(1, Math.trunc(nights) || 1);

  // no dates to work with — fall back to rating every row on its own
  if (!checkIn) {
    let best = null;
    for (const p of prices) {
      const q = quoteFor(p, party, stay);
      if (q && (!best || q.total < best.total)) {
        best = { ...q, roomType: p.roomTypeId?.name || '', mealPlan: p.mealPlanId?.code || '' };
      }
    }
    return best;
  }

  const dates = nightsOf(checkIn, stay);

  // group the rows by what a guest actually picks: room type and meal plan
  const combos = new Map();
  for (const p of prices) {
    const key = `${p.roomTypeId?.name || ''}|${p.mealPlanId?.code || ''}`;
    if (!combos.has(key)) combos.set(key, []);
    combos.get(key).push(p);
  }

  let best = null;

  for (const [key, rows] of combos) {
    const perNight = [];
    let usable = true;

    for (const date of dates) {
      const live = rows.filter((p) => activeOn(p, date));

      // A narrower window is a deliberate override of a broader one, so a
      // peak-season row wins over the year-round rate it sits inside. Only
      // equally specific rows are then settled on price.
      let picked = null;
      let pickedSpan = Infinity;
      for (const p of live) {
        const q = quoteFor(p, party, 1);
        if (!q) continue;
        const span = spanOf(p);
        if (span < pickedSpan || (span === pickedSpan && q.perNight < picked.perNight)) {
          picked = q;
          pickedSpan = span;
        }
      }
      if (!picked) { usable = false; break; }       // a night nobody prices
      perNight.push({ date, rate: picked.perNight, currency: picked.currency });
    }
    if (!usable) continue;

    const total = perNight.reduce((sum, x) => sum + x.rate, 0);
    if (best && total >= best.total) continue;

    const [roomType, mealPlan] = key.split('|');

    // collapse consecutive nights on the same rate into readable segments
    const segments = [];
    for (const nightRate of perNight) {
      const last = segments[segments.length - 1];
      if (last && last.rate === nightRate.rate) last.nights += 1;
      else segments.push({ rate: nightRate.rate, nights: 1, from: nightRate.date });
    }

    best = {
      total,
      nights: stay,
      perNight: Math.round(total / stay),
      currency: perNight[0].currency,
      roomType,
      mealPlan,
      seasonal: segments.length > 1,
      segments: segments.map((x) => ({ rate: x.rate, nights: x.nights, from: x.from })),
    };
  }

  return best;
}
