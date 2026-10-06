-- name: categories
SELECT DISTINCT category FROM products ORDER BY category;

-- name: product_revenue
-- description: Paid revenue and units per product in the range
SELECT p.name AS product,
       p.category,
       p.price,
       SUM(i.quantity) AS units,
       SUM(i.quantity * i.unit_price) AS revenue
FROM order_items i
JOIN orders o ON o.id = i.order_id
JOIN products p ON p.id = i.product_id
WHERE o.status = 'paid'
  AND o.ordered_at >= :from AND o.ordered_at < :to
  AND (:category IS NULL OR p.category = :category)
GROUP BY p.id
ORDER BY revenue DESC;

-- name: category_periods
-- description: Paid revenue per category in the range and in the same-length period before it (not narrowed by the category filter)
WITH bounds AS (
  SELECT :from AS cur_from,
         :to AS cur_to,
         date(:from, '-' || CAST(julianday(:to) - julianday(:from) AS INTEGER) || ' days') AS prev_from
)
SELECT p.category,
       CASE WHEN o.ordered_at >= b.cur_from THEN '本期' ELSE '上一期' END AS period,
       SUM(i.quantity * i.unit_price) AS revenue
FROM order_items i
JOIN orders o ON o.id = i.order_id
JOIN products p ON p.id = i.product_id, bounds b
WHERE o.status = 'paid' AND o.ordered_at >= b.prev_from AND o.ordered_at < b.cur_to
GROUP BY p.category, period
ORDER BY period DESC, p.category;

-- name: category_by_month
-- description: Paid revenue per category and calendar month (not narrowed by the category filter)
SELECT strftime('%Y-%m', o.ordered_at) AS month,
       p.category,
       SUM(i.quantity * i.unit_price) AS revenue
FROM order_items i
JOIN orders o ON o.id = i.order_id
JOIN products p ON p.id = i.product_id
WHERE o.status = 'paid'
  AND o.ordered_at >= :from AND o.ordered_at < :to
GROUP BY month, p.category
ORDER BY month, p.category;
