-- name: regions
-- description: Options for the region filter
-- expect: rows > 0
-- expect: unique region
SELECT DISTINCT region FROM orders ORDER BY region;

-- name: kpis
-- description: Headline numbers for the selected range, with the same-length period before it
-- expect: rows = 1
-- expect: revenue >= 0
-- expect: orders >= 0
WITH bounds AS (
  SELECT :from AS cur_from,
         :to AS cur_to,
         date(:from, '-' || CAST(julianday(:to) - julianday(:from) AS INTEGER) || ' days') AS prev_from
),
paid AS (
  SELECT o.id, o.ordered_at, SUM(i.quantity * i.unit_price) AS amount
  FROM orders o
  JOIN order_items i ON i.order_id = o.id
  WHERE o.status = 'paid'
    AND (:region IS NULL OR o.region = :region)
  GROUP BY o.id
)
SELECT
  SUM(CASE WHEN p.ordered_at >= b.cur_from AND p.ordered_at < b.cur_to THEN p.amount END) AS revenue,
  SUM(CASE WHEN p.ordered_at >= b.prev_from AND p.ordered_at < b.cur_from THEN p.amount END) AS revenue_prev,
  COUNT(CASE WHEN p.ordered_at >= b.cur_from AND p.ordered_at < b.cur_to THEN 1 END) AS orders,
  COUNT(CASE WHEN p.ordered_at >= b.prev_from AND p.ordered_at < b.cur_from THEN 1 END) AS orders_prev,
  AVG(CASE WHEN p.ordered_at >= b.cur_from AND p.ordered_at < b.cur_to THEN p.amount END) AS aov,
  AVG(CASE WHEN p.ordered_at >= b.prev_from AND p.ordered_at < b.cur_from THEN p.amount END) AS aov_prev
FROM paid p, bounds b;

-- name: refund_rate
-- expect: rows = 1
-- expect: refund_rate between 0 and 1
SELECT
  1.0 * SUM(status = 'refunded') / COUNT(*) AS refund_rate
FROM orders
WHERE ordered_at >= :from AND ordered_at < :to
  AND (:region IS NULL OR region = :region);

-- name: daily_revenue
-- description: Revenue per day, for sparklines and the trend chart
-- expect: unique day
-- expect: revenue >= 0
SELECT date(o.ordered_at) AS day,
       SUM(i.quantity * i.unit_price) AS revenue,
       COUNT(DISTINCT o.id) AS orders
FROM orders o
JOIN order_items i ON i.order_id = o.id
WHERE o.status = 'paid'
  AND o.ordered_at >= :from AND o.ordered_at < :to
  AND (:region IS NULL OR o.region = :region)
GROUP BY day
ORDER BY day;

-- name: revenue_by_channel
-- description: Weekly revenue split by sales channel (long form: one row per week and channel)
-- expect: unique week, channel
-- expect: revenue >= 0
SELECT date(o.ordered_at, 'weekday 0', '-6 days') AS week,
       o.channel,
       SUM(i.quantity * i.unit_price) AS revenue
FROM orders o
JOIN order_items i ON i.order_id = o.id
WHERE o.status = 'paid'
  AND o.ordered_at >= :from AND o.ordered_at < :to
  AND (:region IS NULL OR o.region = :region)
GROUP BY week, o.channel
ORDER BY week, CASE o.channel WHEN 'web' THEN 1 WHEN 'mobile' THEN 2 ELSE 3 END;

-- name: top_products
-- expect: rows <= 10
-- expect: unique product
-- expect: units >= 0
SELECT p.name AS product,
       SUM(i.quantity) AS units,
       SUM(i.quantity * i.unit_price) AS revenue
FROM order_items i
JOIN orders o ON o.id = i.order_id
JOIN products p ON p.id = i.product_id
WHERE o.status = 'paid'
  AND o.ordered_at >= :from AND o.ordered_at < :to
  AND (:region IS NULL OR o.region = :region)
GROUP BY p.id
ORDER BY revenue DESC
LIMIT 10;

-- name: revenue_by_category
-- expect: unique category
-- expect: revenue >= 0
SELECT p.category,
       SUM(i.quantity * i.unit_price) AS revenue
FROM order_items i
JOIN orders o ON o.id = i.order_id
JOIN products p ON p.id = i.product_id
WHERE o.status = 'paid'
  AND o.ordered_at >= :from AND o.ordered_at < :to
  AND (:region IS NULL OR o.region = :region)
GROUP BY p.category
ORDER BY revenue DESC;

-- name: revenue_by_region
-- expect: unique region
-- expect: revenue >= 0
SELECT o.region,
       SUM(i.quantity * i.unit_price) AS revenue
FROM orders o
JOIN order_items i ON i.order_id = o.id
WHERE o.status = 'paid'
  AND o.ordered_at >= :from AND o.ordered_at < :to
GROUP BY o.region
ORDER BY revenue DESC;

-- name: recent_orders
-- expect: unique order_id
-- expect: total >= 0
SELECT o.id AS order_id,
       o.ordered_at,
       c.name AS customer,
       o.region,
       o.channel,
       o.status,
       SUM(i.quantity * i.unit_price) AS total
FROM orders o
JOIN customers c ON c.id = o.customer_id
JOIN order_items i ON i.order_id = o.id
WHERE o.ordered_at >= :from AND o.ordered_at < :to
  AND (:region IS NULL OR o.region = :region)
GROUP BY o.id
ORDER BY o.ordered_at DESC
LIMIT 50;
