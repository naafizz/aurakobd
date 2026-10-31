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

/* ---------------- load data ---------------- */
const products = JSON.parse(read(path.join(ROOT, "assets/data/products.json")));
const categories = JSON.parse(read(path.join(ROOT, "assets/data/categories.json")));
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
  const meta = plain(p.name) + " price in Bangladesh: " + taka(p.price) + ". " +
    (ownPlain ? ownPlain + " " : "") + "Cash on delivery available nationwide.";
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
    seller: { "@type": "Organization", name: BRAND }
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
    title, desc: d.meta, canonical: url, image: images[0], ogType: "product", price: p.price, ld: [productLd, crumbLd]
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
    : "<p class=\"prose\">" + esc(d.generated) + "</p>";
  const about =
    '<section class="section-sm" id="pdpAbout"><h2>About ' + esc(p.name) + "</h2>" + aboutParas +
    '<p class="prose text-muted">' + (cat ? 'Category: <a href="/category/' + cat.id + '">' + esc(cat.name) + "</a>. " : "") +
    (bp ? 'More from <a href="/brand/' + bp.slug + '">' + esc(bp.name) + "</a>. " : "") +
    'Order online with cash on delivery anywhere in Bangladesh – <a href="shipping.html">delivery information</a>.</p></section>';
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
  html = patchHead(html, { title: o.title, desc: o.desc, canonical: url, image: o.list[0] && o.list[0].thumb, noindex: o.noindex, ld: o.noindex ? [] : [itemLd, crumbLd] });
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
console.log("AURAKO SEO build");
fs.rmSync(OUT, { recursive: true, force: true });
copyDir(ROOT, OUT);

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
    const o = { canonical: SITE + cfg.url, noBase: true, title: cfg.title, desc: cfg.desc, ld: [] };
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
const today = new Date().toISOString().slice(0, 10);
write(path.join(OUT, "sitemap.xml"),
  '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  sitemapUrls.map((u) => "  <url><loc>" + esc(u.loc) + "</loc><lastmod>" + today + "</lastmod><priority>" + u.pr + "</priority></url>").join("\n") +
  "\n</urlset>\n");
write(path.join(OUT, "robots.txt"), "User-agent: *\nAllow: /\n\nSitemap: " + SITE + "/sitemap.xml\n");

console.log("  products:   " + seen.size);
console.log("  categories: " + nCat + " (with products)");
console.log("  brands:     " + brandPages.length + " -> " + brandPages.map((g) => g.slug).join(", "));
console.log("  sitemap:    " + sitemapUrls.length + " urls");
console.log("Done -> dist/");
