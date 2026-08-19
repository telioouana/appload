"use server"

import { getLocale } from "@workspace/i18n/server"
import { Client, TravelMode, UnitSystem } from "@googlemaps/google-maps-services-js"

const client = new Client()

export async function autoComplete(input: string) {
    const locale = await getLocale()
    if (!input) return []

    try {
        const response = await client.placeAutocomplete({
            params: {
                input,
                key: process.env.GOOGLE_MAPS_API_KEY!,
                language: locale,
            }
        })

        return response.data.predictions
    } catch (error) {
        console.log(error)
    }
}

export async function distanceCalculator(origins: string, destinations: string) {
    const locale = await getLocale()
    try {
        const response = await client.distancematrix({
            params: {
                origins: [`place_id:${origins}`],
                destinations: [`place_id:${destinations}`],
                mode: TravelMode.driving,
                key: process.env.GOOGLE_MAPS_API_KEY!,
                language: locale,
                units: UnitSystem.metric,
            }
        })

        return response.data.rows
    } catch (error) {
        console.log(error)
    }
}

export async function getLocation(place_id: string) {
    try {
        const response = await client.geocode({
            params: {
                place_id,
                key: process.env.GOOGLE_MAPS_API_KEY!,
            }
        })

        return response.data.results
    } catch (error) {
        console.log(error)
    }
}

/**
 * Determines trip direction for Mozambique Logistics.
 * * LOGIC:
 * 1. ELEVATION (CLIMB): If gaining > 30m (e.g., Maputo -> Ressano), it's NORMAL.
 * 2. DIRECTION (SOUTH): Moving South (e.g., Beira -> Xinavane) is BACKLOAD.
 * 3. HUB START: If Northbound/Flat AND starting at a Port, it's NORMAL.
 * 4. TIE-BREAKER: Northbound is NORMAL, Southbound is BACKLOAD.
 * * Result for Beira -> Xinavane: BACKLOAD (Direction is Southward).
 * Result for Nampula -> Beira: BACKLOAD (Descending & Southward).
 */
export async function getLogisticsTripType(origins: string, destinations: string) {
    const PRIMARY_HUBS = ["beira", "nacala", "maputo", "matola", "ressano garcia", "pemba", "quelimane"];

    try {
        const [originDetails, destinationDetails] = await Promise.all([
            client.placeDetails({ 
                params: { 
                    place_id: origins, 
                    fields: ['geometry', 'address_components', 'name'], 
                    key: process.env.GOOGLE_MAPS_API_KEY! 
                } 
            }),
            client.placeDetails({ 
                params: { 
                    place_id: destinations, 
                    fields: ['geometry', 'address_components', 'name'], 
                    key: process.env.GOOGLE_MAPS_API_KEY! 
                } 
            })
        ]);

        const originRes = originDetails.data.result;
        const destRes = destinationDetails.data.result;
        const originLoc = originRes.geometry?.location;
        const destLoc = destRes.geometry?.location;
        const originName = originRes.name?.toLowerCase() ?? "";

        if (!originLoc || !destLoc) throw new Error("Missing coordinates");

        const elevationResponse = await client.elevation({
            params: { locations: [originLoc, destLoc], key: process.env.GOOGLE_MAPS_API_KEY! }
        });

        const eStart = elevationResponse.data.results[0]?.elevation;
        const eEnd = elevationResponse.data.results[1]?.elevation;
        if (eStart === undefined || eEnd === undefined) throw new Error("Missing elevation data");
        const elevationDiff = eEnd - eStart;

        // --- UPDATED HIERARCHY ---
        let tripType: "NORMAL" | "BACKLOAD";

        const isMovingSouth = destLoc.lat < originLoc.lat;
        const isSignificantClimb = elevationDiff > 30;
        const isStartingAtHub = (originRes.address_components?.some(c => 
            PRIMARY_HUBS.some(hub => c.long_name.toLowerCase().includes(hub))
        ) || PRIMARY_HUBS.some(hub => originName.includes(hub)));

        // 1. If it's a heavy climb (e.g. Maputo to Ressano), it's always NORMAL (Fuel cost).
        if (isSignificantClimb) {
            tripType = "NORMAL";
        }
        // 2. If it's moving South (e.g. Beira to Xinavane), it's a BACKLOAD.
        else if (isMovingSouth) {
            tripType = "BACKLOAD";
        }
        // 3. If it's Northbound/Flat and starts at a Port, it's NORMAL.
        else if (isStartingAtHub) {
            tripType = "NORMAL";
        }
        // 4. Default tie-breaker
        else {
            tripType = "NORMAL"; 
        }

        return {
            tripType,
            debug: { elevationDiff, isMovingSouth, isStartingAtHub }
        };

    } catch (error) {
        console.error("Logistics Calculation Error:", error);
        return { tripType: "NORMAL", error: true };
    }
}