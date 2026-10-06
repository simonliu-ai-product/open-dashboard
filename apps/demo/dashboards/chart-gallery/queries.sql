-- Every query here counts paid orders only, unless its description says otherwise.
-- "The previous period" is the range of the same length just before :from.

-- name: city_order_value
-- description: Average paid order value per customer city
WITH totals AS (
  SELECT o.id, c.city, SUM(i.quantity * i.unit_price) AS total
  FROM orders o
  JOIN customers c ON c.id = o.customer_id
  JOIN order_items i ON i.order_id = o.id
  WHERE o.status = 'paid' AND o.ordered_at >= :from AND o.ordered_at < :to
  GROUP BY o.id
)
SELECT city, AVG(total) AS avg_order_value FROM totals GROUP BY city ORDER BY avg_order_value DESC;

-- name: region_periods
-- description: Paid revenue per region, previous period vs this one
WITH bounds AS (
  SELECT datetime(:from, printf('%+f days', julianday(:from) - julianday(:to))) AS prev_from
)
SELECT o.region,
       SUM(CASE WHEN o.ordered_at < :from THEN i.quantity * i.unit_price ELSE 0 END) AS previous,
       SUM(CASE WHEN o.ordered_at >= :from THEN i.quantity * i.unit_price ELSE 0 END) AS current
FROM orders o
JOIN order_items i ON i.order_id = o.id, bounds
WHERE o.status = 'paid' AND o.ordered_at >= bounds.prev_from AND o.ordered_at < :to
GROUP BY o.region
ORDER BY current DESC;

-- name: channel_targets
-- description: Paid revenue per channel against a target of the previous period plus 10%
WITH bounds AS (
  SELECT datetime(:from, printf('%+f days', julianday(:from) - julianday(:to))) AS prev_from
), sums AS (
  SELECT o.channel,
         SUM(CASE WHEN o.ordered_at < :from THEN i.quantity * i.unit_price ELSE 0 END) AS previous,
         SUM(CASE WHEN o.ordered_at >= :from THEN i.quantity * i.unit_price ELSE 0 END) AS revenue
  FROM orders o
  JOIN order_items i ON i.order_id = o.id, bounds
  WHERE o.status = 'paid' AND o.ordered_at >= bounds.prev_from AND o.ordered_at < :to
  GROUP BY o.channel
)
SELECT channel, revenue, ROUND(previous * 1.1) AS target,
       ROUND(previous * 0.8) AS poor, ROUND(previous) AS fair
FROM sums
ORDER BY revenue DESC;

-- name: category_change
-- description: Change in paid revenue per category, as a fraction of the previous period
WITH bounds AS (
  SELECT datetime(:from, printf('%+f days', julianday(:from) - julianday(:to))) AS prev_from
), sums AS (
  SELECT p.category,
         SUM(CASE WHEN o.ordered_at < :from THEN i.quantity * i.unit_price ELSE 0 END) AS previous,
         SUM(CASE WHEN o.ordered_at >= :from THEN i.quantity * i.unit_price ELSE 0 END) AS current
  FROM orders o
  JOIN order_items i ON i.order_id = o.id
  JOIN products p ON p.id = i.product_id, bounds
  WHERE o.status = 'paid' AND o.ordered_at >= bounds.prev_from AND o.ordered_at < :to
  GROUP BY p.category
)
SELECT category, (current - previous) / previous AS change FROM sums ORDER BY change DESC;

-- name: region_channel
-- description: Paid revenue per region and channel
SELECT o.region, o.channel, SUM(i.quantity * i.unit_price) AS revenue
FROM orders o
JOIN order_items i ON i.order_id = o.id
WHERE o.status = 'paid' AND o.ordered_at >= :from AND o.ordered_at < :to
GROUP BY o.region, o.channel
ORDER BY o.region, o.channel;

-- name: category_by_month
-- description: Paid revenue per category and calendar month, last 12 months (ignores the time filter)
SELECT strftime('%Y-%m', o.ordered_at) AS month, p.category, SUM(i.quantity * i.unit_price) AS revenue
FROM orders o
JOIN order_items i ON i.order_id = o.id
JOIN products p ON p.id = i.product_id
WHERE o.status = 'paid'
  AND o.ordered_at >= strftime('%Y-%m-01', 'now', 'localtime', '-11 months')
GROUP BY month, p.category
ORDER BY month, p.category;

-- name: revenue_bridge
-- description: Previous period's paid revenue, the change per category, and this period's total
WITH bounds AS (
  SELECT datetime(:from, printf('%+f days', julianday(:from) - julianday(:to))) AS prev_from
), sums AS (
  SELECT p.category,
         SUM(CASE WHEN o.ordered_at < :from THEN i.quantity * i.unit_price ELSE 0 END) AS previous,
         SUM(CASE WHEN o.ordered_at >= :from THEN i.quantity * i.unit_price ELSE 0 END) AS current
  FROM orders o
  JOIN order_items i ON i.order_id = o.id
  JOIN products p ON p.id = i.product_id, bounds
  WHERE o.status = 'paid' AND o.ordered_at >= bounds.prev_from AND o.ordered_at < :to
  GROUP BY p.category
)
SELECT step, change, kind FROM (
  SELECT 0 AS ord, '上一期' AS step, SUM(previous) AS change, 'total' AS kind FROM sums
  UNION ALL
  SELECT 1, category, current - previous, 'step' FROM sums
  UNION ALL
  SELECT 2, '本期', SUM(current), 'total' FROM sums
)
ORDER BY ord, change DESC;

-- name: daily_orders
-- description: Paid orders per day over the last year (ignores the time filter)
SELECT date(ordered_at) AS day, COUNT(*) AS orders
FROM orders
WHERE status = 'paid' AND ordered_at >= date('now', 'localtime', '-364 days')
GROUP BY day
ORDER BY day;

-- name: category_by_week
-- description: Paid revenue per category and week
SELECT date(o.ordered_at, 'weekday 1', '-7 days') AS week, p.category, SUM(i.quantity * i.unit_price) AS revenue
FROM orders o
JOIN order_items i ON i.order_id = o.id
JOIN products p ON p.id = i.product_id
WHERE o.status = 'paid' AND o.ordered_at >= :from AND o.ordered_at < :to
GROUP BY week, p.category
ORDER BY week, p.category;

-- name: daily_revenue_band
-- description: Paid revenue per day with its trailing 7-day average and min–max range
WITH daily AS (
  SELECT date(o.ordered_at) AS day, SUM(i.quantity * i.unit_price) AS revenue
  FROM orders o
  JOIN order_items i ON i.order_id = o.id
  WHERE o.status = 'paid' AND o.ordered_at >= :from AND o.ordered_at < :to
  GROUP BY day
)
SELECT day,
       AVG(revenue) OVER w AS avg_7d,
       MIN(revenue) OVER w AS low_7d,
       MAX(revenue) OVER w AS high_7d
FROM daily
WINDOW w AS (ORDER BY day ROWS BETWEEN 6 PRECEDING AND CURRENT ROW)
ORDER BY day;

-- name: daily_refund_rate
-- description: Share of each day's orders that were refunded (all statuses counted)
SELECT date(ordered_at) AS day,
       AVG(CASE WHEN status = 'refunded' THEN 1.0 ELSE 0 END) AS refund_rate
FROM orders
WHERE ordered_at >= :from AND ordered_at < :to
GROUP BY day
ORDER BY day;

-- name: hourly_orders_by_region
-- description: Paid orders per hour and region over the last 7 days (ignores the time filter)
SELECT strftime('%Y-%m-%d %H:00', ordered_at) AS hour, region, COUNT(*) AS orders
FROM orders
WHERE status = 'paid' AND ordered_at >= datetime('now', 'localtime', '-7 days')
  AND ordered_at < datetime('now', 'localtime')
GROUP BY hour, region
ORDER BY hour, region;

-- name: fulfillment_recent
-- description: The 30 most recent pick, pack and ship jobs (ignores the time filter)
SELECT worker, stage, started_at, finished_at
FROM fulfillment_jobs
ORDER BY started_at DESC
LIMIT 30;

-- name: relaunch_plan
-- description: The store relaunch plan, task by task (ignores the time filter)
SELECT id, task, phase, owner, start_date, end_date, after, progress
FROM project_tasks
ORDER BY rowid;

-- name: bean_prices
-- description: Daily green-coffee price, open / high / low / close
SELECT date, open, high, low, close
FROM bean_prices
WHERE date >= date(:from) AND date < date(:to)
ORDER BY date;

-- name: order_values
-- description: One row per paid order: its value and channel
SELECT o.channel, SUM(i.quantity * i.unit_price) AS order_value
FROM orders o
JOIN order_items i ON i.order_id = o.id
WHERE o.status = 'paid' AND o.ordered_at >= :from AND o.ordered_at < :to
GROUP BY o.id
LIMIT 5000;

-- name: product_prices
-- description: List price of every product, by category
SELECT category, name, price FROM products ORDER BY category, price;

-- name: customer_revenue
-- description: Paid revenue per customer in the range
SELECT c.name AS customer, SUM(i.quantity * i.unit_price) AS revenue
FROM orders o
JOIN customers c ON c.id = o.customer_id
JOIN order_items i ON i.order_id = o.id
WHERE o.status = 'paid' AND o.ordered_at >= :from AND o.ordered_at < :to
GROUP BY c.id
ORDER BY revenue DESC;

-- name: order_flow
-- description: Orders from acquisition channel to order channel, then order channel to outcome (all statuses)
WITH scoped AS (
  SELECT c.acquisition_channel AS acquired, o.channel, o.status
  FROM orders o JOIN customers c ON c.id = o.customer_id
  WHERE o.ordered_at >= :from AND o.ordered_at < :to
)
SELECT '來源 ' || acquired AS source, '下單 ' || channel AS target, COUNT(*) AS orders
FROM scoped GROUP BY acquired, channel
UNION ALL
SELECT '下單 ' || channel, status, COUNT(*) FROM scoped GROUP BY channel, status;

-- name: signup_cohorts
-- description: Customers who placed a paid order N months after their sign-up month, last 12 cohorts (ignores the time filter)
WITH first AS (
  SELECT id, strftime('%Y-%m', signed_up_at) AS cohort,
         CAST(strftime('%Y', signed_up_at) AS INT) * 12 + CAST(strftime('%m', signed_up_at) AS INT) AS start
  FROM customers
  WHERE signed_up_at >= strftime('%Y-%m-01', 'now', 'localtime', '-11 months')
), active AS (
  SELECT DISTINCT f.id, f.cohort,
         CAST(strftime('%Y', o.ordered_at) AS INT) * 12 + CAST(strftime('%m', o.ordered_at) AS INT) - f.start AS period
  FROM first f JOIN orders o ON o.customer_id = f.id
  WHERE o.status = 'paid'
), sizes AS (
  SELECT cohort, COUNT(*) AS customers FROM first GROUP BY cohort
)
SELECT a.cohort, a.period, COUNT(*) AS active, s.customers
FROM active a JOIN sizes s ON s.cohort = a.cohort
WHERE a.period >= 0
GROUP BY a.cohort, a.period
ORDER BY a.cohort, a.period;

-- name: category_combinations
-- description: Customers by the exact set of categories they bought from in the range
WITH bought AS (
  SELECT DISTINCT o.customer_id, p.category
  FROM orders o
  JOIN order_items i ON i.order_id = o.id
  JOIN products p ON p.id = i.product_id
  WHERE o.status = 'paid' AND o.ordered_at >= :from AND o.ordered_at < :to
  ORDER BY o.customer_id, p.category
), combos AS (
  SELECT customer_id, group_concat(category, ',') AS categories FROM bought GROUP BY customer_id
)
SELECT categories, COUNT(*) AS customers FROM combos GROUP BY categories ORDER BY customers DESC;

-- name: city_revenue
-- description: Paid revenue and orders per customer city, with its coordinates
SELECT c.city, k.lat, k.lng, c.region,
       COUNT(DISTINCT o.id) AS orders,
       SUM(i.quantity * i.unit_price) AS revenue
FROM orders o
JOIN customers c ON c.id = o.customer_id
JOIN order_items i ON i.order_id = o.id
JOIN city_coordinates k ON k.city = c.city
WHERE o.status = 'paid' AND o.ordered_at >= :from AND o.ordered_at < :to
GROUP BY c.city
ORDER BY revenue DESC;

-- name: service_status
-- description: Health checks every 10 minutes, 29 Sep – 1 Oct (fixed sample, ignores the time filter)
SELECT checked_at, service, status FROM service_checks ORDER BY service, checked_at;
