-- name: traffic_by_source
-- description: Weekly sessions per acquisition source
SELECT date(date, 'weekday 0', '-6 days') AS week,
       source,
       SUM(sessions) AS sessions
FROM daily_traffic
WHERE date >= :from AND date < :to
GROUP BY week, source
ORDER BY week, source;

-- name: funnel_totals
SELECT
  (SELECT SUM(sessions) FROM daily_traffic WHERE date >= :from AND date < :to) AS sessions,
  (SELECT SUM(signups) FROM daily_traffic WHERE date >= :from AND date < :to) AS signups,
  (SELECT COUNT(*) FROM orders WHERE status = 'paid' AND ordered_at >= :from AND ordered_at < :to) AS orders,
  1.0 * (SELECT COUNT(*) FROM orders WHERE status = 'paid' AND ordered_at >= :from AND ordered_at < :to)
      / (SELECT SUM(sessions) FROM daily_traffic WHERE date >= :from AND date < :to) AS conversion;

-- name: new_vs_returning
-- description: Paid orders per month, by whether it was the customer's first order
WITH firsts AS (
  SELECT customer_id, MIN(ordered_at) AS first_at FROM orders WHERE status = 'paid' GROUP BY customer_id
)
SELECT strftime('%Y-%m', o.ordered_at) AS month,
       SUM(o.ordered_at = f.first_at) AS new_customers,
       SUM(o.ordered_at > f.first_at) AS returning_customers
FROM orders o
JOIN firsts f ON f.customer_id = o.customer_id
WHERE o.status = 'paid' AND o.ordered_at >= :from AND o.ordered_at < :to
GROUP BY month
ORDER BY month;

-- name: channel_quality
-- description: Customers who signed up in the range, by how they found us
SELECT c.acquisition_channel AS channel,
       COUNT(DISTINCT c.id) AS customers,
       COUNT(DISTINCT o.customer_id) AS buyers,
       1.0 * COUNT(DISTINCT o.customer_id) / COUNT(DISTINCT c.id) AS buyer_rate,
       COALESCE(SUM(i.quantity * i.unit_price), 0) / COUNT(DISTINCT c.id) AS revenue_per_customer
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.id AND o.status = 'paid'
LEFT JOIN order_items i ON i.order_id = o.id
WHERE c.signed_up_at >= :from AND c.signed_up_at < :to
GROUP BY c.acquisition_channel
ORDER BY revenue_per_customer DESC;

-- name: funnel
-- description: Sessions, sign-ups, and customers who signed up in the range and then bought once, then again
WITH signed AS (
  SELECT id FROM customers WHERE signed_up_at >= :from AND signed_up_at < :to
),
paid AS (
  SELECT o.customer_id, COUNT(*) AS n
  FROM orders o JOIN signed s ON s.id = o.customer_id
  WHERE o.status = 'paid'
  GROUP BY o.customer_id
)
SELECT '工作階段' AS stage, (SELECT SUM(sessions) FROM daily_traffic WHERE date >= :from AND date < :to) AS people, 1 AS step
UNION ALL SELECT '註冊', (SELECT COUNT(*) FROM signed), 2
UNION ALL SELECT '首次購買', (SELECT COUNT(*) FROM paid), 3
UNION ALL SELECT '回購', (SELECT COUNT(*) FROM paid WHERE n >= 2), 4
ORDER BY step;

-- name: month_pace
-- description: Paid revenue this calendar month so far, against all of last month
WITH paid AS (
  SELECT o.ordered_at, SUM(i.quantity * i.unit_price) AS amount
  FROM orders o JOIN order_items i ON i.order_id = o.id
  WHERE o.status = 'paid' AND o.ordered_at >= date('now', 'localtime', 'start of month', '-1 month')
  GROUP BY o.id
),
-- scale is the gauge's full arc: a quarter above the larger of the two
totals AS (
  SELECT
    SUM(CASE WHEN ordered_at >= date('now', 'localtime', 'start of month')
              AND ordered_at < datetime('now', 'localtime') THEN amount END) AS this_month,
    SUM(CASE WHEN ordered_at < date('now', 'localtime', 'start of month') THEN amount END) AS last_month
  FROM paid
)
SELECT this_month, last_month,
       MAX(COALESCE(this_month, 0), COALESCE(last_month, 0)) * 1.25 AS scale
FROM totals;
