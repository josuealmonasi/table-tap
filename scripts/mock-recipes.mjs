// ============================================================================
// Recipes for the rest of the demo menu, so Costs can show a margin for every
// dish the presentation opens (feed-demo). Quantities are what a kitchen
// actually plates. Soup of the Day and Apple Pie stay without one on purpose:
// "sales with no recipe" is part of the tour. Pack prices are on the menu's own scale, so a price scale
// (DEMO_PRICE_SCALE) moves both together and food cost stays near 25–35%.
// ============================================================================

const M = "Central Market", B = "Butcher Ruiz", F = "Pacific Fish", D = "Valley Dairy",
  P = "Pantry Wholesale", L = "La Cava Drinks";

// name, unit, pack size (g/ml/pza), pack price, supplier
export const MORE_INGREDIENTS = [
  ["Chicken thigh", "g", 1000, 6, B], ["Pork belly", "g", 1000, 7.5, B], ["Ribeye", "g", 1000, 26, B],
  ["Bacon strips", "g", 1000, 11, B], ["Salmon fillet", "g", 1000, 22, F], ["White fish", "g", 1000, 12, F],
  ["Squid", "g", 1000, 10, F], ["Egg", "pza", 30, 4.5, D], ["Butter", "g", 1000, 9, D],
  ["Mozzarella", "g", 1000, 9.5, D], ["Parmesan", "g", 1000, 22, D], ["Cream", "ml", 1000, 4, D],
  ["Mascarpone", "g", 500, 6, D], ["Cream cheese", "g", 1000, 8, D], ["Sour cream base", "g", 1000, 4, D],
  ["Rice", "g", 5000, 7, P], ["Ramen noodles", "g", 1000, 3.2, P], ["Rice noodles", "g", 1000, 2.8, P],
  ["Spaghetti", "g", 1000, 2, P], ["Flour", "g", 5000, 4, P], ["Panko", "g", 1000, 3.5, P],
  ["Corn tortilla", "pza", 30, 1.5, P], ["Tortilla chips", "g", 1000, 4, P], ["Sourdough", "pza", 12, 4.8, P],
  ["Pizza dough", "pza", 10, 6, P], ["Curry paste", "g", 1000, 9, P], ["Pork broth", "ml", 1000, 2.2, P],
  ["Vegetable stock", "ml", 1000, 1.2, P], ["Frying oil", "ml", 1000, 2.4, P], ["Chocolate", "g", 1000, 12, P],
  ["Matcha", "g", 100, 6, P], ["Rice flour", "g", 1000, 3, P], ["Apple", "pza", 20, 4, M],
  ["Soybeans", "g", 1000, 4.5, M], ["Tomato", "g", 1000, 1.6, M], ["Onion", "g", 1000, 1, M],
  ["Lettuce", "g", 1000, 2.2, M], ["Mixed vegetables", "g", 1000, 2.6, M], ["Basil", "g", 100, 1.5, M],
  ["Garlic", "g", 1000, 4, M], ["Scallion", "g", 1000, 3, M], ["Avocado fruit", "pza", 10, 6, M],
  ["Jalapeño pepper", "g", 1000, 2.5, M], ["Mushroom", "g", 1000, 5, M], ["Cabbage", "g", 1000, 1, M],
  ["Pickle", "g", 1000, 3, M], ["Kimchi base", "g", 1000, 6, M], ["Peanuts", "g", 1000, 5, M],
  ["Craft beer bottle", "pza", 24, 30, L], ["House red", "ml", 750, 7, L], ["Sparkling water bottle", "pza", 24, 14, L],
  ["Truffle oil bottle", "ml", 250, 9, L], ["Hot sauce", "ml", 1000, 3, P],
];

// product name → [ingredient, quantity]
export const MORE_RECIPES = {
  "Edamame": [["Soybeans", 150]],
  "Spring Rolls": [["Mixed vegetables", 120], ["Flour", 40], ["Frying oil", 30]],
  "Gyoza": [["Pork belly", 90], ["Flour", 60], ["Cabbage", 40], ["Garlic", 5]],
  "Bruschetta": [["Sourdough", 1], ["Tomato", 120], ["Basil", 3], ["Garlic", 4]],
  "Garlic Bread": [["Sourdough", 1], ["Butter", 25], ["Garlic", 8]],
  "Chicken Wings": [["Chicken thigh", 300], ["Hot sauce", 40], ["Frying oil", 40]],
  "Loaded Nachos": [["Tortilla chips", 150], ["Cheddar", 60], ["Jalapeño pepper", 20], ["Sour cream base", 40]],
  "Calamari": [["Squid", 180], ["Flour", 40], ["Frying oil", 40]],
  "Margherita Pizza": [["Pizza dough", 1], ["Mozzarella", 150], ["Tomato", 100], ["Basil", 3]],
  "Tonkotsu Ramen": [["Ramen noodles", 150], ["Pork belly", 120], ["Pork broth", 400], ["Egg", 1], ["Scallion", 10]],
  "Pad Thai": [["Rice noodles", 150], ["Chicken thigh", 120], ["Egg", 1], ["Peanuts", 20], ["Scallion", 10]],
  "Grilled Salmon": [["Salmon fillet", 200], ["Mixed vegetables", 150], ["Butter", 15]],
  "Ribeye Steak": [["Ribeye", 300], ["Potato", 200], ["Butter", 20]],
  "Chicken Curry": [["Chicken thigh", 180], ["Curry paste", 40], ["Cream", 80], ["Rice", 150]],
  "Fish & Chips": [["White fish", 200], ["Potato", 250], ["Flour", 50], ["Frying oil", 60]],
  "Spaghetti Carbonara": [["Spaghetti", 140], ["Bacon strips", 70], ["Egg", 2], ["Parmesan", 25]],
  "Beef Tacos": [["Ground beef", 150], ["Corn tortilla", 3], ["Onion", 40], ["Avocado fruit", 0.5]],
  "Veggie Buddha Bowl": [["Rice", 150], ["Mixed vegetables", 200], ["Avocado fruit", 0.5], ["Soybeans", 50]],
  "Katsu Curry": [["Pork belly", 160], ["Panko", 40], ["Curry paste", 40], ["Rice", 150], ["Frying oil", 40]],
  "Onion Rings": [["Onion", 200], ["Flour", 50], ["Frying oil", 40]],
  "Side Salad": [["Lettuce", 100], ["Tomato", 60]],
  "Mashed Potatoes": [["Potato", 250], ["Butter", 25], ["Cream", 40]],
  "Steamed Rice": [["Rice", 180]],
  "Coleslaw": [["Cabbage", 150], ["Sour cream base", 30]],
  "Cheesecake": [["Cream cheese", 120], ["Egg", 1], ["Sugar", 30], ["Flour", 30]],
  "Chocolate Lava Cake": [["Chocolate", 70], ["Butter", 40], ["Egg", 2], ["Sugar", 30]],
  "Matcha Tiramisu": [["Mascarpone", 100], ["Matcha", 4], ["Cream", 50], ["Sugar", 25]],
  "Mochi Ice Cream": [["Rice flour", 60], ["Cream", 80], ["Sugar", 25]],
  "Craft Beer": [["Craft beer bottle", 1]],
  "House Red Wine": [["House red", 150]],
  "Sparkling Water": [["Sparkling water bottle", 1]],
  // Extras.
  "Bacon": [["Bacon strips", 40]],
  "Avocado": [["Avocado fruit", 0.5]],
  "Fried Egg": [["Egg", 1], ["Frying oil", 10]],
  "Extra Sauce": [["Hot sauce", 30]],
  "Sautéed Mushrooms": [["Mushroom", 60], ["Butter", 10]],
  "Jalapeños": [["Jalapeño pepper", 30]],
  "Caramelized Onions": [["Onion", 80], ["Butter", 10]],
  "Pickles": [["Pickle", 40]],
  "Whipped Cream": [["Cream", 40], ["Sugar", 5]],
  "Truffle Oil": [["Truffle oil bottle", 5]],
  "Kimchi": [["Kimchi base", 60]],
  "Guacamole": [["Avocado fruit", 1], ["Onion", 20], ["Tomato", 30]],
  "Sour Cream": [["Sour cream base", 40]],
};
