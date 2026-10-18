# stream-finder

Sök bland filmer och serier på SVT Play, Netflix, Disney+ och HBO Max. Bakgrund och beslut står i [docs/PLAN.md](docs/PLAN.md).

Appen byggs med [Void](node_modules/void/docs/index.md) och körs på Cloudflare: en Worker, D1 (databasen), R2 (katalogfilen) och tre köer. Void skriver Cloudflare-konfigurationen utifrån koden och sköter deployen.

## Kom igång lokalt

Skapa `.env` med de variabler som står i [env.ts](env.ts):

```
TMDB_API_KEY=...
ADMIN_TOKEN=...
SYNC_PIN=...
```

Lägg inga andra `.env.*`-filer i roten, inte heller `.env.example`, för då vägrar Void bygga.

```sh
pnpm install
pnpm dev     # http://localhost:5173, tryck på synkknappen i sidfoten för att fylla katalogen
pnpm test
```

## Kommandon

| Kommando | Gör |
| --- | --- |
| `pnpm release` | Bygger och deployar till Cloudflare, och kör nya D1-migrationer |
| `pnpm status` | Visar deployade versioner och vilken som är live |
| `pnpm logs` | Visar loggar från Workern i produktionen |
| `pnpm secrets` | Listar vilka hemligheter som är satta i produktionen (inte värdena) |
| `pnpm void secret put <NAMN>` | Sätter eller byter en hemlighet i produktionen |
| `pnpm void secret sync .env` | Skickar alla värden i `.env` till produktionen |
| `pnpm ratings:update` | Uppdaterar IMDb-betygen, se [scripts/update-ratings.ts](scripts/update-ratings.ts) |

`void` är installerat i projektet, inte globalt, så kör det alltid via `pnpm void …`. Alla kommandon visas med `pnpm void --help`. Dokumentationen följer med paketet: [CLI](node_modules/void/docs/reference/cli.md), [deploy](node_modules/void/docs/guide/deployment.md) och [hemligheter](node_modules/void/docs/guide/env-vars.md).

