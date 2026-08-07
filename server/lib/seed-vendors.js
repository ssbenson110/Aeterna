'use strict';

/**
 * Sample vendor listings, one to three per category across the full taxonomy.
 *
 * IMPORTANT: every listing here is flagged is_sample and the interface labels
 * them as samples. They exist so the marketplace is legible before real vendors
 * sign up. There are no reviews, no ratings, no testimonials and no counts of
 * couples served anywhere in this file, because none of that exists yet.
 *
 * `hero` picks the category tile image, `headshot` picks a portrait for
 * individual practitioners, `portfolio` indexes into the shared gallery.
 */

const SAMPLE_VENDORS = [
  /* ---------------- venues ---------------- */
  {
    slug: 'the-old-brewery-greenwich', business_name: 'The Old Brewery Rooms',
    category: 'venues', region: 'South East London', town: 'Greenwich',
    tagline: 'A brick and glass room for 60 to 180, with a courtyard for the confetti.',
    about: 'A restored brewery hall a short walk from Greenwich station. The main room takes 180 seated, the courtyard handles the ceremony and the confetti, and there is a separate quiet room that works well for a tea ceremony or a nikah. We are open to outside caterers, which matters if your family is bringing their own food, and we hold a late licence to midnight.',
    price_from_pence: 620000, capacity_per_month: 4, verified: 1,
    traditions: ['Civil ceremony', 'Chinese tea ceremony', 'Nikah', 'Humanist'],
    services: ['Ceremony and reception in one place', 'Outside caterers welcome', 'Late licence to midnight', 'Step free access throughout'],
    hero: 'venues', portfolio: [6, 5, 4],
  },
  {
    slug: 'penshurst-barn-kent', business_name: 'Penshurst Long Barn',
    category: 'venues', region: 'West Kent', town: 'Penshurst',
    tagline: 'Oak framed barn and a walled garden, licensed for outdoor ceremonies.',
    about: 'A working estate barn in the Weald with a walled garden licensed for outdoor ceremonies. The barn seats 140 and we can put a marquee on the paddock for larger numbers. Open flame is permitted in the garden with a fire plan agreed in advance, which makes the space workable for a havan. There are eight rooms on site for the wedding party.',
    price_from_pence: 780000, capacity_per_month: 3, verified: 1,
    traditions: ['Hindu ceremony', 'Civil ceremony', 'Church of England', 'Humanist'],
    services: ['Licensed for outdoor ceremonies', 'Open flame permitted with a fire plan', 'Marquee space on the paddock', 'Eight bedrooms on site'],
    hero: 'venues', portfolio: [7, 4],
  },
  {
    slug: 'croydon-assembly-hall', business_name: 'Assembly Hall Croydon',
    category: 'venues', region: 'South London', town: 'Croydon',
    tagline: 'A large flexible hall for 250, built for two day celebrations.',
    about: 'A civic hall with a 250 seated capacity, a commercial kitchen for outside caterers and a stage that suits a mandap or a dhol entrance. We hire by the day rather than by the hour, so a two day celebration does not mean two full price bookings. Parking for 90 cars and a station eight minutes on foot.',
    price_from_pence: 340000, capacity_per_month: 5, verified: 1,
    traditions: ['Hindu ceremony', 'Sikh Anand Karaj', 'Nikah', 'Nigerian traditional', 'Tamil ceremony'],
    services: ['Commercial kitchen for outside caterers', 'Day rate rather than hourly', 'Stage suitable for a mandap', 'Parking for 90 cars'],
    hero: 'venues', portfolio: [0, 1, 7],
  },

  /* ---------------- marquees and tipis ---------------- */
  {
    slug: 'weald-tipi-company', business_name: 'Weald Tipi Company',
    category: 'marquees-and-tipis', region: 'Kent', town: 'Maidstone',
    tagline: 'Nordic tipis and stretch tents for gardens and open fields.',
    about: 'We put up tipis and stretch tents across Kent, usually on family land or a hired field. Three linked tipis comfortably hold 200 standing. We handle the ground survey, flooring, lighting and heating, and we build the day before so nobody is racing a sunset on the morning of the wedding.',
    price_from_pence: 420000, capacity_per_month: 4, verified: 1,
    traditions: ['Civil ceremony', 'Humanist', 'Nigerian traditional'],
    services: ['Nordic tipis and stretch tents', 'Ground survey and flooring included', 'Heating and festoon lighting', 'Built the day before'],
    hero: 'marquees-and-tipis', portfolio: [4],
  },
  {
    slug: 'southside-marquees', business_name: 'Southside Marquees',
    category: 'marquees-and-tipis', region: 'South London', town: 'Bromley',
    tagline: 'Framed marquees for tight urban gardens and awkward sites.',
    about: 'Framed marquees need no guy ropes, so they fit gardens where a traditional pole marquee will not. We work a lot in South London where space is tight and access is through a house. We will do a site visit before quoting rather than guessing from a photograph.',
    price_from_pence: 260000, capacity_per_month: 5, verified: 0,
    traditions: ['Civil ceremony', 'Nikah', 'Hindu ceremony'],
    services: ['Framed marquees, no guy ropes', 'Difficult access specialists', 'Site visit before every quote', 'Linings, flooring and heating'],
    hero: 'marquees-and-tipis', portfolio: [6],
  },

  /* ---------------- celebrants ---------------- */
  {
    slug: 'rosa-adeyemi-celebrant', business_name: 'Rosa Adeyemi, Celebrant',
    category: 'celebrants-and-officiants', region: 'South London', town: 'Camberwell',
    tagline: 'Ceremonies that hold two families and two languages at once.',
    about: 'I write and lead ceremonies for couples blending traditions, and roughly half my work involves two languages in the room. I will sit with both families before the day so nobody feels like a guest at their own child\'s wedding. I am not a registrar, so you will still need the legal appointment, and I will help you plan around it.',
    price_from_pence: 65000, capacity_per_month: 6, verified: 1,
    traditions: ['Humanist', 'Civil ceremony', 'Nigerian traditional', 'Yoruba traditional', 'Ghanaian traditional'],
    services: ['Bespoke ceremony writing', 'Bilingual ceremonies', 'Family meeting before the day', 'Rehearsal included'],
    hero: 'celebrants-and-officiants', headshot: 0,
  },
  {
    slug: 'kent-humanist-ceremonies', business_name: 'Kent Humanist Ceremonies',
    category: 'celebrants-and-officiants', region: 'East Kent', town: 'Canterbury',
    tagline: 'Accredited humanist celebrants across Kent.',
    about: 'Accredited humanist celebrants covering the whole of Kent. A humanist ceremony is not legally binding in England and Wales, so we will always tell you plainly that you need a register office appointment as well, and we will help you sequence the two.',
    price_from_pence: 58000, capacity_per_month: 6, verified: 1,
    traditions: ['Humanist', 'Civil ceremony', 'Quaker'],
    services: ['Accredited humanist celebrants', 'Ceremony written with you', 'Guidance on the legal appointment'],
    hero: 'celebrants-and-officiants', headshot: 4,
  },

  /* ---------------- catering ---------------- */
  {
    slug: 'ekow-and-sons-catering', business_name: 'Ekow and Sons',
    category: 'catering', region: 'South London', town: 'Peckham',
    tagline: 'West African and British menus for 80 to 400 guests.',
    about: 'A family kitchen cooking jollof, egusi, grilled fish and a proper British roast, often at the same wedding. We are used to catering for 300 plus, and we are used to aunties inspecting the pot. We work from your venue\'s kitchen or bring our own mobile setup where there is not one.',
    price_from_pence: 4200, price_unit: 'per head', capacity_per_month: 4, verified: 1,
    traditions: ['Nigerian traditional', 'Ghanaian traditional', 'Yoruba traditional', 'Civil ceremony'],
    services: ['West African and British menus', 'Up to 400 guests', 'Mobile kitchen where needed', 'Halal options'],
    hero: 'catering', portfolio: [5],
  },
  {
    slug: 'saffron-hill-caterers', business_name: 'Saffron Hill Caterers',
    category: 'catering', region: 'South London', town: 'Tooting',
    tagline: 'Fully vegetarian and Jain friendly Indian catering.',
    about: 'We cook South Indian and Gujarati menus, fully vegetarian, with a separate Jain preparation on request. Live dosa and chaat stations work well for a long afternoon. We hold a halal certification for our separate meat kitchen where a couple needs both.',
    price_from_pence: 3400, price_unit: 'per head', capacity_per_month: 5, verified: 1,
    traditions: ['Hindu ceremony', 'Jain ceremony', 'Gujarati ceremony', 'Tamil ceremony', 'Nikah'],
    services: ['Fully vegetarian kitchen', 'Jain preparation on request', 'Live dosa and chaat stations', 'Separate halal kitchen'],
    hero: 'catering', portfolio: [6],
  },

  /* ---------------- cakes ---------------- */
  {
    slug: 'bluebird-cakes', business_name: 'Bluebird Cake Studio',
    category: 'cakes-and-desserts', region: 'South West London', town: 'Balham',
    tagline: 'Wedding cakes, dessert tables and a proper eggless option.',
    about: 'Cakes for 40 to 300, including eggless and vegan tiers that taste like cake rather than an apology. We do dessert tables alongside the main cake, which works well when one side of the family expects mithai and the other expects Victoria sponge.',
    price_from_pence: 32000, capacity_per_month: 8, verified: 1,
    traditions: ['Civil ceremony', 'Hindu ceremony', 'Jain ceremony', 'Church of England'],
    services: ['Eggless and vegan tiers', 'Dessert tables', 'Tasting box posted before booking', 'Delivery and setup'],
    hero: 'cakes-and-desserts',
  },

  /* ---------------- bar ---------------- */
  {
    slug: 'copper-pour-bars', business_name: 'Copper Pour Mobile Bars',
    category: 'bar-and-drinks', region: 'Kent', town: 'Sevenoaks',
    tagline: 'Mobile bars, cocktails and a genuinely good dry bar.',
    about: 'We build a bar wherever you need one, including fields with no power. Our dry bar list is properly developed rather than three juices in a jug, which matters for a nikah or any celebration where alcohol is not part of the day. Fully licensed and insured.',
    price_from_pence: 95000, capacity_per_month: 6, verified: 1,
    traditions: ['Nikah', 'Civil ceremony', 'Humanist', 'Hindu ceremony'],
    services: ['Mobile bar with own power', 'Developed dry bar list', 'Cocktail service', 'Licensed and insured'],
    hero: 'bar-and-drinks',
  },

  /* ---------------- photography ---------------- */
  {
    slug: 'amara-rowe-photography', business_name: 'Amara Rowe Photography',
    category: 'photography', region: 'South London', town: 'Peckham',
    tagline: 'Documentary photography for long days and big families.',
    about: 'I photograph weddings the way they actually happen, which usually means a lot of people, a lot of movement and a schedule that slips. I have shot Nigerian traditional engagements, church weddings and civil ceremonies across South London, and I am comfortable working from six in the morning to midnight. Every couple gets the full edited set, not a curated handful.',
    price_from_pence: 195000, capacity_per_month: 3, verified: 1,
    traditions: ['Nigerian traditional', 'Ghanaian traditional', 'Church of England', 'Civil ceremony', 'Yoruba traditional'],
    services: ['Full day coverage', 'Full edited gallery, no drip feed', 'Second photographer available', 'Print rights included'],
    hero: 'photography', headshot: 1, portfolio: [2, 3, 5, 4],
  },
  {
    slug: 'north-light-studio', business_name: 'North Light Studio',
    category: 'photography', region: 'South West London', town: 'Wandsworth',
    tagline: 'Quiet, unposed coverage for smaller weddings.',
    about: 'A two person studio working mostly with weddings under 80 guests. We stay out of the way, we do not run group shot production lines unless you want one, and we hand over the full set within three weeks. Good fit for register office ceremonies and restaurant receptions.',
    price_from_pence: 145000, capacity_per_month: 4, verified: 0,
    traditions: ['Civil ceremony', 'Humanist', 'Jewish ceremony', 'Register office'],
    services: ['Half day and full day options', 'Two photographers as standard', 'Three week turnaround'],
    hero: 'photography', headshot: 3, portfolio: [4, 5],
  },

  /* ---------------- videography ---------------- */
  {
    slug: 'sanjay-verma-films', business_name: 'Verma Wedding Films',
    category: 'videography', region: 'Kent', town: 'Bromley',
    tagline: 'Two and three day coverage, film and stills from one team.',
    about: 'We film multi day weddings across Kent and South London. Most of our work is two or three events across a weekend, so we quote by the celebration rather than by the day. We know the running order of a mehndi, an Anand Karaj and a reception, which means we are set up before the moment rather than chasing it.',
    price_from_pence: 285000, capacity_per_month: 2, verified: 1,
    traditions: ['Hindu ceremony', 'Sikh Anand Karaj', 'Tamil ceremony', 'Nikah', 'Punjabi ceremony', 'Sangeet'],
    services: ['Multi day coverage quoted as one celebration', 'Film and stills from one team', 'Drone with a licensed operator', 'Same week highlight film'],
    hero: 'videography', headshot: 4, portfolio: [0, 1, 7, 6],
  },

  /* ---------------- decor and florals ---------------- */
  {
    slug: 'wildfold-florals', business_name: 'Wildfold Florals',
    category: 'decor-and-florals', region: 'Kent', town: 'Sevenoaks',
    tagline: 'Seasonal British flowers, installations and mandap florals.',
    about: 'We grow a good share of what we use on a smallholding outside Sevenoaks, which keeps the cost sensible and the flowers seasonal. We build arches, aisle installations and mandap florals, and we will happily reuse the ceremony flowers on the reception tables rather than selling you the same flowers twice.',
    price_from_pence: 120000, capacity_per_month: 4, verified: 1,
    traditions: ['Hindu ceremony', 'Civil ceremony', 'Church of England', 'Tamil ceremony'],
    services: ['Seasonal British flowers', 'Ceremony arches and installations', 'Mandap florals', 'Ceremony flowers reused at the reception'],
    hero: 'decor-and-florals', headshot: 4, portfolio: [6, 7, 0],
  },

  /* ---------------- mandap and stage ---------------- */
  {
    slug: 'atelier-noor-decor', business_name: 'Atelier Noor',
    category: 'mandap-and-stage', region: 'South London', town: 'Tooting',
    tagline: 'Mandaps, nikah stages and full room transformations.',
    about: 'We build mandaps, nikah stages and full room sets for celebrations of 150 to 400. We own our own inventory rather than subcontracting, so the thing you see in the drawing is the thing that arrives. Setup usually happens the night before where the venue allows it.',
    price_from_pence: 220000, capacity_per_month: 3, verified: 1,
    traditions: ['Hindu ceremony', 'Nikah', 'Sikh Anand Karaj', 'Tamil ceremony', 'Gujarati ceremony'],
    services: ['Mandap and stage build', 'Full room transformation', 'Owned inventory, nothing subcontracted', 'Night before setup where permitted'],
    hero: 'mandap-and-stage', portfolio: [0, 1, 7],
  },

  /* ---------------- lighting ---------------- */
  {
    slug: 'lumenworks-production', business_name: 'Lumenworks Production',
    category: 'lighting-and-production', region: 'South London', town: 'Deptford',
    tagline: 'Festoons, uplighting, dance floors and sound that works.',
    about: 'Lighting and sound for weddings in venues that were not built for either. We handle sound limiters, power distribution and the dull technical constraints that ruin a party when nobody has checked them. Festoon, uplighting and dance floor packages, or a bespoke rig.',
    price_from_pence: 78000, capacity_per_month: 6, verified: 0,
    traditions: ['Civil ceremony', 'Nigerian traditional', 'Hindu ceremony', 'Nikah'],
    services: ['Festoon and uplighting', 'Dance floor hire', 'Sound limiter management', 'Power distribution for field sites'],
    hero: 'lighting-and-production',
  },

  /* ---------------- bands ---------------- */
  {
    slug: 'the-brixton-eight', business_name: 'The Brixton Eight',
    category: 'bands-and-live-music', region: 'South London', town: 'Brixton',
    tagline: 'An eight piece that can play afrobeats, soul and a first dance.',
    about: 'An eight piece band covering afrobeats, highlife, soul and motown, with a horn section that earns its place. We will learn your first dance song properly rather than approximating it, and we can drop to a four piece for the ceremony and drinks.',
    price_from_pence: 210000, capacity_per_month: 4, verified: 1,
    traditions: ['Nigerian traditional', 'Ghanaian traditional', 'Civil ceremony', 'Jamaican traditional'],
    services: ['Eight piece with horns', 'Four piece option for the ceremony', 'First dance learned properly', 'Own PA and lighting'],
    hero: 'bands-and-live-music',
  },

  /* ---------------- djs ---------------- */
  {
    slug: 'dj-remi-south', business_name: 'DJ Remi',
    category: 'djs', region: 'South London', town: 'Lewisham',
    tagline: 'One night, two cultures, one dance floor that stays full.',
    about: 'I mostly play weddings where the playlist has to move between bhangra, afrobeats, garage and whatever the grandparents will get up for. That is a reading job more than a technical one. I bring my own rig, I work with your venue\'s sound limiter, and I do not talk over the music.',
    price_from_pence: 68000, capacity_per_month: 6, verified: 1,
    traditions: ['Punjabi ceremony', 'Nigerian traditional', 'Civil ceremony', 'Nikah', 'Jamaican traditional'],
    services: ['Multi genre sets across the night', 'Own rig and backup', 'Works with venue sound limiters', 'MC on request'],
    hero: 'djs',
  },

  /* ---------------- cultural performers ---------------- */
  {
    slug: 'london-dhol-collective', business_name: 'London Dhol Collective',
    category: 'cultural-performers', region: 'South London', town: 'Southall Road',
    tagline: 'Dhol players, dancers and a baraat that people remember.',
    about: 'Dhol players for baraats, entrances and sangeets, from a single drummer to a group of six with dancers. We work outdoors and indoors, and we will check the noise restrictions at your venue before the day rather than discovering them on it.',
    price_from_pence: 45000, capacity_per_month: 8, verified: 1,
    traditions: ['Punjabi ceremony', 'Sikh Anand Karaj', 'Hindu ceremony', 'Sangeet', 'Nikah'],
    services: ['One to six dhol players', 'Baraat and entrance sets', 'Dancers available', 'Noise restriction check beforehand'],
    hero: 'cultural-performers',
  },

  /* ---------------- hair and makeup ---------------- */
  {
    slug: 'zainab-artistry', business_name: 'Zainab Artistry',
    category: 'hair-and-makeup', region: 'South London', town: 'Streatham',
    tagline: 'Bridal hair and makeup across every skin tone and hair texture.',
    about: 'I work across deep to fair skin tones and across textures from 4C to fine straight hair, and I carry a kit that reflects that. I do South Asian bridal, Nigerian traditional and civil ceremony looks, and I am happy to do two looks in a day. Trials happen at my studio in Streatham or at your home for an additional travel fee.',
    price_from_pence: 45000, capacity_per_month: 6, verified: 1,
    traditions: ['Nikah', 'Hindu ceremony', 'Nigerian traditional', 'Tamil ceremony', 'Civil ceremony'],
    services: ['Bridal hair and makeup', 'Two looks in one day', 'Party bookings for the wedding party', 'Trials at the studio or at home'],
    hero: 'hair-and-makeup', headshot: 0, portfolio: [1, 2],
  },
  {
    slug: 'lumen-hair-and-makeup', business_name: 'Lumen Hair and Makeup',
    category: 'hair-and-makeup', region: 'West Kent', town: 'Tunbridge Wells',
    tagline: 'A small team covering the whole wedding party in one morning.',
    about: 'A team of three, so a party of eight is finished comfortably before the photographer arrives. We work across textures and tones, we bring our own lighting for early starts in winter, and we stay for a touch up before the ceremony as standard.',
    price_from_pence: 38000, capacity_per_month: 6, verified: 0,
    traditions: ['Civil ceremony', 'Church of England', 'Humanist'],
    services: ['Team of three artists', 'Touch up before the ceremony included', 'Early winter starts with our own lighting'],
    hero: 'hair-and-makeup', headshot: 2, portfolio: [4],
  },

  /* ---------------- mehndi ---------------- */
  {
    slug: 'henna-by-fariha', business_name: 'Henna by Fariha',
    category: 'mehndi-artists', region: 'South London', town: 'Croydon',
    tagline: 'Bridal mehndi and large family bookings, organic paste only.',
    about: 'Bridal mehndi in Indian, Arabic and Moroccan styles, plus party henna for however many relatives turn up, which is always more than the number you booked for. I use organic paste with no PPD, and I will quote for a realistic number of guests rather than a hopeful one.',
    price_from_pence: 28000, capacity_per_month: 8, verified: 1,
    traditions: ['Mehndi', 'Nikah', 'Hindu ceremony', 'Punjabi ceremony', 'Somali traditional'],
    services: ['Bridal mehndi', 'Party henna for guests', 'Organic paste, no PPD', 'Travel across South London and Kent'],
    hero: 'mehndi-artists', headshot: 0,
  },

  /* ---------------- bridalwear ---------------- */
  {
    slug: 'thread-and-form', business_name: 'Thread and Form',
    category: 'bridalwear-and-tailoring', region: 'South London', town: 'Clapham',
    tagline: 'Alterations and made to measure for dresses, suits and saris.',
    about: 'We alter and make wedding clothes of every kind, including saris, lehengas, agbadas and three piece suits. A lot of our work is rescuing something bought online that does not fit, and a lot is making something from scratch. Two fittings are included and we will tell you honestly when a garment cannot be saved.',
    price_from_pence: 18000, capacity_per_month: 10, verified: 1,
    traditions: ['Civil ceremony', 'Hindu ceremony', 'Nigerian traditional', 'Nikah', 'Punjabi ceremony'],
    services: ['Alterations and made to measure', 'Saris, lehengas and agbadas', 'Two fittings included', 'Suit tailoring'],
    hero: 'bridalwear-and-tailoring',
  },

  /* ---------------- jewellery ---------------- */
  {
    slug: 'hatton-and-gold', business_name: 'Hatton and Gold',
    category: 'jewellery', region: 'South London', town: 'Blackheath',
    tagline: 'Rings, bridal sets and remodelling family gold.',
    about: 'We make wedding and engagement rings, and a good share of our work is remodelling gold a family already owns into something a couple will actually wear. Bridal sets in 22 carat for those who want them. Everything is made in the workshop rather than ordered in.',
    price_from_pence: 65000, capacity_per_month: 8, verified: 0,
    traditions: ['Civil ceremony', 'Hindu ceremony', 'Nikah', 'Tamil ceremony'],
    services: ['Wedding and engagement rings', 'Remodelling family gold', '22 carat bridal sets', 'Made in our own workshop'],
    hero: 'jewellery',
  },

  /* ---------------- planners ---------------- */
  {
    slug: 'meridian-wedding-planning', business_name: 'Meridian Wedding Planning',
    category: 'planners', region: 'South London', town: 'Dulwich',
    tagline: 'Full planning, partial planning and on the day coordination.',
    about: 'We plan weddings across South London and Kent, and roughly half our work is couples combining two sets of traditions. We are used to managing two families, two running orders and occasionally two caterers. Partial planning is our most popular option, where you book the big things and we handle logistics from three months out.',
    price_from_pence: 180000, capacity_per_month: 3, verified: 1,
    traditions: ['Hindu ceremony', 'Nikah', 'Civil ceremony', 'Chinese tea ceremony', 'Nigerian traditional'],
    services: ['Full planning', 'Partial planning from three months out', 'On the day coordination', 'Supplier contract review'],
    hero: 'planners', headshot: 0, portfolio: [6, 4],
  },
  {
    slug: 'saltmarsh-events-kent', business_name: 'Saltmarsh Events',
    category: 'planners', region: 'East Kent', town: 'Canterbury',
    tagline: 'On the day coordination across Kent, so you are not running your own wedding.',
    about: 'We coordinate on the day so nobody in your family has to hold a clipboard. We take over four weeks before, confirm every supplier, build the timeline and then run it. We also do full planning for a small number of weddings each year.',
    price_from_pence: 95000, capacity_per_month: 4, verified: 1,
    traditions: ['Civil ceremony', 'Church of England', 'Humanist'],
    services: ['On the day coordination', 'Timeline build and supplier confirmation', 'Full planning for a limited number of dates'],
    hero: 'planners', headshot: 3, portfolio: [5],
  },

  /* ---------------- transport ---------------- */
  {
    slug: 'kentish-classic-cars', business_name: 'Kentish Classic Cars',
    category: 'transport', region: 'Kent', town: 'Tonbridge',
    tagline: 'Classic cars, and coaches when the whole family is coming.',
    about: 'Three classic cars and a pair of 49 seat coaches, which matters when a hundred relatives need to get from a gurdwara to a reception. We plan the route with your venues rather than trusting a postcode, and we build in the delay that always happens.',
    price_from_pence: 42000, capacity_per_month: 8, verified: 1,
    traditions: ['Sikh Anand Karaj', 'Civil ceremony', 'Church of England', 'Hindu ceremony'],
    services: ['Classic wedding cars', '49 seat guest coaches', 'Route planned with your venues', 'Baraat transport'],
    hero: 'transport',
  },

  /* ---------------- stationery ---------------- */
  {
    slug: 'inkwell-and-press', business_name: 'Inkwell and Press',
    category: 'stationery-and-invitations', region: 'South East London', town: 'Forest Hill',
    tagline: 'Invitations, calligraphy and signage, including dual language sets.',
    about: 'Letterpress and digital invitations, day of signage and seating cards. We regularly set invitations in two languages and two scripts on the same card, which is a typesetting problem most printers will not take on. Proofs are unlimited until you are happy.',
    price_from_pence: 48000, capacity_per_month: 8, verified: 1,
    traditions: ['Civil ceremony', 'Hindu ceremony', 'Nikah', 'Chinese tea ceremony', 'Tamil ceremony'],
    services: ['Letterpress and digital printing', 'Dual language and dual script setting', 'Day of signage', 'Proofs until you are happy'],
    hero: 'stationery-and-invitations',
  },

  /* ---------------- extras ---------------- */
  {
    slug: 'flashbox-photo-booths', business_name: 'Flashbox',
    category: 'photo-booths-and-extras', region: 'South London', town: 'Sydenham',
    tagline: 'Photo booths, neon signs and a 360 platform.',
    about: 'A photo booth with an attendant who actually gets people into it, plus neon signs and a 360 video platform. Prints are unlimited on the night and the digital gallery goes to you the next morning. We set up quietly during the meal rather than during the speeches.',
    price_from_pence: 55000, capacity_per_month: 8, verified: 0,
    traditions: ['Civil ceremony', 'Nigerian traditional', 'Punjabi ceremony', 'Humanist'],
    services: ['Attended photo booth', 'Neon sign hire', '360 video platform', 'Digital gallery the next morning'],
    hero: 'photo-booths-and-extras',
  },
];

module.exports = { SAMPLE_VENDORS };
