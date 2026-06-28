-- ============================================================================
-- TableTap — SEED DATA (demo restaurant so you can test immediately)
-- Run via: pnpm db:seed   (or pnpm db:reset to drop + create + seed)
-- Idempotent: skips if the demo restaurant already exists.
-- ============================================================================
do $$
declare
  rid uuid;
  cat_starters uuid; cat_mains uuid; cat_sushi uuid; cat_drinks uuid; cat_desserts uuid;
begin
  if exists (select 1 from restaurants where name = 'Sakura Dining') then
    raise notice 'Seed skipped — Sakura Dining already exists.';
    return;
  end if;

  -- Restaurant
  insert into restaurants (name, tagline, logo, currency, service_pct)
  values ('Sakura Dining', 'Modern Japanese Kitchen', '🌸', 'USD', 10)
  returning id into rid;

  -- Tables 1..12
  for i in 1..12 loop
    insert into restaurant_tables (restaurant_id, label) values (rid, i::text);
  end loop;

  -- Categories
  insert into categories (restaurant_id, name, sort_order) values (rid,'Starters',1) returning id into cat_starters;
  insert into categories (restaurant_id, name, sort_order) values (rid,'Mains',2)    returning id into cat_mains;
  insert into categories (restaurant_id, name, sort_order) values (rid,'Sushi',3)    returning id into cat_sushi;
  insert into categories (restaurant_id, name, sort_order) values (rid,'Drinks',4)   returning id into cat_drinks;
  insert into categories (restaurant_id, name, sort_order) values (rid,'Desserts',5) returning id into cat_desserts;

  -- Menu items
  insert into menu_items (restaurant_id, category_id, name, description, price, emoji, popular, modifiers, sort_order) values
  (rid, cat_starters, 'Edamame', 'Steamed salted soybeans with sea salt', 4.50, '🫛', true,
    '[{"label":"Spice level","type":"single","options":["Mild","Spicy","Extra Spicy"]}]', 1),
  (rid, cat_starters, 'Gyoza (6 pcs)', 'Pan-fried pork & cabbage dumplings with ponzu', 8.90, '🥟', true,
    '[{"label":"Cooking style","type":"single","options":["Pan-fried","Steamed"]},{"label":"Extra sauce","type":"multi","options":["Ponzu","Soy","Chili oil"]}]', 2),
  (rid, cat_starters, 'Miso Soup', 'Dashi-based miso with tofu, wakame, spring onion', 3.50, '🍵', false, '[]', 3),
  (rid, cat_mains, 'Tonkotsu Ramen', 'Rich pork bone broth, chashu, soft egg, nori', 14.90, '🍜', true,
    '[{"label":"Broth richness","type":"single","options":["Light","Regular","Rich"]},{"label":"Noodle firmness","type":"single","options":["Soft","Medium","Firm (kata)"]},{"label":"Extras","type":"multi","options":["Extra chashu +$3","Extra egg +$1.5","Extra nori +$1"]}]', 1),
  (rid, cat_mains, 'Katsu Curry', 'Crispy panko chicken katsu, Japanese curry, rice', 13.50, '🍛', false,
    '[{"label":"Protein","type":"single","options":["Chicken","Pork","Tofu (V)"]},{"label":"Curry heat","type":"single","options":["Mild","Medium","Hot"]}]', 2),
  (rid, cat_mains, 'Teriyaki Salmon', 'Grilled salmon, house teriyaki, rice and pickles', 17.90, '🐟', false,
    '[{"label":"Side","type":"single","options":["Steamed rice","Soba noodles","Salad"]}]', 3),
  (rid, cat_sushi, 'Salmon Nigiri (4 pcs)', 'Hand-pressed vinegared rice, fresh salmon', 11.50, '🍣', true,
    '[{"label":"Wasabi","type":"single","options":["With wasabi","No wasabi"]}]', 1),
  (rid, cat_sushi, 'Dragon Roll (8 pcs)', 'Prawn tempura, avocado & eel, spicy mayo', 16.90, '🐉', true,
    '[{"label":"Sauce","type":"single","options":["Spicy mayo","Teriyaki","Both"]}]', 2),
  (rid, cat_drinks, 'Asahi Beer', 'Japanese lager, 330ml bottle', 5.50, '🍺', false, '[]', 1),
  (rid, cat_drinks, 'Matcha Latte', 'Ceremonial grade matcha, steamed oat milk', 4.90, '🍵', true,
    '[{"label":"Milk","type":"single","options":["Oat","Soy","Full cream"]}]', 2),
  (rid, cat_drinks, 'Yuzu Lemonade', 'Yuzu citrus syrup, sparkling water, mint', 4.50, '🍋', false,
    '[{"label":"Sugar","type":"single","options":["Normal","Less sweet","No sugar"]}]', 3),
  (rid, cat_desserts, 'Mochi Ice Cream (3 pcs)', 'Soft rice cake with ice cream filling', 7.90, '🍡', true,
    '[{"label":"Flavours","type":"multi","options":["Matcha","Strawberry","Mango","Vanilla","Black sesame"]}]', 1),
  (rid, cat_desserts, 'Matcha Tiramisu', 'Matcha-soaked ladyfingers, mascarpone', 8.50, '🍰', false, '[]', 2);

  raise notice 'Seeded restaurant id: %', rid;
end $$;
