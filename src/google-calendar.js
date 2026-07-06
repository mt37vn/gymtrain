const { google } = require('googleapis');
const { getParams, saveParams } = require('./params');

const SCOPES = ['https://www.googleapis.com/auth/calendar'];

function getOAuth2Client() {
  const params = getParams();
  const clientId = params.google_client_id;
  const clientSecret = params.google_client_secret;
  if (!clientId || !clientSecret) return null;
  return new google.auth.OAuth2(clientId, clientSecret, 'http://localhost:3000/api/google/callback');
}

function getAuthUrl() {
  const oauth2Client = getOAuth2Client();
  if (!oauth2Client) return null;
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES
  });
}

async function handleCallback(code) {
  const oauth2Client = getOAuth2Client();
  if (!oauth2Client) throw new Error('google_client_id and google_client_secret not configured');
  const { tokens } = await oauth2Client.getToken(code);
  if (!tokens.refresh_token) throw new Error('No refresh token received. Ensure access_type=offline and prompt=consent.');
  saveParams({ google_refresh_token: tokens.refresh_token, google_token_expiry: tokens.expiry_date });
  return true;
}

async function getCalendarClient() {
  const params = getParams();
  const calendarId = params.google_calendar_id;
  if (!calendarId) throw new Error('google_calendar_id not configured');

  const refreshToken = params.google_refresh_token;
  if (refreshToken) {
    const oauth2Client = getOAuth2Client();
    if (!oauth2Client) throw new Error('google_client_id and google_client_secret not configured');
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    return google.calendar({ version: 'v3', auth: oauth2Client });
  }

  const apiKey = params.google_api_key;
  if (apiKey) {
    return google.calendar({ version: 'v3', auth: apiKey });
  }

  throw new Error('No Google Calendar auth configured. Set google_client_id/google_client_secret and run /api/google/auth-url to authorize, or set google_api_key for read-only access.');
}

module.exports = { getAuthUrl, handleCallback, getCalendarClient };
