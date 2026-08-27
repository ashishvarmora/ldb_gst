/**
 * Toll-plaza names are free text, so "which state is this truck in" has to be
 * inferred from the name. This is a keyword table, not a boundary lookup: it is
 * good enough for "entered Maharashtra" style alerts and it is honest about
 * being a guess. Officers can always override the keyword list on a rule.
 *
 * Keep entries lowercase; matching is substring, case-insensitive.
 */

export type StateName =
  | "Gujarat"
  | "Maharashtra"
  | "Rajasthan"
  | "Madhya Pradesh"
  | "Delhi"
  | "Haryana"
  | "Punjab"
  | "Uttar Pradesh"
  | "Karnataka"
  | "Tamil Nadu";

const STATE_KEYWORDS: Record<StateName, string[]> = {
  Gujarat: [
    "ahmedabad", "amreli", "anand", "ankleshwar", "bharuch", "bhavnagar", "bhatia",
    "bhuj", "chorasi", "choryasi", "dahod", "deesa", "gandhidham", "gandhinagar",
    "godhra", "halol", "himmatnagar", "jamnagar", "junagadh", "kadi", "kalol",
    "kamrej", "kandla", "kheda", "mahesana", "mehsana", "morbi", "mundra", "nadiad",
    "navsari", "palanpur", "patan", "porbandar", "rajkot", "sanand", "surat",
    "surendranagar", "vadodara", "valsad", "vapi", "veraval", "viramgam", "gujarat",
  ],
  Maharashtra: [
    "amravati", "aurangabad", "bhiwandi", "boisar", "charoti", "dhule", "igatpuri",
    "jalgaon", "kalyan", "kolhapur", "latur", "mumbai", "nagpur", "nashik", "nasik",
    "navi mumbai", "panvel", "pune", "sangli", "satara", "solapur", "talasari",
    "thane", "vashi", "khed", "shirwal", "maharashtra",
  ],
  Rajasthan: [
    "abu road", "ajmer", "alwar", "banswara", "beawar", "bhilwara", "bikaner",
    "chittorgarh", "dungarpur", "jaipur", "jaisalmer", "jhalawar", "jodhpur",
    "kishangarh", "kota", "nathdwara", "pali", "shahpura", "sikar", "udaipur",
    "rajasthan",
  ],
  "Madhya Pradesh": [
    "bhopal", "burhanpur", "dewas", "dhar", "gwalior", "indore", "jabalpur",
    "khandwa", "khargone", "neemuch", "ratlam", "rewa", "sagar", "satna", "shivpuri",
    "ujjain", "vidisha", "madhya pradesh",
  ],
  Delhi: ["delhi", "new delhi", "badarpur", "kundli"],
  Haryana: [
    "ambala", "bahadurgarh", "faridabad", "gurgaon", "gurugram", "hisar", "karnal",
    "kurukshetra", "manesar", "panipat", "rewari", "rohtak", "sonipat", "haryana",
  ],
  Punjab: [
    "amritsar", "bathinda", "jalandhar", "ludhiana", "mohali", "patiala",
    "pathankot", "punjab",
  ],
  "Uttar Pradesh": [
    "agra", "aligarh", "allahabad", "bareilly", "ghaziabad", "gorakhpur", "jhansi",
    "kanpur", "lucknow", "mathura", "meerut", "moradabad", "noida", "prayagraj",
    "varanasi", "uttar pradesh",
  ],
  Karnataka: [
    "bangalore", "bengaluru", "belgaum", "belagavi", "bellary", "davangere",
    "dharwad", "gulbarga", "hubli", "hubballi", "mangalore", "mysore", "mysuru",
    "tumkur", "karnataka",
  ],
  "Tamil Nadu": [
    "chennai", "coimbatore", "erode", "hosur", "krishnagiri", "madurai", "salem",
    "tiruchirappalli", "trichy", "tirunelveli", "vellore", "tamil nadu",
  ],
};

export const STATE_NAMES = Object.keys(STATE_KEYWORDS) as StateName[];

/** Best guess at the state a toll plaza sits in, or null when unrecognised. */
export function stateFromLocation(locName: string | null | undefined): StateName | null {
  if (!locName) return null;
  const text = locName.toLowerCase();

  for (const state of STATE_NAMES) {
    for (const keyword of STATE_KEYWORDS[state]) {
      if (text.includes(keyword)) return state;
    }
  }
  return null;
}

/**
 * Cities officers most often want an "approaching" alert for, with the toll
 * keywords that ring the city. Used to prefill the alert-rule form.
 */
export const CITY_APPROACH_PRESETS: { city: string; tolls: string[] }[] = [
  { city: "Ahmedabad", tolls: ["ahmedabad", "sanand", "bavla", "kheda", "nadiad", "viramgam", "kadi"] },
  { city: "Surat", tolls: ["surat", "choryasi", "chorasi", "kamrej", "bhatia", "kim", "hazira"] },
  { city: "Vadodara", tolls: ["vadodara", "anand", "halol", "bharuch", "padra"] },
  { city: "Rajkot", tolls: ["rajkot", "morbi", "gondal", "jetpur", "chotila"] },
  { city: "Gandhidham / Kandla", tolls: ["gandhidham", "kandla", "mundra", "bhuj", "anjar"] },
  { city: "Mumbai", tolls: ["mumbai", "thane", "vashi", "panvel", "charoti", "talasari"] },
];

/** Human label for a matched keyword list, e.g. for an alert message. */
export function matchedKeyword(locName: string | null, keywords: string[]): string | null {
  if (!locName) return null;
  const text = locName.toLowerCase();
  for (const keyword of keywords) {
    const needle = keyword.trim().toLowerCase();
    if (needle && text.includes(needle)) return keyword;
  }
  return null;
}
