import { loadGoogleMapsAPI, waitForGoogleMaps } from './googleMapsLoader';

export interface PlacePrediction {
  placeId: string;
  description: string;
  mainText: string;
  secondaryText: string;
}

export interface PlaceDetails {
  lat: number;
  lon: number;
  formattedAddress: string;
}

let placesReady = false;

async function initPlaces() {
  if (placesReady) return;
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';
  await loadGoogleMapsAPI(apiKey);
  await waitForGoogleMaps();
  // Wait until the new Place classes are available
  let retries = 0;
  while (!(google.maps.places as any)?.AutocompleteSuggestion && retries++ < 30) {
    await new Promise(r => setTimeout(r, 100));
  }
  placesReady = true;
}

export async function getPlaceAutocomplete(input: string): Promise<PlacePrediction[]> {
  if (!input.trim()) return [];
  await initPlaces();

  const { suggestions } = await (google.maps.places as any).AutocompleteSuggestion
    .fetchAutocompleteSuggestions({
      input: input.trim(),
      language: 'zh-TW',
      includedRegionCodes: ['tw'],
    });

  return (suggestions as any[])
    .filter((s: any) => s.placePrediction != null)
    .map((s: any) => {
      const p = s.placePrediction;
      return {
        placeId: p.placeId,
        description: p.text?.text ?? p.mainText?.text ?? '',
        mainText: p.mainText?.text ?? p.text?.text ?? '',
        secondaryText: p.secondaryText?.text ?? '',
      };
    });
}

export async function getPlaceDetails(placeId: string): Promise<PlaceDetails> {
  await initPlaces();

  const place = new (google.maps.places as any).Place({ id: placeId });
  await place.fetchFields({ fields: ['location', 'formattedAddress'] });

  if (!place.location) throw new Error('Place location unavailable');

  return {
    lat: place.location.lat(),
    lon: place.location.lng(),
    formattedAddress: place.formattedAddress ?? '',
  };
}
