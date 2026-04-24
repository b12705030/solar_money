/// <reference types="@types/google.maps" />

declare global {
  interface Window { google: typeof google; }
}

export function waitForGoogleMaps(): Promise<typeof google> {
  return new Promise((resolve, reject) => {
    if (window.google?.maps) { resolve(window.google); return; }
    const interval = setInterval(() => {
      if (window.google?.maps) { clearInterval(interval); resolve(window.google); }
    }, 100);
    setTimeout(() => { clearInterval(interval); reject(new Error('Google Maps API failed to load')); }, 10000);
  });
}

export function loadGoogleMapsAPI(apiKey: string): Promise<typeof google> {
  return new Promise((resolve, reject) => {
    if (window.google?.maps) { resolve(window.google); return; }
    if (document.querySelector('script[src*="maps.googleapis.com"]')) {
      waitForGoogleMaps().then(resolve).catch(reject);
      return;
    }
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places&language=zh-TW&loading=async`;
    script.async = true;
    script.defer = true;
    script.onload = () => waitForGoogleMaps().then(resolve).catch(reject);
    script.onerror = () => reject(new Error('Failed to load Google Maps API'));
    document.head.appendChild(script);
  });
}
