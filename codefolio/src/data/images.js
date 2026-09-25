// All photos are from Unsplash (free to use). IDs verified to resolve.
export const unsplash = (id, w = 900, h) =>
  `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${w}${h ? `&h=${h}` : ''}&q=70`

export const PHOTOS = {
  // community / events
  laptopsTeam: 'photo-1531482615713-2afd69097998',
  openOffice: 'photo-1504384308090-c894fdcc538d',
  teamTable: 'photo-1522071820081-009f0129c71c',
  workshopRoom: 'photo-1556761175-b413da4baf72',
  confHall: 'photo-1511578314322-379afb476865',
  highFive: 'photo-1600880292203-757bb62b4baf',
  friends: 'photo-1529156069898-49953e39b3ac',
  conference: 'photo-1540575467063-178a50c2df87',
  speaker: 'photo-1475721027785-f74eccf877e2',
  audience: 'photo-1505373877841-8d25f7d46678',
  crowd: 'photo-1523580494863-6f3031224c94',
  meeting: 'photo-1552664730-d307ca884978',
  planning: 'photo-1528605248644-14dd04022da1',
  // code
  codeLaptop: 'photo-1517694712202-14dd9538aa97',
  codeDesk: 'photo-1498050108023-c5249f4df085',
  codeScreen: 'photo-1555066931-4365d14bab8c',
  codeDark: 'photo-1461749280684-dccba630e2f6',
  codeMac: 'photo-1587620962725-abab7fe55159',
  techTeam: 'photo-1519389950473-47ba0277781c',
  // cities
  bengaluru: 'photo-1596176530529-78163a4f7af2',
  mumbai: 'photo-1570168007204-dfb528c6958f',
  delhi: 'photo-1587474260584-136574528ed5',
  kolkata: 'photo-1558431382-27e303142255',
  chennai: 'photo-1582510003544-4d00b7f74220',
}

// Fallback art per category, rotated deterministically by id so neighbouring
// cards don't repeat the same photo.
const FALLBACKS = {
  hackathon: ['laptopsTeam', 'codeDark', 'highFive', 'codeMac', 'techTeam', 'codeScreen'],
  workshop: ['workshopRoom', 'teamTable', 'codeLaptop', 'openOffice', 'codeDesk', 'planning'],
  gdg: ['conference', 'speaker', 'audience', 'confHall', 'crowd', 'friends', 'meeting'],
}

export function fallbackImage(category = 'gdg', seed = '') {
  const list = FALLBACKS[category] || FALLBACKS.gdg
  let h = 0
  for (const ch of String(seed)) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return unsplash(PHOTOS[list[h % list.length]], 800, 480)
}
