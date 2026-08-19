-- ============================================================================
-- TableTap — SEED DATA (demo restaurant so you can test immediately)
-- Run via: pnpm db:seed   (or pnpm db:reset to drop + create + seed)
-- Idempotent: skips if the demo restaurant already exists.
-- Demonstrates multiple menus: a "Dinner" menu and a "Brunch" menu, each with
-- its own categories, products and extras (nothing shared between them).
-- ============================================================================
do $$
declare
  rid uuid;
  m_dinner uuid; m_brunch uuid;
  cat_starters uuid; cat_mains uuid; cat_sushi uuid; cat_drinks uuid; cat_desserts uuid;
  cat_brunch uuid; cat_coffee uuid;
begin
  if exists (select 1 from restaurants where name = 'Sakura Dining') then
    raise notice 'Seed skipped — Sakura Dining already exists.';
    return;
  end if;

  -- Restaurant
  -- On Casa explicitly. Restaurants default to the free counter plan, which
  -- allows no tables at all, so the twelve below would be refused by the plan
  -- ceiling — the demo exists to show the paid product, not to fail on it.
  insert into restaurants (name, tagline, logo, currency, service_pct, plan, plan_status)
  values ('Sakura Dining', 'Modern Japanese Kitchen', '🌸', 'MXN', 0, 'casa', 'active')
  returning id into rid;

  -- Tables 1..12
  for i in 1..12 loop
    insert into restaurant_tables (restaurant_id, label) values (rid, i::text);
  end loop;

  -- Menus (both active — the customer sees the union; the owner can toggle either)
  insert into menus (restaurant_id, name, active, sort_order) values (rid, 'Dinner', true, 0) returning id into m_dinner;
  insert into menus (restaurant_id, name, active, sort_order) values (rid, 'Brunch', true, 1) returning id into m_brunch;

  -- ── Dinner menu ──
  insert into categories (restaurant_id, menu_id, name, sort_order) values (rid,m_dinner,'Starters',1) returning id into cat_starters;
  insert into categories (restaurant_id, menu_id, name, sort_order) values (rid,m_dinner,'Mains',2)    returning id into cat_mains;
  insert into categories (restaurant_id, menu_id, name, sort_order) values (rid,m_dinner,'Sushi',3)    returning id into cat_sushi;
  insert into categories (restaurant_id, menu_id, name, sort_order) values (rid,m_dinner,'Drinks',4)   returning id into cat_drinks;
  insert into categories (restaurant_id, menu_id, name, sort_order) values (rid,m_dinner,'Desserts',5) returning id into cat_desserts;

  insert into menu_items (restaurant_id, menu_id, category_id, name, description, price, emoji, popular, modifiers, sort_order) values
  (rid, m_dinner, cat_starters, 'Edamame', 'Steamed salted soybeans with sea salt', 4.50, '🫛', true,
    '[{"label":"Spice level","type":"single","options":["Mild","Spicy","Extra Spicy"]}]', 1),
  (rid, m_dinner, cat_starters, 'Gyoza (6 pcs)', 'Pan-fried pork & cabbage dumplings with ponzu', 8.90, '🥟', true,
    '[{"label":"Cooking style","type":"single","options":["Pan-fried","Steamed"]},{"label":"Extra sauce","type":"multi","options":["Ponzu","Soy","Chili oil"]}]', 2),
  (rid, m_dinner, cat_starters, 'Miso Soup', 'Dashi-based miso with tofu, wakame, spring onion', 3.50, '🍵', false, '[]', 3),
  (rid, m_dinner, cat_mains, 'Tonkotsu Ramen', 'Rich pork bone broth, chashu, soft egg, nori', 14.90, '🍜', true,
    '[{"label":"Broth richness","type":"single","options":["Light","Regular","Rich"]},{"label":"Noodle firmness","type":"single","options":["Soft","Medium","Firm (kata)"]},{"label":"Extras","type":"multi","options":["Extra chashu +$3","Extra egg +$1.5","Extra nori +$1"]}]', 1),
  (rid, m_dinner, cat_mains, 'Katsu Curry', 'Crispy panko chicken katsu, Japanese curry, rice', 13.50, '🍛', false,
    '[{"label":"Protein","type":"single","options":["Chicken","Pork","Tofu (V)"]},{"label":"Curry heat","type":"single","options":["Mild","Medium","Hot"]}]', 2),
  (rid, m_dinner, cat_mains, 'Teriyaki Salmon', 'Grilled salmon, house teriyaki, rice and pickles', 17.90, '🐟', false,
    '[{"label":"Side","type":"single","options":["Steamed rice","Soba noodles","Salad"]}]', 3),
  (rid, m_dinner, cat_sushi, 'Salmon Nigiri (4 pcs)', 'Hand-pressed vinegared rice, fresh salmon', 11.50, '🍣', true,
    '[{"label":"Wasabi","type":"single","options":["With wasabi","No wasabi"]}]', 1),
  (rid, m_dinner, cat_sushi, 'Dragon Roll (8 pcs)', 'Prawn tempura, avocado & eel, spicy mayo', 16.90, '🐉', true,
    '[{"label":"Sauce","type":"single","options":["Spicy mayo","Teriyaki","Both"]}]', 2),
  (rid, m_dinner, cat_drinks, 'Asahi Beer', 'Japanese lager, 330ml bottle', 5.50, '🍺', false, '[]', 1),
  (rid, m_dinner, cat_drinks, 'Matcha Latte', 'Ceremonial grade matcha, steamed oat milk', 4.90, '🍵', true,
    '[{"label":"Milk","type":"single","options":["Oat","Soy","Full cream"]}]', 2),
  (rid, m_dinner, cat_drinks, 'Yuzu Lemonade', 'Yuzu citrus syrup, sparkling water, mint', 4.50, '🍋', false,
    '[{"label":"Sugar","type":"single","options":["Normal","Less sweet","No sugar"]}]', 3),
  (rid, m_dinner, cat_desserts, 'Mochi Ice Cream (3 pcs)', 'Soft rice cake with ice cream filling', 7.90, '🍡', true,
    '[{"label":"Flavours","type":"multi","options":["Matcha","Strawberry","Mango","Vanilla","Black sesame"]}]', 1),
  (rid, m_dinner, cat_desserts, 'Matcha Tiramisu', 'Matcha-soaked ladyfingers, mascarpone', 8.50, '🍰', false, '[]', 2);

  -- ── Brunch menu (its own categories, products and extras) ──
  insert into categories (restaurant_id, menu_id, name, sort_order) values (rid,m_brunch,'Brunch Plates',1) returning id into cat_brunch;
  insert into categories (restaurant_id, menu_id, name, sort_order) values (rid,m_brunch,'Coffee',2)        returning id into cat_coffee;

  insert into menu_items (restaurant_id, menu_id, category_id, name, description, price, emoji, popular, modifiers, sort_order) values
  (rid, m_brunch, cat_brunch, 'Tamago Sando', 'Fluffy Japanese egg salad on milk bread', 7.50, '🥪', true, '[]', 1),
  (rid, m_brunch, cat_brunch, 'Okonomiyaki', 'Savoury cabbage pancake, bonito, kewpie', 11.00, '🥞', true, '[]', 2),
  (rid, m_brunch, cat_coffee, 'Pour Over', 'Single-origin, hand-brewed', 4.20, '☕', false,
    '[{"label":"Bean","type":"single","options":["Light roast","Dark roast"]}]', 1),
  (rid, m_brunch, cat_coffee, 'Iced Hojicha Latte', 'Roasted green tea, milk, ice', 4.80, '🧋', true, '[]', 2);

  -- A Brunch-only extra, attached to the Tamago Sando.
  insert into menu_items (restaurant_id, menu_id, name, price, emoji, is_addon, sort_order)
  values (rid, m_brunch, 'Extra egg', 1.50, '🥚', true, 1);
  insert into item_addons (product_id, addon_id)
  select p.id, a.id
  from menu_items p, menu_items a
  where p.restaurant_id = rid and p.name = 'Tamago Sando'
    and a.restaurant_id = rid and a.name = 'Extra egg' and a.is_addon = true;

  raise notice 'Seeded restaurant id: %', rid;
end $$;
