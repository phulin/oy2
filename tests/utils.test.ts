import { strict as assert } from "node:assert";
import { test } from "node:test";
import { calculateDistance } from "../src/utils.ts";

test("calculateDistance", () => {
    // Distance between NY and LA is roughly 3936 km
    const ny = { lat: 40.7128, lon: -74.0060 };
    const la = { lat: 34.0522, lon: -118.2437 };

    const distance = calculateDistance(ny.lat, ny.lon, la.lat, la.lon);
    // It returns string, let's parse or check content
    // Expect ~3935.7km
    assert.match(distance, /39\d\d\.\dkm/);

    // Distance between two close points
    // 1 degree latitude is approx 111km
    const p1 = { lat: 40, lon: 0 };
    const p2 = { lat: 40.001, lon: 0 }; // 0.001 deg is approx 111m

    const closeDistance = calculateDistance(p1.lat, p1.lon, p2.lat, p2.lon);
    assert.match(closeDistance, /\d+m/);
    assert.ok(closeDistance.endsWith("m"));

    // Exact same point
    const zero = calculateDistance(40, 0, 40, 0);
    assert.equal(zero, "0m");
});
