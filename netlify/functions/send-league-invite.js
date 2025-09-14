// netlify/functions/send-league-invite.js
// Sends a league invite email via Netlify Emails (Mailgun) using the original league_invites table.
// Assumes you already have the RPC: create_league_invite(p_league uuid, p_max_uses int, p_expires timestamptz)

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
// Netlify provides URL in production; fallback to localhost for dev
const SITE_URL =
  process.env.URL ||
  process.env.DEPLOY_PRIME_URL ||
  process.env.DEPLOY_URL ||
  'http://localhost:8888';

const NETLIFY_EMAILS_SECRET = process.env.NETLIFY_EMAILS_SECRET;

// Use a verified sender from your Mailgun domain (configured in Netlify Emails)
const FROM_EMAIL = 'postmaster@sandboxdb6d53015ae44960a792dc878cded364.mailgun.org';
const FROM_NAME = 'DraftQueen Invites';

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }
    if (!event.body) {
      return { statusCode: 400, body: 'Missing body' };
    }

    const { league_id, email } = JSON.parse(event.body || '{}');
    if (!league_id || !email) {
      return { statusCode: 400, body: 'league_id and email required' };
    }

    // Caller must include their Supabase JWT (so we can enforce owner-only via RPC/RLS)
    const authHeader = event.headers.authorization || event.headers.Authorization || '';
    const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!jwt) return { statusCode: 401, body: 'Unauthorized' };

    // Supabase client impersonating the caller (RLS enforced)
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });

    // 1) Create an invite code via your owner-only RPC (this writes to league_invites)
    const { data: code, error: codeErr } = await supabase.rpc('create_league_invite', {
      p_league: league_id,
      p_max_uses: 100,
      p_expires: null,
    });
    if (codeErr || !code) {
      return { statusCode: 400, body: codeErr?.message || 'Invite create failed' };
    }

    // 2) Fetch details for template variables (optional but nice)
    const [{ data: lg }, { data: prof }, { data: userResp }] = await Promise.all([
      supabase.from('leagues').select('name').eq('id', league_id).maybeSingle(),
      supabase.from('profiles').select('username').limit(1).maybeSingle(),
      supabase.auth.getUser(),
    ]);
    const inviterFallback = userResp?.user?.email || 'A league owner';

    // 3) Build accept link that hits your invite-accept page
    const inviteLink = `${SITE_URL}/pages/invite-accept.html?code=${encodeURIComponent(code)}`;

    // 4) Send via Netlify Emails (uses /emails/invite/index.html template in your repo)
    const emailRes = await fetch(`${SITE_URL}/.netlify/functions/emails/invite`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'netlify-emails-secret': NETLIFY_EMAILS_SECRET,
      },
      body: JSON.stringify({
        from: { email: FROM_EMAIL, name: FROM_NAME },
        to: [{ email }],
        subject: `You're invited to join ${lg?.name || 'a DraftQueen league'}`,
        parameters: {
          league_name: lg?.name || 'Your League',
          inviter_name: prof?.username || inviterFallback,
          invite_link: inviteLink,
        },
      }),
    });

    if (!emailRes.ok) {
      const errTxt = await emailRes.text();
      // We don't write to league_invites here (RPC already did). Just surface the error.
      return { statusCode: 502, body: `Email send failed: ${errTxt.slice(0, 500)}` };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true }),
      headers: { 'content-type': 'application/json' },
    };
  } catch (e) {
    return { statusCode: 500, body: e?.message || 'Server error' };
  }
};