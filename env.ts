import { defineEnv, string } from 'void/env';

export default defineEnv({
  // TMDB API-nyckel (v3) eller Read Access Token (v4, "eyJ...")
  TMDB_API_KEY: string(),
  // Skyddar /api/admin/* (scripts/update-ratings.ts). Minst 32 tecken,
  // till exempel: openssl rand -hex 32
  ADMIN_TOKEN: string(),
});
