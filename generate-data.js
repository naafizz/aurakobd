// generate-data.js — builds JSON demo data for AURAKO
const fs = require('fs');

const brands = [
  { id: "b1", name: "Haenyeo Botanicals", origin: "Jeju Island", tagline: "Deep sea, deeper hydration" },
  { id: "b2", name: "Suhwa", origin: "Seoul", tagline: "Traditional hanbang beauty rituals" },
  { id: "b3", name: "Cloud Nine Lab", origin: "Seoul", tagline: "Cloud-soft skin, science backed" },
  { id: "b4", name: "Mochi & Mineral", origin: "Busan", tagline: "Bouncy skin, mineral rich" },
  { id: "b5", name: "Ginseng House 1954", origin: "Geumsan", tagline: "Six generations of root wisdom" },
  { id: "b6", name: "Petal Theory", origin: "Seoul", tagline: "Flower-fermented actives" },
  { id: "b7", name: "Glasswork Skin", origin: "Seoul", tagline: "The original glass-skin formula" },
  { id: "b8", name: "Barley & Bloom", origin: "Icheon", tagline: "Grain fermented skincare" },
  { id: "b9", name: "Cell Renew Atelier", origin: "Seoul", tagline: "Biotech skincare, luxury feel" },
  { id: "b10", name: "Snow Mushroom Co.", origin: "Gangwon", tagline: "Tremella-powered moisture" },
  { id: "b11", name: "Hanok House", origin: "Jeonju", tagline: "Heritage recipes, modern lab" },
  { id: "b12", name: "Quartz & Silk", origin: "Seoul", tagline: "Mineral clays, silk proteins" },
  { id: "b13", name: "Dawn Ritual", origin: "Seoul", tagline: "Morning skin rituals" },
  { id: "b14", name: "Green Tide", origin: "Wando", tagline: "Marine algae skincare" },
  { id: "b15", name: "Blanc Atelier", origin: "Seoul", tagline: "Minimalist brightening science" }
];

const categories = [
  { id: "cleansers", name: "Cleansers", desc: "Oil, foam & powder cleansers for a clean first step" },
  { id: "toners", name: "Toners & Essences", desc: "Hydrating first-treatment layers" },
  { id: "serums", name: "Serums & Ampoules", desc: "Concentrated actives for targeted results" },
  { id: "moisturizers", name: "Moisturizers", desc: "Creams, gels & emulsions to lock in hydration" },
  { id: "masks", name: "Sheet & Wash-off Masks", desc: "Intensive weekly treatments" },
  { id: "suncare", name: "Suncare", desc: "Lightweight, glow-friendly SPF" },
  { id: "eyecare", name: "Eye Care", desc: "Targeted care for the delicate eye area" },
  { id: "exfoliants", name: "Exfoliants", desc: "Gentle resurfacing & renewal" },
  { id: "lip", name: "Lip Care", desc: "Balms & treatments for soft lips" },
  { id: "sets", name: "Gift Sets", desc: "Curated routines, beautifully packaged" }
];

const skinConcerns = ["Hydration", "Brightening", "Anti-Aging", "Acne & Blemish", "Redness & Sensitivity", "Pores & Texture", "Dullness", "Barrier Repair"];
const skinTypes = ["All Skin Types", "Dry", "Oily", "Combination", "Sensitive", "Normal"];

const productTypesByCategory = {
  cleansers: ["Cleansing Oil", "Foaming Cleanser", "Cleansing Balm", "Powder Cleanser", "Micellar Water", "Cleansing Gel"],
  toners: ["Essence Toner", "First Treatment Essence", "Hydrating Toner", "Balancing Toner", "Ferment Essence"],
  serums: ["Brightening Serum", "Repair Ampoule", "Vitamin C Serum", "Niacinamide Serum", "Peptide Ampoule", "Snail Mucin Serum"],
  moisturizers: ["Water Cream", "Sleeping Mask Cream", "Barrier Cream", "Gel Moisturizer", "Rich Night Cream", "Emulsion"],
  masks: ["Hydrogel Mask", "Sheet Mask", "Clay Wash-off Mask", "Sleeping Mask", "Rubber Mask"],
  suncare: ["Daily Sunscreen SPF50", "Tone-Up Sun Cream", "Sun Stick SPF50+", "Watery Sun Gel"],
  eyecare: ["Eye Cream", "Eye Serum", "Eye Patch Set", "Brightening Eye Balm"],
  exfoliants: ["Peeling Gel", "Enzyme Powder", "AHA Toner Pads", "Exfoliating Cleanser"],
  lip: ["Lip Sleeping Balm", "Lip Treatment Oil", "Tinted Lip Balm"],
  sets: ["4-Step Starter Set", "Glow Ritual Set", "Hydration Duo", "Travel Essentials Kit"]
};

const heroIngredients = ["Centella Asiatica", "Snail Mucin", "Rice Water", "Ginseng Root", "Green Tea", "Camellia Oil", "Propolis", "Niacinamide", "Hyaluronic Acid", "Tremella Mushroom", "Bamboo Sap", "Licorice Root", "Peptide Complex", "Mugwort", "Beta-Glucan", "Fermented Rice", "Sea Buckthorn", "Birch Sap", "Ceramide NP", "Galactomyces"];

const benefitsPool = [
  "Deeply hydrates and plumps skin for up to 72 hours",
  "Visibly brightens dull, tired-looking skin tone",
  "Strengthens the skin barrier against environmental stress",
  "Reduces the look of fine lines and loss of elasticity",
  "Soothes redness and calms sensitive, reactive skin",
  "Refines the look of enlarged pores over time",
  "Delivers a lit-from-within dewy glass-skin finish",
  "Balances oil production without stripping moisture",
  "Fades the appearance of post-blemish marks",
  "Improves overall skin texture and smoothness"
];

function pick(arr){ return arr[Math.floor(Math.random()*arr.length)]; }
function pickN(arr,n){ const c=[...arr]; const out=[]; for(let i=0;i<n && c.length;i++){ out.push(c.splice(Math.floor(Math.random()*c.length),1)[0]); } return out; }
function rand(min,max){ return Math.floor(Math.random()*(max-min+1))+min; }
function seedPicsum(seed,w,h){ return `https://picsum.photos/seed/${seed}/${w}/${h}`; }

const productNamePrefixes = ["Radiant","Pure","Velvet","Dewy","Silk","Glow","Crystal","Jade","Blossom","Luminous","Calm","Tender","Second Skin","Honey","Moon","Pearl","Soft Focus","True","Everyday","Signature"];

let products = [];
let pid = 1;
const catKeys = Object.keys(productTypesByCategory);

for (let i = 0; i < 250; i++) {
  const catId = catKeys[i % catKeys.length];
  const brand = brands[i % brands.length];
  const type = pick(productTypesByCategory[catId]);
  const prefix = pick(productNamePrefixes);
  const hero = pick(heroIngredients);
  const name = `${prefix} ${hero} ${type}`;
  const basePrice = rand(18, 98);
  const onSale = Math.random() < 0.35;
  const discountPct = onSale ? pick([10,15,20,25,30]) : 0;
  const price = onSale ? +(basePrice * (1 - discountPct/100)).toFixed(2) : basePrice;
  const isNew = Math.random() < 0.22;
  const isBestSeller = Math.random() < 0.2;
  const isTrending = Math.random() < 0.18;
  const rating = +(3.8 + Math.random()*1.2).toFixed(1);
  const reviewCount = rand(8, 940);
  const concerns = pickN(skinConcerns, rand(1,3));
  const types = pickN(skinTypes, rand(1,2));
  const size = pick(["30ml","50ml","80ml","100ml","120ml","150ml","200ml","10 sheets","5 pairs"]);

  products.push({
    id: `AK-${String(pid).padStart(4,'0')}`,
    slug: `${name.toLowerCase().replace(/[^a-z0-9]+/g,'-')}-${pid}`,
    name,
    brand: brand.name,
    brandId: brand.id,
    category: catId,
    price,
    originalPrice: basePrice,
    onSale,
    discountPct,
    isNew,
    isBestSeller,
    isTrending,
    rating,
    reviewCount,
    size,
    skinConcerns: concerns,
    skinTypes: types,
    heroIngredient: hero,
    stock: rand(0, 250),
    images: [
      seedPicsum(`ak${pid}a`,800,900),
      seedPicsum(`ak${pid}b`,800,900),
      seedPicsum(`ak${pid}c`,800,900),
      seedPicsum(`ak${pid}d`,800,900)
    ],
    thumb: seedPicsum(`ak${pid}a`,500,560),
    hoverThumb: seedPicsum(`ak${pid}b`,500,560),
    shortDescription: `A ${type.toLowerCase()} powered by ${hero}, formulated to leave skin feeling ${pick(["hydrated and smooth","calm and balanced","bright and refreshed","soft as silk","visibly renewed"])}.`,
    description: `${name} by ${brand.name} is a ${type.toLowerCase()} crafted in ${brand.origin} using time-honored hanbang techniques paired with modern dermatological science. Centered around ${hero}, this formula is designed for ${types.join(" & ").toLowerCase()} skin and targets ${concerns.join(", ").toLowerCase()}. Lightweight yet deeply nourishing, it absorbs quickly into skin without any greasy residue, layering seamlessly into any K-beauty routine. Free from parabens, sulfates and mineral oil, and never tested on animals.`,
    benefits: pickN(benefitsPool, 4),
    howToUse: [
      "After cleansing, apply a small amount to face and neck.",
      "Gently pat and press into skin until fully absorbed.",
      "Follow with the next step in your routine.",
      "Use morning and evening for best results."
    ],
    ingredients: `Water, ${hero} Extract, Butylene Glycol, Glycerin, Niacinamide, Panthenol, Sodium Hyaluronate, Centella Asiatica Extract, Beta-Glucan, Allantoin, Fragrance, Adenosine, Tocopherol.`,
    faqs: [
      { q: "Is this suitable for sensitive skin?", a: "Yes, this formula is fragrance-balanced and dermatologist tested, though we always recommend a patch test first." },
      { q: "Can I use this with retinol or vitamin C?", a: "Yes, it layers well with most actives. Introduce new actives gradually and always follow with SPF in the morning." },
      { q: "How long until I see results?", a: "Most customers report visible improvement in texture and hydration within 2-4 weeks of consistent use." }
    ]
  });
  pid++;
}

products.forEach(p => {
  const others = products.filter(o => o.category === p.category && o.id !== p.id);
  p.relatedIds = pickN(others, Math.min(4, others.length)).map(o => o.id);
  p.fbtIds = pickN(products.filter(o=>o.id!==p.id), 2).map(o=>o.id);
});

fs.writeFileSync('assets/data/products.json', JSON.stringify(products, null, 0));
fs.writeFileSync('assets/data/brands.json', JSON.stringify(brands, null, 2));
fs.writeFileSync('assets/data/categories.json', JSON.stringify(categories, null, 2));

const blogTopics = [
  "The 10-Step Korean Skincare Routine, Explained","Understanding Glass Skin: Myth vs Method","Centella Asiatica: Why K-Beauty Loves This Herb",
  "Double Cleansing 101: Oil First, Foam Second","Snail Mucin Explained: The Science of the Slime","How to Layer Serums Without Overloading Skin",
  "Ginseng in Skincare: An Ancient Root, Reimagined","Fermented Skincare: What It Is and Why It Works","Building a Minimalist K-Beauty Routine",
  "SPF Every Day: Why Korean Sun Care Feels Different","Sheet Masks: How Often Is Too Often?","Barrier Repair: Signs Your Skin Needs a Reset",
  "Niacinamide vs Vitamin C: Which One First?","The Rise of Slow Beauty in Korean Skincare","Seasonal Skincare: Adjusting Your Routine for Winter",
  "What Is a Skin Cycle and Do You Need One?","Rice Water Beauty: Ancient Ritual, Modern Formula","Understanding Your Skin Barrier in 5 Minutes",
  "Why K-Beauty Prioritizes Hydration Over Everything","Peptides Explained: The Building Blocks of Firmness","How to Choose a Moisturizer for Your Skin Type",
  "Mugwort: The Calming Herb Behind Redness Relief","Exfoliation Without Irritation: A Gentle Guide","Travel-Size K-Beauty: Building the Perfect Kit",
  "Ask an Esthetician: Your Skincare Questions Answered"
];
const blogs = blogTopics.map((title, i) => ({
  id: `post-${i+1}`,
  title,
  slug: title.toLowerCase().replace(/[^a-z0-9]+/g,'-'),
  excerpt: `Explore ${title.toLowerCase()} and learn how AURAKO's curated formulas fit into a considered, effective skincare routine.`,
  image: seedPicsum(`blog${i+1}`,700,500),
  date: new Date(2026, (i % 12), rand(1,28)).toISOString().split('T')[0],
  author: pick(["Dr. Mina Park","Soo-ah Lee","The AURAKO Editors","Dr. Hana Cho"]),
  readTime: rand(3,9)
}));
fs.writeFileSync('assets/data/blogs.json', JSON.stringify(blogs, null, 2));

const names = ["Emily R.","Sarah K.","Jasmine T.","Olivia M.","Grace L.","Ava P.","Mia Chen","Isabella W.","Chloe B.","Sophia N.","Hannah J.","Ruby S.","Nora F.","Lily A.","Ella G.","Zoe H.","Amara D.","Priya V.","Yuki S.","Elena C."];
const quotes = [
  "My skin has never felt this hydrated. The glow is unreal after just two weeks.",
  "I've tried every K-beauty brand out there — AURAKO's serums are on another level.",
  "The packaging alone feels luxurious, but the results are what keep me coming back.",
  "Finally a brand that takes sensitive skin seriously. Zero irritation, all glow.",
  "My esthetician actually asked what I was using. That says it all.",
  "The moisturizer is rich but never greasy. Perfect for my combination skin.",
  "I gifted the ritual set to my mom and now we're both obsessed.",
  "Shipping was fast and the customer service team is genuinely lovely.",
  "This is the first brightening serum that actually delivered visible results.",
  "The barrier cream saved my skin during a brutal winter.",
  "I love that every product tells you exactly how to layer it.",
  "Worth every penny — my pores look smaller after a month of consistent use.",
  "The lip sleeping balm is a nightly non-negotiable now.",
  "Clean ingredients, elegant design, and it actually works. Rare combo.",
  "I was skeptical about snail mucin but I'm officially a convert.",
  "AURAKO turned my skincare routine into something I look forward to.",
  "The sun stick is my new everyday essential — no white cast at all.",
  "Customer support helped me build a routine for my skin type in minutes.",
  "This is luxury skincare that doesn't feel like it's just for show.",
  "My redness has calmed down significantly since starting the ritual set."
];
const testimonials = names.map((n,i)=>({
  id: `t-${i+1}`,
  name: n,
  rating: pick([4,5,5,5]),
  quote: quotes[i],
  location: pick(["New York, US","London, UK","Sydney, AU","Toronto, CA","Singapore","Los Angeles, US","Dubai, UAE","Paris, FR"]),
  avatar: seedPicsum(`avatar${i+1}`,120,120)
}));
fs.writeFileSync('assets/data/testimonials.json', JSON.stringify(testimonials, null, 2));

console.log("Generated:", products.length, "products,", brands.length, "brands,", blogs.length, "blogs,", testimonials.length, "testimonials");
