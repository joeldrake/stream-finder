/// <reference types="vite-plus/client" />
// Registrerar service workern (public/sw.js) i produktionsbygget. I dev
// skulle den cacha Vites moduler och ställa till det.
export async function registerServiceWorker(): Promise<void> {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.register("/sw.js");
    const worker = registration.active ?? (await navigator.serviceWorker.ready).active;
    // Filer som laddades innan service workern tog över cachas i efterhand.
    const urls = performance.getEntriesByType("resource").map((e) => e.name);
    worker?.postMessage({ type: "cache-assets", urls });
  } catch (error) {
    console.warn("Service worker kunde inte registreras", error);
  }
}
