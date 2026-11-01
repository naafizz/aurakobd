/* ============================================================
   AURAKO — build-seo.js
   Runs on Vercel (node build-seo.js) and produces ./dist

   What it does (source files are NEVER modified):
   1. Copies the whole site into dist/
   2. Generates a static, crawlable page for every product:   /product/<slug>
      category:                                                /category/<id>
      brand (2+ products):                                     /brand/<brand>
      with unique title, meta description, canonical, Open Graph,
      Product / Breadcrumb / ItemList JSON-LD, and pre-rendered content
   3. Adds canonical / OG / robots tags to the existing pages
   4. Rewrites old links  product.html?slug=x -> /product/x
                          shop.html?cat=x     -> /category/x
   5. Writes sitemap.xml and robots.txt
   6. Cleans the product data before publishing (dist/assets/data/products.json):
      fixes image path typos, merges brand spellings, moves combo packs to "sets",
      fixes obviously wrong categories, removes pasted-in junk text, fixes known
      spelling mistakes, drops broken related-product ids. The source file is not touched.
      Anything it cannot fix on its own is listed under "DATA CHECK" in the build log.
   7. Converts every PNG/JPG in /images to WebP (much smaller, same look) and points the pages to
      the WebP files. Needs the "sharp" package (installed automatically from package.json).
      Also makes small 1200x630 share images (/og/...) for WhatsApp / Facebook previews.
   8. Writes a description for products that have none (built from their own benefits/ingredients).

   Product data comes from assets/data/products.json
   (the file you upload after "Export products.json" in admin).
   No npm packages needed.
   ============================================================ */
"use strict";
const fs = require("fs");
const path = require("path");

const SITE = "https://www.aurako.shop";
const BRAND = "AURAKO";
const ROOT = __dirname;
const OUT = path.join(ROOT, "dist");
const DEFAULT_OG = "/images/mainhero.png";

/* Delivery and return rules used in the Google "Product" data. Keep in sync with shipping.html / refund.html / checkout.html */
const POLICY = {
  handlingDays: [1, 2],
  insideDhaka: { rate: 60, days: [1, 3] },
  outsideDhaka: { rate: 120, days: [3, 5] },
  freeDeliveryCategory: "sets",   // combo packs: free delivery
  returnDays: 3
};
const OTHER_DIVISIONS = ["Chattogram", "Rajshahi", "Khulna", "Barishal", "Sylhet", "Rangpur", "Mymensingh"];
const CONTACT = { email: "aurakobd@gmail.com", phone: "+8801341075034", city: "Dhaka", area: "Gulshan" };
const SOCIAL = ["https://www.facebook.com/Aurakobd/", "https://www.instagram.com/aurakobd/"];

/* Pages that must NOT appear in Google (private / utility / demo content) */
const NOINDEX = new Set([
  "cart.html", "checkout.html", "wishlist.html", "track-order.html", "my-orders.html",
  "order-success.html", "admin.html", "admin12.html", "404.html",
  "category.html",              // replaced by /category/<id>
  "product.html",               // template only; real pages are /product/<slug>
  "blog.html", "blog-post.html" // demo/placeholder articles until real ones are written
]);

/* Existing pages that SHOULD be indexed: path -> optional title/description */
const PAGES = {
  "index.html": { url: "/" },
  "shop.html": {
    url: "/shop.html",
    title: "Shop Korean Skincare Products Online in Bangladesh | AURAKO",
    desc: "Browse all skincare at AURAKO – cleansers, toners, serums, moisturizers and sun care. Cash on delivery available all over Bangladesh."
  },
  "about.html": { url: "/about.html" },
  "contact.html": { url: "/contact.html" },
  "faq.html": { url: "/faq.html" },
  "privacy.html": { url: "/privacy.html" },
  "terms.html": { url: "/terms.html" },
  "refund.html": { url: "/refund.html" },
  "shipping.html": { url: "/shipping.html" }
};

const SKIP_COPY = new Set([
  ".git", ".github", ".vercel", "node_modules", "dist", "build-seo.js", "package.json",
  "package-lock.json", "generate-data.js", "README.md", "FIREBASE-SETUP.md", "image",
  "products.json" // stale root copy; the site reads assets/data/products.json
]);

/* ---------------- helpers ---------------- */
const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const abs = (p) => (/^https?:\/\//i.test(p) ? p : SITE + encodeURI(p.startsWith("/") ? p : "/" + p));
const plain = (s) => String(s || "").replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, "").replace(/\s+/g, " ").trim();
const taka = (n) => "\u09F3" + Number(n || 0).toFixed(0);
const clip = (s, n) => { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length <= n ? s : s.slice(0, n - 1).replace(/\s+\S*$/, "") + "\u2026"; };
const jsonLd = (o) => '<script type="application/ld+json">' + JSON.stringify(o).replace(/</g, "\\u003c") + "</script>";
const warn = (m) => console.warn("  [warn] " + m);
const read = (f) => fs.readFileSync(f, "utf8");
const write = (f, c) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, c); };

function replaceOnce(html, find, repl, label) {
  const i = typeof find === "string" ? html.indexOf(find) : html.search(find);
  if (i === -1) { warn("template part not found: " + label); return html; }
  if (typeof find === "string") return html.slice(0, i) + repl + html.slice(i + find.length);
  return html.replace(find, repl);
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (src === ROOT && SKIP_COPY.has(e.name)) continue;
    if (e.name.startsWith(".")) continue;
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d); else fs.copyFileSync(s, d);
  }
}

/* brand names in the data are typed by hand ("MIssha", "Beauty of joseon") – group them */
const BRAND_ALIASES = { somebimi: "Some By Mi", iamfrom: "I'm From", imfrom: "I'm From" };
const brandKey = (b) => String(b || "").toLowerCase().replace(/[^a-z0-9]/g, "");
function titleCase(s) { return s.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()); }



const toBn = (n) => String(n).replace(/\d/g, (d) => "\u09E6\u09E7\u09E8\u09E9\u09EA\u09EB\u09EC\u09ED\u09EE\u09EF"[d]);

function shippingDetails(p) {
  const free = p.category === POLICY.freeDeliveryCategory || (Array.isArray(p.categories) && p.categories.length > 1);
  const mk = (z, regions) => ({
    "@type": "OfferShippingDetails",
    shippingRate: { "@type": "MonetaryAmount", value: free ? 0 : z.rate, currency: "BDT" },
    shippingDestination: { "@type": "DefinedRegion", addressCountry: "BD", addressRegion: regions },
    deliveryTime: {
      "@type": "ShippingDeliveryTime",
      handlingTime: { "@type": "QuantitativeValue", minValue: POLICY.handlingDays[0], maxValue: POLICY.handlingDays[1], unitCode: "DAY" },
      transitTime: { "@type": "QuantitativeValue", minValue: z.days[0], maxValue: z.days[1], unitCode: "DAY" }
    }
  });
  return [mk(POLICY.insideDhaka, ["Dhaka"]), mk(POLICY.outsideDhaka, OTHER_DIVISIONS)];
}
const returnPolicy = () => ({
  "@type": "MerchantReturnPolicy", applicableCountry: "BD",
  returnPolicyCategory: "https://schema.org/MerchantReturnFiniteReturnWindow",
  merchantReturnDays: POLICY.returnDays, merchantReturnLink: SITE + "/refund.html"
});

/* ---- images: WebP copies + small share images ---- */
let sharp = null;
try { sharp = require("sharp"); } catch (e) { /* optional: the site still works without it */ }

async function optimizeImages(outDir) {
  const map = {};
  if (!sharp) { warn("sharp is not installed - images were NOT converted to WebP"); return map; }
  const dir = path.join(outDir, "images");
  if (!fs.existsSync(dir)) return map;
  const taken = new Set(fs.readdirSync(dir).map((n) => n.toLowerCase()));
  let before = 0, after = 0, n = 0;
  for (const file of fs.readdirSync(dir)) {
    if (!/\.(png|jpe?g)$/i.test(file)) continue;
    const target = file.replace(/\.[^.]+$/, "") + ".webp";
    if (taken.has(target.toLowerCase())) continue;
    try {
      const src = path.join(dir, file);
      const buf = await sharp(src).rotate().resize({ width: 1600, withoutEnlargement: true }).webp({ quality: 82, effort: 5 }).toBuffer();
      const orig = fs.statSync(src).size;
      if (buf.length < orig * 0.85) {
        fs.writeFileSync(path.join(dir, target), buf);
        taken.add(target.toLowerCase());
        map["images/" + file.toLowerCase()] = "images/" + target;
        before += orig; after += buf.length; n++;
      }
    } catch (e) { warn("could not convert " + file + ": " + e.message); }
  }
  console.log("  images:     " + n + " converted to WebP, " + (before / 1048576).toFixed(1) + " MB -> " + (after / 1048576).toFixed(1) + " MB");
  return map;
}

/* 1200x630 JPEG share image (WhatsApp/Facebook skip big images) */
async function makeOg(srcRel, outRel, outDir) {
  if (!sharp || !srcRel) return null;
  const src = path.join(ROOT, srcRel.replace(/^\//, ""));
  if (!fs.existsSync(src)) return null;
  try {
    const fit = /hero/i.test(srcRel) ? "cover" : "contain";
    const buf = await sharp(src).resize(1200, 630, { fit, background: "#F4F1EA" }).flatten({ background: "#F4F1EA" }).jpeg({ quality: 80, mozjpeg: true }).toBuffer();
    write(path.join(outDir, outRel), buf);
    return "/" + outRel;
  } catch (e) { warn("could not make share image for " + srcRel + ": " + e.message); return null; }
}

/* point <img src>, JSON paths etc. to the WebP copies (absolute https:// URLs are left alone) */
function rewriteImageRefs(dir, map) {
  if (!Object.keys(map).length) return 0;
  const re = /(?<=["'(\s,=])(\/?)(images\/[^"'()\s<>\\]+?\.(?:png|jpe?g))(?=["')\s,<>?#\\])/gi;
  let files = 0;
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== "images" && e.name !== "og") walk(p); continue; }
      if (!/\.(html|json)$/i.test(e.name)) continue;
      const txt = fs.readFileSync(p, "utf8");
      const out = txt.replace(re, (m, slash, rel) => (map[rel.toLowerCase()] ? slash + map[rel.toLowerCase()] : m));
      if (out !== txt) { fs.writeFileSync(p, out); files++; }
    }
  })(dir);
  return files;
}

/* ---------------- product data cleaning ---------------- */
/* Add your real brands here once: the exact spelling you want shown everywhere. */
const KNOWN_BRANDS = [
  "COSRX", "Beauty of Joseon", "Missha", "The Face Shop", "The Ordinary", "I'm From", "Dr. Althea", "Some By Mi",
  "Innisfree", "Laneige", "Anua", "Skin1004", "Round Lab", "Torriden", "Medicube", "Mixsoon", "Etude", "Clio",
  "Banila Co", "Tonymoly", "Neogen", "Isntree", "Abib", "Numbuzin", "Axis-Y", "Purito", "Klairs", "Sulwhasoo", "Hera"
];
const BRAND_CANON = { somebimi: "Some By Mi", iamfrom: "I'm From", imfrom: "I'm From" };
KNOWN_BRANDS.forEach((b) => { BRAND_CANON[brandKey(b)] = b; });

/* spelling mistakes that keep coming back (applied to product names only) */
const NAME_TYPOS = [[/\bmusin\b/gi, "mucin"], [/\bessense\b/gi, "essence"], [/\baurbutin\b/gi, "arbutin"], [/\bsunscren\b/gi, "sunscreen"], [/\bmoisturiser\b/gi, "moisturizer"]];

/* text that was pasted from a chat / search page and must never be shown to customers */
const JUNK_LINE = /^\d+\s+sites?$|^\+\d+$|let me know|i can help (you )?(build|with)|^what is your skin type|^are you trying to|if you'd like|^key ingredients? (&|and) benefits$|available via|^show more$|^sources?$/i;

/* keyword -> category. Only used when a product is still in the default "cleansers" category. */
const CAT_RULES = [
  ["suncare", /sun\s?(screen|milk|gel|cream|block|stick|protect|fluid)|\bspf\b|relief sun|\buv\b/i],
  ["exfoliants", /\b(aha|bha|pha)\b|peel|exfoliat/i],
  ["serums", /serum|ampoule/i],
  ["moisturizers", /cream|moisturi[sz]|lotion|gel cream|emulsion/i],
  ["toners", /toner|essence|mist|\bpad/i],
  ["cleansers", /cleanser|cleansing|foam|face\s?wash|facewash|micellar|cleansing oil/i]
];

function slugify(t) { return String(t || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }


const CAT_NOUN = { cleansers: "cleanser", toners: "toner / essence", serums: "serum", moisturizers: "moisturizer", suncare: "sunscreen", exfoliants: "exfoliating toner", sets: "skincare set", masks: "mask" };
const tidyLine = (t) => plain(t).replace(/^[\s\u2022\u2713\u2714*\-\u2013\u2014\u00b7]+/, "").replace(/\s+/g, " ").trim();
function autoDescription(p) {
  let noun = CAT_NOUN[p.category] || "skincare product";
  if (p.category === "toners") noun = /essence/i.test(p.name) ? "essence" : "toner";
  if (p.category === "cleansers" && /foam/i.test(p.name)) noun = "cleansing foam";
  const art = /^[aeiou]/i.test(noun) ? "an" : "a";
  const single = p.brand && String(p.brand).indexOf(",") === -1;
  const heads = [];
  p.benefits.forEach((b) => {
    const l = tidyLine(b); const i = l.indexOf(":");
    const h = i > 2 && i <= 48 ? l.slice(0, i) : (l.length <= 60 ? l.replace(/[.]+$/, "") : "");
    if (h && heads.indexOf(h) === -1 && heads.length < 3) heads.push(h);
  });
  const ing = [];
  (String(p.ingredients).match(/(?:^|[.\n\u2022])\s*([A-Z](?:[^:.\n]|(?<=\d)\.(?=\d)){2,55}?)\s*:/g) || []).forEach((m) => {
    const name = tidyLine(m.replace(/^[.\n\u2022\s]+/, "").replace(/:$/, "")).trim();
    if (name && ing.length < 3 && ing.indexOf(name) === -1) ing.push(name);
  });
  const list = (a) => a.length > 1 ? a.slice(0, -1).join(", ") + " and " + a[a.length - 1] : a[0];
  const parts = [plain(p.name) + " is " + art + " " + noun + (single ? " from " + p.brand : "") + "."];
  const tail = [];
  if (heads.length) tail.push((heads.length > 1 ? "Key benefits: " : "Main benefit: ") + list(heads) + ".");
  if (ing.length) tail.push("Key ingredients include " + list(ing) + ".");
  tail.push("Order online from AURAKO with cash on delivery anywhere in Bangladesh.");
  return { text: parts.concat(tail).join(" "), meta: tail.join(" ") };
}

function cleanProducts(raw, categoryList, check) {
  const catIds = new Set(categoryList.map((c) => c.id));
  /* case-insensitive image lookup: Vercel is case-sensitive, your Mac is not */
  const imgFiles = {};
  const imgDir = path.join(ROOT, "images");
  if (fs.existsSync(imgDir)) fs.readdirSync(imgDir).forEach((n) => { imgFiles[n.toLowerCase()] = n; });
  const fixImg = (rel) => {
    if (!rel || /^(https?:)?\/\//i.test(rel) || /^data:/i.test(rel)) return rel;
    const clean = rel.replace(/^\/+/, "").replace(/^m?ages\//i, "images/");
    const base = clean.replace(/^images\//i, "");
    const hit = imgFiles[base.toLowerCase()];
    return hit ? "images/" + hit : null;
  };

  /* most common spelling for brands that are not in KNOWN_BRANDS */
  const forms = {};
  raw.forEach((p) => {
    if (!p.brand || String(p.brand).indexOf(",") !== -1) return;
    const k = brandKey(p.brand);
    forms[k] = forms[k] || {};
    forms[k][p.brand.trim()] = (forms[k][p.brand.trim()] || 0) + 1;
  });
  const commonForm = (k) => Object.entries(forms[k]).sort((a, b) => b[1] - a[1])[0][0];

  const used = new Set();
  const out = raw.map((src) => {
    const p = JSON.parse(JSON.stringify(src));
    const label = p.name || p.id || "(no name)";

    /* name */
    let name = String(p.name || "").replace(/\s+/g, " ").trim().replace(/\.$/, "");
    NAME_TYPOS.forEach(([re, to]) => { name = name.replace(re, to); });
    if (name !== p.name) check("auto-fixed name: \"" + p.name + "\" -> \"" + name + "\"");
    p.name = name;

    /* slug (never change an existing one: it is the page address) */
    if (!p.slug) { p.slug = slugify(p.id || p.name); check("no slug for \"" + label + "\" -> using \"" + p.slug + "\""); }
    let slug = p.slug, n = 2;
    while (used.has(slug)) slug = p.slug + "-" + n++;
    if (slug !== p.slug) check("duplicate slug \"" + p.slug + "\" -> \"" + slug + "\" (give each product its own slug)");
    p.slug = slug; used.add(slug);
    if (!p.id) p.id = p.slug;

    /* brand */
    if (p.brand && String(p.brand).indexOf(",") === -1) {
      const k = brandKey(p.brand);
      const canon = BRAND_CANON[k] || commonForm(k);
      if (canon !== p.brand) check("brand spelling merged: \"" + p.brand + "\" -> \"" + canon + "\"");
      p.brand = canon;
    }

    /* images */
    const thumb = fixImg(p.thumb) || fixImg((p.images || [])[0]);
    if (!thumb) check("NO IMAGE FOUND for \"" + label + "\" (thumb: " + p.thumb + ")");
    if (thumb && thumb !== p.thumb) check("image path fixed for \"" + label + "\": " + p.thumb + " -> " + thumb);
    p.thumb = thumb || p.thumb;
    const imgs = (p.images || []).map((i) => ({ o: i, f: fixImg(i) }));
    imgs.forEach((i) => { if (i.f && i.f !== i.o) check("image path fixed for \"" + label + "\": " + i.o + " -> " + i.f); });
    p.images = imgs.map((i) => i.f).filter(Boolean);
    if (!p.images.length && p.thumb) p.images = [p.thumb];
    const hover = fixImg(p.hoverThumb);
    p.hoverThumb = hover || p.thumb;

    /* junk text pasted from chats / search pages */
    ["benefits", "howToUse"].forEach((key) => {
      if (!Array.isArray(p[key])) { p[key] = p[key] ? [String(p[key])] : []; return; }
      const before = p[key].length;
      p[key] = p[key].filter((l) => !JUNK_LINE.test(String(l).trim()) && !/^oriental beauty$/i.test(String(l).trim()));
      if (key === "benefits") {   // pasted pages often continue with "How to Use ..." inside the benefits list
        const cut = p[key].findIndex((l) => /^how to use$/i.test(String(l).trim()));
        if (cut > -1) p[key] = p[key].slice(0, cut);
      }
      if (p[key].length !== before) check("removed " + (before - p[key].length) + " pasted junk line(s) from " + key + " of \"" + label + "\" - please clean it in admin too");
    });
    /* text pasted without line breaks: "Cleanse your face.Apply toner." -> two steps */
    p.benefits = p.benefits.flatMap((l) => { l = String(l).replace(/\u00a0/g, " "); return (l.length > 80 && l.indexOf(":") === -1) ? l.split(/(?<=[a-z])(?=[A-Z][a-z])/) : [l]; }).map((l) => l.trim()).filter(Boolean);
    p.howToUse = p.howToUse.flatMap((l) => String(l).replace(/\u00a0/g, " ").split(/(?<=[.!?])(?=[A-Z][a-z])/)).map((l) => l.trim()).filter(Boolean);
    if (p.ingredients) p.ingredients = String(p.ingredients).replace(/\u00a0/g, " ");
    ["faqs", "skinConcerns", "skinTypes", "relatedIds", "fbtIds"].forEach((key) => { if (!Array.isArray(p[key])) p[key] = []; });
    ["description", "shortDescription", "ingredients", "size", "heroIngredient"].forEach((key) => { if (p[key] == null) p[key] = ""; });

    /* category */
    const multi = Array.isArray(p.categories) && p.categories.length > 1;   // this is how checkout detects combo packs
    if (multi && p.category !== "sets" && catIds.has("sets")) {
      check("combo pack \"" + label + "\" moved from \"" + p.category + "\" to \"sets\" (listing only; free delivery still works)");
      p.category = "sets";
    } else if (p.category === "cleansers" || !p.category) {
      const hit = CAT_RULES.find((r) => r[1].test(p.name));
      if (hit && hit[0] !== p.category && catIds.has(hit[0])) {
        check("category auto-fixed for \"" + label + "\": " + (p.category || "none") + " -> " + hit[0]);
        p.category = hit[0];
      }
    } else {
      const hit = CAT_RULES.find((r) => r[1].test(p.name));
      if (hit && hit[0] !== p.category) check("category looks wrong? \"" + label + "\" is in \"" + p.category + "\" but the name suggests \"" + hit[0] + "\" (fix in admin)");
    }
    if (!catIds.has(p.category)) check("unknown category \"" + p.category + "\" for \"" + label + "\"");
    if (Array.isArray(p.categories) && p.categories.length === 1) p.categories = [p.category];

    /* sale numbers */
    p.price = Number(p.price) || 0; p.originalPrice = Number(p.originalPrice) || p.price;
    if (p.price <= 0) check("PRICE MISSING for \"" + label + "\"");
    if (p.originalPrice < p.price) { check("original price is lower than price for \"" + label + "\" - using price"); p.originalPrice = p.price; }
    if (p.onSale && p.originalPrice > p.price && !p.discountPct) p.discountPct = Math.round((1 - p.price / p.originalPrice) * 100);
    p.stock = Number(p.stock); if (!isFinite(p.stock)) p.stock = 0;

    /* no description written yet: build one from the product's own benefits / ingredients */
    if (!String(p.description).trim() && String(p.shortDescription).trim().length < 25) {
      const auto = autoDescription(p);
      p.shortDescription = auto.text;
      p.seoMeta = auto.meta;   // used for the search-result description (does not repeat the product name)
      check("no description for \"" + label + "\" - an automatic one is shown for now (write your own in admin: it ranks better)");
    }
    /* content that helps ranking and buyers */
    if (!p.benefits.length) check("no benefits for \"" + label + "\"");
    if (!multi && !String(p.ingredients).trim()) check("no ingredients for \"" + label + "\"");
    if (!multi && !p.howToUse.length) check("no how-to-use for \"" + label + "\"");
    return p;
  });

  /* related / frequently-bought ids: keep only ids that exist (names of products are also accepted) */
  const byId = new Map(out.map((p) => [String(p.id), p.id]));
  const byName = new Map(out.map((p) => [plain(p.name).toLowerCase(), p.id]));
  out.forEach((p) => {
    ["relatedIds", "fbtIds"].forEach((key) => {
      const fixed = [...new Set(p[key].map((x) => byId.get(String(x)) || byName.get(plain(x).toLowerCase())).filter((x) => x && x !== p.id))];
      if (fixed.length !== p[key].length) check(key + " of \"" + p.name + "\" had ids that do not exist - cleaned");
      p[key] = fixed;
    });
  });
  return out;
}

/* ---------------- load data ---------------- */
const CHECKS = [];
const categories = JSON.parse(read(path.join(ROOT, "assets/data/categories.json")));
const products = cleanProducts(JSON.parse(read(path.join(ROOT, "assets/data/products.json"))), categories, (m) => CHECKS.push(m));
const catById = Object.fromEntries(categories.map((c) => [c.id, c]));

const brandGroups = {}; // key -> {name, products[]}
for (const p of products) {
  if (!p.brand || p.brand.indexOf(",") !== -1) continue; // combos with many brands
  const k = brandKey(p.brand);
  if (!brandGroups[k]) brandGroups[k] = { key: k, count: {}, products: [] };
  brandGroups[k].products.push(p);
  brandGroups[k].count[p.brand.trim()] = (brandGroups[k].count[p.brand.trim()] || 0) + 1;
}
for (const g of Object.values(brandGroups)) {
  const best = Object.entries(g.count).sort((a, b) => b[1] - a[1])[0][0];
  g.name = BRAND_ALIASES[g.key] || (best === best.toLowerCase() || best === best.toUpperCase() && best.length > 5 ? titleCase(best) : best);
  g.slug = g.key.replace(/^(.*)$/, (m) => m) && g.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
const brandOf = (p) => (p.brand && p.brand.indexOf(",") === -1 && brandGroups[brandKey(p.brand)]) ? brandGroups[brandKey(p.brand)] : null;
const brandPages = Object.values(brandGroups).filter((g) => g.products.length >= 2);
const brandPageFor = (p) => { const g = brandOf(p); return g && g.products.length >= 2 ? g : null; };
const brandDisplay = (p) => { const g = brandOf(p); return g ? g.name : BRAND; };

/* ---------------- shell (header/footer/scripts) from product.html ---------------- */
/* old-style links -> clean URLs (used for every page, including the generated ones) */
function rewriteLinks(html) {
  html = html.split("product.html?slug=").join("/product/");
  html = html.split("shop.html?cat=").join("/category/");
  return html.split('href="index.html"').join('href="/"');
}
const productTpl = rewriteLinks(read(path.join(ROOT, "product.html")));

function headBlock(o) {
  const lines = [
    '<link rel="canonical" href="' + esc(o.canonical) + '">',
    '<meta name="robots" content="' + (o.noindex ? "noindex, follow" : "index, follow, max-image-preview:large") + '">',
    '<meta property="og:site_name" content="' + BRAND + '">',
    '<meta property="og:locale" content="en_US">',
    '<meta property="og:type" content="' + (o.ogType || "website") + '">',
    '<meta property="og:title" content="' + esc(o.title) + '">',
    '<meta property="og:description" content="' + esc(o.desc) + '">',
    '<meta property="og:url" content="' + esc(o.canonical) + '">',
    '<meta property="og:image" content="' + esc(abs(o.image || DEFAULT_OG)) + '">',
    '<meta name="twitter:card" content="summary_large_image">',
    '<meta name="twitter:title" content="' + esc(o.title) + '">',
    '<meta name="twitter:description" content="' + esc(o.desc) + '">',
    '<meta name="twitter:image" content="' + esc(abs(o.image || DEFAULT_OG)) + '">'
  ];
  if (o.ogSized) { lines.push('<meta property="og:image:width" content="1200">'); lines.push('<meta property="og:image:height" content="630">'); }
  if (o.preload) lines.push('<link rel="preload" as="image" href="' + esc(o.preload) + '" fetchpriority="high">');
  if (o.price != null) {
    lines.push('<meta property="product:price:amount" content="' + o.price + '">');
    lines.push('<meta property="product:price:currency" content="BDT">');
  }
  (o.ld || []).forEach((x) => lines.push(jsonLd(x)));
  return lines.join("\n");
}

/* swap <title>, description and inject SEO block into any page's <head> */
function patchHead(html, o) {
  if (o.title) html = html.replace(/<title>[\s\S]*?<\/title>/i, "<title>" + esc(o.title) + "</title>");
  else { const m = html.match(/<title>([\s\S]*?)<\/title>/i); o.title = m ? m[1].trim() : BRAND; }
  if (o.desc) {
    if (/<meta\s+name="description"/i.test(html)) html = html.replace(/<meta\s+name="description"[^>]*>/i, '<meta name="description" content="' + esc(o.desc) + '">');
    else html = html.replace(/<\/title>/i, '</title>\n<meta name="description" content="' + esc(o.desc) + '">');
  } else {
    const m = html.match(/<meta\s+name="description"\s+content="([^"]*)"/i);
    o.desc = m ? m[1] : "";
  }
  /* the icon tag can contain ">" inside a data: URI, so match the whole line */
  html = html.replace(/<link rel="icon"[^\n]*\n/i, '<link rel="icon" href="/images/transparentlogo.png" type="image/png">\n');
  /* <base> must come BEFORE every relative stylesheet/script URL */
  if (!o.noBase) html = html.replace(/(<meta charset="UTF-8">)/i, '$1\n<base href="/">');
  return html.replace(/<\/head>/i, headBlock(o) + "\n</head>");
}

/* when <base href="/"> is used, in-page anchors must keep their own path */
function fixAnchors(html, pagePath) {
  return html.replace(/href="(#[^"]*)"/g, (m, h) => 'href="' + pagePath + h + '"');
}

/* ---------------- product page ---------------- */
function productDescription(p) {
  const cat = catById[p.category] ? catById[p.category].name : "skincare";
  const lines = String(p.description || "").split(/\n+/).map((s) => s.trim()).filter(Boolean);
  const own = p.shortDescription && p.shortDescription.trim().length > 25 ? p.shortDescription.trim() : "";
  const generated = "Buy " + p.name + (brandOf(p) ? " by " + brandDisplay(p) : "") + " online in Bangladesh from AURAKO. " +
    "Price " + taka(p.price) + (p.originalPrice > p.price ? " (regular price " + taka(p.originalPrice) + ")" : "") +
    ". Browse more " + cat.toLowerCase() + " with cash on delivery available nationwide.";
  const ownPlain = own.split(/\n+/).map(plain).filter(Boolean).join(", ").replace(/\s+\u2014\s+/g, " ");
  const tailText = p.seoMeta || ownPlain;
  const meta = plain(p.name) + " price in Bangladesh: " + taka(p.price) + " (\u09A6\u09BE\u09AE " + toBn(Math.round(p.price)) + " \u099F\u09BE\u0995\u09BE). " +
    (tailText ? tailText + " " : "") + (p.seoMeta ? "" : "Cash on delivery available nationwide.");
  return { lines, own, generated, meta: clip(meta, 158) };
}

function productPage(p) {
  const url = SITE + "/product/" + p.slug;
  const cat = catById[p.category];
  const d = productDescription(p);
  const title = clip(plain(p.name) + " Price in Bangladesh | " + BRAND, 70);
  const images = [...new Set((p.images && p.images.length ? p.images : [p.thumb]).filter(Boolean))].map(abs);
  const bp = brandPageFor(p);

  const offer = {
    "@type": "Offer", url, priceCurrency: "BDT", price: String(Number(p.price).toFixed(0)),
    availability: p.stock > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
    itemCondition: "https://schema.org/NewCondition",
    seller: { "@type": "Organization", name: BRAND },
    shippingDetails: shippingDetails(p),
    hasMerchantReturnPolicy: returnPolicy()
  };
  const productLd = {
    "@context": "https://schema.org", "@type": "Product",
    name: plain(p.name), image: images, sku: String(p.id), url,
    description: (d.lines.join(" ") || d.own || d.generated).replace(/\s+/g, " ").slice(0, 500),
    brand: { "@type": "Brand", name: brandDisplay(p) },
    category: cat ? cat.name : undefined, offers: offer
    /* no aggregateRating on purpose: only add it when you have real, visible customer reviews */
  };
  const crumbs = [["Home", SITE + "/"], ["Shop", SITE + "/shop.html"]];
  if (cat) crumbs.push([cat.name, SITE + "/category/" + cat.id]);
  crumbs.push([plain(p.name), url]);
  const crumbLd = {
    "@context": "https://schema.org", "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c[0], item: c[1] }))
  };

  let html = productTpl;
  html = patchHead(html, {
    title, desc: d.meta, canonical: url, image: ogPaths[p.slug] || images[0], ogSized: !!ogPaths[p.slug], ogType: "product", price: p.price,
    preload: p.images && p.images[0], ld: [productLd, crumbLd]
  });
  html = fixAnchors(html, "/product/" + p.slug);

  /* pre-render (the page's own JS re-renders the same blocks after load) */
  html = replaceOnce(html, 'id="pdpMainImg" src="" alt=""', 'id="pdpMainImg" src="' + esc(p.images && p.images[0] || p.thumb) + '" alt="' + esc(p.name) + '"', "main image");
  html = replaceOnce(html, /(<div class="breadcrumb" id="pdpCrumb">)[\s\S]*?(<\/div>)/,
    "$1" + '<a href="index.html">Home</a><span class="sep">/</span><a href="shop.html">Shop</a>' +
    (cat ? '<span class="sep">/</span><a href="/category/' + cat.id + '">' + esc(cat.name) + "</a>" : "") +
    '<span class="sep">/</span><span>' + esc(p.name) + "</span>" + "$2", "breadcrumb");
  const priceHtml = '<span class="price-now">' + taka(p.price) + "</span>" +
    (p.originalPrice > p.price ? '<span class="price-old">' + taka(p.originalPrice) + "</span>" : "");
  const infoHtml =
    (bp ? '<a href="/brand/' + bp.slug + '" class="brand-link">' + esc(brandDisplay(p)) + "</a>" : '<span class="brand-link">' + esc(brandDisplay(p)) + "</span>") +
    "<h1>" + esc(p.name) + "</h1>" +
    '<div class="pdp-price-row">' + priceHtml + "</div>" +
    "<p>" + esc(d.own || d.generated) + "</p>" +
    '<div class="pdp-meta-list">' + (p.size ? "<div><b>Size</b><span>" + esc(p.size) + "</span></div>" : "") +
    "<div><b>Availability</b><span>" + (p.stock > 0 ? "In stock" : "Out of stock") + "</span></div></div>";
  html = replaceOnce(html, '<div class="pdp-info" id="pdpInfo"></div>', '<div class="pdp-info" id="pdpInfo">' + infoHtml + "</div>", "pdpInfo");
  const li = (a) => (a || []).filter(Boolean).map((x) => "<li>" + esc(x) + "</li>").join("");
  html = replaceOnce(html, 'id="panel-benefits"></div>', 'id="panel-benefits"><ul class="prose">' + li(p.benefits) + "</ul></div>", "benefits");
  html = replaceOnce(html, 'id="panel-ingredients"></div>', 'id="panel-ingredients"><p class="prose">' + esc(p.ingredients || "") + "</p></div>", "ingredients");
  html = replaceOnce(html, 'id="panel-howto"></div>', 'id="panel-howto"><ol class="prose">' + li(p.howToUse) + "</ol></div>", "howto");

  /* visible "about" text – not touched by the page script, gives every product unique crawlable copy */
  const aboutParas = d.lines.length
    ? "<ul class=\"prose\">" + d.lines.map((l) => "<li>" + esc(l) + "</li>").join("") + "</ul>"
    : "<p class=\"prose\">" + esc(d.own || d.generated) + "</p>";
  const about =
    '<section class="section-sm" id="pdpAbout"><h2>About ' + esc(p.name) + "</h2>" + aboutParas +
    '<p class="prose text-muted">' + (cat ? 'Category: <a href="/category/' + cat.id + '">' + esc(cat.name) + "</a>. " : "") +
    (bp ? 'More from <a href="/brand/' + bp.slug + '">' + esc(bp.name) + "</a>. " : "") +
    'See our <a href="shipping.html">delivery information</a> and <a href="refund.html">return policy</a>.</p></section>';
  html = replaceOnce(html, '<div class="pdp-tab-panel" id="panel-reviews"></div>', '<div class="pdp-tab-panel" id="panel-reviews"></div>\n' + about, "about block");

  html = replaceOnce(html, "</head>", "<script>window.__PRODUCT_SLUG__=" + JSON.stringify(p.slug) + ";</script>\n</head>", "slug var");
  return html;
}

/* ---------------- category & brand listing pages ---------------- */
const imgOk = (rel) => !!rel && fs.existsSync(path.join(ROOT, rel.replace(/^\//, "")));
function cardHtml(p) {
  const badges = (p.onSale && p.discountPct ? '<span class="badge badge-sale">-' + p.discountPct + "%</span>" : "") +
    (p.isNew ? '<span class="badge badge-new">New</span>' : "") + (p.isBestSeller ? '<span class="badge badge-best">Best Seller</span>' : "");
  const price = p.onSale && p.originalPrice > p.price
    ? '<span class="price-now">' + taka(p.price) + '</span><span class="price-old">' + taka(p.originalPrice) + "</span>"
    : '<span class="price-now">' + taka(p.price) + "</span>";
  const href = "/product/" + p.slug;
  return '<div class="product-card" data-id="' + esc(p.id) + '"><div class="product-card-media">' +
    '<div class="product-badges">' + badges + "</div>" +
    '<button class="wishlist-toggle" data-wishlist="' + esc(p.id) + '" aria-label="Toggle wishlist"><svg viewBox="0 0 24 24"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 1 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/></svg></button>' +
    '<a href="' + esc(href) + '"><img class="img-1" src="' + esc(p.thumb) + '" loading="lazy" alt="' + esc(p.name) + '"><img class="img-2" src="' + esc(imgOk(p.hoverThumb) ? p.hoverThumb : p.thumb) + '" loading="lazy" alt=""></a>' +
    '<div class="product-card-actions"><button class="btn btn-dark ripple-surface" data-quickview="' + esc(p.id) + '">Quick View</button>' +
    '<button class="btn btn-primary ripple-surface" data-addcart="' + esc(p.id) + '">Add to Cart</button></div></div>' +
    '<div class="product-card-body"><div class="product-card-brand">' + esc(brandDisplay(p)) + "</div>" +
    '<h3 class="product-card-name"><a href="' + esc(href) + '">' + esc(p.name) + "</a></h3>" +
    '<div class="price-row" style="margin-top:6px;">' + price + "</div></div></div>";
}

function listingPage(o) {
  /* o: {path, title, desc, h1, intro, list, crumbs, extra, noindex} */
  const url = SITE + o.path;
  const itemLd = {
    "@context": "https://schema.org", "@type": "CollectionPage", name: o.h1, url, description: o.desc,
    mainEntity: { "@type": "ItemList", itemListElement: o.list.map((p, i) => ({ "@type": "ListItem", position: i + 1, url: SITE + "/product/" + p.slug, name: p.name })) }
  };
  const crumbs = [["Home", SITE + "/"], ["Shop", SITE + "/shop.html"]].concat(o.crumbs, [[o.h1, url]]);
  const crumbLd = {
    "@context": "https://schema.org", "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c[0], item: c[1] }))
  };
  let html = productTpl;
  html = patchHead(html, { title: o.title, desc: o.desc, canonical: url, image: (o.list[0] && ogPaths[o.list[0].slug]) || (o.list[0] && o.list[0].thumb), ogSized: !!(o.list[0] && ogPaths[o.list[0].slug]), noindex: o.noindex, ld: o.noindex ? [] : [itemLd, crumbLd] });
  html = fixAnchors(html, o.path);
  const crumbHtml = '<a href="index.html">Home</a><span class="sep">/</span><a href="shop.html">Shop</a>' +
    o.crumbs.map((c) => '<span class="sep">/</span><a href="' + esc(c[1].replace(SITE, "")) + '">' + esc(c[0]) + "</a>").join("") +
    '<span class="sep">/</span><span>' + esc(o.h1) + "</span>";
  const grid = o.list.length
    ? '<div class="grid product-grid">' + o.list.map(cardHtml).join("") + "</div>"
    : '<p class="prose">New products are coming soon. Meanwhile, <a href="shop.html">browse all products</a>.</p>';
  const main = '<main id="main"><div class="container" style="padding-top:var(--space-6);"><div class="breadcrumb">' + crumbHtml + "</div></div>" +
    '<div class="container section-sm"><h1>' + esc(o.h1) + '</h1><p class="prose" style="max-width:70ch;margin:var(--space-3) 0 var(--space-6);">' + esc(o.intro) + "</p>" +
    grid + (o.extra || "") + "</div></main>";
  html = replaceOnce(html, /<main id="main">[\s\S]*<\/main>/, main.replace(/\$/g, "$$$$"), "main block");
  /* drop the product-only script (last inline script) */
  const i = html.lastIndexOf("<script>");
  if (i > -1 && html.slice(i).indexOf("pdpInfo") > -1) html = html.slice(0, i) + html.slice(html.indexOf("</script>", i) + 9);
  else warn("product script not removed from listing page " + o.path);
  return html;
}

/* ---------------- build ---------------- */
const ogPaths = {};   // product slug -> /og/<slug>.jpg
let defaultOg = null;
(async function main() {
console.log("AURAKO SEO build");
fs.rmSync(OUT, { recursive: true, force: true });
copyDir(ROOT, OUT);
write(path.join(OUT, "assets/data/products.json"), JSON.stringify(products));   // the website loads the cleaned data

/* share images (1200x630) for WhatsApp / Facebook */
for (const p of products) { const o = await makeOg(p.thumb, "og/" + p.slug + ".jpg", OUT); if (o) ogPaths[p.slug] = o; }
defaultOg = await makeOg(DEFAULT_OG, "og/default.jpg", OUT);
const imgMap = await optimizeImages(OUT);   // WebP copies; pages are pointed to them at the very end

const sitemapUrls = [];
const addUrl = (loc, pr) => sitemapUrls.push({ loc, pr });

/* 1. existing pages: link rewrites + SEO head */
const topBrands = brandPages.sort((a, b) => b.products.length - a.products.length).slice(0, 4).map((g) => g.name);
const homeDesc = "Shop skincare online in Bangladesh at AURAKO – " + (topBrands.length ? topBrands.join(", ") + " and more. " : "") + "Cash on delivery available nationwide.";
const orgLd = {
  "@context": "https://schema.org", "@type": "Organization", name: BRAND, url: SITE + "/",
  logo: abs("/images/transparentlogo.png"), sameAs: SOCIAL,
  email: CONTACT.email, telephone: CONTACT.phone,
  address: { "@type": "PostalAddress", addressLocality: CONTACT.city, addressCountry: "BD" }
};
const siteLd = { "@context": "https://schema.org", "@type": "WebSite", name: BRAND, url: SITE + "/", potentialAction: { "@type": "SearchAction", target: SITE + "/shop.html?q={search_term_string}", "query-input": "required name=search_term_string" } };

for (const f of fs.readdirSync(OUT).filter((x) => x.endsWith(".html"))) {
  let html = read(path.join(OUT, f));
  html = rewriteLinks(html);
  if (f === "product.html") {
    html = patchHead(html, { title: "Product | " + BRAND, desc: "AURAKO product page.", canonical: SITE + "/shop.html", noindex: true, noBase: true });
  } else if (NOINDEX.has(f)) {
    html = patchHead(html, { canonical: SITE + "/" + f, noindex: true, noBase: true });
  } else if (PAGES[f]) {
    const cfg = PAGES[f];
    const o = { canonical: SITE + cfg.url, noBase: true, title: cfg.title, desc: cfg.desc, ld: [], image: defaultOg || DEFAULT_OG, ogSized: !!defaultOg };
    if (f === "index.html") {
      o.title = "AURAKO – Korean Skincare Online in Bangladesh";
      o.desc = homeDesc;
      o.ld = [orgLd, siteLd];
    }
    html = patchHead(html, o);
    addUrl(cfg.url === "/" ? SITE + "/" : SITE + cfg.url, f === "index.html" ? "1.0" : f === "shop.html" ? "0.9" : "0.5");
  } else {
    html = patchHead(html, { canonical: SITE + "/" + f, noindex: true, noBase: true });
    warn(f + " is not in PAGES / NOINDEX – marked noindex");
  }
  write(path.join(OUT, f), html);
}

/* 2. products */
const seen = new Set();
for (const p of products) {
  if (!p.slug || seen.has(p.slug)) { warn("skipped product without unique slug: " + p.name); continue; }
  seen.add(p.slug);
  write(path.join(OUT, "product", p.slug + ".html"), productPage(p));
  addUrl(SITE + "/product/" + p.slug, "0.8");
}

/* 3. categories */
let nCat = 0;
for (const c of categories) {
  const list = products.filter((p) => p.category === c.id);
  const intro = c.desc
    ? c.name + ": " + c.desc.replace(/\.$/, "") + ". Shop " + c.name.toLowerCase() + " online in Bangladesh at AURAKO with cash on delivery available nationwide."
    : "Shop " + c.name.toLowerCase() + " online in Bangladesh at AURAKO.";
  const others = categories.filter((x) => x.id !== c.id && products.some((p) => p.category === x.id));
  const extra = others.length ? '<section class="section-sm"><h2>More categories</h2><p class="prose">' +
    others.map((x) => '<a href="/category/' + x.id + '">' + esc(x.name) + "</a>").join(" · ") + "</p></section>" : "";
  const empty = list.length === 0;
  write(path.join(OUT, "category", c.id + ".html"), listingPage({
    path: "/category/" + c.id, title: c.name + " Price in Bangladesh | " + BRAND,
    desc: clip(intro, 158), h1: c.name, intro, list, crumbs: [], extra, noindex: empty
  }));
  if (!empty) { addUrl(SITE + "/category/" + c.id, "0.8"); nCat++; }
}

/* 4. brands (2+ products) */
for (const g of brandPages) {
  const intro = "Buy " + g.name + " products online in Bangladesh from AURAKO. " + g.products.length + " products available, with cash on delivery nationwide.";
  write(path.join(OUT, "brand", g.slug + ".html"), listingPage({
    path: "/brand/" + g.slug, title: g.name + " Products Price in Bangladesh | " + BRAND,
    desc: clip(intro, 158), h1: g.name, intro, list: g.products, crumbs: []
  }));
  addUrl(SITE + "/brand/" + g.slug, "0.7");
}

/* 5. sitemap.xml + robots.txt */
write(path.join(OUT, "sitemap.xml"),
  '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  sitemapUrls.map((u) => "  <url><loc>" + esc(u.loc) + "</loc><priority>" + u.pr + "</priority></url>").join("\n") +
  "\n</urlset>\n");
write(path.join(OUT, "robots.txt"), "User-agent: *\nAllow: /\n\nSitemap: " + SITE + "/sitemap.xml\n");

console.log("  products:   " + seen.size);
console.log("  categories: " + nCat + " (with products)");
console.log("  brands:     " + brandPages.length + " -> " + brandPages.map((g) => g.slug).join(", "));
console.log("  sitemap:    " + sitemapUrls.length + " urls");
const rewritten = rewriteImageRefs(OUT, imgMap);
if (rewritten) console.log("  webp:       pointed " + rewritten + " files to WebP images");
console.log("Done -> dist/");
if (CHECKS.length) {
  console.log("\nDATA CHECK (" + CHECKS.length + ") - things the build fixed or you should look at:");
  CHECKS.forEach((c) => console.log("  - " + c));
}
})().catch((e) => { console.error(e); process.exit(1); });
