/* ============================================================
   STOREFRONT MODULE  —  customer-facing catalog (back-office side)

   Depends on Simple Store: reads the same products. If simplestore
   isn't loaded, this module does NOT register — no nav, no page.
   This <script> MUST load AFTER simplestore.js in index.html.

   Phase 1: section builder — add / delete / toggle / drag-reorder
   the storefront layout sections. Section internals come later.
   ============================================================ */
(function(){
  const ID = 'storefront';
  const KEY = 'mod_storefront_config';       // draft — edited freely, no customer sees it
  const PUB_KEY = 'mod_storefront_published'; // live — only changes on Publish
  const esc = (s)=> window.escapeHtml(String(s == null ? '' : s));
  const T = (k)=> window.moduleI18n(ID)(k);

  // Dependency gate: no Simple Store -> don't register at all.
  if(!window.getModule || !window.getModule('stock')){
    return;
  }

  // Section types available in the builder (matches the storefront design).
  const SECTION_TYPES = ['hero', 'features', 'categories', 'products', 'promo', 'news', 'contact'];
  // The Shop Layout gets one extra: the filtered product listing. It's exclusive
  // to the Shop page — the Home Layout can't add it.
  const SHOP_ONLY_TYPES = ['productlist'];
  // The About Layout has its own restricted set (no products/categories/promo).
  const ABOUT_TYPES = ['features', 'cards', 'news', 'contact'];
  // The Product Detail Layout: everything below the built-in detail block.
  const DETAIL_TYPES = ['products', 'promo', 'contact', 'features', 'news', 'cards', 'categories'];
  // 'productdetail' is a PLACEHOLDER row for the hard-coded detail block in
  // shop.html — it can't be added, edited, moved, disabled or deleted.
  const LOCKED_TYPES = ['hero', 'productdetail'];
  const isLockedType = (t)=> LOCKED_TYPES.indexOf(t) >= 0;
  // Singletons: only one allowed per layout.
  const SINGLETON_TYPES = ['hero', 'productlist'];
  const SECTION_ICON = { hero:'\u{1F5BC}\uFE0F', features:'\u2B50', categories:'\u{1F5C2}\uFE0F', products:'\u{1F6CD}\uFE0F', promo:'\u{1F3F7}\uFE0F', news:'\u{1F4F0}', contact:'\u{1F4EC}', productlist:'\u{1F6CD}\uFE0F', cards:'\u{1F5C3}\uFE0F', productdetail:'\u{1F50D}' };

  // Which section types each layout may contain.
  function allowedTypes(){
    if(subPage === 'shoplayout') return SECTION_TYPES.concat(SHOP_ONLY_TYPES);
    if(subPage === 'aboutlayout') return ABOUT_TYPES;
    if(subPage === 'detaillayout') return DETAIL_TYPES;
    return SECTION_TYPES;
  }

  const rid = ()=> Math.random().toString(36).slice(2, 10);

  let config = null;   // { sections: [...], theme: {...} }
  let dragFromIndex = null;

  function defaultConfig(){
    // A sensible starter layout - the order the design shows.
    const mk = (type)=> ({ id: rid(), type, enabled:true, data: defaultDataFor(type) });
    return {
      storeName: 'Artisan Store',
      storeNameColors: { mode:'theme', bg:'#FFFFFF', text:'#2B2E26', card:'#FFFFFF', accent:'#6B7F58' },
      sections: [
        mk('hero'), mk('features'), mk('categories'),
        mk('products'), mk('promo'), mk('news'), mk('contact')
      ],
      shopSections: defaultShopSections(),
      aboutSections: defaultAboutSections(),
      detailSections: defaultDetailSections(),
      theme: { preset:'default', mode:'light' }
    };
  }

  // Default Shop page layout: Hero, a Best Selling products strip, then the
  // filtered product listing (grid + auto filter sidebar).
  function defaultShopSections(){
    const mk = (type)=> ({ id: rid(), type, enabled:true, data: defaultDataFor(type) });
    const best = mk('products');
    best.data.heading = 'Best Selling Products';
    return [ mk('hero'), best, mk('productlist') ];
  }

  // Default Product Detail layout: the locked detail placeholder, then
  // Best Selling / Promotion / Follow Us underneath it.
  function detailPlaceholder(){ return { id: rid(), type:'productdetail', enabled:true, data:{} }; }
  function defaultDetailSections(){
    const mk = (type)=> ({ id: rid(), type, enabled:true, data: defaultDataFor(type) });
    const best = mk('products');
    best.data.heading = 'Best Selling Products';
    return [ detailPlaceholder(), best, mk('promo'), mk('contact') ];
  }
  // The placeholder always exists and always sits first.
  function ensureDetailFirst(list){
    if(!Array.isArray(list)) return;
    const i = list.findIndex(s=> s.type === 'productdetail');
    if(i < 0){ list.unshift(detailPlaceholder()); return; }
    if(i > 0){ const [ph] = list.splice(i, 1); list.unshift(ph); }
  }

  // Default About page layout: a Feature Bar and a manual image+title cards row.
  // No Hero — About Us doesn't use a store header.
  function defaultAboutSections(){
    const mk = (type)=> ({ id: rid(), type, enabled:true, data: defaultDataFor(type) });
    return [ mk('features'), mk('cards') ];
  }

  async function loadConfig(){
    const saved = await window.Store.get(KEY);
    if(saved && Array.isArray(saved.sections)){
      config = saved;
      let changed = false;
      if(!config.theme){ config.theme = { preset:'default', mode:'light' }; changed = true; }
      // Older drafts predate the Shop/About layouts — add them, and PERSIST, so
      // the stored draft (what Preview and Publish read) matches the builder.
      if(!Array.isArray(config.shopSections)){ config.shopSections = defaultShopSections(); changed = true; }
      if(!Array.isArray(config.aboutSections)){ config.aboutSections = defaultAboutSections(); changed = true; }
      if(!Array.isArray(config.detailSections)){ config.detailSections = defaultDetailSections(); changed = true; }
      if(!config.detailSections.some(x=> x.type === 'productdetail')){ ensureDetailFirst(config.detailSections); changed = true; }
      ensureHeroFirst(config.sections);
      ensureHeroFirst(config.shopSections);
      ensureDetailFirst(config.detailSections);
      if(config.aboutSections.some(s=> s.type === 'hero')){
        config.aboutSections = config.aboutSections.filter(s=> s.type !== 'hero');  // About has no Hero
        changed = true;
      }
      if(changed) await saveConfig();
    }else{
      config = defaultConfig();
      await saveConfig();
    }
  }
  async function saveConfig(){ await window.Store.set(KEY, config); }

  // Draft vs published: the customer only ever sees the published copy.
  async function getPublished(){ return await window.Store.get(PUB_KEY); }
  async function publishNow(){
    // Snapshot the current draft into the published slot.
    await window.Store.set(PUB_KEY, config);
  }
  async function isDirty(){
    // Dirty = draft differs from published (or nothing published yet).
    const pub = await getPublished();
    if(!pub) return true;
    return JSON.stringify(pub) !== JSON.stringify(config);
  }

  // Hero is pinned to the top of whichever layout it's in. Force it to index 0.
  function ensureHeroFirst(list){
    if(!Array.isArray(list)) return;
    const hi = list.findIndex(s=> s.type === 'hero');
    if(hi > 0){
      const [hero] = list.splice(hi, 1);
      list.unshift(hero);
    }
  }

  // The section list the builder is currently editing — Home vs Shop layout.
  function curSections(){
    if(subPage === 'shoplayout'){
      if(!Array.isArray(config.shopSections)) config.shopSections = defaultShopSections();
      return config.shopSections;
    }
    if(subPage === 'aboutlayout'){
      if(!Array.isArray(config.aboutSections)) config.aboutSections = defaultAboutSections();
      return config.aboutSections;
    }
    if(subPage === 'detaillayout'){
      if(!Array.isArray(config.detailSections)) config.detailSections = defaultDetailSections();
      return config.detailSections;
    }
    return config.sections;
  }

  window.registerModuleI18n(ID, {
    th: {
      'io.exportTitle': 'สำรองข้อมูลหน้าร้าน', 'io.exportDesc': 'ดาวน์โหลด layout ทั้งหมด (Home/Shop/About) + ธีม และฉบับ publish เป็น JSON',
      'io.json': 'ดาวน์โหลด JSON (สำรองทั้งหมด)', 'io.importTitle': 'นำเข้าข้อมูลหน้าร้าน', 'io.importDesc': 'อัปโหลดไฟล์ JSON — จะเขียนทับ layout หน้าร้านทั้งหมด (ไม่ใช่การรวม)',
      'io.chooseFile': 'เลือกไฟล์', 'io.noFile': 'ยังไม่ได้เลือกไฟล์', 'io.importBtn': 'ยืนยันนำเข้า', 'io.replaceWarn': 'การนำเข้าจะเขียนทับ layout หน้าร้านปัจจุบันทั้งหมด ยืนยันไหม?',
      'io.importDone': 'นำเข้าสำเร็จ', 'io.importFail': 'ไฟล์ไม่ถูกต้อง',
      'title': '\u0E2B\u0E19\u0E49\u0E32\u0E23\u0E49\u0E32\u0E19\u0E2D\u0E2D\u0E19\u0E44\u0E25\u0E19\u0E4C',
      'crumb': '\u0E08\u0E31\u0E14\u0E01\u0E32\u0E23\u0E2B\u0E19\u0E49\u0E32\u0E23\u0E49\u0E32\u0E19\u0E04\u0E49\u0E32\u0E2D\u0E2D\u0E19\u0E44\u0E25\u0E19\u0E4C',
      'viewShop': '\u{1F517} \u0E14\u0E39\u0E2B\u0E19\u0E49\u0E32\u0E23\u0E49\u0E32\u0E19\u0E08\u0E23\u0E34\u0E07',
      'layout.title': '\u0E08\u0E31\u0E14 Layout \u0E2B\u0E19\u0E49\u0E32\u0E23\u0E49\u0E32\u0E19',
      'layout.desc': '\u0E25\u0E32\u0E01\u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E2A\u0E25\u0E31\u0E1A\u0E25\u0E33\u0E14\u0E31\u0E1A Section \u00B7 \u0E40\u0E1B\u0E34\u0E14/\u0E1B\u0E34\u0E14\u0E01\u0E32\u0E23\u0E41\u0E2A\u0E14\u0E07\u0E1C\u0E25 \u00B7 \u0E40\u0E1E\u0E34\u0E48\u0E21\u0E2B\u0E23\u0E37\u0E2D\u0E25\u0E1A Section \u0E44\u0E14\u0E49',
      'addSection': '+ \u0E40\u0E1E\u0E34\u0E48\u0E21 Section',
      'empty': '\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E21\u0E35 Section \u2014 \u0E40\u0E1E\u0E34\u0E48\u0E21 Section \u0E41\u0E23\u0E01\u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E40\u0E23\u0E34\u0E48\u0E21\u0E08\u0E31\u0E14\u0E2B\u0E19\u0E49\u0E32\u0E23\u0E49\u0E32\u0E19',
      'on': '\u0E40\u0E1B\u0E34\u0E14', 'off': '\u0E1B\u0E34\u0E14',
      'delete': '\u0E25\u0E1A',
      'confirmDelete': '\u0E25\u0E1A Section \u0E19\u0E35\u0E49\u0E2D\u0E2D\u0E01\u0E08\u0E32\u0E01\u0E2B\u0E19\u0E49\u0E32\u0E23\u0E49\u0E32\u0E19?',
      'edit.soon': '\u0E23\u0E32\u0E22\u0E25\u0E30\u0E40\u0E2D\u0E35\u0E22\u0E14\u0E20\u0E32\u0E22\u0E43\u0E19 Section \u0E19\u0E35\u0E49 \u2014 \u0E40\u0E14\u0E35\u0E4B\u0E22\u0E27\u0E40\u0E23\u0E32\u0E08\u0E30\u0E21\u0E32\u0E17\u0E33\u0E43\u0E19\u0E40\u0E1F\u0E2A\u0E16\u0E31\u0E14\u0E44\u0E1B\u0E04\u0E48\u0E30',
      'type.hero': 'Header / Hero', 'type.features': '\u0E41\u0E16\u0E1A\u0E08\u0E38\u0E14\u0E40\u0E14\u0E48\u0E19 (Features)',
      'type.categories': '\u0E2B\u0E21\u0E27\u0E14\u0E2B\u0E21\u0E39\u0E48\u0E2A\u0E34\u0E19\u0E04\u0E49\u0E32 (Categories)', 'type.products': '\u0E23\u0E32\u0E22\u0E01\u0E32\u0E23\u0E2A\u0E34\u0E19\u0E04\u0E49\u0E32 (Products)',
      'type.promo': '\u0E41\u0E1A\u0E19\u0E40\u0E19\u0E2D\u0E23\u0E4C\u0E42\u0E1B\u0E23\u0E42\u0E21\u0E0A\u0E31\u0E19 (Promo)',
      'type.news': '\u0E02\u0E48\u0E32\u0E27\u0E2A\u0E32\u0E23 (News)', 'type.contact': '\u0E0A\u0E48\u0E2D\u0E07\u0E17\u0E32\u0E07\u0E15\u0E34\u0E14\u0E15\u0E48\u0E2D (Contact)',
      'type.productlist': '\u0E23\u0E32\u0E22\u0E01\u0E32\u0E23\u0E2A\u0E34\u0E19\u0E04\u0E49\u0E32 + \u0E15\u0E31\u0E27\u0E01\u0E23\u0E2D\u0E07 (Product Listing)',
      'type.cards': '\u0E01\u0E32\u0E23\u0E4C\u0E14\u0E23\u0E39\u0E1B + \u0E0A\u0E37\u0E48\u0E2D (Cards)',
      'cards.title': '\u0E01\u0E32\u0E23\u0E4C\u0E14 (\u0E23\u0E39\u0E1B + \u0E0A\u0E37\u0E48\u0E2D)', 'cards.heading': '\u0E2B\u0E31\u0E27\u0E02\u0E49\u0E2D', 'cards.add': '+ \u0E40\u0E1E\u0E34\u0E48\u0E21\u0E01\u0E32\u0E23\u0E4C\u0E14', 'cards.max': '\u0E2A\u0E39\u0E07\u0E2A\u0E38\u0E14 12 \u0E01\u0E32\u0E23\u0E4C\u0E14', 'cards.image': '\u0E23\u0E39\u0E1B', 'cards.itemTitle': '\u0E0A\u0E37\u0E48\u0E2D\u0E01\u0E32\u0E23\u0E4C\u0E14',
      'pl.title': '\u0E23\u0E32\u0E22\u0E01\u0E32\u0E23\u0E2A\u0E34\u0E19\u0E04\u0E49\u0E32 (Product Listing)', 'pl.heading': '\u0E2B\u0E31\u0E27\u0E02\u0E49\u0E2D',
      'pl.note': '\u0E15\u0E31\u0E27\u0E01\u0E23\u0E2D\u0E07\u0E14\u0E49\u0E32\u0E19\u0E0B\u0E49\u0E32\u0E22 (\u0E2B\u0E21\u0E27\u0E14\u0E2B\u0E21\u0E39\u0E48/\u0E23\u0E32\u0E04\u0E32/\u0E25\u0E14\u0E23\u0E32\u0E04\u0E32) \u0E41\u0E25\u0E30 grid 4 \u0E0A\u0E34\u0E49\u0E19\u0E15\u0E48\u0E2D\u0E41\u0E16\u0E27 \u00D7 6 \u0E41\u0E16\u0E27\u0E15\u0E48\u0E2D\u0E2B\u0E19\u0E49\u0E32 \u0E08\u0E30\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E43\u0E2B\u0E49\u0E2D\u0E31\u0E15\u0E42\u0E19\u0E21\u0E31\u0E15\u0E34\u0E43\u0E19\u0E2B\u0E19\u0E49\u0E32 Shop \u00B7 \u0E40\u0E1E\u0E34\u0E48\u0E21\u0E44\u0E14\u0E49\u0E40\u0E09\u0E1E\u0E32\u0E30\u0E2B\u0E19\u0E49\u0E32 Shop \u0E40\u0E17\u0E48\u0E32\u0E19\u0E31\u0E49\u0E19',
      'typedesc.hero': '\u0E23\u0E39\u0E1B\u0E2B\u0E31\u0E27\u0E23\u0E49\u0E32\u0E19 + \u0E02\u0E49\u0E2D\u0E04\u0E27\u0E32\u0E21\u0E15\u0E49\u0E2D\u0E19\u0E23\u0E31\u0E1A',
      'typedesc.features': '\u0E44\u0E2D\u0E04\u0E2D\u0E19 + \u0E02\u0E49\u0E2D\u0E04\u0E27\u0E32\u0E21\u0E08\u0E38\u0E14\u0E40\u0E14\u0E48\u0E19 \u0E40\u0E0A\u0E48\u0E19 \u0E08\u0E31\u0E14\u0E2A\u0E48\u0E07\u0E1F\u0E23\u0E35 / \u0E04\u0E37\u0E19\u0E2A\u0E34\u0E19\u0E04\u0E49\u0E32\u0E07\u0E48\u0E32\u0E22',
      'typedesc.categories': '\u0E2B\u0E21\u0E27\u0E14\u0E2B\u0E21\u0E39\u0E48\u0E2A\u0E34\u0E19\u0E04\u0E49\u0E32 \u0E14\u0E36\u0E07\u0E1B\u0E23\u0E30\u0E40\u0E20\u0E17\u0E08\u0E32\u0E01 Simple Store',
      'typedesc.products': '\u0E23\u0E32\u0E22\u0E01\u0E32\u0E23\u0E2A\u0E34\u0E19\u0E04\u0E49\u0E32 \u0E40\u0E0A\u0E48\u0E19 \u0E2A\u0E34\u0E19\u0E04\u0E49\u0E32\u0E02\u0E32\u0E22\u0E14\u0E35 \u0E14\u0E36\u0E07\u0E08\u0E32\u0E01 Simple Store',
      'typedesc.promo': '\u0E41\u0E1A\u0E19\u0E40\u0E19\u0E2D\u0E23\u0E4C\u0E42\u0E1B\u0E23\u0E42\u0E21\u0E0A\u0E31\u0E19 \u0E40\u0E0A\u0E48\u0E19 \u0E25\u0E14\u0E2A\u0E39\u0E07\u0E2A\u0E38\u0E14 50%',
      'typedesc.news': '\u0E01\u0E25\u0E48\u0E2D\u0E07\u0E02\u0E48\u0E32\u0E27\u0E2A\u0E32\u0E23 \u0E43\u0E2A\u0E48\u0E23\u0E39\u0E1B + \u0E02\u0E49\u0E2D\u0E04\u0E27\u0E32\u0E21 (\u0E44\u0E21\u0E48\u0E21\u0E35\u0E1B\u0E38\u0E48\u0E21)', 'typedesc.contact': '\u0E01\u0E25\u0E48\u0E2D\u0E07\u0E0A\u0E48\u0E2D\u0E07\u0E17\u0E32\u0E07\u0E15\u0E34\u0E14\u0E15\u0E48\u0E2D 1-10 \u0E0A\u0E48\u0E2D\u0E07 \u0E04\u0E25\u0E34\u0E01\u0E41\u0E25\u0E49\u0E27 copy \u0E2B\u0E23\u0E37\u0E2D\u0E40\u0E1B\u0E34\u0E14\u0E25\u0E34\u0E07\u0E01\u0E4C',
      'typedesc.productlist': '\u0E23\u0E32\u0E22\u0E01\u0E32\u0E23\u0E2A\u0E34\u0E19\u0E04\u0E49\u0E32\u0E17\u0E31\u0E49\u0E07\u0E23\u0E49\u0E32\u0E19 + \u0E15\u0E31\u0E27\u0E01\u0E23\u0E2D\u0E07\u0E2D\u0E31\u0E15\u0E42\u0E19\u0E21\u0E31\u0E15\u0E34 (\u0E40\u0E09\u0E1E\u0E32\u0E30 Shop Layout)',
      'typedesc.cards': '\u0E01\u0E32\u0E23\u0E4C\u0E14\u0E23\u0E39\u0E1B + \u0E0A\u0E37\u0E48\u0E2D \u0E43\u0E2A\u0E48\u0E40\u0E2D\u0E07\u0E44\u0E14\u0E49 (\u0E44\u0E21\u0E48\u0E14\u0E36\u0E07\u0E23\u0E32\u0E22\u0E01\u0E32\u0E23\u0E2A\u0E34\u0E19\u0E04\u0E49\u0E32)',
      'pickType': '\u0E40\u0E25\u0E37\u0E2D\u0E01\u0E0A\u0E19\u0E34\u0E14 Section',
      'storeName.colorLabel': '\u0E2A\u0E35\u0E0A\u0E37\u0E48\u0E2D\u0E23\u0E49\u0E32\u0E19',
      'storeName.title': '\u0E0A\u0E37\u0E48\u0E2D\u0E23\u0E49\u0E32\u0E19', 'storeName.desc': '\u0E0A\u0E37\u0E48\u0E2D\u0E17\u0E35\u0E48\u0E41\u0E2A\u0E14\u0E07\u0E1A\u0E19\u0E2B\u0E31\u0E27\u0E23\u0E49\u0E32\u0E19 (\u0E21\u0E38\u0E21\u0E0B\u0E49\u0E32\u0E22\u0E1A\u0E19)', 'storeName.ph': '\u0E43\u0E2A\u0E48\u0E0A\u0E37\u0E48\u0E2D\u0E23\u0E49\u0E32\u0E19',
      'col.title': '\u0E2A\u0E35\u0E02\u0E2D\u0E07 Section \u0E19\u0E35\u0E49', 'col.theme': '\u0E15\u0E32\u0E21\u0E18\u0E35\u0E21', 'col.custom': 'Custom',
      'tcolor.label': '\u0E2A\u0E35\u0E15\u0E31\u0E27\u0E2D\u0E31\u0E01\u0E29\u0E23', 'tcolor.theme': '\u0E15\u0E32\u0E21\u0E18\u0E35\u0E21', 'tcolor.custom': 'Custom',
      'col.bg': '\u0E1E\u0E37\u0E49\u0E19\u0E2B\u0E25\u0E31\u0E07', 'col.text': '\u0E15\u0E31\u0E27\u0E2D\u0E31\u0E01\u0E29\u0E23', 'col.card': '\u0E01\u0E25\u0E48\u0E2D\u0E07/\u0E01\u0E32\u0E23\u0E4C\u0E14', 'col.accent': '\u0E1B\u0E38\u0E48\u0E21/\u0E44\u0E2E\u0E44\u0E25\u0E17\u0E4C',
      'sub.layout': 'หน้าแรก', 'sub.shoplayout': 'หน้าร้าน', 'sub.aboutlayout': 'เกี่ยวกับเรา', 'sub.detaillayout': 'หน้ารายละเอียดสินค้า', 'fixed': 'ระบบสร้างให้', 'type.productdetail': 'รายละเอียดสินค้า (ระบบสร้าง)', 'typedesc.productdetail': 'บล็อกรูป/สี/รายละเอียด/สต๊อก ที่ระบบแสดงให้อัตโนมัติ — แก้ไขหรือย้ายไม่ได้', 'sub.theme': '\u0E18\u0E35\u0E21\u0E2A\u0E35 (Theme)',
      'theme.title': '\u0E18\u0E35\u0E21\u0E2A\u0E35\u0E2B\u0E19\u0E49\u0E32\u0E23\u0E49\u0E32\u0E19', 'theme.desc': '\u0E40\u0E25\u0E37\u0E2D\u0E01\u0E0A\u0E38\u0E14\u0E2A\u0E35\u0E02\u0E2D\u0E07\u0E2B\u0E19\u0E49\u0E32\u0E23\u0E49\u0E32\u0E19 \u00B7 \u0E21\u0E35\u0E1C\u0E25\u0E01\u0E31\u0E1A\u0E1E\u0E37\u0E49\u0E19\u0E2B\u0E25\u0E31\u0E07 \u0E1B\u0E38\u0E48\u0E21 \u0E41\u0E25\u0E30\u0E2A\u0E35\u0E2B\u0E25\u0E31\u0E01',
      'theme.mode': '\u0E42\u0E2B\u0E21\u0E14\u0E2A\u0E27\u0E48\u0E32\u0E07 / \u0E21\u0E37\u0E14', 'theme.modeDesc': '\u0E43\u0E0A\u0E49\u0E44\u0E14\u0E49\u0E17\u0E38\u0E01\u0E18\u0E35\u0E21 \u0E15\u0E31\u0E27\u0E2D\u0E31\u0E01\u0E29\u0E23\u0E08\u0E30\u0E1B\u0E23\u0E31\u0E1A\u0E43\u0E2B\u0E49\u0E2D\u0E48\u0E32\u0E19\u0E2D\u0E2D\u0E01\u0E40\u0E2A\u0E21\u0E2D', 'theme.light': '\u0E2A\u0E27\u0E48\u0E32\u0E07', 'theme.dark': '\u0E21\u0E37\u0E14',
      'theme.custom': '\u0E1B\u0E23\u0E31\u0E1A\u0E41\u0E15\u0E48\u0E07\u0E40\u0E2D\u0E07 (Custom)', 'theme.customDesc': '\u0E40\u0E25\u0E37\u0E2D\u0E01\u0E2A\u0E35 4 \u0E15\u0E31\u0E27 \u0E17\u0E35\u0E48\u0E40\u0E2B\u0E25\u0E37\u0E2D\u0E04\u0E33\u0E19\u0E27\u0E13\u0E43\u0E2B\u0E49\u0E2D\u0E31\u0E15\u0E42\u0E19\u0E21\u0E31\u0E15\u0E34', 'theme.customName': 'Custom',
      'theme.presets': '\u0E18\u0E35\u0E21\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08\u0E23\u0E39\u0E1B', 'theme.presetsDesc': '\u0E0A\u0E38\u0E14\u0E2A\u0E35\u0E17\u0E35\u0E48\u0E08\u0E31\u0E14\u0E44\u0E27\u0E49\u0E43\u0E2B\u0E49\u0E40\u0E25\u0E37\u0E2D\u0E01', 'theme.inUse': '\u0E43\u0E0A\u0E49\u0E2D\u0E22\u0E39\u0E48',
      'publishTitle': '\u0E01\u0E32\u0E23\u0E40\u0E1C\u0E22\u0E41\u0E1E\u0E23\u0E48 (Publish)', 'publishDesc': '\u0E41\u0E01\u0E49\u0E44\u0E02\u0E43\u0E19\u0E42\u0E2B\u0E21\u0E14 draft \u0E44\u0E14\u0E49\u0E15\u0E32\u0E21\u0E15\u0E49\u0E2D\u0E07\u0E01\u0E32\u0E23 \u0E01\u0E14 Publish \u0E40\u0E21\u0E37\u0E48\u0E2D\u0E1E\u0E23\u0E49\u0E2D\u0E21\u0E43\u0E2B\u0E49\u0E25\u0E39\u0E01\u0E04\u0E49\u0E32\u0E40\u0E2B\u0E47\u0E19',
      'preview': '\u{1F441}\uFE0F \u0E14\u0E39\u0E15\u0E31\u0E27\u0E2D\u0E22\u0E48\u0E32\u0E07 (Preview)', 'viewLive': '\u{1F517} \u0E2B\u0E19\u0E49\u0E32\u0E23\u0E49\u0E32\u0E19\u0E08\u0E23\u0E34\u0E07', 'publish': '\u{1F680} Publish',
      'status.dirty': '\u0E21\u0E35\u0E01\u0E32\u0E23\u0E41\u0E01\u0E49\u0E44\u0E02\u0E17\u0E35\u0E48\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49 Publish', 'status.live': '\u0E2B\u0E19\u0E49\u0E32\u0E23\u0E49\u0E32\u0E19\u0E15\u0E23\u0E07\u0E01\u0E31\u0E1A\u0E17\u0E35\u0E48 Publish \u0E25\u0E48\u0E32\u0E2A\u0E38\u0E14',
      'news.title': '\u0E41\u0E01\u0E49\u0E44\u0E02\u0E01\u0E25\u0E48\u0E2D\u0E07\u0E02\u0E48\u0E32\u0E27\u0E2A\u0E32\u0E23',
      'contact.title': '\u0E41\u0E01\u0E49\u0E44\u0E02\u0E0A\u0E48\u0E2D\u0E07\u0E17\u0E32\u0E07\u0E15\u0E34\u0E14\u0E15\u0E48\u0E2D', 'contact.heading': '\u0E2B\u0E31\u0E27\u0E02\u0E49\u0E2D Section', 'contact.subtext': '\u0E04\u0E33\u0E42\u0E1B\u0E23\u0E22 (\u0E44\u0E21\u0E48\u0E43\u0E2A\u0E48\u0E01\u0E47\u0E44\u0E14\u0E49)', 'contact.desc': '\u0E41\u0E15\u0E48\u0E25\u0E30\u0E01\u0E25\u0E48\u0E2D\u0E07 \u0E15\u0E31\u0E49\u0E07\u0E44\u0E2D\u0E04\u0E2D\u0E19/\u0E23\u0E39\u0E1B + \u0E0A\u0E37\u0E48\u0E2D + \u0E25\u0E34\u0E07\u0E01\u0E4C \u0E41\u0E25\u0E30\u0E40\u0E25\u0E37\u0E2D\u0E01\u0E27\u0E48\u0E32\u0E04\u0E25\u0E34\u0E01\u0E41\u0E25\u0E49\u0E27\u0E43\u0E2B\u0E49 copy \u0E2B\u0E23\u0E37\u0E2D\u0E40\u0E1B\u0E34\u0E14\u0E25\u0E34\u0E07\u0E01\u0E4C',
      'contact.add': '+ \u0E40\u0E1E\u0E34\u0E48\u0E21\u0E0A\u0E48\u0E2D\u0E07\u0E17\u0E32\u0E07', 'contact.max': '\u0E04\u0E23\u0E1A 10 \u0E0A\u0E48\u0E2D\u0E07\u0E41\u0E25\u0E49\u0E27', 'contact.label': '\u0E0A\u0E37\u0E48\u0E2D (\u0E40\u0E0A\u0E48\u0E19 Instagram)', 'contact.value': '\u0E25\u0E34\u0E07\u0E01\u0E4C\u0E2B\u0E23\u0E37\u0E2D\u0E02\u0E49\u0E2D\u0E04\u0E27\u0E32\u0E21\u0E17\u0E35\u0E48\u0E08\u0E30\u0E04\u0E31\u0E14\u0E25\u0E2D\u0E01', 'contact.image': '\u0E23\u0E39\u0E1B/\u0E44\u0E2D\u0E04\u0E2D\u0E19', 'contact.open': '\u0E40\u0E1B\u0E34\u0E14\u0E25\u0E34\u0E07\u0E01\u0E4C', 'contact.copy': '\u0E04\u0E31\u0E14\u0E25\u0E2D\u0E01',
      'contact.pickIcon': '\u0E40\u0E25\u0E37\u0E2D\u0E01\u0E44\u0E2D\u0E04\u0E2D\u0E19 \u0E2B\u0E23\u0E37\u0E2D\u0E2D\u0E31\u0E1B\u0E42\u0E2B\u0E25\u0E14\u0E23\u0E39\u0E1B\u0E40\u0E2D\u0E07', 'contact.upload': '\u0E2D\u0E31\u0E1B\u0E42\u0E2B\u0E25\u0E14\u0E23\u0E39\u0E1B', 'contact.clearImg': '\u0E25\u0E1A\u0E23\u0E39\u0E1B\u0E17\u0E35\u0E48\u0E2D\u0E31\u0E1B\u0E42\u0E2B\u0E25\u0E14',
      'promo.title': '\u0E41\u0E01\u0E49\u0E44\u0E02\u0E41\u0E1A\u0E19\u0E40\u0E19\u0E2D\u0E23\u0E4C\u0E42\u0E1B\u0E23\u0E42\u0E21\u0E0A\u0E31\u0E19', 'promo.eyebrow': '\u0E02\u0E49\u0E2D\u0E04\u0E27\u0E32\u0E21\u0E19\u0E33 (\u0E15\u0E31\u0E27\u0E40\u0E25\u0E47\u0E01)', 'promo.heading': '\u0E2B\u0E31\u0E27\u0E02\u0E49\u0E2D\u0E43\u0E2B\u0E0D\u0E48', 'promo.subtext': '\u0E04\u0E33\u0E42\u0E1B\u0E23\u0E22',
      'promo.button': '\u0E02\u0E49\u0E2D\u0E04\u0E27\u0E32\u0E21\u0E1A\u0E19\u0E1B\u0E38\u0E48\u0E21', 'promo.showButton': '\u0E41\u0E2A\u0E14\u0E07\u0E1B\u0E38\u0E48\u0E21', 'promo.image': '\u0E23\u0E39\u0E1B', 'promo.showImage': '\u0E41\u0E2A\u0E14\u0E07\u0E23\u0E39\u0E1B',
      'prod.title': '\u0E41\u0E01\u0E49\u0E44\u0E02\u0E23\u0E32\u0E22\u0E01\u0E32\u0E23\u0E2A\u0E34\u0E19\u0E04\u0E49\u0E32', 'prod.heading': '\u0E2B\u0E31\u0E27\u0E02\u0E49\u0E2D Section', 'prod.desc': '\u0E40\u0E25\u0E37\u0E2D\u0E01\u0E1B\u0E23\u0E30\u0E40\u0E20\u0E17 \u2192 \u0E40\u0E25\u0E37\u0E2D\u0E01\u0E2A\u0E34\u0E19\u0E04\u0E49\u0E32 \u2192 \u0E01\u0E14\u0E40\u0E1E\u0E34\u0E48\u0E21 (\u0E2A\u0E39\u0E07\u0E2A\u0E38\u0E14 10 \u0E0A\u0E34\u0E49\u0E19)',
      'prod.allTypes': '\u0E17\u0E38\u0E01\u0E1B\u0E23\u0E30\u0E40\u0E20\u0E17', 'prod.addItem': '+ \u0E40\u0E1E\u0E34\u0E48\u0E21', 'prod.max': '\u0E04\u0E23\u0E1A 10 \u0E0A\u0E34\u0E49\u0E19\u0E41\u0E25\u0E49\u0E27', 'prod.noneLeft': '\u0E44\u0E21\u0E48\u0E21\u0E35\u0E2A\u0E34\u0E19\u0E04\u0E49\u0E32\u0E43\u0E19\u0E1B\u0E23\u0E30\u0E40\u0E20\u0E17\u0E19\u0E35\u0E49',
      'prod.emptyPicked': '\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49\u0E40\u0E25\u0E37\u0E2D\u0E01\u0E2A\u0E34\u0E19\u0E04\u0E49\u0E32 \u2014 \u0E16\u0E49\u0E32\u0E44\u0E21\u0E48\u0E40\u0E25\u0E37\u0E2D\u0E01 \u0E08\u0E30\u0E42\u0E0A\u0E27\u0E4C\u0E2A\u0E34\u0E19\u0E04\u0E49\u0E32\u0E17\u0E31\u0E49\u0E07\u0E2B\u0E21\u0E14', 'prod.noProducts': '\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E21\u0E35\u0E2A\u0E34\u0E19\u0E04\u0E49\u0E32\u0E43\u0E19 Simple Store',
      'cat.title': '\u0E41\u0E01\u0E49\u0E44\u0E02\u0E2B\u0E21\u0E27\u0E14\u0E2B\u0E21\u0E39\u0E48\u0E2A\u0E34\u0E19\u0E04\u0E49\u0E32', 'cat.heading': '\u0E2B\u0E31\u0E27\u0E02\u0E49\u0E2D Section', 'cat.desc': '\u0E0A\u0E37\u0E48\u0E2D\u0E14\u0E36\u0E07\u0E08\u0E32\u0E01\u0E2B\u0E21\u0E27\u0E14\u0E2B\u0E21\u0E39\u0E48\u0E43\u0E19 Simple Store \u00B7 \u0E15\u0E31\u0E49\u0E07\u0E23\u0E39\u0E1B (\u0E08\u0E15\u0E38\u0E23\u0E31\u0E2A 300\u00d7300px) \u0E41\u0E25\u0E30\u0E2A\u0E35\u0E1E\u0E37\u0E49\u0E19\u0E2B\u0E25\u0E31\u0E07\u0E44\u0E14\u0E49',
      'cat.noTypes': '\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E21\u0E35\u0E2B\u0E21\u0E27\u0E14\u0E2B\u0E21\u0E39\u0E48\u0E43\u0E19 Simple Store \u2014 \u0E44\u0E1B\u0E40\u0E1E\u0E34\u0E48\u0E21\u0E17\u0E35\u0E48\u0E15\u0E31\u0E49\u0E07\u0E04\u0E48\u0E32\u0E01\u0E48\u0E2D\u0E19', 'cat.image': '\u0E23\u0E39\u0E1B', 'cat.color': '\u0E2A\u0E35\u0E1E\u0E37\u0E49\u0E19\u0E2B\u0E25\u0E31\u0E07',
      'feat.title': '\u0E41\u0E01\u0E49\u0E44\u0E02\u0E41\u0E16\u0E1A\u0E08\u0E38\u0E14\u0E40\u0E14\u0E48\u0E19 (Features)', 'feat.desc': '\u0E40\u0E1E\u0E34\u0E48\u0E21\u0E44\u0E14\u0E49\u0E2A\u0E39\u0E07\u0E2A\u0E38\u0E14 5 \u0E23\u0E32\u0E22\u0E01\u0E32\u0E23 \u00B7 \u0E23\u0E39\u0E1B\u0E08\u0E15\u0E38\u0E23\u0E31\u0E2A 200\u00d7200px',
      'feat.add': '+ \u0E40\u0E1E\u0E34\u0E48\u0E21\u0E23\u0E32\u0E22\u0E01\u0E32\u0E23', 'feat.max': '\u0E04\u0E23\u0E1A 5 \u0E23\u0E32\u0E22\u0E01\u0E32\u0E23\u0E41\u0E25\u0E49\u0E27', 'feat.image': '\u0E23\u0E39\u0E1B', 'feat.itemTitle': '\u0E2B\u0E31\u0E27\u0E02\u0E49\u0E2D', 'feat.itemDesc': '\u0E04\u0E33\u0E2D\u0E18\u0E34\u0E1A\u0E32\u0E22',
      'img.sq': '\u0E41\u0E19\u0E30\u0E19\u0E33\u0E23\u0E39\u0E1B\u0E08\u0E15\u0E38\u0E23\u0E31\u0E2A (1:1) \u0E2D\u0E22\u0E48\u0E32\u0E07\u0E19\u0E49\u0E2D\u0E22', 'img.hero': '\u0E41\u0E19\u0E30\u0E19\u0E33\u0E02\u0E19\u0E32\u0E14', 'img.wide': '\u0E41\u0E19\u0E30\u0E19\u0E33\u0E20\u0E32\u0E1E\u0E41\u0E19\u0E27\u0E19\u0E2D\u0E19',
      'hero.title': '\u0E41\u0E01\u0E49\u0E44\u0E02 Header / Hero',
      'hero.badge': '\u0E1B\u0E49\u0E32\u0E22\u0E40\u0E25\u0E47\u0E01 (Badge)', 'hero.heading': '\u0E2B\u0E31\u0E27\u0E02\u0E49\u0E2D\u0E43\u0E2B\u0E0D\u0E48', 'hero.subtext': '\u0E04\u0E33\u0E42\u0E1B\u0E23\u0E22',
      'hero.primary': '\u0E1B\u0E38\u0E48\u0E21\u0E2B\u0E25\u0E31\u0E01', 'hero.secondary': '\u0E1B\u0E38\u0E48\u0E21\u0E23\u0E2D\u0E07',
      'hero.align': '\u0E08\u0E31\u0E14\u0E15\u0E33\u0E41\u0E2B\u0E19\u0E48\u0E07\u0E02\u0E49\u0E2D\u0E04\u0E27\u0E32\u0E21', 'hero.alignLeft': '\u0E0A\u0E34\u0E14\u0E0B\u0E49\u0E32\u0E22', 'hero.alignCenter': '\u0E01\u0E36\u0E48\u0E07\u0E01\u0E25\u0E32\u0E07', 'hero.alignRight': '\u0E0A\u0E34\u0E14\u0E02\u0E27\u0E32',
      'hero.font': '\u0E1F\u0E2D\u0E19\u0E15\u0E4C', 'hero.image': '\u0E23\u0E39\u0E1B Hero', 'hero.chooseImg': '\u0E40\u0E25\u0E37\u0E2D\u0E01\u0E23\u0E39\u0E1B', 'hero.noImg': '\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49\u0E40\u0E25\u0E37\u0E2D\u0E01\u0E23\u0E39\u0E1B', 'hero.imgChosen': '\u0E21\u0E35\u0E23\u0E39\u0E1B\u0E41\u0E25\u0E49\u0E27',
      'hero.showProductImg': '\u0E41\u0E2A\u0E14\u0E07\u0E23\u0E39\u0E1B\u0E2A\u0E34\u0E19\u0E04\u0E49\u0E32\u0E14\u0E49\u0E32\u0E19\u0E02\u0E27\u0E32',
      'hero.bgImage': '\u0E23\u0E39\u0E1B\u0E1E\u0E37\u0E49\u0E19\u0E2B\u0E25\u0E31\u0E07 (\u0E40\u0E15\u0E47\u0E21\u0E41\u0E16\u0E1A)', 'hero.bgHint': '\u0E43\u0E2A\u0E48\u0E23\u0E39\u0E1B\u0E41\u0E25\u0E49\u0E27\u0E02\u0E49\u0E2D\u0E04\u0E27\u0E32\u0E21\u0E08\u0E30\u0E27\u0E32\u0E07\u0E17\u0E31\u0E1A\u0E1A\u0E19\u0E23\u0E39\u0E1B', 'hero.removeBg': '\u0E25\u0E1A\u0E23\u0E39\u0E1B\u0E1E\u0E37\u0E49\u0E19\u0E2B\u0E25\u0E31\u0E07',
      'save': '\u0E1A\u0E31\u0E19\u0E17\u0E36\u0E01',
      'cancel': '\u0E22\u0E01\u0E40\u0E25\u0E34\u0E01'
    },
    en: {
      'io.exportTitle': 'Back up storefront', 'io.exportDesc': 'Download all layouts (Home/Shop/About) + theme and the published copy as JSON',
      'io.json': 'Download JSON (full backup)', 'io.importTitle': 'Import storefront', 'io.importDesc': 'Upload a JSON backup — this REPLACES all storefront layouts (not a merge)',
      'io.chooseFile': 'Choose file', 'io.noFile': 'No file chosen', 'io.importBtn': 'Import', 'io.replaceWarn': 'Importing will overwrite ALL current storefront layouts. Continue?',
      'io.importDone': 'Imported', 'io.importFail': 'Invalid file',
      'title': 'Storefront',
      'crumb': 'Manage your online storefront',
      'viewShop': '\u{1F517} View live shop',
      'layout.title': 'Storefront layout',
      'layout.desc': 'Drag to reorder sections \u00B7 toggle visibility \u00B7 add or remove sections',
      'addSection': '+ Add section',
      'empty': 'No sections yet \u2014 add your first section to start building',
      'on': 'On', 'off': 'Off',
      'delete': 'Delete',
      'confirmDelete': 'Remove this section from the storefront?',
      'edit.soon': 'This section\u2019s contents \u2014 coming in the next phase.',
      'type.hero': 'Header / Hero', 'type.features': 'Features bar',
      'type.categories': 'Shop by Categories', 'type.products': 'Products',
      'type.promo': 'Promo banner',
      'type.news': 'News', 'type.contact': 'Contact',
      'type.productlist': 'Product Listing + Filters',
      'type.cards': 'Image + Title Cards',
      'cards.title': 'Cards (image + title)', 'cards.heading': 'Heading', 'cards.add': '+ Add card', 'cards.max': 'Up to 12 cards', 'cards.image': 'Image', 'cards.itemTitle': 'Card title',
      'pl.title': 'Product Listing', 'pl.heading': 'Heading',
      'pl.note': 'The left filter sidebar (Categories / Price / On Sale) and the 4-per-row × 6-row paginated grid are built automatically on the Shop page · this section can only be added on the Shop Layout.',
      'typedesc.hero': 'Store header image + welcome text',
      'typedesc.features': 'Icon + text highlights like Free Shipping / Easy Returns',
      'typedesc.categories': 'Product categories, pulled from Simple Store',
      'typedesc.products': 'Product lists like Best Selling, pulled from Simple Store',
      'typedesc.promo': 'Promotional banner like Up to 50% Off',
      'typedesc.news': 'News block with image + text (no button)', 'typedesc.contact': 'Social/contact boxes (1-10), click to copy or open a link',
      'typedesc.productlist': 'Full product list + auto filter sidebar (Shop Layout only)',
      'typedesc.cards': 'Manual image + title cards (no Simple Store data)',
      'pickType': 'Choose a section type',
      'storeName.colorLabel': 'Store name colour',
      'storeName.title': 'Store name', 'storeName.desc': 'The name shown in the storefront header (top-left)', 'storeName.ph': 'Enter store name',
      'col.title': 'This section\u2019s colours', 'col.theme': 'Follow theme', 'col.custom': 'Custom',
      'tcolor.label': 'Text colour', 'tcolor.theme': 'Theme', 'tcolor.custom': 'Custom',
      'col.bg': 'Background', 'col.text': 'Text', 'col.card': 'Card/box', 'col.accent': 'Button/accent',
      'sub.layout': 'Home Layout', 'sub.shoplayout': 'Shop Layout', 'sub.aboutlayout': 'About Layout', 'sub.detaillayout': 'Product Detail Layout', 'fixed': 'Built-in', 'type.productdetail': 'Product Detail (built-in)', 'typedesc.productdetail': 'The image/colour/description/stock block the shop renders automatically — not editable or movable', 'sub.theme': 'Theme',
      'theme.title': 'Storefront theme', 'theme.desc': 'Pick your storefront colours \u00B7 drives backgrounds, buttons and highlights',
      'theme.mode': 'Light / Dark', 'theme.modeDesc': 'Works with every palette \u00B7 ink adapts to stay readable', 'theme.light': 'Light', 'theme.dark': 'Dark',
      'theme.custom': 'Custom', 'theme.customDesc': 'Pick four colours \u2014 the rest is derived automatically', 'theme.customName': 'Custom',
      'theme.presets': 'Palettes', 'theme.presetsDesc': 'Ready-made colour schemes', 'theme.inUse': 'In use',
      'publishTitle': 'Publishing', 'publishDesc': 'Edit freely in draft, then Publish when you\u2019re ready for customers to see it',
      'preview': '\u{1F441}\uFE0F Preview', 'viewLive': '\u{1F517} View live shop', 'publish': '\u{1F680} Publish',
      'status.dirty': 'You have unpublished changes', 'status.live': 'Live matches your latest publish',
      'news.title': 'Edit News block',
      'contact.title': 'Edit Contact', 'contact.heading': 'Section heading', 'contact.subtext': 'Subtext (optional)', 'contact.desc': 'Per box: icon/image + label + link, and choose whether clicking copies or opens it',
      'contact.add': '+ Add box', 'contact.max': 'Maximum 10 boxes', 'contact.label': 'Label (e.g. Instagram)', 'contact.value': 'Link or text to copy', 'contact.image': 'Image/icon', 'contact.open': 'Open link', 'contact.copy': 'Copy',
      'contact.pickIcon': 'Pick an icon, or upload your own', 'contact.upload': 'Upload image', 'contact.clearImg': 'Remove uploaded image',
      'promo.title': 'Edit Promo banner', 'promo.eyebrow': 'Eyebrow (small label)', 'promo.heading': 'Heading', 'promo.subtext': 'Subtext',
      'promo.button': 'Button text', 'promo.showButton': 'Show button', 'promo.image': 'Image', 'promo.showImage': 'Show image',
      'prod.title': 'Edit Products', 'prod.heading': 'Section heading', 'prod.desc': 'Pick a type \u2192 pick a product \u2192 add (up to 10)',
      'prod.allTypes': 'All types', 'prod.addItem': '+ Add', 'prod.max': 'Maximum 10 items', 'prod.noneLeft': 'No products left in this type',
      'prod.emptyPicked': 'No products picked \u2014 leave empty to show all', 'prod.noProducts': 'No products in Simple Store',
      'cat.title': 'Edit Categories', 'cat.heading': 'Section heading', 'cat.desc': 'Names come from Simple Store categories \u00B7 set an image (square 300\u00d7300px) and background colour',
      'cat.noTypes': 'No categories in Simple Store yet \u2014 add some in its settings first', 'cat.image': 'Image', 'cat.color': 'Background colour',
      'feat.title': 'Edit Features bar', 'feat.desc': 'Up to 5 items \u00B7 square image 200\u00d7200px',
      'feat.add': '+ Add item', 'feat.max': 'Maximum 5 items', 'feat.image': 'Image', 'feat.itemTitle': 'Title', 'feat.itemDesc': 'Description',
      'img.sq': 'Use a square (1:1) image, at least', 'img.hero': 'Recommended size', 'img.wide': 'Wide image, recommended',
      'hero.title': 'Edit Header / Hero',
      'hero.badge': 'Badge', 'hero.heading': 'Heading', 'hero.subtext': 'Subtext',
      'hero.primary': 'Primary button', 'hero.secondary': 'Secondary button',
      'hero.align': 'Text alignment', 'hero.alignLeft': 'Left', 'hero.alignCenter': 'Center', 'hero.alignRight': 'Right',
      'hero.font': 'Font', 'hero.image': 'Hero image', 'hero.chooseImg': 'Choose image', 'hero.noImg': 'No image chosen', 'hero.imgChosen': 'Image chosen',
      'hero.showProductImg': 'Show right-side product image',
      'hero.bgImage': 'Background image (full width)', 'hero.bgHint': 'With a background image, text overlays it', 'hero.removeBg': 'Remove background',
      'save': 'Save',
      'cancel': 'Cancel'
    }
  });

  window.registerModule({
    id: ID,
    navLabel: { th: '\u0E2B\u0E19\u0E49\u0E32\u0E23\u0E49\u0E32\u0E19\u0E2D\u0E2D\u0E19\u0E44\u0E25\u0E19\u0E4C', en: 'Storefront' },
    pageId: 'page-storefront',

    async onInit(){
      await loadConfig();
    },

    async mount(container){
      if(!config) await loadConfig();
      container.innerHTML = `
        <div class="topbar">
          <h1>${esc(T('title'))}</h1>
          <div class="crumb">${esc(T('crumb'))}</div>
        </div>
        <div class="content">
          <div class="acc-subnav store-subnav" id="sfSubnav"></div>
          <div id="sfBody"></div>
        </div>`;
      container.querySelector('#sfSubnav').addEventListener('click', (e)=>{
        const btn = e.target.closest('[data-subpage]');
        if(!btn) return;
        subPage = btn.dataset.subpage;
        renderSubPage();
      });
      renderSubPage();
    },

    // Re-localize (called on language switch + on page open) — mount runs once at startup.
    render(){
      const page = document.getElementById('page-storefront');
      if(page){
        const h1 = page.querySelector('.topbar h1'); if(h1) h1.textContent = T('title');
        const cr = page.querySelector('.topbar .crumb'); if(cr) cr.textContent = T('crumb');
      }
      renderSubPage();
    },

    // Backup box shown on the Import/Export page. Storefront data is just the
    // draft config + the published copy, so a single JSON round-trips it all.
    dataTools: {
      render(){
        return `
          <div class="settings-section">
            <div class="settings-section-head">
              <h3 class="setting-title">${esc(T('io.exportTitle'))}</h3>
              <p class="setting-desc">${esc(T('io.exportDesc'))}</p>
            </div>
            <div class="if-row"><button class="btn btn-primary" id="sfExportJson">${esc(T('io.json'))}</button></div>
          </div>
          <div class="settings-section">
            <div class="settings-section-head">
              <h3 class="setting-title">${esc(T('io.importTitle'))}</h3>
              <p class="setting-desc">${esc(T('io.importDesc'))}</p>
            </div>
            <div class="if-row">
              <label class="file-picker">
                <input type="file" id="sfImportFile" accept=".json,application/json">
                <span class="file-picker-btn">${esc(T('io.chooseFile'))}</span>
                <span class="file-picker-name" id="sfImportName">${esc(T('io.noFile'))}</span>
              </label>
              <button class="btn btn-primary" id="sfImportBtn" disabled>${esc(T('io.importBtn'))}</button>
              <span class="if-note" id="sfImportNote"></span>
            </div>
          </div>`;
      },
      bind(section){
        section.querySelector('#sfExportJson').addEventListener('click', exportStorefrontJson);
        const file = section.querySelector('#sfImportFile');
        const btn = section.querySelector('#sfImportBtn');
        const nameEl = section.querySelector('#sfImportName');
        let pending = null;
        file.addEventListener('change', ()=>{
          const f = file.files && file.files[0];
          if(!f){ btn.disabled = true; pending = null; nameEl.textContent = T('io.noFile'); return; }
          nameEl.textContent = f.name;
          const reader = new FileReader();
          reader.onload = ()=>{ pending = String(reader.result); btn.disabled = false; };
          reader.readAsText(f);
        });
        btn.addEventListener('click', async ()=>{
          if(pending == null) return;
          const note = section.querySelector('#sfImportNote');
          if(!window.confirm(T('io.replaceWarn'))) return;
          try{
            await importStorefrontJson(pending);
            note.textContent = T('io.importDone');
            btn.disabled = true; file.value = ''; nameEl.textContent = T('io.noFile');
          }catch(e){ note.textContent = T('io.importFail'); }
        });
      }
    }
  });

  async function exportStorefrontJson(){
    const published = await window.Store.get(PUB_KEY);
    const blob = { app:'storefront', schema:1, config, published: published || null };
    window.downloadFile('storefront-backup-' + window.localIso() + '.json', JSON.stringify(blob, null, 2), 'application/json;charset=utf-8;');
  }
  async function importStorefrontJson(text){
    const data = JSON.parse(text);
    if(data.app !== 'storefront' || !data.config) throw new Error('bad file');
    config = data.config;
    await saveConfig();                                        // draft
    if(data.published) await window.Store.set(PUB_KEY, data.published);   // live copy
    if(document.getElementById('sfBody')){ renderSubnav(); renderSubPage(); }
  }

  const SUBPAGES = ['layout', 'shoplayout', 'aboutlayout', 'detaillayout', 'theme'];
  let subPage = 'layout';

  function renderSubnav(){
    const nav = document.querySelector('#sfSubnav');
    if(!nav) return;
    nav.innerHTML = SUBPAGES.map(id=>
      `<button type="button" class="acc-subnav-btn ${id===subPage?'active':''}" data-subpage="${id}">${esc(T('sub.'+id))}</button>`
    ).join('');
  }

  function renderSubPage(){
    renderSubnav();
    const body = document.querySelector('#sfBody');
    if(!body) return;
    if(subPage === 'theme') renderThemePage(body);
    else renderLayoutPage(body);
  }

  async function refreshPublishStatus(body){
    const el = body.querySelector('#sfPubStatus');
    const btn = body.querySelector('#sfPublish');
    if(!el) return;
    const dirty = await isDirty();
    if(dirty){
      el.innerHTML = `<span class="sf-dot sf-dot-dirty"></span> ${esc(T('status.dirty'))}`;
      if(btn) btn.disabled = false;
    }else{
      el.innerHTML = `<span class="sf-dot sf-dot-live"></span> ${esc(T('status.live'))}`;
      if(btn) btn.disabled = true;
    }
  }

  /* ================= Layout builder ================= */
  /* ================= Theme Setting subpage ================= */
  // Storefront palettes — seeds (deep/accent/pop/pale) mirror the Base App set.
  // shop.html derives the full token set + light/dark from these.
  const STORE_THEMES = [
    { id:'ocean',      name:'Ocean',      seeds:{ deep:'#0B2733', accent:'#1F5C74', pop:'#5E958E', pale:'#DCEAE7' } },
    { id:'harbor',     name:'Harbor',     seeds:{ deep:'#112B3C', accent:'#F66B0E', pop:'#205375', pale:'#EFEFEF' } },
    { id:'sangria',    name:'Sangria',    seeds:{ deep:'#5E244E', accent:'#AA1C41', pop:'#E68457', pale:'#FFE8B4' } },
    { id:'mulberry',   name:'Mulberry',   seeds:{ deep:'#56021F', accent:'#7D1C4A', pop:'#D17D98', pale:'#F4CCE9' } },
    { id:'fern',       name:'Fern',       seeds:{ deep:'#1A312C', accent:'#428475', pop:'#89D7B7', pale:'#FFF4E1' } },
    { id:'bubblegum',  name:'Bubblegum',  seeds:{ deep:'#FF90BB', accent:'#FF90BB', pop:'#8ACCD5', pale:'#F8F8E1' } },
    { id:'terracotta', name:'Terracotta', seeds:{ deep:'#5E6A4E', accent:'#B96A4E', pop:'#E9D9C0', pale:'#F2E8DA' } },
    { id:'azure',      name:'Azure',      seeds:{ deep:'#2A3B86', accent:'#3E6FD1', pop:'#8FCBDE', pale:'#D3E7EC' } },
    { id:'blossom',    name:'Blossom',    seeds:{ deep:'#FF7CC4', accent:'#FF8FB3', pop:'#FFC79C', pale:'#FBF6C8' } },
    { id:'candy',      name:'Candy',      seeds:{ deep:'#C25E7E', accent:'#FBB6C7', pop:'#9AD4E0', pale:'#FCFAA8' } },
    { id:'sage',       name:'Sage',       seeds:{ deep:'#2C362E', accent:'#3E5045', pop:'#A17C5B', pale:'#DFDACD' } },
    { id:'plum',       name:'Plum',       seeds:{ deep:'#5C4453', accent:'#75505C', pop:'#9A8768', pale:'#D6A98B' } },
    { id:'amethyst',   name:'Amethyst',   seeds:{ deep:'#231145', accent:'#4B2160', pop:'#A0524F', pale:'#DDA05C' } },
    { id:'orchid',     name:'Orchid',     seeds:{ deep:'#3C2168', accent:'#5E3086', pop:'#E0559E', pale:'#FCA3B0' } },
    { id:'sunset',     name:'Sunset',     seeds:{ deep:'#F9515A', accent:'#FB8062', pop:'#FFBE7D', pale:'#FCF07A' } },
    { id:'sky',        name:'Sky',        seeds:{ deep:'#7FA9BA', accent:'#9DC7D6', pop:'#C0DDE4', pale:'#E3F3D9' } },
    { id:'espresso',   name:'Espresso',   seeds:{ deep:'#000000', accent:'#241810', pop:'#43301A', pale:'#E5DED0' } },
    { id:'cocoa',      name:'Cocoa',      seeds:{ deep:'#42292A', accent:'#575859', pop:'#E7D2C4', pale:'#F3E9E4' } },
    { id:'petal',      name:'Petal',      seeds:{ deep:'#C9A7C4', accent:'#FBE9EC', pop:'#FBD9DE', pale:'#F5C6D0' } },
    { id:'obsidian',   name:'Obsidian',   seeds:{ deep:'#2B2B2B', accent:'#552847', pop:'#8E3459', pale:'#F73758' } },
    { id:'crimson',    name:'Crimson',    seeds:{ deep:'#1B1717', accent:'#8B1A17', pop:'#D2402E', pale:'#EFEFEF' } },
    { id:'coral',      name:'Coral',      seeds:{ deep:'#0A1A38', accent:'#8B2144', pop:'#C13350', pale:'#E07A5F' } }
  ];
  const STORE_DEFAULT_CUSTOM = { deep:'#6B7F58', accent:'#55684A', pop:'#8AA17C', pale:'#EDEBE3' };
  const SEED_LABELS = { deep:'Background / dark', accent:'Buttons & accent', pop:'Highlight', pale:'Light tone' };

  function themeConf(){
    if(!config.theme) config.theme = { preset:'fern', mode:'light', customSeeds:{ ...STORE_DEFAULT_CUSTOM } };
    if(!config.theme.customSeeds) config.theme.customSeeds = { ...STORE_DEFAULT_CUSTOM };
    if(!config.theme.preset) config.theme.preset = 'fern';
    if(!config.theme.mode) config.theme.mode = 'light';
    return config.theme;
  }

  function renderThemePage(body){
    const th = themeConf();
    body.innerHTML = `
      <div class="panel">
        <div class="settings-section-head" style="margin-bottom:12px;">
          <h3 class="setting-title">${esc(T('theme.title'))}</h3>
          <p class="setting-desc">${esc(T('theme.desc'))}</p>
        </div>
        <div class="sf-theme-mode-row">
          <div>
            <h4 class="setting-subtitle">${esc(T('theme.mode'))}</h4>
            <p class="setting-desc">${esc(T('theme.modeDesc'))}</p>
          </div>
          <div class="sf-theme-mode-toggle" id="sfThemeMode">
            <button type="button" class="sf-mode-btn ${th.mode==='light'?'active':''}" data-mode="light">${esc(T('theme.light'))}</button>
            <button type="button" class="sf-mode-btn ${th.mode==='dark'?'active':''}" data-mode="dark">${esc(T('theme.dark'))}</button>
          </div>
        </div>

        <div class="sf-theme-custom-block">
          <div class="settings-section-head" style="margin-bottom:10px;">
            <h4 class="setting-subtitle">${esc(T('theme.custom'))}</h4>
            <p class="setting-desc">${esc(T('theme.customDesc'))}</p>
          </div>
          <div class="theme-list">
            <button type="button" class="theme-card ${th.preset==='custom'?'active':''}" data-preset="custom">
              ${themeCardPreview('custom', th.customSeeds)}
              <div class="theme-card-foot">
                <span class="theme-name">${esc(T('theme.customName'))}</span>
                ${th.preset==='custom'?`<span class="theme-active-tag">${esc(T('theme.inUse'))}</span>`:''}
              </div>
            </button>
          </div>
          <div class="sf-seed-grid" id="sfSeedGrid"></div>
        </div>

        <div class="sf-theme-preset-block">
          <div class="settings-section-head" style="margin-bottom:10px;">
            <h4 class="setting-subtitle">${esc(T('theme.presets'))}</h4>
            <p class="setting-desc">${esc(T('theme.presetsDesc'))}</p>
          </div>
          <div class="theme-list" id="sfThemeList"></div>
        </div>
      </div>`;

    // mode toggle
    body.querySelector('#sfThemeMode').addEventListener('click', async (e)=>{
      const btn = e.target.closest('[data-mode]'); if(!btn) return;
      themeConf().mode = btn.dataset.mode;
      await saveConfig();
      renderThemePage(body);
      refreshPublishStatus(body);
    });

    // preset cards
    const list = body.querySelector('#sfThemeList');
    list.innerHTML = STORE_THEMES.map(t=>`
      <button type="button" class="theme-card ${th.preset===t.id?'active':''}" data-preset="${t.id}">
        ${themeCardPreview(t.id, t.seeds)}
        <div class="theme-card-foot">
          <span class="theme-name">${esc(t.name)}</span>
          ${th.preset===t.id?`<span class="theme-active-tag">${esc(T('theme.inUse'))}</span>`:''}
        </div>
      </button>`).join('');

    body.querySelectorAll('.theme-card').forEach(btn=>{
      btn.addEventListener('click', async ()=>{
        themeConf().preset = btn.dataset.preset;
        await saveConfig();
        renderThemePage(body);
        refreshPublishStatus(body);
      });
    });

    drawSeedGrid(body);
  }

  // Small preview mockup from a theme's seeds (mirrors the Base App card).
  function themeCardPreview(id, seeds){
    const s = seeds || {};
    const tk = sfDeriveTokens(s, themeConf().mode);
    return `
      <div class="theme-preview" style="background:${esc(tk.bg)}; border-color:${esc(tk.border)}">
        <div class="theme-preview-nav" style="background:${esc(tk.deep)}">
          <span class="theme-preview-navline accent" style="background:${esc(tk.accent)}"></span>
          <span class="theme-preview-navline short" style="background:${esc(tk.navline)}"></span>
          <span class="theme-preview-navline short" style="background:${esc(tk.navline)}"></span>
        </div>
        <div class="theme-preview-page">
          <div class="theme-preview-card" style="background:${esc(tk.panel)}; border-color:${esc(tk.border)}">
            <span class="theme-preview-line" style="background:${esc(tk.text)}"></span>
            <span class="theme-preview-line short" style="background:${esc(tk.muted)}"></span>
            <span class="theme-preview-btn" style="background:${esc(tk.accent)}"></span>
          </div>
        </div>
      </div>
      <div class="sf-theme-chips">${[s.deep,s.accent,s.pop,s.pale].filter(Boolean).map(c=>`<span style="background:${esc(c)}"></span>`).join('')}</div>`;
  }

  // Colour maths (mirrors shop.html) so the back-office preview matches the shop.
  function sfHexRgb(h){ h=String(h||'#888888').replace('#',''); if(h.length===3) h=h.split('').map(c=>c+c).join(''); return [parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)]; }
  function sfRgbHex(r,g,b){ return '#'+[r,g,b].map(x=>Math.max(0,Math.min(255,Math.round(x))).toString(16).padStart(2,'0')).join(''); }
  function sfMix(a,b,t){ const A=sfHexRgb(a),B=sfHexRgb(b); return sfRgbHex(A[0]+(B[0]-A[0])*t,A[1]+(B[1]-A[1])*t,A[2]+(B[2]-A[2])*t); }
  function sfDeriveTokens(seeds, mode){
    const deep = seeds.deep||'#333', accent = seeds.accent||'#888', pale = seeds.pale||'#eee';
    if(mode === 'dark'){
      const bg = sfMix(deep,'#000000',0.55), panel = sfMix(deep,'#000000',0.35);
      return { bg, panel, deep, accent, border:sfMix(panel,'#FFFFFF',0.14), text:'#F3F1EC', muted:sfMix('#F3F1EC',bg,0.5), navline:sfMix(pale,deep,0.5) };
    }
    return { bg:'#FFFFFF', panel:'#FFFFFF', deep, accent, border:sfMix(pale,'#000000',0.06), text:sfMix(deep,'#000000',0.1), muted:sfMix(deep,'#FFFFFF',0.45), navline:sfMix(pale,'#FFFFFF',0.3) };
  }

  function drawSeedGrid(body){
    const grid = body.querySelector('#sfSeedGrid');
    if(!grid) return;
    const th = themeConf();
    const showEditor = th.preset === 'custom';
    grid.style.display = showEditor ? 'grid' : 'none';
    if(!showEditor){ grid.innerHTML = ''; return; }
    grid.innerHTML = ['deep','accent','pop','pale'].map(k=>`
      <label class="sf-seed">
        <span class="sf-seed-label">${esc(SEED_LABELS[k])}</span>
        <input type="color" class="sf-seed-input" data-seed="${k}" value="${esc(th.customSeeds[k]||'#888888')}">
        <span class="sf-seed-hex">${esc((th.customSeeds[k]||'').toUpperCase())}</span>
      </label>`).join('');
    grid.querySelectorAll('.sf-seed-input').forEach(inp=>{
      inp.addEventListener('input', async (e)=>{
        themeConf().customSeeds[e.target.dataset.seed] = e.target.value.toUpperCase();
        e.target.parentElement.querySelector('.sf-seed-hex').textContent = e.target.value.toUpperCase();
        await saveConfig();
        // refresh the custom card preview live
        const card = body.querySelector('.theme-card[data-preset="custom"]');
        if(card){
          const footHtml = card.querySelector('.theme-card-foot').outerHTML;
          card.innerHTML = themeCardPreview('custom', themeConf().customSeeds) + footHtml;
        }
        refreshPublishStatus(body);
      });
    });
  }

  function renderLayoutPage(body){
    const routeHash = subPage === 'shoplayout' ? '#shop' : (subPage === 'aboutlayout' ? '#about' : (subPage === 'detaillayout' ? '#shop' : ''));
    body.innerHTML = `
      <div class="panel">
        <div class="settings-section-head" style="margin-bottom:12px;">
          <h3 class="setting-title">${esc(T('publishTitle'))}</h3>
          <p class="setting-desc">${esc(T('publishDesc'))}</p>
        </div>
        <div class="sf-publish-bar">
          <div class="sf-publish-status" id="sfPubStatus"></div>
          <div class="sf-publish-actions">
            <a href="shop.html?preview=1${routeHash}" target="_blank" class="btn btn-ghost" id="sfPreview">${esc(T('preview'))}</a>
            <a href="shop.html${routeHash}" target="_blank" class="btn btn-ghost">${esc(T('viewLive'))}</a>
            <button class="btn btn-primary" id="sfPublish">${esc(T('publish'))}</button>
          </div>
        </div>
        <div class="sf-storename-block">
          <div class="settings-section-head" style="margin-bottom:10px;">
            <h3 class="setting-title">${esc(T('storeName.title'))}</h3>
            <p class="setting-desc">${esc(T('storeName.desc'))}</p>
          </div>
          <div class="sf-storename-row">
            <input type="text" id="sfStoreName" class="sf-storename-input" value="${esc(config.storeName || 'Artisan Store')}" placeholder="${esc(T('storeName.ph'))}">
          </div>
          ${colorsBlockHtml(config.storeNameColors, ['text'], 'storeName.colorLabel')}
        </div>
        <div class="sf-layout-head">
          <div class="settings-section-head" style="margin-bottom:0;">
            <h3 class="setting-title">${esc(T('layout.title'))}</h3>
            <p class="setting-desc">${esc(T('layout.desc'))}</p>
          </div>
          <button class="btn btn-primary" id="sfAddSection">${esc(T('addSection'))}</button>
        </div>
        <div id="sfSectionList" class="sf-section-list"></div>
      </div>`;
    // store name — save on edit
    const nameInput = body.querySelector('#sfStoreName');
    nameInput.addEventListener('input', async ()=>{
      config.storeName = nameInput.value;
      await saveConfig();
      refreshPublishStatus(body);
    });
    // store-name colours — inline block, save whenever it changes
    const getStoreColors = wireColorsBlock(body, config.storeNameColors);
    const persistStoreColors = async ()=>{
      config.storeNameColors = getStoreColors();
      await saveConfig();
      refreshPublishStatus(body);
    };
    body.querySelector('#sfColMode').addEventListener('click', ()=> setTimeout(persistStoreColors, 0));
    body.querySelectorAll('.sf-colors-block [data-color]').forEach(inp=>
      inp.addEventListener('input', ()=> setTimeout(persistStoreColors, 0)));
    body.querySelector('#sfAddSection').addEventListener('click', ()=> openAddSectionModal(body));
    body.querySelector('#sfPublish').addEventListener('click', async ()=>{
      await publishNow();
      await refreshPublishStatus(body);
    });
    refreshPublishStatus(body);
    drawSections(body);
  }

  function typeName(type){ return T('type.'+type); }
  function typeDesc(type){ return T('typedesc.'+type); }
  // Row label: the user's custom heading if they set one, else the type name.
  function displayName(s){
    const h = s.data && typeof s.data.heading === 'string' ? s.data.heading.trim() : '';
    return h || typeName(s.type);
  }

  function drawSections(body){
    const list = body.querySelector('#sfSectionList');
    if(!list) return;
    const secs = curSections();
    if(secs.length === 0){
      list.innerHTML = `<div class="sf-empty">${esc(T('empty'))}</div>`;
      return;
    }
    list.innerHTML = secs.map((s, i)=>{
      const locked = isLockedType(s.type);
      const fixed = s.type === 'productdetail';
      return `
      <div class="sf-section-row ${s.enabled?'':'sf-disabled'} ${locked?'sf-locked':''}" data-index="${i}" data-id="${s.id}" data-type="${esc(s.type)}" draggable="false">
        ${locked ? '<span class="sf-drag-handle sf-lock" title="locked">\u{1F512}</span>' : '<span class="sf-drag-handle" title="drag">\u283F</span>'}
        <span class="sf-section-ico">${SECTION_ICON[s.type]||'\u25AB\uFE0F'}</span>
        <div class="sf-section-meta">
          <div class="sf-section-name">${esc(displayName(s))}</div>
          <div class="sf-section-desc">${esc(typeDesc(s.type))}</div>
        </div>
        ${fixed ? `<span class="sf-fixed-badge">${esc(T('fixed'))}</span>` : `
        <button class="sf-toggle ${s.enabled?'on':'off'}" data-act="toggle" title="${esc(s.enabled?T('on'):T('off'))}">
          <span class="sf-toggle-knob"></span>
        </button>
        <button class="acc-icon sf-edit" data-act="edit" title="edit">\u270E</button>
        <button class="acc-icon sf-del" data-act="del" title="${esc(T('delete'))}">\u2715</button>`}
      </div>`; }).join('');

    list.querySelectorAll('.sf-section-row').forEach(row=>{
      const idx = parseInt(row.dataset.index, 10);
      const tglBtn = row.querySelector('[data-act="toggle"]');
      if(tglBtn) tglBtn.addEventListener('click', async ()=>{
        curSections()[idx].enabled = !curSections()[idx].enabled;
        await saveConfig(); drawSections(body);
      });
      const editBtn = row.querySelector('[data-act="edit"]');
      if(editBtn) editBtn.addEventListener('click', ()=> openSectionEditor(body, idx));
      const delBtn = row.querySelector('[data-act="del"]');
      if(delBtn) delBtn.addEventListener('click', async ()=>{
        if(!window.confirm(T('confirmDelete'))) return;
        curSections().splice(idx, 1);
        await saveConfig(); drawSections(body);
      });

      // Drag-to-reorder - only draggable while grabbing the handle.
      // Hero is locked to the top: it can't be dragged and nothing can drop above it.
      const isHero = isLockedType(row.dataset.type);   // hero + detail placeholder are both pinned to the top
      const handle = row.querySelector('.sf-drag-handle');
      if(!isHero){
        handle.addEventListener('mousedown', ()=>{ row.draggable = true; });
        handle.addEventListener('touchstart', ()=>{ row.draggable = true; }, { passive:true });
        row.addEventListener('dragstart', (e)=>{
          dragFromIndex = idx;
          row.classList.add('dragging');
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', String(idx));
        });
        row.addEventListener('dragend', ()=>{
          row.draggable = false;
          row.classList.remove('dragging');
          list.querySelectorAll('.sf-section-row').forEach(r=> r.classList.remove('drag-over'));
        });
      }
      row.addEventListener('dragover', (e)=>{
        if(isHero) return;               // can't drop onto the Hero slot
        e.preventDefault(); e.dataTransfer.dropEffect='move'; row.classList.add('drag-over');
      });
      row.addEventListener('dragleave', ()=> row.classList.remove('drag-over'));
      row.addEventListener('drop', async (e)=>{
        if(isHero) return;               // Hero stays put
        e.preventDefault();
        row.classList.remove('drag-over');
        let to = parseInt(row.dataset.index, 10);
        if(to === 0) to = 1;             // never above a top-locked Hero
        if(dragFromIndex != null && dragFromIndex !== to && dragFromIndex !== 0){
          const secs2 = curSections();
          const [moved] = secs2.splice(dragFromIndex, 1);
          secs2.splice(to, 0, moved);
          ensureHeroFirst(secs2);
          if(subPage === 'detaillayout') ensureDetailFirst(secs2);
          await saveConfig(); drawSections(body);
        }
        dragFromIndex = null;
      });
    });
    refreshPublishStatus(body);
  }

  // Google Fonts offered in the storefront (all support Thai except Poppins).
  const FONTS = ['Poppins', 'Kanit', 'Prompt', 'Sarabun', 'Mitr', 'Bai Jamjuree'];

  /* ---- Per-section colours (reusable across section editors) ---- */
  // mode:'theme' uses the storefront palette; 'custom' overrides these four.
  function colorDefaults(){
    return { mode:'theme', bg:'#FFFFFF', text:'#2B2E26', card:'#FFFFFF', accent:'#6B7F58' };
  }
  // Renders the "Section colours" block. Pass the section's data.colors (or null).
  function colorsBlockHtml(colors, fields, titleKey){
    const c = Object.assign(colorDefaults(), colors || {});
    const isCustom = c.mode === 'custom';
    const list = fields || ['bg','text','card','accent'];
    const labelFor = { bg:'col.bg', text:'col.text', card:'col.card', accent:'col.accent' };
    const swatch = (key)=>`
      <label class="sf-color-field">
        <span>${esc(T(labelFor[key]))}</span>
        <input type="color" data-color="${key}" value="${esc(c[key])}">
      </label>`;
    return `
      <div class="sf-colors-block">
        <div class="sf-inline-toggle">
          <span>${esc(T(titleKey || 'col.title'))}</span>
          <div class="sf-seg" id="sfColMode">
            <button type="button" class="sf-seg-btn ${!isCustom?'active':''}" data-cmode="theme">${esc(T('col.theme'))}</button>
            <button type="button" class="sf-seg-btn ${isCustom?'active':''}" data-cmode="custom">${esc(T('col.custom'))}</button>
          </div>
        </div>
        <div class="sf-color-grid" id="sfColGrid" style="${isCustom?'':'display:none;'}">
          ${list.map(swatch).join('')}
        </div>
      </div>`;
  }
  // Wires the block inside an overlay; returns a getter for the current colours.
  function wireColorsBlock(ov, initial){
    let c = Object.assign(colorDefaults(), initial || {});
    const grid = ov.querySelector('#sfColGrid');
    ov.querySelector('#sfColMode').addEventListener('click', (e)=>{
      const btn = e.target.closest('[data-cmode]'); if(!btn) return;
      c.mode = btn.dataset.cmode;
      ov.querySelectorAll('#sfColMode .sf-seg-btn').forEach(b=> b.classList.toggle('active', b.dataset.cmode===c.mode));
      if(grid) grid.style.display = c.mode==='custom' ? 'grid' : 'none';
    });
    ov.querySelectorAll('[data-color]').forEach(inp=>{
      inp.addEventListener('input', ()=>{ c[inp.dataset.color] = inp.value.toUpperCase(); });
    });
    return ()=> ({ ...c });
  }

  /* ---- Per-field text colour ----------------------------------------------
     A compact control that sits under any text input: a theme/custom toggle
     plus a colour picker (shown only in custom mode). 'theme' keeps whatever
     colour the text already resolves to (section text / theme) — it changes
     nothing; 'custom' pins the chosen colour on that one element in shop.html.

     Simple fields store under section data.textColors[field] = {mode,color}.
     Repeatable items store the object on the item itself (e.g. it.titleColor),
     bound via data-tcitem / data-tckey so add/remove/reorder carries the colour.
     ------------------------------------------------------------------------- */
  function tcolorDefault(){ return { mode:'theme', color:'#2B2E26' }; }

  // attrs: the binding, e.g. `data-tcfield="heading"` (simple) or
  // `data-tcitem="0" data-tckey="titleColor"` (repeatable item).
  function tcolorCtrlHtml(tc, attrs){
    const c = Object.assign(tcolorDefault(), tc || {});
    const isC = c.mode === 'custom';
    return `<span class="sf-tcolor" ${attrs || ''}>
        <span class="sf-tcolor-label">${esc(T('tcolor.label'))}</span>
        <span class="sf-seg sf-tcolor-seg">
          <button type="button" class="sf-seg-btn ${!isC?'active':''}" data-tcmode="theme">${esc(T('tcolor.theme'))}</button>
          <button type="button" class="sf-seg-btn ${isC?'active':''}" data-tcmode="custom">${esc(T('tcolor.custom'))}</button>
        </span>
        <input type="color" class="sf-tcolor-input" value="${esc(c.color)}" style="${isC?'':'display:none;'}">
      </span>`;
  }

  // Wire the simple-field controls inside `scope`. Returns a reader that gives
  // back { field: {mode,color} } for saving into data.textColors.
  function wireTcolors(scope, initial){
    const state = {};
    Object.keys(initial || {}).forEach(k=>{ state[k] = Object.assign(tcolorDefault(), initial[k]); });
    scope.querySelectorAll('.sf-tcolor[data-tcfield]').forEach(box=>{
      const field = box.dataset.tcfield;
      if(!state[field]) state[field] = tcolorDefault();
      const seg = box.querySelector('.sf-tcolor-seg');
      const input = box.querySelector('.sf-tcolor-input');
      seg.addEventListener('click', (e)=>{
        const b = e.target.closest('[data-tcmode]'); if(!b) return;
        state[field].mode = b.dataset.tcmode;
        seg.querySelectorAll('.sf-seg-btn').forEach(x=> x.classList.toggle('active', x.dataset.tcmode===state[field].mode));
        input.style.display = state[field].mode==='custom' ? '' : 'none';
      });
      input.addEventListener('input', ()=>{ state[field].color = input.value.toUpperCase(); });
    });
    return ()=>{ const out = {}; Object.keys(state).forEach(k=> out[k] = { ...state[k] }); return out; };
  }

  // Wire the repeatable-item controls inside `container`: each writes straight
  // onto items[data-tcitem][data-tckey]. Call after every list re-draw.
  function wireItemTcolors(container, items){
    container.querySelectorAll('.sf-tcolor[data-tcitem]').forEach(box=>{
      const i = +box.dataset.tcitem;
      const key = box.dataset.tckey;
      if(!items[i]) return;
      if(!items[i][key]) items[i][key] = tcolorDefault();
      const seg = box.querySelector('.sf-tcolor-seg');
      const input = box.querySelector('.sf-tcolor-input');
      seg.addEventListener('click', (e)=>{
        const b = e.target.closest('[data-tcmode]'); if(!b) return;
        items[i][key].mode = b.dataset.tcmode;
        seg.querySelectorAll('.sf-seg-btn').forEach(x=> x.classList.toggle('active', x.dataset.tcmode===items[i][key].mode));
        input.style.display = items[i][key].mode==='custom' ? '' : 'none';
      });
      input.addEventListener('input', ()=>{ items[i][key].color = input.value.toUpperCase(); });
    });
  }

  function heroDefaults(){
    return {
      badge: 'NEW ARRIVALS',
      heading: 'Discover The Best Products for You',
      subtext: 'Explore our wide range of high-quality products at affordable prices. Shop now and enjoy the best deals!',
      primaryText: 'Shop Now',
      secondaryText: 'Explore Deals',
      image: null,            // right-side product image
      showProductImage: true, // toggle the right-side image on/off
      bgImage: null,          // full-width background image (text overlays it)
      align: 'left',   // left | center | right
      font: 'Poppins'
    };
  }

  // Route the edit button to the right per-type editor.
  function openSectionEditor(body, idx){
    const s = curSections()[idx];
    if(s.type === 'hero') return openHeroEditor(body, idx);
    if(s.type === 'features') return openFeaturesEditor(body, idx);
    if(s.type === 'categories') return openCategoriesEditor(body, idx);
    if(s.type === 'products') return openProductsEditor(body, idx);
    if(s.type === 'promo') return openPromoEditor(body, idx);
    if(s.type === 'news') return openNewsEditor(body, idx);
    if(s.type === 'contact') return openContactEditor(body, idx);
    if(s.type === 'productlist') return openProductListEditor(body, idx);
    if(s.type === 'cards') return openCardsEditor(body, idx);
    // other types come in later phases
    window.alert(T('edit.soon'));
  }

  // Product Listing (Shop page only) — the grid + auto filter sidebar are built
  // by shop.html; here the owner only sets the heading. Filters (Categories /
  // Price / On Sale) and the 4-per-row × 6-row paginated grid are automatic.
  function openProductListEditor(body, idx){
    const s = curSections()[idx];
    const d = s.data || {};
    const tc = d.textColors || {};
    const ov = document.createElement('div');
    ov.className = 'art-modal-overlay show';
    ov.innerHTML = `
      <div class="art-modal art-modal-lg">
        <h3 class="art-modal-title">${esc(T('pl.title'))}</h3>
        <div class="art-form-grid">
          <label class="art-form-full">${esc(T('pl.heading'))}<input type="text" id="plHeading" value="${esc(d.heading != null ? d.heading : 'Shop All')}">${tcolorCtrlHtml(tc.heading, 'data-tcfield="heading"')}</label>
        </div>
        <p class="setting-desc" style="margin:6px 0 0;">${esc(T('pl.note'))}</p>
        ${colorsBlockHtml(s.data.colors)}
        <div class="art-modal-actions">
          <button class="btn btn-ghost" id="plCancel">${esc(T('cancel'))}</button>
          <button class="btn btn-primary" id="plSave">${esc(T('save'))}</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    const getColors = wireColorsBlock(ov, s.data.colors);
    const getTextColors = wireTcolors(ov, tc);
    const close = ()=> ov.remove();
    ov.addEventListener('click', e=>{ if(e.target===ov) close(); });
    ov.querySelector('#plCancel').addEventListener('click', close);
    ov.querySelector('#plSave').addEventListener('click', async ()=>{
      s.data = { heading: ov.querySelector('#plHeading').value.trim(), colors: getColors(), textColors: getTextColors() };
      await saveConfig();
      close();
      drawSections(body);
      refreshPublishStatus(body);
    });
  }

  function openHeroEditor(body, idx){
    const s = curSections()[idx];
    const d = Object.assign(heroDefaults(), s.data || {});
    const tc = d.textColors || {};
    let imgData = d.image || null;
    let bgData = d.bgImage || null;
    const ov = document.createElement('div');
    ov.className = 'art-modal-overlay show';
    ov.innerHTML = `
      <div class="art-modal art-modal-lg">
        <h3 class="art-modal-title">${esc(T('hero.title'))}</h3>
        <div class="art-form-grid">
          <label class="art-form-full">${esc(T('hero.badge'))}<input type="text" id="hBadge" value="${esc(d.badge)}">${tcolorCtrlHtml(tc.badge, 'data-tcfield="badge"')}</label>
          <label class="art-form-full">${esc(T('hero.heading'))}<input type="text" id="hHeading" value="${esc(d.heading)}">${tcolorCtrlHtml(tc.heading, 'data-tcfield="heading"')}</label>
          <label class="art-form-full">${esc(T('hero.subtext'))}<textarea id="hSub" rows="2">${esc(d.subtext)}</textarea>${tcolorCtrlHtml(tc.subtext, 'data-tcfield="subtext"')}</label>
          <label>${esc(T('hero.primary'))}<input type="text" id="hPrimary" value="${esc(d.primaryText)}">${tcolorCtrlHtml(tc.primaryText, 'data-tcfield="primaryText"')}</label>
          <label>${esc(T('hero.secondary'))}<input type="text" id="hSecondary" value="${esc(d.secondaryText)}">${tcolorCtrlHtml(tc.secondaryText, 'data-tcfield="secondaryText"')}</label>
          <label>${esc(T('hero.align'))}
            <select id="hAlign">
              <option value="left" ${d.align==='left'?'selected':''}>${esc(T('hero.alignLeft'))}</option>
              <option value="center" ${d.align==='center'?'selected':''}>${esc(T('hero.alignCenter'))}</option>
              <option value="right" ${d.align==='right'?'selected':''}>${esc(T('hero.alignRight'))}</option>
            </select>
          </label>
          <label>${esc(T('hero.font'))}
            <select id="hFont">${FONTS.map(f=>`<option value="${esc(f)}" ${d.font===f?'selected':''}>${esc(f)}</option>`).join('')}</select>
          </label>
          <div class="art-img-field art-form-full">
            <label class="art-img-label">${esc(T('hero.image'))}</label>
            <p class="sf-img-hint">${esc(T('img.sq'))} 800×800px</p>
            <div class="sf-inline-toggle">
              <span>${esc(T('hero.showProductImg'))}</span>
              <button type="button" class="sf-toggle ${d.showProductImage?'on':'off'}" id="hShowImg"><span class="sf-toggle-knob"></span></button>
            </div>
            <div class="art-img-preview" id="hImgPreview" style="${imgData?'':'display:none;'}">${imgData?`<img src="${imgData}" alt="">`:''}</div>
            <label class="file-picker">
              <input type="file" id="hImg" accept="image/*">
              <span class="file-picker-btn">${esc(T('hero.chooseImg'))}</span>
              <span class="file-picker-name" id="hImgName">${imgData?esc(T('hero.imgChosen')):esc(T('hero.noImg'))}</span>
            </label>
          </div>
          <div class="art-img-field art-form-full">
            <label class="art-img-label">${esc(T('hero.bgImage'))}</label>
            <p class="setting-desc" style="margin:-2px 0 4px;">${esc(T('hero.bgHint'))}</p>
            <p class="sf-img-hint">${esc(T('img.wide'))} 1600×900px</p>
            <div class="art-img-preview" id="hBgPreview" style="${bgData?'':'display:none;'}">${bgData?`<img src="${bgData}" alt="">`:''}</div>
            <label class="file-picker">
              <input type="file" id="hBg" accept="image/*">
              <span class="file-picker-btn">${esc(T('hero.chooseImg'))}</span>
              <span class="file-picker-name" id="hBgName">${bgData?esc(T('hero.imgChosen')):esc(T('hero.noImg'))}</span>
            </label>
            ${bgData?`<button type="button" class="btn btn-ghost" id="hBgClear" style="margin-top:8px;">${esc(T('hero.removeBg'))}</button>`:''}
          </div>
        </div>
        ${colorsBlockHtml(d.colors)}
        <div class="art-modal-actions">
          <button class="btn btn-ghost" id="hCancel">${esc(T('cancel'))}</button>
          <button class="btn btn-primary" id="hSave">${esc(T('save'))}</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    const getColors = wireColorsBlock(ov, d.colors);
    const getTextColors = wireTcolors(ov, tc);
    const g = (id)=> ov.querySelector('#'+id);
    const close = ()=> ov.remove();
    ov.addEventListener('click', e=>{ if(e.target===ov) close(); });
    g('hCancel').addEventListener('click', close);
    g('hImg').addEventListener('change', (e)=>{
      const file = e.target.files[0]; if(!file) return;
      g('hImgName').textContent = file.name;
      const reader = new FileReader();
      reader.onload = ()=>{ imgData = reader.result; const pv = g('hImgPreview'); pv.innerHTML = `<img src="${imgData}" alt="">`; pv.style.display = 'block'; };
      reader.readAsDataURL(file);
    });
    // product-image on/off toggle
    let showImg = d.showProductImage !== false;
    const toggleBtn = g('hShowImg');
    toggleBtn.addEventListener('click', ()=>{
      showImg = !showImg;
      toggleBtn.classList.toggle('on', showImg);
      toggleBtn.classList.toggle('off', !showImg);
    });
    // background image
    g('hBg').addEventListener('change', (e)=>{
      const file = e.target.files[0]; if(!file) return;
      g('hBgName').textContent = file.name;
      const reader = new FileReader();
      reader.onload = ()=>{ bgData = reader.result; const pv = g('hBgPreview'); pv.innerHTML = `<img src="${bgData}" alt="">`; pv.style.display = 'block'; };
      reader.readAsDataURL(file);
    });
    const bgClear = g('hBgClear');
    if(bgClear) bgClear.addEventListener('click', ()=>{ bgData = null; const pv = g('hBgPreview'); pv.style.display='none'; pv.innerHTML=''; g('hBgName').textContent = T('hero.noImg'); bgClear.style.display='none'; });
    g('hSave').addEventListener('click', async ()=>{
      s.data = {
        badge: g('hBadge').value.trim(),
        heading: g('hHeading').value.trim(),
        subtext: g('hSub').value.trim(),
        primaryText: g('hPrimary').value.trim(),
        secondaryText: g('hSecondary').value.trim(),
        image: imgData,
        showProductImage: showImg,
        bgImage: bgData,
        align: g('hAlign').value,
        font: g('hFont').value,
        colors: getColors(),
        textColors: getTextColors()
      };
      await saveConfig();
      close();
      drawSections(body);
      refreshPublishStatus(body);
    });
  }

  /* ---------------- Features editor ---------------- */
  const FEATURES_MAX = 5;
  function featuresDefaults(){
    return { items: [
      { id: rid(), icon:'\u{1F69A}', title:'Free Shipping', desc:'On orders over $50', image:null },
      { id: rid(), icon:'\u{1F512}', title:'Secure Payment', desc:'100% secure payment', image:null },
      { id: rid(), icon:'\u21BA', title:'Easy Returns', desc:'30 days return policy', image:null },
      { id: rid(), icon:'\u{1F3A7}', title:'24/7 Support', desc:'Dedicated support', image:null }
    ] };
  }

  function openFeaturesEditor(body, idx){
    const s = curSections()[idx];
    const d = Object.assign(featuresDefaults(), s.data || {});
    // Work on a copy so Cancel discards changes.
    let items = (d.items || []).map(it=> Object.assign({}, it));
    const ov = document.createElement('div');
    ov.className = 'art-modal-overlay show';
    ov.innerHTML = `
      <div class="art-modal art-modal-lg">
        <h3 class="art-modal-title">${esc(T('feat.title'))}</h3>
        <p class="setting-desc" style="margin:-4px 0 12px;">${esc(T('feat.desc'))}</p>
        <div id="featList" class="sf-feat-list"></div>
        <button class="btn btn-ghost" id="featAdd" style="margin-top:12px;">${esc(T('feat.add'))}</button>
        ${colorsBlockHtml(s.data.colors)}
        <div class="art-modal-actions">
          <button class="btn btn-ghost" id="featCancel">${esc(T('cancel'))}</button>
          <button class="btn btn-primary" id="featSave">${esc(T('save'))}</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    const getColors = wireColorsBlock(ov, s.data.colors);
    const close = ()=> ov.remove();
    ov.addEventListener('click', e=>{ if(e.target===ov) close(); });
    ov.querySelector('#featCancel').addEventListener('click', close);

    function draw(){
      const list = ov.querySelector('#featList');
      list.innerHTML = items.map((it, i)=>`
        <div class="sf-feat-item" data-i="${i}">
          <div class="sf-feat-item-img">
            <label class="sf-feat-imgbtn" title="${esc(T('feat.image'))}">
              <input type="file" accept="image/*" data-fi="${i}" style="display:none;">
              ${it.image ? `<img src="${esc(it.image)}" alt="">` : `<span class="sf-feat-emoji">${esc(it.icon||'\u2B50')}</span>`}
            </label>
          </div>
          <div class="sf-feat-item-fields">
            <input type="text" class="sf-feat-title" data-ft="${i}" value="${esc(it.title)}" placeholder="${esc(T('feat.itemTitle'))}">
            ${tcolorCtrlHtml(it.titleColor, 'data-tcitem="'+i+'" data-tckey="titleColor"')}
            <input type="text" class="sf-feat-desc" data-fd="${i}" value="${esc(it.desc)}" placeholder="${esc(T('feat.itemDesc'))}">
            ${tcolorCtrlHtml(it.descColor, 'data-tcitem="'+i+'" data-tckey="descColor"')}
          </div>
          <button class="acc-icon sf-feat-del" data-fx="${i}" title="${esc(T('delete'))}">\u2715</button>
        </div>`).join('');
      // wire fields
      list.querySelectorAll('[data-ft]').forEach(el=> el.addEventListener('input', e=>{ items[+e.target.dataset.ft].title = e.target.value; }));
      list.querySelectorAll('[data-fd]').forEach(el=> el.addEventListener('input', e=>{ items[+e.target.dataset.fd].desc = e.target.value; }));
      list.querySelectorAll('[data-fi]').forEach(el=> el.addEventListener('change', e=>{
        const file = e.target.files[0]; if(!file) return;
        const i = +e.target.dataset.fi;
        const reader = new FileReader();
        reader.onload = ()=>{ items[i].image = reader.result; draw(); };
        reader.readAsDataURL(file);
      }));
      list.querySelectorAll('[data-fx]').forEach(el=> el.addEventListener('click', e=>{ items.splice(+e.currentTarget.dataset.fx, 1); draw(); }));
      wireItemTcolors(list, items);
      // add button state
      const addBtn = ov.querySelector('#featAdd');
      addBtn.disabled = items.length >= FEATURES_MAX;
      addBtn.textContent = items.length >= FEATURES_MAX ? T('feat.max') : T('feat.add');
    }
    ov.querySelector('#featAdd').addEventListener('click', ()=>{
      if(items.length >= FEATURES_MAX) return;
      items.push({ id: rid(), icon:'\u2B50', title:'', desc:'', image:null });
      draw();
    });
    ov.querySelector('#featSave').addEventListener('click', async ()=>{
      s.data = { items, colors: getColors() };
      await saveConfig();
      close();
      drawSections(body);
      refreshPublishStatus(body);
    });
    draw();
  }

  /* ---------------- Categories editor ---------------- */
  const CAT_TINTS = ['#DCE3D3','#EADBDD','#EFE6D6','#E7DDE9','#D8E5E6','#EDE2D2'];

  // Category names come live from Simple Store product types.
  // Reads through the async Store face (not localStorage directly) so the
  // Firebase swap reaches this for free — same as every other module read.
  async function storeProductTypes(){
    const cfg = await window.Store.get('mod_store_config');
    return (cfg && Array.isArray(cfg.productTypes)) ? cfg.productTypes.map(t=> t.name) : [];
  }

  async function openCategoriesEditor(body, idx){
    const s = curSections()[idx];
    const d = s.data || {};
    let heading = d.heading != null ? d.heading : 'Shop by Categories';
    const tc = d.textColors || {};
    // map keyed by type name: { image, color, show }
    const map = Object.assign({}, d.styles || {});
    const types = await storeProductTypes();

    const ov = document.createElement('div');
    ov.className = 'art-modal-overlay show';
    ov.innerHTML = `
      <div class="art-modal art-modal-lg">
        <h3 class="art-modal-title">${esc(T('cat.title'))}</h3>
        <div class="art-form-grid">
          <label class="art-form-full">${esc(T('cat.heading'))}<input type="text" id="catHeading" value="${esc(heading)}">${tcolorCtrlHtml(tc.heading, 'data-tcfield="heading"')}</label>
        </div>
        ${types.length === 0
          ? `<p class="setting-desc" style="margin:12px 0;">${esc(T('cat.noTypes'))}</p>`
          : `<p class="setting-desc" style="margin:8px 0 10px;">${esc(T('cat.desc'))}</p><div id="catList" class="sf-cat-list"></div>`}
        ${colorsBlockHtml(s.data.colors)}
        <div class="art-modal-actions">
          <button class="btn btn-ghost" id="catCancel">${esc(T('cancel'))}</button>
          <button class="btn btn-primary" id="catSave">${esc(T('save'))}</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    const getColors = wireColorsBlock(ov, s.data.colors);
    const getTextColors = wireTcolors(ov, tc);
    const close = ()=> ov.remove();
    ov.addEventListener('click', e=>{ if(e.target===ov) close(); });
    ov.querySelector('#catCancel').addEventListener('click', close);

    function styleOf(name){
      if(!map[name]) map[name] = { image:null, color:'', show:true };
      return map[name];
    }
    function draw(){
      const list = ov.querySelector('#catList');
      if(!list) return;
      list.innerHTML = types.map((name, i)=>{
        const st = styleOf(name);
        const color = st.color || CAT_TINTS[i % CAT_TINTS.length];
        const circle = st.image
          ? `<img src="${esc(st.image)}" alt="">`
          : `<span class="sf-cat-emoji">\u{1F4E6}</span>`;
        return `
          <div class="sf-cat-item ${st.show===false?'sf-cat-off':''}" data-name="${esc(name)}">
            <label class="sf-cat-circle" style="background:${esc(color)}" title="${esc(T('cat.image'))}">
              <input type="file" accept="image/*" data-ci="${i}" style="display:none;">
              ${circle}
            </label>
            <div class="sf-cat-name">${esc(name)}</div>
            <input type="color" class="sf-cat-color" data-cc="${i}" value="${esc(toHex(color))}" title="${esc(T('cat.color'))}">
            <button class="sf-toggle ${st.show===false?'off':'on'}" data-ct="${i}" title="${esc(st.show===false?T('off'):T('on'))}"><span class="sf-toggle-knob"></span></button>
          </div>`;
      }).join('');
      list.querySelectorAll('[data-ci]').forEach(el=> el.addEventListener('change', e=>{
        const file = e.target.files[0]; if(!file) return;
        const name = types[+e.target.dataset.ci];
        const reader = new FileReader();
        reader.onload = ()=>{ styleOf(name).image = reader.result; draw(); };
        reader.readAsDataURL(file);
      }));
      list.querySelectorAll('[data-cc]').forEach(el=> el.addEventListener('input', e=>{
        styleOf(types[+e.target.dataset.cc]).color = e.target.value;
      }));
      list.querySelectorAll('[data-ct]').forEach(el=> el.addEventListener('click', e=>{
        const st = styleOf(types[+e.currentTarget.dataset.ct]);
        st.show = st.show === false ? true : false;
        draw();
      }));
    }
    ov.querySelector('#catSave').addEventListener('click', async ()=>{
      s.data = { heading: ov.querySelector('#catHeading').value.trim(), styles: map, colors: getColors(), textColors: getTextColors() };
      await saveConfig();
      close();
      drawSections(body);
      refreshPublishStatus(body);
    });
    draw();
  }

  // Normalise any CSS colour to #rrggbb for the native colour input.
  function toHex(c){
    if(/^#[0-9a-fA-F]{6}$/.test(c)) return c;
    if(/^#[0-9a-fA-F]{3}$/.test(c)) return '#'+c.slice(1).split('').map(x=>x+x).join('');
    return '#DCE3D3';
  }

  /* ---------------- Products editor ---------------- */
  const PRODUCTS_MAX = 10;

  async function storeProducts(){
    try{ return await window.Store.list('mod_store_products'); }
    catch(e){ return []; }
  }

  async function openProductsEditor(body, idx){
    const s = curSections()[idx];
    const d = s.data || {};
    let heading = d.heading != null ? d.heading : 'Best Selling Products';
    const tc = d.textColors || {};
    let picked = Array.isArray(d.productIds) ? d.productIds.slice() : [];  // ordered product ids
    const allProducts = await storeProducts();
    const types = await storeProductTypes();

    const ov = document.createElement('div');
    ov.className = 'art-modal-overlay show';
    ov.innerHTML = `
      <div class="art-modal art-modal-lg">
        <h3 class="art-modal-title">${esc(T('prod.title'))}</h3>
        <div class="art-form-grid">
          <label class="art-form-full">${esc(T('prod.heading'))}<input type="text" id="pdHeading" value="${esc(heading)}">${tcolorCtrlHtml(tc.heading, 'data-tcfield="heading"')}</label>
        </div>
        ${allProducts.length === 0
          ? `<p class="setting-desc" style="margin:12px 0;">${esc(T('prod.noProducts'))}</p>`
          : `
          <p class="setting-desc" style="margin:8px 0 10px;">${esc(T('prod.desc'))}</p>
          <div class="sf-pd-picker">
            <select id="pdType"><option value="all">${esc(T('prod.allTypes'))}</option>${types.map(t=>`<option value="${esc(t)}">${esc(t)}</option>`).join('')}</select>
            <select id="pdProduct"></select>
            <button class="btn btn-ghost" id="pdAdd">${esc(T('prod.addItem'))}</button>
          </div>
          <div id="pdList" class="sf-pd-list"></div>`}
        ${colorsBlockHtml(s.data.colors)}
        <div class="art-modal-actions">
          <button class="btn btn-ghost" id="pdCancel">${esc(T('cancel'))}</button>
          <button class="btn btn-primary" id="pdSave">${esc(T('save'))}</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    const getColors = wireColorsBlock(ov, s.data.colors);
    const getTextColors = wireTcolors(ov, tc);
    const g = (id)=> ov.querySelector('#'+id);
    const close = ()=> ov.remove();
    ov.addEventListener('click', e=>{ if(e.target===ov) close(); });
    g('pdCancel').addEventListener('click', close);

    function nameOf(id){ const p = allProducts.find(x=> x.id===id); return p ? p.name : id; }

    function fillProductDropdown(){
      const sel = g('pdProduct');
      if(!sel) return;
      const type = g('pdType').value;
      const list = allProducts.filter(p=>{
        if(picked.includes(p.id)) return false;                 // already added
        if(type !== 'all' && p.productType !== type) return false;
        return true;
      });
      sel.innerHTML = list.length === 0
        ? `<option value="">${esc(T('prod.noneLeft'))}</option>`
        : list.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}${p.sku?` (${esc(p.sku)})`:''}</option>`).join('');
    }
    function drawPicked(){
      const list = g('pdList');
      if(!list) return;
      list.innerHTML = picked.length === 0
        ? `<div class="sf-pd-empty">${esc(T('prod.emptyPicked'))}</div>`
        : picked.map((id, i)=>`
          <div class="sf-pd-item" data-i="${i}">
            <span class="sf-pd-num">${i+1}</span>
            <span class="sf-pd-name">${esc(nameOf(id))}</span>
            <button class="acc-icon sf-pd-del" data-px="${i}" title="${esc(T('delete'))}">\u2715</button>
          </div>`).join('');
      list.querySelectorAll('[data-px]').forEach(el=> el.addEventListener('click', e=>{
        picked.splice(+e.currentTarget.dataset.px, 1);
        drawPicked(); fillProductDropdown(); updateAddState();
      }));
    }
    function updateAddState(){
      const add = g('pdAdd'); if(!add) return;
      const sel = g('pdProduct');
      add.disabled = picked.length >= PRODUCTS_MAX || !sel.value;
      add.textContent = picked.length >= PRODUCTS_MAX ? T('prod.max') : T('prod.addItem');
    }
    if(allProducts.length > 0){
      g('pdType').addEventListener('change', ()=>{ fillProductDropdown(); updateAddState(); });
      g('pdProduct').addEventListener('change', updateAddState);
      g('pdAdd').addEventListener('click', ()=>{
        const id = g('pdProduct').value;
        if(!id || picked.length >= PRODUCTS_MAX) return;
        picked.push(id);
        drawPicked(); fillProductDropdown(); updateAddState();
      });
      fillProductDropdown(); drawPicked(); updateAddState();
    }
    g('pdSave').addEventListener('click', async ()=>{
      s.data = { heading: g('pdHeading').value.trim(), productIds: picked, colors: getColors(), textColors: getTextColors() };
      await saveConfig();
      close();
      drawSections(body);
      refreshPublishStatus(body);
    });
  }

  /* ---------------- Promo editor ---------------- */
  function promoDefaults(){
    return {
      eyebrow: 'Special Offer',
      heading: 'Up to 50% Off',
      subtext: 'Limited time offer on selected items. Hurry up and grab the best deals!',
      buttonText: 'Shop the Sale',
      image: null,
      showImage: true,
      showButton: true
    };
  }

  function openPromoEditor(body, idx){
    const s = curSections()[idx];
    const d = Object.assign(promoDefaults(), s.data || {});
    const tc = d.textColors || {};
    let imgData = d.image || null;
    let showImage = d.showImage !== false;
    let showButton = d.showButton !== false;
    const ov = document.createElement('div');
    ov.className = 'art-modal-overlay show';
    ov.innerHTML = `
      <div class="art-modal art-modal-lg">
        <h3 class="art-modal-title">${esc(T('promo.title'))}</h3>
        <div class="art-form-grid">
          <label class="art-form-full">${esc(T('promo.eyebrow'))}<input type="text" id="pmEyebrow" value="${esc(d.eyebrow)}">${tcolorCtrlHtml(tc.eyebrow, 'data-tcfield="eyebrow"')}</label>
          <label class="art-form-full">${esc(T('promo.heading'))}<input type="text" id="pmHeading" value="${esc(d.heading)}">${tcolorCtrlHtml(tc.heading, 'data-tcfield="heading"')}</label>
          <label class="art-form-full">${esc(T('promo.subtext'))}<textarea id="pmSub" rows="2">${esc(d.subtext)}</textarea>${tcolorCtrlHtml(tc.subtext, 'data-tcfield="subtext"')}</label>
          <label class="art-form-full">${esc(T('promo.button'))}<input type="text" id="pmButton" value="${esc(d.buttonText)}">${tcolorCtrlHtml(tc.buttonText, 'data-tcfield="buttonText"')}</label>
          <div class="sf-inline-toggle art-form-full">
            <span>${esc(T('promo.showButton'))}</span>
            <button type="button" class="sf-toggle ${showButton?'on':'off'}" id="pmShowBtn"><span class="sf-toggle-knob"></span></button>
          </div>
          <div class="art-img-field art-form-full">
            <label class="art-img-label">${esc(T('promo.image'))}</label>
            <p class="sf-img-hint">${esc(T('img.wide'))} 800×600px</p>
            <div class="sf-inline-toggle">
              <span>${esc(T('promo.showImage'))}</span>
              <button type="button" class="sf-toggle ${showImage?'on':'off'}" id="pmShowImg"><span class="sf-toggle-knob"></span></button>
            </div>
            <div class="art-img-preview" id="pmImgPreview" style="${imgData?'':'display:none;'}">${imgData?`<img src="${imgData}" alt="">`:''}</div>
            <label class="file-picker">
              <input type="file" id="pmImg" accept="image/*">
              <span class="file-picker-btn">${esc(T('hero.chooseImg'))}</span>
              <span class="file-picker-name" id="pmImgName">${imgData?esc(T('hero.imgChosen')):esc(T('hero.noImg'))}</span>
            </label>
          </div>
        </div>
        ${colorsBlockHtml(s.data.colors)}
        <div class="art-modal-actions">
          <button class="btn btn-ghost" id="pmCancel">${esc(T('cancel'))}</button>
          <button class="btn btn-primary" id="pmSave">${esc(T('save'))}</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    const getColors = wireColorsBlock(ov, s.data.colors);
    const getTextColors = wireTcolors(ov, tc);
    const g = (id)=> ov.querySelector('#'+id);
    const close = ()=> ov.remove();
    ov.addEventListener('click', e=>{ if(e.target===ov) close(); });
    g('pmCancel').addEventListener('click', close);
    g('pmImg').addEventListener('change', (e)=>{
      const file = e.target.files[0]; if(!file) return;
      g('pmImgName').textContent = file.name;
      const reader = new FileReader();
      reader.onload = ()=>{ imgData = reader.result; const pv = g('pmImgPreview'); pv.innerHTML = `<img src="${imgData}" alt="">`; pv.style.display = 'block'; };
      reader.readAsDataURL(file);
    });
    g('pmShowImg').addEventListener('click', ()=>{
      showImage = !showImage;
      g('pmShowImg').classList.toggle('on', showImage);
      g('pmShowImg').classList.toggle('off', !showImage);
    });
    g('pmShowBtn').addEventListener('click', ()=>{
      showButton = !showButton;
      g('pmShowBtn').classList.toggle('on', showButton);
      g('pmShowBtn').classList.toggle('off', !showButton);
    });
    g('pmSave').addEventListener('click', async ()=>{
      s.data = {
        eyebrow: g('pmEyebrow').value.trim(),
        heading: g('pmHeading').value.trim(),
        subtext: g('pmSub').value.trim(),
        buttonText: g('pmButton').value.trim(),
        image: imgData,
        showImage: showImage,
        showButton: showButton,
        colors: getColors(),
        textColors: getTextColors()
      };
      await saveConfig();
      close();
      drawSections(body);
      refreshPublishStatus(body);
    });
  }

  /* ---------------- News editor (Promo without a button) ---------------- */
  function newsDefaults(){
    return {
      eyebrow: 'What\u2019s New',
      heading: 'Latest News',
      subtext: 'Stay tuned for our latest updates and announcements.',
      image: null,
      showImage: true
    };
  }

  function openNewsEditor(body, idx){
    const s = curSections()[idx];
    const d = Object.assign(newsDefaults(), s.data || {});
    const tc = d.textColors || {};
    let imgData = d.image || null;
    let showImage = d.showImage !== false;
    const ov = document.createElement('div');
    ov.className = 'art-modal-overlay show';
    ov.innerHTML = `
      <div class="art-modal art-modal-lg">
        <h3 class="art-modal-title">${esc(T('news.title'))}</h3>
        <div class="art-form-grid">
          <label class="art-form-full">${esc(T('promo.eyebrow'))}<input type="text" id="nwEyebrow" value="${esc(d.eyebrow)}">${tcolorCtrlHtml(tc.eyebrow, 'data-tcfield="eyebrow"')}</label>
          <label class="art-form-full">${esc(T('promo.heading'))}<input type="text" id="nwHeading" value="${esc(d.heading)}">${tcolorCtrlHtml(tc.heading, 'data-tcfield="heading"')}</label>
          <label class="art-form-full">${esc(T('promo.subtext'))}<textarea id="nwSub" rows="2">${esc(d.subtext)}</textarea>${tcolorCtrlHtml(tc.subtext, 'data-tcfield="subtext"')}</label>
          <div class="art-img-field art-form-full">
            <label class="art-img-label">${esc(T('promo.image'))}</label>
            <p class="sf-img-hint">${esc(T('img.wide'))} 800×600px</p>
            <div class="sf-inline-toggle">
              <span>${esc(T('promo.showImage'))}</span>
              <button type="button" class="sf-toggle ${showImage?'on':'off'}" id="nwShowImg"><span class="sf-toggle-knob"></span></button>
            </div>
            <div class="art-img-preview" id="nwImgPreview" style="${imgData?'':'display:none;'}">${imgData?`<img src="${imgData}" alt="">`:''}</div>
            <label class="file-picker">
              <input type="file" id="nwImg" accept="image/*">
              <span class="file-picker-btn">${esc(T('hero.chooseImg'))}</span>
              <span class="file-picker-name" id="nwImgName">${imgData?esc(T('hero.imgChosen')):esc(T('hero.noImg'))}</span>
            </label>
          </div>
        </div>
        ${colorsBlockHtml(s.data.colors)}
        <div class="art-modal-actions">
          <button class="btn btn-ghost" id="nwCancel">${esc(T('cancel'))}</button>
          <button class="btn btn-primary" id="nwSave">${esc(T('save'))}</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    const g = (id)=> ov.querySelector('#'+id);
    const close = ()=> ov.remove();
    ov.addEventListener('click', e=>{ if(e.target===ov) close(); });
    g('nwCancel').addEventListener('click', close);
    g('nwImg').addEventListener('change', (e)=>{
      const file = e.target.files[0]; if(!file) return;
      g('nwImgName').textContent = file.name;
      const reader = new FileReader();
      reader.onload = ()=>{ imgData = reader.result; const pv = g('nwImgPreview'); pv.innerHTML = `<img src="${imgData}" alt="">`; pv.style.display = 'block'; };
      reader.readAsDataURL(file);
    });
    g('nwShowImg').addEventListener('click', ()=>{
      showImage = !showImage;
      g('nwShowImg').classList.toggle('on', showImage);
      g('nwShowImg').classList.toggle('off', !showImage);
    });
    const getColors = wireColorsBlock(ov, s.data.colors);
    const getTextColors = wireTcolors(ov, tc);
    g('nwSave').addEventListener('click', async ()=>{
      s.data = {
        eyebrow: g('nwEyebrow').value.trim(),
        heading: g('nwHeading').value.trim(),
        subtext: g('nwSub').value.trim(),
        image: imgData,
        showImage: showImage,
        colors: getColors(),
        textColors: getTextColors()
      };
      await saveConfig();
      close();
      drawSections(body);
      refreshPublishStatus(body);
    });
  }

  /* ---------------- Cards editor (About Layout) ---------------- */
  // Manual image + title cards — same look as the product grid, but the owner
  // adds each card by hand (no Simple Store data).
  const CARDS_MAX = 12;
  function cardsDefaults(){
    return { heading: 'Meet the Team', items: [
      { id: rid(), image:null, title:'Card One' },
      { id: rid(), image:null, title:'Card Two' },
      { id: rid(), image:null, title:'Card Three' }
    ] };
  }
  function openCardsEditor(body, idx){
    const s = curSections()[idx];
    const d = Object.assign(cardsDefaults(), s.data || {});
    const tc = d.textColors || {};
    let items = (d.items || []).map(it=> Object.assign({}, it));
    const ov = document.createElement('div');
    ov.className = 'art-modal-overlay show';
    ov.innerHTML = `
      <div class="art-modal art-modal-lg">
        <h3 class="art-modal-title">${esc(T('cards.title'))}</h3>
        <div class="art-form-grid">
          <label class="art-form-full">${esc(T('cards.heading'))}<input type="text" id="cdHeading" value="${esc(d.heading||'')}">${tcolorCtrlHtml(tc.heading, 'data-tcfield="heading"')}</label>
        </div>
        <p class="sf-img-hint">${esc(T('img.sq'))} 400\u00D7400px</p>
        <div id="cdList" class="sf-feat-list"></div>
        <button class="btn btn-ghost" id="cdAdd" style="margin-top:12px;">${esc(T('cards.add'))}</button>
        ${colorsBlockHtml(s.data.colors)}
        <div class="art-modal-actions">
          <button class="btn btn-ghost" id="cdCancel">${esc(T('cancel'))}</button>
          <button class="btn btn-primary" id="cdSave">${esc(T('save'))}</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    const getColors = wireColorsBlock(ov, s.data.colors);
    const getTextColors = wireTcolors(ov, tc);
    const close = ()=> ov.remove();
    ov.addEventListener('click', e=>{ if(e.target===ov) close(); });
    ov.querySelector('#cdCancel').addEventListener('click', close);

    function draw(){
      const list = ov.querySelector('#cdList');
      list.innerHTML = items.map((it, i)=>`
        <div class="sf-feat-item" data-i="${i}">
          <div class="sf-feat-item-img">
            <label class="sf-feat-imgbtn" title="${esc(T('cards.image'))}">
              <input type="file" accept="image/*" data-fi="${i}" style="display:none;">
              ${it.image ? `<img src="${esc(it.image)}" alt="">` : `<span class="sf-feat-emoji">\u{1F4F7}</span>`}
            </label>
          </div>
          <div class="sf-feat-item-fields">
            <input type="text" class="sf-feat-title" data-ft="${i}" value="${esc(it.title||'')}" placeholder="${esc(T('cards.itemTitle'))}">
            ${tcolorCtrlHtml(it.titleColor, 'data-tcitem="'+i+'" data-tckey="titleColor"')}
          </div>
          <button class="acc-icon sf-feat-del" data-fx="${i}" title="${esc(T('delete'))}">\u2715</button>
        </div>`).join('');
      list.querySelectorAll('[data-ft]').forEach(el=> el.addEventListener('input', e=>{ items[+e.target.dataset.ft].title = e.target.value; }));
      list.querySelectorAll('[data-fi]').forEach(el=> el.addEventListener('change', e=>{
        const file = e.target.files[0]; if(!file) return;
        const i = +e.target.dataset.fi;
        const reader = new FileReader();
        reader.onload = ()=>{ items[i].image = reader.result; draw(); };
        reader.readAsDataURL(file);
      }));
      list.querySelectorAll('[data-fx]').forEach(el=> el.addEventListener('click', e=>{ items.splice(+e.currentTarget.dataset.fx, 1); draw(); }));
      wireItemTcolors(list, items);
      const addBtn = ov.querySelector('#cdAdd');
      addBtn.disabled = items.length >= CARDS_MAX;
      addBtn.textContent = items.length >= CARDS_MAX ? T('cards.max') : T('cards.add');
    }
    ov.querySelector('#cdAdd').addEventListener('click', ()=>{
      if(items.length >= CARDS_MAX) return;
      items.push({ id: rid(), image:null, title:'' });
      draw();
    });
    ov.querySelector('#cdSave').addEventListener('click', async ()=>{
      s.data = { heading: ov.querySelector('#cdHeading').value.trim(), items, colors: getColors(), textColors: getTextColors() };
      await saveConfig();
      close();
      drawSections(body);
      refreshPublishStatus(body);
    });
    draw();
  }

  /* ---------------- Contact editor (social/link boxes) ---------------- */
  const CONTACT_MIN = 1, CONTACT_MAX = 10;
  // Ready-made emoji icons to pick from.
  const CONTACT_ICONS = ['\u{1F4F7}','\u{1F3B5}','\u{1F4AC}','\u{1F4D8}','\u2716\uFE0F','\u25B6\uFE0F','\u2709\uFE0F','\u{1F310}','\u{1F4F1}','\u{1F6D2}','\u2764\uFE0F','\u2B50'];

  function contactDefaults(){
    return {
      heading: 'Follow Us',
      subtext: '',
      boxes: [
        { id: rid(), label:'Instagram', icon:'\u{1F4F7}', image:null, value:'https://instagram.com/', action:'open' },
        { id: rid(), label:'TikTok', icon:'\u{1F3B5}', image:null, value:'https://tiktok.com/', action:'open' },
        { id: rid(), label:'Line', icon:'\u{1F4AC}', image:null, value:'@yourline', action:'copy' }
      ]
    };
  }

  function openContactEditor(body, idx){
    const s = curSections()[idx];
    const d = Object.assign(contactDefaults(), s.data || {});
    const tc = d.textColors || {};
    let boxes = (d.boxes || []).map(b=> Object.assign({}, b));
    if(boxes.length === 0) boxes = contactDefaults().boxes;
    const ov = document.createElement('div');
    ov.className = 'art-modal-overlay show';
    ov.innerHTML = `
      <div class="art-modal art-modal-lg">
        <h3 class="art-modal-title">${esc(T('contact.title'))}</h3>
        <div class="art-form-grid">
          <label class="art-form-full">${esc(T('contact.heading'))}<input type="text" id="ctHeading" value="${esc(d.heading)}">${tcolorCtrlHtml(tc.heading, 'data-tcfield="heading"')}</label>
          <label class="art-form-full">${esc(T('contact.subtext'))}<input type="text" id="ctSub" value="${esc(d.subtext)}">${tcolorCtrlHtml(tc.subtext, 'data-tcfield="subtext"')}</label>
        </div>
        <p class="setting-desc" style="margin:8px 0 10px;">${esc(T('contact.desc'))}</p>
        <div id="ctList" class="sf-ct-list"></div>
        <button class="btn btn-ghost" id="ctAdd" style="margin-top:10px;">${esc(T('contact.add'))}</button>
        ${colorsBlockHtml(s.data.colors)}
        <div class="art-modal-actions">
          <button class="btn btn-ghost" id="ctCancel">${esc(T('cancel'))}</button>
          <button class="btn btn-primary" id="ctSave">${esc(T('save'))}</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    const getColors = wireColorsBlock(ov, s.data.colors);
    const getTextColors = wireTcolors(ov, tc);
    const close = ()=> ov.remove();
    ov.addEventListener('click', e=>{ if(e.target===ov) close(); });
    ov.querySelector('#ctCancel').addEventListener('click', close);

    function draw(){
      const list = ov.querySelector('#ctList');
      list.innerHTML = boxes.map((b, i)=>`
        <div class="sf-ct-item" data-i="${i}">
          <div class="sf-ct-row1">
            <span class="sf-ct-icon">
              ${b.image ? `<img src="${esc(b.image)}" alt="">` : `<span class="sf-ct-icon-emoji">${esc(b.icon||'\u2B50')}</span>`}
            </span>
            <input type="text" class="sf-ct-label" data-cl="${i}" value="${esc(b.label)}" placeholder="${esc(T('contact.label'))}">
            <button class="acc-icon sf-ct-del" data-cx="${i}" title="${esc(T('delete'))}" ${boxes.length<=CONTACT_MIN?'disabled':''}>\u2715</button>
          </div>
          ${tcolorCtrlHtml(b.labelColor, 'data-tcitem="'+i+'" data-tckey="labelColor"')}
          <div class="sf-ct-iconpick-label">${esc(T('contact.pickIcon'))} · ${esc(T('img.sq'))} 200×200px</div>
          <div class="sf-ct-icons" data-ic="${i}">
            ${CONTACT_ICONS.map(ic=>`<button type="button" class="sf-ct-ico-pick ${b.icon===ic&&!b.image?'sel':''}" data-setic="${i}" data-ic="${esc(ic)}">${ic}</button>`).join('')}
            <label class="sf-ct-upload" title="${esc(T('contact.upload'))}">
              <input type="file" accept="image/*" data-ci="${i}" style="display:none;">
              \u{1F4F7}\uFE0F ${esc(T('contact.upload'))}
            </label>
          </div>
          ${b.image ? `<button type="button" class="sf-ct-clearimg" data-clr="${i}">${esc(T('contact.clearImg'))}</button>` : ''}
          <input type="text" class="sf-ct-value" data-cv="${i}" value="${esc(b.value)}" placeholder="${esc(T('contact.value'))}">
          <div class="sf-ct-action">
            <button type="button" class="sf-ct-mode ${b.action==='open'?'sel':''}" data-mode="open" data-mi="${i}">${esc(T('contact.open'))}</button>
            <button type="button" class="sf-ct-mode ${b.action==='copy'?'sel':''}" data-mode="copy" data-mi="${i}">${esc(T('contact.copy'))}</button>
          </div>
        </div>`).join('');
      // wire
      list.querySelectorAll('[data-cl]').forEach(el=> el.addEventListener('input', e=>{ boxes[+e.target.dataset.cl].label = e.target.value; }));
      list.querySelectorAll('[data-cv]').forEach(el=> el.addEventListener('input', e=>{ boxes[+e.target.dataset.cv].value = e.target.value; }));
      list.querySelectorAll('[data-ci]').forEach(el=> el.addEventListener('change', e=>{
        const file = e.target.files[0]; if(!file) return;
        const i = +e.target.dataset.ci;
        const reader = new FileReader();
        reader.onload = ()=>{ boxes[i].image = reader.result; draw(); };
        reader.readAsDataURL(file);
      }));
      list.querySelectorAll('[data-setic]').forEach(el=> el.addEventListener('click', e=>{
        const i = +e.currentTarget.dataset.setic;
        boxes[i].icon = e.currentTarget.dataset.ic;
        boxes[i].image = null;  // picking an emoji clears the uploaded image
        draw();
      }));
      list.querySelectorAll('[data-clr]').forEach(el=> el.addEventListener('click', e=>{
        boxes[+e.currentTarget.dataset.clr].image = null; draw();
      }));
      list.querySelectorAll('[data-mode]').forEach(el=> el.addEventListener('click', e=>{
        boxes[+e.currentTarget.dataset.mi].action = e.currentTarget.dataset.mode;
        draw();
      }));
      list.querySelectorAll('[data-cx]').forEach(el=> el.addEventListener('click', e=>{
        if(boxes.length <= CONTACT_MIN) return;
        boxes.splice(+e.currentTarget.dataset.cx, 1); draw();
      }));
      wireItemTcolors(list, boxes);
      const addBtn = ov.querySelector('#ctAdd');
      addBtn.disabled = boxes.length >= CONTACT_MAX;
      addBtn.textContent = boxes.length >= CONTACT_MAX ? T('contact.max') : T('contact.add');
    }
    ov.querySelector('#ctAdd').addEventListener('click', ()=>{
      if(boxes.length >= CONTACT_MAX) return;
      boxes.push({ id: rid(), label:'', icon:'\u{1F310}', image:null, value:'', action:'open' });
      draw();
    });
    ov.querySelector('#ctSave').addEventListener('click', async ()=>{
      s.data = {
        heading: ov.querySelector('#ctHeading').value.trim(),
        subtext: ov.querySelector('#ctSub').value.trim(),
        boxes: boxes,
        colors: getColors(),
        textColors: getTextColors()
      };
      await saveConfig();
      close();
      drawSections(body);
      refreshPublishStatus(body);
    });
    draw();
  }

  // Seed a new section with sensible content so it shows immediately,
  // before the user ever opens its editor.
  function defaultDataFor(type){
    switch(type){
      case 'hero': return heroDefaults();
      case 'features': return featuresDefaults();
      case 'categories': return { heading:'Shop by Categories', styles:{} };
      case 'products': return { heading:'Best Selling Products', productIds:[] };
      case 'promo': return promoDefaults();
      case 'news': return newsDefaults();
      case 'contact': return contactDefaults();
      case 'productlist': return { heading:'Shop All' };
      case 'cards': return cardsDefaults();
      default: return {};
    }
  }

  function openAddSectionModal(body){
    const secs = curSections();
    // Singletons (Hero, Product Listing) are hidden once one already exists.
    const available = allowedTypes().filter(type=>
      !(SINGLETON_TYPES.includes(type) && secs.some(s=> s.type === type))
    );
    const ov = document.createElement('div');
    ov.className = 'art-modal-overlay show';
    ov.innerHTML = `
      <div class="art-modal">
        <h3 class="art-modal-title">${esc(T('pickType'))}</h3>
        <div class="sf-type-picker">
          ${available.map(type=>`
            <button class="sf-type-card" data-type="${type}">
              <span class="sf-type-ico">${SECTION_ICON[type]}</span>
              <span class="sf-type-name">${esc(typeName(type))}</span>
              <span class="sf-type-desc">${esc(typeDesc(type))}</span>
            </button>`).join('')}
        </div>
        <div class="art-modal-actions">
          <button class="btn btn-ghost" id="sfAddCancel">${esc(T('cancel'))}</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    const close = ()=> ov.remove();
    ov.addEventListener('click', e=>{ if(e.target===ov) close(); });
    ov.querySelector('#sfAddCancel').addEventListener('click', close);
    ov.querySelectorAll('.sf-type-card').forEach(btn=>{
      btn.addEventListener('click', async ()=>{
        curSections().push({ id: rid(), type: btn.dataset.type, enabled:true, data: defaultDataFor(btn.dataset.type) });
        await saveConfig();
        close();
        drawSections(body);
      });
    });
  }
})();
