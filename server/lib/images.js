'use strict';

/**
 * Photography manifest.
 *
 * Every image is real photography. No illustration, no clip art, no emoji.
 * The set is deliberately balanced across Black British, South Asian, East Asian,
 * mixed race and white couples. The `rep` field is an internal audit note and is
 * never rendered. Alt text describes the scene and never labels anyone's ethnicity.
 */

const U = (photo, w) => `https://images.unsplash.com/${photo}?w=${w}&q=80&auto=format&fit=crop`;
// Unsplash serves its "plus" library from a different host.
const P = (photo, w) => `https://plus.unsplash.com/${photo}?w=${w}&q=80&auto=format&fit=crop`;

const hero = [
  {
    url: U('photo-1508905309331-76b1d900af31', 1600),
    alt: 'Newlywed couple laughing as guests shower them with confetti outdoors',
    rep: 'white',
  },
  {
    url: U('photo-1754782915842-aa4fca6c203a', 1600),
    alt: 'Couple showered with flower petals during a joyful outdoor celebration',
    rep: 'south-asian',
  },
  {
    url: U('photo-1594425437587-e75c19ebf332', 1600),
    alt: 'Couple holding each other closely and laughing in warm afternoon light',
    rep: 'black',
  },
];

const couples = [
  { url: U('photo-1665960213508-48f07086d49c', 1200), alt: 'Bride and groom in traditional attire smiling warmly at their wedding', rep: 'south-asian' },
  { url: U('photo-1741201864879-c5e7f81c98b0', 1200), alt: 'Couple celebrating during a Hindu wedding ceremony', rep: 'south-asian' },
  { url: U('photo-1719499683843-721331f2495f', 1200), alt: 'Portrait of a couple in wedding attire in bright natural light', rep: 'mixed' },
  { url: U('photo-1664646449735-69bc987a49da', 1200), alt: 'Couple holding hands at their outdoor wedding, smiling and relaxed', rep: 'black' },
  { url: U('photo-1579227638706-d1e85cb8960f', 1200), alt: 'Couple holding balloons and smiling in a green outdoor setting', rep: 'east-asian' },
  { url: U('photo-1665258608444-54f857b2ed8c', 1200), alt: 'Smiling couple embracing in a bright outdoor ceremony setting', rep: 'black' },
];

const categoryTiles = {
  // Ceremony and venue
  venues: {
    url: U('photo-1761110787206-2cc164e4913c', 1200),
    alt: 'Ballroom with chandeliers and dressed tables set for a wedding reception',
  },
  'marquees-and-tipis': {
    url: U('photo-1675376616537-c8aa9ddc9977', 1200),
    alt: 'A large wedding marquee set up outdoors with draped fabric and event styling inside',
  },
  'celebrants-and-officiants': {
    url: U('photo-1768611873586-52db3c0a6963', 1200),
    alt: 'A couple signing their marriage documents during a ceremony',
    rep: 'mixed',
  },

  // Food and drink
  catering: {
    url: P('premium_photo-1681841364476-8ae10f8f93b0', 1200),
    alt: 'A grazing table of colourful canapes being served at a wedding reception',
  },
  'cakes-and-desserts': {
    url: U('photo-1769230366307-ed3b9ccb6b4b', 1200),
    alt: 'A three tiered wedding cake decorated with small white flowers',
  },
  'bar-and-drinks': {
    url: U('photo-1763771757330-3212b518e31c', 1200),
    alt: 'A bartender working behind a bar stocked with bottles at an event',
    rep: 'black',
  },

  // Photography and film
  photography: {
    url: U('photo-1629756048377-09540f52caa1', 1200),
    alt: 'Wedding photographer holding a professional camera during a ceremony',
  },
  videography: {
    url: U('photo-1763598811139-175c9ad6b96b', 1200),
    alt: 'A videographer filming with a cinema camera on a stabiliser at an outdoor event',
  },

  // Styling and decor
  'decor-and-florals': {
    url: U('photo-1502635385003-ee1e6a1a742d', 1200),
    alt: 'Floral centrepiece with roses and greenery on a dressed wedding table',
  },
  'mandap-and-stage': {
    url: U('photo-1587271636175-90d58cdad458', 1200),
    alt: 'A ceremony taking place beneath a decorated floral canopy',
    rep: 'south-asian',
  },
  'lighting-and-production': {
    url: U('photo-1516450360452-9312f5e86fc7', 1200),
    alt: 'A busy wedding dance floor under warm coloured lighting',
    rep: 'mixed',
  },

  // Entertainment
  'bands-and-live-music': {
    url: U('photo-1775126964224-99c03c0e439c', 1200),
    alt: 'A guitarist performing on stage at a wedding reception',
  },
  djs: {
    url: U('photo-1772187727779-fdcdde1b307d', 1200),
    alt: 'A DJ mixing on turntables with coloured lights and a crowd behind',
    rep: 'black',
  },
  'cultural-performers': {
    url: U('photo-1759253139451-e27dd04b1cb4', 1200),
    alt: 'A dhol player drumming for a crowd at a celebration',
    rep: 'south-asian',
  },

  // Attire and beauty
  'hair-and-makeup': {
    url: U('photo-1773688199710-040ad7ddac18', 1200),
    alt: 'Bride having professional makeup applied before her ceremony',
  },
  'mehndi-artists': {
    url: U('photo-1767607740740-25ef7ca4342b', 1200),
    alt: 'A mehndi artist applying an intricate henna design to a bride\'s hand',
    rep: 'south-asian',
  },
  'bridalwear-and-tailoring': {
    url: U('photo-1591253368336-a4409e39df7b', 1200),
    alt: 'A couple in wedding attire standing beside a floral display in a bridal boutique',
    rep: 'mixed',
  },
  jewellery: {
    url: U('photo-1600685890506-593fdf55949b', 1200),
    alt: 'A bride wearing an ornate traditional gold crown and bridal jewellery',
    rep: 'south-asian',
  },

  // Planning
  planners: {
    url: U('photo-1666305132656-097bd699e023', 1200),
    alt: 'Two people working through wedding plans together with a laptop and notes',
  },

  // Logistics and extras
  transport: {
    url: U('photo-1756267236776-651082452c0a', 1200),
    alt: 'A couple seated in a vintage car surrounded by cheering guests',
    rep: 'mixed',
  },
  'stationery-and-invitations': {
    url: U('photo-1632610992667-44a7b82edbdc', 1200),
    alt: 'A flatlay of wedding invitation cards arranged with floral accents',
  },
  'photo-booths-and-extras': {
    url: P('premium_photo-1675263779692-6b5c21588a25', 1200),
    alt: 'A neon sign reading let us dance glowing at a wedding reception',
  },
};

const portfolio = [
  { url: U('photo-1771929836785-065bb7635053', 1200), alt: 'Couple performing a ritual during a colourful wedding ceremony', rep: 'south-asian' },
  { url: U('photo-1765881395337-a69cf213bd84', 1200), alt: 'Groom lifting his bride in traditional attire in a joyful outdoor moment', rep: 'south-asian' },
  { url: U('photo-1551963474-cc9e699de3b4', 1200), alt: 'Couple sharing a quiet moment at their wedding reception', rep: 'black' },
  { url: U('photo-1543260987-d0169ccf36f9', 1200), alt: 'Couple laughing together outdoors in a relaxed candid portrait', rep: 'black' },
  { url: U('photo-1648154164366-d067faecdc51', 1200), alt: 'Couple sharing their first dance at the reception in warm light', rep: 'mixed' },
  { url: U('photo-1660715858388-8deaf653ab2b', 1200), alt: 'Couple laughing together against a bright open sky', rep: 'east-asian' },
  { url: U('photo-1511795409834-ef04bbd61622', 1200), alt: 'Styled wedding table with tall floral centrepieces and candlelight', rep: 'detail' },
  { url: U('photo-1587271636175-90d58cdad458', 1200), alt: 'Bride and groom at their ceremony wearing traditional flower garlands', rep: 'south-asian' },
];

const headshots = [
  { url: U('photo-1573497019940-1c28c88b4f3e', 800), alt: 'Portrait of a wedding professional smiling warmly at the camera', rep: 'south-asian' },
  { url: U('photo-1614023342667-6f060e9d1e04', 800), alt: 'Portrait of a wedding professional in smart casual wear', rep: 'black' },
  { url: U('photo-1558222218-b7b54eede3f3', 800), alt: 'Portrait of a smiling wedding professional in business attire', rep: 'south-east-asian' },
  { url: U('photo-1494790108377-be9c29b29330', 800), alt: 'Portrait of a wedding professional with a warm smile', rep: 'east-asian' },
  { url: U('photo-1627161683077-e34782c24d81', 800), alt: 'Portrait of a friendly wedding professional in business casual attire', rep: 'white' },
];

module.exports = { hero, couples, categoryTiles, portfolio, headshots };
