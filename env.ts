import { defineEnv, string } from 'void/env';

export default defineEnv({
  // TMDB API-nyckel (v3) eller Read Access Token (v4, "eyJ...")
  TMDB_API_KEY: string(),
});
