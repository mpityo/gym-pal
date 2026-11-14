/**
 * Live heart rate over Bluetooth (Web Bluetooth, Chrome on Android).
 *
 * Uses the standard Bluetooth Heart Rate profile (service 0x180D,
 * characteristic 0x2A37). Chest straps and arm bands speak it out of the box.
 * A Galaxy Watch does not broadcast it by default — it needs a heart-rate
 * broadcast app installed on the watch first (search the Galaxy Store or Play
 * Store on the watch for "heart rate broadcast" / "BLE heart rate"). Once the
 * watch is advertising, it shows up in the picker here like any strap.
 */

let device = null;
let characteristic = null;
const listeners = new Set();
let lastBpm = null;
let lastAt = 0;

export function supported() {
  return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
}

export function connected() {
  return Boolean(device?.gatt?.connected);
}

export function deviceName() {
  return device?.name ?? null;
}

export function latest() {
  return Date.now() - lastAt < 15000 ? lastBpm : null;
}

export function onHeartRate(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(bpm) {
  lastBpm = bpm;
  lastAt = Date.now();
  for (const fn of listeners) fn(bpm);
}

/** Heart Rate Measurement: flags bit 0 says whether the value is 8 or 16 bit. */
export function parseMeasurement(dataView) {
  const flags = dataView.getUint8(0);
  return flags & 0x1 ? dataView.getUint16(1, true) : dataView.getUint8(1);
}

export async function connect() {
  if (!supported()) throw new Error('This browser cannot use Bluetooth. Use Chrome on Android.');
  device = await navigator.bluetooth.requestDevice({ filters: [{ services: ['heart_rate'] }] });
  device.addEventListener('gattserverdisconnected', () => {
    emit(null);
    // One quiet reconnect attempt: watches drop the link when the screen sleeps.
    setTimeout(() => {
      if (device && !device.gatt.connected) subscribe().catch(() => {});
    }, 2000);
  });
  await subscribe();
  return device.name;
}

async function subscribe() {
  const server = await device.gatt.connect();
  const service = await server.getPrimaryService('heart_rate');
  characteristic = await service.getCharacteristic('heart_rate_measurement');
  characteristic.addEventListener('characteristicvaluechanged', (e) => {
    const bpm = parseMeasurement(e.target.value);
    if (bpm > 0) emit(bpm);
  });
  await characteristic.startNotifications();
}

export function disconnect() {
  try {
    device?.gatt?.disconnect();
  } catch {
    /* already gone */
  }
  device = null;
  characteristic = null;
  emit(null);
}
