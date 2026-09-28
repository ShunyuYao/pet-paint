// Pure data only. Resource URLs come from the host's bound appearance handles;
// data JSON cannot introduce its own URL, local path or executable content.
const fields = ['front', 'back', 'frontBump', 'backBump', 'shape'];
const kinds = {top: ['sweater', 'tee', 'shirt'], bottom: ['denim', 'shorts', 'jeans']};
const own = (o, k) => Object.prototype.hasOwnProperty.call(o || {}, k);
function requireValue(ok) { if (!ok) throw Error('invalid_appearance'); }
function handle(assets, key) {
  requireValue(typeof key === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(key) && own(assets, key));
  const url = assets[key];
  requireValue(typeof url === 'string' && /^plugin:\/\/rat-doll-renderer\/__appearance__\/[A-Za-z0-9_%.-]+$/.test(url));
  return url;
}
export function decodeAppearance(appearance) {
  requireValue(appearance?.dataVersion === 2);
  const {data, assets} = appearance;
  requireValue(data && ['female', 'male'].includes(data.person));
  requireValue(Number.isFinite(data.headScale) && data.headScale >= .75 && data.headScale <= 2);
  const garments = {};
  for (const slot of ['top', 'bottom']) {
    const input = data.garments?.[slot];
    requireValue(input && kinds[slot].includes(input.kind));
    garments[slot] = {kind: input.kind, assets: Object.fromEntries(fields.map(field => [field, handle(assets, input.assets?.[field])]))};
  }
  return {person: data.person, headScale: data.headScale, headUrl: handle(assets, 'head'), garments,
    character: 'rat-doll-' + data.person};
}
export function validateShape(data) {
  requireValue(data && Array.isArray(data.outline) && data.outline.length >= 3 && data.outline.length <= 1024);
  requireValue(data.outline.every(p => Array.isArray(p) && p.length === 2 && p.every(v => Number.isFinite(v) && v >= 0 && v <= 1)));
  let distance = data.distance;
  requireValue(distance && Number.isInteger(distance.size) && distance.size >= 2 && distance.size <= 128);
  if (distance.bytes !== undefined) {
    const count = distance.size ** 2, encoded = distance.bytes;
    requireValue(distance.pixels === undefined && typeof encoded === 'string' && encoded.length === Math.ceil(count / 3) * 4);
    requireValue(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded));
    const decoded = atob(encoded);
    requireValue(decoded.length === count && btoa(decoded) === encoded);
    distance = {size: distance.size, pixels: Array.from(decoded, c => c.charCodeAt(0))};
  }
  requireValue(Array.isArray(distance.pixels) && distance.pixels.length === distance.size ** 2);
  requireValue(distance.pixels.every(v => Number.isFinite(v) && v >= 0 && v <= 255));
  return {...data, distance};
}
