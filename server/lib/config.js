'use strict';

/**
 * Single source of truth for commercial terms, taxonomy and published policies.
 * These values are contractual. Do not add tiers, do not invent variants.
 */

/* ------------------------------------------------------------------ */
/* pricing and entitlements                                            */
/* ------------------------------------------------------------------ */

/**
 * Couples get a permanent free tier, but it is a genuine demo rather than a
 * product. Nothing is ever taken away from them, and the caps below are
 * enforced server side in lib/entitlements.js. Every cap is published on the
 * pricing page in the same words used here.
 */
const FREE_LIMITS = {
  aiMessagesTotal: 20,        // total, not monthly. Once used, they are used.
  enquiries: 1,
  collaborators: 0,
  guests: 0,                  // the guest list is an upgrade feature
  tabs: ['checklist', 'budget', 'details', 'enquiries'],
  exportPlan: false,
  sharedWorkspace: false,
};

const UPGRADED_LIMITS = {
  aiMessagesMonthly: 400,
  enquiries: Infinity,
  collaborators: 25,
  guests: 1000,
  tabs: ['checklist', 'budget', 'guests', 'seating', 'timeline', 'details', 'enquiries', 'workspace'],
  exportPlan: true,
  sharedWorkspace: true,
};

const PRICING = {
  vendor: {
    plans: 1,
    foundingPricePence: 2900,
    standardPricePence: 4900,
    foundingSlots: 40,
    foundingLockMonths: 12,
    // Rollout offer: every vendor's first month is free while the marketplace
    // fills. Applied automatically at subscription, no code needed.
    trialDays: 30,
    paidRanking: false,
    summary:
      'One plan, and your first month is free while we roll out. Then £29 a month at the founding rate for the first 40 vendors, locked for 12 months, then £49 a month standard. There is no higher tier and no paid ranking.',
  },
  couple: {
    freePricePence: 0,
    upgradePricePence: 4900,
    recurring: false,
    freeLimits: FREE_LIMITS,
    upgradedLimits: UPGRADED_LIMITS,
    summary:
      'The free plan covers the checklist, the budget and 20 AI planner messages, and lets you send one enquiry. £49 once per wedding unlocks the rest, including the shared workspace. It is not a subscription.',
    freeSummary:
      'Free covers the checklist, the budget, 20 planner messages and one enquiry. It stays yours and nothing is taken away, but it is deliberately limited.',
  },
};

/* ------------------------------------------------------------------ */
/* vendor taxonomy                                                     */
/* ------------------------------------------------------------------ */

/**
 * Category families keep a twenty plus category directory scannable.
 * Order matters: it is the order shown on the browse page.
 */
const CATEGORY_FAMILIES = [
  { slug: 'ceremony-and-venue', label: 'Ceremony and venue' },
  { slug: 'food-and-drink', label: 'Food and drink' },
  { slug: 'photography-and-film', label: 'Photography and film' },
  { slug: 'styling', label: 'Styling and decor' },
  { slug: 'entertainment', label: 'Entertainment' },
  { slug: 'attire-and-beauty', label: 'Attire and beauty' },
  { slug: 'planning', label: 'Planning' },
  { slug: 'logistics-and-extras', label: 'Logistics and extras' },
];

const CATEGORIES = [
  // Ceremony and venue
  { slug: 'venues', family: 'ceremony-and-venue', label: 'Venues',
    blurb: 'Halls, barns, hotels, gurdwaras, banqueting suites and civic spaces.' },
  { slug: 'marquees-and-tipis', family: 'ceremony-and-venue', label: 'Marquees and tipis',
    blurb: 'Stretch tents, tipis and framed marquees for gardens and open sites.' },
  { slug: 'celebrants-and-officiants', family: 'ceremony-and-venue', label: 'Celebrants and officiants',
    blurb: 'Independent celebrants, humanists and officiants for every kind of ceremony.' },
  { slug: 'toastmasters-and-mcs', family: 'ceremony-and-venue', label: 'Toastmasters and MCs',
    blurb: 'Toastmasters, masters of ceremonies and bilingual hosts who keep the day moving.' },

  // Food and drink
  { slug: 'catering', family: 'food-and-drink', label: 'Catering',
    blurb: 'Caterers who handle long days, multiple services and family recipes.' },
  { slug: 'cakes-and-desserts', family: 'food-and-drink', label: 'Cakes and desserts',
    blurb: 'Wedding cakes, dessert tables and sweet trolleys.' },
  { slug: 'bar-and-drinks', family: 'food-and-drink', label: 'Bar and drinks',
    blurb: 'Mobile bars, cocktails and dry bar options.' },
  { slug: 'food-trucks-and-street-food', family: 'food-and-drink', label: 'Food trucks and street food',
    blurb: 'Vans, stalls and late night food for the evening crowd.' },
  { slug: 'grazing-and-sweet-carts', family: 'food-and-drink', label: 'Grazing and sweet carts',
    blurb: 'Grazing tables, chocolate fountains, chaat stations and pick and mix.' },

  // Photography and film
  { slug: 'photography', family: 'photography-and-film', label: 'Photography',
    blurb: 'Documentary photographers who know long multicultural days.' },
  { slug: 'videography', family: 'photography-and-film', label: 'Videography',
    blurb: 'Film teams, highlight films and multi day coverage.' },
  { slug: 'content-creators', family: 'photography-and-film', label: 'Content creators',
    blurb: 'Phone shot, same day social coverage alongside your main photographer.' },

  // Styling and decor
  { slug: 'decor-and-florals', family: 'styling', label: 'Decor and florals',
    blurb: 'Arches, installations, tablescapes and seasonal British flowers.' },
  { slug: 'mandap-and-stage', family: 'styling', label: 'Mandaps and stages',
    blurb: 'Mandaps, nikah stages and full room transformations.' },
  { slug: 'lighting-and-production', family: 'styling', label: 'Lighting and production',
    blurb: 'Festoons, uplighting, dance floors and sound.' },
  { slug: 'prop-and-furniture-hire', family: 'styling', label: 'Prop and furniture hire',
    blurb: 'Chairs, tables, dance floors, arches and statement pieces.' },
  { slug: 'balloons-and-installations', family: 'styling', label: 'Balloons and installations',
    blurb: 'Balloon arches, flower walls and photo moments.' },

  // Entertainment
  { slug: 'bands-and-live-music', family: 'entertainment', label: 'Bands and live music',
    blurb: 'Bands, ensembles and party starters.' },
  { slug: 'djs', family: 'entertainment', label: 'DJs',
    blurb: 'DJs who can read a room across two cultures in one night.' },
  { slug: 'cultural-performers', family: 'entertainment', label: 'Dhol and cultural performers',
    blurb: 'Dhol players, steel pans, lion dancers and traditional performers.' },
  { slug: 'ceremony-musicians', family: 'entertainment', label: 'Ceremony musicians',
    blurb: 'String quartets, harpists, gospel choirs and soloists.' },
  { slug: 'magicians-and-entertainers', family: 'entertainment', label: 'Magicians and entertainers',
    blurb: 'Close up magic, caricaturists and comedians.' },
  { slug: 'dancers-and-choreography', family: 'entertainment', label: 'Dancers and choreography',
    blurb: 'First dance lessons, sangeet choreography and performance troupes.' },
  { slug: 'fireworks-and-special-effects', family: 'entertainment', label: 'Fireworks and special effects',
    blurb: 'Fireworks, sparkler send offs, cold spark fountains and confetti drops.' },
  { slug: 'kids-entertainment', family: 'entertainment', label: 'Kids entertainment',
    blurb: 'Entertainers who keep the little ones happy through the speeches.' },

  // Attire and beauty
  { slug: 'bridalwear-and-tailoring', family: 'attire-and-beauty', label: 'Bridalwear and tailoring',
    blurb: 'Dresses, saris, lehengas and made to measure.' },
  { slug: 'menswear-and-suit-hire', family: 'attire-and-beauty', label: 'Menswear and suit hire',
    blurb: 'Suits, sherwanis, agbadas and kilts, bought or hired.' },
  { slug: 'hair-and-makeup', family: 'attire-and-beauty', label: 'Hair and makeup',
    blurb: 'Artists experienced across every skin tone and hair texture.' },
  { slug: 'mehndi-artists', family: 'attire-and-beauty', label: 'Mehndi artists',
    blurb: 'Bridal mehndi, party henna and large family bookings.' },
  { slug: 'jewellery', family: 'attire-and-beauty', label: 'Jewellery',
    blurb: 'Rings, bridal sets and traditional gold.' },
  { slug: 'accessories-and-headpieces', family: 'attire-and-beauty', label: 'Accessories and headpieces',
    blurb: 'Veils, turbans, fascinators and heirloom pieces.' },
  { slug: 'nails-and-grooming', family: 'attire-and-beauty', label: 'Nails and grooming',
    blurb: 'Manicures, barbering and pre wedding grooming.' },

  // Planning
  { slug: 'planners', family: 'planning', label: 'Planners and coordinators',
    blurb: 'Full planning, partial planning and on the day coordination.' },

  // Logistics and extras
  { slug: 'transport', family: 'logistics-and-extras', label: 'Transport',
    blurb: 'Wedding cars, coaches for guests and baraat transport.' },
  { slug: 'stationery-and-invitations', family: 'logistics-and-extras', label: 'Stationery and invitations',
    blurb: 'Invitations, calligraphy, signage and on the day stationery.' },
  { slug: 'photo-booths-and-extras', family: 'logistics-and-extras', label: 'Photo booths and extras',
    blurb: 'Booths, neon signs, 360 platforms and the things that make people laugh.' },
  { slug: 'favours-and-gifts', family: 'logistics-and-extras', label: 'Favours and gifts',
    blurb: 'Favours, welcome bags and thank you gifts.' },
  { slug: 'childcare-and-creche', family: 'logistics-and-extras', label: 'Childcare and creche',
    blurb: 'Registered creches and nannies for the day.' },
  { slug: 'security-and-stewarding', family: 'logistics-and-extras', label: 'Security and stewarding',
    blurb: 'SIA licensed security, car park marshals and stewards.' },
  { slug: 'power-toilets-and-site', family: 'logistics-and-extras', label: 'Power, toilets and site services',
    blurb: 'Generators, luxury toilets and everything a field needs to host a wedding.' },
  {
    slug: 'other-services', family: 'logistics-and-extras', label: 'Something else',
    blurb: 'A wedding service we have not listed yet. Every vendor has a place here.',
    catchAll: true,
  },
];

const CATEGORY_SLUGS = CATEGORIES.map((c) => c.slug);

/**
 * Share of a total budget each category typically takes. Used only to sanity
 * check affordability when routing an enquiry, never shown as a market figure.
 */
const CATEGORY_BUDGET_SHARE = {
  venues: 0.34,
  'marquees-and-tipis': 0.12,
  'celebrants-and-officiants': 0.02,
  catering: 0.22,
  'cakes-and-desserts': 0.03,
  'bar-and-drinks': 0.06,
  photography: 0.08,
  videography: 0.06,
  'decor-and-florals': 0.09,
  'mandap-and-stage': 0.07,
  'lighting-and-production': 0.04,
  'bands-and-live-music': 0.06,
  djs: 0.03,
  'cultural-performers': 0.03,
  'hair-and-makeup': 0.04,
  'mehndi-artists': 0.02,
  'bridalwear-and-tailoring': 0.1,
  jewellery: 0.05,
  planners: 0.07,
  transport: 0.03,
  'stationery-and-invitations': 0.02,
  'photo-booths-and-extras': 0.02,
};

/**
 * The whole of the UK, grouped so a long list stays navigable. The original
 * beachhead areas keep their exact names, so existing data needs no migration.
 * Routing scores same area strongest, then same group, then neighbouring group.
 */
const REGION_GROUPS = [
  { label: 'London', items: [
    'Central London', 'North London', 'East London', 'South London',
    'South East London', 'South West London', 'West London',
  ] },
  { label: 'South East England', items: [
    'Kent', 'West Kent', 'East Kent', 'Surrey', 'East Sussex', 'West Sussex',
    'Hampshire', 'Berkshire', 'Buckinghamshire', 'Oxfordshire', 'Essex',
  ] },
  { label: 'South West England', items: [
    'Bristol and Bath', 'Gloucestershire', 'Wiltshire', 'Somerset',
    'Dorset', 'Devon', 'Cornwall',
  ] },
  { label: 'East of England', items: [
    'Hertfordshire', 'Cambridgeshire', 'Bedfordshire', 'Norfolk', 'Suffolk',
  ] },
  { label: 'Midlands', items: [
    'Birmingham and West Midlands', 'Coventry and Warwickshire', 'Leicestershire',
    'Nottinghamshire', 'Derbyshire', 'Northamptonshire', 'Staffordshire',
    'Shropshire', 'Lincolnshire', 'Herefordshire and Worcestershire',
  ] },
  { label: 'North of England', items: [
    'Manchester and Greater Manchester', 'Liverpool and Merseyside', 'Cheshire',
    'Lancashire', 'Leeds and West Yorkshire', 'Sheffield and South Yorkshire',
    'York and North Yorkshire', 'Hull and East Yorkshire',
    'Newcastle and the North East', 'Cumbria and the Lakes',
  ] },
  { label: 'Wales', items: [
    'Cardiff and South East Wales', 'Swansea and South West Wales',
    'Mid Wales', 'North Wales',
  ] },
  { label: 'Scotland', items: [
    'Edinburgh and the Lothians', 'Glasgow and the West', 'Aberdeen and the North East',
    'Dundee and Tayside', 'Stirling and Central Scotland', 'Highlands and Islands',
    'Scottish Borders', 'Dumfries and Galloway',
  ] },
  { label: 'Northern Ireland', items: [
    'Belfast and County Antrim', 'County Down', 'County Armagh',
    'Derry and the North West', 'Fermanagh and Tyrone',
  ] },
];

const REGIONS = REGION_GROUPS.flatMap((group) => group.items);

/** Which groups border which, for the routing fallback. */
const REGION_GROUP_NEIGHBOURS = {
  London: ['South East England', 'East of England'],
  'South East England': ['London', 'South West England', 'East of England', 'Midlands'],
  'South West England': ['South East England', 'Midlands', 'Wales'],
  'East of England': ['London', 'South East England', 'Midlands'],
  Midlands: ['South East England', 'South West England', 'East of England', 'North of England', 'Wales'],
  'North of England': ['Midlands', 'Scotland', 'Wales'],
  Wales: ['South West England', 'Midlands', 'North of England'],
  Scotland: ['North of England', 'Northern Ireland'],
  'Northern Ireland': ['Scotland'],
};


/* ------------------------------------------------------------------ */
/* traditions                                                          */
/* ------------------------------------------------------------------ */

/**
 * Presets are a starting point, never a closed list. A couple can add their own
 * in free text, and a custom entry is matched and used exactly like a preset.
 * Grouped so a long list stays navigable.
 */
const TRADITION_GROUPS = [
  {
    label: 'Legal and civil',
    items: ['Civil ceremony', 'Register office', 'Humanist', 'Quaker'],
  },
  {
    label: 'Christian',
    items: ['Church of England', 'Catholic', 'Baptist', 'Pentecostal', 'Greek Orthodox',
      'Ethiopian Orthodox', 'Coptic Orthodox', 'Seventh-day Adventist'],
  },
  {
    label: 'Muslim',
    items: ['Nikah', 'Walima', 'Mehndi night', 'Somali traditional', 'Turkish traditional'],
  },
  {
    label: 'Hindu, Sikh and Jain',
    items: ['Hindu ceremony', 'Sikh Anand Karaj', 'Tamil ceremony', 'Gujarati ceremony',
      'Punjabi ceremony', 'Jain ceremony', 'Mehndi', 'Haldi', 'Sangeet'],
  },
  {
    label: 'Jewish',
    items: ['Jewish ceremony', 'Orthodox Jewish', 'Reform Jewish'],
  },
  {
    label: 'African',
    items: ['Nigerian traditional', 'Yoruba traditional', 'Igbo traditional',
      'Ghanaian traditional', 'Kenyan traditional', 'Zimbabwean traditional', 'Eritrean traditional'],
  },
  {
    label: 'Caribbean and Latin',
    items: ['Jamaican traditional', 'Trinidadian traditional', 'Latin American traditional'],
  },
  {
    label: 'East and South East Asian',
    items: ['Chinese tea ceremony', 'Vietnamese traditional', 'Filipino traditional',
      'Korean paebaek', 'Japanese traditional', 'Thai traditional'],
  },
  {
    label: 'Middle Eastern and Central Asian',
    items: ['Persian sofreh aghd', 'Arab traditional', 'Kurdish traditional', 'Afghan traditional'],
  },
  {
    label: 'European',
    items: ['Polish traditional', 'Italian traditional', 'Irish traditional', 'Greek traditional'],
  },
];

const TRADITIONS = TRADITION_GROUPS.flatMap((group) => group.items);

const MAX_TRADITIONS_PER_WEDDING = 12;
const MAX_CUSTOM_TRADITION_LENGTH = 60;

/* ------------------------------------------------------------------ */
/* shared workspace                                                    */
/* ------------------------------------------------------------------ */

/**
 * Roles on a wedding's shared page.
 *
 * The hard rule: a vendor reaches the workspace only once the couple has marked
 * them booked. An enquiry still goes to exactly one vendor, and a vendor who
 * declines or is never booked never gains access. Collaboration is a post
 * booking feature, so it cannot become the bidding swarm this product exists to
 * avoid. See lib/workspace.js, which is the only place access is granted.
 */
const WORKSPACE_ROLES = {
  owner: {
    label: 'Couple',
    description: 'Owns the wedding, sees everything, controls who is invited.',
    can: ['read_all', 'write_all', 'invite', 'revoke', 'see_budget_totals', 'see_guest_list', 'see_payments'],
  },
  planner: {
    label: 'Planner',
    description: 'A professional planner working on this wedding by invitation.',
    can: ['read_all', 'write_plan', 'invite_vendor', 'see_budget_totals', 'see_guest_list'],
  },
  vendor: {
    label: 'Booked vendor',
    description: 'Scoped to their own work. Sees the date, venue, guest count, their own budget line and the day timeline.',
    can: ['read_scoped', 'write_own_tasks', 'comment'],
  },
  helper: {
    label: 'Family or friend',
    description: 'A trusted helper. Can see and tick the checklist and read the timeline.',
    can: ['read_plan', 'write_checklist', 'comment'],
  },
};

/**
 * Facts a booked vendor must never see. Enforced in workspace.js, not just here.
 * A supplier who can see the total budget prices against it rather than against
 * the work, which is bad for the couple and bad for trust.
 */
const VENDOR_HIDDEN_FIELDS = ['budget_total', 'other_vendor_prices', 'full_guest_list', 'payments'];

/* ------------------------------------------------------------------ */
/* published policies                                                  */
/* ------------------------------------------------------------------ */

const VERIFICATION_SCOPE = {
  version: '1.0',
  effective: '2026-08-01',
  headline: 'What AETERNA Verified covers',
  intro:
    'AETERNA Verified is a documented set of checks completed before a vendor can receive enquiries. It is a checklist, not a personal endorsement, and it is not a guarantee of the work a vendor will produce.',
  checks: [
    {
      title: 'Identity',
      detail:
        'We confirm the legal identity behind the business, either a registered company number or a named sole trader with photo identification.',
    },
    {
      title: 'Insurance',
      detail:
        'We sight a current public liability certificate and, where the category requires it, professional indemnity cover. We record the expiry date and chase renewal.',
    },
    {
      title: 'References',
      detail:
        'We contact two recent clients and one industry contact. We record that the references were completed. We do not publish their comments as reviews.',
    },
    {
      title: 'Portfolio rights',
      detail:
        'We ask the vendor to confirm in writing that they hold the rights to every image on their profile and that the work shown is their own.',
    },
    {
      title: 'Video call',
      detail:
        'A member of the AETERNA team completes a live video call with the vendor to confirm the person and the business match the application.',
    },
    {
      title: 'Annual re-checks',
      detail:
        'Every verified vendor repeats the checks each year. Insurance lapses, an unreachable business or a failed re-check removes the badge.',
    },
  ],
  limits: [
    'Verification is a process check. It does not rate quality, taste or value.',
    'AETERNA is not party to the contract between a couple and a vendor.',
    'If any check lapses, the badge is removed until it is completed again.',
  ],
};

const FAIR_USE = {
  version: '1.1',
  effective: '2026-08-05',
  headline: 'AI planner fair use policy',
  intro:
    'The AI planner is generous on the upgraded plan but it is not unlimited. Published limits keep the service fast for everyone and keep costs honest.',
  limits: [
    { label: 'Free plan', value: '20 planner messages in total' },
    { label: 'Upgraded wedding', value: '400 planner messages a month' },
    { label: 'Message length', value: 'Up to 4,000 characters per message' },
    { label: 'Rate', value: 'Up to 20 messages in any 10 minute window' },
  ],
  overage:
    'If you reach a limit, the planner tells you plainly and your plan stays fully readable and editable. The free allowance is a one off total. The upgraded allowance resets at the start of each calendar month.',
  abuse:
    'Automated or resale use is not permitted. We contact anyone whose usage looks automated before taking any action on an account.',
};

/**
 * Seating designer. Shapes carry their footprint so the canvas can draw them
 * to scale, and a sensible seat range so a two seat banquet table cannot exist.
 */
const TABLE_SHAPES = [
  { key: 'round', label: 'Round', minSeats: 2, maxSeats: 14, defaultSeats: 8, width: 12, height: 12 },
  { key: 'square', label: 'Square', minSeats: 2, maxSeats: 12, defaultSeats: 8, width: 11, height: 11 },
  { key: 'rectangle', label: 'Banquet', minSeats: 4, maxSeats: 24, defaultSeats: 10, width: 20, height: 9 },
  { key: 'oval', label: 'Oval', minSeats: 6, maxSeats: 20, defaultSeats: 10, width: 18, height: 11 },
  { key: 'head', label: 'Top table', minSeats: 2, maxSeats: 16, defaultSeats: 6, width: 24, height: 7 },
];
const TABLE_SHAPE_KEYS = TABLE_SHAPES.map((shape) => shape.key);

/**
 * The vendor pipeline. An enquiry moves through these stages, some
 * automatically (accepting moves it to in_conversation, an approved quote
 * moves it to booked) and some by the vendor's own hand.
 */
const PIPELINE_STAGES = [
  { key: 'new', label: 'New' },
  { key: 'in_conversation', label: 'In conversation' },
  { key: 'quoted', label: 'Quoted' },
  { key: 'booked', label: 'Booked' },
  { key: 'closed_lost', label: 'Closed' },
];
const PIPELINE_STAGE_KEYS = PIPELINE_STAGES.map((s) => s.key);

/**
 * The sharing matrix defaults. The couple decides what each booked vendor
 * sees, per data type and per vendor. These are the starting positions; the
 * hard rule that other vendors' prices are never shared is not a setting.
 */
const SHARING_DEFAULTS = {
  budget_total: false,   // a supplier who can see the budget quotes against it
  guest_summary: true,   // headcount and RSVP counts
  dietary_counts: false, // useful to caterers, nobody else needs it
  full_guest_list: false,
};
const SHARING_KEYS = Object.keys(SHARING_DEFAULTS);
const SHARING_LABELS = {
  budget_total: {
    label: 'Total budget',
    detail: 'Your overall figure, not the per vendor lines.',
    warning: 'A supplier who can see the total budget tends to quote against the budget rather than the work. Share it deliberately, not by default.',
  },
  guest_summary: {
    label: 'Guest numbers',
    detail: 'The headcount and RSVP counts, not names.',
    warning: null,
  },
  dietary_counts: {
    label: 'Dietary counts',
    detail: 'How many vegetarian, halal, allergies and so on. Caterers need this, most vendors do not.',
    warning: null,
  },
  full_guest_list: {
    label: 'Full guest list',
    detail: 'Names, sides and groups.',
    warning: 'Most vendors never need names. Share the list only with someone who genuinely does, like your planner or a stationer addressing invitations.',
  },
};

/**
 * The supply cap. Vendor supply must lag couple demand: signing vendors into a
 * patch with no enquiries produces paying customers who get nothing, then
 * cancel. The cap per category and region group is the floor, or one and a
 * half times the enquiries that patch saw in the last 30 days, whichever is
 * larger. Sample listings do not count towards it.
 */
const SUPPLY_CAP = {
  floorPerPatch: 3,
  perEnquiry30d: 1.5,
  windowDays: 30,
};

const ENQUIRY_EXCLUSIVITY_HOURS = 48;

/* ------------------------------------------------------------------ */
/* verification operations                                             */
/* ------------------------------------------------------------------ */

/**
 * The six checks, as keys. These are the same six published in
 * VERIFICATION_SCOPE above, and the admin console works through exactly this
 * list. If a check is added here it must be added to the published scope too,
 * because the badge must never mean more than the page says it means.
 */
const VERIFICATION_CHECKS = [
  {
    key: 'identity',
    label: 'Identity',
    evidencePrompt: 'Company number, or the photo identification you sighted for a sole trader.',
    requiresEvidence: true,
  },
  {
    key: 'insurance',
    label: 'Insurance',
    evidencePrompt: 'Recorded separately, including the insurer and the expiry date.',
    requiresEvidence: false,
    drivenBy: 'insurance_record',
  },
  {
    key: 'references',
    label: 'References',
    evidencePrompt: 'Confirm two recent clients and one industry contact were contacted. Do not paste their comments, they are not reviews.',
    requiresEvidence: true,
  },
  {
    key: 'portfolio_rights',
    label: 'Portfolio rights',
    evidencePrompt: 'Recorded automatically when the vendor confirms in writing that they hold the rights to their images.',
    requiresEvidence: false,
    drivenBy: 'rights_confirmation',
  },
  {
    key: 'video_call',
    label: 'Video call',
    evidencePrompt: 'Date of the call and who at AETERNA completed it.',
    requiresEvidence: true,
  },
  {
    key: 'annual_recheck',
    label: 'Annual re-check',
    evidencePrompt: 'Only relevant after the first year. New vendors pass this automatically until their first anniversary.',
    requiresEvidence: false,
    drivenBy: 'anniversary',
  },
];

const VERIFICATION_CHECK_KEYS = VERIFICATION_CHECKS.map((c) => c.key);

/** How long a completed verification stands before the annual re-check is due. */
const RECHECK_INTERVAL_DAYS = 365;

/** How far ahead the console starts chasing an insurance renewal. */
const INSURANCE_CHASE_DAYS = 45;

/**
 * Categories where professional indemnity is expected on top of public
 * liability, because the work carries advice or coordination risk.
 */
const INDEMNITY_CATEGORIES = ['planners', 'celebrants-and-officiants'];

/* ------------------------------------------------------------------ */
/* uploads                                                             */
/* ------------------------------------------------------------------ */

const UPLOADS = {
  maxBytes: 6 * 1024 * 1024,
  maxImagesPerVendor: 12,
  // Checked by magic bytes, not by the declared content type.
  allowed: {
    'image/jpeg': { ext: '.jpg', magic: [[0xff, 0xd8, 0xff]] },
    'image/png': { ext: '.png', magic: [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]] },
    'image/webp': { ext: '.webp', magic: [[0x52, 0x49, 0x46, 0x46]] },
  },
  /**
   * A vendor must confirm in writing that they hold the rights to every image
   * before any upload is accepted. This is the same confirmation the published
   * verification scope describes, so the two cannot drift apart.
   */
  rightsStatement:
    'I confirm that I hold the rights to every image I upload, that the work shown is my own, and that anyone identifiable in it has agreed to appear on a public profile.',
};

module.exports = {
  PRICING,
  PIPELINE_STAGES,
  PIPELINE_STAGE_KEYS,
  SHARING_DEFAULTS,
  SHARING_KEYS,
  SHARING_LABELS,
  SUPPLY_CAP,
  REGION_GROUPS,
  REGION_GROUP_NEIGHBOURS,
  TABLE_SHAPES,
  TABLE_SHAPE_KEYS,
  VERIFICATION_CHECKS,
  VERIFICATION_CHECK_KEYS,
  RECHECK_INTERVAL_DAYS,
  INSURANCE_CHASE_DAYS,
  INDEMNITY_CATEGORIES,
  UPLOADS,
  FREE_LIMITS,
  UPGRADED_LIMITS,
  CATEGORIES,
  CATEGORY_FAMILIES,
  CATEGORY_SLUGS,
  CATEGORY_BUDGET_SHARE,
  REGIONS,
  TRADITIONS,
  TRADITION_GROUPS,
  MAX_TRADITIONS_PER_WEDDING,
  MAX_CUSTOM_TRADITION_LENGTH,
  WORKSPACE_ROLES,
  VENDOR_HIDDEN_FIELDS,
  VERIFICATION_SCOPE,
  FAIR_USE,
  ENQUIRY_EXCLUSIVITY_HOURS,
};
