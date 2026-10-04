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

/** The cheapest quote across a hotel's rates for the requested party. */
export function bestQuote(prices = [], party = {}, nights = 1) {
  let best = null;
  for (const p of prices) {
    const q = quoteFor(p, party, nights);
    if (!q) continue;
    if (!best || q.total < best.total) {
      best = { ...q, roomType: p.roomTypeId?.name || '', mealPlan: p.mealPlanId?.code || '' };
    }
  }
  return best;
}
