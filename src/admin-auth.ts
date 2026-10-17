// En gemensam hemlig token (ADMIN_TOKEN) skyddar /api/admin/*. Den används av
// scripts/update-ratings.ts, inte av webbläsaren.
const MIN_TOKEN_LENGTH = 32;

export function isAuthorized(authorization: string | undefined, token: string | undefined): boolean {
  if (!token || token.length < MIN_TOKEN_LENGTH || !authorization?.startsWith("Bearer ")) return false;
  return constantTimeEqual(authorization.slice("Bearer ".length), token);
}

// Jämför utan att avslöja via svarstiden hur många tecken som stämmer.
function constantTimeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}
