-- name: totals
SELECT SUM(amount) AS revenue,
       COUNT(*) AS orders,
       AVG(amount) AS average_order
FROM orders
WHERE status = 'paid'
  AND ordered_at >= :from AND ordered_at < :to;

-- name: revenue_by_week
SELECT date(ordered_at, 'weekday 0', '-6 days') AS week,
       SUM(amount) AS revenue
FROM orders
WHERE status = 'paid'
  AND ordered_at >= :from AND ordered_at < :to
GROUP BY week
ORDER BY week;

-- name: revenue_by_category
SELECT category, SUM(amount) AS revenue
FROM orders
WHERE status = 'paid'
  AND ordered_at >= :from AND ordered_at < :to
GROUP BY category
ORDER BY revenue DESC;

-- name: top_products
SELECT product, COUNT(*) AS orders, SUM(amount) AS revenue
FROM orders
WHERE status = 'paid'
  AND ordered_at >= :from AND ordered_at < :to
GROUP BY product
ORDER BY revenue DESC;
