/**
 * Personal data that must never appear in a guide screenshot or its manifest.
 * Returns a list of short descriptions; empty means clean.
 */
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const HF_TOKEN = /\bhf_[A-Za-z0-9]{10,}/;
const USER_PATH = /[A-Z]:[\\/]+Users[\\/]+([^\\/\s"']+)/gi;
const HOME_PATH = /\/(?:Users|home)\/([^/\s"']+)/g;
const PHONE = /(?:\+84|\b0)(?:[\s.-]?\d){9,10}\b/;
/** Demo and system account names a screenshot may legitimately show. */
const NEUTRAL_USERS = new Set(['demo', 'public', 'default', 'runner']);

export function findPersonalData(text, { username = '' } = {}) {
  const found = [];
  const name = username.trim().toLowerCase();
  if (name.length >= 3 && !NEUTRAL_USERS.has(name) && text.toLowerCase().includes(name)) {
    found.push('Windows/OS user name');
  }
  // Fixture addresses on the reserved example.* domains are not personal data.
  const emails = (text.match(EMAIL) ?? []).filter(
    (email) => !/@example\.(com|org|net)$/i.test(email),
  );
  if (emails.length) found.push('e-mail address');
  if (HF_TOKEN.test(text)) found.push('Hugging Face token');
  for (const pattern of [USER_PATH, HOME_PATH]) {
    for (const match of text.matchAll(pattern)) {
      if (!NEUTRAL_USERS.has(match[1].toLowerCase())) {
        found.push(`user path (${match[0].slice(0, 3)}…)`);
        break;
      }
    }
  }
  if (PHONE.test(text)) found.push('phone number');
  return found;
}
