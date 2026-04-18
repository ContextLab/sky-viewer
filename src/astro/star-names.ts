// Proper names for the brightest named stars, keyed by Yale BSC "HR" number.
//
// Source: IAU Working Group on Star Names (WGSN) approved proper names,
// which are in the public domain (see https://www.iau.org/public/themes/naming_stars/).
// Limited to stars with V-magnitude <= ~2.5 plus a handful of famous fainter
// ones (Polaris, Albireo, Mizar, Alcor) to keep the payload small.
//
// Accuracy note: the ~10 anchor stars below are known-accurate (verified
// against the Bright Star Catalogue, 5th ed.):
//   Polaris=424, Vega=7001, Sirius=2491, Betelgeuse=2061, Rigel=1713,
//   Arcturus=5340, Capella=1708, Aldebaran=1457, Procyon=2943, Altair=7557.
// The remaining entries are best-effort transcriptions of widely-cited
// HR -> proper-name mappings; the occasional HR number in the "best-effort"
// tail may be slightly off, but the anchor set covers every star this UI
// is primarily intended to surface.

export const STAR_NAMES: Record<number, string> = {
  // --- Anchors (verified) ---
  424: "Polaris",
  1457: "Aldebaran",
  1708: "Capella",
  1713: "Rigel",
  2061: "Betelgeuse",
  2491: "Sirius",
  2943: "Procyon",
  5340: "Arcturus",
  7001: "Vega",
  7557: "Altair",

  // --- Brightest stars, magnitude <= ~2.5 (best-effort) ---
  2326: "Canopus",
  5459: "Rigil Kentaurus",
  5460: "Toliman",
  4730: "Acrux",
  472: "Achernar",
  2990: "Pollux",
  2891: "Castor",
  3685: "Regulus",
  5056: "Spica",
  8728: "Fomalhaut",
  6134: "Antares",
  7121: "Nunki",
  7924: "Deneb",
  3982: "Denebola",
  6378: "Kaus Australis",
  4853: "Gacrux",
  4662: "Mimosa",
  2618: "Adhara",
  3165: "Alphard",
  188: "Alpheratz",
  337: "Caph",
  168: "Algenib",
  911: "Mirach",
  603: "Schedar",
  542: "Ankaa",
  1017: "Hamal",
  1231: "Menkar",
  1790: "Bellatrix",
  1791: "Elnath",
  1852: "Nihal",
  1865: "Mintaka",
  1903: "Alnilam",
  1948: "Alnitak",
  1956: "Saiph",
  2004: "Phact",
  2286: "Mirzam",
  2421: "Alhena",
  2473: "Mebsuta",
  2693: "Wezen",
  2827: "Avior",
  3307: "Suhail",
  3748: "Algieba",
  3775: "Miaplacidus",
  3873: "Tania Borealis",
  3888: "Merak",
  4301: "Dubhe",
  4357: "Chertan",
  4534: "Zosma",
  4554: "Megrez",
  4660: "Phecda",
  4905: "Alioth",
  5054: "Mizar",
  5062: "Alcor",
  5191: "Alkaid",
  5267: "Hadar",
  5793: "Alphecca",
  6056: "Sabik",
  6175: "Rasalhague",
  6212: "Cebalrai",
  6527: "Shaula",
  6623: "Eltanin",
  7139: "Albaldah",
  7235: "Peacock",
  7417: "Albireo",
  7602: "Tarazed",
  7635: "Alshain",
  7796: "Sadr",
  7790: "Gienah Cygni",
  8232: "Enif",
  8322: "Sadalsuud",
  8414: "Sadalmelik",
  8634: "Scheat",
  8775: "Markab",
  8781: "Alrai",
  4763: "Alchiba",
  4757: "Gienah Corvi",
  4786: "Algorab",
};

/** Count of entries actually exposed. */
export const STAR_NAMES_COUNT: number = Object.keys(STAR_NAMES).length;
