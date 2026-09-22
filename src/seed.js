import 'dotenv/config';
import mongoose from 'mongoose';
import { Hotel, RoomType, MealPlan, HotelPrice, Lead } from './models/index.js';

const P = (id) => `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&w=1600`;

// Luxury hotel photography only — pools, lobbies, suites, dining.
const IMG = {
  poolCourtyard: P(4502973), poolAerial: P(3889843), poolSea: P(2506988), poolCabana: P(1268871),
  resortExterior: P(1134176), poolUmbrella: P(189296), poolJungle: P(6129967),
  lobby: P(2869215), suiteClassic: P(262048), suiteModern: P(1457842),
  suiteLiving: P(7534561), suiteBright: P(5998120), roomModern: P(271618),
  roomSoft: P(1743231), bath: P(8092388), dining: P(67468),
};

const A = ['WiFi', 'Swimming Pool', 'Restaurant', 'Parking', 'Room Service', 'Air Conditioning', 'Gym', 'Spa'];

const hotels = [
  { name: 'The Azure Palm Resort', city: 'Goa', location: 'Candolim Beach', starCategory: 5, rating: 4.8,
    description: 'Beachfront luxury resort with private pool villas, an award-winning spa and sunset dining by the Arabian Sea.',
    images: [IMG.resortExterior, IMG.poolSea, IMG.suiteBright, IMG.bath, IMG.dining], amenities: A,
    address: 'Candolim Beach Road, Bardez, Goa 403515', phone: '+91 98200 11223', email: 'stay@azurepalm.in' },

  { name: 'Lake Pichola Heritage Palace', city: 'Udaipur', location: 'Lake Pichola', starCategory: 5, rating: 4.9,
    description: 'A restored royal residence on the water in Udaipur, with lake-facing suites, courtyard dining and evening boat transfers.',
    images: [IMG.poolCourtyard, IMG.lobby, IMG.suiteClassic, IMG.dining, IMG.bath], amenities: A,
    address: 'Lake Palace Road, Udaipur, Rajasthan 313001', phone: '+91 294 242 8800', email: 'reservations@lakepichola.in' },

  { name: 'Rajmahal Heritage Palace', city: 'Jaipur', location: 'Civil Lines', starCategory: 5, rating: 4.7,
    description: 'A restored royal residence offering courtyard suites, heritage dining and curated Pink City experiences.',
    images: [IMG.lobby, IMG.suiteClassic, IMG.poolUmbrella, IMG.dining, IMG.suiteLiving], amenities: A.filter((a) => a !== 'Gym'),
    address: 'Civil Lines, Jaipur, Rajasthan 302006', phone: '+91 141 400 1122', email: 'info@rajmahalheritage.in' },

  { name: 'Taj View Garden Retreat', city: 'Agra', location: 'Taj Ganj', starCategory: 4, rating: 4.5,
    description: 'Garden-facing rooms minutes from the Taj Mahal, with a rooftop terrace for sunrise views and all-day Mughlai dining.',
    images: [IMG.poolUmbrella, IMG.roomModern, IMG.dining, IMG.bath], amenities: ['WiFi', 'Swimming Pool', 'Restaurant', 'Parking', 'Room Service', 'Air Conditioning'],
    address: 'Taj Ganj, Agra, Uttar Pradesh 282001', phone: '+91 562 400 3311', email: 'stay@tajviewretreat.in' },

  { name: 'The Capital Residency', city: 'Delhi', location: 'Connaught Place', starCategory: 4, rating: 4.4,
    description: 'Contemporary business hotel in the heart of New Delhi with meeting suites and a rooftop restaurant.',
    images: [IMG.suiteModern, IMG.lobby, IMG.roomModern, IMG.bath], amenities: ['WiFi', 'Restaurant', 'Parking', 'Room Service', 'Air Conditioning', 'Gym'],
    address: 'Barakhamba Road, Connaught Place, New Delhi 110001', phone: '+91 11 4300 5500', email: 'stay@capitalresidency.in' },

  { name: 'Seaview Bay Hotel', city: 'Mumbai', location: 'Marine Drive', starCategory: 4, rating: 4.3,
    description: 'Classic sea-facing rooms along Marine Drive with all-day dining and easy access to South Mumbai.',
    images: [IMG.suiteLiving, IMG.roomSoft, IMG.dining, IMG.lobby], amenities: ['WiFi', 'Restaurant', 'Parking', 'Room Service', 'Air Conditioning', 'Gym', 'Spa'],
    address: 'Netaji Subhash Chandra Bose Road, Mumbai 400020', phone: '+91 22 6600 4400', email: 'hello@seaviewbay.in' },

  { name: 'Munnar Tea Valley Resort', city: 'Munnar', location: 'Chithirapuram', starCategory: 4, rating: 4.6,
    description: 'Cottages set among working tea estates in the Western Ghats, with valley-view balconies and estate walks at dawn.',
    images: [IMG.poolJungle, IMG.poolAerial, IMG.roomSoft, IMG.dining], amenities: ['WiFi', 'Restaurant', 'Parking', 'Room Service', 'Spa', 'Air Conditioning'],
    address: 'Chithirapuram, Munnar, Kerala 685565', phone: '+91 4865 263 300', email: 'stay@munnarteavalley.in' },

  { name: 'Coral Sands Beach Club', city: 'Goa', location: 'Palolem Beach', starCategory: 4, rating: 4.5,
    description: 'Relaxed south-Goa beach club with sea-facing cottages, a shack restaurant and live acoustic evenings.',
    images: [IMG.poolCabana, IMG.poolAerial, IMG.resortExterior, IMG.roomModern], amenities: ['WiFi', 'Swimming Pool', 'Restaurant', 'Parking', 'Air Conditioning', 'Room Service'],
    address: 'Palolem Beach Road, Canacona, Goa 403702', phone: '+91 83220 77441', email: 'book@coralsands.in' },

  { name: 'Oaktree Mountain Homestay', city: 'Narkanda', location: 'Thanedhar Road', starCategory: 3, rating: 4.2,
    description: 'A warm apple-orchard homestay with Himalayan views, home-cooked meals and cosy wood-panelled rooms.',
    images: [IMG.roomSoft, IMG.suiteBright, IMG.dining], amenities: ['WiFi', 'Restaurant', 'Parking', 'Room Service'],
    address: 'Thanedhar Road, Narkanda, Himachal Pradesh 171213', phone: '+91 94180 22110', email: 'stay@oaktreehomestay.in' },

  { name: 'Amber Fort View Inn', city: 'Jaipur', location: 'Amer', starCategory: 3, rating: 4.1,
    description: 'Simple, spotless rooms with terrace views of Amber Fort and traditional Rajasthani breakfasts.',
    images: [IMG.roomModern, IMG.suiteBright, IMG.lobby], amenities: ['WiFi', 'Restaurant', 'Parking', 'Air Conditioning'],
    address: 'Amer Road, Jaipur, Rajasthan 302028', phone: '+91 141 253 0099', email: 'info@amberfortview.in' },
];

const roomTypes = [
  ['Standard', 'Comfortable base category room'],
  ['Deluxe', 'Spacious room with upgraded amenities'],
  ['Premium', 'Premium room with view and lounge access'],
  ['Suite', 'Separate living area and bedroom'],
  ['Penthouse', 'Top-floor signature accommodation'],
];
const mealPlans = [
  ['EP', 'European Plan', 'Room only'],
  ['CP', 'Continental Plan', 'Room with breakfast'],
  ['MAP', 'Modified American Plan', 'Room with breakfast and one major meal'],
];

const d = (s) => new Date(s);

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  await Promise.all([Hotel.deleteMany({}), RoomType.deleteMany({}), MealPlan.deleteMany({}), HotelPrice.deleteMany({}), Lead.deleteMany({})]);

  const rts = await RoomType.insertMany(roomTypes.map(([name, description]) => ({ name, description })));
  const mps = await MealPlan.insertMany(mealPlans.map(([code, name, description]) => ({ code, name, description })));
  const H = await Hotel.insertMany(hotels);

  const rt = Object.fromEntries(rts.map((x) => [x.name, x._id]));
  const mp = Object.fromEntries(mps.map((x) => [x.code, x._id]));

  // base double price per hotel, scaled per room type / meal plan
  const base = { 5: 12000, 4: 7000, 3: 3500 };
  const rtMul = { Standard: 1, Deluxe: 1.25, Premium: 1.55, Suite: 2.1, Penthouse: 2.9 };
  const mpAdd = { EP: 0, CP: 1200, MAP: 2600 };
  const rows = [];
  const round = (n) => Math.round(n / 100) * 100;

  for (const h of H) {
    const b = base[h.starCategory] || 4000;
    const types = h.starCategory === 5 ? ['Deluxe', 'Premium', 'Suite', 'Penthouse'] : h.starCategory === 4 ? ['Standard', 'Deluxe', 'Premium'] : ['Standard', 'Deluxe'];
    for (const t of types) {
      for (const m of ['EP', 'CP', 'MAP']) {
        const dbl = round(b * rtMul[t] + mpAdd[m]);
        rows.push({
          hotelId: h._id, roomTypeId: rt[t], mealPlanId: mp[m],
          singlePrice: round(dbl * 0.8), doublePrice: dbl, triplePrice: round(dbl * 1.3), quadPrice: t === 'Standard' ? 0 : round(dbl * 1.5),
          cnbPrice: round(dbl * 0.15), cwbPrice: round(dbl * 0.3),
          adultExtraBedPrice: round(dbl * 0.35), childExtraBedPrice: round(dbl * 0.2),
          currency: 'INR',
          startDate: d('2026-01-01'), endDate: d('2026-12-31'), status: 'Active',
        });
      }
    }
    // one peak-season record
    rows.push({
      hotelId: h._id, roomTypeId: rt[types[0]], mealPlanId: mp.CP,
      singlePrice: 0, doublePrice: round(b * rtMul[types[0]] * 1.4), triplePrice: round(b * rtMul[types[0]] * 1.8), quadPrice: 0,
      cnbPrice: 0, cwbPrice: round(b * 0.3), adultExtraBedPrice: round(b * 0.4), childExtraBedPrice: round(b * 0.25),
      currency: 'INR',
      startDate: d('2026-12-20'), endDate: d('2027-01-05'), status: 'Active',
    });
  }
  await HotelPrice.insertMany(rows);

  await Lead.insertMany([
    { name: 'Ananya Sharma', email: 'ananya@example.com', phone: '+91 98110 22334', hotelId: H[0]._id, hotelName: H[0].name,
      checkIn: d('2026-11-12'), checkOut: d('2026-11-15'), rooms: 1, adults: 2, children: 1, roomType: 'Premium', mealPlan: 'CP',
      message: 'Looking for a sea-facing room.', status: 'New' },
    { name: 'Rahul Verma', email: 'rahul.v@example.com', phone: '+91 99300 55667', hotelId: H[1]._id, hotelName: H[1].name,
      checkIn: d('2026-10-05'), checkOut: d('2026-10-09'), rooms: 2, adults: 4, children: 0, roomType: 'Suite', mealPlan: 'MAP',
      message: 'Family trip, need connecting rooms.', status: 'Contacted' },
  ]);

  console.log(`Seeded ${H.length} hotels, ${rows.length} prices, ${rts.length} room types, ${mps.length} meal plans.`);
  await mongoose.disconnect();
}
run().catch((e) => { console.error(e); process.exit(1); });
