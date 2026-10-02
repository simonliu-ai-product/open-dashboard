-- name: today_vs_yesterday
-- description: Today so far against yesterday up to the same time of day (server local time)
WITH bounds AS (
  SELECT date('now', 'localtime') AS today,
         datetime('now', 'localtime') AS now_today,
         date('now', 'localtime', '-1 day') AS yesterday,
         datetime('now', 'localtime', '-1 day') AS now_yesterday
),
recent AS (
  SELECT o.id, o.ordered_at, o.status,
         (SELECT SUM(i.quantity * i.unit_price) FROM order_items i WHERE i.order_id = o.id) AS amount
  FROM orders o, bounds b
  WHERE o.ordered_at >= b.yesterday AND o.ordered_at < b.now_today
)
SELECT
  SUM(CASE WHEN r.status = 'paid' AND r.ordered_at >= b.today THEN r.amount END) AS revenue_today,
  SUM(CASE WHEN r.status = 'paid' AND r.ordered_at < b.now_yesterday THEN r.amount END) AS revenue_yesterday,
  COUNT(CASE WHEN r.status = 'paid' AND r.ordered_at >= b.today THEN 1 END) AS orders_today,
  COUNT(CASE WHEN r.status = 'paid' AND r.ordered_at < b.now_yesterday THEN 1 END) AS orders_yesterday,
  COUNT(CASE WHEN r.status IN ('cancelled', 'refunded') AND r.ordered_at >= b.today THEN 1 END) AS issues_today,
  COUNT(CASE WHEN r.status IN ('cancelled', 'refunded') AND r.ordered_at < b.now_yesterday THEN 1 END) AS issues_yesterday,
  b.now_today AS as_of
FROM recent r, bounds b;

-- name: hourly_orders
-- description: Orders placed per hour, every hour present (empty hours are 0), up to now
WITH RECURSIVE hours(hour) AS (
  SELECT strftime('%Y-%m-%d %H:00:00', 'now', 'localtime', '-' || :days || ' days')
  UNION ALL
  SELECT datetime(hour, '+1 hour') FROM hours
  WHERE hour < strftime('%Y-%m-%d %H:00:00', 'now', 'localtime')
),
counts AS (
  SELECT strftime('%Y-%m-%d %H:00:00', ordered_at) AS hour,
         SUM(status = 'paid') AS paid,
         SUM(status IN ('cancelled', 'refunded')) AS cancelled_or_refunded
  FROM orders
  WHERE ordered_at >= (SELECT MIN(hour) FROM hours)
    AND ordered_at < datetime('now', 'localtime')
  GROUP BY 1
)
SELECT h.hour,
       COALESCE(c.paid, 0) AS paid,
       COALESCE(c.cancelled_or_refunded, 0) AS cancelled_or_refunded
FROM hours h
LEFT JOIN counts c ON c.hour = h.hour
ORDER BY h.hour;

-- name: recent_orders
SELECT o.id AS order_id,
       o.ordered_at,
       c.name AS customer,
       o.channel,
       o.region,
       o.status,
       SUM(i.quantity * i.unit_price) AS total
FROM orders o
JOIN customers c ON c.id = o.customer_id
JOIN order_items i ON i.order_id = o.id
WHERE o.ordered_at < datetime('now', 'localtime')
GROUP BY o.id
ORDER BY o.ordered_at DESC
LIMIT 50;

-- name: today_issues
-- description: Today's cancelled and refunded orders, newest first
SELECT o.id AS order_id,
       strftime('%H:%M', o.ordered_at) AS time,
       o.status,
       c.name AS customer,
       o.channel,
       o.region,
       SUM(i.quantity * i.unit_price) AS total
FROM orders o
JOIN customers c ON c.id = o.customer_id
JOIN order_items i ON i.order_id = o.id
WHERE o.status IN ('cancelled', 'refunded')
  AND o.ordered_at >= date('now', 'localtime')
  AND o.ordered_at < datetime('now', 'localtime')
GROUP BY o.id
ORDER BY o.ordered_at DESC;

-- name: weekday_hour
-- description: Paid orders by weekday and hour of day over the last four weeks, up to now
WITH placed AS (
  SELECT CAST(strftime('%w', ordered_at) AS INTEGER) AS dow,
         CAST(strftime('%H', ordered_at) AS INTEGER) AS hour
  FROM orders
  WHERE status = 'paid'
    AND ordered_at >= date('now', 'localtime', '-28 days')
    AND ordered_at < datetime('now', 'localtime')
)
SELECT printf('%02d:00', hour) AS hour,
       CASE dow WHEN 1 THEN '週一' WHEN 2 THEN '週二' WHEN 3 THEN '週三' WHEN 4 THEN '週四'
                WHEN 5 THEN '週五' WHEN 6 THEN '週六' ELSE '週日' END AS weekday,
       COUNT(*) AS orders
FROM placed
GROUP BY dow, hour
ORDER BY (dow + 6) % 7, hour;
