import nodemailer from 'nodemailer';

/**
 * Mail is optional. Without SMTP_HOST the app runs exactly as before and
 * every send is skipped with a reason, so a missing mail server can never
 * stop a booking being saved.
 */
const HOST = process.env.SMTP_HOST || '';
const PORT = Number(process.env.SMTP_PORT || 587);
const USER = process.env.SMTP_USER || '';
const PASS = process.env.SMTP_PASS || '';
const FROM = process.env.MAIL_FROM || USER;
const BCC = process.env.MAIL_BCC || '';

export const mailEnabled = () => Boolean(HOST && FROM);

let transport;
const getTransport = () => (transport ||= nodemailer.createTransport({
  host: HOST,
  port: PORT,
  secure: PORT === 465,            // 465 is implicit TLS, 587 upgrades with STARTTLS
  auth: USER ? { user: USER, pass: PASS } : undefined,
}));

const esc = (v) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const day = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

/** The booking format, as the rows a hotel expects to read. */
function bookingRows(lead) {
  const rows = [
    ['Guest Name', lead.name],
    ['Hotel Name', lead.hotelName],
    ['Check-in Date', day(lead.checkIn)],
    ['Check Out Date', day(lead.checkOut)],
  ];
  if (lead.reCheckIn || lead.reCheckOut) {
    rows.push(['Re-Check-in Date', day(lead.reCheckIn)], ['Re-Check Out Date', day(lead.reCheckOut)]);
  }
  rows.push(
    ['Total No. of Nights', lead.nights],
    ['No. of Adults (12+ Years)', lead.adults],
    ['No. of Rooms', lead.rooms],
    ['No. Of Extra Beds', lead.extraBeds],
    ['No. of Child with Bed', lead.childWithBed],
    ['No. of Child without Bed', lead.childNoBedAges],
    ['Room Type', lead.roomType],
    ['Meal Plan', lead.mealPlan],
    ['Extra Inclusions', lead.extraInclusions],
    ['Total Amount Payable To You', lead.totalAmount],
  );
  return rows.filter(([, v]) => v !== '' && v !== null && v !== undefined && v !== 0);
}

function render(lead) {
  const rows = bookingRows(lead).map(([k, v]) => `
      <tr>
        <td style="padding:8px 12px;border:1px solid #e2e8f0;background:#f8fafc;font-weight:600;width:46%">${esc(k)}</td>
        <td style="padding:8px 12px;border:1px solid #e2e8f0">${esc(v)}</td>
      </tr>`).join('');

  const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#0f172a;max-width:640px">
    <p>Dear Partner,</p>
    <p>Kindly confirm the below booking.</p>
    <table style="border-collapse:collapse;width:100%;font-size:14px">${rows}</table>
    <p>Kindly acknowledge this mail with your confirmation.</p>
    <p style="margin-top:18px">Warm regards,<br><strong>Team HolidayAlong</strong></p>
  </div>`;

  const text = ['Dear Partner,', '', 'Kindly confirm the below booking.', '',
    ...bookingRows(lead).map(([k, v]) => `${k}: ${v}`), '',
    'Kindly acknowledge this mail with your confirmation.', '', 'Warm regards,', 'Team HolidayAlong'].join('\n');

  return { html, text };
}

/**
 * Tell the hotel about a new booking. Never throws — the caller has already
 * saved the lead and a mail failure must not undo that.
 */
export async function sendBookingToHotel(lead, to) {
  if (!mailEnabled()) return { sent: false, reason: 'smtp_not_configured' };
  if (!to) return { sent: false, reason: 'hotel_has_no_email' };

  const { html, text } = render(lead);
  try {
    const info = await getTransport().sendMail({
      from: FROM,
      to,
      bcc: BCC || undefined,
      replyTo: lead.userEmail || undefined,
      subject: `Booking request — ${lead.hotelName || 'Hotel'} — ${lead.name} — ${day(lead.checkIn)}`,
      text,
      html,
    });
    return { sent: true, messageId: info.messageId };
  } catch (err) {
    return { sent: false, reason: err.message };
  }
}
