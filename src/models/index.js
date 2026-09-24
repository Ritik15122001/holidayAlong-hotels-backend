import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const hotelSchema = new Schema({
  name: { type: String, required: true, trim: true },
  slug: { type: String, unique: true, index: true },
  city: { type: String, required: true, trim: true, index: true },
  location: { type: String, required: true, trim: true },
  starCategory: { type: Number, required: true, min: 1, max: 5, index: true },
  description: { type: String, default: '' },
  images: { type: [String], default: [] },
  amenities: { type: [String], default: [] },
  address: { type: String, default: '' },
  phone: { type: String, default: '' },
  email: { type: String, default: '' },
  website: { type: String, default: '' },
  rating: { type: Number, default: 4.5 },
  checkIn: { type: String, default: '14:00' },
  checkOut: { type: String, default: '11:00' },
  vendorId: { type: Schema.Types.ObjectId, ref: 'Vendor', index: true },
  status: { type: String, enum: ['Active', 'Inactive'], default: 'Active', index: true },
}, { timestamps: true });

hotelSchema.pre('validate', function (next) {
  if (!this.slug && this.name) {
    this.slug = this.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + Math.random().toString(36).slice(2, 6);
  }
  next();
});

const roomTypeSchema = new Schema({
  name: { type: String, required: true, unique: true, trim: true },
  description: { type: String, default: '' },
  status: { type: String, enum: ['Active', 'Inactive'], default: 'Active' },
}, { timestamps: true });

const mealPlanSchema = new Schema({
  code: { type: String, required: true, unique: true, uppercase: true, trim: true },
  name: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  status: { type: String, enum: ['Active', 'Inactive'], default: 'Active' },
}, { timestamps: true });

const hotelPriceSchema = new Schema({
  hotelId: { type: Schema.Types.ObjectId, ref: 'Hotel', required: true, index: true },
  roomTypeId: { type: Schema.Types.ObjectId, ref: 'RoomType', required: true },
  mealPlanId: { type: Schema.Types.ObjectId, ref: 'MealPlan', required: true },
  singlePrice: { type: Number, default: 0, min: 0 },
  doublePrice: { type: Number, default: 0, min: 0 },
  triplePrice: { type: Number, default: 0, min: 0 },
  quadPrice: { type: Number, default: 0, min: 0 },
  cnbPrice: { type: Number, default: 0, min: 0 },
  cwbPrice: { type: Number, default: 0, min: 0 },
  adultExtraBedPrice: { type: Number, default: 0, min: 0 },
  childExtraBedPrice: { type: Number, default: 0, min: 0 },
  currency: { type: String, default: 'INR' },
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  status: { type: String, enum: ['Active', 'Inactive'], default: 'Active', index: true },
}, { timestamps: true });

hotelPriceSchema.pre('validate', function (next) {
  if (this.startDate && this.endDate && this.endDate < this.startDate) {
    return next(new Error('End date must be after start date'));
  }
  next();
});

const leadSchema = new Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, trim: true, lowercase: true },
  phone: { type: String, required: true, trim: true },
  altPhone: { type: String, default: '', trim: true },
  address: { type: String, default: '', trim: true },
  city: { type: String, default: '', trim: true },
  state: { type: String, default: '', trim: true },
  country: { type: String, default: 'India', trim: true },
  hotelId: { type: Schema.Types.ObjectId, ref: 'Hotel' },
  hotelName: { type: String, default: '' },
  checkIn: { type: Date },
  checkOut: { type: Date },
  rooms: { type: Number, default: 1 },
  adults: { type: Number, default: 2 },
  children: { type: Number, default: 0 },
  roomType: { type: String, default: '' },
  mealPlan: { type: String, default: '' },
  message: { type: String, default: '' },
  status: { type: String, enum: ['New', 'Contacted', 'Closed'], default: 'New', index: true },
}, { timestamps: true });

const userSchema = new Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, trim: true, lowercase: true, unique: true, index: true },
  phone: { type: String, default: '', trim: true },
  passwordHash: { type: String, required: true },
  status: { type: String, enum: ['Active', 'Blocked'], default: 'Active', index: true },
  lastLoginAt: { type: Date },
}, { timestamps: true });

const citySchema = new Schema({
  name: { type: String, required: true, trim: true, index: true },
  state: { type: String, default: '', trim: true },
  country: { type: String, default: 'India', trim: true },
  status: { type: String, enum: ['Active', 'Inactive'], default: 'Active', index: true },
}, { timestamps: true });
citySchema.index({ name: 1, state: 1 }, { unique: true });

const locationSchema = new Schema({
  name: { type: String, required: true, trim: true },
  cityId: { type: Schema.Types.ObjectId, ref: 'City', required: true, index: true },
  status: { type: String, enum: ['Active', 'Inactive'], default: 'Active', index: true },
}, { timestamps: true });
locationSchema.index({ name: 1, cityId: 1 }, { unique: true });

const vendorSchema = new Schema({
  companyName: { type: String, required: true, trim: true, index: true },
  contactPerson: { type: String, default: '', trim: true },
  phones: { type: [String], default: [] },
  emails: { type: [String], default: [] },
  website: { type: String, default: '', trim: true },
  vendorType: {
    type: String,
    enum: ['Cab', 'Hotel', 'Flight', 'Bus', 'Activities', 'Cruises', 'Visa', 'Insurance'],
    required: true, index: true,
  },
  sectors: { type: [String], default: [] },   // e.g. ['Delhi', 'Rajasthan']
  // Finance details — admin only, never exposed on the public site.
  gstPan: { type: String, default: '', trim: true },
  accountNumber: { type: String, default: '', trim: true },
  bankName: { type: String, default: '', trim: true },
  ifsc: { type: String, default: '', trim: true, uppercase: true },
  upi: { type: String, default: '', trim: true },
  status: { type: String, enum: ['Active', 'Inactive'], default: 'Active', index: true },
}, { timestamps: true });

const brochureSchema = new Schema({
  title: { type: String, required: true, trim: true },
  region: { type: String, default: '', trim: true },
  fileUrl: { type: String, required: true, trim: true },   // link to the PDF
  sortOrder: { type: Number, default: 0 },
  status: { type: String, enum: ['Active', 'Inactive'], default: 'Active', index: true },
}, { timestamps: true });

const formatSchema = new Schema({
  title: { type: String, required: true, trim: true },
  group: { type: String, default: 'General', trim: true },
  body: { type: String, required: true },
  sortOrder: { type: Number, default: 0 },
  status: { type: String, enum: ['Active', 'Inactive'], default: 'Active', index: true },
}, { timestamps: true });

export const Format = model('Format', formatSchema);
export const Brochure = model('Brochure', brochureSchema);
export const Vendor = model('Vendor', vendorSchema);
export const City = model('City', citySchema);
export const Location = model('Location', locationSchema);
export const User = model('User', userSchema);
export const Hotel = model('Hotel', hotelSchema);
export const RoomType = model('RoomType', roomTypeSchema);
export const MealPlan = model('MealPlan', mealPlanSchema);
export const HotelPrice = model('HotelPrice', hotelPriceSchema);
export const Lead = model('Lead', leadSchema);
