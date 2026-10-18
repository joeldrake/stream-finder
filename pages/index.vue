<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, shallowRef } from "vue";
import { SERVICES, type CatalogIndex, type ServiceName } from "../src/catalog/format";
import { registerServiceWorker } from "../src/register-sw";
import { indexedDbStore, loadCatalog } from "../src/search/catalog-cache";
import { createCatalogSearch, MIN_QUERY_LENGTH, type CatalogSearch } from "../src/search/catalog-search";
import type { SyncStatus } from "../src/sync";
import { PIN_LENGTH } from "../src/sync-pin";

const SERVICE_LABELS: Record<ServiceName, string> = {
  svt: "SVT Play",
  netflix: "Netflix",
  disney: "Disney+",
  hbomax: "HBO Max",
};

const query = ref("");
const focused = ref(false);
const input = ref<HTMLInputElement>();
const catalog = shallowRef<CatalogSearch>();
const loadError = ref(false);
// Bilder som inte gick att ladda, till exempel offline: visa initialen i stället.
const brokenPosters = reactive(new Set<string>());

// Sökrutan ligger i mitten tills man fokuserar den eller har skrivit något.
const active = computed(() => focused.value || query.value.length > 0);
const tooShort = computed(() => query.value.trim().length < MIN_QUERY_LENGTH);
const results = computed(() => catalog.value?.search(query.value) ?? []);

const status = computed(() => {
  if (loadError.value) return "Kunde inte ladda katalogen. Ladda om sidan för att försöka igen.";
  if (!catalog.value) return "Laddar katalogen…";
  if (!active.value) return `${catalog.value.size.toLocaleString("sv-SE")} filmer och serier`;
  if (tooShort.value) return "Skriv minst två tecken";
  if (results.value.length === 0) return `Inga träffar på ”${query.value.trim()}”`;
  return "";
});

function showCatalog(index: CatalogIndex) {
  if (index.version !== catalog.value?.version) catalog.value = createCatalogSearch(index);
}

onMounted(async () => {
  void registerServiceWorker();
  void fetchSyncStatus();
  window.addEventListener("online", () => brokenPosters.clear());
  try {
    await loadCatalog(showCatalog, indexedDbStore);
  } catch {
    loadError.value = true;
  }
});

// Synkning: knappen ber om PIN-koden och startar synkningen, och medan den pågår frågar vi efter status
// var 5:e sekund. När den är klar hämtas den nya katalogen.
const POLL_MS = 5000;
const sync = ref<SyncStatus>();
const syncStarting = ref(false);
const syncRequestError = ref("");
const syncing = computed(() => syncStarting.value || !!sync.value?.running);
const syncError = computed(() => syncRequestError.value || (!syncing.value && sync.value?.last?.error) || "");
let pollTimer: ReturnType<typeof setTimeout> | undefined;
onUnmounted(() => clearTimeout(pollTimer));

function applySyncStatus(next: SyncStatus) {
  const wasRunning = !!sync.value?.running;
  sync.value = next;
  clearTimeout(pollTimer);
  if (next.running) pollTimer = setTimeout(fetchSyncStatus, POLL_MS);
  else if (wasRunning) void loadCatalog(showCatalog, indexedDbStore).catch(() => {});
}

async function fetchSyncStatus() {
  try {
    const res = await fetch("/api/sync", { cache: "no-store" });
    if (res.ok) applySyncStatus((await res.json()) as SyncStatus);
  } catch {
    // Offline: knappen visas ändå, och nästa försök sker när man trycker.
  }
}

const pinOpen = ref(false);
const pin = ref("");
const pinInput = ref<HTMLInputElement>();

async function openPin() {
  pin.value = "";
  syncRequestError.value = "";
  pinOpen.value = true;
  await nextTick();
  pinInput.value?.focus();
}

function closePin() {
  pinOpen.value = false;
  pin.value = "";
}

// Synkningen startar när hela koden är inskriven.
function onPinInput() {
  if ([...pin.value].length >= PIN_LENGTH) void startSync(pin.value);
}

async function startSync(code: string) {
  if (syncing.value) return;
  syncStarting.value = true;
  syncRequestError.value = "";
  try {
    const res = await fetch("/api/sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pin: code }),
    });
    const body = (await res.json()) as Partial<SyncStatus> & { error?: string; retryAt?: string };
    if (res.status === 403) {
      // Fel kod: fältet står kvar så att man kan försöka igen.
      syncRequestError.value = "Fel PIN-kod";
      pin.value = "";
      await nextTick();
      pinInput.value?.focus();
      return;
    }
    closePin();
    if (res.status === 429 && body.retryAt) {
      syncRequestError.value = `För många försök, spärrad till ${formatTime(body.retryAt)}`;
    } else if (!res.ok && res.status !== 409) {
      // 409 betyder att en synkning redan pågår; den följer vi då i stället.
      syncRequestError.value = body.error ?? `Servern svarade ${res.status}`;
    }
    if (body.running !== undefined) applySyncStatus(body as SyncStatus);
  } catch {
    closePin();
    syncRequestError.value = "Kunde inte nå servern";
  } finally {
    syncStarting.value = false;
  }
}

const formatTime = (iso: string) => new Date(iso).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" });
const formatCount = (n: number) => n.toLocaleString("sv-SE");
const formatDate = (iso: string) =>
  new Date(iso).toLocaleString("sv-SE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

const formatRating = (rating: number) => rating.toLocaleString("sv-SE", { minimumFractionDigits: 1 });

function clear() {
  query.value = "";
  input.value?.blur();
}
</script>

<template>
  <main class="page" :class="{ active }">
    <header class="search">
      <h1 class="logo">Stream Finder</h1>
      <div class="field">
        <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          ref="input"
          v-model="query"
          type="search"
          placeholder="Sök film eller serie"
          aria-label="Sök film eller serie"
          autocomplete="off"
          spellcheck="false"
          @focus="focused = true"
          @blur="focused = false"
          @keydown.esc="clear"
        />
      </div>
      <p class="status" aria-live="polite">{{ status }}</p>
    </header>

    <ul v-if="active && !tooShort && results.length" class="results">
      <li v-for="hit in results" :key="hit.id" class="card">
        <component
          :is="hit.url ? 'a' : 'div'"
          :href="hit.url ?? undefined"
          :target="hit.url ? '_blank' : undefined"
          :rel="hit.url ? 'noopener' : undefined"
          class="link"
        >
          <div class="poster">
            <img
              v-if="hit.poster && !brokenPosters.has(hit.poster)"
              :src="hit.poster"
              alt=""
              loading="lazy"
              decoding="async"
              @error="brokenPosters.add(hit.poster)"
            />
            <span v-else class="placeholder" aria-hidden="true">{{ hit.title.slice(0, 1) }}</span>
          </div>
          <h2 class="title">{{ hit.title }}</h2>
        </component>
        <div class="meta">
          <p class="sub">
            {{ hit.series ? "Serie" : "Film" }}<template v-if="hit.year"> · {{ hit.year }}</template>
            <span v-if="hit.imdbRating" class="rating" :title="`IMDb-betyg ${formatRating(hit.imdbRating)}`">
              · <span aria-hidden="true">★</span> {{ formatRating(hit.imdbRating) }}</span
            >
          </p>
          <ul class="services">
            <li v-for="s in hit.services" :key="s">
              <a
                v-if="s === 'svt' && hit.svtUrl"
                :href="hit.svtUrl"
                class="pill"
                :class="s"
                target="_blank"
                rel="noopener"
                >{{ SERVICE_LABELS[s] }}</a
              >
              <span v-else class="pill" :class="s">{{ SERVICE_LABELS[s] }}</span>
            </li>
          </ul>
        </div>
      </li>
    </ul>

    <footer class="credits">
      <div v-if="catalog" class="sync">
        <span v-for="s in SERVICES" :key="s" class="count">{{ SERVICE_LABELS[s] }} {{ formatCount(catalog.serviceCounts[s]) }}</span>
        <span class="updated">
          <template v-if="syncing">Synkar…</template>
          <template v-else>Uppdaterad {{ formatDate(catalog.version) }}</template>
          <span v-if="syncError" class="sync-error" :title="syncError" role="status"
            >· {{ syncRequestError || "senaste synken gav fel" }}</span
          >
          <input
            v-if="pinOpen"
            ref="pinInput"
            v-model="pin"
            class="pin"
            type="password"
            :maxlength="PIN_LENGTH"
            placeholder="PIN"
            aria-label="PIN-kod för att synka"
            autocomplete="off"
            :disabled="syncing"
            @input="onPinInput"
            @keydown.esc="closePin"
          />
          <button
            type="button"
            class="sync-button"
            :class="{ spinning: syncing }"
            :disabled="syncing"
            :title="syncing ? 'Synkar…' : 'Synka nu'"
            :aria-label="syncing ? 'Synkar' : 'Synka nu'"
            @click="pinOpen ? closePin() : openPin()"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M20 12a8 8 0 1 1-2.34-5.66" />
              <path d="M20 4v5h-5" />
            </svg>
          </button>
        </span>
      </div>
      <p class="attribution">
        <a class="github-link" href="https://github.com/joeldrake/stream-finder" rel="noopener">
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="currentColor">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
          </svg>
          github.com/joeldrake/stream-finder
        </a>
      </p>
    </footer>
  </main>
</template>

<style>
:root {
  --bg: #f6f6f4;
  --surface: #ffffff;
  --text: #17171a;
  --muted: #6b6b73;
  --border: #e3e3e0;
  --ring: #3b5bdb;
  --shadow: 0 1px 2px rgb(0 0 0 / 0.04), 0 8px 24px rgb(0 0 0 / 0.06);
  color-scheme: light;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #111114;
    --surface: #1b1b20;
    --text: #f0f0f2;
    --muted: #9a9aa5;
    --border: #2c2c33;
    --ring: #7c95ff;
    --shadow: 0 1px 2px rgb(0 0 0 / 0.3), 0 8px 24px rgb(0 0 0 / 0.35);
    color-scheme: dark;
  }
}

* {
  box-sizing: border-box;
}

html {
  scrollbar-gutter: stable;
}

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font: 16px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
}
</style>

<style scoped>
.page {
  min-height: 100dvh;
  padding: 0 16px 48px;
}

.search {
  position: sticky;
  top: 0;
  z-index: 1;
  max-width: 720px;
  margin: 0 auto;
  padding: 16px 0 8px;
  background: linear-gradient(var(--bg) 85%, transparent);
}

/* På desktop är sökrutan centrerad i viloläget och glider upp vid sökning.
   På mobil ligger den längst upp från start. */
@media (min-width: 641px) {
  .search {
    transform: translateY(calc(50dvh - 50% - 8px));
    transition: transform 0.5s cubic-bezier(0.2, 0.8, 0.2, 1);
  }

  .page:not(.active) .search {
    background: none;
  }

  .active .search {
    transform: translateY(0);
  }
}

.logo {
  margin: 0 0 20px;
  text-align: center;
  font-size: 2rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  transition:
    opacity 0.3s ease,
    margin 0.5s cubic-bezier(0.2, 0.8, 0.2, 1),
    font-size 0.5s cubic-bezier(0.2, 0.8, 0.2, 1);
}

.active .logo {
  margin-bottom: 12px;
  font-size: 1.1rem;
  opacity: 0.7;
}

/* På mobil hålls loggan i ett läge så att sökrutan inte flyttar sig vid fokus. */
@media (max-width: 640px) {
  .logo,
  .active .logo {
    margin-bottom: 12px;
    font-size: 1.5rem;
    opacity: 1;
    transition: none;
  }
}

.field {
  position: relative;
}

.icon {
  position: absolute;
  left: 22px;
  top: 50%;
  width: 22px;
  height: 22px;
  transform: translateY(-50%);
  fill: none;
  stroke: var(--muted);
  stroke-width: 2;
  stroke-linecap: round;
  pointer-events: none;
}

input {
  width: 100%;
  height: 64px;
  padding: 0 24px 0 58px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface);
  color: var(--text);
  font: inherit;
  font-size: 1.2rem;
  box-shadow: var(--shadow);
  outline: none;
  transition:
    border-color 0.2s,
    box-shadow 0.2s;
  -webkit-appearance: none;
  appearance: none;
}

input::placeholder {
  color: var(--muted);
}

input:focus {
  border-color: var(--ring);
  box-shadow:
    var(--shadow),
    0 0 0 4px color-mix(in srgb, var(--ring) 18%, transparent);
}

input::-webkit-search-cancel-button {
  cursor: pointer;
}

.status {
  min-height: 1.45em;
  margin: 12px 0 0;
  text-align: center;
  color: var(--muted);
  font-size: 0.9rem;
}

.results {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 20px 16px;
  max-width: 1080px;
  margin: 8px auto 0;
  padding: 0;
  list-style: none;
  animation: fade-in 0.25s ease;
}

@keyframes fade-in {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
}

.card {
  min-width: 0;
}

.link {
  display: block;
  color: inherit;
  text-decoration: none;
}

a.link:hover .title {
  text-decoration: underline;
}

a.link:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 4px;
  border-radius: 14px;
}

.poster {
  display: grid;
  place-items: center;
  aspect-ratio: 2 / 3;
  overflow: hidden;
  border-radius: 14px;
  background: var(--border);
}

.poster img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.placeholder {
  color: var(--muted);
  font-size: 2.5rem;
  font-weight: 700;
}

.meta {
  padding: 0 2px;
}

.title {
  margin: 0;
  padding: 8px 2px 0;
  overflow: hidden;
  font-size: 0.95rem;
  font-weight: 600;
  line-height: 1.3;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.sub {
  margin: 2px 0 6px;
  color: var(--muted);
  font-size: 0.8rem;
}

.rating {
  color: var(--text);
  font-weight: 600;
}

.rating [aria-hidden] {
  color: #e0a100;
}

.credits {
  position: fixed;
  right: 0;
  bottom: 0;
  left: 0;
  padding: 10px 16px calc(10px + env(safe-area-inset-bottom, 0px));
  color: var(--muted);
  font-size: 0.72rem;
  text-align: center;
  transition: opacity 0.3s ease;
}

.credits a {
  color: inherit;
}

.attribution {
  margin: 0;
}

.github-link {
  display: inline-flex;
  align-items: center;
  gap: 0.35em;
}

.sync {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: center;
  gap: 2px 12px;
  margin-bottom: 6px;
  font-variant-numeric: tabular-nums;
}

.updated {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.sync-error {
  color: #c4111b;
  cursor: help;
}

.pin {
  width: 5.5em;
  height: 22px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface);
  color: var(--text);
  font: inherit;
  font-size: 0.72rem;
  letter-spacing: 0.2em;
  text-align: center;
  box-shadow: none;
}

.pin::placeholder {
  letter-spacing: normal;
}

.pin:focus {
  border-color: var(--ring);
  box-shadow: none;
}

.sync-button {
  display: inline-grid;
  place-items: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: none;
  color: inherit;
  cursor: pointer;
}

.sync-button:hover:not(:disabled) {
  color: var(--text);
  background: var(--border);
}

.sync-button:focus-visible {
  outline: 2px solid var(--ring);
}

.sync-button:disabled {
  cursor: default;
}

.sync-button svg {
  width: 13px;
  height: 13px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2.2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.spinning svg {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* Sidfoten syns bara i viloläget, så att den inte ligger över resultaten. */
.active .credits {
  opacity: 0;
  pointer-events: none;
}

.services {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.pill {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 999px;
  color: #fff;
  font-size: 0.7rem;
  font-weight: 600;
  text-decoration: none;
  white-space: nowrap;
}

a.pill:hover {
  filter: brightness(1.1);
}

.svt {
  background: #1e7b3c;
}
.netflix {
  background: #c4111b;
}
.disney {
  background: #1a3fb8;
}
.hbomax {
  background: #5a2bd0;
}

@media (prefers-reduced-motion: reduce) {
  .search,
  .logo,
  .results,
  .spinning svg {
    transition: none;
    animation: none;
  }
}
</style>
